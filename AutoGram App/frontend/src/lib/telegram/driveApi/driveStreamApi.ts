import { DriveCredentials } from './driveApiUtils';
import { FolderChunkPayload, tgStartFolderStream, tgCancelFolderStream } from '../core/telegramBackend';

export type { FolderChunkPayload };

export async function startFolderStream(
  creds: DriveCredentials,
  folderId: number | null,
  opts: {
    requestId: string;
    offsetId?: number | null;
    topicId?: number | null;
    limit?: number;
    onChunk: (payload: FolderChunkPayload) => void;
  }
) {
  const chatId = folderId == null ? 'me' : String(folderId);
  const apiId = Number(creds.apiId) || 0;
  return tgStartFolderStream(
    {
      session: creds.session,
      apiId,
      apiHash: creds.apiHash,
      chatId,
      requestId: opts.requestId,
      offsetId: opts.offsetId ?? null,
      topicId: opts.topicId ?? null,
      limit: opts.limit ?? 30,
    },
    opts.onChunk
  );
}

export async function cancelFolderStream(requestId: string) {
  return tgCancelFolderStream(requestId);
}
