import sqlite3
import os
import threading


_RUNTIME_SCHEMA_LOCK = threading.Lock()
_RUNTIME_SCHEMA_READY = set()


RUNTIME_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_tasks_execution_status_msg "
    "ON tasks(execution_id, status, source_message_id)",
    "CREATE INDEX IF NOT EXISTS idx_executions_job_started "
    "ON executions(job_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_mapping_job_message "
    "ON message_mapping(job_id, source_msg_id)",
    "CREATE INDEX IF NOT EXISTS idx_mapping_job_status_updated "
    "ON message_mapping(job_id, status, last_updated)",
)

def get_db_path():
    """Mengambil path database. Default ke root database/ folder."""
    db_path = os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'telegram_migrator.db')
    return os.path.abspath(db_path)


def ensure_runtime_indexes(conn):
    """Install scale indexes when their tables exist (safe for old databases)."""
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    for statement in RUNTIME_INDEX_STATEMENTS:
        if " ON tasks(" in statement and "tasks" not in tables:
            continue
        if " ON executions(" in statement and "executions" not in tables:
            continue
        if " ON message_mapping(" in statement and "message_mapping" not in tables:
            continue
        try:
            conn.execute(statement)
        except Exception:
            pass
    conn.commit()

def get_connection():
    """Membuka koneksi ke SQLite database."""
    db_path = get_db_path()

    # Jika db belum ada, kita bisa jalankan init schema untuk keperluan testing mandiri Python
    is_new = not os.path.exists(db_path)
    conn = sqlite3.connect(db_path, timeout=60.0, check_same_thread=False)

    # Connection-scoped safety/performance settings.
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=60000;")  # 60s — handles media_studio + drive_serve contention
    conn.execute("PRAGMA synchronous=NORMAL;")

    if is_new:
        print(f"Database {db_path} tidak ditemukan, membuat baru berdasarkan schema...", flush=True)
        init_schema(conn)

    # WAL mode is persistent. Configure it and install idempotent indexes once
    # per process/database instead of for every per-item query connection.
    with _RUNTIME_SCHEMA_LOCK:
        if db_path not in _RUNTIME_SCHEMA_READY:
            conn.execute("PRAGMA journal_mode=WAL;")
            ensure_runtime_indexes(conn)
            # Apply migration 012 on existing databases (idempotent)
            _apply_migration_012(conn)
            _RUNTIME_SCHEMA_READY.add(db_path)

    return conn

def _apply_migration_012(conn):
    """
    Apply migration 012 on existing databases (idempotent).
    Creates new tables if missing, and adds new columns to duplicate_history
    if they don't exist yet. Safe to call on any database version.
    """
    migrations_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'database', 'migrations')
    migration_012 = os.path.join(migrations_dir, '012_enhanced_dup_detection.sql')
    if not os.path.exists(migration_012):
        return
    try:
        with open(migration_012, 'r') as f:
            sql_content = f.read()
        # Clean single-line comments before splitting
        clean_lines = []
        for line in sql_content.splitlines():
            stripped = line.strip()
            if stripped.startswith('--'):
                continue
            clean_lines.append(line)
        clean_sql = '\n'.join(clean_lines)

        # Execute CREATE TABLE and CREATE INDEX statements (all IF NOT EXISTS — safe)
        create_stmts = []
        alter_stmts  = []
        for stmt in clean_sql.split(';'):
            stmt = stmt.strip()
            if not stmt:
                continue
            upper = stmt.upper().lstrip()
            if upper.startswith('ALTER TABLE'):
                alter_stmts.append(stmt)
            elif upper.startswith('CREATE'):
                create_stmts.append(stmt)

        # Run all CREATE statements at once (they use IF NOT EXISTS)
        if create_stmts:
            conn.executescript(';\n'.join(create_stmts) + ';')

        # Run ALTER TABLE statements one by one, ignoring duplicate column errors
        for stmt in alter_stmts:
            try:
                conn.execute(stmt)
                conn.commit()
            except Exception as e:
                err = str(e).lower()
                if 'duplicate column' in err or 'already exists' in err:
                    pass  # Column already added — idempotent
    except Exception:
        pass  # Migration 012 is non-critical on existing databases

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
                pass  # Ignore if columns already exist
        pass  # skipped 005
        pass  # skipped 006
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
                pass  # columns might already exist
        migration_011 = os.path.join(migrations_dir, '011_migration_scale.sql')
        if os.path.exists(migration_011):
            with open(migration_011, 'r') as f:
                conn.executescript(f.read())
        # Migration 012: Enhanced duplicate detection (new tables + extended columns)
        _apply_migration_012(conn)
        conn.commit()
    except Exception as e:
        print(f"Gagal menginisialisasi skema database: {e}", flush=True)
