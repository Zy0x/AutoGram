# AutoGram Documentation Portal

Welcome to the official documentation for **AutoGram** — the high-performance Telegram Cloud Drive, Remote Media Downloader, and Automation Platform.

---

## 📚 Public Documentation Index

| Document | Description | Target Audience |
| :--- | :--- | :--- |
| 📖 [**User Guide**](./USER_GUIDE.md) | Step-by-step walkthrough of all features, from connecting your Telegram account to remote media streaming and ZIP browsing. | End Users & Operators |
| 🛡️ [**Security & Privacy**](./SECURITY_AND_PRIVACY.md) | Transparent overview of our client-side encryption, direct MTProto connections, and zero-telemetry architecture. | All Users & Security Auditors |
| ⚡ [**Features & Capabilities**](./FEATURES_AND_CAPABILITIES.md) | Complete breakdown of the 4-level deduplication engine, sparse ZIP preview, and multi-session transfer queue. | Power Users & Technical Teams |
| 💻 [**System Requirements**](./SYSTEM_REQUIREMENTS.md) | Hardware, OS, and network prerequisites for running AutoGram Desktop and Android APK. | System Administrators & Users |
| ❓ [**FAQ & Troubleshooting**](./FAQ_AND_TROUBLESHOOTING.md) | Frequently asked questions, FloodWait recovery guide, and troubleshooting tips. | All Users |

---

## 🌟 Key Highlights of AutoGram

Android Debug APKs remain previews rather than complete desktop replacements. Cloud
Drive preview uses native byte-range reads and a progressive player with separate
startup and ongoing buffer thresholds. Supported images, text, audio and video do not
imply archive/document or transfer parity. See the current
[Android preview guide](../AutoGram%20App/docs/ANDROID_PREVIEW.md) for limits and controls.

1. **Native Grammers Rust MTProto Engine**: Connects directly to official Telegram Data Centers with maximum bandwidth efficiency and lowest CPU overhead.
2. **Zero-Waste Sparse ZIP Streaming**: Browse and extract single files inside 10 GB+ ZIP archives in milliseconds without downloading the whole file.
3. **4-Level Duplicate Prevention**: Protects Telegram storage from duplicate uploads using cryptographic hash and file pointer checks.
4. **Universal Remote Media Pipeline**: Extract, convert, preview, and transfer media from YouTube, TikTok, Instagram, Twitter/X, and direct streams with multi-language subtitle support.
5. **100% Client-Side Privacy**: All sessions and secrets are encrypted at rest using AES-GCM. No external analytics or proxy servers are ever used.

---

## 🤝 Support & Feedback

If you encounter any issues or have feature suggestions:
- Check our [FAQ & Troubleshooting](./FAQ_AND_TROUBLESHOOTING.md) guide.
- Report issues via our official GitHub repository.
