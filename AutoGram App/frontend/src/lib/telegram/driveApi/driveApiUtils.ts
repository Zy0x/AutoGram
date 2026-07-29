import { runDaemonOnce } from '../../jobProcess';
import { driveSessionCallFor as rawDriveSessionCallFor, ensureDriveSession, isDriveSessionReady, stopDriveSession } from '../../driveSession';
import { detectTauriRuntime } from '../../platform';
import { driveSessionLeaseKey, isSessionTransferLeased } from './driveTransfersApi';

export const DRIVE_JOB_ID = 991002;
/** Open/Preview download — separate from transfer so cancel open never kills upload/download. */
export const DRIVE_OPEN_JOB_ID = 991004;
/** First page — lean for fast first paint (scroll loads more) */
export const DEFAULT_FILE_PAGE = 40;
/** Subsequent pages — larger to reduce "Scroll for more" round-trips */
export const LOAD_MORE_FILE_PAGE = 100;
/** First chat page — lean for Media Studio boot (sidebar scroll loads more) */
export const DEFAULT_CHAT_PAGE = 48;
/** Pages when user scrolls near end of chat list (not auto full-library dump) */
export const CHAT_BULK_PAGE = 100;
/** Soft auto-prefetch after boot: at most one extra page, not entire 10k library */
export const CHAT_SOFT_PREFETCH_MAX = 100;

export type DriveCredentials = {
  session: string;
  apiId: string;
  apiHash: string;
};

export class DriveTransferDeferredError extends Error {
  readonly code = 'DRIVE_TRANSFER_DEFERRED';

  constructor() {
    super('Drive read deferred while Media Studio owns the Telegram session');
    this.name = 'DriveTransferDeferredError';
  }
}

export function isDriveTransferDeferredError(err: unknown): boolean {
  return (
    err instanceof DriveTransferDeferredError ||
    String((err as any)?.code || '') === 'DRIVE_TRANSFER_DEFERRED' ||
    /drive read deferred while media studio/i.test(String((err as any)?.message || err || ''))
  );
}


export async function driveSessionCallFor(
  creds: DriveCredentials,
  cmd: string,
  params: Record<string, any> = {},
  timeoutMs = 120000
): Promise<any> {
  if (await isSessionTransferLeased(creds)) throw new DriveTransferDeferredError();
  return rawDriveSessionCallFor(creds, cmd, params, timeoutMs);
}


/** Pure helper — exported for unit tests */
export function isSessionLockError(err: unknown): boolean {
  const s = String((err as any)?.message || err || '').toLowerCase();
  return (
    s.includes('database is locked') ||
    s.includes('database locked') ||
    s.includes('sqlite_busy') ||
    (s.includes('operationalerror') && s.includes('locked'))
  );
}

export function isPeerEntityError(err: unknown): boolean {
  // Include cause/raw: runDrive wraps with friendlyDriveError() which strips
  // Telethon "PeerChannel" markers — recovery must still detect those.
  const parts = [
    String((err as any)?.message || err || ''),
    String((err as any)?.raw || ''),
    String((err as any)?.cause?.message || (err as any)?.cause || ''),
  ];
  const s = parts.join(' ').toLowerCase();
  return (
    s.includes('could not find the input entity') ||
    s.includes('peerchannel') ||
    s.includes('peeruser') ||
    s.includes('peerchat') ||
    s.includes('no user has') ||
    s.includes('cannot find any entity') ||
    (s.includes('input entity') && s.includes('peer')) ||
    // Indonesian friendly wrap (after friendlyDriveError)
    s.includes('tidak tersedia di akun (session)') ||
    s.includes('sisa lokasi dari session lain') ||
    s.includes('lokasi tidak valid di session')
  );
}

export function friendlyDriveError(err: unknown): string {
  const raw = String((err as any)?.message || err || '');
  if (/media stats superseded by newer location/i.test(raw)) {
    // Normal cancellation when peer/topic changes. It must not become a red
    // banner in the newly selected location.
    return '';
  }
  if (/drive session stopped|drive session ended|drive session not ready|no stdin for job|is drive-serve running/i.test(raw)) {
    // Normal lifecycle cancellation when warm session is stopped for transfer jobs.
    return '';
  }
  if (isDriveTransferDeferredError(err)) return '';
  if (isSessionLockError(err)) {
    return 'Session Telegram sedang dipakai proses lain. Tunggu sebentar lalu Refresh, atau hentikan job migrasi yang jalan.';
  }
  if (isPeerEntityError(err)) {
    return (
      'Chat/folder ini tidak tersedia di akun (session) yang aktif. ' +
      'Biasanya sisa lokasi dari session lain — AutoGram kembali ke Saved Messages. ' +
      'Pilih chat dari daftar session ini.'
    );
  }
  if (/file terlalu besar untuk batas akun telegram/i.test(raw)) {
    return raw; // already humanized by worker UploadLimitExceeded
  }
  return raw || 'Drive operation failed';
}


export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Global serial queue: one Drive worker at a time */
let driveQueue: Promise<unknown> = Promise.resolve();

export function enqueueDrive<T>(fn: () => Promise<T>): Promise<T> {
  const next = driveQueue.then(fn, fn);
  driveQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}


export function baseArgs(creds: DriveCredentials): string[] {
  return [
    '--action',
    'drive',
    '--session',
    creds.session,
    '--api-id',
    String(creds.apiId),
    '--api-hash',
    String(creds.apiHash),
  ];
}

export function parseJsonOutput(stdout: string): any {
  const text = String(stdout || '');
  const marker = '[JSON_OUTPUT]';
  const idx = text.lastIndexOf(marker);
  if (idx < 0) return null;
  const raw = text.slice(idx + marker.length).trim();
  const start = raw.indexOf('{');
  if (start < 0) return null;

  // FAST PATH: try native parsing directly from first { to last }
  // This avoids a manual character-by-character scan which freezes the UI on 10MB+ payloads.
  const end = raw.lastIndexOf('}');
  if (end >= start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      // fallback to slow parser if junk with '}' exists at the end
    }
  }

  // SLOW PATH: character-by-character depth counting
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function runDriveOnce(creds: DriveCredentials, extra: string[]): Promise<any> {
  const res = await runDaemonOnce([...baseArgs(creds), ...extra]);
  const data = parseJsonOutput(res.stdout);
  if (data) {
    if (data.status === 'error' || data.error) {
      throw new Error(data.error || data.message || 'Drive operation failed');
    }
    return data;
  }
  const errText = res.stderr || res.stdout || '';
  if (res.code !== 0 || errText) {
    throw new Error(errText.slice(0, 400) || `Drive exit ${res.code}`);
  }
  throw new Error('No JSON_OUTPUT from drive worker');
}

/**
 * Pause warm drive-serve so a second Python process can open the same .session
 * without SQLite "database is locked". Restarts serve after `fn` settles when
 * the exclusive work is a one-shot; for long jobs, pass restartOnSettle=false
 * and restart in onClose.
 */

export async function withExclusiveSession<T>(
  creds: DriveCredentials,
  fn: () => Promise<T>,
  opts?: { restartAfter?: boolean }
): Promise<T> {
  const restartAfter = opts?.restartAfter !== false;
  const hadWarm = isDriveSessionReady();
  if (hadWarm) {
    await stopDriveSession();
    await sleep(200);
  }
  try {
    return await fn();
  } finally {
    if (restartAfter && hadWarm) {
      void ensureDriveSession(creds).catch(() => undefined);
    }
  }
}


export function isTelegramDisconnectError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    msg.includes('while disconnected') ||
    msg.includes('cannot send requests') ||
    msg.includes('koneksi telegram terputus') ||
    msg.includes('not connected') ||
    msg.includes('drive session ended') ||
    msg.includes('drive session stopped') ||
    msg.includes('drive session not ready')
  );
}


export async function runDrive(creds: DriveCredentials, extra: string[], retries = 4): Promise<any> {
  return enqueueDrive(async () => {
    if (await isSessionTransferLeased(creds)) {
      throw new DriveTransferDeferredError();
    }
    return withExclusiveSession(creds, async () => {
      let last: unknown;
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          return await runDriveOnce(creds, extra);
        } catch (e) {
          last = e;
              // Retry on SQLite lock (already existing behavior)
              if (isSessionLockError(e) && attempt < retries - 1) {
                await sleep(350 + attempt * 250);
                continue;
              }
              // Retry when worker/session disconnected — attempt to re-ensure warm session
              if (isTelegramDisconnectError(e) && attempt < retries - 1) {
                try {
                  await ensureDriveSession(creds);
                } catch {
                  /* ignore */
                }
                await sleep(400 + attempt * 250);
                continue;
              }
          const wrapped = new Error(friendlyDriveError(e) || String((e as any)?.message || e));
          (wrapped as any).raw = String((e as any)?.message || e || '');
          (wrapped as any).cause = e;
          throw wrapped;
        }
      }
      const wrapped = new Error(friendlyDriveError(last) || String(last));
      (wrapped as any).raw = String((last as any)?.message || last || '');
      (wrapped as any).cause = last;
      throw wrapped;
    });
  });
}

export function folderArg(folderId: number | null | undefined): string[] {
  if (folderId === null || folderId === undefined) return [];
  return ['--folder-id', String(folderId)];
}

export function requireGrammersIdentity(creds: DriveCredentials) {
  if (!detectTauriRuntime()) {
    throw new Error('Operasi Drive membutuhkan desktop Rust + Grammers.');
  }
  const session = String(creds?.session || '').trim();
  const apiId = Number(creds?.apiId) || 0;
  const apiHash = String(creds?.apiHash || '').trim();
  if (!session) {
    throw new Error('Sesi Telegram belum dipilih.');
  }
  return {
    session,
    apiId,
    apiHash,
  };
}

export async function resolveGrammersIdentity(creds: DriveCredentials) {
  const base = requireGrammersIdentity(creds);
  if (base.apiId > 0 && base.apiHash) {
    return base;
  }
  try {
    const { getApiCredentials } = await import('../../secureCredentials');
    const secure = await getApiCredentials();
    const apiId = base.apiId > 0 ? base.apiId : (Number(secure?.apiId) || 0);
    const apiHash = base.apiHash || secure?.apiHash || '';
    return {
      session: base.session,
      apiId,
      apiHash,
    };
  } catch {
    return base;
  }
}

/** Map Grammers DialogEntry → DriveChat (preserves is_forum for topics bar). */
export function mapDialogToChat(d: {
  id: number | string;
  title?: string;
  isUser?: boolean;
  isChannel?: boolean;
  isGroup?: boolean;
  isForum?: boolean;
}) {
  const title = String(d.title || d.id);
  const isTd = title.includes('[TD]');
  const type = d.isUser
    ? 'user'
    : d.isChannel
      ? 'channel'
      : d.isGroup
        ? 'group'
        : 'unknown';
  // Unknown forum flag must stay undefined/true-path — never hard-false unless
  // backend said so (false skips topic RPC and leaves Groups without topics).
  const isForum = d.isForum === true ? true : d.isForum === false ? false : type === 'group';
  return {
    id: Number(d.id),
    name: isTd ? title.replace(/\s*\[TD\]\s*$/i, '').trim() || title : title,
    title_raw: title,
    type,
    is_drive_folder: isTd,
    is_forum: isForum,
    username: null as string | null,
  };
}

export function mapFolderResult(data: any) {
  const f = data?.folder;
  if (!f) return { status: 'success', folder: null, backend: 'grammers', warning: data?.warning };
  return {
    status: 'success',
    folder: {
      id: Number(f.id),
      name: String(f.name || ''),
      title_raw: String(f.titleRaw || f.name || ''),
      username: f.username ?? null,
      is_drive_folder: f.isDriveFolder !== false,
      parent_id: f.parentId ?? null,
      is_orphan: !!f.isOrphan,
    },
    warning: data?.warning ?? null,
    backend: 'grammers',
  };
}


export { driveSessionLeaseKey, isSessionTransferLeased };