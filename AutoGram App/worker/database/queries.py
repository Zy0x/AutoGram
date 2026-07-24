import sqlite3
import json
from .db import get_connection

# --- Jobs Queries ---

def create_job(profile_name, source_entity_id, target_entity_id, transfer_mode, config_json, job_name=None):
    """Membuat job baru (Template Konfigurasi) dan mengembalikan ID-nya."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO jobs (name, profile_name, source_entity_id, target_entity_id, transfer_mode, config_json)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (job_name, profile_name, source_entity_id, target_entity_id, transfer_mode, config_json))
    job_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return job_id

def update_job(job_id, profile_name, source_entity_id, target_entity_id, transfer_mode, config_json, job_name=None):
    """Memperbarui data dan konfigurasi job berdasarkan ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE jobs 
        SET profile_name = ?, source_entity_id = ?, target_entity_id = ?, transfer_mode = ?, config_json = ?, name = ?
        WHERE id = ?
    ''', (profile_name, source_entity_id, target_entity_id, transfer_mode, config_json, job_name, job_id))
    conn.commit()
    conn.close()


def update_job_status(job_id, status):
    """Update lightweight status flag on jobs table if column exists; no-op safe."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('UPDATE jobs SET status = ? WHERE id = ?', (status, job_id))
        conn.commit()
    except Exception:
        # Column may not exist on older schemas — ignore
        pass
    finally:
        conn.close()

def get_job(job_id):
    """Mendapatkan data job berdasarkan ID."""
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM jobs WHERE id = ?', (job_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_all_jobs():
    """Mengambil semua jobs untuk UI beserta status eksekusi terakhirnya."""
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT 
            j.id, j.name as job_name, j.profile_name, j.source_entity_id, 
            j.target_entity_id, j.transfer_mode, j.config_json, j.created_at,
            e.status, e.processed_messages, e.total_messages, 
            e.last_processed_id, e.id as last_execution_id
        FROM jobs j
        LEFT JOIN (
            SELECT job_id, status, processed_messages, total_messages, last_processed_id, id,
                   ROW_NUMBER() OVER(PARTITION BY job_id ORDER BY started_at DESC) as rn
            FROM executions
        ) e ON j.id = e.job_id AND e.rn = 1
        ORDER BY j.created_at DESC
    ''')
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def delete_job(job_id):
    """Menghapus job dan otomatis menghapus seluruh eksekusinya (ON DELETE CASCADE)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM jobs WHERE id = ?', (job_id,))
    conn.commit()
    conn.close()

# --- Executions Queries ---

def create_execution(job_id, snapshot_config_json):
    """Membuat instance eksekusi baru dari sebuah job."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO executions (job_id, snapshot_config_json, status)
        VALUES (?, ?, 'STARTING')
    ''', (job_id, snapshot_config_json))
    execution_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return execution_id


def seed_execution_from_prior(job_id, new_execution_id, *, allow_statuses=None):
    """
    Copy last_processed_id / processed_messages from the most recent prior
    execution so Resume (new execution row) continues the checkpoint.
    """
    # Do NOT seed from COMPLETED — a new run after success should start clean
    # (duplicates still skip via history). Resume targets PAUSED / partial / failed.
    allow = allow_statuses or (
        'PAUSED', 'PARTIAL_SUCCESS', 'PARTIAL', 'FAILED', 'STOPPING', 'PAUSING'
    )
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        placeholders = ','.join('?' * len(allow))
        cursor.execute(f'''
            SELECT last_processed_id, processed_messages, total_messages, status
            FROM executions
            WHERE job_id = ? AND id != ? AND status IN ({placeholders})
            ORDER BY id DESC
            LIMIT 1
        ''', (job_id, new_execution_id, *allow))
        row = cursor.fetchone()
        if not row:
            return False
        last_id = row['last_processed_id'] or 0
        processed = row['processed_messages'] or 0
        total = row['total_messages']
        if last_id <= 0 and processed <= 0:
            return False
        if total is not None:
            cursor.execute('''
                UPDATE executions
                SET last_processed_id = ?, processed_messages = ?, total_messages = ?
                WHERE id = ?
            ''', (last_id, processed, total, new_execution_id))
        else:
            cursor.execute('''
                UPDATE executions
                SET last_processed_id = ?, processed_messages = ?
                WHERE id = ?
            ''', (last_id, processed, new_execution_id))
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()

def update_execution_progress(execution_id, last_processed_id, processed_messages, total_messages=None):
    """Memperbarui progres eksekusi saat ini."""
    conn = get_connection()
    cursor = conn.cursor()
    if total_messages is not None:
        cursor.execute('''
            UPDATE executions 
            SET last_processed_id = ?, processed_messages = ?, total_messages = ?
            WHERE id = ?
        ''', (last_processed_id, processed_messages, total_messages, execution_id))
    else:
        cursor.execute('''
            UPDATE executions 
            SET last_processed_id = ?, processed_messages = ?
            WHERE id = ?
        ''', (last_processed_id, processed_messages, execution_id))
    conn.commit()
    conn.close()

def update_execution_status(execution_id, status, error_message=None):
    """Memperbarui status eksekusi (State Machine)."""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Jika selesai/stop, catat waktu selesai
    is_terminal = status in [
        'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'STOPPED', 'CANCELLED', 'PAUSED'
    ]
    
    if is_terminal:
        cursor.execute('''
            UPDATE executions 
            SET status = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (status, error_message, execution_id))
    else:
        cursor.execute('''
            UPDATE executions 
            SET status = ?, error_message = ?
            WHERE id = ?
        ''', (status, error_message, execution_id))
        
    conn.commit()
    conn.close()


def request_pause_for_job(job_id):
    """Mark running/starting executions as PAUSING for cooperative stop."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE executions
        SET status = 'PAUSING', error_message = 'Pause requested by user'
        WHERE job_id = ? AND status IN ('RUNNING', 'STARTING', 'RESUMING')
    ''', (job_id,))
    conn.commit()
    changed = cursor.rowcount
    conn.close()
    return changed


def clear_duplicate_history_for_target(target_entity_id):
    """Remove file-level duplicate history for a destination entity."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'DELETE FROM duplicate_history WHERE target_entity_id = ?',
            (str(target_entity_id),)
        )
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def clear_tasks_for_job(job_id):
    """Clear tasks belonging to all executions of a job."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            DELETE FROM tasks WHERE execution_id IN (
                SELECT id FROM executions WHERE job_id = ?
            )
        ''', (job_id,))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def mark_stalled_mappings_for_job(job_id, status='FAILED', message='Stalled after process end'):
    """Best-effort mark enterprise IN_PROGRESS rows as failed after kill/reconcile."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            UPDATE message_mapping
            SET status = ?, error_message = ?, last_updated = CURRENT_TIMESTAMP
            WHERE job_id = ? AND status = 'IN_PROGRESS'
        ''', (status, message, str(job_id)))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()

def get_execution(execution_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM executions WHERE id = ?', (execution_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_executions_by_job(job_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM executions WHERE job_id = ? ORDER BY started_at DESC', (job_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]
    
def get_all_executions():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    # Join with jobs to get job name
    cursor.execute('''
        SELECT e.*, j.name as job_name, j.profile_name 
        FROM executions e
        JOIN jobs j ON e.job_id = j.id
        ORDER BY e.started_at DESC
    ''')
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# --- Tasks Queries ---

def create_task(execution_id, source_message_id, file_unique_id=None, file_hash=None, file_name=None, file_size=None, status='RUNNING'):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO tasks (execution_id, source_message_id, file_unique_id, file_hash, file_name, file_size, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (execution_id, source_message_id, file_unique_id, file_hash, file_name, file_size, status))
    task_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return task_id


def create_tasks_batch(rows):
    """
    Insert task rows in one transaction and return their generated IDs.

    Each row is `(execution_id, source_message_id, file_unique_id, file_hash,
    file_name, file_size, status)`. Inserts stay individual inside the same
    transaction so callers retain the exact task-id/message pairing.
    """
    if not rows:
        return []
    conn = get_connection()
    cursor = conn.cursor()
    task_ids = []
    try:
        cursor.execute('BEGIN')
        for row in rows:
            cursor.execute('''
                INSERT INTO tasks
                (execution_id, source_message_id, file_unique_id, file_hash, file_name, file_size, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', tuple(row))
            task_ids.append(cursor.lastrowid)
        conn.commit()
        return task_ids
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def update_task_status(task_id, status, target_message_id=None, error_category=None, error_message=None):
    """Memperbarui status task (DONE / FAILED / SKIPPED)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE tasks 
        SET status = ?, target_message_id = ?, error_category = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    ''', (status, target_message_id, error_category, error_message, task_id))
    conn.commit()
    conn.close()


def update_task_status_batch(rows):
    """Update task states in one transaction.

    Rows are `(status, target_message_id, error_category, error_message, task_id)`.
    """
    if not rows:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.executemany('''
            UPDATE tasks
            SET status = ?, target_message_id = ?, error_category = ?,
                error_message = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', [tuple(row) for row in rows])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def get_failed_source_message_ids(execution_id):
    """Mengambil list source_message_id yang statusnya FAILED untuk suatu eksekusi."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT source_message_id FROM tasks 
        WHERE execution_id = ? AND status = 'FAILED'
    ''', (execution_id,))
    rows = cursor.fetchall()
    conn.close()
    return [r[0] for r in rows]

def get_execution_task_stats(execution_id):
    """Mendapatkan statistik penyelesaian task dalam suatu eksekusi."""
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT 
            COUNT(*) as total_tasks,
            SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as total_done,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as total_failed,
            SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) as total_skipped,
            SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as total_running
        FROM tasks
        WHERE execution_id = ?
    ''', (execution_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

# --- Duplicate History Queries ---

def log_duplicate(file_unique_id, target_entity_id, target_message_id):
    """Mencatat histori duplikasi sukses."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO duplicate_history (file_unique_id, target_entity_id, target_message_id)
            VALUES (?, ?, ?)
        ''', (file_unique_id, target_entity_id, target_message_id))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def log_duplicates_batch(rows):
    """Persist duplicate keys with one connection/commit (existing keys stay)."""
    if not rows:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.executemany('''
            INSERT OR IGNORE INTO duplicate_history
            (file_unique_id, target_entity_id, target_message_id)
            VALUES (?, ?, ?)
        ''', [tuple(row) for row in rows])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def purge_deleted_duplicates_batch(target_entity_id: str, message_ids: list) -> int:
    """
    Menghapus entri duplicate_history & message_mapping lokal saat ID pesan Telegram
    terdeteksi terhapus / MessageEmpty di server Telegram.
    """
    if not message_ids:
        return 0
    clean_ids = [int(m) for m in message_ids if m is not None and int(m) > 0]
    if not clean_ids:
        return 0
    conn = get_connection()
    cursor = conn.cursor()
    total_purged = 0
    try:
        entity_str = str(target_entity_id) if target_entity_id is not None else ""
        for start in range(0, len(clean_ids), 400):
            chunk = clean_ids[start:start + 400]
            placeholders = ",".join("?" for _ in chunk)
            if entity_str:
                cursor.execute(
                    f"DELETE FROM duplicate_history "
                    f"WHERE target_entity_id = ? AND target_message_id IN ({placeholders})",
                    (entity_str, *chunk),
                )
            else:
                cursor.execute(
                    f"DELETE FROM duplicate_history "
                    f"WHERE target_message_id IN ({placeholders})",
                    (*chunk,),
                )
            total_purged += cursor.rowcount or 0

            # Juga bersihkan entri pada message_mapping jika tabel ada
            try:
                cursor.execute(
                    f"DELETE FROM message_mapping "
                    f"WHERE target_msg_id IN ({placeholders}) OR source_msg_id IN ({placeholders})",
                    (*chunk, *chunk),
                )
            except Exception:
                pass
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[DB] Failed to purge deleted duplicates batch: {e}", flush=True)
    finally:
        conn.close()
    return total_purged


# --- Other Queries ---

def get_statistics():
    """Mengambil agregasi statistik seluruh migrasi."""
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT 
            COUNT(*) as total_items,
            SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as total_success,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as total_failed,
            SUM(file_size) as total_bytes
        FROM tasks
    ''')
    stats = dict(cursor.fetchone())
    
    cursor.execute('SELECT COUNT(*) as total_jobs FROM jobs')
    stats['total_jobs'] = cursor.fetchone()['total_jobs']
    
    conn.close()
    return stats

# --- Note: Profile & Automation queries are omitted for brevity if unchanged, but they should remain.
# I will keep them below.
def get_profiles():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM migration_profiles ORDER BY name ASC')
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_profile(name, config_json):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO migration_profiles (name, config_json)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET config_json=excluded.config_json
    ''', (name, config_json))
    conn.commit()
    conn.close()

def delete_profile(profile_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM migration_profiles WHERE id = ?', (profile_id,))
    conn.commit()
    conn.close()

# --- Automation Jobs Queries ---

def create_automation_job(name, profile_id, session_name, source, target, cron, is_realtime, config_json):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO automation_jobs (name, profile_id, session_name, source_entity_id, target_entity_id, cron_expression, is_realtime, config_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (name, profile_id, session_name, source, target, cron, 1 if is_realtime else 0, config_json))
    conn.commit()
    job_id = cursor.lastrowid
    conn.close()
    return job_id

def get_automation_jobs():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM automation_jobs ORDER BY created_at DESC')
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def update_automation_job_status(job_id, status):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE automation_jobs SET status = ? WHERE id = ?', (status, job_id))
    conn.commit()
    conn.close()

def delete_automation_job(job_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM automation_jobs WHERE id = ?', (job_id,))
    conn.commit()
    conn.close()

def update_automation_last_run(job_id, next_run=None):
    conn = get_connection()
    cursor = conn.cursor()
    if next_run:
        cursor.execute('UPDATE automation_jobs SET last_run_at = CURRENT_TIMESTAMP, next_run_at = ? WHERE id = ?', (next_run, job_id))
    else:
        cursor.execute('UPDATE automation_jobs SET last_run_at = CURRENT_TIMESTAMP WHERE id = ?', (job_id,))
    conn.commit()
    conn.close()

# --- Sessions Queries ---
def save_session(name, session_string, status='active'):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO sessions (name, session_string, status)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET session_string=excluded.session_string, status=excluded.status
    ''', (name, session_string, status))
    conn.commit()

def get_session(name):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT session_string, status FROM sessions WHERE name = ?', (name,))
    row = cursor.fetchone()
    if row:
        return {'session_string': row[0], 'status': row[1]}
    return None

def get_all_sessions():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT name, status FROM sessions')
    rows = cursor.fetchall()
    return [{'name': row[0], 'status': row[1]} for row in rows]

def delete_session(name):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM sessions WHERE name = ?', (name,))
    conn.commit()
