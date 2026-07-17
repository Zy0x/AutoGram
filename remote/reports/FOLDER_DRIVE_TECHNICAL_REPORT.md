# Laporan Teknis: Perombakan Folder Drive (Media Studio)

**Tanggal:** 2026-07-15  
**Sumber:** Live CDP audit + deep probe + review kode  
**Status:** **Audit & spesifikasi saja — belum implementasi**  
**Session live:** `Lavender` · frontend.exe CDP `:9222` · Vite `:1420`

---

## 1. Ringkasan eksekutif

Media Studio Drive sudah punya **fondasi folder-in-folder yang berfungsi di production live**:

| Aspek | Status live |
|--------|-------------|
| Drive terhubung | ✅ |
| Folder `[TD]` ter-scan | ✅ (~3–5 root + subfolder remote test) |
| Tree nested (indent + chevron) | ✅ **multi-level** terlihat |
| Buat root / subfolder | ✅ toolbar `+ Sub` + empty-state + context menu |
| Hapus folder | ✅ context menu `Hapus folder [TD]…` |
| Rename folder | ❌ tidak ada |
| Pindah/reparent folder | ❌ tidak ada |
| DnD reorganisasi folder | ❌ hanya DnD **file** |
| Cascade delete anak | ❌ tidak ada |
| Breadcrumb path multi-level | ⚠️ hanya 1 segmen lokasi |
| Wizard perombakan massal flat→tree | ❌ tidak ada |

**Kesimpulan:** “Perombakan folder Drive” **bukan** pekerjaan dari nol. Yang belum selesai adalah **manajemen folder penuh + reorganisasi aman** di atas hierarki virtual yang sudah jalan.

---

## 2. Evidence live CDP

### 2.1 Artefak

| File | Isi |
|------|-----|
| `reports/folder_drive_audit_2026-07-15T12-02-50.json` | Audit otomatis penuh |
| `reports/folder_drive_deep_probe.json` | Tree + context menu akurat |
| `reports/screenshots/2026-07-15T12-02-50_folder_audit_main.png` | UI tree nested + empty folder |
| `reports/screenshots/2026-07-15_folder_ctxmenu.png` | Context menu folder |
| `scripts/folder-drive-audit.mjs` | Script audit (bisa diulang) |

### 2.2 Tree hierarki (deep probe, sesi Lavender)

```
Saved Messages
#GudangTD                          (root, pl=8)
#Gudang - Donghua 3D [TD]          (root, toggle expanded)
  └ SubRemote_848254 [TD]          (nested pl=22, toggle expanded)
      └ SubRemote_099359 [TD]      (nested pl=36, leaf, active di audit sebelumnya)
#Gudang ~ Donghua [TD]             (root)
(+ chats non-TD di section Chats)
```

**Observasi:**

- Indentasi nyata: `pl 8 → 22 → 36` = **3 level**.
- Subfolder uji remote (`SubRemote_*`) menempel di bawah `#Gudang - Donghua 3D`.
- Banyak channel `#Gudang ~ …` masih **flat root** (bukan nested) — kandidat “perombakan massal”.
- Chip **Recent** menampilkan folder **flat** (bukan tree) — normal untuk recents.

### 2.3 Context menu folder Drive (deep probe — **koreksi** audit pertama)

Audit otomatis pertama salah baca menu (hanya 1 item). Deep probe mengonfirmasi menu `.drive-context-menu` berisi:

1. **Buka**
2. **Buat subfolder di sini**
3. **Salin ID**
4. **Hapus folder [TD]…**

**Tidak ada:** Ganti nama folder · Pindah folder / Ubah induk · Duplikat folder.

### 2.4 Toolbar / empty state

- Saat di dalam folder Drive: tombol **`+ Sub`** + empty state **Buat subfolder [TD]**.
- Breadcrumb contoh: `Start / SubRemote_099359` — **bukan**  
  `Start / #Gudang - Donghua 3D / SubRemote_848254 / SubRemote_099359`.

### 2.5 Catatan stabilitas remote

- `ensure-remote.ps1` kadang melaporkan CDP OK lalu proses `frontend.exe` hilang jika env CDP tidak di-inherit stabil.
- Launch andal: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` via `ProcessStartInfo`, pastikan Vite `:1420` dulu, baru `frontend.exe`.
- **Jangan** `browser.close()` pada Playwright CDP.

---

## 3. Model data & arsitektur (as-is)

### 3.1 Mapping Telegram

| Konsep UI | Realitas Telegram |
|-----------|-------------------|
| Folder Drive root | Channel privat, title `Name [TD]`, about `[telegram-drive-folder]` |
| Subfolder | **Channel privat terpisah** (bukan “folder di dalam channel”) |
| Hierarki | Metadata di about: `parent=-100…` |
| File di folder | Message media di channel tersebut |
| Saved Messages | Peer “me” / Saved |

Hierarki **hanya dikenali AutoGram** (dan klien yang baca about yang sama). Di Telegram resmi, subfolder = channel setara di daftar chat.

### 3.2 Alur teknis

```text
UI (SpeedTest + media-drive/*)
  → driveApi / driveSession (warm JSON-RPC atau one-shot daemon)
    → drive_serve.py | drive_fs.py
      → Telethon: CreateChannel / EditChatAbout / DeleteChannel / iter_dialogs
```

**File kunci:**

| Lapisan | Path |
|---------|------|
| Orkestrasi UI | `frontend/src/pages/SpeedTest.tsx` |
| Tree sidebar | `frontend/src/components/media-drive/DriveSidebar.tsx` |
| Context menu | `frontend/src/components/media-drive/DriveContextMenu.tsx` |
| Tree pure fn | `frontend/src/lib/chatSearch.ts` (`buildFolderTreeRows`) |
| API | `frontend/src/lib/driveApi.ts` |
| Worker | `worker/engine/drive_fs.py`, `drive_serve.py` |
| DnD file | `frontend/src/lib/driveDrag.ts` |

### 3.3 API folder yang sudah ada

| Operasi | Backend | Frontend API |
|---------|---------|--------------|
| Scan folders + `parent_id` | `_scan_folders_on` | `driveScanFolders` / bootstrap |
| Create root/sub | `create_folder(parent_id?)` | `driveCreateFolder(..., { parentId })` |
| Delete 1 folder | `delete_folder_on_client` | `driveDeleteFolder` |
| Rename folder | — | — |
| Set/reparent parent | — | — |
| List children / cascade | — | — (tree di UI saja) |

### 3.4 Batasan platform (non-negotiable)

1. **1 folder = 1 channel Telegram** → risk `ChannelsTooMuch` / `UserRestricted`.
2. Session SQLite lock → Drive queue + exclusive session pattern sudah ada.
3. About channel punya **batas panjang** → metadata parent harus ringkas (`parent=-100…`).
4. User bisa edit about manual di Telegram → `parent_id` bisa rusak/orphan.

---

## 4. Gap analysis (prioritas)

### P0 — Harus untuk “manajemen folder lengkap”

| ID | Gap | Impact | Evidence |
|----|-----|--------|----------|
| **F-RENAME** | Tidak ada rename folder (title channel) | Nama jelek/`SubRemote_*` tidak bisa dirapikan di app | Live menu + kode |
| **F-REPARENT** | Tidak bisa ubah parent folder existing | Tidak bisa “susun ulang” tree tanpa recreate | Live + kode |
| **F-CASCADE** | Delete 1 channel; anak jadi orphan root | Tree rusak / folder zombie | `delete_folder_on_client` |

### P1 — Pengalaman file-manager

| ID | Gap | Impact |
|----|-----|--------|
| **F-BREADCRUMB** | Path multi-level tidak ditampilkan | User bingung posisi nested |
| **F-DND-FOLDER** | Tidak bisa drag folder ke folder lain | Reorg lambat (hanya via dialog) |
| **F-SEARCH-TREE** | Search `forceFlat` | Hierarchy hilang saat cari (trade-off, dokumentasikan) |

### P2 — Perombakan skala gudang

| ID | Gap | Impact |
|----|-----|--------|
| **F-BULK** | Tidak ada wizard: pilih root + assign children / “jadikan subfolder” massal | Banyak `#Gudang ~ *` tetap flat |
| **F-LIMIT-UX** | Warning proaktif sisa kuota channel | User kejut `ChannelsTooMuch` |
| **F-ORPHAN-UI** | Orphan `parent_id` tidak ditandai | Sulit debug metadata rusak |

### Bukan gap (sudah OK live)

- Create subfolder (toolbar + menu + empty state)
- Tree expand/collapse + indent multi-level
- Delete folder (single) dari context menu
- DnD / move **file** antar lokasi (suite remote sebelumnya 30/30)

---

## 5. Desain teknis usulan (untuk keputusan)

### 5.1 Prinsip

1. **Hierarki tetap virtual** via `about` (tidak memindahkan message antar channel hanya untuk “pindah folder”).
2. **Reparent = EditChatAbout**, bukan copy file.
3. **Rename = EditTitle channel** (+ pertahankan suffix `[TD]`).
4. **Delete** default: tolak jika punya anak, **atau** opsi eksplisit “hapus termasuk N subfolder”.
5. Semua mutasi folder lewat warm session + serial queue yang sudah ada.
6. UI Indonesia; istilah **murid** tidak relevan di sini (domain Drive).

### 5.2 Kontrak API baru (worker)

```text
rename_folder
  in:  { folder_id: number, name: string }
  out: { status, folder: DriveFolder }
  impl: EditTitle / channels.EditTitle — pastikan title akhir = "{name} [TD]"
        Jangan hapus tag about / parent=

set_folder_parent   # reparent
  in:  { folder_id: number, parent_id: number | null }
  out: { status, folder }
  impl:
    - validasi folder_id & parent_id adalah Drive [TD]
    - cegah cycle (folder tidak boleh ancestor dirinya)
    - cegah parent = self
    - EditChatAbout: "Telegram Drive folder [telegram-drive-folder]" + optional " parent={id}"
    - update _FOLDER_PARENT_CACHE

delete_folder (perluas)
  in:  { folder_id, cascade?: boolean }
  out: { deleted: number[], skipped?: ..., orphans_fixed?: ... }
  impl:
    - cascade=false (default): error jika children.length > 0
      message: "Folder punya N subfolder. Hapus anak dulu atau centang cascade."
    - cascade=true: DFS hapus descendants lalu self (respect FloodWait)
    - opsi alternatif "detach children" → set parent=null lalu hapus self
```

Dispatch: `drive_serve.py` + `run_drive_action` di `drive_fs.py`.  
Frontend: `driveRenameFolder`, `driveSetFolderParent`, perluas `driveDeleteFolder`.

### 5.3 UI / UX

| Fitur | Interaksi |
|-------|-----------|
| Rename | Context menu folder → “Ganti nama folder…” → `DriveInputDialog` |
| Reparent | Context menu → “Pindah ke folder…” → `DriveDestinationPicker` **hanya Drive folders** (bukan chat), + opsi “Jadikan root” |
| Cascade delete | Dialog konfirmasi: daftar anak + checkbox cascade / detach |
| Breadcrumb | `Start / Root / … / Current` dari `folderAncestorIds` + klik ancestor |
| DnD folder (opsional P1) | Drag `.td-folder-row` ke drop-key `drive:*` → confirm reparent |
| Bulk reorg (P2) | Wizard: pilih parent target + multi-select folder root → batch `set_folder_parent` |

### 5.4 Validasi & edge cases

| Kasus | Perilaku |
|-------|----------|
| Cycle A→B→A | Tolak dengan error jelas |
| Parent non-TD / chat | Tolak |
| Parent = self | Tolak |
| Orphan parent missing | Tetap render sebagai root (sudah) + badge “yatim” (baru) |
| FloodWait delete cascade | Pause, emit event, resume sisa |
| ChannelsTooMuch create | Error Indonesia existing dipertahankan |
| Concurrent rename+scan | Invalidate parent cache + refresh folders list |
| User hapus channel di Telegram luar | Scan berikutnya hilangkan; orphan parent fix |

### 5.5 Data / persistence

- **Tidak perlu tabel SQLite baru** untuk hierarki (sumber kebenaran = Telegram about).
- Opsional P2: cache lokal `folder_meta(peer_id, parent_id, sort_order, color)` seperti Telegram-Drive grouping — **hanya** jika butuh sort manual / warna grup; harus sync ulang dari Telegram.

### 5.6 Testing

| Level | Isi |
|-------|-----|
| Unit | `buildFolderTreeRows` cycle helpers; parent path; forceFlat |
| Worker unit | parse/set about parent; cycle detect (mock) |
| CDP remote | rename → tree label update; reparent → indent berubah; delete blocked with children; cascade |
| Regression | DnD **file** suite existing harus tetap 30/30 |

Script baru disarankan: `scripts/folder-mgmt-audit.mjs` (mutate di folder uji `SubRemote_*` saja).

---

## 6. Rencana eksekusi bertahap (usulan PR)

### Tahap A — Foundation API (1–2 hari dev)

1. `rename_folder` backend + API + UI menu  
2. `set_folder_parent` backend + validasi cycle + UI “Pindah ke…”  
3. Unit tests parse about + cycle  

**Acceptance A:**

- [ ] Rename folder mengubah label sidebar tanpa hilang `[TD]` / parent  
- [ ] Reparent mengubah indent tree setelah refresh  
- [ ] Cycle ditolak  
- [ ] Session lock tidak merusak warm serve  

### Tahap B — Delete aman + breadcrumb (1 hari)

1. Delete default block-if-children  
2. Dialog cascade / detach  
3. Breadcrumb multi-level klikable  

**Acceptance B:**

- [ ] Hapus parent dengan anak → dialog, tidak silent orphan  
- [ ] Cascade menghapus N channel (uji di folder test saja)  
- [ ] Breadcrumb menunjukkan ancestor chain  

### Tahap C — UX reorg (opsional, 1–2 hari)

1. DnD folder → reparent confirm  
2. Badge orphan  
3. Warning soft channel limit  

### Tahap D — Bulk perombakan (opsional produk)

1. Wizard multi-select “Jadikan subfolder di bawah X”  
2. Dry-run list perubahan parent  
3. Batch dengan delay anti-FloodWait  

---

## 7. Estimasi risiko

| Risiko | Level | Mitigasi |
|--------|-------|----------|
| `ChannelsTooMuch` saat user buat banyak sub | Tinggi | UX limit + prefer reparent vs create baru |
| Cascade delete menghapus channel berisi media | Tinggi | Confirm + list count file (opsional scan) + default non-cascade |
| Edit about menimpa teks user | Sedang | Template about deterministic; preserve non-parent fields jika ada |
| Regresi DnD file | Sedang | Suite remote existing wajib hijau |
| Peer id format (-100…) mismatch | Sedang | Normalisasi peer id di satu helper |
| frontend.exe CDP drop | Operasional | Document launch path; jangan kill saat audit |

---

## 8. Out of scope (sengaja)

- Mengubah Jobs/migration engine  
- Menyimpan file “di dalam” folder tanpa channel baru (mustahil murni di Telegram tanpa model lain)  
- Mirror 1:1 semua fitur `Source/Telegram-Drive-main` (REST API, share link, Android)  
- Group warna lokal ala TD (kecuali diputuskan Tahap D+)  
- Hapus/refactor `legacy_scripts/` atau `archive/`  

---

## 9. Matriks kemampuan (live + kode)

| Kemampuan | Live | Kode backend | Kode UI |
|-----------|------|--------------|---------|
| List folder TD | ✅ | ✅ | ✅ |
| Tree nested | ✅ | ✅ parent_id | ✅ |
| Create root | ✅ | ✅ | ✅ |
| Create subfolder | ✅ | ✅ | ✅ |
| Delete folder single | ✅ | ✅ | ✅ |
| Rename folder | ❌ | ❌ | ❌ |
| Reparent folder | ❌ | ❌ | ❌ |
| Cascade / detach delete | ❌ | ❌ | ❌ |
| Breadcrumb multi-level | ⚠️ partial | n/a | ⚠️ 1 segmen |
| DnD file | ✅ (suite) | ✅ | ✅ |
| DnD folder | ❌ | ❌ | ❌ |
| Bulk reorg wizard | ❌ | ❌ | ❌ |

---

## 10. Rekomendasi keputusan untuk Anda

Tiga paket pilihan (bisa kombinasi):

### Opsi 1 — **Minimum Complete** (disarankan dulu)

Tahap **A + B** saja: rename, reparent, delete aman, breadcrumb.  
Cukup untuk “merapikan” gudang tanpa wizard massal.

### Opsi 2 — **File-manager feel**

Opsi 1 + Tahap **C** (DnD folder, orphan badge, limit warning).

### Opsi 3 — **Perombakan gudang besar**

Opsi 2 + Tahap **D** (wizard bulk assign parent ke puluhan `#Gudang ~ *`).

---

## 11. Pertanyaan keputusan (maks. 3)

1. **Paket mana** yang Anda setujui: Opsi 1 / 2 / 3 / custom?  
2. **Delete default:** block-if-children, cascade, atau detach-children?  
3. **Bulk reorg:** perlu sekarang, atau nanti setelah rename+reparent manual stabil?

---

## 12. Lampiran — koreksi temuan audit otomatis

| Temuan audit v1 | Koreksi deep probe |
|-----------------|--------------------|
| Context menu tanpa create sub | **Salah** — ada “Buat subfolder di sini” |
| Context menu tanpa hapus | **Salah** — ada “Hapus folder [TD]…” |
| Hierarchical live | **Benar** — 3 level di `#Gudang - Donghua 3D` |
| No rename / no reparent | **Benar** |
| Search flattens tree | **Benar** (by design) |

---

---

## 13. Status implementasi (2026-07-15)

User memilih **Opsi 2 — File-manager feel**. Diimplementasikan:

| Fitur | Status |
|-------|--------|
| `rename_folder` API + menu | ✅ |
| `set_folder_parent` / reparent + menu + picker | ✅ |
| Delete aman (block children → detach/cascade dialog) | ✅ |
| Breadcrumb multi-level klikable | ✅ |
| DnD folder reparent | ✅ |
| Badge orphan (yatim) | ✅ |
| Soft channel-limit banner (≥450) | ✅ |
| Unit tests (chatSearch + drive_fs helpers) | ✅ |
| `tsc --noEmit` | ✅ |

*Implementasi Opsi 2 selesai di working tree; verifikasi live CDP (rename/reparent/delete) disarankan di sesi Anda.*
