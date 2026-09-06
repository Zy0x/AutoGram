import {
  friendlyDriveError,
  telegramAccessIssue,
} from '../../lib/telegram/driveApi';
import type { TransferSession } from '../../lib/telegram/driveTypes';

export function localizedDriveError(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const issue = telegramAccessIssue(error);
  if (issue === 'restricted') return t('drive.telegram_access_restricted');
  if (issue === 'private') return t('drive.telegram_access_private');
  if (issue === 'unavailable') return t('drive.telegram_access_unavailable');
  return friendlyDriveError(error);
}

export function inferUploadMime(path: string): string | null {
  const clean = String(path || '').split(/[?#]/, 1)[0];
  const extension = clean.includes('.') ? clean.split('.').pop()?.toLowerCase() : '';
  const known: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic', avif: 'image/avif',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
    pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed', txt: 'text/plain', json: 'application/json',
  };
  return extension ? known[extension] ?? 'application/octet-stream' : null;
}

export interface QueueTask {
  id: string;
  kind: 'upload' | 'download' | 'download_one' | 'download_zip';
  paths?: string[];
  targetFolderId?: number | null;
  targetLabel?: string;
  skipTopic?: boolean;
  topicId?: number | null;
  selectedIds?: number[];
  saveDir?: string;
  messageId?: number;
  savePath?: string;
  names: string[];
  options: any;
  startIndex: number;
}

export type LocationKind = 'saved' | 'drive' | 'chat';

export async function flushTransferDebugLog(session: TransferSession): Promise<void> {
  if (!session || !session.debugLogs || !session.debugLogs.length) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_worker_temp_file', {
      filename: 'transfer_debug.txt',
      contents: session.debugLogs.join('\n'),
    });
  } catch (error) {
    console.warn('Gagal menulis transfer_debug.txt', error);
  }
}
