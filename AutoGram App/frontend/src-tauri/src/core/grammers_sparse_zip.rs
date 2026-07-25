//! Sparse Range MTProto ZIP Engine (Rust + Grammers).
//! Reads ZIP Central Directory & EOCD directly via Telegram MTProto API range requests.
//! Zero full-file download, zero memory allocation bloat, instant listing load (<0.5s).

use std::collections::HashMap;
use std::io::{Error as IoError, ErrorKind as IoErrorKind, Read, Result as IoResult, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Mutex;

use grammers_client::media::Media;
use grammers_client::tl;
use serde::{Deserialize, Serialize};

use super::grammers_ops::{obtain_live_client, persist_memory_session, resolve_peer, runtime};
use super::session_rate;
use super::telegram_ops::TelegramIdentity;
use super::tg_error::{map_invocation, TgError, TgErrorCode};
use super::zip_local::{sanitize_zip_path, ZipEntry, ZipEntryPreview, ZipListResult};

const BLOCK_SIZE: u64 = 512 * 1024; // 512 KiB block fetch
const BACKEND: &str = "grammers_sparse";

#[derive(Debug, Clone)]
pub struct CachedCatalog {
    pub result: ZipListResult,
    pub created_at: std::time::Instant,
}

static CATALOG_CACHE: Mutex<Option<HashMap<String, CachedCatalog>>> = Mutex::new(None);

pub fn get_cached_catalog(key: &str) -> Option<ZipListResult> {
    let guard = CATALOG_CACHE.lock().ok()?;
    if let Some(map) = guard.as_ref() {
        if let Some(entry) = map.get(key) {
            if entry.created_at.elapsed() < std::time::Duration::from_secs(600) {
                return Some(entry.result.clone());
            }
        }
    }
    None
}

pub fn set_cached_catalog(key: String, result: ZipListResult) {
    if let Ok(mut guard) = CATALOG_CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        if map.len() > 50 {
            map.clear();
        }
        map.insert(
            key,
            CachedCatalog {
                result,
                created_at: std::time::Instant::now(),
            },
        );
    }
}

pub fn invalidate_cached_catalog(key: &str) {
    if let Ok(mut guard) = CATALOG_CACHE.lock() {
        if let Some(map) = guard.as_mut() {
            map.remove(key);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparseZipOpts {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub message_id: i32,
    #[serde(default)]
    pub force_refresh: Option<bool>,
}

pub struct TelegramSparseReader<'a> {
    client: &'a grammers_client::Client,
    media: Media,
    doc_size: u64,
    pos: u64,
    cache: HashMap<u64, Vec<u8>>,
    rt: &'static tokio::runtime::Runtime,
}

impl<'a> TelegramSparseReader<'a> {
    pub fn new(
        client: &'a grammers_client::Client,
        media: Media,
        doc_size: u64,
        rt: &'static tokio::runtime::Runtime,
    ) -> Self {
        Self {
            client,
            media,
            doc_size,
            pos: 0,
            cache: HashMap::new(),
            rt,
        }
    }

    pub fn prefetch_tail(&mut self) -> IoResult<()> {
        if self.doc_size == 0 {
            return Ok(());
        }
        let last_idx = (self.doc_size - 1) / BLOCK_SIZE;
        let start_idx = last_idx.saturating_sub(16);
        for idx in start_idx..=last_idx {
            let _ = self.fetch_block(idx)?;
        }
        Ok(())
    }

    fn fetch_block(&mut self, block_idx: u64) -> IoResult<&Vec<u8>> {
        if self.cache.contains_key(&block_idx) {
            return Ok(self.cache.get(&block_idx).unwrap());
        }

        let block_offset = block_idx * BLOCK_SIZE;
        if block_offset >= self.doc_size {
            self.cache.insert(block_idx, Vec::new());
            return Ok(self.cache.get(&block_idx).unwrap());
        }

        let limit = BLOCK_SIZE as i32;
        let client = self.client;
        let media = self.media.clone();

        let fetch_fut = async move {
            let skip = block_idx.min(i32::MAX as u64) as i32;
            let mut iter = client
                .iter_download(&media)
                .chunk_size(limit)
                .skip_chunks(skip);
            let mut retries = 0;
            loop {
                match iter.next().await {
                    Ok(Some(bytes)) => break Ok(bytes),
                    Ok(None) => break Ok(Vec::new()),
                    Err(e) => {
                        let mapped = map_invocation(&e);
                        if mapped.code() == TgErrorCode::FloodWait {
                            if let Some(secs) = mapped.flood_wait_secs() {
                                tokio::time::sleep(std::time::Duration::from_secs(u64::from(secs))).await;
                            }
                        } else {
                            tokio::time::sleep(std::time::Duration::from_millis(300 * (1 << retries))).await;
                        }
                        retries += 1;
                        if retries > 3 {
                            break Err(IoError::new(
                                IoErrorKind::Other,
                                format!("GetFile MTProto failed: {e}"),
                            ));
                        }
                        let skip = block_idx.min(i32::MAX as u64) as i32;
                        iter = client
                            .iter_download(&media)
                            .chunk_size(limit)
                            .skip_chunks(skip);
                    }
                }
            }
        };

        let bytes = self.rt.block_on(fetch_fut)?;
        self.cache.insert(block_idx, bytes);
        Ok(self.cache.get(&block_idx).unwrap())
    }
}

impl<'a> Read for TelegramSparseReader<'a> {
    fn read(&mut self, buf: &mut [u8]) -> IoResult<usize> {
        if self.pos >= self.doc_size || buf.is_empty() {
            return Ok(0);
        }

        let mut read_bytes = 0;
        let total_to_read = buf.len().min((self.doc_size - self.pos) as usize);

        while read_bytes < total_to_read {
            let current_pos = self.pos + read_bytes as u64;
            let block_idx = current_pos / BLOCK_SIZE;
            let block_offset = (current_pos % BLOCK_SIZE) as usize;

            let block = self.fetch_block(block_idx)?;
            if block_offset >= block.len() {
                break;
            }

            let available_in_block = block.len() - block_offset;
            let chunk_len = (total_to_read - read_bytes).min(available_in_block);

            buf[read_bytes..read_bytes + chunk_len]
                .copy_from_slice(&block[block_offset..block_offset + chunk_len]);

            read_bytes += chunk_len;
        }

        self.pos += read_bytes as u64;
        Ok(read_bytes)
    }
}

impl<'a> Seek for TelegramSparseReader<'a> {
    fn seek(&mut self, pos: SeekFrom) -> IoResult<u64> {
        let new_pos = match pos {
            SeekFrom::Start(off) => off as i64,
            SeekFrom::End(off) => self.doc_size as i64 + off,
            SeekFrom::Current(off) => self.pos as i64 + off,
        };

        if new_pos < 0 {
            return Err(IoError::new(IoErrorKind::InvalidInput, "negative seek position"));
        }

        self.pos = (new_pos as u64).min(self.doc_size);
        Ok(self.pos)
    }
}

fn parse_central_directory_fast(
    reader: &mut TelegramSparseReader,
    doc_size: u64,
) -> IoResult<ZipListResult> {
    if doc_size < 22 {
        return Err(IoError::new(IoErrorKind::InvalidData, "file too small"));
    }

    // Search for EOCD marker (PK\x05\x06) in the last 16 MB
    let search_len = doc_size.min(16 * 1024 * 1024) as usize;
    let start_pos = doc_size - search_len as u64;
    reader.seek(SeekFrom::Start(start_pos))?;
    let mut tail_buf = vec![0u8; search_len];
    reader.read_exact(&mut tail_buf)?;

    let mut eocd_pos = None;
    for i in (0..search_len.saturating_sub(21)).rev() {
        if tail_buf[i] == 0x50 && tail_buf[i + 1] == 0x4b && tail_buf[i + 2] == 0x05 && tail_buf[i + 3] == 0x06 {
            eocd_pos = Some(i);
            break;
        }
    }

    let eocd_idx = eocd_pos.ok_or_else(|| IoError::new(IoErrorKind::InvalidData, "Could not find EOCD"))?;
    let eocd_slice = &tail_buf[eocd_idx..];

    let mut total_entries = u16::from_le_bytes([eocd_slice[10], eocd_slice[11]]) as usize;
    let mut cd_size = u32::from_le_bytes([eocd_slice[12], eocd_slice[13], eocd_slice[14], eocd_slice[15]]) as u64;
    let mut cd_offset = u32::from_le_bytes([eocd_slice[16], eocd_slice[17], eocd_slice[18], eocd_slice[19]]) as u64;

    // Check for ZIP64 EOCD Locator (PK\x06\x07)
    if (total_entries == 0xFFFF || cd_offset == 0xFFFFFFFF || cd_size == 0xFFFFFFFF) && eocd_idx >= 20 {
        let loc_idx = eocd_idx - 20;
        if tail_buf[loc_idx] == 0x50 && tail_buf[loc_idx + 1] == 0x4b && tail_buf[loc_idx + 2] == 0x06 && tail_buf[loc_idx + 3] == 0x07 {
            let zip64_eocd_off = u64::from_le_bytes([
                tail_buf[loc_idx + 8], tail_buf[loc_idx + 9], tail_buf[loc_idx + 10], tail_buf[loc_idx + 11],
                tail_buf[loc_idx + 12], tail_buf[loc_idx + 13], tail_buf[loc_idx + 14], tail_buf[loc_idx + 15],
            ]);
            reader.seek(SeekFrom::Start(zip64_eocd_off))?;
            let mut zip64_buf = [0u8; 56];
            reader.read_exact(&mut zip64_buf)?;
            if &zip64_buf[0..4] == &[0x50, 0x4b, 0x06, 0x06] {
                total_entries = u64::from_le_bytes([
                    zip64_buf[32], zip64_buf[33], zip64_buf[34], zip64_buf[35],
                    zip64_buf[36], zip64_buf[37], zip64_buf[38], zip64_buf[39],
                ]) as usize;
                cd_size = u64::from_le_bytes([
                    zip64_buf[40], zip64_buf[41], zip64_buf[42], zip64_buf[43],
                    zip64_buf[44], zip64_buf[45], zip64_buf[46], zip64_buf[47],
                ]);
                cd_offset = u64::from_le_bytes([
                    zip64_buf[48], zip64_buf[49], zip64_buf[50], zip64_buf[51],
                    zip64_buf[52], zip64_buf[53], zip64_buf[54], zip64_buf[55],
                ]);
            }
        }
    }

    if cd_offset + cd_size > doc_size {
        return Err(IoError::new(IoErrorKind::InvalidData, "invalid central directory offset"));
    }

    // Read Central Directory in memory (located at tail end)
    reader.seek(SeekFrom::Start(cd_offset))?;
    let mut cd_buf = vec![0u8; cd_size as usize];
    reader.read_exact(&mut cd_buf)?;

    let mut cursor = 0;
    let limit = total_entries.min(8000);
    let mut entries = Vec::with_capacity(limit);
    let mut total_uncompressed = 0u64;

    while cursor + 46 <= cd_buf.len() && entries.len() < limit {
        if &cd_buf[cursor..cursor + 4] != &[0x50, 0x4b, 0x01, 0x02] {
            break;
        }

        let method = u16::from_le_bytes([cd_buf[cursor + 10], cd_buf[cursor + 11]]);
        let mut comp_sz = u32::from_le_bytes([cd_buf[cursor + 20], cd_buf[cursor + 21], cd_buf[cursor + 22], cd_buf[cursor + 23]]) as u64;
        let mut uncomp_sz = u32::from_le_bytes([cd_buf[cursor + 24], cd_buf[cursor + 25], cd_buf[cursor + 26], cd_buf[cursor + 27]]) as u64;
        let name_len = u16::from_le_bytes([cd_buf[cursor + 28], cd_buf[cursor + 29]]) as usize;
        let extra_len = u16::from_le_bytes([cd_buf[cursor + 30], cd_buf[cursor + 31]]) as usize;
        let comment_len = u16::from_le_bytes([cd_buf[cursor + 32], cd_buf[cursor + 33]]) as usize;
        let ext_attr = u32::from_le_bytes([cd_buf[cursor + 38], cd_buf[cursor + 39], cd_buf[cursor + 40], cd_buf[cursor + 41]]);
        let mut local_off = u32::from_le_bytes([cd_buf[cursor + 42], cd_buf[cursor + 43], cd_buf[cursor + 44], cd_buf[cursor + 45]]) as u64;

        let header_end = cursor + 46;
        if header_end + name_len + extra_len + comment_len > cd_buf.len() {
            break;
        }

        let raw_name_bytes = &cd_buf[header_end..header_end + name_len];
        let raw_name = String::from_utf8_lossy(raw_name_bytes).replace('\\', "/");
        let name = sanitize_zip_path(&raw_name);

        // ZIP64 Extra Field parsing (0x0001)
        if extra_len >= 4 {
            let extra_bytes = &cd_buf[header_end + name_len..header_end + name_len + extra_len];
            let mut ex_idx = 0;
            while ex_idx + 4 <= extra_bytes.len() {
                let tag = u16::from_le_bytes([extra_bytes[ex_idx], extra_bytes[ex_idx + 1]]);
                let sz = u16::from_le_bytes([extra_bytes[ex_idx + 2], extra_bytes[ex_idx + 3]]) as usize;
                if tag == 0x0001 && ex_idx + 4 + sz <= extra_bytes.len() {
                    let mut data_pos = ex_idx + 4;
                    if uncomp_sz == 0xFFFFFFFF && data_pos + 8 <= extra_bytes.len() {
                        uncomp_sz = u64::from_le_bytes(extra_bytes[data_pos..data_pos + 8].try_into().unwrap());
                        data_pos += 8;
                    }
                    if comp_sz == 0xFFFFFFFF && data_pos + 8 <= extra_bytes.len() {
                        comp_sz = u64::from_le_bytes(extra_bytes[data_pos..data_pos + 8].try_into().unwrap());
                        data_pos += 8;
                    }
                    if local_off == 0xFFFFFFFF && data_pos + 8 <= extra_bytes.len() {
                        local_off = u64::from_le_bytes(extra_bytes[data_pos..data_pos + 8].try_into().unwrap());
                    }
                    break;
                }
                ex_idx += 4 + sz;
            }
        }

        let is_dir = (ext_attr & 0x10) != 0 || name.ends_with('/') || raw_name.ends_with('/') || ((ext_attr >> 16) & 0o040000 != 0);

        if !is_dir {
            total_uncompressed = total_uncompressed.saturating_add(uncomp_sz);
        }

        entries.push(ZipEntry {
            name: if name.is_empty() { raw_name } else { name },
            size: uncomp_sz,
            compressed_size: comp_sz,
            is_dir,
            method,
            local_header_offset: local_off,
        });

        cursor = header_end + name_len + extra_len + comment_len;
    }

    Ok(ZipListResult {
        entries,
        count: limit,
        truncated: total_entries > 8000,
        total_entries,
        total_uncompressed,
        archive_size: doc_size,
        source: "mtproto_sparse_fast".into(),
        backend: BACKEND.into(),
    })
}

/// Instant Sparse ZIP Listing via Grammers MTProto Range Fetching
pub async fn list_zip_sparse(opts: SparseZipOpts) -> Result<ZipListResult, TgError> {
    let cache_key = format!("{}:{}:{}", opts.chat_id, opts.message_id, opts.session);
    if opts.force_refresh.unwrap_or(false) {
        invalidate_cached_catalog(&cache_key);
    } else if let Some(cached) = get_cached_catalog(&cache_key) {
        return Ok(cached);
    }

    let rt = runtime()?;
    let identity = TelegramIdentity {
        session: opts.session.clone(),
        api_id: opts.api_id,
        api_hash: opts.api_hash.clone(),
    };
    session_rate::wait_if_flooded_capped(&opts.session, std::time::Duration::from_secs(35)).await?;
    let _media_slot = session_rate::acquire_media_slot(&opts.session).await?;
    let sessions_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("sessions");
    let live = obtain_live_client(&sessions_dir, &identity, true, false).await?;
    let peer = resolve_peer(&live.client, &opts.chat_id).await?;

    let msg = live
        .client
        .get_messages_by_id(peer, &[opts.message_id])
        .await
        .map_err(|e| map_invocation(&e))?
        .pop()
        .flatten()
        .ok_or_else(|| TgError::new(TgErrorCode::PeerNotFound, "Pesan tidak ditemukan"))?;

    let media = msg
        .media()
        .ok_or_else(|| TgError::new(TgErrorCode::PeerNotFound, "Media tidak ada pada pesan"))?;

    let doc_size = match &media {
        Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };

    if doc_size == 0 {
        return Err(TgError::new(TgErrorCode::Io, "Ukuran dokumen ZIP 0 byte"));
    }

    let client = live.client.clone();
    let session = live.session.clone();
    let session_path = live.session_path.clone();
    let media_cloned = media.clone();

    let res = tokio::task::spawn_blocking(move || {
        let mut sparse_reader = TelegramSparseReader::new(&client, media_cloned, doc_size, rt);
        let _ = sparse_reader.prefetch_tail();

        // FAST PATH: Zero-seek Central Directory parser directly from tail memory buffer
        if let Ok(res) = parse_central_directory_fast(&mut sparse_reader, doc_size) {
            let _ = persist_memory_session(&session, &session_path);
            return Ok(res);
        }

        // FALLBACK PATH: zip crate archive parser
        let archive = zip::ZipArchive::new(&mut sparse_reader).map_err(|e| {
            let msg = e.to_string();
            if msg.contains("Password") || msg.contains("Encrypted") {
                TgError::new(TgErrorCode::Io, "Arsip ZIP dilindungi password")
            } else {
                TgError::new(TgErrorCode::Io, msg)
            }
        })?;

        let total_entries = archive.len();
        let mut entries = Vec::new();
        let total_uncompressed = 0u64;
        let limit = total_entries.min(8000);

        for i in 0..limit {
            if let Some(raw_name_ref) = archive.name_for_index(i) {
                let raw_name = raw_name_ref.replace('\\', "/");
                let name = sanitize_zip_path(&raw_name);
                let is_dir = name.ends_with('/') || raw_name.ends_with('/');
                entries.push(ZipEntry {
                    name: if name.is_empty() { raw_name } else { name },
                    size: 0,
                    compressed_size: 0,
                    is_dir,
                    method: 0,
                    local_header_offset: 0,
                });
            }
        }

        let _ = persist_memory_session(&session, &session_path);

        Ok(ZipListResult {
            entries,
            count: limit,
            truncated: total_entries > 8000,
            total_entries,
            total_uncompressed,
            archive_size: doc_size,
            source: "mtproto_sparse".into(),
            backend: BACKEND.into(),
        })
    })
    .await
    .map_err(|e| TgError::new(TgErrorCode::Internal, format!("Alur tugas ZIP terputus: {e}")))?;

    if let Ok(ref valid_res) = res {
        set_cached_catalog(cache_key, valid_res.clone());
    }

    res
}

fn preview_zip_entry_direct(
    reader: &mut TelegramSparseReader,
    entry: &ZipEntry,
    password: Option<&str>,
) -> IoResult<ZipEntryPreview> {
    if entry.is_dir {
        return Ok(ZipEntryPreview {
            name: entry.name.clone(),
            size: 0,
            text_content: None,
            data_url: None,
            mime_type: None,
            is_binary: false,
            encrypted: false,
            backend: "grammers_sparse_direct".into(),
        });
    }

    if entry.size as usize > 12 * 1024 * 1024 {
        return Ok(ZipEntryPreview {
            name: entry.name.clone(),
            size: entry.size,
            text_content: Some(format!(
                "[Berkas terlalu besar untuk pratinjau langsung — {} byte]",
                entry.size
            )),
            data_url: None,
            mime_type: None,
            is_binary: true,
            encrypted: false,
            backend: "grammers_sparse_direct".into(),
        });
    }

    reader.seek(SeekFrom::Start(entry.local_header_offset))?;
    let mut header_buf = [0u8; 30];
    reader.read_exact(&mut header_buf)?;

    if &header_buf[0..4] != &[0x50, 0x4b, 0x03, 0x04] {
        return Err(IoError::new(IoErrorKind::InvalidData, "Invalid Local Header signature"));
    }

    let flags = u16::from_le_bytes([header_buf[6], header_buf[7]]);
    let is_encrypted = (flags & 1) != 0;
    if is_encrypted && password.is_none() {
        return Ok(ZipEntryPreview {
            name: entry.name.clone(),
            size: entry.size,
            text_content: None,
            data_url: None,
            mime_type: None,
            is_binary: true,
            encrypted: true,
            backend: "grammers_sparse_direct".into(),
        });
    }

    let method = u16::from_le_bytes([header_buf[8], header_buf[9]]);
    let name_len = u16::from_le_bytes([header_buf[26], header_buf[27]]) as u64;
    let extra_len = u16::from_le_bytes([header_buf[28], header_buf[29]]) as u64;

    let payload_offset = entry.local_header_offset + 30 + name_len + extra_len;
    reader.seek(SeekFrom::Start(payload_offset))?;

    let comp_size = entry.compressed_size as usize;
    let mut comp_buf = vec![0u8; comp_size];
    reader.read_exact(&mut comp_buf)?;

    let decomp_buf = if is_encrypted {
        return Err(IoError::new(IoErrorKind::Other, "Encrypted entry fallback"));
    } else {
        match method {
            0 => comp_buf,
            8 => {
                use flate2::read::DeflateDecoder;
                let mut decoder = DeflateDecoder::new(&comp_buf[..]);
                let mut out = Vec::new();
                decoder.read_to_end(&mut out)?;
                out
            }
            _ => {
                return Err(IoError::new(
                    IoErrorKind::Other,
                    format!("Method {method} fallback to ZipArchive"),
                ));
            }
        }
    };

    let mut prev = super::zip_local::build_zip_entry_preview(&entry.name, entry.size, decomp_buf);
    prev.backend = "grammers_sparse_direct".into();
    Ok(prev)
}

/// Read single entry by fetching exact byte range lazily from Telegram MTProto (zero full download)
pub async fn preview_zip_entry_sparse(
    opts: SparseZipOpts,
    entry_name: String,
    password: Option<String>,
) -> Result<ZipEntryPreview, TgError> {
    let cache_key = format!("{}:{}:{}", opts.chat_id, opts.message_id, opts.session);
    let catalog = match get_cached_catalog(&cache_key) {
        Some(cat) => cat,
        None => list_zip_sparse(opts.clone()).await?,
    };

    let target_entry = catalog.entries.iter().find(|e| {
        e.name == entry_name || sanitize_zip_path(&e.name) == sanitize_zip_path(&entry_name)
    }).cloned();

    let rt = runtime()?;
    let identity = TelegramIdentity {
        session: opts.session.clone(),
        api_id: opts.api_id,
        api_hash: opts.api_hash.clone(),
    };
    session_rate::wait_if_flooded_capped(&opts.session, std::time::Duration::from_secs(35)).await?;
    let _media_slot = session_rate::acquire_media_slot(&opts.session).await?;
    let sessions_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("sessions");
    let live = obtain_live_client(&sessions_dir, &identity, true, false).await?;
    let peer = resolve_peer(&live.client, &opts.chat_id).await?;

    let msg = live
        .client
        .get_messages_by_id(peer, &[opts.message_id])
        .await
        .map_err(|e| map_invocation(&e))?
        .pop()
        .flatten()
        .ok_or_else(|| TgError::new(TgErrorCode::PeerNotFound, "Pesan tidak ditemukan"))?;

    let media = msg
        .media()
        .ok_or_else(|| TgError::new(TgErrorCode::PeerNotFound, "Media tidak ada pada pesan"))?;

    let doc_size = match &media {
        Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };

    if doc_size == 0 {
        return Err(TgError::new(TgErrorCode::Io, "Ukuran dokumen ZIP 0 byte"));
    }

    let client = live.client.clone();
    let session = live.session.clone();
    let session_path = live.session_path.clone();
    let media_cloned = media.clone();

    tokio::task::spawn_blocking(move || {
        let mut sparse_reader = TelegramSparseReader::new(&client, media_cloned, doc_size, rt);

        // FAST DIRECT PATH: Read single entry directly from local_header_offset without tail prefetch & without archive re-scan
        if let Some(ref entry) = target_entry {
            if let Ok(prev) = preview_zip_entry_direct(&mut sparse_reader, entry, password.as_deref()) {
                let _ = persist_memory_session(&session, &session_path);
                return Ok(prev);
            }
        }

        // FALLBACK PATH: Standard zip archive parser with tail prefetch
        let _ = sparse_reader.prefetch_tail();
        let archive = zip::ZipArchive::new(&mut sparse_reader).map_err(|e| {
            let msg = e.to_string();
            if msg.contains("Could not find EOCD") {
                TgError::new(TgErrorCode::Io, "Indeks ZIP tidak valid atau penanda EOCD tidak ditemukan.")
            } else {
                TgError::new(TgErrorCode::Io, msg)
            }
        })?;

        let mut prev = super::zip_local::preview_zip_entry_from_archive(
            archive,
            &entry_name,
            password.as_deref(),
        )
        .map_err(|e| TgError::new(TgErrorCode::Io, e))?;

        prev.backend = BACKEND.into();
        let _ = persist_memory_session(&session, &session_path);
        Ok(prev)
    })
    .await
    .map_err(|e| TgError::new(TgErrorCode::Internal, format!("Alur tugas ZIP terputus: {e}")))?
}

fn extract_zip_entry_direct(
    reader: &mut TelegramSparseReader,
    entry: &ZipEntry,
    dest_path: &str,
    _password: Option<&str>,
) -> IoResult<u64> {
    if entry.is_dir {
        let target_p = super::path_policy::assert_safe_transfer_path(dest_path)
            .map_err(|e| IoError::new(IoErrorKind::InvalidInput, e))?;
        std::fs::create_dir_all(&target_p)?;
        return Ok(0);
    }

    reader.seek(SeekFrom::Start(entry.local_header_offset))?;
    let mut header_buf = [0u8; 30];
    reader.read_exact(&mut header_buf)?;

    if &header_buf[0..4] != &[0x50, 0x4b, 0x03, 0x04] {
        return Err(IoError::new(IoErrorKind::InvalidData, "Invalid Local Header signature"));
    }

    let flags = u16::from_le_bytes([header_buf[6], header_buf[7]]);
    let is_encrypted = (flags & 1) != 0;
    if is_encrypted {
        return Err(IoError::new(IoErrorKind::Other, "Encrypted entry fallback"));
    }

    let method = u16::from_le_bytes([header_buf[8], header_buf[9]]);
    let name_len = u16::from_le_bytes([header_buf[26], header_buf[27]]) as u64;
    let extra_len = u16::from_le_bytes([header_buf[28], header_buf[29]]) as u64;

    let payload_offset = entry.local_header_offset + 30 + name_len + extra_len;
    reader.seek(SeekFrom::Start(payload_offset))?;

    let comp_size = entry.compressed_size as usize;
    let mut comp_buf = vec![0u8; comp_size];
    reader.read_exact(&mut comp_buf)?;

    let decomp_buf = match method {
        0 => comp_buf,
        8 => {
            use flate2::read::DeflateDecoder;
            let mut decoder = DeflateDecoder::new(&comp_buf[..]);
            let mut out = Vec::new();
            decoder.read_to_end(&mut out)?;
            out
        }
        _ => {
            return Err(IoError::new(
                IoErrorKind::Other,
                format!("Method {method} fallback to ZipArchive"),
            ));
        }
    };

    let target_p = super::path_policy::assert_safe_transfer_path(dest_path)
        .map_err(|e| IoError::new(IoErrorKind::InvalidInput, e))?;
    if let Some(parent) = target_p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target_p, &decomp_buf)?;
    Ok(decomp_buf.len() as u64)
}

/// Extract single entry by fetching byte range lazily from Telegram MTProto directly to disk (zero full download)
pub async fn extract_zip_entry_sparse(
    opts: SparseZipOpts,
    entry_name: String,
    dest_path: String,
    password: Option<String>,
) -> Result<u64, TgError> {
    let cache_key = format!("{}:{}:{}", opts.chat_id, opts.message_id, opts.session);
    let catalog = match get_cached_catalog(&cache_key) {
        Some(cat) => cat,
        None => list_zip_sparse(opts.clone()).await?,
    };

    let target_entry = catalog.entries.iter().find(|e| {
        e.name == entry_name || sanitize_zip_path(&e.name) == sanitize_zip_path(&entry_name)
    }).cloned();

    let rt = runtime()?;
    let identity = TelegramIdentity {
        session: opts.session.clone(),
        api_id: opts.api_id,
        api_hash: opts.api_hash.clone(),
    };
    session_rate::wait_if_flooded_capped(&opts.session, std::time::Duration::from_secs(35)).await?;
    let _media_slot = session_rate::acquire_media_slot(&opts.session).await?;
    let sessions_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("sessions");
    let live = obtain_live_client(&sessions_dir, &identity, true, false).await?;
    let peer = resolve_peer(&live.client, &opts.chat_id).await?;

    let msg = live
        .client
        .get_messages_by_id(peer, &[opts.message_id])
        .await
        .map_err(|e| map_invocation(&e))?
        .pop()
        .flatten()
        .ok_or_else(|| TgError::new(TgErrorCode::PeerNotFound, "Pesan tidak ditemukan"))?;

    let media = msg
        .media()
        .ok_or_else(|| TgError::new(TgErrorCode::PeerNotFound, "Media tidak ada pada pesan"))?;

    let doc_size = match &media {
        Media::Document(d) => d.size().unwrap_or(0) as u64,
        _ => 0,
    };

    if doc_size == 0 {
        return Err(TgError::new(TgErrorCode::Io, "Ukuran dokumen ZIP 0 byte"));
    }

    let client = live.client.clone();
    let session = live.session.clone();
    let session_path = live.session_path.clone();
    let media_cloned = media.clone();

    tokio::task::spawn_blocking(move || {
        let mut sparse_reader = TelegramSparseReader::new(&client, media_cloned, doc_size, rt);

        // FAST DIRECT PATH: Extract single entry directly from local_header_offset without tail prefetch
        if let Some(ref entry) = target_entry {
            if let Ok(bytes_written) = extract_zip_entry_direct(&mut sparse_reader, entry, &dest_path, password.as_deref()) {
                let _ = persist_memory_session(&session, &session_path);
                return Ok(bytes_written);
            }
        }

        // FALLBACK PATH: Standard zip archive parser
        let _ = sparse_reader.prefetch_tail();
        let archive = zip::ZipArchive::new(&mut sparse_reader).map_err(|e| {
            let msg = e.to_string();
            if msg.contains("Could not find EOCD") {
                TgError::new(TgErrorCode::Io, "Indeks ZIP tidak valid atau penanda EOCD tidak ditemukan.")
            } else {
                TgError::new(TgErrorCode::Io, msg)
            }
        })?;

        let bytes_written = super::zip_local::extract_zip_entry_from_archive(
            archive,
            &entry_name,
            &dest_path,
            password.as_deref(),
        )
        .map_err(|e| TgError::new(TgErrorCode::Io, e))?;

        let _ = persist_memory_session(&session, &session_path);
        Ok(bytes_written)
    })
    .await
    .map_err(|e| TgError::new(TgErrorCode::Internal, format!("Alur tugas ZIP terputus: {e}")))?
}
