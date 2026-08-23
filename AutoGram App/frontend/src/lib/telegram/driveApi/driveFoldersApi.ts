import { ensureDriveSession } from '../core/driveSession';
import { detectTauriRuntime } from '../../tauri/platform';
import {
  DEFAULT_FILE_PAGE,
  DEFAULT_CHAT_PAGE,
  DriveCredentials,
  requireGrammersIdentity,
  mapDialogToChat,
  mapFolderResult
} from './driveApiUtils';
import { isTransferJobActive } from './driveTransfersApi';
import { driveListFiles } from './driveFilesApi';
import {
  driveEngineAccountId,
  driveEngineCreateDrive,
  driveEngineCreateFolder,
  driveEngineLocationSubtree,
  driveEngineLoadSidebar,
  driveEngineMoveFolder,
  driveEngineRenameFolder,
  driveEngineSoftDeleteDrive,
  driveEngineSoftDeleteFolder,
  registerDriveEngineLocation,
  resolveDriveEngineLocation,
  resolveDriveEngineRoot,
} from './driveEngineApi';

function mapEngineLocationToFolder(location: Awaited<ReturnType<typeof driveEngineLoadSidebar>>[number]) {
  return {
    id: location.uiId,
    name: location.name,
    title_raw: location.name,
    username: null,
    is_drive_folder: true,
    parent_id: location.parentUiId,
    is_orphan: false,
    engine_drive_id: location.driveId,
    engine_folder_id: location.folderId,
    storage_peer_id: location.storagePeerId,
    storage_topic_id: location.storageTopicId,
    source: 'engine' as const,
  };
}

/**
 * Restore production Drive trees from local SQLite without touching Telegram.
 * This is the authoritative first-paint source for filesystem-engine Drives.
 */
export async function driveLoadLocalFolders(creds: DriveCredentials) {
  if (!detectTauriRuntime()) return { status: 'success', folders: [], backend: 'drive-engine' };
  const locations = await driveEngineLoadSidebar(driveEngineAccountId(creds.session));
  return {
    status: 'success',
    folders: locations.map(mapEngineLocationToFolder),
    backend: 'drive-engine',
  };
}

export async function driveScanFolders(creds: DriveCredentials) {
  if (!detectTauriRuntime()) {
    throw new Error('Drive membutuhkan aplikasi desktop (Rust + Grammers).');
  }
  const localResult = await driveLoadLocalFolders(creds).catch(() => ({
    status: 'success',
    folders: [],
    backend: 'drive-engine',
  }));
  const localFolders = localResult.folders;
  const engineStoragePeers = new Set(
    localFolders.map((folder) => folder.storage_peer_id).filter((value) => value != null)
  );
  const mergeWithLocal = (legacyFolders: any[]) => [
    ...localFolders,
    ...legacyFolders.filter((folder: any) => !engineStoragePeers.has(Number(folder.id))),
  ];
  try {
    const { tgScanFolders } = await import('../core/telegramBackend');
    const result = await tgScanFolders({
      session: creds.session,
      apiId: Number(creds.apiId) || 0,
      apiHash: creds.apiHash,
    });
    if (result?.ok && result.data?.folders) {
      const legacyFolders = result.data.folders.map((f: any) => ({
        id: Number(f.id),
        name: String(f.name || f.titleRaw || f.id),
        title_raw: String(f.titleRaw || f.name || f.id),
        username: f.username ?? null,
        is_drive_folder: f.isDriveFolder !== false,
        parent_id: f.parentId ?? null,
        is_orphan: !!f.isOrphan,
        source: 'legacy' as const,
      }));
      const folders = mergeWithLocal(legacyFolders);
      return { status: 'success', folders, backend: 'grammers' };
    }
    // Fallback: dialog title filter without parent= (older native path)
    const { tgListDialogs } = await import('../core/telegramBackend');
    const dialogs = await tgListDialogs({
      session: creds.session,
      apiId: Number(creds.apiId),
      apiHash: creds.apiHash,
      limit: 500,
    });
    if (dialogs?.ok && Array.isArray(dialogs.data)) {
      const legacyFolders = dialogs.data
        .filter((dialog: any) => /\[TD\]/i.test(String(dialog.title || '')))
        .map((dialog: any) => ({
          id: Number(dialog.id),
          name: String(dialog.title || dialog.id).replace(/\s*\[TD\]\s*$/i, '').trim(),
          title_raw: String(dialog.title || dialog.id),
          username: null,
          is_drive_folder: true,
          parent_id: null,
          source: 'legacy' as const,
        }));
      const folders = mergeWithLocal(legacyFolders);
      return { status: 'success', folders, backend: 'grammers' };
    }
    throw new Error(result?.userMessage || result?.error?.message || 'Scan folder Grammers gagal.');
  } catch (e) {
    if (localFolders.length > 0) {
      return { status: 'success', folders: localFolders, backend: 'drive-engine' };
    }
    throw new Error(`Scan folder Rust + Grammers gagal: ${String((e as Error)?.message || e)}`);
  }
}

/**
 * Bootstrap first paint — hanya menunggu chats + files (TIDAK blocking pada folder scan).
 * driveScanFolders berjalan di background via folderScanPromise sehingga grid tampil
 * sebelum folder scan yang mungkin memakan 5-30 detik selesai.
 */
export async function driveBootstrap(
  creds: DriveCredentials,
  folderId: number | null,
  opts?: { filePageSize?: number; chatPageSize?: number; topicId?: number | null }
) {
  const filePage = opts?.filePageSize ?? DEFAULT_FILE_PAGE;
  const chatPage = opts?.chatPageSize ?? DEFAULT_CHAT_PAGE;
  const topicId = opts?.topicId ?? null;
  const localFoldersPromise = driveLoadLocalFolders(creds).catch(() => ({
    status: 'success',
    folders: [],
    backend: 'drive-engine',
  }));
  await ensureDriveSession(creds);

  // Folder scan dimulai tapi TIDAK ditunggu — grid tidak perlu menunggu folder scan.
  // Caller menggunakan folderScanPromise untuk proses folder setelah first paint.
  const foldersPromise = driveScanFolders(creds).catch(() => ({ status: 'success', folders: [] }));

  // Hanya chats + files yang blocking first paint
  const [chatsRes, filesRes, localFoldersRes] = await Promise.all([
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
    localFoldersPromise,
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
    // Filesystem-engine Drives are restored from SQLite immediately. The
    // background scan only reconciles legacy [TD] Drives and storage peers.
    folders: (localFoldersRes as any).folders || [],
    /** Caller dapat await ini setelah first paint untuk mendapatkan folder list lengkap */
    folderScanPromise: foldersPromise,
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
      const { tgListDialogs } = await import('../core/telegramBackend');
      {
        const apiId = Number(creds.apiId) || 0;
        const gr = await tgListDialogs({
          session: creds.session,
          apiId,
          apiHash: creds.apiHash,
          limit,
        });
        if (gr?.ok && Array.isArray(gr.data)) {
          const chats = gr.data.map((d: any) => mapDialogToChat(d));
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
    const { tgListDialogs } = await import('../core/telegramBackend');
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgListDialogs({
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      limit: Math.min(limit + offset, 2000),
    });
    if (gr?.ok && Array.isArray(gr.data)) {
      const all = gr.data.map((d: any) => mapDialogToChat(d));
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
      const { tgListDialogFilters } = await import('../core/telegramBackend');
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


export type DriveDeleteFolderOpts = {
  cascade?: boolean;
  detachChildren?: boolean;
};

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
  const engineLocation = resolveDriveEngineLocation(fid);
  if (engineLocation) {
    const id = requireGrammersIdentity(creds);
    if (engineLocation.root) {
      if (engineLocation.storagePeerId != null) {
        const { tgDeleteFolder } = await import('../core/telegramBackend');
        const remoteDelete = await tgDeleteFolder({ ...id, folderId: engineLocation.storagePeerId });
        if (!remoteDelete?.ok) {
          throw new Error(remoteDelete?.userMessage || remoteDelete?.error?.message || 'DRIVE_ENGINE_REMOTE_DELETE_FAILED');
        }
      }
    } else if (engineLocation.storagePeerId != null) {
      const topics = driveEngineLocationSubtree(fid)
        .map((location) => location.storageTopicId)
        .filter((topicId): topicId is number => topicId != null && topicId > 0);
      for (const topicId of topics.reverse()) {
        await driveDeleteTopic(creds, engineLocation.storagePeerId, topicId);
      }
    }
    const deleted = engineLocation.root
      ? await driveEngineSoftDeleteDrive({
          accountId: driveEngineAccountId(creds.session),
          driveId: engineLocation.driveId,
        })
      : await driveEngineSoftDeleteFolder({
          accountId: driveEngineAccountId(creds.session),
          driveId: engineLocation.driveId,
          folderId: engineLocation.folderId,
        });
    return { status: 'success', backend: 'drive-engine', deleted };
  }
  if (opts?.cascade && opts?.detachChildren) {
    throw new Error('Pilih cascade atau lepas anak, bukan keduanya.');
  }
  const id = requireGrammersIdentity(creds);
  const { tgDeleteFolder } = await import('../core/telegramBackend');
  const gr = await tgDeleteFolder({ ...id, folderId: fid });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Hapus folder Grammers gagal.');
  }
  return { status: 'success', backend: 'grammers' };
}

/**
 * Batch delete multiple Drive/Folder channels permanently on Telegram MTProto.
 * Executes in parallel with allSettled so one failure (e.g. already deleted channel)
 * doesn't block the deletion of the rest.
 */
export async function driveDeleteFoldersBatch(
  creds: DriveCredentials,
  folderIds: number[]
) {
  if (!folderIds || !folderIds.length) return { status: 'success', backend: 'grammers' };
  const uniqueIds = Array.from(new Set(folderIds.map((id) => Number(id)))).filter(Number.isFinite);
  const results = await Promise.allSettled(
    uniqueIds.map((fid) => driveDeleteFolder(creds, fid))
  );
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === 'rejected') {
      const msg = String(r.reason?.message || r.reason || '');
      if (!msg.toLowerCase().includes('not found') && !msg.toLowerCase().includes('channel_invalid')) {
        errors.push(msg);
      }
    }
  }
  if (errors.length > 0 && errors.length === uniqueIds.length) {
    throw new Error(errors[0]);
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
  const engineLocation = resolveDriveEngineLocation(fid);
  if (engineLocation) {
    if (engineLocation.root && engineLocation.storagePeerId != null) {
      const id = requireGrammersIdentity(creds);
      const { tgRenameFolder } = await import('../core/telegramBackend');
      const storageRename = await tgRenameFolder({
        ...id,
        folderId: engineLocation.storagePeerId,
        name: clean,
        storageMode: true,
      });
      if (!storageRename?.ok) {
        throw new Error(
          storageRename?.userMessage ||
          storageRename?.error?.message ||
          'DRIVE_ENGINE_STORAGE_RENAME_FAILED'
        );
      }
    } else if (engineLocation.storagePeerId != null && engineLocation.storageTopicId != null) {
      await driveRenameTopic(creds, engineLocation.storagePeerId, engineLocation.storageTopicId, clean);
    }
    const folder = await driveEngineRenameFolder({
      accountId: driveEngineAccountId(creds.session),
      driveId: engineLocation.driveId,
      folderId: engineLocation.folderId,
      name: clean,
    });
    registerDriveEngineLocation({ ...engineLocation, folderId: folder.folderId, name: folder.name });
    return {
      status: 'success',
      backend: 'drive-engine',
      folder: {
        id: fid,
        name: folder.name,
        title_raw: folder.name,
        parent_id: engineLocation.parentUiId,
        is_drive_folder: true,
        engine_drive_id: engineLocation.driveId,
        engine_folder_id: folder.folderId,
        storage_peer_id: engineLocation.storagePeerId,
        source: 'engine' as const,
      },
    };
  }
  const id = requireGrammersIdentity(creds);
  const { tgRenameFolder } = await import('../core/telegramBackend');
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
  const engineLocation = resolveDriveEngineLocation(fid);
  if (engineLocation) {
    const parent = pid == null
      ? resolveDriveEngineRoot(engineLocation.driveId)
      : resolveDriveEngineLocation(pid);
    if (!parent || parent.driveId !== engineLocation.driveId) {
      throw new Error('DRIVE_ENGINE_PARENT_SCOPE_INVALID');
    }
    const folder = await driveEngineMoveFolder({
      accountId: driveEngineAccountId(creds.session),
      driveId: engineLocation.driveId,
      folderId: engineLocation.folderId,
      parentId: parent.folderId,
    });
    registerDriveEngineLocation({ ...engineLocation, parentUiId: parent.root ? parent.uiId : parent.uiId });
    return {
      status: 'success',
      backend: 'drive-engine',
      folder: {
        id: fid,
        name: folder.name,
        title_raw: folder.name,
        parent_id: parent.uiId,
        is_drive_folder: true,
        engine_drive_id: engineLocation.driveId,
        engine_folder_id: folder.folderId,
        storage_peer_id: engineLocation.storagePeerId,
        source: 'engine' as const,
      },
    };
  }
  const id = requireGrammersIdentity(creds);
  const { tgSetFolderParent } = await import('../core/telegramBackend');
  const gr = await tgSetFolderParent({ ...id, folderId: fid, parentId: pid });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Reparent folder Grammers gagal.');
  }
  return mapFolderResult(gr.data);
}

/** Create a production Drive or a logical folder inside an existing Drive. */
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
  const accountId = driveEngineAccountId(creds.session);
  const parentLocation = resolveDriveEngineLocation(parentId);
  if (parentLocation) {
    if (parentLocation.storagePeerId == null) throw new Error('DRIVE_ENGINE_STORAGE_PEER_MISSING');
    const remoteTopic = await driveCreateTopic(creds, parentLocation.storagePeerId, clean);
    const storageTopicId = Number(remoteTopic.topic_id);
    if (!Number.isFinite(storageTopicId) || storageTopicId <= 0) {
      throw new Error('DRIVE_ENGINE_TOPIC_ID_MISSING');
    }
    let folder;
    try {
      folder = await driveEngineCreateFolder({
        accountId,
        driveId: parentLocation.driveId,
        parentId: parentLocation.folderId,
        name: clean,
        telegramChatId: String(parentLocation.storagePeerId),
        telegramTopicId: storageTopicId,
      });
    } catch (error) {
      await driveDeleteTopic(creds, parentLocation.storagePeerId, storageTopicId).catch(() => undefined);
      throw error;
    }
    const location = registerDriveEngineLocation({
      driveId: parentLocation.driveId,
      folderId: folder.folderId,
      parentUiId: parentLocation.uiId,
      name: folder.name,
      storagePeerId: parentLocation.storagePeerId,
      storageTopicId,
      root: false,
    });
    return {
      status: 'success',
      backend: 'drive-engine',
      folder: {
        id: location.uiId,
        name: location.name,
        title_raw: location.name,
        username: null,
        parent_id: parentLocation.uiId,
        is_drive_folder: true,
        is_orphan: false,
        engine_drive_id: location.driveId,
        engine_folder_id: location.folderId,
        storage_peer_id: location.storagePeerId,
        storage_topic_id: location.storageTopicId,
        source: 'engine' as const,
      },
    };
  }
  const id = requireGrammersIdentity(creds);
  const { tgCreateFolder } = await import('../core/telegramBackend');
  if (parentId != null) {
    // Existing verified Drives keep their legacy Telegram-backed hierarchy.
    const legacy = await tgCreateFolder({ ...id, name: clean, parentId, storageMode: false });
    if (!legacy?.ok) {
      throw new Error(legacy?.userMessage || legacy?.error?.message || 'Buat folder Grammers gagal.');
    }
    return mapFolderResult(legacy.data);
  }
  const gr = await tgCreateFolder({ ...id, name: clean, parentId: null, storageMode: true });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Buat folder Grammers gagal.');
  }
  const legacyFolder = mapFolderResult(gr.data);
  const storagePeerId = Number(legacyFolder?.folder?.id);
  if (!Number.isFinite(storagePeerId)) return legacyFolder;
  let drive;
  try {
    drive = await driveEngineCreateDrive({
      accountId,
      name: clean,
      storagePeerId: String(storagePeerId),
    });
  } catch (error) {
    const { tgDeleteFolder } = await import('../core/telegramBackend');
    await tgDeleteFolder({ ...id, folderId: storagePeerId }).catch(() => undefined);
    throw error;
  }
  const location = registerDriveEngineLocation({
    driveId: drive.driveId,
    folderId: drive.rootFolderId,
    parentUiId: null,
    name: drive.name,
      storagePeerId,
      storageTopicId: null,
      root: true,
  });
  return {
    status: 'success',
    backend: 'drive-engine',
    folder: {
      id: location.uiId,
      name: location.name,
      title_raw: location.name,
      username: null,
      parent_id: null,
      is_drive_folder: true,
      is_orphan: false,
      engine_drive_id: location.driveId,
      engine_folder_id: location.folderId,
      storage_peer_id: storagePeerId,
      storage_topic_id: null,
      source: 'engine' as const,
    },
  };
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

export async function driveListTopics(creds: DriveCredentials, chatId: number) {
  if (!detectTauriRuntime()) {
    throw new Error('Daftar topik membutuhkan desktop Rust + Grammers.');
  }
  try {
    const { tgListTopics } = await import('../core/telegramBackend');
    const apiId = Number(creds.apiId) || 0;
    const gr = await tgListTopics({
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
    });
    if (gr?.ok && gr.data) {
      const topics = (gr.data.topics || []).map((t: any) => ({
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
  const { tgCreateTopic } = await import('../core/telegramBackend');
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
  const { tgDeleteTopic } = await import('../core/telegramBackend');
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
  const { tgRenameTopic } = await import('../core/telegramBackend');
  const gr = await tgRenameTopic({ ...id, chatId, topicId, title: clean });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Rename topik Grammers gagal.');
  }
  return { status: 'success', topic_id: topicId, title: clean, backend: 'grammers' };
}

export { addDriveEventListener } from '../core/driveSession';
