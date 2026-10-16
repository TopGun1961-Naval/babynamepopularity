// Baby Page API (Cloudflare Pages Function).
// Storage: a KV namespace bound to this Pages project as BNP_DATA.
// Without the binding every call answers 503 {error:"storage-not-connected"}
// and the page runs in preview mode (saved only in the visitor's browser).
//
// Routes
//   POST /api/baby                 create a page   -> {id, edit}
//   GET  /api/baby/:id             page + tallies  (+ owner view with X-Edit-Token)
//   PUT  /api/baby/:id             update (X-Edit-Token)
//   DELETE /api/baby/:id           delete page and its votes/guesses (X-Edit-Token)
//   POST /api/baby/:id/vote        {voter, picks:[...]}
//   POST /api/baby/:id/guess       {voter, who, date, lbs, oz, sex, initial}
//   POST /api/baby/:id/event       {type:"share"}
//   GET  /api/baby/stats/summary   network totals (X-Admin-Token = env.BNP_ADMIN_TOKEN)

const J = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const ID_RE = /^[A-Za-z0-9]{8,16}$/;
const VOTER_RE = /^[A-Za-z0-9_-]{8,40}$/;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function rid(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += ALPHA[x % ALPHA.length];
  return s;
}
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null;
};
function url(v) {
  const s = str(v, 400);
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

// Only the fields a page may hold; everything else is dropped.
function clean(b, prev = {}) {
  const out = { ...prev };
  if ("title" in b) out.title = str(b.title, 60) || "Our baby";
  if ("hosts" in b) out.hosts = str(b.hosts, 80);
  if ("due" in b) out.due = date(b.due);
  if ("message" in b) out.message = str(b.message, 400);
  if ("names" in b && Array.isArray(b.names)) {
    const seen = new Set();
    out.names = b.names
      .map((n) => ({ key: str(n && n.key, 40).toLowerCase(), name: str(n && n.name, 30) }))
      .filter((n) => n.name && !seen.has(n.name.toLowerCase()) && seen.add(n.name.toLowerCase()))
      .slice(0, 12);
  }
  if ("registries" in b && Array.isArray(b.registries)) {
    out.registries = b.registries
      .map((r) => ({ label: str(r && r.label, 40), url: url(r && r.url) }))
      .filter((r) => r.url)
      .slice(0, 8);
  }
  if ("features" in b && b.features && typeof b.features === "object") {
    out.features = { poll: !!b.features.poll, pool: !!b.features.pool, registry: !!b.features.registry };
  }
  if ("born" in b) {
    const x = b.born && typeof b.born === "object" ? b.born : null;
    out.born = x && x.name
      ? { name: str(x.name, 40), date: date(x.date), lbs: num(x.lbs, 0, 20), oz: num(x.oz, 0, 15.9), sex: ["g", "b", ""].includes(x.sex) ? x.sex : "" }
      : null;
  }
  return out;
}

async function tallies(kv, id) {
  const votes = {}, guesses = [];
  let voters = 0, cursor;
  do {
    const r = await kv.list({ prefix: `v:${id}:`, cursor });
    for (const k of r.keys) {
      voters++;
      for (const p of (k.metadata && k.metadata.p) || []) votes[p] = (votes[p] || 0) + 1;
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  cursor = undefined;
  do {
    const r = await kv.list({ prefix: `g:${id}:`, cursor });
    for (const k of r.keys) if (k.metadata) guesses.push(k.metadata);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return { votes, voters, guesses };
}

async function bump(kv, key, field, by = 1) {
  const s = (await kv.get(key, "json")) || {};
  s[field] = (s[field] || 0) + by;
  await kv.put(key, JSON.stringify(s));
}

export async function onRequest({ request, env, params }) {
  const kv = env.BNP_DATA;
  if (!kv) return J({ error: "storage-not-connected" }, 503);
  const parts = (params.path || []).filter(Boolean);
  const m = request.method;
  let body = {};
  if (m === "POST" || m === "PUT") {
    const t = await request.text();
    if (t.length > 8000) return J({ error: "too-large" }, 413);
    try { body = t ? JSON.parse(t) : {}; } catch { return J({ error: "bad-json" }, 400); }
  }

  // Network totals for the owner (optional secret set in Pages settings).
  if (parts[0] === "stats" && m === "GET") {
    if (!env.BNP_ADMIN_TOKEN || request.headers.get("x-admin-token") !== env.BNP_ADMIN_TOKEN) return J({ error: "forbidden" }, 403);
    return J((await kv.get("stats:all", "json")) || {});
  }

  if (parts.length === 0) {
    if (m !== "POST") return J({ error: "method" }, 405);
    const id = rid(10), edit = rid(24);
    const ref = ID_RE.test(body.ref || "") ? body.ref : "";
    const page = clean(body, {
      id, created: new Date().toISOString(), ref,
      features: { poll: true, pool: true, registry: true }, names: [], registries: [], born: null,
    });
    page.editHash = await sha(edit);
    await kv.put(`p:${id}`, JSON.stringify(page));
    await bump(kv, "stats:all", "pages");
    if (ref) { await bump(kv, `s:${ref}`, "children"); await bump(kv, "stats:all", "referredPages"); }
    return J({ id, edit }, 201);
  }

  const id = parts[0];
  if (!ID_RE.test(id)) return J({ error: "not-found" }, 404);
  const page = await kv.get(`p:${id}`, "json");
  if (!page) return J({ error: "not-found" }, 404);
  const token = request.headers.get("x-edit-token") || "";
  const owner = !!token && (await sha(token)) === page.editHash;
  const action = parts[1] || "";

  if (!action) {
    if (m === "GET") {
      const { editHash, ...pub } = page;
      const t = await tallies(kv, id);
      const out = { page: pub, ...t, owner };
      if (owner) out.stats = (await kv.get(`s:${id}`, "json")) || {};
      return J(out);
    }
    if (!owner) return J({ error: "forbidden" }, 403);
    if (m === "PUT") {
      const next = clean(body, page);
      next.updated = new Date().toISOString();
      await kv.put(`p:${id}`, JSON.stringify(next));
      return J({ ok: true });
    }
    if (m === "DELETE") {
      for (const pre of [`v:${id}:`, `g:${id}:`]) {
        let cursor;
        do {
          const r = await kv.list({ prefix: pre, cursor });
          await Promise.all(r.keys.map((k) => kv.delete(k.name)));
          cursor = r.list_complete ? null : r.cursor;
        } while (cursor);
      }
      await kv.delete(`p:${id}`); await kv.delete(`s:${id}`);
      return J({ ok: true });
    }
    return J({ error: "method" }, 405);
  }

  if (m !== "POST") return J({ error: "method" }, 405);
  const voter = VOTER_RE.test(body.voter || "") ? body.voter : "";

  if (action === "vote") {
    if (!voter) return J({ error: "voter" }, 400);
    const allowed = new Set((page.names || []).map((n) => n.name));
    const picks = (Array.isArray(body.picks) ? body.picks : []).map((p) => str(p, 30)).filter((p) => allowed.has(p)).slice(0, 3);
    const key = `v:${id}:${voter}`;
    if (!picks.length) { await kv.delete(key); return J({ ok: true }); }
    const isNew = !(await kv.get(key));
    await kv.put(key, "1", { metadata: { p: picks } });
    if (isNew) await bump(kv, `s:${id}`, "votes");
    return J({ ok: true });
  }

  if (action === "guess") {
    if (!voter) return J({ error: "voter" }, 400);
    const g = {
      who: str(body.who, 24) || "A guest",
      date: date(body.date),
      lbs: num(body.lbs, 0, 20), oz: num(body.oz, 0, 15.9),
      sex: ["g", "b", ""].includes(body.sex) ? body.sex : "",
      initial: str(body.initial, 1).toUpperCase(),
    };
    const key = `g:${id}:${voter}`;
    const isNew = !(await kv.get(key));
    await kv.put(key, "1", { metadata: g });
    if (isNew) await bump(kv, `s:${id}`, "guesses");
    return J({ ok: true });
  }

  if (action === "event") {
    // Page views are counted by site analytics, not here (KV writes are metered).
    if (body.type !== "share") return J({ error: "type" }, 400);
    await bump(kv, `s:${id}`, "shares");
    await bump(kv, "stats:all", "shares");
    return J({ ok: true });
  }

  return J({ error: "not-found" }, 404);
}
