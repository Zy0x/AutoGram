# Database Governance

Setiap perubahan struktur database pada proyek ini harus mematuhi aturan berikut:
1. Memiliki *migration file* yang jelas dan berurut di folder `migrations/`.
2. Terdokumentasi kegunaannya.
3. Dapat dilacak (*traceable*) melalui kontrol versi.

DILARANG merubah skema SQLite (`schema.sql`) tanpa menyertakan catatan migrasi yang sesuai!
