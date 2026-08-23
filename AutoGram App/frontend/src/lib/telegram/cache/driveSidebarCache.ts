import type { DriveChat, DriveFolder } from '../driveTypes';

const PREFIX = 'autogram_drive_sidebar_v1_';
export const DRIVE_SIDEBAR_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const DRIVE_SIDEBAR_CHAT_LIMIT = 1_000;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type DriveSidebarSnapshot = {
  folders: DriveFolder[];
  chats: DriveChat[];
  chatsHasMore: boolean;
  chatsOffset: number;
  cursor: {
    offset_id?: number | null;
    offset_date?: string | null;
    offset_peer_id?: number | null;
  } | null;
  savedAt: number;
};

function key(session: string): string {
  return `${PREFIX}${encodeURIComponent(session)}`;
}

export function loadDriveSidebarSnapshot(
  storage: StorageLike,
  session: string,
  now = Date.now()
): DriveSidebarSnapshot | null {
  try {
    const parsed = JSON.parse(storage.getItem(key(session)) || 'null');
    if (!parsed || !Array.isArray(parsed.folders) || !Array.isArray(parsed.chats)) return null;
    if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > DRIVE_SIDEBAR_CACHE_MAX_AGE_MS) {
      return null;
    }
    return {
      folders: parsed.folders.slice(0, 500),
      chats: parsed.chats.slice(0, DRIVE_SIDEBAR_CHAT_LIMIT),
      chatsHasMore: !!parsed.chatsHasMore,
      chatsOffset: Math.max(0, Number(parsed.chatsOffset) || parsed.chats.length),
      cursor: parsed.cursor && typeof parsed.cursor === 'object' ? parsed.cursor : null,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/** Drop sidebar snapshot for one session (e.g. after PeerChannel poison). */
export function clearDriveSidebarSnapshot(storage: StorageLike, session: string): void {
  try {
    storage.removeItem?.(key(session));
  } catch {
    /* ignore */
  }
}

export function saveDriveSidebarSnapshot(
  storage: StorageLike,
  session: string,
  update: Partial<Omit<DriveSidebarSnapshot, 'savedAt'>>,
  now = Date.now()
): void {
  const previous = loadDriveSidebarSnapshot(storage, session, now) ?? {
    folders: [],
    chats: [],
    chatsHasMore: false,
    chatsOffset: 0,
    cursor: null,
    savedAt: now,
  };
  const next: DriveSidebarSnapshot = {
    folders: (update.folders ?? previous.folders).slice(0, 500),
    chats: (update.chats ?? previous.chats).slice(0, DRIVE_SIDEBAR_CHAT_LIMIT),
    chatsHasMore: update.chatsHasMore ?? previous.chatsHasMore,
    chatsOffset: update.chatsOffset ?? previous.chatsOffset,
    cursor: update.cursor === undefined ? previous.cursor : update.cursor,
    savedAt: now,
  };
  try {
    storage.setItem(key(session), JSON.stringify(next));
  } catch {
    // Sidebar cache is an acceleration layer only.
  }
}

export function removeFoldersFromDriveSidebarSnapshot(
  storage: StorageLike,
  session: string,
  folderIds: number[],
  now = Date.now()
): void {
  if (!folderIds || !folderIds.length) return;
  const deleteSet = new Set(folderIds.map((id) => Number(id)));
  const existing = loadDriveSidebarSnapshot(storage, session, now);
  if (!existing || !Array.isArray(existing.folders)) return;

  const nextFolders = existing.folders.filter((f) => !deleteSet.has(Number(f.id)));
  const nextChats = existing.chats.filter((c) => !deleteSet.has(Number(c.id)));
  if (nextFolders.length === existing.folders.length && nextChats.length === existing.chats.length) return;

  saveDriveSidebarSnapshot(storage, session, {
    folders: nextFolders,
    chats: nextChats,
  }, now);
}
