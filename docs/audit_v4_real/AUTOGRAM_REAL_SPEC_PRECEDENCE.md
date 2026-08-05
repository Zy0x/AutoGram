# AutoGram Real Specification Precedence Register

Authoritative Specification Precedence and Domain Conflict Resolution Rules for AutoGram.

---

## 1. Domain Specification Hierarchy

When rules across specifications conflict, the domain-specific latest specification takes strict precedence according to the following order:

1. **Spec v4.7**: Encoder Engine, Hardware Device Discovery, Output Validation, and Resource Scheduling.
2. **Spec v4.6**: Album Orchestration, Idempotency State Machine, `UNKNOWN_COMMIT`, Avoid-Single Rebalancing, and Failure Recovery.
3. **Spec v4.5**: Transfer Manager, Persistent Job Queue, Smart Rate Controller, FloodWait Persistence, Download Lifecycle, Caption Engine, and Send Lifecycle.
4. **Spec v4.4**: Oversize Transfer Manager, Volume Split Engine, Alternate Account Selector, Skip/Defer Audit Trail, and Reassembly.
5. **Spec v4.3**: Universal File Routing, Format Category Classification (`MediaCategory` Enum), and File Preservation Rules.
6. **Spec v4.1**: Quality Mode Engine Baseline Contracts (`ORIGINAL`, `HQ`, `SMART`), Preflight Approval, and Feature Flag Scoping.
7. **Master Architecture v2.8.7**: Baseline desktop architecture (Rust + Tauri + Grammers MTProto, SQLite, React UI). Master v2.8.7 applies ONLY to components not superseded by v4.x.

---

## 2. Explicit Domain Conflict Resolutions

### A. Album Packing & Grouping Size (v4.6 vs Master Architecture v2.8.7)
- **Master v2.8.7 Conflict**: Stated max 9 items for 3x3 grid display.
- **Spec v4.6 Precedence**: Album supports 2 to 10 items (up to 10 compatible items in 1 album).
- **Avoid-Single Rule**:
  - 10 items stay in 1 album of 10 items.
  - 11 items with `album_avoid_single = true` rebalance to 9 + 2 partitions (avoiding 10 + 1 single remainder).
  - 11 items with `album_avoid_single = false` partition to 10 + 1.
- **Legacy Fallback Rule**: Automatic single item fallback is **REMOVED**. Single items must strictly follow specified failure policies or atomic replan policies.

### B. Commit Timeouts & Idempotency (v4.6 vs v4.5)
- **Spec v4.6 Precedence**: Any network timeout during MTProto `sendMultiMedia` RPC MUST transition the album order state to `UNKNOWN_COMMIT`.
- **Reconciliation Constraint**: Retrying `sendMultiMedia` directly while commit state is unknown is **STRICTLY FORBIDDEN**. Pre-send `AlbumCommitIntent` and logical commit IDs must be reconciled via server message receipts before any retry.

### C. Hardware Detection & Encoding (v4.7 vs v4.1)
- **Spec v4.7 Precedence**: Static enum priority is superseded by physical GPU hardware discovery (L0-L6 probes executing `ffmpeg -hwaccels`, per-codec smoke encodes, and dynamic resource admission controller).
- **Output Safety Chain**: Remux/transcode output MUST pass `OutputContract` validator (checking container streams, duration, timestamp sync, color space, HDR metadata, rotation) before entering the upload gate.

---

## 3. Scope Classifications

Every requirement and explicit case must be strictly categorized into one of four scopes:

- **`CURRENT_DESKTOP`**: Features active in the current Tauri + React + Rust desktop application (`AutoGram App/`).
- **`SHARED_CORE`**: Shared Rust engine contracts, data structures, and database schemas.
- **`FUTURE_ANDROID`**: Mobile/Android platform parity items deferred until Android native repository is active.
- **`EXTERNAL_TELEGRAM_BLOCKED`**: Features requiring live Telegram MTProto RPC sandbox credentials.
