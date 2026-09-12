use super::model::{CrawlRequest, KINDS};
use regex::{Regex, RegexBuilder};
use std::net::IpAddr;
use url::{Host, Url};

pub const MAX_URL: usize = 4096;
pub struct Policy {
    pub request: CrawlRequest,
    pub seeds: Vec<Url>,
    include: Option<Regex>,
    exclude: Option<Regex>,
}

impl Policy {
    pub fn new(request: CrawlRequest) -> Result<Self, String> {
        request.network.validate()?;
        super::rules::validate(&request.rules)?;
        if request.seeds.is_empty() || request.seeds.len() > 32 || request.max_depth > 8
            || !(1..=500).contains(&request.max_pages) || !(1..=5000).contains(&request.max_results)
            || !(250..=10000).contains(&request.delay_ms) || !(1..=4).contains(&request.concurrency)
            || request.kinds.len() > 8 || request.kinds.iter().any(|k| !KINDS.contains(&k.as_str()))
            || request.selector.len() > 512 {
            return Err("remote_crawl_invalid_request".into());
        }
        if !request.selector.is_empty() {
            scraper::Selector::parse(&request.selector).map_err(|_| "remote_crawl_invalid_selector")?;
        }
        let seeds = request.seeds.iter().map(|s| parse_url(s)).collect::<Result<Vec<_>, _>>()?;
        let include = pattern(&request.include_pattern)?;
        let exclude = pattern(&request.exclude_pattern)?;
        Ok(Self { request, seeds, include, exclude })
    }
    pub fn in_scope(&self, url: &Url) -> bool {
        if self.request.directory_mode {
            return self.seeds.iter().any(|seed| seed.origin() == url.origin()
                && url.path().starts_with(&directory_prefix(seed)));
        }
        !self.request.same_origin || self.seeds.iter().any(|s| s.origin() == url.origin())
    }
    // Include is a result filter, so a matching asset remains discoverable through
    // nonmatching index pages. Exclude also prevents traversal and redirect fetches.
    pub fn excluded(&self, url: &Url) -> bool {
        self.exclude.as_ref().is_some_and(|r| r.is_match(url.as_str()))
    }
    pub fn accepts(&self, url: &Url, kind: &str) -> bool {
        !self.excluded(url) && self.include.as_ref().is_none_or(|r| r.is_match(url.as_str()))
            && (self.request.kinds.is_empty() || self.request.kinds.iter().any(|k| k == kind))
    }
}
fn directory_prefix(seed: &Url) -> String {
    if seed.path().ends_with('/') { seed.path().to_string() }
    else { format!("{}/", seed.path().rsplit_once('/').map(|(p, _)| p).unwrap_or("")) }
}
fn pattern(value: &str) -> Result<Option<Regex>, String> {
    if value.is_empty() { return Ok(None); }
    if value.len() > 512 { return Err("remote_crawl_invalid_pattern".into()); }
    RegexBuilder::new(value).size_limit(256 * 1024).dfa_size_limit(256 * 1024)
        .nest_limit(32).build().map(Some).map_err(|_| "remote_crawl_invalid_pattern".into())
}

pub fn parse_url(raw: &str) -> Result<Url, String> {
    if raw.len() > MAX_URL || raw.chars().any(char::is_control) {
        return Err("remote_crawl_invalid_url".into());
    }
    let mut url = Url::parse(raw).map_err(|_| "remote_crawl_invalid_url")?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("remote_crawl_invalid_url".into());
    }
    match url.host() {
        Some(Host::Ipv4(ip)) if public_ip(ip.into()) => (),
        Some(Host::Ipv6(ip)) if public_ip(ip.into()) => (),
        Some(Host::Domain(host)) if !host.ends_with('.') && host.contains('.')
            && !["localhost", "local", "internal", "test", "invalid", "onion"].iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))) => (),
        _ => return Err("remote_crawl_private_address".into()),
    }
    url.set_fragment(None);
    Ok(url)
}

pub fn resolve(base: &Url, raw: &str) -> Result<Url, String> {
    if raw.len() > MAX_URL { return Err("remote_crawl_invalid_url".into()); }
    parse_url(base.join(raw).map_err(|_| "remote_crawl_invalid_url")?.as_str())
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a,b,c,_] = v.octets();
            !v.is_private() && !v.is_loopback() && !v.is_link_local() && !v.is_broadcast()
                && !v.is_unspecified() && !v.is_multicast() && a != 0 && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 192 && (b == 0 || (b == 88 && c == 99) || (b == 2)))
                && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(v) => {
            // Only global-unicast space; reject mapped/compatible, NAT64, 6to4,
            // Teredo and special-purpose/documentation prefixes conservatively.
            let s = v.segments();
            (s[0] & 0xe000) == 0x2000 && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

pub fn kind(url: &Url, mime: &str, fallback: &str) -> String {
    let mime = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let ext = url.path().rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let result = if mime.contains("mpegurl") || mime == "application/dash+xml" || matches!(ext.as_str(), "m3u8" | "m3u" | "mpd") { "manifest" }
    else if mime.starts_with("image/") { "image" }
    else if mime.starts_with("video/") { "video" }
    else if mime.starts_with("audio/") { "audio" }
    else if matches!(mime.as_str(), "text/html" | "application/xhtml+xml" | "application/rss+xml" | "application/atom+xml") { "page" }
    else { match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "avif" | "svg" | "ico" | "bmp" | "heic" => "image",
        "mp4" | "webm" | "mkv" | "mov" | "avi" | "m4v" | "ts" => "video",
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" | "opus" => "audio",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "csv" | "epub" | "json" => "document",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" => "archive",
        _ if mime == "application/pdf" || mime.starts_with("text/") => "document",
        _ => fallback,
    }};
    result.into()
}
