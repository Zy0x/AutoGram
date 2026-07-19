"""
Long-lived Drive RPC: one Telethon connection, JSON lines on stdin/stdout.

Request (one line JSON):
  {"id":"1","cmd":"bootstrap","folder_id":null,"file_page_size":40,"chat_page_size":60}
  {"id":"2","cmd":"list_files","folder_id":-100…,"page_size":40,"offset_id":123}
  {"id":"3","cmd":"list_chats","page_size":60,"offset":0}
  {"id":"4","cmd":"thumbnails","folder_id":null,"message_ids":[1,2,3]}
  {"id":"5","cmd":"avatars","peer_ids":[0,123,-100…]}
  {"id":"6","cmd":"ping"}
  {"id":"7","cmd":"quit"}

Response:
  {"id":"1","ok":true,"result":{...}}
  {"id":"1","ok":false,"error":"..."}
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from typing import Any, Dict, Optional

from telethon import functions
from telethon.errors import AuthKeyError

from engine.drive_fs import (
    _connect,
    _list_chats_on,
    _list_files_on,
    _list_topics_on,
    invalidate_topics_cache,
    _get_create_forum_topic_cls,
    _get_delete_forum_topic_cls,
    _get_edit_forum_topic_cls,
    _resolve_peer,
    _scan_folders_on,
    _fetch_thumb_data_url,
    _disk_thumb_data_url,
    _ensure_dirs,
    _create_td_channel,
    _FOLDER_PARENT_CACHE,
    _compose_folder_about,
    get_avatars_batch_on_client,
    delete_folder_on_client,
    rename_folder_on_client,
    set_folder_parent_on_client,
    FOLDER_TITLE_SUFFIX,
    FOLDER_ABOUT_TAG,
    DRIVE_FOLDER_SOFT_LIMIT,
)
from engine.utf8_io import ensure_utf8_stdio, print_json


def _out(obj: Dict[str, Any]) -> None:
    print_json(obj)


def _is_disconnect_error(err: BaseException) -> bool:
    msg = str(err or "").lower()
    return (
        "while disconnected" in msg
        or "not connected" in msg
        or "connection closed" in msg
        or "server closed the connection" in msg
        or "cannot send requests" in msg
    )


async def _ensure_connected(
    client: Any,
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
) -> Any:
    """
    Warm drive-serve keeps one Telethon client for hours. TCP can die while the
    process still runs — UI still says 'terhubung' but preview fails with
    'Cannot send requests while disconnected'. Reconnect before every RPC.
    """
    try:
        if client is not None and client.is_connected():
            return client
    except Exception:
        pass

    # Soft reconnect existing client object (reuses session handle)
    if client is not None:
        try:
            await client.connect()
            if client.is_connected() and await client.is_user_authorized():
                return client
        except Exception:
            pass
        try:
            await client.disconnect()
        except Exception:
            pass

    return await _connect(session_name, api_id, api_hash)


async def _handle(client, req: Dict[str, Any]) -> Any:
    cmd = str(req.get("cmd") or "").strip().lower().replace("-", "_")
    folder_id = req.get("folder_id", None)
    if folder_id in ("", "null", "None", "me", "home"):
        folder_id = None
    elif folder_id is not None:
        folder_id = int(folder_id)

    if cmd == "ping":
        connected = False
        ms = None
        try:
            connected = bool(client is not None and client.is_connected())
            if connected:
                import time
                import random
                from telethon.functions import PingRequest
                try:
                    t0 = time.time()
                    # Wait at most 1.5 seconds for ping response (fast timeout)
                    await asyncio.wait_for(
                        client(PingRequest(ping_id=random.randint(0, 1000000))),
                        timeout=1.5
                    )
                    ms = int((time.time() - t0) * 1000)
                except Exception:
                    # Do not set connected=False if PingRequest fails due to timeout/busy channel.
                    # As long as client.is_connected() returned True, we are still connected.
                    ms = None
        except Exception:
            connected = False
        return {"pong": True, "connected": connected, "ms": ms}

    def _parse_topic_id(raw) -> Optional[int]:
        if raw in (None, "", "null", "None", "all", "ALL", 0, "0"):
            return None
        try:
            v = int(raw)
            return v if v > 0 else None
        except Exception:
            return None

    if cmd in ("bootstrap",):
        import asyncio

        fps = int(req.get("file_page_size") or req.get("page_size") or 28)
        cps = int(req.get("chat_page_size") or 32)
        tid = _parse_topic_id(req.get("topic_id"))
        # Fast first paint:
        # 1) chats first (small page — unblocks sidebar)
        # 2) files without SearchCounters
        # Folders: cache only here (full dialog walk deferred to scan_folders)
        from engine.drive_fs import _FOLDERS_CACHE, _FOLDERS_CACHE_TTL_S
        import time as _time

        # Parallel fetch chats and files to reduce initial load latency
        chats_task = _list_chats_on(client, limit=cps, offset=0)
        files_task = _list_files_on(
            client,
            folder_id=folder_id,
            page_size=fps,
            offset_id=None,
            scan_budget=min(160, fps * 4),
            topic_id=tid,
            quick_stats=False,
        )
        chats_pack, files_pack = await asyncio.gather(chats_task, files_task)

        folders = []
        if _FOLDERS_CACHE.get("folders") and (
            _time.time() - float(_FOLDERS_CACHE.get("ts") or 0)
        ) < _FOLDERS_CACHE_TTL_S:
            folders = [dict(f) for f in _FOLDERS_CACHE["folders"]]
        return {
            "status": "success",
            "folders": folders,
            "chats": chats_pack["chats"],
            "chats_has_more": chats_pack["has_more"],
            "chats_next_offset": chats_pack["next_offset"],
            "chats_next_offset_id": chats_pack.get("next_offset_id"),
            "chats_next_offset_date": chats_pack.get("next_offset_date"),
            "chats_next_offset_peer_id": chats_pack.get("next_offset_peer_id"),
            "files": files_pack["files"],
            "files_has_more": files_pack["has_more"],
            "next_offset_id": files_pack["next_offset_id"],
            "total_count": files_pack.get("total_count"),
            "total_bytes": files_pack.get("total_bytes"),
            "stats_accurate": bool(files_pack.get("stats_accurate")),
            "stats_pending": bool(files_pack.get("stats_pending", True)),
            "folder_id": folder_id,
            "topic_id": tid,
        }

    if cmd in ("list_files", "list-files"):
        ps = int(req.get("page_size") or req.get("limit") or 40)
        oid = req.get("offset_id")
        oid = int(oid) if oid not in (None, "", 0, "0") else None
        tid = _parse_topic_id(req.get("topic_id"))
        sort_mode = req.get("sort_mode") or "newest_first"
        # Lower scan_budget default: media filters make large history scans rare
        pack = await _list_files_on(
            client,
            folder_id=folder_id,
            page_size=ps,
            offset_id=oid,
            scan_budget=int(req.get("scan_budget") or min(200, max(ps * 3, 80))),
            topic_id=tid,
            quick_stats=bool(req.get("quick_stats", True)),
            sort_mode=sort_mode,
        )
        return {"status": "success", **pack}

    if cmd in ("get_message", "get-message", "get_file", "get-file"):
        mid = req.get("message_id")
        if not mid:
            return {"status": "error", "message": "message_id required"}
        from engine.drive_fs import message_to_drive_file, _attach_topic_id
        try:
            msg = await client.get_messages(peer, ids=int(mid))
            if not msg:
                return {"status": "error", "message": "Pesan tidak ditemukan"}
            item = message_to_drive_file(msg, folder_id)
            if not item:
                return {"status": "error", "message": "Pesan bukan media valid"}
            _attach_topic_id(msg, item)
            return {"status": "success", "file": item}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    if cmd in ("media_stats", "media-stats", "drive_media_stats", "stats"):
        from engine.drive_fs import media_stats_on_client

        tid = _parse_topic_id(req.get("topic_id"))
        force = bool(req.get("force") or req.get("refresh"))
        peek = bool(req.get("peek") or req.get("cache_only"))
        return await media_stats_on_client(
            client,
            folder_id=folder_id,
            topic_id=tid,
            force=force,
            peek=peek,
        )

    if cmd in ("list_topics", "list-topics"):
        if folder_id is None:
            return {"status": "success", "topics": [], "is_forum": False}
        pack = await _list_topics_on(client, int(folder_id))
        return {
            "status": "success",
            "chat_id": int(folder_id),
            "is_forum": bool(pack.get("is_forum")),
            "topics": pack.get("topics") or [],
        }

    if cmd in ("create_topic", "create-topic"):
        title = req.get("title")
        if folder_id is None or not title:
            raise ValueError("folder_id and title are required for create_topic")

        CreateForumTopicCls = _get_create_forum_topic_cls()
        peer = await _resolve_peer(client, int(folder_id))
        result = await client(
            CreateForumTopicCls(
                channel=peer,
                title=str(title),
            )
        )
        invalidate_topics_cache(int(folder_id))

        topic_id = None
        for update in getattr(result, "updates", []):
            if type(update).__name__ in ("UpdateNewForumTopic", "UpdateNewForumTopicWrapper"):
                topic = getattr(update, "topic", None)
                if topic:
                    topic_id = getattr(topic, "id", None)
                    break

        if topic_id is None:
            for update in getattr(result, "updates", []):
                if hasattr(update, "id"):
                    topic_id = getattr(update, "id")
                elif hasattr(update, "topic_id"):
                    topic_id = getattr(update, "topic_id")

        return {
            "status": "success",
            "chat_id": int(folder_id),
            "topic_id": topic_id,
            "title": str(title),
        }

    if cmd in ("delete_topic", "delete-topic"):
        raw_tid = req.get("topic_id") or req.get("topicId")
        if folder_id is None or raw_tid is None:
            raise ValueError("folder_id and topic_id are required for delete_topic")

        DeleteCls = _get_delete_forum_topic_cls()
        peer = await _resolve_peer(client, int(folder_id))
        await client(DeleteCls(channel=peer, top_msg_id=int(raw_tid)))
        invalidate_topics_cache(int(folder_id))
        return {
            "status": "success",
            "chat_id": int(folder_id),
            "topic_id": int(raw_tid),
        }

    if cmd in ("rename_topic", "rename-topic"):
        raw_tid = req.get("topic_id") or req.get("topicId")
        title = req.get("title") or req.get("name")
        if folder_id is None or raw_tid is None or not title:
            raise ValueError("folder_id, topic_id, and title are required for rename_topic")

        EditCls = _get_edit_forum_topic_cls()
        peer = await _resolve_peer(client, int(folder_id))
        await client(
            EditCls(
                peer=peer,
                topic_id=int(raw_tid),
                title=str(title),
            )
        )
        invalidate_topics_cache(int(folder_id))
        return {
            "status": "success",
            "chat_id": int(folder_id),
            "topic_id": int(raw_tid),
            "name": str(title),
        }

    if cmd in ("list_chats", "list-chats"):
        od = req.get("offset_date") or req.get("offsetDate")
        op = req.get("offset_peer_id") or req.get("offsetPeerId")
        oi = req.get("offset_id") or req.get("offsetId") or 0
        pack = await _list_chats_on(
            client,
            limit=int(req.get("page_size") or req.get("limit") or 100),
            offset=int(req.get("offset") or 0),
            offset_id=int(oi or 0),
            offset_date=od,
            offset_peer_id=int(op) if op not in (None, "", 0, "0") else None,
            chat_folder_id=(
                int(req.get("chat_folder_id") or req.get("chatFolderId"))
                if (req.get("chat_folder_id") or req.get("chatFolderId")) not in (None, "", 0, "0")
                else None
            ),
        )
        return {"status": "success", **pack}

    if cmd in ("list_chat_folders", "list-chat-folders"):
        from engine.drive_fs import _list_chat_folders_on

        folders = await _list_chat_folders_on(client, force=bool(req.get("force")))
        return {"status": "success", "folders": folders}

    if cmd in ("scan_folders", "scan-folders"):
        enrich = req.get("enrich_parents")
        if enrich is None:
            enrich = True
        folders = await _scan_folders_on(
            client,
            enrich_parents=bool(enrich),
            use_cache=bool(req.get("use_cache", True)),
        )
        return {"status": "success", "folders": folders}

    if cmd in ("delete_folder", "delete-folder"):
        fid = req.get("folder_id", req.get("folderId", folder_id))
        if fid in (None, "", "null", "None"):
            raise ValueError("folder_id required")
        cascade = bool(req.get("cascade"))
        detach = bool(
            req.get("detach_children") or req.get("detachChildren") or req.get("detach")
        )
        return await delete_folder_on_client(
            client, int(fid), cascade=cascade, detach_children=detach
        )

    if cmd in ("rename_folder", "rename-folder"):
        fid = req.get("folder_id", req.get("folderId", folder_id))
        if fid in (None, "", "null", "None"):
            raise ValueError("folder_id required")
        return await rename_folder_on_client(
            client, int(fid), str(req.get("name") or "")
        )

    if cmd in ("set_folder_parent", "set-folder-parent", "reparent_folder", "reparent-folder"):
        fid = req.get("folder_id", req.get("folderId", folder_id))
        if fid in (None, "", "null", "None"):
            raise ValueError("folder_id required")
        raw_parent = req.get("parent_id", req.get("parentId"))
        parent_id = None
        if raw_parent not in (None, "", "null", "None"):
            try:
                parent_id = int(raw_parent)
            except Exception:
                parent_id = None
        return await set_folder_parent_on_client(client, int(fid), parent_id)

    if cmd in ("create_folder", "create-folder"):
        # Uses module-level imports only — local "from engine.drive_fs import
        # _scan_folders_on" would make the name local for ALL of _handle and break
        # bootstrap (UnboundLocalError: not associated with a value).
        clean = re.sub(r"\s+", " ", str(req.get("name") or "").strip())
        if not clean:
            raise ValueError("Folder name required")
        if FOLDER_TITLE_SUFFIX.strip() in clean:
            clean = clean.replace(FOLDER_TITLE_SUFFIX.strip(), "").strip()
        title = f"{clean}{FOLDER_TITLE_SUFFIX}"
        raw_parent = req.get("parent_id", req.get("parentId"))
        parent_id = None
        if raw_parent not in (None, "", "null", "None", 0, "0"):
            try:
                parent_id = int(raw_parent)
            except Exception:
                parent_id = None
        about = _compose_folder_about(parent_id)
        folder_count_warn = None
        try:
            n = len(await _scan_folders_on(client))
            if n >= DRIVE_FOLDER_SOFT_LIMIT:
                folder_count_warn = (
                    f"Sudah ada {n} Drive/Folder [TD]. "
                    f"Mendekati batas channel Telegram (~500). "
                    "Pertimbangkan pindah hierarki/hapus item lama."
                )
        except Exception:
            pass
        ch = await _create_td_channel(client, title=title, about=about)
        entity = None
        try:
            entity = await client.get_entity(ch)
            peer_id = int(await client.get_peer_id(entity))
        except Exception:
            fid = int(getattr(ch, "id", 0))
            peer_id = -1000000000000 - fid if fid > 0 else fid
        if parent_id is not None and entity is not None:
            try:
                await client(
                    functions.messages.EditChatAboutRequest(peer=entity, about=about)
                )
            except Exception:
                pass
        try:
            _FOLDER_PARENT_CACHE[peer_id] = parent_id
        except Exception:
            pass
        out = {
            "status": "success",
            "folder": {
                "id": peer_id,
                "name": clean,
                "title_raw": title,
                "username": None,
                "is_public": False,
                "parent_id": parent_id,
                "is_drive_folder": True,
                "is_orphan": False,
            },
        }
        if folder_count_warn:
            out["warning"] = folder_count_warn
        return out

    if cmd in ("thumbnails", "thumbnails_batch"):
        import asyncio as _aio

        from engine.drive_fs import _normalize_thumb_quality, _thumb_profile

        _ensure_dirs()
        qname = _normalize_thumb_quality(
            req.get("quality") or req.get("thumb_quality") or req.get("thumbQuality")
        )
        prof = _thumb_profile(qname)
        batch = max(int(prof.get("batch") or 12), 8)
        # Allow client to request larger batches on fast devices (hard cap 24)
        try:
            req_batch = int(req.get("batch_size") or req.get("batchSize") or 0)
            if req_batch > 0:
                batch = max(batch, min(req_batch, 24))
        except Exception:
            pass
        ids = [int(x) for x in (req.get("message_ids") or [])][:batch]
        thumbs: Dict[str, Optional[str]] = {}
        need = []
        for mid in ids:
            hit = _disk_thumb_data_url(folder_id, mid, qname)
            if hit is not None:
                thumbs[str(mid)] = hit or None
            else:
                need.append(mid)
        nosample_ids: list = []
        if need:
            from engine.drive_fs import (
                _cache_key,
                _thumb_nosample_active,
                _stream_sample_base_key,
            )

            peer = await _resolve_peer(client, folder_id)
            # Resolve metadata for the entire batch in one Telegram request.
            # Previously every image/video repeated get_messages before its
            # static thumbnail download, dominating cold-grid latency.
            preloaded: Dict[int, Any] = {}
            try:
                messages = await client.get_messages(peer, ids=need)
                if not isinstance(messages, (list, tuple)):
                    messages = [messages]
                preloaded = {
                    int(getattr(message, "id", 0)): message
                    for message in messages
                    if message is not None and int(getattr(message, "id", 0) or 0) > 0
                }
            except Exception:
                # Fall back per item; thumbnail failure must not block the grid.
                preloaded = {}
            # Parallel fetch (bounded) — sequential was the grid scroll bottleneck
            conc = max(1, min(int(prof.get("concurrency") or 3), 6))
            sem = _aio.Semaphore(conc)

            async def _one(mid: int):
                async with sem:
                    try:
                        url = await _aio.wait_for(
                            _fetch_thumb_data_url(
                                client,
                                peer,
                                folder_id,
                                mid,
                                quality=qname,
                                preloaded_message=preloaded.get(mid),
                                message_preloaded=mid in preloaded,
                            ),
                            timeout=15.0
                        )
                        return mid, url
                    except Exception:
                        return mid, None

            results = await _aio.gather(*[_one(m) for m in need])
            for mid, url in results:
                thumbs[str(mid)] = url
                if url is None:
                    try:
                        key = _stream_sample_base_key(_cache_key(folder_id, mid))
                        if _thumb_nosample_active(key):
                            nosample_ids.append(int(mid))
                    except Exception:
                        pass
        return {
            "status": "success",
            "thumbs": thumbs,
            "fetched": len(need),
            "quality": qname,
            "nosample_ids": nosample_ids,
        }

    if cmd in ("avatars", "avatars_batch", "profile_photos", "profile-photos"):
        raw = req.get("peer_ids") or req.get("peerIds") or []
        pids: list = []
        for x in raw:
            try:
                pids.append(int(x))
            except Exception:
                continue
        return await get_avatars_batch_on_client(client, pids)

    if cmd in ("preview", "preview_stream", "stream_preview"):
        from engine.drive_fs import start_preview_stream_on_client

        mid = req.get("message_id")
        if mid is None:
            raise ValueError("message_id required")
        pq = req.get("quality") or req.get("play_quality") or req.get("playQuality")
        sp = req.get("skip_poster")
        if sp is None:
            sp = req.get("skipPoster")
        skip_p = True if sp is None else bool(sp)
        return await start_preview_stream_on_client(
            client,
            folder_id=folder_id,
            message_id=int(mid),
            quality=str(pq) if pq is not None else None,
            skip_poster=skip_p,
        )

    if cmd in ("preview_warm", "warm_preview", "warm_preview_head"):
        from engine.drive_fs import warm_preview_head_on_client

        mid = req.get("message_id")
        if mid is None:
            raise ValueError("message_id required")
        hb = req.get("head_bytes") or req.get("bytes") or 768 * 1024
        return await warm_preview_head_on_client(
            client,
            folder_id=folder_id,
            message_id=int(mid),
            head_bytes=int(hb),
        )

    if cmd in ("stream_status", "preview_status"):
        from engine.media_stream import stream_status

        sid = str(req.get("stream_id") or "")
        return {"status": "success", **stream_status(sid)}

    if cmd in (
        "stop_stream",
        "stream_stop",
        "preview_stop",
        "stop_preview_stream",
    ):
        from engine.media_stream import stop_all_streams, stop_stream

        sid = str(req.get("stream_id") or "").strip()
        stop_all = bool(req.get("stop_all") or req.get("all"))
        if stop_all or sid in ("*", "all", "__all__"):
            return stop_all_streams(
                incomplete_only=bool(req.get("incomplete_only", True))
            )
        if not sid:
            raise ValueError("stream_id required (or stop_all=true)")
        return {
            "status": "success",
            **stop_stream(
                sid,
                delete_partial=bool(req.get("delete_partial", True)),
            ),
        }

    if cmd in ("stream_seek", "seek_stream", "preview_seek"):
        from engine.media_stream import stream_seek

        sid = str(req.get("stream_id") or "").strip()
        if not sid:
            raise ValueError("stream_id required")
        off = req.get("offset")
        time_s = req.get("time_s") or req.get("time")
        duration_s = req.get("duration_s") or req.get("duration")
        return {
            "status": "success",
            **stream_seek(
                sid,
                offset=int(off) if off is not None else None,
                time_s=float(time_s) if time_s is not None else None,
                duration_s=float(duration_s) if duration_s is not None else None,
            ),
        }

    if cmd in ("zip_list", "zip-list", "drive_zip_list"):
        from engine.drive_fs import zip_list_on_client

        mid = req.get("message_id")
        if mid is None:
            raise ValueError("message_id required")
        return await zip_list_on_client(
            client, folder_id=folder_id, message_id=int(mid)
        )

    if cmd in ("zip_read", "zip-read", "drive_zip_read", "zip_entry"):
        from engine.drive_fs import zip_read_entry_on_client

        mid = req.get("message_id")
        if mid is None:
            raise ValueError("message_id required")
        entry = str(req.get("entry") or req.get("entry_name") or req.get("path") or "")
        if not entry:
            raise ValueError("entry required")
        return await zip_read_entry_on_client(
            client,
            folder_id=folder_id,
            message_id=int(mid),
            entry_name=entry,
            password=req.get("password"),
        )

    # ── Mutating ops on warm client (avoid second process + session lock) ──
    if cmd in ("delete", "drive_delete"):
        from engine.drive_fs import delete_file_on_client

        mid = req.get("message_id")
        if mid is None:
            raise ValueError("message_id required")
        return await delete_file_on_client(client, int(mid), folder_id)

    if cmd in ("delete_batch", "delete-batch", "drive_delete_batch"):
        from engine.drive_fs import delete_files_batch_on_client

        raw = req.get("message_ids") or []
        ids = [int(x) for x in raw if x is not None]
        if not ids:
            raise ValueError("message_ids required")
        return await delete_files_batch_on_client(client, ids, folder_id)

    if cmd in ("rename", "drive_rename"):
        from engine.drive_fs import rename_file_on_client

        mid = req.get("message_id")
        if mid is None:
            raise ValueError("message_id required")
        name = str(req.get("name") or req.get("new_name") or "").strip()
        return await rename_file_on_client(client, int(mid), name, folder_id)

    if cmd in ("move", "drive_move"):
        from engine.drive_fs import move_file_on_client

        mid = req.get("message_id")
        if mid is None:
            raise ValueError("message_id required")
        to_raw = req.get("to_folder_id", req.get("toFolderId"))
        if to_raw in ("", "null", "None", "me", "home"):
            to_fid = None
        elif to_raw is not None:
            to_fid = int(to_raw)
        else:
            to_fid = None
        raw_tid = req.get("topic_id", req.get("topicId"))
        try:
            tid = int(raw_tid) if raw_tid not in (None, "", 0, "0") else None
        except Exception:
            tid = None
        del_src = req.get("delete_source", req.get("deleteSource"))
        if del_src is None:
            del_src = True
        return await move_file_on_client(
            client,
            int(mid),
            folder_id,
            to_fid,
            topic_id=tid,
            delete_source=bool(del_src),
        )

    if cmd in ("index_folder", "index-folder"):
        if folder_id is None:
            raise ValueError("folder_id required for index_folder")
        tid = _parse_topic_id(req.get("topic_id"))
        job_id = req.get("job_id")
        req_id = req.get("id")
        async def _progress(evt):
            evt["id"] = req_id
            print(json.dumps(evt), flush=True)
            
        from engine.drive_fs import index_folder_on_client
        result = await index_folder_on_client(
            client,
            folder_id=int(folder_id),
            topic_id=tid,
            job_id=job_id,
            progress_callback=_progress
        )
        return result

    if cmd == "quit":
        return {"bye": True}

    raise ValueError(f"Unknown cmd: {cmd}")


def _register_event_handlers(client: TelegramClient):
    from telethon import events
    
    @client.on(events.NewMessage)
    async def _on_new_message(event):
        try:
            msg = event.message
            if not msg:
                return
            chat_id = int(event.chat_id) if event.chat_id else None
            if chat_id is None:
                return
            from engine.drive_fs import message_to_drive_file, _attach_topic_id
            item = message_to_drive_file(msg, chat_id)
            if item:
                _attach_topic_id(msg, item)
                _out({
                    "type": "update",
                    "action": "new",
                    "folder_id": chat_id,
                    "file": item
                })
        except Exception:
            pass

    @client.on(events.MessageDeleted)
    async def _on_message_deleted(event):
        try:
            chat_id = int(event.chat_id) if event.chat_id else None
            if event.deleted_ids:
                _out({
                    "type": "update",
                    "action": "delete",
                    "folder_id": chat_id,
                    "message_ids": [int(x) for x in event.deleted_ids]
                })
        except Exception:
            pass

    @client.on(events.MessageEdited)
    async def _on_message_edited(event):
        try:
            msg = event.message
            if not msg:
                return
            chat_id = int(event.chat_id) if event.chat_id else None
            if chat_id is None:
                return
            from engine.drive_fs import message_to_drive_file, _attach_topic_id
            item = message_to_drive_file(msg, chat_id)
            if item:
                _attach_topic_id(msg, item)
                _out({
                    "type": "update",
                    "action": "edit",
                    "folder_id": chat_id,
                    "file": item
                })
        except Exception:
            pass


async def run_drive_serve(*, session_name: str, api_id: int, api_hash: str) -> None:
    """
    Long-lived RPC. Handles requests concurrently so thumbnail batches
    do not block list_files / load-more (sequential stdin previously made
    "Scroll for more…" wait behind every thumb download).

    Ready is emitted BEFORE Telethon connect finishes so the UI can mark the
    warm session up quickly; RPCs wait on _live_client until connected.
    """
    ensure_utf8_stdio()
    # Mutable holder — reconnect may replace the TelegramClient instance
    state: Dict[str, Any] = {
        "client": None,
        "session_name": session_name,
        "api_id": int(api_id),
        "api_hash": str(api_hash),
        "connect_error": None,
    }
    # Signal process up immediately (connect continues in background)
    _out({"type": "ready", "session": session_name, "connecting": True})
    loop = asyncio.get_event_loop()

    async def _bg_connect() -> None:
        try:
            state["client"] = await _connect(session_name, api_id, api_hash)
            _register_event_handlers(state["client"])
            _out({"type": "connected", "session": session_name})
        except Exception as e:
            state["connect_error"] = str(e)
            try:
                print(f"[drive_serve] connect failed: {e}", flush=True)
            except Exception:
                pass

    connect_task = asyncio.create_task(_bg_connect())

    # Media work is bounded so a fast frontend cannot multiply one thumbnail
    # batch into enough concurrent Telegram work to exhaust memory/sockets.
    thumb_sem = asyncio.Semaphore(4)
    # History-wide scans are strictly serial and never share the visible-media
    # lane. They remain live/eventual while first-paint commands keep priority.
    background_sem = asyncio.Semaphore(1)
    # Serialize reconnect so concurrent RPCs don't thrash connect()
    connect_lock = asyncio.Lock()
    tasks: set = set()
    # Only the newest location-wide count is useful to the UI. A stale walk from
    # a location the user already left must not hold the background lane.
    stats_tasks: Dict[tuple, asyncio.Task] = {}

    # HIGH: user-visible first paint and direct user actions.
    HIGH = {
        "list_files",
        "list-files",
        "bootstrap",
        "list_chats",
        "list-chats",
        "list_chat_folders",
        "list-chat-folders",
        "list_topics",
        "list-topics",
        "preview",
        "preview_stream",
        "stream_preview",
        "preview_warm",
        "warm_preview",
        "warm_preview_head",
        "zip_list",
        "zip-list",
        "drive_zip_list",
        "zip_read",
        "zip-read",
        "drive_zip_read",
        "zip_entry",
        "stream_status",
        "preview_status",
        "stop_stream",
        "stream_stop",
        "preview_stop",
        "stop_preview_stream",
        "stream_seek",
        "seek_stream",
        "preview_seek",
        "delete",
        "delete_batch",
        "rename",
        "move",
        "ping",
        "create_folder",
        "create-folder",
        "create_topic",
        "create-topic",
        "delete_folder",
        "delete-folder",
        "rename_folder",
        "rename-folder",
        "set_folder_parent",
        "set-folder-parent",
        "reparent_folder",
        "reparent-folder",
        "create_topic",
        "create-topic",
        "delete_topic",
        "delete-topic",
        "rename_topic",
        "rename-topic",
    }
    BACKGROUND = {
        "scan_folders",
        "media_stats",
        "drive_media_stats",
        "stats",
        "index_folder",
        "index-folder",
    }

    async def _live_client() -> Any:
        # Wait for initial connect (UI already got "ready")
        if state["client"] is None and not connect_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(connect_task), timeout=45.0)
            except Exception:
                pass
        if state["client"] is None and state.get("connect_error"):
            raise RuntimeError(f"Telegram connect failed: {state['connect_error']}")
        async with connect_lock:
            state["client"] = await _ensure_connected(
                state["client"],
                session_name=state["session_name"],
                api_id=state["api_id"],
                api_hash=state["api_hash"],
            )
            return state["client"]

    async def _run_one(req: Dict[str, Any], *, lane: str) -> None:
        req_id = req.get("id")
        last_err: Optional[BaseException] = None
        try:
            for attempt in range(2):
                try:
                    client = await _live_client()

                    async def _do():
                        return await _handle(client, req)

                    if lane == "high":
                        result = await _do()
                    elif lane == "background":
                        async with background_sem:
                            result = await _do()
                    else:
                        async with thumb_sem:
                            result = await _do()
                    _out({"id": req_id, "ok": True, "result": result})
                    return
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    last_err = e
                    # One hard reconnect + retry (covers half-open sockets)
                    if attempt == 0 and (
                        _is_disconnect_error(e) or isinstance(e, (ConnectionError, OSError, AuthKeyError))
                    ):
                        async with connect_lock:
                            try:
                                await state["client"].disconnect()
                            except Exception:
                                pass
                            try:
                                state["client"] = await _connect(
                                    state["session_name"],
                                    state["api_id"],
                                    state["api_hash"],
                                )
                            except Exception as re_err:
                                last_err = re_err
                                break
                        continue
                    break
        except asyncio.CancelledError:
            # Resolve the frontend promise promptly when a newer location
            # supersedes this history-wide scan; never leave it until timeout.
            _out({
                "id": req_id,
                "ok": False,
                "error": "Media stats superseded by newer location",
            })
            return
        err_msg = str(last_err) if last_err else "Drive serve error"
        if _is_disconnect_error(last_err or Exception(err_msg)):
            err_msg = (
                "Koneksi Telegram terputus. Coba lagi — Drive akan menyambung ulang otomatis."
            )
        _out({"id": req_id, "ok": False, "error": err_msg})

    try:
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except Exception as e:
                _out({"id": None, "ok": False, "error": f"bad json: {e}"})
                continue
            cmd = str(req.get("cmd") or "").strip().lower().replace("-", "_")
            if cmd == "quit":
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)
                _out({"id": req.get("id"), "ok": True, "result": {"bye": True}})
                break

            is_stats = cmd in {"media_stats", "drive_media_stats", "stats"}
            is_stats_peek = is_stats and bool(req.get("peek") or req.get("cache_only"))
            if is_stats_peek:
                # Cache-only progress reads must never queue behind the scan they
                # are observing. They perform no Telegram history traversal.
                t = asyncio.create_task(_run_one(req, lane="high"))
                tasks.add(t)
                t.add_done_callback(lambda task: tasks.discard(task))
            elif is_stats:
                stats_key = (
                    req.get("folder_id"),
                    req.get("topic_id"),
                )
                # Latest location wins. Preserve same-key requests so the
                # media_stats in-flight deduper can share their result.
                for old_key, old_task in list(stats_tasks.items()):
                    if old_key != stats_key and not old_task.done():
                        old_task.cancel()
                t = asyncio.create_task(_run_one(req, lane="background"))
                stats_tasks[stats_key] = t
                tasks.add(t)

                def _drop_stats(task, key=stats_key):
                    tasks.discard(task)
                    if stats_tasks.get(key) is task:
                        stats_tasks.pop(key, None)

                t.add_done_callback(_drop_stats)
            elif cmd in BACKGROUND:
                t = asyncio.create_task(_run_one(req, lane="background"))
                tasks.add(t)
                t.add_done_callback(lambda task: tasks.discard(task))
            # High-priority: visible lists and direct actions run immediately.
            elif cmd in HIGH or cmd.replace("_", "-") in HIGH:
                # Also fire as task so stdin keeps reading; await only if nothing else
                t = asyncio.create_task(_run_one(req, lane="high"))
                tasks.add(t)
                t.add_done_callback(lambda task: tasks.discard(task))
            else:
                t = asyncio.create_task(_run_one(req, lane="media"))
                tasks.add(t)
                t.add_done_callback(lambda task: tasks.discard(task))
                if len(tasks) > 32:
                    done = {x for x in tasks if x.done()}
                    tasks -= done
    finally:
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await state["client"].disconnect()
        except Exception:
            pass
