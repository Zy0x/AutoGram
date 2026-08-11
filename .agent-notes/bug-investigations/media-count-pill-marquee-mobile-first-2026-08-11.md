# Media count, pill clipping, marquee, and mobile-first investigation

Date: 2026-08-11
Scope: `AutoGram App/frontend`

## Symptoms

- The header hid Telegram's quick total until a unique full-history walk completed.
- Filter and topic pill borders/focus rings were clipped by horizontal scroll lanes.
- Type labels and numeric badges nearly touched at desktop density.
- Pointer drag over a card always primed card DnD, preventing rectangle selection.
- Deep application surfaces still need a systematic mobile-first and touch audit.

## Reproduction

1. Open a large group or forum topic from a cold location cache.
2. Observe the initial header count and category tabs before metadata pagination ends.
3. Focus or activate a topic pill at either edge of the horizontal lane.
4. Hold Ctrl and drag from the middle of a media card across adjacent cards.
5. Resize the native window through phone, tablet, laptop, and large desktop dimensions.

## Root causes

- `media_counter.rs` issued six sequential `messages.search` calls instead of Telegram's single `messages.getSearchCounters` vector RPC.
- `MediaStudio` accepted the fast response only when it was already exact, and `DriveTopBar` explicitly returned no total while non-final.
- Several late CSS overrides reduced pill group gaps to one pixel; scroll lanes had insufficient block padding and default focus outlines escaped their clip region.
- Card pointer handlers primed internal DnD before the explorer could claim a Ctrl-modified marquee.

## Fix strategy

- Use one batch counter RPC for photos, videos, documents, GIFs, links, and audio.
- Show the overlapping result as an explicit estimate, then replace it with the unique metadata result.
- Preserve session/peer/topic generation guards and keep protected preview/stream/thumbnail paths untouched.
- Apply a shared in-bounds pill geometry/focus contract and a dedicated count-badge gap.
- Resolve pointer ownership before drag prime; suppress the synthetic post-marquee click only after actual movement.
- Follow with a route/modal mobile-first matrix and native `frontend.exe` verification.

## Status

- [x] Root cause isolated
- [x] Batch counters implemented
- [x] Estimated header/category count enabled
- [x] Pill geometry patch implemented
- [x] Ctrl/Cmd marquee ownership implemented
- [x] Phase-one automated and native desktop gates
- [ ] Phase-one commit
- [ ] Full mobile-first audit and implementation
- [ ] Multi-viewport/touch verification
