# AutoGram Features & Technical Capabilities

An exhaustive technical breakdown of the features, algorithms, and engineering capabilities powering AutoGram.

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

- **Verified Public Media Discovery**: Follows public redirects, wrapper pages, folders, galleries, and manifests, then validates MIME, byte-range, and payload signatures before enabling transfer.
- **Progressive Folder Scan**: Large public folders are discovered in resumable batches with deduplication and source provenance rather than silently truncating results.
- **Selected-Format Stream Range Proxy**: Proxies the exact selected stream locally with its required Referer, preventing preview from falling back to a provider container.
- **Per-preview diagnostics**: A bounded, in-memory Log overlay records actual player, buffer-runway, range, MOOV-tail, seek, decode, retry, and governor events. It is cleared when the preview closes and redacts credentials, signed-query values, and local paths.
- **Adaptive traffic governor**: Upload, download, and stream goodput are observed independently. Background chunks yield only while a playing preview has critical runway, then immediately return capacity to the user-configured Transfer Settings ceiling.
- **User-Assisted Inspection**: Opens an isolated temporary WebView for user-completed login or challenge flows and accepts only subsequently public, independently validated media URLs; no cookie or credential export occurs.
- **Subtitle Transformer**: Converts embedded captions into standardized `.SRT` and `.VTT` subtitle tracks.
- **Multi-Language Auto-Translation**: Translates video captions into user-specified languages (Indonesian, English, Japanese, etc.) on the fly.
