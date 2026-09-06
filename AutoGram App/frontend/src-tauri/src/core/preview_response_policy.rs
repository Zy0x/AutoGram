//! Bounded MP4 bootstrap responses let a browser request tail metadata promptly.
pub fn startup_response_end(start: u64, normal_end: u64, needs_tail_probe: bool) -> u64 {
    if needs_tail_probe && start == 0 { normal_end.min(512 * 1024) } else { normal_end }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bootstrap_does_not_hold_a_sixteen_megabyte_request_open() {
        assert_eq!(startup_response_end(0, 16 * 1024 * 1024, true), 512 * 1024);
        assert_eq!(startup_response_end(0, 2, true), 2);
        assert_eq!(startup_response_end(20_000_000, 22_000_000, true), 22_000_000);
        assert_eq!(startup_response_end(0, 16 * 1024 * 1024, false), 16 * 1024 * 1024);
    }
}
