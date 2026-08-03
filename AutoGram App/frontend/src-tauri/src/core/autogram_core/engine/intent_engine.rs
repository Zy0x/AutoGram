//! User Intent Classification Engine
//! Categorizes files/batches into Media Album Intent vs Cold Storage Archive Intent.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UserIntent {
    MediaAlbum,
    ColdStorageArchive,
    GeneralDocument,
}

pub fn classify_user_intent(filename: &str, mime_type: Option<&str>) -> UserIntent {
    let lower_name = filename.to_lowercase();

    if lower_name.ends_with(".zip")
        || lower_name.ends_with(".tar.gz")
        || lower_name.ends_with(".7z")
        || lower_name.ends_with(".rar")
        || lower_name.ends_with(".iso")
        || lower_name.contains("cctv")
        || lower_name.contains("backup")
    {
        UserIntent::ColdStorageArchive
    } else if let Some(mime) = mime_type {
        if mime.starts_with("image/") || mime.starts_with("video/") {
            UserIntent::MediaAlbum
        } else {
            UserIntent::GeneralDocument
        }
    } else if lower_name.ends_with(".mp4")
        || lower_name.ends_with(".mkv")
        || lower_name.ends_with(".jpg")
        || lower_name.ends_with(".png")
        || lower_name.ends_with(".mov")
    {
        UserIntent::MediaAlbum
    } else {
        UserIntent::GeneralDocument
    }
}
