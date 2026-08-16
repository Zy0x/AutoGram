//! Large Batch Execution Planner & Grouping Optimizer

use super::intent_engine::{classify_user_intent, UserIntent};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionCategory {
    DirectUpload,
    RemuxContainer,
    EncodeTranscode,
    SplitBinary,
    SplitVideo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchItemPlan {
    pub filepath: PathBuf,
    pub filename: String,
    pub filesize: u64,
    pub intent: UserIntent,
    pub category: ActionCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchPlan {
    pub total_files: usize,
    pub total_bytes: u64,
    pub estimated_seconds: u64,
    pub items: Vec<BatchItemPlan>,
}

pub fn plan_batch_execution(
    file_list: &[(PathBuf, String, u64)],
    account_max_bytes: u64,
) -> BatchPlan {
    let mut total_bytes = 0u64;
    let mut items = Vec::new();

    for (filepath, filename, filesize) in file_list {
        total_bytes += filesize;
        let intent = classify_user_intent(filename, None);

        let category = if *filesize > account_max_bytes {
            if intent == UserIntent::MediaAlbum {
                ActionCategory::SplitVideo
            } else {
                ActionCategory::SplitBinary
            }
        } else {
            ActionCategory::DirectUpload
        };

        items.push(BatchItemPlan {
            filepath: filepath.clone(),
            filename: filename.clone(),
            filesize: *filesize,
            intent,
            category,
        });
    }

    let estimated_seconds = (total_bytes / (10 * 1024 * 1024)).max(1); // 10MB/s estimation

    BatchPlan {
        total_files: file_list.len(),
        total_bytes,
        estimated_seconds,
        items,
    }
}
