#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
=============================================================================
 AutoGram Supergroup-to-Channel Zero-Miss Migration Engine
=============================================================================
 Memindahkan/menyalin seluruh media dari setiap topik aktif di supergrup
 '#Gudang [TD]' (-1003214112048) ke Channel Privat terpisah per topik
 ('#Gudang - <Nama Topik>') secara 100% server-side Clean Copy
 (drop_author=True, tanpa download/upload ulang, urutan kronologis & kolase
 album 100% utuh).

 Invarian:
   1. Owner channel: Mantan (@mantangadis)
   2. Auto-invite & promote Admin penuh: Lavender (@lv_drr) & Thea (@ThuandMuda)
   3. Idempotent channel creation (tidak pernah membuat channel duplikat)
   4. Album-aware batching (grouped_id tidak pernah terpotong antar-batch)
   5. Multi-account sequential round-robin + instant anti-FloodWait failover
   6. SQLite checkpoint ledger (100% crash-resumable, 0 duplikat, 0 terlewat)
   7. Verifikasi akhir jumlah pesan sumber vs target untuk setiap channel
=============================================================================
"""

import os
import sys
import json
import time
import random
import signal
import sqlite3
import asyncio
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

from telethon import TelegramClient, functions, types
from telethon.errors import (
    FloodWaitError,
    SlowModeWaitError,
    UserPrivacyRestrictedError,
    UserAlreadyParticipantError,
    MessageIdInvalidError,
)

# Reuse auth pool & constants from upload_donghua.py
sys.path.insert(0, str(Path(__file__).resolve().parent))
from upload_donghua import (
    build_account_pool,
    DEFAULT_TARGET_CHAT,
    CLR_RESET, CLR_BOLD, CLR_RED, CLR_GREEN, CLR_YELLOW, CLR_BLUE, CLR_MAGENTA, CLR_CYAN, CLR_WHITE,
)

OWNER_ACCOUNT_ID = 8420671507      # Mantan (@mantangadis)
INVITE_ADMIN_USERNAMES = ["lv_drr", "ThuandMuda"]
INVITE_ADMIN_IDS = [8542241823, 862678085]  # Lavender & Thea

g_shutdown = False

def sigint_handler(signum, frame):
    global g_shutdown
    if not g_shutdown:
        print(f"\n{CLR_YELLOW}[WARN] Ctrl+C diterima. Menyelesaikan batch aktif sebelum berhenti dengan aman...{CLR_RESET}")
        g_shutdown = True
    else:
        sys.exit(1)

signal.signal(signal.SIGINT, sigint_handler)


# =============================================================================
# SQLITE MIGRATION LEDGER (CHECKPOINT & ZERO-MISS TRACKER)
# =============================================================================
class MigrationLedger:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.conn = sqlite3.connect(str(db_path), timeout=30.0)
        self.conn.execute("PRAGMA journal_mode = WAL;")
        self.conn.execute("PRAGMA synchronous = NORMAL;")
        self._init_schema()

    def _init_schema(self):
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS channel_map (
                    source_chat_id TEXT NOT NULL,
                    source_topic_id INTEGER NOT NULL,
                    topic_title TEXT NOT NULL,
                    target_channel_id INTEGER NOT NULL,
                    target_channel_title TEXT NOT NULL,
                    invite_link TEXT,
                    source_total INTEGER DEFAULT 0,
                    copied_total INTEGER DEFAULT 0,
                    skipped_service INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    PRIMARY KEY (source_chat_id, source_topic_id)
                );
            """)
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS copied_messages (
                    source_chat_id TEXT NOT NULL,
                    source_topic_id INTEGER NOT NULL,
                    source_msg_id INTEGER NOT NULL,
                    target_channel_id INTEGER NOT NULL,
                    target_msg_id INTEGER,
                    grouped_id INTEGER,
                    copied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (source_chat_id, source_topic_id, source_msg_id)
                );
            """)
            self.conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_cm_topic
                ON copied_messages(source_chat_id, source_topic_id);
            """)

    def get_channel_map(self, source_chat_id: int, topic_id: int) -> Optional[Dict[str, Any]]:
        cur = self.conn.cursor()
        cur.execute("""
            SELECT source_topic_id, topic_title, target_channel_id, target_channel_title,
                   invite_link, source_total, copied_total, skipped_service, status
            FROM channel_map
            WHERE source_chat_id = ? AND source_topic_id = ?
        """, (str(source_chat_id), topic_id))
        row = cur.fetchone()
        if not row:
            return None
        return {
            "source_topic_id": row[0],
            "topic_title": row[1],
            "target_channel_id": row[2],
            "target_channel_title": row[3],
            "invite_link": row[4],
            "source_total": row[5],
            "copied_total": row[6],
            "skipped_service": row[7],
            "status": row[8],
        }

    def upsert_channel_map(
        self, source_chat_id: int, topic_id: int, topic_title: str,
        target_channel_id: int, target_channel_title: str, invite_link: str = ""
    ):
        with self.conn:
            self.conn.execute("""
                INSERT INTO channel_map (
                    source_chat_id, source_topic_id, topic_title,
                    target_channel_id, target_channel_title, invite_link, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'in_progress')
                ON CONFLICT(source_chat_id, source_topic_id) DO UPDATE SET
                    target_channel_id = excluded.target_channel_id,
                    target_channel_title = excluded.target_channel_title,
                    invite_link = COALESCE(NULLIF(excluded.invite_link, ''), channel_map.invite_link)
            """, (str(source_chat_id), topic_id, topic_title, target_channel_id, target_channel_title, invite_link))

    def get_copied_ids(self, source_chat_id: int, topic_id: int) -> set:
        cur = self.conn.cursor()
        cur.execute("""
            SELECT source_msg_id FROM copied_messages
            WHERE source_chat_id = ? AND source_topic_id = ?
        """, (str(source_chat_id), topic_id))
        return {r[0] for r in cur.fetchall()}

    def record_copied_batch(
        self, source_chat_id: int, topic_id: int, target_channel_id: int,
        items: List[Tuple[int, Optional[int], Optional[int]]]
    ):
        """items: list of (source_msg_id, target_msg_id, grouped_id)"""
        with self.conn:
            self.conn.executemany("""
                INSERT OR REPLACE INTO copied_messages (
                    source_chat_id, source_topic_id, source_msg_id,
                    target_channel_id, target_msg_id, grouped_id
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, [
                (str(source_chat_id), topic_id, smid, target_channel_id, tmid, gid)
                for (smid, tmid, gid) in items
            ])

    def update_topic_progress(
        self, source_chat_id: int, topic_id: int,
        source_total: int, copied_total: int, skipped_service: int, status: str
    ):
        with self.conn:
            if status == "completed":
                self.conn.execute("""
                    UPDATE channel_map
                    SET source_total = ?, copied_total = ?, skipped_service = ?,
                        status = ?, completed_at = CURRENT_TIMESTAMP
                    WHERE source_chat_id = ? AND source_topic_id = ?
                """, (source_total, copied_total, skipped_service, status, str(source_chat_id), topic_id))
            else:
                self.conn.execute("""
                    UPDATE channel_map
                    SET source_total = ?, copied_total = ?, skipped_service = ?, status = ?
                    WHERE source_chat_id = ? AND source_topic_id = ?
                """, (source_total, copied_total, skipped_service, status, str(source_chat_id), topic_id))

    def list_all_maps(self, source_chat_id: int) -> List[Dict[str, Any]]:
        cur = self.conn.cursor()
        cur.execute("""
            SELECT source_topic_id, topic_title, target_channel_id, target_channel_title,
                   invite_link, source_total, copied_total, skipped_service, status
            FROM channel_map
            WHERE source_chat_id = ?
            ORDER BY source_total ASC
        """, (str(source_chat_id),))
        out = []
        for row in cur.fetchall():
            out.append({
                "source_topic_id": row[0],
                "topic_title": row[1],
                "target_channel_id": row[2],
                "target_channel_title": row[3],
                "invite_link": row[4],
                "source_total": row[5],
                "copied_total": row[6],
                "skipped_service": row[7],
                "status": row[8],
            })
        return out

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass


# =============================================================================
# CHANNEL CREATION & ADMIN PROMOTION
# =============================================================================
FULL_ADMIN_RIGHTS = types.ChatAdminRights(
    change_info=True,
    post_messages=True,
    edit_messages=True,
    delete_messages=True,
    ban_users=True,
    invite_users=True,
    pin_messages=True,
    add_admins=True,
    anonymous=False,
    manage_call=True,
    other=True,
    manage_topics=True,
    post_stories=True,
    edit_stories=True,
    delete_stories=True,
)


async def ensure_target_channel(
    owner_client: TelegramClient,
    other_clients: List[TelegramClient],
    source_entity: Any,
    topic_id: int,
    topic_title: str,
    channel_title: str,
    ledger: MigrationLedger,
    source_chat_id: int,
) -> Tuple[int, Any, Dict[int, Any], str]:
    """
    Memastikan Channel Privat '#Gudang - <Nama Topik>' tersedia (idempotent),
    mengundang Lavender & Thea sebagai Admin penuh, dan mengembalikan entity channel
    untuk seluruh klien di pool.
    """
    existing = ledger.get_channel_map(source_chat_id, topic_id)
    target_entity = None
    invite_link = existing["invite_link"] if existing else ""

    if existing:
        try:
            target_entity = await owner_client.get_entity(existing["target_channel_id"])
            print(f"  {CLR_GREEN}[REUSE]{CLR_RESET} Channel '{channel_title}' sudah tercatat (ID: {existing['target_channel_id']})")
        except Exception as e:
            print(f"  {CLR_YELLOW}[WARN]{CLR_RESET} Entity ledger gagal di-resolve ({e}), mencari di dialog...")

    if target_entity is None:
        # Cek di dialog owner apakah channel dengan judul persis sudah ada
        async for dlg in owner_client.iter_dialogs():
            if dlg.is_channel and not getattr(dlg.entity, "megagroup", False):
                if dlg.name == channel_title:
                    target_entity = dlg.entity
                    print(f"  {CLR_GREEN}[FOUND]{CLR_RESET} Channel '{channel_title}' sudah ada di Telegram (ID: -100{target_entity.id})")
                    break

    if target_entity is None:
        print(f"  {CLR_CYAN}[CREATE]{CLR_RESET} Membuat Channel Privat baru: '{channel_title}'...")
        res = await owner_client(functions.channels.CreateChannelRequest(
            title=channel_title,
            about=f"Arsip permanen kategori {topic_title} (migrasi dari #Gudang [TD] Topik ID {topic_id})",
            broadcast=True,
            megagroup=False,
        ))
        target_entity = res.chats[0]
        full_id = int(f"-100{target_entity.id}")
        print(f"  ✔ {CLR_GREEN}[CREATED]{CLR_RESET} Channel '{channel_title}' berhasil dibuat (ID: {full_id})")
        await asyncio.sleep(1.5)

    full_channel_id = int(f"-100{target_entity.id}")

    # Jika channel sudah tercatat di ledger (reuse), tidak perlu ulangi invite/promote admin
    need_admin_setup = (existing is None)

    # Export invite link agar bisa dipakai jika akun lain perlu join
    if not invite_link:
        try:
            inv = await owner_client(functions.messages.ExportChatInviteRequest(peer=target_entity))
            invite_link = getattr(inv, "link", "")
        except Exception:
            pass

    if need_admin_setup:
        # Resolusi user Lavender & Thea dari peserta #Gudang [TD] agar access_hash pasti valid
        admin_targets = []
        try:
            participants = await owner_client.get_participants(source_entity)
            for p in participants:
                if p.id in INVITE_ADMIN_IDS:
                    admin_targets.append(p)
        except Exception:
            pass

        # Fallback by username
        if len(admin_targets) < len(INVITE_ADMIN_IDS):
            known_ids = {u.id for u in admin_targets}
            for uname in INVITE_ADMIN_USERNAMES:
                try:
                    u = await owner_client.get_entity(uname)
                    if u.id not in known_ids:
                        admin_targets.append(u)
                        known_ids.add(u.id)
                except Exception as e:
                    print(f"  {CLR_YELLOW}[WARN]{CLR_RESET} Gagal resolve @{uname}: {e}")

        # Invite & Promote Admin penuh untuk Lavender & Thea
        for user_ent in admin_targets:
            label = f"{user_ent.first_name} (@{user_ent.username})"
            try:
                await owner_client(functions.channels.EditAdminRequest(
                    channel=target_entity,
                    user_id=user_ent,
                    admin_rights=FULL_ADMIN_RIGHTS,
                    rank="Admin",
                ))
                print(f"  ✔ {CLR_GREEN}[ADMIN]{CLR_RESET} {label} dipromosikan sebagai Admin penuh di '{channel_title}'")
                await asyncio.sleep(0.5)
            except Exception as e:
                print(f"  {CLR_YELLOW}[WARN]{CLR_RESET} Promote admin {label}: {e}")

    ledger.upsert_channel_map(
        source_chat_id, topic_id, topic_title,
        full_channel_id, channel_title, invite_link
    )

    # Resolusi entity channel untuk semua akun lain di pool (misal Lavender)
    client_entities: Dict[int, Any] = {OWNER_ACCOUNT_ID: target_entity}
    for oc in other_clients:
        me = await oc.get_me()
        ent = None
        try:
            ent = await oc.get_entity(full_channel_id)
        except Exception:
            # Join via invite link jika belum masuk dialog
            if invite_link and "+" in invite_link:
                inv_hash = invite_link.split("+")[-1].strip()
                try:
                    await oc(functions.messages.ImportChatInviteRequest(hash=inv_hash))
                    await asyncio.sleep(0.8)
                    ent = await oc.get_entity(full_channel_id)
                except Exception as je:
                    print(f"  {CLR_YELLOW}[WARN]{CLR_RESET} Akun {me.first_name} gagal join via link: {je}")
            if ent is None:
                # Refresh dialogs once
                async for dlg in oc.iter_dialogs(limit=50):
                    if dlg.id == full_channel_id:
                        ent = dlg.entity
                        break
        if ent is not None:
            # Pastikan admin sudah aktif jika baru join via link
            if not getattr(ent, "admin_rights", None):
                try:
                    u_ent = await owner_client.get_entity(me.id)
                    await owner_client(functions.channels.EditAdminRequest(
                        channel=target_entity,
                        user_id=u_ent,
                        admin_rights=FULL_ADMIN_RIGHTS,
                        rank="Admin",
                    ))
                    await asyncio.sleep(0.5)
                    ent = await oc.get_entity(full_channel_id)
                except Exception:
                    pass
            client_entities[me.id] = ent

    return full_channel_id, target_entity, client_entities, invite_link


# =============================================================================
# TOPIC MESSAGE ENUMERATOR & ALBUM-SAFE BATCHER
# =============================================================================
async def fetch_all_topic_messages(
    client: TelegramClient,
    source_entity: Any,
    topic_id: int,
    topic_title: str,
) -> Tuple[List[Tuple[int, Optional[int]]], int]:
    """
    Mengambil SELURUH pesan dalam satu topik menggunakan GetRepliesRequest secara penuh,
    mengembalikan daftar (msg_id, grouped_id) dalam urutan KRONOLOGIS (tertua -> terbaru),
    serta jumlah MessageService yang dilewati.
    """
    raw_items: List[Tuple[int, Optional[int]]] = []
    skipped_service = 0
    offset_id = 0
    page = 0

    while True:
        page += 1
        try:
            res = await client(functions.messages.GetRepliesRequest(
                peer=source_entity,
                msg_id=topic_id,
                offset_id=offset_id,
                offset_date=None,
                add_offset=0,
                limit=100,
                max_id=0,
                min_id=0,
                hash=0,
            ))
        except FloodWaitError as fw:
            wait_s = fw.seconds + 2
            print(f"  {CLR_YELLOW}[FLOODWAIT SCAN]{CLR_RESET} Menunggu {wait_s}s saat scan topik '{topic_title}'...")
            await asyncio.sleep(wait_s)
            continue

        msgs = res.messages
        if not msgs:
            break

        for m in msgs:
            if isinstance(m, types.MessageService) or isinstance(m, types.MessageEmpty):
                skipped_service += 1
                continue
            raw_items.append((m.id, getattr(m, "grouped_id", None)))

        min_id_in_page = min(m.id for m in msgs)
        if min_id_in_page == offset_id or len(msgs) < 100:
            break
        offset_id = min_id_in_page

        if page % 25 == 0:
            print(f"  {CLR_BLUE}[SCAN]{CLR_RESET} Topik '{topic_title}': {len(raw_items)} pesan terindeks sejauh ini...")
        await asyncio.sleep(0.15)

    # Deduplikasi & urutkan KRONOLOGIS ASCENDING (tertua -> terbaru)
    unique_map = {}
    for mid, gid in raw_items:
        unique_map[mid] = gid
    ordered = sorted(unique_map.items(), key=lambda x: x[0])
    return ordered, skipped_service


def build_album_safe_batches(
    items: List[Tuple[int, Optional[int]]],
    max_batch_size: int = 100,
) -> List[List[Tuple[int, Optional[int]]]]:
    """
    Memecah daftar (msg_id, grouped_id) menjadi batch maksimal `max_batch_size` (<= 100)
    TANPA PERNAH memotong album kolase (grouped_id yang sama selalu berada dalam 1 batch).
    """
    # 1. Kelompokkan pesan berurutan yang memiliki grouped_id sama menjadi unit atomik
    units: List[List[Tuple[int, Optional[int]]]] = []
    i = 0
    n = len(items)
    while i < n:
        mid, gid = items[i]
        if gid is not None:
            group = [(mid, gid)]
            j = i + 1
            while j < n and items[j][1] == gid:
                group.append(items[j])
                j += 1
            units.append(group)
            i = j
        else:
            units.append([(mid, None)])
            i += 1

    # 2. Gabungkan unit atomik ke dalam batch <= max_batch_size
    batches: List[List[Tuple[int, Optional[int]]]] = []
    current: List[Tuple[int, Optional[int]]] = []
    for unit in units:
        if current and len(current) + len(unit) > max_batch_size:
            batches.append(current)
            current = []
        current.extend(unit)
    if current:
        batches.append(current)

    return batches


def extract_forwarded_msg_ids(updates_obj: Any, expected_count: int) -> List[Optional[int]]:
    """Ekstrak daftar target message ID yang dihasilkan dari ForwardMessagesRequest."""
    found: List[int] = []
    updates = getattr(updates_obj, "updates", None)
    if updates:
        for u in updates:
            msg = getattr(u, "message", None)
            if msg is not None and hasattr(msg, "id"):
                found.append(msg.id)
            elif hasattr(u, "id") and isinstance(u, types.UpdateMessageID):
                found.append(u.id)
    found = sorted(set(found))
    if len(found) == expected_count:
        return found
    # Pad/trim safely if server omits some update wrappers
    return [found[i] if i < len(found) else None for i in range(expected_count)]


# =============================================================================
# MAIN MIGRATION ORCHESTRATOR
# =============================================================================
async def run_migration(args):
    repo_root = Path(__file__).resolve().parent.parent.parent
    ledger_path = repo_root / "tools" / "upload_donghua" / "migration_ledger_gudang.sqlite"
    registry_path = repo_root / "tools" / "upload_donghua" / "channel_registry.json"
    ledger = MigrationLedger(ledger_path)

    pool = await build_account_pool(repo_root, args.source_chat)

    # Identifikasi akun Owner (Mantan) & akun lain (Lavender)
    owner_acc = next((a for a in pool.accounts if a.user_id == OWNER_ACCOUNT_ID), None)
    if not owner_acc:
        print(f"{CLR_RED}[ERROR] Akun Owner Mantan (ID {OWNER_ACCOUNT_ID}) tidak ditemukan di pool!{CLR_RESET}")
        await pool.disconnect_all()
        ledger.close()
        return 1

    other_accs = [a for a in pool.accounts if a.user_id != OWNER_ACCOUNT_ID]

    # Ambil daftar seluruh topik aktif di #Gudang [TD]
    topics_res = await owner_acc.client(functions.messages.GetForumTopicsRequest(
        peer=owner_acc.entity, offset_date=None, offset_id=0, offset_topic=0, limit=100
    ))

    topic_list = []
    for t in topics_res.topics:
        t_title = getattr(t, "title", f"Topic {t.id}")
        if args.topics and t.id not in args.topics:
            continue
        # Hitung estimasi jumlah pesan untuk mengurutkan dari terkecil -> terbesar
        try:
            r = await owner_acc.client(functions.messages.GetRepliesRequest(
                peer=owner_acc.entity, msg_id=t.id, offset_id=0, offset_date=None,
                add_offset=0, limit=1, max_id=0, min_id=0, hash=0
            ))
            est_count = getattr(r, "count", len(r.messages))
        except Exception:
            est_count = 0
        topic_list.append({
            "id": t.id,
            "title": t_title,
            "est_count": est_count,
            "channel_title": f"#Gudang - {t_title}",
        })

    # Urutkan dari topik paling sedikit -> paling banyak agar yang kecil langsung tuntas duluan
    topic_list.sort(key=lambda x: x["est_count"])

    print(f"\n{CLR_BOLD}{CLR_CYAN}================================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_WHITE} AUTOGRAM SERVER-SIDE CLEAN COPY MIGRATION (#Gudang [TD] -> Channel Privat){CLR_RESET}")
    print(f"{CLR_CYAN} Owner Channel : {CLR_GREEN}{owner_acc.display_name()}{CLR_RESET}")
    print(f"{CLR_CYAN} Auto-Admins   : {CLR_WHITE}Lavender (@lv_drr) & Thea (@ThuandMuda){CLR_RESET}")
    print(f"{CLR_CYAN} Total Topik   : {CLR_YELLOW}{len(topic_list)} topik ({sum(x['est_count'] for x in topic_list):,} pesan){CLR_RESET}")
    print(f"{CLR_CYAN} Mode Salin    : {CLR_GREEN}Server-Side Clean Copy (drop_author=True, 100% Album Utuh){CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_CYAN}================================================================================{CLR_RESET}\n")

    start_all = time.time()

    # FASE 1: Buat seluruh 8 Channel Privat & Promosikan Admin
    print(f"{CLR_BOLD}{CLR_MAGENTA}>>> FASE 1: PEMBUATAN CHANNEL PRIVAT & PROMOSI ADMIN <<<{CLR_RESET}")
    prepared_topics = []
    for idx, t in enumerate(topic_list, start=1):
        print(f"\n[{idx}/{len(topic_list)}] Menyiapkan channel untuk topik '{t['title']}' (ID: {t['id']}, ~{t['est_count']:,} pesan)...")
        ch_id, ch_ent, client_entities, inv_link = await ensure_target_channel(
            owner_client=owner_acc.client,
            other_clients=[a.client for a in other_accs],
            source_entity=owner_acc.entity,
            topic_id=t["id"],
            topic_title=t["title"],
            channel_title=t["channel_title"],
            ledger=ledger,
            source_chat_id=args.source_chat,
        )
        t["target_channel_id"] = ch_id
        t["client_entities"] = client_entities
        t["invite_link"] = inv_link
        prepared_topics.append(t)

    # Simpan registry JSON segera setelah semua channel terbentuk
    registry_data = {
        "source_chat_id": args.source_chat,
        "owner_id": OWNER_ACCOUNT_ID,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "channels": {
            t["title"]: {
                "source_topic_id": t["id"],
                "channel_id": t["target_channel_id"],
                "channel_title": t["channel_title"],
                "invite_link": t["invite_link"],
            }
            for t in prepared_topics
        },
    }
    with open(registry_path, "w", encoding="utf-8") as rf:
        json.dump(registry_data, rf, indent=2, ensure_ascii=False)
    print(f"\n✔ {CLR_GREEN}[REGISTRY]{CLR_RESET} Daftar channel tersimpan di '{registry_path.name}'.\n")

    if args.create_only:
        print(f"{CLR_GREEN}[SELESAI]{CLR_RESET} Mode --create-only selesai.")
        await pool.disconnect_all()
        ledger.close()
        return 0

    # FASE 2: Server-Side Clean Copy Per Topik (Kronologis + Album Utuh + Verifikasi)
    print(f"{CLR_BOLD}{CLR_MAGENTA}>>> FASE 2: SERVER-SIDE CLEAN COPY SEMUA MEDIA PER TOPIK <<<{CLR_RESET}")

    grand_copied = 0
    for idx, t in enumerate(prepared_topics, start=1):
        if g_shutdown:
            break

        topic_id = t["id"]
        topic_title = t["title"]
        ch_id = t["target_channel_id"]
        ch_title = t["channel_title"]
        client_entities = t["client_entities"]

        print(f"\n{CLR_BOLD}{CLR_CYAN}--------------------------------------------------------------------------------{CLR_RESET}")
        print(f"{CLR_BOLD}[TOPIK {idx}/{len(prepared_topics)}] '{topic_title}' (ID {topic_id}) -> '{ch_title}' ({ch_id}){CLR_RESET}")
        print(f"{CLR_CYAN}--------------------------------------------------------------------------------{CLR_RESET}")

        # 2.1 Scan seluruh pesan topik dari server (tertua -> terbaru)
        all_items, skipped_svc = await fetch_all_topic_messages(
            owner_acc.client, owner_acc.entity, topic_id, topic_title
        )
        source_total = len(all_items)
        already_copied = ledger.get_copied_ids(args.source_chat, topic_id)
        pending_items = [it for it in all_items if it[0] not in already_copied]

        print(
            f"  {CLR_BLUE}[AUDIT]{CLR_RESET} Total media/pesan: {CLR_BOLD}{source_total:,}{CLR_RESET} "
            f"(Service dilewati: {skipped_svc}) | Sudah tersalin: {len(already_copied):,} | "
            f"Sisa: {CLR_YELLOW}{len(pending_items):,}{CLR_RESET}"
        )

        if not pending_items:
            ledger.update_topic_progress(args.source_chat, topic_id, source_total, len(already_copied), skipped_svc, "completed")
            print(f"  ✔ {CLR_GREEN}[SUDAH LENGKAP]{CLR_RESET} Topik '{topic_title}' sudah 100% tersalin!")
            continue

        batches = build_album_safe_batches(pending_items, max_batch_size=args.batch_size)
        print(f"  {CLR_CYAN}[PLAN]{CLR_RESET} Membagi {len(pending_items):,} pesan ke dalam {len(batches)} batch aman-album (maks {args.batch_size}/batch)...")

        # Filter akun yang memiliki akses entity target channel
        eligible_accs = [a for a in pool.accounts if a.user_id in client_entities]
        if not eligible_accs:
            eligible_accs = [owner_acc]

        topic_copied_now = 0
        topic_start = time.time()
        acc_rr = 0

        for b_idx, batch in enumerate(batches, start=1):
            if g_shutdown:
                break

            msg_ids = [x[0] for x in batch]
            success = False
            attempts = 0

            while not success and attempts < 6 and not g_shutdown:
                attempts += 1
                # Pilih akun yang sedang tidak cooldown
                chosen_acc = None
                min_wait = 999999
                for offset in range(len(eligible_accs)):
                    cand = eligible_accs[(acc_rr + offset) % len(eligible_accs)]
                    rem = cand.cooldown_remaining()
                    if rem == 0:
                        chosen_acc = cand
                        acc_rr = (acc_rr + offset + 1) % len(eligible_accs)
                        break
                    if rem < min_wait:
                        min_wait = rem

                if chosen_acc is None:
                    wait_s = min(min_wait, 120) + 1
                    print(f"  {CLR_YELLOW}[COOLDOWN]{CLR_RESET} Semua akun sedang FloodWait. Menunggu {wait_s}s...")
                    await asyncio.sleep(wait_s)
                    continue

                try:
                    await chosen_acc.ensure_connected()
                    tgt_ent = client_entities[chosen_acc.user_id]
                    random_ids = [random.randrange(-(2**63), 2**63 - 1) for _ in msg_ids]

                    res = await chosen_acc.client(functions.messages.ForwardMessagesRequest(
                        from_peer=chosen_acc.entity,
                        id=msg_ids,
                        random_id=random_ids,
                        to_peer=tgt_ent,
                        drop_author=True,
                        drop_media_captions=False,
                        silent=True,
                    ))

                    target_ids = extract_forwarded_msg_ids(res, len(msg_ids))
                    record_rows = [
                        (smid, tmid, gid)
                        for (smid, gid), tmid in zip(batch, target_ids)
                    ]
                    ledger.record_copied_batch(args.source_chat, topic_id, ch_id, record_rows)

                    topic_copied_now += len(msg_ids)
                    grand_copied += len(msg_ids)
                    success = True

                    total_done = len(already_copied) + topic_copied_now
                    pct = (total_done / source_total) * 100 if source_total > 0 else 100.0
                    elapsed_t = time.time() - topic_start
                    rate = (topic_copied_now / elapsed_t) * 60 if elapsed_t > 0 else 0

                    if b_idx == 1 or b_idx % 5 == 0 or b_idx == len(batches):
                        print(
                            f"  ✔ [{chosen_acc.label:<8s}] Batch {b_idx:03d}/{len(batches):03d} "
                            f"(+{len(msg_ids):3d}) | Total: {total_done:,}/{source_total:,} ({pct:5.1f}%) "
                            f"| ~{rate:,.0f} pesan/menit"
                        )

                    await asyncio.sleep(args.delay)

                except (FloodWaitError, SlowModeWaitError) as fw:
                    wait_s = fw.seconds + 3
                    chosen_acc.set_cooldown(wait_s)
                    print(f"  {CLR_YELLOW}[FLOODWAIT]{CLR_RESET} Akun {chosen_acc.label} terkena limit {fw.seconds}s -> Failover instan!")
                except MessageIdInvalidError:
                    # Fallback kirim per unit atomik agar pesan valid tetap tersalin
                    print(f"  {CLR_YELLOW}[FALLBACK]{CLR_RESET} Ada ID tidak valid di batch {b_idx}, menyalin per-unit...")
                    sub_units = build_album_safe_batches(batch, max_batch_size=10)
                    for su in sub_units:
                        s_ids = [x[0] for x in su]
                        try:
                            s_rands = [random.randrange(-(2**63), 2**63 - 1) for _ in s_ids]
                            s_res = await chosen_acc.client(functions.messages.ForwardMessagesRequest(
                                from_peer=chosen_acc.entity,
                                id=s_ids,
                                random_id=s_rands,
                                to_peer=client_entities[chosen_acc.user_id],
                                drop_author=True,
                                drop_media_captions=False,
                                silent=True,
                            ))
                            t_ids = extract_forwarded_msg_ids(s_res, len(s_ids))
                            ledger.record_copied_batch(
                                args.source_chat, topic_id, ch_id,
                                [(sm, tm, gd) for (sm, gd), tm in zip(su, t_ids)]
                            )
                            topic_copied_now += len(s_ids)
                            grand_copied += len(s_ids)
                            await asyncio.sleep(0.5)
                        except Exception as se:
                            print(f"    {CLR_RED}[SKIP]{CLR_RESET} Unit {s_ids} gagal: {se}")
                    success = True
                except Exception as ex:
                    print(f"  {CLR_RED}[RETRY {attempts}/6]{CLR_RESET} Batch {b_idx} ({chosen_acc.label}): {ex}")
                    await asyncio.sleep(min(attempts * 3, 15))

            if not success:
                print(f"  {CLR_RED}[ERROR]{CLR_RESET} Batch {b_idx} gagal setelah 6 percobaan. Progres tersimpan di ledger.")

        # Verifikasi akhir topik ini
        final_copied_set = ledger.get_copied_ids(args.source_chat, topic_id)
        final_copied_cnt = len(final_copied_set)
        # Cek jumlah pesan aktual di channel target via Telegram server
        try:
            tgt_check = await owner_acc.client.get_messages(client_entities[OWNER_ACCOUNT_ID], limit=0)
            server_target_total = tgt_check.total
        except Exception:
            server_target_total = -1

        status_str = "completed" if final_copied_cnt >= source_total else "partial"
        ledger.update_topic_progress(args.source_chat, topic_id, source_total, final_copied_cnt, skipped_svc, status_str)
        print(
            f"  {CLR_GREEN}[VERIFIED TOPIK '{topic_title}']{CLR_RESET} "
            f"Sumber: {source_total:,} | Ledger Tersalin: {final_copied_cnt:,} | "
            f"Total di Channel Server: {server_target_total:,} | Status: {CLR_BOLD}{status_str.upper()}{CLR_RESET}"
        )

    # Ringkasan akhir
    total_elapsed = time.time() - start_all
    all_maps = ledger.list_all_maps(args.source_chat)
    print(f"\n{CLR_BOLD}{CLR_GREEN}================================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_WHITE} RINGKASAN MIGRASI SERVER-SIDE CLEAN COPY SELESAI{CLR_RESET}")
    print(f"{CLR_GREEN}================================================================================{CLR_RESET}")
    print(f" {'Channel Target':<26} | {'Channel ID':<15} | {'Sumber':>8} | {'Tersalin':>8} | {'Status'}")
    print(f" {'-'*26} | {'-'*15} | {'-'*8} | {'-'*8} | {'-'*10}")
    for m in all_maps:
        print(
            f" {m['target_channel_title']:<26} | {str(m['target_channel_id']):<15} | "
            f"{m['source_total']:>8,} | {m['copied_total']:>8,} | {m['status'].upper()}"
        )
    print(f"{CLR_GREEN}================================================================================{CLR_RESET}")
    print(f"  * Total Disalin Sesi Ini : {CLR_BOLD}{grand_copied:,}{CLR_RESET} pesan/media")
    print(f"  * Waktu Eksekusi Total   : {int(total_elapsed // 60)}m {int(total_elapsed % 60)}s\n")

    await pool.disconnect_all()
    ledger.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description="AutoGram Supergroup-to-Channel Clean Copy Migration Engine")
    parser.add_argument("--source-chat", type=int, default=DEFAULT_TARGET_CHAT, help="Source Supergroup ID")
    parser.add_argument("--topics", type=int, nargs="*", default=None, help="Filter topic ID tertentu (default: semua)")
    parser.add_argument("--batch-size", type=int, default=100, help="Maksimal pesan per ForwardMessages batch (default: 100)")
    parser.add_argument("--delay", type=float, default=1.2, help="Jeda detik antar batch (default: 1.2)")
    parser.add_argument("--create-only", action="store_true", help="Hanya buat channel dan promote admin tanpa menyalin pesan")
    args = parser.parse_args()
    sys.exit(asyncio.run(run_migration(args)))


if __name__ == "__main__":
    main()
