/**
 * AutoGram Drive worker bridge — Telethon via daemon.py --action drive
 * Serialized queue + lock retry to avoid SQLite "database is locked" on .session
 */
import { runDaemonOnce, spawnDaemonJob, killWorkerJob, parseEventLine, type JobChild } from './jobProcess';
import {
  driveSessionCallFor,
  ensureDriveSession,
  isDriveSessionReady,
  isDriveSessionReadyFor,
  stopDriveSession,
} from './driveSession';

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

async function ensureWarmDriveSession(creds: DriveCredentials): Promise<boolean> {
  if (isTransferJobActive()) return false;
  if (isDriveSessionReadyFor(creds)) return true;
  return ensureDriveSession(creds);
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
    return withExclusiveSession(creds, async () => {
      let last: unknown;
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          return await runDriveOnce(creds, extra);
        } catch (e) {
          last = e;
          if (isSessionLockError(e) && attempt < retries - 1) {
            await sleep(350 + attempt * 250);
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
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'scan_folders');
  }
  return runDrive(creds, ['--drive-action', 'scan-folders']);
}

/** Warm-session bootstrap (or one-shot fallback). */
export async function driveBootstrap(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: { filePageSize?: number; chatPageSize?: number; topicId?: number | null }
) {
  const filePage = opts?.filePageSize ?? DEFAULT_FILE_PAGE;
  const chatPage = opts?.chatPageSize ?? DEFAULT_CHAT_PAGE;
  const topicId = opts?.topicId ?? null;
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'bootstrap', {
      folder_id: folderId,
      file_page_size: filePage,
      chat_page_size: chatPage,
      topic_id: topicId,
    });
  }
  const options: Record<string, unknown> = { chat_page_size: chatPage };
  if (topicId != null) options.topic_id = topicId;
  return runDrive(creds, [
    '--drive-action',
    'bootstrap',
    '--page-size',
    String(filePage),
    ...folderArg(folderId),
    '--options-json',
    JSON.stringify(options),
  ]);
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

  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'list_chats', params);
  }
  return runDrive(creds, [
    '--drive-action',
    'list-chats',
    '--page-size',
    String(limit),
    '--chat-offset',
    String(offset),
    '--options-json',
    JSON.stringify({
      offset_id: cursor?.offset_id ?? 0,
      offset_date: cursor?.offset_date ?? null,
      offset_peer_id: cursor?.offset_peer_id ?? null,
      chat_folder_id: opts?.chatFolderId ?? null,
    }),
  ]);
}

export async function driveListChatFolders(
  creds: DriveCredentials,
  opts?: { force?: boolean }
) {
  const params = { force: !!opts?.force };
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'list_chat_folders', params);
  }
  return runDrive(creds, [
    '--drive-action',
    'list-chat-folders',
    '--options-json',
    JSON.stringify(params),
  ]);
}

/** Batch thumbnails via warm session when available. */
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
    (quality === 'saver' ? 14 : quality === 'sharp' ? 8 : 12);
  const ids = messageIds.slice(0, batch);
  // CRITICAL: never one-shot spawn Python for thumbs during load — that freezes
  // WebView ("Not Responding") and can force-close the desktop app on low-end PCs.
  if (!(await ensureWarmDriveSession(creds))) {
    return { status: 'success', thumbs: {} as Record<string, string | null>, deferred: true };
  }
  return driveSessionCallFor(
    creds,
    'thumbnails',
    {
      folder_id: folderId,
      message_ids: ids,
      quality,
      batch_size: batch,
    },
    // Keep short so UI never blocks behind a hung thumb RPC
    45000
  );
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
  // Same rule as thumbs: no one-shot spawn during warm-up (force-close risk)
  if (!(await ensureWarmDriveSession(creds))) {
    return { status: 'success', avatars: {} as Record<string, string | null>, deferred: true };
  }
  return driveSessionCallFor(creds, 'avatars', { peer_ids: ids }, 30000);
}

export type DriveDeleteFolderOpts = {
  cascade?: boolean;
  detachChildren?: boolean;
};

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
  const cascade = !!opts?.cascade;
  const detachChildren = !!opts?.detachChildren;
  if (cascade && detachChildren) {
    throw new Error('Pilih cascade atau lepas anak, bukan keduanya.');
  }
  const payload = {
    folder_id: fid,
    cascade,
    detach_children: detachChildren,
  };

  await ensureDriveSession(creds);
  if (isDriveSessionReadyFor(creds)) {
    try {
      return await driveSessionCallFor(creds, 'delete_folder', payload, 180000);
    } catch (e) {
      if (isTelegramDisconnectError(e)) {
        try {
          const { stopDriveSession } = await import('./driveSession');
          await stopDriveSession();
        } catch {
          /* ignore */
        }
        await ensureDriveSession(creds);
        if (isDriveSessionReadyFor(creds)) {
          return driveSessionCallFor(creds, 'delete_folder', payload, 180000);
        }
      } else {
        throw e;
      }
    }
  }
  return runDrive(creds, [
    '--drive-action',
    'delete-folder',
    ...folderArg(fid),
    '--options-json',
    JSON.stringify({ cascade, detach_children: detachChildren }),
  ]);
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
  const payload = { folder_id: fid, name: clean };

  await ensureDriveSession(creds);
  if (isDriveSessionReadyFor(creds)) {
    try {
      return await driveSessionCallFor(creds, 'rename_folder', payload, 120000);
    } catch (e) {
      if (isTelegramDisconnectError(e)) {
        try {
          const { stopDriveSession } = await import('./driveSession');
          await stopDriveSession();
        } catch {
          /* ignore */
        }
        await ensureDriveSession(creds);
        if (isDriveSessionReadyFor(creds)) {
          return driveSessionCallFor(creds, 'rename_folder', payload, 120000);
        }
      } else {
        throw e;
      }
    }
  }
  return runDrive(creds, [
    '--drive-action',
    'rename-folder',
    ...folderArg(fid),
    '--drive-name',
    clean,
  ]);
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
  const payload = { folder_id: fid, parent_id: pid };

  await ensureDriveSession(creds);
  if (isDriveSessionReadyFor(creds)) {
    try {
      return await driveSessionCallFor(creds, 'set_folder_parent', payload, 120000);
    } catch (e) {
      if (isTelegramDisconnectError(e)) {
        try {
          const { stopDriveSession } = await import('./driveSession');
          await stopDriveSession();
        } catch {
          /* ignore */
        }
        await ensureDriveSession(creds);
        if (isDriveSessionReadyFor(creds)) {
          return driveSessionCallFor(creds, 'set_folder_parent', payload, 120000);
        }
      } else {
        throw e;
      }
    }
  }
  return runDrive(creds, [
    '--drive-action',
    'set-folder-parent',
    ...folderArg(fid),
    '--options-json',
    JSON.stringify({ parent_id: pid }),
  ]);
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
  const payload = { name, parent_id: parentId };

  await ensureDriveSession(creds);
  if (isDriveSessionReadyFor(creds)) {
    try {
      return await driveSessionCallFor(creds, 'create_folder', payload, 120000);
    } catch (e) {
      // Warm session dead or create failed after disconnect — bounce once
      if (isTelegramDisconnectError(e)) {
        try {
          const { stopDriveSession } = await import('./driveSession');
          await stopDriveSession();
        } catch {
          /* ignore */
        }
        await ensureDriveSession(creds);
        if (isDriveSessionReadyFor(creds)) {
          return driveSessionCallFor(creds, 'create_folder', payload, 120000);
        }
      } else {
        throw e;
      }
    }
  }
  const extra = ['--drive-action', 'create-folder', '--drive-name', name];
  if (parentId != null) {
    extra.push('--options-json', JSON.stringify({ parent_id: parentId }));
  }
  return runDrive(creds, extra);
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
  }
) {
  const pageSize = opts?.pageSize ?? DEFAULT_FILE_PAGE;
  const topicId = opts?.topicId ?? null;
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'list_files', {
      folder_id: folderId,
      page_size: pageSize,
      offset_id: opts?.offsetId ?? null,
      topic_id: topicId,
      quick_stats: opts?.quickStats ?? true,
    });
  }
  const extra = [
    '--drive-action',
    'list-files',
    ...folderArg(folderId),
    '--page-size',
    String(pageSize),
  ];
  if (opts?.offsetId != null && opts.offsetId > 0) {
    extra.push('--offset-id', String(opts.offsetId));
  }
  // one-shot path: pass topic via options-json
  if (topicId != null) {
    extra.push('--options-json', JSON.stringify({ topic_id: topicId }));
  }
  return runDrive(creds, extra);
}

/**
 * Accurate media count + total bytes for a location (unique message ids).
 * Independent of pagination — walks Telegram media filters (metadata only).
 *
 * - force: re-walk even if cache warm
 * - peek: read progressive/incomplete cache only (never start a walk; for UI poll)
 */
export async function driveMediaStats(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: { topicId?: number | null; force?: boolean; peek?: boolean }
) {
  const topicId = opts?.topicId ?? null;
  const force = !!opts?.force;
  const peek = !!opts?.peek;
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(
      creds,
      'media_stats',
      {
        folder_id: folderId,
        topic_id: topicId,
        force: peek ? false : force,
        peek,
      },
      // Peek is cache-only; walk may take longer on huge libraries
      peek ? 15000 : 180000
    );
  }
  // one-shot path has no progressive poll — skip peek
  if (peek) {
    return { status: 'success', total_count: null, total_bytes: null, incomplete: true, pending: true };
  }
  const extra = [
    '--drive-action',
    'media-stats',
    ...folderArg(folderId),
  ];
  if (topicId != null || force) {
    extra.push(
      '--options-json',
      JSON.stringify({ topic_id: topicId, force })
    );
  }
  return runDrive(creds, extra);
}

export async function driveListTopics(creds: DriveCredentials, chatId: number) {
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'list_topics', { folder_id: chatId });
  }
  return runDrive(creds, [
    '--drive-action',
    'list-topics',
    ...folderArg(chatId),
  ]);
}

export async function driveCreateTopic(creds: DriveCredentials, chatId: number, title: string) {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('Nama topik wajib diisi');
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'create_topic', {
      folder_id: chatId,
      title: clean,
    });
  }
  return runDrive(creds, [
    '--drive-action',
    'create-topic',
    ...folderArg(chatId),
    '--options-json',
    JSON.stringify({ title: clean }),
  ]);
}

export async function driveDeleteTopic(creds: DriveCredentials, chatId: number, topicId: number) {
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'delete_topic', {
      folder_id: chatId,
      topic_id: topicId,
    });
  }
  return runDrive(creds, [
    '--drive-action',
    'delete-topic',
    ...folderArg(chatId),
    '--options-json',
    JSON.stringify({ topic_id: topicId }),
  ]);
}

export async function driveRenameTopic(
  creds: DriveCredentials,
  chatId: number,
  topicId: number,
  name: string
) {
  if (await ensureWarmDriveSession(creds)) {
    return driveSessionCallFor(creds, 'rename_topic', {
      folder_id: chatId,
      topic_id: topicId,
      name,
    });
  }
  return runDrive(creds, [
    '--drive-action',
    'rename-topic',
    ...folderArg(chatId),
    '--options-json',
    JSON.stringify({ topic_id: topicId, title: name }),
  ]);
}

export async function driveThumbnail(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
) {
  if (isDriveSessionReadyFor(creds)) {
    const res = await driveSessionCallFor(creds, 'thumbnails', {
      folder_id: folderId,
      message_ids: [messageId],
    });
    const url = res?.thumbs?.[String(messageId)] ?? null;
    return { status: 'success', data_url: url };
  }
  return runDrive(creds, [
    '--drive-action',
    'thumbnail',
    '--message-id',
    String(messageId),
    ...folderArg(folderId),
  ]);
}

function isTelegramDisconnectError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    msg.includes('while disconnected') ||
    msg.includes('cannot send requests') ||
    msg.includes('koneksi telegram terputus') ||
    msg.includes('not connected') ||
    msg.includes('drive session ended')
  );
}

export async function drivePreview(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  opts?: { quality?: string; skipPoster?: boolean }
) {
  // Progressive stream (play-while-download) needs warm drive-serve:
  // HTTP media server + Telethon download must stay in the same long-lived process.
  // One-shot workers exit after JSON and kill the stream — so always warm first.
  const quality = (opts?.quality || 'auto').trim() || 'auto';
  const skipPoster = opts?.skipPoster !== false; // default true — faster open
  // Lower rungs (p480/p360/p720) may download + ffmpeg — allow longer RPC
  const needsTranscode = /^(p1080|p720|p480|p360|1080|720|480|360)/i.test(quality);
  const timeoutMs = needsTranscode ? 600000 : 120000;

  const payload = {
    folder_id: folderId,
    message_id: messageId,
    quality,
    skip_poster: skipPoster,
  };

  await ensureDriveSession(creds);
  if (isDriveSessionReadyFor(creds)) {
    try {
      return await driveSessionCallFor(creds, 'preview', payload, timeoutMs);
    } catch (e) {
      // Warm client half-open: bounce the whole drive-serve process once, then retry
      if (!isTelegramDisconnectError(e)) throw e;
      try {
        const { stopDriveSession } = await import('./driveSession');
        await stopDriveSession();
      } catch {
        /* ignore */
      }
      await ensureDriveSession(creds);
      if (isDriveSessionReadyFor(creds)) {
        return driveSessionCallFor(creds, 'preview', payload, timeoutMs);
      }
      // fall through to one-shot
    }
  }
  // Last resort (no Tauri / session failed): one-shot full/partial preview
  return runDrive(creds, [
    '--drive-action',
    'preview',
    '--message-id',
    String(messageId),
    ...folderArg(folderId),
    '--options-json',
    JSON.stringify({ quality, skip_poster: skipPoster }),
  ]);
}

/** Prefetch first ~head of a video into stream cache (hover / scroll warm). */
export async function drivePreviewWarm(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  headBytes = 768 * 1024
) {
  if (!isDriveSessionReadyFor(creds)) {
    await ensureDriveSession(creds);
  }
  if (!isDriveSessionReadyFor(creds)) return { status: 'no_session' };
  try {
    return await driveSessionCallFor(
      creds,
      'preview_warm',
      {
        folder_id: folderId,
        message_id: messageId,
        head_bytes: headBytes,
      },
      12000
    );
  } catch {
    return { status: 'error' };
  }
}

export async function driveStreamStatus(creds: DriveCredentials, streamId: string) {
  if (!isDriveSessionReadyFor(creds)) {
    await ensureDriveSession(creds);
  }
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(creds, 'stream_status', { stream_id: streamId }, 15000);
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
  opts?: { stopAll?: boolean; incompleteOnly?: boolean }
) {
  if (!opts?.stopAll && !streamId) return { status: 'missing' };
  try {
    if (!isDriveSessionReadyFor(creds)) {
      await ensureDriveSession(creds);
    }
    if (!isDriveSessionReadyFor(creds)) return { status: 'no_session' };
    return await driveSessionCallFor(
      creds,
      'stop_stream',
      opts?.stopAll
        ? { stop_all: true, incomplete_only: opts.incompleteOnly !== false }
        : { stream_id: streamId, delete_partial: true },
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
  try {
    if (!isDriveSessionReadyFor(creds)) {
      await ensureDriveSession(creds);
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

/** Lightweight ZIP central-directory listing (no full extract). */
export async function driveZipList(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
) {
  await ensureDriveSession(creds);
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(
      creds,
      'zip_list',
      { folder_id: folderId, message_id: messageId },
      180000
    );
  }
  return runDrive(creds, [
    '--drive-action',
    'zip-list',
    '--message-id',
    String(messageId),
    ...folderArg(folderId),
  ]);
}

/** Read/extract a single ZIP entry (downloads full archive once if needed). */
export async function driveZipReadEntry(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  entry: string,
  password?: string
) {
  await ensureDriveSession(creds);
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(
      creds,
      'zip_read',
      { folder_id: folderId, message_id: messageId, entry, password },
      300000
    );
  }
  return runDrive(creds, [
    '--drive-action',
    'zip-read',
    '--message-id',
    String(messageId),
    ...folderArg(folderId),
    '--options-json',
    JSON.stringify({ entry, password }),
  ]);
}

export async function driveDelete(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
) {
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(creds, 'delete', {
      folder_id: folderId,
      message_id: messageId,
    });
  }
  return runDrive(creds, [
    '--drive-action',
    'delete',
    '--message-id',
    String(messageId),
    ...folderArg(folderId),
  ]);
}

/** Bulk delete in one RPC (warm session) or sequential one-shot. */
export async function driveDeleteBatch(
  creds: DriveCredentials,
  messageIds: number[],
  folderId: number | null
) {
  const ids = messageIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return { status: 'success', deleted: [], failed: [] };
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(creds, 'delete_batch', {
      folder_id: folderId,
      message_ids: ids,
    });
  }
  const deleted: number[] = [];
  const failed: { id: number; error: string }[] = [];
  for (const id of ids) {
    try {
      await driveDelete(creds, id, folderId);
      deleted.push(id);
    } catch (e: any) {
      failed.push({ id, error: String(e?.message || e) });
    }
  }
  return { status: failed.length && !deleted.length ? 'error' : 'success', deleted, failed };
}

export async function driveRename(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  newName: string
) {
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(creds, 'rename', {
      folder_id: folderId,
      message_id: messageId,
      name: newName,
    });
  }
  return runDrive(creds, [
    '--drive-action',
    'rename',
    '--message-id',
    String(messageId),
    '--drive-name',
    newName,
    ...folderArg(folderId),
  ]);
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
  const topicId =
    opts?.topicId != null && Number(opts.topicId) > 0 ? Number(opts.topicId) : null;
  if (isDriveSessionReadyFor(creds)) {
    return driveSessionCallFor(
      creds,
      'move',
      {
        folder_id: fromFolderId,
        message_id: messageId,
        to_folder_id: toFolderId === null || toFolderId === undefined ? 'me' : toFolderId,
        topic_id: topicId,
        delete_source: deleteSource,
      },
      300000
    );
  }
  const options: Record<string, unknown> = { delete_source: deleteSource };
  if (topicId) options.topic_id = topicId;
  const extra = [
    '--drive-action',
    'move',
    '--message-id',
    String(messageId),
    ...folderArg(fromFolderId),
    '--options-json',
    JSON.stringify(options),
  ];
  if (toFolderId === null || toFolderId === undefined) {
    extra.push('--to-folder-id', 'me');
  } else {
    extra.push('--to-folder-id', String(toFolderId));
  }
  return runDrive(creds, extra);
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
    try {
      return await spawnDaemonJob({
        jobId: DRIVE_OPEN_JOB_ID,
        args: [
          ...baseArgs(creds),
          '--drive-action',
          'download',
          '--message-id',
          String(messageId),
          '--save-path',
          savePath,
          ...folderArg(folderId),
        ],
        onStdoutLine: handlers.onStdoutLine || (() => undefined),
        onStderrLine: handlers.onStderrLine || (() => undefined),
        onClose: (code) => {
          try {
            handlers.onClose?.(code);
          } finally {
            restartWarm();
          }
        },
        allowShellFallback: false,
      });
    } catch (e) {
      restartWarm();
      throw e;
    }
  });
}

/** True while exclusive transfer job (upload/download-batch) owns DRIVE_JOB_ID. */
let transferJobActive = false;

export function isTransferJobActive(): boolean {
  return transferJobActive;
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
    const hadWarm = isDriveSessionReady();
    if (hadWarm) {
      await stopDriveSession();
      await sleep(250);
    }
    // Best-effort: clear any orphan transfer worker before spawn
    try {
      await killWorkerJob(DRIVE_JOB_ID);
      await sleep(120);
    } catch {
      /* ignore */
    }
    let restarted = false;
    const restartWarm = () => {
      if (opts?.skipRestartWarm) return;
      if (restarted || !hadWarm) return;
      restarted = true;
      void ensureDriveSession(creds).catch(() => undefined);
    };
    transferJobActive = true;
    try {
      return await spawnDaemonJob({
        jobId: DRIVE_JOB_ID,
        args,
        onStdoutLine: handlers.onStdoutLine,
        onStderrLine: handlers.onStderrLine,
        onClose: (code) => {
          transferJobActive = false;
          try {
            handlers.onClose(code);
          } finally {
            restartWarm();
          }
        },
        allowShellFallback: false,
      });
    } catch (e) {
      transferJobActive = false;
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
