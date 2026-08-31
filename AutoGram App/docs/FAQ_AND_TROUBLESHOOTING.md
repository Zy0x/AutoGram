# AutoGram Frequently Asked Questions & Troubleshooting

Answers to common questions and quick troubleshooting steps for AutoGram.

---

## ❓ Frequently Asked Questions

### 1. Is my Telegram account safe when using AutoGram?
**Yes.** AutoGram connects directly to official Telegram servers using MTProto. Your phone number, verification code, and session keys are encrypted locally using AES-256-GCM and are never transmitted to any third-party servers.

### 2. What is the maximum file size I can transfer?
- **Free Telegram Accounts**: Up to 2,000 MB (2.0 GB) per file.
- **Telegram Premium Accounts**: Up to 4,000 MB (4.0 GB) per file.

### 3. Can I open password-protected ZIP files?
**Yes.** AutoGram supports both standard **ZipCrypto** and military-grade **WinZip AES-128 / AES-256** encrypted archives. When opening an encrypted archive, AutoGram prompts for your password and decrypts individual files on the fly in memory.

### 4. What media platforms are supported by Remote URL?
AutoGram natively supports YouTube, TikTok, Instagram, Twitter/X, Videe, Vqso, StreamRizz, and generic direct video links (.mp4, .webm, .m3u8).

---

## 🛠️ Common Troubleshooting Steps

### A. Telegram "FloodWait" or Cooldown Error
- **Cause**: Telegram temporarily throttles accounts that execute too many requests in a short time.
- **Solution**: AutoGram automatically enters a cooldown countdown. Let the timer expire; transfers will resume automatically with exponential backoff.

### B. YouTube Stream Preview Fails to Load
- **Cause**: YouTube signed video streams require specific headers and referers.
- **Solution**: AutoGram automatically routes the preview through its native local range proxy. Ensure your firewall allows local loopback traffic on `127.0.0.1`.

### C. Database Backup & Reset
- If you need to reset or export your transfer history, navigate to **Settings > Data & Storage > Database Backup** and click **Export Backup (SQL/JSON)**.
