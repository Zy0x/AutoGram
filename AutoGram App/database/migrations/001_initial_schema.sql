-- 001 Initial Schema Foundation
-- Berisi struktur dasar pengguna dan integrasi akun.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    master_password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    session_file_path TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1
);
