//! Extensible Media Intelligence Interfaces for v2.9.0

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaAnalysisResult {
    pub mime_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_secs: Option<f64>,
    pub is_corrupt: bool,
    pub moov_atom_at_end: bool,
}
