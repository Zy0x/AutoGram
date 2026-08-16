//! Production Reliability & Persistence Module

pub mod checkpoint_manager;
pub mod checkpoint_validator;
pub mod error_classifier;
pub mod job_dependencies;
pub mod job_events;
pub mod job_queue;
pub mod recovery_engine;
pub mod retry_policy;

pub use checkpoint_manager::{
    delete_job_checkpoints, load_latest_checkpoint, save_checkpoint, JobCheckpoint,
};
pub use checkpoint_validator::{calculate_file_sha256, validate_checkpoint_hash};
pub use error_classifier::{classify_error, ErrorClass};
pub use job_dependencies::{
    add_dependency, get_child_jobs, is_child_blocked, DependencyType, JobDependency,
};
pub use job_events::{get_job_events, log_job_event, JobEvent};
pub use job_queue::{update_job_status, JobStatus, ReliableJob};
pub use recovery_engine::{determine_recovery_action, execute_recovery_step, RecoveryAction};
pub use retry_policy::RetryPolicy;
