from database.db import get_connection

class DuplicateChecker:
    """
    Duplicate Engine 4-Level.
    Bertugas mencegah file yang sama di-forward ke channel yang sama berkali-kali.
    """
    
    def __init__(self, target_entity_id):
        self.target_entity_id = target_entity_id

    def get_duplicate_message_id(self, file_unique_id=None, file_hash=None, file_name=None, file_size=None):
        """Mengecek apakah item sudah pernah ada di target dan mengembalikan target_message_id jika ada."""
        conn = get_connection()
        cursor = conn.cursor()
        
        # Level 2: Cek berdasarkan file_unique_id Telegram
        if file_unique_id:
            cursor.execute('''
                SELECT target_message_id FROM duplicate_history 
                WHERE file_unique_id = ? AND target_entity_id = ?
            ''', (file_unique_id, self.target_entity_id))
            row = cursor.fetchone()
            if row:
                conn.close()
                return row[0]
                
        # Level 3 & 4 (Hash / Name + Size) bisa diimplementasikan ke depannya
        # di tabel migration_items jika mode Clean Copy digunakan.
        
        conn.close()
        return None
