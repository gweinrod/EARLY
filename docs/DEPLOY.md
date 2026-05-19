# Deploy EARLY to the classroom iPad

Phase **1b**: HTTPS on Vercel, then Safari → Add to Home Screen.

## 1. Private GitHub repo

Create an empty **private** repo named `EARLY` on GitHub (no README).

```powershell
cd C:\EARLY
git remote add origin https://github.com/YOUR_USER/EARLY.git
git push -u origin main
```

## 2. Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → import `EARLY`.
2. Framework: **Vite** (auto-detected). Build: `npm run build`, output: `dist`.
3. Deploy. Copy the `https://….vercel.app` URL.

### Cloud training (recommended)

1. Vercel → **Storage** → **Blob** → connect to the project (sets `BLOB_READ_WRITE_TOKEN`).
2. Redeploy. Teacher panel shows **Cloud training: N samples on server** after accepts.
3. Periodically publish a shared model: see [`docs/CLOUD_TRAINING.md`](CLOUD_TRAINING.md).

## 3. iPad (Safari only)

1. Open the Vercel URL in **Safari** (not Chrome).
2. Allow microphone when prompted.
3. Share → **Add to Home Screen** → open **EARLY** from the icon.
4. Enter a test student ID (e.g. `TEST`).
5. One word: tap speak, say the word, tap **agree** or **disagree**.
6. **export session log** → confirm JSON downloads/opens.

### URL modes (optional)

| URL | Use |
|-----|-----|
| Default | Teacher panel + curriculum words |
| `?student=1` | Hide teacher panel (student-only) |
| `?debug=1` | Show heatmap / NN (your machine only) |
| `?nonsense=1` | Nonsense words instead of curriculum |

## 4. Pre-Vercel test on the same Wi‑Fi

Mic needs **HTTPS** on iPad except for localhost. For a quick LAN check from your PC:

```powershell
npm run dev:lan
```

On the iPad Safari, open `http://YOUR_PC_IP:5173` — mic may still be blocked on HTTP; use Vercel for a real mic test.

## 5. After first classroom session

1. Export JSON from the app.
2. Store under e.g. `exports/` (gitignored if you add local data).
3. Summarize:

```powershell
python tools/import_session_logs.py exports\early-session-*.json
```

## Checklist

- [ ] GitHub private repo pushed
- [ ] Vercel deploy green
- [ ] iPad Safari: mic works
- [ ] iPad: speech recognition returns a transcript
- [ ] Add to Home Screen works
- [ ] Session log export contains attempts + judgments
