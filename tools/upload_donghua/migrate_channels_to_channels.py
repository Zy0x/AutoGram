#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
AutoGram Channel-to-Channel Zero-Miss Clean Copy (with media-type routing).

Copies messages from legacy '#Gudang ~ ...' channels into the consolidated
'#Gudang - ...' private channels using server-side ForwardMessages
(drop_author=True). Supports per-media-type routing (photo/video/other),
album-safe batching, multi-account failover and a SQLite checkpoint ledger.
"""

import sys
import json
import time
import random
import signal
import sqlite3
import asyncio
import argparse
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

from telethon import functions, types
from telethon.errors import FloodWaitError, SlowModeWaitError, MessageIdInvalidError

sys.path.insert(0, str(Path(__file__).resolve().parent))
from upload_donghua import build_account_pool, DEFAULT_TARGET_CHAT, CLR_RESET, CLR_BOLD, CLR_RED, CLR_GREEN, CLR_YELLOW, CLR_CYAN
from migrate_topics_to_channels import FULL_ADMIN_RIGHTS, build_album_safe_batches, extract_forwarded_msg_ids

OWNER_ACCOUNT_ID = 8420671507          # Mantan
ADMIN_IDS = [8542241823, 862678085]     # Lavender, Thea

# Target channels: key -> (title, existing_id or None)
TARGETS = {
    "cosplay":   ("#Gudang - Cosplay", -1005952864778),
    "nsfw_vid":  ("#Gudang - NSFW Video", -1005795269861),
    "nsfw_pict": ("#Gudang - NSFW Pict", -1005802138718),
    "mmd":       ("#Gudang - 3D & MMD", -1005924655694),
}

# Jobs: (source_id, source_label, routes) ; routes: kind -> target key (missing kind = skip)
ALL = {"photo": None, "video": None, "other": None, "text": None}
JOBS = [
    (-1002352958169, "#Gudang ~ NSFW & Cosplay", {k: "cosplay" for k in ALL}),
    (-1002445503919, "#Gudang ~ NSFW", {"photo": "nsfw_pict", "video": "nsfw_vid", "other": "nsfw_vid"}),
    (-1002485818147, "#Gudang ~ MMD & 3D Animated", {k: "mmd" for k in ALL}),
]

g_shutdown = False
def _sig(*_):
    global g_shutdown
    if g_shutdown:
        sys.exit(1)
    g_shutdown = True
    print(f"\n{CLR_YELLOW}[WARN] Berhenti setelah batch aktif selesai...{CLR_RESET}")
signal.signal(signal.SIGINT, _sig)


class Ledger:
    def __init__(self, path: Path):
        self.conn = sqlite3.connect(str(path), timeout=30)
        self.conn.execute("PRAGMA journal_mode = WAL;")
        with self.conn:
            self.conn.execute("""CREATE TABLE IF NOT EXISTS targets (
                key TEXT PRIMARY KEY, channel_id INTEGER NOT NULL, title TEXT NOT NULL)""")
            self.conn.execute("""CREATE TABLE IF NOT EXISTS copied (
                source_id INTEGER NOT NULL, source_msg_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL, target_msg_id INTEGER,
                copied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (source_id, source_msg_id, target_id))""")
            self.conn.execute("""CREATE TABLE IF NOT EXISTS failed (
                source_id INTEGER NOT NULL, source_msg_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL, error TEXT,
                PRIMARY KEY (source_id, source_msg_id, target_id))""")

    def record_failed(self, src, tgt, mid, err):
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO failed VALUES (?,?,?,?)", (src, mid, tgt, err[:200]))

    def failed_ids(self, src, tgt):
        return {r[0] for r in self.conn.execute(
            "SELECT source_msg_id FROM failed WHERE source_id=? AND target_id=?", (src, tgt))}

    def target(self, key):
        r = self.conn.execute("SELECT channel_id FROM targets WHERE key=?", (key,)).fetchone()
        return r[0] if r else None

    def set_target(self, key, cid, title):
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO targets VALUES (?,?,?)", (key, cid, title))

    def copied_ids(self, src, tgt):
        return {r[0] for r in self.conn.execute(
            "SELECT source_msg_id FROM copied WHERE source_id=? AND target_id=?", (src, tgt))}

    def record(self, src, tgt, rows):
        with self.conn:
            self.conn.executemany("INSERT OR REPLACE INTO copied (source_id, source_msg_id, target_id, target_msg_id) VALUES (?,?,?,?)",
                                  [(src, s, tgt, t) for s, t in rows])


def classify(m) -> str:
    if isinstance(m, (types.MessageService, types.MessageEmpty)):
        return "service"
    media = getattr(m, "media", None)
    if media is None:
        return "text"
    if isinstance(media, types.MessageMediaPhoto):
        return "photo"
    if isinstance(media, types.MessageMediaDocument) and getattr(media, "document", None):
        doc = media.document
        mime = (getattr(doc, "mime_type", "") or "").lower()
        if mime.startswith("video/") or any(isinstance(a, types.DocumentAttributeVideo) for a in doc.attributes):
            return "video"
        if mime.startswith("image/"):
            return "photo"
        return "other"
    return "other"


async def resolve_for(client, cid):
    try:
        ent = await client.get_entity(cid)
        if isinstance(ent, types.ChannelForbidden):
            return None
        return ent
    except Exception:
        async for d in client.iter_dialogs():
            if d.id == cid:
                if isinstance(d.entity, types.ChannelForbidden):
                    return None
                return d.entity
    return None


async def ensure_target(key, owner, others, ledger):
    title, fixed = TARGETS[key]
    cid = fixed or ledger.target(key)
    ent = await resolve_for(owner.client, cid) if cid else None
    if ent is None:
        async for d in owner.client.iter_dialogs():
            if d.is_channel and not getattr(d.entity, "megagroup", False) and d.name == title:
                if not isinstance(d.entity, types.ChannelForbidden):
                    ent = d.entity
                    break
    created = False
    if ent is None:
        res = await owner.client(functions.channels.CreateChannelRequest(
            title=title, about=f"Arsip permanen kategori {title[10:]}", broadcast=True, megagroup=False))
        ent = res.chats[0]
        created = True
        print(f"  {CLR_GREEN}[CREATED]{CLR_RESET} {title} (ID -100{ent.id})")
        await asyncio.sleep(1.5)
    cid = int(f"-100{ent.id}")
    ledger.set_target(key, cid, title)
    if created:
        for uid in ADMIN_IDS:
            try:
                u = await owner.client.get_entity(uid)
                await owner.client(functions.channels.EditAdminRequest(
                    channel=ent, user_id=u, admin_rights=FULL_ADMIN_RIGHTS, rank="Admin"))
                print(f"  {CLR_GREEN}[ADMIN]{CLR_RESET} {getattr(u, 'first_name', uid)} -> {title}")
                await asyncio.sleep(0.6)
            except Exception as e:
                print(f"  {CLR_YELLOW}[WARN]{CLR_RESET} admin {uid}: {e}")
    ents = {owner.user_id: ent}
    for acc in others:
        oe = await resolve_for(acc.client, cid)
        if oe is not None:
            ents[acc.user_id] = oe
    return cid, title, ents


async def scan_source(client, src_ent):
    items = []
    async for m in client.iter_messages(src_ent, reverse=True):
        items.append((m.id, getattr(m, "grouped_id", None), classify(m)))
    return items


async def copy_batches(pool, src_id, src_ents, tgt_id, tgt_ents, batches, ledger, label, total, done0, delay):
    accs = [a for a in pool.accounts if a.user_id in src_ents and a.user_id in tgt_ents]
    rr, done, t0 = 0, 0, time.time()
    for bi, batch in enumerate(batches, 1):
        if g_shutdown:
            return done
        ids = [x[0] for x in batch]
        for attempt in range(1, 11):
            acc = None
            wait = 10**6
            for off in range(len(accs)):
                c = accs[(rr + off) % len(accs)]
                rem = c.cooldown_remaining()
                if rem == 0:
                    acc, rr = c, (rr + off + 1) % len(accs)
                    break
                wait = min(wait, rem)
            if acc is None:
                await asyncio.sleep(min(wait, 120) + 1)
                continue
            try:
                await acc.ensure_connected()
                res = await acc.client(functions.messages.ForwardMessagesRequest(
                    from_peer=src_ents[acc.user_id], id=ids,
                    random_id=[random.randrange(-(2**63), 2**63 - 1) for _ in ids],
                    to_peer=tgt_ents[acc.user_id], drop_author=True, silent=True))
                tids = extract_forwarded_msg_ids(res, len(ids))
                ledger.record(src_id, tgt_id, list(zip(ids, tids)))
                done += len(ids)
                if bi == 1 or bi % 10 == 0 or bi == len(batches):
                    rate = done / max(time.time() - t0, 1) * 60
                    print(f"  [{acc.label:<8s}] {label} batch {bi}/{len(batches)} | {done0 + done:,}/{total:,} | ~{rate:,.0f}/menit")
                await asyncio.sleep(delay)
                break
            except (FloodWaitError, SlowModeWaitError) as fw:
                acc.flood_until = time.time() + fw.seconds + 3
                print(f"  {CLR_YELLOW}[FLOODWAIT]{CLR_RESET} {acc.label} {fw.seconds}s -> failover")
            except Exception as e_any:
                err_str = str(e_any)
                if not isinstance(e_any, MessageIdInvalidError) and "MEDIA_FILE_INVALID" not in err_str:
                    print(f"  {CLR_RED}[RETRY {attempt}/10]{CLR_RESET} {acc.label}: {e_any}")
                    # Jika WorkerBusy atau server error, failover akun atau tunggu sebentar
                    if "WorkerBusy" in err_str or "RpcMcgetFailError" in err_str:
                        await asyncio.sleep(min(attempt * 4, 25))
                    else:
                        await asyncio.sleep(min(attempt * 3, 15))
                    if attempt < 10:
                        continue
                print(f"  {CLR_YELLOW}[FALLBACK]{CLR_RESET} batch {bi}: {type(e_any).__name__} -> salin per pesan")
                for one in ids:
                    try:
                        r1 = await acc.client(functions.messages.ForwardMessagesRequest(
                            from_peer=src_ents[acc.user_id], id=[one], random_id=[random.randrange(-(2**63), 2**63 - 1)],
                            to_peer=tgt_ents[acc.user_id], drop_author=True, silent=True))
                        ledger.record(src_id, tgt_id, [(one, extract_forwarded_msg_ids(r1, 1)[0])])
                        done += 1
                    except FloodWaitError as fw1:
                        await asyncio.sleep(min(fw1.seconds, 60) + 1)
                    except Exception as e1:
                        ledger.record_failed(src_id, tgt_id, one, str(e1))
                        print(f"    {CLR_RED}[GAGAL]{CLR_RESET} msg {one}: {e1}")
                    await asyncio.sleep(0.4)
                break
    return done


async def main_async(args):
    root = Path(__file__).resolve().parent
    ledger = Ledger(root / "migration_ledger_channels.sqlite")
    pool = await build_account_pool(root.parent.parent, DEFAULT_TARGET_CHAT)
    owner = next(a for a in pool.accounts if a.user_id == OWNER_ACCOUNT_ID)
    others = [a for a in pool.accounts if a is not owner]

    print(f"\n{CLR_BOLD}>>> FASE 1: SIAPKAN CHANNEL TUJUAN{CLR_RESET}")
    tgt = {}
    for key in TARGETS:
        tgt[key] = await ensure_target(key, owner, others, ledger)

    reg_path = root / "channel_registry.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8")) if reg_path.exists() else {"channels": {}}
    for key, (cid, title, _) in tgt.items():
        reg.setdefault("channels", {})[title] = {**reg["channels"].get(title, {}), "channel_id": cid, "channel_title": title}
    reg_path.write_text(json.dumps(reg, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n{CLR_BOLD}>>> FASE 2: CLEAN COPY{CLR_RESET}")
    report = []
    for src_id, src_label, routes in JOBS:
        if g_shutdown:
            break
        src_ents = {}
        for acc in pool.accounts:
            e = await resolve_for(acc.client, src_id)
            if e is not None:
                src_ents[acc.user_id] = e
        print(f"\n{CLR_CYAN}[SUMBER]{CLR_RESET} {src_label} — memindai riwayat...")
        items = await scan_source(owner.client, src_ents[owner.user_id])
        kinds = {}
        for _, _, k in items:
            kinds[k] = kinds.get(k, 0) + 1
        print(f"  Komposisi: {kinds}")
        per_target: Dict[str, List[Tuple[int, Optional[int]]]] = {}
        skipped = 0
        for mid, gid, k in items:
            key = routes.get(k)
            if key is None:
                skipped += 1
                continue
            per_target.setdefault(key, []).append((mid, gid))
        for key, lst in per_target.items():
            tgt_id, tgt_title, tgt_ents = tgt[key]
            already = ledger.copied_ids(src_id, tgt_id)
            pending = [x for x in lst if x[0] not in already]
            print(f"  -> {tgt_title}: total {len(lst):,} | sudah {len(already & {x[0] for x in lst}):,} | sisa {len(pending):,}")
            if pending:
                batches = build_album_safe_batches(pending, max_batch_size=100)
                await copy_batches(pool, src_id, src_ents, tgt_id, tgt_ents, batches, ledger,
                                   tgt_title, len(lst), len(lst) - len(pending), args.delay)
            final = len(ledger.copied_ids(src_id, tgt_id) & {x[0] for x in lst})
            fails = len((ledger.failed_ids(src_id, tgt_id) - ledger.copied_ids(src_id, tgt_id)) & {x[0] for x in lst})
            if fails:
                print(f"  {CLR_YELLOW}[INFO]{CLR_RESET} {fails} pesan ditolak server (media rusak/tidak valid)")
            report.append((src_label, tgt_title, len(lst), final))
        if skipped:
            report.append((src_label, "(dilewati: service/teks tanpa media)", skipped, 0))

    print(f"\n{CLR_BOLD}{CLR_GREEN}=== RINGKASAN ==={CLR_RESET}")
    for s, t, n, c in report:
        status = "OK" if c >= n or t.startswith("(") else "PARTIAL"
        print(f"  {s:<30s} -> {t:<26s} | sumber {n:>6,} | tersalin {c:>6,} | {status}")
    await pool.disconnect_all()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--delay", type=float, default=1.2)
    asyncio.run(main_async(p.parse_args()))


if __name__ == "__main__":
    main()
