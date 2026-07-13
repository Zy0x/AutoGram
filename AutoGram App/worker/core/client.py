import os
import sys
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError

from database.queries import get_session, save_session
from core.encryption import decrypt_data, encrypt_data

def get_credentials(api_id_arg=None, api_hash_arg=None):
    api_id = api_id_arg
    api_hash = api_hash_arg

    if not api_id or not api_hash:
        env_path = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
        try:
            from dotenv import load_dotenv
            load_dotenv(dotenv_path=env_path)
            api_id = api_id or os.getenv('TELEGRAM_API_ID')
            api_hash = api_hash or os.getenv('TELEGRAM_API_HASH')
        except ImportError:
            pass

    if not api_id or not api_hash:
        print("ERROR: API_ID dan API_HASH tidak ditemukan. Harap masukkan via GUI atau set di .env", file=sys.stderr)
        sys.exit(1)

    try:
        api_id = int(api_id)
    except ValueError:
        print("ERROR: API_ID harus berupa angka.", file=sys.stderr)
        sys.exit(1)

    return api_id, api_hash

async def create_client(session_name: str, api_id_arg=None, api_hash_arg=None, phone_callback=None, code_callback=None, password_callback=None) -> TelegramClient:
    api_id, api_hash = get_credentials(api_id_arg, api_hash_arg)
    
    session_data = get_session(session_name)
    if session_data and session_data['session_string']:
        try:
            decrypted_str = decrypt_data(session_data['session_string'])
            string_session = StringSession(decrypted_str)
        except:
            string_session = StringSession()
    else:
        string_session = StringSession()

    client = TelegramClient(string_session, api_id, api_hash)
    
    await client.connect()
    if not await client.is_user_authorized():
        if not phone_callback or not code_callback:
            raise ValueError("Klien belum login, tetapi callback UI tidak disediakan.")
            
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
            
        # Simpan sesi setelah login sukses
        session_str = client.session.save()
        save_session(session_name, encrypt_data(session_str), status='active')

    return client
