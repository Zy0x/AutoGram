//! File Segmentation & Split Engine

pub mod binary_volume_split;
pub mod manifest_builder;
pub mod video_segment_split;

pub use binary_volume_split::{split_binary_volume, BinaryVolumePart};
pub use manifest_builder::{AutoGramSplitManifest, ManifestPartInfo, ManifestV28, MergeCommands};
pub use video_segment_split::{split_video_segments, VideoSegment};

#[derive(Debug)]
pub struct BinarySplitBundle {
    pub parts: Vec<BinaryVolumePart>,
    pub manifest: AutoGramSplitManifest,
    pub manifest_path: std::path::PathBuf,
}

pub fn split_with_public_manifest(
    input: &std::path::Path,
    output_dir: &std::path::Path,
    max_part_bytes: u64,
) -> Result<BinarySplitBundle, String> {
    let parts = split_binary_volume(input, output_dir, max_part_bytes)?;
    if parts.len() < 2 {
        return Err("split requested but input produced fewer than two parts".into());
    }
    let manifest = AutoGramSplitManifest::from_parts(input, max_part_bytes, &parts)?;
    let filename = input
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file.bin");
    let manifest_path = output_dir.join(format!("{filename}.autogram-manifest.json"));
    manifest.write_to(&manifest_path)?;
    Ok(BinarySplitBundle {
        parts,
        manifest,
        manifest_path,
    })
}
