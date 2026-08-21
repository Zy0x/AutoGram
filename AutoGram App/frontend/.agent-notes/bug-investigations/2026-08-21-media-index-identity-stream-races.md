# Media index, identity, stream, and thumbnail race investigation

## Reproduction evidence

- A fully populated peer reopened as `80 / 4,767` even though its normalized IndexedDB rows already existed.
- During indexing, the toolbar could show an indexed count smaller than the All-media statistic or later grow beyond its true unique-row target.
- A peer opened through the chat view could fall back to `Chat <id>` although the same peer had an authoritative Drive/dialog title.
- Launcher rendered a hard-coded Lavender fallback whenever the native session inventory was temporarily empty, creating a visible ghost account.

## Confirmed root causes

1. Index progress used `indexedLoadedCount += page.length`; Telegram delta/retry pages can contain records already present in the scoped store.
2. Persistent restore loaded rows and exact totals but did not restore `totalIndexedCount`.
3. Chat breadcrumb and location labels ignored the known folder title when the paged dialog list had not reached the peer.
4. Session Launcher fabricated a Lavender card instead of representing the actual native inventory.
5. A legacy checkpoint for `-1002447029067` claimed `backfillComplete=true` with only 1,670 unique rows while Telegram's two search lanes reported 4,767 candidates.
6. Breadcrumb lookup used strict id equality, but persisted sidebar entries can deserialize their peer id as a string.
7. Message `19024` had no Telegram filename attribute; the caption was incorrectly promoted to a filename and hid its stable media identity.

## Fix strategy

- Use the account/peer/topic IndexedDB index count after every atomic page commit and on persistent restore.
- Keep candidate-index progress separate from All-message category totals.
- Resolve titles live-dialog first, cached Drive title second, raw id last.
- De-duplicate verified session aliases by Telegram user id and never fabricate session cards.
- Continue with restriction metadata, Telegram delivery classification, sparse ZIP proof, stream/thumbnail benchmarks, and race verification.

## Applied fixes and live evidence

- Completed checkpoints are now cross-validated against Telegram's live candidate total when their peer is opened. A mismatch resets only cursor state; indexed rows are retained and deduplicated by the next pass.
- Native CDP proof for `-1002447029067`: stale state was removed while all 1,670 rows remained; toolbar reports `1,670 / 4,767 · Index All` instead of a false completed badge.
- Native CDP proof: the same peer header now shows `ᴅᴏɴɢʜᴜᴀ ɢɪʀʟs ɴᴜᴅᴇ ᴘʜᴏᴛᴏ` instead of `Chat -1002447029067`.
- Exact message benchmark `-1002557538013/63280`: stream startup succeeded, first 256 KiB range returned HTTP 206 in 6 ms. A/C/A/B switching completed in 884/748/3,477/1,744 ms without a stuck stream.
- Thumbnail benchmark `-1002779865496`: 12/12 cold thumbnails ready in about 1,000 ms and 12/12 warm in 26 ms, without reloading the drive.
- Restriction metadata for `-1003606461240` is returned as restricted with Telegram's pornography restriction reason and is mapped to the active-drive notice.
- Message `-1002660885317/19024` now derives `video_19024.mp4` from MIME/native attributes when Telegram omitted a filename; FILE versus MEDIA classification is based on Telegram document attributes rather than `.mp4` extension. The live Grammers binary returned the corrected name, MP4 format, and native `media/video` delivery after rebuild.
- Resolution menu now exposes only direct Telegram automatic/original streams. Fake 720p/480p/360p choices that implied a server variant but triggered local conversion were removed.
- Sparse ZIP preview reads the EOCD/central directory and the selected entry's compressed byte range; password fallback continues through the sparse reader rather than downloading the archive wholesale.
- Launcher inventory is deduplicated by Telegram user id, never creates a fallback Lavender card, and withholds legacy native aliases that have no verified Telegram user id. A quality-gate reproduction caught the transient raw `Lavender` alias; the final live inventory renders three verified identities only.
- Current native process tree measured about 812 MB working set after indexing/preview activity, within the requested 1 GB target. No broad cache purge or process termination was used.

## Gates

- `npm test`: 30 files, 246 tests passed; locale audit 5,168 EN/ID keys, zero parity/missing/fallback/hardcoded findings.
- `npm run build`: passed; Vite emitted existing chunk-splitting warnings only.
- Rust delivery identity test: passed.
- Rust ZIP local behavior tests: 5/5 passed.
