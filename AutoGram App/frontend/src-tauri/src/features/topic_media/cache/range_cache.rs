//! Range cache for partial document byte-range reader.

use bytes::Bytes;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct RangeCache {
    ranges: Mutex<HashMap<(u64, usize), Bytes>>,
}

impl RangeCache {
    pub fn new() -> Self {
        Self {
            ranges: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, offset: u64, length: usize) -> Option<Bytes> {
        let guard = self.ranges.lock().ok()?;
        guard.get(&(offset, length)).cloned()
    }

    pub fn put(&self, offset: u64, length: usize, data: Bytes) {
        if let Ok(mut guard) = self.ranges.lock() {
            guard.insert((offset, length), data);
        }
    }
}
