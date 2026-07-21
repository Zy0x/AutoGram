import argparse
import asyncio
import json
import sys
import os
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    SessionPasswordNeededError, 
    PhoneCodeInvalidError, 
    PasswordHashInvalidError,
    FloodWaitError,
    PhoneCodeExpiredError,
    ApiIdInvalidError
)
import sqlite3

# Import DB and Encryption
from database.queries import save_session, get_session, get_all_sessions, delete_session
from core.encryption import encrypt_data, decrypt_data

def get_client_and_string(session_name, api_id, api_hash):
    session_data = get_session(session_name)
    if session_data and session_data['session_string']:
        try:
            decrypted_str = decrypt_data(session_data['session_string'])
            string_session = StringSession(decrypted_str)
        except Exception as e:
            string_session = StringSession()
    else:
        string_session = StringSession()
        
    client = TelegramClient(string_session, int(api_id), api_hash)
    return client, string_session

def save_client_session(session_name, client):
    session_str = client.session.save()
    encrypted_str = encrypt_data(session_str)
    save_session(session_name, encrypted_str, status='active')

    sessions_dir = os.path.join(os.path.dirname(__file__), "sessions")
    os.makedirs(sessions_dir, exist_ok=True)
    
    file_sess_path = os.path.join(sessions_dir, f"{session_name}.session")
    grammers_sess_path = os.path.join(sessions_dir, f"{session_name}.grammers.json")
    
    # Remove stale grammers json cache so Rust re-imports fresh auth_key automatically
    if os.path.exists(grammers_sess_path):
        try:
            os.remove(grammers_sess_path)
        except Exception:
            pass

    # Ensure worker/sessions/<session_name>.session contains SQLite auth_key
    try:
        if getattr(client.session, 'auth_key', None):
            file_client = TelegramClient(file_sess_path, client.api_id, client.api_hash)
            file_client.session.auth_key = client.session.auth_key
            file_client.session.server_address = client.session.server_address
            file_client.session.port = client.session.port
            file_client.session.dc_id = client.session.dc_id
            file_client.session.save()
    except Exception:
        pass

async def send_code(session_name, phone, api_id, api_hash):
    client, _ = get_client_and_string(session_name, api_id, api_hash)
    
    try:
        await asyncio.wait_for(client.connect(), timeout=15.0)
        
        if await client.is_user_authorized():
            print(json.dumps({"status": "already_authorized"}))
            return
            
        sent = await client.send_code_request(phone)
        save_client_session(session_name, client)
        print(json.dumps({"status": "code_sent", "phone_code_hash": sent.phone_code_hash}))
    except TimeoutError:
        print(json.dumps({"error": "timeout"}))
    except FloodWaitError as e:
        print(json.dumps({"error": "flood_wait", "seconds": e.seconds}))
    except ApiIdInvalidError:
        print(json.dumps({"error": "invalid_api_id"}))
    except sqlite3.OperationalError:
        print(json.dumps({"error": "db_locked"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
    finally:
        await client.disconnect()

async def sign_in(session_name, phone, code, phone_code_hash, api_id, api_hash):
    client, _ = get_client_and_string(session_name, api_id, api_hash)
    
    try:
        await asyncio.wait_for(client.connect(), timeout=15.0)
        await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        save_client_session(session_name, client)
        print(json.dumps({"status": "success"}))
    except SessionPasswordNeededError:
        save_client_session(session_name, client)
        print(json.dumps({"status": "2fa_required"}))
    except PhoneCodeInvalidError:
        print(json.dumps({"error": "invalid_otp"}))
    except PhoneCodeExpiredError:
        print(json.dumps({"error": "code_expired"}))
    except TimeoutError:
        print(json.dumps({"error": "timeout"}))
    except FloodWaitError as e:
        print(json.dumps({"error": "flood_wait", "seconds": e.seconds}))
    except sqlite3.OperationalError:
        print(json.dumps({"error": "db_locked"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
    finally:
        await client.disconnect()

async def sign_in_2fa(session_name, password, api_id, api_hash):
    client, _ = get_client_and_string(session_name, api_id, api_hash)
    
    try:
        await asyncio.wait_for(client.connect(), timeout=15.0)
        await client.sign_in(password=password)
        save_client_session(session_name, client)
        print(json.dumps({"status": "success"}))
    except PasswordHashInvalidError:
        print(json.dumps({"error": "invalid_password"}))
    except TimeoutError:
        print(json.dumps({"error": "timeout"}))
    except FloodWaitError as e:
        print(json.dumps({"error": "flood_wait", "seconds": e.seconds}))
    except sqlite3.OperationalError:
        print(json.dumps({"error": "db_locked"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
    finally:
        await client.disconnect()

def _scan_session_files():
    """File-based Telethon sessions under worker/sessions/*.session (used by daemon/drive)."""
    sessions_dir = os.path.join(os.path.dirname(__file__), "sessions")
    names = []
    if not os.path.isdir(sessions_dir):
        return names
    for f in os.listdir(sessions_dir):
        if not f.endswith(".session"):
            continue
        # skip journal/wal sidecars
        if f.endswith(".session-journal") or "-journal" in f:
            continue
        name = f[: -len(".session")]
        if name and not name.startswith(".") and not name.endswith("_preview"):
            names.append(name)
    return names


async def list_sessions_action(api_id, api_hash, verify: bool = False):
    """
    Always list known sessions from DB + session files.
    Missing API credentials must NOT return an empty list (UI looked like data loss).
    Live Telegram checks only when verify=True AND api_id + api_hash present.
    Default is offline (fast) — Media Studio must not block on N× Telethon connects.
    Never auto-delete sessions on soft auth failures.
    """
    by_name = {}

    # 1) StringSession rows in SQLite
    try:
        for sess in get_all_sessions():
            name = sess.get("name") if isinstance(sess, dict) else sess[0]
            if not name or name.endswith("_preview"):
                continue
            status = "stored"
            if isinstance(sess, dict) and sess.get("status"):
                status = sess["status"]
            by_name[name] = {"name": name, "status": status, "source": "db"}
    except Exception as e:
        print(json.dumps({"error": f"db_list_failed: {e}", "sessions": []}), flush=True)
        return

    # 2) File sessions (Lavender.session, Mantan Gadis.session, …)
    for name in _scan_session_files():
        if name in by_name:
            by_name[name]["source"] = "db+file"
            if by_name[name].get("status") in (None, "", "stored"):
                by_name[name]["status"] = "active"
        else:
            by_name[name] = {"name": name, "status": "active", "source": "file"}

    # Offline default: treat stored/file sessions as usable without Telegram RTT
    if not verify or not api_id or not api_hash:
        for info in by_name.values():
            if info.get("status") in (None, "", "stored"):
                info["status"] = "active"
        print(json.dumps({"sessions": list(by_name.values())}), flush=True)
        return

    # 3) Live check (only when verify=True)
    for session_name, info in list(by_name.items()):
        client = None
        try:
            sessions_dir = os.path.join(os.path.dirname(__file__), "sessions")
            file_base = os.path.join(sessions_dir, session_name)
            if os.path.exists(file_base + ".session"):
                client = TelegramClient(file_base, int(api_id), str(api_hash))
            else:
                client, _ = get_client_and_string(session_name, api_id, api_hash)

            await client.connect()
            authorized = await client.is_user_authorized()
            if authorized:
                status = "active"
                try:
                    me = await client.get_me()
                    if not me:
                        status = "expired"
                except Exception as e:
                    err_str = str(e).lower()
                    if any(
                        k in err_str
                        for k in ("auth", "deactivated", "revoke", "unregistered")
                    ):
                        status = "expired"
                    else:
                        status = "error"
                info["status"] = status
            else:
                info["status"] = "expired"
            await client.disconnect()
        except Exception:
            info["status"] = info.get("status") or "error"
            if client is not None:
                try:
                    await client.disconnect()
                except Exception:
                    pass

    print(json.dumps({"sessions": list(by_name.values())}), flush=True)

async def delete_session_action(session_name, api_id=None, api_hash=None):
    try:
        if api_id and api_hash:
            try:
                client, _ = get_client_and_string(session_name, api_id, api_hash)
                await asyncio.wait_for(client.connect(), timeout=3.0)
                if await client.is_user_authorized():
                    await asyncio.wait_for(client.log_out(), timeout=3.0)
                await client.disconnect()
            except Exception:
                pass

        delete_session(session_name)
        sessions_dir = os.environ.get("AUTOGRAM_SESSIONS_DIR", os.path.join(os.path.dirname(__file__), 'sessions'))
        s_name = session_name.strip().removesuffix('.session')

        for ext in ('.session', '.grammers.json', '.session-journal', '.session.lock'):
            target_path = os.path.join(sessions_dir, f"{s_name}{ext}")
            if os.path.exists(target_path):
                for attempt in range(5):
                    try:
                        os.remove(target_path)
                        break
                    except Exception:
                        await asyncio.sleep(0.1)

        print(json.dumps({"status": "success", "message": f"Session {session_name} deleted"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

async def qr_export_action(session_name, api_id, api_hash):
    import time
    client, _ = get_client_and_string(session_name, api_id, api_hash)
    try:
        await asyncio.wait_for(client.connect(), timeout=10.0)
        if await client.is_user_authorized():
            save_client_session(session_name, client)
            print(json.dumps({"status": "already_authorized"}), flush=True)
            return

        qr_login = await client.qr_login()
        save_client_session(session_name, client)
        expires = int(qr_login.expires.timestamp()) if getattr(qr_login, "expires", None) else (int(time.time()) + 60)

        print(
            json.dumps({
                "status": "qr_code",
                "url": qr_login.url,
                "token": qr_login.token.hex() if hasattr(qr_login.token, "hex") else str(qr_login.token),
                "expires": expires,
            }),
            flush=True,
        )

        try:
            await qr_login.wait(timeout=50)
            save_client_session(session_name, client)
            sessions_dir = os.environ.get("AUTOGRAM_SESSIONS_DIR", os.path.join(os.path.dirname(__file__), "sessions"))
            grammers_file = os.path.join(sessions_dir, f"{session_name}.grammers.json")
            if os.path.exists(grammers_file):
                try:
                    os.remove(grammers_file)
                except Exception:
                    pass
            print(json.dumps({"status": "success"}), flush=True)
        except errors.SessionPasswordNeededError:
            save_client_session(session_name, client)
            print(json.dumps({"status": "2fa_required"}), flush=True)
        except Exception:
            pass
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

async def qr_check_action(session_name, api_id, api_hash):
    client, _ = get_client_and_string(session_name, api_id, api_hash)
    try:
        await asyncio.wait_for(client.connect(), timeout=8.0)
        if await client.is_user_authorized():
            save_client_session(session_name, client)
            sessions_dir = os.environ.get("AUTOGRAM_SESSIONS_DIR", os.path.join(os.path.dirname(__file__), "sessions"))
            grammers_file = os.path.join(sessions_dir, f"{session_name}.grammers.json")
            if os.path.exists(grammers_file):
                try:
                    os.remove(grammers_file)
                except Exception:
                    pass
            print(json.dumps({"status": "success"}), flush=True)
            return

        print(json.dumps({"status": "pending"}), flush=True)
    except Exception as e:
        msg = str(e).lower()
        if "unregistered" in msg or "expired" in msg:
            print(json.dumps({"error": "qr_expired"}), flush=True)
        else:
            print(json.dumps({"status": "pending"}), flush=True)
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--action', choices=['send-code', 'sign-in', 'sign-in-2fa', 'list-sessions', 'delete-session', 'qr-login', 'qr-export', 'qr-check'], required=True)
    parser.add_argument('--api-id', required=False)
    parser.add_argument('--api-hash', required=False)
    parser.add_argument('--session', required=False)
    parser.add_argument('--phone', required=False)
    parser.add_argument('--code', required=False)
    parser.add_argument('--hash', required=False)
    parser.add_argument('--password', required=False)
    parser.add_argument(
        '--verify',
        action='store_true',
        help='Live-check each session via Telegram (slow). Default is offline list only.',
    )
    
    args = parser.parse_args()
    
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(line_buffering=True)
        
    if args.action == 'list-sessions':
        asyncio.run(list_sessions_action(args.api_id, args.api_hash, verify=bool(args.verify)))
    elif args.action == 'delete-session':
        asyncio.run(delete_session_action(args.session, args.api_id, args.api_hash))
    elif args.action == 'send-code':
        asyncio.run(send_code(args.session, args.phone, args.api_id, args.api_hash))
    elif args.action == 'sign-in':
        asyncio.run(sign_in(args.session, args.phone, args.code, args.hash, args.api_id, args.api_hash))
    elif args.action == 'sign-in-2fa':
        asyncio.run(sign_in_2fa(args.session, args.password, args.api_id, args.api_hash))
    elif args.action in ('qr-login', 'qr-export'):
        asyncio.run(qr_export_action(args.session, args.api_id, args.api_hash))
    elif args.action == 'qr-check':
        asyncio.run(qr_check_action(args.session, args.api_id, args.api_hash))

if __name__ == '__main__':
    main()
