//! Abstraction Traits for Intelligence Layer

use super::interfaces::MediaAnalysisResult;
use std::path::Path;

pub trait MediaAnalyzer: Send + Sync {
    fn analyze(&self, path: &Path) -> Result<MediaAnalysisResult, String>;
}
