use super::{extraction::{Candidate, Extraction, MAX_CANDIDATES}, model::KINDS, policy};
use scraper::{Html, Selector};
use serde::Deserialize;
use url::Url;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtractionRule {
    pub selector: String,
    pub attribute: String,
    pub kind: String,
    #[serde(default)]
    pub follow: bool,
}

pub fn validate(rules: &[ExtractionRule]) -> Result<(), String> {
    if rules.len() > 16 { return Err("remote_crawl_invalid_rules".into()); }
    for rule in rules {
        if rule.selector.is_empty() || rule.selector.len() > 500 || rule.attribute.is_empty()
            || rule.attribute.len() > 64 || !rule.attribute.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            || !KINDS.contains(&rule.kind.as_str()) || (rule.follow && rule.kind != "page")
            || Selector::parse(&rule.selector).is_err() {
            return Err("remote_crawl_invalid_rules".into());
        }
    }
    Ok(())
}

/// A declarative rule can only read an attribute from parsed markup. No scripts,
/// expressions, filesystem access or executable plugins are evaluated.
pub fn extract(source: &Url, body: &str, rules: &[ExtractionRule], result: &mut Extraction) {
    if rules.is_empty() { return; }
    let document = Html::parse_document(body);
    for rule in rules {
        let Ok(selector) = Selector::parse(&rule.selector) else { continue; };
        for element in document.select(&selector) {
            if result.candidates.len() >= MAX_CANDIDATES { result.limited = true; return; }
            let Some(raw) = element.attr(rule.attribute.as_str()) else { continue; };
            match policy::resolve(source, raw) {
                Ok(url) => {
                    let kind = policy::kind(&url, "", &rule.kind);
                    let traverse = rule.follow && kind == "page";
                    result.candidates.push(Candidate { url, kind, traverse, selected: true });
                }
                Err(_) => result.blocked += 1,
            }
        }
    }
}
