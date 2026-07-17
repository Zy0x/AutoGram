"""
Fast Forward full suite — offline unit + live Telegram (fast, strict-but-fair).
Does not print secrets.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SOURCE_CHAT = "-1003214112048_5"
DEST_CHAT = "-1004468191168"
SESSION = "Lavender"
JOB_ID = 33


@dataclass
class TestResult:
    name: str
    ok: bool
    detail: str = ""
    category: str = "unit"


@dataclass
class Suite:
    results: List[TestResult] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str = "", category: str = "unit"):
        self.results.append(TestResult(name, ok, detail, category))
        print(f"[{'PASS' if ok else 'FAIL'}] [{category}] {name}: {detail}", flush=True)

    def summary(self) -> int:
        total = len(self.results)
        passed = sum(1 for r in self.results if r.ok)
        failed = total - passed
        print("\n" + "=" * 60, flush=True)
        print(f"TOTAL {total}  PASS {passed}  FAIL {failed}", flush=True)
        by_cat: Dict[str, List[TestResult]] = {}
        for r in self.results:
            by_cat.setdefault(r.category, []).append(r)
        for cat, items in by_cat.items():
            p = sum(1 for i in items if i.ok)
            print(f"  {cat}: {p}/{len(items)}", flush=True)
        if failed:
            print("\nFAILED:", flush=True)
            for r in self.results:
                if not r.ok:
                    print(f"  - {r.name}: {r.detail}", flush=True)
        return 0 if failed == 0 else 1


def _creds():
    api_id = int(os.getenv("API_ID") or os.getenv("api_id") or "0")
    api_hash = (os.getenv("API_HASH") or os.getenv("api_hash") or "").strip().strip('"')
    if not api_id or not api_hash:
        raise SystemExit("API credentials missing")
    return api_id, api_hash


def _ok_done(r: dict) -> bool:
    return r.get("db_status") in ("COMPLETED", "PARTIAL_SUCCESS", "PAUSED") and r.get("error") is None


def _accounted(r: dict) -> bool:
    return r.get("processed", 0) == (
        r.get("success", 0) + r.get("failed", 0) + r.get("skipped", 0)
    )


# ── Unit ────────────────────────────────────────────────────────────────────

def test_unit(suite: Suite):
    from engine.config_normalize import normalize_job_config
    from engine.pause_control import resolve_final_state
    from engine.enterprise.filters import message_in_date_range, passes_size_filter
    from engine.fast_forward import FastForwardEngine, ChatRestrictedFallback
    from engine.forwarder import MigrationForwarder
    from engine.duplicate_checker import DuplicateChecker
    from database.queries import (
        create_execution,
        seed_execution_from_prior,
        update_execution_progress,
        update_execution_status,
        get_execution,
        log_duplicate,
    )
    import datetime
    import inspect
    from telethon.client.messages import MessageMethods

    suite.add("import engines", True, "FF+Forwarder")
    suite.add("ChatRestrictedFallback", issubclass(ChatRestrictedFallback, Exception))

    c = normalize_job_config(
        {
            "mode": "Fast Forward",
            "min_size_mb": 3,
            "max_size_mb": 50,
            "autoFallback": True,
            "dupAction": "Skip",
            "startDate": "2024-01-01",
            "endDate": "2026-12-31",
            "fetchDirection": "Oldest First",
            "source": SOURCE_CHAT,
            "destination": DEST_CHAT,
            "delayMin": 1,
            "delayMax": 2,
            "enableThrottle": True,
        }
    )
    suite.add("normalize transfer_mode", c.get("transfer_mode") == "Fast Forward", str(c.get("transfer_mode")))
    suite.add(
        "normalize size aliases",
        float(c.get("size_min_mb", 0)) == 3.0 and float(c.get("min_size_mb", 0)) == 3.0,
        f"min={c.get('size_min_mb')} max={c.get('size_max_mb')}",
    )
    suite.add("normalize auto_fallback", c.get("auto_fallback") is True)
    suite.add("normalize dates", c.get("start_date") == "2024-01-01" and c.get("end_date") == "2026-12-31")
    suite.add("normalize topic", c.get("source_topic_id") == 5, str(c.get("source_topic_id")))
    suite.add("normalize fetch", c.get("fetch_direction") == "Oldest First")

    suite.add(
        "pause incomplete → PAUSED",
        resolve_final_state(paused=True, failed_count=0, processed_count=3, limit=100, natural_end=False) == "PAUSED",
    )
    suite.add(
        "pause + natural_end → COMPLETED",
        resolve_final_state(paused=True, failed_count=0, processed_count=10, limit=10, natural_end=True) == "COMPLETED",
    )
    suite.add(
        "failures → PARTIAL_SUCCESS",
        resolve_final_state(paused=False, failed_count=2, processed_count=10, limit=10, natural_end=True)
        == "PARTIAL_SUCCESS",
    )
    suite.add(
        "clean → COMPLETED",
        resolve_final_state(paused=False, failed_count=0, processed_count=5, limit=5, natural_end=True) == "COMPLETED",
    )

    class FakeMsg:
        def __init__(self, d):
            self.date = d

    old = FakeMsg(datetime.datetime(2010, 1, 1, tzinfo=datetime.timezone.utc))
    new = FakeMsg(datetime.datetime(2026, 7, 1, tzinfo=datetime.timezone.utc))
    rng = {"start_date": "2025-01-01", "end_date": "2026-12-31"}
    suite.add("date excludes old", message_in_date_range(old, rng) is False)
    suite.add("date includes new", message_in_date_range(new, rng) is True)
    suite.add("date empty allows", message_in_date_range(old, {}) is True)
    suite.add("size no bounds", passes_size_filter(None, {"size_min_mb": 0, "size_max_mb": 0}) is True)

    exec_a = create_execution(JOB_ID, json.dumps({"t": "a"}))
    update_execution_status(exec_a, "RUNNING")
    update_execution_progress(exec_a, 88888, 4, 10)
    update_execution_status(exec_a, "PAUSED")
    exec_b = create_execution(JOB_ID, json.dumps({"t": "b"}))
    ok_seed = seed_execution_from_prior(JOB_ID, exec_b)
    ex_b = get_execution(exec_b)
    suite.add(
        "seed from PAUSED",
        ok_seed is True and (ex_b or {}).get("last_processed_id") == 88888,
        f"seeded={ok_seed} last={(ex_b or {}).get('last_processed_id')}",
    )

    dest_key = "suite_dest_ff"
    key = DuplicateChecker.msgid_key("srcX", 123456)
    log_duplicate(key, dest_key, 555)
    hit = DuplicateChecker(dest_key).get_duplicate_message_id(file_unique_id=key)
    suite.add("msgid duplicate lookup", hit == 555, f"hit={hit}")

    params = set(inspect.signature(MessageMethods.forward_messages).parameters)
    suite.add("telethon has no top_msg_id", "top_msg_id" not in params)
    src = open(
        os.path.join(os.path.dirname(__file__), "engine", "fast_forward.py"),
        encoding="utf-8",
    ).read()
    suite.add("uses ForwardMessagesRequest", "ForwardMessagesRequest" in src)
    suite.add("has max_scan safety", "max_scan" in src)
    suite.add(
        "enterprise seed helper",
        hasattr(MigrationForwarder, "_seed_enterprise_mapping_from_ff_tasks"),
    )


# ── Live ────────────────────────────────────────────────────────────────────

async def _connect():
    from telethon import TelegramClient

    api_id, api_hash = _creds()
    session = os.path.join(os.path.dirname(__file__), "sessions", SESSION)
    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("unauthorized")
    return client


def _cfg(**overrides) -> dict:
    from engine.config_normalize import normalize_job_config

    raw = {
        "mode": "Fast Forward",
        "transfer_mode": "Fast Forward",
        "session_name": SESSION,
        "source_chat": SOURCE_CHAT,
        "dest_chat": DEST_CHAT,
        "limit": 2,
        "fetch_direction": "Newest First",
        "duplicate_action": "Skip",
        "dupAction": "Skip",
        "auto_fallback": True,
        "dry_run": False,
        "delay_min": 0.4,
        "delay_max": 0.7,
        "throttle_active": True,
        "media_filter": "all",
        "job_id": JOB_ID,
        "max_scan": 80,
    }
    raw.update(overrides)
    cfg = normalize_job_config(raw)
    cfg["job_id"] = JOB_ID
    # re-apply critical overrides post-normalize
    for k in (
        "dry_run",
        "limit",
        "auto_fallback",
        "fetch_direction",
        "duplicate_action",
        "dupAction",
        "media_filter",
        "start_date",
        "end_date",
        "size_min_mb",
        "size_max_mb",
        "min_size_mb",
        "max_size_mb",
        "max_scan",
        "is_retry",
        "rerun_mode",
        "delay_min",
        "delay_max",
        "throttle_active",
    ):
        if k in overrides:
            cfg[k] = overrides[k]
    if "dupAction" in overrides:
        cfg["duplicate_action"] = overrides["dupAction"]
        cfg["dupAction"] = overrides["dupAction"]
    if "duplicate_action" in overrides:
        cfg["duplicate_action"] = overrides["duplicate_action"]
        cfg["dupAction"] = overrides["duplicate_action"]
    return cfg


async def _run_ff(client, config: dict, limit: int, pause_after: Optional[float] = None) -> dict:
    from database.queries import create_execution, update_execution_status, get_execution
    from engine.events import setup_emitter
    from engine.fast_forward import FastForwardEngine, ChatRestrictedFallback

    execution_id = create_execution(JOB_ID, json.dumps({"suite": True, "limit": limit}))
    setup_emitter(execution_id, JOB_ID)
    update_execution_status(execution_id, "RUNNING")
    config = dict(config)
    config["job_id"] = JOB_ID

    source = await client.get_input_entity(int(str(config["source_chat"]).split("_")[0]))
    dest = await client.get_input_entity(int(config["dest_chat"]))
    engine = FastForwardEngine(client, source, dest, execution_id, config)

    pause_task = None
    if pause_after is not None:

        async def _p():
            await asyncio.sleep(pause_after)
            update_execution_status(execution_id, "PAUSING")

        pause_task = asyncio.create_task(_p())

    err = None
    fallback = False
    try:
        await engine.execute_migration(limit=limit)
    except ChatRestrictedFallback as e:
        fallback = True
        err = e.reason
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    finally:
        if pause_task and not pause_task.done():
            pause_task.cancel()

    ex = get_execution(execution_id) or {}
    return {
        "execution_id": execution_id,
        "db_status": ex.get("status"),
        "last_processed_id": ex.get("last_processed_id"),
        "processed_messages": ex.get("processed_messages"),
        "processed": engine.progress.processed,
        "success": engine.progress.success,
        "failed": engine.progress.failed,
        "skipped": engine.progress.skipped,
        "error": err,
        "fallback": fallback,
    }


async def test_live(suite: Suite):
    client = await _connect()
    me = await client.get_me()
    suite.add("live auth", True, f"uid={me.id}", category="live")

    try:
        src = await client.get_entity(int(SOURCE_CHAT.split("_")[0]))
        dst = await client.get_entity(int(DEST_CHAT))
        suite.add(
            "live resolve entities",
            True,
            f"src={getattr(src,'title',None)} dst={getattr(dst,'title',None)} noforwards={getattr(src,'noforwards',None)}",
            category="live",
        )

        # 1) Dry-run: accept success OR skip (dups from prior tests)
        r = await _run_ff(client, _cfg(dry_run=True, limit=2, duplicate_action="Skip"), 2)
        suite.add(
            "live dry-run completes",
            _ok_done(r) and r["db_status"] == "COMPLETED" and r["processed"] >= 1 and _accounted(r),
            str(r),
            category="live",
        )

        # 2) Date exclude-all with max_scan (must not hang)
        r = await _run_ff(
            client,
            _cfg(
                dry_run=True,
                limit=5,
                start_date="2010-01-01",
                end_date="2010-12-31",
                max_scan=40,
                duplicate_action="Skip",
            ),
            5,
        )
        suite.add(
            "live date exclude + max_scan (no hang)",
            r["db_status"] == "COMPLETED" and r["processed"] == 0 and r["error"] is None,
            str(r),
            category="live",
        )

        # 3) Date include recent (process or skip OK)
        r = await _run_ff(
            client,
            _cfg(
                dry_run=True,
                limit=2,
                start_date="2025-01-01",
                end_date="2026-12-31",
                max_scan=80,
            ),
            2,
        )
        suite.add(
            "live date include recent",
            r["db_status"] == "COMPLETED" and r["processed"] >= 1 and _accounted(r),
            str(r),
            category="live",
        )

        # 4) Size filter huge min → no media passes (text might; media-only topic → 0)
        r = await _run_ff(
            client,
            _cfg(dry_run=True, limit=5, size_min_mb=99999.0, min_size_mb=99999.0, max_scan=40),
            5,
        )
        suite.add(
            "live size filter high min",
            r["error"] is None and r["db_status"] == "COMPLETED" and r["success"] == 0,
            str(r),
            category="live",
        )

        # 5) Media filter voice (usually 0) + max_scan
        r = await _run_ff(
            client,
            _cfg(dry_run=True, limit=5, media_filter="voice", max_scan=40),
            5,
        )
        suite.add(
            "live media filter voice",
            r["error"] is None and r["db_status"] == "COMPLETED",
            str(r),
            category="live",
        )

        # 6) Real forward limit 1 (success or skip if already done)
        r = await _run_ff(client, _cfg(dry_run=False, limit=1, duplicate_action="Skip"), 1)
        suite.add(
            "live real forward/skip",
            r["db_status"] in ("COMPLETED", "PARTIAL_SUCCESS")
            and r["failed"] == 0
            and (r["success"] + r["skipped"]) >= 1
            and _accounted(r),
            str(r),
            category="live",
        )
        had_success = r.get("success", 0) >= 1

        # 7) Dup skip (if previous success) else just no-fail
        r2 = await _run_ff(client, _cfg(dry_run=False, limit=1, duplicate_action="Skip"), 1)
        if had_success or r2.get("skipped", 0) >= 1:
            suite.add(
                "live duplicate skip",
                r2["skipped"] >= 1 and r2["failed"] == 0,
                str(r2),
                category="live",
            )
        else:
            suite.add("live second run no fail", r2["failed"] == 0, str(r2), category="live")

        # 8) OVERWRITE forces re-forward (expect success)
        r = await _run_ff(
            client,
            _cfg(
                dry_run=False,
                limit=1,
                is_retry=True,
                rerun_mode="OVERWRITE",
                duplicate_action="Skip",
            ),
            1,
        )
        suite.add(
            "live OVERWRITE re-forward",
            r["db_status"] in ("COMPLETED", "PARTIAL_SUCCESS") and r["success"] >= 1 and r["failed"] == 0,
            str(r),
            category="live",
        )

        # 9) Pause → PAUSED
        r = await _run_ff(
            client,
            _cfg(dry_run=False, limit=6, is_retry=True, rerun_mode="OVERWRITE"),
            6,
            pause_after=0.2,
        )
        suite.add(
            "live pause → PAUSED",
            r["db_status"] == "PAUSED",
            str(r),
            category="live",
        )

        # 10) Resume seed + continue
        from database.queries import create_execution, seed_execution_from_prior, get_execution, update_execution_status
        from engine.events import setup_emitter
        from engine.fast_forward import FastForwardEngine

        new_exec = create_execution(JOB_ID, json.dumps({"resume": True}))
        seeded = seed_execution_from_prior(JOB_ID, new_exec)
        ex = get_execution(new_exec)
        suite.add(
            "live resume seed",
            seeded is True and int((ex or {}).get("last_processed_id") or 0) > 0,
            f"seeded={seeded} last={(ex or {}).get('last_processed_id')}",
            category="live",
        )
        setup_emitter(new_exec, JOB_ID)
        update_execution_status(new_exec, "RUNNING")
        cfg = _cfg(dry_run=False, limit=2, duplicate_action="Skip")
        source = await client.get_input_entity(int(SOURCE_CHAT.split("_")[0]))
        dest = await client.get_input_entity(int(DEST_CHAT))
        engine = FastForwardEngine(client, source, dest, new_exec, cfg)
        await engine.execute_migration(limit=2)
        ex2 = get_execution(new_exec) or {}
        suite.add(
            "live resume run",
            ex2.get("status") in ("COMPLETED", "PARTIAL_SUCCESS", "PAUSED") and engine.progress.failed == 0,
            f"status={ex2.get('status')} p={engine.progress.processed} s={engine.progress.success} k={engine.progress.skipped}",
            category="live",
        )

        # 11) Oldest First dry-run
        r = await _run_ff(
            client,
            _cfg(dry_run=True, limit=2, fetch_direction="Oldest First", max_scan=50),
            2,
        )
        suite.add(
            "live Oldest First",
            r["db_status"] == "COMPLETED" and r["processed"] >= 1 and _accounted(r),
            str(r),
            category="live",
        )

        # 12) target_message_id mapped
        from database.db import get_connection
        import sqlite3

        conn = get_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            """
            SELECT target_message_id FROM tasks
            WHERE status='DONE' AND target_message_id IS NOT NULL AND target_message_id > 0
            ORDER BY id DESC LIMIT 1
            """
        )
        row = cur.fetchone()
        conn.close()
        suite.add(
            "live target_message_id > 0",
            row is not None and int(row["target_message_id"]) > 0,
            f"id={row['target_message_id'] if row else None}",
            category="live",
        )

        # 13) auto_fallback off on open source still works
        r = await _run_ff(client, _cfg(dry_run=True, limit=1, auto_fallback=False), 1)
        suite.add(
            "live auto_fallback=off unrestricted",
            r["db_status"] == "COMPLETED" and r["fallback"] is False and r["error"] is None,
            str(r),
            category="live",
        )

        # 14) counters coherent
        r = await _run_ff(client, _cfg(dry_run=True, limit=2), 2)
        suite.add("live counters coherent", _accounted(r) and _ok_done(r), str(r), category="live")

    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


async def amain():
    suite = Suite()
    print("=== UNIT ===", flush=True)
    try:
        test_unit(suite)
    except Exception as e:
        suite.add("unit crashed", False, f"{e}\n{traceback.format_exc()}")

    print("\n=== LIVE ===", flush=True)
    try:
        await test_live(suite)
    except Exception as e:
        suite.add("live crashed", False, f"{e}\n{traceback.format_exc()}", category="live")

    code = suite.summary()
    report_path = os.path.join(os.path.dirname(__file__), "logs", "ff_full_suite_report.json")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(
            [{"name": r.name, "ok": r.ok, "detail": r.detail, "category": r.category} for r in suite.results],
            f,
            indent=2,
            ensure_ascii=False,
        )
    print(f"\nReport: {report_path}", flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(amain()))
