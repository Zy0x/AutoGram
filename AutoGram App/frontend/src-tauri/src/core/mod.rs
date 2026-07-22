//! AutoGram Rust core — local/default backend for hybrid architecture.
//!
//! Telegram MTProto stays in the Python worker. Anything that does not need
//! Telethon should live here to keep the app lighter and reduce process gap.

pub mod capability;
pub mod config_normalize;
pub mod doc_preview;
pub mod grammers_media;
pub mod grammers_ops;
pub mod hash_util;
pub mod job_queue;
pub mod network;
pub mod path_policy;
pub mod progress_rate;
pub mod stream_server;
pub mod streaming_policy;
pub mod studio_orch;
pub mod telegram_ops;
pub mod telethon_session_import;
pub mod tg_error;
pub mod tg_log;
pub mod zip_local;
