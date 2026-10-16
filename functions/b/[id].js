// Short share link: /b/<id> serves the Baby Page app with a link preview
// (title, description, image) written for that family, so a link pasted into
// iMessage, WhatsApp or Facebook shows "Help name Baby Rivera" instead of a bare URL.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function onRequestGet({ request, env, params }) {
  const res = await env.ASSETS.fetch(new URL("/baby/", request.url));
  let html = await res.text();
  let title = "You're invited to a Baby Page";
  let desc = "Vote on baby names, guess the due date, and find the registry. Free from BabyNamePopularity.";
  try {
    const p = env.BNP_DATA && /^[A-Za-z0-9]{8,16}$/.test(params.id) ? await env.BNP_DATA.get(`p:${params.id}`, "json") : null;
    if (p) {
      const t = p.title || "our baby";
      if (p.born && p.born.name) { title = `Meet ${p.born.name}!`; desc = `${t} has arrived. See the announcement and send your congratulations.`; }
      else if (p.features && p.features.poll && (p.names || []).length) { title = `Help name ${t}`; desc = `Vote on the shortlist${p.due ? ", guess the arrival date" : ""} and see the registry.`; }
      else { title = `${t}: guess the arrival`; desc = "Join the baby pool, see the registry and send your wishes."; }
    }
  } catch {}
  const origin = new URL(request.url).origin;
  const meta = `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${origin}/photos/newborn_feet.jpg"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">`;
  html = html.replace("<!--og-->", meta).replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} | BabyNamePopularity</title>`);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}
