use super::policy::{kind, resolve};
use scraper::{Html, Selector};
use url::Url;

pub const MAX_CANDIDATES: usize = 10000;
#[derive(Debug)]
pub struct Candidate { pub url: Url, pub kind: String, pub traverse: bool, pub selected: bool }
pub struct Extraction { pub candidates: Vec<Candidate>, pub blocked: usize, pub limited: bool }

// Selector applies to extracted results. Navigation stays independent so a selector
// for images does not accidentally prevent discovery on subsequent pages.
pub fn extract(source: &Url, body: &str, selector: &str) -> Result<Extraction, String> {
    let document = Html::parse_document(body);
    let filter = if selector.is_empty() { None } else {
        Some(Selector::parse(selector).map_err(|_| "remote_crawl_invalid_selector")?)
    };
    let base_selector = Selector::parse("base[href]").unwrap();
    let base = document.select(&base_selector).next().and_then(|e| e.attr("href"))
        .and_then(|href| resolve(source, href).ok()).unwrap_or_else(|| source.clone());
    let elements = Selector::parse("a[href],area[href],img,video,audio,source,meta,enclosure,link[href]").unwrap();
    let mut result = Extraction { candidates: Vec::new(), blocked: 0, limited: false };
    for element in document.select(&elements) {
        let selected = filter.as_ref().is_none_or(|s| s.matches(&element));
        let name = element.value().name();
        let mut add = |raw: &str, hint: &str, navigate: bool| {
            if result.candidates.len() >= MAX_CANDIDATES { result.limited = true; return; }
            match resolve(&base, raw) {
                Ok(url) => {
                    let mime = element.attr("type").unwrap_or("");
                    let kind = kind(&url, mime, hint);
                    let traverse = navigate && kind == "page";
                    result.candidates.push(Candidate { url, kind, traverse, selected });
                }
                Err(_) => result.blocked += 1,
            }
        };
        match name {
            "a" | "area" => add(element.attr("href").unwrap_or(""), "page", true),
            "img" | "video" | "audio" | "source" => {
                let hint = match name {
                    "img" => "image", "video" => "video", "audio" => "audio",
                    _ => element.ancestors().filter_map(scraper::ElementRef::wrap)
                        .find_map(|p| match p.value().name() { "audio" => Some("audio"), "picture" => Some("image"), "video" => Some("video"), _ => None }).unwrap_or("other"),
                };
                for attr in ["src", "data-src", "data-original", "data-lazy-src"] {
                    if let Some(raw) = element.attr(attr) { add(raw, hint, false); }
                }
                if let Some(raw) = element.attr("poster") { add(raw, "image", false); }
                for attr in ["srcset", "data-srcset"] {
                    if let Some(raw) = element.attr(attr) {
                        for value in srcset(raw).take(MAX_CANDIDATES + 1) { add(value, "image", false); }
                    }
                }
            }
            "meta" => {
                let property = element.attr("property").or_else(|| element.attr("name")).unwrap_or("");
                let hint = match property {
                    "og:image" | "og:image:url" | "og:image:secure_url" | "twitter:image" => Some("image"),
                    "og:video" | "og:video:url" | "og:video:secure_url" => Some("video"),
                    "og:audio" | "og:audio:url" | "og:audio:secure_url" => Some("audio"),
                    _ => None,
                };
                if let (Some(raw), Some(hint)) = (element.attr("content"), hint) { add(raw, hint, false); }
            }
            // Basic RSS/Atom enclosures, parsed tolerantly as markup, not a full XML feed reader.
            "enclosure" => { if let Some(raw) = element.attr("url") { add(raw, "other", false); } }
            "link" if element.attr("rel") == Some("enclosure") => {
                if let Some(raw) = element.attr("href") { add(raw, "other", false); }
            }
            _ => (),
        }
        if result.limited { break; }
    }
    Ok(result)
}

// Preserve commas inside URL tokens (including signed query parameters). A comma
// at a token's end is a candidate separator; descriptors end at the next comma.
fn srcset(mut input: &str) -> impl Iterator<Item = &str> {
    std::iter::from_fn(move || {
        input = input.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == ',');
        if input.is_empty() { return None; }
        let end = input.find(|c: char| c.is_ascii_whitespace()).unwrap_or(input.len());
        let token = &input[..end];
        input = &input[end..];
        if !token.ends_with(',') {
            input = input.split_once(',').map(|(_, rest)| rest).unwrap_or("");
        }
        Some(token.trim_end_matches(','))
    })
}
