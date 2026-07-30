//! Format-aware seekable range reader for partial video preview extraction.
//! Supports head read, tail read (for MP4 moov atom at EOF), exact seek,
//! range merging, byte budget enforcement (max 6 MB), and timeout (3s).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::time::timeout;

use super::super::error::TopicMediaError;
use super::super::mtproto::file_transport::TelegramRangeReader;

pub const DEFAULT_BYTE_BUDGET: usize = 6 * 1024 * 1024; // 6 MB max per media
pub const READ_TIMEOUT_SECS: u64 = 3;

pub struct BoundedRangeReader<'a> {
    pub reader: &'a (dyn TelegramRangeReader + 'a),
    pub max_budget: usize,
    bytes_read: AtomicUsize,
    cache: tokio::sync::Mutex<BTreeMap<u64, Vec<u8>>>,
}

impl<'a> BoundedRangeReader<'a> {
    pub fn new(reader: &'a (dyn TelegramRangeReader + 'a)) -> Self {
        Self {
            reader,
            max_budget: DEFAULT_BYTE_BUDGET,
            bytes_read: AtomicUsize::new(0),
            cache: tokio::sync::Mutex::new(BTreeMap::new()),
        }
    }

    pub fn file_size(&self) -> u64 {
        self.reader.file_size()
    }

    pub async fn read_head(&self, length: usize) -> Result<Vec<u8>, TopicMediaError> {
        self.read_range_cached(0, length).await
    }

    pub async fn read_tail(&self, length: usize) -> Result<Vec<u8>, TopicMediaError> {
        let size = self.file_size();
        let offset = size.saturating_sub(length as u64);
        self.read_range_cached(offset, length).await
    }

    pub async fn read_range_cached(
        &self,
        offset: u64,
        length: usize,
    ) -> Result<Vec<u8>, TopicMediaError> {
        let current = self.bytes_read.load(Ordering::Relaxed);
        if current >= self.max_budget {
            return Err(TopicMediaError::Internal(
                "Byte budget exceeded for partial range extraction".into(),
            ));
        }

        let actual_len = length.min(self.max_budget - current);

        let fut = self.reader.read_range(offset, actual_len);
        let bytes = match timeout(Duration::from_secs(READ_TIMEOUT_SECS), fut).await {
            Ok(Ok(b)) => b,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                return Err(TopicMediaError::Internal(
                    "Timeout reading range from Telegram".into(),
                ))
            }
        };

        self.bytes_read
            .fetch_add(bytes.len(), Ordering::Relaxed);

        let vec_bytes = bytes.to_vec();
        {
            let mut cache = self.cache.lock().await;
            cache.insert(offset, vec_bytes.clone());
        }

        Ok(vec_bytes)
    }

    pub async fn locate_mp4_moov(&self, head_bytes: &[u8]) -> Result<Option<Vec<u8>>, TopicMediaError> {
        // Search for 'moov' atom in head
        if head_bytes.windows(4).any(|w| w == b"moov") {
            return Ok(Some(head_bytes.to_vec()));
        }

        // Search for 'moov' atom in tail if not found in head
        let tail_size = 512 * 1024;
        let tail_bytes = self.read_tail(tail_size).await?;
        if tail_bytes.windows(4).any(|w| w == b"moov") {
            let mut merged = head_bytes.to_vec();
            merged.extend_from_slice(&tail_bytes);
            return Ok(Some(merged));
        }

        Ok(None)
    }

    pub async fn locate_mkv_cues(&self, head_bytes: &[u8]) -> Result<Vec<u8>, TopicMediaError> {
        // Search EBML / cues in head or tail
        if head_bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
            return Ok(head_bytes.to_vec());
        }
        let tail_bytes = self.read_tail(256 * 1024).await?;
        let mut merged = head_bytes.to_vec();
        merged.extend_from_slice(&tail_bytes);
        Ok(merged)
    }
}
