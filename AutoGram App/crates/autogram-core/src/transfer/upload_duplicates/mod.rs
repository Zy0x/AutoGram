//! Read-only duplicate inspection; a candidate is never a completed transfer.
mod admission;
mod contracts;
mod inspection;
mod ledger;
#[cfg(test)]
mod tests;

pub use admission::{plan_identical_upload_admission, UploadAdmission, UploadAdmissionPlan};
pub use contracts::*;
pub use inspection::inspect_duplicates;
