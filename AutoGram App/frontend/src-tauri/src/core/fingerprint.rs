use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaFingerprint {
    pub media_type: String,      // "document"|"photo"|"video"|"audio"|"voice"|"unknown"
    pub tier: u8,                // 1(best)..4(fallback)
    pub primary_hash: Option<String>,
    pub secondary_hashes: Vec<String>,
    pub file_unique_id: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration: Option<i32>,   // seconds
    pub mime_type: Option<String>,
    pub sha256: Option<String>,  // local file sha256 (upload only)
}

impl MediaFingerprint {
    pub fn hash_str(s: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(s.as_bytes());
        let result = hasher.finalize();
        let hex_str = hex::encode(result);
        hex_str[..32].to_string()
    }

    pub fn from_local_file(
        file_name: &str,
        file_size: i64,
        sha256: Option<&str>,
        media_type: &str,
    ) -> MediaFingerprint {
        let name_lower = file_name.to_lowercase();
        if let Some(h) = sha256 {
            MediaFingerprint {
                media_type: media_type.to_string(),
                tier: 1,
                primary_hash: Some(format!("sha256:{}", h)),
                secondary_hashes: vec![Self::hash_str(&format!("doc:{}:{}", name_lower, file_size))],
                file_name: Some(file_name.to_string()),
                file_size: Some(file_size),
                sha256: Some(h.to_string()),
                ..Default::default()
            }
        } else {
            MediaFingerprint {
                media_type: media_type.to_string(),
                tier: 2,
                primary_hash: Some(Self::hash_str(&format!("doc:{}:{}", name_lower, file_size))),
                secondary_hashes: vec![],
                file_name: Some(file_name.to_string()),
                file_size: Some(file_size),
                ..Default::default()
            }
        }
    }

    pub fn from_fields(
        media_type: &str,
        file_unique_id: Option<&str>,
        file_name: Option<&str>,
        file_size: Option<i64>,
        width: Option<i32>,
        height: Option<i32>,
        duration: Option<i32>,
        mime_type: Option<&str>,
    ) -> MediaFingerprint {
        let mut fp = MediaFingerprint {
            media_type: media_type.to_string(),
            file_unique_id: file_unique_id.map(|s| s.to_string()),
            file_name: file_name.map(|s| s.to_string()),
            file_size,
            width,
            height,
            duration,
            mime_type: mime_type.map(|s| s.to_string()),
            ..Default::default()
        };

        match media_type {
            "photo" => {
                if let (Some(fuid), Some(w), Some(h)) = (file_unique_id, width, height) {
                    fp.tier = 1;
                    fp.primary_hash = Some(Self::hash_str(&format!("photo:{}:{}x{}", fuid, w, h)));
                    fp.secondary_hashes = vec![Self::hash_str(&format!("photo:{}", fuid))];
                } else if let Some(fuid) = file_unique_id {
                    fp.tier = 2;
                    fp.primary_hash = Some(Self::hash_str(&format!("photo:{}", fuid)));
                } else {
                    fp.tier = 4;
                }
            }
            "video" | "audio" | "voice" => {
                if let (Some(fuid), Some(dur), Some(sz)) = (file_unique_id, duration, file_size) {
                    fp.tier = 1;
                    fp.primary_hash = Some(Self::hash_str(&format!("{}:{}:{}:{}", media_type, fuid, dur, sz)));
                    fp.secondary_hashes = vec![Self::hash_str(&format!("{}:{}", media_type, fuid))];
                } else if let Some(fuid) = file_unique_id {
                    fp.tier = 2;
                    fp.primary_hash = Some(Self::hash_str(&format!("{}:{}", media_type, fuid)));
                } else {
                    fp.tier = 4;
                }
            }
            _ => {
                // document
                if let (Some(name), Some(sz)) = (file_name, file_size) {
                    fp.tier = 1;
                    let name_lower = name.to_lowercase();
                    fp.primary_hash = Some(Self::hash_str(&format!("doc:{}:{}", name_lower, sz)));
                    if let Some(fuid) = file_unique_id {
                        fp.secondary_hashes = vec![Self::hash_str(&format!("doc_uid:{}", fuid))];
                    }
                } else if let Some(fuid) = file_unique_id {
                    fp.tier = 2;
                    fp.primary_hash = Some(Self::hash_str(&format!("doc_uid:{}", fuid)));
                } else {
                    fp.tier = 4;
                }
            }
        }
        fp
    }

    pub fn match_fingerprints(source: &MediaFingerprint, dest: &MediaFingerprint, strict: bool) -> (bool, f32) {
        if source.primary_hash.is_some() && source.primary_hash == dest.primary_hash {
            let score = if source.tier == 1 { 0.99 } else { 0.90 };
            return (true, score);
        }

        if !strict {
            if let (Some(s_sha), Some(d_sha)) = (&source.sha256, &dest.sha256) {
                if s_sha == d_sha {
                    return (true, 0.99);
                }
            }

            for s_hash in &source.secondary_hashes {
                if dest.secondary_hashes.contains(s_hash) || (dest.primary_hash.is_some() && dest.primary_hash.as_ref() == Some(s_hash)) {
                    return (true, 0.87);
                }
            }
            for d_hash in &dest.secondary_hashes {
                if source.secondary_hashes.contains(d_hash) || (source.primary_hash.is_some() && source.primary_hash.as_ref() == Some(d_hash)) {
                    return (true, 0.87);
                }
            }

            if source.media_type == "photo" && dest.media_type == "photo" {
                if let (Some(s_fuid), Some(d_fuid)) = (&source.file_unique_id, &dest.file_unique_id) {
                    if s_fuid == d_fuid {
                        if let (Some(sw), Some(sh), Some(dw), Some(dh)) = (source.width, source.height, dest.width, dest.height) {
                            if (sw - dw).abs() <= 10 && (sh - dh).abs() <= 10 {
                                return (true, 0.85);
                            }
                        }
                        return (true, 0.80);
                    }
                }
            }

            if (source.media_type == "document" || source.media_type == "unknown") 
                && (dest.media_type == "document" || dest.media_type == "unknown") {
                if let (Some(s_name), Some(d_name), Some(s_size), Some(d_size)) = (&source.file_name, &dest.file_name, source.file_size, dest.file_size) {
                    if s_name.to_lowercase() == d_name.to_lowercase() {
                        let size_diff = (s_size - d_size).abs() as f64;
                        let max_size = std::cmp::max(s_size, d_size) as f64;
                        if max_size > 0.0 && (size_diff / max_size) <= 0.05 {
                            return (true, 0.85);
                        }
                    }
                }
            }
        }

        (false, 0.0)
    }
}
