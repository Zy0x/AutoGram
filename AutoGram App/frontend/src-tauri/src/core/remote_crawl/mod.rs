mod engine;
mod extraction;
mod jobs;
mod model;
mod policy;
mod robots;
mod transport;
mod network_options;
mod rules;

use model::{CrawlRequest, Snapshot};
use policy::Policy;

#[tauri::command]
pub async fn remote_crawl_start(request: CrawlRequest) -> Result<Snapshot, String> {
    jobs::start(Policy::new(request)?)
}
#[tauri::command]
pub fn remote_crawl_status(id: String) -> Result<Snapshot, String> {
    Ok(jobs::lock(&jobs::registry()).get(&id)?.snapshot.lock().unwrap_or_else(|p| p.into_inner()).clone())
}
#[tauri::command]
pub fn remote_crawl_control(id: String, action: String) -> Result<(), String> {
    jobs::lock(&jobs::registry()).get(&id)?.control(&action)
}
#[tauri::command]
pub fn remote_crawl_list() -> Vec<Snapshot> { jobs::lock(&jobs::registry()).list() }

#[cfg(test)]
mod tests;
