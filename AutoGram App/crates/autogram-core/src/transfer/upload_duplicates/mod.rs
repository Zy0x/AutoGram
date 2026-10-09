//! Read-only duplicate inspection; a candidate is never a completed transfer.
mod contracts;
mod inspection;
mod ledger;
#[cfg(test)]
mod tests;

pub use contracts::*;
pub use inspection::inspect_duplicates;
