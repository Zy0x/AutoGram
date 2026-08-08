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

function isUsableStatus(status: string | undefined): boolean {
  const s = String(status || 'active').toLowerCase();
  // Reject only clearly bad states
  if (s === 'expired' || s === 'error' || s === 'revoked') return false;
  return true;
}

/** Short in-memory cache — avoids re-spawning list-sessions on rapid tab reopen */
let sessionsMemCache: { at: number; verify: boolean; list: SessionOption[] } | null = null;
const SESSIONS_MEM_TTL_MS = 45_000;

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
  /** Bypass 45s memory cache (e.g. after add/delete account) */
  force?: boolean;
}): Promise<SessionOption[]> {
  const autoSeed = opts?.autoSeedActive !== false;
  const verify = opts?.verify === true;
  const force = opts?.force === true;

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

  const usable = all.filter((s: any) => isUsableStatus(s.status));
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
    tgAuthStatus({
      session: sessionName,
      apiId: Number(apiId),
      apiHash,
    })
      .then((result) => {
        if (result?.ok && result.data?.user) {
          const u = result.data.user;
          const uFullName = u.firstName || undefined;
          saveSessionMetadata(sessionName, {
            userFullName: uFullName,
            username: u.username || undefined,
            photoBase64: u.photoBase64 || undefined,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        hydratingSessions.delete(sessionName);
      });
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

