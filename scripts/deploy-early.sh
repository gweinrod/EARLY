#!/bin/bash
# VPS: install as /app/deploy-early.sh (chmod +x).
# Pulls latest vps branch, builds dist/, prints deployed commit.
# Do not run git pull separately before this script.
set -e
cd /app/early
git fetch origin
git checkout vps
git pull origin vps
npm ci
npm run build
# If server/ changed: cd server && npm install && sudo systemctl restart early-api
echo "Deployed $(git rev-parse --short HEAD) → /app/early/dist"
