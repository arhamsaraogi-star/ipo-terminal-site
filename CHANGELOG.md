# Changelog

## 0.1.0 — 2026-10-05 · Phase 1
- Architecture approved: React/Vite SPA, two-repo GitHub hosting, Company as the core entity, PDFs as release assets
- JSON Schemas for Company, Offering, Fact (with provenance), Document, Event, Lock-in tranche, News, Change, Holding
- Extensible event registry and versioned SEBI ICDR lock-in rules (all marked unverified until Phase 7)
- Lock-in engine (rule chosen by issue opening date; runs from the allotment date) and listing anniversaries
- Validation gates: schema, provenance, issue arithmetic, share arithmetic, P&L chain, chronology, unknown events
- Encrypted vault (AES-256-GCM, PBKDF2-SHA-256 600k), with a Python→browser contract test
- Liquid Glass terminal: dashboard, portfolio, pipeline, upcoming, recently listed, private→IPO, lock-in calendar,
  IPO calendar, filings, changes, news, needs-review, and company pages with source pop-overs
- Portfolio/watchlist via owner-only GitHub issues → commit → redeploy
- CI, deploy-to-public-site with a plaintext leak guard, fictional DEMO data set
