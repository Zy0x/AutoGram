---
name: telethon-best-practices
description: Panduan dan snippets untuk penggunaan Telethon, manajemen session, handling FloodWaitError, dan interaksi yang aman dengan API Telegram. Gunakan skill ini setiap menulis fitur terkait Telegram di AutoGram.
---

# Telethon Best Practices untuk AutoGram

Skill ini memberikan panduan wajib untuk berinteraksi dengan API Telegram menggunakan `telethon` dalam lingkungan proyek AutoGram.

## 1. Handling FloodWaitError
Semua panggilan API Telegram yang bersifat memodifikasi, mengunduh media, atau melakukan iterasi panjang (seperti `iter_messages`, `send_file`, `send_message`) wajib di-*wrap* dengan penanganan `FloodWaitError`.

```python
import asyncio
from telethon.errors import FloodWaitError

async def safe_api_call(client, func, *args, **kwargs):
    max_retries = 3
    for attempt in range(max_retries):
        try:
            return await func(*args, **kwargs)
        except FloodWaitError as e:
            print(f"[Warning] Terkena FloodWaitError, menunggu {e.seconds} detik...")
            await asyncio.sleep(e.seconds)
    raise Exception("Gagal mengeksekusi panggilan API Telegram setelah maksimal retry.")
```

## 2. Penggunaan Sesi
Selalu simpan sesi ke dalam folder yang aman dan jangan biarkan terhapus secara tidak sengaja. Pada *production*, disarankan untuk menempatkan SQLite `.session` pada storage yang persisten atau menyimpannya dalam Supabase jika aplikasi menjadi *stateless*.

## 3. Rate Limiting Otomatis
Telegram membatasi _request_ per detiknya. Saat melakukan _forward_ ratusan media, selalu berikan `await asyncio.sleep(2)` hingga `3` setelah setiap `send_file` untuk menghindari pemblokiran akun.
