//! Seekable range reader and file transport for MTProto media download.

use async_trait::async_trait;
use bytes::Bytes;
use grammers_client::tl;
use grammers_client::Client;

use super::super::error::TopicMediaError;

pub const MAX_CHUNK_SIZE: usize = 1024 * 1024; // 1MB max chunk limit per Telegram MTProto spec

#[async_trait]
pub trait TelegramRangeReader: Send + Sync {
    async fn read_range(&self, offset: u64, length: usize) -> Result<Bytes, TopicMediaError>;

    fn file_size(&self) -> u64;

    async fn cancel(&self);
}

pub struct MTProtoRangeReader {
    client: Client,
    location: tl::enums::InputFileLocation,
    dc_id: Option<i32>,
    file_size: u64,
}

impl MTProtoRangeReader {
    pub fn new(
        client: Client,
        location: tl::enums::InputFileLocation,
        dc_id: Option<i32>,
        file_size: u64,
    ) -> Self {
        Self {
            client,
            location,
            dc_id,
            file_size,
        }
    }
}

#[async_trait]
impl TelegramRangeReader for MTProtoRangeReader {
    async fn read_range(&self, offset: u64, length: usize) -> Result<Bytes, TopicMediaError> {
        let chunk_len = length.min(MAX_CHUNK_SIZE);
        let req = tl::functions::upload::GetFile {
            precise: true,
            cdn_supported: false,
            location: self.location.clone(),
            offset: offset as i64,
            limit: chunk_len as i32,
        };

        let res = self
            .client
            .invoke(&req)
            .await
            .map_err(|e| TopicMediaError::Internal(e.to_string()))?;

        match res {
            tl::enums::upload::File::File(f) => Ok(Bytes::from(f.bytes)),
            tl::enums::upload::File::CdnRedirect(_) => Err(TopicMediaError::CdnRedirect),
        }
    }

    fn file_size(&self) -> u64 {
        self.file_size
    }

    async fn cancel(&self) {}
}
