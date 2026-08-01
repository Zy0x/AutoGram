//! Format capability registry for media & document previews.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewCapability {
    DirectServerThumb,
    EmbeddedPreview,
    PartialImageDecode,
    IndexedVideoSeek,
    BoundedLinearScan,
    PdfFirstPage,
    SmartIcon,
    Unsupported,
}

pub fn get_format_capability(mime_type: Option<&str>, file_name: &str) -> PreviewCapability {
    let mime = mime_type.unwrap_or("").to_lowercase();
    let name = file_name.to_lowercase();

    if mime.starts_with("image/")
        || name.ends_with(".jpg")
        || name.ends_with(".jpeg")
        || name.ends_with(".png")
        || name.ends_with(".webp")
    {
        PreviewCapability::PartialImageDecode
    } else if mime.starts_with("video/")
        || name.ends_with(".mp4")
        || name.ends_with(".mov")
        || name.ends_with(".mkv")
        || name.ends_with(".webm")
    {
        PreviewCapability::IndexedVideoSeek
    } else if mime == "application/pdf" || name.ends_with(".pdf") {
        PreviewCapability::PdfFirstPage
    } else {
        PreviewCapability::SmartIcon
    }
}
