use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

use super::{classify_media, MediaCategory};

pub const ANALYSIS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamAnalysis {
    pub index: u32,
    pub codec_type: String,
    pub codec_name: String,
    pub pixel_format: Option<String>,
    pub profile: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub color_transfer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAnalysis {
    pub schema_version: u32,
    pub category: MediaCategory,
    pub format_name: Option<String>,
    pub duration_seconds: Option<f64>,
    pub streams: Vec<StreamAnalysis>,
    pub probe_available: bool,
    pub probe_error: Option<String>,
}

#[derive(Deserialize)]
struct ProbeRoot {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeStream {
    index: Option<u32>,
    codec_type: Option<String>,
    codec_name: Option<String>,
    pix_fmt: Option<String>,
    profile: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    color_transfer: Option<String>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

fn ffprobe_path() -> Option<PathBuf> {
    if let Some(ffprobe) = crate::platform::find_ffprobe_binary() {
        return Some(ffprobe);
    }
    if let Some(ffmpeg) = crate::platform::find_ffmpeg_binary() {
        if let Some(parent) = ffmpeg.parent() {
            let candidate = parent.join(if cfg!(windows) {
                "ffprobe.exe"
            } else {
                "ffprobe"
            });
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let full = if cfg!(windows) {
            dir.join("ffprobe.exe")
        } else {
            dir.join("ffprobe")
        };
        if full.is_file() {
            return Some(full);
        }
    }
    None
}

fn analyze_media_uncached(path: &Path) -> MediaAnalysis {
    let category = classify_media(path);
    let Some(ffprobe) = ffprobe_path() else {
        return MediaAnalysis {
            schema_version: ANALYSIS_SCHEMA_VERSION,
            category,
            format_name: None,
            duration_seconds: None,
            streams: Vec::new(),
            probe_available: false,
            probe_error: Some("ffprobe_unavailable".into()),
        };
    };
    let mut command = Command::new(ffprobe);
    command.args([
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
    ]);
    command.arg(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = match command.output() {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return MediaAnalysis {
                schema_version: ANALYSIS_SCHEMA_VERSION,
                category,
                format_name: None,
                duration_seconds: None,
                streams: Vec::new(),
                probe_available: true,
                probe_error: Some(format!("ffprobe_exit_{}", output.status)),
            }
        }
        Err(error) => {
            return MediaAnalysis {
                schema_version: ANALYSIS_SCHEMA_VERSION,
                category,
                format_name: None,
                duration_seconds: None,
                streams: Vec::new(),
                probe_available: true,
                probe_error: Some(format!("ffprobe_spawn:{error}")),
            }
        }
    };
    match serde_json::from_slice::<ProbeRoot>(&output.stdout) {
        Ok(probe) => MediaAnalysis {
            schema_version: ANALYSIS_SCHEMA_VERSION,
            category,
            format_name: probe
                .format
                .as_ref()
                .and_then(|format| format.format_name.clone()),
            duration_seconds: probe
                .format
                .and_then(|format| format.duration)
                .and_then(|value| value.parse().ok()),
            streams: probe
                .streams
                .into_iter()
                .map(|stream| StreamAnalysis {
                    index: stream.index.unwrap_or(0),
                    codec_type: stream.codec_type.unwrap_or_else(|| "unknown".into()),
                    codec_name: stream.codec_name.unwrap_or_else(|| "unknown".into()),
                    pixel_format: stream.pix_fmt,
                    profile: stream.profile,
                    width: stream.width,
                    height: stream.height,
                    color_transfer: stream.color_transfer,
                })
                .collect(),
            probe_available: true,
            probe_error: None,
        },
        Err(error) => MediaAnalysis {
            schema_version: ANALYSIS_SCHEMA_VERSION,
            category,
            format_name: None,
            duration_seconds: None,
            streams: Vec::new(),
            probe_available: true,
            probe_error: Some(format!("ffprobe_json:{error}")),
        },
    }
}

pub fn analysis_cache_key(path: &Path) -> (String, u64, i64) {
    let metadata = std::fs::metadata(path).ok();
    let source_size = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
    let source_mtime_ms = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let identity = format!(
        "{}|{source_size}|{source_mtime_ms}|probe:{}|v{ANALYSIS_SCHEMA_VERSION}",
        canonical.display(),
        ffprobe_path().is_some()
    );
    (
        super::sha256_bytes(identity.as_bytes()),
        source_size,
        source_mtime_ms,
    )
}

pub fn analyze_media(path: &Path) -> MediaAnalysis {
    let (cache_key, source_size, source_mtime_ms) = analysis_cache_key(path);
    if let Ok(Some(cached)) = super::load_media_analysis::<MediaAnalysis>(
        &cache_key,
        ANALYSIS_SCHEMA_VERSION,
        source_size,
        source_mtime_ms,
    ) {
        return cached;
    }
    let analysis = analyze_media_uncached(path);
    let _ = super::persist_media_analysis(
        &cache_key,
        ANALYSIS_SCHEMA_VERSION,
        source_size,
        source_mtime_ms,
        &analysis,
    );
    analysis
}

impl MediaAnalysis {
    pub fn video_codec(&self) -> Option<&str> {
        self.streams
            .iter()
            .find(|stream| stream.codec_type == "video")
            .map(|stream| stream.codec_name.as_str())
    }

    pub fn audio_codecs(&self) -> Vec<&str> {
        self.streams
            .iter()
            .filter(|stream| stream.codec_type == "audio")
            .map(|stream| stream.codec_name.as_str())
            .collect()
    }

    pub fn subtitle_codecs(&self) -> Vec<&str> {
        self.streams
            .iter()
            .filter(|stream| stream.codec_type == "subtitle")
            .map(|stream| stream.codec_name.as_str())
            .collect()
    }

    pub fn is_validated_native_video(&self) -> bool {
        if self.category != MediaCategory::Mp4Video {
            return false;
        }
        if self.probe_error.is_some() || self.streams.is_empty() {
            return true;
        }
        let Some(video) = self
            .streams
            .iter()
            .find(|stream| stream.codec_type == "video")
        else {
            return true;
        };
        matches!(video.codec_name.as_str(), "h264" | "avc1")
            && video
                .pixel_format
                .as_deref()
                .is_none_or(|format| matches!(format, "yuv420p" | "yuvj420p"))
            && self
                .audio_codecs()
                .iter()
                .all(|codec| matches!(*codec, "aac" | "mp3"))
            && self.subtitle_codecs().is_empty()
    }

    pub fn lossless_mp4_remux_feasible(&self) -> bool {
        self.probe_error.is_none()
            && matches!(self.video_codec(), Some("h264" | "avc1"))
            && self
                .audio_codecs()
                .iter()
                .all(|codec| matches!(*codec, "aac" | "mp3"))
            && self.subtitle_codecs().is_empty()
    }

    pub fn is_hdr(&self) -> bool {
        self.streams.iter().any(|stream| {
            stream.codec_type == "video"
                && stream
                    .color_transfer
                    .as_deref()
                    .is_some_and(|transfer| matches!(transfer, "smpte2084" | "arib-std-b67"))
        })
    }

    pub fn has_preservation_sensitive_streams(&self) -> bool {
        !self.subtitle_codecs().is_empty()
            || self.audio_codecs().len() > 1
            || self
                .streams
                .iter()
                .any(|stream| !matches!(stream.codec_type.as_str(), "video" | "audio"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analysis(video: &str, audio: &[&str], subtitles: &[&str]) -> MediaAnalysis {
        let mut streams = vec![StreamAnalysis {
            index: 0,
            codec_type: "video".into(),
            codec_name: video.into(),
            pixel_format: Some("yuv420p".into()),
            profile: None,
            width: Some(1920),
            height: Some(1080),
            color_transfer: None,
        }];
        streams.extend(
            audio
                .iter()
                .enumerate()
                .map(|(index, codec)| StreamAnalysis {
                    index: index as u32 + 1,
                    codec_type: "audio".into(),
                    codec_name: (*codec).into(),
                    pixel_format: None,
                    profile: None,
                    width: None,
                    height: None,
                    color_transfer: None,
                }),
        );
        streams.extend(
            subtitles
                .iter()
                .enumerate()
                .map(|(index, codec)| StreamAnalysis {
                    index: index as u32 + 10,
                    codec_type: "subtitle".into(),
                    codec_name: (*codec).into(),
                    pixel_format: None,
                    profile: None,
                    width: None,
                    height: None,
                    color_transfer: None,
                }),
        );
        MediaAnalysis {
            schema_version: 1,
            category: MediaCategory::Mp4Video,
            format_name: Some("mov,mp4".into()),
            duration_seconds: Some(10.0),
            streams,
            probe_available: true,
            probe_error: None,
        }
    }

    #[test]
    fn native_video_requires_validated_h264_compatible_streams() {
        assert!(analysis("h264", &["aac"], &[]).is_validated_native_video());
        assert!(!analysis("av1", &["aac"], &[]).is_validated_native_video());
        assert!(!analysis("h264", &["flac"], &[]).is_validated_native_video());
        assert!(!analysis("h264", &["aac"], &["ass"]).is_validated_native_video());
    }
}
