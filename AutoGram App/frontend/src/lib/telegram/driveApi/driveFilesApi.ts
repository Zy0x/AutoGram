import { detectTauriRuntime } from '../../tauri/platform';
import { toLeanDriveFile, type DriveFile } from '../driveTypes';
import {
  DEFAULT_FILE_PAGE,
  DriveCredentials,
  resolveGrammersIdentity
} from './driveApiUtils';
export async function driveThumbnailsBatch(
  creds: DriveCredentials,
  messageIds: number[],
  folderId: number | null,
  opts?: {
    quality?: 'saver' | 'balanced' | 'sharp';
    batchSize?: number;
    requestId?: string;
    batchId?: string;
    items?: Array<{
      requestId: string;
      peerId: string;
      telegramMessageId: number;
      quality?: string;
      generation?: number;
    }>;
    telegramPeerId?: string;
    telegramMessageIds?: number[];
  }
) {
  if (!messageIds.length && !opts?.items?.length) return { status: 'success', thumbs: {} as Record<string, string | null>, items: [] };
  const quality = opts?.quality || 'balanced';
  const batch =
    opts?.batchSize ??
    (quality === 'saver' ? 24 : quality === 'sharp' ? 16 : 32);
  const ids = messageIds.slice(0, Math.min(96, batch));

  if (!detectTauriRuntime()) {
    return { status: 'success', thumbs: {} as Record<string, string | null>, items: [], deferred: true };
  }
  try {
    const { tgThumbsBatch } = await import('../core/telegramBackend');
    const engineLocation = resolveDriveEngineLocation(folderId);
    const chatId = opts?.telegramPeerId || (folderId == null
      ? 'me'
      : String(engineLocation?.storagePeerId ?? folderId));
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgThumbsBatch({
      requestId: opts?.requestId,
      batchId: opts?.batchId,
      items: opts?.items,
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      telegramPeerId: chatId,
      messageIds: ids,
      telegramMessageIds: opts?.telegramMessageIds || ids,
      quality,
    });
    if (gr?.ok && gr.data) {
      return {
        status: 'success',
        thumbs: gr.data.thumbs || {},
        items: gr.data.items || [],
        backend: 'grammers',
      };
    }
    return { status: 'success', thumbs: {} as Record<string, string | null>, items: [], deferred: true };
  } catch (e) {
    console.warn('[driveThumbnailsBatch] Grammers thumbnail failed', e);
    return { status: 'success', thumbs: {} as Record<string, string | null>, items: [], deferred: true };
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

import type { DriveMediaContext, DriveMediaFilter, ViewPerspective } from '../driveTypes';
import {
  buildDriveMediaContext,
  getMediaPageByContext,
  getMediaIndexState,
  getMediaRecordsCountByContext,
} from '../../db/mediaStudioDb';
import { mediaListCache } from '../../cache/multiTierCache';
import {
  driveEngineAccountId,
  driveEngineListFiles,
  driveEngineMoveFiles,
  driveEngineSoftDeleteFiles,
  resolveDriveEngineLocation,
} from './driveEngineApi';

const inFlightPages = new Map<string, Promise<any>>();

import type { TgScopedMediaSearchCursor } from '../core/telegramBackend';

export async function driveListFiles(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: {
    pageSize?: number;
    offsetId?: number | null;
    minId?: number | null;
    topicId?: number | null;
    context?: DriveMediaContext;
    searchCursor?: TgScopedMediaSearchCursor | null;
    /** Skip aggregate counters on the latency-critical first page. */
    quickStats?: boolean;
    sortMode?: string;
    localOffset?: number;
    bypassCache?: boolean;
    contentFilter?: DriveMediaFilter | string | null;
    perspective?: ViewPerspective;
  }
) {
  const pageSize = opts?.pageSize ?? DEFAULT_FILE_PAGE;
  const topicId = opts?.topicId ?? null;
  const sortMode = opts?.sortMode ?? 'newest';
  const offsetId = opts?.offsetId ?? null;
  const minId = opts?.minId ?? 0;
  const localOffset = opts?.localOffset ?? 0;
  const engineLocation = resolveDriveEngineLocation(folderId);

  const mediaContext = opts?.context ?? buildDriveMediaContext(creds.session, folderId, topicId);
  const cursorFingerprint = opts?.searchCursor
    ? `${opts.searchCursor.photoVideo?.fetchOffsetId ?? 0}:${opts.searchCursor.document?.fetchOffsetId ?? 0}:${opts.searchCursor.photoVideo?.exhausted ? 1 : 0}:${opts.searchCursor.document?.exhausted ? 1 : 0}:${opts.searchCursor.scope?.minId ?? 0}`
    : 'fresh';
  const contextKey = `${mediaContext.accountId}:${mediaContext.peerId}:${mediaContext.scopeKind}:${mediaContext.topicId ?? 'none'}:${opts?.contentFilter ?? 'all'}:${opts?.perspective ?? 'telegram'}:${offsetId ?? 0}:${minId}:${localOffset}:${cursorFingerprint}`;

  // L1 In-Memory Fast Cache Check
  if (!opts?.bypassCache && mediaListCache.has(contextKey)) {
    return mediaListCache.get(contextKey);
  }

  // Production Drive folders are logical UUID locations backed by one
  // Telegram peer. Their file membership comes from the local metadata map,
  // never from an unscoped peer scan (which would leak sibling contents).
  if (engineLocation) {
    const localPage = await driveEngineListFiles({
      accountId: driveEngineAccountId(creds.session),
      driveId: engineLocation.driveId,
      folderId: engineLocation.folderId,
      limit: Math.min(200, Math.max(pageSize, 1)),
      offset: Math.max(0, localOffset),
      sortMode,
      contentFilter: String(opts?.contentFilter ?? 'all'),
    });
    let files: DriveFile[] = localPage.files.map((file) => {
      const mime = String(file.mime || '').toLowerCase();
      const extension = file.filename.includes('.')
        ? file.filename.split('.').pop()?.toLowerCase() || null
        : null;
      const iconType = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
          ? 'video'
          : mime.startsWith('audio/')
            ? 'audio'
            : 'document';
      return toLeanDriveFile({
        id: Number(file.telegramMessageId),
        folder_id: folderId,
        name: file.filename,
        size: Number(file.size || 0),
        mime_type: file.mime ?? null,
        file_ext: extension,
        created_at: new Date(file.createdAt).toISOString(),
        icon_type: iconType,
        topic_id: file.telegramTopicId ?? null,
        has_thumb: iconType === 'image' || iconType === 'video',
        as_document: iconType === 'document',
        peer_id: file.telegramChatId,
        account_id: creds.session,
        peer_kind: 'channel',
        is_saved_messages: file.telegramChatId === 'me',
      });
    });
    const result = {
      status: 'success',
      folder_id: folderId,
      topic_id: null,
      files,
      total: files.length,
      page_size: pageSize,
      has_more: localPage.hasMore,
      next_offset_id: files[files.length - 1]?.id ?? null,
      search_cursor: null,
      lane_counts: null,
      emitted_watermark: null,
      lane_durability: null,
      total_count: localPage.totalCount,
      total_bytes: localPage.totalBytes,
      stats_accurate: true,
      stats_pending: false,
      cached: true,
      invalid_topic: false,
      backend: 'drive-engine',
    };
    mediaListCache.set(contextKey, result, 15000);
    return result;
  }

  // L2 Persistent Database Instant Paint Check (when opening fresh or after restart)
  if (!opts?.bypassCache && offsetId == null && localOffset === 0 && !opts?.searchCursor) {
    try {
      const indexState = await getMediaIndexState(mediaContext);
      if (indexState && (indexState.backfillComplete || indexState.newestCommittedId > 0)) {
        const localRows = await getMediaPageByContext(
          mediaContext,
          sortMode,
          localOffset,
          pageSize,
          opts?.contentFilter,
          opts?.perspective || 'telegram'
        );
        if (localRows && localRows.length > 0) {
          const totalCount =
            (await getMediaRecordsCountByContext(mediaContext, opts?.contentFilter, opts?.perspective || 'telegram')) ||
            (opts?.contentFilter && opts.contentFilter !== 'all' ? localRows.length : indexState.exactMediaCount) ||
            localRows.length;
          const canonicalLocalRows = localRows.map(toLeanDriveFile);
          const cachedResult = {
            status: 'success',
            folder_id: folderId,
            topic_id: topicId,
            files: canonicalLocalRows,
            total: canonicalLocalRows.length,
            page_size: pageSize,
            has_more: canonicalLocalRows.length >= pageSize && canonicalLocalRows.length < totalCount,
            next_offset_id: canonicalLocalRows[canonicalLocalRows.length - 1]?.id ?? null,
            search_cursor: null,
            lane_counts: null,
            emitted_watermark: null,
            lane_durability: null,
            total_count: totalCount,
            total_bytes: indexState.exactBytes ?? null,
            stats_accurate: true,
            stats_pending: false,
            cached: true,
            invalid_topic: false,
            backend: 'indexeddb_l2',
          };
          mediaListCache.set(contextKey, cachedResult, 15000); // 15s micro-cache
          return cachedResult;
        }
      }
    } catch {
      /* Fallback cleanly to MTProto network */
    }
  }

  if (inFlightPages.has(contextKey)) {
    return inFlightPages.get(contextKey)!;
  }

  const work = (async () => {
    // Grammers is authoritative. Callers may paint a scoped IndexedDB snapshot
    // first, but this API always revalidates it against Telegram.
    if (!detectTauriRuntime()) {
      throw new Error('Daftar media membutuhkan desktop Rust + Grammers.');
    }
    try {
      const { tgListMedia } = await import('../core/telegramBackend');
      const chatId = folderId == null
        ? 'me'
        : String(folderId);
      const apiId = Number(creds.apiId) || 0;
      const gr = await tgListMedia({
        session: creds.session,
        apiId,
        apiHash: creds.apiHash,
        chatId,
        limit: pageSize,
        offsetId: opts?.offsetId ?? null,
        minId: opts?.minId ?? null,
        topicId: topicId != null && topicId > 0 ? topicId : null,
        searchCursor: opts?.searchCursor ?? null,
        contentFilter: opts?.contentFilter ?? null,
      });
      if (gr?.ok && gr.data?.files) {
        let files = gr.data.files.map((f: any) => toLeanDriveFile({
          id: Number(f.id),
          folder_id: f.folderId ?? folderId,
          name: f.name,
          size: Number(f.size || 0),
          mime_type: f.mimeType ?? null,
          file_ext: f.fileExt ?? f.file_ext ?? null,
          original_name: f.originalName ?? f.original_name ?? null,
          icon_type: f.iconType || 'file',
          created_at: f.createdAt ?? undefined,
          has_thumb: !!f.hasThumb,
          as_document: !!f.asDocument,
          topic_id: f.topicId ?? topicId,
          peer_id: f.peerId ?? f.peer_id ?? (folderId == null
            ? 'me'
            : String(folderId)),
          peer_kind: f.peerKind ?? f.peer_kind ?? (folderId != null && folderId !== 0 ? 'channel' : undefined),
          peer_username: f.peerUsername ?? f.peer_username ?? undefined,
          grouped_id: f.groupedId ?? f.grouped_id ?? undefined,
          is_saved_messages: f.isSavedMessages ?? f.is_saved_messages ?? (folderId == null || folderId === 0),
          telegram_category: f.telegramCategory ?? f.telegram_category ?? undefined,
          telegram_subtype: f.telegramSubtype ?? f.telegram_subtype ?? undefined,
          drive_category: f.driveCategory ?? f.drive_category ?? undefined,
          drive_format: f.driveFormat ?? f.drive_format ?? undefined,
          caption: f.caption ?? null,
          link_urls: String(f.driveFormat ?? f.drive_format ?? '')
            .split('\n')
            .map((value) => value.trim())
            .filter((value) => /^https?:\/\//i.test(value)),
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
        const result = {
          status: 'success',
          folder_id: folderId,
          topic_id: topicId,
          files,
          total: files.length,
          page_size: pageSize,
          has_more: !!gr.data.hasMore,
          next_offset_id: gr.data.nextOffsetId ?? null,
          search_cursor: gr.data.searchCursor ?? null,
          lane_counts: gr.data.laneCounts ?? null,
          emitted_watermark: gr.data.emittedWatermark ?? null,
          lane_durability: gr.data.laneDurability ?? null,
          total_count: gr.data.totalCount ?? null,
          total_bytes: null,
          stats_accurate: false,
          stats_pending: true,
          cached: false,
          invalid_topic: false,
          backend: 'grammers',
        } as any;
        mediaListCache.set(contextKey, result);
        return result;
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

export interface AuthoritativeScanResult {
  files: DriveFile[];
  uniqueCount: number;
  pagesScanned: number;
  exhausted: true;
}

function isSameSearchCursor(
  a: TgScopedMediaSearchCursor | null,
  b: TgScopedMediaSearchCursor | null
): boolean {
  if (!a || !b) return a === b;
  return (
    a.photoVideo?.fetchOffsetId === b.photoVideo?.fetchOffsetId &&
    a.document?.fetchOffsetId === b.document?.fetchOffsetId &&
    Boolean(a.photoVideo?.exhausted) === Boolean(b.photoVideo?.exhausted) &&
    Boolean(a.document?.exhausted) === Boolean(b.document?.exhausted) &&
    a.scope?.minId === b.scope?.minId
  );
}

/**
 * P2.5.4 Exhaustive Authoritative Full Server Scan.
 * Paginates through all media records on Telegram server for the given peer across all pages until fully exhausted.
 * Fails closed: throws if cursor stalls, cursor is missing when has_more=true, or safety limit is hit.
 */
export async function scanAllAuthoritativePeerMedia(
  creds: DriveCredentials,
  folderId: number | null
): Promise<AuthoritativeScanResult> {
  const allFiles: DriveFile[] = [];
  const seenIds = new Set<number>();
  let currentCursor: TgScopedMediaSearchCursor | null = null;
  let pagesScanned = 0;
  const SAFETY_MAX_PAGES = 10000; // supports up to 1,000,000 files

  while (true) {
    pagesScanned++;
    if (pagesScanned > SAFETY_MAX_PAGES) {
      throw new Error(`Authoritative scan safety limit (${SAFETY_MAX_PAGES} pages) reached before exhaustion`);
    }

    const res = await driveListFiles(creds, folderId, {
      pageSize: 100,
      searchCursor: currentCursor,
      quickStats: false,
      sortMode: 'newest',
      bypassCache: true,
    });

    if (!res) {
      throw new Error('Authoritative scan failed: received empty response from driveListFiles');
    }

    if (res.files && res.files.length > 0) {
      for (const f of res.files) {
        if (!seenIds.has(f.id)) {
          seenIds.add(f.id);
          allFiles.push(f);
        }
      }
    }

    // If server declares no more, we have proven exhaustion!
    if (!res.has_more) {
      return {
        files: allFiles,
        uniqueCount: seenIds.size,
        pagesScanned,
        exhausted: true,
      };
    }

    // Fail closed: has_more=true but cursor missing
    if (!res.search_cursor) {
      throw new Error('Authoritative scan incomplete: has_more=true but search_cursor is missing');
    }

    // Fail closed: cursor stalled (did not advance compared to current request cursor)
    if (currentCursor && isSameSearchCursor(res.search_cursor, currentCursor)) {
      throw new Error('Authoritative scan stalled: search_cursor did not advance');
    }

    currentCursor = res.search_cursor;
  }
}


/**
 * Media stats — pending until full Grammers walk is ported.
 * UI already treats stats_pending; avoid spawning Telethon.
 */
export async function driveMediaStats(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: { topicId?: number | null; force?: boolean; peek?: boolean }
) {
  const location = resolveDriveEngineLocation(folderId);
  if (location) {
    const page = await driveEngineListFiles({
      accountId: driveEngineAccountId(creds.session),
      driveId: location.driveId,
      folderId: location.folderId,
      limit: 1,
      offset: 0,
    });
    return {
      status: 'success',
      folder_id: folderId,
      topic_id: null,
      total_count: page.totalCount,
      total_bytes: page.totalBytes,
      incomplete: false,
      pending: false,
      stats_pending: false,
      accurate: true,
      backend: 'drive-engine',
    };
  }
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
  const location = resolveDriveEngineLocation(folderId);
  const chatId = folderId == null ? 'me' : String(location?.storagePeerId ?? folderId);
  const gr = await tgDeleteMessages({
    ...id,
    chatId,
    messageIds: [messageId],
  });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Hapus media Grammers gagal.');
  }
  if (location) {
    await driveEngineSoftDeleteFiles({
      accountId: driveEngineAccountId(creds.session),
      driveId: location.driveId,
      folderId: location.folderId,
      telegramMessageIds: [messageId],
      deviceId: creds.session,
    });
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
  const grouped = new Map<string, {
    chatId: string;
    ids: number[];
    location: ReturnType<typeof resolveDriveEngineLocation>;
  }>();
  for (const item of items) {
    const location = resolveDriveEngineLocation(item.folderId);
    const chatId = item.folderId == null
      ? 'me'
      : String(location?.storagePeerId ?? item.folderId);
    const key = location ? `${chatId}:${location.driveId}:${location.folderId}` : chatId;
    const existing = grouped.get(key) || { chatId, ids: [], location };
    existing.ids.push(item.id);
    grouped.set(key, existing);
  }

  const id = await resolveGrammersIdentity(creds);
  const { tgDeleteMessages } = await import('../core/telegramBackend');

  const allDeleted: number[] = [];
  const allFailed: Array<{ id: number; error: string }> = [];

  for (const { chatId, ids, location } of grouped.values()) {
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
        if (location) {
          const deletedIds = Array.isArray(gr.data.deletedIds)
            ? gr.data.deletedIds
            : gr.data.deleted > 0
              ? ids
              : [];
          if (deletedIds.length > 0) {
            await driveEngineSoftDeleteFiles({
              accountId: driveEngineAccountId(creds.session),
              driveId: location.driveId,
              folderId: location.folderId,
              telegramMessageIds: deletedIds,
              deviceId: creds.session,
            });
          }
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
  /**
   * Group media messages as an album when moving/copying multiple items
   */
  groupAsAlbum?: boolean;
};

export async function driveMove(
  creds: DriveCredentials,
  messageId: number | number[],
  fromFolderId: number | null,
  toFolderId: number | null,
  opts?: DriveMoveOpts
) {
  const deleteSource = opts?.deleteSource !== false;
  const topicId = opts?.topicId != null && Number(opts.topicId) > 0 ? Number(opts.topicId) : null;
  const id = await resolveGrammersIdentity(creds);
  const { tgMoveMessages } = await import('../core/telegramBackend');
  const sourceLocation = resolveDriveEngineLocation(fromFolderId);
  const destinationLocation = resolveDriveEngineLocation(toFolderId);
  const ids = Array.isArray(messageId) ? messageId : [messageId];
  if (!ids.length) return { status: 'success', moved: 0, backend: 'grammers' };
  if (
    deleteSource
    && sourceLocation
    && destinationLocation
    && sourceLocation.driveId === destinationLocation.driveId
  ) {
    const moved = await driveEngineMoveFiles({
      accountId: driveEngineAccountId(creds.session),
      driveId: sourceLocation.driveId,
      sourceFolderId: sourceLocation.folderId,
      destinationFolderId: destinationLocation.folderId,
      telegramMessageIds: ids,
      deviceId: creds.session,
    });
    return { status: 'success', moved, backend: 'drive-engine' };
  }
  const sourceChat = fromFolderId == null
    ? 'me'
    : String(sourceLocation?.storagePeerId ?? fromFolderId);
  const destChat =
    toFolderId === null || toFolderId === undefined
      ? 'me'
      : String(destinationLocation?.storagePeerId ?? toFolderId);
  const gr = await tgMoveMessages({
    ...id,
    sourceChat,
    destChat,
    destTopicId: topicId,
    messageIds: ids,
    deleteSource,
    groupAsAlbum: opts?.groupAsAlbum,
  });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Pindah media Grammers gagal.');
  }
  return {
    status: 'success',
    moved: gr.data?.moved ?? ids.length,
    backend: 'grammers',
  };
}

export async function driveGetMediaStats(
  creds: DriveCredentials,
  folderId: number | null,
  topicId?: number | null,
  loadedCount?: number
) {
  if (!detectTauriRuntime()) return null;
  try {
    const location = resolveDriveEngineLocation(folderId);
    if (location) {
      const page = await driveEngineListFiles({
        accountId: driveEngineAccountId(creds.session),
        driveId: location.driveId,
        folderId: location.folderId,
        limit: 1,
        offset: 0,
      });
      return {
        totalCount: page.totalCount,
        totalBytes: page.totalBytes,
        photoCount: 0,
        videoCount: 0,
        fileCount: page.totalCount,
        gifCount: 0,
        linkCount: 0,
        audioCount: 0,
        topicId: null,
        isExact: true,
        backend: 'drive-engine',
      };
    }
    const { tgGetMediaStatistics } = await import('../core/telegramBackend');
    const chatId = folderId == null ? 'me' : String(folderId);
    const gr = await tgGetMediaStatistics({
      session: creds.session,
      apiId: Number(creds.apiId) || 0,
      apiHash: creds.apiHash,
      chatId,
      topicId: topicId ?? null,
      loadedCount: loadedCount ?? 0,
    });
    if (gr?.ok && gr.data) {
      return gr.data;
    }
    return null;
  } catch (e) {
    console.warn('[driveGetMediaStats] Grammers statistics failed', e);
    return null;
  }
}
