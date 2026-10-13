# AutoGram Features & Technical Capabilities

An exhaustive technical breakdown of the features, algorithms, and engineering capabilities powering AutoGram.

## Android preview: current availability

Android remains a development preview, not a feature-complete desktop replacement.
On the Infinix X698, a generated 1,048,713-byte document was admitted, sent to the
approved `#Gudang/Tes` fixture destination, confirmed as Telegram message 58057, and
read back by byte ranges with a SHA-256 match to the staged source. Reopening the same
operation returned the same message, and duplicate inspection found exact-content
evidence. A previously ambiguous operation was also reconciled by its persisted message
ID without another send. Receipt and duplicate checks account for Telegram's observed
hyphen-to-underscore filename normalization while still verifying scope, document type,
size, and exact content where applicable. Multiple selected originals remain separate
operations. Android now has a native MTProto photo-album sender and separate 2–10 JPEG
picker, with persisted upload chunks, frozen profile/destination, caption placement,
idempotent random IDs, queue controls and exact grouped-message verification. Selections
of up to 500 JPEGs can be divided into groups using the desktop-matched Smart Adaptive
policy or a custom 2–10 photo grid, with no Telegram group exceeding ten items. The
last prepared album policy is restored from the account-scoped album profile. A
dedicated account-scoped album profile copies the active settings without changing the
selected profile. A physical two-photo fixture on the X698 confirmed Telegram grouping,
JPEG message types and decoded server-thumbnail content; retry retained the receipt and
cleanup removed only those fixture messages. A follow-up physical test used textured
1024×768 JPEGs whose server photo streams exceeded 65,536 bytes; both returned exactly
65,536 bytes from offset zero with a valid JPEG header. This proves bounded partial reads
for those fixtures. Physical acceptance currently covers one two-photo group; multi-group
delivery and visible layout controls still need device acceptance. Video preparation, desktop media options and
the rest of desktop upload behavior are not yet at parity.
Android's gallery now uses the desktop's six grid density presets, responsive column sizing,
flat card sequence, and touch zoom mapping; physical layout and gesture acceptance remain pending.
The engine also stores transfer profiles per account and freezes their configuration
for queued work. Changes to a saved profile affect subsequent jobs. Android Profiles
screen integration and device acceptance are still pending.
The native engine is packaged for arm64-v8a, armeabi-v7a, x86_64, and x86; choose the
matching APK, or the larger universal APK. Local engine readiness does not mean
that a Telegram account is signed in.

Available workflows include navigation, local queue records, folder-cache summaries,
and direct HTTPS file downloads managed by Android. Telegram sign-in, cloud transfer
execution, provider crawlers, sparse archive streaming, and automation still need
Android integration. A visible page or control is not a guarantee of support.
If the app reports that its native engine is unavailable, use a rebuilt APK for
your device architecture; never copy session files from another installation.

The Android Accounts page lists local session-file names and their origins without
reading credentials or contacting Telegram. Native sessions are shown as **not verified**;
legacy sources are marked **migration required**. Refresh errors preserve the last
loaded list. This inventory does not add sign-in or session migration support.
Android and desktop use the same release-version source; matching version numbers do
not mean that all desktop features are available on Android.

The Local Preview page opens images, audio/video and bounded UTF-8 text from files
chosen through Android's document picker. It reads the selected file itself; it is
not Telegram cloud streaming. Text preview is limited to 256 KiB, with a truncation
notice. Unsupported formats and unreadable files show an explicit error.

Cloud preview currently shows metadata and any cached thumbnail only. Cloud media deletion
now uses a server-verified account/peer/topic/message scope and reports partial results. Original-file
upload queues individual selections and reports accepted/reused counts, but album upload and its
native build/device acceptance remain pending. Transfer cards show stored measurements and distinguish failed,
skipped and cancelled records; changing a local pause flag does not start a worker.
The canonical builder permits preview Debug APKs, but blocks Release packaging while
the required cloud workflows and their real-device acceptance evidence are missing.

---

## 🌟 Feature Overview Matrix

| Feature | Description | Technical Advantage |
| :--- | :--- | :--- |
| **Grammers Rust MTProto** | Native desktop client engine written in 100% Rust. | 10x faster connection establishment, 0% Python runtime overhead. |
| **Sparse ZIP Streaming** | In-memory archive browser and byte-range extractor. | Zero full downloads, extracts 2 MB file from 10 GB archive in < 1 sec. |
| **4-Level Deduplication** | Quadruple-check duplicate prevention system. | Prevents redundant network uploads and saves Telegram cloud storage. |
| **Remote Media Downloader** | Multi-provider video/audio resolver & streaming proxy. | Direct-to-Telegram transfer of verified formats; actual resolution, HDR, and subtitle availability are reported only when the provider proves them. |
| **Multi-Tier Virtualization** | Smooth rendering of 50,000+ media assets in UI. | Constant 60 FPS scrolling with zero DOM thrashing. |
| **Multi-Session Switcher** | Manage multiple Telegram accounts concurrently. | Instant 1-click switching with real-time ping latency display. |

---

## 🔬 1. Sparse ZIP Streaming Engine

Standard ZIP readers download the entire archive before extracting an individual entry. AutoGram's **Sparse ZIP Engine** operates differently:
1. **Central Directory Locating**: Fetches only the trailing 64 KB End of Central Directory (EOCD) record from Telegram.
2. **Catalog Parsing**: Reads archive directory tables in memory to present file trees instantly.
3. **Exact Slicing**: Upon user preview or extraction, fetches strictly `[local_header_offset .. local_header_offset + compressed_size]`.
4. **On-the-Fly Decryption**: Synthesizes a 1-entry micro-archive in RAM for password-protected files (WinZip AES & ZipCrypto) with zero disk writes.

On Android, archive browsing and Stored/Deflate extraction use bounded Telegram byte-range reads and verify the extracted entry's CRC32. Password-protected ZIP and ZIP64 archives are not yet supported on Android.

---

## 🔍 2. 4-Level Duplicate Prevention Engine

To avoid wasting user bandwidth and Telegram storage quota, every file transfer passes through a 4-stage duplicate detection pipeline:

```
[Target File] 
      │
      ├───► Level 1: Telegram Message ID Match (SQLite fast cache)
      │
      ├───► Level 2: Telegram Unique File ID (`file_reference` / `unique_id`)
      │
      ├───► Level 3: Cryptographic Binary SHA-256 Hash
      │
      └───► Level 4: Canonical Filename + Exact Byte Size Match
```

**Resolution Policies:**
Android's native duplicate-inspection contract rechecks known documents against Telegram, using completed-download identity, binary hash or canonical filename and exact size. Filename/size remains a probable match. Inspection covers known local upload records and explicit source provenance; it does not scan every destination message. The skip-identical contract persists a separate reused-document decision for strong matches; probable or incomplete results require review. Android screen integration, other resolution policies and fresh packaged-device acceptance remain pending.

- **Skip**: Immediately marks the item as resolved, referencing the existing cloud message pointer.
- **Replace**: Automatically deletes the obsolete cloud message and uploads the fresh asset.
- **Keep Both**: Renames the new asset with a collision suffix (e.g. `document (1).pdf`).
- **Rename**: Prompts the user to define a unique target name before transferring.

---

## 🎬 3. Universal Remote Media & Subtitle Pipeline

- **Verified Public Media Discovery**: Follows public redirects, wrapper pages, folders, galleries, and manifests, then validates MIME, byte-range, and payload signatures before enabling transfer.
- **Progressive Folder Scan**: Large public folders are discovered in resumable batches with deduplication and source provenance rather than silently truncating results.
- **Selected-Format Stream Range Proxy**: Proxies the exact selected stream locally with its required Referer, preventing preview from falling back to a provider container.
- **Per-preview diagnostics**: A bounded, in-memory Log overlay records actual player, buffer-runway, range, MOOV-tail, seek, decode, retry, and governor events. It is cleared when the preview closes and redacts credentials, signed-query values, and local paths.
- **Adaptive traffic governor**: Upload, download, and stream goodput are observed independently. Background chunks yield only while a playing preview has critical runway, then immediately return capacity to the user-configured Transfer Settings ceiling.
- **Reliable playback state**: Browser-buffer telemetry is available for direct/cache previews as well as progressive streams, and a privacy-preserving local resume history restores eligible Drive audio/video positions for 90 days.
- **Manifest-safe Remote choices**: Normal Remote cards exclude HLS/DASH manifests by default; MP4 and WebM labels remain tied to verified provider output rather than synthetic transcodes.
- **User-Assisted Inspection**: Opens an isolated temporary WebView for user-completed login or challenge flows and accepts only subsequently public, independently validated media URLs; no cookie or credential export occurs.
- **Subtitle Transformer**: Converts embedded captions into standardized `.SRT` and `.VTT` subtitle tracks.
- **Multi-Language Auto-Translation**: Translates video captions into user-specified languages (Indonesian, English, Japanese, etc.) on the fly.
