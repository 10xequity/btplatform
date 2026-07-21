# Boomtown Athletics Platform
**Version:** v0.2 · **Date:** 2026-07-21

Multi-org volleyball operations platform (Boomtown Volleyball · Match Point Social · Queens Club).
Spec of record: `2026-07-21_boomtown-design-spec_v0.1.md` (project knowledge).

- `web/` — frontend (GitHub Pages)
- `worker/` — Cloudflare Worker API
- `db/migrations/` — schema of record (0001 already applied to prod)
- `docs/` — setup guide and handoffs
- Deploy: push to `main`; Actions deploys the worker; Pages publishes the frontend.

Start here: `docs/2026-07-21_setup-guide_v0.1.md`
