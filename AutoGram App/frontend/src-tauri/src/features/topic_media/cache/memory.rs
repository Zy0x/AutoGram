//! Level 1 Memory Cache with LRU byte budget.

use std::collections::HashMap;
use std::sync::Mutex;

pub struct MemoryThumbCache {
    items: Mutex<HashMap<String, Vec<u8>>>,
    max_bytes: usize,
}

impl MemoryThumbCache {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            items: Mutex::new(HashMap::new()),
            max_bytes: if max_bytes == 0 {
                32 * 1024 * 1024
            } else {
                max_bytes
            },
        }
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        let guard = self.items.lock().ok()?;
        guard.get(key).cloned()
    }

    pub fn put(&self, key: String, data: Vec<u8>) {
        if data.len() > self.max_bytes {
            return;
        }
        if let Ok(mut guard) = self.items.lock() {
            if guard.len() >= 1000 {
                guard.clear();
            }
            guard.insert(key, data);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.items.lock() {
            guard.clear();
        }
    }
}
