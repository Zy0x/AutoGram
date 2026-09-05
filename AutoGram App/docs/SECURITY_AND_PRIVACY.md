# AutoGram Security, Privacy & Data Protection Architecture

At AutoGram, user security, account confidentiality, and cryptographic data protection are non-negotiable core principles.

---

## 🔒 1. Direct MTProto Architecture (Zero Middleman Servers)

Unlike cloud-based Telegram bot managers or web scrapers:
- **Direct Client-to-DC Sockets**: AutoGram establishes direct TLS/MTProto socket connections between your computer and official Telegram Data Centers (DCs).
- **Zero Proxy Servers**: Your credentials, phone number, messages, files, and media never pass through any third-party intermediary servers.
- **Zero Telemetry & Analytics**: AutoGram does not collect user metrics, device telemetry, transfer history, or file filenames.

---

## 🔑 2. Cryptographic Storage & Session Encryption

1. **AES-GCM Encryption at Rest**:
   - All Telegram session tokens (`*.session`), API hashes, and authentication credentials are encrypted using industry-standard **AES-256-GCM** before being written to your local disk.
   - Master keys are derived using secure machine-bound entropy and hardware-backed key derivation.
2. **Zero Plaintext Credentials in Logs**:
   - AutoGram's Rust engine strips all authentication hashes, phone numbers, and session keys from terminal logs and stdout/stderr output.
3. **Encrypted In-Memory ZIP Decryption**:
   - Password-protected archives (AES-128/256 and ZipCrypto) are decrypted directly in volatile RAM buffers. No unencrypted temporary files are ever written to your hard drive.

---

## 🛡️ 3. Safe API Rate Limiting & Account Protection

Telegram strictly enforces rate limits (`FLOOD_WAIT_X`) to protect its infrastructure from spam:
- **Smart Rate Controller**: AutoGram dynamically detects MTProto `FloodWait` response headers, extracts the exact cooldown period, and applies intelligent exponential backoff.
- **Circuit Breaker Protocol**: If consecutive network or rate errors exceed safe limits, AutoGram automatically trips the transfer circuit, halts queue processing, and alerts the user to prevent account restrictions.
- **Chunked Transfer Slicing**: Large files (up to 2 GB for free accounts, up to 4 GB for Telegram Premium) are transferred in optimized 512 KB–1 MB streaming slices matching Telegram's official protocol specifications.

---

## 🌐 4. Supabase Cloud Integration (Phase 2) Security

When integrating cloud sync via Supabase:
- **Row Level Security (RLS)**: Strictly enforced on every table. Users can only read and write rows matching their authenticated user ID (`auth.uid() = user_id`).
- **Server-Side Edge Functions**: Sensitive operations run exclusively inside secure Deno Edge Functions with encrypted secrets accessed via `Deno.env.get()`.
- **Public Anon Key Restrictions**: The frontend client interacts with Supabase exclusively through public anonymous keys with zero administrative privileges.

---

## 🔎 5. Remote Link Discovery & Assisted Inspection

- **Public-network validation**: Remote URL checks every redirect and discovered candidate before fetching. Private addresses, embedded credentials, and local-network targets are rejected.
- **No extension trust**: A filename ending in `.mp4` is not treated as media until its response bytes and transport metadata validate it.
- **Isolated assisted window**: A user-assisted page opens in a temporary incognito webview. It can report only potential media URLs to a dedicated, least-privilege command.
- **No credential export**: Cookies, local storage, passwords, CAPTCHA values, and Telegram credentials are never copied from the assisted window. A session-bound resource that cannot be fetched independently is not queued for transfer.
- **Preview diagnostic privacy**: The preview Log uses a 500-event in-memory ring buffer and is deleted when its preview closes. URL query strings, cookies, tokens, credentials, and absolute local paths are removed before an event can be shown or copied.

---

## 📋 6. Summary of Security Guarantees

| Security Aspect | Implementation |
| :--- | :--- |
| **Session Protection** | AES-256-GCM encrypted local storage |
| **Connection Protocol** | Native Grammers Rust MTProto (TLS 1.3 / TCP) |
| **Third-Party Telemetry** | 0% (Completely disabled) |
| **Temporary File Leakage** | 0 bytes (In-memory stream decryption) |
| **Database Encryption** | SQLite WAL mode with client-side isolation |
