# Changelog

## 0.4.0 — 2026-10-05 · Logins, sync, private companies, industry charts
- Username + password sign-in (TERMINAL_USERS secret, IPOV2 vault with per-user wrapped keys); encrypted cross-device sync of portfolio, tracking and private companies (userdata branch)
- Add any private company in the world with funding rounds; positions marked to the latest round; portfolio MOIC + XIRR + cost-vs-value chart
- Track any company with a status and note; home page leads with the portfolio, new filings, latest IPO news and tracking
- Industry tab rebuilt as charts from the offer document's chart labels, tables and statements (with page links and calculated CAGRs)
- Simpler navigation (7 sections) and company page (6 tabs)
- Fixes: BRLM parsing for multi-line names / "(formerly …)", "DETAILS OF OFFER" variant, withdrawn issues, hard per-request deadline in ingestion

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
