use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::io::Read;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;
use url::Url;

const MAX_HTML_BYTES: u64 = 1_250_000;
const MEDIA_PROBE_BYTES: u64 = 131_072;
const DISCOVERY_PAGE_BUDGET: usize = 6;
const MAX_DEPTH: usize = 8;
const MAX_QUEUE_ENTRIES: usize = 2_000;
const MAX_CANDIDATES_PER_BATCH: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLinkCandidate {
    pub url: String,
    pub source_url: String,
    pub parent_url: Option<String>,
    pub redirect_chain: Vec<String>,
    pub title: String,
    pub kind: String,
    pub mime_type: Option<String>,
    pub content_length: Option<u64>,
    pub verified: bool,
    pub validation: String,
    pub range_supported: bool,
    pub expires_at_ms: Option<u64>,
    pub is_downloadable: bool,
    pub is_streamable: bool,
    pub download_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDiscoveryQueueEntry {
    pub url: String,
    pub parent_url: Option<String>,
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLinkDiscoveryCursor {
    pub queue: Vec<RemoteDiscoveryQueueEntry>,
    pub visited: Vec<String>,
    pub root_final_url: String,
    pub root_title: String,
    pub root_mime_type: Option<String>,
    pub root_content_length: Option<u64>,
    pub inspected_pages: usize,
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
    pub discovery_cursor: Option<RemoteLinkDiscoveryCursor>,
    pub discovery_complete: bool,
    pub pending_count: usize,
    pub warnings: Vec<String>,
    pub blocker_reason: Option<String>,
}

#[derive(Debug)]
struct PageInspection {
    final_url: Url,
    redirect_chain: Vec<String>,
    title: String,
    mime_type: Option<String>,
    content_length: Option<u64>,
    is_direct: bool,
    detected_kind: Option<String>,
    links: Vec<Url>,
    validation: Option<String>,
    is_streamable: bool,
    range_supported: bool,
    blocker_reason: Option<String>,
}

/// Only expose expiry when the public URL itself uses a conventional unix
/// timestamp parameter.  A missing value means "unknown", never "permanent".
fn public_url_expiry_ms(url: &Url) -> Option<u64> {
    for (key, value) in url.query_pairs() {
        if !matches!(key.to_ascii_lowercase().as_str(), "expire" | "expires" | "expiry" | "exp") {
            continue;
        }
        let raw = value.parse::<u64>().ok()?;
        return Some(if raw < 10_000_000_000 { raw.saturating_mul(1000) } else { raw });
    }
    None
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

/// Used by the assisted inspector before it retains a URL reported by an
/// untrusted remote document. It performs no request, only the same URL/DNS
/// safety validation the crawler uses before every hop.
pub fn ensure_public_remote_url(raw: &str) -> Result<(), String> {
    validate_public_url(raw).map(|_| ())
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
        let brand = &bytes[8..12];
        return Some(if matches!(brand, b"avif" | b"avis") {
            "avif"
        } else {
            "mp4"
        });
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
    if trimmed.starts_with("WEBVTT") {
        return Some("vtt");
    }
    let mut subtitle_lines = trimmed.lines();
    if subtitle_lines
        .next()
        .is_some_and(|line| line.trim().parse::<u32>().is_ok())
        && subtitle_lines
            .next()
            .is_some_and(|line| line.contains("-->") && line.contains(':'))
    {
        return Some("srt");
    }
    if trimmed.starts_with("<?xml") && trimmed.to_ascii_lowercase().contains("<mpd")
        || trimmed.to_ascii_lowercase().starts_with("<mpd")
    {
        return Some("mpd");
    }
    None
}

fn declared_media_kind(mime: Option<&str>) -> Option<&'static str> {
    let mime = mime.unwrap_or("").to_ascii_lowercase();
    if mime.starts_with("video/") {
        return Some("video");
    }
    if mime.starts_with("audio/") {
        return Some("audio");
    }
    if mime.starts_with("image/") {
        return Some("image");
    }
    match mime.as_str() {
        "application/pdf" => Some("pdf"),
        "application/zip" | "application/x-zip-compressed" => Some("zip"),
        "application/vnd.apple.mpegurl" | "application/x-mpegurl" => Some("m3u8"),
        "application/dash+xml" => Some("mpd"),
        "text/vtt" | "application/x-subrip" => Some("subtitle"),
        _ => None,
    }
}

fn is_streamable_kind(kind: &str) -> bool {
    matches!(
        kind,
        "mp4"
            | "m4v"
            | "mov"
            | "webm"
            | "m3u8"
            | "mpd"
            | "mp3"
            | "m4a"
            | "aac"
            | "ogg"
            | "opus"
            | "wav"
            | "flac"
    )
}

fn looks_like_html(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let trimmed = text
        .trim_start_matches(['\u{feff}', ' ', '\t', '\r', '\n'])
        .to_ascii_lowercase();
    trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || trimmed.starts_with("<head")
        || trimmed.starts_with("<body")
        || trimmed.contains("<title>")
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
            if out.len() >= MAX_CANDIDATES_PER_BATCH * 3 {
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
            if out.len() >= MAX_CANDIDATES_PER_BATCH * 4 {
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
            if out.len() >= MAX_CANDIDATES_PER_BATCH * 4 {
                break;
            }
        }
    }

    // StreamRizz family pages embed the actual public CDN resource in a
    // base64 JSON token rather than a DOM `src`. Decode only that public
    // transport descriptor; authentication/session material is ignored.
    let mut cursor = 0usize;
    while let Some(relative) = lower[cursor..].find("embedtoken") {
        let after_key = cursor + relative + "embedtoken".len();
        let Some(first_quote_offset) = decoded[after_key..].find(['\'', '\"']) else {
            break;
        };
        let value_start = after_key + first_quote_offset + 1;
        let quote = decoded.as_bytes()[value_start - 1];
        let Some(value_end_offset) = decoded[value_start..].find(quote as char) else {
            break;
        };
        let value_end = value_start + value_end_offset;
        cursor = value_end.saturating_add(1);
        let token = decoded[value_start..value_end]
            .split('.')
            .next()
            .unwrap_or_default();
        if token.is_empty() || token.len() > 8192 {
            continue;
        }
        let normalized = token.replace('-', "+").replace('_', "/");
        let decoded_token = STANDARD
            .decode(&normalized)
            .or_else(|_| URL_SAFE.decode(token))
            .or_else(|_| URL_SAFE_NO_PAD.decode(token));
        let Ok(bytes) = decoded_token else { continue };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        let Some(rf) = value.get("rf").and_then(|field| field.as_str()) else {
            continue;
        };
        if rf.is_empty() || rf.len() > 4096 || rf.contains(['\r', '\n']) {
            continue;
        }
        if let Ok(url) = Url::parse(&format!("https://mp4-01.overfetch.video/{rf}")) {
            out.push(url);
        }
    }

    out.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    out.dedup_by(|a, b| a.as_str() == b.as_str());
    out
}

fn is_likely_media_host(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    host.contains("cdn")
        || host.contains("overfetch")
        || host.contains("googlevideo")
        || host.contains("slicedrive")
        || host.contains("aceimg")
        || host.contains("viidooy")
}

/// Hosts in this family have been observed returning advertising/upload HTML
/// for a URL shaped as `*.mp4`. They are not public player wrappers; crawling
/// their redirected landing page would turn site chrome (favicons, logos) into
/// misleading image candidates. A real media payload still passes normally.
fn blocks_html_disguised_as_direct_media(url: &Url) -> bool {
    url.host_str()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains("acegimg")
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
    let mut redirect_chain = vec![request_url.to_string()];
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
            redirect_chain.push(request_url.to_string());
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
    let has_range = response.header("content-range").is_some();
    let disposition_title = response
        .header("content-disposition")
        .and_then(|value| value.split("filename=").nth(1))
        .map(|value| value.trim_matches(['\'', '\"', ' ']).to_string())
        .filter(|value| !value.is_empty());
    let declared_kind = declared_media_kind(mime_type.as_deref());
    let read_limit = if declared_kind.is_some_and(|kind| kind != "subtitle") {
        MEDIA_PROBE_BYTES
    } else {
        MAX_HTML_BYTES
    };
    let mut payload = Vec::new();
    response
        .into_reader()
        .take(read_limit)
        .read_to_end(&mut payload)
        .map_err(|error| format!("remote_link_read_error:{error}"))?;
    let fingerprint_kind = fingerprint_media(&payload).map(str::to_string);
    // A suffix or a friendly Content-Type is not evidence by itself: wrapper
    // hosts commonly answer `.mp4` requests with HTML. Magic bytes are the
    // primary proof; text subtitle formats may use their declared MIME.
    let detected_kind = fingerprint_kind.or_else(|| {
        (!looks_like_html(&payload) && matches!(declared_kind, Some("subtitle")))
            .then_some("vtt".to_string())
    });
    if let Some(kind) = detected_kind {
        let title = disposition_title.unwrap_or_else(|| {
            final_url
                .path_segments()
                .and_then(|mut values| values.next_back())
                .filter(|value| !value.is_empty())
                .unwrap_or("remote_media")
                .to_string()
        });
        let is_streamable = is_streamable_kind(&kind) && has_range;
        return Ok(PageInspection {
            final_url,
            redirect_chain,
            title,
            mime_type,
            content_length,
            is_direct: true,
            detected_kind: Some(kind),
            links: vec![],
            validation: Some(if has_range {
                "magic+range".into()
            } else {
                "magic".into()
            }),
            is_streamable,
            range_supported: has_range,
            blocker_reason: None,
        });
    }
    let body = String::from_utf8_lossy(&payload).into_owned();
    let title = html_title(&body, &final_url);
    let links = collect_embedded_urls(&body, &final_url);
    let lower_body = body.to_ascii_lowercase();
    let blocker_reason = if lower_body.contains("cf-chl")
        || lower_body.contains("checking your browser")
        || lower_body.contains("just a moment")
    {
        Some("cloudflare_challenge".into())
    } else if lower_body.contains("captcha") {
        Some("captcha_required".into())
    } else if lower_body.contains("sign in") || lower_body.contains("login required") {
        Some("login_required".into())
    } else if lower_body.contains("drm") || lower_body.contains("widevine") {
        Some("drm_protected".into())
    } else {
        None
    };
    Ok(PageInspection {
        final_url,
        redirect_chain,
        title,
        mime_type,
        content_length,
        is_direct: false,
        detected_kind: None,
        links,
        validation: None,
        is_streamable: false,
        range_supported: false,
        blocker_reason,
    })
}

pub fn resolve_remote_link_deep(
    raw_url: String,
    cursor: Option<RemoteLinkDiscoveryCursor>,
) -> Result<RemoteLinkResolution, String> {
    let source = validate_public_url(raw_url.trim())?;
    let agent = ureq::AgentBuilder::new()
        // Redirects are followed manually so every hop is checked by the SSRF
        // policy before a network connection is opened.
        .redirects(0)
        .timeout_connect(Duration::from_secs(8))
        .timeout_read(Duration::from_secs(12))
        .timeout_write(Duration::from_secs(8))
        .build();

    let mut queue: VecDeque<RemoteDiscoveryQueueEntry>;
    let mut visited: HashSet<String>;
    let mut root_final: Url;
    let mut root_title: String;
    let mut root_mime: Option<String>;
    let mut root_length: Option<u64>;
    let mut inspected_pages: usize;

    if let Some(saved) = cursor {
        queue = saved.queue.into();
        visited = saved.visited.into_iter().collect();
        root_final = validate_public_url(&saved.root_final_url).unwrap_or_else(|_| source.clone());
        root_title = saved.root_title;
        root_mime = saved.root_mime_type;
        root_length = saved.root_content_length;
        inspected_pages = saved.inspected_pages;
    } else {
        queue = VecDeque::from([RemoteDiscoveryQueueEntry {
            url: source.to_string(),
            parent_url: None,
            depth: 0,
        }]);
        visited = HashSet::new();
        root_final = source.clone();
        root_title = source
            .path_segments()
            .and_then(|mut values| values.next_back())
            .unwrap_or("remote_media")
            .to_string();
        root_mime = None;
        root_length = None;
        inspected_pages = 0;
    }

    let mut candidates = Vec::new();
    let mut warnings = Vec::new();
    let mut blocker_reason = None;
    let mut pages_this_batch = 0usize;

    while let Some(next) = queue.pop_front() {
        if pages_this_batch >= DISCOVERY_PAGE_BUDGET || candidates.len() >= MAX_CANDIDATES_PER_BATCH
        {
            queue.push_front(next);
            break;
        }
        if next.depth > MAX_DEPTH {
            warnings.push("discovery_depth_limit".into());
            continue;
        }
        let next_url = match validate_public_url(&next.url) {
            Ok(url) => url,
            Err(_) => continue,
        };
        if !visited.insert(next_url.to_string()) {
            continue;
        }
        let inspection = match inspect_page(&agent, &next_url) {
            Ok(value) => value,
            Err(error) if next.depth == 0 => return Err(error),
            Err(_) => continue,
        };
        pages_this_batch += 1;
        inspected_pages += 1;
        if next.depth == 0 {
            root_final = inspection.final_url.clone();
            root_title = inspection.title.clone();
            root_mime = inspection.mime_type.clone();
            root_length = inspection.content_length;
        }
        if let Some(reason) = inspection.blocker_reason.clone() {
            blocker_reason.get_or_insert(reason);
        }
        if next.depth == 0
            && media_extension(&next_url).is_some()
            && !inspection.is_direct
            && blocks_html_disguised_as_direct_media(&next_url)
        {
            warnings.push("direct_url_resolved_to_html".into());
            blocker_reason.get_or_insert("direct_url_resolved_to_html".into());
            continue;
        }
        if inspection.is_direct {
            let kind = inspection
                .detected_kind
                .or_else(|| media_extension(&inspection.final_url))
                .unwrap_or_else(|| "file".into());
            let is_streamable = inspection.is_streamable;
            candidates.push(RemoteLinkCandidate {
                url: inspection.final_url.to_string(),
                source_url: source.to_string(),
                parent_url: next.parent_url,
                redirect_chain: inspection.redirect_chain,
                title: inspection.title,
                kind,
                mime_type: inspection.mime_type,
                content_length: inspection.content_length,
                verified: true,
                validation: inspection.validation.unwrap_or_else(|| "magic".into()),
                range_supported: inspection.range_supported,
                expires_at_ms: public_url_expiry_ms(&inspection.final_url),
                is_downloadable: true,
                is_streamable,
                download_only: !is_streamable,
            });
            continue;
        }

        let parent_url = inspection.final_url.to_string();
        let parent_host = inspection.final_url.host_str().map(str::to_ascii_lowercase);
        let mut scored = inspection.links;
        scored.sort_by_key(|url| {
            let direct = media_extension(url).is_some();
            let same_host = url.host_str().map(str::to_ascii_lowercase) == parent_host;
            (if direct { 0 } else { 1 }, if same_host { 0 } else { 1 })
        });
        scored.dedup_by(|a, b| a.as_str() == b.as_str());
        for link in scored {
            if queue.len() >= MAX_QUEUE_ENTRIES {
                warnings.push("discovery_queue_limit".into());
                break;
            }
            if validate_public_url(link.as_str()).is_err() {
                continue;
            }
            let same_host = link.host_str().map(str::to_ascii_lowercase) == parent_host;
            // Stay within the discovered site tree. A cross-origin link is
            // inspected only when it looks like a media source, not as a page
            // to recursively crawl through advertising or navigation sites.
            if same_host || media_extension(&link).is_some() || is_likely_media_host(&link) {
                queue.push_back(RemoteDiscoveryQueueEntry {
                    url: link.to_string(),
                    parent_url: Some(parent_url.clone()),
                    depth: next.depth + 1,
                });
            }
        }
    }

    candidates.sort_by(|a, b| a.url.cmp(&b.url));
    candidates.dedup_by(|a, b| a.url == b.url);
    warnings.sort();
    warnings.dedup();
    let discovery_complete = queue.is_empty();
    let pending_count = queue.len();
    let discovery_cursor = (!discovery_complete).then_some(RemoteLinkDiscoveryCursor {
        queue: queue.into(),
        visited: visited.into_iter().collect(),
        root_final_url: root_final.to_string(),
        root_title: root_title.clone(),
        root_mime_type: root_mime.clone(),
        root_content_length: root_length,
        inspected_pages,
    });
    let platform_name = classify_platform(source.host_str().unwrap_or("Remote Link"));
    Ok(RemoteLinkResolution {
        source_url: source.to_string(),
        final_url: root_final.to_string(),
        platform_name,
        title: root_title,
        mime_type: root_mime,
        content_length: root_length,
        requires_interaction: candidates.is_empty()
            && (blocker_reason.is_some() || discovery_complete),
        candidates,
        inspected_pages,
        discovery_cursor,
        discovery_complete,
        pending_count,
        warnings,
        blocker_reason,
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
        assert_eq!(fingerprint_media(b"\0\0\0\x18ftypavifmore"), Some("avif"));
        assert_eq!(fingerprint_media(b"\x89PNG\r\n\x1A\nrest"), Some("png"));
        assert_eq!(
            fingerprint_media(b"#EXTM3U\n#EXT-X-VERSION:3"),
            Some("m3u8")
        );
        assert_eq!(
            fingerprint_media(b"<?xml version=\"1.0\"?><MPD type=\"static\"></MPD>"),
            Some("mpd")
        );
        assert_eq!(
            fingerprint_media(b"1\n00:00:01,000 --> 00:00:02,000\nCaption"),
            Some("srt")
        );
        assert_eq!(fingerprint_media(b"<html>not media</html>"), None);
        assert!(looks_like_html(
            b"<!doctype html><html><body>wrapped mp4</body></html>"
        ));
    }

    #[test]
    fn an_mp4_filename_is_never_validation_evidence() {
        let named_mp4 = Url::parse("https://cdn.example.invalid/download.mp4").unwrap();
        assert_eq!(media_extension(&named_mp4), Some("mp4".into()));
        let wrapper = b"<!doctype html><html><title>Advertisement</title></html>";
        assert!(looks_like_html(wrapper));
        assert_eq!(fingerprint_media(wrapper), None);
    }

    #[test]
    fn blocks_known_html_disguised_as_acegimg_media() {
        assert!(blocks_html_disguised_as_direct_media(
            &Url::parse("http://cdn2.acegimg.com/fake.mp4").unwrap()
        ));
        assert!(!blocks_html_disguised_as_direct_media(
            &Url::parse("https://cdn4.cloud/real-wrapper.mp4").unwrap()
        ));
    }

    #[test]
    fn extracts_streamrizz_public_cdn_token_without_following_a_player_page() {
        let base = Url::parse("https://streamrizz.com/d/abc").unwrap();
        let token = STANDARD.encode(r#"{"rf":"public-rf-token"}"#);
        let html = format!("<script>var embedToken = '{token}.signature';</script>");
        let links = collect_embedded_urls(&html, &base);
        assert!(links
            .iter()
            .any(|url| url.as_str() == "https://mp4-01.overfetch.video/public-rf-token"));
    }

    #[test]
    fn cursor_is_serializable_without_session_material() {
        let cursor = RemoteLinkDiscoveryCursor {
            queue: vec![RemoteDiscoveryQueueEntry {
                url: "https://example.com/folder/next".into(),
                parent_url: Some("https://example.com/folder".into()),
                depth: 1,
            }],
            visited: vec!["https://example.com/folder".into()],
            root_final_url: "https://example.com/folder".into(),
            root_title: "folder".into(),
            root_mime_type: Some("text/html".into()),
            root_content_length: None,
            inspected_pages: 1,
        };
        let value = serde_json::to_string(&cursor).unwrap();
        assert!(!value.to_ascii_lowercase().contains("cookie"));
        assert!(!value.to_ascii_lowercase().contains("token"));
    }

    #[test]
    fn parses_total_length_from_range_response() {
        assert_eq!(content_range_total("bytes 0-1023/987654"), Some(987654));
        assert_eq!(content_range_total("bytes */*"), None);
    }

    #[test]
    fn extracts_conventional_signed_url_expiry_without_guessing() {
        let seconds = Url::parse("https://cdn.example/media.mp4?expire=1234").unwrap();
        let milliseconds = Url::parse("https://cdn.example/media.mp4?expires=1234567890123").unwrap();
        let unknown = Url::parse("https://cdn.example/media.mp4?signature=not-a-time").unwrap();
        assert_eq!(public_url_expiry_ms(&seconds), Some(1_234_000));
        assert_eq!(public_url_expiry_ms(&milliseconds), Some(1_234_567_890_123));
        assert_eq!(public_url_expiry_ms(&unknown), None);
    }
}
