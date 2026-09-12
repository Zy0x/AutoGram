use super::{
    engine,
    jobs::{Job, lock},
    model::{CrawlRequest, Snapshot},
    policy::{self, Policy},
    transport::{Response, Transport},
};
use std::{collections::HashMap, io::Cursor, sync::Arc};
use url::Url;

struct Fixture {
    pages: HashMap<String, (&'static str, &'static str, u16)>,
}

impl Fixture {
    fn new() -> Self { Self { pages: HashMap::new() } }
    fn add(mut self, url: &str, mime: &'static str, body: &'static str) -> Self {
        self.pages.insert(url.into(), (mime, body, 200)); self
    }
}

impl Transport for Fixture {
    fn get(&self, url: &Url) -> Result<Response, String> {
        let (mime, body, status) = self.pages.get(url.as_str()).copied()
            .ok_or_else(|| String::from("remote_crawl_network"))?;
        Ok(Response { status, mime: mime.into(), location: None, retry_after: None,
            encoding: None, length: Some(body.len()), body: Box::new(Cursor::new(body.as_bytes())) })
    }
}

fn request(seed: &str) -> CrawlRequest {
    CrawlRequest { seeds: vec![seed.into()], max_depth: 2, max_pages: 20, max_results: 20,
        delay_ms: 250, concurrency: 2, same_origin: true, include_pattern: String::new(),
        exclude_pattern: String::new(), selector: String::new(), kinds: Vec::new(), respect_robots: true,
        network: Default::default(), rules: Vec::new(), directory_mode: false }
}

fn job() -> Arc<Job> { Arc::new(Job::new("fixture".into())) }

#[test]
fn engine_discovers_assets_and_walks_breadth_first() {
    let fixture = Fixture::new()
        .add("https://example.com/robots.txt", "text/plain", "User-agent: *\nAllow: /")
        .add("https://example.com/", "text/html", r#"
            <base href="/gallery/"><a href="one.html">one</a>
            <img src="photo.jpg"><img data-src="photo.jpg">
            <video poster="cover.png"><source src="clip.mp4"></video>
        "#)
        .add("https://example.com/gallery/one.html", "text/html", "<a href='/two'>two</a>")
        .add("https://example.com/gallery/two", "text/html", "<a href='/'>home</a>");
    let policy = Policy::new(request("https://example.com/")).unwrap();
    let worker = job();
    let limited = engine::run(&policy, &worker, &fixture).unwrap();
    let snapshot = lock(&worker.snapshot).clone();
    assert!(!limited);
    assert_eq!(snapshot.pages_visited, 3);
    assert_eq!(snapshot.entries.iter().filter(|e| e.kind == "image").count(), 2);
    assert!(snapshot.entries.iter().any(|e| e.url.ends_with("clip.mp4")));
    assert!(snapshot.duplicates >= 1);
}

#[test]
fn engine_parses_feed_enclosures_without_downloading_them() {
    let fixture = Fixture::new()
        .add("https://example.com/robots.txt", "text/plain", "User-agent: *\nAllow: /")
        .add("https://example.com/feed.xml", "application/rss+xml", r#"
            <rss><channel><item><enclosure url="/audio.mp3" type="audio/mpeg"/>
            <link rel="enclosure" href="/video.mp4"/></item></channel></rss>
        "#);
    let policy = Policy::new(request("https://example.com/feed.xml")).unwrap();
    let worker = job();
    engine::run(&policy, &worker, &fixture).unwrap();
    let snapshot = lock(&worker.snapshot).clone();
    assert_eq!(snapshot.entries.len(), 2);
    assert!(snapshot.entries.iter().any(|e| e.kind == "audio"));
    assert!(snapshot.entries.iter().any(|e| e.kind == "video"));
}

#[test]
fn engine_honours_result_cap_and_include_filter() {
    let mut request = request("https://example.com/");
    request.max_results = 1;
    request.include_pattern = r"\.jpg$".into();
    let fixture = Fixture::new()
        .add("https://example.com/robots.txt", "text/plain", "User-agent: *\nAllow: /")
        .add("https://example.com/", "text/html", "<img src='/a.jpg'><img src='/b.jpg'><a href='/next'>x</a>")
        .add("https://example.com/next", "text/html", "<img src='/c.jpg'>");
    let policy = Policy::new(request).unwrap();
    let worker = job();
    assert!(engine::run(&policy, &worker, &fixture).unwrap());
    let snapshot = lock(&worker.snapshot).clone();
    assert_eq!(snapshot.entries.len(), 1);
    assert!(snapshot.entries[0].url.ends_with("a.jpg"));
}

#[test]
fn robots_and_private_url_guards_fail_closed() {
    let fixture = Fixture::new()
        .add("https://example.com/robots.txt", "text/plain", "User-agent: *\nDisallow: /")
        .add("https://example.com/", "text/html", "<img src='/a.jpg'>");
    let policy = Policy::new(request("https://example.com/")).unwrap();
    let worker = job();
    engine::run(&policy, &worker, &fixture).unwrap();
    let snapshot = lock(&worker.snapshot).clone();
    assert_eq!(snapshot.entries.len(), 0);
    assert_eq!(snapshot.blocked, 1);
    assert!(policy::parse_url("http://127.0.0.1/").is_err());
    assert!(policy::parse_url("http://user:pass@example.com/").is_err());
}

#[test]
fn cancellation_is_observed_before_network_work() {
    let fixture = Fixture::new();
    let policy = Policy::new(request("https://example.com/")).unwrap();
    let worker = job();
    worker.control("cancel").unwrap();
    let error = engine::run(&policy, &worker, &fixture).unwrap_err();
    assert_eq!(error, "remote_crawl_stopped");
}

#[test]
fn request_bounds_and_public_dns_validation_are_enforced() {
    let mut request = request("https://example.com/");
    request.max_pages = 501;
    assert!(Policy::new(request).is_err());
    assert!(super::transport::validate_addresses(&["127.0.0.1:80".parse().unwrap()]).is_err());
}

#[test]
fn declarative_rules_are_bounded_and_extract_only_declared_attributes() {
    let mut request = request("https://example.com/");
    request.rules = vec![super::rules::ExtractionRule { selector: "a[data-file]".into(),
        attribute: "data-file".into(), kind: "video".into(), follow: false }];
    let policy = Policy::new(request).unwrap();
    let fixture = Fixture::new()
        .add("https://example.com/robots.txt", "text/plain", "User-agent: *\nAllow: /")
        .add("https://example.com/", "text/html", "<a data-file='/clip.mp4' href='/ignored'>x</a>");
    let worker = job();
    engine::run(&policy, &worker, &fixture).unwrap();
    let snapshot = lock(&worker.snapshot).clone();
    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].url, "https://example.com/clip.mp4");
    assert_eq!(snapshot.entries[0].kind, "video");
}
