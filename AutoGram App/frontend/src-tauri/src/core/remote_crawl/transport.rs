use super::{jobs::{lock, Job}, policy::{parse_url, public_ip, resolve, Policy}, robots::{self, Rules}};
use std::{collections::HashMap, io::Read, net::{SocketAddr, ToSocketAddrs}, sync::{Arc, Mutex}, time::{Duration, Instant}};
use url::Url;

pub const HTML_BYTES: usize = 2 * 1024 * 1024;
pub struct Response {
    pub status: u16,
    pub mime: String,
    pub location: Option<String>,
    pub retry_after: Option<String>,
    pub encoding: Option<String>,
    pub length: Option<usize>,
    pub body: Box<dyn Read + Send>,
}
pub trait Transport: Sync { fn get(&self, url: &Url) -> Result<Response, String>; }
pub struct Network { agent: ureq::Agent }
impl Network {
    pub fn new() -> Self {
        Self { agent: ureq::AgentBuilder::new().redirects(0).try_proxy_from_env(false)
            .timeout_connect(Duration::from_secs(5)).timeout_read(Duration::from_secs(2))
            .timeout_write(Duration::from_secs(2)).timeout(Duration::from_secs(15))
            .max_idle_connections(4).user_agent("AutoGramCrawler/1.0")
            .resolver(|host: &str| -> std::io::Result<Vec<SocketAddr>> {
                let addresses: Vec<_> = host.to_socket_addrs()?.take(33).collect();
                validate_addresses(&addresses)?;
                Ok(addresses)
            }).build() }
    }
}
pub fn validate_addresses(addresses: &[SocketAddr]) -> std::io::Result<()> {
    if addresses.is_empty() || addresses.len() > 32 || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "public DNS required"));
    }
    Ok(())
}
impl Transport for Network {
    fn get(&self, url: &Url) -> Result<Response, String> {
        parse_url(url.as_str())?;
        let response = match self.agent.get(url.as_str()).set("Accept-Encoding", "identity")
            .set("Accept", "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,text/plain;q=0.5,*/*;q=0.1").call() {
            Ok(response) | Err(ureq::Error::Status(_, response)) => response,
            Err(_) => return Err("remote_crawl_network".into()),
        };
        Ok(Response { status: response.status(), mime: response.header("Content-Type").unwrap_or("").to_ascii_lowercase(),
            location: response.header("Location").filter(|s| s.len() <= super::policy::MAX_URL).map(str::to_string),
            retry_after: response.header("Retry-After").filter(|s| s.len() <= 128).map(str::to_string),
            encoding: response.header("Content-Encoding").map(str::to_string),
            length: response.header("Content-Length").and_then(|s| s.parse().ok()), body: response.into_reader() })
    }
}

pub struct Session<'a> {
    pub policy: &'a Policy,
    pub job: &'a Job,
    transport: &'a dyn Transport,
    pace: Mutex<Pace>,
    // Lock is held during the first robots fetch, providing single-flight loading.
    robots: Mutex<HashMap<String, Arc<Rules>>>,
}
struct Pace { last: Option<Instant>, delay: Duration, backoff: Option<Instant> }
impl<'a> Session<'a> {
    pub fn new(policy: &'a Policy, job: &'a Job, transport: &'a dyn Transport) -> Self {
        Self { policy, job, transport, pace: Mutex::new(Pace { last: None,
            delay: Duration::from_millis(policy.request.delay_ms), backoff: None }), robots: Mutex::new(HashMap::new()) }
    }
    fn paced(&self) -> Result<(), String> {
        loop {
            self.job.checkpoint()?;
            let mut pace = lock(&self.pace);
            let now = Instant::now();
            let next = pace.last.map(|last| last + pace.delay).unwrap_or(now)
                .max(pace.backoff.unwrap_or(now));
            if now >= next { pace.last = Some(now); return Ok(()); }
            drop(pace);
            self.job.wait(next - now)?;
        }
    }
    fn request(&self, url: &Url) -> Result<Response, String> {
        for attempt in 0..3 {
            self.paced()?;
            self.job.checkpoint()?;
            let response = self.transport.get(url)?;
            self.job.checkpoint()?;
            if response.status == 429 || (500..600).contains(&response.status) {
                if attempt == 2 { return Err("remote_crawl_retry_exhausted".into()); }
                let delay = retry_delay(response.retry_after.as_deref(), attempt)?;
                drop(response);
                let mut pace = lock(&self.pace);
                let until = Instant::now() + delay;
                pace.backoff = Some(pace.backoff.unwrap_or(until).max(until));
                continue;
            }
            return Ok(response);
        }
        Err("remote_crawl_retry_exhausted".into())
    }
    fn rules(&self, url: &Url) -> Result<Arc<Rules>, String> {
        let origin = url.origin().ascii_serialization();
        let mut cache = lock(&self.robots);
        if let Some(rules) = cache.get(&origin) { return Ok(rules.clone()); }
        if cache.len() >= 512 { return Err("remote_crawl_robots_limit".into()); }
        let mut current = parse_url(&format!("{origin}/robots.txt"))?;
        let fetched = (|| {
            for redirects in 0..=5 {
                let response = self.request(&current)?;
                if is_redirect(response.status) {
                    if redirects == 5 { return Err("remote_crawl_redirect_limit".to_string()); }
                    current = resolve(&current, response.location.as_deref().ok_or("remote_crawl_redirect")?)?;
                    if current.origin().ascii_serialization() != origin { return Err("remote_crawl_scope".into()); }
                    continue;
                }
                if matches!(response.status, 404 | 410) { return Ok(Rules::default()); }
                if response.status != 200 { return Ok(Rules::deny_all()); }
                let mime = response.mime.split(';').next().unwrap_or("").trim();
                if !matches!(mime, "text/plain" | "text/x-robots") { return Ok(Rules::deny_all()); }
                let body = read_text(response, robots::ROBOTS_BYTES, self.job)?;
                return Ok(robots::parse(&body));
            }
            Ok(Rules::deny_all())
        })();
        self.job.checkpoint()?;
        let rules = Arc::new(fetched.unwrap_or_else(|_| Rules::deny_all()));
        {
            let mut pace = lock(&self.pace);
            pace.delay = pace.delay.max(rules.delay);
        }
        cache.insert(origin, rules.clone());
        Ok(rules)
    }
    pub fn fetch(&self, start: &Url) -> Result<(Url, Response), String> {
        let mut current = start.clone();
        for redirects in 0..=5 {
            self.job.checkpoint()?;
            parse_url(current.as_str())?;
            if !self.policy.in_scope(&current) || self.policy.excluded(&current) { return Err("remote_crawl_scope".into()); }
            // respectRobots is retained in the wire contract; false cannot disable safety.
            if !self.rules(&current)?.allows(&current) { return Err("remote_crawl_robots_denied".into()); }
            let response = self.request(&current)?;
            if is_redirect(response.status) {
                if redirects == 5 { return Err("remote_crawl_redirect_limit".into()); }
                let next = resolve(&current, response.location.as_deref().ok_or("remote_crawl_redirect")?)?;
                if current.scheme() == "https" && next.scheme() == "http" { return Err("remote_crawl_redirect_downgrade".into()); }
                current = next;
                continue;
            }
            if !(200..300).contains(&response.status) { return Err("remote_crawl_http_status".into()); }
            return Ok((current, response));
        }
        Err("remote_crawl_redirect_limit".into())
    }
}
fn is_redirect(status: u16) -> bool { matches!(status, 301 | 302 | 303 | 307 | 308) }
pub fn retry_delay(raw: Option<&str>, attempt: u32) -> Result<Duration, String> {
    let seconds = raw.and_then(|s| s.parse::<u64>().ok().or_else(|| {
        chrono::DateTime::parse_from_rfc2822(s).ok().map(|d| (d.timestamp() - chrono::Utc::now().timestamp()).max(0) as u64)
    })).unwrap_or(0).max(1u64 << attempt.min(8));
    // Do not retry earlier than a server-requested long cooldown.
    if seconds > 300 { return Err("remote_crawl_retry_after_limit".into()); }
    Ok(Duration::from_secs(seconds))
}
pub fn is_markup(mime: &str) -> bool {
    matches!(mime.split(';').next().unwrap_or("").trim(), "text/html" | "application/xhtml+xml" | "application/rss+xml" | "application/atom+xml")
}
pub fn read_text(mut response: Response, cap: usize, job: &Job) -> Result<String, String> {
    if response.length.is_some_and(|len| len > cap) { return Err("remote_crawl_body_limit".into()); }
    if response.encoding.as_deref().is_some_and(|e| !e.eq_ignore_ascii_case("identity")) { return Err("remote_crawl_encoding".into()); }
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut bytes = Vec::with_capacity(response.length.unwrap_or(8192).min(cap));
    let mut chunk = [0; 8192];
    loop {
        job.checkpoint()?;
        if Instant::now() >= deadline { return Err("remote_crawl_body_timeout".into()); }
        let allowed = chunk.len().min(cap + 1 - bytes.len());
        let n = response.body.read(&mut chunk[..allowed]).map_err(|_| "remote_crawl_network")?;
        if n == 0 { break; }
        bytes.extend_from_slice(&chunk[..n]);
        if bytes.len() > cap { return Err("remote_crawl_body_limit".into()); }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
