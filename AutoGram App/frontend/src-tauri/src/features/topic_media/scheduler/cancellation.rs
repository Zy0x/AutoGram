//! Scoped Cancellation Token Manager for Navigation & Task Abort.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct ScopedCancellationManager {
    tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl ScopedCancellationManager {
    pub fn new() -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn get_or_create_token(&self, scope_key: &str) -> CancellationToken {
        let mut map = self.tokens.lock().await;
        if let Some(token) = map.get(scope_key) {
            token.clone()
        } else {
            let token = CancellationToken::new();
            map.insert(scope_key.to_string(), token.clone());
            token
        }
    }

    pub async fn cancel_scope(&self, scope_key: &str) {
        let mut map = self.tokens.lock().await;
        if let Some(token) = map.remove(scope_key) {
            token.cancel();
        }
    }
}
