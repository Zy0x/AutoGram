import { ensureDriveSession, isDriveSessionReadyFor } from '../core/driveSession';
import { detectTauriRuntime } from '../../tauri/platform';
import {
  DriveCredentials,
  driveSessionCallFor
} from './driveApiUtils';

export async function drivePreview(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  opts?: {
    quality?: string;
    skipPoster?: boolean;
    peerId?: string | null;
    topicId?: number | null;
    locationType?: string;
    accountId?: string;
  }
) {
  if (!detectTauriRuntime()) {
    throw new Error('Preview membutuhkan desktop Rust + Grammers.');
  }
  try {
    const { tgPreviewStream } = await import('../core/telegramBackend');
    const rawPeer = (opts?.peerId || (folderId != null && folderId !== 0 ? String(folderId) : '') || '').trim();
    const locationType = opts?.locationType || (rawPeer === 'me' ? 'saved_messages' : 'group');

    // Guard rule 18:
    if (rawPeer === 'me' && locationType !== 'saved_messages') {
      throw new Error(`INVALID_SELF_PEER_USAGE: peerId 'me' cannot be used for locationType '${locationType}'`);
    }

    const chatId = rawPeer || (locationType === 'saved_messages' ? 'me' : 'me');
    if (!chatId || (chatId === 'me' && locationType !== 'saved_messages' && !rawPeer)) {
      throw new Error(`INVALID_PEER_IDENTITY: Cannot resolve peerId for message ${messageId}. Defaulting to 'me' is strictly forbidden.`);
    }

    const apiId = Number(creds.apiId) || 0;
    const request = {
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      messageId,
      topicId: opts?.topicId ?? null,
      locationType,
      accountId: opts?.accountId || creds.session,
    };
    // WebView can paint the cached grid a few hundred milliseconds before the
    // cold Grammers command bridge is ready. Retry only a missing invoke result;
    // real Telegram/file errors must surface immediately.
    let gr = await tgPreviewStream(request);
    for (let attempt = 0; gr == null && attempt < 3; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
      gr = await tgPreviewStream(request);
    }
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
        source: d.source || 'full',
        is_fallback: d.isFallback || false,
        width: d.width,
        height: d.height,
        byte_size: d.byteSize || d.size,
        full_download_error: d.fullDownloadError,
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
    void drivePreview(creds, messageId, folderId).catch(() => undefined);
    return { status: 'warming', backend: 'grammers' };
  } catch {
    return { status: 'error' };
  }
}

export async function driveStreamStatus(_creds: DriveCredentials, streamId: string) {
  if (detectTauriRuntime() && streamId) {
    try {
      const { streamStatusLocal } = await import('../../tauri/rustBackend');
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
  const deletePartial = opts?.deletePartial === true;
  if (streamId && detectTauriRuntime() && !opts?.stopAll) {
    try {
      const { tgStopStream } = await import('../core/telegramBackend');
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
      const { tgSeekStream } = await import('../core/telegramBackend');
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

export type ZipTargetOpts = {
  peerId?: string | null;
  topicId?: number | null;
  locationType?: string;
  accountId?: string;
};

export function resolveZipChatId(
  folderId: number | null,
  opts?: ZipTargetOpts
): string {
  const rawPeer = (opts?.peerId || (folderId != null && folderId !== 0 ? String(folderId) : '') || '').trim();
  const locType = opts?.locationType || (rawPeer === 'me' ? 'saved_messages' : 'group');
  return rawPeer || (locType === 'saved_messages' ? 'me' : 'me');
}

/** In-memory session cache for extracted ZIP entry previews to prevent duplicate MTProto fetches on re-open */
const zipEntryCacheMap = new Map<string, Map<string, any>>();

export function clearZipEntryCache(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  opts?: ZipTargetOpts
): void {
  const chatId = resolveZipChatId(folderId, opts);
  const archiveKey = `${creds?.session || ''}_${chatId}_${messageId}`;
  zipEntryCacheMap.delete(archiveKey);
}

/** Lightweight Sparse ZIP listing via Grammers MTProto Range Fetch (<0.5s) & Rust native engine. */
export async function driveZipList(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  forceRefresh?: boolean,
  opts?: ZipTargetOpts
): Promise<any> {
  if (!detectTauriRuntime()) {
    throw new Error('ZIP browser membutuhkan desktop Rust + Grammers.');
  }

  if (forceRefresh) {
    clearZipEntryCache(creds, messageId, folderId, opts);
  }

  const chatId = resolveZipChatId(folderId, opts);
  const apiId = Number(creds.apiId) || 0;
  const sparseOpts = {
    session: creds.session,
    apiId,
    apiHash: creds.apiHash,
    chatId,
    messageId,
    forceRefresh: !!forceRefresh,
  };

  try {
    const { zipListSparse } = await import('../../tauri/rustBackend');
    const res = await zipListSparse(sparseOpts);
    return {
      status: 'success',
      entries: (res?.entries || []).map((e: any) => ({
        name: e.name,
        size: Number(e.size || 0),
        compressed_size: Number(e.compressedSize || 0),
        is_dir: !!e.isDir,
        method: e.method || 0,
        encrypted: !!e.encrypted,
      })),
      archive_size: res?.archiveSize,
      total_uncompressed: res?.totalUncompressed,
      source: res?.source || 'central_dir_sparse',
      truncated: !!res?.truncated,
      backend: 'grammers_sparse',
    };
  } catch (sparseErr: any) {
    const rawMsg = String(sparseErr?.message || sparseErr || 'Gagal membaca arsip ZIP secara remote');
    console.warn('[driveZipList] Sparse fetch error:', sparseErr);
    let friendly = rawMsg;
    if (rawMsg.includes('Could not find EOCD') || rawMsg.includes('EOCD missing')) {
      friendly = 'Arsip ZIP tidak valid atau penanda EOCD tidak ditemukan.';
    } else if (rawMsg.includes('Password required') || rawMsg.includes('bad_password')) {
      friendly = 'Arsip ZIP dienkripsi dengan password.';
    }
    return {
      status: 'error',
      error: friendly,
      message: friendly,
      entries: [],
      backend: 'grammers_sparse',
    };
  }
}

/** Serialized queue lock to prevent concurrent MTProto request flooding on Telegram session */
let currentZipReadPromise: Promise<any> = Promise.resolve();

/** Read ZIP entry via Grammers MTProto Range Fetch & Rust native engine (Zero full-file download). */
export async function driveZipReadEntry(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  entry: string,
  password?: string,
  forceRefresh?: boolean,
  opts?: ZipTargetOpts
): Promise<any> {
  if (!detectTauriRuntime()) {
    throw new Error('ZIP browser membutuhkan desktop Rust + Grammers.');
  }

  const chatId = resolveZipChatId(folderId, opts);
  const archiveKey = `${creds?.session || ''}_${chatId}_${messageId}`;
  const passKey = password || '';
  const entryCacheKey = `${entry}||${passKey}`;

  if (!forceRefresh) {
    const cachedObj = zipEntryCacheMap.get(archiveKey)?.get(entryCacheKey);
    if (cachedObj && cachedObj.status === 'success') {
      return { ...cachedObj, cached: true };
    }
  }

  const runRead = async () => {
    const apiId = Number(creds.apiId) || 0;
    const sparseOpts = {
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      messageId,
    };

    try {
      const { zipPreviewEntrySparse } = await import('../../tauri/rustBackend');
      const res = await zipPreviewEntrySparse(sparseOpts, entry, password);

      if (res?.encrypted) {
        return {
          status: 'encrypted',
          message: 'File ZIP dienkripsi. Masukkan password.',
          backend: 'grammers_sparse',
        };
      }

      let kind = 'meta';
      const mime = (res?.mimeType || '').toLowerCase();
      if (mime === 'application/pdf') {
        kind = 'pdf';
      } else if (mime.startsWith('video/')) {
        kind = 'video';
      } else if (mime.startsWith('audio/')) {
        kind = 'audio';
      } else if (mime.startsWith('image/')) {
        kind = 'image';
      } else if (res?.textContent != null) {
        kind = 'text';
      } else if (res?.isBinary) {
        kind = 'binary';
      }

      const outObj = {
        status: 'success',
        kind,
        text: res?.textContent,
        data_url: res?.dataUrl,
        mime: res?.mimeType,
        size: res?.size,
        backend: 'grammers_sparse',
      };

      let archiveMap = zipEntryCacheMap.get(archiveKey);
      if (!archiveMap) {
        archiveMap = new Map();
        zipEntryCacheMap.set(archiveKey, archiveMap);
      }
      archiveMap.set(entryCacheKey, outObj);

      return outObj;
    } catch (sparseErr: any) {
      const msg = String(sparseErr?.message || sparseErr || 'Gagal membaca entri ZIP');
      console.warn('[driveZipReadEntry] Sparse preview error:', sparseErr);
      if (
        msg.includes('bad_password') ||
        msg.includes('Password') ||
        msg.includes('password') ||
        msg.includes('decryption failed') ||
        msg.includes('checksum') ||
        msg.includes('Checksum') ||
        msg.includes('HMAC') ||
        msg.includes('hmac')
      ) {
        return {
          status: 'bad_password',
          message: 'Password salah atau enkripsi tidak didukung.',
          backend: 'grammers_sparse',
        };
      }
      return {
        status: 'error',
        error: msg,
        message: msg,
        backend: 'grammers_sparse',
      };
    }
  };

  const nextReadPromise = currentZipReadPromise.then(runRead, runRead);
  currentZipReadPromise = nextReadPromise;
  return nextReadPromise;
}

/** Fetch micro-quota thumbnail from ZIP entry (capped at max 64 KiB MTProto download). */
export async function driveZipThumbnailEntry(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  entry: string,
  password?: string,
  forceRefresh?: boolean,
  opts?: ZipTargetOpts
): Promise<any> {
  if (!detectTauriRuntime()) {
    throw new Error('ZIP browser membutuhkan desktop Rust + Grammers.');
  }

  const chatId = resolveZipChatId(folderId, opts);
  const archiveKey = `thumb_${creds?.session || ''}_${chatId}_${messageId}`;
  const passKey = password || '';
  const entryCacheKey = `${entry}||${passKey}`;

  if (!forceRefresh) {
    const cachedObj = zipEntryCacheMap.get(archiveKey)?.get(entryCacheKey);
    if (cachedObj && cachedObj.status === 'success') {
      return { ...cachedObj, cached: true };
    }
  }

  const runThumb = async () => {
    const apiId = Number(creds.apiId) || 0;
    const sparseOpts = {
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      messageId,
    };

    try {
      const { zipThumbnailEntrySparse } = await import('../../tauri/rustBackend');
      const res = await zipThumbnailEntrySparse(sparseOpts, entry, password);

      if (res?.encrypted) {
        return {
          status: 'encrypted',
          message: 'File ZIP dienkripsi. Masukkan password.',
          backend: 'grammers_sparse_thumb',
        };
      }

      const outObj = {
        status: 'success',
        kind: 'image',
        text: null,
        data_url: res?.dataUrl,
        mime: res?.mimeType || 'image/jpeg',
        size: res?.size,
        backend: res?.backend || 'grammers_sparse_thumb',
      };

      let archiveMap = zipEntryCacheMap.get(archiveKey);
      if (!archiveMap) {
        archiveMap = new Map();
        zipEntryCacheMap.set(archiveKey, archiveMap);
      }
      archiveMap.set(entryCacheKey, outObj);

      return outObj;
    } catch (sparseErr: any) {
      const msg = String(sparseErr?.message || sparseErr || 'Gagal membaca thumbnail ZIP');
      if (
        msg.includes('bad_password') ||
        msg.includes('Password') ||
        msg.includes('password') ||
        msg.includes('decryption failed')
      ) {
        return {
          status: 'encrypted',
          message: 'Password salah atau diperlukan.',
          backend: 'grammers_sparse_thumb',
        };
      }
      return {
        status: 'error',
        message: msg,
        backend: 'grammers_sparse_thumb',
      };
    }
  };

  const nextThumbPromise = currentZipReadPromise.then(runThumb, runThumb);
  currentZipReadPromise = nextThumbPromise;
  return nextThumbPromise;
}

/** Extract single ZIP entry directly to destination path on disk via Grammers Sparse Fetch. */
export async function driveZipExtractEntry(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  entryName: string,
  destPath: string,
  password?: string,
  opts?: ZipTargetOpts
): Promise<{ status: string; bytesWritten: number }> {
  if (!detectTauriRuntime()) {
    throw new Error('ZIP extraction membutuhkan desktop Rust + Grammers.');
  }
  const chatId = resolveZipChatId(folderId, opts);
  const apiId = Number(creds.apiId) || 0;
  const sparseOpts = {
    session: creds.session,
    apiId,
    apiHash: creds.apiHash,
    chatId,
    messageId,
  };

  const { zipExtractEntrySparse } = await import('../../tauri/rustBackend');
  const bytesWritten = await zipExtractEntrySparse(sparseOpts, entryName, destPath, password);
  return { status: 'success', bytesWritten };
}
