# EARLY training API (Postgres)

EARLY training + auth API: `/api/calibration`, `/api/voice-bank`, `/api/writing-judgments`, `/api/auth/*`, `/api/clear-training-data`.

## Why Postgres

- **GET stats** = one row read from `stage_sample_counts` (no listing hundreds of files).
- **POST** = insert sample + increment counter in the **same transaction**.
- **Concurrent teachers** = Postgres handles many writers; SQLite would serialize writes.

## VPS setup (summary)

```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE earlydb;"
sudo -u postgres psql -c "CREATE USER earlyuser WITH PASSWORD 'your-strong-password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE earlydb TO earlyuser;"
sudo mkdir -p /var/lib/early/samples
sudo chown early:early /var/lib/early/samples

cd /app/early/server
cp .env.example .env   # edit DATABASE_URL
npm install
psql "$DATABASE_URL" -f schema.sql
```

### systemd (`/etc/systemd/system/early-api.service`)

```ini
[Unit]
Description=EARLY training API
After=network.target postgresql.service

[Service]
User=early
WorkingDirectory=/app/early/server
EnvironmentFile=/app/early/server/.env
ExecStart=/usr/bin/node /app/early/server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable early-api
sudo systemctl start early-api
```

### nginx (inside `server { server_name early.gregtutors.com; ... }`)

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Reload nginx after adding. The static app and API share `early.gregtutors.com` (no CORS issues).

## Pull for training on your PC

```bash
DATABASE_URL=postgresql://earlyuser:pass@early.gregtutors.com:5432/earlydb \
  node tools/pull_calibration_from_postgres.mjs
npm run training:archive
python tools/train_global_model.py --stage alphabet
```

(Use SSH tunnel if Postgres is not exposed publicly — recommended: localhost only.)

## Tables

| Table | Purpose |
|-------|---------|
| `training_samples` | Full JSON payload per upload |
| `stage_sample_counts` | `(kind, stage_id) → sample_count` — **source of truth for UI** |

Optional files under `DATA_DIR` mirror samples for debugging; training can use SQL export or files.
