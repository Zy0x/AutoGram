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
    detected_kind: Option<String>,
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
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
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
    let host = parsed
        .host_str()
        .ok_or_else(|| "remote_link_missing_host".to_string())?;
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
            if addresses
                .into_iter()
                .any(|address| is_private_ip(address.ip()))
            {
                return Err("remote_link_private_host_blocked".into());
            }
        }
    }
    Ok(parsed)
}

fn media_extension(url: &Url) -> Option<String> {
    let name = url.path_segments()?.next_back()?.to_ascii_lowercase();
    let ext = name
        .rsplit_once('.')?
        .1
        .split(['?', '#'])
        .next()?
        .to_string();
    const KNOWN: &[&str] = &[
        "mp4", "m4v", "mov", "webm", "mkv", "avi", "flv", "m3u8", "mpd", "jpg", "jpeg", "png",
        "webp", "gif", "avif", "mp3", "m4a", "aac", "ogg", "opus", "wav", "flac", "zip", "rar",
        "7z", "pdf",
    ];
    KNOWN.contains(&ext.as_str()).then_some(ext)
}

fn content_range_total(value: &str) -> Option<u64> {
    value
        .rsplit_once('/')
        .and_then(|(_, total)| total.trim().parse::<u64>().ok())
}

/// Identify the actual payload from a bounded prefix. Remote hosts frequently
/// return `application/octet-stream` or a path without an extension, so URL
/// names and response headers cannot be authoritative.
fn fingerprint_media(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\xFF\xD8\xFF") {
        return Some("jpg");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1A\n") {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return Some("mp4");
    }
    if bytes.starts_with(b"\x1A\x45\xDF\xA3") {
        let probe = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]).to_ascii_lowercase();
        return Some(if probe.contains("webm") {
            "webm"
        } else {
            "mkv"
        });
    }
    if bytes.starts_with(b"ID3")
        || bytes
            .get(..2)
            .is_some_and(|head| head[0] == 0xFF && (head[1] & 0xE0) == 0xE0)
    {
        return Some("mp3");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("wav");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("flac");
    }
    if bytes.starts_with(b"OggS") {
        return Some("ogg");
    }
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        return Some("zip");
    }
    if bytes.starts_with(b"Rar!\x1A\x07") {
        return Some("rar");
    }
    if bytes.starts_with(b"7z\xBC\xAF\x27\x1C") {
        return Some("7z");
    }
    if bytes.starts_with(b"%PDF-") {
        return Some("pdf");
    }

    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let trimmed = text.trim_start_matches(['\u{feff}', ' ', '\t', '\r', '\n']);
    if trimmed.starts_with("#EXTM3U") {
        return Some("m3u8");
    }
    if trimmed.starts_with("<?xml") && trimmed.to_ascii_lowercase().contains("<mpd")
        || trimmed.to_ascii_lowercase().starts_with("<mpd")
    {
        return Some("mpd");
    }
    None
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
    for attr in [
        "src", "href", "content", "data-url", "data-src", "file", "url",
    ] {
        let needle = format!("{attr}=");
        let mut cursor = 0usize;
        while let Some(relative) = lower[cursor..].find(&needle) {
            let mut start = cursor + relative + needle.len();
            while html
                .as_bytes()
                .get(start)
                .is_some_and(|b| b.is_ascii_whitespace())
            {
                start += 1;
            }
            let quote = html.as_bytes().get(start).copied();
            let (value_start, terminator) = match quote {
                Some(b'\'') | Some(b'\"') => (start + 1, quote.unwrap()),
                _ => (start, b' '),
            };
            let bytes = html.as_bytes();
            let mut end = value_start;
            while end < bytes.len() {
                let byte = bytes[end];
                if byte == terminator
                    || (terminator == b' '
                        && (byte.is_ascii_whitespace() || byte == b'>' || byte == b','))
                {
                    break;
                }
                end += 1;
            }
            cursor = end.saturating_add(1);
            if end <= value_start || end - value_start > 4096 {
                continue;
            }
            let value = decode_html_value(&html[value_start..end]);
            if value.starts_with("data:")
                || value.starts_with("javascript:")
                || value.starts_with('#')
            {
                continue;
            }
            if let Ok(url) = base.join(value.trim()) {
                if matches!(url.scheme(), "http" | "https") {
                    out.push(url);
                }
            }
            if out.len() >= MAX_CANDIDATES * 3 {
                return out;
            }
        }
    }
    out
}

fn collect_embedded_urls(html: &str, base: &Url) -> Vec<Url> {
    let decoded = decode_html_value(html);
    let lower = decoded.to_ascii_lowercase();
    let mut out = collect_attr_values(&decoded, base);

    // Player configs and JSON payloads commonly expose their source as a
    // quoted value instead of a DOM attribute: {"videoUrl":"..."} or
    // `file: "..."`. Keep parsing bounded and validate every candidate later.
    for key in [
        "videourl", "mediaurl", "file", "source", "src", "stream", "playlist", "url",
    ] {
        let mut cursor = 0usize;
        while let Some(relative) = lower[cursor..].find(key) {
            let key_end = cursor + relative + key.len();
            let Some(separator_offset) =
                lower[key_end..].find(|character: char| character == ':' || character == '=')
            else {
                break;
            };
            let mut value_start = key_end + separator_offset + 1;
            while decoded
                .as_bytes()
                .get(value_start)
                .is_some_and(|byte| byte.is_ascii_whitespace() || *byte == b'\'' || *byte == b'"')
            {
                value_start += 1;
            }
            let bytes = decoded.as_bytes();
            let mut end = value_start;
            while end < bytes.len()
                && !matches!(bytes[end], b'\'' | b'"' | b'<' | b'>' | b',' | b'}')
                && !bytes[end].is_ascii_whitespace()
            {
                end += 1;
            }
            cursor = end.saturating_add(1);
            if end <= value_start || end - value_start > 4096 {
                continue;
            }
            if let Ok(url) = base.join(decoded[value_start..end].trim()) {
                if matches!(url.scheme(), "http" | "https") {
                    out.push(url);
                }
            }
            if out.len() >= MAX_CANDIDATES * 4 {
                break;
            }
        }
    }

    // Last-resort extraction for absolute URLs embedded in script blobs.
    for scheme in ["https://", "http://"] {
        let mut cursor = 0usize;
        while let Some(relative) = lower[cursor..].find(scheme) {
            let start = cursor + relative;
            let bytes = decoded.as_bytes();
            let mut end = start;
            while end < bytes.len()
                && !matches!(
                    bytes[end],
                    b'\'' | b'"' | b'<' | b'>' | b' ' | b'\r' | b'\n'
                )
            {
                end += 1;
            }
            cursor = end.saturating_add(1);
            if end > start && end - start <= 4096 {
                if let Ok(url) = Url::parse(decoded[start..end].trim_end_matches([';', ',', ')'])) {
                    out.push(url);
                }
            }
            if out.len() >= MAX_CANDIDATES * 4 {
                break;
            }
        }
    }

    out.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    out.dedup_by(|a, b| a.as_str() == b.as_str());
    out
}

fn html_title(html: &str, fallback: &Url) -> String {
    let lower = html.to_ascii_lowercase();
    if let (Some(start), Some(end)) = (lower.find("<title"), lower.find("</title>")) {
        if end > start {
            if let Some(gt) = html[start..end].find('>') {
                let value = html[start + gt + 1..end].trim();
                if !value.is_empty() {
                    return decode_html_value(value);
                }
            }
        }
    }
    fallback
        .path_segments()
        .and_then(|mut values| values.next_back())
        .filter(|s| !s.is_empty())
        .unwrap_or("remote_media")
        .to_string()
}

fn classify_platform(host: &str) -> String {
    let host = host.to_ascii_lowercase();
    let entries = [
        ("facebook", "Facebook"),
        ("fb.watch", "Facebook"),
        ("streamrizz", "StreamRizz"),
        ("overfetch", "Overfetch"),
        ("vidoy", "Vidoy"),
        ("terabox", "Terabox"),
        ("1024tera", "Terabox"),
        ("pikpak", "PikPak"),
        ("dailymotion", "Dailymotion"),
        ("gofile", "Gofile"),
        ("mega.", "MEGA"),
        ("odysee", "Odysee"),
        ("dtube", "DTube"),
        ("ok.ru", "OK.ru"),
        ("rumble", "Rumble"),
        ("streamwish", "StreamWish"),
        ("dood", "DoodStream"),
        ("tribunvideo", "Tribun Video"),
        ("justpaste", "JustPaste"),
        ("mp4ko", "MP4ko"),
        ("videayo", "Videayo"),
        ("vidlyx", "Vidlyx"),
        ("up2file", "Up2File"),
        ("aceiwmg", "Ace Image"),
        ("slicndrive", "SlicnDrive"),
        ("slicadrivee", "SlicaDrive"),
        ("twimg.casa", "Twimg Media"),
        ("vimoy", "Vimoy"),
        ("vidqy", "Vidqy"),
        ("vdko", "VDKO"),
    ];
    entries
        .iter()
        .find(|(needle, _)| host.contains(needle))
        .map(|(_, label)| (*label).to_string())
        .unwrap_or_else(|| host.to_string())
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
    let mime_type = response.header("content-type").map(|value| {
        value
            .split(';')
            .next()
            .unwrap_or(value)
            .trim()
            .to_ascii_lowercase()
    });
    let content_length = response
        .header("content-range")
        .and_then(content_range_total)
        .or_else(|| {
            response
                .header("content-length")
                .and_then(|value| value.parse::<u64>().ok())
        });
    let header_or_path_is_direct =
        is_direct_mime(mime_type.as_deref()) || media_extension(&final_url).is_some();
    if header_or_path_is_direct {
        let detected_kind = media_extension(&final_url);
        let title = response
            .header("content-disposition")
            .and_then(|value| value.split("filename=").nth(1))
            .map(|value| value.trim_matches(['\'', '\"', ' ']).to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                final_url
                    .path_segments()
                    .and_then(|mut values| values.next_back())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "remote_media".into());
        return Ok(PageInspection {
            final_url,
            title,
            mime_type,
            content_length,
            is_direct: true,
            detected_kind,
            links: vec![],
        });
    }
    let mut payload = Vec::new();
    response
        .into_reader()
        .take(MAX_HTML_BYTES)
        .read_to_end(&mut payload)
        .map_err(|error| format!("remote_link_read_error:{error}"))?;
    if let Some(kind) = fingerprint_media(&payload) {
        let title = final_url
            .path_segments()
            .and_then(|mut values| values.next_back())
            .filter(|value| !value.is_empty())
            .unwrap_or("remote_media")
            .to_string();
        return Ok(PageInspection {
            final_url,
            title,
            mime_type,
            content_length,
            is_direct: true,
            detected_kind: Some(kind.to_string()),
            links: vec![],
        });
    }
    let body = String::from_utf8_lossy(&payload).into_owned();
    let title = html_title(&body, &final_url);
    let links = collect_embedded_urls(&body, &final_url);
    Ok(PageInspection {
        final_url,
        title,
        mime_type,
        content_length,
        is_direct: false,
        detected_kind: None,
        links,
    })
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
    let mut root_title = source
        .path_segments()
        .and_then(|mut values| values.next_back())
        .unwrap_or("remote_media")
        .to_string();
    let mut root_mime = None;
    let mut root_length = None;
    let mut inspected_pages = 0usize;

    while let Some((next_url, depth)) = queue.pop_front() {
        if inspected_pages >= MAX_PAGES || candidates.len() >= MAX_CANDIDATES {
            break;
        }
        if !visited.insert(next_url.as_str().to_string()) {
            continue;
        }
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
                kind: inspection
                    .detected_kind
                    .or_else(|| media_extension(&inspection.final_url))
                    .unwrap_or_else(|| "file".into()),
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
            if validate_public_url(link.as_str()).is_err() {
                continue;
            }
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
            if candidates.len() >= MAX_CANDIDATES {
                break;
            }
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
        let links = collect_embedded_urls(html, &base);
        assert!(links
            .iter()
            .any(|url| url.as_str() == "https://example.com/cdn/a.mp4"));
        assert!(links
            .iter()
            .any(|url| url.as_str() == "https://cdn.example.net/b.m3u8"));
    }

    #[test]
    fn extracts_media_from_player_json_and_script_blobs() {
        let base = Url::parse("https://wrapper.example/e/abc").unwrap();
        let html = r#"<script>window.player={"videoUrl":"https:\/\/cdn.example.net\/secret","file":"/stream/master.m3u8"};</script>"#;
        let links = collect_embedded_urls(html, &base);
        assert!(links
            .iter()
            .any(|url| url.as_str() == "https://cdn.example.net/secret"));
        assert!(links
            .iter()
            .any(|url| url.as_str() == "https://wrapper.example/stream/master.m3u8"));
    }

    #[test]
    fn fingerprints_extensionless_media_payloads() {
        assert_eq!(fingerprint_media(b"\0\0\0\x18ftypisommore"), Some("mp4"));
        assert_eq!(fingerprint_media(b"\x89PNG\r\n\x1A\nrest"), Some("png"));
        assert_eq!(
            fingerprint_media(b"#EXTM3U\n#EXT-X-VERSION:3"),
            Some("m3u8")
        );
        assert_eq!(fingerprint_media(b"<html>not media</html>"), None);
    }

    #[test]
    fn parses_total_length_from_range_response() {
        assert_eq!(content_range_total("bytes 0-1023/987654"), Some(987654));
        assert_eq!(content_range_total("bytes */*"), None);
    }
}
