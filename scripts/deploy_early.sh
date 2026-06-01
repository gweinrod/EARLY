#!/bin/bash
# VPS: install as /app/deploy_early.sh (chmod +x). Same as deploy-early.sh.
# Pulls latest main branch, builds dist/, prints deployed commit.
set -e
cd /app/early
git fetch origin --prune
git checkout -B main origin/main
git pull origin main
npm ci
npm run build
if [ -f server/package.json ]; then
  (cd server && npm ci)
fi
if systemctl is-active --quiet early-api 2>/dev/null; then
  sudo systemctl restart early-api
  echo "Restarted early-api (embedding len: $(node tools/read_embedding_dim.mjs 2>/dev/null || echo '?'))"
else
  echo "Note: early-api not running — start with: sudo systemctl start early-api"
fi
echo "Deployed $(git rev-parse --short HEAD) → /app/early/dist"
