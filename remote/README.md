# AutoGram Remote (CDP)

Semua alat remote ada di folder ini: `F:\AutoGram\remote\`.

> **Never** call `browser.close()` — that kills `frontend.exe` WebView2.

## Masalah “Can't reach this page”

`frontend.exe` **debug** memuat UI dari `http://127.0.0.1:1420` (Vite).  
Jika Vite mati, WebView menampilkan **Hmmm… can't reach this page**.

### Perilaku cerdas (sudah di-wire)

| Layer | Tindakan |
|-------|----------|
| `ensure-remote.ps1` | **Wajib** Vite hidup dulu, baru buka frontend; heal ber-timeout; PHASE log + status WORKING |
| `core/vite_ensure.mjs` | Probe + spawn Vite hidden jika down (adaptive poll / early exit) |
| `core/wait_helpers.mjs` | Helper pure poll/phase (unit-testable) |
| `core/page_heal.mjs` | Deteksi chrome-error / teks "can't reach" → `page.goto` ke Vite |
| `core/remote_connector.mjs` | Saat connect CDP: ensure Vite + heal otomatis |
| `heal-remote.mjs` / `npm run heal` | Perbaikan cepat tanpa suite |

### Perbaiki sekarang (pilih satu)

```bat
cd F:\AutoGram\remote
npm run heal
```

atau double-click **`1-Start-Remote.vbs`** (Vite hidden + frontend + CDP + heal).

Jangan double-click `target\debug\frontend.exe` sendirian.

## Double-click (tanpa window cmd)

**Wajib pakai `.vbs`** (bukan `.cmd`) agar tidak ada window CMD di belakang frontend:

| File | Fungsi |
|------|--------|
| **`1-Start-Remote.vbs`** | Vite hidden + frontend + CDP + heal |
| **`2-Start-Remote-Dan-Suite.vbs`** | Sama + suite uji |

Implementasi: `core\silent-launch.vbs` memakai **Win32 CREATE_NO_WINDOW**.  
`.cmd` hanya wrapper tipis — double-click `.cmd` bisa flash console. Gunakan **`.vbs`**.

### Status / log

| File | Isi |
|------|-----|
| `reports\last-run-status.txt` | `OK` / `FAIL` ringkas |
| `reports\logs\ensure-remote.log` | Chronology ensure |
| `reports\logs\vite-hidden.*.log` | Log Vite |
| `reports\logs\heal-remote.*.log` | Log heal |
| `reports\summary_dashboard.json` | Skor suite |

## Prasyarat

1. `frontend.exe` sudah di-build (`AutoGram App/frontend` → `npm run tauri build` atau `tauri dev` sekali)
2. Playwright di `AutoGram App/frontend/node_modules/playwright`
3. Node.js di PATH
4. `npm install` di `AutoGram App/frontend` (supaya `vite.js` ada)

## Manual (agent / terminal)

```bat
cd F:\AutoGram\remote
npm run ensure
npm run heal
npm run suite
```

atau:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ensure-remote.ps1
node run.mjs
```

## Port

| Layanan | URL |
|---------|-----|
| Vite (hidden) | http://127.0.0.1:1420 |
| CDP | http://127.0.0.1:9222 |

## Scripts npm

| Script | Fungsi |
|--------|--------|
| `npm run vite` | Pastikan Vite up |
| `npm run heal` | Vite + navigate WebView |
| `npm run ensure` | Full stack (PowerShell) |
| `npm run test:wait` | Unit test cold-start wait helpers |
| `npm run suite` | Suite uji CDP |
| `npm run audit:modals` | Audit visual dialog (strip vertikal / rename) |
| `npm run health` | Probe health JSON |

### Cold start (setelah restart Windows)

Double-click `1-Start-Remote.vbs` bisa lambat di boot pertama karena **Node memuat `node_modules` + Vite compile pertama**. Pastikan tidak hung:

1. Buka `reports\last-run-status.txt` — harus berisi `WORKING ...` lalu `OK remote ready ... total=…ms`
2. Log fase: `reports\logs\ensure-remote.log` baris `PHASE VITE_*` / `FRONTEND_*` / `CDP_*` / `HEAL_*` / `DONE`
3. Heal dibatasi ~12s agar Playwright cold load tidak menahan popup OK selamanya  
4. Parent VBS menunggu **5 menit** (bukan 2) agar tidak FAIL sementara ensure masih jalan; timeout **taskkill** orphan PowerShell

## Audit visual dialog (rename strip)

Suite suite `visual_layout` + skrip:

```bat
cd F:\AutoGram\remote
npm run audit:modals
```

Gagal jika panel dialog:
- terlalu sempit/tinggi (strip vertikal),
- teks 1-huruf per baris,
- `writing-mode` vertikal.
