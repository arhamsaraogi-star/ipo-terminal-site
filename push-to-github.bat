@echo off
REM One-time push of the IPO Terminal to GitHub. After this, GitHub Actions refreshes everything every 15 minutes.
cd /d "%~dp0"
git remote remove origin 2>nul
git remote add origin https://github.com/arhamsaraogi-star/ipo-terminal-site.git
git push -u origin main --force
echo.
echo Done. Next: add the TERMINAL_PASSPHRASE secret and set Pages source to GitHub Actions (see docs\SETUP.md).
pause
