# AutoGram Build System & Release Hub

This directory is the dedicated standalone hub for building, packaging, and producing distribution binaries for **AutoGram Desktop (Windows)** and **AutoGram Mobile (Android APK)**.

---

## 📁 Directory Structure

```
build/
├── README.md                      # This documentation
├── build_all.bat                  # 1-Click build for both Desktop & Android APK
├── build_desktop.bat              # Compile & package Windows Desktop (.exe / .msi)
├── build_desktop.ps1              # Desktop build engine (PowerShell)
├── build_apk.bat                  # Compile & package Android APK (.apk)
├── build_apk.ps1                  # Android APK build engine (PowerShell)
├── bootstrap_toolchains.bat       # Auto-download isolated Android SDK & JDK 17
│
├── tools/                         # Build helper scripts & utilities
│   ├── generate_bindings.bat      # UniFFI Rust-to-Kotlin bindings generator
│   ├── install_apk_to_device.bat  # Install output APK to physical phone via ADB
│   └── launch_emulator.bat        # Launch isolated Android emulator
│
└── output/                        # LOCAL ONLY: Generated production binaries (Git Ignored)
    ├── desktop/                   # Output Windows executables & MSI installers
    └── apk/                       # Output Android debug & release APKs
```

---

## 🚀 How to Build

### 1. Build Windows Desktop Application
Double-click `build_desktop.bat` or run:
```cmd
build\build_desktop.bat
```
* **Process**: Compiles React frontend via Vite, compiles native Rust engine via Tauri, and bundles the application.
* **Output**: `.exe` and `.msi` installers are automatically placed in `build\output\desktop\`.

---

### 2. Build Android APK
Double-click `build_apk.bat` or run:
```cmd
build\build_apk.bat
```
* **Process**: Generates UniFFI Kotlin bindings, compiles native `autogram-core` libraries for Android architectures (`arm64-v8a`, `x86_64`), and runs Gradle build.
* **Output**: Generated `.apk` files are automatically placed in `build\output\apk\`.

---

### 3. Build All Targets (Desktop + Android)
Double-click `build_all.bat` to compile both platforms sequentially.

---

## 🛠️ Developer Utilities (`build/tools/`)

- **Install APK to Phone**: Run `build\tools\install_apk_to_device.bat` to push the latest APK in `output/apk/` to a connected phone via ADB.
- **Launch Android Emulator**: Run `build\tools\launch_emulator.bat` to start the isolated Android virtual device.
- **Regenerate Bindings**: Run `build\tools\generate_bindings.bat` when Rust core API interfaces change.
