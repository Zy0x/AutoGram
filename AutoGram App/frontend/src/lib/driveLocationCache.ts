import type { DriveFile } from './driveTypes';

const CACHE_PREFIX = 'autogram_drive_locations_v1_';
const MAX_LOCATIONS = 24;
const MAX_FILES_PER_LOCATION = 64;
export const DRIVE_LOCATION_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type DriveLocationSnapshot = {
  files: DriveFile[];
  hasMore: boolean;
  nextOffsetId: number | null;
  totalCount: number | null;
  totalBytes: number | null;
  savedAt: number;
};

type CacheEnvelope = {
  entries: Record<string, DriveLocationSnapshot>;
};

export function driveLocationKey(peerId: number | null, topicId: number | null): string {
  return `${peerId == null ? 'root' : peerId}:${topicId == null ? 'all' : topicId}`;
}

function storageKey(session: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(session)}`;
}

function readEnvelope(storage: StorageLike, session: string): CacheEnvelope {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(session)) || 'null');
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      return parsed as CacheEnvelope;
    }
  } catch {
    // Corrupt/old cache is disposable; the network refresh will rebuild it.
  }
  return { entries: {} };
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return value != null && Number.isFinite(n) && n >= 0 ? n : null;
}

export function loadDriveLocationSnapshot(
  storage: StorageLike,
  session: string,
  peerId: number | null,
  topicId: number | null,
  now = Date.now()
): DriveLocationSnapshot | null {
  const entry = readEnvelope(storage, session).entries[driveLocationKey(peerId, topicId)];
  if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) return null;
  if (!Number.isFinite(entry.savedAt) || now - entry.savedAt > DRIVE_LOCATION_CACHE_MAX_AGE_MS) {
    return null;
  }
  // Deduplicate by message id — older snapshots may contain duplicates from earlier bugs.
  // Use string coercion key so that both JSON-parsed strings and number IDs are unified.
  const seen = new Set<string>();
  const deduped: DriveFile[] = [];
  for (const f of entry.files) {
    const key = f && f.id != null ? String(f.id) : null;
    if (key != null && !seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }
  return {
    files: deduped.slice(0, MAX_FILES_PER_LOCATION),
    hasMore: !!entry.hasMore,
    nextOffsetId: finiteOrNull(entry.nextOffsetId),
    totalCount: finiteOrNull(entry.totalCount),
    totalBytes: finiteOrNull(entry.totalBytes),
    savedAt: entry.savedAt,
  };
}

export function saveDriveLocationSnapshot(
  storage: StorageLike,
  session: string,
  peerId: number | null,
  topicId: number | null,
  snapshot: Omit<DriveLocationSnapshot, 'savedAt'>,
  now = Date.now()
): void {
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) return;
  const envelope = readEnvelope(storage, session);
  envelope.entries[driveLocationKey(peerId, topicId)] = {
    files: snapshot.files.slice(0, MAX_FILES_PER_LOCATION),
    hasMore: !!snapshot.hasMore,
    nextOffsetId: finiteOrNull(snapshot.nextOffsetId),
    totalCount: finiteOrNull(snapshot.totalCount),
    totalBytes: finiteOrNull(snapshot.totalBytes),
    savedAt: now,
  };

  envelope.entries = Object.fromEntries(
    Object.entries(envelope.entries)
      .sort(([, a], [, b]) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
      .slice(0, MAX_LOCATIONS)
  );
  try {
    storage.setItem(storageKey(session), JSON.stringify(envelope));
  } catch {
    // Cache failure must never block Media Studio.
  }
}

export function removeFilesFromDriveLocationSnapshot(
  storage: StorageLike,
  session: string,
  peerId: number | null,
  topicId: number | null,
  deletedIds: number[]
): void {
  if (!deletedIds || !deletedIds.length) return;
  const key = driveLocationKey(peerId, topicId);
  const envelope = readEnvelope(storage, session);
  const existing = envelope.entries[key];
  if (!existing || !Array.isArray(existing.files)) return;

  const deletedSet = new Set(deletedIds.map((id) => Number(id)));
  const updatedFiles = existing.files.filter((f) => !deletedSet.has(Number(f.id)));
  
  if (updatedFiles.length === existing.files.length) return;

  envelope.entries[key] = {
    ...existing,
    files: updatedFiles,
    totalCount: existing.totalCount != null ? Math.max(0, existing.totalCount - (existing.files.length - updatedFiles.length)) : null,
    savedAt: Date.now(),
  };

  try {
    storage.setItem(storageKey(session), JSON.stringify(envelope));
  } catch {
    /* ignore */
  }
}

