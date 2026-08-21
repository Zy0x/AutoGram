use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;
use url::Url;

const MAX_HTML_BYTES: u64 = 1_250_000;
const MAX_PAGES: usize = 8;
const MAX_DEPTH: usize = 3;
const MAX_CANDIDATES: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLinkCandidate {
    pub url: String,
    pub kind: String,
    pub mime_type: Option<String>,
    pub content_length: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLinkResolution {
    pub source_url: String,
    pub final_url: String,
    pub platform_name: String,
    pub title: String,
    pub mime_type: Option<String>,
    pub content_length: Option<u64>,
    pub candidates: Vec<RemoteLinkCandidate>,
    pub requires_interaction: bool,
    pub inspected_pages: usize,
}

#[derive(Debug)]
struct PageInspection {
    final_url: Url,
    title: String,
    mime_type: Option<String>,
    content_length: Option<u64>,
    is_direct: bool,
    links: Vec<Url>,
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || v6.is_unique_local() || v6.is_unicast_link_local(),
    }
}

fn validate_public_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "remote_link_invalid_url".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("remote_link_unsupported_scheme".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("remote_link_embedded_credentials_blocked".into());
    }
    let host = parsed.host_str().ok_or_else(|| "remote_link_missing_host".to_string())?;
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
        return Err("remote_link_private_host_blocked".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err("remote_link_private_host_blocked".into());
        }
    } else {
        let port = parsed.port_or_known_default().unwrap_or(443);
        if let Ok(addresses) = (host, port).to_socket_addrs() {
            if addresses.into_iter().any(|address| is_private_ip(address.ip())) {
                return Err("remote_link_private_host_blocked".into());
            }
        }
    }
    Ok(parsed)
}

fn media_extension(url: &Url) -> Option<String> {
    let name = url.path_segments()?.next_back()?.to_ascii_lowercase();
    let ext = name.rsplit_once('.')?.1.split(['?', '#']).next()?.to_string();
    const KNOWN: &[&str] = &[
        "mp4", "m4v", "mov", "webm", "mkv", "avi", "flv", "m3u8", "mpd",
        "jpg", "jpeg", "png", "webp", "gif", "avif", "mp3", "m4a", "aac",
        "ogg", "opus", "wav", "flac", "zip", "rar", "7z", "pdf",
    ];
    KNOWN.contains(&ext.as_str()).then_some(ext)
}

fn is_direct_mime(mime: Option<&str>) -> bool {
    let mime = mime.unwrap_or("").to_ascii_lowercase();
    !mime.is_empty()
        && !mime.contains("text/html")
        && !mime.contains("application/xhtml")
        && !mime.contains("text/plain")
        && !mime.contains("application/json")
}

fn decode_html_value(value: &str) -> String {
    value
        .replace("\\u002F", "/")
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn collect_attr_values(html: &str, base: &Url) -> Vec<Url> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    for attr in ["src", "href", "content", "data-url", "data-src", "file", "url"] {
        let needle = format!("{attr}=");
        let mut cursor = 0usize;
        while let Some(relative) = lower[cursor..].find(&needle) {
            let mut start = cursor + relative + needle.len();
            while html.as_bytes().get(start).is_some_and(|b| b.is_ascii_whitespace()) { start += 1; }
            let quote = html.as_bytes().get(start).copied();
            let (value_start, terminator) = match quote {
                Some(b'\'') | Some(b'\"') => (start + 1, quote.unwrap()),
                _ => (start, b' '),
            };
            let bytes = html.as_bytes();
            let mut end = value_start;
            while end < bytes.len() {
                let byte = bytes[end];
                if byte == terminator || (terminator == b' ' && (byte.is_ascii_whitespace() || byte == b'>' || byte == b',')) { break; }
                end += 1;
            }
            cursor = end.saturating_add(1);
            if end <= value_start || end - value_start > 4096 { continue; }
            let value = decode_html_value(&html[value_start..end]);
            if value.starts_with("data:") || value.starts_with("javascript:") || value.starts_with('#') { continue; }
            if let Ok(url) = base.join(value.trim()) {
                if matches!(url.scheme(), "http" | "https") { out.push(url); }
            }
            if out.len() >= MAX_CANDIDATES * 3 { return out; }
        }
    }
    out
}

fn html_title(html: &str, fallback: &Url) -> String {
    let lower = html.to_ascii_lowercase();
    if let (Some(start), Some(end)) = (lower.find("<title"), lower.find("</title>")) {
        if end > start {
            if let Some(gt) = html[start..end].find('>') {
                let value = html[start + gt + 1..end].trim();
                if !value.is_empty() { return decode_html_value(value); }
            }
        }
    }
    fallback.path_segments().and_then(|mut values| values.next_back()).filter(|s| !s.is_empty()).unwrap_or("remote_media").to_string()
}

fn classify_platform(host: &str) -> String {
    let host = host.to_ascii_lowercase();
    let entries = [
        ("facebook", "Facebook"), ("fb.watch", "Facebook"), ("terabox", "Terabox"),
        ("1024tera", "Terabox"), ("pikpak", "PikPak"), ("dailymotion", "Dailymotion"),
        ("gofile", "Gofile"), ("mega.", "MEGA"), ("odysee", "Odysee"),
        ("dtube", "DTube"), ("ok.ru", "OK.ru"), ("rumble", "Rumble"),
        ("streamwish", "StreamWish"), ("dood", "DoodStream"), ("tribunvideo", "Tribun Video"),
        ("justpaste", "JustPaste"), ("mp4ko", "MP4ko"), ("videayo", "Videayo"),
        ("vidlyx", "Vidlyx"), ("up2file", "Up2File"), ("aceiwmg", "Ace Image"),
        ("slicndrive", "SlicnDrive"), ("slicadrivee", "SlicaDrive"), ("twimg.casa", "Twimg Media"),
        ("vimoy", "Vimoy"), ("vidqy", "Vidqy"), ("vdko", "VDKO"),
    ];
    entries.iter().find(|(needle, _)| host.contains(needle)).map(|(_, label)| (*label).to_string()).unwrap_or_else(|| host.to_string())
}

fn inspect_page(agent: &ureq::Agent, url: &Url) -> Result<PageInspection, String> {
    let mut request_url = validate_public_url(url.as_str())?;
    let mut redirects = 0usize;
    let response = loop {
        let response = agent
            .get(request_url.as_str())
            .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36")
            .set("Accept", "text/html,application/xhtml+xml,video/*,audio/*,image/*,*/*;q=0.8")
            .set("Range", "bytes=0-1249999")
            .call()
            .map_err(|error| format!("remote_link_http_error:{error}"))?;
        if (300..400).contains(&response.status()) {
            if redirects >= 8 {
                return Err("remote_link_redirect_limit".into());
            }
            let location = response
                .header("location")
                .ok_or_else(|| "remote_link_redirect_missing_location".to_string())?;
            request_url = validate_public_url(
                request_url
                    .join(location)
                    .map_err(|_| "remote_link_invalid_redirect".to_string())?
                    .as_str(),
            )?;
            redirects += 1;
            continue;
        }
        break response;
    };
    let final_url = validate_public_url(response.get_url())?;
    let mime_type = response.header("content-type").map(|value| value.split(';').next().unwrap_or(value).trim().to_ascii_lowercase());
    let content_length = response.header("content-length").and_then(|value| value.parse::<u64>().ok());
    let is_direct = is_direct_mime(mime_type.as_deref()) || media_extension(&final_url).is_some();
    if is_direct {
        let title = response.header("content-disposition")
            .and_then(|value| value.split("filename=").nth(1))
            .map(|value| value.trim_matches(['\'', '\"', ' ']).to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| final_url.path_segments().and_then(|mut values| values.next_back()).map(str::to_string))
            .unwrap_or_else(|| "remote_media".into());
        return Ok(PageInspection { final_url, title, mime_type, content_length, is_direct: true, links: vec![] });
    }
    let mut body = String::new();
    response.into_reader().take(MAX_HTML_BYTES).read_to_string(&mut body).map_err(|error| format!("remote_link_read_error:{error}"))?;
    let title = html_title(&body, &final_url);
    let links = collect_attr_values(&body, &final_url);
    Ok(PageInspection { final_url, title, mime_type, content_length, is_direct: false, links })
}

pub fn resolve_remote_link_deep(raw_url: String) -> Result<RemoteLinkResolution, String> {
    let source = validate_public_url(raw_url.trim())?;
    let agent = ureq::AgentBuilder::new()
        // Redirects are followed manually so every hop is checked by the SSRF
        // policy before a network connection is opened.
        .redirects(0)
        .timeout_connect(Duration::from_secs(8))
        .timeout_read(Duration::from_secs(12))
        .timeout_write(Duration::from_secs(8))
        .build();
    let mut queue = VecDeque::from([(source.clone(), 0usize)]);
    let mut visited = HashSet::new();
    let mut candidates = Vec::new();
    let mut root_final = source.clone();
    let mut root_title = source.path_segments().and_then(|mut values| values.next_back()).unwrap_or("remote_media").to_string();
    let mut root_mime = None;
    let mut root_length = None;
    let mut inspected_pages = 0usize;

    while let Some((next_url, depth)) = queue.pop_front() {
        if inspected_pages >= MAX_PAGES || candidates.len() >= MAX_CANDIDATES { break; }
        if !visited.insert(next_url.as_str().to_string()) { continue; }
        let inspection = match inspect_page(&agent, &next_url) {
            Ok(value) => value,
            Err(error) if depth == 0 => return Err(error),
            Err(_) => continue,
        };
        inspected_pages += 1;
        if depth == 0 {
            root_final = inspection.final_url.clone();
            root_title = inspection.title.clone();
            root_mime = inspection.mime_type.clone();
            root_length = inspection.content_length;
        }
        if inspection.is_direct {
            candidates.push(RemoteLinkCandidate {
                url: inspection.final_url.to_string(),
                kind: media_extension(&inspection.final_url).unwrap_or_else(|| "file".into()),
                mime_type: inspection.mime_type,
                content_length: inspection.content_length,
            });
            continue;
        }
        let mut scored = inspection.links;
        scored.sort_by_key(|url| {
            let direct = media_extension(url).is_some();
            let same_host = url.host_str() == inspection.final_url.host_str();
            (if direct { 0 } else { 1 }, if same_host { 0 } else { 1 })
        });
        scored.dedup_by(|a, b| a.as_str() == b.as_str());
        for link in scored.into_iter().take(14) {
            if validate_public_url(link.as_str()).is_err() { continue; }
            if media_extension(&link).is_some() {
                candidates.push(RemoteLinkCandidate {
                    kind: media_extension(&link).unwrap_or_else(|| "file".into()),
                    url: link.to_string(),
                    mime_type: None,
                    content_length: None,
                });
            } else if depth < MAX_DEPTH {
                queue.push_back((link, depth + 1));
            }
            if candidates.len() >= MAX_CANDIDATES { break; }
        }
    }
    candidates.sort_by(|a, b| a.url.cmp(&b.url));
    candidates.dedup_by(|a, b| a.url == b.url);
    let platform_name = classify_platform(source.host_str().unwrap_or("Remote Link"));
    Ok(RemoteLinkResolution {
        source_url: source.to_string(),
        final_url: root_final.to_string(),
        platform_name,
        title: root_title,
        mime_type: root_mime,
        content_length: root_length,
        requires_interaction: candidates.is_empty(),
        candidates,
        inspected_pages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_network_targets() {
        assert!(validate_public_url("http://127.0.0.1/file.mp4").is_err());
        assert!(validate_public_url("http://localhost/file.mp4").is_err());
        assert!(validate_public_url("file:///tmp/video.mp4").is_err());
    }

    #[test]
    fn extracts_relative_and_absolute_media_candidates() {
        let base = Url::parse("https://example.com/watch/1").unwrap();
        let html = r#"<video><source src="/cdn/a.mp4"></video><meta property="og:video" content="https://cdn.example.net/b.m3u8">"#;
        let links = collect_attr_values(html, &base);
        assert!(links.iter().any(|url| url.as_str() == "https://example.com/cdn/a.mp4"));
        assert!(links.iter().any(|url| url.as_str() == "https://cdn.example.net/b.m3u8"));
    }
}
