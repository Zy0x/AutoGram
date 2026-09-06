//! Local-only remote transfers. No Telegram identity, upload queue or governor.
mod http;
mod mux;
mod publish;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex, OnceLock, atomic::{AtomicU8, AtomicU64, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuxSpec {
    pub video_url: String,
    pub audio_url: String,
    pub output_ext: String,
    pub expected_height: Option<u32>,
    pub expected_duration_sec: Option<f64>,
    #[serde(default)]
    pub transcode_video: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub filename: String,
    pub directory: String,
    pub connections: Option<usize>,
    pub mux: Option<MuxSpec>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub filename: String,
    pub directory: String,
    pub state: String,
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
    pub output_bytes: u64,
    pub error: Option<String>,
}

pub(super) struct Job {
    pub snapshot: Mutex<Snapshot>,
    // 0 running, 1 paused, 2 cancelled; cancellation is terminal.
    pub control: AtomicU8,
}
impl Job {
    pub fn checkpoint(&self) -> Result<(), String> {
        loop {
            match self.control.load(Ordering::SeqCst) {
                0 => return Ok(()),
                1 => std::thread::sleep(Duration::from_millis(50)),
                _ => return Err("remote_download_cancelled".into()),
            }
        }
    }
    fn update(&self, f: impl FnOnce(&mut Snapshot)) { f(&mut self.snapshot.lock().unwrap()); }
    fn phase(&self, phase: &str) { self.update(|s| s.phase = phase.into()); }
}

fn jobs() -> &'static Mutex<HashMap<String, Arc<Job>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<Job>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn terminal(state: &str) -> bool { matches!(state, "done" | "failed" | "cancelled") }

fn validate_filename(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 220 || name == "." || name == ".."
        || name.ends_with(['.', ' ']) || name.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c)) {
        return Err("remote_download_invalid_filename".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit()) {
        return Err("remote_download_invalid_filename".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_download_start(requests: Vec<DownloadRequest>) -> Result<Vec<Snapshot>, String> {
    // Validate the entire batch before launching any network work.
    if requests.is_empty() || requests.len() > 100 { return Err("remote_download_invalid_batch".into()); }
    for request in &requests {
        validate_filename(&request.filename)?;
        http::validate_url(&request.url)?;
        let directory = Path::new(&request.directory);
        if !directory.is_absolute() || !directory.is_dir() { return Err("remote_download_invalid_directory".into()); }
        if directory.join(&request.filename).exists() { return Err("remote_download_exists".into()); }
        if let Some(mux) = &request.mux {
            http::validate_url(&mux.video_url)?;
            http::validate_url(&mux.audio_url)?;
            if !["mp4", "webm", "mkv"].contains(&mux.output_ext.as_str())
                || Path::new(&request.filename).extension().and_then(|s| s.to_str()) != Some(&mux.output_ext) {
                return Err("remote_download_invalid_mux".into());
            }
            mux::binaries()?;
        }
    }
    let mut registry = jobs().lock().unwrap();
    // One local batch at a time bounds total sockets and disk pressure, not Telegram limits.
    if registry.values().any(|job| !terminal(&job.snapshot.lock().unwrap().state)) {
        return Err("remote_download_busy".into());
    }
    registry.retain(|_, job| !terminal(&job.snapshot.lock().unwrap().state));
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let mut work = Vec::new();
    let mut result = Vec::new();
    for request in requests {
        let millis = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let id = format!("local-{}-{millis}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed));
        let snapshot = Snapshot { id: id.clone(), filename: request.filename.clone(), directory: request.directory.clone(),
            state: "queued".into(), phase: "download".into(), downloaded: 0, total: 0, output_bytes: 0, error: None };
        let job = Arc::new(Job { snapshot: Mutex::new(snapshot.clone()), control: AtomicU8::new(0) });
        registry.insert(id, job.clone());
        work.push((request, job));
        result.push(snapshot);
    }
    std::thread::spawn(move || {
        for (request, job) in work {
            if job.control.load(Ordering::SeqCst) == 0 { job.update(|s| s.state = "downloading".into()); }
            let result = run(&request, &job);
            job.update(|s| {
                s.state = match &result { Ok(_) => "done", Err(_) if job.control.load(Ordering::SeqCst) == 2 => "cancelled", Err(_) => "failed" }.into();
                s.error = result.err().filter(|_| s.state != "cancelled");
            });
        }
    });
    Ok(result)
}

#[tauri::command]
pub fn remote_download_list() -> Vec<Snapshot> {
    let mut result: Vec<_> = jobs().lock().unwrap().values().map(|j| j.snapshot.lock().unwrap().clone()).collect();
    result.sort_by(|a, b| a.id.cmp(&b.id));
    result
}

#[tauri::command]
pub fn remote_download_control(id: String, action: String) -> Result<(), String> {
    let registry = jobs().lock().unwrap();
    let job = registry.get(&id).ok_or("remote_download_missing")?;
    let mut snapshot = job.snapshot.lock().unwrap();
    if terminal(&snapshot.state) { return Ok(()); }
    if job.control.load(Ordering::SeqCst) == 2 { return Ok(()); }
    match action.as_str() {
        "pause" => { job.control.store(1, Ordering::SeqCst); snapshot.state = "paused".into(); }
        "resume" => { job.control.store(0, Ordering::SeqCst); snapshot.state = "downloading".into(); }
        "cancel" => { job.control.store(2, Ordering::SeqCst); snapshot.state = "cancelling".into(); }
        _ => return Err("remote_download_invalid_action".into()),
    }
    Ok(())
}

/// Only owns files inside a freshly created job-specific directory.
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        // No recursive cleanup: known files only. Never follow/delete arbitrary paths.
        for name in ["video.part", "audio.part", "download.part", "output.mp4", "output.webm", "output.mkv"] {
            let _ = std::fs::remove_file(self.0.join(name));
        }
        let _ = std::fs::remove_dir(&self.0);
    }
}

fn run(request: &DownloadRequest, job: &Job) -> Result<(), String> {
    job.checkpoint()?;
    let id = job.snapshot.lock().unwrap().id.clone();
    let root = std::fs::canonicalize(&request.directory).map_err(|_| "remote_download_invalid_directory")?;
    let scratch = root.join(format!(".autogram-{id}"));
    std::fs::create_dir(&scratch).map_err(|_| "remote_download_disk_error")?;
    let scratch = Scratch(scratch);
    let connections = request.connections.unwrap_or(4).clamp(1, 8);
    let output = if let Some(spec) = &request.mux {
        let video = scratch.0.join("video.part");
        let audio = scratch.0.join("audio.part");
        http::download(&spec.video_url, &video, connections, job)?;
        http::download(&spec.audio_url, &audio, connections, job)?;
        job.phase("mux");
        let output = scratch.0.join(format!("output.{}", spec.output_ext));
        mux::assemble(&video, &audio, &output, spec, job)?;
        output
    } else {
        let output = scratch.0.join("download.part");
        http::download(&request.url, &output, connections, job)?;
        output
    };
    job.checkpoint()?;
    let size = std::fs::metadata(&output).map_err(|_| "remote_download_disk_error")?.len();
    if size == 0 { return Err("remote_download_empty".into()); }
    // Hard link is atomic, same volume and fails if the destination exists.
    // Never rename-overwrite a user's existing file or publish a partial output.
    let destination = root.join(&request.filename);
    let mut snapshot = job.snapshot.lock().unwrap();
    if job.control.load(Ordering::SeqCst) == 2 { return Err("remote_download_cancelled".into()); }
    publish::publish(&output, &destination).map_err(|_| "remote_download_publish_failed")?;
    snapshot.output_bytes = size;
    snapshot.state = "done".into();
    Ok(())
}
