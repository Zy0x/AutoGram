//! AutoGram Android UniFFI Bridge
//! Exposes shared `autogram-core` functionality to Kotlin & Jetpack Compose via Mozilla UniFFI.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use parking_lot::RwLock;

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum AutoGramBridgeError {
    #[error("Internal Error: {msg}")]
    InternalError { msg: String },
    #[error("Database Error: {msg}")]
    DatabaseError { msg: String },
    #[error("Telegram MTProto Error: {msg}")]
    TelegramError { msg: String },
    #[error("Media Processing Error: {msg}")]
    MediaError { msg: String },
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct AccountScoreResult {
    pub account_id: String,
    pub tier: String,
    pub total_score: f64,
    pub capability_score: f64,
    pub health_score: f64,
    pub latency_score: f64,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct RepairSummary {
    pub success: bool,
    pub output_path: String,
    pub repaired_by: String,
    pub message: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct HardwareProfileSummary {
    pub best_encoder: String,
    pub priority: u32,
    pub bitrate: u32,
    pub preset: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct StorageBudgetResult {
    pub max_temp_bytes: u64,
    pub purge_threshold_ratio: f32,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct AccountCapabilityResult {
    pub account_id: String,
    pub source: String,
    pub max_file_size: u64,
}

#[uniffi::export(callback_interface)]
pub trait AutoGramEventListener: Send + Sync {
    fn on_event(&self, event_type: String, payload_json: String);
}

static LISTENER: RwLock<Option<Box<dyn AutoGramEventListener>>> = RwLock::new(None);
static INITIALIZED: AtomicBool = AtomicBool::new(false);

#[uniffi::export]
pub fn init_autogram_runtime(app_storage_dir: String) -> Result<String, AutoGramBridgeError> {
    if !app_storage_dir.trim().is_empty() {
        std::env::set_var("AUTOGRAM_DB_PATH", format!("{app_storage_dir}/telegram_migrator.db"));
        std::env::set_var("AUTOGRAM_STORAGE_DIR", &app_storage_dir);
    }
    INITIALIZED.store(true, Ordering::SeqCst);
    Ok("AutoGram Runtime Initialized Successfully".to_string())
}

#[uniffi::export]
pub fn register_event_listener(listener: Box<dyn AutoGramEventListener>) {
    let mut guard = LISTENER.write();
    *guard = Some(listener);
}

#[uniffi::export]
pub fn emit_bridge_event(event_type: String, payload_json: String) {
    if let Some(ref listener) = *LISTENER.read() {
        listener.on_event(event_type, payload_json);
    }
}

#[uniffi::export]
pub fn get_account_scores() -> Result<Vec<AccountScoreResult>, AutoGramBridgeError> {
    let acc_free = autogram_core::AccountCapability::free("android-account-1");
    let health = autogram_core::AccountHealthState::Healthy;
    let score = autogram_core::calculate_account_score(&acc_free, &health, 30, 0, false);
    
    let tier_str = match score.routing_tier {
        autogram_core::AccountRoutingTier::Primary => "Primary",
        autogram_core::AccountRoutingTier::Secondary => "Secondary",
        autogram_core::AccountRoutingTier::CircuitBreaker => "CircuitBreaker",
    };

    Ok(vec![AccountScoreResult {
        account_id: score.account_id,
        tier: tier_str.to_string(),
        total_score: score.total_score,
        capability_score: score.capability_score,
        health_score: score.health_score,
        latency_score: score.latency_score,
    }])
}

#[uniffi::export]
pub fn run_container_repair(
    input_path: String,
    output_path: String,
) -> Result<RepairSummary, AutoGramBridgeError> {
    let input = PathBuf::from(&input_path);
    let output = PathBuf::from(&output_path);
    let res = autogram_core::repair_mp4_container(&input, &output)
        .map_err(|e| AutoGramBridgeError::MediaError { msg: e })?;
    
    Ok(RepairSummary {
        success: res.success,
        output_path: res.output_path,
        repaired_by: res.repaired_by,
        message: res.message,
    })
}

#[uniffi::export]
pub fn get_hardware_profiles() -> Result<HardwareProfileSummary, AutoGramBridgeError> {
    let enc = autogram_core::HardwareEncoderType::MediaCodec;
    let info = autogram_core::select_best_hardware_profile(enc);
    
    let (bitrate, preset) = match info.default_profile {
        autogram_core::EncoderQualityProfile::HighQuality { bitrate, preset } => (bitrate, preset),
        autogram_core::EncoderQualityProfile::Balanced { bitrate, preset } => (bitrate, preset),
        autogram_core::EncoderQualityProfile::HighSpeed { bitrate, preset } => (bitrate, preset),
    };

    Ok(HardwareProfileSummary {
        best_encoder: info.best_encoder,
        priority: info.priority,
        bitrate,
        preset,
    })
}

#[uniffi::export]
pub fn get_storage_budget() -> Result<StorageBudgetResult, AutoGramBridgeError> {
    let budget = autogram_core::StorageBudget::default();
    Ok(StorageBudgetResult {
        max_temp_bytes: budget.max_temp_bytes,
        purge_threshold_ratio: budget.purge_threshold_ratio,
    })
}

#[uniffi::export]
pub fn plan_batch_execution_summary(
    total_files: u32,
    total_bytes: u64,
) -> Result<String, AutoGramBridgeError> {
    let summary = serde_json::json!({
        "status": "planned",
        "totalFiles": total_files,
        "totalBytes": total_bytes,
        "maxPartLimit": 2147483648u64,
        "engine": "AutoGram Batch Optimizer v4"
    });
    Ok(summary.to_string())
}
