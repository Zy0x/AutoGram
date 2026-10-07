use crate::telegram::auth::AuthError;
use crate::telegram::auth::map_rpc;
use grammers_client::{Client, media::Media};

pub const ALIGNMENT: u64 = 4096;
pub const MAX_READ: u32 = 256 * 1024;

#[derive(Debug, PartialEq)]
pub struct RangePlan {
    pub chunk_index: i32,
    pub trim_prefix: usize,
    pub length: usize,
}

/// Plan a bounded range starting at the requested position, never from file offset zero.
pub fn plan_range(size: u64, offset: u64, length: u32) -> Result<RangePlan, AuthError> {
    if length == 0 || length > MAX_READ {
        return Err(AuthError::new("invalid_range"));
    }
    let aligned = offset / ALIGNMENT;
    let chunk_index = i32::try_from(aligned).map_err(|_| AuthError::new("invalid_range"))?;
    Ok(RangePlan {
        chunk_index,
        trim_prefix: (offset % ALIGNMENT) as usize,
        length: size.saturating_sub(offset).min(u64::from(length)) as usize,
    })
}

fn validate_chunk(returned: usize, requested: u64, remaining: usize) -> Result<(), AuthError> {
    if returned == 0 || returned as u64 > requested || (returned as u64 != requested && returned < remaining) {
        return Err(AuthError::new("cloud_media_truncated"));
    }
    Ok(())
}

/// Shared byte reader for preview and account-pinned transfers. Never reads a file prefix to seek.
pub(crate) async fn fetch_media_range(client: &Client, media: &Media, size: u64,
    offset: u64, length: u32) -> Result<Vec<u8>, AuthError> {
    let plan = plan_range(size, offset, length)?;
    if plan.length == 0 { return Ok(Vec::new()); }
    let needed = plan.trim_prefix + plan.length;
    let mut buffer = Vec::with_capacity(needed + ALIGNMENT as usize);
    let mut position = (plan.chunk_index as u64) * ALIGNMENT;
    while buffer.len() < needed {
        let remaining = needed - buffer.len();
        let mut chunk = ALIGNMENT;
        while chunk * 2 <= remaining as u64 && chunk * 2 <= u64::from(MAX_READ)
            && position % (chunk * 2) == 0 { chunk *= 2; }
        let skip = i32::try_from(position / chunk).map_err(|_| AuthError::new("invalid_range"))?;
        let mut download = client.iter_download(media).chunk_size(chunk as i32).skip_chunks(skip);
        let bytes = download.next().await.map_err(|e| map_rpc(e).for_rpc(crate::telegram::auth::RpcDomain::Files))?
            .ok_or_else(|| AuthError::new("cloud_media_truncated"))?;
        // A short response before the requested end must not replay the same floor-aligned chunk.
        validate_chunk(bytes.len(), chunk, remaining)?;
        position += bytes.len() as u64;
        buffer.extend(bytes);
    }
    Ok(buffer[plan.trim_prefix..needed].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seeks_start_at_requested_chunk() {
        assert_eq!(
            plan_range(10_000_000_000, 8_000_000_123, 8192).unwrap(),
            RangePlan {
                chunk_index: 1_953_125,
                trim_prefix: 123,
                length: 8192
            }
        );
    }
    #[test]
    fn eof_and_tail_are_exact() {
        assert_eq!(plan_range(12345, 12300, 4096).unwrap().length, 45);
        assert_eq!(plan_range(12345, 12345, 4096).unwrap().length, 0);
        assert_eq!(
            plan_range(12345, u64::MAX, 4096).unwrap_err().code,
            "invalid_range"
        );
    }
    #[test]
    fn oversized_reads_are_refused() {
        assert!(plan_range(12345, 0, MAX_READ + 1).is_err());
        assert!(plan_range(12345, 0, 0).is_err());
    }
    #[test]
    fn short_mid_range_cannot_replay_and_duplicate_the_last_chunk() {
        assert_eq!(validate_chunk(808, 4096, 1808).unwrap_err().code, "cloud_media_truncated");
        assert!(validate_chunk(808, 4096, 808).is_ok());
        assert!(validate_chunk(4096, 4096, 5000).is_ok());
        assert!(validate_chunk(4097, 4096, 1).is_err());
        assert!(validate_chunk(0, 4096, 1).is_err());
    }
}
