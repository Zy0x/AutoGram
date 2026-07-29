import type { DriveViewMode } from './driveTypes';

const PREFIX = 'autogram_drive_scroll_v1_';
const MAX_ENTRIES = 80;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type ScrollEntry = { top: number; savedAt: number };
type ScrollEnvelope = { entries: Record<string, ScrollEntry> };

export function driveScrollLocationKey(
  kind: string,
  peerId: number | null,
  topicId: number | null,
  viewMode: DriveViewMode
): string {
  return `${kind}:${peerId ?? 'root'}:${topicId ?? 'all'}:${viewMode}`;
}

function storageKey(session: string): string {
  return `${PREFIX}${encodeURIComponent(session)}`;
}

function read(storage: StorageLike, session: string): ScrollEnvelope {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(session)) || 'null');
    if (parsed?.entries && typeof parsed.entries === 'object') return parsed as ScrollEnvelope;
  } catch {
    // Corrupt scroll memory is disposable.
  }
  return { entries: {} };
}

export function loadDriveScrollPosition(
  storage: StorageLike,
  session: string,
  locationKey: string
): number {
  const top = Number(read(storage, session).entries[locationKey]?.top);
  return Number.isFinite(top) && top > 0 ? top : 0;
}

export function saveDriveScrollPosition(
  storage: StorageLike,
  session: string,
  locationKey: string,
  top: number,
  now = Date.now()
): void {
  const envelope = read(storage, session);
  envelope.entries[locationKey] = {
    top: Number.isFinite(top) ? Math.max(0, Math.round(top)) : 0,
    savedAt: now,
  };
  envelope.entries = Object.fromEntries(
    Object.entries(envelope.entries)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, MAX_ENTRIES)
  );
  try {
    storage.setItem(storageKey(session), JSON.stringify(envelope));
  } catch {
    // Scroll restoration is best-effort only.
  }
}

