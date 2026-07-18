/**
 * Coalesce thumbnail requests into one worker process per batch.
 * High-end: multiple concurrent batches + aggressive flush.
 * Low-end: single flight, never one-shot Python spawn.
 */
import { driveThumbnailsBatch, type DriveCredentials } from './driveApi';
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
  private readonly MAX_SIZE = 500;
  private readonly MAX_BYTES = 10 * 1024 * 1024; // 10MB soft limit
  private currentBytes = 0;

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    while (this.cache.size >= this.MAX_SIZE || (this.currentBytes + value.length) > this.MAX_BYTES) {
      this.evictLRU();
    }
    if (this.cache.has(key)) {
      const old = this.cache.get(key)!;
      this.currentBytes -= old.length;
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    this.currentBytes += value.length;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.currentBytes = 0;
  }

  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const old = this.cache.get(firstKey)!;
      this.currentBytes -= old.length;
      this.cache.delete(firstKey);
    }
  }
}

const memCache = new LRUThumbnailCache();
const softFailAt = new Map<string, number>();
const errorFailAt = new Map<string, number>();

const ERROR_COOLDOWN_MS = 3500;

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
let bootstrapMode = true;

function softFailMs(): number {
  return Math.min(getDrivePerfProfile().thumbSoftFailMs, 90_000);
}

function batchLimit(_q: DriveThumbQuality): number {
  const configured = Math.max(2, getDrivePerfProfile().thumbBatch);
  if (!bootstrapMode) return configured;
  const tier = getDrivePerfProfile().tier;
  const startupCap = tier === 'high' ? 12 : tier === 'mid' ? 8 : 4;
  return Math.min(configured, startupCap);
}

function flushDelayMs(): number {
  return getDrivePerfProfile().thumbFlushMs;
}

function queueMax(): number {
  const configured = getDrivePerfProfile().thumbQueueMax;
  if (!bootstrapMode) return configured;
  const tier = getDrivePerfProfile().tier;
  const startupCap = tier === 'high' ? 64 : tier === 'mid' ? 40 : 16;
  return Math.min(configured, startupCap);
}

function maxConcurrent(): number {
  if (bootstrapMode) {
    // The worker has its own global media semaphore. Two small startup batches
    // are safe on strong desktops, while low/mid devices remain single-flight.
    return getDrivePerfProfile().tier === 'high' ? 2 : 1;
  }
  return Math.max(1, getDrivePerfProfile().thumbConcurrent || 1);
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
  activeSession = session;
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
  memCache.clear();
  softFailAt.clear();
  errorFailAt.clear();
  contextGeneration += 1;
  for (const [, task] of queue) {
    resolveTask(task, null);
  }
  queue.clear();
  metrics.queued = 0;
}

export function getCachedThumb(folderId: number | null, messageId: number): string | null | undefined {
  const k = cacheKey(folderId, messageId, activeQuality);
  if (memCache.has(k)) return memCache.get(k)!;
  const failAt = softFailAt.get(k);
  if (failAt != null && Date.now() - failAt < softFailMs()) return null;
  const errAt = errorFailAt.get(k);
  if (errAt != null && Date.now() - errAt < ERROR_COOLDOWN_MS) return null;
  return undefined;
}

/** Seed a just-committed thumbnail without opening another Telegram worker. */
export function primeThumbCache(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number,
  dataUrl: string
): void {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return;
  const k = cacheKey(folderId, messageId, activeQuality, creds.session);
  memCache.set(k, dataUrl);
  softFailAt.delete(k);
  errorFailAt.delete(k);
  void savePersistentThumb(k, dataUrl);
}

export function clearThumbCache() {
  memCache.clear();
  softFailAt.clear();
  errorFailAt.clear();
}

export function invalidateThumbFailures() {
  softFailAt.clear();
  errorFailAt.clear();
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
    });
  }
}

let thumbsPaused = false;

export function setThumbsPaused(paused: boolean) {
  thumbsPaused = paused;
  if (!paused && queue.size) {
    // Kick multiple flushes immediately on high-end
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
  if (immediate) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void flushQueue();
    return;
  }
  if (timer) return;
  const delay = thumbsPaused ? Math.max(200, flushDelayMs() * 3) : flushDelayMs();
  timer = setTimeout(() => {
    timer = null;
    void flushQueue();
  }, delay);
}

async function flushQueue() {
  if (queue.size === 0) return;
  if (thumbsPaused) {
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
      } else if (!(res as { deferred?: boolean }).deferred) {
        softFailAt.set(k, Date.now());
      } else {
        // Deferred (session not ready) — requeue without soft-fail
        if (task.generation === contextGeneration && task.contextKey === activeContextKey) {
          queue.set(k, task);
          metrics.retries += 1;
        }
      }
      if (!(res as { deferred?: boolean }).deferred) resolveTask(task, url);
    }
  } catch {
    for (const task of tasks) {
      const k = task.key;
      errorFailAt.set(k, Date.now());
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
  opts?: { priority?: ThumbPriority; contextKey?: string; signal?: AbortSignal }
): Promise<string | null> {
  if (opts?.signal?.aborted) return null;
  const contextKey = opts?.contextKey || activeContextKey;
  const generation = contextGeneration;
  const k = cacheKey(folderId, messageId, activeQuality, creds.session);
  const hit = memCache.get(k);
  if (hit) return Promise.resolve(hit);

  const failAt = softFailAt.get(k);
  if (failAt != null && Date.now() - failAt < softFailMs()) {
    return Promise.resolve(null);
  }
  const errAt = errorFailAt.get(k);
  if (errAt != null && Date.now() - errAt < ERROR_COOLDOWN_MS) {
    return Promise.resolve(null);
  }

  const persisted = await loadPersistentThumb(k);
  if (persisted) {
    memCache.set(k, persisted);
    softFailAt.delete(k);
    errorFailAt.delete(k);
    return persisted;
  }

  return new Promise((resolve) => {
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
    // During bootstrap, leave a tiny coalescing window instead of spawning
    // several high-end batches from child-card effects in the same frame.
    scheduleFlush(!bootstrapMode && getDrivePerfProfile().tier === 'high');
  });
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
