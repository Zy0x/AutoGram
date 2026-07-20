import os
import sys
import asyncio
import urllib.parse
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import aiohttp
import zipstream

from core.client import create_client
from engine.drive_fs import _resolve_peer
from telethon.tl.types import InputMessagesFilterDocument

app = FastAPI(title="AutoGram Media Studio API", version="3.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache for active clients: session_name -> TelegramClient
clients_cache = {}
loop_instance = None

class RemoteUploadRequest(BaseModel):
    url: str
    folder_id: Optional[str] = None

class AsyncStreamReader:
    """Wraps an aiohttp stream to act as a synchronous file-like reader for Telethon."""
    def __init__(self, response_content, loop, total_size=None):
        self.content = response_content
        self.loop = loop
        self.total_size = total_size
        self.read_bytes = 0

    def read(self, n=-1):
        # Read from aiohttp content stream in the main loop
        coro = self.content.read(n)
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        chunk = future.result()
        self.read_bytes += len(chunk)
        return chunk

def get_message_filename(message, default="file"):
    if message.document:
        for attr in message.document.attributes:
            if hasattr(attr, 'file_name') and attr.file_name:
                return attr.file_name
    return default

def sync_chunk_generator(loop, client, document):
    """Synchronous chunk generator running async Telethon downloads thread-safely."""
    offset = 0
    chunk_size = 512 * 1024  # 512KB chunks for high performance
    while offset < document.size:
        coro = client.download_file(
            document,
            file=bytes,
            offset=offset,
            limit=chunk_size
        )
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        chunk = future.result()
        if not chunk:
            break
        yield chunk
        offset += len(chunk)

def ensure_api_session(session_name: str) -> str:
    if not session_name or session_name.endswith("_api") or session_name.endswith("_preview"):
        return session_name
        
    worker_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    sessions_dir = os.path.join(worker_dir, 'sessions')
    os.makedirs(sessions_dir, exist_ok=True)
    
    src_db = os.path.join(sessions_dir, f"{session_name}.session")
    dest_db = os.path.join(sessions_dir, f"{session_name}_api.session")
    
    if not os.path.exists(src_db):
        return session_name
        
    try:
        import sqlite3
        # Open source database in read-only mode to prevent locking conflicts
        src_conn = sqlite3.connect(f"file:{src_db}?mode=ro", uri=True)
        dest_conn = sqlite3.connect(dest_db)
        
        with src_conn:
            src_conn.backup(dest_conn)
            
        src_conn.close()
        dest_conn.close()
        
        # Apply WAL patch to destination session database
        from core.client import _patch_session_wal
        _patch_session_wal(dest_db)
        
        print(f"[API] Atomic clone of session created: {session_name}_api", flush=True)
        return f"{session_name}_api"
    except Exception as e:
        print(f"[API] Warning: Failed to clone session dynamically: {e}. Falling back to original session.", flush=True)
        return session_name

async def get_client(
    session: Optional[str] = None,
    api_id: Optional[str] = None,
    api_hash: Optional[str] = None,
    x_telegram_session: Optional[str] = Header(None, alias="X-Telegram-Session"),
    x_telegram_api_id: Optional[str] = Header(None, alias="X-Telegram-Api-Id"),
    x_telegram_api_hash: Optional[str] = Header(None, alias="X-Telegram-Api-Hash"),
):
    target_session = x_telegram_session or session or os.environ.get("AUTOGRAM_API_SESSION") or "Lavender"
    target_api_id = x_telegram_api_id or api_id or os.environ.get("AUTOGRAM_API_ID")
    target_api_hash = x_telegram_api_hash or api_hash or os.environ.get("AUTOGRAM_API_HASH")
    
    if target_session in (None, '', '__DEFAULT_SESSION__'):
        target_session = 'Lavender'
        
    api_session_name = ensure_api_session(target_session)
    
    global clients_cache
    if api_session_name in clients_cache:
        client = clients_cache[api_session_name]
        if client.is_connected():
            return client
            
    print(f"[API] Connecting Telethon client for session: {api_session_name}...", flush=True)
    try:
        client = await create_client(
            session_name=api_session_name,
            api_id_arg=int(target_api_id) if target_api_id else None,
            api_hash_arg=target_api_hash
        )
        clients_cache[api_session_name] = client
        print(f"[API] Connected client for session: {api_session_name}", flush=True)
        return client
    except Exception as e:
        print(f"[API] Failed to connect client for {api_session_name}: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=503, detail=f"Telegram client not connected: {str(e)}")

@app.on_event("startup")
async def startup_event():
    global loop_instance
    loop_instance = asyncio.get_running_loop()
    print("[API] FastAPI server startup complete. Loop acquired.", flush=True)
    # Warm up client connection for default session in background if credentials exist
    default_session = os.environ.get("AUTOGRAM_API_SESSION")
    if default_session:
        asyncio.create_task(get_client())

@app.on_event("shutdown")
async def shutdown_event():
    global clients_cache
    print(f"[API] Disconnecting {len(clients_cache)} cached clients...", flush=True)
    for name, client in list(clients_cache.items()):
        try:
            await client.disconnect()
        except Exception:
            pass
    clients_cache.clear()

@app.get("/health")
async def health(
    session: Optional[str] = Query(None),
    x_telegram_session: Optional[str] = Header(None, alias="X-Telegram-Session")
):
    target_session = x_telegram_session or session or os.environ.get("AUTOGRAM_API_SESSION") or "Lavender"
    if target_session in (None, '', '__DEFAULT_SESSION__'):
        target_session = 'Lavender'
    api_session_name = f"{target_session}_api"
    
    global clients_cache
    client = clients_cache.get(api_session_name)
    connected = client.is_connected() if client else False
    
    return {
        "status": "ok",
        "version": "3.0.0",
        "session": target_session,
        "client_connected": connected
    }

@app.get("/api/v1/folders/{folder_id}/download-all")
async def download_all(
    folder_id: str,
    session: Optional[str] = Query(None),
    api_id: Optional[str] = Query(None),
    api_hash: Optional[str] = Query(None)
):
    client = await get_client(session=session, api_id=api_id, api_hash=api_hash)
    global loop_instance
        
    actual_id = None
    if folder_id not in (None, '', 'home', 'me', 'null', 'None'):
        try:
            actual_id = int(folder_id)
        except ValueError:
            pass
            
    try:
        peer = await _resolve_peer(client, actual_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve folder peer: {e}")
        
    documents = []
    async for message in client.iter_messages(peer, filter=InputMessagesFilterDocument):
        if message.document:
            documents.append((message.document, get_message_filename(message)))
            
    if not documents:
        raise HTTPException(status_code=404, detail="No files found in folder to download")
        
    z = zipstream.ZipStream()
    for doc, filename in documents:
        z.add(sync_chunk_generator(loop_instance, client, doc), filename)
        
    headers = {
        "Content-Disposition": f"attachment; filename=folder_{folder_id or 'root'}.zip"
    }
    return StreamingResponse(z, media_type="application/zip", headers=headers)

@app.post("/api/v1/remote-upload")
async def remote_upload(
    payload: RemoteUploadRequest,
    x_telegram_session: Optional[str] = Header(None, alias="X-Telegram-Session"),
    x_telegram_api_id: Optional[str] = Header(None, alias="X-Telegram-Api-Id"),
    x_telegram_api_hash: Optional[str] = Header(None, alias="X-Telegram-Api-Hash")
):
    client = await get_client(
        x_telegram_session=x_telegram_session,
        x_telegram_api_id=x_telegram_api_id,
        x_telegram_api_hash=x_telegram_api_hash
    )
    global loop_instance
        
    url = payload.url
    actual_folder_id = None
    if payload.folder_id not in (None, '', 'home', 'me', 'null', 'None'):
        try:
            actual_folder_id = int(payload.folder_id)
        except ValueError:
            pass
            
    try:
        peer = await _resolve_peer(client, actual_folder_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve folder peer: {e}")

    # Parse filename from URL path
    parsed = urllib.parse.urlparse(url)
    filename = os.path.basename(parsed.path)
    if not filename:
        filename = "remote_file"

    print(f"[API] Starting remote upload from {url} to folder {payload.folder_id}...", flush=True)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise HTTPException(status_code=400, detail=f"Failed to fetch file from URL (HTTP status {response.status})")
                
                total_size = response.content_length
                # Use custom AsyncStreamReader to pipe HTTP stream into Telethon's upload_file
                stream_reader = AsyncStreamReader(response.content, loop_instance, total_size)
                
                uploaded_file = await client.upload_file(
                    stream_reader,
                    file_name=filename,
                    file_size=total_size
                )
                
                # Send the uploaded document to target channel/Saved Messages
                await client.send_file(peer, uploaded_file, caption=f"Remote upload from: {url}")
                
        return {"status": "success", "filename": filename, "size": total_size}
    except Exception as e:
        print(f"[API] Remote upload failed: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail=f"Remote upload failed: {str(e)}")
