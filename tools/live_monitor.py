#!/usr/bin/env python3
"""
AutoGram Live Transfer Monitor (Terminal Dashboard)
100% Local - 0 LLM Tokens - Realtime SQLite Tracking
"""

import os
import sys
import time
import sqlite3
from datetime import datetime

# Path constants
DB_PATH = r"F:\AutoGram\AutoGram App\frontend\src-tauri\database\telegram_migrator.db"
SOURCE_DIR = r"D:\Upload\Donghua NSFW"
TARGET_TOPIC_ID = 8
TARGET_DEST_LABEL = "#Gudang -> Topic Donghua NSFW (ID: 8)"

# ANSI Color Codes
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

def get_disk_files_count():
    try:
        if os.path.exists(SOURCE_DIR):
            return sum(1 for entry in os.scandir(SOURCE_DIR) if entry.is_file())
    except Exception:
        pass
    return 17268

def render_bar(percent, width=30):
    filled = int(round(width * (percent / 100.0)))
    filled = max(0, min(width, filled))
    bar = "█" * filled + "░" * (width - filled)
    return bar

def format_size(bytes_val):
    if bytes_val < 1024:
        return f"{bytes_val} B"
    elif bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    else:
        return f"{bytes_val / (1024 * 1024):.2f} MB"

def main():
    # Enable ANSI escape sequences on Windows
    os.system("")
    
    print(f"{CYAN}Memulai AutoGram Live Transfer Monitor...{RESET}")
    total_disk = get_disk_files_count()

    prev_count = None
    prev_time = time.time()
    rate_history = []
    last_change_time = time.time()

    while True:
        try:
            conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=2.0)
            cur = conn.cursor()

            # 1. Topic 8 ledger metrics
            cur.execute("SELECT COUNT(*), MAX(telegram_message_id) FROM upload_ledger WHERE topic_id = ?", (TARGET_TOPIC_ID,))
            total_ledger, max_msg_id = cur.fetchone()
            total_ledger = total_ledger or 0
            max_msg_id = max_msg_id or 0

            # 2. Distinct uploaded files in Topic 8
            cur.execute("SELECT COUNT(DISTINCT filename || ':' || file_size) FROM upload_ledger WHERE topic_id = ?", (TARGET_TOPIC_ID,))
            distinct_uploaded = cur.fetchone()[0] or 0

            # 3. Active run and items
            cur.execute("SELECT transfer_id, state, updated_at FROM transfer_runs ORDER BY rowid DESC LIMIT 1")
            run_row = cur.fetchone()
            active_run_id = run_row[0] if run_row else "None"
            active_run_state = run_row[1] if run_row else "IDLE"

            cur.execute("SELECT state, count(*) FROM transfer_items_v4 WHERE transfer_id = ? GROUP BY state", (active_run_id,))
            state_counts = dict(cur.fetchall())
            done_items = state_counts.get("DONE", 0)
            skipped_items = state_counts.get("SKIPPED", 0)
            prepared_items = state_counts.get("PREPARED", 0)

            # 4. Recent uploads
            cur.execute("""
                SELECT telegram_message_id, filename, file_size, 
                       datetime(created_at/1000, 'unixepoch', 'localtime')
                FROM upload_ledger 
                WHERE topic_id = ? 
                ORDER BY telegram_message_id DESC 
                LIMIT 8
            """, (TARGET_TOPIC_ID,))
            recent_rows = cur.fetchall()

            conn.close()

            # Rate calculation
            now = time.time()
            if prev_count is not None:
                delta_items = total_ledger - prev_count
                delta_time = now - prev_time
                if delta_items > 0:
                    last_change_time = now
                    items_per_min = (delta_items / delta_time) * 60.0
                    rate_history.append(items_per_min)
                    if len(rate_history) > 5:
                        rate_history.pop(0)

            prev_count = total_ledger
            prev_time = now

            avg_rate = (sum(rate_history) / len(rate_history)) if rate_history else 0.0
            idle_seconds = int(now - last_change_time)

            # Determine human-friendly kloter label
            kloter_display = active_run_id
            if "chunk_10" in active_run_id:
                kloter_display = "Kloter 10 / 12"
            elif "chunk_11" in active_run_id:
                kloter_display = "Kloter 11 / 12"
            elif "chunk_12" in active_run_id:
                kloter_display = "Kloter 12 / 12"
            elif "chunk_" in active_run_id:
                kloter_display = active_run_id.split("_")[-1]

            # Progress metrics
            remaining_disk = max(0, total_disk - distinct_uploaded)
            overall_pct = (distinct_uploaded / total_disk * 100.0) if total_disk > 0 else 0.0
            progress_bar = render_bar(overall_pct, 28)

            # Clear screen and draw
            os.system("cls" if os.name == "nt" else "clear")
            clock_str = datetime.now().strftime("%H:%M:%S")

            print(f"{BOLD}{CYAN}╔═══════════════════════════════════════════════════════════════════════════════════════╗{RESET}")
            print(f"{BOLD}{CYAN}║                    ⚡ AUTOGRAM LIVE TRANSFER MONITOR (LOCAL 0-TOKEN)                  ║{RESET}")
            print(f"{BOLD}{CYAN}╚═══════════════════════════════════════════════════════════════════════════════════════╝{RESET}")
            print(f"{DIM}Waktu Lokal : {clock_str}  |  Refresh: 2 detik  |  Tekan Ctrl+C untuk keluar{RESET}")
            print(f"{DIM}Sumber      : {SOURCE_DIR}{RESET}")
            print(f"{DIM}Tujuan      : {TARGET_DEST_LABEL}{RESET}")
            print(f"{CYAN}{'─'*87}{RESET}")

            # Status pill
            if idle_seconds > 20:
                status_pill = f"{YELLOW}{BOLD}[ COOLDOWN / FLOODWAIT ({idle_seconds}s) ]{RESET}"
            else:
                status_pill = f"{GREEN}{BOLD}[ AKTIF MENGUNGGAH ]{RESET}"

            print(f"Status Transfer : {status_pill}   |   Kloter Aktif : {MAGENTA}{BOLD}{kloter_display}{RESET} ({active_run_state})")
            print(f"Rincian Kloter  : {GREEN}{done_items} Berhasil{RESET}  |  {YELLOW}{skipped_items} Dilewati (Duplikat){RESET}  |  {CYAN}{prepared_items} Sedang Siap{RESET}")
            print(f"Laju Kecepatan  : {BOLD}{avg_rate:4.1f} file/menit{RESET}   |   Pesan Telegram Terakhir : {BOLD}#{max_msg_id}{RESET}")
            print(f"{CYAN}{'─'*87}{RESET}")

            # Progress bar display
            print(f"{BOLD}Progres Total   : {GREEN}[{progress_bar}] {overall_pct:5.2f}%{RESET}")
            print(f"Statistik File  : {GREEN}{distinct_uploaded:,} Terunggah{RESET} / {total_disk:,} Total  |  Sisa: {RED}{BOLD}{remaining_disk:,} Berkas{RESET}")
            print(f"Total Ledger    : {CYAN}{total_ledger:,} Transaksi di Topic 8{RESET}")
            print(f"{CYAN}{'═'*87}{RESET}")

            # Recent uploaded files table
            print(f"{BOLD}{CYAN}TABEL MEDIA TERAKHIR DITERIMA DI TELEGRAM :{RESET}")
            print(f"{DIM}{'ID Pesan':<10} | {'Nama Berkas':<36} | {'Ukuran':<11} | {'Waktu Diterima':<19}{RESET}")
            print(f"{DIM}{'-'*10}-+-{'-'*36}-+-{'-'*11}-+-{'-'*19}{RESET}")

            for row in recent_rows:
                msg_id = f"#{row[0]}"
                fname = row[1]
                if len(fname) > 34:
                    fname = fname[:31] + "..."
                fsize = format_size(row[2])
                ftime = row[3] if row[3] else "-"
                print(f"{GREEN}{msg_id:<10}{RESET} | {fname:<36} | {fsize:<11} | {ftime:<19}")

            print(f"{CYAN}{'─'*87}{RESET}")
            print(f"{DIM}Memantau langsung dari SQLite WAL... Hemat 100% token LLM.{RESET}")

        except sqlite3.OperationalError as e:
            # Database busy retry gracefully
            time.sleep(1.0)
            continue
        except KeyboardInterrupt:
            print(f"\n{YELLOW}Pemantau lokal dihentikan.{RESET}")
            sys.exit(0)
        except Exception as e:
            print(f"\n{RED}Error pemantauan: {e}{RESET}")

        time.sleep(2.0)

if __name__ == "__main__":
    main()
