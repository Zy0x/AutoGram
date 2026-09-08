use super::{engine, model::Snapshot, policy::Policy, transport::Network};
use std::{collections::VecDeque, sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock}, time::{Duration, Instant}};

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}
pub fn terminal(state: &str) -> bool { matches!(state, "done" | "failed" | "cancelled" | "limited") }
pub struct Job {
    pub snapshot: Mutex<Snapshot>,
    wake: Condvar,
    // A cancelled snapshot is immediately visible, but the registry remains busy
    // until its workers exit. Otherwise repeated start/cancel could leak threads.
    pub active: std::sync::atomic::AtomicBool,
}
impl Job {
    pub fn new(id: String) -> Self {
        Self { snapshot: Mutex::new(Snapshot { id, state: "running".into(), pages_visited: 0,
            pages_queued: 0, errors: 0, duplicates: 0, blocked: 0, entries: Vec::new(), error: None }),
            wake: Condvar::new(), active: std::sync::atomic::AtomicBool::new(true) }
    }
    pub fn update(&self, f: impl FnOnce(&mut Snapshot)) { f(&mut lock(&self.snapshot)); }
    pub fn checkpoint(&self) -> Result<(), String> {
        let mut snapshot = lock(&self.snapshot);
        while snapshot.state == "paused" {
            snapshot = self.wake.wait(snapshot).unwrap_or_else(|p| p.into_inner());
        }
        if terminal(&snapshot.state) { Err("remote_crawl_stopped".into()) } else { Ok(()) }
    }
    pub fn wait(&self, duration: Duration) -> Result<(), String> {
        let until = Instant::now() + duration;
        loop {
            self.checkpoint()?;
            let now = Instant::now();
            if now >= until { return Ok(()); }
            let snapshot = lock(&self.snapshot);
            if terminal(&snapshot.state) { return Err("remote_crawl_stopped".into()); }
            let _guard = self.wake.wait_timeout(snapshot, (until - now).min(Duration::from_millis(50)))
                .unwrap_or_else(|p| p.into_inner());
        }
    }
    pub fn control(&self, action: &str) -> Result<(), String> {
        if !matches!(action, "pause" | "resume" | "cancel") { return Err("remote_crawl_invalid_action".into()); }
        let mut snapshot = lock(&self.snapshot);
        if terminal(&snapshot.state) { return Ok(()); }
        snapshot.state = match action { "pause" => "paused", "resume" => "running", _ => "cancelled" }.into();
        if action == "cancel" { snapshot.pages_queued = 0; }
        self.wake.notify_all();
        Ok(())
    }
    pub fn finish(&self, state: &str, error: Option<String>) {
        self.update(|s| {
            if s.state != "cancelled" { s.state = state.into(); s.error = error; }
            s.pages_queued = 0;
        });
        self.wake.notify_all();
    }
}

#[derive(Default)]
pub struct Registry { jobs: VecDeque<Arc<Job>> }
impl Registry {
    pub fn insert(&mut self, job: Arc<Job>) -> Result<(), String> {
        use std::sync::atomic::Ordering;
        if self.jobs.iter().any(|j| j.active.load(Ordering::Acquire)) { return Err("remote_crawl_busy".into()); }
        self.prune();
        self.jobs.push_back(job);
        Ok(())
    }
    pub fn prune(&mut self) {
        use std::sync::atomic::Ordering;
        while self.jobs.iter().filter(|j| !j.active.load(Ordering::Acquire)).count() > 8 {
            if let Some(index) = self.jobs.iter().position(|j| !j.active.load(Ordering::Acquire)) { self.jobs.remove(index); }
        }
    }
    pub fn get(&self, id: &str) -> Result<Arc<Job>, String> {
        self.jobs.iter().find(|j| lock(&j.snapshot).id == id).cloned().ok_or_else(|| "remote_crawl_not_found".into())
    }
    pub fn list(&self) -> Vec<Snapshot> { self.jobs.iter().rev().map(|j| lock(&j.snapshot).clone()).collect() }
}
pub fn registry() -> &'static Mutex<Registry> {
    static JOBS: OnceLock<Mutex<Registry>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(Registry::default()))
}

pub fn start(policy: Policy) -> Result<Snapshot, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let id = format!("crawl-{}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let job = Arc::new(Job::new(id));
    let snapshot = lock(&job.snapshot).clone();
    lock(registry()).insert(job.clone())?;
    let worker = job.clone();
    if std::thread::Builder::new().name("remote-crawl".into()).spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            engine::run(&policy, &worker, &Network::new())
        }));
        match outcome {
            Ok(Ok(limited)) => worker.finish(if limited { "limited" } else { "done" }, None),
            Ok(Err(error)) => worker.finish("failed", Some(error)),
            Err(_) => worker.finish("failed", Some("remote_crawl_worker_failed".into())),
        }
        worker.active.store(false, Ordering::Release);
        lock(registry()).prune();
    }).is_err() {
        job.finish("failed", Some("remote_crawl_worker_failed".into()));
        job.active.store(false, Ordering::Release);
        lock(registry()).prune();
        return Err("remote_crawl_worker_failed".into());
    }
    Ok(snapshot)
}
