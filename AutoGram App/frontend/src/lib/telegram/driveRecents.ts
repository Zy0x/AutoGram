/**
 * Recent Drive locations + pinned favorites (Google Drive–style quick jump).
 * ALWAYS session-scoped — never share Terbaru/pins across Telegram accounts.
 */
import { truncateMiddle } from '../drivePower';

export type DriveRecentKind = 'saved' | 'drive' | 'chat';

export type DriveRecent = {
  kind: DriveRecentKind;
  id: number | null;
  label: string;
  at: number;
};

const LS_RECENTS_PREFIX = 'autogram_drive_recents_v2_';
const LS_PINS_PREFIX = 'autogram_drive_pins_v2_';
/** Legacy unscoped keys — read-once migrate then wipe so they cannot bleed. */
const LS_LEGACY_RECENTS = 'autogram_drive_recents';
const LS_LEGACY_PINS = 'autogram_drive_pins';
const MAX = 8;
const MAX_PINS = 8;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function sessionKey(prefix: string, session: string): string {
  const s = String(session || '').trim();
  return `${prefix}${encodeURIComponent(s || '_none')}`;
}

function keyOf(r: Pick<DriveRecent, 'kind' | 'id'>): string {
  return `${r.kind}:${r.id ?? 'me'}`;
}

function normalizeList(raw: unknown, max: number): DriveRecent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x) =>
        x &&
        (x.kind === 'saved' || x.kind === 'drive' || x.kind === 'chat') &&
        typeof x.label === 'string'
    )
    .map((x) => ({
      kind: x.kind as DriveRecentKind,
      id: x.kind === 'saved' ? null : Number(x.id),
      label: String(x.label || '').slice(0, 80),
      at: Number(x.at) || 0,
    }))
    .filter((x) => x.kind === 'saved' || Number.isFinite(x.id as number))
    .slice(0, max);
}

/** Pure key builder — unit-tested so UI never regresses to unscoped keys. */
export function driveRecentsStorageKey(session: string): string {
  return sessionKey(LS_RECENTS_PREFIX, session);
}

export function drivePinsStorageKey(session: string): string {
  return sessionKey(LS_PINS_PREFIX, session);
}

function wipeLegacyUnscoped(store: StorageLike): void {
  try {
    store.removeItem(LS_LEGACY_RECENTS);
    store.removeItem(LS_LEGACY_PINS);
  } catch {
    /* ignore */
  }
}

export function loadDriveRecents(session: string, store?: StorageLike | null): DriveRecent[] {
  const s = store ?? storage();
  if (!s || !String(session || '').trim()) return [];
  try {
    const raw = s.getItem(driveRecentsStorageKey(session));
    if (raw) return normalizeList(JSON.parse(raw), MAX);
  } catch {
    /* corrupt */
  }
  // Never promote legacy global recents into a new session — they are poison.
  wipeLegacyUnscoped(s);
  return [];
}

export function pushDriveRecent(
  session: string,
  entry: Omit<DriveRecent, 'at'> & { at?: number },
  store?: StorageLike | null
): DriveRecent[] {
  const s = store ?? storage();
  if (!s || !String(session || '').trim()) return [];
  const next: DriveRecent = {
    kind: entry.kind,
    id: entry.kind === 'saved' ? null : entry.id,
    label: (entry.label || 'Lokasi').slice(0, 80),
    at: entry.at ?? Date.now(),
  };
  const prev = loadDriveRecents(session, s).filter((r) => keyOf(r) !== keyOf(next));
  const list = [next, ...prev].slice(0, MAX);
  try {
    s.setItem(driveRecentsStorageKey(session), JSON.stringify(list));
    wipeLegacyUnscoped(s);
  } catch {
    /* ignore */
  }
  return list;
}

export function clearDriveRecents(session: string, store?: StorageLike | null): void {
  const s = store ?? storage();
  if (!s || !String(session || '').trim()) return;
  try {
    s.removeItem(driveRecentsStorageKey(session));
  } catch {
    /* ignore */
  }
}

export function loadDrivePins(session: string, store?: StorageLike | null): DriveRecent[] {
  const s = store ?? storage();
  if (!s || !String(session || '').trim()) return [];
  try {
    const raw = s.getItem(drivePinsStorageKey(session));
    if (raw) return normalizeList(JSON.parse(raw), MAX_PINS);
  } catch {
    /* corrupt */
  }
  wipeLegacyUnscoped(s);
  return [];
}

function savePins(session: string, list: DriveRecent[], store: StorageLike): DriveRecent[] {
  const out = list.slice(0, MAX_PINS);
  try {
    store.setItem(drivePinsStorageKey(session), JSON.stringify(out));
    wipeLegacyUnscoped(store);
  } catch {
    /* ignore */
  }
  return out;
}

export function isDrivePinned(
  session: string,
  entry: Pick<DriveRecent, 'kind' | 'id'>,
  store?: StorageLike | null
): boolean {
  const k = keyOf(entry);
  return loadDrivePins(session, store).some((p) => keyOf(p) === k);
}

export function toggleDrivePin(
  session: string,
  entry: Omit<DriveRecent, 'at'> & { at?: number },
  store?: StorageLike | null
): DriveRecent[] {
  const s = store ?? storage();
  if (!s || !String(session || '').trim()) return [];
  const next: DriveRecent = {
    kind: entry.kind,
    id: entry.kind === 'saved' ? null : entry.id,
    label: (entry.label || 'Lokasi').slice(0, 80),
    at: entry.at ?? Date.now(),
  };
  const prev = loadDrivePins(session, s);
  const k = keyOf(next);
  if (prev.some((p) => keyOf(p) === k)) {
    return savePins(session, prev.filter((p) => keyOf(p) !== k), s);
  }
  return savePins(session, [next, ...prev], s);
}

/** Short label for chips (middle ellipsis). */
export function recentDisplayLabel(label: string, max = 20): string {
  return truncateMiddle(label, max);
}

/**
 * Guard for Terbaru writes: never record a chat/drive peer for session S unless
 * that peer id appears in S's loaded chats/folders (or location is Saved).
 * Pure — unit-tested to prevent A→B cross-session Terbaru poison.
 */
export function shouldRecordDriveRecent(args: {
  session: string;
  locationKind: DriveRecentKind;
  peerId: number | null;
  knownPeerIds: Iterable<number | null | undefined>;
}): boolean {
  const session = String(args.session || '').trim();
  if (!session) return false;
  if (args.locationKind === 'saved') return true;
  if (args.peerId == null || !Number.isFinite(args.peerId)) return false;
  const id = Number(args.peerId);
  for (const k of args.knownPeerIds) {
    if (k != null && Number(k) === id) return true;
  }
  return false;
}

/**
 * Session-scoped last open location (kind + peer id).
 * Unscoped global peer is the main cause of PeerChannel cross-account errors.
 */
const LS_PEER_PREFIX = 'autogram_drive_peer_v2_';
const LS_PEER_LEGACY = 'autogram_drive_peer';

export type DrivePeerLocation = {
  kind: DriveRecentKind;
  id: number | null;
};

export function drivePeerStorageKey(session: string): string {
  return sessionKey(LS_PEER_PREFIX, session);
}

export function loadDrivePeer(
  session: string,
  store?: StorageLike | null
): DrivePeerLocation {
  const s = store ?? storage();
  if (!s || !String(session || '').trim()) return { kind: 'saved', id: null };
  try {
    const raw = s.getItem(drivePeerStorageKey(session));
    if (raw) {
      const p = JSON.parse(raw);
      if (p.kind === 'saved') return { kind: 'saved', id: null };
      if ((p.kind === 'drive' || p.kind === 'chat') && typeof p.id === 'number') {
        return { kind: p.kind, id: p.id };
      }
    }
  } catch {
    /* ignore */
  }
  // Drop legacy global peer so it cannot open another account's channel.
  try {
    s.removeItem(LS_PEER_LEGACY);
  } catch {
    /* ignore */
  }
  return { kind: 'saved', id: null };
}

export function saveDrivePeer(
  session: string,
  loc: DrivePeerLocation,
  store?: StorageLike | null
): void {
  const s = store ?? storage();
  if (!s || !String(session || '').trim()) return;
  try {
    s.setItem(
      drivePeerStorageKey(session),
      JSON.stringify({
        kind: loc.kind,
        id: loc.kind === 'saved' ? null : loc.id,
      })
    );
    s.removeItem(LS_PEER_LEGACY);
  } catch {
    /* ignore */
  }
}

/** Clear in-memory-safe ephemeral root caches for a session (sessionStorage). */
export function clearDriveSessionEphemeralCaches(session: string): void {
  const s = String(session || '').trim();
  if (!s) return;
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(`drive_root_chats_${s}`);
    sessionStorage.removeItem(`drive_root_files_${s}`);
  } catch {
    /* ignore */
  }
}
