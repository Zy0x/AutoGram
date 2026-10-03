//! Durable account-pinned downloads. No Telegram transport or Android lifecycle is implicit.
mod contracts;
mod executor;
mod files;
mod store;

pub use contracts::*;
pub use executor::DownloadExecutor;
pub use store::DownloadStore;

#[cfg(test)]
mod tests;
