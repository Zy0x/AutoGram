//! Retry & Backoff Policy Engine
//! Provides exponential backoff with jitter and max retries calculation.

use super::error_classifier::ErrorClass;

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 5,
            base_delay_ms: 1000,
            max_delay_ms: 60_000,
        }
    }
}

impl RetryPolicy {
    pub fn calculate_backoff(&self, retry_count: u32, error_class: &ErrorClass) -> u64 {
        if retry_count >= self.max_retries {
            return 0;
        }

        match error_class {
            ErrorClass::RateLimit => {
                // Rate limits use FLOOD_WAIT duration or min 30 seconds delay
                30_000
            }
            ErrorClass::FileError | ErrorClass::SizeLimit => {
                // Non-retryable without container repair or split pipeline escalation
                0
            }
            ErrorClass::NetworkError | ErrorClass::SystemError | ErrorClass::Unknown => {
                let exp = 2u64.pow(retry_count.min(6));
                let delay = self.base_delay_ms * exp;
                delay.min(self.max_delay_ms)
            }
        }
    }

    pub fn should_retry(&self, retry_count: u32, error_class: &ErrorClass) -> bool {
        if retry_count >= self.max_retries {
            return false;
        }
        match error_class {
            ErrorClass::FileError | ErrorClass::SizeLimit => false,
            _ => true,
        }
    }
}
