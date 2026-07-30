//! In-flight request deduplication manager.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

#[derive(Clone)]
pub struct InFlightTracker {
    in_flight: Arc<Mutex<HashMap<String, broadcast::Sender<Result<String, String>>>>>,
}

impl InFlightTracker {
    pub fn new() -> Self {
        Self {
            in_flight: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns Some(receiver) if already in flight, None if this caller should execute the request.
    pub async fn subscribe_or_execute(
        &self,
        key: &str,
    ) -> Option<broadcast::Receiver<Result<String, String>>> {
        let mut map = self.in_flight.lock().await;
        if let Some(tx) = map.get(key) {
            Some(tx.subscribe())
        } else {
            let (tx, _) = broadcast::channel(16);
            map.insert(key.to_string(), tx);
            None
        }
    }

    pub async fn complete(&self, key: &str, result: Result<String, String>) {
        let mut map = self.in_flight.lock().await;
        if let Some(tx) = map.remove(key) {
            let _ = tx.send(result);
        }
    }
}
