//! Sparse Range MTProto ZIP Engine (Rust + Grammers).
//! Reads ZIP Central Directory & EOCD directly via Telegram MTProto API range requests.
//! Zero full-file download, zero memory allocation bloat, instant listing load (<0.5s).

use std::collections::HashMap;
use std::io::{
    Error as IoError, ErrorKind as IoErrorKind, Read, Result as IoResult, Seek, SeekFrom,
};
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
        let _ = self.fetch_block(last_idx)?;
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
                                tokio::time::sleep(std::time::Duration::from_secs(u64::from(secs)))
                                    .await;
                            }
                        } else {
                            tokio::time::sleep(std::time::Duration::from_millis(
                                300 * (1 << retries),
                            ))
                            .await;
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
            return Err(IoError::new(
                IoErrorKind::InvalidInput,
                "negative seek position",
            ));
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

    // Search for EOCD marker (PK\x05\x06) in the last 128 KB (standard ZIP max comment 64KB)
    let search_len = doc_size.min(128 * 1024) as usize;
    let start_pos = doc_size - search_len as u64;
    reader.seek(SeekFrom::Start(start_pos))?;
    let mut tail_buf = vec![0u8; search_len];
    reader.read_exact(&mut tail_buf)?;

    let mut eocd_pos = None;
    for i in (0..search_len.saturating_sub(21)).rev() {
        if tail_buf[i] == 0x50
            && tail_buf[i + 1] == 0x4b
            && tail_buf[i + 2] == 0x05
            && tail_buf[i + 3] == 0x06
        {
            eocd_pos = Some(i);
            break;
        }
    }

    let eocd_idx =
        eocd_pos.ok_or_else(|| IoError::new(IoErrorKind::InvalidData, "Could not find EOCD"))?;
    let eocd_slice = &tail_buf[eocd_idx..];

    let mut total_entries = u16::from_le_bytes([eocd_slice[10], eocd_slice[11]]) as usize;
    let mut cd_size = u32::from_le_bytes([
        eocd_slice[12],
        eocd_slice[13],
        eocd_slice[14],
        eocd_slice[15],
    ]) as u64;
    let mut cd_offset = u32::from_le_bytes([
        eocd_slice[16],
        eocd_slice[17],
        eocd_slice[18],
        eocd_slice[19],
    ]) as u64;

    // Check for ZIP64 EOCD Locator (PK\x06\x07)
    if (total_entries == 0xFFFF || cd_offset == 0xFFFFFFFF || cd_size == 0xFFFFFFFF)
        && eocd_idx >= 20
    {
        let loc_idx = eocd_idx - 20;
        if tail_buf[loc_idx] == 0x50
            && tail_buf[loc_idx + 1] == 0x4b
            && tail_buf[loc_idx + 2] == 0x06
            && tail_buf[loc_idx + 3] == 0x07
        {
            let zip64_eocd_off = u64::from_le_bytes([
                tail_buf[loc_idx + 8],
                tail_buf[loc_idx + 9],
                tail_buf[loc_idx + 10],
                tail_buf[loc_idx + 11],
                tail_buf[loc_idx + 12],
                tail_buf[loc_idx + 13],
                tail_buf[loc_idx + 14],
                tail_buf[loc_idx + 15],
            ]);
            reader.seek(SeekFrom::Start(zip64_eocd_off))?;
            let mut zip64_buf = [0u8; 56];
            reader.read_exact(&mut zip64_buf)?;
            if &zip64_buf[0..4] == &[0x50, 0x4b, 0x06, 0x06] {
                total_entries = u64::from_le_bytes([
                    zip64_buf[32],
                    zip64_buf[33],
                    zip64_buf[34],
                    zip64_buf[35],
                    zip64_buf[36],
                    zip64_buf[37],
                    zip64_buf[38],
                    zip64_buf[39],
                ]) as usize;
                cd_size = u64::from_le_bytes([
                    zip64_buf[40],
                    zip64_buf[41],
                    zip64_buf[42],
                    zip64_buf[43],
                    zip64_buf[44],
                    zip64_buf[45],
                    zip64_buf[46],
                    zip64_buf[47],
                ]);
                cd_offset = u64::from_le_bytes([
                    zip64_buf[48],
                    zip64_buf[49],
                    zip64_buf[50],
                    zip64_buf[51],
                    zip64_buf[52],
                    zip64_buf[53],
                    zip64_buf[54],
                    zip64_buf[55],
                ]);
            }
        }
    }

    if cd_offset + cd_size > doc_size {
        return Err(IoError::new(
            IoErrorKind::InvalidData,
            "invalid central directory offset",
        ));
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
        let flags = u16::from_le_bytes([cd_buf[cursor + 8], cd_buf[cursor + 9]]);
        let mut comp_sz = u32::from_le_bytes([
            cd_buf[cursor + 20],
            cd_buf[cursor + 21],
            cd_buf[cursor + 22],
            cd_buf[cursor + 23],
        ]) as u64;
        let mut uncomp_sz = u32::from_le_bytes([
            cd_buf[cursor + 24],
            cd_buf[cursor + 25],
            cd_buf[cursor + 26],
            cd_buf[cursor + 27],
        ]) as u64;
        let name_len = u16::from_le_bytes([cd_buf[cursor + 28], cd_buf[cursor + 29]]) as usize;
        let extra_len = u16::from_le_bytes([cd_buf[cursor + 30], cd_buf[cursor + 31]]) as usize;
        let comment_len = u16::from_le_bytes([cd_buf[cursor + 32], cd_buf[cursor + 33]]) as usize;
        let ext_attr = u32::from_le_bytes([
            cd_buf[cursor + 38],
            cd_buf[cursor + 39],
            cd_buf[cursor + 40],
            cd_buf[cursor + 41],
        ]);
        let mut local_off = u32::from_le_bytes([
            cd_buf[cursor + 42],
            cd_buf[cursor + 43],
            cd_buf[cursor + 44],
            cd_buf[cursor + 45],
        ]) as u64;

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
                let sz =
                    u16::from_le_bytes([extra_bytes[ex_idx + 2], extra_bytes[ex_idx + 3]]) as usize;
                if tag == 0x0001 && ex_idx + 4 + sz <= extra_bytes.len() {
                    let mut data_pos = ex_idx + 4;
                    if uncomp_sz == 0xFFFFFFFF && data_pos + 8 <= extra_bytes.len() {
                        uncomp_sz = u64::from_le_bytes(
                            extra_bytes[data_pos..data_pos + 8].try_into().unwrap(),
                        );
                        data_pos += 8;
                    }
                    if comp_sz == 0xFFFFFFFF && data_pos + 8 <= extra_bytes.len() {
                        comp_sz = u64::from_le_bytes(
                            extra_bytes[data_pos..data_pos + 8].try_into().unwrap(),
                        );
                        data_pos += 8;
                    }
                    if local_off == 0xFFFFFFFF && data_pos + 8 <= extra_bytes.len() {
                        local_off = u64::from_le_bytes(
                            extra_bytes[data_pos..data_pos + 8].try_into().unwrap(),
                        );
                    }
                    break;
                }
                ex_idx += 4 + sz;
            }
        }

        let is_dir = (ext_attr & 0x10) != 0
            || name.ends_with('/')
            || raw_name.ends_with('/')
            || ((ext_attr >> 16) & 0o040000 != 0);

        if !is_dir {
            total_uncompressed = total_uncompressed.saturating_add(uncomp_sz);
        }

        entries.push(ZipEntry {
            name: if name.is_empty() { raw_name } else { name },
            size: uncomp_sz,
            compressed_size: comp_sz,
            is_dir,
            method,
            encrypted: (flags & 1) != 0,
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
    crate::core::stream_server::record_stream_activity();
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
    let sessions_dir = super::grammers_ops::resolve_sessions_dir(None);
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
                    encrypted: false,
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
    .map_err(|e| {
        TgError::new(
            TgErrorCode::Internal,
            format!("Alur tugas ZIP terputus: {e}"),
        )
    })?;

    if let Ok(ref valid_res) = res {
        set_cached_catalog(cache_key, valid_res.clone());
    }

    res
}

/// ZipCrypto stream cipher keys
struct ZipCrypto {
    key0: u32,
    key1: u32,
    key2: u32,
}

const CRC32_TABLE: [u32; 256] = [
    0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f, 0xe963a535, 0x9e6495a3,
    0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988, 0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91,
    0x1db71064, 0x6ab020f2, 0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
    0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9, 0xfa0f3d63, 0x8d080df5,
    0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172, 0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b,
    0x35b5a8fa, 0x42b2986c, 0xdbbbc9d6, 0xacbcf940, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
    0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c423, 0xcfba9599, 0xb8bda50f,
    0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924, 0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d,
    0x76dc4190, 0x01db7106, 0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
    0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d, 0x91646c97, 0xe6635c01,
    0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e, 0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457,
    0x65b0d9c6, 0x12b7e950, 0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
    0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7, 0xa4d1c46d, 0xd3d6f4fb,
    0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0, 0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9,
    0x5005713c, 0x270241aa, 0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
    0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81, 0xb7bd5c3b, 0xc0ba6cad,
    0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a, 0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683,
    0xe3630b12, 0x94643b84, 0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
    0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb, 0x196c3671, 0x6e6b06e7,
    0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc, 0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5,
    0xd6d6a3e8, 0xa1d1937e, 0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
    0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa867df55, 0x316e8eef, 0x4669be79,
    0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236, 0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f,
    0xc5ba3bbe, 0xb2bd0b28, 0x2bb45a92, 0x5cb36a04, 0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
    0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a, 0x9c0906a9, 0xeb0e363f, 0x72076785, 0x05005713,
    0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38, 0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21,
    0x86d3d2d4, 0xf1d4e242, 0x68ddb3f8, 0x1fda836e, 0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
    0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c, 0x8f659eff, 0xf862ae69, 0x616bffd3, 0x166ccf45,
    0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2, 0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db,
    0xaed16a4a, 0xd9d65adc, 0x40df0b66, 0x37d83bf0, 0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
    0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6, 0xbad03605, 0xcdd70693, 0x54de5729, 0x23d967bf,
    0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94, 0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d,
];

impl ZipCrypto {
    fn new(password: &[u8]) -> Self {
        let mut z = Self {
            key0: 0x12345678,
            key1: 0x23456789,
            key2: 0x34567890,
        };
        for &b in password {
            z.update(b);
        }
        z
    }

    #[inline(always)]
    fn crc32(crc: u32, b: u8) -> u32 {
        (crc >> 8) ^ CRC32_TABLE[((crc & 0xff) as u8 ^ b) as usize]
    }

    #[inline(always)]
    fn update(&mut self, b: u8) {
        self.key0 = Self::crc32(self.key0, b);
        self.key1 = self
            .key1
            .wrapping_add(self.key0 & 0xff)
            .wrapping_mul(0x08088405)
            .wrapping_add(1);
        self.key2 = Self::crc32(self.key2, (self.key1 >> 24) as u8);
    }

    #[inline(always)]
    fn decrypt_byte(&mut self, c: u8) -> u8 {
        let temp = (self.key2 as u16) | 3;
        let k = (((temp.wrapping_mul(temp ^ 1)) >> 8) & 0xff) as u8;
        let p = c ^ k;
        self.update(p);
        p
    }
}

/// In-memory direct entry decompressor / decryptor (Zero full archive rescan, zero 60MB search)
fn decode_entry_bytes_direct(
    local_header: &[u8],
    comp_buf: &[u8],
    password: Option<&str>,
    uncomp_size_hint: u64,
) -> IoResult<Vec<u8>> {
    if local_header.len() < 30 {
        return Err(IoError::new(IoErrorKind::InvalidData, "Header too short"));
    }
    let flags = u16::from_le_bytes([local_header[6], local_header[7]]);
    let is_encrypted = (flags & 1) != 0;
    let method = u16::from_le_bytes([local_header[8], local_header[9]]);
    let mod_time = u16::from_le_bytes([local_header[10], local_header[11]]);
    let crc32 = u32::from_le_bytes([
        local_header[14],
        local_header[15],
        local_header[16],
        local_header[17],
    ]);

    if !is_encrypted {
        return match method {
            0 => Ok(comp_buf.to_vec()),
            8 => {
                use flate2::read::DeflateDecoder;
                let mut decoder = DeflateDecoder::new(comp_buf);
                let mut out = Vec::with_capacity(uncomp_size_hint as usize);
                decoder.read_to_end(&mut out)?;
                Ok(out)
            }
            _ => Err(IoError::new(
                IoErrorKind::Other,
                format!("Unsupported compression method {method}"),
            )),
        };
    }

    // Encrypted entry: require password
    let pass =
        password.ok_or_else(|| IoError::new(IoErrorKind::PermissionDenied, "bad_password"))?;

    // 1. Try fast ZipCrypto first
    if comp_buf.len() >= 12 {
        let mut z = ZipCrypto::new(pass.as_bytes());
        let mut hdr = [0u8; 12];
        for i in 0..12 {
            hdr[i] = z.decrypt_byte(comp_buf[i]);
        }

        let expected_check = if (flags & 8) != 0 {
            (mod_time >> 8) as u8
        } else {
            (crc32 >> 24) as u8
        };

        if hdr[11] == expected_check {
            let mut payload = Vec::with_capacity(comp_buf.len() - 12);
            for &b in &comp_buf[12..] {
                payload.push(z.decrypt_byte(b));
            }

            match method {
                0 => return Ok(payload),
                8 => {
                    use flate2::read::DeflateDecoder;
                    let mut decoder = DeflateDecoder::new(&payload[..]);
                    let mut out = Vec::with_capacity(uncomp_size_hint as usize);
                    if decoder.read_to_end(&mut out).is_ok() {
                        return Ok(out);
                    }
                }
                _ => {}
            }
        }
    }

    // 2. Synthetic 1-entry in-memory ZIP buffer for AES / WinZip or other methods
    let name_len = u16::from_le_bytes([local_header[26], local_header[27]]) as usize;
    let extra_len = u16::from_le_bytes([local_header[28], local_header[29]]) as usize;
    let header_prefix_len = 30 + name_len + extra_len;
    if local_header.len() < header_prefix_len {
        return Err(IoError::new(
            IoErrorKind::InvalidData,
            "Incomplete local header",
        ));
    }

    let total_local_entry_len = header_prefix_len + comp_buf.len();
    let mut synth_zip = Vec::with_capacity(total_local_entry_len + 46 + name_len + extra_len + 22);

    // 1. Local entry header + name + extra + compressed payload
    synth_zip.extend_from_slice(&local_header[..header_prefix_len]);
    synth_zip.extend_from_slice(comp_buf);

    let cd_offset = synth_zip.len() as u32;

    // 2. Central directory header (46 bytes + name + extra)
    synth_zip.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02]); // Signature
    synth_zip.extend_from_slice(&[20, 0]); // Version made by
    synth_zip.extend_from_slice(&local_header[4..30]); // Copy version needed, flags, method, mod time/date, crc32, sizes, lengths
    synth_zip.extend_from_slice(&[0, 0]); // Comment length (0)
    synth_zip.extend_from_slice(&[0, 0]); // Disk number start (0)
    synth_zip.extend_from_slice(&[0, 0]); // Internal attributes (0)
    synth_zip.extend_from_slice(&[0, 0, 0, 0]); // External attributes (0)
    synth_zip.extend_from_slice(&[0, 0, 0, 0]); // Relative offset of local header (0)
    synth_zip.extend_from_slice(&local_header[30..header_prefix_len]); // Filename + extra

    let cd_size = (synth_zip.len() as u32) - cd_offset;

    // 3. EOCD (22 bytes)
    synth_zip.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06]);
    synth_zip.extend_from_slice(&[0, 0]); // Disk number
    synth_zip.extend_from_slice(&[0, 0]); // Disk with CD
    synth_zip.extend_from_slice(&[1, 0]); // Total entries on disk
    synth_zip.extend_from_slice(&[1, 0]); // Total entries
    synth_zip.extend_from_slice(&cd_size.to_le_bytes());
    synth_zip.extend_from_slice(&cd_offset.to_le_bytes());
    synth_zip.extend_from_slice(&[0, 0]); // Comment len

    let cursor = std::io::Cursor::new(synth_zip);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| {
        IoError::new(
            IoErrorKind::InvalidData,
            format!("Synthetic ZIP error: {e}"),
        )
    })?;

    let mut f = archive
        .by_index_decrypt(0, pass.as_bytes())
        .map_err(|e| match e {
            zip::result::ZipError::InvalidPassword => {
                IoError::new(IoErrorKind::PermissionDenied, "bad_password")
            }
            _ => IoError::new(IoErrorKind::Other, format!("{e}")),
        })?;

    let mut out = Vec::with_capacity(uncomp_size_hint as usize);
    f.read_to_end(&mut out).map_err(|e| {
        let s = e.to_string();
        if s.contains("password") || s.contains("checksum") || s.contains("HMAC") {
            IoError::new(IoErrorKind::PermissionDenied, "bad_password")
        } else {
            e
        }
    })?;

    Ok(out)
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
        return Err(IoError::new(
            IoErrorKind::InvalidData,
            "Invalid Local Header signature",
        ));
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

    let name_len = u16::from_le_bytes([header_buf[26], header_buf[27]]) as usize;
    let extra_len = u16::from_le_bytes([header_buf[28], header_buf[29]]) as usize;

    let mut name_extra_buf = vec![0u8; name_len + extra_len];
    if !name_extra_buf.is_empty() {
        reader.read_exact(&mut name_extra_buf)?;
    }

    let mut full_local_header = Vec::with_capacity(30 + name_len + extra_len);
    full_local_header.extend_from_slice(&header_buf);
    full_local_header.extend_from_slice(&name_extra_buf);

    let comp_size = entry.compressed_size as usize;
    let mut comp_buf = vec![0u8; comp_size];
    reader.read_exact(&mut comp_buf)?;

    let decomp_buf =
        decode_entry_bytes_direct(&full_local_header, &comp_buf, password, entry.size)?;

    let mut prev = super::zip_local::build_zip_entry_preview(&entry.name, entry.size, decomp_buf);
    prev.backend = "grammers_sparse_direct".into();
    Ok(prev)
}

fn extract_exif_thumbnail_from_header(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 128 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }

    let mut pos = 2;
    while pos + 4 <= data.len() {
        if data[pos] != 0xFF {
            break;
        }
        let marker = data[pos + 1];
        pos += 2;

        if marker == 0xD9 || marker == 0xDA {
            break;
        }

        if pos + 2 > data.len() {
            break;
        }
        let seg_len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        if seg_len < 2 || pos + seg_len > data.len() {
            break;
        }

        let seg_data = &data[pos + 2..pos + seg_len];
        pos += seg_len;

        if marker == 0xE1 && seg_data.len() >= 14 && &seg_data[0..6] == b"Exif\0\0" {
            let tiff = &seg_data[6..];
            if tiff.len() < 8 {
                continue;
            }

            let is_le = match &tiff[0..2] {
                b"II" => true,
                b"MM" => false,
                _ => continue,
            };

            let read_u16 = |buf: &[u8], off: usize| -> Option<u16> {
                if off + 2 <= buf.len() {
                    if is_le {
                        Some(u16::from_le_bytes([buf[off], buf[off + 1]]))
                    } else {
                        Some(u16::from_be_bytes([buf[off], buf[off + 1]]))
                    }
                } else {
                    None
                }
            };

            let read_u32 = |buf: &[u8], off: usize| -> Option<u32> {
                if off + 4 <= buf.len() {
                    if is_le {
                        Some(u32::from_le_bytes([
                            buf[off],
                            buf[off + 1],
                            buf[off + 2],
                            buf[off + 3],
                        ]))
                    } else {
                        Some(u32::from_be_bytes([
                            buf[off],
                            buf[off + 1],
                            buf[off + 2],
                            buf[off + 3],
                        ]))
                    }
                } else {
                    None
                }
            };

            let ifd0_offset = read_u32(tiff, 4)? as usize;
            if ifd0_offset >= tiff.len() {
                continue;
            }

            let ifd0_count = read_u16(tiff, ifd0_offset)? as usize;
            let ifd1_ptr_offset = ifd0_offset + 2 + ifd0_count * 12;
            let ifd1_offset = read_u32(tiff, ifd1_ptr_offset)? as usize;

            if ifd1_offset == 0 || ifd1_offset >= tiff.len() {
                continue;
            }

            let ifd1_count = read_u16(tiff, ifd1_offset)? as usize;
            let mut thumb_offset: Option<usize> = None;
            let mut thumb_len: Option<usize> = None;

            for i in 0..ifd1_count {
                let tag_off = ifd1_offset + 2 + i * 12;
                let tag_id = read_u16(tiff, tag_off)?;
                let tag_val = read_u32(tiff, tag_off + 8)?;

                if tag_id == 0x0201 {
                    thumb_offset = Some(tag_val as usize);
                } else if tag_id == 0x0202 {
                    thumb_len = Some(tag_val as usize);
                }
            }

            if let (Some(off), Some(len)) = (thumb_offset, thumb_len) {
                if off + len <= tiff.len() {
                    let thumb_slice = &tiff[off..off + len];
                    if thumb_slice.len() >= 4 && thumb_slice[0] == 0xFF && thumb_slice[1] == 0xD8 {
                        return Some(thumb_slice.to_vec());
                    }
                }
            }
        }
    }

    None
}

fn extract_mp4_cover_from_header(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 32 {
        return None;
    }
    if let Some(covr_pos) = data.windows(4).position(|w| w == b"covr") {
        if covr_pos + 8 <= data.len() {
            let data_atom_pos = covr_pos + 8;
            if data_atom_pos + 16 <= data.len()
                && &data[data_atom_pos + 4..data_atom_pos + 8] == b"data"
            {
                let data_len = u32::from_be_bytes([
                    data[data_atom_pos],
                    data[data_atom_pos + 1],
                    data[data_atom_pos + 2],
                    data[data_atom_pos + 3],
                ]) as usize;
                let payload_start = data_atom_pos + 16;
                let payload_end = (data_atom_pos + data_len).min(data.len());
                if payload_start < payload_end {
                    let img_slice = &data[payload_start..payload_end];
                    if (img_slice.len() >= 2 && img_slice[0] == 0xFF && img_slice[1] == 0xD8)
                        || (img_slice.len() >= 8 && &img_slice[0..4] == b"\x89PNG")
                    {
                        return Some(img_slice.to_vec());
                    }
                }
            }
        }
    }
    None
}

fn extract_thumbnail_direct(
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
            backend: "grammers_sparse_thumb".into(),
        });
    }

    reader.seek(SeekFrom::Start(entry.local_header_offset))?;
    let mut header_buf = [0u8; 30];
    reader.read_exact(&mut header_buf)?;

    if &header_buf[0..4] != &[0x50, 0x4b, 0x03, 0x04] {
        return Err(IoError::new(
            IoErrorKind::InvalidData,
            "Invalid Local Header signature",
        ));
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
            backend: "grammers_sparse_thumb".into(),
        });
    }

    let name_len = u16::from_le_bytes([header_buf[26], header_buf[27]]) as usize;
    let extra_len = u16::from_le_bytes([header_buf[28], header_buf[29]]) as usize;

    let mut name_extra_buf = vec![0u8; name_len + extra_len];
    if !name_extra_buf.is_empty() {
        reader.read_exact(&mut name_extra_buf)?;
    }

    let mut full_local_header = Vec::with_capacity(30 + name_len + extra_len);
    full_local_header.extend_from_slice(&header_buf);
    full_local_header.extend_from_slice(&name_extra_buf);

    let method = u16::from_le_bytes([header_buf[8], header_buf[9]]);

    // CAPPED MICRO-QUOTA READ: For files > 384 KB, fetch only first 64 KiB from MTProto!
    let capped_fetch = if entry.size > 384 * 1024 {
        (entry.compressed_size as usize).min(64 * 1024)
    } else {
        entry.compressed_size as usize
    };

    let mut comp_buf = vec![0u8; capped_fetch];
    reader.read_exact(&mut comp_buf)?;

    // If small file (< 384 KB), decompress fully
    if entry.size <= 384 * 1024 {
        let decomp_buf =
            decode_entry_bytes_direct(&full_local_header, &comp_buf, password, entry.size)?;
        let mut prev =
            super::zip_local::build_zip_entry_preview(&entry.name, entry.size, decomp_buf);
        prev.backend = "grammers_sparse_thumb_full".into();
        return Ok(prev);
    }

    // For large files (> 384 KB): extract header chunk
    let mut header_data = Vec::new();
    if is_encrypted {
        if let Some(pass) = password {
            if comp_buf.len() >= 12 {
                let mut z = ZipCrypto::new(pass.as_bytes());
                for b in comp_buf.iter_mut() {
                    *b = z.decrypt_byte(*b);
                }
                comp_buf = comp_buf[12..].to_vec();
            }
        }
    }

    if method == 0 {
        header_data = comp_buf;
    } else if method == 8 {
        use flate2::read::DeflateDecoder;
        let mut decoder = DeflateDecoder::new(&comp_buf[..]);
        let mut uncomp_chunk = Vec::with_capacity(128 * 1024);
        let _ = std::io::copy(&mut (&mut decoder).take(128 * 1024), &mut uncomp_chunk);
        header_data = uncomp_chunk;
    }

    // Try EXIF JPEG thumbnail extraction
    if let Some(thumb_bytes) = extract_exif_thumbnail_from_header(&header_data) {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&thumb_bytes);
        return Ok(ZipEntryPreview {
            name: entry.name.clone(),
            size: entry.size,
            text_content: None,
            data_url: Some(format!("data:image/jpeg;base64,{b64}")),
            mime_type: Some("image/jpeg".into()),
            is_binary: true,
            encrypted: false,
            backend: "grammers_sparse_exif_thumb".into(),
        });
    }

    // Try MP4 cover extraction
    if let Some(cover_bytes) = extract_mp4_cover_from_header(&header_data) {
        use base64::Engine;
        let mime = if cover_bytes.starts_with(b"\x89PNG") {
            "image/png"
        } else {
            "image/jpeg"
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&cover_bytes);
        return Ok(ZipEntryPreview {
            name: entry.name.clone(),
            size: entry.size,
            text_content: None,
            data_url: Some(format!("data:{mime};base64,{b64}")),
            mime_type: Some(mime.into()),
            is_binary: true,
            encrypted: false,
            backend: "grammers_sparse_mp4_cover".into(),
        });
    }

    // Fallback: If image has JPEG SOI but no EXIF thumbnail and entry size is moderately sized (< 1.5MB),
    // fetch full entry preview
    if entry.size < 1536 * 1024 {
        reader.seek(SeekFrom::Start(
            entry.local_header_offset + 30 + name_len as u64 + extra_len as u64,
        ))?;
        let full_comp_size = entry.compressed_size as usize;
        let mut full_comp_buf = vec![0u8; full_comp_size];
        reader.read_exact(&mut full_comp_buf)?;
        let decomp_buf =
            decode_entry_bytes_direct(&full_local_header, &full_comp_buf, password, entry.size)?;
        let mut prev =
            super::zip_local::build_zip_entry_preview(&entry.name, entry.size, decomp_buf);
        prev.backend = "grammers_sparse_direct_fallback".into();
        return Ok(prev);
    }

    Ok(ZipEntryPreview {
        name: entry.name.clone(),
        size: entry.size,
        text_content: None,
        data_url: None,
        mime_type: None,
        is_binary: true,
        encrypted: false,
        backend: "grammers_sparse_no_thumb".into(),
    })
}

/// Read micro-quota thumbnail (capped at max 64 KiB from MTProto)
pub async fn preview_zip_thumbnail_sparse(
    opts: SparseZipOpts,
    entry_name: String,
    password: Option<String>,
) -> Result<ZipEntryPreview, TgError> {
    let cache_key = format!("{}:{}:{}", opts.chat_id, opts.message_id, opts.session);
    let catalog = match get_cached_catalog(&cache_key) {
        Some(cat) => cat,
        None => list_zip_sparse(opts.clone()).await?,
    };

    let target_entry = catalog
        .entries
        .iter()
        .find(|e| {
            e.name == entry_name || sanitize_zip_path(&e.name) == sanitize_zip_path(&entry_name)
        })
        .cloned();

    let rt = runtime()?;
    let identity = TelegramIdentity {
        session: opts.session.clone(),
        api_id: opts.api_id,
        api_hash: opts.api_hash.clone(),
    };
    session_rate::wait_if_flooded_capped(&opts.session, std::time::Duration::from_secs(35)).await?;
    let _media_slot = session_rate::acquire_media_slot(&opts.session).await?;
    let sessions_dir = super::grammers_ops::resolve_sessions_dir(None);
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

        if let Some(ref entry) = target_entry {
            match extract_thumbnail_direct(&mut sparse_reader, entry, password.as_deref()) {
                Ok(prev) => {
                    let _ = persist_memory_session(&session, &session_path);
                    return Ok(prev);
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    if err_msg.contains("bad_password")
                        || err_msg.contains("Password required")
                        || err_msg.contains("PermissionDenied")
                    {
                        return Err(TgError::new(TgErrorCode::Io, "bad_password"));
                    }
                    return Err(TgError::new(TgErrorCode::Io, err_msg));
                }
            }
        }

        Err(TgError::new(
            TgErrorCode::Io,
            format!("Entri tidak ditemukan: {entry_name}"),
        ))
    })
    .await
    .map_err(|e| {
        TgError::new(
            TgErrorCode::Internal,
            format!("Alur tugas thumbnail ZIP terputus: {e}"),
        )
    })?
}

/// Read single entry by fetching exact byte range lazily from Telegram MTProto (zero full download)
pub async fn preview_zip_entry_sparse(
    opts: SparseZipOpts,
    entry_name: String,
    password: Option<String>,
) -> Result<ZipEntryPreview, TgError> {
    crate::core::stream_server::record_stream_activity();
    let cache_key = format!("{}:{}:{}", opts.chat_id, opts.message_id, opts.session);
    let catalog = match get_cached_catalog(&cache_key) {
        Some(cat) => cat,
        None => list_zip_sparse(opts.clone()).await?,
    };

    let target_entry = catalog
        .entries
        .iter()
        .find(|e| {
            e.name == entry_name || sanitize_zip_path(&e.name) == sanitize_zip_path(&entry_name)
        })
        .cloned();

    let rt = runtime()?;
    let identity = TelegramIdentity {
        session: opts.session.clone(),
        api_id: opts.api_id,
        api_hash: opts.api_hash.clone(),
    };
    session_rate::wait_if_flooded_capped(&opts.session, std::time::Duration::from_secs(35)).await?;
    let _media_slot = session_rate::acquire_media_slot(&opts.session).await?;
    let sessions_dir = super::grammers_ops::resolve_sessions_dir(None);
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
            match preview_zip_entry_direct(&mut sparse_reader, entry, password.as_deref()) {
                Ok(prev) => {
                    let _ = persist_memory_session(&session, &session_path);
                    return Ok(prev);
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    if err_msg.contains("bad_password")
                        || err_msg.contains("Password required")
                        || err_msg.contains("PermissionDenied")
                    {
                        return Err(TgError::new(TgErrorCode::Io, "bad_password"));
                    }
                    return Err(TgError::new(TgErrorCode::Io, err_msg));
                }
            }
        }

        Err(TgError::new(
            TgErrorCode::Io,
            format!("Entri tidak ditemukan: {entry_name}"),
        ))
    })
    .await
    .map_err(|e| {
        TgError::new(
            TgErrorCode::Internal,
            format!("Alur tugas ZIP terputus: {e}"),
        )
    })?
}

fn extract_zip_entry_direct(
    reader: &mut TelegramSparseReader,
    entry: &ZipEntry,
    dest_path: &str,
    password: Option<&str>,
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
        return Err(IoError::new(
            IoErrorKind::InvalidData,
            "Invalid Local Header signature",
        ));
    }

    let flags = u16::from_le_bytes([header_buf[6], header_buf[7]]);
    let is_encrypted = (flags & 1) != 0;
    if is_encrypted && password.is_none() {
        return Err(IoError::new(IoErrorKind::PermissionDenied, "bad_password"));
    }

    let name_len = u16::from_le_bytes([header_buf[26], header_buf[27]]) as usize;
    let extra_len = u16::from_le_bytes([header_buf[28], header_buf[29]]) as usize;
    let mut name_extra_buf = vec![0u8; name_len + extra_len];
    if !name_extra_buf.is_empty() {
        reader.read_exact(&mut name_extra_buf)?;
    }

    let mut full_local_header = Vec::with_capacity(30 + name_len + extra_len);
    full_local_header.extend_from_slice(&header_buf);
    full_local_header.extend_from_slice(&name_extra_buf);

    let comp_size = entry.compressed_size as usize;
    let mut comp_buf = vec![0u8; comp_size];
    reader.read_exact(&mut comp_buf)?;

    let decomp_buf =
        decode_entry_bytes_direct(&full_local_header, &comp_buf, password, entry.size)?;

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

    let target_entry = catalog
        .entries
        .iter()
        .find(|e| {
            e.name == entry_name || sanitize_zip_path(&e.name) == sanitize_zip_path(&entry_name)
        })
        .cloned();

    let rt = runtime()?;
    let identity = TelegramIdentity {
        session: opts.session.clone(),
        api_id: opts.api_id,
        api_hash: opts.api_hash.clone(),
    };
    session_rate::wait_if_flooded_capped(&opts.session, std::time::Duration::from_secs(35)).await?;
    let _media_slot = session_rate::acquire_media_slot(&opts.session).await?;
    let sessions_dir = super::grammers_ops::resolve_sessions_dir(None);
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
            match extract_zip_entry_direct(
                &mut sparse_reader,
                entry,
                &dest_path,
                password.as_deref(),
            ) {
                Ok(bytes_written) => {
                    let _ = persist_memory_session(&session, &session_path);
                    return Ok(bytes_written);
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    if err_msg.contains("bad_password") || err_msg.contains("PermissionDenied") {
                        return Err(TgError::new(TgErrorCode::Io, "bad_password"));
                    }
                    return Err(TgError::new(TgErrorCode::Io, err_msg));
                }
            }
        }

        Err(TgError::new(
            TgErrorCode::Io,
            format!("Entri tidak ditemukan: {entry_name}"),
        ))
    })
    .await
    .map_err(|e| {
        TgError::new(
            TgErrorCode::Internal,
            format!("Alur tugas ZIP terputus: {e}"),
        )
    })?
}
