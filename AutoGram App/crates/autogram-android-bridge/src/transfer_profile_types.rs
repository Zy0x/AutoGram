//! Typed UniFFI profile values mirror the shared frozen profile; no JSON UI contract.
use autogram_core::transfer::scoped_profiles::{
    validate_profile, ProfileError, ScopedTransferProfile,
};
use autogram_core::transfer::*;

macro_rules! native_enum {
    ($native:ident, $core:ty, [$($variant:ident),+]) => {
        #[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
        pub enum $native { $($variant),+ }
        impl From<$core> for $native {
            fn from(value: $core) -> Self { match value { $(<$core>::$variant => Self::$variant),+ } }
        }
        impl From<$native> for $core {
            fn from(value: $native) -> Self { match value { $($native::$variant => Self::$variant),+ } }
        }
    }
}
native_enum!(
    NativePresentationMode,
    PresentationOverride,
    [Automatic, ForceDocument, ForceNativeMedia]
);
native_enum!(
    NativeAlbumPacking,
    AlbumPackingPolicy,
    [
        SmartAdaptive,
        Maximum,
        Balanced,
        Custom,
        FollowSelection,
        Never
    ]
);
native_enum!(
    NativeAlbumFailure,
    AlbumFailurePolicy,
    [
        AtomicStrict,
        RetryPrepare,
        ReplanGroup,
        SendRemaining,
        SendFailedSeparately,
        CancelGroup,
        BestEffortAdvanced
    ]
);
native_enum!(
    NativeOversizeAction,
    OversizeAction,
    [Split, AlternateAccount, Skip]
);
native_enum!(
    NativeEncoderStrategy,
    EncoderStrategy,
    [
        AutoAdaptive,
        HardwarePreferred,
        SoftwarePreferred,
        HardwareOnly,
        SoftwareOnly,
        SpecificDevice,
        DisableReencode
    ]
);
native_enum!(
    NativeEncoderResources,
    EncoderResourceProfile,
    [Eco, Balanced, Performance, Custom]
);
native_enum!(
    NativeQualityMode,
    QualityMode,
    [HighQuality, Smart, Original, Document]
);

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct NativeEncoderSettings {
    pub strategy: NativeEncoderStrategy,
    pub resources: NativeEncoderResources,
    pub specific_device: Option<String>,
    pub max_parallel_encodes: u32,
    pub max_cpu_percent: u8,
    pub max_memory_mb: u32,
    pub allow_software_fallback: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct NativeTransferSettings {
    pub name: String,
    pub quality_mode: NativeQualityMode,
    pub presentation: NativePresentationMode,
    pub upload_concurrency: u32,
    pub download_concurrency: u32,
    pub group_as_album: bool,
    pub album_packing: NativeAlbumPacking,
    pub album_group_size: u32,
    pub album_avoid_single: bool,
    pub album_failure: NativeAlbumFailure,
    pub group_documents: bool,
    pub group_audio: bool,
    pub group_original_documents: bool,
    pub oversize_action: NativeOversizeAction,
    pub encoder: NativeEncoderSettings,
    pub silent: bool,
    pub spoiler: bool,
}
impl NativeTransferSettings {
    pub(super) fn into_core(self) -> Result<FrozenTransferProfile, ProfileError> {
        let quality_mode = match self.quality_mode {
            NativeQualityMode::HighQuality => "HIGH_QUALITY",
            NativeQualityMode::Smart => "SMART",
            NativeQualityMode::Original => "ORIGINAL",
            NativeQualityMode::Document => "DOCUMENT",
        }
        .into();
        let config = FrozenTransferProfile {
            schema_version: 1,
            profile_name: self.name,
            quality_mode,
            presentation_override: self.presentation.into(),
            upload_concurrency: self.upload_concurrency as usize,
            download_concurrency: self.download_concurrency as usize,
            group_as_album: self.group_as_album,
            album_packing: self.album_packing.into(),
            album_group_size: self.album_group_size as usize,
            album_avoid_single: self.album_avoid_single,
            album_failure_policy: self.album_failure.into(),
            group_documents: self.group_documents,
            group_audio: self.group_audio,
            group_original_documents: self.group_original_documents,
            oversize_action: self.oversize_action.into(),
            encoder: EncoderPolicy {
                strategy: self.encoder.strategy.into(),
                resource_profile: self.encoder.resources.into(),
                specific_device: self.encoder.specific_device,
                max_parallel_encodes: self.encoder.max_parallel_encodes as usize,
                max_cpu_percent: self.encoder.max_cpu_percent,
                max_memory_mb: self.encoder.max_memory_mb,
                allow_software_fallback: self.encoder.allow_software_fallback,
            },
            silent: self.silent,
            spoiler: self.spoiler,
        };
        validate_profile(&config)?;
        Ok(config)
    }
    pub(super) fn from_core(value: FrozenTransferProfile) -> Result<Self, ProfileError> {
        validate_profile(&value)?;
        Ok(Self {
            name: value.profile_name,
            quality_mode: QualityMode::parse(Some(&value.quality_mode)).into(),
            presentation: value.presentation_override.into(),
            upload_concurrency: value.upload_concurrency as u32,
            download_concurrency: value.download_concurrency as u32,
            group_as_album: value.group_as_album,
            album_packing: value.album_packing.into(),
            album_group_size: value.album_group_size as u32,
            album_avoid_single: value.album_avoid_single,
            album_failure: value.album_failure_policy.into(),
            group_documents: value.group_documents,
            group_audio: value.group_audio,
            group_original_documents: value.group_original_documents,
            oversize_action: value.oversize_action.into(),
            encoder: NativeEncoderSettings {
                strategy: value.encoder.strategy.into(),
                resources: value.encoder.resource_profile.into(),
                specific_device: value.encoder.specific_device,
                max_parallel_encodes: value.encoder.max_parallel_encodes as u32,
                max_cpu_percent: value.encoder.max_cpu_percent,
                max_memory_mb: value.encoder.max_memory_mb,
                allow_software_fallback: value.encoder.allow_software_fallback,
            },
            silent: value.silent,
            spoiler: value.spoiler,
        })
    }
}
#[derive(Debug, Clone, uniffi::Record)]
pub struct NativeTransferProfile {
    pub account_id: String,
    pub profile_id: String,
    pub revision: i64,
    pub active: bool,
    pub settings: NativeTransferSettings,
}
impl NativeTransferProfile {
    pub(super) fn from_core(value: ScopedTransferProfile) -> Result<Self, ProfileError> {
        Ok(Self {
            account_id: value.scope.account_id().into(),
            profile_id: value.profile_id,
            revision: value.revision,
            active: value.active,
            settings: NativeTransferSettings::from_core(value.config)?,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typed_roundtrip_preserves_nondefault_profile_without_dropping_delivery_or_encoder_policy() {
        let mut core = FrozenTransferProfile::default();
        core.profile_name = "Fixture profile".into();
        core.quality_mode = "DOCUMENT".into();
        core.presentation_override = PresentationOverride::ForceDocument;
        core.silent = true;
        core.spoiler = true;
        core.upload_concurrency = 7;
        core.album_packing = AlbumPackingPolicy::Custom;
        core.album_group_size = 8;
        core.album_failure_policy = AlbumFailurePolicy::SendFailedSeparately;
        core.oversize_action = OversizeAction::Skip;
        core.encoder.strategy = EncoderStrategy::SpecificDevice;
        core.encoder.specific_device = Some("fixture-codec".into());
        let result = NativeTransferSettings::from_core(core.clone())
            .unwrap()
            .into_core()
            .unwrap();
        assert_eq!(result, core);
    }
    #[test]
    fn typed_out_of_bounds_configuration_is_rejected() {
        let mut value =
            NativeTransferSettings::from_core(FrozenTransferProfile::default()).unwrap();
        value.upload_concurrency = u32::MAX;
        assert_eq!(value.into_core().unwrap_err(), ProfileError::InvalidProfile);
    }
}
