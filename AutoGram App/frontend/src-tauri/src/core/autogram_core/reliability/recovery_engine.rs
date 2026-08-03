//! Recovery Engine Module
//! Handles repair -> remux -> encode -> split pipeline orchestration for failed or corrupt jobs.

use super::error_classifier::{classify_error, ErrorClass};
use rusqlite::Connection;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecoveryAction {
    RetryWithOffset(u64),
    RepairContainer,
    RemuxLossless,
    TranscodeAdaptive,
    SplitEngine,
    SwitchAccount,
    Abort(String),
}

pub fn determine_recovery_action(
    error_message: &str,
    current_offset: u64,
    retry_count: u32,
    has_moov_error: bool,
    exceeds_limit: bool,
) -> RecoveryAction {
    let error_class = classify_error(error_message);

    match error_class {
        ErrorClass::RateLimit => RecoveryAction::SwitchAccount,
        ErrorClass::SizeLimit | _ if exceeds_limit => RecoveryAction::SplitEngine,
        ErrorClass::FileError if has_moov_error => RecoveryAction::RepairContainer,
        ErrorClass::FileError => RecoveryAction::RemuxLossless,
        ErrorClass::NetworkError if retry_count < 5 => RecoveryAction::RetryWithOffset(current_offset),
        ErrorClass::SystemError if retry_count < 3 => RecoveryAction::TranscodeAdaptive,
        _ => RecoveryAction::Abort(error_message.to_string()),
    }
}

pub fn execute_recovery_step(
    conn: &Connection,
    job_id: i64,
    action: &RecoveryAction,
) -> Result<(), String> {
    let msg = format!("Executing recovery action: {:?}", action);
    super::job_events::log_job_event(conn, job_id, "RECOVERY", &msg, None)?;
    Ok(())
}
