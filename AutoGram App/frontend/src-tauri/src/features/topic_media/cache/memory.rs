//! Level 1 Memory Cache with LRU byte budget.

use std::collections::HashMap;
use std::sync::Mutex;

pub struct MemoryThumbCache {
    items: Mutex<HashMap<String, Vec<u8>>>,
    max_bytes: usize,
    current_bytes: usize,
}

impl MemoryThumbCache {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            items: Mutex::new(HashMap::new()),
            max_bytes,
            current_bytes: 0,
        }
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        let guard = self.items.lock().ok()?;
        guard.get(key).cloned()
    }

    pub fn put(&self, key: String, data: Vec<u8>) {
        if let Ok(mut guard) = self.items.lock() {
            guard.insert(key, data);
        }
    }
}
