# Changelog

## 0.3.0 — 2026-10-05 · Revamp
- Offer-document body extraction (layout + table parser): restated financials, KPIs, peers, industry CAGR claims, pre-issue shares — every number links to its PDF page
- NSE end-of-day market data (bhavcopy + mcap files): CMP, day change, listing-day open, price history, shares outstanding
- Valuation inputs at issue price and CMP (mcap, P/E, P/B, P/S, EV/EBITDA) plus a what-if calculator for unpriced DRHPs
- Duplicate-company merge (ISIN/PAN/CIN/symbol/normalised name) with redirects; all lists sorted by date
- Pre-IPO holdings: entry valuation, invested amount, latest round — marked vs round, IPO mcap and market mcap with multiple and CAGR
- Mobile layout: bottom navigation, tables reflow into cards

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
