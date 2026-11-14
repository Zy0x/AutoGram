#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
=============================================================================
 AutoGram Dedicated Smart Media Uploader (Topic: Donghua NSFW)
=============================================================================
 Target Destination : 'U8542241823/D-1003214112048/T8'
 Source Directory   : 'E:\Data\Upload\Dong'
 Batch Limit        : 500 media per execution
 Engine             : Local Telethon MTProto (Zero AI Token, 100% Local)
 Invariants         :
   1. Verified deletion immediately upon 100% confirmed Telegram upload
   2. Failed uploads remain untouched in the source folder
   3. Intelligent crash/restart recovery (Zero duplicate uploads)
   4. Live interactive progress & speed telemetry
   5. AutoGram settings parity: Album 10 items, Silent, Single caption collage
=============================================================================
"""

import os
import sys
import time
import json
import sqlite3
import hashlib
import struct
import base64
import signal
import argparse
import asyncio
import ipaddress
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional

try:
    from telethon import TelegramClient, functions, types, utils
    from telethon.sessions import StringSession
    from telethon.errors import FloodWaitError, SlowModeWaitError
except ImportError:
    print("\n[ERROR] Modul 'telethon' belum terpasang.")
    print("Silakan jalankan: pip install telethon\n")
    sys.exit(1)

# =============================================================================
# DEFAULT CONFIGURATION (Matched with active AutoGram settings)
# =============================================================================
DEFAULT_SOURCE_DIR = r"E:\Data\Upload\Dong"
DEFAULT_TARGET_CHAT = -1003214112048  # #Gudang
DEFAULT_TOPIC_ID = 8                  # Donghua NSFW
DEFAULT_BATCH_LIMIT = 500             # 500 media per run
DEFAULT_ALBUM_SIZE = 10               # Telegram visual album limit
API_ID = 2040                         # Official Telegram Desktop API ID
API_HASH = "b18441a1ed607e10a39a6b584d3034f9"
ACCOUNT_USER_ID = 8542241823          # Lavender (@lv_drr)

SUPPORTED_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".mp4", ".mov", ".mkv", ".webm", ".avi"
)

# ANSI Color Codes
CLR_RESET  = "\033[0m"
CLR_BOLD   = "\033[1m"
CLR_RED    = "\033[91m"
CLR_GREEN  = "\033[92m"
CLR_YELLOW = "\033[93m"
CLR_BLUE   = "\033[94m"
CLR_CYAN   = "\033[96m"
CLR_WHITE  = "\033[97m"
CLR_BG_BLUE= "\033[44m"

# Global shutdown flag
g_shutdown_requested = False

def sigint_handler(signum, frame):
    global g_shutdown_requested
    if not g_shutdown_requested:
        print(f"\n{CLR_YELLOW}[WARN] Sinyal penghentian diterima (Ctrl+C). Menyelesaikan album yang sedang berjalan...{CLR_RESET}")
        g_shutdown_requested = True
    else:
        print(f"\n{CLR_RED}[WARN] Penghentian paksa.{CLR_RESET}")
        sys.exit(1)

signal.signal(signal.SIGINT, sigint_handler)

# =============================================================================
# SESSION RESOLUTION (Pure In-Memory StringSession from AutoGram)
# =============================================================================
def resolve_autogram_session(repo_root: Path) -> str:
    """
    Menemukan file session_1785668521.grammers.json dari AutoGram dan
    mengonversinya menjadi Telethon StringSession secara in-memory.
    """
    candidates = [
        repo_root / "AutoGram App" / "worker" / "sessions" / "session_1785668521.grammers.json",
        repo_root / "AutoGram App" / "worker" / "sessions" / "Lavender.grammers.json",
        Path(r"F:\AutoGram\AutoGram App\worker\sessions\session_1785668521.grammers.json"),
        Path(r"F:\AutoGram\AutoGram App\worker\sessions\Lavender.grammers.json"),
    ]
    
    session_file: Optional[Path] = None
    for c in candidates:
        if c.exists():
            session_file = c
            break
            
    if not session_file:
        raise FileNotFoundError(
            "Tidak dapat menemukan file sesi AutoGram (session_1785668521.grammers.json).\n"
            "Pastikan Anda telah login di AutoGram minimal satu kali."
        )
        
    with open(session_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    dc_id = data["homeDc"]
    ip_str = data["ipv4"]
    port = data["port"]
    auth_key = bytes.fromhex(data["authKeyHex"].strip())
    
    ip_packed = ipaddress.ip_address(ip_str).packed
    packed = struct.pack(f">B{len(ip_packed)}sH256s", dc_id, ip_packed, port, auth_key)
    return "1" + base64.urlsafe_b64encode(packed).decode("ascii")


# =============================================================================
# LOCAL LEDGER & DATABASE SYNC
# =============================================================================
class UploadLedger:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        self.conn.execute("PRAGMA journal_mode = WAL;")
        self.conn.execute("PRAGMA synchronous = NORMAL;")
        self._init_schema()

    def _init_schema(self):
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS upload_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL UNIQUE,
                    file_size INTEGER NOT NULL,
                    sha256 TEXT,
                    telegram_message_id INTEGER NOT NULL,
                    chat_id TEXT NOT NULL,
                    topic_id INTEGER NOT NULL,
                    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_ledger_fn ON upload_ledger(filename);")

    def is_already_uploaded(self, filename: str, file_size: int) -> Optional[int]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT telegram_message_id FROM upload_ledger WHERE filename = ? AND file_size = ?", (filename, file_size))
        row = cursor.fetchone()
        return row[0] if row else None

    def record_success(self, filename: str, file_size: int, sha256_hash: str, msg_id: int, chat_id: int, topic_id: int):
        with self.conn:
            self.conn.execute("""
                INSERT OR REPLACE INTO upload_ledger
                (filename, file_size, sha256, telegram_message_id, chat_id, topic_id, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (filename, file_size, sha256_hash, msg_id, str(chat_id), topic_id))

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass


def try_sync_to_autogram_db(repo_root: Path, filename: str, file_size: int, msg_id: int, chat_id: int, topic_id: int):
    """
    Sinkronisasi opsional ke database internal AutoGram (destination_scan_cache & duplicate_history).
    """
    db_candidates = [
        repo_root / "AutoGram App" / "frontend" / "src-tauri" / "database" / "telegram_migrator.db",
        repo_root / "AutoGram App" / "worker" / "database" / "telegram_migrator.db",
    ]
    for db_path in db_candidates:
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(str(db_path), timeout=5.0)
            with conn:
                now_ts = int(time.time() * 1000)
                # Sinkronkan ke destination_scan_cache jika ada
                conn.execute("""
                    INSERT OR IGNORE INTO destination_scan_cache
                    (target_entity_id, topic_id, file_name, file_size, media_type, fingerprint_tier, telegram_message_id, telegram_date)
                    VALUES (?, ?, ?, ?, 'image', 4, ?, ?)
                """, (str(chat_id), topic_id, filename, file_size, msg_id, now_ts))
            conn.close()
            break
        except Exception:
            pass  # Jangan biarkan kegagalan sinkronisasi internal AutoGram menghambat upload utama


# =============================================================================
# HELPER UTILITIES
# =============================================================================
def format_size(bytes_num: int) -> str:
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_num < 1024.0:
            return f"{bytes_num:.1f} {unit}"
        bytes_num /= 1024.0
    return f"{bytes_num:.2f} TB"

def calculate_sha256(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def partition_album_batches(files: List[Path], max_album_size: int = 10) -> List[List[Path]]:
    """
    Membagi file menjadi batch album visual (maksimal 10 file per album).
    Jika menyisakan 1 file di akhir, re-balance batch terakhir agar tidak ada foto tunggal canggung.
    """
    if not files:
        return []
    batches = []
    i = 0
    while i < len(files):
        remaining = len(files) - i
        if remaining == max_album_size + 1 and max_album_size > 2:
            # Misalnya tersisa 11: buat 6 dan 5 alih-alih 10 dan 1
            split_a = (remaining + 1) // 2
            batches.append(files[i : i + split_a])
            i += split_a
            batches.append(files[i : i + (remaining - split_a)])
            i += (remaining - split_a)
        else:
            chunk = files[i : i + max_album_size]
            batches.append(chunk)
            i += len(chunk)
    return batches


# =============================================================================
# MAIN SMART UPLOADER ENGINE
# =============================================================================
async def run_uploader(args):
    repo_root = Path(__file__).resolve().parent
    # Cari root workspace (folder tempat AutoGram App berada)
    curr = repo_root
    while curr != curr.parent:
        if (curr / "AutoGram App").exists():
            repo_root = curr
            break
        curr = curr.parent

    source_dir = Path(args.source)
    if not source_dir.exists():
        print(f"{CLR_RED}[ERROR] Folder source '{source_dir}' tidak ditemukan!{CLR_RESET}")
        return 1

    ledger_path = repo_root / "tools" / "upload_donghua" / "upload_ledger_donghua.sqlite"
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger = UploadLedger(ledger_path)

    # 1. Bersihkan sisa file yang sebelumnya sudah sukses di-upload (Crash recovery)
    print(f"\n{CLR_BOLD}{CLR_CYAN}========================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_WHITE} AutoGram Smart Media Uploader - Topic 'Donghua NSFW'{CLR_RESET}")
    print(f"{CLR_CYAN} Target Destination : {CLR_YELLOW}U{ACCOUNT_USER_ID}/D{args.chat}/T{args.topic}{CLR_RESET}")
    print(f"{CLR_CYAN} Source Directory   : {CLR_WHITE}{source_dir}{CLR_RESET}")
    print(f"{CLR_CYAN} Batch Limit        : {CLR_GREEN}{args.limit} media per running{CLR_RESET}")
    print(f"{CLR_CYAN} Album Invariant    : {CLR_WHITE}Max 10/album, Silent, Single-Caption Collage{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_CYAN}========================================================================{CLR_RESET}\n")

    # Ambil seluruh file yang valid
    all_raw_files = [
        source_dir / f for f in os.listdir(source_dir)
        if (source_dir / f).is_file() and f.lower().endswith(SUPPORTED_EXTENSIONS)
    ]
    # Urutkan secara natural/alphabetical
    all_raw_files.sort(key=lambda p: p.name)

    total_in_folder = len(all_raw_files)
    print(f"{CLR_BLUE}[SCAN]{CLR_RESET} Ditemukan total {CLR_BOLD}{total_in_folder}{CLR_RESET} file di folder source.")

    # Cek terhadap ledger jika ada file yang tertinggal padahal sudah berhasil dikirim
    clean_files: List[Path] = []
    recovered_count = 0
    for file_path in all_raw_files:
        try:
            size = file_path.stat().st_size
        except OSError:
            continue
        prev_msg_id = ledger.is_already_uploaded(file_path.name, size)
        if prev_msg_id:
            # File sudah ter-upload sebelumnya tapi belum sempat terhapus (misal crash/mati lampu)
            print(f"  {CLR_YELLOW}[RECOVERED]{CLR_RESET} File '{file_path.name}' sudah ada di Telegram (Msg ID: {prev_msg_id}). Menghapus duplikat lokal...")
            try:
                file_path.unlink(missing_ok=True)
                recovered_count += 1
            except Exception as e:
                print(f"    {CLR_RED}Gagal menghapus file yang pulih: {e}{CLR_RESET}")
        else:
            clean_files.append(file_path)

    if recovered_count > 0:
        print(f"{CLR_GREEN}[RECOVERY]{CLR_RESET} Berhasil membersihkan {recovered_count} file yang sudah ter-upload dari sesi sebelumnya.\n")

    if not clean_files:
        print(f"{CLR_GREEN}{CLR_BOLD}[SELESAI]{CLR_RESET} Tidak ada file baru yang perlu di-upload di '{source_dir}'. Semua beres!")
        ledger.close()
        return 0

    # Ambil maksimal sesuai batch limit (per 500 media saja)
    batch_files = clean_files[: args.limit]
    remaining_after_batch = len(clean_files) - len(batch_files)
    total_batch_bytes = sum(f.stat().st_size for f in batch_files)

    print(f"{CLR_CYAN}[TARGET BATCH]{CLR_RESET} Menyiapkan {CLR_BOLD}{len(batch_files)}{CLR_RESET} media ({format_size(total_batch_bytes)}) untuk sesi ini.")
    if remaining_after_batch > 0:
        print(f"{CLR_YELLOW}[INFO]{CLR_RESET} Sisa {remaining_after_batch} media lainnya akan diproses pada running berikutnya.")

    # 2. Inisialisasi Koneksi MTProto Telethon
    print(f"\n{CLR_BLUE}[AUTH]{CLR_RESET} Mengautentikasi sesi Telegram AutoGram...")
    session_str = resolve_autogram_session(repo_root)
    client = TelegramClient(StringSession(session_str), API_ID, API_HASH)

    await client.connect()
    if not await client.is_user_authorized():
        print(f"{CLR_RED}[ERROR] Sesi tidak terotorisasi! Silakan login ulang via AutoGram.{CLR_RESET}")
        await client.disconnect()
        ledger.close()
        return 1

    me = await client.get_me()
    print(f"  Terhubung sebagai: {CLR_GREEN}{me.first_name}{CLR_RESET} (@{me.username}) [ID: {me.id}]")

    target_entity = await client.get_entity(args.chat)
    entity_title = getattr(target_entity, 'title', str(args.chat))
    print(f"  Target Chat     : {CLR_GREEN}{entity_title}{CLR_RESET} (ID: {args.chat})")
    print(f"  Target Topik    : {CLR_GREEN}ID {args.topic}{CLR_RESET} (Donghua NSFW)")

    # 3. Bagi menjadi album-album (maksimal 10 media per album sesuai MTProto AutoGram)
    album_batches = partition_album_batches(batch_files, max_album_size=args.album_size)
    total_albums = len(album_batches)

    print(f"\n{CLR_GREEN}[START]{CLR_RESET} Memulai pengiriman {len(batch_files)} file dalam {total_albums} album visual...\n")

    uploaded_files_count = 0
    deleted_files_count = 0
    freed_bytes = 0
    start_time = time.time()

    for album_idx, album_files in enumerate(album_batches, start=1):
        if g_shutdown_requested:
            print(f"\n{CLR_YELLOW}[INTERRUPTED] Pengunggahan dihentikan secara aman oleh pengguna.{CLR_RESET}")
            break

        album_bytes = sum(f.stat().st_size for f in album_files)
        album_names = [f.name for f in album_files]
        file_paths_str = [str(f) for f in album_files]

        print(f"{CLR_BOLD}{CLR_CYAN}[ALBUM {album_idx:02d}/{total_albums:02d}]{CLR_RESET} Mengirim {len(album_files)} media ({format_size(album_bytes)})...")
        for f in album_files:
            print(f"  -> {CLR_WHITE}{f.name}{CLR_RESET} ({format_size(f.stat().st_size)})")

        if args.dry_run:
            print(f"  {CLR_YELLOW}[DRY-RUN]{CLR_RESET} Simulasi upload sukses. Melewati penghapusan fisik.")
            uploaded_files_count += len(album_files)
            continue

        # Upload dengan Safe Retry & FloodWait Protection
        success = False
        res_messages = None
        attempt = 0
        max_attempts = 4

        while attempt < max_attempts and not success and not g_shutdown_requested:
            attempt += 1
            try:
                # Live upload progress
                def upload_progress(current, total):
                    pct = (current / total) * 100 if total > 0 else 0
                    bar_len = 30
                    filled = int(bar_len * current / total) if total > 0 else 0
                    bar = "█" * filled + "░" * (bar_len - filled)
                    sys.stdout.write(f"\r  {CLR_BLUE}[UPLOADING]{CLR_RESET} [{bar}] {pct:5.1f}% | {format_size(int(current))}/{format_size(int(total))}")
                    sys.stdout.flush()

                # Parameter MTProto yang sinkron 1:1 dengan AutoGram:
                # - reply_to = args.topic (mengirim langsung ke topik forum)
                # - silent = True (tidak membunyikan notifikasi berisik ke anggota)
                # - force_document = False (native visual photo collage)
                res_messages = await client.send_file(
                    target_entity,
                    file_paths_str,
                    reply_to=args.topic,
                    silent=True,
                    force_document=False,
                    progress_callback=upload_progress
                )
                print()  # newline after progress

                # Verifikasi respons dari server Telegram
                if isinstance(res_messages, list) and len(res_messages) == len(album_files):
                    if all(m.id and m.id > 0 for m in res_messages):
                        success = True
                elif not isinstance(res_messages, list) and len(album_files) == 1 and res_messages.id > 0:
                    res_messages = [res_messages]
                    success = True

                if not success:
                    print(f"  {CLR_YELLOW}[WARN] Hasil pesan Telegram tidak lengkap (percobaan {attempt}/{max_attempts}). Mencoba ulang...{CLR_RESET}")
                    await asyncio.sleep(2)

            except FloodWaitError as e:
                print(f"\n  {CLR_YELLOW}[FLOOD WAIT] Telegram rate-limit. Menunggu {e.seconds} detik...{CLR_RESET}")
                wait_sec = e.seconds
                for s in range(wait_sec, 0, -1):
                    if g_shutdown_requested:
                        break
                    sys.stdout.write(f"\r  Melanjutkan dalam {s:02d} detik...")
                    sys.stdout.flush()
                    await asyncio.sleep(1)
                print()
            except SlowModeWaitError as e:
                print(f"\n  {CLR_YELLOW}[SLOW MODE] Slowmode aktif. Menunggu {e.seconds} detik...{CLR_RESET}")
                await asyncio.sleep(e.seconds)
            except Exception as e:
                print(f"\n  {CLR_RED}[ERROR] Gagal mengirim album (percobaan {attempt}/{max_attempts}): {e}{CLR_RESET}")
                if attempt < max_attempts:
                    await asyncio.sleep(3 * attempt)

        # 4. Verifikasi Mutlak & Penghapusan File Lokal
        if success and res_messages:
            msg_ids = [m.id for m in res_messages]
            id_range_str = f"{min(msg_ids)} - {max(msg_ids)}" if len(msg_ids) > 1 else f"{msg_ids[0]}"
            print(f"  {CLR_GREEN}[VERIFIED]{CLR_RESET} Telegram Server mengonfirmasi penerimaan: {len(msg_ids)} pesan (Msg IDs: {id_range_str})")

            # Catat ke ledger & hapus lokal
            album_deleted = 0
            for file_path, msg_obj in zip(album_files, res_messages):
                try:
                    f_size = file_path.stat().st_size
                    f_sha256 = calculate_sha256(file_path)

                    # 1. Catat ke persistent ledger lokal
                    ledger.record_success(file_path.name, f_size, f_sha256, msg_obj.id, args.chat, args.topic)

                    # 2. Sinkronkan ke SQLite AutoGram
                    try_sync_to_autogram_db(repo_root, file_path.name, f_size, msg_obj.id, args.chat, args.topic)

                    # 3. Hapus berkas lokal seketika
                    file_path.unlink()
                    if not file_path.exists():
                        album_deleted += 1
                        freed_bytes += f_size
                    else:
                        print(f"  {CLR_RED}[WARN] File {file_path.name} gagal dihapus dari disk!{CLR_RESET}")
                except Exception as del_err:
                    print(f"  {CLR_RED}[ERROR] Gagal memproses ledger/penghapusan {file_path.name}: {del_err}{CLR_RESET}")

            uploaded_files_count += len(album_files)
            deleted_files_count += album_deleted

            elapsed = time.time() - start_time
            speed = (freed_bytes / (1024 * 1024)) / elapsed if elapsed > 0 else 0
            pct_batch = (uploaded_files_count / len(batch_files)) * 100
            current_remaining_folder = total_in_folder - deleted_files_count - recovered_count

            print(f"  {CLR_GREEN}[CLEANUP]{CLR_RESET} Berhasil menghapus {album_deleted}/{len(album_files)} file dari disk lokal.")
            print(f"  {CLR_CYAN}[PROGRESS]{CLR_RESET} Batch: {uploaded_files_count}/{len(batch_files)} ({pct_batch:.1f}%) | Speed: {speed:.2f} MB/s | Total Dihapus: {format_size(freed_bytes)} | Sisa di Folder: {current_remaining_folder} file")
            print(f"{CLR_BLUE}------------------------------------------------------------------------{CLR_RESET}")

            # Jeda sopan antar-album agar aman dari spam filter Telegram
            await asyncio.sleep(1.8)

        else:
            # Jika album gagal secara keseluruhan, jangan hapus file! (Syarat 2)
            print(f"  {CLR_RED}[ALBUM FAILED]{CLR_RESET} Album {album_idx} gagal dikirim setelah {max_attempts} percobaan.")
            print(f"  {CLR_YELLOW}[SAFEGUARD]{CLR_RESET} Seluruh {len(album_files)} file tetap dipertahankan utuh di folder source.")
            
            # Coba fallback kirim satu per satu agar file yang valid tetap bisa terkirim
            print(f"  {CLR_CYAN}[FALLBACK]{CLR_RESET} Mengirim secara individu untuk menyelamatkan file yang valid...")
            for single_file in album_files:
                if g_shutdown_requested:
                    break
                try:
                    single_res = await client.send_file(
                        target_entity,
                        str(single_file),
                        reply_to=args.topic,
                        silent=True,
                        force_document=False
                    )
                    if single_res and single_res.id > 0:
                        f_sz = single_file.stat().st_size
                        f_sha = calculate_sha256(single_file)
                        ledger.record_success(single_file.name, f_sz, f_sha, single_res.id, args.chat, args.topic)
                        try_sync_to_autogram_db(repo_root, single_file.name, f_sz, single_res.id, args.chat, args.topic)
                        single_file.unlink()
                        uploaded_files_count += 1
                        deleted_files_count += 1
                        freed_bytes += f_sz
                        print(f"    {CLR_GREEN}[OK]{CLR_RESET} {single_file.name} -> Msg ID {single_res.id} (Dihapus)")
                        await asyncio.sleep(1.5)
                except Exception as s_err:
                    print(f"    {CLR_RED}[FAIL]{CLR_RESET} {single_file.name} tetap gagal ({s_err}) - Ditinggalkan di folder.")

    # 5. Selesai & Laporan Akhir
    total_elapsed = time.time() - start_time
    avg_speed = (freed_bytes / (1024 * 1024)) / total_elapsed if total_elapsed > 0 else 0
    remaining_final = len([
        f for f in os.listdir(source_dir)
        if (source_dir / f).is_file() and f.lower().endswith(SUPPORTED_EXTENSIONS)
    ])

    print(f"\n{CLR_BOLD}{CLR_GREEN}========================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_WHITE} RINGKASAN SESI PENGUNGGAHAN SELESAI{CLR_RESET}")
    print(f"{CLR_GREEN}========================================================================{CLR_RESET}")
    print(f"  * Total Media Terkirim & Terverifikasi : {CLR_BOLD}{uploaded_files_count}{CLR_RESET} file")
    print(f"  * Total File Fisik Dihapus Bersih     : {CLR_BOLD}{deleted_files_count}{CLR_RESET} file")
    print(f"  * Total Penyimpanan Dibebaskan         : {CLR_BOLD}{format_size(freed_bytes)}{CLR_RESET}")
    print(f"  * Waktu Eksekusi                       : {int(total_elapsed // 60)}m {int(total_elapsed % 60)}s ({avg_speed:.2f} MB/s)")
    print(f"  * Sisa Media di Folder Source          : {CLR_BOLD}{CLR_YELLOW}{remaining_final}{CLR_RESET} file")

    if remaining_final > 0:
        print(f"\n{CLR_CYAN}[INFO]{CLR_RESET} Masih terdapat {remaining_final} media tersisa di '{source_dir}'.")
        print(f"Jalankan kembali script ini untuk memproses batch 500 media berikutnya secara cerdas tanpa redundan.\n")
    else:
        print(f"\n{CLR_GREEN}[SUKSES TOTAL]{CLR_RESET} Seluruh file di '{source_dir}' telah 100% tuntas ter-upload dan dibersihkan!\n")

    await client.disconnect()
    ledger.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description="AutoGram Smart Media Uploader to Telegram Topic")
    parser.add_argument("--source", default=DEFAULT_SOURCE_DIR, help=f"Folder source media (default: {DEFAULT_SOURCE_DIR})")
    parser.add_argument("--chat", type=int, default=DEFAULT_TARGET_CHAT, help=f"Target Telegram Chat/Supergroup ID (default: {DEFAULT_TARGET_CHAT})")
    parser.add_argument("--topic", type=int, default=DEFAULT_TOPIC_ID, help=f"Target Topic ID (default: {DEFAULT_TOPIC_ID})")
    parser.add_argument("--limit", type=int, default=DEFAULT_BATCH_LIMIT, help=f"Maksimal media per running (default: {DEFAULT_BATCH_LIMIT})")
    parser.add_argument("--album-size", type=int, default=DEFAULT_ALBUM_SIZE, help=f"Banyak media per album visual (default: {DEFAULT_ALBUM_SIZE})")
    parser.add_argument("--dry-run", action="store_true", help="Simulasi tanpa benar-benar upload dan hapus file")

    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(run_uploader(args)))
    except KeyboardInterrupt:
        print("\n[CANCELLED] Dihentikan oleh pengguna.")
        sys.exit(0)

if __name__ == "__main__":
    main()
