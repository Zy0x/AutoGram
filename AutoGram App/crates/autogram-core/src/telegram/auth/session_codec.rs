//! Versioned envelope owns transport material only; peer caches are rebuilt from Telegram.
use grammers_session::{types::DcOption, SessionData};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;

#[derive(Serialize, Deserialize)]
struct TransportSnapshot {
    home_dc: i32,
    dc_options: HashMap<i32, DcOption>,
}

pub fn serialize<S: Serializer>(data: &SessionData, serializer: S) -> Result<S::Ok, S::Error> {
    TransportSnapshot {
        home_dc: data.home_dc,
        dc_options: data.dc_options.clone(),
    }
    .serialize(serializer)
}
pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<SessionData, D::Error> {
    let snapshot = TransportSnapshot::deserialize(deserializer)?;
    if !(1..=5).contains(&snapshot.home_dc)
        || snapshot.dc_options.len() > 10
        || !snapshot
            .dc_options
            .get(&snapshot.home_dc)
            .is_some_and(|option| option.auth_key.is_some())
    {
        return Err(serde::de::Error::custom("invalid_transport_snapshot"));
    }
    Ok(SessionData {
        home_dc: snapshot.home_dc,
        dc_options: snapshot.dc_options,
        ..SessionData::default()
    })
}
