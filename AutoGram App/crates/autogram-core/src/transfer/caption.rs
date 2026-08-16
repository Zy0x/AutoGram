//! Caption policy shared by preflight and the Grammers delivery path.
//!
//! Telegram measures caption limits in UTF-16 code units. Keeping that detail
//! here prevents the UI and album planner from silently disagreeing about
//! emoji, supplementary-plane characters, or which surviving album item owns
//! the summary caption.

use serde::{Deserialize, Serialize};

use super::PreparedAlbumItem;

pub const FALLBACK_CAPTION_LIMIT: u32 = 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptionOverflowPolicy {
    TruncateWithWarning,
    Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptionDetailMode {
    Filename,
    Template,
    None,
}

impl CaptionDetailMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
            "template" => Self::Template,
            "none" | "no_caption" => Self::None,
            _ => Self::Filename,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptionTemplateContext<'a> {
    pub filename: &'a str,
    pub stem: &'a str,
    pub extension: &'a str,
    pub index: usize,
    pub total: usize,
    pub relative_path: &'a str,
    pub date: &'a str,
    pub hash_prefix: &'a str,
    pub quality_mode: &'a str,
}

impl CaptionOverflowPolicy {
    pub fn parse(value: Option<&str>) -> Self {
        match value
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "fail" => Self::Fail,
            _ => Self::TruncateWithWarning,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedCaption {
    pub value: String,
    pub original_utf16_len: usize,
    pub final_utf16_len: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlbumCaptionAssignment {
    pub item_index: Option<usize>,
    pub original_utf16_len: usize,
    pub final_utf16_len: usize,
    pub truncated: bool,
}

pub fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn truncate_utf16(value: &str, limit: usize) -> String {
    if limit == 0 {
        return String::new();
    }
    let mut used = 0usize;
    value
        .chars()
        .take_while(|character| {
            let width = character.len_utf16();
            if used.saturating_add(width) > limit {
                false
            } else {
                used += width;
                true
            }
        })
        .collect()
}

pub fn normalize_caption(
    value: &str,
    runtime_limit: u32,
    policy: CaptionOverflowPolicy,
) -> Result<NormalizedCaption, String> {
    let limit = usize::try_from(runtime_limit.max(1)).unwrap_or(FALLBACK_CAPTION_LIMIT as usize);
    let original_utf16_len = utf16_len(value);
    if original_utf16_len <= limit {
        return Ok(NormalizedCaption {
            value: value.to_string(),
            original_utf16_len,
            final_utf16_len: original_utf16_len,
            truncated: false,
        });
    }
    if policy == CaptionOverflowPolicy::Fail {
        return Err(format!(
            "CAPTION_LIMIT_EXCEEDED: caption uses {original_utf16_len} UTF-16 units; runtime limit is {limit}"
        ));
    }
    let value = truncate_utf16(value, limit);
    Ok(NormalizedCaption {
        final_utf16_len: utf16_len(&value),
        value,
        original_utf16_len,
        truncated: true,
    })
}

pub fn render_caption_template(
    template: &str,
    context: &CaptionTemplateContext<'_>,
) -> Result<String, String> {
    const TOKENS: [&str; 9] = [
        "filename",
        "stem",
        "extension",
        "index",
        "total",
        "relative_path",
        "date",
        "hash_prefix",
        "mode",
    ];
    let mut output = template.replace("{{", "\u{e000}").replace("}}", "\u{e001}");
    let replacements = [
        ("filename", context.filename.to_string()),
        ("stem", context.stem.to_string()),
        ("extension", context.extension.to_string()),
        ("index", (context.index + 1).to_string()),
        ("total", context.total.to_string()),
        ("relative_path", context.relative_path.to_string()),
        ("date", context.date.to_string()),
        ("hash_prefix", context.hash_prefix.to_string()),
        ("mode", context.quality_mode.to_string()),
    ];
    for (token, value) in replacements {
        output = output.replace(&format!("{{{token}}}"), &value);
    }
    if let Some(start) = output.find('{') {
        let suffix = &output[start + 1..];
        let end = suffix.find('}').unwrap_or(suffix.len());
        let unknown = &suffix[..end];
        if !unknown.is_empty() && !TOKENS.contains(&unknown) {
            return Err(format!("CAPTION_TEMPLATE_UNKNOWN_VARIABLE: {unknown}"));
        }
        return Err("CAPTION_TEMPLATE_INVALID_BRACES".into());
    }
    Ok(output.replace('\u{e000}', "{").replace('\u{e001}', "}"))
}

/// Assign one logical album summary after preparation and duplicate filtering.
/// The summary replaces the first surviving item's detail caption but preserves
/// captions on every other item. This keeps one summary while retaining
/// explicit per-item detail semantics required by `InputSingleMedia`.
pub fn apply_album_caption_policy(
    items: &mut [PreparedAlbumItem],
    summary: Option<&str>,
    runtime_limit: u32,
    policy: CaptionOverflowPolicy,
) -> Result<AlbumCaptionAssignment, String> {
    let summary = summary.map(str::trim).filter(|value| !value.is_empty());
    if let Some(summary) = summary {
        let normalized = normalize_caption(summary, runtime_limit, policy)?;
        for item in items.iter_mut().skip(1) {
            let detail = normalize_caption(&item.caption, runtime_limit, policy)?;
            item.caption = detail.value;
        }
        let item_index = items.first().map(|item| item.index);
        if let Some(first) = items.first_mut() {
            first.caption = normalized.value;
        }
        return Ok(AlbumCaptionAssignment {
            item_index,
            original_utf16_len: normalized.original_utf16_len,
            final_utf16_len: normalized.final_utf16_len,
            truncated: normalized.truncated,
        });
    }

    let mut any_truncated = false;
    let mut original_utf16_len = 0usize;
    let mut final_utf16_len = 0usize;
    for item in items.iter_mut() {
        let normalized = normalize_caption(&item.caption, runtime_limit, policy)?;
        any_truncated |= normalized.truncated;
        original_utf16_len = original_utf16_len.max(normalized.original_utf16_len);
        final_utf16_len = final_utf16_len.max(normalized.final_utf16_len);
        item.caption = normalized.value;
    }
    Ok(AlbumCaptionAssignment {
        item_index: None,
        original_utf16_len,
        final_utf16_len,
        truncated: any_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer::{AlbumCompatibilityKey, PayloadClass};

    fn item(index: usize, caption: &str) -> PreparedAlbumItem {
        PreparedAlbumItem {
            index,
            path: format!("item-{index}"),
            caption: caption.into(),
            spoiler: false,
            size: 1,
            key: AlbumCompatibilityKey {
                account_id: "account".into(),
                peer_id: "peer".into(),
                topic_id: None,
                reply_to: None,
                send_as: None,
                schedule_at: None,
                silent: false,
                payload_class: PayloadClass::DocumentGroup,
            },
        }
    }

    #[test]
    fn truncation_respects_utf16_surrogate_boundaries() {
        let normalized =
            normalize_caption("ab😀cd", 4, CaptionOverflowPolicy::TruncateWithWarning).unwrap();
        assert_eq!(normalized.value, "ab😀");
        assert_eq!(normalized.original_utf16_len, 6);
        assert_eq!(normalized.final_utf16_len, 4);
        assert!(normalized.truncated);
    }

    #[test]
    fn fail_policy_is_explicit() {
        let error = normalize_caption("12345", 4, CaptionOverflowPolicy::Fail).unwrap_err();
        assert!(error.contains("CAPTION_LIMIT_EXCEEDED"));
    }

    #[test]
    fn summary_moves_to_first_surviving_item_exactly_once() {
        let mut items = vec![item(2, "old-2"), item(4, "old-4")];
        let assignment = apply_album_caption_policy(
            &mut items,
            Some("logical album caption"),
            1_024,
            CaptionOverflowPolicy::Fail,
        )
        .unwrap();
        assert_eq!(assignment.item_index, Some(2));
        assert_eq!(items[0].caption, "logical album caption");
        assert_eq!(items[1].caption, "old-4");
        assert_eq!(
            items
                .iter()
                .filter(|item| item.caption == "logical album caption")
                .count(),
            1
        );
    }

    #[test]
    fn empty_summary_preserves_per_item_captions() {
        let mut items = vec![item(0, "first"), item(1, "second")];
        let assignment =
            apply_album_caption_policy(&mut items, None, 1_024, CaptionOverflowPolicy::Fail)
                .unwrap();
        assert_eq!(assignment.item_index, None);
        assert_eq!(items[0].caption, "first");
        assert_eq!(items[1].caption, "second");
    }

    #[test]
    fn template_renders_stable_variables_and_escaped_braces() {
        let context = CaptionTemplateContext {
            filename: "clip.final.mp4",
            stem: "clip.final",
            extension: "mp4",
            index: 1,
            total: 3,
            relative_path: "folder/clip.final.mp4",
            date: "2026-08-05",
            hash_prefix: "abcdef12",
            quality_mode: "SMART",
        };
        let rendered = render_caption_template(
            "{index}/{total} {filename} [{mode}] {hash_prefix} {{ok}}",
            &context,
        )
        .unwrap();
        assert_eq!(rendered, "2/3 clip.final.mp4 [SMART] abcdef12 {ok}");
    }

    #[test]
    fn template_rejects_unknown_variables() {
        let context = CaptionTemplateContext {
            filename: "file.txt",
            stem: "file",
            extension: "txt",
            index: 0,
            total: 1,
            relative_path: "file.txt",
            date: "2026-08-05",
            hash_prefix: "12345678",
            quality_mode: "ORIGINAL",
        };
        assert!(render_caption_template("{unknown}", &context)
            .unwrap_err()
            .contains("UNKNOWN_VARIABLE"));
    }
}
