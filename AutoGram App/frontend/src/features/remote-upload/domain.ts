import type {
  ResolvedMediaInfo,
  RemoteMuxSpec,
  StreamQualityFormat,
} from '../../lib/telegram/linkResolvers';
import { isManifestTransport } from '../../lib/telegram/linkResolvers/transportPolicy';

export type RemoteUploadTab = 'single' | 'batch';
export type DeliveryMode = 'auto' | 'uncompressed' | 'document';
export type UrlKind = 'video' | 'image' | 'profile' | 'story' | 'audio' | 'zip' | 'doc' | 'other' | 'unsupported';
export type BatchQualityPreference = 'best' | '1080p' | '720p' | 'audio';

export interface UrlInspection {
  url: string;
  status: 'idle' | 'inspecting' | 'valid' | 'direct_stream' | 'error';
  filename: string;
  size?: number | null;
  mimeType?: string | null;
  kind: UrlKind;
  error?: string | null;
}

export interface BatchMediaItem {
  id: string;
  groupId: string;
  sourceUrl: string;
  title: string;
  filename: string;
  directUrl: string;
  thumbnailUrl?: string;
  filesizeBytes?: number;
  durationSec?: number;
  qualityBadge?: string;
  headers?: Record<string, string>;
  mux?: RemoteMuxSpec;
  isVideo: boolean;
  kind: 'video' | 'photo' | 'document' | 'audio';
}

export interface BatchUrlResultGroup {
  id: string;
  sourceUrl: string;
  status: 'pending' | 'resolving' | 'success' | 'error';
  errorMessage?: string;
  platformName: string;
  title: string;
  items: BatchMediaItem[];
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').replace(/[\r\n\t]+/g, ' ').trim();
}

export function isInspectableRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.includes('.') && parsed.hostname.length >= 4;
  } catch {
    return false;
  }
}

export function isManifestFormat(format: Pick<StreamQualityFormat, 'ext' | 'protocol' | 'directUrl'> | null | undefined): boolean {
  return isManifestTransport(format);
}

export function canTransferResolvedFormat(format: StreamQualityFormat | null | undefined): format is StreamQualityFormat {
  const status = format?.verification?.status;
  return Boolean(
    format?.directUrl &&
      !isManifestFormat(format) &&
      format.isDownloadable !== false &&
      status !== 'blocked' &&
      status !== 'session-bound' &&
      status !== 'wrapper' &&
      status !== 'unverified'
  );
}

export function mergeRemoteDiscoveryResults(previous: ResolvedMediaInfo, next: ResolvedMediaInfo): ResolvedMediaInfo {
  const formatKeys = new Set<string>();
  const formats = [...previous.formats, ...next.formats].filter((format) => {
    const key = format.directUrl || format.id;
    if (formatKeys.has(key)) return false;
    formatKeys.add(key);
    return true;
  });
  const itemKeys = new Set<string>();
  const mediaItems = [...(previous.mediaItems || []), ...(next.mediaItems || [])].filter((item) => {
    const key = item.formats[0]?.directUrl || item.id;
    if (itemKeys.has(key)) return false;
    itemKeys.add(key);
    return true;
  });
  return {
    ...previous,
    ...next,
    title: previous.title || next.title,
    formats,
    mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
    selectedFormatId: previous.selectedFormatId || next.selectedFormatId,
    totalItems: formats.length,
    discovery: next.discovery || previous.discovery,
  };
}

export function inferKindFromExt(ext: string): UrlKind {
  const value = ext.toLowerCase().replace(/^\./, '');
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'm4v', '3gp', 'ts'].includes(value)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tiff'].includes(value)) return 'image';
  if (['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac', 'opus', 'wma'].includes(value)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'iso', 'bz2', 'tgz'].includes(value)) return 'zip';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub'].includes(value)) return 'doc';
  if (!value || value.length > 8 || !/^[a-z0-9]+$/i.test(value)) return 'unsupported';
  return 'other';
}

export function inferFilenameFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    const pathSegment = url.pathname.split('/').filter(Boolean).pop();
    if (pathSegment) {
      const decoded = decodeURIComponent(pathSegment);
      if (decoded.trim()) return decoded.trim();
    }
    return url.hostname || 'remote_file.bin';
  } catch {
    const clean = rawUrl.trim().split('?')[0].split('#')[0];
    const segment = clean.split(/[/\\]/).filter(Boolean).pop();
    return segment || 'remote_file.bin';
  }
}

export function selectFormatByPreference(formats?: StreamQualityFormat[], preference?: BatchQualityPreference): StreamQualityFormat | undefined {
  if (!formats || formats.length === 0) return undefined;
  const value = preference || '1080p';
  if (value === 'audio') {
    const audio = formats.find((format) => format.isAudio || format.qualityTier === 'audio');
    if (audio) return audio;
  }
  if (value === '720p') {
    const p720 = formats.find((format) => Number(format.height || 0) === 720);
    if (p720) return p720;
  }
  if (value === '1080p') {
    const p1080 = formats.find((format) => Number(format.height || 0) === 1080);
    if (p1080) return p1080;
  }
  if (value === 'best') {
    const top = [...formats].sort((a, b) => Number(b.height || 0) - Number(a.height || 0) || Number(b.fps || 0) - Number(a.fps || 0) || Number(b.bitrate || 0) - Number(a.bitrate || 0))[0];
    if (top) return top;
  }
  return formats.find((format) => Number(format.height || 0) === 1080) || formats[0];
}

const KNOWN_MEDIA_EXTENSIONS = new Set([
  'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', '3gp', 'ts',
  'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma',
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'heic',
  'zip', 'rar', '7z', 'tar', 'gz', 'pdf', 'doc', 'docx', 'txt', 'epub',
]);

function hasKnownMediaExtension(name: string, ext?: string): boolean {
  const clean = (name || '').trim();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const candidate = clean.slice(lastDot + 1).trim().toLowerCase();
  if (ext && candidate === ext.toLowerCase().replace(/^\./, '')) return true;
  return KNOWN_MEDIA_EXTENSIONS.has(candidate);
}

export function getEffectiveFormatFilename(fmt?: StreamQualityFormat, resolved?: ResolvedMediaInfo | null, fallbackExt?: string): string {
  if (!resolved && !fmt) return '';
  if (fmt?.customFilename) return fmt.customFilename;
  const rawTitle = sanitizeFilename(fmt?.customTitle || resolved?.title || '').trim();
  const targetExt = (fmt?.ext || fallbackExt || 'mp4').toLowerCase().replace(/^\./, '');
  if (!rawTitle) return `remote_file.${targetExt}`;
  if (hasKnownMediaExtension(rawTitle, targetExt)) return rawTitle;
  return `${rawTitle}.${targetExt}`;
}

export function formatMediaDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

export function splitFilenameAndExt(fullFilename: string, fallbackExt: string): { base: string; ext: string } {
  const clean = (fullFilename || '').trim();
  const cleanFallback = (fallbackExt || 'mp4').toLowerCase().replace(/^\./, '');
  const lastDot = clean.lastIndexOf('.');
  if (lastDot > 0) {
    const candidate = clean.slice(lastDot + 1).trim().toLowerCase();
    if (/^[a-z0-9]{1,6}$/.test(candidate) && (candidate === cleanFallback || KNOWN_MEDIA_EXTENSIONS.has(candidate))) {
      return { base: clean.slice(0, lastDot).trim(), ext: candidate };
    }
  }
  return { base: clean || 'unnamed_media', ext: cleanFallback };
}

export function sanitizeAndNormalizeFilename(userInput: string, targetExt: string): string {
  let name = (userInput || '').trim().replace(/[\\/:*?"<>|]/g, '_').trim();
  const cleanTargetExt = (targetExt || 'mp4').toLowerCase().replace(/^\./, '');
  let changed = true;
  while (changed) {
    changed = false;
    const lastDot = name.lastIndexOf('.');
    if (lastDot > 0) {
      const candidate = name.slice(lastDot + 1).trim().toLowerCase();
      if (candidate === cleanTargetExt || KNOWN_MEDIA_EXTENSIONS.has(candidate)) {
        name = name.slice(0, lastDot).trim();
        changed = true;
      }
    }
  }
  return `${name || 'media'}.${cleanTargetExt}`;
}
