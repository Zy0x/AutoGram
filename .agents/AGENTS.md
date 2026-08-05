# AutoGram Project Rules

<RULE[project_autogram]>
Dokumen ini berfungsi sebagai pelengkap untuk aturan pengembangan proyek AutoGram (berdasarkan blueprint Telegram Migration Platform).

1. **Root Direktori Utama:**
   - Direktori `AutoGram App/` adalah **root utama** dari aplikasi ini. Seluruh pengembangan fitur baru, perbaikan bug, dan restrukturisasi arsitektur wajib dilakukan di dalam direktori tersebut.
   - Skrip Python yang berada di `legacy_scripts/` HANYA berfungsi sebagai skrip referensi masa lalu. Jangan mengubahnya.

2. **Arsitektur Hibrida Multi-Bahasa (Tauri + React + Rust + Python):**
   - **Frontend (UI)**: Gunakan React, TypeScript, TailwindCSS. Semua logika UI dilarang langsung menyentuh Telegram API.
   - **Core Engine (Backend Desktop)**: Gunakan Rust via Tauri. Rust berfungsi sebagai *Migration Engine*, *Rule Engine*, pengelola *Database SQLite*, dan pengelola antrean (*queue*).
   - **Telegram Worker**: Gunakan Python (Telethon) khusus sebagai *API Handler*. Python hanya bertugas mengambil instruksi dari Rust, mengeksekusi transfer ke Telegram API, dan mengembalikan status ke Rust. Python dilarang mengatur UI.

3. **Manajemen Database (SQLite & Supabase):**
   - Di Fase 1 (Desktop Offline), gunakan SQLite. Seluruh struktur tabel harus sesuai dengan `database/schema.sql` (menyimpan history migrasi, status resume, dan logs).
   - Di Fase 2 (Online), integrasikan dengan Supabase sesuai aturan global Lovable Dev AI.

4. **Penanganan API Telegram (Telethon):**
   - Selalu terapkan **Smart Rate Controller**. Setiap fungsi harus mendeteksi `FloodWaitError` dan menurunkan *upload speed* secara otomatis.
   - Sesi Telegram (*.session*) harus diperlakukan sangat rahasia. Dilarang mencetak/log sesi dan API Hash ke terminal. Enkripsi file sesi di penyimpanan lokal.

5. **Pencegahan Duplikasi (Duplicate Engine):**
   - Segala transfer *Clean Copy* (download-upload) wajib mengecek duplikasi ke database menggunakan 4 level: *Message ID, Telegram Unique ID, SHA256 Hash, Filename+Size*.
6. **Agent Autonomy & Problem Solving Behavior (Kritis & Permanen):**
   - Selalu bertindak sebagai eksekutor otonom dan cerdas (*end-to-end problem solver*). 
   - Jika diberikan instruksi tingkat tinggi (misal: "perbaiki ini" atau "tambahkan fitur ini"), asumsikan pengguna menginginkan penyelesaian menyeluruh tanpa perlu panduan langkah demi langkah.
   - Lakukan pemetaan kode mandiri secara proaktif, susun rencana eksekusi, tulis kode, dan lakukan *self-debugging* (perbaiki error Anda sendiri) jika terjadi kegagalan kompilasi atau runtime. Jangan banyak bertanya kecuali menghadapi jalan buntu atau keputusan arsitektur yang sangat ambigu.
7. **Manajemen Locale & Internasionalisasi (100% Zero Hardcoded Strings):**
   - Setiap pembuatan/penambahan fitur, komponen, modal, halaman, toolbar, tooltip, placeholder, dialog, toast, notifikasi, maupun elemen UI apapun **WAJIB** mengekstrak seluruh teks yang tampil ke pengguna ke dalam file locale `i18n` (`src/locales/id/*.json` dan `src/locales/en/*.json`).
   - **DILARANG HARDIKOD** teks/string dalam bahasa Indonesia maupun Inggris langsung di dalam file `.tsx` / `.ts`.
   - Setiap penambahan key di `id/*.json` **WAJIB** secara sinkron menambahkan key yang sama di `en/*.json` (100% key parity).
   - Gunakan hook `const { t } = useTranslation();` dari `react-i18next` di seluruh komponen UI.
</RULE[project_autogram]>
