# AutoGram User Guide & Operational Manual

A comprehensive guide on setting up, using, and maximizing your productivity with AutoGram.

---

## 📑 Table of Contents
1. [Getting Started & Account Connection](#1-getting-started--account-connection)
2. [Cloud Drives & Folder Management](#2-cloud-drives--folder-management)
3. [Remote Media Downloader & Streaming](#3-remote-media-downloader--streaming)
4. [Sparse ZIP Browser & In-Memory Extraction](#4-sparse-zip-browser--in-memory-extraction)
5. [Forwarder & Channel Automations](#5-forwarder--channel-automations)
6. [Transfer Queue & Clean-Copy Deduplication](#6-transfer-queue--clean-copy-deduplication)
7. [Settings & Backup Management](#7-settings--backup-management)

---

## 1. Getting Started & Account Connection

### Connecting Your Telegram Account
1. Launch **AutoGram**.
2. Click **Accounts** in the top-right toolbar or the **Account Selector** in the left sidebar.
3. Select **Add Account**:
   - **Phone Number Login**: Enter your international phone number (e.g. `+62812...`) and submit. Enter the verification code received inside your official Telegram app.
   - **Two-Step Verification (2FA)**: If your account has cloud password protection enabled, enter your 2FA password when prompted.
4. Once connected, your account name and username (e.g. `Lavender (@lv_drr)`) will appear with real-time ping latency and connection status.

---

## 2. Cloud Drives & Folder Management

AutoGram transforms Telegram into a structured cloud file system:

- **Saved Messages**: Your private Telegram cloud workspace for personal files and backups.
- **Dedicated Cloud Drives**: Create private channels as dedicated root drives (e.g., `#Work_Files`, `#Media_Vault`).
- **Nested Folders**: Create hierarchical directories inside any drive with unlimited depth.
- **Drag-and-Drop Organization**: Drag files or entire folders to reorder, reparent, or move them between categories and topics.
- **Media Gallery & Grid Customization**: Switch between Bento Grid, Card View, and Compact Table views with customizable thumbnail sizing (`Saver`, `Balanced`, `Sharp`).

---

## 3. Remote Media Downloader & Streaming

Transfer online videos and social media content directly into your Telegram Cloud without saving to your local disk:

### Supported Providers
- **Video Platforms**: YouTube (up to 8K/4K HDR @ 60 FPS), TikTok, Instagram, Twitter/X, Videe, Vqso, StreamRizz, and generic MP4/WEBM direct URLs.

### Step-by-Step Usage:
1. Click **Remote URL** in the top navigation bar.
2. Paste the target media URL. AutoGram will automatically resolve available formats, resolutions, audio tracks, and subtitles.
3. **Format & Resolution Selector**:
   - **General** shows one verified best candidate for each real resolution; **Advance** retains every verified container and track.
   - Filter by **Video**, **Audio**, or **Subtitle** tabs. A filename such as `video-8k.mp4` is never treated as proof of 8K.
   - Click any format chip to inspect verified resolution, codec, framerate, and estimated file size.
4. **Live Synchronized Preview**:
   - Click **Play Stream** or double-click any format chip to preview that exact selected stream through the local range proxy.
   - A format marked download-only is not presented as a playable preview.
5. **Folders, galleries, and wrapper pages**:
   - Remote URL verifies payload bytes before offering a download. HTML pages disguised as `.mp4`, advertising redirects, and unavailable links are not selectable media.
   - For large public folders, use **Load next results** to continue the safe recursive scan without duplicating already found media.
   - If a page requires JavaScript, login, or a challenge, use **Open user-assisted inspection**. Complete the page action yourself; AutoGram only validates public media URLs that the page subsequently requests. Cookies, passwords, and challenge credentials are never exported.
6. **Subtitle Language Selection**:
   - Under the **Subtitel** tab, select embedded or auto-translated captions (.SRT / .VTT).
7. Click **Transfer to Drive** to queue the verified download-and-upload directly into your active Telegram destination.

---

## 4. Sparse ZIP Browser & In-Memory Extraction

AutoGram introduces revolutionary **Sparse ZIP Streaming** technology:

- **Instant ZIP Exploration**: Open 5 GB–20 GB ZIP archives stored on Telegram instantly without downloading the archive.
- **Encrypted Archive Support**: Seamlessly preview files inside password-protected ZIPs (PKWARE ZipCrypto and WinZip AES-128/256).
- **Zero Bandwidth Waste**: Extracting a 2 MB photo from a 10 GB archive fetches *only* that 2 MB byte-range from Telegram servers.

---

## 5. Forwarder & Channel Automations

Automate channel-to-channel content delivery:

- **Media Forwarder Workspace**: The Overview surfaces only real local job status, pending decisions, completed jobs, and the next safe action. Use **Create Job** to enter the guided source, rules, delivery, and review flow.
- **Decision Inbox**: When a duplicate or restriction requires your choice, the job pauses safely and appears in **Decisions**. Resolve it with the displayed option before resuming the job.
- **Local-first Execution**: Forwarder jobs run on the selected desktop session. Telegram credentials and session material remain on the device.
- **Source & Destination Mapping**: Link source channels/chats with destination channels or specific forum topics.
- **Filtering Rules**: Filter by file extension, media kind (videos, images, docs, audio), minimum/maximum file size, or keyword matches.
- **Caption Transformation**: Apply automated prefix/suffix headers, channel watermark removal, or dynamic file renaming patterns.

The Media Forwarder workspace does not replace Transfer Manager media delivery controls. Existing album and grid delivery settings continue to be applied by the transfer engine.

---

## 6. Transfer Queue & Clean-Copy Deduplication

The **Transfer Manager** oversees all network activity:

- **4-Level Duplicate Prevention**: Before any transfer starts, AutoGram verifies if the file already exists on Telegram using:
  1. Telegram Message ID match
  2. Telegram Unique File ID (`file_reference`)
  3. SHA-256 binary hash
  4. Filename + exact size match
- **Resolution Policies**: Choose to `Skip`, `Replace`, `Keep Both`, or `Rename` duplicate items.
- **Smart Rate Limiter**: Automatically throttles speed and applies exponential backoff if Telegram triggers `FloodWaitError`.

---

## 7. Settings & Backup Management

- **Theme & Appearance**: Dark slate modern glassmorphism interface with high-contrast readability.
- **Language**: Full bilingual support (Bahasa Indonesia & English) with 100% complete localized terminology.
- **Database Backup & Export**: Export your SQLite transfer history and catalog metadata with 1-click JSON/SQL backups.
