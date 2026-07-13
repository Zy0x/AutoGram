import time
import datetime
from croniter import croniter
import subprocess
import os
import sys
import json

# Setup path untuk bisa import folder database
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from database.queries import get_automation_jobs, update_automation_last_run

DAEMON_SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'daemon.py')

def execute_job(job):
    print(f"[BACKGROUND] Menjalankan Automation Job: {job['name']}", flush=True)
    try:
        config = {}
        if job.get('config_json'):
            try:
                config = json.loads(job['config_json'])
            except: pass
            
        args = [sys.executable, DAEMON_SCRIPT]
        
        is_realtime = job.get('is_realtime')
        if is_realtime:
            args.extend(['--action', 'sync'])
        else:
            args.extend(['--action', 'migrate'])
            
        args.extend(['--source', job['source_entity_id'], '--destination', job['target_entity_id']])
        if job.get('session_name'):
            args.extend(['--session', job['session_name']])
            
        if 'transfer_mode' in config: args.extend(['--mode', config['transfer_mode']])
        if 'media_filter' in config: args.extend(['--media', config['media_filter']])
        if 'duplicate_action' in config: args.extend(['--duplicate-action', config['duplicate_action']])
        
        # Eksekusi sebagai subprocess terpisah (asynchronous / detached)
        # Menghindari background worker terblokir
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[BACKGROUND] Job {job['name']} berhasil di-spawn.", flush=True)
    except Exception as e:
        print(f"[BACKGROUND] Gagal menjalankan job: {e}", flush=True)

def main_loop():
    print("[BACKGROUND] Worker Automation Scheduler berjalan...", flush=True)
    
    while True:
        try:
            jobs = get_automation_jobs()
            now = datetime.datetime.now()
            
            for job in jobs:
                if job['status'] != 'active':
                    continue
                    
                if job['cron_expression']:
                    try:
                        last_run = job.get('last_run_at')
                        last_run_dt = datetime.datetime.strptime(last_run, "%Y-%m-%d %H:%M:%S") if last_run else None
                        
                        if not last_run_dt:
                            execute_job(job)
                            update_automation_last_run(job['id'])
                        else:
                            cron = croniter(job['cron_expression'], last_run_dt)
                            next_run = cron.get_next(datetime.datetime)
                            if now >= next_run:
                                execute_job(job)
                                update_automation_last_run(job['id'])
                    except Exception as e:
                        print(f"[BACKGROUND] Error cron job {job['id']}: {e}", flush=True)
                
                elif job['is_realtime']:
                    # Realtime sync biasanya long-running
                    # Jika worker ini di-restart, kita perlu pastikan proses realtime jalan
                    # Untuk versi simple ini, kita spawn 1x jika belum pernah run
                    last_run = job.get('last_run_at')
                    if not last_run:
                        execute_job(job)
                        update_automation_last_run(job['id'])
                        
        except Exception as e:
            print(f"[BACKGROUND] Error di main loop: {e}", flush=True)
            
        time.sleep(60) # Cek setiap 1 menit

if __name__ == "__main__":
    main_loop()
