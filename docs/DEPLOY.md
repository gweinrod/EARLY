# Deploy EARLY to the classroom iPad

Production: **HTTPS on your VPS** (`https://early.gregtutors.com`), nginx serves `dist/` and proxies `/api/*` to `server/index.mjs` + Postgres.

## 1. Private GitHub repo

Create an empty **private** repo named `EARLY` on GitHub (no README).

```powershell
cd C:\EARLY
git remote add origin https://github.com/YOUR_USER/EARLY.git
git push -u origin main
```

## 2. VPS (static + API)

1. On the VPS: clone/pull EARLY, `npm ci`, `npm run build`.
2. Run the API: `node server/index.mjs` (systemd unit `early-api`) with `DATABASE_URL` and `JWT_SECRET` in `server/.env`.
3. nginx: TLS cert, `root` → `dist/`, `location /api/` → `http://127.0.0.1:3001` (or your API port).
4. Deploy script (example): `ssh early@early.gregtutors.com /app/deploy-early.sh`

### Cloud training

Teacher panel shows **Cloud training: N … on server** when `/api/*` is reachable.

Periodically publish a shared model from your PC: [`docs/CLOUD_TRAINING.md`](CLOUD_TRAINING.md) (`scripts\publish-shared-model-postgres.bat` or `npm run publish:unit1`).

## 3. iPad (Safari only)

1. Open `https://early.gregtutors.com` in **Safari** (not Chrome).
2. Allow microphone when prompted.
3. Share → **Add to Home Screen** → open **EARLY** from the icon.
4. Log in as teacher or enter student flow.
5. One word: tap speak, say the word, tap **agree** or **disagree**.

### URL modes (optional)

| URL | Use |
|-----|-----|
| Default | Teacher panel + curriculum words |
| `?student=1` | Hide teacher panel (student-only) |
| `?debug=1` | Show heatmap / NN (your machine only) |
| `?nonsense=1` | Nonsense words instead of curriculum |

## 4. Local dev on the same Wi‑Fi

Mic needs **HTTPS** on iPad except for localhost. For a quick LAN check from your PC:

```powershell
npm run dev:lan
```

On the iPad Safari, open `http://YOUR_PC_IP:5173` — mic may still be blocked on HTTP; use production HTTPS for a real mic test.

## 5. After first classroom session

1. Export JSON from the app (optional archive).
2. Store under e.g. `exports/` (gitignored if you add local data).
3. Summarize:

```powershell
python tools/import_session_logs.py exports\early-session-*.json
```

## Checklist

- [ ] GitHub private repo pushed
- [ ] VPS: `npm run build`, API running, nginx TLS green
- [ ] iPad Safari: mic works
- [ ] iPad: speech recognition returns a transcript
- [ ] Add to Home Screen works
- [ ] Teacher accepts upload; cloud stats increment
