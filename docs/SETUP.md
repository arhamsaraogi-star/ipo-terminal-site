# One-time GitHub setup (≈10 minutes)

## 1. Create two repositories

| Repo | Visibility | Purpose |
|---|---|---|
| `ipo-terminal` | **Private** | Everything: code, data, workflows |
| `ipo-terminal-site` | Public | Receives only the encrypted build; serves GitHub Pages |

Create both empty (no README).

## 2. Push this code to the private repo

```bash
cd "IPO Monitor/ipo-terminal"
git remote add origin https://github.com/<you>/ipo-terminal.git
git push -u origin main
```

## 3. Deploy token (lets the private repo publish to the site repo)

GitHub → Settings → Developer settings → Fine-grained tokens → **Generate new token**
- Repository access: **Only** `ipo-terminal-site`
- Permissions: **Contents → Read and write**
- Copy the token.

## 4. Secrets and variable on the private repo

`ipo-terminal` → Settings → Secrets and variables → Actions

| Kind | Name | Value |
|---|---|---|
| Secret | `TERMINAL_PASSPHRASE` | Your terminal password: 5+ random words, at least 12 characters |
| Secret | `SITE_DEPLOY_TOKEN` | The token from step 3 |
| Variable | `SITE_REPO` | `<you>/ipo-terminal-site` |

Also: Settings → Actions → General → Workflow permissions → **Read and write**.

## 5. First deploy

Actions → **Deploy** → Run workflow. When it is green:

`ipo-terminal-site` → Settings → Pages → Source: **Deploy from a branch** → `main` / root → Save.

Your terminal is live at `https://<you>.github.io/ipo-terminal-site/`.

## 6. Label for portfolio issues

`ipo-terminal` → Issues → Labels → New label `portfolio`.

## Notes

- The site URL is public, but its content is encrypted. Don't share the passphrase over chat or email.
- Free plan: private repos get 2,000 Actions minutes per month. Phase 1 uses about 3 minutes per deploy.
