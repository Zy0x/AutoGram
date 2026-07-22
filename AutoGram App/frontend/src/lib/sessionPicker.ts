/**
 * Shared session list for Job Editor / Media Studio.
 * Accounts shows all sessions; pickers need selectable names without
 * false-empty when API store is mid-migrate or ACTIVE_SESSIONS is empty.
 */
import { bootstrapSecureCredentials, getApiCredentials } from './secureCredentials';
import { tgAuthStatus, tgListSessions } from './telegramBackend';

export type SessionOption = {
  name: string;
  status: string;
  source?: string;
};

const ACTIVE_KEY = 'ACTIVE_SESSIONS';

function readActiveTargets(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, 1) : [];
  } catch {
    return [];
  }
}

/** Persist Active Target list (same key as Accounts page). */
export function setActiveSessionTargets(names: string[]): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(names.filter(Boolean).slice(0, 1)));
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
    .map((s) => ({
      name: String(s?.name || '').trim(),
      status: String(s?.status || 'checking'),
      source: s?.source ? String(s.source) : undefined,
    }))
    .filter((s) => s.name);

  if (verify && apiId && apiHash) {
    const checked = await Promise.all(
      all.map(async (session) => {
        const result = await tgAuthStatus({
          session: session.name,
          apiId: Number(apiId),
          apiHash,
        });
        return {
          ...session,
          status: result?.ok && result.data?.authorized ? 'connected' : 'expired',
        };
      })
    );
    all = checked;
  }

  const usable = all.filter((s) => isUsableStatus(s.status));
  let targets = readActiveTargets();

  // No Active Target toggled yet → treat all usable as selectable
  if (!targets.length && usable.length && autoSeed) {
    targets = [usable[0].name];
    setActiveSessionTargets(targets);
  }

  const preferred = usable.filter((s) => targets.includes(s.name));
  const nonPreferred = usable.filter((s) => !targets.includes(s.name));
  // Place preferred active session first, then remaining usable sessions
  const result = preferred.length ? [...preferred, ...nonPreferred] : usable;
  sessionsMemCache = { at: Date.now(), verify, list: result };
  return result;
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
  return list.map((s) => s.name);
}
