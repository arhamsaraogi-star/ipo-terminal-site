# Changelog

## 0.7.1 — fixes: lock-in dates, SEBI approvals, coverage, sync
- Anchor lock-ins are dated from the issue timeline alone (no longer wait for the share count to be read from the offer document); counted the market way, allotment day = day 1 (allotment 4 Aug → 30d ends 2 Sep, 90d ends 1 Nov)
- SEBI approval: an "Approved" status on the NSE register creates a SEBI-approval event (date first seen), moves the company to "SEBI observed", and shows in a new "SEBI nod" column on the Pipeline
- Coverage: DRHP window widened from 450 to 900 days and every live register status is kept, so approved filings older than a year are no longer dropped; returned filings are marked withdrawn
- Sync: unsent changes are retried every minute (before, one failure stalled them), up to 5 conflict retries, files over 1 MB are read via the blob API, and the error now says what happened (401 / 403 / 404 / offline)

## 0.7.0 — 2026-10-06 · BSE SME documents read, phone layout, anchor intelligence
- BSE SME filing list read through a page-reader relay when bsesme.com refuses the runner; documents downloaded via the bseindia.com mirror; every document re-read (doc/4), never-read documents first, 6 parallel workers
- SME cover pages: lead manager / registrar parsed when the name follows the contact details; company summary from SME "Our Business" chapters
- Phone layout: compact two-line rows (title + key figure + meta line), wide tables scroll with a sticky first column, scrollable tabs, smaller headings
- Anchor scorecard: what anchors actually earned (issue → day-30 / day-90 unlocks) by deal and by lead manager
- "If you were an anchor" on every listed company; expected issue window for every DRHP (learned from past DRHP→launch times)
- "Since your last visit" strip on Home; one-page IC brief (print / save as PDF) from any company page

## 0.6.0 — 2026-10-06 · Live peers, BSE coverage, tracked zone
- Offer-document peer tables brought up to today's NSE close (price, market cap, P/E and P/B on the document's EPS / NAV)
- BSE SME DRHPs / RHPs / prospectuses from the exchange's own page (bsesme.com), dated the day they are filed
- BSE-only issue dates, price bands and sizes via ipowatch.in (secondary source); BSE prices + listing-day open from the BSE bhavcopy
- Industry charts headline the forecast CAGR (last actual → last projected year)
- Money shown in ₹ / lakh / crore as it fits; XIRR and CAGR only after ~6 months
- News: All IPOs = listed ≤ 3 months or filed ≤ 6 months; portfolio and tracked names always show every headline
- New Tracked page and Calendar in the main menu with an All / Tracked switch

## 0.5.0 — 2026-10-05 · One big refresh, company summaries, web news
- Offer documents read in parallel (4 workers); pushes and manual runs do a full sweep, 15-minute runs stay incremental
- "About the company" summary from the offer document's Our Business → Overview (with page link)
- Web news + press-reported valuations for private, tracked and held companies (Google News; requests encrypted with the terminal key)

## 0.4.0 — 2026-10-05 · Logins, sync, private companies, industry charts
- Self-service accounts: Create account (username + password ≥ 6 + one-time access code), sign in anywhere, change password, log out (IPOV3 vault); encrypted cross-device sync of portfolio, tracking and private companies (userdata branch)
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
