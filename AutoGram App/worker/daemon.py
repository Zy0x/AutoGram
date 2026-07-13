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
        
        # Regex untuk mendeteksi nomor telepon (minimal 10 digit, opsional dengan +)
        self.phone_regex = re.compile(r'(\+?\d{2,4}[-\s]?\d{8,12})')
        # Regex untuk string panjang alfanumerik (seperti API Hash, Session String, atau Token)
        self.hash_regex = re.compile(r'([a-zA-Z0-9_-]{30,})')

    def write(self, data):
        self.stream.write(data)
        self.stream.flush()
        
        # Redaction/Masking
        safe_data = data
        safe_data = self.phone_regex.sub('***[PHONE REDACTED]***', safe_data)
        safe_data = self.hash_regex.sub('***[HASH REDACTED]***', safe_data)
        
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(safe_data)

    def flush(self):
        self.stream.flush()

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

async def list_dialogs(session_name, api_id, api_hash):
    try:
        # Create client without interactive prompts (assuming session exists)
        client = await create_client(
            session_name=session_name,
            api_id_arg=api_id,
            api_hash_arg=api_hash,
            phone_callback=lambda: "",
            code_callback=lambda: "",
            password_callback=lambda: ""
        )
        
        dialogs_list = []
        async for dialog in client.iter_dialogs():
            # Limit to first 100 for performance
            if len(dialogs_list) > 100:
                break
                
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
            
        await client.disconnect()
        
        # Print exactly one line of JSON for the Tauri app to parse
        print(f"[JSON_OUTPUT]{json.dumps(dialogs_list)}")
    except Exception as e:
        print(f"[JSON_OUTPUT]{json.dumps({'error': str(e)})}")

async def list_topics(session_name, chat_id, api_id, api_hash):
    try:
        client = await create_client(
            session_name=session_name,
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

async def main():
    parser = argparse.ArgumentParser(description="AutoGram Daemon")
    parser.add_argument("--action", default="migrate")
    parser.add_argument("--api-id", required=False)
    parser.add_argument("--api-hash", required=False)
    parser.add_argument("--source", required=False)
    parser.add_argument("--destination", required=False)
    parser.add_argument("--mode", default="Clean Copy")
    parser.add_argument("--rerun-mode", default="RESUME", help="Mode untuk Re-run: RESUME, OVERWRITE, SMART_SYNC")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--media", default="Semua")
    parser.add_argument("--session", default="Lavender")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--duplicate-action", default="Skip")
    parser.add_argument("--size-min", type=float, default=0.0)
    parser.add_argument("--size-max", type=float, default=float('inf'))
    parser.add_argument("--caption", default="Keep Original")
    parser.add_argument('--throttle', action='store_true', help='Aktifkan Safe Mode Throttle')
    parser.add_argument('--auto-fallback', action='store_true', help='Aktifkan Auto-Fallback jika chat terproteksi')
    parser.add_argument('--fetch-direction', default='Newest First', help='Arah pengambilan pesan (Newest First / Oldest First)')
    parser.add_argument('--start-date', default=None, help='Filter dari tanggal ini (YYYY-MM-DD)')
    parser.add_argument('--end-date', default=None, help='Filter hingga tanggal ini (YYYY-MM-DD)')
    parser.add_argument('--delay-min', type=float, default=2.0, help='Jeda minimum dalam detik')
    parser.add_argument('--delay-max', type=float, default=5.0, help='Jeda maksimum dalam detik')
    parser.add_argument('--album-handling', default='Follow Source', help='Cara handle grouped media')
    parser.add_argument("--chat-id", required=False)
    parser.add_argument("--config", type=str, help="Job config JSON")
    parser.add_argument("--job-id", type=int, default=None, help="ID Job jika melanjutkan migrasi (opsional)")
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
    
    args = parser.parse_args()
    
    
    if args.action == "create-job":
        if not args.source or not args.destination or not args.session:
            print("[ERROR] --source, --destination, and --session are required for create-job", file=sys.stderr)
            sys.exit(1)
        job_name = None
        config_str = "{}"
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
                pass
        job_id = create_job(args.session, args.source, args.destination, args.mode, config_str, job_name)
        print(f"[JOB_ID]{job_id}")
        return

    if args.action == "edit-job":
        if not args.job_id or not args.source or not args.destination or not args.session:
            print("[ERROR] --job-id, --source, --destination, and --session are required for edit-job", file=sys.stderr)
            sys.exit(1)
        job_name = None
        config_str = "{}"
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
                pass
        from database.queries import update_job
        update_job(args.job_id, args.session, args.source, args.destination, args.mode, config_str, job_name)
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
        from database.queries import update_job
        
        delete_mapping_by_job(str(args.job_id))
        CheckpointManager().delete_checkpoint(str(args.job_id))
        print("[DAEMON] Fresh Start Completed", flush=True)
        return
        
    if args.action == "set-status":
        if not args.job_id or not args.status:
            print("[ERROR] --job-id and --status are required", file=sys.stderr)
            sys.exit(1)
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
        cursor.execute("UPDATE executions SET status = 'FAILED', error_message = 'Process terminated unexpectedly (System Restart)' WHERE status = 'RUNNING'")
        conn.commit()
        print("[DAEMON] Reconciliation complete. Zombie executions marked as FAILED.")
        return

    if args.action == "list-dialogs":
        await list_dialogs(args.session, args.api_id, args.api_hash)
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
        from database.queries import get_job, create_execution, update_execution_status, get_execution
        
        config = {'is_retry': args.action == 'retry-execution'}
        execution_id = None
        
        if args.action == 'retry-execution':
            # Needs --execution-id (we will overload --job-id for it temporarily if needed, but let's add --execution-id manually or parse it)
            # Wait, argparse doesn't have --execution-id. Let's use --job-id as the execution_id for this action
            exec_id = args.job_id
            if not exec_id:
                print("[ERROR] --job-id (used as execution_id) is required for retry-execution", file=sys.stderr)
                sys.exit(1)
            execution = get_execution(exec_id)
            if not execution:
                print(f"[ERROR] Execution ID {exec_id} not found", file=sys.stderr)
                sys.exit(1)
            try:
                config = json.loads(execution.get('snapshot_config_json', '{}'))
            except:
                pass
            config['is_retry'] = True
            config['rerun_mode'] = args.rerun_mode
            config['job_id'] = execution['job_id']
            
            # Create a NEW execution for the retry, using the same snapshot
            execution_id = create_execution(execution['job_id'], execution.get('snapshot_config_json', '{}'))
            
        else:
            if not args.job_id:
                print("[ERROR] --job-id is required for execute-job and run-again", file=sys.stderr)
                sys.exit(1)
                
            from database.queries import get_executions_by_job
            existing_execs = get_executions_by_job(args.job_id)
            if any(e.get('status') == 'RUNNING' for e in existing_execs):
                print(f"[ERROR] Job ID {args.job_id} is already RUNNING. Cannot start multiple instances.", file=sys.stderr)
                sys.exit(1)
                
            job_data = get_job(args.job_id)
            if not job_data:
                print(f"[ERROR] Job ID {args.job_id} not found", file=sys.stderr)
                sys.exit(1)
            try:
                config = json.loads(job_data.get('config_json', '{}'))
            except:
                pass
            
            config['is_retry'] = False
            config['job_id'] = args.job_id
            execution_id = create_execution(args.job_id, json.dumps(config))
            
        # SETUP PERSISTENT LOGGING
        log_dir = os.path.join(os.path.dirname(__file__), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        log_file_path = os.path.join(log_dir, f'job_{args.job_id}_exec_{execution_id}.log')
        sys.stdout = TeeStream(sys.stdout, log_file_path)
        sys.stderr = TeeStream(sys.stderr, log_file_path)
        
        setup_emitter(execution_id, args.job_id)
        emit_event('ExecutionCreated', execution_id=execution_id, jobId=args.job_id)
                
        # Override with any explicit args provided (if they were sent over CLI instead of config)
        if args.source and args.destination:
            config['source_chat'] = args.source
            config['dest_chat'] = args.destination
            
        # Map frontend config keys
        if 'source' in config and 'source_chat' not in config:
            config['source_chat'] = config['source']
        if 'destination' in config and 'dest_chat' not in config:
            config['dest_chat'] = config['destination']
        if 'mode' in config and 'transfer_mode' not in config:
            config['transfer_mode'] = config['mode']
        if 'session' in config and 'session_name' not in config:
            config['session_name'] = config['session']
        if 'delayMin' in config and 'delay_min' not in config:
            config['delay_min'] = config['delayMin']
        if 'delayMax' in config and 'delay_max' not in config:
            config['delay_max'] = config['delayMax']
        if 'size_min' in config and 'size_min_mb' not in config:
            config['size_min_mb'] = config['size_min']
        if 'size_max' in config and 'size_max_mb' not in config:
            config['size_max_mb'] = config['size_max']
        if 'dupAction' in config and 'duplicate_action' not in config:
            config['duplicate_action'] = config['dupAction']
        if 'fetchDirection' in config and 'fetch_direction' not in config:
            config['fetch_direction'] = config['fetchDirection']
        if 'captionRule' in config and 'caption_rule' not in config:
            config['caption_rule'] = config['captionRule']
        if 'albumHandling' in config and 'album_handling' not in config:
            config['album_handling'] = config['albumHandling']
        if 'autoFallback' in config and 'auto_fallback' not in config:
            config['auto_fallback'] = config['autoFallback']
            
        if not config.get('source_chat') or not config.get('dest_chat'):
            print("[ERROR] --source and --destination are required for new migration", file=sys.stderr)
            update_execution_status(execution_id, 'FAILED', "Source/Destination missing")
            sys.exit(1)
            
        # Merge other args
        config['api_id'] = args.api_id or config.get('api_id')
        config['api_hash'] = args.api_hash or config.get('api_hash')
        config['transfer_mode'] = args.mode if args.mode != "Clean Copy" else config.get('transfer_mode', 'Clean Copy')
        config['limit'] = args.limit if args.limit != 5 else config.get('limit', 5)
        config['media_filter'] = args.media if args.media != "Semua" else config.get('media_filter', 'Semua')
        config['dry_run'] = args.dry_run or config.get('dry_run', False)
        config['session_name'] = args.session if args.session != "Lavender" else config.get('session_name', 'Lavender')
        config['duplicate_action'] = args.duplicate_action if args.duplicate_action != "Skip" else config.get('duplicate_action', 'Skip')
        config['size_min_mb'] = args.size_min if args.size_min != 0.0 else config.get('size_min_mb', 0.0)
        config['size_max_mb'] = args.size_max if args.size_max != float('inf') else config.get('size_max_mb', float('inf'))
        config['throttle_active'] = args.throttle or config.get('throttle_active', False)
        config['auto_fallback'] = args.auto_fallback or config.get('auto_fallback', False)
        config['caption_rule'] = args.caption if args.caption != "Keep Original" else config.get('caption_rule', "Keep Original")
        config['album_handling'] = args.album_handling if args.album_handling != 'Follow Source' else config.get('album_handling', 'Follow Source')
        config['fetch_direction'] = args.fetch_direction if args.fetch_direction != 'Newest First' else config.get('fetch_direction', 'Newest First')
        config['start_date'] = args.start_date or config.get('start_date')
        config['end_date'] = args.end_date or config.get('end_date')
        config['delay_min'] = args.delay_min if args.delay_min != 2.0 else config.get('delay_min', 2.0)
        config['delay_max'] = args.delay_max if args.delay_max != 5.0 else config.get('delay_max', 5.0)
        
        # Determine effective API ID and Hash
        effective_api_id = args.api_id if args.api_id else config.get('api_id')
        effective_api_hash = args.api_hash if args.api_hash else config.get('api_hash')
        
        if not effective_api_id or not effective_api_hash:
            print("[EVENT] {\"type\": \"FatalError\", \"error\": \"API_ID and API_HASH are required. Please login.\"}", file=sys.stderr)
            update_execution_status(execution_id, 'FAILED', "API_ID missing")
            sys.exit(1)
            
        print(f"[EVENT] {json.dumps({'type': 'EngineInitialized', 'execution_id': execution_id})}", flush=True)
        session_dir = os.path.join(os.path.dirname(__file__), 'sessions')
        session_file = os.path.join(session_dir, config.get('session_name', 'Lavender'))
        
        # Ekstrak topic ID jika ada
        source_topic_id = None
        source_str = str(config.get('source_chat', ''))
        if '_' in source_str:
            try: source_topic_id = int(source_str.split('_')[1])
            except: pass
            
        dest_topic_id = None
        dest_str = str(config.get('dest_chat', ''))
        if '_' in dest_str:
            try: dest_topic_id = int(dest_str.split('_')[1])
            except: pass
            
        config['source_topic_id'] = source_topic_id
        config['dest_topic_id'] = dest_topic_id
        
        try:
            update_execution_status(execution_id, 'STARTING')
            client = TelegramClient(session_file, int(effective_api_id), effective_api_hash)
            await client.connect()
            if not await client.is_user_authorized():
                print("[EVENT] {\"type\": \"FatalError\", \"error\": \"Sesi tidak valid. Silakan login kembali.\"}", flush=True)
                update_execution_status(execution_id, 'FAILED', "Sesi tidak valid")
                sys.exit(1)
                
            try:
                source_entity = await client.get_input_entity(parse_entity(config.get('source_chat')))
            except ValueError:
                print("[EVENT] {\"type\": \"Log\", \"message\": \"Fetching dialogs to populate cache for Source...\"}", flush=True)
                await client.get_dialogs(limit=100)
                try:
                    source_entity = await client.get_input_entity(parse_entity(config.get('source_chat')))
                except ValueError:
                    emit_event('FatalError', error=f"Chat/Username Sumber '{config.get('source_chat')}' tidak valid.")
                    update_execution_status(execution_id, 'FAILED', "Source invalid")
                    sys.exit(1)
                
            try:
                dest_entity = await client.get_input_entity(parse_entity(config.get('dest_chat')))
            except ValueError:
                print("[EVENT] {\"type\": \"Log\", \"message\": \"Fetching dialogs to populate cache for Dest...\"}", flush=True)
                await client.get_dialogs(limit=100)
                try:
                    dest_entity = await client.get_input_entity(parse_entity(config.get('dest_chat')))
                except ValueError:
                    emit_event('FatalError', error=f"Chat/Username Tujuan '{config.get('dest_chat')}' tidak valid.")
                    update_execution_status(execution_id, 'FAILED', "Destination invalid")
                    sys.exit(1)
            
            update_execution_status(execution_id, 'RUNNING')
            
            mode = config.get('mode', 'Instant Clone')
            if mode == 'Clean Copy':
                # Use RetryScheduler if it's a retry, else EnterpriseEngine
                if config.get('is_retry'):
                    from engine.enterprise.retry_scheduler import RetryScheduler
                    forwarder = RetryScheduler(client, source_entity, dest_entity, execution_id, config)
                else:
                    from engine.enterprise.engine import EnterpriseEngine
                    forwarder = EnterpriseEngine(client, source_entity, dest_entity, execution_id, config)
            else:
                forwarder = MigrationForwarder(client, source_entity, dest_entity, execution_id, config)
                
            await forwarder.execute_migration(limit=config.get('limit', 5))
            
            # The final state is handled inside execute_migration
                
        except Exception as e:
            emit_event('FatalError', error=f"Engine Failed: {str(e)}")
            update_execution_status(execution_id, 'FAILED', str(e))
            sys.exit(1)

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
            client = TelegramClient(session_file, int(args.api_id) if args.api_id else int(config.get('api_id', 0)), args.api_hash or config.get('api_hash', ''))
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
        sys.stdout.reconfigure(line_buffering=True)
    asyncio.run(main())
    
