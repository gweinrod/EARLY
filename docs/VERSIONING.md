# EARLY display versioning

The header shows **EARLY** plus **`v0.x`** from `src/version.ts`.

## Bump before each release commit

```bash
npm run version:bump
git add src/version.ts package.json
```

Sequence: `0.1` → `0.2` → … → `0.9` → `0.10` → `0.11` …

After deploy, confirm the new **`v0.x`** under the title (hard refresh if needed).
