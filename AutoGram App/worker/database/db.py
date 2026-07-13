import sqlite3
import os

def get_db_path():
    """Mengambil path database. Default ke root database/ folder."""
    db_path = os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'telegram_migrator.db')
    return os.path.abspath(db_path)

def get_connection():
    """Membuka koneksi ke SQLite database."""
    db_path = get_db_path()
    
    # Jika db belum ada, kita bisa jalankan init schema untuk keperluan testing mandiri Python
    is_new = not os.path.exists(db_path)
    conn = sqlite3.connect(db_path, timeout=30.0, check_same_thread=False)
    
    # Optimasi untuk High Concurrency
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    
    if is_new:
        print(f"Database {db_path} tidak ditemukan, membuat baru berdasarkan schema...", flush=True)
        init_schema(conn)
        
    return conn

def init_schema(conn):
    """Menjalankan file migrasi awal jika DB belum terbentuk (untuk Dev Mode)."""
    migrations_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'migrations')
    
    try:
        with open(os.path.join(migrations_dir, '001_initial_schema.sql'), 'r') as f:
            conn.executescript(f.read())
        with open(os.path.join(migrations_dir, '002_telegram_core.sql'), 'r') as f:
            conn.executescript(f.read())
        with open(os.path.join(migrations_dir, '003_sync_engine.sql'), 'r') as f:
            conn.executescript(f.read())
        with open(os.path.join(migrations_dir, '004_job_manager.sql'), 'r') as f:
            try:
                conn.executescript(f.read())
            except sqlite3.OperationalError:
                pass # Ignore if columns already exist
        pass # skipped 005
        pass # skipped 006
        with open(os.path.join(migrations_dir, '007_execution_engine.sql'), 'r') as f:
            conn.executescript(f.read())
        with open(os.path.join(migrations_dir, '008_sessions.sql'), 'r') as f:
            conn.executescript(f.read())
        with open(os.path.join(migrations_dir, '009_enterprise_engine.sql'), 'r') as f:
            conn.executescript(f.read())
        with open(os.path.join(migrations_dir, '010_retry_engine.sql'), 'r') as f:
            try:
                conn.executescript(f.read())
            except sqlite3.OperationalError:
                pass # columns might already exist
        conn.commit()
    except Exception as e:
        print(f"Gagal menginisialisasi skema database: {e}", flush=True)
