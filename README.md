# IPO Terminal

A private, password-protected research terminal for Indian IPOs. It tracks each company from DRHP through listing, lock-ins and post-listing news, and every number links back to its source document and page.

- **Source of truth:** this private GitHub repo (code, structured data, rules, tests, automation)
- **Site:** a public GitHub Pages repo that contains **only** an app shell and an AES-256-GCM encrypted data vault
- **Design:** see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Repo, schemas, sample data, validation gates, lock-in engine, encrypted vault, Liquid Glass UI, portfolio workflow, CI/deploy | ✅ done |
| 2 | Source spike + SEBI / NSE / BSE discovery adapters | next |
| 3–11 | Documents → extraction → normalisation → events/changes → lock-in rule verification → prices → automation → QA | planned |

The terminal currently runs on **fictional DEMO companies** (shown with a SAMPLE DATA banner). Remove them with `python scripts/make_sample_data.py --remove`.

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
.github/workflows/  ci.yml · deploy.yml · portfolio.yml
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

## How the password works

1. The passphrase exists only as the GitHub Actions secret `TERMINAL_PASSPHRASE` (and in your head).
2. `deploy.yml` compiles all data into one JSON → gzip → AES-256-GCM, with the key derived by PBKDF2-SHA-256 (600k iterations) → `vault.bin`.
3. The public site gets `vault.bin` plus a generic app shell. No company names, figures or routes are present in plaintext. The deploy step fails if any are.
4. The browser derives the key from what you type and decrypts in memory. "Remember this device" stores a *non-extractable* key (never the password) in IndexedDB. **Lock** wipes it.
5. To rotate: change the secret, run `python scripts/rotate_salt.py`, commit, deploy.

Use a long passphrase (5+ random words). Anyone can download the encrypted file and try passwords offline, so the length of the passphrase is the protection.

## Portfolio & watchlist

On any company page, **★ Add to portfolio** or **☆ Watch** opens a pre-filled GitHub issue. Fill in the quantity, average cost and date, then submit. `portfolio.yml` validates it, commits `data/portfolio/holdings.json`, closes the issue and redeploys. Only the repo owner's issues are accepted. Holdings drive the front-page panel and the high-frequency news tracking (Phase 2+).

## Adding a new event type / source

- **Event type:** add a line to `rules/event_types.yaml`. No schema change is needed.
- **Source:** add an adapter in `src/pipeline/ingestion/`. It must emit `source` objects with a `url`, plus a `page` for offer-document facts. Third-party sources use `tier: secondary`.

## Manually trigger / debug

- **Actions → Deploy → Run workflow** rebuilds and republishes.
- A failed validation prints `ERROR …` lines in the "Derive, validate, encrypt" step and nothing deploys. Warnings appear on the terminal's **Needs Review** page.

See [`docs/SETUP.md`](docs/SETUP.md) for one-time GitHub setup.
