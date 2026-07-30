import { detectTauriRuntime } from '../../tauri/platform';
import {
  DEFAULT_FILE_PAGE,
  DriveCredentials,
  resolveGrammersIdentity
} from './driveApiUtils';
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
  // Backend caps at 96; send full requested batch so scroll fill is fewer RPCs.
  const ids = messageIds.slice(0, Math.min(96, batch));

  if (!detectTauriRuntime()) {
    return { status: 'success', thumbs: {} as Record<string, string | null>, deferred: true };
  }
  try {
    const { tgThumbsBatch } = await import('../core/telegramBackend');
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
    const { tgAvatarsBatch } = await import('../core/telegramBackend');
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

import type { DriveMediaContext } from '../driveTypes';
import { getMediaPageByContext, getMediaRecords } from '../../db/mediaStudioDb';

const inFlightPages = new Map<string, Promise<any>>();

export async function driveListFiles(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: {
    pageSize?: number;
    offsetId?: number | null;
    topicId?: number | null;
    context?: DriveMediaContext;
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
  const offsetId = opts?.offsetId ?? null;
  const localOffset = opts?.localOffset ?? 0;

  const contextKey = opts?.context
    ? `${opts.context.accountId}:${opts.context.peerId}:${opts.context.scopeKind}:${opts.context.topicId ?? 'none'}:${offsetId ?? 0}:${localOffset}`
    : `${folderId ?? 'me'}:${topicId ?? 'all'}:${offsetId ?? 0}:${localOffset}`;

  if (inFlightPages.has(contextKey)) {
    return inFlightPages.get(contextKey)!;
  }

  const work = (async () => {
    // 1. Try serving from local IndexedDB warm cache (completed indexing)
    const folderKey = folderId || 0;
    if (!opts?.bypassCache) {
      try {
        let records = opts?.context
          ? await getMediaPageByContext(opts.context, sortMode, localOffset, pageSize)
          : await getMediaRecords(folderKey, sortMode, localOffset, pageSize);

        if (!opts?.context && topicId != null && topicId > 0) {
          records = records.filter((r: any) => Number(r.topic_id ?? r.topicId) === Number(topicId));
        }
        if (records.length > 0 || topicId == null || topicId <= 0) {
          const totalCount = records.length;
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
        }
      } catch (e) {
        console.warn('[driveListFiles] Local cache query failed, falling back to network:', e);
      }
    }

    // 2. Grammers only (topic/sort client-side gaps handled as newest network page).
    if (!detectTauriRuntime()) {
      throw new Error('Daftar media membutuhkan desktop Rust + Grammers.');
    }
    try {
      const { tgListMedia } = await import('../core/telegramBackend');
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
        let files = gr.data.files.map((f: any) => ({
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
  })();

  inFlightPages.set(contextKey, work);
  try {
    return await work;
  } finally {
    if (inFlightPages.get(contextKey) === work) {
      inFlightPages.delete(contextKey);
    }
  }
}

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

export async function driveThumbnail(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
) {
  const res = await driveThumbnailsBatch(creds, [messageId], folderId, { batchSize: 1 });
  const url = res?.thumbs?.[String(messageId)] ?? null;
  return { status: 'success', data_url: url, backend: 'grammers' };
}

export async function driveDelete(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null
) {
  const id = await resolveGrammersIdentity(creds);
  const { tgDeleteMessages } = await import('../core/telegramBackend');
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
  const { tgDeleteMessages } = await import('../core/telegramBackend');

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
  const { tgMoveMessages } = await import('../core/telegramBackend');
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