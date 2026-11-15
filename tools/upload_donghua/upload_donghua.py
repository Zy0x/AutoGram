#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
=============================================================================
 AutoGram Dedicated Smart Media Uploader - Multi-Account Pool Edition
=============================================================================
 Target Destination : 'U8542241823/D-1003214112048/T8' (Topik: Donghua NSFW)
 Source Directory   : 'E:\Data\Upload\Dong'
 Batch Limit        : 500 media per execution
 Engine             : Local Telethon MTProto (Zero AI Token, 100% Local)
 Multi-Account Pool : Round-Robin Load Balancing + Instant Anti-FloodWait Failover
 Invariants         :
   1. Multi-Account active pooling: alternating uploads between accounts
   2. Instant failover on FloodWait: no pauses, switches account immediately
   3. Verified deletion immediately upon 100% confirmed Telegram upload
   4. Failed uploads remain untouched in the source folder
   5. Intelligent crash/restart recovery (Zero duplicate uploads)
   6. Live interactive progress & speed telemetry
   7. AutoGram settings parity: Album 10 items, Silent, Single caption collage
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

# Enforce immediate line buffering so live progress is never swallowed by stdout buffers
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

try:
    from telethon import TelegramClient, functions, types, utils
    from telethon.sessions import StringSession
    from telethon.errors import FloodWaitError, SlowModeWaitError
except ImportError:
    print("\n[ERROR] Modul 'telethon' belum terpasang.")
    print("Silakan jalankan: pip install telethon\n")
    sys.exit(1)

# =============================================================================
# DEFAULT CONFIGURATION
# =============================================================================
DEFAULT_SOURCE_DIR = r"E:\Data\Upload\Dong"
DEFAULT_TARGET_CHAT = -1003214112048  # #Gudang
DEFAULT_TOPIC_ID = 8                  # Donghua NSFW
DEFAULT_BATCH_LIMIT = 500             # 500 media per run
DEFAULT_ALBUM_SIZE = 10               # Telegram visual album limit
API_ID = 2040                         # Official Telegram Desktop API ID
API_HASH = "b18441a1ed607e10a39a6b584d3034f9"

SUPPORTED_EXTENSIONS = (
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".mp4", ".mov", ".mkv", ".webm", ".avi"
)

# ANSI Color Codes
CLR_RESET   = "\033[0m"
CLR_BOLD    = "\033[1m"
CLR_RED     = "\033[91m"
CLR_GREEN   = "\033[92m"
CLR_YELLOW  = "\033[93m"
CLR_BLUE    = "\033[94m"
CLR_MAGENTA = "\033[95m"
CLR_CYAN    = "\033[96m"
CLR_WHITE   = "\033[97m"

# Global shutdown flag
g_shutdown_requested = False

def sigint_handler(signum, frame):
    global g_shutdown_requested
    if not g_shutdown_requested:
        print(f"\n{CLR_YELLOW}[WARN] Sinyal penghentian diterima (Ctrl+C). Menyelesaikan proses berjalan secara aman...{CLR_RESET}")
        g_shutdown_requested = True
    else:
        print(f"\n{CLR_RED}[WARN] Penghentian paksa.{CLR_RESET}")
        sys.exit(1)

signal.signal(signal.SIGINT, sigint_handler)


# =============================================================================
# MULTI-ACCOUNT POOL MANAGER
# =============================================================================
class TelegramAccount:
    def __init__(self, key: str, label: str, client: TelegramClient, entity: Any, user_id: int, username: str, target_chat: int):
        self.key = key
        self.label = label
        self.client = client
        self.entity = entity
        self.user_id = user_id
        self.username = username
        self.target_chat = target_chat
        self.flood_until = 0.0
        self.uploaded_albums = 0
        self.uploaded_files = 0

    async def ensure_connected(self):
        if not self.client.is_connected():
            try:
                await self.client.connect()
            except Exception:
                pass
        if not self.entity:
            try:
                self.entity = await self.client.get_entity(self.target_chat)
            except Exception:
                pass

    def is_available(self) -> bool:
        return time.time() >= self.flood_until

    def cooldown_remaining(self) -> int:
        return max(0, int(self.flood_until - time.time()))

    def display_name(self) -> str:
        u = f" (@{self.username})" if self.username else ""
        return f"{self.label}{u} [ID: {self.user_id}]"


class MultiAccountPool:
    def __init__(self, accounts: List[TelegramAccount], strategy: str = "round_robin"):
        self.accounts = accounts
        self.strategy = strategy
        self.current_index = 0

    def get_account_for_album(self) -> Tuple[Optional[TelegramAccount], int]:
        """
        Mengambil akun yang siap untuk mengirim album.
        Mendukung rotasi Round-Robin dan Failover seketika jika ada akun yang cooldown.
        Jika seluruh akun cooldown, mengembalikan (None, detik_menunggu_terpendek).
        """
        n = len(self.accounts)
        if n == 0:
            return None, 0

        # Cek ketersediaan akun dengan rotasi Round-Robin
        for offset in range(n):
            idx = (self.current_index + offset) % n
            acc = self.accounts[idx]
            if acc.is_available():
                if self.strategy == "round_robin":
                    self.current_index = (idx + 1) % n
                return acc, 0

        # Seluruh akun sedang dalam FloodWait, cari cooldown terpendek
        min_cooldown = min(acc.cooldown_remaining() for acc in self.accounts)
        return None, min_cooldown

    def get_failover_account(self, failed_account: TelegramAccount) -> Optional[TelegramAccount]:
        """
        Mencari akun cadangan lain yang siap ketika akun saat ini terkena error/floodwait.
        """
        for acc in self.accounts:
            if acc.key != failed_account.key and acc.is_available():
                return acc
        return None

    async def disconnect_all(self):
        for acc in self.accounts:
            try:
                await acc.client.disconnect()
            except Exception:
                pass


def grammers_to_string_session(json_path: Path) -> str:
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    dc_id = data["homeDc"]
    ip_str = data["ipv4"]
    port = data["port"]
    auth_key = bytes.fromhex(data["authKeyHex"].strip())
    ip_packed = ipaddress.ip_address(ip_str).packed
    packed = struct.pack(f">B{len(ip_packed)}sH256s", dc_id, ip_packed, port, auth_key)
    return "1" + base64.urlsafe_b64encode(packed).decode("ascii")


async def build_account_pool(repo_root: Path, target_chat: int, filter_accounts: Optional[List[str]] = None) -> MultiAccountPool:
    sessions_dir = repo_root / "AutoGram App" / "worker" / "sessions"
    if not sessions_dir.exists():
        sessions_dir = Path(r"F:\AutoGram\AutoGram App\worker\sessions")

    # Cari seluruh session *.grammers.json
    all_session_files = list(sessions_dir.glob("*.grammers.json"))
    if not all_session_files:
        raise FileNotFoundError(f"Tidak ada file sesi .grammers.json ditemukan di {sessions_dir}")

    # Prioritaskan session_1785668521 dan tg_62881012533172 (sesuai pool aktif AutoGram)
    known_preferred = ["session_1785668521", "tg_62881012533172"]
    def sort_key(p: Path):
        base = p.name.replace(".grammers.json", "")
        if base in known_preferred:
            return (0, known_preferred.index(base))
        return (1, base)

    all_session_files.sort(key=sort_key)

    seen_auth_keys = set()
    accounts: List[TelegramAccount] = []

    print(f"{CLR_BLUE}[AUTH POOL]{CLR_RESET} Memeriksa dan menginisialisasi pool akun Telegram...")

    for sf in all_session_files:
        acc_key = sf.name.replace(".grammers.json", "")
        if filter_accounts and acc_key not in filter_accounts and sf.stem not in filter_accounts:
            continue

        try:
            with open(sf, "r", encoding="utf-8") as f:
                raw = json.load(f)
            auth_hex = raw.get("authKeyHex", "").strip()
            if not auth_hex or auth_hex in seen_auth_keys:
                continue
            seen_auth_keys.add(auth_hex)

            sess_str = grammers_to_string_session(sf)
            client = TelegramClient(StringSession(sess_str), API_ID, API_HASH)
            await client.connect()

            if not await client.is_user_authorized():
                # Lewati sesi expired
                await client.disconnect()
                continue

            me = await client.get_me()
            try:
                target_entity = await client.get_entity(target_chat)
            except Exception as ent_err:
                print(f"  {CLR_YELLOW}[WARN]{CLR_RESET} Akun {me.first_name} tidak dapat mengakses chat {target_chat}: {ent_err}")
                await client.disconnect()
                continue

            acc = TelegramAccount(
                key=acc_key,
                label=me.first_name or acc_key,
                client=client,
                entity=target_entity,
                user_id=me.id,
                username=me.username or "",
                target_chat=target_chat
            )
            accounts.append(acc)
            print(f"  ✔ {CLR_GREEN}[TERHUBUNG]{CLR_RESET} Akun #{len(accounts)}: {CLR_BOLD}{acc.display_name()}{CLR_RESET} (Key: {acc_key})")

        except Exception as e:
            print(f"  ✖ {CLR_RED}[GAGAL]{CLR_RESET} Sesi {sf.name}: {e}")

    if not accounts:
        raise RuntimeError("Gagal menginisialisasi akun Telegram apapun dari sesi yang tersedia!")

    print(f"\n{CLR_GREEN}[POOL SIAP]{CLR_RESET} Berhasil mengaktifkan {CLR_BOLD}{len(accounts)}{CLR_RESET} akun untuk rotasi multi-account.")
    return MultiAccountPool(accounts, strategy="round_robin")


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
                    account_name TEXT,
                    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_ledger_fn ON upload_ledger(filename);")
            cols = [col[1] for col in self.conn.execute("PRAGMA table_info(upload_ledger)").fetchall()]
            if "account_name" not in cols:
                self.conn.execute("ALTER TABLE upload_ledger ADD COLUMN account_name TEXT;")

    def is_already_uploaded(self, filename: str, file_size: int) -> Optional[int]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT telegram_message_id FROM upload_ledger WHERE filename = ? AND file_size = ?", (filename, file_size))
        row = cursor.fetchone()
        return row[0] if row else None

    def record_success(self, filename: str, file_size: int, sha256_hash: str, msg_id: int, chat_id: int, topic_id: int, account_name: str):
        with self.conn:
            self.conn.execute("""
                INSERT OR REPLACE INTO upload_ledger
                (filename, file_size, sha256, telegram_message_id, chat_id, topic_id, account_name, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (filename, file_size, sha256_hash, msg_id, str(chat_id), topic_id, account_name))

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass


def try_sync_to_autogram_db(repo_root: Path, filename: str, file_size: int, msg_id: int, chat_id: int, topic_id: int):
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
                conn.execute("""
                    INSERT OR IGNORE INTO destination_scan_cache
                    (target_entity_id, topic_id, file_name, file_size, media_type, fingerprint_tier, telegram_message_id, telegram_date)
                    VALUES (?, ?, ?, ?, 'image', 4, ?, ?)
                """, (str(chat_id), topic_id, filename, file_size, msg_id, now_ts))
            conn.close()
            break
        except Exception:
            pass


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
    if not files:
        return []
    batches = []
    i = 0
    while i < len(files):
        remaining = len(files) - i
        if remaining == max_album_size + 1 and max_album_size > 2:
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

    print(f"\n{CLR_BOLD}{CLR_CYAN}========================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_WHITE} AutoGram Multi-Account Smart Media Uploader - Topic 'Donghua NSFW'{CLR_RESET}")
    print(f"{CLR_CYAN} Target Destination : {CLR_YELLOW}D{args.chat}/T{args.topic}{CLR_RESET}")
    print(f"{CLR_CYAN} Source Directory   : {CLR_WHITE}{source_dir}{CLR_RESET}")
    print(f"{CLR_CYAN} Batch Limit        : {CLR_GREEN}{args.limit} media per running{CLR_RESET}")
    print(f"{CLR_CYAN} Multi-Account Mode : {CLR_MAGENTA}Round-Robin Load Balance + Instant Anti-FloodWait Failover{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_CYAN}========================================================================{CLR_RESET}\n")

    # 1. Bersihkan sisa file yang sebelumnya sudah sukses di-upload (Crash recovery)
    all_raw_files = [
        source_dir / f for f in os.listdir(source_dir)
        if (source_dir / f).is_file() and f.lower().endswith(SUPPORTED_EXTENSIONS)
    ]
    all_raw_files.sort(key=lambda p: p.name)

    total_in_folder = len(all_raw_files)
    print(f"{CLR_BLUE}[SCAN]{CLR_RESET} Ditemukan total {CLR_BOLD}{total_in_folder}{CLR_RESET} file di folder source.")

    clean_files: List[Path] = []
    recovered_count = 0
    for file_path in all_raw_files:
        try:
            size = file_path.stat().st_size
        except OSError:
            continue
        prev_msg_id = ledger.is_already_uploaded(file_path.name, size)
        if prev_msg_id:
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

    batch_files = clean_files[: args.limit]
    remaining_after_batch = len(clean_files) - len(batch_files)
    total_batch_bytes = sum(f.stat().st_size for f in batch_files)

    print(f"{CLR_CYAN}[TARGET BATCH]{CLR_RESET} Menyiapkan {CLR_BOLD}{len(batch_files)}{CLR_RESET} media ({format_size(total_batch_bytes)}) untuk sesi ini.")
    if remaining_after_batch > 0:
        print(f"{CLR_YELLOW}[INFO]{CLR_RESET} Sisa {remaining_after_batch} media lainnya akan diproses pada running berikutnya.\n")

    # 2. Inisialisasi Pool Multi-Account
    filter_list = [a.strip() for a in args.accounts.split(",") if a.strip()] if args.accounts else None
    pool = await build_account_pool(repo_root, args.chat, filter_accounts=filter_list)

    # 3. Bagi menjadi album-album
    album_batches = partition_album_batches(batch_files, max_album_size=args.album_size)
    total_albums = len(album_batches)

    print(f"\n{CLR_GREEN}[START]{CLR_RESET} Memulai pengiriman {len(batch_files)} file dalam {total_albums} album visual dengan rotasi multi-akun...\n")

    uploaded_files_count = 0
    deleted_files_count = 0
    freed_bytes = 0
    start_time = time.time()

    for album_idx, album_files in enumerate(album_batches, start=1):
        if g_shutdown_requested:
            print(f"\n{CLR_YELLOW}[INTERRUPTED] Pengunggahan dihentikan secara aman oleh pengguna.{CLR_RESET}")
            break

        album_bytes = sum(f.stat().st_size for f in album_files)
        file_paths_str = [str(f) for f in album_files]

        if args.dry_run:
            acc, _ = pool.get_account_for_album()
            acc_name = acc.display_name() if acc else "DryRun-Sim"
            print(f"{CLR_BOLD}{CLR_CYAN}[ALBUM {album_idx:02d}/{total_albums:02d}]{CLR_RESET} [{CLR_MAGENTA}Akun: {acc_name}{CLR_RESET}] Mengirim {len(album_files)} media ({format_size(album_bytes)})...")
            for f in album_files:
                print(f"  -> {CLR_WHITE}{f.name}{CLR_RESET} ({format_size(f.stat().st_size)})")
            print(f"  {CLR_YELLOW}[DRY-RUN]{CLR_RESET} Simulasi upload sukses.")
            uploaded_files_count += len(album_files)
            continue

        # Pilih akun dari pool (Round-Robin)
        account, wait_sec = pool.get_account_for_album()
        while not account and not g_shutdown_requested:
            print(f"\n{CLR_YELLOW}[ANTI-FLOODWAIT] Seluruh akun sedang dalam cooldown. Menunggu {wait_sec}s untuk akun pertama...{CLR_RESET}")
            for s in range(wait_sec, 0, -1):
                if g_shutdown_requested:
                    break
                sys.stdout.write(f"\r  Melanjutkan dalam {s:02d} detik...")
                sys.stdout.flush()
                await asyncio.sleep(1)
            print()
            account, wait_sec = pool.get_account_for_album()

        if g_shutdown_requested or not account:
            break

        print(f"{CLR_BOLD}{CLR_CYAN}[ALBUM {album_idx:02d}/{total_albums:02d}]{CLR_RESET} [{CLR_MAGENTA}Akun: {account.label} (@{account.username}){CLR_RESET}] Mengirim {len(album_files)} media ({format_size(album_bytes)})...")
        for f in album_files:
            print(f"  -> {CLR_WHITE}{f.name}{CLR_RESET} ({format_size(f.stat().st_size)})")

        success = False
        res_messages = None
        current_acc = account
        attempts = 0
        max_attempts = 4

        while attempts < max_attempts and not success and not g_shutdown_requested:
            attempts += 1
            try:
                def upload_progress(current, total):
                    pct = (current / total) * 100 if total > 0 else 0
                    bar_len = 26
                    filled = int(bar_len * current / total) if total > 0 else 0
                    bar = "█" * filled + "░" * (bar_len - filled)
                    sys.stdout.write(f"\r  {CLR_BLUE}[{current_acc.label}]{CLR_RESET} [{bar}] {pct:5.1f}% | {format_size(int(current))}/{format_size(int(total))}")
                    sys.stdout.flush()

                await current_acc.ensure_connected()
                res_messages = await current_acc.client.send_file(
                    current_acc.entity,
                    file_paths_str,
                    reply_to=args.topic,
                    silent=True,
                    force_document=False,
                    progress_callback=upload_progress
                )
                print()  # newline

                if isinstance(res_messages, list) and len(res_messages) == len(album_files):
                    if all(m.id and m.id > 0 for m in res_messages):
                        success = True
                elif not isinstance(res_messages, list) and len(album_files) == 1 and res_messages.id > 0:
                    res_messages = [res_messages]
                    success = True

                if not success:
                    print(f"  {CLR_YELLOW}[WARN] Hasil verifikasi pesan Telegram belum lengkap. Mencoba ulang...{CLR_RESET}")
                    await asyncio.sleep(2)

            except FloodWaitError as e:
                current_acc.flood_until = time.time() + e.seconds
                print(f"\n  {CLR_YELLOW}[ANTI-FLOODWAIT] Akun '{current_acc.label}' terkena limit {e.seconds}s.{CLR_RESET}")
                
                # FAILOVER SEKETIKA KE AKUN LAIN TANPA JEDA
                failover_acc = pool.get_failover_account(current_acc)
                if failover_acc:
                    print(f"  {CLR_GREEN}[FAILOVER SEKETIKA]{CLR_RESET} Langsung beralih ke {CLR_BOLD}{failover_acc.display_name()}{CLR_RESET} tanpa jeda!")
                    current_acc = failover_acc
                    attempts -= 1  # Jangan kurangi jatah attempt jika murni failover
                    await asyncio.sleep(0.5)
                else:
                    print(f"  {CLR_YELLOW}[INFO] Tidak ada akun cadangan lain yang bebas floodwait. Menunggu {e.seconds}s...{CLR_RESET}")
                    for s in range(e.seconds, 0, -1):
                        if g_shutdown_requested:
                            break
                        sys.stdout.write(f"\r  Cooldown {current_acc.label}: {s:02d}s tersisa...")
                        sys.stdout.flush()
                        await asyncio.sleep(1)
                    print()

            except SlowModeWaitError as e:
                print(f"\n  {CLR_YELLOW}[SLOW MODE] Menunggu {e.seconds} detik...{CLR_RESET}")
                await asyncio.sleep(e.seconds)

            except Exception as e:
                print(f"\n  {CLR_RED}[ERROR] Gagal mengirim via {current_acc.label}: {e}{CLR_RESET}")
                # Coba failover ke akun lain
                failover_acc = pool.get_failover_account(current_acc)
                if failover_acc:
                    print(f"  {CLR_YELLOW}[FAILOVER] Mencoba beralih ke akun {failover_acc.label}...{CLR_RESET}")
                    current_acc = failover_acc
                await asyncio.sleep(2)

        # 4. Verifikasi & Hapus File
        if success and res_messages:
            msg_ids = [m.id for m in res_messages]
            id_range_str = f"{min(msg_ids)} - {max(msg_ids)}" if len(msg_ids) > 1 else f"{msg_ids[0]}"
            print(f"  {CLR_GREEN}[VERIFIED]{CLR_RESET} Telegram Server ({current_acc.label}) mengonfirmasi {len(msg_ids)} pesan (Msg IDs: {id_range_str})")

            album_deleted = 0
            for file_path, msg_obj in zip(album_files, res_messages):
                try:
                    f_size = file_path.stat().st_size
                    f_sha256 = calculate_sha256(file_path)

                    ledger.record_success(
                        file_path.name, f_size, f_sha256, msg_obj.id, args.chat, args.topic, current_acc.label
                    )
                    try_sync_to_autogram_db(repo_root, file_path.name, f_size, msg_obj.id, args.chat, args.topic)

                    file_path.unlink()
                    if not file_path.exists():
                        album_deleted += 1
                        freed_bytes += f_size
                except Exception as del_err:
                    print(f"  {CLR_RED}[ERROR] Gagal menghapus {file_path.name}: {del_err}{CLR_RESET}")

            uploaded_files_count += len(album_files)
            deleted_files_count += album_deleted
            current_acc.uploaded_albums += 1
            current_acc.uploaded_files += len(album_files)

            elapsed = time.time() - start_time
            speed = (freed_bytes / (1024 * 1024)) / elapsed if elapsed > 0 else 0
            pct_batch = (uploaded_files_count / len(batch_files)) * 100
            current_remaining_folder = total_in_folder - deleted_files_count - recovered_count

            print(f"  {CLR_GREEN}[CLEANUP]{CLR_RESET} Dihapus {album_deleted}/{len(album_files)} berkas dari disk.")
            print(f"  {CLR_CYAN}[PROGRESS]{CLR_RESET} Batch: {uploaded_files_count}/{len(batch_files)} ({pct_batch:.1f}%) | Speed: {speed:.2f} MB/s | Total Dihapus: {format_size(freed_bytes)} | Sisa di Folder: {current_remaining_folder} file")
            print(f"{CLR_BLUE}------------------------------------------------------------------------{CLR_RESET}")

            # Jeda antar-album kecil (rotasi akun sudah membagi beban 50%)
            await asyncio.sleep(1.2)

        else:
            print(f"  {CLR_RED}[ALBUM FAILED]{CLR_RESET} Album {album_idx} gagal dikirim setelah percobaan.")
            print(f"  {CLR_YELLOW}[SAFEGUARD]{CLR_RESET} File tetap aman di folder source.")
            
            # Fallback kirim per-file
            print(f"  {CLR_CYAN}[FALLBACK]{CLR_RESET} Mencoba kirim per-file secara individual...")
            for single_file in album_files:
                if g_shutdown_requested:
                    break
                # Ambil akun yang siap
                single_acc, _ = pool.get_account_for_album()
                if not single_acc:
                    break
                try:
                    await single_acc.ensure_connected()
                    s_res = await single_acc.client.send_file(
                        single_acc.entity,
                        str(single_file),
                        reply_to=args.topic,
                        silent=True,
                        force_document=False
                    )
                    if s_res and s_res.id > 0:
                        f_sz = single_file.stat().st_size
                        f_sha = calculate_sha256(single_file)
                        ledger.record_success(single_file.name, f_sz, f_sha, s_res.id, args.chat, args.topic, single_acc.label)
                        try_sync_to_autogram_db(repo_root, single_file.name, f_sz, s_res.id, args.chat, args.topic)
                        single_file.unlink()
                        uploaded_files_count += 1
                        deleted_files_count += 1
                        freed_bytes += f_sz
                        single_acc.uploaded_files += 1
                        print(f"    {CLR_GREEN}[OK]{CLR_RESET} [{single_acc.label}] {single_file.name} -> Msg ID {s_res.id} (Dihapus)")
                        await asyncio.sleep(1.0)
                except Exception as s_err:
                    print(f"    {CLR_RED}[FAIL]{CLR_RESET} {single_file.name} gagal ({s_err}) - Tersisa di folder.")

    # 5. Selesai & Laporan Akhir
    total_elapsed = time.time() - start_time
    avg_speed = (freed_bytes / (1024 * 1024)) / total_elapsed if total_elapsed > 0 else 0
    remaining_final = len([
        f for f in os.listdir(source_dir)
        if (source_dir / f).is_file() and f.lower().endswith(SUPPORTED_EXTENSIONS)
    ])

    print(f"\n{CLR_BOLD}{CLR_GREEN}========================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_WHITE} RINGKASAN SESI PENGUNGGAHAN MULTI-ACCOUNT SELESAI{CLR_RESET}")
    print(f"{CLR_GREEN}========================================================================{CLR_RESET}")
    print(f"  * Total Media Terkirim & Terverifikasi : {CLR_BOLD}{uploaded_files_count}{CLR_RESET} file")
    print(f"  * Total File Fisik Dihapus Bersih     : {CLR_BOLD}{deleted_files_count}{CLR_RESET} file")
    print(f"  * Total Penyimpanan Dibebaskan         : {CLR_BOLD}{format_size(freed_bytes)}{CLR_RESET}")
    print(f"  * Waktu Eksekusi                       : {int(total_elapsed // 60)}m {int(total_elapsed % 60)}s ({avg_speed:.2f} MB/s)")
    print(f"  * Kontribusi Pool Akun:")
    for acc in pool.accounts:
        print(f"      - {acc.label} (@{acc.username}): {acc.uploaded_albums} album ({acc.uploaded_files} file)")
    print(f"  * Sisa Media di Folder Source          : {CLR_BOLD}{CLR_YELLOW}{remaining_final}{CLR_RESET} file")

    if remaining_final > 0:
        print(f"\n{CLR_CYAN}[INFO]{CLR_RESET} Masih terdapat {remaining_final} media tersisa di '{source_dir}'.")
        print(f"Jalankan kembali script ini untuk memproses batch 500 media berikutnya secara cerdas tanpa redundan.\n")
    else:
        print(f"\n{CLR_GREEN}[SUKSES TOTAL]{CLR_RESET} Seluruh file di '{source_dir}' telah 100% tuntas ter-upload dan dibersihkan!\n")

    await pool.disconnect_all()
    ledger.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description="AutoGram Multi-Account Smart Media Uploader to Telegram Topic")
    parser.add_argument("--source", default=DEFAULT_SOURCE_DIR, help=f"Folder source media (default: {DEFAULT_SOURCE_DIR})")
    parser.add_argument("--chat", type=int, default=DEFAULT_TARGET_CHAT, help=f"Target Telegram Chat/Supergroup ID (default: {DEFAULT_TARGET_CHAT})")
    parser.add_argument("--topic", type=int, default=DEFAULT_TOPIC_ID, help=f"Target Topic ID (default: {DEFAULT_TOPIC_ID})")
    parser.add_argument("--limit", type=int, default=DEFAULT_BATCH_LIMIT, help=f"Maksimal media per running (default: {DEFAULT_BATCH_LIMIT})")
    parser.add_argument("--album-size", type=int, default=DEFAULT_ALBUM_SIZE, help=f"Banyak media per album visual (default: {DEFAULT_ALBUM_SIZE})")
    parser.add_argument("--accounts", default="", help="Pilih akun tertentu dipisahkan koma (default: seluruh akun aktif)")
    parser.add_argument("--strategy", default="round_robin", choices=["round_robin", "failover_only"], help="Strategi multi-akun (default: round_robin)")
    parser.add_argument("--dry-run", action="store_true", help="Simulasi tanpa benar-benar upload dan hapus file")

    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(run_uploader(args)))
    except KeyboardInterrupt:
        print("\n[CANCELLED] Dihentikan oleh pengguna.")
        sys.exit(0)

if __name__ == "__main__":
    main()
