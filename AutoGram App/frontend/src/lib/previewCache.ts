/**
 * In-memory preview result cache + in-flight dedupe + neighbor prefetch.
 * Makes next/prev feel instant when media was already opened or prefetched.
 */
import type { DriveCredentials } from './driveApi';
import { drivePreview, drivePreviewWarm } from './driveApi';

export type CachedPreview = {
  data_url?: string | null;
  path?: string | null;
  stream_url?: string | null;
  stream_id?: string | null;
  mime_type?: string | null;
  size?: number;
  preview_kind?: string;
  /** Inline text/JSON body from worker (skips HTTP stream fetch) */
  text_content?: string | null;
  too_large?: boolean;
  streaming?: boolean;
  poster_url?: string | null;
  buffered?: number;
  message?: string;
  quality?: string;
  qualities?: Array<{
    id: string;
    label: string;
    description?: string;
    height?: number | null;
    size?: number | null;
    native?: boolean;
    transcode?: boolean;
  }>;
  video_width?: number | null;
  video_height?: number | null;
  status?: string;
  /** wall clock when cached */
  cachedAt: number;
};

const TTL_MS = 20 * 60 * 1000; // longer — next/prev stays instant
const MAX_ENTRIES = 72;

const cache = new Map<string, CachedPreview>();
const inflight = new Map<string, Promise<CachedPreview>>();

export function previewCacheKey(
  folderId: number | null,
  messageId: number,
  quality: string
): string {
  return `${folderId ?? 'home'}:${messageId}:${quality || 'auto'}`;
}

function touch(key: string, val: CachedPreview) {
  cache.delete(key);
  cache.set(key, val);
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first == null) break;
    cache.delete(first);
  }
}

export function getCachedPreview(
  folderId: number | null,
  messageId: number,
  quality: string
): CachedPreview | null {
  const key = previewCacheKey(folderId, messageId, quality);
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU bump
  touch(key, hit);
  return hit;
}

export function setCachedPreview(
  folderId: number | null,
  messageId: number,
  quality: string,
  res: Omit<CachedPreview, 'cachedAt'>
): CachedPreview {
  const entry: CachedPreview = { ...res, cachedAt: Date.now() };
  touch(previewCacheKey(folderId, messageId, quality), entry);
  return entry;
}

/** Incomplete progressive files are not a solid cache hit (need live stream_url). */
function isSolidLocalHit(hit: CachedPreview): boolean {
  if (hit.text_content != null && hit.text_content !== '') return true;
  if (hit.data_url && hit.data_url.startsWith('data:')) return true;
  const p = hit.path || '';
  if (!p) return false;
  // Hollow progressive cache path — not playable alone
  if (/\.stream\./i.test(p)) return false;
  // Complete text/pdf/image path without live stream dependency
  if (
    hit.preview_kind === 'text' ||
    hit.preview_kind === 'pdf' ||
    hit.preview_kind === 'image'
  ) {
    if (!hit.streaming) return true;
    if (hit.buffered && hit.size && hit.buffered >= hit.size * 0.98) return true;
  }
  // Still streaming / incomplete
  if (hit.streaming && !(hit.buffered && hit.size && hit.buffered >= hit.size * 0.98)) {
    return false;
  }
  return true;
}

function isFreshStreamHit(hit: CachedPreview, maxAgeMs?: number): boolean {
  if (!hit.stream_url || !/^https?:\/\//i.test(hit.stream_url)) return false;
  // Progressive streams die when browsing many videos (port/stream_id churn).
  // Keep cache short so we re-RPC instead of replaying a dead URL in a loop.
  const ttl =
    maxAgeMs ??
    (hit.streaming || hit.preview_kind === 'stream' || hit.preview_kind === 'video'
      ? 20_000
      : 90_000);
  if (Date.now() - hit.cachedAt > ttl) return false;
  return true;
}

/** Fetch preview with cache + single-flight. */
export async function loadPreviewCached(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  quality: string,
  opts?: { force?: boolean }
): Promise<CachedPreview> {
  const q = quality || 'auto';
  const hit = getCachedPreview(folderId, messageId, q);
  // Complete local only (full file / faststart) — never trust hollow .stream. alone
  if (!opts?.force && hit && isSolidLocalHit(hit)) {
    return hit;
  }
  // Fresh progressive HTTP stream only — older ports die after worker bounce
  if (!opts?.force && hit && isFreshStreamHit(hit)) {
    return hit;
  }

  const key = previewCacheKey(folderId, messageId, q);
  const existing = inflight.get(key);
  if (existing && !opts?.force) return existing;

  const p = (async () => {
    try {
      if (isPreviewWarmPaused()) {
        // Still allow explicit open, but backend will fail-fast on FloodWait.
      }
      const res = await drivePreview(creds, messageId, folderId, {
        quality: q,
        // Backend: skip blocking poster (grid thumb is enough for instant UI)
        skipPoster: true,
      });
      // Drop hollow progressive results that have no usable stream_url —
      // caching them causes endless "reload" when opening many videos.
      const r = res as unknown as CachedPreview;
      if (
        r &&
        r.streaming &&
        !r.stream_url &&
        !r.data_url &&
        !(r.path && !/\.stream\./i.test(String(r.path)))
      ) {
        return r;
      }
      return setCachedPreview(folderId, messageId, q, r);
    } catch (e) {
      noteFloodFromError(e);
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** Prefetch neighbors in background (fire-and-forget). */
export function prefetchPreviews(
  creds: DriveCredentials,
  folderId: number | null,
  messageIds: number[],
  quality: string
): void {
  const q = quality || 'auto';
  // De-dupe ids while preserving order
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const mid of messageIds) {
    if (!mid || mid <= 0 || seen.has(mid)) continue;
    seen.add(mid);
    ordered.push(mid);
  }
  if (isPreviewWarmPaused()) return;
  // Prefetch at most 1 neighbor — parallel full previews caused FloodWait storms.
  ordered.slice(0, 1).forEach((mid, i) => {
    if (getCachedPreview(folderId, mid, q)) return;
    const key = previewCacheKey(folderId, mid, q);
    if (inflight.has(key)) return;
    window.setTimeout(() => {
      if (isPreviewWarmPaused()) return;
      loadPreviewCached(creds, mid, folderId, q).catch((e) => noteFloodFromError(e));
    }, 400 + i * 600);
  });
}

/** In-flight warm heads (messageId) — avoid spamming Telegram on scroll. */
const warmInflight = new Set<string>();
const warmDone = new Map<string, number>(); // key -> ready bytes
const WARM_TTL_MS = 15 * 60 * 1000;
/** Global warm concurrency — never parallel-warm multiple videos (FloodWait). */
let warmGlobalBusy = false;
/** Pause all warm/prefetch until this timestamp (FloodWait / connection storms). */
let warmPausedUntil = 0;

export function pausePreviewWarm(ms = 35_000): void {
  warmPausedUntil = Math.max(warmPausedUntil, Date.now() + ms);
}

export function isPreviewWarmPaused(): boolean {
  return Date.now() < warmPausedUntil;
}

function noteFloodFromError(err: unknown): void {
  const msg = String((err as Error)?.message || err || '');
  if (/flood|rate limit|tunggu|wait \d+s/i.test(msg)) {
    const m = msg.match(/(\d+)\s*s/i);
    const secs = m ? Math.min(120, Math.max(15, Number(m[1]) || 30)) : 35;
    pausePreviewWarm(secs * 1000);
  } else if (/read 0 bytes|10054|connection.*closed|AUTH_BYTES/i.test(msg)) {
    pausePreviewWarm(12_000);
  }
}

/**
 * Warm first ~256–512KB only (backend light path — not full progressive).
 * Safe to call from hover / visibility; no-ops if already warm/in-flight/flooded.
 */
export function warmPreviewHead(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number,
  opts?: { headBytes?: number }
): void {
  if (!messageId || messageId <= 0) return;
  if (isPreviewWarmPaused()) return;
  if (warmGlobalBusy) return;
  const key = `${folderId ?? 'home'}:${messageId}`;
  const doneAt = warmDone.get(key);
  if (doneAt && Date.now() - doneAt < WARM_TTL_MS) return;
  if (warmInflight.has(key)) return;
  // Already have a full preview cache entry with stream
  const hit = getCachedPreview(folderId, messageId, 'auto');
  if (hit?.stream_url && (hit.buffered || 0) >= 64 * 1024) {
    warmDone.set(key, Date.now());
    return;
  }
  warmInflight.add(key);
  warmGlobalBusy = true;
  void drivePreviewWarm(creds, messageId, folderId, opts?.headBytes ?? 256 * 1024)
    .then((res: { status?: string; bytes?: number; size?: number; message?: string; error?: string }) => {
      const errText = String(res?.message || res?.error || res?.status || '');
      if (res?.status === 'skipped' || /busy|flood|membatasi|wait \d+s|rate limit/i.test(errText)) {
        noteFloodFromError(errText);
        return;
      }
      if (res && (res.status === 'ok' || res.status === 'ready' || (res.bytes || res.size || 0) > 0)) {
        warmDone.set(key, Date.now());
      }
    })
    .catch((e) => {
      noteFloodFromError(e);
    })
    .finally(() => {
      warmInflight.delete(key);
      warmGlobalBusy = false;
    });
}

/** Warm visible videos — max 1, slow stagger (FloodWait-safe). */
export function warmPreviewHeads(
  creds: DriveCredentials,
  folderId: number | null,
  messageIds: number[],
  max = 1
): void {
  if (isPreviewWarmPaused()) return;
  const seen = new Set<number>();
  let n = 0;
  const cap = Math.min(1, Math.max(0, max)); // hard cap 1
  for (const mid of messageIds) {
    if (!mid || mid <= 0 || seen.has(mid)) continue;
    seen.add(mid);
    const i = n;
    n += 1;
    if (n > cap) break;
    window.setTimeout(() => warmPreviewHead(creds, folderId, mid), 200 + i * 400);
  }
}

export function clearPreviewCache(): void {
  cache.clear();
  inflight.clear();
}

/** Drop one entry (e.g. after failed render / stale stream URL). */
export function invalidatePreview(
  folderId: number | null,
  messageId: number,
  quality?: string
): void {
  if (quality) {
    cache.delete(previewCacheKey(folderId, messageId, quality));
    return;
  }
  const prefix = `${folderId ?? 'home'}:${messageId}:`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}
