//! Platform-independent, real Grammers authentication. Secrets never implement Debug.
mod contracts;
mod engine;
mod qr_updates;
mod session_codec;
mod transport;

pub use contracts::*;
pub use engine::{AuthAction, AuthEngine};
pub use transport::snapshot_session;

#[cfg(test)]
mod tests;
