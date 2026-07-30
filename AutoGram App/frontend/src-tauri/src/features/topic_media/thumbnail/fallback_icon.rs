//! Extension and MIME type SVG icon fallback mapper.

pub fn get_smart_icon_name(mime_type: Option<&str>, file_name: &str) -> &'static str {
    let mime = mime_type.unwrap_or("").to_lowercase();
    let name = file_name.to_lowercase();

    if mime.starts_with("video/") || name.ends_with(".mp4") || name.ends_with(".mkv") {
        "video"
    } else if mime.starts_with("audio/") || name.ends_with(".mp3") || name.ends_with(".flac") {
        "audio"
    } else if mime.starts_with("image/") || name.ends_with(".png") || name.ends_with(".jpg") {
        "image"
    } else if mime == "application/pdf" || name.ends_with(".pdf") {
        "pdf"
    } else if name.ends_with(".zip") || name.ends_with(".rar") || name.ends_with(".7z") {
        "archive"
    } else if name.ends_with(".exe") || name.ends_with(".msi") || name.ends_with(".apk") {
        "binary"
    } else if name.ends_with(".url") || mime == "text/html" {
        "link"
    } else {
        "document"
    }
}
