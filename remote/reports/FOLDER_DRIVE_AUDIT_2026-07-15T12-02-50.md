# Live CDP Audit — Folder Drive

**Waktu:** 2026-07-15T12:02:50.209Z
**Shell:** true · **Connected:** true
**Folder rows:** 26 · **Hierarchical live:** true

## Findings
- **WARN** [session] Drive belum terhubung — coba tunggu/bootstrap session
- **INFO** [session] Drive terhubung setelah +2s
- **INFO** [folders] 26 baris folder Drive di sidebar
- **INFO** [tree] UI menampilkan indikasi hierarki (indent / nested / tree toggle)
- **INFO** [context-menu] Menu folder terbuka (1 item)
- **GAP** [menu] Tidak terlihat aksi buat subfolder di context menu folder
- **GAP** [menu] Tidak terlihat hapus folder
- **GAP** [menu] Tidak ada Rename folder di context menu lokasi
- **GAP** [menu] Tidak ada Move/Reparent folder
- **PASS** [toolbar] Tombol buat folder root ada
- **INFO** [toolbar] Tombol/label subfolder terlihat (mungkin hanya saat di dalam folder Drive)
- **PASS** [inside-folder] Saat di dalam folder Drive, UI offer subfolder (+ Sub)
- **INFO** [nav] Breadcrumb: Start
/
- **INFO** [search] Saat search, folder dirender flat (sesuai forceFlat di kode)

## Gaps
- `MENU_NO_CREATE_SUB` (high): Context menu folder tanpa create subfolder
- `MENU_NO_DELETE` (medium): Context menu tanpa hapus folder
- `NO_RENAME_FOLDER` (high): Tidak ada UI rename folder (hanya file rename di codebase)
- `NO_REPARENT_FOLDER` (high): Tidak bisa mengubah parent folder yang sudah ada
- `SEARCH_FLATTENS_TREE` (low): Universal search men-flatten tree — UX sadar trade-off
- `NO_RENAME_FOLDER_API` (high): Backend/UI: tidak ada rename folder (hanya rename file)
- `NO_REPARENT_API` (high): Tidak ada API set parent_id / EditChatAbout untuk folder existing
- `NO_FOLDER_DND` (medium): DnD hanya media files, bukan reorganisasi folder tree
- `NO_CASCADE_DELETE` (high): delete_folder hanya 1 channel; children parent_id orphan
- `NO_BULK_REORG` (medium): Tidak ada wizard perombakan massal flat → nested tree
- `CHANNEL_LIMIT` (high): 1 subfolder = 1 Telegram channel → ChannelsTooMuch risk

## Capability matrix
```json
{
  "list_drive_folders": true,
  "tree_ui_present": true,
  "create_root_folder_btn": true,
  "create_subfolder_btn_or_menu": true,
  "delete_folder_menu": false,
  "rename_folder": false,
  "reparent_move_folder": false,
  "dnd_folder_reorganize": false,
  "cascade_delete": false,
  "dnd_files_to_folder": true
}
```

## Screenshot
F:\AutoGram\remote-automation-suite\reports\screenshots\2026-07-15T12-02-50_folder_audit_main.png
