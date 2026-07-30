//! Multi-lane priority queue definition: P0 Critical, P1 Preview, P2 Download.

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PriorityLane {
    P0CriticalViewport = 0,
    P1NearViewportPreview = 1,
    P2UserFullDownload = 2,
}
