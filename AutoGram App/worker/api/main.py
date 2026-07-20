import os
import sys
import asyncio
import urllib.parse
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from pydantic import BaseModel
import aiohttp

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


def get_message_filename(message, default="file"):
    if message.document:
        for attr in message.document.attributes:
            if hasattr(attr, 'file_name') and attr.file_name:
                return attr.file_name
    return default

def cleanup_files(temp_job_dir: str, zip_path: Optional[str] = None):
    import shutil
    try:
        if os.path.exists(temp_job_dir):
            shutil.rmtree(temp_job_dir, ignore_errors=True)
            print(f"[API] Cleaned up temporary folder: {temp_job_dir}", flush=True)
    except Exception as e:
        print(f"[API] Warning: Failed to clean up temp folder {temp_job_dir}: {e}", flush=True)
        
    if zip_path:
        try:
            if os.path.exists(zip_path):
                os.remove(zip_path)
                print(f"[API] Cleaned up temporary ZIP file: {zip_path}", flush=True)
        except Exception as e:
            print(f"[API] Warning: Failed to delete temp ZIP {zip_path}: {e}", flush=True)

def ensure_api_session(session_name: str) -> str:
    if not session_name or session_name.endswith("_api") or session_name.endswith("_preview"):
        return session_name
        
    worker_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    sessions_dir = os.path.join(worker_dir, 'sessions')
    os.makedirs(sessions_dir, exist_ok=True)
    
    src_db = os.path.join(sessions_dir, f"{session_name}.session")
    dest_db = os.path.join(sessions_dir, f"{session_name}_api.session")
    
    if os.path.exists(dest_db) and os.path.exists(src_db):
        if os.path.getmtime(src_db) <= os.path.getmtime(dest_db):
            return f"{session_name}_api"
        
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
    background_tasks: BackgroundTasks,
    session: Optional[str] = Query(None),
    api_id: Optional[str] = Query(None),
    api_hash: Optional[str] = Query(None)
):
    client = await get_client(session=session, api_id=api_id, api_hash=api_hash)
        
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
        
    import tempfile
    import shutil
    import zipfile
    
    worker_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    temp_dir = os.path.join(worker_dir, 'temp')
    os.makedirs(temp_dir, exist_ok=True)
    
    # Create unique temporary folder for download task
    temp_job_dir = tempfile.mkdtemp(dir=temp_dir, prefix="zip_job_")
    
    try:
        print(f"[API] Downloading {len(documents)} files for ZIP generation in: {temp_job_dir}...", flush=True)
        for doc, filename in documents:
            dest_path = os.path.join(temp_job_dir, filename)
            await client.download_file(doc, dest_path)
            
        # Create ZIP file
        zip_path = os.path.join(temp_dir, f"zip_out_{tempfile.mktemp(dir='')}.zip")
        print(f"[API] Creating ZIP archive at: {zip_path}...", flush=True)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_f:
            for filename in os.listdir(temp_job_dir):
                file_path = os.path.join(temp_job_dir, filename)
                zip_f.write(file_path, filename)
                
        # Register post-completion cleanup task
        background_tasks.add_task(cleanup_files, temp_job_dir, zip_path)
        
        headers = {
            "Content-Disposition": f"attachment; filename=folder_{folder_id or 'root'}.zip"
        }
        return FileResponse(zip_path, media_type="application/zip", headers=headers)
        
    except Exception as e:
        cleanup_files(temp_job_dir, None)
        print(f"[API] ZIP download-all job failed: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate ZIP archive: {str(e)}")

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

    import tempfile
    worker_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    temp_dir = os.path.join(worker_dir, 'temp')
    os.makedirs(temp_dir, exist_ok=True)
    
    # Generate unique temporary file name
    temp_fd, temp_path = tempfile.mkstemp(dir=temp_dir, suffix=".tmp")
    os.close(temp_fd) # Close file descriptor immediately to write via standard open()

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        # Download step
        total_size = 0
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=300) as response:
                if response.status != 200:
                    raise HTTPException(
                        status_code=400, 
                        detail=f"Failed to fetch file from URL (HTTP status {response.status})"
                    )
                
                content_len = response.content_length
                print(f"[API] Downloading URL to temp file: {temp_path} (expected size: {content_len})...", flush=True)
                
                with open(temp_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(1024 * 1024): # 1MB chunks
                        f.write(chunk)
                        total_size += len(chunk)

        print(f"[API] Download complete ({total_size} bytes). Uploading to Telegram...", flush=True)
        
        # Upload step
        uploaded_file = await client.upload_file(
            temp_path,
            file_name=filename
        )
        
        # Send step
        await client.send_file(peer, uploaded_file, caption=f"Remote upload from: {url}")
        print(f"[API] Remote upload finished successfully: {filename}", flush=True)
        
        return {"status": "success", "filename": filename, "size": total_size}
    except Exception as e:
        print(f"[API] Remote upload failed: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail=f"Remote upload failed: {str(e)}")
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
                print(f"[API] Cleaned up temp file: {temp_path}", flush=True)
            except Exception as ce:
                print(f"[API] Warning: Failed to delete temp file {temp_path}: {ce}", flush=True)
