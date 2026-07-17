# Remote + pemeriksaan otomatis — hasil

**Waktu:** 2026-07-15  
**Stack:** Vite :1420 · CDP :9222 · frontend.exe (window visible)

## Skor akhir

| Item | Hasil |
|------|------:|
| Suite `run.mjs` | **30/30 PASS** |
| Deep probe | **0 FAIL · 0 WARN** |
| Health fundamental | **100** |
| Composite health | **100** |

## Masalah yang ditemukan & diperbaiki

### 1. Frontend.exe tidak tampil saat remote
- **Cause:** launcher `start` + env CDP tidak andal; Vite/CDP sering mati
- **Fix:** `start-remote-debug.cmd` + `ensure-remote.ps1` (Start-Process, fokusus window, tunggu Vite)
- **Suite:** auto-`ensure-remote` jika health gagal

### 2. Section toggle / chip “outside viewport”
- **Cause:** sidebar `overflow: hidden` + window pendek → header di luar viewport Playwright
- **Fix UI:** `.td-folder-nav { overflow-y: auto }`, min-height chat list, chrome lebih compact
- **Fix test:** click via `evaluate` + `scrollIntoView`

### 3. Status “Drop dibatalkan…” menempel
- **Fix:** auto-clear ~2.2s ke “Siap” saat tidak drag

### 4. DnD / konfirmasi
- Deep + suite: hover benar, dialog Pindah/Salin, Esc, no overlap, same-location no dialog — **PASS**

## Cara jalankan ulang

```bat
powershell -ExecutionPolicy Bypass -File F:\AutoGram\remote-automation-suite\ensure-remote.ps1
cd F:\AutoGram\remote-automation-suite
node run.mjs
node scripts\deep-probe.mjs
```

Atau double-click: `F:\AutoGram\start-remote-debug.cmd`

## Catatan

- Window title binary debug lama: `frontend` (title **AutoGram** setelah rebuild Tauri)
- Jangan tutup window selama remote; suite **tidak** memanggil `browser.close()`
