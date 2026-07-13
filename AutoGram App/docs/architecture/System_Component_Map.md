# System Component Map

Memvisualisasikan bagaimana antarmuka UI, modul Rust Core, dan Python Worker berinteraksi.

```mermaid
graph TD
    A[React UI (TypeScript)] -->|Tauri IPC Commands| B(Rust Core Engine)
    B -->|SQL Queries| C[(SQLite Database)]
    B -->|Spawn/Pipe| D{Python Telegram Worker}
    D -->|Telethon API| E[Telegram Servers]
    
    D -->|stdout/stderr| B
    B -->|Tauri Events| A
```

- **React UI**: Mengelola interaksi pengguna, menampilkan *progress bar*, dan menyimpan profil.
- **Rust Core**: Mengatur siklus hidup aplikasi, memanajemen file lokal (cache), serta memanggil *Worker*.
- **Python Worker**: Sepenuhnya diisolasi hanya untuk komunikasi dengan Telegram MTProto.
