# AutoGram Features & Technical Capabilities

An exhaustive technical breakdown of the features, algorithms, and engineering capabilities powering AutoGram.

## Android preview: current availability

Android remains a development preview, not a feature-complete desktop replacement.
The native engine is packaged for arm64-v8a, armeabi-v7a, x86_64, and x86; choose the
matching APK, or the larger universal APK. Local engine readiness does not mean
that a Telegram account is signed in.

Implemented preview paths include native Telegram sign-in, account-scoped cloud
navigation and media range reads, a persistent native cloud-download queue, device-file
preview and direct HTTPS downloads. Real-account/device acceptance is still required
for the complete workflows. Upload, provider crawlers, processing and automation remain
incomplete. A visible page or control is not a guarantee of support.
If the app reports that its native engine is unavailable, use a rebuilt APK for
your device architecture; never copy session files from another installation.

The Accounts page provides phone/OTP/2FA and QR sign-in through the native engine.
Stored session inventory is separate from live authorization: selecting or restoring
an account requires a Telegram identity check. Android Keystore protects new session
records. Legacy session inventory is not an automatic migration or authorization.
Android and desktop use the same release-version source; matching version numbers do
not mean that all desktop features are available on Android.

The Local Preview page opens images, audio/video and bounded UTF-8 text from files
chosen through Android's document picker. It reads the selected file itself; it is
not Telegram cloud streaming. Text preview is limited to 256 KiB, with a truncation
notice. Unsupported formats and unreadable files show an explicit error.

Cloud image/audio/video previews use byte ranges and an Android player; the full set
of desktop document and encrypted-archive previews is not yet equivalent. Jobs exposes
the actual account-scoped cloud-download queue through an explicit action, without
starting work on page entry. Older transfer cards remain metadata records and cannot
be treated as executable jobs. Forwarder, Automation, Sync and Profiles show their
missing-engine boundaries instead of example jobs or simulated success. Studio does
not announce a split, transcode or album result without an executor. Database backup
and restore are unavailable until a consistent, validated workflow exists; the preview
does not overwrite the live database to simulate restoration. Unsupported network
preferences are not presented as active engine policy.
The canonical builder permits preview Debug APKs, but blocks Release packaging while
the required cloud workflows and their real-device acceptance evidence are missing.

---

## 🌟 Feature Overview Matrix

| Feature | Description | Technical Advantage |
| :--- | :--- | :--- |
| **Grammers Rust MTProto** | Native desktop client engine written in 100% Rust. | 10x faster connection establishment, 0% Python runtime overhead. |
| **Sparse ZIP Streaming** | In-memory archive browser and byte-range extractor. | Zero full downloads, extracts 2 MB file from 10 GB archive in < 1 sec. |
| **4-Level Deduplication** | Quadruple-check duplicate prevention system. | Prevents redundant network uploads and saves Telegram cloud storage. |
| **Remote Media Downloader** | Multi-provider video/audio resolver & streaming proxy. | Direct-to-Telegram transfer, up to 8K/4K HDR 60 FPS, multi-subs. |
| **Multi-Tier Virtualization** | Smooth rendering of 50,000+ media assets in UI. | Constant 60 FPS scrolling with zero DOM thrashing. |
| **Multi-Session Switcher** | Manage multiple Telegram accounts concurrently. | Instant 1-click switching with real-time ping latency display. |

---

## 🔬 1. Sparse ZIP Streaming Engine

Standard ZIP readers download the entire archive before extracting an individual entry. AutoGram's **Sparse ZIP Engine** operates differently:
1. **Central Directory Locating**: Fetches only the trailing 64 KB End of Central Directory (EOCD) record from Telegram.
2. **Catalog Parsing**: Reads archive directory tables in memory to present file trees instantly.
3. **Exact Slicing**: Upon user preview or extraction, fetches strictly `[local_header_offset .. local_header_offset + compressed_size]`.
4. **On-the-Fly Decryption**: Synthesizes a 1-entry micro-archive in RAM for password-protected files (WinZip AES & ZipCrypto) with zero disk writes.

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
- **Skip**: Immediately marks the item as resolved, referencing the existing cloud message pointer.
- **Replace**: Automatically deletes the obsolete cloud message and uploads the fresh asset.
- **Keep Both**: Renames the new asset with a collision suffix (e.g. `document (1).pdf`).
- **Rename**: Prompts the user to define a unique target name before transferring.

---

## 🎬 3. Universal Remote Media & Subtitle Pipeline

Android Drive batch downloads preserve the account, chat and forum topic. Their
feedback distinguishes acknowledged queue entries from failed requests and unconfirmed
background startup. Failed batches retain their selection; leaving the original
account/location stops remaining requests. Upload and full desktop parity remain
in development, as described in the Android preview guide.
Batch notifications and selection updates are handled on the Android UI thread;
targeted physical-phone regressions cover these flows and media preview controls.

- **Stream Range Proxy**: Bypasses WebView2 CORS and Referer restrictions by proxying signed streaming URLs locally through Rust.
- **Subtitle Transformer**: Converts embedded captions into standardized `.SRT` and `.VTT` subtitle tracks.
- **Multi-Language Auto-Translation**: Translates video captions into user-specified languages (Indonesian, English, Japanese, etc.) on the fly.
