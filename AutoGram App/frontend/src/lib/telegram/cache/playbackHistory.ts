const PREFIX = 'autogram_drive_playback_v1_';
const MAX_ENTRIES = 500;
export const PLAYBACK_HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PlaybackHistoryEntry = {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
};
type PlaybackEnvelope = { entries: Record<string, PlaybackHistoryEntry> };

export function playbackHistoryStorageKey(session: string): string {
  return `${PREFIX}${encodeURIComponent(session)}`;
}

export function drivePlaybackIdentity(folderId: number | null, file: { id: number; size?: number | null }): string {
  return `${folderId ?? 'saved'}:${file.id}:${Number(file.size || 0)}`;
}

function read(storage: StorageLike, session: string, now = Date.now()): PlaybackEnvelope {
  try {
    const parsed = JSON.parse(storage.getItem(playbackHistoryStorageKey(session)) || 'null');
    if (parsed?.entries && typeof parsed.entries === 'object') {
      const entries: Record<string, PlaybackHistoryEntry> = {};
      Object.entries(parsed.entries).forEach(([key, raw]) => {
        const value = raw as PlaybackHistoryEntry;
        if (
          Number.isFinite(value?.positionSeconds) &&
          Number.isFinite(value?.durationSeconds) &&
          Number.isFinite(value?.updatedAt) &&
          now - value.updatedAt <= PLAYBACK_HISTORY_TTL_MS
        ) {
          entries[key] = value;
        }
      });
      return { entries };
    }
  } catch {
    // Playback history is best-effort and can be discarded if malformed.
  }
  return { entries: {} };
}

export function loadPlaybackPosition(
  storage: StorageLike,
  session: string,
  identity: string,
  now = Date.now()
): PlaybackHistoryEntry | null {
  const entry = read(storage, session, now).entries[identity];
  if (!entry || !Number.isFinite(entry.positionSeconds) || entry.positionSeconds <= 0) return null;
  return entry;
}

export function savePlaybackPosition(
  storage: StorageLike,
  session: string,
  identity: string,
  positionSeconds: number,
  durationSeconds: number,
  now = Date.now()
): void {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
  const envelope = read(storage, session, now);
  envelope.entries[identity] = {
    positionSeconds: Math.max(0, Math.min(positionSeconds, durationSeconds)),
    durationSeconds,
    updatedAt: now,
  };
  envelope.entries = Object.fromEntries(
    Object.entries(envelope.entries)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ENTRIES)
  );
  try {
    storage.setItem(playbackHistoryStorageKey(session), JSON.stringify(envelope));
  } catch {
    // Local storage quota must never block playback.
  }
}

export function clearPlaybackHistory(storage: StorageLike, session?: string): void {
  try {
    if (session) {
      storage.removeItem(playbackHistoryStorageKey(session));
      return;
    }
    const keys: string[] = [];
    const length = (storage as Storage).length || 0;
    for (let index = 0; index < length; index += 1) {
      const key = (storage as Storage).key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Cache clearing is best-effort.
  }
}
