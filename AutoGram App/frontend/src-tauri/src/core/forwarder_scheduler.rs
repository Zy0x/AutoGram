//! Local-first scheduler primitives for Forwarder V2.
//! The device owns occurrence calculation; cloud only relays a command.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScheduleSpec {
    pub rrule: String,
    pub timezone: String,
    #[serde(default)]
    pub misfire_policy: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatchUpDecision { RunOnce, Wait, None }

pub fn validate_schedule(spec: &ScheduleSpec) -> Result<(), String> {
    if spec.rrule.trim().is_empty() { return Err("RRULE is required".into()); }
    let mut freq = false;
    for part in spec.rrule.split(';') {
        let mut kv = part.splitn(2, '=');
        let key = kv.next().unwrap_or("").trim().to_ascii_uppercase();
        let value = kv.next().unwrap_or("").trim();
        if key == "FREQ" && matches!(value, "MINUTELY"|"HOURLY"|"DAILY"|"WEEKLY"|"MONTHLY"|"YEARLY") { freq = true; }
        if key == "INTERVAL" && value.parse::<u32>().ok().filter(|v| *v > 0).is_none() { return Err("RRULE INTERVAL must be a positive integer".into()); }
        if key == "COUNT" && value.parse::<u32>().ok().filter(|v| *v > 0).is_none() { return Err("RRULE COUNT must be a positive integer".into()); }
    }
    if !freq { return Err("RRULE must contain a supported FREQ".into()); }
    if spec.timezone.trim().is_empty() || !spec.timezone.contains('/') { return Err("timezone must be an IANA name".into()); }
    Ok(())
}

/// Apply the product default: one catch-up execution after an offline period.
/// Missed occurrences are intentionally coalesced to avoid a burst on reconnect.
pub fn catch_up_decision(last_run: Option<DateTime<Utc>>, now: DateTime<Utc>, online: bool, misfire_policy: &str) -> CatchUpDecision {
    if !online { return CatchUpDecision::None; }
    match (last_run, misfire_policy.to_ascii_lowercase().as_str()) {
        (Some(last), "one_catch_up"|"catch_up"|"fire_once") if now > last + Duration::seconds(1) => CatchUpDecision::RunOnce,
        (None, _) => CatchUpDecision::RunOnce,
        _ => CatchUpDecision::Wait,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn validates_rrule() {
        assert!(validate_schedule(&ScheduleSpec { rrule:"FREQ=DAILY;INTERVAL=1".into(), timezone:"Asia/Singapore".into(), misfire_policy:"one_catch_up".into() }).is_ok());
        assert!(validate_schedule(&ScheduleSpec { rrule:"INTERVAL=0".into(), timezone:"Asia/Singapore".into(), misfire_policy:"".into() }).is_err());
    }
    #[test] fn coalesces_missed_runs() {
        let now = Utc::now();
        assert_eq!(catch_up_decision(Some(now - Duration::hours(5)), now, true, "one_catch_up"), CatchUpDecision::RunOnce);
        assert_eq!(catch_up_decision(Some(now - Duration::hours(5)), now, false, "one_catch_up"), CatchUpDecision::None);
    }
}
