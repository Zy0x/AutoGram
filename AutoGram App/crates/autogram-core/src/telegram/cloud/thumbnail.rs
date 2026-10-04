//! Grid thumbnail quality modes, mirroring desktop `core::grammers::thumbs::pick_thumb`.
//!
//! - Saver ("Hemat"): free inline stripped/cached layer, else the smallest real layer.
//! - Balanced ("Seimbang"): the real Telegram layer closest to 512 px.
//! - Sharp ("Jelas"): the largest real Telegram layer (still a thumbnail, never the file).
//!
//! A card thumbnail never downloads the original photo/video; bytes are capped per item.
use crate::telegram::auth::AuthError;
use grammers_client::{
    media::{Downloadable, Media, PhotoSize},
    Client,
};

pub const MAX_THUMBNAIL_BATCH: usize = 24;
pub const MAX_THUMBNAIL_BYTES: usize = 512 * 1024;
const BALANCED_TARGET_DIM: i32 = 512;
const DOWNLOAD_CHUNK: i32 = 128 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThumbnailQuality {
    Saver,
    Balanced,
    Sharp,
}

impl ThumbnailQuality {
    pub fn parse(value: &str) -> Result<Self, AuthError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "saver" | "hemat" => Ok(Self::Saver),
            "balanced" | "seimbang" => Ok(Self::Balanced),
            "sharp" | "jelas" => Ok(Self::Sharp),
            _ => Err(AuthError::new("invalid_thumbnail_quality")),
        }
    }
}

impl std::str::FromStr for ThumbnailQuality {
    type Err = AuthError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

/// Telegram-agnostic description of one thumbnail layer, so selection is unit-testable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Layer {
    pub inline: bool,
    pub width: i32,
    pub height: i32,
    pub bytes: usize,
}

impl Layer {
    fn downloadable(&self) -> bool {
        !self.inline && self.bytes > 0
    }
    fn area(&self) -> i64 {
        if self.width > 0 && self.height > 0 {
            i64::from(self.width) * i64::from(self.height)
        } else {
            self.bytes as i64
        }
    }
}

/// Returns the index of the layer to use for `quality`, or `None` when the
/// caller should keep the inline placeholder it already has.
pub(crate) fn pick_layer(layers: &[Layer], quality: ThumbnailQuality) -> Option<usize> {
    if quality == ThumbnailQuality::Saver {
        if let Some(index) = layers.iter().position(|layer| layer.inline) {
            return Some(index);
        }
    }
    let mut downloadable: Vec<usize> = (0..layers.len()).filter(|&i| layers[i].downloadable()).collect();
    if downloadable.is_empty() {
        return None;
    }
    downloadable.sort_by_key(|&i| layers[i].area());
    match quality {
        ThumbnailQuality::Saver => downloadable.first().copied(),
        ThumbnailQuality::Sharp => downloadable.last().copied(),
        ThumbnailQuality::Balanced => downloadable
            .iter()
            .copied()
            .filter(|&i| layers[i].width.max(layers[i].height) > 0)
            .min_by_key(|&i| (layers[i].width.max(layers[i].height) - BALANCED_TARGET_DIM).abs())
            .or_else(|| downloadable.last().copied()),
    }
}

fn describe(size: &PhotoSize) -> Option<Layer> {
    let (width, height, inline) = match size {
        PhotoSize::Size(s) => (s.width, s.height, false),
        PhotoSize::Progressive(s) => (s.width, s.height, false),
        PhotoSize::Cached(s) => (s.width, s.height, true),
        PhotoSize::Stripped(_) => (0, 0, true),
        _ => return None,
    };
    Some(Layer { inline, width, height, bytes: size.size() })
}

pub(crate) fn media_thumbs(media: &Media) -> Vec<PhotoSize> {
    match media {
        Media::Photo(photo) => photo.thumbs(),
        Media::Document(doc) => doc.thumbs(),
        Media::Sticker(sticker) => sticker.document.thumbs(),
        _ => Vec::new(),
    }
}

/// Downloads the selected layer for one message. `Ok(None)` means "keep the placeholder".
/// FloodWait and other RPC failures are returned so the batch can back off.
pub(crate) async fn fetch_thumbnail(
    client: &Client,
    media: &Media,
    quality: ThumbnailQuality,
) -> Result<Option<Vec<u8>>, AuthError> {
    let sizes = media_thumbs(media);
    let layers: Vec<(usize, Layer)> = sizes
        .iter()
        .enumerate()
        .filter_map(|(i, size)| describe(size).map(|layer| (i, layer)))
        .collect();
    let plain: Vec<Layer> = layers.iter().map(|(_, layer)| *layer).collect();
    let Some(choice) = pick_layer(&plain, quality) else {
        return Ok(None);
    };
    let size = &sizes[layers[choice].0];
    if let Some(data) = size.to_data() {
        return Ok((!data.is_empty()).then_some(data));
    }
    if size.size() > MAX_THUMBNAIL_BYTES {
        return Ok(None);
    }
    let mut output = Vec::with_capacity(size.size());
    let mut download = client.iter_download(size).chunk_size(DOWNLOAD_CHUNK);
    while let Some(chunk) = download.next().await.map_err(crate::telegram::auth::map_rpc)? {
        output.extend_from_slice(&chunk);
        if output.len() > MAX_THUMBNAIL_BYTES {
            return Ok(None);
        }
    }
    // Desktop parity: anything this small is not a decodable JPEG layer.
    Ok((output.len() >= 64).then_some(output))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inline() -> Layer {
        Layer { inline: true, width: 0, height: 0, bytes: 700 }
    }
    fn real(dim: i32, bytes: usize) -> Layer {
        Layer { inline: false, width: dim, height: dim * 3 / 4, bytes }
    }

    #[test]
    fn parses_desktop_and_indonesian_labels() {
        assert_eq!(ThumbnailQuality::parse("Hemat").unwrap(), ThumbnailQuality::Saver);
        assert_eq!(ThumbnailQuality::parse("balanced").unwrap(), ThumbnailQuality::Balanced);
        assert_eq!(ThumbnailQuality::parse(" JELAS ").unwrap(), ThumbnailQuality::Sharp);
        assert!(ThumbnailQuality::parse("ultra").is_err());
    }

    #[test]
    fn saver_prefers_free_inline_layer() {
        let layers = [real(320, 9_000), inline(), real(800, 60_000)];
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Saver), Some(1));
    }

    #[test]
    fn saver_without_inline_uses_smallest_real_layer() {
        let layers = [real(800, 60_000), real(90, 2_000), real(320, 9_000)];
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Saver), Some(1));
    }

    #[test]
    fn balanced_picks_layer_closest_to_512() {
        let layers = [inline(), real(90, 2_000), real(320, 9_000), real(800, 60_000), real(1280, 120_000)];
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Balanced), Some(2));
    }

    #[test]
    fn sharp_picks_largest_real_layer_and_never_inline() {
        let layers = [inline(), real(320, 9_000), real(1280, 120_000), real(800, 60_000)];
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Sharp), Some(2));
    }

    #[test]
    fn non_saver_without_real_layers_keeps_placeholder() {
        let layers = [inline()];
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Balanced), None);
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Sharp), None);
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Saver), Some(0));
    }

    #[test]
    fn zero_byte_layers_are_not_downloadable() {
        let layers = [real(800, 0), real(320, 9_000)];
        assert_eq!(pick_layer(&layers, ThumbnailQuality::Sharp), Some(1));
    }
}
