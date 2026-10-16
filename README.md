# BabyNamePopularity.com

Static site published by Cloudflare Pages. Every push to this branch republishes the site.

This is the review copy: `_headers` and `robots.txt` keep search engines out until launch.

Production branch: `main` (Cloudflare Pages project `babynamepopularity`). Framework None, no build command, output directory `/`.

## Baby Page (family sharing) — keep these when republishing

The main build (`index.html`) does not contain these, so a republish must copy them across unchanged:

- `baby/index.html` — the Baby Page app (name poll, baby pool, registry links, announcement).
- `functions/api/baby/[[path]].js` — the API (Cloudflare Pages Functions).
- `functions/b/[id].js` — short share links `/b/<id>` with a family-specific link preview.
- In `index.html`: the "Baby Page" link in the main menu and the Baby Page card on Tools & games.

Storage: create a Workers KV namespace (for example `bnp-baby-pages`) and bind it to the Pages project as **BNP_DATA** (Settings → Bindings, for Production and Preview), then redeploy. Until then the page runs in preview mode and saves only in the visitor's browser.
Optional: a secret `BNP_ADMIN_TOKEN` lets `GET /api/baby/stats/summary` return network totals (pages, pages started from another page, shares).
Baby Pages stay `noindex` after launch: they are private family pages.
