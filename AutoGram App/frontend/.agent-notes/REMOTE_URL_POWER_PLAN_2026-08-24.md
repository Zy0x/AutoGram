# Remote URL Power Plan

Status: execution plan, not a claim that every provider is implemented.

## Product outcome

Remote URL becomes a resolver and download orchestration surface for a single URL, a multi-URL message, or an authorized public crawl. It must discover the real media variants, let the user choose exactly what to fetch, and hand the selected artifacts to the existing Transfer Manager without bypassing DRM, paywalls, account access controls, or provider restrictions.

## Core workflow

1. **Input and dry run**
   - Accept paste, drag-and-drop text, Telegram message links, and a bounded batch list.
   - Normalize Unicode, unwrap known tracking links, remove duplicates, and reject unsafe schemes.
   - Dry run resolves metadata and variants but never downloads media.
2. **Safe redirect discovery**
   - Resolve redirects with DNS/IP revalidation on every hop, a hop limit, response-size cap, and private-network/localhost blocking.
   - Preserve cookies only inside an encrypted per-provider vault and only after explicit user authorization.
3. **Resolver routing**
   - Tier A: direct file, HLS, DASH, image, and audio URLs.
   - Tier B: official/public provider APIs where available.
   - Tier C: maintained native extractors for stable public page metadata.
   - Tier D: a sandboxed browser-assisted resolver for JavaScript pages, with a hard timeout and no automatic human-verification bypass.
   - Unknown providers use conservative OpenGraph/JSON-LD/media-tag discovery.
4. **Variant model**
   - Return provider, canonical URL, author/title, media kind, dimensions, duration, codec/container, estimated bytes, thumbnail, subtitles, audio tracks, expiry, and required authorization.
   - Group video/audio combinations explicitly; never label a transcoded local variant as a provider-native resolution.
5. **User decision**
   - Single asset: compact preview and one primary action.
   - Multiple assets/slides: selectable grid/list with Select all, invert, filters, size estimate, and filename preview.
   - Expiring URLs display a clear expiry/re-resolve state.
6. **Transfer execution**
   - Freeze a signed resolution manifest before download.
   - Stream with resumable ranges where the origin supports them; validate content length/MIME/magic bytes and optional SHA-256.
   - Report stages independently: Resolving, Waiting for authorization, Downloading, Merging, Verifying, and Completed.
   - Persist resumable jobs and re-resolve only expired resources.

## Provider capability packs

Each pack implements the same resolver contract and fixture suite.

| Pack | Required coverage |
|---|---|
| X/Twitter | Photos, videos, animated media, quoted/embedded posts, profile photo/banner, metadata, best/native variants |
| Facebook | Public photos, video, reels, stories where authorized and available, albums, profile photo/banner |
| Instagram | Public/authorized posts, carousel, reels, video, stories, highlights, profile photo; no private-content bypass |
| Pinterest | Pins, video pins, boards, carousel/collage assets, original image variants |
| Pixiv | Illustrations, manga pages, ugoira manifest/frame archive, novels as structured text where permitted |
| Terabox/PikPak | Authenticated share inspection, folder navigation, explicit item selection, share-password prompt, resumable retrieval |
| Direct/short-link family | Videy-like hosts, CDN variants, signed files, HLS/DASH, bounded JavaScript redirect chains |

Provider hostnames are configuration data, not hardcoded UI branches. Closely related domains share a signature-based family resolver with hostname allowlists, redirect-policy fixtures, and kill switches.

## Crawl mode

- Scope is explicit: one public/authorized profile, board, album, folder, or bounded URL list.
- Before execution show discovered count, estimated bytes, date/type filters, dedup preview, rate budget, and output naming template.
- Use cursor checkpoints and a durable queue so pause/resume never repeats completed pages.
- Apply four-level duplicate detection: source item ID, provider unique ID, SHA-256, filename+size.
- Stop and surface authentication, consent, robots/policy, rate-limit, or removed-content states; do not silently skip.

## Performance and safety architecture

- Bounded resolver pool separated from bounded download pool; provider-specific token buckets and exponential backoff.
- Adaptive concurrency based on latency, throttling, error rate, CPU, disk pressure, and RAM circuit breaker.
- Stream to `.partial` files; never accumulate large payloads in React or Rust heap.
- Cache only resolver manifests and thumbnails with expiry/ETag; secrets and signed URLs are encrypted and redacted from logs.
- SSRF defense, decompression-bomb limits, filename/path sanitization, MIME sniffing, TLS validation, and optional malware hook.
- Provider breaker disables a failing extractor without breaking other providers.

## UI surfaces

- Remote URL modal: input, Dry run, resolver timeline, variants, selection summary, and Send to Transfer Manager.
- Batch/crawl workspace: source scope, filters, checkpoint status, failures requiring attention, and exportable manifest.
- Provider authorization is contextual inside the resolver result, not a disconnected sidebar feature.
- Every label, tooltip, validation, stage, and error has ID/EN locale parity.

## Phases and acceptance gates

1. **Resolver foundation**: direct files/HLS/DASH, redirect safety, manifests, dry run. Gate: deterministic fixtures and SSRF tests.
2. **Main social providers**: X, Facebook, Instagram, Pinterest, Pixiv. Gate: single/multi assets, removed/private states, variant accuracy.
3. **Cloud shares**: Terabox/PikPak selection and authorization. Gate: folders, password prompt, resume, expiry recovery.
4. **Short-link families**: signature resolver and sandboxed JS fallback. Gate: redirect limits, pop-up isolation, failure clarity.
5. **Crawl**: durable cursors, dedup, filters, batch transfer. Gate: pause/restart recovery and 10k synthetic item soak test.
6. **Production hardening**: telemetry without secrets, provider breakers, resource budgets, signed fixture refresh.

Release requires successful Rust tests, frontend tests/locale audit, download integrity fixtures, deliberate throttling tests, crash/restart recovery, and native `frontend.exe` QA. Unsupported or protected content must produce an honest status rather than a false success.
