# Test Strategy

Untuk mencegah regresi (*bugs*) yang merusak sesi pengguna dan mengakibatkan larangan akun (*account ban*), seluruh kode wajib diuji sebelum di-*merge* ke cabang `main`.

## 1. Unit Testing
- **Fokus**: Fungsi logika di Rust (Rule Engine, Duplicate Engine, SQLite queries).
- **Syarat**: *Mocking* input pesan mentah dan memverifikasi apakah *Rule Engine* menghasilkan aksi *Skip* atau *Forward* yang benar.
- *Framework*: Cargo test untuk Rust, PyTest untuk Python, Jest/Vitest untuk UI.

## 2. Integration Testing
- **Fokus**: Komunikasi antara Rust Core dan Python Worker.
- **Kasus Uji**: 
  - Mengirim *event* "Start Migration" dari Rust, dan memastikan Python menanggapi dengan status `Running`.
  - Mengirim instruksi "Pause" dari Rust, dan memastikan Python berhenti pada pesan berikutnya tanpa kehilangan *progress*.

## 3. System Testing (Migration E2E)
- **Fokus**: Tes skala kecil untuk mode migrasi penuh.
- **Metode**: Membuat *Channel Test A* dan *Channel Test B* dengan bot uji coba. Mengirimkan 50 pesan berbagai tipe (teks, foto album, video besar) dan memverifikasi hasilnya mendarat sempurna.

## 4. Security & Safety Testing
- **Dry Run Test**: Menjalankan mode *Scan Only*, memastikan sama sekali tidak ada API transmisi unggah/kirim yang terpanggil.
- **Throttle Test**: Mensimulasikan lemparan `FloodWaitError` buatan untuk melihat apakah Python Worker melakukan `sleep` yang sesuai tanpa membuat UI React macet (*not responding*).
