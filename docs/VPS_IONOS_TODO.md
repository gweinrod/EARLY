# IONOS VPS rollout — EARLY (`early.gregtutors.com`)

Checklist for the **`vps`** branch. Combines [MIGRATION_OFF_VERCEL.md](MIGRATION_OFF_VERCEL.md) (current repo) with [claude imports/EARLY_full_vps_setup.pdf](claude%20imports/EARLY_full_vps_setup.pdf) (reference only — **do not reinstall** the VPS).

**Domain:** `early.gregtutors.com` → same IONOS VPS as tutoring (DNS in **GoDaddy** only).  
**Repo:** `gweinrod/EARLY` — model **v5** and training archive are on `main`; this branch is for deploy/infra work.

---

## Current server (inventory — keep as-is)

**Do not wipe or reinstall.** Add EARLY as a second nginx vhost on the existing box.

| Item | On the VPS now |
|------|----------------|
| **OS** | Ubuntu **24.04.4 LTS** (Noble) |
| **Web** | **nginx 1.24** on **80** and **443** |
| **Firewall** | **UFW** active — 22, 80, 443 allowed |
| **Tutoring** | `gregtutors.com` / `www` → `proxy_pass http://127.0.0.1:4200` (**Next.js** `next-server`) |
| **Tutoring SSL** | Let’s Encrypt `gregtutors.com` (certbot), expires **2026-07-24** |
| **Apache** | Not installed |
| **EARLY** | Not deployed yet — static site at `/app/early/dist` + new `early` vhost |

Tutoring config: `/etc/nginx/sites-available/gregtutors` (leave unchanged).  
Re-run inventory anytime: `~/vps-inventory.sh` (see chat / create from script in repo notes).

---

## How this maps to the codebase today

| PDF / VPS plan | Current EARLY (v0.68) | Notes |
|----------------|----------------------|--------|
| `/` → static `dist/` | `npm run build` → `dist/` | Same. Ship `public/models/` and `public/tfjs-wasm/` via build. |
| `GET /api/model` | `GET /models/alphabet/model.json` | App loads shared TF.js model from static files; no API required for class practice. |
| `POST /api/samples` + PostgreSQL | `POST /api/calibration` + Vercel Blob | Different contract. Phase A: static-only. Phase B: port existing APIs or new backend. |
| Nightly `retrain.py` (sklearn) | `tools/train_global_model.py` (TF.js) | Prefer existing trainer + `public/models/`; train on PC or VPS. |
| Client `const API = 'https://…'` | Relative `/api/...` | Optional base URL on `vps` branch when API is live. |

---

## Phase 0 — Before you touch the VPS

- [x] Confirm **GoDaddy** controls DNS for `gregtutors.com`.
- [x] Note **IONOS VPS public IP** (same IP for `gregtutors.com` and `early.gregtutors.com`).
- [x] Run server inventory (nginx, UFW, ports) — **no reinstall needed**.
- [x] Decide **Phase A** (static app only) vs **Phase B** (API + storage for teacher uploads).
- [ ] Keep Vercel live until `https://early.gregtutors.com` passes iPad mic + one full practice take.

---

## Phase 1 — DNS (GoDaddy)

- [x] Add **A record**: Name `early` → Value `<IONOS VPS IP>`, TTL 1 hour.
- [x] Wait for propagation: `nslookup early.gregtutors.com` returns the VPS IP.
- [x] Do **not** change nameservers at IONOS (hosting only).

---

## Phase 2 — Use existing stack (no OS reinstall)

Everything below is **already on the server** from tutoring. Only install what’s missing when you need it.

- [x] Ubuntu **24.04** — keep current image.
- [x] **nginx** + **certbot** (`python3-certbot-nginx`).
- [x] **UFW** — SSH, HTTP, HTTPS open.
- [ ] Optional: dedicated Linux user `early` for deploys (you may use `root` today — fine for Phase 3).
- [x] Optional: `apt update && apt upgrade -y` (maintenance only, not required for EARLY).
- [x] Install only if missing for later phases:

  ```bash
  # Check first: git --version; node -v; python3 --version
  sudo apt install -y git
  # Node 20 LTS — only if you build on VPS instead of PC
  # postgresql — only for Phase 5 Option B
  ```

- [x] Confirm tutoring still works after any changes: `https://gregtutors.com` → Next.js on **4200** (do not stop `next-server`).

---

## Phase 3 — Static frontend (minimum viable — do this first)

Works with **no** backend; uses committed model under `/models/alphabet/`.  
**Does not** modify `/etc/nginx/sites-available/gregtutors`.

- [x] Create app directory (separate from tutoring):

  ```bash
  sudo mkdir -p /app/early/dist
  sudo chown -R $USER:$USER /app/early
  cd /app/early
  git clone https://github.com/gweinrod/EARLY.git .
  git checkout vps   # or main after merge
  ```

- [x] Build on **PC** (recommended) or on VPS with Node 20:

  ```bash
  # On PC (Windows):
  cd C:\EARLY
  npm ci
  npm run build
  scp -r dist/* root@early.gregtutors.com:/app/early/dist/
  ```

  `npm run build` copies `public/models/` and `public/tfjs-wasm/` into `dist/`.

- [x] New nginx site `/etc/nginx/sites-available/early` (HTTP first):

  ```nginx
  server {
    listen 80;
    listen [::]:80;
    server_name early.gregtutors.com;

    root /app/early/dist;
    index index.html;

    location / {
      try_files $uri $uri/ /index.html;
    }

    location ~* ^/tfjs-wasm/.*\.wasm$ {
      types { application/wasm wasm; }
      default_type application/wasm;
    }
  }
  ```

- [x] Enable site (keep `gregtutors` and existing `default` as they are):

  ```bash
  sudo ln -s /etc/nginx/sites-available/early /etc/nginx/sites-enabled/
  sudo nginx -t
  sudo systemctl reload nginx
  ```

- [x] SSL (after DNS OK): `sudo certbot --nginx -d early.gregtutors.com`  
  Adds a **separate** cert; does not change `gregtutors.com` cert paths.

- [x] Test in **Safari on iPad**: HTTPS, mic, footer **v0.68+**, shared model **v5+**
- [x] Add to Home Screen; one letter take in collector/teacher mode

**Phase 3 done when:** `https://early.gregtutors.com` works and tutoring at `gregtutors.com` is unchanged.

---

## Phase 4 — Deploy script (repeatable updates)

- [x] Create `/app/deploy-early.sh` on VPS:

  ```bash
  #!/bin/bash
  set -e
  cd /app/early
  git fetch origin
  git checkout vps    # or main
  git pull
  npm ci
  npm run build
  # optional: sudo systemctl restart early-api   # after Phase 5
  echo "Deployed $(git rev-parse --short HEAD) → /app/early/dist"
  ```

- [x] `chmod +x /app/deploy-early.sh`
- [x] From PC: `ssh root@early.gregtutors.com /app/deploy-early.sh`

---

## Phase 5 — Postgres training API (teacher cloud sync)

**Why:** Vercel Blob **list** on every stats refresh burned “advanced” ops. The old API never incremented `counts.json` on POST, so GET often listed **every** judgment file.

**Approach:** `server/` — Node + **PostgreSQL** + same `/api/*` routes. UI unchanged (same origin on `early.gregtutors.com`).

| Op | Cost |
|----|------|
| **GET** `?stage=alphabet` | `SELECT sample_count` from `stage_sample_counts` — O(1) |
| **POST** upload | `INSERT` sample + **increment counter** in one transaction |
| **Clear server** | `DELETE` + reset counters (no Blob list) |

Code: [server/README.md](../server/README.md), [server/index.mjs](../server/index.mjs), [server/schema.sql](../server/schema.sql).

### Checklist

- [x] Install Postgres on VPS; create `earlydb` / `earlyuser` (localhost only — no public 5432).
- [ ] `cd /app/early/server && npm install && psql $DATABASE_URL -f schema.sql`
- [ ] `.env` with `DATABASE_URL`, `PORT=8787`, `DATA_DIR=/var/lib/early/samples`
- [ ] systemd `early-api.service` → `node index.mjs` (see server README)
- [ ] nginx `location /api/ { proxy_pass http://127.0.0.1:8787; }` on **early** vhost only
- [ ] One-time import — see **Phase 5 — Step 4** below
- [ ] Teacher panel: “Cloud training: N judgments on server” updates without Vercel bill
- [ ] Training export: `npm run calibration:pull:postgres` (SSH tunnel if DB not exposed)

**Not using:** PDF FastAPI sample schema (different URLs). **Using:** Postgres + existing JSON bodies.

### Step 4 — One-time import (detailed)

**Before you start:** Steps 1–3 done — Postgres running, `earlydb` + `earlyuser` created, `schema.sql` applied, `/app/early/server/.env` has a working `DATABASE_URL`.

**Warning:** The import script **`TRUNCATE`s** `training_samples` and `stage_sample_counts` and rebuilds counts. Safe on a **fresh** DB; do not run if you already have live uploads you care about.

#### What gets imported

| Source folder (in repo) | DB `kind` | Typical count |
|-------------------------|-----------|---------------|
| `data/training-archive/calibration/*.json` | `calibration` | ~620 judgments |
| `data/training-archive/voice-bank/*.json` | `voice_bank` | ~27 voice seed |

The importer auto-uses `data/training-archive/` when `data/calibration/` is empty (after `git pull` on `vps`).

#### Path A — Import on the VPS from Git archive (recommended)

```bash
cd /app/early
git pull origin vps

# Confirm archive is present
ls data/training-archive/calibration/*.json | wc -l
ls data/training-archive/voice-bank/*.json | wc -l

# Root package needs `pg` (for the import script)
npm install

# Load DB URL from server .env
set -a
source server/.env
set +a

# Run import (1–3 minutes for ~650 files)
npm run calibration:import:postgres
```

**Expected output (approximate):**

```text
Calibration JSON dir: .../data/training-archive/calibration
Voice-bank JSON dir: .../data/training-archive/voice-bank
Imported 620 calibration + 27 voice JSON files.
  calibration: 620 counted in stage_sample_counts
  voice_bank: 27 counted in stage_sample_counts
```

#### Verify in Postgres

```bash
psql "$DATABASE_URL" -c "SELECT kind, stage_id, sample_count FROM stage_sample_counts ORDER BY kind, stage_id;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM training_samples WHERE kind='calibration';"
```

#### Verify through the API (after Step 5 nginx + systemd)

```bash
curl -s "http://127.0.0.1:8787/api/calibration?stage=alphabet"
curl -s "http://127.0.0.1:8787/api/voice-bank?stage=alphabet"
```

Expect `"total":620` and `"total":27` (or your actual file counts). In the teacher UI: **Cloud training: 27 voice on server · 620 judgments on server**.

#### Path B — Import from Vercel Blob (if archive is stale)

Use while `BLOB_READ_WRITE_TOKEN` still works.

**On your Windows PC** (`C:\EARLY`, `.env` with token):

```powershell
cd C:\EARLY
npm run calibration:pull
```

**Copy to VPS** (replace IP/host):

```powershell
scp -r data/calibration early@YOUR_VPS:/app/early/data/
scp -r data/voice-bank early@YOUR_VPS:/app/early/data/
```

**On VPS** (importer prefers `data/calibration/` when it has files):

```bash
cd /app/early
npm install
set -a && source server/.env && set +a
npm run calibration:import:postgres
```

#### Path C — Skip import (start empty)

Omit Step 4. Counts start at **0**; each new teacher **accept** adds rows via POST. Fine for testing; you lose historical judgments until you import later.

#### Troubleshooting

| Problem | Fix |
|---------|-----|
| `Set DATABASE_URL` | `source server/.env` from `/app/early` |
| `role "early" does not exist` | Use full URL with `earlyuser@127.0.0.1`, not bare `psql` |
| `Cannot find module 'pg'` | Run `npm install` in `/app/early` (repo root) |
| Import count 0 | Run `git pull`; check `ls data/training-archive/calibration \| head` |
| Permission denied on DB | Re-run GRANTs as `postgres` (Step 1 in server README) |

#### After import

Continue Phase 5: **systemd** `early-api` + nginx **`location /api/`** → then test on iPad.

---

## Phase 6 — Training pipeline (recommended hybrid)

Uses `data/training-archive/` in Git (647 files).

- [ ] On PC or VPS:

  ```bash
  pip install -r tools/requirements-train.txt
  python tools/train_global_model.py --stage alphabet
  ```

- [ ] Commit/push `public/models/alphabet/` or copy into `/app/early/dist/models/alphabet/` after build.
- [ ] Optional cron: pull samples (once API exists) → train → `/app/deploy-early.sh`

---

## Phase 7 — Cutover & decommission Vercel

- [ ] Point classroom to `https://early.gregtutors.com`
- [ ] Final Blob export on PC if needed (`npm run calibration:pull` + `training:archive`)
- [ ] Pause Vercel after one week stable on VPS
- [ ] Update [DEPLOY.md](DEPLOY.md) (PR `vps` → `main`)

---

## Quick verification checklist

| Test | Pass? |
|------|-------|
| `https://gregtutors.com` still loads (tutoring / Next.js) | |
| `https://early.gregtutors.com` loads, no cert warnings | |
| `/models/alphabet/manifest.json` shows `"version": 5` (or newer) | |
| `/tfjs-wasm/*.wasm` returns 200, `application/wasm` | |
| iPad Safari: mic works on HTTPS | |
| One take: ASR + DSP + pass/fail UI | |
| Teacher panel: export session log | |
| (If API live) cloud training counts update after accept | |

---

## Reference docs in repo

| Doc | Purpose |
|-----|---------|
| [MIGRATION_OFF_VERCEL.md](MIGRATION_OFF_VERCEL.md) | Static vs Blob vs train-from-archive |
| [CLOUD_TRAINING.md](CLOUD_TRAINING.md) | Upload/pull/publish commands |
| [DEPLOY.md](DEPLOY.md) | iPad flow (update after cutover) |
| [claude imports/EARLY_full_vps_setup.pdf](claude%20imports/EARLY_full_vps_setup.pdf) | Reference (greenfield layout; **not** used for reinstall) |

---

## Suggested order

1. ~~Phase 0–1~~ (done)  
2. **Phase 2** — skim inventory; optional `apt upgrade` only  
3. **Phase 3** — `early` vhost + build + certbot + iPad test  
4. **Phase 4** — `deploy-early.sh`  
5. **Phase 6** — retrain/publish model when needed  
6. **Phase 5** — only if you need multi-device cloud sync  
7. **Phase 7** — turn off Vercel
