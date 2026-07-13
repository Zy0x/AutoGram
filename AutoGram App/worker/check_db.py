import sqlite3
import json

try:
    conn = sqlite3.connect('../database/telegram_migrator.db')
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = c.fetchall()
    print("Tables:", tables)
    
    for table in ['jobs', 'migration_jobs', 'executions']:
        try:
            c.execute(f"SELECT * FROM {table} ORDER BY id DESC LIMIT 1")
            row = c.fetchone()
            if row:
                col_names = [description[0] for description in c.description]
                print(f"\nTable {table}:")
                for name, val in zip(col_names, row):
                    print(f"  {name}: {val}")
        except Exception as e:
            pass
except Exception as e:
    print("Error:", e)
