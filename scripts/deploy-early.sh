#!/bin/bash
# VPS: install as /app/deploy-early.sh (chmod +x).
# Pulls latest letter-writing-ml branch, builds dist/, prints deployed commit.
# Do not run git pull separately before this script.
set -e
cd /app/early
git fetch origin
git checkout letter-writing-ml
git pull origin letter-writing-ml
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
