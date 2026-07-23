"""
Long-lived Studio RPC — Python Telethon steps only.

Rust orchestrator owns the job/item queue and order. This process:
  begin   → connect session + resolve peer
  upload_one → prepare + upload + commit one file (existing media_studio helpers)
  finish  → disconnect
  ping / quit

Request (stdin JSON line):
  {"id":"1","cmd":"begin","session":"Lavender","api_id":..,"api_hash":"..","chat_id":"-100..","topic_id":null,"options":{}}
  {"id":"2","cmd":"upload_one","item":{"path":"...","caption":"","index":0},"transfer_id":"..."}
  {"id":"3","cmd":"finish"}

Response:
  {"id":"1","ok":true,"result":{...}}
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from typing import Any, Dict, Optional

from engine.utf8_io import ensure_utf8_stdio, print_json


def _out(obj: Dict[str, Any]) -> None:
    print_json(obj)


async def run_studio_serve(
    *,
    session_name: str = "Lavender",
    api_id: int = 0,
    api_hash: str = "",
) -> None:
    ensure_utf8_stdio()
    state: Dict[str, Any] = {
        "client": None,
        "entity": None,
        "session_name": session_name,
        "api_id": int(api_id or 0),
        "api_hash": str(api_hash or ""),
        "chat_id": None,
        "options": {},
        "transfer_id": None,
        "journal": None,
    }

    _out({"type": "ready", "backend": "studio-serve", "hybrid": "python_step"})

    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    async def handle(req: Dict[str, Any]) -> Any:
        cmd = str(req.get("cmd") or "").strip().lower().replace("-", "_")

        if cmd == "ping":
            connected = False
            try:
                c = state["client"]
                connected = bool(c is not None and c.is_connected())
            except Exception:
                connected = False
            return {"pong": True, "connected": connected}

        if cmd == "begin":
            from engine.media_studio import StudioOptions, _resolve_entity, _session_lease_hash
            from engine.drive_fs import _session_client as build_client
            from engine.transfer_journal import TransferJournal as TJ

            session = str(req.get("session") or state["session_name"] or "Lavender")
            api_id_v = int(req.get("api_id") or state["api_id"] or 0)
            api_hash_v = str(req.get("api_hash") or state["api_hash"] or "")
            chat_id = str(req.get("chat_id") or "")
            if not chat_id:
                raise ValueError("chat_id required")
            if not api_id_v or not api_hash_v:
                raise ValueError("api_id/api_hash required")

            opts_raw = req.get("options") or {}
            if not isinstance(opts_raw, dict):
                opts_raw = {}
            transfer_id = str(
                opts_raw.get("transfer_id")
                or opts_raw.get("transferId")
                or req.get("transfer_id")
                or f"orch-{os.getpid()}"
            )

            if state["client"] is not None:
                try:
                    await state["client"].disconnect()
                except Exception:
                    pass

            session_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sessions")
            session_file = os.path.join(session_dir, session)
            try:
                from engine.media_studio import patch_telethon_sqlite_session

                patch_telethon_sqlite_session()
            except Exception:
                pass
            try:
                from engine.drive_fs import _patch_session_wal as psw

                psw(session_file)
            except Exception:
                pass

            client = build_client(session, api_id_v, api_hash_v)
            await asyncio.wait_for(client.connect(), timeout=45.0)
            if not await client.is_user_authorized():
                await client.disconnect()
                raise RuntimeError("Session not authorized")

            entity = await _resolve_entity(client, chat_id)
            opts = StudioOptions(
                quality_mode=str(
                    opts_raw.get("quality_mode") or opts_raw.get("qualityMode") or "HIGH_QUALITY"
                ),
                concurrency=int(opts_raw.get("concurrency") or 2),
                group_as_album=bool(opts_raw.get("group_as_album") or opts_raw.get("groupAsAlbum")),
                silent=bool(opts_raw.get("silent")),
                spoiler=bool(opts_raw.get("spoiler")),
                compress=bool(opts_raw.get("compress")),
                topic_id=int(opts_raw["topic_id"])
                if opts_raw.get("topic_id")
                else (int(opts_raw["topicId"]) if opts_raw.get("topicId") else None),
                global_caption=str(
                    opts_raw.get("global_caption") or opts_raw.get("globalCaption") or ""
                ),
                reencode_hw=str(
                    opts_raw.get("reencode_hw") or opts_raw.get("reencodeHardware") or "auto"
                ),
                reencode_preset=str(
                    opts_raw.get("reencode_preset") or opts_raw.get("reencodePreset") or "balanced"
                ),
                duplicate_policy=str(
                    opts_raw.get("duplicate_policy") or opts_raw.get("duplicatePolicy") or "SKIP"
                ),
            )

            state.update(
                {
                    "client": client,
                    "entity": entity,
                    "session_name": session,
                    "api_id": api_id_v,
                    "api_hash": api_hash_v,
                    "chat_id": chat_id,
                    "options": opts,
                    "transfer_id": transfer_id,
                    "journal": TJ(transfer_id),
                    "session_key_hash": _session_lease_hash(session, api_id_v),
                }
            )
            state["journal"].append("orch_begin", critical=True, chat_id=chat_id)
            return {
                "status": "ready",
                "transfer_id": transfer_id,
                "session": session,
                "chat_id": chat_id,
            }

        if cmd in ("upload_one", "upload_item", "step_upload"):
            client = state.get("client")
            entity = state.get("entity")
            opts = state.get("options")
            if client is None or entity is None or opts is None:
                raise RuntimeError("call begin first")

            item_raw = req.get("item") or {}
            if isinstance(item_raw, str):
                item_raw = {"path": item_raw}
            path = str(item_raw.get("path") or item_raw.get("file") or "").strip()
            if not path:
                raise ValueError("item.path required")
            index = int(item_raw.get("index") or req.get("index") or 0)
            caption = str(item_raw.get("caption") or "")
            transfer_id = str(req.get("transfer_id") or state.get("transfer_id") or "orch")

            from engine.media_studio import (
                StudioItem,
                _run_fastlane_pipeline,
                ProgressAgg,
            )
            from engine.fast_transfer import resolve_upload_policy

            it = StudioItem(
                index=index,
                path=path,
                caption=caption,
                size=int(os.path.getsize(path)) if os.path.isfile(path) else 0,
                item_id=str(item_raw.get("item_id") or f"{transfer_id}:{index}"),
                original_name=os.path.basename(path),
            )
            items = [it]
            agg = ProgressAgg(total_bytes=it.size or 0, n_items=1)
            upload_policy = resolve_upload_policy(None)
            journal = state["journal"]
            journal.append(
                "orch_upload_one_start",
                critical=True,
                index=index,
                path=os.path.basename(path),
            )

            # Progress events as stdout lines for Rust orchestrator
            from engine import events as ev_mod

            def _forward(evt_type: str, **payload):
                _out(
                    {
                        "type": "studio_event",
                        "event": evt_type,
                        "transfer_id": transfer_id,
                        **payload,
                    }
                )

            # Monkey-patch emit for this step (best-effort)
            prev_emit = getattr(ev_mod, "emit_event", None)

            def emit_event(event_type, **payload):
                try:
                    _forward(str(event_type), **payload)
                except Exception:
                    pass
                if prev_emit:
                    try:
                        prev_emit(event_type, **payload)
                    except Exception:
                        pass

            ev_mod.emit_event = emit_event  # type: ignore

            try:
                await _run_fastlane_pipeline(
                    client,
                    entity,
                    items,
                    opts,
                    agg,
                    upload_policy=upload_policy,
                    dup_checker=None,
                    tg_exists={},
                    transfer_id=transfer_id,
                    session_key_hash=str(state.get("session_key_hash") or ""),
                    journal=journal,
                )
            finally:
                if prev_emit:
                    ev_mod.emit_event = prev_emit  # type: ignore

            status = it.status
            journal.append(
                "orch_upload_one_done",
                critical=True,
                index=index,
                status=status,
                message_id=it.message_id,
                error=it.error,
            )
            return {
                "status": status,
                "index": index,
                "item_id": it.item_id,
                "message_id": it.message_id,
                "error": it.error,
                "size": it.size,
                "duration_s": it.duration_s,
                "fingerprint": it.fingerprint,
            }

        if cmd in ("finish", "end", "close"):
            c = state.get("client")
            if c is not None:
                try:
                    await c.disconnect()
                except Exception:
                    pass
            if state.get("journal"):
                try:
                    state["journal"].append("orch_finish", critical=True)
                except Exception:
                    pass
            state["client"] = None
            state["entity"] = None
            return {"status": "finished"}

        if cmd in ("quit", "exit"):
            c = state.get("client")
            if c is not None:
                try:
                    await c.disconnect()
                except Exception:
                    pass
            _out({"id": req.get("id"), "ok": True, "result": {"bye": True}})
            raise SystemExit(0)

        raise ValueError(f"unknown cmd: {cmd}")

    while True:
        try:
            line = await reader.readline()
        except Exception:
            break
        if not line:
            break
        text = line.decode("utf-8", errors="replace").strip()
        if not text:
            continue
        try:
            req = json.loads(text)
        except Exception as e:
            _out({"ok": False, "error": f"bad json: {e}"})
            continue
        req_id = req.get("id")
        try:
            result = await handle(req)
            _out({"id": req_id, "ok": True, "result": result})
        except SystemExit:
            raise
        except Exception as e:
            _out(
                {
                    "id": req_id,
                    "ok": False,
                    "error": str(e),
                    "trace": traceback.format_exc()[-800:],
                }
            )
