use serde::Deserialize;
use std::{collections::BTreeMap, net::IpAddr};
use url::Url;

#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkOptions {
    pub user_agent: String,
    pub headers: BTreeMap<String, String>,
    pub proxy_url: String,
    pub timeout_seconds: u64,
    pub retries: u32,
}

impl Default for NetworkOptions {
    fn default() -> Self {
        Self { user_agent: "AutoGramCrawler/1.0".into(), headers: BTreeMap::new(),
            proxy_url: String::new(), timeout_seconds: 15, retries: 2 }
    }
}

impl NetworkOptions {
    pub fn validate(&self) -> Result<(), String> {
        if self.user_agent.trim().is_empty() || self.user_agent.len() > 512
            || !self.user_agent.is_ascii() || self.user_agent.chars().any(char::is_control)
            || !(5..=120).contains(&self.timeout_seconds) || self.retries > 5 || self.headers.len() > 5 {
            return Err("remote_crawl_invalid_network".into());
        }
        let mut names = std::collections::HashSet::new();
        for (name, value) in &self.headers {
            let lower = name.to_ascii_lowercase();
            if !["accept", "accept-language", "referer", "origin", "cache-control"].contains(&lower.as_str())
                || !names.insert(lower.clone()) || value.len() > 2048 || !value.is_ascii()
                || value.chars().any(char::is_control) {
                return Err("remote_crawl_invalid_headers".into());
            }
            if matches!(lower.as_str(), "referer" | "origin") {
                super::policy::parse_url(value).map_err(|_| "remote_crawl_invalid_headers")?;
            }
        }
        if !self.proxy_url.is_empty() { self.proxy()?; }
        Ok(())
    }

    /// The proxy is user-selected infrastructure. Only this explicit endpoint
    /// may be loopback; destination validation is never relaxed for a proxy.
    pub fn proxy(&self) -> Result<Url, String> {
        let fail = || String::from("remote_crawl_invalid_proxy");
        if self.proxy_url.len() > 4096 || self.proxy_url.chars().any(char::is_control) { return Err(fail()); }
        let url = Url::parse(&self.proxy_url).map_err(|_| fail())?;
        if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some()
            || url.port().is_none() || url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
            return Err(fail());
        }
        let loopback = url.host_str().is_some_and(|h| h.trim_matches(['[', ']'])
            .parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()));
        if !loopback { super::policy::parse_url(url.as_str()).map_err(|_| fail())?; }
        Ok(url)
    }
}
