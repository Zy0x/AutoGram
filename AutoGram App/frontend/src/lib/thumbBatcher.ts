/**
 * Coalesce thumbnail requests into one worker process per batch.
 * High-end: multiple concurrent batches + aggressive flush.
 * Low-end: single flight, never one-shot Python spawn.
 */
import { driveThumbnailsBatch, type DriveCredentials } from './driveApi';
import { debugLog } from './debugMode';
import type { DriveThumbQuality } from './driveTypes';
import { DEFAULT_THUMB_QUALITY } from './driveTypes';
import { getDrivePerfProfile } from './devicePerformance';
import { isDriveSessionReady } from './driveSession';
import {
  loadPersistentThumb,
  loadPersistentThumbs,
  savePersistentThumb,
} from './thumbPersistentCache';

export type ThumbPriority = 'visible' | 'near' | 'prefetch';
type Waiter = { resolve: (url: string | null) => void; signal?: AbortSignal };
type Task = {
  key: string;
  contextKey: string;
  generation: number;
  creds: DriveCredentials;
  folderId: number | null;
  messageId: number;
  quality: DriveThumbQuality;
  priority: number;
  sequence: number;
  waiters: Waiter[];
};

export type ThumbSchedulerMetrics = {
  queued: number;
  inFlight: number;
  staleCancelled: number;
  evictedPrefetch: number;
  batches: number;
  batchLatencyMs: number;
  retries: number;
};


class LRUThumbnailCache {
  private cache = new Map<string, string>();
  private readonly MAX_SIZE = 1000;

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    const url = value;

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
      if (oldUrl.startsWith('blob:')) {
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

const ERROR_COOLDOWN_MS = 800;

const queue = new Map<string, Task>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** Parallel in-flight flush count (high tier > 1) */
let flushInFlight = 0;
let activeQuality: DriveThumbQuality = DEFAULT_THUMB_QUALITY;
let activeContextKey = 'unscoped';
let activeSession = 'unscoped';
let contextGeneration = 0;
let taskSequence = 0;
const metrics: ThumbSchedulerMetrics = {
  queued: 0,
  inFlight: 0,
  staleCancelled: 0,
  evictedPrefetch: 0,
  batches: 0,
  batchLatencyMs: 0,
  retries: 0,
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
        const targetSession = p.session ? String(p.session).trim() : activeSession;
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
        const k = cacheKey(folderPart, mid, quality, targetSession);

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
          if (task.messageId !== mid || task.creds.session !== targetSession) continue;
          memCache.set(taskKey, p.url);
          softFailAt.delete(taskKey);
          errorFailAt.delete(taskKey);
          void savePersistentThumb(taskKey, p.url);
          resolveTask(task, p.url);
          queue.delete(taskKey);
        }
      }).catch(() => {});
    })
    .catch(() => {});
}

function softFailMs(priority?: number): number {
  // Visible cards retry faster (800ms); prefetch/near can wait longer (1500ms).
  if (priority === 0) return 800; // visible
  return 1_500;
}


function batchLimit(_q: DriveThumbQuality): number {
  const configured = Math.max(2, getDrivePerfProfile().thumbBatch);
  if (!bootstrapMode) return configured;
  const tier = getDrivePerfProfile().tier;
  // Larger first batches so viewport fills without waiting for scroll.
  const startupCap = tier === 'high' ? 64 : tier === 'mid' ? 36 : 16;
  return Math.min(configured, startupCap);
}

function flushDelayMs(): number {
  return getDrivePerfProfile().thumbFlushMs;
}

function queueMax(): number {
  const configured = getDrivePerfProfile().thumbQueueMax;
  if (!bootstrapMode) return configured;
  const tier = getDrivePerfProfile().tier;
  const startupCap = tier === 'high' ? 160 : tier === 'mid' ? 80 : 32;
  return Math.min(configured, startupCap);
}

function maxConcurrent(): number {
  // Cap at 2 concurrent thumb batch flights.
  // REASON: driveThumbnailsBatch and list_media share the SAME Grammers session in Rust.
  // High concurrency (10-16) queues many thumb batches in front of list_media/loadMore,
  // making the file list appear stuck. 2 flights = 1 visible + 1 prefetch, enough throughput.
  // Larger batch sizes (profile.thumbBatch) reduce total RPCs without adding parallelism.
  return Math.min(2, Math.max(1, getDrivePerfProfile().thumbConcurrent || 1));
}

function cacheKey(
  folderId: number | null,
  messageId: number,
  quality: DriveThumbQuality,
  session = activeSession
) {
  return `${session}:${quality}:${folderId ?? 'home'}:${messageId}`;
}

function priorityValue(priority: ThumbPriority | undefined): number {
  if (priority === 'prefetch') return 2;
  if (priority === 'near') return 1;
  return 0;
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
  messageIds: number[]
): void {
  if (!messageIds.length || !isDriveSessionReady()) return;
  const ids = [...new Set(messageIds.filter(Number.isFinite))].slice(0, queueMax());
  const missing = ids.filter((mid) => !memCache.has(cacheKey(folderId, mid, activeQuality, creds.session)));
  if (!missing.length) return;

  const missingKeys = missing.map((mid) => cacheKey(folderId, mid, activeQuality, creds.session));
  void loadPersistentThumbs(missingKeys).then((persisted) => {
    for (const [key, url] of persisted) {
      memCache.set(key, url);
      softFailAt.delete(key);
      errorFailAt.delete(key);
      notifyThumbReady(key, url, false);
    }
    for (const mid of missing) {
      const k = cacheKey(folderId, mid, activeQuality, creds.session);
      if (memCache.has(k)) continue;
      void requestThumb(creds, folderId, mid, {
        priority: 'visible',
        contextKey: activeContextKey,
      });
    }
    const n = maxConcurrent();
    for (let i = 0; i < n; i++) scheduleFlush(true);
  });
}

export function getCachedThumb(folderId: number | null, messageId: number): string | null | undefined {
  const k = cacheKey(folderId, messageId, activeQuality);
  if (memCache.has(k)) return memCache.get(k)!;
  return undefined;
}

/**
 * Retrieve the saver (stripped/blurred) thumbnail regardless of active quality.
 * Used as an instant blur placeholder in balanced/sharp modes while the
 * higher-quality thumb is being fetched \u2014 mirrors Telegram\u2019s progressive loading UX.
 * Returns null when not in cache (i.e., primeThumbsFromFileList not yet called).
 */
export function getCachedSaverThumb(
  folderId: number | null,
  messageId: number,
  session = activeSession
): string | null {
  if (activeQuality === 'saver') return null; // already handled by getCachedThumb
  const k = cacheKey(folderId, messageId, 'saver', session);
  return memCache.has(k) ? memCache.get(k)! : null;
}

/** Seed a just-committed thumbnail without opening another Telegram worker. */
export function primeThumbCache(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number,
  dataUrl: string
): void {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return;
  const session = creds.session;
  // ONLY prime "saver" (stripped). Never poison balanced/jelas keys with blur
  // mini-thumbs — that made quality switch look like a no-op.
  const saverKey = cacheKey(folderId, messageId, 'saver', session);
  memCache.set(saverKey, dataUrl);
  softFailAt.delete(saverKey);
  errorFailAt.delete(saverKey);
  void savePersistentThumb(saverKey, dataUrl);
  // If UI is currently on saver, paint now. Other qualities must fetch properly.
  if (activeQuality === 'saver') {
    notifyThumbReady(saverKey, dataUrl, false);
  }
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
  messageIds: number[]
): void {
  if (!messageIds.length || !isDriveSessionReady()) return;
  softFailAt.clear();
  errorFailAt.clear();
  const ids = [...new Set(messageIds.filter(Number.isFinite))].slice(0, queueMax());
  for (const mid of ids) {
    const k = cacheKey(folderId, mid, activeQuality, creds.session);
    inflightByKey.delete(k);
    if (activeQuality !== 'saver') {
      memCache.delete(k);
    }
    void requestThumb(creds, folderId, mid, {
      priority: 'visible',
      contextKey: activeContextKey,
      bypassCache: activeQuality !== 'saver',
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
  files: Array<{ id: number; thumb_data_url?: string | null; thumbDataUrl?: string | null }>
): number {
  let n = 0;
  for (const f of files) {
    const url = f.thumb_data_url || f.thumbDataUrl;
    if (!url || !f.id) continue;
    primeThumbCache(creds, folderId, f.id, url);
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

export function clearThumbCache() {
  memCache.clear();
  softFailAt.clear();
  errorFailAt.clear();
  inflightByKey.clear();
  contextGeneration += 1;
  for (const [, task] of queue) {
    resolveTask(task, null);
  }
  queue.clear();
  metrics.queued = 0;
}

export function invalidateThumbFailures() {
  softFailAt.clear();
  errorFailAt.clear();
}

/** Drop a single broken/stale thumb (e.g. revoked blob URL) and clear fail cooldowns. */
export function invalidateThumb(
  folderId: number | null,
  messageId: number,
  session?: string
): void {
  const k = cacheKey(folderId, messageId, activeQuality, session || activeSession);
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
  messageId: number
): void {
  const k = cacheKey(folderId, messageId, activeQuality, creds.session);
  softFailAt.delete(k);
  errorFailAt.delete(k);
  // Only enqueue if not already in cache or queue
  if (!memCache.has(k) && !queue.has(k)) {
    // Fire-and-forget — result is handled by any mounted DriveFileCard
    void requestThumb(creds, folderId, messageId, {
      priority: 'visible',
      contextKey: activeContextKey,
      bypassCache: true,
    });
  }
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
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void flushQueue();
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
  if (flushInFlight >= maxConcurrent()) return;

  flushInFlight++;

  const first = [...queue.values()].sort(
    (a, b) => a.priority - b.priority || a.sequence - b.sequence
  )[0];
  if (!first) return;
  const creds = first.creds;
  const folderId = first.folderId;
  const quality = first.quality;
  const limit = batchLimit(quality);
  const tasks = [...queue.values()]
    .filter(
      (task) =>
        task.contextKey === first.contextKey &&
        task.folderId === folderId &&
        task.quality === quality &&
        task.creds.session === creds.session
    )
    .sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
    .slice(0, limit);
  const ids = tasks.map((task) => task.messageId);
  for (const task of tasks) queue.delete(task.key);
  metrics.queued = queue.size;

  // Pipeline: start next batch while this one is in flight (high concurrent)
  if (queue.size > 0 && flushInFlight < maxConcurrent()) {
    scheduleFlush(true);
  }

  try {
    const started = performance.now();
    const res = await driveThumbnailsBatch(creds, ids, folderId, {
      quality,
      batchSize: limit,
    });
    const thumbs = (res.thumbs || {}) as Record<string, string | null>;
    const deferred = !!(res as { deferred?: boolean }).deferred;
    const deletedIds = (res as { deleted_ids?: number[] }).deleted_ids;
    if (deletedIds && deletedIds.length) {
      notifyMediaDeleted(deletedIds, folderId);
    }
    metrics.batches += 1;

    metrics.batchLatencyMs = Math.round(performance.now() - started);
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
        if (task.generation === contextGeneration && task.contextKey === activeContextKey) {
          queue.set(k, task);
          metrics.retries += 1;
        } else {
          resolveTask(task, null);
        }
      } else {
        // Miss: short soft-fail so visible cards can re-request soon without hammering.
        debugLog('thumbBatcher', 'miss', { folderId: folderId ?? 'home', mid, quality });
        softFailAt.set(k, Date.now());
        resolveTask(task, null);
      }
    }
  } catch (err) {
    console.error(`[thumbBatcher] Thumbnail batch failed for chat=${folderId ?? 'home'} ids=[${ids.join(',')}] quality=${quality}:`, err);
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
    for (const task of tasks) {
      const k = task.key;
      errorFailAt.set(k, Date.now());
      // Transient errors: requeue high-priority (visible) once generation is still current
      if (
        task.priority === 0 &&
        task.generation === contextGeneration &&
        task.contextKey === activeContextKey
      ) {
        queue.set(k, {
          ...task,
          waiters: [], // original waiters already resolved null; cards re-request
        });
        metrics.retries += 1;
      }
      resolveTask(task, null);
    }
  }

  flushInFlight--;
  if (queue.size) scheduleFlush(flushInFlight === 0);
}

/** Request a thumb; coalesces with other visible cards. */
export async function requestThumb(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number,
  opts?: { priority?: ThumbPriority; contextKey?: string; signal?: AbortSignal; bypassCache?: boolean }
): Promise<string | null> {
  if (opts?.signal?.aborted) return null;
  const contextKey = opts?.contextKey || activeContextKey;
  const generation = contextGeneration;
  const k = cacheKey(folderId, messageId, activeQuality, creds.session);
  if (opts?.bypassCache) {
    softFailAt.delete(k);
    errorFailAt.delete(k);
    inflightByKey.delete(k);
    // Drop mem for this quality key so seimbang/jelas re-fetch (do not keep hemat blur).
    memCache.delete(k);
  } else {
    const hit = memCache.get(k);
    if (hit) return hit;
    const failAt = softFailAt.get(k);
    if (failAt != null && Date.now() - failAt < softFailMs(priorityValue(opts?.priority))) {
      return null;
    }
    const errAt = errorFailAt.get(k);
    if (errAt != null && Date.now() - errAt < ERROR_COOLDOWN_MS) {
      return null;
    }
    const inflight = inflightByKey.get(k);
    if (inflight) return inflight;
  }

  const work = (async (): Promise<string | null> => {
    // Re-check mem (list_media prime often races card mount by one tick).
    const again = memCache.get(k);
    if (again) return again;

    const persisted = await loadPersistentThumb(k);
    if (persisted) {
      memCache.set(k, persisted);
      softFailAt.delete(k);
      errorFailAt.delete(k);
      return persisted;
    }

    // Re-check after async gap — another caller may have filled mem or queue.
    const afterPersist = memCache.get(k);
    if (afterPersist) return afterPersist;

    return new Promise<string | null>((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(null);
        return;
      }
      const existing = queue.get(k);
      if (existing) {
        existing.priority = Math.min(existing.priority, priorityValue(opts?.priority));
        existing.waiters.push({ resolve, signal: opts?.signal });
        scheduleFlush(false);
        return;
      }
      if (queue.size >= queueMax()) {
        const evictable = [...queue.values()]
          .filter((task) => task.priority > priorityValue(opts?.priority))
          .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence)[0];
        if (!evictable) {
          resolve(null);
          return;
        }
        queue.delete(evictable.key);
        metrics.evictedPrefetch += 1;
        resolveTask(evictable, null);
      }
      queue.set(k, {
        key: k,
        contextKey,
        generation,
        creds,
        folderId,
        messageId,
        quality: activeQuality,
        priority: priorityValue(opts?.priority),
        sequence: taskSequence++,
        waiters: [{ resolve, signal: opts?.signal }],
      });
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
  messageIds: number[]
): void {
  if (thumbsPaused || !isDriveSessionReady()) return;
  const ids = [...new Set(messageIds.filter(Number.isFinite))];
  const keys = ids.map((mid) => cacheKey(folderId, mid, activeQuality, creds.session));
  void loadPersistentThumbs(keys).then((persisted) => {
    for (const [key, url] of persisted) memCache.set(key, url);
    const cap = Math.min(queueMax(), getDrivePerfProfile().thumbBatch * maxConcurrent() * 2);
    for (const mid of ids) {
      if (queue.size >= cap) break;
      const key = cacheKey(folderId, mid, activeQuality, creds.session);
      if (memCache.has(key) || queue.has(key)) continue;
      void requestThumb(creds, folderId, mid, {
        priority: 'prefetch',
        contextKey: activeContextKey,
      });
    }
  });
}
