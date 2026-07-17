"""
Remote Fast Forward smoke test. Does not print secrets.
Usage:
  python _ff_remote_test.py --dry-run
  python _ff_remote_test.py --real --limit 1
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time

from dotenv import load_dotenv

load_dotenv()

# Ensure worker root on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _creds():
    api_id = int(os.getenv("API_ID") or os.getenv("api_id") or "0")
    api_hash = (os.getenv("API_HASH") or os.getenv("api_hash") or "").strip().strip('"')
    if not api_id or not api_hash:
        raise SystemExit("API_ID/API_HASH missing from .env")
    return api_id, api_hash


async def run_engine(dry_run: bool, limit: int, pause_after: int | None = None):
    from telethon import TelegramClient
    from database.queries import create_execution, get_execution, update_execution_status
    from engine.config_normalize import normalize_job_config
    from engine.fast_forward import FastForwardEngine, ChatRestrictedFallback
    from engine.events import setup_emitter

    api_id, api_hash = _creds()
    session = os.path.join(os.path.dirname(__file__), "sessions", "Lavender")

    raw = {
        "mode": "Fast Forward",
        "transfer_mode": "Fast Forward",
        "session_name": "Lavender",
        "source_chat": "-1003214112048_5",
        "dest_chat": "-1004468191168",
        "limit": limit,
        "fetch_direction": "Newest First",
        "duplicate_action": "Skip",
        "dupAction": "Skip",
        "auto_fallback": True,
        "autoFallback": True,
        "dry_run": dry_run,
        "dryRun": dry_run,
        "delay_min": 1.0,
        "delay_max": 1.5,
        "throttle_active": True,
        "media_filter": "all",
        "job_id": 33,
    }
    config = normalize_job_config(raw)
    config["job_id"] = 33
    config["dry_run"] = dry_run

    execution_id = create_execution(33, json.dumps(config))
    setup_emitter(execution_id, 33)
    update_execution_status(execution_id, "RUNNING")

    print(
        json.dumps(
            {
                "phase": "start",
                "execution_id": execution_id,
                "dry_run": dry_run,
                "limit": limit,
                "mode": config.get("transfer_mode"),
                "source_topic": config.get("source_topic_id"),
                "size_min_mb": config.get("size_min_mb"),
                "auto_fallback": config.get("auto_fallback"),
            }
        ),
        flush=True,
    )

    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        update_execution_status(execution_id, "FAILED", "session unauthorized")
        print(json.dumps({"error": "session unauthorized"}))
        return 1

    source = await client.get_input_entity(
        int(str(config["source_chat"]).split("_")[0])
        if "_" in str(config["source_chat"])
        else int(config["source_chat"])
    )
    dest = await client.get_input_entity(int(config["dest_chat"]))

    # full entity for preflight
    src_full = await client.get_entity(source)
    print(
        json.dumps(
            {
                "source_title": getattr(src_full, "title", None),
                "noforwards": bool(getattr(src_full, "noforwards", False)),
            }
        ),
        flush=True,
    )

    engine = FastForwardEngine(client, source, dest, execution_id, config)

    pause_task = None
    if pause_after is not None and pause_after > 0:

        async def _pause_later():
            await asyncio.sleep(pause_after)
            update_execution_status(execution_id, "PAUSING")
            print(json.dumps({"phase": "pause_requested"}), flush=True)

        pause_task = asyncio.create_task(_pause_later())

    t0 = time.time()
    exit_code = 0
    try:
        await engine.execute_migration(limit=limit)
    except ChatRestrictedFallback as e:
        print(json.dumps({"phase": "fallback", "reason": e.reason}), flush=True)
        exit_code = 2
    except Exception as e:
        print(json.dumps({"phase": "error", "error": f"{type(e).__name__}: {e}"}), flush=True)
        exit_code = 1
    finally:
        if pause_task and not pause_task.done():
            pause_task.cancel()
        try:
            await client.disconnect()
        except Exception:
            pass

    ex = get_execution(execution_id) or {}
    print(
        json.dumps(
            {
                "phase": "done",
                "duration_s": round(time.time() - t0, 2),
                "db_status": ex.get("status"),
                "last_processed_id": ex.get("last_processed_id"),
                "processed_messages": ex.get("processed_messages"),
                "progress": {
                    "processed": engine.progress.processed,
                    "success": engine.progress.success,
                    "failed": engine.progress.failed,
                    "skipped": engine.progress.skipped,
                    "floodwaits": engine.progress.floodwait_count,
                },
                "exit_code": exit_code,
            }
        ),
        flush=True,
    )
    return exit_code


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--real", action="store_true")
    p.add_argument("--limit", type=int, default=2)
    p.add_argument("--pause-after", type=float, default=None, help="Request PAUSE after N seconds")
    args = p.parse_args()
    dry = args.dry_run or not args.real
    if args.real:
        dry = False
    code = asyncio.run(run_engine(dry_run=dry, limit=args.limit, pause_after=args.pause_after))
    sys.exit(code)


if __name__ == "__main__":
    main()
