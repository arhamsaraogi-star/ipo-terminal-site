# IPO Terminal

A private, password-protected research terminal for Indian IPOs. It tracks each company from DRHP through listing, lock-ins and post-listing news, and every number links back to its source document and page.

- **One public repo** (`ipo-terminal-site`): code + workflows on `main`, **encrypted** pipeline data on the `state` branch, and the site on GitHub Pages
- **Nothing readable is published:** the site is an app shell plus an AES-256-GCM vault; pipeline data is encrypted with the same passphrase
- **Live:** GitHub Actions pulls SEBI + NSE every 15 minutes (05:30–00:15 IST, hourly overnight); an open terminal picks up new builds within 2 minutes without a reload
- **Design:** see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Repo, schemas, sample data, validation gates, lock-in engine, encrypted vault, Liquid Glass UI, portfolio workflow, CI/deploy | ✅ done |
| 2 | Live SEBI + NSE (Mainboard + SME/Emerge) discovery, issue dates, subscription, documents, announcements | ✅ done |
| 3–4 | Offer-document download + cover-page extraction (offer size, structure, eligibility, BRLM deal-team contacts) | ✅ done |
| — | **Anchor Desk**: filings the day they land, lead-manager contacts, approved-not-launched, anchor books imminent | ✅ done |
| 5+ | Restated financials + industry tables, BSE SME, delayed prices, lock-in rule verification, alerts | planned |

Sources: SEBI offer-document listings (DRHP/RHP/Prospectus/addenda), NSE offer-document register (Mainboard + Emerge SME), NSE past/current/upcoming issues and issue detail, NSE corporate announcements, NSE trading holidays. **Gap:** BSE (incl. BSE SME-only issues) blocks automated access from cloud runners; tracked in `docs/ARCHITECTURE.md`.

## Layout

```text
schemas/            JSON Schema — the contract for all data
rules/              event_types.yaml (extensible), lockin.yaml (versioned SEBI ICDR rules)
config/vault.json   public KDF salt + iterations (the password is never stored)
data/               companies/<id>/{company,offerings,facts,documents,lockins}.json + events/news .jsonl
                    portfolio/holdings.json, changes/*.jsonl
src/pipeline/       Python: ingestion, extraction, normalization, calculations, validation, build
src/web/            React + Vite + TypeScript + Tailwind terminal (hash-routed SPA)
tests/              pytest (pipeline);  src/web/src/**/*.test.ts (vitest, incl. Python↔browser crypto contract)
.github/workflows/  ci.yml · refresh.yml (ingest → validate → encrypted state → Pages)
```

## Local development

```bash
pip install -r requirements.txt
python -m pytest -q                                            # pipeline tests
PYTHONPATH=src python -m pipeline.build.compile --check        # validation gate

export TERMINAL_PASSPHRASE='your local test passphrase'
PYTHONPATH=src python -m pipeline.build.compile --out src/web/public/vault.bin
cd src/web && npm install && npm run dev                       # http://localhost:5173
npm test && npm run build
```

## Sign-in, users and cross-device memory

* **Accounts**: anyone with the access code (the `TERMINAL_PASSPHRASE` secret) can tap *Create account* once (username + password, min 6). After that they sign in with username + password on any device. Account files on the `userdata` branch hold only the master key wrapped under each password.
* **Cross-device memory**: portfolio, tracking list and private companies are encrypted in the browser with a key derived from
  your password and saved to `users/<hash>.bin` on the `userdata` branch. Needs the repo secret `SYNC_TOKEN` — a fine-grained
  GitHub token on this repository only with *Contents: read & write* (accounts, sync, web-news requests) and *Actions: read & write* (lets the terminal start a refresh as soon as you add a company). The token is shipped inside the encrypted vault, so only
  signed-in users can use it. Without it, data stays on each device.
* `TERMINAL_PASSPHRASE` is both the sign-up access code and the key for the encrypted pipeline state branch — keep it.
* After changing a secret, run **Actions → Refresh → Run workflow** to rebuild the site.

## Refresh cadence

* Push to `main`, a manual *Run workflow* with “Full sweep”, or a fresh state → **full refresh** (up to 110 min): every offer document is
  read with 4 parallel workers. Overnight hourly runs are full too.
* Every 15 minutes in Indian hours → **incremental**: only new filings, changed documents, prices and news.

## Portfolio, tracking & private companies

* ★ **Add to portfolio** on any company (pre-IPO with entry valuation, anchor, allotment, market). Returns: MOIC, XIRR, CAGR.
* ◎ **Track** any company with a status (Interested → Evaluating → In talks with BRLM → Committed / Passed) and a note.
* **+ Private company** adds any unlisted company in the world (any currency, FX to ₹), its funding rounds and your position. The refresh job searches Google News for it (and for everything you track or hold) and lists headlines plus valuation figures quoted in the press — one click turns a press figure into a mark.

## Adding a new event type / source

- **Event type:** add a line to `rules/event_types.yaml`. No schema change is needed.
- **Source:** add an adapter in `src/pipeline/ingestion/`. It must emit `source` objects with a `url`, plus a `page` for offer-document facts. Third-party sources use `tier: secondary`.

## Manually trigger / debug

- **Actions → Deploy → Run workflow** rebuilds and republishes.
- A failed validation prints `ERROR …` lines in the "Derive, validate, encrypt" step and nothing deploys. Warnings appear on the terminal's **Needs Review** page.

See [`docs/SETUP.md`](docs/SETUP.md) for one-time GitHub setup.
