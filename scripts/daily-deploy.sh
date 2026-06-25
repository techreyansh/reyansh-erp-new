#!/bin/zsh
# Daily auto-deploy of the Reyansh ERP to Vercel production.
# Run by launchd (com.reyansh.erp.daily-deploy) at 22:00 local time.
# Uses the local Vercel CLI login + the .vercel project link in the repo.
export PATH="/usr/local/bin:/usr/bin:/bin"

REPO="$HOME/Desktop/reyansh-erp-new"
LOG="$REPO/scripts/daily-deploy.log"
cd "$REPO" || { echo "$(date): repo not found" >> "$LOG"; exit 1; }

echo "" >> "$LOG"
echo "========== $(date '+%Y-%m-%d %H:%M:%S') : daily deploy start ==========" >> "$LOG"

# Sync the deploy branch (fast-forward; safe since the tree is committed/pushed).
git pull --ff-only origin design-system-rollout >> "$LOG" 2>&1

# Deploy the current working directory to production.
npx vercel --prod --yes >> "$LOG" 2>&1
STATUS=$?

# Verify the live URL.
CODE=$(curl -s -m 20 -o /dev/null -w "%{http_code}" https://reyansh-erp-new-mu.vercel.app/)
echo "$(date '+%Y-%m-%d %H:%M:%S') : vercel exit=$STATUS  live HTTP=$CODE" >> "$LOG"
echo "========== deploy end ==========" >> "$LOG"
