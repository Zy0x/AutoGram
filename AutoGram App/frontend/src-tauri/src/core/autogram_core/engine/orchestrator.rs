//! Main Pipeline Coordinator
//! Orchestrates the stage flow: ANALYZE -> REPAIR -> PLANNING -> EXECUTION -> UPLOAD -> VERIFY -> COMPLETED/CLEANUP.

use super::pipeline_state::PipelineStage;
use crate::core::autogram_core::reliability::JobStatus;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorState {
    pub job_id: i64,
    pub current_stage: PipelineStage,
    pub progress_percentage: f64,
}

impl OrchestratorState {
    pub fn new(job_id: i64) -> Self {
        Self {
            job_id,
            current_stage: PipelineStage::Analyze,
            progress_percentage: 0.0,
        }
    }

    pub fn advance_to(&mut self, next_stage: PipelineStage) {
        self.current_stage = next_stage;
    }
}
