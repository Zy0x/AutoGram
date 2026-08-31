# AutoGram Developer & Contributor Guide

Welcome to the AutoGram engineering and contributor guide. This document explains the codebase architecture, development conventions, IPC bridge protocols, and testing standards.

---

## 🛠️ 1. Architecture Overview

AutoGram uses a modular 3-tier desktop architecture:

1. **Presentation Layer (`AutoGram App/frontend/src/`)**:
   - **Framework**: React 18 with TypeScript and TailwindCSS.
   - **State Management**: Zustand stores (`useTelegramStore`, `useDriveStore`, `useTransferManager`).
   - **Internationalization**: `react-i18next` with 100% key parity between `src/locales/id/` and `src/locales/en/`.
   - **Zero Direct Telegram API Rule**: The frontend never connects to Telegram directly; all actions pass through Tauri IPC commands.

2. **Core Desktop Backend (`AutoGram App/frontend/src-tauri/`)**:
   - **Tauri 2.x**: Native Rust runtime handling windowing, secure storage, and IPC commands.
   - **Grammers MTProto**: Native Rust client handling Telegram sockets, multi-DC connection pooling, chunked uploads, and rate limiting.
   - **Range HTTP Server**: Ephemeral `tiny_http` server bound to `127.0.0.1` providing HTTP 206 Partial Content streams for media preview.

3. **Core Modular Crates (`AutoGram App/crates/`)**:
   - `autogram-core`: High-performance SQLite WAL job queue, policy engine, and account score manager.
   - `autogram-android-bridge`: UniFFI cross-language bridge exposing Rust engine APIs to Kotlin on Android.

---

## 💻 2. Daily Development Workflow

### Starting the Dev Server
```cmd
# Method 1: Using the 1-click launcher
.\Buka_AutoGram_LiveDev.bat

# Method 2: Manual terminal
cd "AutoGram App/frontend"
npm run tauri dev
```

### Adding New Tauri IPC Commands
1. Define the Rust command in `src-tauri/src/commands/` or `src-tauri/src/grammers_ops/`.
2. Register the command in `src-tauri/src/lib.rs` inside the `generate_handler![...]` macro.
3. Expose the typed TypeScript wrapper in `AutoGram App/frontend/src/lib/telegram/telegramBackend.ts`.

---

## 🌐 3. Internationalization (i18n) Rules

- **Zero Hardcoded Strings**: Hardcoding user-facing strings directly in `.tsx` / `.ts` files is strictly prohibited.
- **Parity Guarantee**: Every key added to `src/locales/id/*.json` must have a matching key in `src/locales/en/*.json`.
- **Audit Verification**: Run `node tools/locale-audit.mjs` before committing.

---

## 🧪 4. Running Test Suites

```bash
cd "AutoGram App/frontend"

# Run all 44 Vitest suites and the locale parity audit
npm test

# Run strict TypeScript compiler verification
npx tsc --noEmit
```

---

## 📦 5. Building & Packaging

Use the standalone scripts in the root **`build/`** folder:
- Windows Desktop: `build\build_desktop.bat` (Generates `.exe` and `.msi` in `build/output/desktop/`).
- Android APK: `build\build_apk.bat` (Generates `.apk` in `build/output/apk/`).
