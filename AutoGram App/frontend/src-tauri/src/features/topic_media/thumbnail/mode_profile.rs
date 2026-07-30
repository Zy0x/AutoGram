//! Thumbnail mode profiles: Saver, Balance, and High.

use super::super::models::ThumbnailMode;

#[derive(Debug, Clone, Copy)]
pub struct ModeProfile {
    pub target_width: u32,
    pub visible_slots: usize,
    pub partial_slots: usize,
    pub max_image_budget_bytes: usize,
    pub max_video_budget_bytes: usize,
    pub decode_timeout_secs: u64,
}

pub fn get_mode_profile(mode: ThumbnailMode) -> ModeProfile {
    match mode {
        ThumbnailMode::Saver => ModeProfile {
            target_width: 160,
            visible_slots: 3,
            partial_slots: 1,
            max_image_budget_bytes: 1024 * 1024,
            max_video_budget_bytes: 2 * 1024 * 1024,
            decode_timeout_secs: 2,
        },
        ThumbnailMode::Balance => ModeProfile {
            target_width: 320,
            visible_slots: 4,
            partial_slots: 2,
            max_image_budget_bytes: 3 * 1024 * 1024,
            max_video_budget_bytes: 6 * 1024 * 1024,
            decode_timeout_secs: 3,
        },
        ThumbnailMode::High => ModeProfile {
            target_width: 512,
            visible_slots: 6,
            partial_slots: 3,
            max_image_budget_bytes: 6 * 1024 * 1024,
            max_video_budget_bytes: 16 * 1024 * 1024,
            decode_timeout_secs: 5,
        },
    }
}
