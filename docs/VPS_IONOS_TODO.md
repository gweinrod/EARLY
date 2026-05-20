# IONOS VPS rollout — EARLY (`early.gregtutors.com`)

Checklist for the **`vps`** branch. Combines [MIGRATION_OFF_VERCEL.md](MIGRATION_OFF_VERCEL.md) (current repo) with [claude imports/EARLY_full_vps_setup.pdf](claude%20imports/EARLY_full_vps_setup.pdf) (target server layout).

**Domain:** `early.gregtutors.com` → IONOS VPS (DNS in **GoDaddy** only).  
**Repo:** `gweinrod/EARLY` — model **v5** and training archive are already on `main`; this branch is for deploy/infra work.

---

## How this maps to the codebase today

| PDF / VPS plan | Current EARLY (v0.68) | Notes |
|----------------|----------------------|--------|
| `/` → static `dist/` | `npm run build` → `dist/` | Same. Ship `public/models/` and `public/tfjs-wasm/` via build. |
| `GET /api/model` | `GET /models/alphabet/model.json` | App already loads shared TF.js model from static files; no API required for class practice. |
| `POST /api/samples` + PostgreSQL | `POST /api/calibration` + Vercel Blob | Different contract. Phase A: static-only. Phase B: port existing `api/calibration.ts` / `api/voice-bank.ts` or implement PDF schema. |
| Nightly `retrain.py` (sklearn) | `tools/train_global_model.py` (TF.js) | Prefer **existing** Python trainer + `public/models/` publish; cron on VPS or train on PC and `deploy.sh` pull. |
| Client `const API = 'https://…'` | Relative `/api/...` | Optional env/base URL change on `vps` branch when API is live. |

---

## Phase 0 — Before you touch the VPS

- [ ] Confirm **GoDaddy** controls DNS for `gregtutors.com` (nameservers per PDF).
- [ ] Note **IONOS VPS public IP** (unchanged across reinstall).
- [ ] Backup anything still on the old VPS image (reinstall wipes the disk).
- [ ] Decide **Phase A only** (static app, no cloud sync) vs **Phase B** (API + DB for teacher uploads).
- [ ] Keep Vercel live until `https://early.gregtutors.com` passes iPad mic + one full practice take.

---

## Phase 1 — DNS (GoDaddy)

- [ ] Add **A record**: Name `early` → Value `<IONOS VPS IP>`, TTL 1 hour.
- [ ] Wait for propagation: `nslookup early.gregtutors.com` returns the VPS IP.
- [ ] Do **not** change nameservers at IONOS (hosting only).

---

## Phase 2 — VPS base (IONOS, Ubuntu 22.04 LTS)

- [ ] Reinstall VPS with **Ubuntu 22.04 LTS** (PDF recommends against 24 for package support).
- [ ] SSH as `root`, then: `apt update && apt upgrade -y`
- [ ] Create user: `adduser early` → `usermod -aG sudo early`
- [ ] Copy SSH keys to `early`, set `PermitRootLogin no` and `PasswordAuthentication no`, restart `sshd`
- [ ] Verify login: `ssh early@<IP>` in a **second** terminal before closing root
- [ ] Install packages:

  ```bash
  sudo apt install -y nginx postgresql postgresql-contrib \
    python3 python3-pip python3-venv git \
    certbot python3-certbot-nginx ufw
  ```

- [ ] Firewall: `ufw allow OpenSSH`, `ufw allow 'Nginx Full'`, `ufw enable`

---

## Phase 3 — Static frontend (minimum viable — do this first)

Works with **no** FastAPI/Postgres; uses committed model under `/models/alphabet/`.

- [ ] On VPS:

  ```bash
  sudo mkdir -p /app/early
  sudo chown -R early:early /app
  cd /app/early
  git clone https://github.com/gweinrod/EARLY.git .
  git checkout vps   # or main after merge
  ```

- [ ] Install Node on VPS **or** build on PC and rsync `dist/` (PC build is often easier):

  ```bash
  # On PC (Windows):
  cd C:\EARLY
  npm ci
  npm run build
  scp -r dist/* early@early.gregtutors.com:/app/early/dist/
  ```

  If building on VPS: install Node 20 LTS, then `npm ci && npm run build` in repo root (output is `dist/`).

- [ ] Nginx site `/etc/nginx/sites-available/early` (HTTP first):

  ```nginx
  server {
    listen 80;
    server_name early.gregtutors.com;
    root /app/early/dist;
    index index.html;

    location / {
      try_files $uri $uri/ /index.html;
    }

    # TensorFlow.js WASM (required for DSP)
    location ~* ^/tfjs-wasm/.*\.wasm$ {
      types { application/wasm wasm; }
      default_type application/wasm;
    }
  }
  ```

- [ ] Enable site: `ln -s .../early sites-enabled/`, remove default, `nginx -t`, `reload nginx`
- [ ] SSL: `sudo certbot --nginx -d early.gregtutors.com` (only after DNS OK)
- [ ] Test in **Safari on iPad**: HTTPS, mic prompt, footer shows **v0.67+**, model status mentions shared **v5**
- [ ] Add to Home Screen; one letter take with collector/teacher flow as you use in class

**Phase 3 done when:** classroom works on VPS with **no** `/api` (cloud line may say “not connected” — expected).

---

## Phase 4 — Deploy script (repeatable updates)

- [ ] Create `/app/deploy.sh` on VPS:

  ```bash
  #!/bin/bash
  set -e
  cd /app/early
  git fetch origin
  git checkout vps    # or main
  git pull
  npm ci
  npm run build
  # optional: sudo systemctl restart early   # after Phase 5 API exists
  echo "Deployed $(git rev-parse --short HEAD) → /app/early/dist"
  ```

- [ ] `chmod +x /app/deploy.sh`
- [ ] From PC: `ssh early@early.gregtutors.com /app/deploy.sh`

---

## Phase 5 — Backend (optional — teacher cloud sync)

Pick **one** path; do not build both at once.

### Option A — Port current EARLY APIs (closest to today)

- [ ] Run Node adapter on VPS (or keep training upload as **git + manual train** only).
- [ ] Replace Vercel Blob with disk or S3-compatible storage; keep routes:
  - `GET/POST /api/calibration?stage=alphabet`
  - `GET/POST /api/voice-bank?stage=alphabet`
- [ ] Set env on server (no Vercel): storage credentials instead of `BLOB_READ_WRITE_TOKEN`
- [ ] On `vps` branch: add configurable API base URL if app is not same-origin

### Option B — PDF FastAPI + PostgreSQL (greenfield)

- [ ] PostgreSQL: `earlydb`, user `earlyuser`, tables `mfcc_samples`, `sessions`, `model_versions` (see PDF Step 5)
- [ ] `/app/api` venv: `fastapi`, `uvicorn`, `psycopg2-binary`, etc.
- [ ] `early.service` systemd unit → uvicorn on `127.0.0.1:8000`
- [ ] Extend Nginx `location /api/` → `proxy_pass http://127.0.0.1:8000`
- [ ] **Rewrite client** to match PDF (`/api/samples`, `/api/model`) **or** implement FastAPI routes that mirror existing Blob JSON shape
- [ ] Nightly cron: prefer wiring PDF `retrain.py` to export into `public/models/alphabet/` **or** run repo `train_global_model.py` against `data/training-archive/` copied to VPS

---

## Phase 6 — Training pipeline on VPS (recommended hybrid)

Uses what you already have in Git.

- [ ] Copy or clone includes `data/training-archive/` (647 samples) — already in repo
- [ ] On VPS or PC:

  ```bash
  pip install -r tools/requirements-train.txt
  python tools/train_global_model.py --stage alphabet
  ```

- [ ] Copy `public/models/alphabet/*` into `/app/early/dist/models/alphabet/` (or rebuild after train)
- [ ] Bump `manifest.json` version when publishing; iPads reload on next visit
- [ ] Optional cron on VPS: pull new samples (once API exists) → train → deploy.sh

---

## Phase 7 — Cutover & decommission Vercel

- [ ] Point teachers/iPads to `https://early.gregtutors.com` only
- [ ] Final Blob export if needed: `npm run calibration:pull` + `npm run training:archive` on PC (archive already in Git)
- [ ] Cancel / pause Vercel project after one week of stable VPS use
- [ ] Update [DEPLOY.md](DEPLOY.md) with VPS as primary (PR on `vps` → `main`)

---

## Quick verification checklist

| Test | Pass? |
|------|-------|
| `https://early.gregtutors.com` loads, no cert warnings | |
| `/models/alphabet/manifest.json` shows `"version": 5` (or newer) | |
| `/tfjs-wasm/*.wasm` returns 200, type `application/wasm` | |
| iPad Safari: mic works on HTTPS | |
| One take: ASR + DSP + pass/fail UI | |
| Teacher panel: export session log | |
| (If API live) cloud training counts update after accept | |

---

## Reference docs in repo

| Doc | Purpose |
|-----|---------|
| [MIGRATION_OFF_VERCEL.md](MIGRATION_OFF_VERCEL.md) | Static vs Blob vs train-from-archive |
| [CLOUD_TRAINING.md](CLOUD_TRAINING.md) | Current upload/pull/publish commands |
| [DEPLOY.md](DEPLOY.md) | iPad / Vercel flow (update after cutover) |
| [claude imports/EARLY_full_vps_setup.pdf](claude%20imports/EARLY_full_vps_setup.pdf) | Full nginx + FastAPI + Postgres + cron detail |

---

## Suggested order (one weekend)

1. Phase 0–1 (DNS)  
2. Phase 2–3 (VPS + **static only** + SSL + iPad test)  
3. Phase 4 (`deploy.sh`)  
4. Phase 6 (train/publish model v5+ to `dist/` if not already in pulled build)  
5. Phase 5 only if you still need multi-device cloud sync  
6. Phase 7 (turn off Vercel)
