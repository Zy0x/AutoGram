import argparse
import asyncio
import sys
import json
import os
import sqlite3
import datetime
from engine.forwarder import MigrationForwarder
from engine.enterprise.engine import EnterpriseEngine
from engine.sync_engine import SyncEngine
from engine.events import setup_emitter, emit_event
from core.client import create_client
from telethon import functions, TelegramClient

import re

class TeeStream:
    def __init__(self, stream, log_file):
        self.stream = stream
        self.log_file = log_file
        self._closed = False
        
        # Regex untuk mendeteksi nomor telepon (minimal 10 digit, opsional dengan +)
        self.phone_regex = re.compile(r'(\+?\d{2,4}[-\s]?\d{8,12})')
        # Regex untuk string panjang alfanumerik (seperti API Hash, Session String, atau Token)
        self.hash_regex = re.compile(r'([a-zA-Z0-9_-]{30,})')

    def write(self, data):
        if data is None or self._closed:
            return 0
        if isinstance(data, bytes):
            try:
                data = data.decode('utf-8', errors='replace')
            except Exception:
                data = str(data)
        try:
            self.stream.write(data)
            self.stream.flush()
        except UnicodeEncodeError:
            try:
                buf = getattr(self.stream, 'buffer', None)
                if buf is not None:
                    buf.write(str(data).encode('utf-8', errors='replace'))
                    buf.flush()
            except Exception:
                pass
        except Exception:
            pass
        
        try:
            safe_data = self.phone_regex.sub('***[PHONE REDACTED]***', data)
            safe_data = self.hash_regex.sub('***[HASH REDACTED]***', safe_data)
            with open(self.log_file, "a", encoding="utf-8", errors='replace') as f:
                f.write(safe_data)
        except Exception:
            pass
        return len(data) if isinstance(data, str) else 0

    def flush(self):
        try:
            if not self._closed:
                self.stream.flush()
        except Exception:
            pass

    def close(self):
        self._closed = True

    @property
    def encoding(self):
        return getattr(self.stream, 'encoding', 'utf-8')

    def isatty(self):
        return False

def parse_entity(entity_str):
    if not entity_str:
        return entity_str
    
    entity_str = str(entity_str)
    # Jika formatnya adalah ID_Topik (contoh: -100123_5), ambil ID dasar saja
    if '_' in entity_str:
        base_id = entity_str.split('_')[0]
        if base_id.lstrip('-').isdigit():
            return int(base_id)
            
    if entity_str.lstrip('-').isdigit():
        return int(entity_str)
    return entity_str
from database.queries import (
    get_all_jobs, delete_job, create_job, get_job, 
    get_profiles, save_profile, delete_profile,
    create_automation_job, get_automation_jobs, update_automation_job_status, delete_automation_job
)
from database.db import get_connection

async def list_dialogs(session_name, api_id, api_hash, chat_folder_id=None):
    try:
        try:
            from core.ghost_session import GhostSessionManager
            effective_session = GhostSessionManager.ensure_ghost(session_name, GhostSessionManager.PREVIEW_SUFFIX)
        except Exception as ge:
            print(f"[WARNING] Failed to clone preview session: {ge}", file=sys.stderr)
            effective_session = session_name

        # Create client without interactive prompts (assuming session exists)
        client = await create_client(
            session_name=effective_session,
            api_id_arg=api_id,
            api_hash_arg=api_hash,
            phone_callback=lambda: "",
            code_callback=lambda: "",
            password_callback=lambda: ""
        )
        
        selected_filter = None
        if chat_folder_id is not None and int(chat_folder_id) != 0:
            try:
                from engine.drive_fs import _get_chat_filter_on, _dialog_matches_chat_filter
                selected_filter = await _get_chat_filter_on(client, int(chat_folder_id))
            except Exception as fe:
                print(f"[WARNING] Failed to load chat folder filter: {fe}", file=sys.stderr)

        dialogs_list = []
        scanned = 0
        async for dialog in client.iter_dialogs():
            scanned += 1
            if scanned > 300 and not selected_filter:
                break
            if scanned > 1000:  # safety limit when filter is active
                break

            if selected_filter:
                try:
                    from engine.drive_fs import _dialog_matches_chat_filter
                    if not _dialog_matches_chat_filter(dialog, selected_filter):
                        continue
                except Exception:
                    pass

            is_forum = getattr(dialog.entity, "forum", False)
            
            # Determine type
            dialog_type = "Unknown"
            if dialog.is_user:
                dialog_type = "Bot" if getattr(dialog.entity, "bot", False) else "User"
            elif dialog.is_group:
                dialog_type = "Group"
            elif dialog.is_channel:
                if getattr(dialog.entity, "megagroup", False):
                    dialog_type = "Group"
                else:
                    dialog_type = "Channel"
                    
            if dialog_type == "Unknown":
                dialog_type = type(dialog.entity).__name__ if dialog.entity else "NoEntity"
                    
            dialogs_list.append({
                "id": str(dialog.id),
                "name": dialog.name,
                "is_forum": is_forum,
                "type": dialog_type,
                "is_restricted": getattr(dialog.entity, "noforwards", False)
            })

            # Limit to first 100 for performance
            if len(dialogs_list) >= 100:
                break
            
        await client.disconnect()
        
        # Print exactly one line of JSON for the Tauri app to parse
        print(f"[JSON_OUTPUT]{json.dumps(dialogs_list)}")
    except Exception as e:
        print(f"[JSON_OUTPUT]{json.dumps({'error': str(e)})}")

async def list_topics(session_name, chat_id, api_id, api_hash):
    try:
        try:
            from core.ghost_session import GhostSessionManager
            effective_session = GhostSessionManager.ensure_ghost(session_name, GhostSessionManager.PREVIEW_SUFFIX)
        except Exception as ge:
            print(f"[WARNING] Failed to clone preview session: {ge}", file=sys.stderr)
            effective_session = session_name

        client = await create_client(
            session_name=effective_session,
            api_id_arg=api_id,
            api_hash_arg=api_hash,
            phone_callback=lambda: "",
            code_callback=lambda: "",
            password_callback=lambda: ""
        )
        
        topics_list = []
        try:
            peer = await client.get_input_entity(int(chat_id))
            result = await client(functions.messages.GetForumTopicsRequest(
                peer=peer,
                offset_date=None,
                offset_id=0,
                offset_topic=0,
                limit=100
            ))
            for t in result.topics:
                topics_list.append({
                    "id": str(t.id),
                    "title": getattr(t, 'title', 'General')
                })
        except Exception as e:
            pass
            
        await client.disconnect()
        print(f"[JSON_OUTPUT]{json.dumps(topics_list)}")
    except Exception as e:
        print(f"[JSON_OUTPUT]{json.dumps({'error': str(e)})}")

def start_parent_watcher() -> None:
    """Spawns a background thread to watch the parent process.
    If the parent process exits, this process will terminate immediately to avoid orphaned daemons."""
    import threading
    import time
    import sys

    ppid = os.getppid()
    if ppid <= 0:
        return

    def watcher():
        log_path = os.path.join(os.path.dirname(__file__), "watcher_debug.log")
        with open(log_path, "a") as log:
            log.write(f"Watcher started. PPID: {ppid}\n")
            log.flush()
        while True:
            time.sleep(2)
            alive = True
            err_msg = ""
            if sys.platform == "win32":
                try:
                    os.kill(ppid, 0)
                except OSError as e:
                    err_msg = f"OSError: {e}, winerror: {getattr(e, 'winerror', None)}"
                    # On Windows, if process is dead, os.kill(pid, 0) might raise WinError 87
                    if getattr(e, "winerror", None) == 87:
                        alive = False
            else:
                import errno
                try:
                    os.kill(ppid, 0)
                except OSError as e:
                    err_msg = f"OSError: {e}"
                    if e.errno == errno.ESRCH:
                        alive = False
            
            with open(log_path, "a") as log:
                log.write(f"PPID: {ppid}, alive: {alive}, err: {err_msg}\n")
                log.flush()
                
            if not alive:
                with open(log_path, "a") as log:
                    log.write("Parent is dead! Exiting...\n")
                    log.flush()
                os._exit(0)

    t = threading.Thread(target=watcher, daemon=True)
    t.start()

async def main():
    start_parent_watcher()
    # Windows console often uses 'charmap' — break Telegram unicode titles otherwise
    try:
        from engine.utf8_io import ensure_utf8_stdio
        ensure_utf8_stdio()
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="AutoGram Daemon")
    parser.add_argument("--action", default="migrate")
    parser.add_argument("--api-id", required=False)
    parser.add_argument("--api-hash", required=False)
    parser.add_argument("--source", required=False)
    parser.add_argument("--destination", required=False)
    # Sentinels: "__DEFAULT_*" / -1 means "not provided by CLI — keep job config"
    parser.add_argument("--mode", default="__DEFAULT_MODE__")
    parser.add_argument("--rerun-mode", default="RESUME", help="Mode untuk Re-run: RESUME, OVERWRITE, SMART_SYNC")
    parser.add_argument("--limit", type=int, default=-1, help="Max messages (0=unlimited). -1=use job config")
    parser.add_argument("--media", default="__DEFAULT_MEDIA__")
    parser.add_argument("--session", default="__DEFAULT_SESSION__")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--duplicate-action", default="__DEFAULT_DUP__")
    parser.add_argument("--size-min", type=float, default=-1.0)
    parser.add_argument("--size-max", type=float, default=-1.0)
    parser.add_argument("--caption", default="__DEFAULT_CAPTION__")
    parser.add_argument('--throttle', action='store_true', help='Aktifkan Safe Mode Throttle')
    parser.add_argument('--auto-fallback', action='store_true', help='Aktifkan Auto-Fallback jika chat terproteksi')
    parser.add_argument('--fetch-direction', default='__DEFAULT_FETCH__', help='Arah pengambilan pesan')
    parser.add_argument('--start-date', default=None, help='Filter dari tanggal ini (YYYY-MM-DD)')
    parser.add_argument('--end-date', default=None, help='Filter hingga tanggal ini (YYYY-MM-DD)')
    parser.add_argument('--delay-min', type=float, default=-1.0, help='Jeda minimum dalam detik')
    parser.add_argument('--delay-max', type=float, default=-1.0, help='Jeda maksimum dalam detik')
    parser.add_argument('--album-handling', default='__DEFAULT_ALBUM__', help='Cara handle grouped media')
    parser.add_argument("--chat-id", required=False)
    parser.add_argument("--config", type=str, help="Job config JSON")
    parser.add_argument("--job-id", type=int, default=None, help="ID Job")
    parser.add_argument("--execution-id", type=int, default=None, help="ID Execution (retry/re-run)")
    parser.add_argument('--status', type=str, help="Status (e.g., active, paused, completed)")
    parser.add_argument('--profile-name', type=str, help="Profile/Automation name")
    parser.add_argument('--profile-config', type=str, help="Profile configuration JSON")
    parser.add_argument('--profile-id', type=int, help="Profile/Automation ID")
    parser.add_argument('--cron', type=str, help="Cron expression for automation")
    parser.add_argument('--realtime', action='store_true', help="Flag for real-time automation")
    
    # Sync specific args
    parser.add_argument('--sync-catchup', action='store_true', help='Catch up missed messages in sync')
    parser.add_argument('--mirror-edits', action='store_true', help='Mirror edited messages')
    parser.add_argument('--mirror-deletions', action='store_true', help='Mirror deleted messages')

    # Media speed benchmark
    parser.add_argument('--bench-mode', default='upload', help='upload | download | roundtrip')
    parser.add_argument('--file-path', default=None, help='Local file path for upload bench')
    parser.add_argument('--generate-mb', type=float, default=0, help='Generate dummy file of N MB')
    parser.add_argument('--message-id', type=int, default=None, help='Message id for download bench')
    parser.add_argument('--cleanup', action='store_true', default=True, help='Delete temp files after bench')
    parser.add_argument('--no-cleanup', action='store_true', help='Keep temp files after bench')
    parser.add_argument('--delete-message', action='store_true', help='Delete uploaded test message after bench')

    # Media Studio
    parser.add_argument('--studio-action', default='upload', help='upload | download')
    parser.add_argument('--files-json', default=None, help='Path to JSON list of {path, caption}')
    parser.add_argument('--options-json', default=None, help='Path or inline JSON for studio options')
    parser.add_argument('--last-n', type=int, default=5, help='Download last N media')

    # AutoGram Drive (Telegram-Drive model)
    parser.add_argument('--drive-action', default=None, help='bootstrap|scan-folders|list-chats|list-files|thumbnails|thumbnail|preview|...')
    parser.add_argument('--folder-id', default=None, help='Drive folder peer id; omit/empty = Saved Messages')
    parser.add_argument('--to-folder-id', default=None, help='Target folder for move')
    parser.add_argument('--drive-name', default=None, help='Folder or rename name')
    parser.add_argument('--save-path', default=None, help='Local path for drive-download or dir for download-batch')
    parser.add_argument('--include-td', action='store_true', help='Deprecated; [TD] always scanned')
    parser.add_argument('--drive-limit', type=int, default=80, help='Legacy limit; prefer --page-size')
    parser.add_argument('--page-size', type=int, default=None, help='Page size for list-files / list-chats')
    parser.add_argument('--offset-id', type=int, default=None, help='Telegram offset_id for list-files pagination')
    parser.add_argument('--chat-offset', type=int, default=0, help='Skip N dialogs for list-chats pagination')
    parser.add_argument('--message-ids-json', default=None, help='JSON list of message ids for download-batch')
    parser.add_argument("--port", type=int, default=8550, help="Port untuk FastAPI api-server")
    
    args = parser.parse_args()

    try:
        from engine.debug_log import dlog, is_debug_enabled, set_debug_session

        set_debug_session(f"daemon-{args.action}-{args.drive_action or args.studio_action or 'x'}")
        dlog(
            "daemon invoke",
            scope="daemon",
            phase="start",
            action=args.action,
            drive_action=args.drive_action,
            studio_action=getattr(args, "studio_action", None),
            job_id=args.job_id,
            debug=is_debug_enabled(),
        )
    except Exception:
        pass

    if args.action == "api-server":
        # Launch FastAPI server
        try:
            import uvicorn
            os.environ["AUTOGRAM_API_SESSION"] = args.session if args.session not in (None, '', '__DEFAULT_SESSION__') else 'Lavender'
            os.environ["AUTOGRAM_API_ID"] = str(args.api_id) if args.api_id else ""
            os.environ["AUTOGRAM_API_HASH"] = str(args.api_hash) if args.api_hash else ""
            
            port = int(args.port) if getattr(args, "port", None) else 8550
            print(f"[DAEMON] Starting FastAPI API server on port {port}...", flush=True)
            config = uvicorn.Config("api.main:app", host="127.0.0.1", port=port, log_level="info")
            server = uvicorn.Server(config)
            await server.serve()
        except Exception as e:
            print(f"[DAEMON] API Server Failed to start: {e}", file=sys.stderr, flush=True)
        return

    if args.action == "drive-serve":
        # Long-lived Drive RPC (stdin JSON lines) — keep one Telethon session warm
        try:
            from engine.drive_serve import run_drive_serve

            session = args.session if args.session not in (None, '', '__DEFAULT_SESSION__') else 'Lavender'
            if not args.api_id or not args.api_hash:
                print(json.dumps({"type": "error", "error": "API_ID/API_HASH required"}), flush=True)
                return
            await run_drive_serve(
                session_name=session,
                api_id=int(args.api_id),
                api_hash=str(args.api_hash),
            )
        except Exception as e:
            print(json.dumps({"type": "error", "error": str(e)}), flush=True)
        return

    if args.action == "drive":
        # Desktop drive ops — always clean exit (Windows Tauri host safety)
        try:
            from engine.drive_fs import run_drive_action

            def _load_json_arg(raw: str):
                s = (raw or "").strip().strip('"').strip("'")
                if not s:
                    return None
                if os.path.isfile(s):
                    with open(s, 'r', encoding='utf-8-sig') as f:
                        return json.load(f)
                if s.startswith('\ufeff'):
                    s = s.lstrip('\ufeff')
                return json.loads(s)

            session = args.session if args.session not in (None, '', '__DEFAULT_SESSION__') else 'Lavender'
            if not args.api_id or not args.api_hash:
                print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': 'API_ID/API_HASH required'})}")
                return
            drive_action = args.drive_action or 'scan-folders'
            folder_id = None
            if args.folder_id not in (None, '', 'null', 'None', 'home', 'me'):
                try:
                    folder_id = int(str(args.folder_id).strip())
                except ValueError:
                    print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': 'invalid folder_id'})}")
                    return
            to_folder_id = None
            if args.to_folder_id not in (None, '', 'null', 'None', 'home', 'me'):
                try:
                    to_folder_id = int(str(args.to_folder_id).strip())
                except ValueError:
                    print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': 'invalid to_folder_id'})}")
                    return
            files = None
            options = {}
            if args.files_json:
                try:
                    files = _load_json_arg(args.files_json)
                except Exception as e:
                    print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': f'files-json: {e}'})}")
                    return
            if args.options_json:
                try:
                    options = _load_json_arg(args.options_json) or {}
                except Exception as e:
                    print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': f'options-json: {e}'})}")
                    return
            message_ids = None
            if args.message_ids_json:
                try:
                    message_ids = _load_json_arg(args.message_ids_json)
                except Exception as e:
                    print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': f'message-ids-json: {e}'})}")
                    return
            await run_drive_action(
                drive_action,
                session_name=session,
                api_id=int(args.api_id),
                api_hash=str(args.api_hash),
                folder_id=folder_id,
                to_folder_id=to_folder_id,
                message_id=args.message_id,
                message_ids=message_ids,
                name=args.drive_name,
                save_path=args.save_path or args.file_path,
                include_td=True,
                limit=int(args.drive_limit or 80),
                page_size=args.page_size,
                offset_id=args.offset_id,
                chat_offset=int(args.chat_offset or 0),
                files=files,
                options=options,
            )
        except Exception as e:
            print(f"[ERROR] drive: {e}", file=sys.stderr)
            try:
                print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': str(e)})}")
            except Exception:
                pass
        return

    if args.action == "media-studio":
        # Never sys.exit(non-zero) here — on Windows Tauri shell may force-close the UI.
        log_dir = os.path.join(os.path.dirname(__file__), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        studio_log = os.path.join(log_dir, f'studio_{int(datetime.datetime.now().timestamp())}.log')
        try:
            with open(studio_log, 'a', encoding='utf-8') as lf:
                lf.write(f"START media-studio args files={args.files_json} opts={args.options_json}\n")
        except Exception:
            pass
        try:
            from engine.media_studio import run_media_studio
            session = args.session if args.session not in (None, '', '__DEFAULT_SESSION__') else 'Lavender'
            if not args.api_id or not args.api_hash:
                print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': 'API_ID/API_HASH required'})}")
                return
            if not args.chat_id:
                print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': 'chat_id required'})}")
                return
            files = None
            options = {}

            def _load_json_arg(raw: str):
                """Load JSON from file path or inline string; tolerate UTF-8 BOM."""
                s = (raw or "").strip().strip('"').strip("'")
                if not s:
                    return None
                if os.path.isfile(s):
                    with open(s, 'r', encoding='utf-8-sig') as f:
                        return json.load(f)
                if s.startswith('\ufeff'):
                    s = s.lstrip('\ufeff')
                return json.loads(s)

            if args.files_json:
                try:
                    files = _load_json_arg(args.files_json)
                except Exception as e:
                    print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': f'files-json: {e}'})}")
                    return
            if args.options_json:
                try:
                    options = _load_json_arg(args.options_json) or {}
                except Exception as e:
                    print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': f'options-json: {e}'})}")
                    return
            msg_ids = None
            if args.message_id:
                msg_ids = [int(args.message_id)]
            await run_media_studio(
                session_name=session,
                api_id=int(args.api_id),
                api_hash=str(args.api_hash),
                chat_id=str(args.chat_id),
                action=str(args.studio_action or 'upload'),
                files=files,
                options=options,
                last_n=int(args.last_n or 5),
                message_ids=msg_ids,
            )
            try:
                with open(studio_log, 'a', encoding='utf-8') as lf:
                    lf.write("END media-studio ok\n")
            except Exception:
                pass
        except Exception as e:
            print(f"[ERROR] media-studio: {e}", file=sys.stderr)
            try:
                with open(studio_log, 'a', encoding='utf-8') as lf:
                    lf.write(f"END media-studio error: {e}\n")
            except Exception:
                pass
            try:
                print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': str(e)})}")
            except Exception:
                pass
            try:
                emit_event('StudioFailed', error=str(e))
            except Exception:
                pass
        # Always exit path cleanly (exit code 0 from process)
        return

    if args.action == "media-bench":
        from engine.media_bench import run_media_bench
        session = args.session if args.session not in (None, '', '__DEFAULT_SESSION__') else 'Lavender'
        if not args.api_id or not args.api_hash:
            print("[ERROR] --api-id and --api-hash are required for media-bench", file=sys.stderr)
            print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': 'API_ID/API_HASH required'})}")
            return
        if not args.chat_id:
            print("[ERROR] --chat-id is required for media-bench", file=sys.stderr)
            print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': 'chat_id required'})}")
            return
        cleanup = not bool(args.no_cleanup)
        try:
            await run_media_bench(
                session_name=session,
                api_id=int(args.api_id),
                api_hash=str(args.api_hash),
                chat_id=str(args.chat_id),
                mode=str(args.bench_mode or 'upload'),
                file_path=args.file_path,
                generate_mb=float(args.generate_mb or 0),
                message_id=args.message_id,
                cleanup=cleanup,
                delete_message=bool(args.delete_message),
            )
        except Exception as e:
            print(f"[ERROR] media-bench failed: {e}", file=sys.stderr)
            # JSON already emitted by run_media_bench on error; ensure one line
            try:
                print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': str(e)})}")
            except Exception:
                pass
        # Always exit 0 so Tauri shell does not force-close UI
        return
    
    
    if args.action == "create-job":
        job_name = None
        config_str = "{}"
        conf = {}
        if args.config:
            import base64
            try:
                if args.config.startswith('{'):
                    config_str = args.config
                else:
                    config_str = base64.b64decode(args.config).decode('utf-8')
                conf = json.loads(config_str)
                job_name = conf.get("jobName")
            except Exception as e:
                conf = {}
        from engine.config_normalize import normalize_job_config
        conf = normalize_job_config(conf, None)
        # Persist normalized JSON so later runs have consistent keys
        config_str = json.dumps(conf)
        source = args.source if args.source else conf.get('source_chat')
        dest = args.destination if args.destination else conf.get('dest_chat')
        session = args.session if args.session not in (None, '', '__DEFAULT_SESSION__') else conf.get('session_name', 'Lavender')
        mode = args.mode if args.mode not in (None, '', '__DEFAULT_MODE__') else conf.get('transfer_mode', 'Clean Copy')
        if not source or not dest or not session:
            print("[ERROR] --source, --destination, and --session are required for create-job", file=sys.stderr)
            sys.exit(1)
        job_id = create_job(session, source, dest, mode, config_str, job_name)
        print(f"[JOB_ID]{job_id}")
        return

    if args.action == "edit-job":
        if not args.job_id:
            print("[ERROR] --job-id is required for edit-job", file=sys.stderr)
            sys.exit(1)
        job_name = None
        config_str = "{}"
        conf = {}
        if args.config:
            import base64
            try:
                if args.config.startswith('{'):
                    config_str = args.config
                else:
                    config_str = base64.b64decode(args.config).decode('utf-8')
                conf = json.loads(config_str)
                job_name = conf.get("jobName")
            except Exception as e:
                conf = {}
        from engine.config_normalize import normalize_job_config
        conf = normalize_job_config(conf, None)
        config_str = json.dumps(conf)
        source = args.source if args.source else conf.get('source_chat')
        dest = args.destination if args.destination else conf.get('dest_chat')
        session = args.session if args.session not in (None, '', '__DEFAULT_SESSION__') else conf.get('session_name', 'Lavender')
        mode = args.mode if args.mode not in (None, '', '__DEFAULT_MODE__') else conf.get('transfer_mode', 'Clean Copy')
        if not source or not dest or not session:
            print("[ERROR] source, destination, and session are required for edit-job", file=sys.stderr)
            sys.exit(1)
        from database.queries import update_job
        update_job(args.job_id, session, source, dest, mode, config_str, job_name)
        print(f"[DAEMON] Job ID {args.job_id} updated successfully")
        return

    if args.action == "list-jobs":
        jobs = get_all_jobs()
        print(f"[JSON_OUTPUT]{json.dumps(jobs)}")
        return
        
    if args.action == "stats":
        stats = get_statistics()
        print(f"[JSON_OUTPUT]{json.dumps(stats)}")
        return
        
    if args.action == "list-profiles":
        profiles = get_profiles()
        print(f"[JSON_OUTPUT]{json.dumps(profiles)}")
        return
        
    if args.action == "save-profile":
        if not args.profile_name or not args.profile_config:
            print("[ERROR] --profile-name and --profile-config are required", file=sys.stderr)
            sys.exit(1)
        save_profile(args.profile_name, args.profile_config)
        print(f"[DAEMON] Profile '{args.profile_name}' saved")
        return
        
    if args.action == "delete-profile":
        if not args.profile_id:
            print("[ERROR] --profile-id is required", file=sys.stderr)
            sys.exit(1)
        delete_profile(args.profile_id)
        print(f"[DAEMON] Profile ID {args.profile_id} deleted")
        return

    if args.action == "list-automations":
        automations = get_automation_jobs()
        print("[JSON_OUTPUT]")
        print(json.dumps(automations))
        return

    if args.action == "add-automation":
        config = {
            "transfer_mode": args.mode,
            "media_filter": args.media,
            "size_min_mb": args.size_min,
            "size_max_mb": args.size_max,
            "duplicate_action": args.duplicate_action,
            "throttle_active": args.throttle,
            "caption_rule": args.caption,
            "album_handling": args.album_handling,
            "fetch_direction": args.fetch_direction,
            "delay_min": args.delay_min,
            "delay_max": args.delay_max,
            "mirror_edits": args.mirror_edits,
            "mirror_deletions": args.mirror_deletions,
            "sync_catchup": args.sync_catchup
        }
        
        # Name is stored in args.profile_name for convenience here or args.session
        # We can pass them via args
        job_id = create_automation_job(
            name=args.profile_name or f"Automation {datetime.datetime.now().strftime('%Y-%m-%d')}",
            profile_id=args.profile_id, # Could be none
            session_name=args.session,
            source=args.source,
            target=args.destination,
            cron=getattr(args, 'cron', ''),
            is_realtime=getattr(args, 'realtime', False),
            config_json=json.dumps(config)
        )
        print(f"[DAEMON] Automation Job Created with ID {job_id}")
        return

    if args.action == "delete-automation":
        if not args.job_id:
            print("[ERROR] --job-id is required", file=sys.stderr)
            sys.exit(1)
        delete_automation_job(args.job_id)
        print(f"[DAEMON] Automation Job {args.job_id} deleted")
        return

    if args.action == "set-automation-status":
        if not args.job_id or not args.status:
            print("[ERROR] --job-id and --status are required", file=sys.stderr)
            sys.exit(1)
        update_automation_job_status(args.job_id, args.status)
        print(f"[DAEMON] Automation Job {args.job_id} status set to {args.status}")
        return

    if args.action == "export-csv":
        import csv
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM migration_items ORDER BY id DESC")
        rows = cursor.fetchall()
        csv_path = os.path.join(os.path.dirname(__file__), "migration_report.csv")
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            if rows:
                writer.writerow(rows[0].keys())
                for r in rows:
                    writer.writerow(dict(r).values())
        print(f"[DAEMON] CSV exported to {csv_path}", flush=True)
        return

    if args.action == "delete-job":
        if not args.job_id:
            print("[ERROR] --job-id is required to delete a job", file=sys.stderr)
            sys.exit(1)
        delete_job(args.job_id)
        print("[DAEMON] Job Deleted Successfully", flush=True)
        return

    if args.action == "fresh-start":
        if not args.job_id:
            print("[ERROR] --job-id is required for fresh-start", file=sys.stderr)
            sys.exit(1)
            
        from engine.enterprise.database import delete_mapping_by_job
        from engine.enterprise.checkpoint import CheckpointManager
        from database.queries import (
            clear_duplicate_history_for_target,
            clear_tasks_for_job,
            mark_stalled_mappings_for_job,
            get_job as _get_job_fs,
        )
        
        job_row = _get_job_fs(args.job_id)
        delete_mapping_by_job(str(args.job_id))
        CheckpointManager().delete_checkpoint(str(args.job_id))
        clear_tasks_for_job(args.job_id)
        mark_stalled_mappings_for_job(args.job_id, 'FAILED', 'Cleared by Fresh Start')
        if job_row and job_row.get('target_entity_id'):
            clear_duplicate_history_for_target(job_row['target_entity_id'])
        # Also clear by dest from config_json if present
        try:
            import json as _json
            conf = _json.loads(job_row.get('config_json') or '{}') if job_row else {}
            dest = conf.get('dest_chat') or conf.get('destination') or conf.get('destValue')
            if dest:
                clear_duplicate_history_for_target(dest)
        except Exception:
            pass
        print("[DAEMON] Fresh Start Completed", flush=True)
        return
        
    if args.action == "set-status":
        if not args.job_id or not args.status:
            print("[ERROR] --job-id and --status are required", file=sys.stderr)
            sys.exit(1)
        from database.queries import update_job_status, request_pause_for_job, mark_stalled_mappings_for_job
        status_norm = str(args.status).lower()
        if status_norm in ('paused', 'pause', 'pausing'):
            request_pause_for_job(args.job_id)
            update_job_status(args.job_id, 'paused')
            # Give cooperative engines a moment; UI may also kill process
            print(f"[DAEMON] Job {args.job_id} pause requested (PAUSING)", flush=True)
        else:
            update_job_status(args.job_id, args.status)
            print(f"[DAEMON] Job {args.job_id} Status Set to {args.status}", flush=True)
        return
        
    if args.action == "export-jobs":
        jobs = get_all_jobs()
        # export file path
        filepath = args.session if args.session and args.session != "Lavender" else "jobs_export.json"
        with open(filepath, 'w') as f:
            json.dump(jobs, f, indent=4)
        print(f"[DAEMON] Jobs Exported to {filepath}", flush=True)
        return
        
    if args.action == "import-jobs":
        filepath = args.session if args.session and args.session != "Lavender" else "jobs_export.json"
        if not os.path.exists(filepath):
            print(f"[ERROR] File {filepath} not found", file=sys.stderr)
            sys.exit(1)
        with open(filepath, 'r') as f:
            jobs = json.load(f)
        
        conn = get_connection()
        cursor = conn.cursor()
        for job in jobs:
            # We ignore id so it generates new ones, or we can keep it
            cursor.execute('''
                INSERT INTO migration_jobs (profile_name, source_entity_id, target_entity_id, transfer_mode, status, config_json, job_name, last_processed_id, total_messages, processed_messages, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (job.get('profile_name'), job.get('source_entity_id'), job.get('target_entity_id'), job.get('transfer_mode'), job.get('status'), job.get('config_json'), job.get('job_name'), job.get('last_processed_id', 0), job.get('total_messages', 0), job.get('processed_messages', 0), job.get('created_at')))
        conn.commit()
        conn.close()
        print(f"[DAEMON] {len(jobs)} Jobs Imported from {filepath}", flush=True)
        return
    
    if args.action == "reconcile":
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE executions SET status = 'FAILED', error_message = 'Process terminated unexpectedly (System Restart)', finished_at = CURRENT_TIMESTAMP WHERE status IN ('RUNNING', 'STARTING', 'PAUSING', 'RESUMING')")
        conn.commit()
        # Best-effort clear enterprise IN_PROGRESS leftovers
        try:
            cursor.execute("UPDATE message_mapping SET status = 'FAILED', error_message = 'Stalled after restart', last_updated = CURRENT_TIMESTAMP WHERE status = 'IN_PROGRESS'")
            conn.commit()
        except Exception:
            pass
        conn.close()
        print("[DAEMON] Reconciliation complete. Zombie executions marked as FAILED.")
        return

    if args.action == "calculate-cache-size":
        cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
        total_size = 0
        if os.path.exists(cache_dir):
            for root, dirs, files in os.walk(cache_dir):
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        total_size += os.path.getsize(fp)
                    except OSError:
                        pass
        print(f"[JSON_OUTPUT]{json.dumps({'status': 'success', 'size_bytes': total_size})}")
        return

    if args.action == "clear-disk-cache":
        import shutil
        cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
        cleaned_dirs = []
        if os.path.exists(cache_dir):
            for item in os.listdir(cache_dir):
                item_path = os.path.join(cache_dir, item)
                if os.path.isdir(item_path):
                    try:
                        shutil.rmtree(item_path)
                        os.makedirs(item_path, exist_ok=True)
                        cleaned_dirs.append(item)
                    except Exception as e:
                        print(f"[WARN] Failed to clean {item}: {e}", file=sys.stderr)
        temp_dir = os.path.join(os.path.dirname(__file__), 'temp')
        if os.path.exists(temp_dir):
            for item in os.listdir(temp_dir):
                if item == "drive_active_downloads.json":
                    continue
                item_path = os.path.join(temp_dir, item)
                try:
                    if os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                    else:
                        os.remove(item_path)
                except Exception:
                    pass
        print(f"[JSON_OUTPUT]{json.dumps({'status': 'success', 'cleaned': cleaned_dirs})}")
        return

    if args.action == "clear-transfer-database":
        try:
            from database.db import get_connection
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM duplicate_history;")
            cursor.execute("DELETE FROM destination_scan_cache;")
            cursor.execute("DELETE FROM transfer_state;")
            cursor.execute("DELETE FROM transfer_audit_log;")
            cursor.execute("VACUUM;")
            conn.commit()
            conn.close()
            print(f"[JSON_OUTPUT]{json.dumps({'status': 'success', 'message': 'Seluruh riwayat transfer dan de-duplikasi berhasil dikosongkan.'})}")
        except Exception as e:
            print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'error': str(e)})}")
        return

    if args.action == "list-dialogs":
        folder_id_val = None
        if args.folder_id:
            try:
                folder_id_val = int(args.folder_id)
            except ValueError:
                pass
        await list_dialogs(args.session, args.api_id, args.api_hash, folder_id_val)
        return
        
    if args.action == "list-topics":
        await list_topics(args.session, args.chat_id, args.api_id, args.api_hash)
        return
        
    if args.action == "list-executions":
        from database.queries import get_executions_by_job
        if not args.job_id:
            print("[ERROR] --job-id is required for list-executions", file=sys.stderr)
            sys.exit(1)
        executions = get_executions_by_job(args.job_id)
        print(f"[JSON_OUTPUT]{json.dumps(executions)}")
        return
        
    if args.action == "get-logs":
        if not args.job_id:
            print("[ERROR] --job-id is required for get-logs", file=sys.stderr)
            sys.exit(1)
            
        exec_id = getattr(args, 'execution_id', None)
        log_dir = os.path.join(os.path.dirname(__file__), 'logs')
        log_file = None
        
        if not exec_id:
            from database.queries import get_executions_by_job
            executions = get_executions_by_job(args.job_id)
            if executions:
                for ex in executions:
                    potential_log = os.path.join(log_dir, f'job_{args.job_id}_exec_{ex["id"]}.log')
                    if os.path.exists(potential_log):
                        exec_id = ex["id"]
                        log_file = potential_log
                        break
                if not exec_id:
                    # Still no log file found for any execution, just default to latest
                    exec_id = executions[0]['id']
            else:
                print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'message': 'No executions found for job'})}")
                return
                
        if not log_file:
            log_file = os.path.join(log_dir, f'job_{args.job_id}_exec_{exec_id}.log')
            
        if os.path.exists(log_file):
            import collections
            with open(log_file, "r", encoding="utf-8") as f:
                content = ''.join(collections.deque(f, maxlen=500))
            print(f"[JSON_OUTPUT]{json.dumps({'status': 'success', 'logs': content})}")
        else:
            print(f"[JSON_OUTPUT]{json.dumps({'status': 'error', 'message': 'Log file not found'})}")
        return
        
    if args.action in ("execute-job", "retry-execution", "run-again"):
        from database.queries import get_job, create_execution, update_execution_status, get_execution, get_executions_by_job
        from engine.config_normalize import normalize_job_config, effective_limit
        
        config = {}
        execution_id = None
        job_id = None
        
        if args.action == 'retry-execution':
            # Prefer explicit --execution-id; fall back to --job-id only if it resolves as execution
            exec_id = args.execution_id or args.job_id
            if not exec_id:
                print("[ERROR] --execution-id is required for retry-execution (or --job-id of a prior execution)", file=sys.stderr)
                sys.exit(1)
            execution = get_execution(exec_id)
            if not execution:
                # Maybe user passed job_id: pick latest execution for that job
                if args.job_id:
                    exs = get_executions_by_job(args.job_id)
                    execution = exs[0] if exs else None
                    exec_id = execution['id'] if execution else None
            if not execution:
                print(f"[ERROR] Execution not found for retry (execution_id/job_id={exec_id})", file=sys.stderr)
                sys.exit(1)
            try:
                config = json.loads(execution.get('snapshot_config_json', '{}') or '{}')
            except Exception:
                config = {}
            # Prefer latest job config when available (user may have edited)
            job_id = execution['job_id']
            job_data = get_job(job_id)
            if job_data and job_data.get('config_json'):
                try:
                    latest = json.loads(job_data.get('config_json') or '{}')
                    # Keep snapshot as base, overlay non-empty latest fields
                    for k, v in latest.items():
                        if v is not None and v != '':
                            config[k] = v
                except Exception:
                    pass
            config['is_retry'] = True
            config['rerun_mode'] = args.rerun_mode or config.get('rerun_mode', 'RESUME')
            config['job_id'] = job_id
            config['prior_execution_id'] = execution['id']
            # Guard concurrent
            existing_execs = get_executions_by_job(job_id)
            if any(e.get('status') in ('RUNNING', 'STARTING') for e in existing_execs):
                print(f"[ERROR] Job ID {job_id} is already RUNNING. Cannot start multiple instances.", file=sys.stderr)
                sys.exit(1)
            execution_id = create_execution(job_id, json.dumps(config))
            
        else:
            if not args.job_id:
                print("[ERROR] --job-id is required for execute-job and run-again", file=sys.stderr)
                sys.exit(1)
            job_id = args.job_id
                
            existing_execs = get_executions_by_job(job_id)
            if any(e.get('status') in ('RUNNING', 'STARTING') for e in existing_execs):
                print(f"[ERROR] Job ID {job_id} is already RUNNING. Cannot start multiple instances.", file=sys.stderr)
                sys.exit(1)
                
            job_data = get_job(job_id)
            if not job_data:
                print(f"[ERROR] Job ID {job_id} not found", file=sys.stderr)
                sys.exit(1)
            try:
                config = json.loads(job_data.get('config_json', '{}') or '{}')
            except Exception:
                config = {}
            
            config['is_retry'] = False
            config['job_id'] = job_id
            # run-again with rerun_mode treats as soft retry of mapping path
            if args.action == 'run-again' or (args.rerun_mode and args.rerun_mode != 'RESUME' and getattr(args, 'force_rerun', False)):
                pass
            execution_id = create_execution(job_id, json.dumps(config))
            # Resume checkpoint: new execution inherits last_processed_id from prior run
            try:
                from database.queries import seed_execution_from_prior
                # Fresh start clears mappings/history elsewhere; still OK to seed if prior exists.
                # OVERWRITE / force full re-run should not continue mid-history.
                rerun = (args.rerun_mode or config.get('rerun_mode') or 'RESUME')
                if str(rerun).upper() != 'OVERWRITE' and not getattr(args, 'force_rerun', False):
                    seeded = seed_execution_from_prior(job_id, execution_id)
                    if seeded:
                        print(f"[EVENT] {json.dumps({'type': 'CheckpointSeeded', 'execution_id': execution_id, 'job_id': job_id})}", flush=True)
            except Exception as _seed_err:
                print(f"[WARN] Could not seed checkpoint: {_seed_err}", file=sys.stderr)
            
        # Normalize config (UI camelCase + CLI)
        config = normalize_job_config(config, args)
        config['job_id'] = job_id
        if args.action == 'retry-execution':
            config['is_retry'] = True
            config['rerun_mode'] = args.rerun_mode or 'RESUME'
            # Also seed for soft retry RESUME so last_processed continues
            if (config.get('rerun_mode') or 'RESUME').upper() == 'RESUME':
                try:
                    from database.queries import seed_execution_from_prior
                    seed_execution_from_prior(job_id, execution_id)
                except Exception:
                    pass

        # SETUP PERSISTENT LOGGING (always job_id + execution_id)
        log_dir = os.path.join(os.path.dirname(__file__), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        log_file_path = os.path.join(log_dir, f'job_{job_id}_exec_{execution_id}.log')
        _orig_stdout, _orig_stderr = sys.stdout, sys.stderr
        sys.stdout = TeeStream(_orig_stdout, log_file_path)
        sys.stderr = TeeStream(_orig_stderr, log_file_path)
        
        setup_emitter(execution_id, job_id)
        emit_event('ExecutionCreated', execution_id=execution_id, jobId=job_id)

        exit_code = 0
        client = None
            
        if not config.get('source_chat') or not config.get('dest_chat'):
            print("[ERROR] source and destination are required", file=sys.stderr)
            update_execution_status(execution_id, 'FAILED', "Source/Destination missing")
            exit_code = 1
        else:
            # Determine effective API ID and Hash
            effective_api_id = args.api_id or config.get('api_id')
            effective_api_hash = args.api_hash or config.get('api_hash')
            
            if not effective_api_id or not effective_api_hash:
                print("[EVENT] {\"type\": \"FatalError\", \"error\": \"API_ID and API_HASH are required. Please login.\"}", file=sys.stderr)
                update_execution_status(execution_id, 'FAILED', "API_ID missing")
                exit_code = 1
            else:
                limit = effective_limit(config)
                print(f"[EVENT] {json.dumps({'type': 'EngineInitialized', 'execution_id': execution_id, 'job_id': job_id, 'limit': limit, 'mode': config.get('transfer_mode')})}", flush=True)
                session_dir = os.path.join(os.path.dirname(__file__), 'sessions')
                original_session_name = config.get('session_name', 'Lavender')
                try:
                    from core.ghost_session import GhostSessionManager
                    ghost_session_name = GhostSessionManager.ensure_ghost(original_session_name)
                except Exception as e:
                    print(f"[WARN] Gagal membuat ghost session: {e}. Menggunakan session utama.", file=sys.stderr)
                    ghost_session_name = original_session_name
                session_file = os.path.join(session_dir, ghost_session_name)
                
                async def resolve_entity(client, chat_key, label):
                    last_err = None
                    entity_ref = parse_entity(config.get(chat_key))
                    for attempt, dlg_limit in enumerate((0, 200, 500)):
                        try:
                            if dlg_limit:
                                print(f"[EVENT] {json.dumps({'type': 'Log', 'message': f'Resolving {label}: loading dialogs (limit={dlg_limit})...'})}", flush=True)
                                await client.get_dialogs(limit=dlg_limit)
                            return await client.get_input_entity(entity_ref)
                        except Exception as e:
                            last_err = e
                            continue
                    try:
                        raw = str(config.get(chat_key) or '')
                        if raw.startswith('@') or (not raw.lstrip('-').replace('_', '').isdigit()):
                            return await client.get_entity(raw)
                    except Exception as e:
                        last_err = e
                    raise ValueError(str(last_err) if last_err else f"{label} invalid")

                try:
                    update_execution_status(execution_id, 'STARTING')
                    try:
                        from core.client import _patch_session_wal
                        _patch_session_wal(session_file)
                    except Exception:
                        pass
                    client = TelegramClient(session_file, int(effective_api_id), effective_api_hash, connection_retries=None, auto_reconnect=True)
                    await client.connect()
                    if not await client.is_user_authorized():
                        print("[EVENT] {\"type\": \"FatalError\", \"error\": \"Sesi tidak valid. Silakan login kembali.\"}", flush=True)
                        update_execution_status(execution_id, 'FAILED', "Sesi tidak valid")
                        exit_code = 1
                    else:
                        try:
                            source_entity = await resolve_entity(client, 'source_chat', 'Source')
                            dest_entity = await resolve_entity(client, 'dest_chat', 'Destination')
                        except Exception as e:
                            emit_event('FatalError', error=f"Entity resolve failed: {e}")
                            update_execution_status(execution_id, 'FAILED', "Entity invalid")
                            exit_code = 1
                        else:
                            update_execution_status(execution_id, 'RUNNING')
                            
                            mode = config.get('transfer_mode') or config.get('mode') or 'Clean Copy'
                            is_retry = bool(config.get('is_retry'))
                            if mode == 'Clean Copy':
                                if is_retry:
                                    from engine.enterprise.retry_scheduler import RetryScheduler
                                    forwarder = RetryScheduler(client, source_entity, dest_entity, execution_id, config)
                                else:
                                    from engine.enterprise.engine import EnterpriseEngine
                                    forwarder = EnterpriseEngine(client, source_entity, dest_entity, execution_id, config)
                            else:
                                forwarder = MigrationForwarder(client, source_entity, dest_entity, execution_id, config)
                                
                            await forwarder.execute_migration(limit=limit)
                            # final state is set inside engine; success exit
                        
                except Exception as e:
                    try:
                        emit_event('FatalError', error=f"Engine Failed: {str(e)}")
                    except Exception:
                        print(f"[ERROR] Engine Failed: {e}", file=sys.stderr)
                    try:
                        update_execution_status(execution_id, 'FAILED', str(e))
                    except Exception:
                        pass
                    exit_code = 1
                finally:
                    # Always disconnect Telegram cleanly — prevents native crash on process teardown
                    if client is not None:
                        try:
                            if getattr(client, "is_connected", lambda: True)():
                                await asyncio.wait_for(client.disconnect(), timeout=5.0)
                        except Exception:
                            try:
                                # Force-close transport if graceful disconnect hangs
                                if hasattr(client, "disconnect"):
                                    await asyncio.wait_for(client.disconnect(), timeout=1.0)
                            except Exception:
                                pass
                        try:
                            await asyncio.sleep(0.05)
                        except Exception:
                            pass
                        client = None
                    # Drop pending tasks that Telethon may leave behind
                    try:
                        await asyncio.sleep(0)
                    except Exception:
                        pass
                    # Cleanup ghost session
                    try:
                        from core.ghost_session import GhostSessionManager
                        GhostSessionManager.cleanup_ghost(original_session_name)
                    except Exception:
                        pass

        # Restore streams before process end (avoids flush crash into closed TeeStream)
        try:
            if isinstance(sys.stdout, TeeStream):
                sys.stdout.close()
            if isinstance(sys.stderr, TeeStream):
                sys.stderr.close()
        except Exception:
            pass
        sys.stdout = _orig_stdout
        sys.stderr = _orig_stderr

        # IMPORTANT: Always exit 0 for job runners so Tauri shell never treats
        # a failed migration as an abnormal process death (can force-close UI on Windows).
        # Job success/failure is communicated via [EVENT] ExecutionFinished / FatalError.
        if exit_code != 0:
            print(f"[DAEMON] Job finished with logical exit_code={exit_code} (process still exits 0)", flush=True)
        return

    if args.action == "sync":
        if not args.source or not args.destination:
            print("[ERROR] --source and --destination are required for sync", file=sys.stderr)
            sys.exit(1)
            
        config = {
            'api_id': args.api_id,
            'api_hash': args.api_hash,
            'source_chat': args.source,
            'dest_chat': args.destination,
            'transfer_mode': args.mode,
            'media_filter': args.media,
            'session_name': args.session,
            'size_min_mb': args.size_min,
            'size_max_mb': args.size_max,
            'throttle_active': args.throttle,
            'caption_rule': args.caption,
            'start_date': args.start_date,
            'end_date': args.end_date,
            'delay_min': args.delay_min,
            'delay_max': args.delay_max,
            'sync_catchup': args.sync_catchup,
            'mirror_edits': args.mirror_edits,
            'mirror_deletions': args.mirror_deletions
        }
        
        print("[DAEMON] Sync Engine Initialized", flush=True)
        session_dir = os.path.join(os.path.dirname(__file__), 'sessions')
        session_file = os.path.join(session_dir, args.session)
        
        # Ekstrak topic ID jika ada
        source_topic_id = None
        if isinstance(args.source, str) and '_' in args.source:
            try: source_topic_id = int(args.source.split('_')[1])
            except: pass
            
        dest_topic_id = None
        if isinstance(args.destination, str) and '_' in args.destination:
            try: dest_topic_id = int(args.destination.split('_')[1])
            except: pass
            
        config['source_topic_id'] = source_topic_id
        config['dest_topic_id'] = dest_topic_id
        
        try:
            client = TelegramClient(session_file, int(args.api_id) if args.api_id else int(config.get('api_id', 0)), args.api_hash or config.get('api_hash', ''), connection_retries=None, auto_reconnect=True)
            await client.connect()
            if not await client.is_user_authorized():
                print("[ERROR] Sesi tidak valid untuk Sync.", flush=True)
                return
                
            try:
                source_entity = await client.get_input_entity(parse_entity(args.source))
            except ValueError:
                print("[DAEMON] Fetching dialogs to populate cache for Sync Source...", flush=True)
                await client.get_dialogs(limit=100)
                try:
                    source_entity = await client.get_input_entity(parse_entity(args.source))
                except ValueError:
                    print(f"[ERROR] Chat/Username Sumber '{args.source}' tidak valid atau tidak ditemukan.", file=sys.stderr)
                    sys.exit(1)

            try:
                dest_entity = await client.get_input_entity(parse_entity(args.destination))
            except ValueError:
                print("[DAEMON] Fetching dialogs to populate cache for Sync Dest...", flush=True)
                await client.get_dialogs(limit=100)
                try:
                    dest_entity = await client.get_input_entity(parse_entity(args.destination))
                except ValueError:
                    print(f"[ERROR] Chat/Username Tujuan '{args.destination}' tidak valid atau tidak ditemukan.", file=sys.stderr)
                    sys.exit(1)
            
            engine = SyncEngine(client, source_entity, dest_entity, config)
            await engine.run()
        except Exception as e:
            print(f"[ERROR] Sync Failed: {e}", file=sys.stderr)

if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
        
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(line_buffering=True)
        except Exception:
            pass
    try:
        asyncio.run(main())
    except SystemExit:
        # Swallow — always terminate cleanly for host process stability
        pass
    except KeyboardInterrupt:
        pass
    except Exception as e:
        try:
            print(f"[FATAL] {e}", file=sys.stderr)
        except Exception:
            pass
    # Hard guarantee: process always exits 0 (no crash signal to Tauri parent)
    try:
        sys.exit(0)
    except SystemExit:
        raise
    except Exception:
        os._exit(0)

