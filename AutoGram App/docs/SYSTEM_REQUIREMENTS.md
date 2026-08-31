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
| **Android Version** | Android 8.0 (Oreo, API Level 26) | Android 12.0+ (API Level 31+) |
| **Architecture** | ARM64 (`aarch64`) / x86_64 | ARM64 (`arm64-v8a`) |
| **RAM** | 3 GB RAM | 4 GB+ RAM |
| **Storage** | 100 MB free storage | 200 MB free storage |

---

## 🌐 3. Network & Firewall Requirements

AutoGram communicates directly with Telegram Data Centers:
- **Outbound Ports**: TCP Port `443` (HTTPS) and TCP Port `80` (HTTP).
- **Protocols**: TLS 1.3, MTProto 2.0.
- **Bandwidth**: Minimum 5 Mbps broadband for smooth 1080p stream preview; 25 Mbps+ for 4K video transfers.
