# AutoGram (Open-Source Telegram Cloud Drive & Automation Platform)

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-blue.svg)](#)
[![Tech Stack](https://img.shields.io/badge/stack-React%20%7C%20Tauri%20%7C%20Rust%20%7C%20Grammers-orange.svg)](#)

**AutoGram** is a high-performance, client-side Telegram Cloud Drive, Remote Media Downloader, and Transfer Automation Platform built on a native **Rust MTProto (Grammers)** engine and **Tauri 2.x**.

AutoGram transforms Telegram into an organized, high-speed virtual filesystem with unlimited nested folders, in-memory sparse ZIP streaming, universal social media downloading, and 4-level duplicate prevention.

---

## 🌟 Core Highlights

- **⚡ Native Grammers Rust MTProto Engine**: 100% native Rust Telegram client with direct socket connections to Telegram Data Centers (DC1–DC5). Zero Python runtime dependencies.
- **🗜️ Zero-Waste Sparse ZIP Streaming**: Inspect 10 GB+ archives in milliseconds and stream single files on the fly without downloading the whole archive. Supports PKWARE ZipCrypto and WinZip AES-128/256 decryption directly in RAM.
- **🛡️ 4-Level Duplicate Prevention Matrix**: Quadruple-check duplicate prevention system (Telegram Message ID, Unique File ID, Binary SHA-256 hash, Filename + Size) to protect cloud quota and bandwidth.
- **🎬 Universal Remote Media Downloader**: Transfer media directly to Telegram from YouTube (up to 8K/4K HDR @ 60 FPS), TikTok, Instagram, Twitter/X, and direct streams with multi-language subtitle conversion (.SRT/.VTT).
- **🔒 100% Client-Side Privacy**: AES-256-GCM encrypted local session storage. Zero telemetry, zero external proxy servers.

---

## 💻 System Requirements & Prerequisites

### 1. Windows Desktop
- **Operating System**: Windows 10 (64-bit, Build 19041+) or Windows 11.
- **Node.js**: `v18.18.0+` or `v20.x LTS` + `npm`.
- **Rust Toolchain**: `1.77.0+` (stable) with target `x86_64-pc-windows-msvc`.
- **C++ Build Tools**: Visual Studio 2022 C++ Build Tools (MSVC Linker).
- **WebView2**: Microsoft Edge WebView2 Evergreen (pre-installed on Windows 10/11).

### 2. Android APK (Optional Cross-Compilation)
- **JDK**: `OpenJDK 17 LTS` (`JAVA_HOME`).
- **Android SDK**: API Level 34 + Platform Tools (`ANDROID_HOME`).
- **Android NDK**: NDK `r26d+` (`ANDROID_NDK_HOME`).
- **Cargo Tools**: `cargo install cargo-ndk uniffi-bindgen`.

---

## 🚀 Quickstart: Running in Development

### 1. Clone the Repository
```bash
git clone https://github.com/Zy0x/AutoGram.git
cd AutoGram
```

### 2. Install Frontend Dependencies
```bash
cd "AutoGram App/frontend"
npm install
```

### 3. Launch Development Mode
From the root directory:
```cmd
Buka_AutoGram_LiveDev.bat
```
Or manually via terminal:
```bash
cd "AutoGram App/frontend"
npm run tauri dev
```

---

## 📦 Building Distribution Packages

All build tools, packaging utilities, and compiled binary outputs are organized under the standalone **`build/`** directory:

### 1. Build Windows Desktop Installer (.exe / .msi)
```cmd
build\build_desktop.bat
```
*Outputs are saved to `build/output/desktop/`.*

### 2. Build Android APK (.apk)
```cmd
build\build_apk.bat
```
*Outputs are saved to `build/output/apk/`.*

### 3. Build All Targets
```cmd
build\build_all.bat
```

---

## 🧪 Testing & Verification

```bash
# Run unit test suite & i18n locale parity audit
cd "AutoGram App/frontend"
npm test

# Run strict TypeScript compilation check
npx tsc --noEmit
```

---

## 📁 Repository Structure

```
AutoGram/
│
├── AutoGram App/                     # Pure source code repository
│   ├── frontend/                     # React 18, TypeScript, TailwindCSS UI
│   │   └── src-tauri/                # Native Rust Desktop Core (Tauri + Grammers)
│   ├── crates/                       # Modular Rust crates (autogram-core, bridge)
│   ├── android/                      # Kotlin UI & Gradle Android project
│   ├── database/                     # Consolidated SQLite schema & migrations
│   └── docs/                         # Public user documentation
│
├── docs/                             # Documentation portal (User Guides, Security, FAQ)
├── build/                            # Standalone builder scripts & isolated output/
└── Buka_AutoGram_LiveDev.bat         # 1-Click launcher for local live development
```

---

## 📄 License & Open-Source

AutoGram is licensed under the [MIT License](../LICENSE). Contributions and pull requests are welcome!
