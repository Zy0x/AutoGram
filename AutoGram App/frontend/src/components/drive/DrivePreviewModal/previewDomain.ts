import i18n from 'i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../lib/tauri/platform';
import {
  formatDriveBytes,
  isAudioDriveFile,
  isImageDriveFile,
  isPdfDriveFile,
  isTextDriveFile,
  isVideoDriveFile,
  isZipDriveFile,
  type DriveFile,
} from '../../../lib/telegram/driveTypes';

export function middleTruncateFilename(filename: string, maxLength: number = 32): string {
  if (!filename || filename.length <= maxLength) return filename;
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex !== -1 ? filename.slice(extIndex) : '';
  const nameWithoutExt = extIndex !== -1 ? filename.slice(0, extIndex) : filename;
  const targetNameLength = maxLength - ext.length - 3;
  if (targetNameLength <= 4) return `${filename.slice(0, 8)}...${ext}`;
  const frontLen = Math.ceil(targetNameLength / 2);
  const backLen = Math.floor(targetNameLength / 2);
  return `${nameWithoutExt.slice(0, frontLen)}...${nameWithoutExt.slice(-backLen)}${ext}`;
}

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
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 0.25;
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function fallbackVideoQualities(t: (key: string) => string): PlayQuality[] {
  return [
    {
      id: 'auto',
      label: t('drive.quality_telegram_auto'),
      description: t('drive.quality_telegram_auto_desc'),
      native: true,
      recommended: true,
    },
    {
      id: 'original',
      label: t('drive.quality_telegram_original'),
      description: t('drive.quality_telegram_original_desc'),
      native: true,
    },
  ];
}

export function readQualityPref(): string {
  try {
    const value = localStorage.getItem(QUALITY_PREF_KEY);
    if (value && value.trim()) return value.trim();
  } catch {
    /* ignore */
  }
  return 'auto';
}

export function writeQualityPref(quality: string): void {
  try {
    localStorage.setItem(QUALITY_PREF_KEY, quality);
  } catch {
    /* ignore */
  }
}

export function isProgressiveStreamPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return /\.stream\./i.test(path) || /\.stream$/i.test(path) || /\.partial$/i.test(path) || /\.partial\./i.test(path) || /\.tmp$/i.test(path);
}

export function isHttpStreamUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/stream\//i.test(url);
}

export function isPlayableHttpUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

export function buildMediaSrc(
  streamUrl: string | null,
  dataUrl: string | null,
  path: string | null,
  preferLocal = false,
  opts?: { forVideo?: boolean }
): string | null {
  const forVideo = !!opts?.forVideo || !preferLocal;
  if (forVideo && isPlayableHttpUrl(streamUrl)) return streamUrl;

  if (preferLocal && !forVideo) {
    if (dataUrl && dataUrl.startsWith('data:image/') && dataUrl.length < 8_000_000) return dataUrl;
    if (path && detectTauriRuntime() && !isProgressiveStreamPath(path)) {
      try {
        return convertFileSrc(path);
      } catch {
        /* fall through */
      }
    }
    if (isPlayableHttpUrl(streamUrl)) return streamUrl;
    return null;
  }

  if (isPlayableHttpUrl(streamUrl)) return streamUrl;
  if (dataUrl && dataUrl.startsWith('data:') && !dataUrl.startsWith('data:image/') && dataUrl.length < 8_000_000) {
    return dataUrl;
  }
  if (path && detectTauriRuntime() && !isProgressiveStreamPath(path)) {
    try {
      return convertFileSrc(path);
    } catch {
      return null;
    }
  }
  return null;
}

export function resolvePreviewKind(
  file: DriveFile,
  mime: string | null,
  previewKind: string | null
): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'zip' | 'other' {
  const mediaType = (mime || file.mime_type || '').toLowerCase();
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType.startsWith('audio/') || previewKind === 'audio' || isAudioDriveFile(file)) return 'audio';
  if (mediaType === 'application/pdf' || previewKind === 'pdf' || isPdfDriveFile(file)) return 'pdf';
  if (mediaType.startsWith('text/') || previewKind === 'text' || isTextDriveFile(file)) return 'text';
  if (isZipDriveFile(file) || mediaType.includes('zip') || previewKind === 'zip') return 'zip';
  if (previewKind === 'image' || previewKind === 'file' || previewKind === 'inline') {
    if (isImageDriveFile(file)) return 'image';
    if (isVideoDriveFile(file)) return 'video';
    if (isAudioDriveFile(file)) return 'audio';
  }
  if (previewKind === 'video') return 'video';
  if (previewKind === 'audio') return 'audio';
  if (isImageDriveFile(file) && !isVideoDriveFile(file)) return 'image';
  if (isVideoDriveFile(file)) return 'video';
  if (isAudioDriveFile(file)) return 'audio';
  const name = (file.name || file.original_name || '').toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|heic|avif|svg|ico)$/i.test(name)) return 'image';
  if (/\.(mp4|mov|mkv|webm|avi|m4v|3gp|ogv)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(name)) return 'audio';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.zip$/i.test(name)) return 'zip';
  if (/\.(json|jsonc|json5|jsonl|txt|text|md|markdown|mdx|rst|csv|tsv|log|xml|ya?ml|ini|cfg|conf|config|properties|env|toml|plist|html?|xhtml|css|scss|sass|less|jsx?|mjs|cjs|tsx?|vue|svelte|astro|py|pyi|rb|php|pl|sh|bash|zsh|ps1|bat|cmd|lua|r|jl|exs?|java|kt|kts|swift|dart|go|rs|c|cc|cpp|cxx|h|hh|hpp|cs|fsx?|sql|prisma|graphql|gql|proto|tf|hcl|nix|diff|patch|dockerfile|makefile|cmake|docx|odt|rtf|xlsx|ods|pptx|odp)$/i.test(name)) return 'text';
  return 'other';
}

export function formatQualitySize(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '';
  return formatDriveBytes(value);
}

export function sanitizeQualityLabel(raw: unknown, id?: string, height?: number | null): string {
  const value = String(raw || '').trim();
  const idValue = String(id || '').toLowerCase();
  if (/^auto/i.test(idValue) || /^otomatis$/i.test(value)) return i18n.t('drive.auto_mode_label');
  if (/^original/i.test(idValue) || /^asli$/i.test(value)) return 'Asli';
  if (height != null && Number.isFinite(height) && height >= 144) return `${Math.round(height)}p`;
  const heightLabel = value.match(/^(\d{3,4})\s*p$/i);
  if (heightLabel) return `${heightLabel[1]}p`;
  const idHeight = idValue.match(/^p?(\d{3,4})$/);
  if (idHeight && Number(idHeight[1]) >= 144) return `${idHeight[1]}p`;
  if (!value || /^(\d{1,2})\s*p$/i.test(value) || value.length < 2) {
    if (idValue === 'auto') return 'Otomatis';
    if (idValue === 'original') return 'Asli';
    return value || 'Otomatis';
  }
  return value;
}

export function normalizePlayQualities(list: PlayQuality[]): PlayQuality[] {
  return (list || []).map((quality) => ({
    ...quality,
    label: sanitizeQualityLabel(quality.label, quality.id, quality.height),
  }));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
