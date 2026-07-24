/**
 * Native Telegram backend. Interactive Account/Session/Preview calls use
 * Rust + Grammers; legacy worker bridges are kept outside this module.
 * All calls are no-op / soft-fail outside Tauri or when commands missing.
 */
import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from './platform';
import { debugLogLayer } from './debugMode';

export type TgBackendStatus = {
  active: string;
  activeLabel: string;
  grammersCompiled: boolean;
  grammersOps: string[];
  telethonOps: string[];
  notes: string[];
};

export type TgOpResult<T> = {
  ok: boolean;
  backend: string;
  data?: T | null;
  error?: {
    code: string;
    message: string;
    floodWaitSecs?: number | null;
    rpcName?: string | null;
    retryable: boolean;
  } | null;
  userMessage?: string | null;
};

export async function tgBackendStatus(): Promise<TgBackendStatus | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const s = await invoke<TgBackendStatus>('tg_backend_status');
    debugLogLayer('rust', 'tg', 'backend_status', s);
    return s;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'backend_status_fail', String(e));
    return null;
  }
}

export async function tgSetBackend(backend: 'telethon' | 'grammers'): Promise<TgOpResult<TgBackendStatus> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<TgBackendStatus>>('tg_set_backend', { backend });
    debugLogLayer('rust', 'tg', 'set_backend', r);
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'set_backend_fail', String(e));
    return null;
  }
}

export async function tgProbeSession(session: string) {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke('tg_probe_session', { session });
    debugLogLayer('rust', 'tg', 'probe_session', r);
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'probe_session_fail', String(e));
    return null;
  }
}

export type TgSessionSummary = {
  name: string;
  status: string;
  source: string;
};

export async function tgListSessions(): Promise<TgSessionSummary[]> {
  if (!detectTauriRuntime()) return [];
  try {
    return await invoke<TgSessionSummary[]>('tg_list_sessions');
  } catch (e) {
    debugLogLayer('rust', 'tg', 'list_sessions_fail', String(e));
    return [];
  }
}

export type TgAuthStatus = {
  backend: string;
  authorized: boolean;
  session: string;
  user?: {
    id: number;
    firstName?: string | null;
    username?: string | null;
  } | null;
};

export async function tgAuthStatus(args: {
  session: string;
  apiId: number;
  apiHash: string;
}): Promise<TgOpResult<TgAuthStatus> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke<TgOpResult<TgAuthStatus>>('tg_auth_status', {
      identity: args,
    });
  } catch (e) {
    debugLogLayer('rust', 'tg', 'auth_status_fail', String(e));
    return null;
  }
}

export type TgLoginResult = {
  status: string;
  needsCode: boolean;
  needsPassword: boolean;
  passwordHint?: string | null;
  user?: TgAuthStatus['user'];
  message: string;
};

export async function tgLogin(args: {
  session: string;
  apiId: number;
  apiHash: string;
  phone?: string;
  code?: string;
  password?: string;
}): Promise<TgOpResult<TgLoginResult> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke<TgOpResult<TgLoginResult>>('tg_login', {
      request: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
        phone: args.phone || '',
        code: args.code || null,
        password: args.password || null,
      },
    });
  } catch (e) {
    debugLogLayer('rust', 'tg', 'login_fail', String(e));
    return null;
  }
}

export async function tgImportTelethonSession(session: string): Promise<TgOpResult<string> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<string>>('tg_import_telethon_session', { session });
    debugLogLayer('rust', 'tg', 'import_session', { ok: r?.ok, message: r?.userMessage || r?.data });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'import_session_fail', String(e));
    return null;
  }
}

export type TgMediaFileRow = {
  id: number;
  folderId?: number | null;
  name: string;
  size: number;
  mimeType?: string | null;
  iconType: string;
  createdAt?: string | null;
  hasThumb?: boolean;
  asDocument?: boolean;
  backend?: string;
};

export type TgListMediaResult = {
  status: string;
  folderId?: number | null;
  files: TgMediaFileRow[];
  total: number;
  pageSize: number;
  hasMore: boolean;
  nextOffsetId?: number | null;
  backend: string;
  cached: boolean;
};

/** Grammers list media (newest-first). Null on failure → caller uses Telethon drive path. */
export async function tgListMedia(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: string;
  limit?: number;
  offsetId?: number | null;
  topicId?: number | null;
}): Promise<TgOpResult<TgListMediaResult> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<TgListMediaResult>>('tg_list_media', {
      request: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
        chatId: args.chatId,
        limit: args.limit,
        offsetId: args.offsetId ?? null,
        topicId: args.topicId ?? null,
      },
    });
    debugLogLayer('rust', 'tg', 'list_media', {
      ok: r?.ok,
      n: r?.data?.files?.length,
      backend: r?.backend,
    });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'list_media_fail', String(e));
    return null;
  }
}

export type TgUploadStepResult = {
  status: string;
  path: string;
  bytesWritten?: number;
  messageId?: number | null;
  backend: string;
};

export async function tgUploadFile(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: string;
  path: string;
  caption?: string;
  asDocument?: boolean;
  silent?: boolean;
  index?: number;
  topicId?: number | null;
}): Promise<TgOpResult<TgUploadStepResult> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<TgUploadStepResult>>('tg_upload_file', {
      request: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
        chatId: args.chatId,
        path: args.path,
        caption: args.caption ?? null,
        asDocument: args.asDocument ?? true,
        silent: args.silent ?? false,
        index: args.index ?? 0,
        topicId: args.topicId ?? null,
      },
    });
    debugLogLayer('rust', 'tg', 'upload_file', {
      ok: r?.ok,
      path: args.path,
      backend: r?.backend,
    });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'upload_file_fail', String(e));
    return null;
  }
}

export type TgDialogEntry = {
  id: number;
  title: string;
  isUser: boolean;
  isChannel: boolean;
  isGroup: boolean;
  isForum?: boolean;
};

/** Drop live Grammers client for a session (fast multi-account switch). */
export async function tgDisconnectSession(session: string): Promise<boolean> {
  if (!detectTauriRuntime() || !session) return false;
  try {
    const r = await invoke<TgOpResult<boolean>>('tg_disconnect_session', { session });
    debugLogLayer('rust', 'tg', 'disconnect_session', { session, ok: r?.ok });
    return !!r?.ok;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'disconnect_session_fail', String(e));
    return false;
  }
}

/** Grammers dialog list — dual-path alternative to Telethon list_chats. */
export async function tgListDialogs(args: {
  session: string;
  apiId: number;
  apiHash: string;
  limit?: number;
}): Promise<TgOpResult<TgDialogEntry[]> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<TgDialogEntry[]>>('tg_list_dialogs', {
      identity: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
      },
      limit: args.limit ?? 100,
    });
    debugLogLayer('rust', 'tg', 'list_dialogs', {
      ok: r?.ok,
      n: Array.isArray(r?.data) ? r.data.length : 0,
      backend: r?.backend,
    });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'list_dialogs_fail', String(e));
    return null;
  }
}

export async function tgListDialogFilters(args: {
  session: string;
  apiId: number;
  apiHash: string;
}): Promise<TgOpResult<Array<{ id: number; title: string; kind: string }>> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke('tg_list_dialog_filters', {
      identity: args,
    });
  } catch (e) {
    debugLogLayer('rust', 'tg', 'list_dialog_filters_fail', String(e));
    return null;
  }
}

export type TgDownloadResult = {
  status: string;
  path: string;
  messageId: number;
  size: number;
  name?: string | null;
  mimeType?: string | null;
  backend: string;
};

/** Full-file Grammers download (≤200MB). Null/fail → Telethon progressive path. */
export async function tgDownloadFile(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: string;
  messageId: number;
  destPath: string;
}): Promise<TgOpResult<TgDownloadResult> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<TgDownloadResult>>('tg_download_file', {
      request: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
        chatId: args.chatId,
        messageId: args.messageId,
        destPath: args.destPath,
      },
    });
    debugLogLayer('rust', 'tg', 'download_file', {
      ok: r?.ok,
      size: r?.data?.size,
      backend: r?.backend,
    });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'download_file_fail', String(e));
    return null;
  }
}

/**
 * Prefer Grammers dual-path only when Telethon is not already holding the session.
 * Avoids AUTH_KEY_DUPLICATED when drive-serve warm worker is connected.
 */
export async function shouldTryGrammersPath(opts?: {
  telethonWarmActive?: boolean;
}): Promise<boolean> {
  if (!detectTauriRuntime()) return false;
  if (opts?.telethonWarmActive) return false;
  try {
    const st = await tgBackendStatus();
    if (!st) return true; // default try when status unavailable
    const label = String(st.activeLabel || st.active || '').toLowerCase();
    if (label.includes('telethon')) return false;
    return true;
  } catch {
    return true;
  }
}

export type TgTopicRow = {
  id: number;
  title: string;
  topMessage?: number | null;
  closed?: boolean;
};

export type TgListTopicsResult = {
  status: string;
  topics: TgTopicRow[];
  isForum: boolean;
  cached: boolean;
  backend: string;
};

export async function tgListTopics(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: number;
}): Promise<TgOpResult<TgListTopicsResult> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<TgListTopicsResult>>('tg_list_topics', {
      request: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
        chatId: args.chatId,
      },
    });
    debugLogLayer('rust', 'tg', 'list_topics', {
      ok: r?.ok,
      n: r?.data?.topics?.length,
      isForum: r?.data?.isForum,
    });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'list_topics_fail', String(e));
    return null;
  }
}

export async function tgThumbsBatch(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: string;
  messageIds: number[];
  quality?: string;
}): Promise<TgOpResult<{ status: string; thumbs: Record<string, string | null>; backend: string }> | null> {
  if (!detectTauriRuntime() || !args.messageIds.length) return null;
  try {
    const r = await invoke<
      TgOpResult<{ status: string; thumbs: Record<string, string | null>; backend: string }>
    >('tg_thumbs_batch', {
      request: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
        chatId: args.chatId,
        messageIds: args.messageIds,
        quality: args.quality || 'seimbang',
      },
    });
    debugLogLayer('rust', 'tg', 'thumbs_batch', {
      ok: r?.ok,
      n: args.messageIds.length,
      hits: r?.data?.thumbs ? Object.keys(r.data.thumbs).length : 0,
    });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'thumbs_batch_fail', String(e));
    return null;
  }
}

export type TgPreviewStreamResult = {
  status: string;
  streamId: string;
  streamUrl: string;
  path: string;
  mimeType: string;
  size: number;
  dataUrl?: string | null;
  textContent?: string | null;
  previewKind: string;
  streaming: boolean;
  backend: string;
  message?: string;
};

export async function tgPreviewStream(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: string;
  messageId: number;
}): Promise<TgOpResult<TgPreviewStreamResult> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<TgPreviewStreamResult>>('tg_preview_stream', {
      request: {
        session: args.session,
        apiId: args.apiId,
        apiHash: args.apiHash,
        chatId: args.chatId,
        messageId: args.messageId,
      },
    });
    debugLogLayer('rust', 'tg', 'preview_stream', {
      ok: r?.ok,
      streamId: r?.data?.streamId,
      streaming: r?.data?.streaming,
      backend: r?.backend,
    });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', 'preview_stream_fail', String(e));
    return null;
  }
}

export async function tgStopStream(streamId: string): Promise<boolean> {
  if (!detectTauriRuntime() || !streamId) return false;
  try {
    const r = await invoke<TgOpResult<boolean>>('tg_stop_stream', { streamId });
    return !!r?.ok && !!r?.data;
  } catch {
    return false;
  }
}

export async function tgSeekStream(
  streamId: string,
  opts: { timeS?: number; durationS?: number; offset?: number }
): Promise<number | null> {
  if (!detectTauriRuntime() || !streamId) return null;
  try {
    const r = await invoke<TgOpResult<number>>('tg_seek_stream', {
      streamId,
      offset: opts.offset ?? null,
      timeS: opts.timeS ?? null,
      durationS: opts.durationS ?? null,
    });
    return r?.ok && typeof r.data === 'number' ? r.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drive mutations (Grammers-only — replaces Telethon drive-serve)
// ---------------------------------------------------------------------------

type TgFolder = {
  id: number;
  name: string;
  titleRaw?: string;
  username?: string | null;
  isPublic?: boolean;
  parentId?: number | null;
  isDriveFolder?: boolean;
  isOrphan?: boolean;
};

function identity(args: { session: string; apiId: number; apiHash: string }) {
  return {
    session: args.session,
    apiId: args.apiId,
    apiHash: args.apiHash,
  };
}

async function tgInvoke<T>(
  cmd: string,
  request: Record<string, unknown>
): Promise<TgOpResult<T> | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const r = await invoke<TgOpResult<T>>(cmd, { request });
    debugLogLayer('rust', 'tg', cmd, { ok: r?.ok });
    return r;
  } catch (e) {
    debugLogLayer('rust', 'tg', `${cmd}_fail`, String(e));
    return null;
  }
}

export async function tgDeleteMessages(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: string;
  messageIds: number[];
}) {
  return tgInvoke<{
    status: string;
    deleted: number;
    deletedIds?: number[];
    failed?: Array<{ id: number; error: string }>;
    backend: string;
  }>('tg_delete_messages', {
    ...identity(args),
    chatId: args.chatId,
    messageIds: args.messageIds,
  });
}

export async function tgCreateFolder(args: {
  session: string;
  apiId: number;
  apiHash: string;
  name: string;
  parentId?: number | null;
}) {
  return tgInvoke<{ status: string; folder?: TgFolder | null; warning?: string | null; backend: string }>(
    'tg_create_folder',
    {
      ...identity(args),
      name: args.name,
      parentId: args.parentId ?? null,
    }
  );
}

export async function tgRenameFolder(args: {
  session: string;
  apiId: number;
  apiHash: string;
  folderId: number;
  name: string;
}) {
  return tgInvoke<{ status: string; folder?: TgFolder | null; backend: string }>('tg_rename_folder', {
    ...identity(args),
    folderId: args.folderId,
    name: args.name,
  });
}

export async function tgSetFolderParent(args: {
  session: string;
  apiId: number;
  apiHash: string;
  folderId: number;
  parentId?: number | null;
}) {
  return tgInvoke<{ status: string; folder?: TgFolder | null; backend: string }>(
    'tg_set_folder_parent',
    {
      ...identity(args),
      folderId: args.folderId,
      parentId: args.parentId ?? null,
    }
  );
}

export async function tgDeleteFolder(args: {
  session: string;
  apiId: number;
  apiHash: string;
  folderId: number;
}) {
  return tgInvoke<{ status: string; backend: string }>('tg_delete_folder', {
    ...identity(args),
    folderId: args.folderId,
  });
}

export async function tgScanFolders(args: {
  session: string;
  apiId: number;
  apiHash: string;
}) {
  return tgInvoke<{ status: string; folders: TgFolder[]; backend: string }>('tg_scan_folders', {
    ...identity(args),
  });
}

export async function tgCreateTopic(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: number;
  title: string;
}) {
  return tgInvoke<{ status: string; topicId?: number | null; title?: string | null; backend: string }>(
    'tg_create_topic',
    {
      ...identity(args),
      chatId: args.chatId,
      title: args.title,
    }
  );
}

export async function tgRenameTopic(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: number;
  topicId: number;
  title: string;
}) {
  return tgInvoke<{ status: string; topicId?: number | null; title?: string | null; backend: string }>(
    'tg_rename_topic',
    {
      ...identity(args),
      chatId: args.chatId,
      topicId: args.topicId,
      title: args.title,
    }
  );
}

export async function tgDeleteTopic(args: {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: number;
  topicId: number;
}) {
  return tgInvoke<{ status: string; topicId?: number | null; backend: string }>('tg_delete_topic', {
    ...identity(args),
    chatId: args.chatId,
    topicId: args.topicId,
  });
}

export async function tgAvatarsBatch(args: {
  session: string;
  apiId: number;
  apiHash: string;
  peerIds: number[];
}) {
  return tgInvoke<{
    status: string;
    avatars: Record<string, string | null>;
    backend: string;
  }>('tg_avatars_batch', {
    ...identity(args),
    peerIds: args.peerIds,
  });
}

export async function tgMoveMessages(args: {
  session: string;
  apiId: number;
  apiHash: string;
  sourceChat: string;
  destChat: string;
  messageIds: number[];
  deleteSource?: boolean;
}) {
  return tgInvoke<{ status: string; moved: number; backend: string }>('tg_move_messages', {
    ...identity(args),
    sourceChat: args.sourceChat,
    destChat: args.destChat,
    messageIds: args.messageIds,
    deleteSource: args.deleteSource !== false,
  });
}
