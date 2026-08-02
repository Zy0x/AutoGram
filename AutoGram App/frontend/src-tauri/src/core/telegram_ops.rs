//! Telegram backend abstraction — dual-path Telethon companion + Grammers.
//!
//! Runtime selection (`AUTOGRAM_TELEGRAM_BACKEND`):
//! - `telethon` / default → Python Telethon companion (Drive/stream/migration full)
//! - `grammers` → Rust Grammers for auth check, dialogs, upload
//!
//! Prefer exclusive session use: never open the same auth_key with both backends
//! at once (AUTH_KEY_DUPLICATED risk).

use serde::{Deserialize, Serialize};

use super::tg_error::{TgError, TgErrorCode, TgErrorPublic};
use super::tg_log;

/// High-level result of a single media upload step (backend-agnostic).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStepResult {
    pub status: String,
    pub message_id: Option<i64>,
    pub error: Option<String>,
    pub index: usize,
    #[serde(default)]
    pub backend: Option<String>,
}

/// Identity needed to open a Telegram client. Never log `api_hash`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramIdentity {
    pub session: String,
    pub api_id: i64,
    /// Opaque secret — keep out of logs and TransferRecord lists.
    pub api_hash: String,
}

impl TelegramIdentity {
    pub fn safe_label(&self) -> String {
        tg_log::session_label(&self.session)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: i64,
    pub first_name: Option<String>,
    pub username: Option<String>,
    pub photo_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub backend: String,
    pub authorized: bool,
    pub session: String,
    pub user: Option<UserProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogEntry {
    pub id: i64,
    pub title: String,
    pub is_user: bool,
    pub is_channel: bool,
    pub is_group: bool,
    /// True when peer is a forum (topics UI). Megagroup channels with forum flag.
    #[serde(default)]
    pub is_forum: bool,
}

/// Backend ownership label for capability / UI diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelegramBackendKind {
    /// Python Telethon companion (default for full Drive/Studio/migration).
    TelethonCompanion,
    /// Rust MTProto via grammers-client.
    Grammers,
}

impl TelegramBackendKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::TelethonCompanion => "telethon_companion",
            Self::Grammers => "grammers",
        }
    }
}

/// Resolve preferred MTProto backend for ops with Grammers parity.
///
/// Default: **Grammers** (Rust). Force Telethon with `AUTOGRAM_TELEGRAM_BACKEND=telethon`.
/// Drive progressive stream / migration still use Python Telethon regardless
/// until those modules are ported.
pub fn active_telegram_backend() -> TelegramBackendKind {
    TelegramBackendKind::Grammers
}

/// Persist preferred backend for this process (and child workers via env).
pub fn set_telegram_backend(kind: TelegramBackendKind) {
    let v = match kind {
        TelegramBackendKind::Grammers => "grammers",
        TelegramBackendKind::TelethonCompanion => "telethon",
    };
    std::env::set_var("AUTOGRAM_TELEGRAM_BACKEND", v);
    tg_log::info("router", "set_backend", format!("backend={v}"));
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub active: TelegramBackendKind,
    pub active_label: &'static str,
    pub grammers_compiled: bool,
    pub grammers_ops: Vec<&'static str>,
    pub telethon_ops: Vec<&'static str>,
    pub notes: Vec<&'static str>,
}

pub fn backend_status() -> BackendStatus {
    BackendStatus {
        active: active_telegram_backend(),
        active_label: active_telegram_backend().label(),
        grammers_compiled: true,
        grammers_ops: vec![
            "auth_status",
            "list_dialogs",
            "list_media",
            "list_topics",
            "thumbs_batch",
            "upload_file",
            "download_file",
            "preview_stream",
            "studio_orch_upload",
            "login",
            "import_telethon_session",
            "probe_session",
        ],
        telethon_ops: vec![],
        notes: vec![
            "FORCE: backend is Grammers (Rust) only — Telethon/Python runtime is disabled.",
            "Drive browse, CRUD, thumbs, topics, avatars, and progressive preview use Grammers.",
            "Studio upload/album use Grammers orch; Telethon studio-serve fallback is removed.",
            "Import legacy Telethon .session → .grammers.json once; runtime uses JSON only.",
            "Jobs/migration MTProto is being ported fully to Grammers (no Telethon companion).",
        ],
    }
}

/// Operations trait — implemented by Telethon companion bridge and Grammers.
pub trait TelegramOps: Send {
    fn backend_kind(&self) -> TelegramBackendKind;

    fn backend_label(&self) -> &'static str {
        self.backend_kind().label()
    }
}

#[derive(Debug, Default, Clone)]
pub struct TelethonCompanionOps;

impl TelegramOps for TelethonCompanionOps {
    fn backend_kind(&self) -> TelegramBackendKind {
        TelegramBackendKind::TelethonCompanion
    }
}

#[derive(Debug, Default, Clone)]
pub struct GrammersOps;

impl TelegramOps for GrammersOps {
    fn backend_kind(&self) -> TelegramBackendKind {
        TelegramBackendKind::Grammers
    }
}

pub fn active_ops() -> Box<dyn TelegramOps> {
    match active_telegram_backend() {
        TelegramBackendKind::Grammers => Box::new(GrammersOps),
        TelegramBackendKind::TelethonCompanion => Box::new(TelethonCompanionOps),
    }
}

// ── High-level dual-path entry points (used by Tauri commands) ─────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFileRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub path: String,
    pub caption: Option<String>,
    pub as_document: Option<bool>,
    pub silent: Option<bool>,
    pub index: Option<usize>,
    pub topic_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpResult<T: Serialize> {
    pub ok: bool,
    pub backend: String,
    pub data: Option<T>,
    pub error: Option<TgErrorPublic>,
    pub user_message: Option<String>,
}

pub fn ok_result<T: Serialize>(backend: &str, data: T) -> OpResult<T> {
    OpResult {
        ok: true,
        backend: backend.into(),
        data: Some(data),
        error: None,
        user_message: None,
    }
}

pub fn err_result<T: Serialize>(backend: &str, e: TgError) -> OpResult<T> {
    let user_message = Some(e.user_message());
    OpResult {
        ok: false,
        backend: backend.into(),
        data: None,
        error: Some(e.to_public()),
        user_message,
    }
}

pub fn sessions_dir_from_env() -> std::path::PathBuf {
    super::grammers_ops::resolve_sessions_dir(None)
}

pub fn tg_disconnect_session(session: String) -> OpResult<bool> {
    super::grammers_ops::disconnect_session_blocking(&session);
    ok_result("grammers", true)
}

pub fn tg_probe_session(session: String) -> super::grammers_ops::SessionProbeResult {
    let dir = sessions_dir_from_env();
    super::grammers_ops::probe_sessions_blocking(&dir, &session)
}

pub fn tg_list_sessions() -> Vec<super::grammers_ops::NativeSessionSummary> {
    super::grammers_ops::list_native_sessions(&sessions_dir_from_env())
}

pub fn tg_import_telethon_session(session: String) -> OpResult<String> {
    let dir = sessions_dir_from_env();
    match super::grammers_ops::import_session_blocking(&dir, &session) {
        Ok(()) => ok_result(
            "grammers",
            format!("imported {session} → .grammers.session"),
        ),
        Err(e) => {
            tg_log::error("grammers", "import", e.to_string());
            err_result("grammers", e)
        }
    }
}

pub fn tg_auth_status(identity: TelegramIdentity) -> OpResult<AuthStatus> {
    let dir = sessions_dir_from_env();
    match active_telegram_backend() {
        TelegramBackendKind::Grammers => {
            match super::grammers_ops::auth_status_blocking(&dir, &identity) {
                Ok(s) => ok_result("grammers", s),
                Err(e) => {
                    tg_log::error("grammers", "auth_status", e.to_string());
                    err_result("grammers", e)
                }
            }
        }
        TelegramBackendKind::TelethonCompanion => {
            // Honest: auth check for Telethon stays in Python; report routing only.
            ok_result(
                "telethon_companion",
                AuthStatus {
                    backend: "telethon_companion".into(),
                    authorized: true, // unknown — Python path owns real check
                    session: identity.session,
                    user: None,
                },
            )
        }
    }
}

/// Download the actual Telegram profile photo for the session user.
/// Returns base64 data-URL JPEG or None. Called asynchronously after auth_status.
pub fn tg_download_profile_photo(identity: TelegramIdentity) -> OpResult<Option<String>> {
    let dir = sessions_dir_from_env();
    match super::grammers_ops::download_profile_photo_blocking(&dir, &identity) {
        Ok(data) => ok_result("grammers", data),
        Err(e) => {
            tg_log::warn("grammers", "download_profile_photo", e.to_string());
            ok_result("grammers", None)
        }
    }
}


pub fn tg_list_dialogs(
    identity: TelegramIdentity,
    limit: Option<usize>,
) -> OpResult<Vec<DialogEntry>> {
    let dir = sessions_dir_from_env();
    let limit = limit.unwrap_or(100);
    match super::grammers_ops::list_dialogs_blocking(&dir, &identity, limit) {
        Ok(v) => ok_result("grammers", v),
        Err(e) => {
            tg_log::error("grammers", "list_dialogs", e.to_string());
            err_result("grammers", e)
        }
    }
}

pub fn tg_list_dialog_filters(
    identity: TelegramIdentity,
) -> OpResult<Vec<super::grammers_ops::DialogFilterRow>> {
    match super::grammers_ops::list_dialog_filters_blocking(&sessions_dir_from_env(), &identity) {
        Ok(rows) => ok_result("grammers", rows),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMediaRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub limit: Option<usize>,
    pub offset_id: Option<i64>,
    pub topic_id: Option<i64>,
}

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

static ACTIVE_STREAMS: OnceLock<StdMutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn active_streams_map() -> &'static StdMutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_STREAMS.get_or_init(|| StdMutex::new(HashMap::new()))
}

pub fn register_stream(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = active_streams_map().lock() {
        map.insert(request_id.to_string(), Arc::clone(&flag));
    }
    flag
}

pub fn cancel_stream(request_id: &str) {
    if let Ok(mut map) = active_streams_map().lock() {
        if let Some(flag) = map.remove(request_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

pub fn unregister_stream(request_id: &str) {
    if let Ok(mut map) = active_streams_map().lock() {
        map.remove(request_id);
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFolderStreamRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub request_id: String,
    pub offset_id: Option<i64>,
    pub topic_id: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetMediaStatisticsRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub topic_id: Option<i64>,
    pub loaded_count: Option<usize>,
}

pub fn tg_get_media_statistics(
    req: GetMediaStatisticsRequest,
) -> OpResult<super::media_statistics::MediaStatisticsResult> {
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    let loaded = req.loaded_count.unwrap_or(0);
    match super::media_counter::get_media_statistics_blocking(
        &dir,
        &identity,
        &req.chat_id,
        req.topic_id,
        loaded,
    ) {
        Ok(stats) => ok_result("grammers", stats),
        Err(e) => err_result("grammers", e),
    }
}

pub fn tg_list_media(req: ListMediaRequest) -> OpResult<super::grammers_ops::ListMediaResult> {
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    let limit = req.limit.unwrap_or(40);
    match super::grammers_ops::list_media_blocking_topic(
        &dir,
        &identity,
        &req.chat_id,
        limit,
        req.offset_id,
        req.topic_id,
    ) {
        Ok(v) => ok_result("grammers", v),
        Err(e) => {
            tg_log::error("grammers", "list_media", e.to_string());
            err_result("grammers", e)
        }
    }
}

pub fn tg_start_folder_stream_blocking(
    req: StartFolderStreamRequest,
    channel: &tauri::ipc::Channel<super::grammers_ops::FolderChunkPayload>,
    cancel_flag: &Arc<AtomicBool>,
) -> OpResult<bool> {
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    let limit = req.limit.unwrap_or(30);
    match super::grammers_ops::start_folder_stream_blocking(
        &dir,
        &identity,
        &req.chat_id,
        limit,
        req.offset_id,
        req.topic_id,
        req.request_id,
        channel,
        cancel_flag,
    ) {
        Ok(v) => ok_result("grammers", v),
        Err(e) => {
            tg_log::error("grammers", "start_folder_stream", e.to_string());
            err_result("grammers", e)
        }
    }
}

pub fn tg_upload_file(req: UploadFileRequest) -> OpResult<UploadStepResult> {
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    if active_telegram_backend() != TelegramBackendKind::Grammers {
        // Explicit dual-path: if user calls Grammers upload while telethon preferred,
        // still allow if env not set — actually require grammers backend for this command.
        tg_log::warn(
            "router",
            "upload_file",
            "AUTOGRAM_TELEGRAM_BACKEND is not grammers; forcing grammers for this upload command",
        );
    }
    let as_doc = req.as_document.unwrap_or(true);
    let silent = req.silent.unwrap_or(false);
    let index = req.index.unwrap_or(0);
    let caption = req.caption.unwrap_or_default();
    match super::grammers_ops::upload_file_blocking_topic(
        &dir,
        &identity,
        &req.chat_id,
        &req.path,
        &caption,
        as_doc,
        silent,
        index,
        req.topic_id,
    ) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => {
            tg_log::error("grammers", "upload_file", e.to_string());
            err_result("grammers", e)
        }
    }
}

pub fn tg_login(
    req: super::grammers_ops::LoginRequest,
) -> OpResult<super::grammers_ops::LoginResult> {
    let dir = sessions_dir_from_env();
    match super::grammers_ops::login_blocking(&dir, &req) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => {
            tg_log::error("grammers", "login", e.to_string());
            err_result("grammers", e)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFileRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub message_id: i64,
    pub dest_path: String,
}

pub fn tg_download_file(
    req: DownloadFileRequest,
) -> OpResult<super::grammers_ops::DownloadFileResult> {
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    match super::grammers_ops::download_file_blocking(
        &dir,
        &identity,
        &req.chat_id,
        req.message_id,
        &req.dest_path,
    ) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => {
            tg_log::error("grammers", "download_file", e.to_string());
            err_result("grammers", e)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTopicsRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: i64,
}

pub fn tg_list_topics(req: ListTopicsRequest) -> OpResult<super::grammers_media::ListTopicsResult> {
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    match super::grammers_media::list_topics_blocking(&dir, &identity, req.chat_id) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => {
            tg_log::error("grammers", "list_topics", e.to_string());
            err_result("grammers", e)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailItemRequest {
    pub request_id: String,
    pub peer_id: String,
    pub telegram_message_id: i32,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub generation: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsBatchRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub batch_id: Option<String>,
    #[serde(default)]
    pub items: Vec<ThumbnailItemRequest>,
    pub request_id: Option<String>,
    pub chat_id: Option<String>,
    pub telegram_peer_id: Option<String>,
    pub message_ids: Option<Vec<i64>>,
    pub telegram_message_ids: Option<Vec<i64>>,
    pub quality: Option<String>,
}

pub fn tg_thumbs_batch(
    req: ThumbsBatchRequest,
) -> OpResult<super::grammers_media::ThumbsBatchResult> {
    tg_thumbs_batch_app(req, None)
}

pub fn tg_thumbs_batch_app(
    req: ThumbsBatchRequest,
    app: Option<&tauri::AppHandle>,
) -> OpResult<super::grammers_media::ThumbsBatchResult> {
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session.clone(),
        api_id: req.api_id,
        api_hash: req.api_hash.clone(),
    };
    let q = req.quality.as_deref().unwrap_or("balanced");

    match super::grammers_media::thumbs_batch_items_blocking_app(&dir, &identity, &req, q, app) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => {
            tg_log::error("grammers", "thumbs_batch", e.to_string());
            err_result("grammers", e)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugGetMessageRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub peer_id: String,
    pub telegram_message_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugGetMessageResult {
    pub found: bool,
    pub returned_id: Option<i64>,
    pub message_type: Option<String>,
    pub has_media: bool,
    pub media_type: Option<String>,
    pub document_id: Option<i64>,
    pub photo_id: Option<i64>,
    pub text_preview: Option<String>,
}

pub fn tg_debug_get_message(req: DebugGetMessageRequest) -> OpResult<DebugGetMessageResult> {
    use crate::core::grammers_ops::{resolve_peer, runtime, with_client, with_pool_retry};
    use crate::core::tg_error::map_invocation;
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    let rt = match runtime() {
        Ok(r) => r,
        Err(e) => return err_result("grammers", e),
    };
    let chat = req.peer_id.clone();
    let mid = req.telegram_message_id as i32;

    let res = rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
            with_client(&dir, &identity, true, move |client| {
                let chat = chat.clone();
                Box::pin(async move {
                    let peer = resolve_peer(client, &chat).await?;
                    let msgs = client
                        .get_messages_by_id(peer, &[mid])
                        .await
                        .map_err(|e| map_invocation(&e))?;
                    if let Some(Some(msg)) = msgs.first() {
                        let returned_id = msg.id() as i64;
                        let maybe_media = msg.media();
                        let has_media = maybe_media.is_some();
                        let (media_type, doc_id, photo_id) = match &maybe_media {
                            Some(grammers_client::media::Media::Photo(p)) => {
                                (Some("photo".into()), None, Some(p.id()))
                            }
                            Some(grammers_client::media::Media::Document(d)) => {
                                (Some("document".into()), Some(d.id()), None)
                            }
                            Some(grammers_client::media::Media::Sticker(s)) => {
                                (Some("sticker".into()), Some(s.document.id()), None)
                            }
                            _ => (None, None, None),
                        };
                        let text_prev = if !msg.text().is_empty() {
                            Some(msg.text().chars().take(50).collect())
                        } else {
                            None
                        };
                        Ok(DebugGetMessageResult {
                            found: true,
                            returned_id: Some(returned_id),
                            message_type: Some("Message".into()),
                            has_media,
                            media_type,
                            document_id: doc_id,
                            photo_id,
                            text_preview: text_prev,
                        })
                    } else {
                        Ok(DebugGetMessageResult {
                            found: false,
                            returned_id: None,
                            message_type: None,
                            has_media: false,
                            media_type: None,
                            document_id: None,
                            photo_id: None,
                            text_preview: None,
                        })
                    }
                })
            })
        })
        .await
    });

    match res {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStreamRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub message_id: i64,
    #[serde(default)]
    pub topic_id: Option<i64>,
    #[serde(default)]
    pub location_type: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub fn tg_preview_stream(
    req: PreviewStreamRequest,
) -> OpResult<super::grammers_media::PreviewStreamResult> {
    let loc_type = req.location_type.as_deref().unwrap_or("").to_lowercase();
    if req.chat_id == "me" && !loc_type.is_empty() && loc_type != "saved_messages" {
        let err = TgError::new(
            TgErrorCode::InvalidIdentity,
            format!(
                "INVALID_SELF_PEER_USAGE: peer 'me' cannot be used for location_type '{loc_type}'"
            ),
        );
        tg_log::error("grammers", "preview_stream", err.to_string());
        return err_result("grammers", err);
    }
    let dir = sessions_dir_from_env();
    let identity = TelegramIdentity {
        session: req.session,
        api_id: req.api_id,
        api_hash: req.api_hash,
    };
    match super::grammers_media::start_preview_stream_blocking(
        &dir,
        &identity,
        &req.chat_id,
        req.message_id,
    ) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => {
            tg_log::error("grammers", "preview_stream", e.to_string());
            err_result("grammers", e)
        }
    }
}

pub fn tg_stop_stream(stream_id: String) -> OpResult<bool> {
    // Mark cancelled + stop fill; leave registry so UI can read final status.
    let ok = super::grammers_media::cancel_progressive(&stream_id);
    ok_result("grammers", ok)
}

pub fn tg_seek_stream(
    stream_id: String,
    offset: Option<u64>,
    time_s: Option<f64>,
    duration_s: Option<f64>,
) -> OpResult<u64> {
    let status = super::stream_server::status_of(&stream_id);
    if status.status == "missing" || status.total == 0 {
        return err_result(
            "grammers",
            TgError::new(TgErrorCode::Internal, "progressive stream not found"),
        );
    }
    let requested = offset.unwrap_or_else(|| {
        let ratio = match (time_s, duration_s) {
            (Some(time), Some(duration)) if duration > 0.0 => (time / duration).clamp(0.0, 1.0),
            _ => 0.0,
        };
        (status.total as f64 * ratio) as u64
    });
    let requested = requested.min(status.total.saturating_sub(1));
    if super::grammers_media::request_progressive_range(&stream_id, requested) {
        ok_result("grammers", requested)
    } else {
        err_result(
            "grammers",
            TgError::new(TgErrorCode::Internal, "stream is no longer active"),
        )
    }
}

pub fn tg_set_backend(backend: String) -> OpResult<BackendStatus> {
    let b = backend.to_ascii_lowercase();
    match b.as_str() {
        "grammers" | "rust" => set_telegram_backend(TelegramBackendKind::Grammers),
        "telethon" | "python" | "telethon_companion" => return err_result(
            "router",
            TgError::new(
                TgErrorCode::BackendDisabled,
                "backend Python dinonaktifkan; Account, Session, dan Preview wajib memakai Rust + Grammers",
            ),
        ),
        _ => {
            return err_result(
                "router",
                TgError::new(
                    TgErrorCode::NotConfigured,
                    format!("unknown backend '{backend}' (use grammers)"),
                ),
            );
        }
    }
    ok_result(active_telegram_backend().label(), backend_status())
}

// ---------------------------------------------------------------------------
// Drive RPC (Grammers-only — formerly Telethon drive-serve)
// ---------------------------------------------------------------------------

fn identity_from(session: String, api_id: i64, api_hash: String) -> TelegramIdentity {
    TelegramIdentity {
        session,
        api_id,
        api_hash,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMessagesRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub message_ids: Vec<i64>,
}

pub fn tg_delete_messages(
    req: DeleteMessagesRequest,
) -> OpResult<super::drive_rpc::DeleteMessagesResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::delete_messages_blocking(
        &dir,
        &identity,
        &req.chat_id,
        &req.message_ids,
    ) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub name: String,
    pub parent_id: Option<i64>,
}

pub fn tg_create_folder(req: CreateFolderRequest) -> OpResult<super::drive_rpc::FolderOpResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::create_folder_blocking(&dir, &identity, &req.name, req.parent_id) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFolderRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub folder_id: i64,
    pub name: String,
}

pub fn tg_rename_folder(req: RenameFolderRequest) -> OpResult<super::drive_rpc::FolderOpResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::rename_folder_blocking(&dir, &identity, req.folder_id, &req.name) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFolderParentRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub folder_id: i64,
    pub parent_id: Option<i64>,
}

pub fn tg_set_folder_parent(
    req: SetFolderParentRequest,
) -> OpResult<super::drive_rpc::FolderOpResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::set_folder_parent_blocking(
        &dir,
        &identity,
        req.folder_id,
        req.parent_id,
    ) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFolderRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub folder_id: i64,
}

pub fn tg_delete_folder(req: DeleteFolderRequest) -> OpResult<super::drive_rpc::FolderOpResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::delete_folder_blocking(&dir, &identity, req.folder_id) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFoldersRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
}

pub fn tg_scan_folders(req: ScanFoldersRequest) -> OpResult<super::drive_rpc::ScanFoldersResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::scan_folders_blocking(&dir, &identity) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicMutRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: i64,
    pub topic_id: Option<i64>,
    pub title: Option<String>,
}

pub fn tg_create_topic(req: TopicMutRequest) -> OpResult<super::drive_rpc::TopicOpResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    let title = req.title.unwrap_or_default();
    match super::drive_rpc::create_topic_blocking(&dir, &identity, req.chat_id, &title) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

pub fn tg_rename_topic(req: TopicMutRequest) -> OpResult<super::drive_rpc::TopicOpResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    let topic_id = req.topic_id.unwrap_or(0);
    let title = req.title.unwrap_or_default();
    match super::drive_rpc::rename_topic_blocking(&dir, &identity, req.chat_id, topic_id, &title) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

pub fn tg_delete_topic(req: TopicMutRequest) -> OpResult<super::drive_rpc::TopicOpResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    let topic_id = req.topic_id.unwrap_or(0);
    match super::drive_rpc::delete_topic_blocking(&dir, &identity, req.chat_id, topic_id) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarsBatchRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub peer_ids: Vec<i64>,
}

pub fn tg_avatars_batch(
    req: AvatarsBatchRequest,
) -> OpResult<super::drive_rpc::AvatarsBatchResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::avatars_batch_blocking(&dir, &identity, &req.peer_ids) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveMessagesRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub source_chat: String,
    pub dest_chat: String,
    pub message_ids: Vec<i64>,
    pub delete_source: Option<bool>,
}

pub fn tg_move_messages(
    req: MoveMessagesRequest,
) -> OpResult<super::drive_rpc::MoveMessagesResult> {
    let dir = sessions_dir_from_env();
    let identity = identity_from(req.session, req.api_id, req.api_hash);
    match super::drive_rpc::move_messages_blocking(
        &dir,
        &identity,
        &req.source_chat,
        &req.dest_chat,
        &req.message_ids,
        req.delete_source.unwrap_or(true),
    ) {
        Ok(r) => ok_result("grammers", r),
        Err(e) => err_result("grammers", e),
    }
}

pub fn tg_purge_inactive_sessions(active_session: &str) {
    super::grammers_ops::purge_inactive_sessions(active_session);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_status_lists_grammers_ops() {
        let s = backend_status();
        assert!(s.grammers_compiled);
        assert!(s.telethon_ops.is_empty());
        assert!(s.grammers_ops.iter().any(|o| *o == "preview_stream"));
    }

    #[test]
    fn identity_safe_label() {
        let id = TelegramIdentity {
            session: "Lavender".into(),
            api_id: 1,
            api_hash: "secret".into(),
        };
        assert!(id.safe_label().contains("Lavender"));
    }
}
