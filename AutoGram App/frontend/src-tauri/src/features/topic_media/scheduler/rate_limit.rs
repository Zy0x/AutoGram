//! Rate limiting and backoff token bucket for MTProto requests.

use std::time::Duration;

pub struct AdaptiveBackoff {
    current_delay: Duration,
    max_delay: Duration,
}

impl AdaptiveBackoff {
    pub fn new(initial: Duration, max: Duration) -> Self {
        Self {
            current_delay: initial,
            max_delay: max,
        }
    }

    pub fn reset(&mut self, initial: Duration) {
        self.current_delay = initial;
    }

    pub fn next_backoff(&mut self) -> Duration {
        let delay = self.current_delay;
        self.current_delay = (self.current_delay * 2).min(self.max_delay);
        delay
    }
}
