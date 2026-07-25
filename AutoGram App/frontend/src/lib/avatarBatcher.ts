/**
 * Coalesce sidebar profile-photo requests into small worker batches.
 * Disk-backed on the Python side; here we only keep a memory cache.
 * peer_id 0 = self (Saved Messages).
 */
import { driveAvatarsBatch, type DriveCredentials } from './driveApi';
import { getDrivePerfProfile } from './devicePerformance';

type Entry = { resolve: (url: string | null) => void };

/** Successful data URLs only (key: `${session}:${peerId}`) */
const memCache = new Map<string, string>();
/** Soft-fail timestamps (no photo / error) — avoid hammering */
const softFailAt = new Map<string, number>();
/** Known empty (no profile photo) — longer than soft-fail */
const emptyAt = new Map<string, number>();

const SOFT_FAIL_MS = 5 * 60_000;
const EMPTY_MS = 24 * 60 * 60_000;

function avatarKey(peerId: number, session = lastCreds?.session || 'unscoped'): string {
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

const queue = new Map<number, Entry[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushBusy = false;
let lastCreds: DriveCredentials | null = null;
let avatarsPaused = false;

/**
 * undefined = unknown (should fetch)
 * string = data URL
 * null = soft-failed / empty recently
 */
export function getCachedAvatar(peerId: number, session = lastCreds?.session || 'unscoped'): string | null | undefined {
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
  lastCreds = null;
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
  if (flushBusy || !lastCreds) return;
  if (queue.size === 0) return;
  if (avatarsPaused) {
    scheduleFlush();
    return;
  }
  flushBusy = true;

  const creds = lastCreds;
  const session = creds.session || 'unscoped';
  const ids: number[] = [];
  const waiterSnap = new Map<number, Entry[]>();
  const BATCH = batchSize();

  for (const [pid, entries] of queue) {
    waiterSnap.set(pid, entries);
    ids.push(pid);
    queue.delete(pid);
    if (ids.length >= BATCH) break;
  }

  if (!ids.length) {
    flushBusy = false;
    return;
  }

  try {
    const res = await driveAvatarsBatch(creds, ids, { batchSize: BATCH });
    const avatars = (res?.avatars || {}) as Record<string, string | null>;
    for (const pid of ids) {
      const k = avatarKey(pid, session);
      const url = avatars[String(pid)] ?? null;
      if (url) {
        memCache.set(k, url);
        softFailAt.delete(k);
        emptyAt.delete(k);
      } else {
        // Treat null as empty/no-photo (backend marks disk .empty)
        emptyAt.set(k, Date.now());
      }
      for (const e of waiterSnap.get(pid) || []) e.resolve(url);
    }
  } catch {
    for (const pid of ids) {
      const k = avatarKey(pid, session);
      softFailAt.set(k, Date.now());
      for (const e of waiterSnap.get(pid) || []) e.resolve(null);
    }
  }

  flushBusy = false;
  if (queue.size) scheduleFlush();
}

/** Request one profile photo; coalesces with other sidebar rows. */
export function requestAvatar(
  creds: DriveCredentials,
  peerId: number
): Promise<string | null> {
  lastCreds = creds;
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
    const list = queue.get(pid) || [];
    list.push({ resolve });
    queue.set(pid, list);
    scheduleFlush();
  });
}

/** Prefetch many peers (e.g. visible virtual rows only — not entire 10k list). */
export function prefetchAvatars(creds: DriveCredentials, peerIds: number[]) {
  lastCreds = creds;
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
    if (queue.has(pid)) continue;
    queue.set(pid, [{ resolve: () => {} }]);
    added++;
    if (added >= BATCH * 2) break; // never enqueue more than 2 batches at once
  }
  if (queue.size) scheduleFlush();
}
