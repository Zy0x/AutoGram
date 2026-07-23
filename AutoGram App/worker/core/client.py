import os
import sys
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError

from database.queries import get_session, save_session
from core.encryption import decrypt_data, encrypt_data

def _worker_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _parse_dotenv(path):
    """Minimal .env reader (no dependency). Strips optional quotes."""
    out = {}
    if not os.path.isfile(path):
        return out
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                out[k] = v
    except Exception:
        pass
    return out


def get_credentials(api_id_arg=None, api_hash_arg=None):
    api_id = api_id_arg
    api_hash = api_hash_arg

    if not api_id or not api_hash:
        # Prefer worker/.env (API_ID / API_HASH) — same as app seed
        worker_env = os.path.join(_worker_root(), '.env')
        env_map = _parse_dotenv(worker_env)
        api_id = api_id or env_map.get('API_ID') or env_map.get('TELEGRAM_API_ID')
        api_hash = api_hash or env_map.get('API_HASH') or env_map.get('TELEGRAM_API_HASH')
        try:
            from dotenv import load_dotenv
            load_dotenv(dotenv_path=worker_env)
            api_id = api_id or os.getenv('API_ID') or os.getenv('TELEGRAM_API_ID')
            api_hash = api_hash or os.getenv('API_HASH') or os.getenv('TELEGRAM_API_HASH')
        except ImportError:
            pass

    if not api_id or not api_hash:
        print("ERROR: API_ID dan API_HASH tidak ditemukan. Harap masukkan via GUI atau set di worker/.env", file=sys.stderr)
        sys.exit(1)

    try:
        api_id = int(api_id)
    except ValueError:
        print("ERROR: API_ID harus berupa angka.", file=sys.stderr)
        sys.exit(1)

    return api_id, api_hash


def resolve_session_path(session_name: str) -> str:
    """Absolute path base for Telethon SQLite session (without .session suffix)."""
    sessions_dir = os.path.join(_worker_root(), 'sessions')
    os.makedirs(sessions_dir, exist_ok=True)
    return os.path.join(sessions_dir, session_name)


import sqlite3 as _sqlite3

def patch_telethon_sqlite_session():
    try:
        from telethon.sessions import SQLiteSession
        if not getattr(SQLiteSession._cursor, '_is_patched', False):
            orig_cursor = SQLiteSession._cursor
            
            def patched_cursor(self):
                cursor = orig_cursor(self)
                try:
                    if self._conn is not None:
                        if not getattr(self._conn, '_patched_wal_timeout', False):
                            # Set the flag first to prevent loop on exceptions
                            setattr(self._conn, '_patched_wal_timeout', True)
                            
                            # These connection-scoped settings can be executed safely at any time
                            self._conn.execute("PRAGMA busy_timeout=15000;")
                            self._conn.execute("PRAGMA synchronous=NORMAL;")
                            
                            # journal_mode=WAL can fail if called inside a transaction
                            try:
                                self._conn.execute("PRAGMA journal_mode=WAL;")
                            except Exception:
                                pass
                except Exception:
                    pass
                return cursor
                
            patched_cursor._is_patched = True
            SQLiteSession._cursor = patched_cursor
    except Exception:
        pass

patch_telethon_sqlite_session()

def _patch_session_wal(session_file: str) -> None:
    db_path = (
        session_file + '.session'
        if not session_file.endswith('.session')
        else session_file
    )
    if not os.path.isfile(db_path):
        return
    try:
        conn = _sqlite3.connect(db_path, timeout=5.0)
        try:
            conn.execute('PRAGMA journal_mode=WAL;')
            conn.execute('PRAGMA busy_timeout=15000;')
            conn.execute('PRAGMA synchronous=NORMAL;')
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


async def create_client(session_name: str, api_id_arg=None, api_hash_arg=None, phone_callback=None, code_callback=None, password_callback=None, connection_retries=5) -> TelegramClient:
    """
    Prefer worker/sessions/<name>.session (file) — same as daemon execute-job / Media Studio.
    Fall back to encrypted StringSession in SQLite if no file exists.
    Supports in-memory ghost clients derived from the canonical database session string.
    Applies AUTOGRAM_* proxy/VPN env from Rust desktop network settings.
    """
    api_id, api_hash = get_credentials(api_id_arg, api_hash_arg)

    # Network hybrid: Rust owns proxy/VPN UI; Python applies to Telethon
    from core.network_env import apply_client_post_create, telethon_client_kwargs

    net_kw = telethon_client_kwargs()
    # Allow caller override for connection_retries only when VPN env not set stronger
    if connection_retries and connection_retries > int(net_kw.get("connection_retries") or 0):
        net_kw["connection_retries"] = connection_retries
    ctor = {k: v for k, v in net_kw.items() if not str(k).startswith("_autogram_")}

    # Detect if session_name is a ghost session view
    is_ghost = False
    base_name = session_name
    purpose = "unknown"
    for suffix in ["_migration", "_preview"]:
        if suffix in session_name:
            is_ghost = True
            purpose = suffix.replace("_", "")
            base_name = session_name.split(suffix)[0]
            break

    if is_ghost:
        # Ghost Session: Completely in-memory using derived StringSession
        session_data = get_session(base_name)
        if session_data and session_data.get('session_string'):
            try:
                decrypted_str = decrypt_data(session_data['session_string'])
                string_session = StringSession(decrypted_str)
            except Exception:
                string_session = StringSession()
        else:
            string_session = StringSession()

        device_model = f"AutoGram Ghost {purpose.capitalize()}"
        system_version = "V2-Reborn"
        app_version = "2.1.52"

        client = TelegramClient(
            string_session,
            api_id,
            api_hash,
            device_model=device_model,
            system_version=system_version,
            app_version=app_version,
            **ctor,
        )
        apply_client_post_create(client, dict(net_kw))
    else:
        # Standard Session: File-based if file exists, else StringSession
        file_base = resolve_session_path(session_name)
        file_session = file_base + '.session'

        if os.path.isfile(file_session):
            # File-based session (Lavender.session, Mantan Gadis.session, …)
            _patch_session_wal(file_base)
            client = TelegramClient(
                file_base,
                api_id,
                api_hash,
                **ctor,
            )
            apply_client_post_create(client, dict(net_kw))
        else:
            session_data = get_session(session_name)
            if session_data and session_data.get('session_string'):
                try:
                    decrypted_str = decrypt_data(session_data['session_string'])
                    string_session = StringSession(decrypted_str)
                except Exception:
                    string_session = StringSession()
            else:
                string_session = StringSession()
            client = TelegramClient(
                string_session,
                api_id,
                api_hash,
                **ctor,
            )
            apply_client_post_create(client, dict(net_kw))

    await client.connect()
    if not await client.is_user_authorized():
        if not phone_callback or not code_callback:
            raise ValueError(
                f"Session '{session_name}' belum login / file session tidak valid. "
                "Login ulang di Accounts."
            )

        phone = await phone_callback()
        await client.send_code_request(phone)

        try:
            code = await code_callback()
            await client.sign_in(phone, code)
        except SessionPasswordNeededError:
            if not password_callback:
                raise ValueError("Akun menggunakan 2FA, tetapi password_callback tidak disediakan.")
            password = await password_callback()
            await client.sign_in(password=password)

        # Persist StringSession copy in DB + ensure file session saved
        try:
            session_str = client.session.save()
            if isinstance(session_str, str) and session_str:
                save_session(session_name, encrypt_data(session_str), status='active')
        except Exception:
            pass

    return client

