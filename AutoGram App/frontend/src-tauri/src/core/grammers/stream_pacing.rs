//! Data-saver pacing applies to speculation, never to an outstanding HTTP demand.

const MAX_AHEAD_BYTES: u64 = 35 * 1024 * 1024;
const DEMAND_BURST_BYTES: u64 = 8 * 1024 * 1024; // 8 MB burst to guarantee instant playback startup

#[derive(Default, Debug)]
pub(super) struct StreamPacing {
    demand_start: Option<u64>,
    demand_end: Option<u64>,
}

impl StreamPacing {
    pub fn demand(&mut self, offset: u64) {
        self.demand_start = Some(offset);
        self.demand_end = Some(offset.saturating_add(DEMAND_BURST_BYTES));
    }

    pub fn demand_bounded(&mut self, offset: u64, total_size: u64) {
        self.demand_start = Some(offset);
        let burst_end = offset.saturating_add(DEMAND_BURST_BYTES).min(total_size);
        self.demand_end = Some(burst_end.max(offset));
    }

    pub fn delay_ms(
        &mut self,
        ranges: &[(u64, u64)],
        cursor: u64,
        last_read: u64,
        data_saver: bool,
        runway_delay: Option<u64>,
    ) -> Option<u64> {
        // 1. Direct Player Demand has absolute priority: zero pacing delay.
        if let (Some(d_start), Some(d_end)) = (self.demand_start, self.demand_end) {
            let covered_end = contiguous_end_from(ranges, d_start);
            if covered_end < d_end {
                // Active player demand is not yet fully satisfied; fetch chunks at full speed!
                return None;
            }
            // Demand is satisfied; clear demand window so speculative prefetch rules resume
            self.demand_start = None;
            self.demand_end = None;
        }

        // 2. Speculative prefetch: apply runway buffer delay if player holds ample runway
        if let Some(delay) = runway_delay {
            return Some(delay);
        }

        // 3. Speculative prefetch: apply Data Saver forward byte-distance cap.
        // ONLY applies when prefetching forward ahead of playback: cursor >= last_read.
        // Never stalls when cursor is behind playback or fulfilling backward gaps.
        if data_saver && cursor >= last_read && (cursor - last_read) >= MAX_AHEAD_BYTES {
            return Some(300);
        }

        None
    }
}

fn contiguous_end_from(ranges: &[(u64, u64)], from: u64) -> u64 {
    let mut cur = from;
    let mut merged = ranges.to_vec();
    merged.sort_unstable_by_key(|&(s, _)| s);
    for (s, e) in merged {
        if s <= cur {
            if e > cur {
                cur = e;
            }
        } else if s > cur {
            break;
        }
    }
    cur
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_demand_bypasses_runway_and_data_saver_until_covered() {
        let mut pacing = StreamPacing::default();
        let total_size = 300 * 1024 * 1024;
        let tail_offset = total_size - 2 * 1024 * 1024; // 298 MB
        pacing.demand_bounded(tail_offset, total_size);

        // Even with huge runway delay and data saver on, delay is None while uncovered
        let ranges_before = vec![(0, 35 * 1024 * 1024)]; // 0-35 MB buffered at head
        assert_eq!(pacing.delay_ms(&ranges_before, tail_offset, 0, true, Some(350)), None);

        // Partial tail fetched (1 MB of the 2 MB tail)
        let ranges_partial = vec![(0, 35 * 1024 * 1024), (tail_offset, tail_offset + 1024 * 1024)];
        assert_eq!(pacing.delay_ms(&ranges_partial, tail_offset + 1024 * 1024, 0, true, Some(350)), None);

        // Tail fully fetched
        let ranges_done = vec![(0, 35 * 1024 * 1024), (tail_offset, total_size)];
        // Now demand is cleared, speculative prefetch applies runway
        assert_eq!(pacing.delay_ms(&ranges_done, tail_offset, 0, true, Some(350)), Some(350));
    }

    #[test]
    fn speculative_prefetch_does_not_stall_when_filling_behind() {
        let mut pacing = StreamPacing::default();
        // Player read at 200 MB, but cursor is at 10 MB (behind playback)
        assert_eq!(pacing.delay_ms(&[], 10 * 1024 * 1024, 200 * 1024 * 1024, true, None), None);
    }

    #[test]
    fn speculative_prefetch_pauses_when_35mb_ahead_of_playback() {
        let mut pacing = StreamPacing::default();
        // Cursor is 35 MB ahead of player read offset
        assert_eq!(pacing.delay_ms(&[], 40 * 1024 * 1024, 5 * 1024 * 1024, true, None), Some(300));
        // Cursor is 10 MB ahead of player read offset (allowed)
        assert_eq!(pacing.delay_ms(&[], 15 * 1024 * 1024, 5 * 1024 * 1024, true, None), None);
        // When data saver is disabled, ahead bytes are not capped
        assert_eq!(pacing.delay_ms(&[], 40 * 1024 * 1024, 5 * 1024 * 1024, false, None), None);
    }
}
