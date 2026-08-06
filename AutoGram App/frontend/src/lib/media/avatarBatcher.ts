/**
 * Coalesce sidebar profile-photo requests into small worker batches.
 * Disk-backed on the Python side; here we only keep a memory cache.
 * peer_id 0 = self (Saved Messages).
 */
import { driveAvatarsBatch, type DriveCredentials } from '../telegram/driveApi';
import { getDrivePerfProfile } from '../utils/devicePerformance';

type Entry = { resolve: (url: string | null) => void };

/** Successful data URLs only (key: `${session}:${peerId}`) */
const memCache = new Map<string, string>();
/** Soft-fail timestamps (no photo / error) — avoid hammering */
const softFailAt = new Map<string, number>();
/** Known empty (no profile photo) — longer than soft-fail */
const emptyAt = new Map<string, number>();

const SOFT_FAIL_MS = 5 * 60_000;
const EMPTY_MS = 24 * 60 * 60_000;

function avatarKey(peerId: number, session?: string): string {
  const s = String(session || '').trim() || 'unscoped';
  return `${s}:${Number(peerId)}`;
}

function batchSize(): number {
  return getDrivePerfProfile().avatarBatch;
}
function flushMs(): number {
  return getDrivePerfProfile().tier === 'low' ? 220 : 120;
}
function maxQueue(): number {
  return getDrivePerfProfile().avatarQueueMax;
}

type QueueItem = {
  creds: DriveCredentials;
  peerId: number;
  waiters: Entry[];
};

const queue = new Map<string, QueueItem>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushBusy = false;
let avatarsPaused = false;

/**
 * undefined = unknown (should fetch)
 * string = data URL
 * null = soft-failed / empty recently
 */
export function getCachedAvatar(peerId: number, session?: string): string | null | undefined {
  if (!session) return undefined;
  const k = avatarKey(peerId, session);
  if (memCache.has(k)) return memCache.get(k)!;
  const empty = emptyAt.get(k);
  if (empty != null && Date.now() - empty < EMPTY_MS) return null;
  const failAt = softFailAt.get(k);
  if (failAt != null && Date.now() - failAt < SOFT_FAIL_MS) return null;
  return undefined;
}

export function clearAvatarCache() {
  memCache.clear();
  softFailAt.clear();
  emptyAt.clear();
  queue.clear();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flushBusy = false;
}

/** Soft-fails only — keep successful avatars (disk already caches) */
export function invalidateAvatarFailures() {
  softFailAt.clear();
  emptyAt.clear();
}

export function setAvatarsPaused(paused: boolean) {
  avatarsPaused = paused;
  if (!paused && queue.size) scheduleFlush();
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushQueue();
  }, avatarsPaused ? Math.max(220, flushMs() * 2) : flushMs());
}

async function flushQueue() {
  if (flushBusy || queue.size === 0) return;
  if (avatarsPaused) {
    scheduleFlush();
    return;
  }
  flushBusy = true;

  // Group pending queue items by session
  const itemsBySession = new Map<string, QueueItem[]>();
  const keysToRemove: string[] = [];

  for (const [key, item] of queue.entries()) {
    const session = item.creds.session || 'unscoped';
    const list = itemsBySession.get(session) || [];
    list.push(item);
    itemsBySession.set(session, list);
    keysToRemove.push(key);
  }

  for (const key of keysToRemove) {
    queue.delete(key);
  }

  const BATCH = batchSize();

  for (const [session, items] of itemsBySession.entries()) {
    const creds = items[0].creds;
    const batchItems = items.slice(0, BATCH);
    const peerIds = batchItems.map((i) => i.peerId);

    try {
      const res = await driveAvatarsBatch(creds, peerIds, { batchSize: BATCH });
      const avatars = (res?.avatars || {}) as Record<string, string | null>;
      for (const item of batchItems) {
        const k = avatarKey(item.peerId, session);
        const url = avatars[String(item.peerId)] ?? null;
        if (url) {
          memCache.set(k, url);
          softFailAt.delete(k);
          emptyAt.delete(k);
        } else {
          emptyAt.set(k, Date.now());
        }
        for (const w of item.waiters) w.resolve(url);
      }
    } catch {
      for (const item of batchItems) {
        const k = avatarKey(item.peerId, session);
        softFailAt.set(k, Date.now());
        for (const w of item.waiters) w.resolve(null);
      }
    }
  }

  flushBusy = false;
  if (queue.size) scheduleFlush();
}

/** Request one profile photo; coalesces with other sidebar rows safely per session. */
export function requestAvatar(
  creds: DriveCredentials,
  peerId: number
): Promise<string | null> {
  const pid = Number(peerId);
  if (!Number.isFinite(pid)) return Promise.resolve(null);

  const session = creds.session || 'unscoped';
  const k = avatarKey(pid, session);

  const hit = memCache.get(k);
  if (hit) return Promise.resolve(hit);

  const empty = emptyAt.get(k);
  if (empty != null && Date.now() - empty < EMPTY_MS) {
    return Promise.resolve(null);
  }
  const failAt = softFailAt.get(k);
  if (failAt != null && Date.now() - failAt < SOFT_FAIL_MS) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const item = queue.get(k) || { creds, peerId: pid, waiters: [] };
    item.waiters.push({ resolve });
    queue.set(k, item);
    scheduleFlush();
  });
}

/** Prefetch many peers per session. */
export function prefetchAvatars(creds: DriveCredentials, peerIds: number[]) {
  const session = creds.session || 'unscoped';
  const BATCH = batchSize();
  const MAX_QUEUE = maxQueue();
  let added = 0;
  for (const raw of peerIds) {
    if (queue.size >= MAX_QUEUE) break;
    const pid = Number(raw);
    if (!Number.isFinite(pid)) continue;
    const k = avatarKey(pid, session);
    if (memCache.has(k)) continue;
    const empty = emptyAt.get(k);
    if (empty != null && Date.now() - empty < EMPTY_MS) continue;
    const failAt = softFailAt.get(k);
    if (failAt != null && Date.now() - failAt < SOFT_FAIL_MS) continue;
    if (queue.has(k)) continue;
    queue.set(k, { creds, peerId: pid, waiters: [{ resolve: () => {} }] });
    added++;
    if (added >= BATCH * 2) break;
  }
  if (queue.size) scheduleFlush();
}
