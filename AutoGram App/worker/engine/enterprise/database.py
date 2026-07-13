import sqlite3
import json
from database.db import get_connection

def record_mapping(job_id, source_chat_id, source_msg_id, dest_chat_id, dest_msg_id, sequence_id, quality_mode, status, file_checksum=None, file_size=None, filename=None):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO message_mapping 
        (job_id, source_chat_id, source_msg_id, dest_chat_id, dest_msg_id, sequence_id, quality_mode, file_checksum, file_size, filename, status, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE NULL END)
        ON CONFLICT(source_chat_id, source_msg_id, job_id) DO UPDATE SET
            dest_msg_id=excluded.dest_msg_id,
            status=excluded.status,
            sequence_id=excluded.sequence_id,
            verified_at=CASE WHEN excluded.status = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE verified_at END
    ''', (job_id, source_chat_id, source_msg_id, dest_chat_id, dest_msg_id, sequence_id, quality_mode, file_checksum, file_size, filename, status, status))
    conn.commit()
    conn.close()

def delete_mapping_by_job(job_id: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM message_mapping WHERE job_id = ?', (job_id,))
    conn.commit()
    conn.close()

def get_mapping(job_id, source_chat_id, source_msg_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM message_mapping WHERE job_id = ? AND source_chat_id = ? AND source_msg_id = ?
    ''', (job_id, source_chat_id, source_msg_id))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_mapping_by_msg_id(job_id, source_msg_id):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM message_mapping WHERE job_id = ? AND source_msg_id = ?
    ''', (job_id, source_msg_id))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_last_verified_sequence(job_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT MAX(sequence_id) FROM message_mapping WHERE job_id = ? AND status = 'VERIFIED'
    ''', (job_id,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row and row[0] is not None else 0

def get_min_failed_msg_id(job_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT MIN(source_msg_id) FROM message_mapping WHERE job_id = ? AND status = 'FAILED'
    ''', (job_id,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row and row[0] is not None else None

def get_min_pending_msg_id(job_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT MIN(source_msg_id) FROM message_mapping WHERE job_id = ? AND status = 'PENDING'
    ''', (job_id,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row and row[0] is not None else None

def get_max_verified_msg_id(job_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT MAX(source_msg_id) FROM message_mapping WHERE job_id = ? AND status IN ('VERIFIED', 'COMMITTED')
    ''', (job_id,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row and row[0] is not None else 0

def get_stalled_in_progress(job_id, timeout_minutes=15):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM message_mapping 
        WHERE job_id = ? AND status = 'IN_PROGRESS' 
        AND last_updated < datetime('now', ?)
    ''', (job_id, f'-{timeout_minutes} minutes'))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def update_mapping_status(job_id, source_msg_id, status, error_message=None):
    conn = get_connection()
    cursor = conn.cursor()
    
    if error_message:
        cursor.execute('''
            UPDATE message_mapping 
            SET status = ?, error_message = ?, last_updated = CURRENT_TIMESTAMP, retry_count = retry_count + 1
            WHERE job_id = ? AND source_msg_id = ?
        ''', (status, error_message, job_id, source_msg_id))
    else:
        cursor.execute('''
            UPDATE message_mapping 
            SET status = ?, last_updated = CURRENT_TIMESTAMP,
                verified_at = CASE WHEN ? = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE verified_at END
            WHERE job_id = ? AND source_msg_id = ?
        ''', (status, status, job_id, source_msg_id))
    
    conn.commit()
    conn.close()
