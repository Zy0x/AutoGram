import { ensureDriveSession } from '../driveSession';
import { detectTauriRuntime } from '../platform';
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
export async function driveScanFolders(creds: DriveCredentials) {
  if (!detectTauriRuntime()) {
    throw new Error('Drive membutuhkan aplikasi desktop (Rust + Grammers).');
  }
  try {
    const { tgScanFolders } = await import('../telegramBackend');
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
    const { tgListDialogs } = await import('../telegramBackend');
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
      const { tgListDialogs } = await import('../telegramBackend');
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
    const { tgListDialogs } = await import('../telegramBackend');
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
      const { tgListDialogFilters } = await import('../telegramBackend');
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
  if (opts?.cascade && opts?.detachChildren) {
    throw new Error('Pilih cascade atau lepas anak, bukan keduanya.');
  }
  const id = requireGrammersIdentity(creds);
  const { tgDeleteFolder } = await import('../telegramBackend');
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
  const { tgRenameFolder } = await import('../telegramBackend');
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
  const { tgSetFolderParent } = await import('../telegramBackend');
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
  const { tgCreateFolder } = await import('../telegramBackend');
  const gr = await tgCreateFolder({ ...id, name: clean, parentId });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Buat folder Grammers gagal.');
  }
  return mapFolderResult(gr.data);
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
    const { tgListTopics } = await import('../telegramBackend');
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
  const { tgCreateTopic } = await import('../telegramBackend');
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
  const { tgDeleteTopic } = await import('../telegramBackend');
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
  const { tgRenameTopic } = await import('../telegramBackend');
  const gr = await tgRenameTopic({ ...id, chatId, topicId, title: clean });
  if (!gr?.ok) {
    throw new Error(gr?.userMessage || gr?.error?.message || 'Rename topik Grammers gagal.');
  }
  return { status: 'success', topic_id: topicId, title: clean, backend: 'grammers' };
}
export { addDriveEventListener } from '../driveSession';
