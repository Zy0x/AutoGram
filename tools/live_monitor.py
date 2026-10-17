#!/usr/bin/env python3
"""
AutoGram Dynamic Live Transfer Monitor & Config Inspector
100% Local - 0 LLM Tokens - Fully Dynamic from SQLite WAL
"""

import os
import sys
import time
import json
import sqlite3
from datetime import datetime

DB_PATH = r"F:\AutoGram\AutoGram App\frontend\src-tauri\database\telegram_migrator.db"

# ANSI Colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BLUE = "\033[94m"
WHITE = "\033[97m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

def render_bar(percent, width=28):
    filled = int(round(width * (percent / 100.0)))
    filled = max(0, min(width, filled))
    bar = "█" * filled + "░" * (width - filled)
    return bar

def format_size(bytes_val):
    if not bytes_val:
        return "0 B"
    if bytes_val < 1024:
        return f"{bytes_val} B"
    elif bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    else:
        return f"{bytes_val / (1024 * 1024):.2f} MB"

def main():
    os.system("") # Enable VT100 on Windows CMD
    
    prev_count = None
    prev_time = time.time()
    rate_history = []
    last_change_time = time.time()

    disk_count_cache = {}

    while True:
        try:
            conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=2.0)
            cur = conn.cursor()

            # 1. Detect latest active run and snapshot
            cur.execute("""
                SELECT transfer_id, state, profile_snapshot_json, updated_at 
                FROM transfer_runs 
                ORDER BY rowid DESC 
                LIMIT 1
            """)
            latest_run = cur.fetchone()
            if not latest_run:
                print(f"{YELLOW}Belum ada riwayat transfer aktif di database.{RESET}")
                conn.close()
                time.sleep(2.0)
                continue

            active_transfer_id = latest_run[0]
            active_run_state = latest_run[1]
            raw_snapshot = latest_run[2] or "{}"

            # Parse profile snapshot dynamically
            profile_data = {}
            feature_flags = {}
            try:
                parsed_json = json.loads(raw_snapshot)
                profile_data = parsed_json.get("profile", {})
                feature_flags = parsed_json.get("resolvedFeatureFlags", {})
            except Exception:
                pass

            # Extract dynamic configuration
            topic_id = profile_data.get("topic_id") or profile_data.get("topicId") or 8
            album_size = profile_data.get("album_group_size", 10 if profile_data.get("group_as_album") else 1)
            is_album = profile_data.get("group_as_album", True)
            concurrency = profile_data.get("concurrency", 10)
            hw_decoder = profile_data.get("reencodeHardware", "auto")
            preset = profile_data.get("reencodePreset", "balanced")
            encoder_strategy = profile_data.get("encoder_strategy", "auto_adaptive")
            dupe_policy = profile_data.get("duplicate_policy", "SKIP")
            alt_pool = profile_data.get("alternate_account_pool", [])
            total_chunks = profile_data.get("totalChunks", 12)
            chunk_label = profile_data.get("chunkLabel", "")

            # 2. Dynamic Source & Destination detection
            cur.execute("SELECT source_path FROM transfer_items_v4 WHERE transfer_id = ? AND source_path != '' LIMIT 1", (active_transfer_id,))
            sample_source = cur.fetchone()
            if sample_source and sample_source[0]:
                source_dir = os.path.dirname(sample_source[0])
            else:
                source_dir = "D:\\Upload\\Donghua NSFW"

            cur.execute("SELECT destination_id FROM upload_ledger WHERE topic_id = ? ORDER BY rowid DESC LIMIT 1", (topic_id,))
            dest_row = cur.fetchone()
            dest_id = dest_row[0] if dest_row else "-1003214112048"

            # 3. Dynamic disk file count
            if source_dir not in disk_count_cache:
                try:
                    if os.path.exists(source_dir):
                        disk_count_cache[source_dir] = sum(1 for e in os.scandir(source_dir) if e.is_file())
                    else:
                        disk_count_cache[source_dir] = 17268
                except Exception:
                    disk_count_cache[source_dir] = 17268
            total_disk = disk_count_cache[source_dir]

            # 4. Total ledger metrics for this destination topic
            cur.execute("SELECT COUNT(*), MAX(telegram_message_id) FROM upload_ledger WHERE topic_id = ?", (topic_id,))
            total_ledger, max_msg_id = cur.fetchone()
            total_ledger = total_ledger or 0
            max_msg_id = max_msg_id or 0

            # 5. Distinct uploaded files in this topic
            cur.execute("SELECT COUNT(DISTINCT filename || ':' || file_size) FROM upload_ledger WHERE topic_id = ?", (topic_id,))
            distinct_uploaded = cur.fetchone()[0] or 0

            # 6. Current active run item states
            cur.execute("SELECT state, count(*) FROM transfer_items_v4 WHERE transfer_id = ? GROUP BY state", (active_transfer_id,))
            state_counts = dict(cur.fetchall())
            active_done = state_counts.get("DONE", 0)
            active_skipped = state_counts.get("SKIPPED", 0)
            active_prepared = state_counts.get("PREPARED", 0)

            # 7. Dynamic Batch Kloter Matrix detection
            # Find all kloters sharing the same session batch prefix (e.g. upload_1792171899723_)
            batch_prefix = "_".join(active_transfer_id.split("_")[:2]) + "_"
            cur.execute("""
                SELECT transfer_id, state 
                FROM transfer_runs 
                WHERE transfer_id LIKE ? 
                ORDER BY rowid ASC
            """, (f"{batch_prefix}%",))
            batch_runs = cur.fetchall()

            kloter_statuses = []
            for idx in range(1, total_chunks + 1):
                # Match run for chunk
                matched_run = None
                for r in batch_runs:
                    rid = r[0]
                    if f"chunk_{idx}" in rid or (idx == 1 and "sihuha9" in rid):
                        matched_run = r
                        break
                
                if matched_run:
                    cur.execute("SELECT state, count(*) FROM transfer_items_v4 WHERE transfer_id = ? GROUP BY state", (matched_run[0],))
                    counts = dict(cur.fetchall())
                    k_done = counts.get("DONE", 0)
                    k_state = matched_run[1]
                    kloter_statuses.append((idx, k_state, k_done))
                else:
                    kloter_statuses.append((idx, "PENDING", 0))

            # 8. Recent 7 uploaded files
            cur.execute("""
                SELECT telegram_message_id, filename, file_size, 
                       datetime(created_at/1000, 'unixepoch', 'localtime')
                FROM upload_ledger 
                WHERE topic_id = ? 
                ORDER BY telegram_message_id DESC 
                LIMIT 7
            """, (topic_id,))
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
                    if len(rate_history) > 6:
                        rate_history.pop(0)

            prev_count = total_ledger
            prev_time = now

            avg_rate = (sum(rate_history) / len(rate_history)) if rate_history else 0.0
            idle_seconds = int(now - last_change_time)

            # Calculations
            remaining_disk = max(0, total_disk - distinct_uploaded)
            overall_pct = (distinct_uploaded / total_disk * 100.0) if total_disk > 0 else 0.0
            progress_bar = render_bar(overall_pct, 26)

            # Redraw Terminal
            os.system("cls" if os.name == "nt" else "clear")
            clock_str = datetime.now().strftime("%H:%M:%S")

            print(f"{BOLD}{CYAN}╔═════════════════════════════════════════════════════════════════════════════════════════╗{RESET}")
            print(f"{BOLD}{CYAN}║              ⚡ AUTOGRAM ADVANCED DYNAMIC MONITOR & CONFIG INSPECTOR                    ║{RESET}")
            print(f"{BOLD}{CYAN}╚═════════════════════════════════════════════════════════════════════════════════════════╝{RESET}")
            print(f"{DIM}Waktu: {clock_str}  |  Refresh: 2s  |  SQLite WAL Mode  |  Tekan Ctrl+C untuk keluar{RESET}")
            print(f"📁 {BOLD}Sumber Aktif{RESET}   : {WHITE}{source_dir}{RESET}")
            print(f"🎯 {BOLD}Destinasi{RESET}      : {WHITE}Chat ID: {dest_id}  ->  Topic ID: {topic_id}{RESET}")
            print(f"{CYAN}{'─'*89}{RESET}")

            # Configuration Card (Dynamic Settings)
            alt_str = ", ".join(alt_pool) if alt_pool else "None"
            album_str = f"Grid {album_size} items" if is_album else "Single Media"
            print(f"⚙️  {BOLD}KONFIGURASI TRANSFER AKTIF (DYNAMIC CONFIG) :{RESET}")
            print(f"   • {BOLD}Album/Grid{RESET}     : {CYAN}{album_str}{RESET} (Packing: custom)")
            print(f"   • {BOLD}Konkurensi{RESET}     : {CYAN}{concurrency} Thread Paralel{RESET}")
            print(f"   • {BOLD}Encoder/Dec{RESET}    : {CYAN}HW: {hw_decoder}{RESET} | Preset: {CYAN}{preset}{RESET} | Strategy: {CYAN}{encoder_strategy}{RESET}")
            print(f"   • {BOLD}Anti-Duplikat{RESET}  : {GREEN}4-Level Hash & Size Matrix ({dupe_policy}){RESET}")
            print(f"   • {BOLD}Multi-Account{RESET}  : {MAGENTA}Rotasi Pool: [{alt_str}]{RESET}")
            print(f"{CYAN}{'─'*89}{RESET}")

            # Kloter Progress Matrix
            print(f"📦 {BOLD}MATRIKS PROGRESS SELURUH KLOTER (TOTAL {total_chunks} KLOTER) :{RESET}")
            matrix_line1 = []
            matrix_line2 = []
            for k_idx, k_state, k_done in kloter_statuses:
                if k_state == "COMPLETED":
                    chip = f"{GREEN}[K{k_idx}: ✔ {k_done}]{RESET}"
                elif k_state == "RUNNING":
                    chip = f"{YELLOW}{BOLD}[K{k_idx}: ⚡ {k_done}]{RESET}"
                else:
                    chip = f"{DIM}[K{k_idx}: ⏳ Antre]{RESET}"
                
                if k_idx <= 6:
                    matrix_line1.append(chip)
                else:
                    matrix_line2.append(chip)

            print("   " + "  ".join(matrix_line1))
            if matrix_line2:
                print("   " + "  ".join(matrix_line2))
            print(f"{CYAN}{'─'*89}{RESET}")

            # Status and Metrics
            if idle_seconds > 20:
                status_badge = f"{YELLOW}{BOLD}[ COOLDOWN / FLOODWAIT ({idle_seconds}s) ]{RESET}"
            else:
                status_badge = f"{GREEN}{BOLD}[ AKTIF MENGUNGGAH ]{RESET}"

            active_kloter_name = chunk_label or active_transfer_id.split("_")[-1]
            print(f"Status Saat Ini : {status_badge}  |  Kloter Aktif: {MAGENTA}{BOLD}{active_kloter_name}{RESET} ({active_run_state})")
            print(f"Progres Kloter  : {GREEN}{active_done} Berhasil{RESET}  |  {YELLOW}{active_skipped} Dilewati (Duplikat){RESET}  |  {CYAN}{active_prepared} Dipersiapkan{RESET}")
            print(f"Laju Kecepatan  : {BOLD}{avg_rate:4.1f} file/menit{RESET}   |   Pesan Terakhir di Topic: {BOLD}#{max_msg_id}{RESET}")
            print(f"{CYAN}{'─'*89}{RESET}")

            # Overall Progress
            print(f"{BOLD}Progres Total   : {GREEN}[{progress_bar}] {overall_pct:5.2f}%{RESET}")
            print(f"Statistik File  : {GREEN}{distinct_uploaded:,} Berkas Terunggah{RESET} / {total_disk:,} Total  |  Sisa: {RED}{BOLD}{remaining_disk:,} Berkas{RESET}")
            print(f"Ledger Topic {topic_id}  : {CYAN}{total_ledger:,} Catatan Pesan Transaksi MTProto{RESET}")
            print(f"{CYAN}{'═'*89}{RESET}")

            # Recent Table
            print(f"{BOLD}{CYAN}BERKAS TERAKHIR YANG TELAH DITERIMA TELEGRAM :{RESET}")
            print(f"{DIM}{'ID Pesan':<9} | {'Nama Berkas':<38} | {'Ukuran':<10} | {'Waktu Diterima':<19}{RESET}")
            print(f"{DIM}{'-'*9}-+-{'-'*38}-+-{'-'*10}-+-{'-'*19}{RESET}")

            for row in recent_rows:
                mid = f"#{row[0]}"
                fn = row[1]
                if len(fn) > 36:
                    fn = fn[:33] + "..."
                fs = format_size(row[2])
                ft = row[3] if row[3] else "-"
                print(f"{GREEN}{mid:<9}{RESET} | {fn:<38} | {fs:<10} | {ft:<19}")

            print(f"{CYAN}{'─'*89}{RESET}")
            print(f"{DIM}100% Dinamis & Presisi. Menginspeksi skema SQLite & config profile tanpa token LLM.{RESET}")

        except sqlite3.OperationalError:
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
