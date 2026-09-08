use serde::{Deserialize, Serialize};

pub const KINDS: [&str; 8] = ["image", "video", "audio", "document", "archive", "other", "page", "manifest"];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlRequest {
    pub seeds: Vec<String>,
    pub max_depth: u32,
    pub max_pages: usize,
    pub max_results: usize,
    pub delay_ms: u64,
    pub concurrency: usize,
    pub same_origin: bool,
    #[serde(default)]
    pub include_pattern: String,
    #[serde(default)]
    pub exclude_pattern: String,
    #[serde(default)]
    pub selector: String,
    pub kinds: Vec<String>,
    #[serde(default = "default_robots")]
    pub respect_robots: bool,
}
fn default_robots() -> bool { true }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub url: String,
    pub source_url: String,
    pub filename: String,
    pub kind: String,
    pub depth: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub state: String,
    pub pages_visited: usize,
    pub pages_queued: usize,
    pub errors: usize,
    pub duplicates: usize,
    pub blocked: usize,
    pub entries: Vec<Entry>,
    pub error: Option<String>,
}
