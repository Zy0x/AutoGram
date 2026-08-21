/**
 * Shared session list for Job Editor / Media Studio.
 * Accounts shows all sessions; pickers need selectable names without
 * false-empty when API store is mid-migrate or ACTIVE_SESSIONS is empty.
 */
import { bootstrapSecureCredentials, getApiCredentials } from '../../tauri/secureCredentials';
import { tgAuthStatus, tgListSessions } from '../core/telegramBackend';

export type SessionOption = {
  name: string;
  label?: string;
  status: string;
  source?: string;
  userFullName?: string;
  username?: string;
  latencyMs?: number;
};

/**
 * Launcher cards must represent a verified Telegram identity. Native inventory
 * can contain legacy aliases or migration source files that look like a real
 * account before the background auth check finishes.
 */
export function hasStableSessionIdentity(
  session: SessionOption,
  metadataFor: (sessionName: string) => SessionMetadata | null = getSessionMetadata
): boolean {
  return Boolean(String(metadataFor(session.name)?.telegramUserId || '').trim());
}

export function dedupeSessionOptionsByIdentity(
  sessions: SessionOption[],
  metadataFor: (sessionName: string) => SessionMetadata | null = getSessionMetadata
): SessionOption[] {
  const seen = new Map<string, number>();
  const result: SessionOption[] = [];
  for (const session of sessions) {
    const metadata = metadataFor(session.name);
    const telegramUserId = String(metadata?.telegramUserId || '').trim();
    // Unknown identities must remain independent until Telegram verification
    // supplies a stable account id.
    if (!telegramUserId) {
      result.push(session);
      continue;
    }
    const key = `user:${telegramUserId}`;
    const existingIndex = seen.get(key);
    const candidate = {
      ...session,
      label: getSessionDisplayName(session.name),
      userFullName: metadata?.userFullName,
      username: metadata?.username,
    };
    if (existingIndex == null) {
      seen.set(key, result.length);
      result.push(candidate);
      continue;
    }
    const existing = result[existingIndex];
    const score = (item: SessionOption) =>
      (item.status === 'connected' ? 8 : 0) +
      (item.name.startsWith('session_') ? 4 : 0) +
      (item.username ? 2 : 0) +
      (item.userFullName ? 1 : 0);
    if (score(candidate) > score(existing)) result[existingIndex] = candidate;
  }
  return result;
}

export type SessionMetadata = {
  userFullName?: string;
  username?: string;
  phone?: string;
  photoBase64?: string;
  alias?: string;
  telegramUserId?: string | number;
  isPremium?: boolean;
  updatedAt?: number;
};

const ACTIVE_KEY = 'ACTIVE_SESSIONS';
const METADATA_KEY = 'AUTOGRAM_SESSION_METADATA';
const ALIASES_KEY = 'CUSTOM_SESSION_ALIASES';

const MAX_ACTIVE_SESSIONS = 12;

export function getSessionMetadata(sessionName: string): SessionMetadata | null {
  if (!sessionName) return null;
  try {
    const raw = localStorage.getItem(METADATA_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw);
    return store[sessionName] || null;
  } catch {
    return null;
  }
}

export const SESSION_METADATA_EVENT = 'autogram_session_metadata_updated';

export function notifySessionMetadataChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_METADATA_EVENT));
  }
}

export function saveSessionMetadata(
  sessionName: string,
  meta: Partial<SessionMetadata>
): void {
  if (!sessionName) return;
  try {
    const raw = localStorage.getItem(METADATA_KEY);
    const store = raw ? JSON.parse(raw) : {};
    const existing = store[sessionName] || {};
    store[sessionName] = {
      ...existing,
      ...meta,
      updatedAt: Date.now(),
    };
    localStorage.setItem(METADATA_KEY, JSON.stringify(store));
    notifySessionMetadataChanged();
  } catch {
    /* ignore */
  }
}

export function setSessionAlias(sessionName: string, alias: string): void {
  if (!sessionName) return;
  try {
    const rawAliases = localStorage.getItem(ALIASES_KEY);
    const aliases = rawAliases ? JSON.parse(rawAliases) : {};
    const trimmed = alias.trim();
    if (trimmed) {
      aliases[sessionName] = trimmed;
    } else {
      delete aliases[sessionName];
    }
    localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases));
    notifySessionMetadataChanged();
  } catch {}
}

export function deleteSessionLocalData(sessionName: string, purgeCache = false): void {
  if (!sessionName) return;
  try {
    const rawMeta = localStorage.getItem(METADATA_KEY);
    if (rawMeta) {
      const store = JSON.parse(rawMeta);
      delete store[sessionName];
      localStorage.setItem(METADATA_KEY, JSON.stringify(store));
    }

    const rawAliases = localStorage.getItem(ALIASES_KEY);
    if (rawAliases) {
      const aliases = JSON.parse(rawAliases);
      delete aliases[sessionName];
      localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases));
    }

    const targets = readActiveTargets();
    const nextTargets = targets.filter((t) => t !== sessionName);
    setActiveSessionTargets(nextTargets);

    if (purgeCache) {
      localStorage.removeItem(`autogram_recents_${sessionName}`);
      localStorage.removeItem(`autogram_sidebar_${sessionName}`);
      localStorage.removeItem(`autogram_totals_${sessionName}`);
    }

    notifySessionMetadataChanged();
  } catch {}
}

export function getSessionDisplayName(sessionName: string): string {
  if (!sessionName) return '';

  // 1. Custom alias set by user in Accounts page
  try {
    const rawAliases = localStorage.getItem(ALIASES_KEY);
    if (rawAliases) {
      const aliases = JSON.parse(rawAliases);
      if (aliases[sessionName]) return aliases[sessionName];
    }
  } catch {
    /* ignore */
  }

  // 2. Cached user metadata from Telegram auth
  const meta = getSessionMetadata(sessionName);
  if (meta) {
    const namePart = meta.userFullName ? meta.userFullName.trim() : '';
    const userPart = meta.username ? (meta.username.startsWith('@') ? meta.username : `@${meta.username}`) : '';
    if (namePart && userPart) return `${namePart} (${userPart})`;
    if (namePart) return namePart;
    if (userPart) return userPart;
  }

  // 3. Fallback to clean sessionName or formatted session timestamp
  if (sessionName.startsWith('session_')) {
    return `Sesi #${sessionName.replace(/^session_/, '')}`;
  }

  return sessionName;
}

function readActiveTargets(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.map(String).filter(Boolean).slice(0, MAX_ACTIVE_SESSIONS)
      : [];
  } catch {
    return [];
  }
}

/** Persist Active Target list (same key as Accounts page). Multi-account allowed. */
export function setActiveSessionTargets(names: string[]): void {
  localStorage.setItem(
    ACTIVE_KEY,
    JSON.stringify(names.filter(Boolean).slice(0, MAX_ACTIVE_SESSIONS))
  );
}

export function getActiveSessionTargets(): string[] {
  return readActiveTargets();
}

/** Hard-reset both cache layers. Call after adding or deleting an account. */
export function invalidateSessionCache(): void {
  sessionsMemCache = null;
  sessionsQuickCache = null;
}

function isUsableStatus(status: string | undefined): boolean {
  const s = String(status || 'active').toLowerCase();
  // Reject only clearly bad states
  if (s === 'expired' || s === 'error' || s === 'revoked') return false;
  return true;
}

/**
 * In-memory cache layers:
 * - sessionsMemCache: result from the most recent loadSelectableSessions call (verify=true or false)
 * - sessionsQuickCache: last known list regardless of verify — used for instant paint on mount
 * TTL is 5 minutes; force:true always bypasses both caches.
 */
let sessionsMemCache: { at: number; verify: boolean; list: SessionOption[] } | null = null;
let sessionsQuickCache: SessionOption[] | null = null; // stale-while-revalidate layer
const SESSIONS_MEM_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load sessions for UI pickers.
 * - Seeds API credentials from secure store / worker .env
 * - Lists native session inventory before live verification
 * - Prefers Accounts "Active Target" toggles; if none set, uses all usable
 * - Auto-seeds ACTIVE_SESSIONS once so Accounts and pickers stay in sync
 */
export async function loadSelectableSessions(opts?: {
  /** If true and ACTIVE_SESSIONS empty, write all usable names there */
  autoSeedActive?: boolean;
  /**
   * Live Telegram status check (slow). Default false — offline DB+file list only.
   * Media Studio must stay offline-fast to avoid lag/force-close on session switch.
   */
  verify?: boolean;
  /** Bypass 5-min memory cache (e.g. after add/delete account) */
  force?: boolean;
}): Promise<SessionOption[]> {
  const autoSeed = opts?.autoSeedActive !== false;
  const verify = opts?.verify === true;
  const force = opts?.force === true;

  // [Stale-While-Revalidate] — force:false returns instantly from ANY cached layer
  if (!force && !verify && sessionsQuickCache && sessionsQuickCache.length > 0) {
    return sessionsQuickCache;
  }

  if (
    !force &&
    sessionsMemCache &&
    sessionsMemCache.verify === verify &&
    Date.now() - sessionsMemCache.at < SESSIONS_MEM_TTL_MS
  ) {
    return sessionsMemCache.list;
  }

  // Fetch native session inventory and credentials in parallel
  const [raw] = await Promise.all([
    tgListSessions(),
    bootstrapSecureCredentials(),
  ]);
  const { apiId, apiHash } = await getApiCredentials();

  let all: SessionOption[] = raw
    .map((s: any) => {
      const sessName = String(s?.name || '').trim();
      return {
        name: sessName,
        label: getSessionDisplayName(sessName),
        status: String(s?.status || 'checking'),
        source: s?.source ? String(s.source) : undefined,
      };
    })
    .filter((s: any) => s.name);

  if (verify && apiId && apiHash) {
    const checked = await Promise.all(
      all.map(async (session) => {
        const start = performance.now();
        const result = await tgAuthStatus({
          session: session.name,
          apiId: Number(apiId),
          apiHash,
        });
        const latencyMs = Math.max(1, Math.round(performance.now() - start));
        const isConn = !!(result?.ok && result.data?.authorized);
        if (isConn && result?.data?.user) {
          const u = result.data.user;
          const uFullName = u.firstName || undefined;
          saveSessionMetadata(session.name, {
            userFullName: uFullName,
            username: u.username || undefined,
            photoBase64: u.photoBase64 || undefined,
            telegramUserId: u.id ? String(u.id) : undefined,
            isPremium: Boolean(u.isPremium),
          });
        }
        return {
          ...session,
          label: getSessionDisplayName(session.name),
          status: isConn ? 'connected' : 'expired',
          latencyMs: isConn ? latencyMs : undefined,
        };
      })
    );
    all = checked;
  }

  const usable = dedupeSessionOptionsByIdentity(all.filter((s: any) => isUsableStatus(s.status)));
  let targets = readActiveTargets();

  // Trigger non-blocking background hydration for any sessions missing user display name metadata
  void hydrateSessionMetadataInBackground(usable.map((s: any) => s.name));

  // No Active Target toggled yet → seed all usable (multi-account switch ready)
  if (!targets.length && usable.length && autoSeed) {
    targets = usable.map((s: any) => s.name).slice(0, MAX_ACTIVE_SESSIONS);
    setActiveSessionTargets(targets);
  }

  const preferred = usable.filter((s: any) => targets.includes(s.name));
  const nonPreferred = usable.filter((s: any) => !targets.includes(s.name));
  // Place preferred active session first, then remaining usable sessions
  const result = preferred.length ? [...preferred, ...nonPreferred] : usable;
  sessionsMemCache = { at: Date.now(), verify, list: result };
  // Always update quick cache so the next force:false call paints instantly
  sessionsQuickCache = result;
  return result;
}

const hydratingSessions = new Set<string>();

export async function hydrateSessionMetadataInBackground(sessionNames: string[]): Promise<void> {
  const missing = sessionNames.filter((name) => {
    if (!name || hydratingSessions.has(name)) return false;
    const meta = getSessionMetadata(name);
    return !meta || !meta.userFullName;
  });

  if (!missing.length) return;

  const { apiId, apiHash } = await getApiCredentials();
  if (!apiId || !apiHash) return;

  for (const sessionName of missing) {
    hydratingSessions.add(sessionName);
    try {
      const result = await tgAuthStatus({
        session: sessionName,
        apiId: Number(apiId),
        apiHash,
      });
      if (result?.ok && result.data?.user) {
        const u = result.data.user;
        const uFullName = u.firstName || undefined;
        saveSessionMetadata(sessionName, {
          userFullName: uFullName,
          username: u.username || undefined,
          photoBase64: u.photoBase64 || undefined,
          telegramUserId: u.id ? String(u.id) : undefined,
          isPremium: Boolean(u.isPremium),
        });
      }
    } catch {
      /* ignore */
    } finally {
      hydratingSessions.delete(sessionName);
    }
    // Rate-control delay between background session checks
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Invalidate list-sessions memory cache (after add/remove account). */
export function invalidateSessionListCache(): void {
  sessionsMemCache = null;
}

/** Names only (Media Studio select). */
export async function loadSelectableSessionNames(opts?: {
  force?: boolean;
}): Promise<string[]> {
  const list = await loadSelectableSessions(opts);
  return list.map((s: any) => s.name);
}

/**
 * Detect and delete unauthenticated / orphaned session files locally.
 * Preserves all active sessions marked in ACTIVE_SESSIONS target list.
 */
export async function purgeOrphanedSessions(): Promise<{
  purgedCount: number;
  purgedNames: string[];
}> {
  const { invoke } = await import('@tauri-apps/api/core');
  const rawSessions = await tgListSessions().catch(() => []);
  const activeTargets = readActiveTargets();
  const { apiId, apiHash } = await getApiCredentials();

  const purgedNames: string[] = [];

  for (const s of rawSessions) {
    const name = String(s?.name || '').trim();
    if (!name) continue;

    // Never purge sessions marked as active targets
    if (activeTargets.includes(name)) continue;

    const meta = getSessionMetadata(name);
    let isAuthorized = false;

    if (apiId && apiHash) {
      try {
        const res = await tgAuthStatus({
          session: name,
          apiId: Number(apiId),
          apiHash,
        });
        isAuthorized = !!(res?.ok && res.data?.authorized);
      } catch {
        isAuthorized = false;
      }
    }

    // Orphaned session: not authorized AND missing valid Telegram User ID
    if (!isAuthorized && (!meta || !meta.telegramUserId)) {
      try {
        await invoke('delete_session_rust', { session: name });
        deleteSessionLocalData(name, true);
        purgedNames.push(name);
      } catch (err) {
        console.warn(`Failed to purge orphaned session ${name}:`, err);
      }
    }
  }

  invalidateSessionListCache();
  notifySessionMetadataChanged();

  return {
    purgedCount: purgedNames.length,
    purgedNames,
  };
}
