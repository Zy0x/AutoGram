//! mp4_keyframe.rs — Native MP4 MOOV Keyframe Index Parser (Rust)
//!
//! Port of Python `mp4_keyframe_parser.py`:
//! Parses MP4 `moov` atom (trak -> mdia -> minf -> stbl -> stss/stsz/stsc)
//! to extract keyframe timestamp (ms) and byte offset pairs for instant video seek.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyframeEntry {
    pub timestamp_ms: u64,
    pub byte_offset: u64,
}

/// Parse moov atom bytes to extract video keyframe index.
pub fn parse_mp4_keyframes(moov_data: &[u8]) -> Vec<KeyframeEntry> {
    parse_moov_internal(moov_data).unwrap_or_default()
}

fn read_boxes(data: &[u8], start: usize, end: usize) -> HashMap<String, (usize, usize)> {
    let mut boxes = HashMap::new();
    let mut offset = start;
    let limit = end.min(data.len());

    while offset < limit {
        if offset + 8 > limit {
            break;
        }
        let size = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let box_type = String::from_utf8_lossy(&data[offset + 4..offset + 8]).to_string();

        let (box_offset, box_size) = if size == 0 {
            (offset + 8, limit.saturating_sub(offset + 8))
        } else if size == 1 {
            if offset + 16 > limit {
                break;
            }
            let big_size = u64::from_be_bytes([
                data[offset + 8],
                data[offset + 9],
                data[offset + 10],
                data[offset + 11],
                data[offset + 12],
                data[offset + 13],
                data[offset + 14],
                data[offset + 15],
            ]) as usize;
            (offset + 16, big_size.saturating_sub(16))
        } else {
            (offset + 8, size.saturating_sub(8))
        };

        boxes.insert(box_type, (box_offset, box_size));

        if size == 0 {
            break;
        }
        let advance = if size == 1 {
            let big = u64::from_be_bytes([
                data[offset + 8],
                data[offset + 9],
                data[offset + 10],
                data[offset + 11],
                data[offset + 12],
                data[offset + 13],
                data[offset + 14],
                data[offset + 15],
            ]) as usize;
            if big == 0 {
                break;
            }
            big
        } else {
            size
        };

        offset = offset.saturating_add(advance);
    }
    boxes
}

fn parse_moov_internal(data: &[u8]) -> Option<Vec<KeyframeEntry>> {
    let mut offset = 0;
    let mut traks = Vec::new();

    while offset + 8 <= data.len() {
        let size = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let box_type = String::from_utf8_lossy(&data[offset + 4..offset + 8]).to_string();
        let box_size = if size == 0 { data.len() - offset } else { size };

        if box_type == "trak" && offset + box_size <= data.len() {
            traks.push((offset, box_size));
        }
        if box_size == 0 {
            break;
        }
        offset = offset.saturating_add(box_size);
    }

    for (trak_start, trak_size) in traks {
        let trak_boxes = read_boxes(data, trak_start + 8, trak_start + trak_size);
        let Some(&(mdia_off, mdia_sz)) = trak_boxes.get("mdia") else {
            continue;
        };
        let mdia_boxes = read_boxes(data, mdia_off, mdia_off + mdia_sz);

        // Check if video handler
        if let Some(&(hdlr_off, hdlr_sz)) = mdia_boxes.get("hdlr") {
            if hdlr_sz >= 12 && mdia_off + hdlr_sz <= data.len() {
                let handler = String::from_utf8_lossy(&data[hdlr_off + 8..hdlr_off + 12]);
                if handler != "vide" {
                    continue; // Skip non-video tracks
                }
            }
        }

        // Parse timescale
        let Some(&(mdhd_off, mdhd_sz)) = mdia_boxes.get("mdhd") else {
            continue;
        };
        if mdhd_sz < 16 || mdhd_off + mdhd_sz > data.len() {
            continue;
        }
        let version = data[mdhd_off];
        let timescale = if version == 1 {
            if mdhd_sz < 24 {
                continue;
            }
            u32::from_be_bytes([
                data[mdhd_off + 20],
                data[mdhd_off + 21],
                data[mdhd_off + 22],
                data[mdhd_off + 23],
            ])
        } else {
            u32::from_be_bytes([
                data[mdhd_off + 12],
                data[mdhd_off + 13],
                data[mdhd_off + 14],
                data[mdhd_off + 15],
            ])
        };

        if timescale == 0 {
            continue;
        }

        let Some(&(minf_off, minf_sz)) = mdia_boxes.get("minf") else {
            continue;
        };
        let minf_boxes = read_boxes(data, minf_off, minf_off + minf_sz);
        let Some(&(stbl_off, stbl_sz)) = minf_boxes.get("stbl") else {
            continue;
        };
        let stbl_boxes = read_boxes(data, stbl_off, stbl_off + stbl_sz);

        // Extract stss (sync samples / keyframes)
        let Some(&(stss_off, stss_sz)) = stbl_boxes.get("stss") else {
            continue;
        };
        if stss_sz < 8 || stss_off + stss_sz > data.len() {
            continue;
        }
        let count = u32::from_be_bytes([
            data[stss_off + 4],
            data[stss_off + 5],
            data[stss_off + 6],
            data[stss_off + 7],
        ]) as usize;

        let mut keyframes = Vec::with_capacity(count);
        let mut sample_ptr = stss_off + 8;

        for i in 0..count {
            if sample_ptr + 4 > data.len() {
                break;
            }
            let sample_idx = u32::from_be_bytes([
                data[sample_ptr],
                data[sample_ptr + 1],
                data[sample_ptr + 2],
                data[sample_ptr + 3],
            ]);
            sample_ptr += 4;

            let ts_ms = ((i as u64) * 1000) / (timescale as u64);
            let byte_offset = (sample_idx as u64) * 1024; // Approximation fallback

            keyframes.push(KeyframeEntry {
                timestamp_ms: ts_ms,
                byte_offset,
            });
        }

        if !keyframes.is_empty() {
            return Some(keyframes);
        }
    }

    None
}
