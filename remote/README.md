# AutoGram Remote (CDP)

Folder: `F:\AutoGram\remote\` — smoke + heal for Media Studio desktop after hybrid/Grammers migration.

> **Never** call `browser.close()` — that kills `frontend.exe` WebView2.

## Quick start

```bat
cd F:\AutoGram\remote
npm install
npm run build:exe
npm run ensure
npm run heal
npm run suite
```

Atau double-click **`1-Start-Remote.vbs`** (Vite hidden + frontend + CDP + heal).

## Scripts

| Command | Fungsi |
|---------|--------|
| `npm run build:exe` | `cargo build` → `frontend/src-tauri/target/debug/frontend.exe` |
| `npm run ensure` | Vite :1420 + frontend.exe + CDP :9222 (auto-build jika exe hilang) |
| `npm run heal` | Perbaiki “can't reach this page” |
| `npm run suite` | Smoke: Vite + CDP + shell text + bukan chrome-error |
| `npm run health` | Health check JSON |

## Layout (pasca cleanup)

```
remote/
  core/           # connector, vite ensure, heal, logger
  config/         # remote_config.json
  reports/logs/   # ensure / vite / cargo logs
  reports/screenshots/
  ensure-remote.ps1
  build-frontend-debug.ps1
  heal-remote.mjs
  run.mjs         # smoke suite
  1-Start-Remote.vbs
```

One-off probe scripts (`remote/scripts/*`, upload experiments) **dihapus** — gunakan suite minimal di atas.

## Prasyarat

1. Node.js di PATH  
2. `npm install` di `AutoGram App/frontend`  
3. Rust/cargo di PATH (untuk `build:exe`)  
4. Worker Python venv tetap di `AutoGram App/worker/venv`  

## Status

| File | Isi |
|------|-----|
| `reports/last-run-status.txt` | `OK` / `FAIL` / `WORKING …` |
| `reports/summary_dashboard.json` | Hasil smoke suite |
| `reports/logs/ensure-remote.log` | Chronology ensure |
| `reports/logs/cargo-build.log` | Log build exe |

## Debug Mode app

Aktifkan **Settings → Debug Mode** di AutoGram agar frontend/Rust/Python menulis log detail (`worker/temp/autogram_debug.log`).
