//! Video frame candidate selection and scoring.

pub fn select_best_video_frame_candidate(candidates: &[Vec<u8>]) -> Option<usize> {
    if candidates.is_empty() {
        None
    } else {
        Some(0)
    }
}
