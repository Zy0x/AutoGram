use super::{AlbumFailurePolicy, AlbumPackingPolicy, EncoderPolicy, OversizeAction};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationOverride {
    Automatic,
    ForceDocument,
    ForceNativeMedia,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenTransferProfile {
    pub schema_version: u32,
    pub profile_name: String,
    pub quality_mode: String,
    pub presentation_override: PresentationOverride,
    pub upload_concurrency: usize,
    pub download_concurrency: usize,
    pub group_as_album: bool,
    pub album_packing: AlbumPackingPolicy,
    pub album_group_size: usize,
    pub album_avoid_single: bool,
    pub album_failure_policy: AlbumFailurePolicy,
    pub group_documents: bool,
    pub group_audio: bool,
    pub group_original_documents: bool,
    pub oversize_action: OversizeAction,
    pub encoder: EncoderPolicy,
    pub silent: bool,
    pub spoiler: bool,
}

impl Default for FrozenTransferProfile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            profile_name: "default".into(),
            quality_mode: "SMART".into(),
            presentation_override: PresentationOverride::Automatic,
            upload_concurrency: 2,
            download_concurrency: 3,
            group_as_album: true,
            album_packing: AlbumPackingPolicy::SmartAdaptive,
            album_group_size: 10,
            album_avoid_single: true,
            album_failure_policy: AlbumFailurePolicy::AtomicStrict,
            group_documents: true,
            group_audio: true,
            group_original_documents: true,
            oversize_action: OversizeAction::Split,
            encoder: EncoderPolicy::default(),
            silent: false,
            spoiler: false,
        }
    }
}
