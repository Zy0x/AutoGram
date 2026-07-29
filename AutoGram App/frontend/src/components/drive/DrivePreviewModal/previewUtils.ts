import { DriveFile, DriveFolder, DriveChat } from '../../../lib/telegram/driveTypes';
import { DriveCredentials } from '../../../lib/telegram/driveApi';

export type DrivePreviewModalProps = {
  file: DriveFile;
  folderId: number | null;
  creds: DriveCredentials;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  neighborIds?: number[];
  folders?: DriveFolder[];
  chats?: DriveChat[];
  onRefreshDrive?: () => void;
  onOpenTransferManager?: () => void;
  onEnqueueUploadPaths?: (
    paths: string[],
    opts?: { targetFolderId?: number | null; targetLabel?: string; topicId?: number | null; skipTopic?: boolean }
  ) => Promise<void>;
  onEnqueueDownloadSingle?: (opts: {
    messageId: number;
    folderId: number | null;
    savePath: string;
    name: string;
  }) => Promise<void>;
};

export type PlayQuality = {
  id: string;
  label: string;
  description?: string;
  height?: number | null;
  size?: number | null;
  native?: boolean;
  transcode?: boolean;
  recommended?: boolean;
};

export const QUALITY_PREF_KEY = 'ag-drive-play-quality';
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;
export const ZOOM_STEP = 0.25;
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function readQualityPref(): string {
  try {
    const v = localStorage.getItem(QUALITY_PREF_KEY);
    if (v && ['auto', '720p', '1080p', '480p', '360p', 'full'].includes(v)) {
      return v;
    }
  } catch {
    /* ignore */
  }
  return 'auto';
}

export function writeQualityPref(q: string) {
  try {
    localStorage.setItem(QUALITY_PREF_KEY, q);
  } catch {
    /* ignore */
  }
}

export function isProgressiveStreamPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.includes('.part') || lower.includes('.tmp');
}

export function isHttpStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}

export function isPlayableHttpUrl(url: string | null | undefined): boolean {
  return isHttpStreamUrl(url) && !isProgressiveStreamPath(url);
}

export function buildMediaSrc(
  path?: string | null,
  localAssetSrc?: (path: string) => string
): string {
  if (!path) return '';
  const trimmed = path.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^asset:\/\/|^tauri:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (localAssetSrc) {
    return localAssetSrc(trimmed);
  }
  return trimmed;
}

export function resolvePreviewKind(
  file: DriveFile,
  streamPath: string | null
): 'video' | 'audio' | 'image' | 'text' | 'pdf' | 'zip' | 'other' {
  const mime = (file.mime_type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const sp = (streamPath || '').toLowerCase();

  if (mime.startsWith('video/') || sp.includes('/video/') || /\.(mp4|mkv|avi|mov|webm|m4v|3gp)$/.test(name)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || /\.(mp3|m4a|aac|flac|ogg|wav|opus)$/.test(name)) {
    return 'audio';
  }
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(name)) {
    return 'image';
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (mime === 'application/zip' || name.endsWith('.zip')) {
    return 'zip';
  }
  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    /\.(txt|json|md|py|rs|ts|tsx|js|jsx|css|html|log|sh|bat|ini|cfg|env|yaml|yml)$/.test(name)
  ) {
    return 'text';
  }
  return 'other';
}

export function formatQualitySize(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n >= 1024 * 1024 * 1024) return ` (${(n / (1024 * 1024 * 1024)).toFixed(1)} GB)`;
  if (n >= 1024 * 1024) return ` (${(n / (1024 * 1024)).toFixed(0)} MB)`;
  return ` (${Math.round(n / 1024)} KB)`;
}

export function sanitizeQualityLabel(raw: unknown, id?: string, height?: number | null): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s && s !== '1p' && s !== '0p' && s.length >= 2 && !/^\d$/.test(s)) {
    return s;
  }
  if (height && height > 0) {
    return `${height}p`;
  }
  if (id === 'full' || id === 'source' || id === 'original') return 'Original';
  if (id === '1080p') return '1080p';
  if (id === '720p') return '720p';
  if (id === '480p') return '480p';
  if (id === '360p') return '360p';
  return id || 'Auto';
}

export function normalizePlayQualities(list: PlayQuality[]): PlayQuality[] {
  if (!Array.isArray(list) || list.length === 0) return [];
  const seen = new Set<string>();
  const out: PlayQuality[] = [];
  for (const q of list) {
    const key = `${q.id}-${q.label}-${q.height ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...q,
      label: sanitizeQualityLabel(q.label, q.id, q.height),
    });
  }
  return out;
}

export function clamp(n: number, a: number, b: number): number {
  return Math.min(Math.max(n, a), b);
}

export function pointerIdMatches(a: number, b: number): boolean {
  return a === b;
}
