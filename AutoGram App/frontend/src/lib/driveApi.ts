/**
 * AutoGram Drive worker bridge — Telethon via daemon.py --action drive
 * Serialized queue + lock retry to avoid SQLite "database is locked" on .session
 */
import { runDaemonOnce, spawnDaemonJob, killWorkerJob, parseEventLine, type JobChild } from './jobProcess';
import { invoke } from '@tauri-apps/api/core';
import {
  driveSessionCallFor as rawDriveSessionCallFor,
  ensureDriveSession,
  isDriveSessionReady,
  isDriveSessionReadyFor,
  stopDriveSession,
  isGhostSessionReady,
} from './driveSession';
import { detectTauriRuntime } from './platform';
import { getCheckpoint, getMediaRecords, getFolderMediaCount } from './mediaStudioDb';

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

async function driveSessionCallFor(
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

function sleep(ms: number) {
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

function baseArgs(creds: DriveCredentials): string[] {
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

async function runDriveOnce(creds: DriveCredentials, extra: string[]): Promise<any> {
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
async function withExclusiveSession<T>(
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

/** Serialized + retry on session lock */
async function runDrive(creds: DriveCredentials, extra: string[], retries = 4): Promise<any> {
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

function folderArg(folderId: number | null | undefined): string[] {
  if (folderId === null || folderId === undefined) return [];
  return ['--folder-id', String(folderId)];
}

export async function driveScanFolders(creds: DriveCredentials) {
  if (!detectTauriRuntime()) {
    throw new Error('Drive membutuhkan aplikasi desktop (Rust + Grammers).');
  }
  try {
    const { tgScanFolders } = await import('./telegramBackend');
    const result = await tgScanFolders({
      session: creds.session,
      apiId: Number(creds.apiId) || 0,
      apiHash: creds.apiHash,
    });
    if (result?.ok && result.data?.folders) {
      const folders = result.data.folders.map((f) => ({
        id: Number(f.id),
        name: String(f.name || f.titleRaw || f.id),
        title_raw: String(f.titleRaw || f.name || f.id),
        username: f.username ?? null,
        is_drive_folder: f.isDriveFolder !== false,
        parent_id: f.parentId ?? null,
        is_orphan: !!f.isOrphan,
      }));
      return { status: 'success', folders, backend: 'grammers' };
    }
    // Fallback: dialog title filter without parent= (older native path)
    const { tgListDialogs } = await import('./telegramBackend');
    const dialogs = await tgListDialogs({
      session: creds.session,
      apiId: Number(creds.apiId),
      apiHash: creds.apiHash,
      limit: 500,
    });
    if (dialogs?.ok && Array.isArray(dialogs.data)) {
      const folders = dialogs.data
        .filter((dialog) => /\[TD\]/i.test(String(dialog.title || '')))
        .map((dialog) => ({
          id: Number(dialog.id),
          name: String(dialog.title || dialog.id).replace(/\s*\[TD\]\s*$/i, '').trim(),
          title_raw: String(dialog.title || dialog.id),
          username: null,
          is_drive_folder: true,
          parent_id: null,
        }));
      return { status: 'success', folders, backend: 'grammers' };
    }
    throw new Error(result?.userMessage || result?.error?.message || 'Scan folder Grammers gagal.');
  } catch (e) {
    throw new Error(`Scan folder Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
  }
}

/** Bootstrap first paint — parallel Grammers list chats + list files (no Telethon). */
export async function driveBootstrap(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: { filePageSize?: number; chatPageSize?: number; topicId?: number | null }
) {
  const filePage = opts?.filePageSize ?? DEFAULT_FILE_PAGE;
  const chatPage = opts?.chatPageSize ?? DEFAULT_CHAT_PAGE;
  const topicId = opts?.topicId ?? null;
  await ensureDriveSession(creds);
  const [chatsRes, filesRes, foldersRes] = await Promise.all([
    driveListChats(creds, { limit: chatPage }).catch(() => ({
      status: 'success',
      chats: [],
      has_more: false,
    })),
    driveListFiles(creds, folderId, { pageSize: filePage, topicId }).catch(() => ({
      status: 'success',
      files: [],
      has_more: false,
      next_offset_id: null,
    })),
    driveScanFolders(creds).catch(() => ({ status: 'success', folders: [] })),
  ]);
  return {
    status: 'success',
    chats: (chatsRes as any).chats || [],
    chats_has_more: !!(chatsRes as any).has_more,
    chats_next_offset: (chatsRes as any).next_offset ?? null,
    chats_next_offset_id: (chatsRes as any).next_offset_id ?? null,
    chats_next_offset_date: (chatsRes as any).next_offset_date ?? null,
    chats_next_offset_peer_id: (chatsRes as any).next_offset_peer_id ?? null,
    files: (filesRes as any).files || [],
    files_has_more: !!(filesRes as any).has_more,
    next_offset_id: (filesRes as any).next_offset_id ?? null,
    total_count: (filesRes as any).total_count ?? null,
    total_bytes: (filesRes as any).total_bytes ?? null,
    stats_pending: true,
    folders: (foldersRes as any).folders || [],
    folder_id: folderId,
    topic_id: topicId,
    backend: 'grammers',
  } as any;
}

export type ChatListCursor = {
  offset_id?: number | null;
  offset_date?: string | null;
  offset_peer_id?: number | null;
};

export async function driveListChats(
  creds: DriveCredentials,
  opts?: {
    limit?: number;
    offset?: number;
    cursor?: ChatListCursor | null;
    chatFolderId?: number | null;
  }
) {
  const limit = opts?.limit ?? DEFAULT_CHAT_PAGE;
  const offset = opts?.offset ?? 0;
  const cursor = opts?.cursor || null;
  const params: Record<string, unknown> = { page_size: limit, offset };
  if (cursor?.offset_id) params.offset_id = cursor.offset_id;
  if (cursor?.offset_date) params.offset_date = cursor.offset_date;
  if (cursor?.offset_peer_id) params.offset_peer_id = cursor.offset_peer_id;
  if (opts?.chatFolderId) params.chat_folder_id = opts.chatFolderId;

  // Grammers dual-path: first page only, no chat-folder filter, no Telethon warm hold
  const firstPage =
    offset === 0 &&
    !cursor?.offset_id &&
    !cursor?.offset_date &&
    !cursor?.offset_peer_id &&
    !opts?.chatFolderId;
  if (firstPage && detectTauriRuntime()) {
    try {
      const { tgListDialogs } = await import('./telegramBackend');
      {
        const apiId = Number(creds.apiId) || 0;
        const gr = await tgListDialogs({
          session: creds.session,
          apiId,
          apiHash: creds.apiHash,
          limit,
        });
        if (gr?.ok && Array.isArray(gr.data)) {
          const chats = gr.data.map((d) => mapDialogToChat(d));
          return {
            status: 'success',
            chats,
            has_more: chats.length >= limit,
            next_offset: chats.length,
            next_offset_id: null,
            next_offset_date: null,
            next_offset_peer_id: null,
            backend: 'grammers',
          };
        }
        throw new Error(gr?.userMessage || gr?.error?.message || 'Daftar chat native gagal.');
      }
    } catch (e) {
      throw new Error(`Daftar chat Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
    }
  }

  // Pagination beyond first page: still Grammers (no Telethon).
  try {
    const { tgListDialogs } = await import('./telegramBackend');
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgListDialogs({
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      limit: Math.min(limit + offset, 200),
    });
    if (gr?.ok && Array.isArray(gr.data)) {
      const all = gr.data.map((d) => mapDialogToChat(d));
      const chats = all.slice(offset, offset + limit);
      return {
        status: 'success',
        chats,
        has_more: offset + chats.length < all.length,
        next_offset: offset + chats.length,
        backend: 'grammers',
      };
    }
    throw new Error(gr?.userMessage || gr?.error?.message || 'Daftar chat Grammers gagal.');
  } catch (e) {
    throw new Error(`Daftar chat Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
  }
}

export async function driveListChatFolders(
  creds: DriveCredentials,
  _opts?: { force?: boolean }
) {
  if (detectTauriRuntime()) {
    try {
      const { tgListDialogFilters } = await import('./telegramBackend');
      const result = await tgListDialogFilters({
        session: creds.session,
        apiId: Number(creds.apiId),
        apiHash: creds.apiHash,
      });
      if (result?.ok && Array.isArray(result.data)) {
        return { status: 'success', folders: result.data, backend: 'grammers' };
      }
      throw new Error(result?.userMessage || result?.error?.message || 'Filter chat native gagal.');
    } catch (e) {
      throw new Error(`Folder chat Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
    }
  }
  throw new Error('Folder chat membutuhkan desktop Rust + Grammers.');
}

/** Batch thumbnails — Grammers only (no Telethon fill). */
export async function driveThumbnailsBatch(
  creds: DriveCredentials,
  messageIds: number[],
  folderId: number | null,
  opts?: { quality?: 'saver' | 'balanced' | 'sharp'; batchSize?: number }
) {
  if (!messageIds.length) return { status: 'success', thumbs: {} as Record<string, string | null> };
  const quality = opts?.quality || 'balanced';
  const batch =
    opts?.batchSize ??
    (quality === 'saver' ? 24 : quality === 'sharp' ? 16 : 32);
  // Backend caps at 64; send full requested batch so scroll fill is fewer RPCs.
  const ids = messageIds.slice(0, Math.min(64, batch));

  if (!detectTauriRuntime()) {
    return { status: 'success', thumbs: {} as Record<string, string | null>, deferred: true };
  }
  try {
    const { tgThumbsBatch } = await import('./telegramBackend');
    const chatId = folderId == null ? 'me' : String(folderId);
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgThumbsBatch({
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      messageIds: ids,
      quality,
    });
    if (gr?.ok && gr.data?.thumbs) {
      return {
        status: 'success',
        thumbs: gr.data.thumbs as Record<string, string | null>,
        backend: 'grammers',
      };
    }
    // Session not ready yet — soft defer for scheduler retry
    return { status: 'success', thumbs: {} as Record<string, string | null>, deferred: true };
  } catch (e) {
    console.warn('[driveThumbnailsBatch] Grammers thumbnail failed', e);
    return { status: 'success', thumbs: {} as Record<string, string | null>, deferred: true };
  }
}

/**
 * Batch sidebar profile photos (small JPEG data URLs).
 * peer_id 0 = self (Saved Messages).
 */
export async function driveAvatarsBatch(
  creds: DriveCredentials,
  peerIds: number[],
  opts?: { batchSize?: number }
) {
  if (!peerIds.length) {
    return { status: 'success', avatars: {} as Record<string, string | null> };
  }
  const batch = opts?.batchSize ?? 16;
  const ids = peerIds.slice(0, batch);
  if (!detectTauriRuntime()) {
    return { status: 'success', avatars: {} as Record<string, string | null>, deferred: true };
  }
  try {
    const { tgAvatarsBatch } = await import('./telegramBackend');
    const gr = await tgAvatarsBatch({
      session: creds.session,
      apiId: Number(creds.apiId) || 0,
      apiHash: creds.apiHash,
      peerIds: ids,
    });
    if (gr?.ok && gr.data?.avatars) {
      return {
        status: 'success',
        avatars: gr.data.avatars as Record<string, string | null>,
        backend: 'grammers',
      };
    }
    return { status: 'success', avatars: {} as Record<string, string | null>, deferred: true };
  } catch (e) {
    console.warn('[driveAvatarsBatch] Grammers avatars failed', e);
    return { status: 'success', avatars: {} as Record<string, string | null>, deferred: true };
  }
}

export type DriveDeleteFolderOpts = {
  cascade?: boolean;
  detachChildren?: boolean;
};

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
    const { getApiCredentials } = await import('./secureCredentials');
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
function mapDialogToChat(d: {
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

function mapFolderResult(data: any) {
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

/** Delete a Drive [TD] folder (Telegram private channel). */
export async function driveDeleteFolder(
  creds: DriveCredentials,
  folderId: number,
  opts?: DriveDeleteFolderOpts
) {
  if (isTransferJobActive()) {
    throw new Error('Tidak dapat mengubah folder saat proses transfer aktif.');
  }
  const fid = Number(folderId);
  if (!Number.isFinite(fid)) throw new Error('folder_id required');
  if (opts?.cascade && opts?.detachChildren) {
    throw new Error('Pilih cascade atau lepas anak, bukan keduanya.');
  }
  const id = requireGrammersIdentity(creds);
  const { tgDeleteFolder } = await import('./telegramBackend');
  const gr = await tgDeleteFolder({ ...id, folderId: fid });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Hapus folder Grammers gagal.');
  }
  return { status: 'success', backend: 'grammers' };
}

/** Rename a Drive [TD] folder channel title. */
export async function driveRenameFolder(
  creds: DriveCredentials,
  folderId: number,
  name: string
) {
  if (isTransferJobActive()) {
    throw new Error('Tidak dapat mengubah folder saat proses transfer aktif.');
  }
  const fid = Number(folderId);
  if (!Number.isFinite(fid)) throw new Error('folder_id required');
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Nama folder wajib diisi');
  const id = requireGrammersIdentity(creds);
  const { tgRenameFolder } = await import('./telegramBackend');
  const gr = await tgRenameFolder({ ...id, folderId: fid, name: clean });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Rename folder Grammers gagal.');
  }
  return mapFolderResult(gr.data);
}

/**
 * Reparent a Drive folder (about parent= metadata).
 * parentId null → root.
 */
export async function driveSetFolderParent(
  creds: DriveCredentials,
  folderId: number,
  parentId: number | null
) {
  if (isTransferJobActive()) {
    throw new Error('Tidak dapat mengubah folder saat proses transfer aktif.');
  }
  const fid = Number(folderId);
  if (!Number.isFinite(fid)) throw new Error('folder_id required');
  const pid =
    parentId != null && Number.isFinite(Number(parentId)) ? Number(parentId) : null;
  if (pid != null && pid === fid) {
    throw new Error('Folder tidak bisa menjadi induk dirinya sendiri.');
  }
  const id = requireGrammersIdentity(creds);
  const { tgSetFolderParent } = await import('./telegramBackend');
  const gr = await tgSetFolderParent({ ...id, folderId: fid, parentId: pid });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Reparent folder Grammers gagal.');
  }
  return mapFolderResult(gr.data);
}

/** Create a Drive [TD] folder. Pass parentId to nest under another Drive folder. */
export async function driveCreateFolder(
  creds: DriveCredentials,
  name: string,
  opts?: { parentId?: number | null }
) {
  const parentId =
    opts?.parentId != null && Number.isFinite(Number(opts.parentId))
      ? Number(opts.parentId)
      : null;
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Nama folder wajib diisi');
  const id = requireGrammersIdentity(creds);
  const { tgCreateFolder } = await import('./telegramBackend');
  const gr = await tgCreateFolder({ ...id, name: clean, parentId });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Buat folder Grammers gagal.');
  }
  return mapFolderResult(gr.data);
}

export async function driveListFiles(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: {
    pageSize?: number;
    offsetId?: number | null;
    topicId?: number | null;
    /** Skip aggregate counters on the latency-critical first page. */
    quickStats?: boolean;
    sortMode?: string;
    localOffset?: number;
    bypassCache?: boolean;
  }
) {
  const pageSize = opts?.pageSize ?? DEFAULT_FILE_PAGE;
  const topicId = opts?.topicId ?? null;
  const sortMode = opts?.sortMode ?? 'newest';

  // 1. Try serving from local IndexedDB warm cache (completed indexing)
  const folderKey = folderId || 0;
  const jobId = `index_chat_${folderKey}${topicId ? `_topic_${topicId}` : ''}`;
  const cp = await getCheckpoint(jobId).catch(() => null);

  if (cp && cp.status === 'completed' && !opts?.bypassCache) {
    const localOffset = opts?.localOffset ?? 0;
    try {
      const records = await getMediaRecords(folderKey, sortMode, localOffset, pageSize);
      const totalCount = await getFolderMediaCount(folderKey);
      const hasMore = localOffset + records.length < totalCount;
      const nextOffsetId = records.length > 0 ? records[records.length - 1].id : null;

      return {
        status: 'success',
        folder_id: folderId,
        topic_id: topicId,
        files: records,
        total: records.length,
        page_size: pageSize,
        has_more: hasMore,
        next_offset_id: nextOffsetId,
        total_count: totalCount,
        total_bytes: null,
        stats_accurate: true,
        stats_pending: false,
        cached: true,
      };
    } catch (e) {
      console.warn('[driveListFiles] Local cache query failed, falling back to network:', e);
    }
  }

  // 2. Grammers only (topic/sort client-side gaps handled as newest network page).
  if (!detectTauriRuntime()) {
    throw new Error('Daftar media membutuhkan desktop Rust + Grammers.');
  }
  try {
    const { tgListMedia } = await import('./telegramBackend');
    const chatId = folderId == null ? 'me' : String(folderId);
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgListMedia({
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      limit: pageSize,
      offsetId: opts?.offsetId ?? null,
      topicId: topicId != null && topicId > 0 ? topicId : null,
    });
    if (gr?.ok && gr.data?.files) {
      let files = gr.data.files.map((f) => ({
        id: Number(f.id),
        folder_id: f.folderId ?? folderId,
        name: f.name,
        size: Number(f.size || 0),
        mime_type: f.mimeType ?? null,
        icon_type: f.iconType || 'file',
        created_at: f.createdAt ?? undefined,
        has_thumb: !!f.hasThumb,
        as_document: !!f.asDocument,
        topic_id: topicId,
      }));
      // Client-side sort for non-newest modes (network page is newest-first).
      if (sortMode === 'oldest') {
        files = [...files].reverse();
      } else if (sortMode === 'size_desc') {
        files = [...files].sort((a, b) => b.size - a.size);
      } else if (sortMode === 'size_asc') {
        files = [...files].sort((a, b) => a.size - b.size);
      } else if (sortMode === 'name_desc') {
        files = [...files].sort((a, b) => b.name.localeCompare(a.name));
      } else if (sortMode === 'name_asc') {
        files = [...files].sort((a, b) => a.name.localeCompare(b.name));
      }
      return {
        status: 'success',
        folder_id: folderId,
        topic_id: topicId,
        files,
        total: files.length,
        page_size: pageSize,
        has_more: !!gr.data.hasMore,
        next_offset_id: gr.data.nextOffsetId ?? null,
        total_count: null,
        total_bytes: null,
        stats_accurate: false,
        stats_pending: true,
        cached: false,
        invalid_topic: false,
        backend: 'grammers',
      } as any;
    }
    throw new Error(gr?.userMessage || gr?.error?.message || 'Daftar media native gagal.');
  } catch (e) {
    throw new Error(`Daftar media Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
  }
}

export async function driveIndexFolder(
  _creds: DriveCredentials,
  _folderId: number | null,
  _opts?: { topicId?: number | null; jobId?: string }
) {
  // Index walk was Telethon-only; Grammers list_media + local cache cover browse.
  // Full background index port is Phase 1 remaining work.
  return {
    status: 'success',
    pending: false,
    backend: 'grammers',
    message: 'Index folder Telethon dinonaktifkan — gunakan list media Grammers.',
  };
}

export { addDriveEventListener } from './driveSession';

export async function driveGetFile(
  creds: DriveCredentials,
  folderId: number | null,
  messageId: number
) {
  // Approximate via list_media page around id is expensive; return minimal row from thumbs path.
  const page = await driveListFiles(creds, folderId, { pageSize: 40, offsetId: messageId + 1 });
  const hit = (page?.files || []).find((f: any) => Number(f.id) === Number(messageId));
  if (hit) return { status: 'success', file: hit, backend: 'grammers' };
  return { status: 'success', file: null, backend: 'grammers' };
}

/**
 * Media stats — pending until full Grammers walk is ported.
 * UI already treats stats_pending; avoid spawning Telethon.
 */
export async function driveMediaStats(
  _creds: DriveCredentials,
  folderId: number | null,
  opts?: { topicId?: number | null; force?: boolean; peek?: boolean }
) {
  return {
    status: 'success',
    folder_id: folderId,
    topic_id: opts?.topicId ?? null,
    total_count: null,
    total_bytes: null,
    incomplete: true,
    pending: true,
    stats_pending: true,
    backend: 'grammers',
  };
}

export async function driveListTopics(creds: DriveCredentials, chatId: number) {
  if (!detectTauriRuntime()) {
    throw new Error('Daftar topik membutuhkan desktop Rust + Grammers.');
  }
  try {
    const { tgListTopics } = await import('./telegramBackend');
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgListTopics({
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
    });
    if (gr?.ok && gr.data) {
      const topics = (gr.data.topics || []).map((t) => ({
        id: Number(t.id),
        title: t.title,
        top_message: t.topMessage ?? null,
        closed: !!t.closed,
      }));
      return {
        status: 'success',
        topics,
        is_forum: !!gr.data.isForum,
        cached: !!gr.data.cached,
        backend: 'grammers',
      };
    }
    throw new Error(gr?.userMessage || gr?.error?.message || 'Daftar topik native gagal.');
  } catch (e) {
    throw new Error(`Daftar topik Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
  }
}

export async function driveCreateTopic(creds: DriveCredentials, chatId: number, title: string) {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('Nama topik wajib diisi');
  const id = requireGrammersIdentity(creds);
  const { tgCreateTopic } = await import('./telegramBackend');
  const gr = await tgCreateTopic({ ...id, chatId, title: clean });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Buat topik Grammers gagal.');
  }
  return {
    status: 'success',
    topic_id: gr.data?.topicId ?? null,
    title: gr.data?.title ?? clean,
    backend: 'grammers',
  };
}

export async function driveDeleteTopic(creds: DriveCredentials, chatId: number, topicId: number) {
  const id = requireGrammersIdentity(creds);
  const { tgDeleteTopic } = await import('./telegramBackend');
  const gr = await tgDeleteTopic({ ...id, chatId, topicId });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Hapus topik Grammers gagal.');
  }
  return { status: 'success', topic_id: topicId, backend: 'grammers' };
}

export async function driveRenameTopic(
  creds: DriveCredentials,
  chatId: number,
  topicId: number,
  name: string
) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Nama topik wajib diisi');
  const id = requireGrammersIdentity(creds);
  const { tgRenameTopic } = await import('./telegramBackend');
  const gr = await tgRenameTopic({ ...id, chatId, topicId, title: clean });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Rename topik Grammers gagal.');
  }
  return { status: 'success', topic_id: topicId, title: clean, backend: 'grammers' };
}

export async function driveThumbnail(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
) {
  const res = await driveThumbnailsBatch(creds, [messageId], folderId, { batchSize: 1 });
  const url = res?.thumbs?.[String(messageId)] ?? null;
  return { status: 'success', data_url: url, backend: 'grammers' };
}

function isTelegramDisconnectError(err: unknown): boolean {
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

export async function drivePreview(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  _opts?: { quality?: string; skipPoster?: boolean }
) {
  if (!detectTauriRuntime()) {
    throw new Error('Preview membutuhkan desktop Rust + Grammers.');
  }
  try {
    const { tgPreviewStream } = await import('./telegramBackend');
    const chatId = folderId == null ? 'me' : String(folderId);
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgPreviewStream({
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      messageId,
    });
    if (gr?.ok && gr.data) {
      const d = gr.data;
      return {
        status: 'success',
        stream_url: d.streamUrl || null,
        stream_id: d.streamId || null,
        path: d.path || null,
        mime_type: d.mimeType,
        size: d.size,
        data_url: d.dataUrl ?? null,
        text_content: d.textContent ?? null,
        cached: false,
        preview_kind: d.previewKind || (d.streaming ? 'stream' : 'image'),
        streaming: !!d.streaming,
        too_large: false,
        backend: 'grammers',
        message: d.message,
      };
    }
    throw new Error(gr?.userMessage || gr?.error?.message || 'Preview native tidak tersedia.');
  } catch (e) {
    throw new Error(`Preview Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
  }
}

/** Prefetch first ~head of a video — start progressive stream (Grammers). */
export async function drivePreviewWarm(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  _headBytes = 768 * 1024
) {
  if (!detectTauriRuntime()) return { status: 'no_session' };
  try {
    // Kick progressive without blocking UI long — fire-and-forget style
    void drivePreview(creds, messageId, folderId).catch(() => undefined);
    return { status: 'warming', backend: 'grammers' };
  } catch {
    return { status: 'error' };
  }
}

export async function driveStreamStatus(_creds: DriveCredentials, streamId: string) {
  if (detectTauriRuntime() && streamId) {
    try {
      const { streamStatusLocal } = await import('./rustBackend');
      const st = await streamStatusLocal(streamId);
      if (st) {
        return {
          status: (st as any).status,
          stream_id: (st as any).streamId ?? streamId,
          path: (st as any).path,
          total: (st as any).total,
          downloaded: (st as any).downloaded,
          downloaded_filled: (st as any).downloadedFilled ?? (st as any).downloaded,
          prefix_bytes: (st as any).prefixBytes ?? (st as any).downloaded,
          percent: (st as any).percent,
          done: !!(st as any).done,
          mime_type: (st as any).mimeType,
          stream_ready: !!(st as any).streamReady,
          moov_ready: (st as any).moovReady ?? true,
          seek_capable: !!(st as any).seekCapable,
          paused: !!(st as any).paused,
          error: (st as any).error || null,
          backend: (st as any).backend || 'rust',
        };
      }
    } catch {
      return { status: 'error', error: 'Status stream Rust tidak tersedia', backend: 'rust' };
    }
    return { status: 'missing', stream_id: streamId, backend: 'rust' };
  }
  return { status: 'unknown' };
}

/**
 * Stop progressive preview download (cancel Telegram fill + drop partial).
 * Call when the preview modal closes or navigates away — prevents background
 * bandwidth/disk leak after the user dismisses media.
 */
export async function driveStopStream(
  creds: DriveCredentials,
  streamId: string | null | undefined,
  opts?: { stopAll?: boolean; incompleteOnly?: boolean; deletePartial?: boolean }
) {
  if (!opts?.stopAll && !streamId) return { status: 'missing' };
  // Keep partial files by default so reopen/resume can continue buffer growth.
  // Deleting partial was zeroing progress and left buffer stuck at 0–1%.
  const deletePartial = opts?.deletePartial === true;
  // Grammers progressive cancel (local)
  if (streamId && detectTauriRuntime() && !opts?.stopAll) {
    try {
      const { tgStopStream } = await import('./telegramBackend');
      const ok = await tgStopStream(streamId);
      return { status: ok ? 'stopped' : 'missing', backend: 'grammers' };
    } catch {
      return { status: 'error', backend: 'grammers' };
    }
  }
  try {
    if (!isDriveSessionReadyFor(creds)) {
      await ensureDriveSession(creds, true);
    }
    if (!isDriveSessionReadyFor(creds)) return { status: 'no_session' };
    return await driveSessionCallFor(
      creds,
      'stop_stream',
      opts?.stopAll
        ? {
            stop_all: true,
            incomplete_only: opts.incompleteOnly !== false,
            delete_partial: deletePartial,
          }
        : { stream_id: streamId, delete_partial: deletePartial },
      15000
    );
  } catch {
    return { status: 'error' };
  }
}

/**
 * YouTube-like seek: tell the worker to pull Telegram bytes at an offset
 * (not only sequential from 0). Pass time_s + duration_s or absolute offset.
 */
export async function driveStreamSeek(
  creds: DriveCredentials,
  streamId: string,
  opts: { time_s?: number; duration_s?: number; offset?: number }
) {
  if (!streamId) return { status: 'missing' };
  if (detectTauriRuntime()) {
    try {
      const { tgSeekStream } = await import('./telegramBackend');
      const target = await tgSeekStream(streamId, {
        timeS: opts.time_s,
        durationS: opts.duration_s,
        offset: opts.offset,
      });
      if (target != null) {
        return { status: 'queued', offset: target, backend: 'grammers' };
      }
      return { status: 'missing', backend: 'grammers' };
    } catch {
      return { status: 'error', backend: 'grammers' };
    }
  }
  try {
    if (!isDriveSessionReadyFor(creds)) {
      await ensureDriveSession(creds, true);
    }
    if (!isDriveSessionReadyFor(creds)) return { status: 'no_session' };
    return await driveSessionCallFor(
      creds,
      'stream_seek',
      {
        stream_id: streamId,
        time_s: opts.time_s,
        duration_s: opts.duration_s,
        offset: opts.offset,
      },
      20000
    );
  } catch {
    return { status: 'error' };
  }
}

const zipPathCache = new Map<string, string>();

async function ensureZipLocalPath(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
): Promise<string> {
  const cacheKey = `${folderId ?? 'root'}:${messageId}`;
  const existing = zipPathCache.get(cacheKey);
  if (existing) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const safe = await invoke<boolean>('path_policy_check', { path: existing });
      if (safe) return existing;
      zipPathCache.delete(cacheKey);
    } catch {
      zipPathCache.delete(cacheKey);
    }
  }

  const { tgPreviewStream } = await import('./telegramBackend');
  const id = await resolveGrammersIdentity(creds);
  const chatId = folderId == null ? 'me' : String(folderId);

  const gr = await tgPreviewStream({
    session: id.session,
    apiId: id.apiId,
    apiHash: id.apiHash,
    chatId,
    messageId,
  });

  if (gr?.ok && gr.data?.path) {
    zipPathCache.set(cacheKey, gr.data.path);
    return gr.data.path;
  }

  if (gr?.ok && gr.data?.message && gr.data.message.includes('File besar')) {
    throw new Error('Berkas ZIP terlalu besar (> 500 MB) untuk dipratinjau langsung. Silakan gunakan opsi Unduh.');
  }

  throw new Error(
    gr?.userMessage || gr?.error?.message || gr?.data?.message || 'Gagal mengunduh berkas ZIP dari Telegram (Grammers)'
  );
}

/** Lightweight ZIP listing via Grammers MTProto & Rust native zip_local engine. */
export async function driveZipList(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
): Promise<any> {
  if (!detectTauriRuntime()) {
    throw new Error('ZIP browser membutuhkan desktop Rust + Grammers.');
  }
  try {
    const localPath = await ensureZipLocalPath(creds, messageId, folderId);
    const { zipListLocal } = await import('./rustBackend');
    const res = await zipListLocal(localPath);
    return {
      status: 'success',
      entries: (res?.entries || []).map((e: any) => ({
        name: e.name,
        size: Number(e.size || 0),
        compressed_size: Number(e.compressedSize || 0),
        is_dir: !!e.isDir,
        method: e.method || 0,
      })),
      archive_size: res?.archiveSize,
      total_uncompressed: res?.totalUncompressed,
      source: 'central_dir',
      truncated: !!res?.truncated,
      backend: 'grammers',
    };
  } catch (e: any) {
    const rawMsg = String(e?.message || e || 'Gagal membaca arsip ZIP');
    let friendly = rawMsg;
    if (rawMsg.includes('Could not find EOCD') || rawMsg.includes('EOCD missing')) {
      friendly = 'Arsip ZIP tidak valid atau unduhan berkas belum selesai (penanda EOCD tidak ditemukan). Coba unduh ulang berkas.';
    } else if (rawMsg.includes('Password required') || rawMsg.includes('bad_password')) {
      friendly = 'Arsip ZIP dienkripsi dengan password.';
    }
    return {
      status: 'error',
      error: friendly,
      message: friendly,
      entries: [],
      backend: 'grammers',
    };
  }
}

/** Read ZIP entry via Grammers MTProto & Rust native zip_local engine. */
export async function driveZipReadEntry(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  entry: string,
  password?: string
): Promise<any> {
  if (!detectTauriRuntime()) {
    throw new Error('ZIP browser membutuhkan desktop Rust + Grammers.');
  }
  try {
    const localPath = await ensureZipLocalPath(creds, messageId, folderId);
    const { zipPreviewEntry } = await import('./rustBackend');
    const res = await zipPreviewEntry(localPath, entry, password);

    if (res?.encrypted) {
      return {
        status: 'encrypted',
        message: 'File ZIP dienkripsi. Masukkan password.',
        backend: 'grammers',
      };
    }

    let kind = 'meta';
    if (res?.dataUrl) {
      const mime = (res.mimeType || '').toLowerCase();
      if (mime.startsWith('video/')) {
        kind = 'video';
      } else if (mime.startsWith('audio/')) {
        kind = 'audio';
      } else {
        kind = 'image';
      }
    } else if (res?.textContent != null) {
      kind = 'text';
    } else if (res?.isBinary) {
      kind = 'binary';
    }

    return {
      status: 'success',
      kind,
      text: res?.textContent,
      data_url: res?.dataUrl,
      mime: res?.mimeType,
      size: res?.size,
      backend: 'grammers',
    };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Gagal membaca entri ZIP');
    if (msg.includes('bad_password') || msg.includes('Password') || msg.includes('decryption failed')) {
      return {
        status: 'bad_password',
        message: 'Password salah atau enkripsi tidak didukung.',
        backend: 'grammers',
      };
    }
    return {
      status: 'error',
      error: msg,
      message: msg,
      backend: 'grammers',
    };
  }
}

/** Extract single ZIP entry directly to destination path on disk via Grammers & Rust. */
export async function driveZipExtractEntry(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  entryName: string,
  destPath: string,
  password?: string
): Promise<{ status: string; bytesWritten: number }> {
  if (!detectTauriRuntime()) {
    throw new Error('ZIP extraction membutuhkan desktop Rust + Grammers.');
  }
  const localPath = await ensureZipLocalPath(creds, messageId, folderId);
  const { zipExtractEntry } = await import('./rustBackend');
  const bytesWritten = await zipExtractEntry(localPath, entryName, destPath, password);
  return { status: 'success', bytesWritten };
}

export async function driveDelete(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
) {
  const id = await resolveGrammersIdentity(creds);
  const { tgDeleteMessages } = await import('./telegramBackend');
  const chatId = folderId == null ? 'me' : String(folderId);
  const gr = await tgDeleteMessages({
    ...id,
    chatId,
    messageIds: [messageId],
  });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Hapus media Grammers gagal.');
  }
  return { status: 'success', deleted: gr.data?.deleted ?? 1, backend: 'grammers' };
}

/** Bulk delete via Grammers. Supports array of IDs or { id, folderId } items. */
export async function driveDeleteBatch(
  creds: DriveCredentials,
  messageIds: Array<number | { id: number; folderId?: number | null }>,
  defaultFolderId: number | null
) {
  const items = (messageIds || [])
    .map((item) => {
      if (typeof item === 'number') {
        return { id: Number(item), folderId: defaultFolderId };
      }
      return { id: Number((item as any)?.id), folderId: (item as any)?.folderId ?? defaultFolderId };
    })
    .filter((x) => Number.isFinite(x.id) && x.id > 0);

  if (!items.length) return { status: 'success', deleted: [], failed: [] };

  // Group items by target chatId
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const chatId = item.folderId == null ? 'me' : String(item.folderId);
    const existing = grouped.get(chatId) || [];
    existing.push(item.id);
    grouped.set(chatId, existing);
  }

  const id = await resolveGrammersIdentity(creds);
  const { tgDeleteMessages } = await import('./telegramBackend');

  const allDeleted: number[] = [];
  const allFailed: Array<{ id: number; error: string }> = [];

  for (const [chatId, ids] of grouped.entries()) {
    try {
      const gr = await tgDeleteMessages({ ...id, chatId, messageIds: ids });
      if (gr?.ok && gr.data) {
        if (Array.isArray(gr.data.deletedIds)) {
          allDeleted.push(...gr.data.deletedIds);
        } else if (gr.data.deleted > 0) {
          allDeleted.push(...ids);
        }
        if (Array.isArray(gr.data.failed)) {
          allFailed.push(...gr.data.failed);
        }
      } else {
        const errStr =
          gr?.userMessage ||
          gr?.error?.message ||
          (gr as any)?.message ||
          'Penghapusan gagal — Periksa izin admin / status keanggotaan akun pada channel Telegram';
        for (const mid of ids) {
          allFailed.push({ id: mid, error: errStr });
        }
      }
    } catch (e: any) {
      const errStr = String(e?.message || e);
      for (const mid of ids) {
        allFailed.push({ id: mid, error: errStr });
      }
    }
  }

  return {
    status: allFailed.length === 0 ? 'success' : allDeleted.length > 0 ? 'partial' : 'error',
    deleted: allDeleted,
    failed: allFailed,
    backend: 'grammers',
  };
}

export async function driveRename(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  newName: string
) {
  // MVP: re-upload under new name is heavy; use caption edit path via download+upload
  // is not ideal. Surface a soft copy-forward with new caption where possible.
  const clean = String(newName || '').trim();
  if (!clean) throw new Error('Nama baru wajib diisi');
  const id = await resolveGrammersIdentity(creds);
  // Best-effort: move to same chat deletes source after re-forward is wrong.
  // Keep explicit until EditDocumentAttributes is ported.
  void id;
  void messageId;
  void folderId;
  throw new Error(
    `Rename "${clean}" belum didukung penuh di Grammers (Telegram tidak mengizinkan ganti nama dokumen tanpa re-upload). Unduh lalu unggah ulang dengan nama baru.`
  );
}

export type DriveMoveOpts = {
  /** Forum topic destination (reply_to top message). null/omit = chat root / General. */
  topicId?: number | null;
  /**
   * true (default): delete source after successful deliver (move).
   * false: keep source (forward/copy only).
   */
  deleteSource?: boolean;
};

export async function driveMove(
  creds: DriveCredentials,
  messageId: number,
  fromFolderId: number | null,
  toFolderId: number | null,
  opts?: DriveMoveOpts
) {
  const deleteSource = opts?.deleteSource !== false;
  const id = await resolveGrammersIdentity(creds);
  const { tgMoveMessages } = await import('./telegramBackend');
  const sourceChat = fromFolderId == null ? 'me' : String(fromFolderId);
  const destChat =
    toFolderId === null || toFolderId === undefined ? 'me' : String(toFolderId);
  const gr = await tgMoveMessages({
    ...id,
    sourceChat,
    destChat,
    messageIds: [messageId],
    deleteSource,
  });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Pindah media Grammers gagal.');
  }
  return {
    status: 'success',
    moved: gr.data?.moved ?? 0,
    backend: 'grammers',
  };
}

export async function driveDownload(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  savePath: string
) {
  return runDrive(creds, [
    '--drive-action',
    'download',
    '--message-id',
    String(messageId),
    '--save-path',
    savePath,
    ...folderArg(folderId),
  ]);
}

/**
 * Open/preview download on a dedicated job id so cancel does not kill transfers.
 * Stops warm serve only for this exclusive .session use, then restarts.
 */
export async function driveDownloadOpenSpawn(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  savePath: string,
  handlers: {
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
    onClose?: (code: number | null) => void;
  } = {}
): Promise<JobChild> {
  return enqueueDrive(async () => {
    const hadWarm = isDriveSessionReady();
    if (hadWarm) {
      await stopDriveSession();
      await sleep(200);
    }
    try {
      await killWorkerJob(DRIVE_OPEN_JOB_ID);
    } catch {
      /* ignore */
    }
    let restarted = false;
    const restartWarm = () => {
      if (restarted || !hadWarm) return;
      restarted = true;
      void ensureDriveSession(creds).catch(() => undefined);
    };

    // Grammers-only download (no Telethon daemon).
    if (detectTauriRuntime()) {
      try {
        const { tgDownloadFile } = await import('./telegramBackend');
        const chatId = folderId == null ? 'me' : String(folderId);
        const apiId = Number(creds.apiId) || 0;
        const gr = await tgDownloadFile({
          session: creds.session,
          apiId,
          apiHash: creds.apiHash,
          chatId,
          messageId,
          destPath: savePath,
        });
        if (gr?.ok && gr.data?.path) {
          handlers.onStdoutLine?.(
            `[JSON_OUTPUT]${JSON.stringify({ status: 'success', path: gr.data.path, backend: 'grammers' })}`
          );
          try {
            handlers.onClose?.(0);
          } finally {
            restartWarm();
          }
          return { jobId: DRIVE_OPEN_JOB_ID, dispose: () => undefined };
        }
        throw new Error(gr?.userMessage || gr?.error?.message || 'Download Grammers gagal');
      } catch (e) {
        restartWarm();
        throw e;
      }
    }
    restartWarm();
    throw new Error('Download membutuhkan desktop Rust + Grammers.');
  });
}

/** True while exclusive transfer job (upload/download-batch) owns DRIVE_JOB_ID. */
let transferJobActive = false;
let activeTransferLease: { sessionKeyHash: string; transferId: string } | null = null;
let leaseProbeCache: { key: string; active: boolean; at: number } | null = null;
let transferChainNeedsWarmRestart = false;

/** Non-secret deterministic key used only for the in-process/Rust lease map. */
export function driveSessionLeaseKey(creds: DriveCredentials): string {
  const input = `${creds.session}|${creds.apiId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function isSessionTransferLeased(creds: DriveCredentials): Promise<boolean> {
  if (isGhostSessionReady(creds)) {
    return false;
  }
  if (transferJobActive) return true;
  const key = driveSessionLeaseKey(creds);
  if (activeTransferLease?.sessionKeyHash === key) return true;
  const now = Date.now();
  if (leaseProbeCache?.key === key && now - leaseProbeCache.at < 500) {
    return leaseProbeCache.active;
  }
  if (!detectTauriRuntime()) return false;
  try {
    const lease = await invoke<unknown>('get_worker_session_lease', { sessionKeyHash: key });
    const active = !!lease;
    leaseProbeCache = { key, active, at: now };
    return active;
  } catch {
    return false;
  }
}

async function acquireTransferLease(creds: DriveCredentials, transferId: string): Promise<void> {
  const key = driveSessionLeaseKey(creds);
  if (detectTauriRuntime()) {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await invoke('acquire_worker_session_lease', {
          sessionKeyHash: key,
          transferId,
          jobId: DRIVE_JOB_ID,
        });
        last = null;
        break;
      } catch (e) {
        last = e;
        if (attempt < 3) await sleep(120 + attempt * 120);
      }
    }
    if (last) throw last;
  }
  activeTransferLease = { sessionKeyHash: key, transferId };
  leaseProbeCache = { key, active: true, at: Date.now() };
}

async function releaseTransferLease(): Promise<void> {
  const lease = activeTransferLease;
  activeTransferLease = null;
  if (!lease) return;
  try {
    if (detectTauriRuntime()) {
      await invoke('release_worker_session_lease', {
        sessionKeyHash: lease.sessionKeyHash,
        transferId: lease.transferId,
      });
    }
  } catch {
    // Rust also releases leases when the worker process exits.
  } finally {
    leaseProbeCache = { key: lease.sessionKeyHash, active: false, at: Date.now() };
  }
}

export function isTransferJobActive(): boolean {
  return transferJobActive;
}

/**
 * Hold exclusive Telegram session ownership for transfer work (upload/download).
 * Stops warm drive-serve, acquires lease, then runs `fn`. Restarts warm session after.
 * Used by media-studio spawn and Rust studio orchestrator.
 */
export async function withExclusiveTransferSession<T>(
  creds: DriveCredentials,
  transferId: string,
  fn: () => Promise<T>,
  opts?: { skipRestartWarm?: boolean; skipKillWorker?: boolean }
): Promise<T> {
  return enqueueDrive(async () => {
    if (transferJobActive) {
      throw new Error(
        'Transfer lain masih berjalan. Tunggu selesai atau Stop dulu di Transfer Manager.'
      );
    }
    if (!opts?.skipKillWorker) {
      try {
        await killWorkerJob(DRIVE_JOB_ID);
        await sleep(220);
      } catch {
        /* ignore */
      }
    }
    await acquireTransferLease(creds, transferId);
    const hadWarm = isDriveSessionReady();
    transferChainNeedsWarmRestart = transferChainNeedsWarmRestart || hadWarm;
    if (hadWarm) {
      await stopDriveSession();
      await sleep(250);
    }
    let restarted = false;
    const restartWarm = () => {
      if (opts?.skipRestartWarm) return;
      if (restarted || !transferChainNeedsWarmRestart) return;
      restarted = true;
      transferChainNeedsWarmRestart = false;
      setTimeout(() => {
        void ensureDriveSession(creds).catch(() => undefined);
      }, 1200);
    };
    transferJobActive = true;
    try {
      return await fn();
    } finally {
      transferJobActive = false;
      await releaseTransferLease();
      restartWarm();
    }
  });
}

/**
 * Long-running transfer: stop drive-serve first (exclusive .session lock),
 * then spawn worker; restart warm session when job exits.
 * Kill-before-respawn is handled in Rust start_worker_job for same job_id.
 */
async function spawnExclusiveTransfer(
  creds: DriveCredentials,
  args: string[],
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return enqueueDrive(async () => {
    // Soft mutex: refuse second concurrent exclusive transfer (UI also gates).
    if (transferJobActive) {
      throw new Error(
        'Transfer lain masih berjalan. Tunggu selesai atau Stop dulu di Transfer Manager.'
      );
    }
    // Best-effort: clear any orphan transfer worker before spawn
    try {
      await killWorkerJob(DRIVE_JOB_ID);
      await sleep(220);
    } catch {
      /* ignore */
    }
    const transferId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await acquireTransferLease(creds, transferId);
    const hadWarm = isDriveSessionReady();
    transferChainNeedsWarmRestart = transferChainNeedsWarmRestart || hadWarm;
    if (hadWarm) {
      await stopDriveSession();
      await sleep(250);
    }
    let restarted = false;
    const restartWarm = () => {
      if (opts?.skipRestartWarm) return;
      if (restarted || !transferChainNeedsWarmRestart) return;
      restarted = true;
      transferChainNeedsWarmRestart = false;
      setTimeout(() => {
        void ensureDriveSession(creds).catch(() => undefined);
      }, 1200);
    };
    transferJobActive = true;
    try {
      return await spawnDaemonJob({
        jobId: DRIVE_JOB_ID,
        args,
        onStdoutLine: handlers.onStdoutLine,
        onStderrLine: handlers.onStderrLine,
        onClose: (code) => {
          void (async () => {
            transferJobActive = false;
            await releaseTransferLease();
            try {
              handlers.onClose(code);
            } finally {
              restartWarm();
            }
          })();
        },
        allowShellFallback: false,
      });
    } catch (e) {
      transferJobActive = false;
      await releaseTransferLease();
      restartWarm();
      throw e;
    }
  });
}

/** Long-running jobs also go through queue for start, but stay exclusive via job id */
export async function driveUploadSpawn(
  creds: DriveCredentials,
  folderId: number | null,
  filesJsonPath: string,
  optionsJsonPath: string,
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return spawnExclusiveTransfer(
    creds,
    [
      ...baseArgs(creds),
      '--drive-action',
      'upload',
      ...folderArg(folderId),
      '--files-json',
      filesJsonPath,
      '--options-json',
      optionsJsonPath,
    ],
    handlers,
    opts
  );
}

export async function driveDownloadBatchSpawn(
  creds: DriveCredentials,
  folderId: number | null,
  messageIdsJsonPath: string,
  saveDir: string,
  optionsJsonPath: string,
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return spawnExclusiveTransfer(
    creds,
    [
      ...baseArgs(creds),
      '--drive-action',
      'download-batch',
      ...folderArg(folderId),
      '--save-path',
      saveDir,
      '--message-ids-json',
      messageIdsJsonPath,
      '--options-json',
      optionsJsonPath,
    ],
    handlers,
    opts
  );
}

export async function cancelDriveJob(): Promise<boolean> {
  transferJobActive = false;
  return killWorkerJob(DRIVE_JOB_ID);
}

/** Cancel open/preview download only — never touches transfer job. */
export async function cancelDriveOpenJob(): Promise<boolean> {
  return killWorkerJob(DRIVE_OPEN_JOB_ID);
}

/**
 * Delete incomplete download artifacts (dest + `.part`) after Stop.
 * Merges explicit paths with worker registry of in-progress downloads.
 */
export async function cleanupPartialDownloads(
  paths?: string[]
): Promise<{ deleted: string[]; failed: string[]; count: number }> {
  try {
    const { invoke, isTauri } = await import('@tauri-apps/api/core');
    if (!isTauri()) {
      return { deleted: [], failed: [], count: 0 };
    }
    const res = await invoke<{
      deleted?: string[];
      failed?: string[];
      count?: number;
    }>('cleanup_partial_downloads', {
      paths: paths && paths.length ? paths : null,
    });
    return {
      deleted: res?.deleted || [],
      failed: res?.failed || [],
      count: Number(res?.count || 0),
    };
  } catch (e) {
    console.warn('cleanupPartialDownloads failed', e);
    return { deleted: [], failed: [String(e)], count: 0 };
  }
}

/** Soft-pause flag under worker/temp (worker checks between files). */
const PAUSE_FLAG_NAME = 'drive_pause.txt';

export async function setDriveTransferPaused(paused: boolean): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  if (paused) {
    try {
      await invoke<string>('write_worker_temp_file', {
        filename: PAUSE_FLAG_NAME,
        contents: '1',
      });
    } catch (e) {
      console.warn('setDriveTransferPaused write failed', e);
    }
  } else {
    try {
      // Resolve path then delete — write first to get path if missing is ok
      const path = await invoke<string>('write_worker_temp_file', {
        filename: PAUSE_FLAG_NAME,
        contents: '0',
      });
      await invoke('delete_worker_temp_file', { path });
    } catch {
      /* ignore — flag may already be gone */
    }
  }
}

export async function clearDriveTransferPause(): Promise<void> {
  return setDriveTransferPaused(false);
}

/**
 * Single-file download with live stdout events (progress).
 * Prefer this over run-once `driveDownload` for UI progress.
 */
export async function driveDownloadSpawn(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  savePath: string,
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return spawnExclusiveTransfer(
    creds,
    [
      ...baseArgs(creds),
      '--drive-action',
      'download',
      '--message-id',
      String(messageId),
      '--save-path',
      savePath,
      ...folderArg(folderId),
    ],
    handlers,
    opts
  );
}

export { parseEventLine };

