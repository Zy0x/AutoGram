//! Source import/preflight owns one immutable account and profile snapshot.
use crate::{
    auth::engine,
    cloud_upload::{self, NativeCloudUpload, NativeUploadError},
};
use autogram_core::{
    telegram::{auth::AccountId, upload::transport::TelegramUploadTransport},
    transfer::{
        cloud_upload::*, scoped_profiles::ScopedTransferProfile, FrozenTransferProfile,
        PresentationOverride,
    },
};
use std::path::Path;
use tokio_util::sync::CancellationToken;

#[derive(Clone, uniffi::Record)]
pub struct NativeUploadInput {
    pub operation_id: String,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i32>,
    pub staged_path: String,
    pub filename: String,
    pub mime_type: String,
    pub caption: String,
}
pub(super) enum ProfileChoice {
    LegacyDocument { silent: bool, spoiler: bool },
    Selected { profile_id: Option<String> },
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn enqueue_profiled_cloud_upload(
    input: NativeUploadInput,
    profile_id: Option<String>,
) -> Result<NativeCloudUpload, NativeUploadError> {
    enqueue(input, ProfileChoice::Selected { profile_id }).await
}
pub(super) async fn enqueue(
    input: NativeUploadInput,
    choice: ProfileChoice,
) -> Result<NativeCloudUpload, NativeUploadError> {
    let prepared = prepare(input, choice).await?;
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    auth.commit_selected_job(&prepared.account, prepared.selected_revision, || {
        Ok(cloud_upload::record(
            cloud_upload::store()?.enqueue(prepared.request)?,
        ))
    })
}
pub(super) struct PreparedUpload {
    pub request: UploadRequest,
    pub selected_revision: u64,
    pub account: AccountId,
}
pub(super) async fn prepare(
    input: NativeUploadInput,
    choice: ProfileChoice,
) -> Result<PreparedUpload, NativeUploadError> {
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    let account = AccountId(input.account_id.clone());
    auth.validate_selected_account(&account).await?;
    let selected_revision = auth.selected_job_revision();
    let destination = cloud_upload::destination(
        cloud_upload::scope(input.account_id)?,
        &input.peer_id,
        input.topic_id,
    )?;
    let existing = match cloud_upload::store()?.get(&input.operation_id, &destination.scope) {
        Ok(value) => Some(value.request),
        Err(UploadError::NotFound) => cloud_upload::store()?
            .get_reuse(&input.operation_id, &destination.scope)?
            .map(|value| value.request),
        Err(error) => return Err(error.into()),
    };
    let (profile, profile_binding) = resolve_profile(existing.as_ref(), choice, |id| {
        let store = crate::transfer_profiles::store()
            .map_err(|_| cloud_upload::error("profile_database"))?;
        match id {
            Some(id) => store
                .get(&destination.scope, id)
                .map_err(|e| cloud_upload::error(&e.to_string())),
            None => store
                .active(&destination.scope)
                .map_err(|e| cloud_upload::error(&e.to_string()))?
                .ok_or_else(|| cloud_upload::error("profile_not_selected")),
        }
    })?;
    validate_document_profile(&profile)?;
    let path = cloud_upload::staging_source(
        &cloud_upload::staging_root()?,
        Path::new(&input.staged_path),
    )?;
    let hash_cancel = cancel.clone();
    let source =
        tokio::task::spawn_blocking(move || snapshot_upload_file_cancellable(&path, &hash_cancel))
            .await
            .map_err(|_| cloud_upload::error("io"))??;
    let random_id = existing.map(|r| r.random_id).unwrap_or_else(|| loop {
        let bytes = *uuid::Uuid::new_v4().as_bytes();
        let value = i64::from_le_bytes(bytes[..8].try_into().unwrap());
        if value != 0 {
            break value;
        }
    });
    let request = UploadRequest {
        operation_id: input.operation_id,
        destination,
        source,
        filename: input.filename,
        mime_type: input.mime_type,
        caption: input.caption,
        profile,
        profile_binding,
        random_id,
    };
    request.validate()?;
    let transport =
        TelegramUploadTransport::connect(auth, request.destination.scope.clone(), cancel.clone())
            .await?;
    transport.limits().await?.validate(&request)?;
    transport.validate_destination(&request.destination).await?;
    if cancel.is_cancelled() {
        return Err(UploadError::Cancelled.into());
    }
    Ok(PreparedUpload {
        request,
        selected_revision,
        account,
    })
}
fn resolve_profile(
    existing: Option<&UploadRequest>,
    choice: ProfileChoice,
    load: impl FnOnce(Option<&str>) -> Result<ScopedTransferProfile, NativeUploadError>,
) -> Result<(FrozenTransferProfile, Option<UploadProfileBinding>), NativeUploadError> {
    if let Some(saved) = existing {
        let mut profile = saved.profile.clone();
        match choice {
            ProfileChoice::Selected {
                profile_id: Some(id),
            } if saved
                .profile_binding
                .as_ref()
                .map(|b| b.profile_id.as_str())
                != Some(id.as_str()) =>
            {
                return Err(UploadError::Conflict.into())
            }
            ProfileChoice::LegacyDocument { silent, spoiler } => {
                profile.silent = silent;
                profile.spoiler = spoiler;
            }
            _ => {}
        }
        return Ok((profile, saved.profile_binding.clone()));
    }
    match choice {
        ProfileChoice::LegacyDocument { silent, spoiler } => {
            let mut profile = FrozenTransferProfile::default();
            profile.presentation_override = PresentationOverride::ForceDocument;
            profile.group_as_album = false;
            profile.group_documents = false;
            profile.silent = silent;
            profile.spoiler = spoiler;
            Ok((profile, None))
        }
        ProfileChoice::Selected { profile_id } => {
            let selected = load(profile_id.as_deref())?;
            Ok((
                selected.config,
                Some(UploadProfileBinding {
                    profile_id: selected.profile_id,
                    revision: selected.revision,
                }),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use autogram_core::transfer::cloud_download::{AccountScope, PeerKind};
    fn selected() -> ScopedTransferProfile {
        let mut config = FrozenTransferProfile::default();
        config.profile_name = "Fixture profile".into();
        config.presentation_override = PresentationOverride::ForceDocument;
        config.group_as_album = false;
        config.group_documents = false;
        config.silent = true;
        config.upload_concurrency = 7;
        ScopedTransferProfile {
            scope: AccountScope::new("tg_77".into(), 77).unwrap(),
            profile_id: "fixture-profile".into(),
            revision: 11,
            active: true,
            config,
        }
    }
    fn saved(
        profile: FrozenTransferProfile,
        binding: Option<UploadProfileBinding>,
    ) -> UploadRequest {
        UploadRequest {
            operation_id: "fixture-operation".into(),
            destination: UploadDestination {
                scope: AccountScope::new("tg_77".into(), 77).unwrap(),
                peer_kind: PeerKind::Channel,
                peer_id: 321,
                topic_id: Some(17),
            },
            source: UploadFileSnapshot {
                path: std::env::temp_dir().join("profile-policy-fixture.staged"),
                size: 1,
                sha256: "0".repeat(64),
                md5: "0".repeat(32),
                part_sha256: vec!["0".repeat(64)],
            },
            filename: "fixture.txt".into(),
            mime_type: "text/plain".into(),
            caption: String::new(),
            profile,
            profile_binding: binding,
            random_id: 991,
        }
    }
    #[test]
    fn new_operation_preserves_selected_profile_flags_and_exact_revision() {
        let expected = selected();
        let (config, binding) =
            resolve_profile(None, ProfileChoice::Selected { profile_id: None }, |id| {
                assert!(id.is_none());
                Ok(expected.clone())
            })
            .unwrap();
        assert_eq!(config, expected.config);
        assert_eq!(
            binding,
            Some(UploadProfileBinding {
                profile_id: expected.profile_id,
                revision: 11
            })
        );
    }
    #[test]
    fn existing_operation_never_reloads_changed_or_deleted_profile() {
        let (config, binding) =
            resolve_profile(None, ProfileChoice::Selected { profile_id: None }, |_| {
                Ok(selected())
            })
            .unwrap();
        let request = saved(config.clone(), binding.clone());
        for profile_id in [None, Some("fixture-profile".into())] {
            let resolved = resolve_profile(
                Some(&request),
                ProfileChoice::Selected { profile_id },
                |_| panic!("retry must retain saved snapshot"),
            )
            .unwrap();
            assert_eq!(resolved, (config.clone(), binding.clone()));
        }
        assert!(
            matches!(resolve_profile(Some(&request),ProfileChoice::Selected{profile_id:Some("different-profile".into())},
            |_|panic!("conflict must be local")),Err(NativeUploadError::RequestFailed{code,..}) if code=="operation_conflict")
        );
    }
    #[test]
    fn unsupported_active_media_profile_is_preserved_and_rejected_without_document_coercion() {
        let mut media = selected();
        media.config = FrozenTransferProfile::default();
        let (config, _) =
            resolve_profile(None, ProfileChoice::Selected { profile_id: None }, |_| {
                Ok(media.clone())
            })
            .unwrap();
        assert_eq!(config, media.config);
        assert_eq!(
            validate_document_profile(&config).unwrap_err(),
            UploadError::UnsupportedProfile
        );
        let (legacy, binding) = resolve_profile(
            None,
            ProfileChoice::LegacyDocument {
                silent: false,
                spoiler: true,
            },
            |_| panic!("legacy explicit document mode must not read active profile"),
        )
        .unwrap();
        validate_document_profile(&legacy).unwrap();
        assert!(legacy.spoiler);
        assert!(!legacy.silent);
        assert!(binding.is_none());
        let json = serde_json::to_value(saved(legacy, None)).unwrap();
        assert!(json.get("profile_binding").is_none());
    }
}
