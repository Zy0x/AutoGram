from database.db import get_connection

class DuplicateChecker:
    """
    Multi-level duplicate lookup for Fast Forward and file-based paths.

    Keys stored in duplicate_history.file_unique_id:
      - msgid:{source_entity}:{source_message_id}  (FF native — preferred)
      - {telegram_file_unique_id}
      - hash:{sha256}
      - name:{file_name}|{file_size}
    """

    def __init__(self, target_entity_id):
        self.target_entity_id = str(target_entity_id)

    def get_duplicate_message_id(self, file_unique_id=None, file_hash=None, file_name=None, file_size=None):
        """Return existing target_message_id if a match is found."""
        conn = get_connection()
        cursor = conn.cursor()

        try:
            # Level 0/1: message id key or Telegram unique file id
            if file_unique_id:
                cursor.execute('''
                    SELECT target_message_id FROM duplicate_history
                    WHERE file_unique_id = ? AND target_entity_id = ?
                ''', (str(file_unique_id), self.target_entity_id))
                row = cursor.fetchone()
                if row:
                    return row[0]

            # Level 2: SHA256
            if file_hash:
                cursor.execute('''
                    SELECT target_message_id FROM duplicate_history
                    WHERE file_unique_id = ? AND target_entity_id = ?
                ''', (f"hash:{file_hash}", self.target_entity_id))
                row = cursor.fetchone()
                if row:
                    return row[0]

            # Level 3: filename + size
            if file_name is not None and file_size is not None:
                key = f"name:{file_name}|{file_size}"
                cursor.execute('''
                    SELECT target_message_id FROM duplicate_history
                    WHERE file_unique_id = ? AND target_entity_id = ?
                ''', (key, self.target_entity_id))
                row = cursor.fetchone()
                if row:
                    return row[0]
        finally:
            conn.close()
        return None

    def get_duplicate_message_ids(self, keys):
        """Return `{duplicate_key: target_message_id}` using bounded IN queries."""
        unique_keys = list(dict.fromkeys(str(k) for k in keys if k is not None))
        if not unique_keys:
            return {}

        conn = get_connection()
        cursor = conn.cursor()
        found = {}
        try:
            # Keep well below SQLite's common 999-variable limit (one variable is
            # also used by target_entity_id).
            for start in range(0, len(unique_keys), 400):
                chunk = unique_keys[start:start + 400]
                placeholders = ','.join('?' for _ in chunk)
                cursor.execute(
                    f'''
                    SELECT file_unique_id, target_message_id
                    FROM duplicate_history
                    WHERE target_entity_id = ?
                      AND file_unique_id IN ({placeholders})
                    ''',
                    (self.target_entity_id, *chunk),
                )
                for key, target_message_id in cursor.fetchall():
                    found[str(key)] = target_message_id
        finally:
            conn.close()
        return found

    def log(self, file_unique_id, target_message_id, file_hash=None, file_name=None, file_size=None):
        from database.queries import log_duplicate
        if file_unique_id:
            log_duplicate(str(file_unique_id), self.target_entity_id, target_message_id)
        if file_hash:
            log_duplicate(f"hash:{file_hash}", self.target_entity_id, target_message_id)
        if file_name is not None and file_size is not None:
            log_duplicate(f"name:{file_name}|{file_size}", self.target_entity_id, target_message_id)

    @staticmethod
    def msgid_key(source_entity_id, source_message_id) -> str:
        return f"msgid:{source_entity_id}:{source_message_id}"
