# Web deploy vs desktop (heavy features)

## Runtime split

| Runtime | How | Heavy media (re-encode / Media Studio / Telethon worker) |
|---------|-----|----------------------------------------------------------|
| **Desktop** | Tauri app (`tauri dev` / packaged) | **Enabled** — work runs on the user's machine |
| **Web** | Static frontend only (Netlify/Vercel/etc.) | **Disabled** — UI gates hide/block Media Studio |

Detection: `frontend/src/lib/platform.ts`  
- Env `VITE_RUNTIME=web` or `desktop` (build-time override)  
- Else: `isTauri()` → desktop, browser → web  

Capabilities: `frontend/src/lib/capabilities.ts`

## Web host build

Deploy **only** the frontend static build. Do **not** ship `worker/`, `src-tauri/`, `*.session`, or Python venv.

```bash
cd "AutoGram App/frontend"
# Windows PowerShell:
$env:VITE_RUNTIME="web"; npm run build
# Unix:
# VITE_RUNTIME=web npm run build
```

Set the same env on the host (e.g. Netlify: `VITE_RUNTIME=web`).

Artifact: `frontend/dist/` — static files only.

## Supabase / backend

Use cloud DB for **metadata** (auth, job rows, status). Do **not** run FFmpeg re-encode or Telethon upload on Supabase Free / Edge Functions.

## Verify

```bash
cd "AutoGram App/frontend"
npm test
# Web-mode build:
$env:VITE_RUNTIME="web"; npm run build
```

In a pure browser (`npm run dev` without Tauri): Media Studio must not appear in the sidebar (or must show the desktop-only banner if forced).
