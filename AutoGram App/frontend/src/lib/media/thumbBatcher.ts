/**
 * Coalesce thumbnail requests into one worker process per batch.
 * High-end: multiple concurrent batches + aggressive flush.
 * Low-end: single flight, never one-shot Python spawn.
 */
import { driveThumbnailsBatch, type DriveCredentials } from '../telegram/driveApi';
import { debugLog } from '../utils/debugMode';
import type { DriveThumbQuality } from '../telegram/driveTypes';
import { DEFAULT_THUMB_QUALITY } from '../telegram/driveTypes';
import { getDrivePerfProfile } from '../utils/devicePerformance';
import { isDriveSessionReady } from '../telegram';
import {
  loadPersistentThumb,
  loadPersistentThumbs,
  savePersistentThumb,
} from './thumbPersistentCache';

export type ThumbPriority = 'visible' | 'near' | 'prefetch' | 'prewarm' | 'regen' | 'maintenance';
type Waiter = { resolve: (url: string | null) => void; signal?: AbortSignal };
type Task = {
  key: string;
  contextKey: string;
  generation: number;
  creds: DriveCredentials;
  folderId: number | null;
  peerId: string;
  topicId: number | null;
  locationType: string;
  messageId: number;
  quality: DriveThumbQuality;
  priority: number;
  sequence: number;
  waiters: Waiter[];
};

export function buildThumbItemRequest(
  accountId: string,
  peerId: string,
  topicId: number | null,
  messageId: number,
  generation: number,
  quality: DriveThumbQuality
) {
  return {
    requestId: `thumb:${accountId}:${peerId}:${topicId ?? 'none'}:${messageId}:g${generation}`,
    peerId,
    telegramMessageId: messageId,
    quality,
    generation,
  };
}

export type ThumbSchedulerMetrics = {
  queued: number;
  inFlight: number;
  staleCancelled: number;
  evictedPrefetch: number;
  batches: number;
  batchLatencyMs: number;
  retries: number;
  cacheHitMemory: number;
  cacheHitIndexedDb: number;
  temporaryFailureCount: number;
  permanentFailureCount: number;
};

function toOptimizedBlobUrl(url: string): string {
  // Pass URLs directly to avoid CPU-heavy atob array allocation during scroll frames
  return url;
}

class LRUThumbnailCache {
  private cache = new Map<string, string>();
  private readonly MAX_SIZE = 1200;

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    const url = value.startsWith('data:image/') ? toOptimizedBlobUrl(value) : value;

    while (this.cache.size >= this.MAX_SIZE) {
      this.evictLRU();
    }

    if (this.cache.has(key)) {
      const oldUrl = this.cache.get(key)!;
      if (oldUrl.startsWith('blob:')) {
        URL.revokeObjectURL(oldUrl);
      }
      this.cache.delete(key);
    }
    this.cache.set(key, url);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): void {
    if (!this.cache.has(key)) return;
    const oldUrl = this.cache.get(key)!;
    if (oldUrl.startsWith('blob:')) {
      URL.revokeObjectURL(oldUrl);
    }
    this.cache.delete(key);
  }

  clear(): void {
    for (const url of this.cache.values()) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
    this.cache.clear();
  }

  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const oldUrl = this.cache.get(firstKey)!;
      if (oldUrl && oldUrl.startsWith('blob:')) {
        URL.revokeObjectURL(oldUrl);
      }
      this.cache.delete(firstKey);
    }
  }
}

const memCache = new LRUThumbnailCache();
const softFailAt = new Map<string, number>();
const errorFailAt = new Map<string, number>();
/** In-flight promise per cache key — collapses race after await loadPersistentThumb. */
const inflightByKey = new Map<string, Promise<string | null>>();

if (typeof window !== 'undefined') {
  window.addEventListener('autogram-emergency-memory-reclaim', () => {
    memCache.clear();
    softFailAt.clear();
    errorFailAt.clear();
  });
}

const ERROR_COOLDOWN_MS = 800;

const queue = new Map<string, Task>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = 0;
let lastFlushStartMs = Date.now();
let activeQuality: DriveThumbQuality = DEFAULT_THUMB_QUALITY;
let activeContextKey = 'unscoped';
let activeSession = 'unscoped';
let contextGeneration = 0;
let viewportRequestGeneration = 0;
let taskSequence = 0;
const metrics: ThumbSchedulerMetrics = {
  queued: 0,
  inFlight: 0,
  staleCancelled: 0,
  evictedPrefetch: 0,
  batches: 0,
  batchLatencyMs: 0,
  retries: 0,
  cacheHitMemory: 0,
  cacheHitIndexedDb: 0,
  temporaryFailureCount: 0,
  permanentFailureCount: 0,
};
/**
 * Startup guard: visible cards still load, but only through one small batch at
 * a time.  SpeedTest releases this after the first live page has settled.
 */
let bootstrapMode = false;

function mapRustThumbQuality(q?: string): DriveThumbQuality {
  const s = String(q || '').toLowerCase();
  if (s.includes('hemat') || s.includes('saver')) return 'saver';
  if (s.includes('jelas') || s.includes('sharp')) return 'sharp';
  return 'balanced';
}

function notifyThumbReady(key: string, url: string, isPlaceholder = false): void {
  if (typeof window === 'undefined' || !url) return;
  try {
    window.dispatchEvent(
      new CustomEvent('autogram-thumb-ready', {
        detail: { key, url, isPlaceholder },
      })
    );
  } catch {
    /* ignore */
  }
}

// Setup Tauri event listener for real-time 1-by-1 per-item thumbnail streaming
if (typeof window !== 'undefined') {
  import('@tauri-apps/api/event')
    .then(({ listen }) => {
      listen<{
        session?: string;
        chatId?: string;
        messageId?: number;
        quality?: string;
        url?: string;
        isPlaceholder?: boolean;
      }>('thumb_single_ready', (event) => {
        const p = event.payload;
        if (!p || !p.messageId || !p.url) return;
        // Legacy event payloads without a session cannot be correlated safely
        // after a fast account switch. The scoped batch response remains the
        // authoritative path for those backend versions.
        if (!p.session) return;
        const targetSession = String(p.session).trim();
        if (targetSession && targetSession !== 'unscoped' && activeSession !== 'unscoped' && targetSession !== activeSession) {
          return;
        }
        const mid = Number(p.messageId);
        if (!Number.isFinite(mid) || mid <= 0) return;
        const quality = mapRustThumbQuality(p.quality);
        const chat = String(p.chatId || '');
        const folderId =
          !chat || chat === 'me' || chat === 'saved' ? null : Number(chat);
        const folderPart = Number.isFinite(folderId as number) ? (folderId as number) : null;
        const eventPeer = !chat || chat === 'saved' ? 'me' : chat;
        const k = cacheKey(folderPart, mid, quality, targetSession, eventPeer, null);

        if (p.isPlaceholder) {
          // Blur placeholder (32x32 stripped).
          // NEVER write placeholder URL to memCache for balanced or sharp modes,
          // and DO NOT resolve queued tasks so cards fetch crisp high-res thumbs.
          if (quality === 'saver') {
            memCache.set(k, p.url);
            softFailAt.delete(k);
            errorFailAt.delete(k);
          }
          notifyThumbReady(k, p.url, true);
          return;
        }

        // Real high-resolution thumbnail arrived!
        memCache.set(k, p.url);
        softFailAt.delete(k);
        errorFailAt.delete(k);
        void savePersistentThumb(k, p.url);
        notifyThumbReady(k, p.url, false);

        for (const [taskKey, task] of queue.entries()) {
          if (
            task.messageId !== mid ||
            task.creds.session !== targetSession ||
            task.peerId !== eventPeer ||
            task.contextKey !== activeContextKey
          ) continue;
          memCache.set(taskKey, p.url);
          softFailAt.delete(taskKey);
          errorFailAt.delete(taskKey);
          void savePersistentThumb(taskKey, p.url);
          resolveTask(task, p.url);
          queue.delete(taskKey);
        }
      }).catch(() => {});

      listen<{
        accountId?: string;
        peerId?: string;
        topicId?: number | null;
        generation?: number;
        completed?: Array<{ localPath?: string; quality?: string; messageId?: number }>;
      }>('topic-media://thumb-ready-batch', (event) => {
        const p = event.payload;
        if (!p || !Array.isArray(p.completed)) return;
        if (!p.accountId || p.accountId !== activeSession || !p.peerId) return;
        const eventContext = `${p.accountId}:${p.peerId === 'me' ? 'home' : p.peerId}:${p.topicId ?? 'all'}`;
        if (eventContext !== activeContextKey) return;
        for (const item of p.completed) {
          if (!item.localPath || !item.messageId) continue;
          const fileUrl = item.localPath.startsWith('http') || item.localPath.startsWith('asset:')
            ? item.localPath
            : 'file:///' + item.localPath.replace(/\\/g, '/');
          const quality = mapRustThumbQuality(item.quality);
          const folderPart = p.peerId === 'me' ? null : Number(p.peerId);
          const k = cacheKey(folderPart, Number(item.messageId), quality, p.accountId, p.peerId, p.topicId);
          memCache.set(k, fileUrl);
          notifyThumbReady(k, fileUrl, false);

          for (const [taskKey, task] of queue.entries()) {
            if (
              task.messageId === Number(item.messageId) &&
              task.creds.session === p.accountId &&
              task.peerId === p.peerId &&
              task.topicId === (p.topicId ?? null) &&
              task.contextKey === activeContextKey
            ) {
              memCache.set(taskKey, fileUrl);
              softFailAt.delete(taskKey);
              errorFailAt.delete(taskKey);
              resolveTask(task, fileUrl);
              queue.delete(taskKey);
            }
          }
        }
      }).catch(() => {});

    })
    .catch(() => {});
}

function softFailMs(priorityScore?: number): number {
  if (priorityScore && priorityScore >= 32) return 600;
  return 1_500;
}


function batchLimit(_q: DriveThumbQuality): number {
  const configured = Math.max(2, getDrivePerfProfile().thumbBatch);
  if (!bootstrapMode) return Math.max(configured, 48);
  const tier = getDrivePerfProfile().tier;
  const startupCap = tier === 'high' ? 64 : tier === 'mid' ? 48 : 24;
  return Math.max(configured, startupCap);
}

function flushDelayMs(): number {
  return getDrivePerfProfile().thumbFlushMs;
}

function queueMax(): number {
  const configured = getDrivePerfProfile().thumbQueueMax;
  if (!bootstrapMode) return configured;
  const tier = getDrivePerfProfile().tier;
  const startupCap = tier === 'high' ? 160 : tier === 'mid' ? 120 : 64;
  return Math.min(configured, startupCap);
}

function maxConcurrent(): number {
  return Math.max(1, getDrivePerfProfile().thumbConcurrent || 4);
}

export function buildThumbCacheKey(
  folderId: number | null,
  messageId: number,
  quality: DriveThumbQuality,
  session: string,
  peerId?: string | null,
  topicId?: number | null
) {
  const peer = peerId || (folderId != null && folderId !== 0 ? String(folderId) : 'me');
  const topic = topicId != null ? String(topicId) : 'none';
  return `v2:${session}:${quality}:${peer}:${topic}:${messageId}`;
}

function cacheKey(
  folderId: number | null,
  messageId: number,
  quality: DriveThumbQuality,
  session = activeSession,
  peerId?: string | null,
  topicId?: number | null
) {
  return buildThumbCacheKey(folderId, messageId, quality, session, peerId, topicId);
}

function priorityValue(priority: ThumbPriority | undefined): number {
  if (priority === 'visible') return 32;
  if (priority === 'near') return 28;
  if (priority === 'prefetch') return 20;
  if (priority === 'prewarm') return 12;
  if (priority === 'regen') return 4;
  if (priority === 'maintenance') return 1;
  return 32;
}

function resolveTask(task: Task, value: string | null): void {
  for (const waiter of task.waiters) {
    if (!waiter.signal?.aborted) waiter.resolve(value);
    else waiter.resolve(null);
  }
}

/** Switch scheduler ownership. Queued work from another location cannot starve visible cards. */
export function setThumbContext(
  creds: DriveCredentials | null,
  folderId: number | null,
  topicId?: number | null
): string {
  const session = creds?.session || 'unscoped';
  const next = `${session}:${folderId ?? 'home'}:${topicId ?? 'all'}`;
  const isSessionSwitch = session !== activeSession && activeSession !== 'unscoped';
  activeSession = session;
  if (isSessionSwitch) {
    softFailAt.clear();
    errorFailAt.clear();
    inflightByKey.clear();
  }
  if (next === activeContextKey) return next;
  activeContextKey = next;
  contextGeneration += 1;
  for (const [key, task] of queue) {
    if (task.contextKey === next) continue;
    queue.delete(key);
    metrics.staleCancelled += 1;
    resolveTask(task, null);
  }
  metrics.queued = queue.size;
  if (queue.size) scheduleFlush(true);
  return next;
}

export const switchThumbContext = setThumbContext;

export function getThumbSchedulerMetrics(): ThumbSchedulerMetrics {
  return { ...metrics, queued: queue.size, inFlight: flushInFlight };
}

export function getThumbQuality(): DriveThumbQuality {
  return activeQuality;
}

export function setThumbQuality(q: DriveThumbQuality): void {
  if (q === activeQuality) return;
  activeQuality = q;
  // Per-quality mem keys stay (saver vs seimbang vs jelas are separate).
  softFailAt.clear();
  errorFailAt.clear();
  contextGeneration += 1;
  for (const [, task] of queue) {
    resolveTask(task, null);
  }
  queue.clear();
  metrics.queued = 0;
  // Notify cards — they must re-read getCachedThumb for the NEW quality key.
  try {
    window.dispatchEvent(
      new CustomEvent('autogram-thumb-quality', {
        detail: { quality: q, forceRefetch: q !== 'saver' },
      })
    );
  } catch {
    /* ignore */
  }
}

/** Prefetch a list of visible ids with visible priority (scroll / quality switch). */
export function requestVisibleThumbs(
  creds: DriveCredentials,
  folderId: number | null,
  messageIds: number[],
  opts?: {
    bypassCache?: boolean;
    peerId?: string | null;
    topicId?: number | null;
    locationType?: string;
    /** Replace queued work from the previous virtual viewport. */
    replaceViewport?: boolean;
  }
): void {
  if (!messageIds.length || !isDriveSessionReady()) return;
  const ids = [...new Set(messageIds.filter(Number.isFinite))].slice(0, queueMax());
  const ownedViewportGeneration = opts?.replaceViewport
    ? ++viewportRequestGeneration
    : viewportRequestGeneration;
  if (opts?.replaceViewport) {
    const visibleKeys = new Set(ids.map((mid) =>
      cacheKey(folderId, mid, activeQuality, creds.session, opts?.peerId, opts?.topicId)
    ));
    for (const [key, task] of queue) {
      if (
        task.contextKey === activeContextKey
        && task.generation === contextGeneration
        && !visibleKeys.has(key)
      ) {
        queue.delete(key);
        inflightByKey.delete(key);
        resolveTask(task, null);
        metrics.staleCancelled += 1;
      }
    }
    metrics.queued = queue.size;
  }
  const missing: Array<{ mid: number; key: string }> = [];

  for (const mid of ids) {
    const k = cacheKey(folderId, mid, activeQuality, creds.session, opts?.peerId, opts?.topicId);
    if (!opts?.bypassCache && memCache.has(k)) continue;

    // Clear soft-fail for visible items so they try cleanly when scrolled into view
    softFailAt.delete(k);

    const existing = queue.get(k);
    if (existing) {
      // Upgrade existing task in queue to visible priority & bump sequence to front
      existing.priority = priorityValue('visible');
      existing.sequence = taskSequence++;
    } else {
      missing.push({ mid, key: k });
    }
  }

  if (!missing.length) return;
  const ownedContext = activeContextKey;
  const ownedGeneration = contextGeneration;
  void (async () => {
    if (!opts?.bypassCache) {
      const persisted = await loadPersistentThumbs(missing.map((item) => item.key));
      if (ownedContext !== activeContextKey || ownedGeneration !== contextGeneration) return;
      if (opts?.replaceViewport && ownedViewportGeneration !== viewportRequestGeneration) return;
      for (const [key, url] of persisted) {
        memCache.set(key, url);
        metrics.cacheHitIndexedDb += 1;
        notifyThumbReady(key, url, false);
      }
    }
    if (ownedContext !== activeContextKey || ownedGeneration !== contextGeneration) return;
    if (opts?.replaceViewport && ownedViewportGeneration !== viewportRequestGeneration) return;
    for (const { mid, key } of missing) {
      if (!opts?.bypassCache && memCache.has(key)) continue;
      void requestThumb(creds, folderId, mid, {
        priority: 'visible',
        contextKey: ownedContext,
        bypassCache: opts?.bypassCache,
        skipPersistentCache: true,
        peerId: opts?.peerId,
        topicId: opts?.topicId,
        locationType: opts?.locationType,
      });
    }
    const n = maxConcurrent();
    for (let i = 0; i < n; i++) scheduleFlush(true);
  })();
}

export function getCachedThumb(
  folderId: number | null,
  messageId: number,
  opts?: { peerId?: string | null; topicId?: number | null }
): string | null | undefined {
  const k = cacheKey(folderId, messageId, activeQuality, activeSession, opts?.peerId, opts?.topicId);
  if (memCache.has(k)) return memCache.get(k)!;
  return undefined;
}

/**
 * Retrieve the saver (stripped/blurred) thumbnail regardless of active quality.
 * Used as an instant blur placeholder in balanced/sharp modes while the
 * higher-quality thumb is being fetched — mirrors Telegram’s progressive loading UX.
 * Returns null when not in cache (i.e., primeThumbsFromFileList not yet called).
 */
export function getCachedSaverThumb(
  folderId: number | null,
  messageId: number,
  session = activeSession,
  opts?: { peerId?: string | null; topicId?: number | null }
): string | null {
  if (activeQuality === 'saver') return null; // already handled by getCachedThumb
  const k = cacheKey(folderId, messageId, 'saver', session, opts?.peerId, opts?.topicId);
  if (memCache.has(k)) {
    const val = memCache.get(k)!;
    if (val && val !== 'NOT_FOUND') return val;
  }
  return null;
}

/** Seed a just-committed thumbnail without opening another Telegram worker. */
export function primeThumbCache(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number,
  dataUrl: string,
  opts?: { peerId?: string | null; topicId?: number | null }
): void {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return;
  const session = creds.session;
  // ONLY prime "saver" (stripped) in memory for instant card paints
  const saverKey = cacheKey(folderId, messageId, 'saver', session, opts?.peerId, opts?.topicId);
  memCache.set(saverKey, dataUrl);
  softFailAt.delete(saverKey);
  errorFailAt.delete(saverKey);
}

/**
 * Inject video frame captured from media player into memory/disk cache & update UI cards instantly.
 */
export function cacheCapturedThumb(
  folderId: number | null,
  messageId: number,
  dataUrl: string,
  session = activeSession
): void {
  if (!messageId || !dataUrl || !dataUrl.startsWith('data:image/')) return;
  const qualities: DriveThumbQuality[] = ['saver', 'balanced', 'sharp'];
  for (const q of qualities) {
    const k = cacheKey(folderId, messageId, q, session);
    memCache.set(k, dataUrl);
    softFailAt.delete(k);
    errorFailAt.delete(k);
    void savePersistentThumb(k, dataUrl);
    notifyThumbReady(k, dataUrl, false);
  }
}

/**
 * Force-refresh visible tiles after quality switch (bypass mem for new quality).
 */
export function refreshVisibleThumbsForQuality(
  creds: DriveCredentials,
  folderId: number | null,
  messageIds: number[],
  opts?: { peerId?: string | null; topicId?: number | null; locationType?: string }
): void {
  if (!messageIds.length || !isDriveSessionReady()) return;
  softFailAt.clear();
  errorFailAt.clear();
  const ids = [...new Set(messageIds.filter(Number.isFinite))].slice(0, queueMax());
  for (const mid of ids) {
    const k = cacheKey(folderId, mid, activeQuality, creds.session, opts?.peerId, opts?.topicId);
    inflightByKey.delete(k);
    if (activeQuality !== 'saver') {
      memCache.delete(k);
    }
    void requestThumb(creds, folderId, mid, {
      priority: 'visible',
      contextKey: activeContextKey,
      bypassCache: activeQuality !== 'saver',
      peerId: opts?.peerId,
      topicId: opts?.topicId,
      locationType: opts?.locationType,
    });
  }
  const n = maxConcurrent();
  for (let i = 0; i < n; i++) scheduleFlush(true);
}

/**
 * After list_media: prime every file that carried an inline stripped thumb.
 * This is the main Telegram-app parity path (paint without thumbs_batch wait).
 * Returns count primed. Callers should strip thumb_data_url from React state
 * after this to avoid multi-MB re-renders.
 */
export function primeThumbsFromFileList(
  creds: DriveCredentials,
  folderId: number | null,
  files: Array<{ id: number; peer_id?: string | null; topic_id?: number | null; thumb_data_url?: string | null; thumbDataUrl?: string | null }>,
  opts?: { peerId?: string | null; topicId?: number | null }
): number {
  let n = 0;
  for (const f of files) {
    const url = f.thumb_data_url || f.thumbDataUrl;
    if (!url || !f.id) continue;
    primeThumbCache(creds, folderId, f.id, url, {
      peerId: f.peer_id || opts?.peerId,
      topicId: opts?.topicId !== undefined ? opts.topicId : f.topic_id,
    });
    n += 1;
  }
  return n;
}

/** Drop heavy inline thumb payloads after priming mem/disk cache. */
export function stripInlineThumbsFromFiles<T extends { thumb_data_url?: string | null; thumbDataUrl?: string | null }>(
  files: T[]
): T[] {
  return files.map((f) => {
    if (!f.thumb_data_url && !f.thumbDataUrl) return f;
    const { thumb_data_url: _a, thumbDataUrl: _b, ...rest } = f as T & {
      thumb_data_url?: string | null;
      thumbDataUrl?: string | null;
    };
    return rest as T;
  });
}

let lastCacheClearTimestamp = 0;

export function getLastCacheClearTimestamp(): number {
  return lastCacheClearTimestamp;
}

export function clearThumbCache() {
  memCache.clear();
  softFailAt.clear();
  errorFailAt.clear();
  inflightByKey.clear();
  lastCacheClearTimestamp = Date.now();
  contextGeneration += 1;
  for (const [, task] of queue) {
    resolveTask(task, null);
  }
  queue.clear();
  metrics.queued = 0;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('autogram-cache-cleared'));
  }
}

export function invalidateThumbFailures() {
  softFailAt.clear();
  errorFailAt.clear();
}

/** Drop a single broken/stale thumb (e.g. revoked blob URL) and clear fail cooldowns. */
export function invalidateThumb(
  folderId: number | null,
  messageId: number,
  session?: string,
  opts?: { peerId?: string | null; topicId?: number | null }
): void {
  const k = cacheKey(
    folderId,
    messageId,
    activeQuality,
    session || activeSession,
    opts?.peerId,
    opts?.topicId
  );
  memCache.delete(k);
  softFailAt.delete(k);
  errorFailAt.delete(k);
}

/**
 * Invalidate the soft-fail / error cache for a single message (e.g. just uploaded).
 * If the message has no cached thumbnail yet, immediately enqueue a fresh request.
 */
export function forceRetryThumb(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number,
  opts?: { peerId?: string | null; topicId?: number | null; locationType?: string }
): void {
  const k = cacheKey(folderId, messageId, activeQuality, creds.session, opts?.peerId, opts?.topicId);
  softFailAt.delete(k);
  errorFailAt.delete(k);
  inflightByKey.delete(k);
  // Only enqueue if not already in cache or queue
  if (!memCache.has(k) && !queue.has(k)) {
    // Fire-and-forget — result is handled by any mounted DriveFileCard
    void requestThumb(creds, folderId, messageId, {
      priority: 'visible',
      contextKey: activeContextKey,
      bypassCache: true,
      peerId: opts?.peerId,
      topicId: opts?.topicId,
      locationType: opts?.locationType,
    });
  }
}

/**
 * Request thumbnails for a batch of newly-uploaded / just-transferred files.
 * Unconditionally clears all fail-cooldowns and in-flight locks so freshly
 * committed items are always fetched — even if a previous attempt failed
 * (e.g. file not yet indexed on Telegram's CDN).
 * Preserves existing good cached thumbs (does NOT evict memCache).
 */
export function requestNewlyUploadedThumbs(
  creds: DriveCredentials,
  folderId: number | null,
  messageIds: number[],
  opts?: { peerId?: string | null; topicId?: number | null; locationType?: string }
): void {
  if (!messageIds.length || !isDriveSessionReady()) return;
  const ids = [...new Set(messageIds.filter(Number.isFinite))];
  for (const mid of ids) {
    const k = cacheKey(folderId, mid, activeQuality, creds.session, opts?.peerId, opts?.topicId);
    // Clear failure cooldowns so the item is retried immediately
    softFailAt.delete(k);
    errorFailAt.delete(k);
    inflightByKey.delete(k);
    // Also clear saver-quality cooldowns so progressive blur can paint immediately
    const saverK = cacheKey(folderId, mid, 'saver', creds.session, opts?.peerId, opts?.topicId);
    softFailAt.delete(saverK);
    errorFailAt.delete(saverK);
    inflightByKey.delete(saverK);
  }
  // Request with visible priority; do NOT bypass memCache — if streaming event
  // already delivered the thumb, there is no need to re-fetch.
  requestVisibleThumbs(creds, folderId, ids, {
    ...opts,
    bypassCache: false,
  });
}

let thumbsPaused = false;
let pauseSafetyTimer: ReturnType<typeof setTimeout> | null = null;

export function setThumbsPaused(paused: boolean) {
  thumbsPaused = paused;
  if (pauseSafetyTimer) {
    clearTimeout(pauseSafetyTimer);
    pauseSafetyTimer = null;
  }
  if (paused) {
    // Safety auto-resume after 60s to prevent permanent lock if a modal unmounts unexpectedly
    pauseSafetyTimer = setTimeout(() => {
      thumbsPaused = false;
      if (queue.size) {
        const n = maxConcurrent();
        for (let i = 0; i < n; i++) scheduleFlush(true);
      }
    }, 60000);
  } else if (queue.size) {
    // Kick multiple flushes immediately on unpause
    const n = maxConcurrent();
    for (let i = 0; i < n; i++) scheduleFlush(true);
  }
}

/** Keep startup thumbnail work bounded until the interactive stage is ready. */
export function setThumbBootstrapMode(enabled: boolean): void {
  if (bootstrapMode === enabled) return;
  bootstrapMode = enabled;
  if (!enabled && !thumbsPaused && queue.size) {
    const n = maxConcurrent();
    for (let i = 0; i < n; i++) scheduleFlush(true);
  }
}

export function isThumbsPaused(): boolean {
  return thumbsPaused;
}

function scheduleFlush(immediate = false) {
  if (immediate && !thumbsPaused) {
    // Coalesce all visible cards mounted in the same React/virtualizer turn.
    // Calling flush synchronously created one native RPC per card and let old
    // overscan work occupy every Grammers lane before the new viewport queued.
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flushQueue();
    }, 0);
    return;
  }
  if (timer) return;
  const delay = thumbsPaused ? Math.max(300, flushDelayMs() * 3) : flushDelayMs();
  timer = setTimeout(() => {
    timer = null;
    void flushQueue();
  }, delay);
}

export function notifyMediaDeleted(deletedIds: number[], peerId: number | null): void {
  if (!deletedIds || !deletedIds.length) return;
  window.dispatchEvent(
    new CustomEvent('autogram-media-deleted', {
      detail: { deletedIds: deletedIds.map((id) => Number(id)), peerId },
    })
  );
}

export function notifyMediaUploaded(file: any, folderId: number | null): void {
  if (!file || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('autogram-media-uploaded', {
      detail: { file, folderId },
    })
  );
}

/**
 * Broadcast that a batch of message IDs just finished transferring.
 * DriveFileCard and any other subscriber can listen to 'autogram-transfer-batch-done'
 * to immediately re-request thumbnails for those items.
 */
export function notifyTransferBatchDone(
  messageIds: number[],
  folderId: number | null,
  opts?: { peerId?: string | null; topicId?: number | null }
): void {
  if (!messageIds.length || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('autogram-transfer-batch-done', {
      detail: { messageIds, folderId, peerId: opts?.peerId, topicId: opts?.topicId },
    })
  );
}

async function flushQueue() {
  if (queue.size === 0) return;
  if (thumbsPaused) {
    // Strictly hold all Telegram thumbnail RPCs while paused (e.g., active media streaming or preview modal open)
    scheduleFlush();
    return;
  }
  if (!isDriveSessionReady()) {
    scheduleFlush();
    return;
  }
  if (flushInFlight >= maxConcurrent()) {
    // Watchdog: If in-flight requests stay locked for > 10s, force reset counters
    if (Date.now() - lastFlushStartMs > 10000) {
      console.warn('[thumbBatcher] Watchdog: in-flight flush locked > 10s. Force resetting concurrency counters.');
      flushInFlight = 0;
    } else {
      return;
    }
  }

  const first = [...queue.values()].sort(
    (a, b) => b.priority - a.priority || b.sequence - a.sequence
  )[0];
  if (!first) return;

  flushInFlight++;
  lastFlushStartMs = Date.now();

  let activeTasks: Task[] = [];
  try {
    const creds = first.creds;
    const folderId = first.folderId;
    const peerId = first.peerId;
    const topicId = first.topicId;
    const quality = first.quality;
    const limit = batchLimit(quality);
    const tasks = [...queue.values()]
      .filter(
        (task) =>
          task.contextKey === first.contextKey &&
          task.peerId === peerId &&
          task.topicId === topicId &&
          task.quality === quality &&
          task.creds.session === creds.session
      )
      .sort((a, b) => b.priority - a.priority || b.sequence - a.sequence)
      .slice(0, limit);
    activeTasks = tasks;
    const ids = tasks.map((task) => task.messageId);
    for (const task of tasks) queue.delete(task.key);
    metrics.queued = queue.size;

    // Pipeline: start next batch while this one is in flight (high concurrent)
    if (queue.size > 0 && flushInFlight < maxConcurrent()) {
      scheduleFlush(true);
    }

    const started = performance.now();
    const batchUuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const realBatchId = `thumb-batch:${batchUuid}`;
    const batchRequestId = first ? `thumb:${peerId}:${first.messageId}:g${first.generation}` : `thumb:batch:${Date.now()}`;
    const itemRequests = tasks.map((task) =>
      buildThumbItemRequest(
        task.creds.session,
        task.peerId,
        task.topicId,
        task.messageId,
        task.generation,
        task.quality
      )
    );
    debugLog('thumbBatcher', 'op=thumb_frontend_invoke', {
      batchId: realBatchId,
      requestId: batchRequestId,
      peerId,
      topicId,
      telegramMessageIds: ids,
      count: ids.length,
    });

    const res = await driveThumbnailsBatch(creds, ids, folderId, {
      quality,
      batchSize: limit,
      requestId: batchRequestId,
      batchId: realBatchId,
      items: itemRequests,
      telegramPeerId: peerId,
      telegramMessageIds: ids,
    });

    const thumbs = (res.thumbs || {}) as Record<string, string | null>;
    const items = (res as any).items || [];
    const deferred = !!(res as { deferred?: boolean }).deferred;
    const deletedIds = (res as { deleted_ids?: number[] }).deleted_ids;
    if (deletedIds && deletedIds.length) {
      notifyMediaDeleted(deletedIds, folderId);
    }
    metrics.batches += 1;
    metrics.batchLatencyMs = Math.round(performance.now() - started);
    const readyCount = Object.values(thumbs).filter(Boolean).length;
    console.log(`[thumbBatcher] Batch ${realBatchId} completed in ${metrics.batchLatencyMs}ms: chat=${folderId ?? 'home'} items=${ids.length} (ready=${readyCount}, missing=${ids.length - readyCount})`);

    if (items.length > 0) {
      for (const item of items) {
        debugLog('thumbBatcher', 'op=thumb_frontend_result', {
          requestId: item.requestId,
          peerId: item.peerId,
          telegramMessageId: item.telegramMessageId,
          status: item.status,
          reason: item.reason,
          source: item.source,
        });
      }
    }

    for (const task of tasks) {
      const mid = task.messageId;
      const k = task.key;
      const url = thumbs[String(mid)] ?? null;
      if (url) {
        memCache.set(k, url);
        void savePersistentThumb(k, url);
        softFailAt.delete(k);
        errorFailAt.delete(k);
        notifyThumbReady(k, url, false);
        resolveTask(task, url);
      } else if (deferred) {
        // Deferred (session not ready / native cold) — requeue without soft-fail
        softFailAt.set(k, Date.now());
        metrics.temporaryFailureCount += 1;
        resolveTask(task, null);
      } else {
        // Miss: short soft-fail so visible cards can re-request soon without hammering.
        debugLog('thumbBatcher', 'op=thumb_frontend_result', {
          requestId: `thumb:${task.peerId}:${mid}:g${task.generation}`,
          peerId: task.peerId,
          telegramMessageId: mid,
          status: 'miss',
        });
        softFailAt.set(k, Date.now());
        resolveTask(task, null);
      }
    }
  } catch (err) {
    console.error('[thumbBatcher] Thumbnail batch failed:', err);
    const errStr = String(err || '').toLowerCase();
    if (errStr.includes('flood') || errStr.includes('wait') || errStr.includes('420')) {
      const match = errStr.match(/wait of (\d+)/i);
      const waitSecs = match ? parseInt(match[1], 10) : 15;
      console.warn(`[thumbBatcher] FloodWait detected (${waitSecs}s). Auto-pausing scheduler.`);
      setThumbsPaused(true);
      setTimeout(() => {
        setThumbsPaused(false);
      }, Math.min(waitSecs, 60) * 1000);
    }
    for (const task of activeTasks) {
      errorFailAt.set(task.key, Date.now());
      metrics.temporaryFailureCount += 1;
      resolveTask(task, null);
    }
  } finally {
    flushInFlight = Math.max(0, flushInFlight - 1);
    if (queue.size) scheduleFlush(flushInFlight === 0);
  }
}

/** Request a thumb; coalesces with other visible cards. */
export async function requestThumb(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number,
  opts?: {
    priority?: ThumbPriority;
    contextKey?: string;
    signal?: AbortSignal;
    bypassCache?: boolean;
    peerId?: string | null;
    topicId?: number | null;
    locationType?: string;
    skipPersistentCache?: boolean;
  }
): Promise<string | null> {
  if (opts?.signal?.aborted) return null;
  const contextKey = opts?.contextKey || activeContextKey;
  const generation = contextGeneration;

  const rawPeer = opts?.peerId || (folderId != null && folderId !== 0 ? String(folderId) : null);
  const locationType = opts?.locationType || (rawPeer === 'me' ? 'saved_messages' : 'group');

  // Guard rule 18:
  if (rawPeer === 'me' && locationType !== 'saved_messages') {
    debugLog('thumbBatcher', 'op=thumb_request_rejected_invalid_self_peer', { folderId, messageId, locationType });
    return null;
  }

  const peerId = rawPeer || (locationType === 'saved_messages' ? 'me' : null);
  if (!peerId) {
    debugLog('thumbBatcher', 'op=thumb_request_rejected_missing_peer', { folderId, messageId, locationType });
    return null;
  }

  const telegramMessageId = Number(messageId);
  if (!Number.isInteger(telegramMessageId) || telegramMessageId <= 0) {
    debugLog('thumbBatcher', 'op=thumb_request_rejected_invalid_locator', { folderId, messageId, peerId, telegramMessageId });
    return null;
  }

  const accId = creds.session || 'default';
  const topicId = opts?.topicId != null ? opts.topicId : 'none';
  const requestId = `thumb:${accId}:${peerId}:${topicId}:${telegramMessageId}:g${generation}`;
  const k = cacheKey(folderId, messageId, activeQuality, creds.session, peerId, opts?.topicId);

  if (opts?.priority === 'visible' || opts?.bypassCache) {
    softFailAt.delete(k);
    errorFailAt.delete(k);
  }

  if (opts?.bypassCache) {
    inflightByKey.delete(k);
    memCache.delete(k);
  } else {
    const hit = memCache.get(k);
    if (hit) return hit;
    const failAt = softFailAt.get(k);
    if (failAt != null && Date.now() - failAt < softFailMs(priorityValue(opts?.priority))) {
      debugLog('thumbBatcher', 'thumb_frontend_request_suppressed', { requestId, folderId, messageId, reason: 'softFail' });
      return null;
    }
    const errAt = errorFailAt.get(k);
    if (errAt != null && Date.now() - errAt < ERROR_COOLDOWN_MS) {
      debugLog('thumbBatcher', 'thumb_frontend_request_suppressed', { requestId, folderId, messageId, reason: 'errorCooldown' });
      return null;
    }
    const inflight = inflightByKey.get(k);
    if (inflight) {
      debugLog('thumbBatcher', 'thumb_frontend_request_joined', { requestId, folderId, messageId });
      return inflight;
    }
  }

  debugLog('thumbBatcher', 'thumb_frontend_request_started', { requestId, folderId, messageId, quality: activeQuality });

  const work = (async (): Promise<string | null> => {
    // Re-check mem (list_media prime often races card mount by one tick).
    const again = memCache.get(k);
    if (again) return again;

    const persisted = opts?.skipPersistentCache ? null : await loadPersistentThumb(k);
    if (generation !== contextGeneration || contextKey !== activeContextKey) return null;
    if (persisted) {
      memCache.set(k, persisted);
      softFailAt.delete(k);
      errorFailAt.delete(k);
      return persisted;
    }

    // Re-check after async gap — another caller may have filled mem or queue.
    const afterPersist = memCache.get(k);
    if (afterPersist) return afterPersist;
    if (generation !== contextGeneration || contextKey !== activeContextKey) return null;

    return new Promise<string | null>((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(null);
        return;
      }
      const existing = queue.get(k);
      if (existing) {
        existing.priority = Math.max(existing.priority, priorityValue(opts?.priority));
        existing.sequence = taskSequence++;
        const waiter = { resolve, signal: opts?.signal };
        existing.waiters.push(waiter);
        opts?.signal?.addEventListener('abort', () => {
          const queued = queue.get(k);
          if (queued) {
            queued.waiters = queued.waiters.filter((item) => item !== waiter);
            if (queued.waiters.length === 0) {
              queue.delete(k);
              metrics.staleCancelled += 1;
              metrics.queued = queue.size;
            }
          }
          resolve(null);
        }, { once: true });
        scheduleFlush(opts?.priority === 'visible');
        return;
      }
      if (queue.size >= queueMax()) {
        const evictable = [...queue.values()]
          .filter((task) => task.priority < priorityValue(opts?.priority))
          .sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)[0];
        if (!evictable) {
          resolve(null);
          return;
        }
        queue.delete(evictable.key);
        metrics.evictedPrefetch += 1;
        resolveTask(evictable, null);
      }
      const waiter = { resolve, signal: opts?.signal };
      queue.set(k, {
        key: k,
        contextKey,
        generation,
        creds,
        folderId,
        peerId,
        topicId: opts?.topicId ?? null,
        locationType,
        messageId,
        quality: activeQuality,
        priority: priorityValue(opts?.priority),
        sequence: taskSequence++,
        waiters: [waiter],
      });
      opts?.signal?.addEventListener('abort', () => {
        const queued = queue.get(k);
        if (queued) {
          queued.waiters = queued.waiters.filter((item) => item !== waiter);
          if (queued.waiters.length === 0) {
            queue.delete(k);
            metrics.staleCancelled += 1;
            metrics.queued = queue.size;
          }
        }
        resolve(null);
      }, { once: true });
      metrics.queued = queue.size;
      const isVisible = opts?.priority === 'visible';
      scheduleFlush(isVisible || (!bootstrapMode && getDrivePerfProfile().tier === 'high'));
    });
  })();

  inflightByKey.set(k, work);
  try {
    return await work;
  } finally {
    if (inflightByKey.get(k) === work) inflightByKey.delete(k);
  }
}

/**
 * Prefetch thumbs for ids (visible + near-visible rows). Fire-and-forget.
 * No-op if paused / session cold / already cached.
 */
export function prefetchThumbs(
  creds: DriveCredentials,
  folderId: number | null,
  messageIds: number[],
  opts?: { peerId?: string | null; topicId?: number | null; locationType?: string }
): void {
  if (thumbsPaused || !isDriveSessionReady()) return;
  const ids = [...new Set(messageIds.filter(Number.isFinite))];
  const cap = Math.min(queueMax(), getDrivePerfProfile().thumbBatch * maxConcurrent() * 2);

  for (const mid of ids) {
    if (queue.size >= cap) break;
    const key = cacheKey(folderId, mid, activeQuality, creds.session, opts?.peerId, opts?.topicId);
    if (memCache.has(key) || queue.has(key)) continue;
    void requestThumb(creds, folderId, mid, {
      priority: 'prefetch',
      contextKey: activeContextKey,
      peerId: opts?.peerId,
      topicId: opts?.topicId,
      locationType: opts?.locationType,
    });
  }
}

if (typeof window !== 'undefined') {
  import('@tauri-apps/api/event').then(({ listen }) => {
    void listen<{ peerId: string; telegramMessageId: number; reason: string }>(
      'topic-media://invalidate-media-row',
      (event) => {
        const { peerId, telegramMessageId } = event.payload;
        const pNum = peerId === 'me' ? null : Number(peerId) || null;
        invalidateThumb(pNum, telegramMessageId);
        notifyMediaDeleted([telegramMessageId], pNum);
      }
    );
  }).catch(() => {});
}
