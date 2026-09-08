use regex::{Regex, RegexBuilder};
use std::time::Duration;
use url::Url;

pub const ROBOTS_BYTES: usize = 512 * 1024;
const MAX_RULES: usize = 2048;
#[derive(Default)]
pub struct Rules { rules: Vec<(Regex, usize, bool)>, pub delay: Duration, deny: bool }
impl Rules {
    pub fn deny_all() -> Self { Self { deny: true, ..Self::default() } }
    pub fn allows(&self, url: &Url) -> bool {
        if self.deny { return false; }
        let path = &url[url::Position::BeforePath..url::Position::AfterQuery];
        self.rules.iter().filter(|(r, _, _)| r.is_match(path))
            .max_by_key(|(_, len, allow)| (*len, *allow)).is_none_or(|(_, _, allow)| *allow)
    }
}

// Basic robots policy: most-specific user-agent group, longest allow/disallow
// match (allow wins ties), * and terminal $, and crawl-delay. No claim of full
// RFC 9309 octet normalization; malformed/oversized rules fail closed.
pub fn parse(text: &str) -> Rules {
    #[derive(Default)]
    struct Group { agents: Vec<String>, lines: Vec<(String, String)> }
    let mut groups = Vec::new();
    let mut group = Group::default();
    let mut count = 0;
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim().trim_start_matches('\u{feff}');
        let Some((key, value)) = line.split_once(':') else { continue; };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        count += 1;
        if count > MAX_RULES || value.len() > 2048 { return Rules::deny_all(); }
        if key == "user-agent" {
            if !group.lines.is_empty() { groups.push(group); group = Group::default(); }
            group.agents.push(value.to_ascii_lowercase());
        } else if !group.agents.is_empty() {
            group.lines.push((key, value.to_string()));
        }
    }
    groups.push(group);
    let score = |g: &Group| g.agents.iter().filter_map(|a| {
        if a == "*" { Some(0) } else if !a.is_empty() && "autogramcrawler".contains(a.as_str()) { Some(a.len()) } else { None }
    }).max();
    let best = groups.iter().filter_map(&score).max();
    let mut rules = Rules::default();
    for group in groups.iter().filter(|g| best.is_some() && score(g) == best) {
        for (key, value) in &group.lines {
            if key == "crawl-delay" {
                let Ok(seconds) = value.parse::<f64>() else { return Rules::deny_all(); };
                if !seconds.is_finite() || !(0.0..=300.0).contains(&seconds) { return Rules::deny_all(); }
                rules.delay = rules.delay.max(Duration::from_secs_f64(seconds));
            } else if matches!(key.as_str(), "allow" | "disallow") && !value.is_empty() {
                let exact = value.ends_with('$');
                let value = if exact { &value[..value.len()-1] } else { value.as_str() };
                let expression = format!("^{}{}", value.split('*').map(regex::escape).collect::<Vec<_>>().join(".*"), if exact { "$" } else { "" });
                match RegexBuilder::new(&expression).size_limit(64 * 1024).dfa_size_limit(64 * 1024).build() {
                    Ok(regex) => rules.rules.push((regex, value.bytes().filter(|b| *b != b'*').count(), key == "allow")),
                    Err(_) => return Rules::deny_all(),
                }
            }
        }
    }
    rules
}
