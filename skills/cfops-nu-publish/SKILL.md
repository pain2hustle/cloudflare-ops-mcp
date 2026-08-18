---
name: cfops-nu-publish
description: Publish a genuinely distinct, quality-gated article to Nothing Unseen (nothingunseen.com) with cross-links, sitemap + IndexNow submission, and no duplicates. Use when adding NU articles, growing NU SEO, or making the software/tools discoverable to AI crawlers.
---

# Nothing Unseen — publish an article

NU is the fair public-record / research site (repo `code\neighbordoors`, Pages project `nothingunseen` on austinsdoors1). The guiding rule is the OPPOSITE of a content farm: every article must be genuinely distinct and true — no faked PII, no FCRA use, honest evidence levels. Apiary's 16K near-dup pages were rejected by Google; do not repeat that.

## Steps

1. **Write / generate** the article HTML into `public/a/<slug>.html`; register it in `lib/nu-articles.json` (keep entries unique — NO dupes; a near-duplicate of an existing angle should be merged, not added).
2. **Cross-link**: link the new piece to 2–3 related NU articles and back, so it is not an orphan.
3. **Sitemap + feeds**: run the generators (`scripts/gen-*.mjs`) to refresh `public/sitemap.xml` and `public/llms.txt` (the llms.txt makes the tools/articles legible to AI crawlers).
4. **Deploy**: `npx wrangler pages deploy . --project-name nothingunseen --branch main --commit-dirty=true` — the repo is on `master`, production is `main`, so `--branch main` is REQUIRED or it only previews (see `cfops-pages-deploy`).
5. **IndexNow**: `node scripts/indexnow-submit.mjs` (expect 200/202). Also submit the sitemap in Google Search Console once.
6. **Verify by content**: fetch the live `/a/<slug>` and match a known sentence — SPA fallback gives false 200s.

## Indexing experiment

Treatment/control lives in `code\apiary\INDEXING-EXPERIMENT.md` — keep logging which pages land vs get ignored to learn Google's algorithm; prune stale/thin pages.
