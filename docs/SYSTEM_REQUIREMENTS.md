# AutoGram System Requirements & Compatibility

Detailed hardware, operating system, and network specifications required to run AutoGram.

---

## 🖥️ 1. Desktop Application (Windows)

| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Operating System** | Windows 10 (64-bit, Build 19041+) | Windows 11 (64-bit, Version 22H2+) |
| **Processor (CPU)** | Intel Core i3 / AMD Ryzen 3 (Dual-Core) | Intel Core i5 / AMD Ryzen 5 (Quad-Core+) |
| **Memory (RAM)** | 4 GB RAM | 8 GB+ RAM |
| **Disk Space** | 250 MB free space (SSD recommended) | 500 MB free space |
| **Webview Runtime** | Microsoft Edge WebView2 Evergreen | Microsoft Edge WebView2 Evergreen |
| **Display Resolution** | 1280 × 720 (HD) | 1920 × 1080 (Full HD) or higher |

---

## 📱 2. Mobile Application (Android APK)

| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Android Version** | Android 7.0 (API Level 24), preview target | Android 12.0+ (API Level 31+) |
| **Architecture** | ARM64, ARMv7, x86_64 or x86 matching the APK | ARM64 (`arm64-v8a`) |
| **RAM** | 3 GB RAM | 4 GB+ RAM |
| **Storage** | At least 1 GB free for the native Debug preview installation | Additional space for selected downloads/media outputs |

Android currently remains a feature-incomplete preview. The native cloud reader connects
directly to Telegram without a running computer, but this does not certify all desktop
workflows. See the [Android preview guide](../AutoGram%20App/docs/ANDROID_PREVIEW.md) for
supported paths and limitations. Install the ABI-specific APK when possible.

Cloud downloads need space for a complete verified file in internal app storage and
for a separate copy at the chosen document destination. Android may defer scheduled
work; user force-stop is not bypassed. Download/read-back verification does not imply
that uploads, crawler jobs or every desktop workflow have passed Android acceptance.

---

## 🌐 3. Network & Firewall Requirements

AutoGram communicates directly with Telegram Data Centers:
- **Outbound Ports**: TCP Port `443` (HTTPS) and TCP Port `80` (HTTP).
- **Protocols**: TLS 1.3, MTProto 2.0.
- **Bandwidth**: Minimum 5 Mbps broadband for smooth 1080p stream preview; 25 Mbps+ for 4K video transfers.
