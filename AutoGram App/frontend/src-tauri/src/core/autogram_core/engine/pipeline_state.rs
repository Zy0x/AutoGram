//! Pipeline State & Workflow Transitions

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PipelineStage {
    Analyze,
    Repair,
    Planning,
    Execution,
    Upload,
    Verify,
    Completed,
    Failed(String),
}

impl PipelineStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            PipelineStage::Analyze => "ANALYZE",
            PipelineStage::Repair => "REPAIR",
            PipelineStage::Planning => "PLANNING",
            PipelineStage::Execution => "EXECUTION",
            PipelineStage::Upload => "UPLOAD",
            PipelineStage::Verify => "VERIFY",
            PipelineStage::Completed => "COMPLETED",
            PipelineStage::Failed(_) => "FAILED",
        }
    }
}
