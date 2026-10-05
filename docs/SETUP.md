# Going live (one-time, ≈3 minutes)

Everything runs from the **public** repo `ipo-terminal-site`. The private `ipo-terminal` repo is not needed (keep it as a backup or delete it).

1. **Push the code** (from the `ipo-terminal` folder on your computer):
   ```
   git remote add origin https://github.com/arhamsaraogi-star/ipo-terminal-site.git
   git push -u origin main
   ```
2. **Add the password**: repo → Settings → Secrets and variables → Actions → New repository secret
   - Name `TERMINAL_PASSPHRASE`, value = your terminal password (5+ random words). It exists nowhere else.
3. **Turn on Pages**: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. **First run**: Actions → **Refresh** → Run workflow (tick "Full sweep"). The first run backfills six months (SEBI + NSE, Mainboard + SME, offer-document covers) and takes 15–30 minutes.

Live at `https://arhamsaraogi-star.github.io/ipo-terminal-site/`. After that it refreshes every 15 minutes on its own; an open terminal updates in place.

Public repos get unlimited free Actions minutes, which is what makes the 15-minute cadence possible.
