//! Range reader wrapper for partial preview extraction.

use super::super::mtproto::file_transport::MTProtoRangeReader;

pub struct ThumbnailRangeReader<'a> {
    pub inner: &'a MTProtoRangeReader,
}
