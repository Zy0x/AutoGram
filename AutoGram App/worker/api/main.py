import os
import sys
import asyncio
import urllib.parse
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
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

# Global instances
client_instance = None
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

@app.on_event("startup")
async def startup_event():
    global client_instance, loop_instance
    loop_instance = asyncio.get_running_loop()
    
    session = os.environ.get("AUTOGRAM_API_SESSION")
    api_id = os.environ.get("AUTOGRAM_API_ID")
    api_hash = os.environ.get("AUTOGRAM_API_HASH")
    
    if not session:
        print("[API] WARNING: AUTOGRAM_API_SESSION environment variable not set. Telethon will not start.", flush=True)
        return
        
    print(f"[API] Starting Telethon client for session: {session}...", flush=True)
    try:
        client_instance = await create_client(
            session_name=session,
            api_id_arg=int(api_id) if api_id else None,
            api_hash_arg=api_hash
        )
        print("[API] Telethon client connected and ready.", flush=True)
    except Exception as e:
        print(f"[API] Failed to start Telethon client: {e}", file=sys.stderr, flush=True)

@app.on_event("shutdown")
async def shutdown_event():
    global client_instance
    if client_instance:
        print("[API] Disconnecting Telethon client...", flush=True)
        try:
            await client_instance.disconnect()
        except Exception:
            pass

@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "3.0.0",
        "session": os.environ.get("AUTOGRAM_API_SESSION"),
        "client_connected": client_instance.is_connected() if client_instance else False
    }

@app.get("/api/v1/folders/{folder_id}/download-all")
async def download_all(folder_id: str):
    global client_instance, loop_instance
    if not client_instance or not client_instance.is_connected():
        raise HTTPException(status_code=503, detail="Telegram client not connected")
        
    actual_id = None
    if folder_id not in (None, '', 'home', 'me', 'null', 'None'):
        try:
            actual_id = int(folder_id)
        except ValueError:
            pass
            
    try:
        peer = await _resolve_peer(client_instance, actual_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve folder peer: {e}")
        
    documents = []
    async for message in client_instance.iter_messages(peer, filter=InputMessagesFilterDocument):
        if message.document:
            documents.append((message.document, get_message_filename(message)))
            
    if not documents:
        raise HTTPException(status_code=404, detail="No files found in folder to download")
        
    z = zipstream.ZipStream()
    for doc, filename in documents:
        z.add(sync_chunk_generator(loop_instance, client_instance, doc), filename)
        
    headers = {
        "Content-Disposition": f"attachment; filename=folder_{folder_id or 'root'}.zip"
    }
    return StreamingResponse(z, media_type="application/zip", headers=headers)

@app.post("/api/v1/remote-upload")
async def remote_upload(payload: RemoteUploadRequest):
    global client_instance, loop_instance
    if not client_instance or not client_instance.is_connected():
        raise HTTPException(status_code=503, detail="Telegram client not connected")
        
    url = payload.url
    actual_folder_id = None
    if payload.folder_id not in (None, '', 'home', 'me', 'null', 'None'):
        try:
            actual_folder_id = int(payload.folder_id)
        except ValueError:
            pass
            
    try:
        peer = await _resolve_peer(client_instance, actual_folder_id)
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
                
                uploaded_file = await client_instance.upload_file(
                    stream_reader,
                    file_name=filename,
                    file_size=total_size
                )
                
                # Send the uploaded document to target channel/Saved Messages
                await client_instance.send_file(peer, uploaded_file, caption=f"Remote upload from: {url}")
                
        return {"status": "success", "filename": filename, "size": total_size}
    except Exception as e:
        print(f"[API] Remote upload failed: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail=f"Remote upload failed: {str(e)}")
