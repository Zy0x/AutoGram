import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useModalBackHandler } from '../../../lib/platform/modalBackStack';
import {
  Link2,
  X,
  Loader2,
  Home,
  Folder,
  Megaphone,
  Users,
  Bot,
  MessageSquare,
  Hash,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Music,
  Archive,
  FileText,
  FileCode,
  CheckCircle2,
  Check,
  CheckCheck,
  CheckSquare,
  Square,
  XCircle,
  LayoutGrid,
  List,
  Layers,
  Sparkles,
  Zap,
  Info,
  KeyRound,
  Search,
  Play,
  Clock,
  HardDrive,
  Pencil,
  RotateCcw,
  RefreshCw,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  User,
  SlidersHorizontal,
} from 'lucide-react';
import type { DriveDestChoice, DriveDestPickerState } from './DriveDestinationPicker';
import { DriveDestinationPicker } from './DriveDestinationPicker';
import type { DriveCredentials } from '../../../lib/telegram/driveApi/driveApiUtils';
import { driveListTopics } from '../../../lib/telegram/driveApi/driveFoldersApi';
import { PeerAvatar } from '../Navigation/sidebarUtils';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../lib/tauri/platform';
import { nativeReadClipboardText } from '../../../lib/tauri/desktopClipboard';
import {
  resolveRemoteMediaUrl,
  parseRemoteShareInput,
  type ResolvedMediaInfo,
  type StreamQualityFormat,
  type ResolvedMediaItem,
} from '../../../lib/telegram/linkResolvers';
import { isRemoteUrlSafetyError } from '../../../lib/telegram/linkResolvers/urlSafety';
import {
  type DriveTransferSettings,
  resolveDefaultDeliveryMode,
} from '../Transfers/transferSettingsModel';
import type { RemoteEngineMode, StorageLocalPolicy } from '../../../lib/telegram/driveTypes';

interface RemoteUploadModalProps {
  isOpen: boolean;
  initialUrl?: string;
  onClose: () => void;
  destinations: DriveDestChoice[];
  currentDestination?: DriveDestChoice;
  creds?: DriveCredentials | null;
  transferSettings?: DriveTransferSettings | null;
  onUpload: (
    urls: string | string[],
    destination: DriveDestChoice,
    opts?: {
      customFilename?: string;
      customFilenames?: string[];
      sourceSizes?: number[];
      thumbnailUrls?: string[];
      asDocument?: boolean;
      qualityMode?: string;
      presentationOverride?: 'document' | 'original' | 'standard' | 'compressed';
      remoteEngineMode?: RemoteEngineMode;
      storagePolicy?: StorageLocalPolicy;
      customDiskPath?: string;
    }
  ) => Promise<boolean | void>;
}

type RemoteUploadTab = 'single' | 'batch';
type DeliveryMode = 'auto' | 'uncompressed' | 'document';
type UrlKind = 'video' | 'image' | 'profile' | 'story' | 'audio' | 'zip' | 'doc' | 'other' | 'unsupported';

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').replace(/[\r\n\t]+/g, ' ').trim();
}

interface UrlInspection {
  url: string;
  status: 'idle' | 'inspecting' | 'valid' | 'direct_stream' | 'error';
  filename: string;
  size?: number | null;
  mimeType?: string | null;
  kind: UrlKind;
  error?: string | null;
}

function inferKindFromExt(ext: string): UrlKind {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'm4v', '3gp', 'ts'].includes(e)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tiff'].includes(e)) return 'image';
  if (['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac', 'opus', 'wma'].includes(e)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'iso', 'bz2', 'tgz'].includes(e)) return 'zip';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub'].includes(e)) return 'doc';
  if (!e || e.length > 8 || !/^[a-z0-9]+$/i.test(e)) return 'unsupported';
  return 'other';
}

function inferFilenameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    const pathSeg = u.pathname.split('/').filter(Boolean).pop();
    if (pathSeg) {
      const decoded = decodeURIComponent(pathSeg);
      if (decoded.trim()) return decoded.trim();
    }
    return u.hostname || 'remote_file.bin';
  } catch {
    const clean = rawUrl.trim().split('?')[0].split('#')[0];
    const seg = clean.split(/[/\\]/).filter(Boolean).pop();
    return seg || 'remote_file.bin';
  }
}

function kindIcon(c: DriveDestChoice) {
  if (c.kind === 'saved') return <Home size={16} />;
  if (c.kind === 'drive') return <Folder size={16} />;
  if (c.isForum) return <Hash size={16} />;
  if (c.type === 'group' || c.type === 'supergroup') return <Users size={16} />;
  if (c.type === 'channel') return <Megaphone size={16} />;
  if (c.type === 'bot') return <Bot size={16} />;
  return <MessageSquare size={16} />;
}

function fileKindIcon(kind: UrlKind) {
  switch (kind) {
    case 'video':
      return <Film size={18} />;
    case 'image':
      return <ImageIcon size={18} />;
    case 'profile':
      return <User size={18} />;
    case 'story':
      return <Sparkles size={18} />;
    case 'audio':
      return <Music size={18} />;
    case 'zip':
      return <Archive size={18} />;
    case 'doc':
      return <FileText size={18} />;
    default:
      return <FileCode size={18} />;
  }
}

function renderBadge(c: DriveDestChoice, t: any) {
  if (c.kind === 'saved') {
    return <span className="td-dest-badge saved">{t('drive.dest_badge_saved')}</span>;
  }
  if (c.isForum) {
    return <span className="td-dest-badge forum">{t('drive.dest_badge_forum')}</span>;
  }
  if (c.kind === 'drive') {
    return <span className="td-dest-badge td">{t('drive.dest_badge_drive')}</span>;
  }
  if (c.type === 'group' || c.type === 'supergroup') {
    return <span className="td-dest-badge group">{t('drive.dest_badge_group')}</span>;
  }
  if (c.type === 'channel') {
    return <span className="td-dest-badge channel">{t('drive.dest_badge_channel')}</span>;
  }
  if (c.type === 'bot') {
    return <span className="td-dest-badge bot">{t('drive.dest_badge_bot')}</span>;
  }
  return <span className="td-dest-badge user">{t('drive.dest_badge_user')}</span>;
}

function getFormatDisplayLabel(
  fmt: StreamQualityFormat,
  resolvedMedia: ResolvedMediaInfo | null,
  t: any
): string {
  if (fmt.isSubtitle) {
    return fmt.label;
  }
  if (fmt.id === 'tiktok_profile_avatar') {
    return t('drive.remote_fmt_creator_avatar');
  }
  if (fmt.id === 'tiktok_photo_all_pack' || (fmt.isAlbumPack && resolvedMedia?.platform === 'tiktok')) {
    const total = resolvedMedia?.albumImages?.length || '';
    return t('drive.remote_fmt_album_pack', { total });
  }
  if (fmt.id === 'pikpak_all_files_pack') {
    const count = resolvedMedia?.totalItems || resolvedMedia?.formats.filter((f) => !f.isAlbumPack).length || 0;
    const sizeStr = fmt.filesizeBytes ? ` ~${formatDriveBytes(fmt.filesizeBytes)}` : '';
    return t('drive.remote_pikpak_batch_pack', { count, size: sizeStr });
  }
  if (fmt.id === 'streamrizz_all_files_pack') {
    const count = resolvedMedia?.totalItems || resolvedMedia?.formats.filter((f) => !f.isAlbumPack).length || 0;
    const sizeStr = fmt.filesizeBytes ? ` ~${formatDriveBytes(fmt.filesizeBytes)}` : '';
    return t('drive.remote_streamrizz_batch_pack', { count, size: sizeStr });
  }
  if (fmt.id.startsWith('tiktok_photo_')) {
    const total = resolvedMedia?.albumImages?.length || 1;
    const match = fmt.id.match(/photo_(\d+)/);
    if (match && match[1]) {
      const idx = parseInt(match[1], 10);
      if (total <= 1) {
        return t('drive.remote_fmt_single_photo');
      }
      return t('drive.remote_fmt_slide_photo', { idx, total });
    }
  }
  if (fmt.label === 'remote_web_page_handoff') {
    return t('drive.remote_web_page_handoff');
  }
  return fmt.label;
}

function getFormatDisplayBadge(fmt: StreamQualityFormat, t: any): string | undefined {
  if (fmt.isCleanNoWatermark) {
    return t('drive.remote_clean_no_watermark');
  }
  if (fmt.badge === 'remote_web_page') {
    return t('drive.remote_web_page_badge');
  }
  if (fmt.badge === 'PASSCODE ERROR') {
    return t('drive.remote_passcode_invalid_badge');
  }
  if (fmt.badge === 'PASSWORD PROTECTED') {
    return t('drive.remote_passcode_required_badge');
  }
  if (!fmt.badge) return undefined;
  // Suppress duplicate badges that repeat the title/label text
  const normBadge = fmt.badge.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normLabel = (fmt.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normBadge && normLabel && (normBadge === normLabel || normLabel.includes(normBadge))) {
    if (fmt.resolution && !normLabel.includes(fmt.resolution.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      return fmt.resolution;
    }
    return undefined;
  }
  return fmt.badge;
}

function getBadgeModifierClass(badgeText?: string): string {
  if (!badgeText) return '';
  const b = badgeText.toUpperCase();
  if (b.includes('SUBTITLE') || b.includes('SRT') || b.includes('VTT')) return 'badge-subtitle';
  if (b.includes('HDR') || b.includes('VISION') || b.includes('DOLBY') || b.includes('8K')) return 'badge-hdr';
  if (b.includes('60FPS') || b.includes('120FPS') || b.includes('60 FPS') || b.includes('60P') || b.includes('FPS')) return 'badge-fps';
  if (b.includes('KBPS') || b.includes('AUDIO') || b.includes('HI-RES') || b.includes('OPUS') || b.includes('SAVER') || b.includes('AAC')) return 'badge-audio';
  if (b.includes('SD') || b.includes('480P') || b.includes('360P')) return 'badge-saver';
  return '';
}

export type BatchQualityPreference = 'best' | '1080p' | '720p' | 'audio';

function selectFormatByPreference(formats?: StreamQualityFormat[], pref?: BatchQualityPreference): StreamQualityFormat | undefined {
  if (!formats || formats.length === 0) return undefined;
  const p = pref || '1080p';
  if (p === 'audio') {
    const audioFmt = formats.find((f) => f.isAudio || f.qualityTier === 'audio');
    if (audioFmt) return audioFmt;
  }
  if (p === '720p') {
    const p720 = formats.find((f) => f.qualityTier === '720p' || f.resolution?.includes('720'));
    if (p720) return p720;
  }
  if (p === '1080p') {
    const p1080 = formats.find((f) => f.qualityTier === '1080p' || f.resolution?.includes('1080'));
    if (p1080) return p1080;
  }
  if (p === 'best') {
    const top =
      formats.find((f) => f.qualityTier === '8k') ||
      formats.find((f) => f.qualityTier === '4k') ||
      formats.find((f) => f.qualityTier === '2k') ||
      formats.find((f) => f.qualityTier === '1080p') ||
      formats.find((f) => f.isVideo) ||
      formats[0];
    if (top) return top;
  }
  return formats.find((f) => f.qualityTier === '1080p') || formats[0];
}

const KNOWN_MEDIA_EXTENSIONS = new Set([
  'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', '3gp', 'ts',
  'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma',
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'heic',
  'zip', 'rar', '7z', 'tar', 'gz',
  'pdf', 'doc', 'docx', 'txt', 'epub',
]);

function hasKnownMediaExtension(name: string, ext?: string): boolean {
  const clean = (name || '').trim();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const candidateExt = clean.slice(lastDot + 1).trim().toLowerCase();
  if (ext && candidateExt === ext.toLowerCase().replace(/^\./, '')) return true;
  return KNOWN_MEDIA_EXTENSIONS.has(candidateExt);
}

function getEffectiveFormatFilename(
  fmt?: StreamQualityFormat,
  resolved?: ResolvedMediaInfo | null,
  fallbackExt?: string
): string {
  if (!resolved && !fmt) return '';
  if (fmt?.customFilename) return fmt.customFilename;
  const rawTitle = sanitizeFilename(fmt?.customTitle || resolved?.title || '').trim();
  const targetExt = (fmt?.ext || fallbackExt || 'mp4').toLowerCase().replace(/^\./, '');
  if (!rawTitle) return `remote_file.${targetExt}`;
  if (hasKnownMediaExtension(rawTitle, targetExt)) {
    return rawTitle;
  }
  return `${rawTitle}.${targetExt}`;
}

function formatMediaDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Splits a full filename into base name and extension.
 * Only strips extension if it matches target ext or is a recognized media format extension.
 * Prevents mangling titles containing dots (e.g. "Kenapa Lu Harus Punya Mini PC.. ft. GEEKOM").
 */
function splitFilenameAndExt(fullFilename: string, fallbackExt: string): { base: string; ext: string } {
  const clean = (fullFilename || '').trim();
  const cleanFallback = (fallbackExt || 'mp4').toLowerCase().replace(/^\./, '');
  const lastDot = clean.lastIndexOf('.');

  if (lastDot > 0) {
    const candidateExt = clean.slice(lastDot + 1).trim().toLowerCase();
    // Only treat as extension if it matches fallback or a recognized media format
    if (/^[a-z0-9]{1,6}$/.test(candidateExt)) {
      if (candidateExt === cleanFallback || KNOWN_MEDIA_EXTENSIONS.has(candidateExt)) {
        return {
          base: clean.slice(0, lastDot).trim(),
          ext: candidateExt,
        };
      }
    }
  }

  return {
    base: clean || 'unnamed_media',
    ext: cleanFallback,
  };
}

/**
 * Robust sanitizer and normalizer for filenames:
 * 1. Sanitizes invalid filesystem and cloud characters (\ / : * ? " < > |)
 * 2. Strips only trailing media extensions typed by user (e.g. .mp4, .mp4.mp4), not dots in title text (e.g. ft., vs.)
 * 3. Enforces the true target format extension
 */
function sanitizeAndNormalizeFilename(userInput: string, targetExt: string): string {
  let name = (userInput || '').trim();
  // 1. Replace illegal filesystem / cloud characters
  name = name.replace(/[\\/:*?"<>|]/g, '_').trim();

  const cleanTargetExt = (targetExt || 'mp4').toLowerCase().replace(/^\./, '');

  // 2. Strip only trailing matching or known media extensions
  let changed = true;
  while (changed) {
    changed = false;
    const lastDot = name.lastIndexOf('.');
    if (lastDot > 0) {
      const candidateExt = name.slice(lastDot + 1).trim().toLowerCase();
      if (candidateExt === cleanTargetExt || KNOWN_MEDIA_EXTENSIONS.has(candidateExt)) {
        name = name.slice(0, lastDot).trim();
        changed = true;
      }
    }
  }

  // 3. Fallback if empty after stripping
  if (!name) {
    name = 'media';
  }

  // 4. Always attach the true target extension
  return `${name}.${cleanTargetExt}`;
}

interface UnifiedBadgeInfo {
  text: string;
  tierClass: string;
}

function getSingleUnifiedBadgeInfo(
  item: ResolvedMediaItem,
  knownRes?: { width: number; height: number }
): UnifiedBadgeInfo | null {
  const fmt = item.formats[0];
  if (!fmt) {
    if (item.kind === 'image') return { text: 'PHOTO', tierClass: 'tier-photo' };
    if (item.kind === 'profile') return { text: 'AVATAR', tierClass: 'tier-profile' };
    if (item.kind === 'story') return { text: 'STORY', tierClass: 'tier-story' };
    if (item.kind === 'audio') return { text: 'AUDIO', tierClass: 'tier-audio' };
    return null;
  }

  const ext = (fmt.ext || '').toLowerCase();

  // Extract dimensions from probe, badge, or format resolution
  let width = knownRes?.width;
  let height = knownRes?.height;

  if (!width || !height) {
    const dimMatch = (fmt.badge || fmt.resolution || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (dimMatch) {
      width = parseInt(dimMatch[1], 10);
      height = parseInt(dimMatch[2], 10);
    }
  }

  // Profile / Avatar Kind
  if (item.kind === 'profile') {
    if (width && height && width > 0 && height > 0) {
      const minDim = Math.min(width, height);
      const maxDim = Math.max(width, height);
      const dimStr = `${width}×${height}`;
      if (minDim >= 1000 || maxDim >= 1900) {
        return { text: `FHD AVATAR · ${dimStr}`, tierClass: 'tier-profile' };
      }
      if (minDim >= 700 || maxDim >= 1200) {
        return { text: `HD AVATAR · ${dimStr}`, tierClass: 'tier-profile' };
      }
      return { text: `AVATAR · ${dimStr}`, tierClass: 'tier-profile' };
    }
    return { text: 'AVATAR', tierClass: 'tier-profile' };
  }

  // Story / Ephemeral Post Kind
  if (item.kind === 'story') {
    if (width && height && width > 0 && height > 0) {
      const minDim = Math.min(width, height);
      const maxDim = Math.max(width, height);
      const dimStr = `${width}×${height}`;
      if (minDim >= 2160 || maxDim >= 3840) {
        return { text: `4K STORY · ${dimStr}`, tierClass: 'tier-story' };
      }
      if (minDim >= 1440 || maxDim >= 2560) {
        return { text: `2K STORY · ${dimStr}`, tierClass: 'tier-story' };
      }
      if (minDim >= 1000 || maxDim >= 1900) {
        return { text: `FHD STORY · ${dimStr}`, tierClass: 'tier-story' };
      }
      if (minDim >= 700 || maxDim >= 1200) {
        return { text: `HD STORY · ${dimStr}`, tierClass: 'tier-story' };
      }
      return { text: `STORY · ${dimStr}`, tierClass: 'tier-story' };
    }
    return { text: 'STORY', tierClass: 'tier-story' };
  }

  // 1. Audio & Music Formats (Lossless, Hi-Res, Standard)
  const AUDIO_EXTS = new Set([
    'mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'alac', 'aiff', 'dsd', 'ape', 'mid', 'midi'
  ]);
  if (AUDIO_EXTS.has(ext) || item.kind === 'audio') {
    const text = ext && ext.length <= 5 ? ext.toUpperCase() : 'AUDIO';
    return { text, tierClass: 'tier-audio' };
  }

  // 2. Compressed Archives & Disk Images
  const ARCHIVE_EXTS = new Set([
    'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'img', 'dmg', 'bin', 'vhd', 'cab'
  ]);
  if (ARCHIVE_EXTS.has(ext)) {
    return { text: ext.toUpperCase(), tierClass: 'tier-archive' };
  }

  // 3. E-Books, Comics & Digital Readers
  const EBOOK_EXTS = new Set(['epub', 'mobi', 'azw3', 'cbr', 'cbz', 'fb2', 'djvu']);
  if (EBOOK_EXTS.has(ext)) {
    return { text: ext.toUpperCase(), tierClass: 'tier-doc' };
  }

  // 4. Documents & Office Files
  const DOC_EXTS = new Set([
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'rtf', 'odt', 'ods', 'odp'
  ]);
  if (DOC_EXTS.has(ext)) {
    return { text: ext.toUpperCase(), tierClass: 'tier-doc' };
  }

  // 5. App Installers & Executables
  const APP_EXTS = new Set(['apk', 'xapk', 'apkm', 'ipa', 'exe', 'msi', 'appimage', 'deb', 'rpm', 'pkg']);
  if (APP_EXTS.has(ext)) {
    return { text: ext.toUpperCase(), tierClass: 'tier-app' };
  }

  // 6. Code & Structured Data Files
  const CODE_EXTS = new Set(['json', 'xml', 'yaml', 'yml', 'sql', 'sqlite', 'db', 'js', 'ts', 'py', 'rs', 'html', 'css', 'cpp', 'c', 'java']);
  if (CODE_EXTS.has(ext)) {
    return { text: ext.toUpperCase(), tierClass: 'tier-code' };
  }

  // 7. Image & Graphics Formats (with full resolution tier classification)
  const IMAGE_EXTS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg', 'heic', 'heif', 'bmp', 'ico', 'tiff', 'tif', 'raw', 'cr2', 'nef', 'arw', 'dng', 'psd', 'ai', 'eps', 'tgs'
  ]);
  if (IMAGE_EXTS.has(ext) || fmt.isImage || item.kind === 'image') {
    const imgTag = ext === 'jpeg' ? 'JPG' : (ext ? ext.toUpperCase() : 'PHOTO');
    if (width && height && width > 0 && height > 0) {
      const minDim = Math.min(width, height);
      const maxDim = Math.max(width, height);
      const dimStr = `${width}×${height}`;

      if (minDim >= 4000 || maxDim >= 7000) {
        return { text: `8K UHD · ${dimStr}`, tierClass: 'tier-8k' };
      }
      if (minDim >= 2160 || maxDim >= 3840) {
        return { text: `4K UHD · ${dimStr}`, tierClass: 'tier-4k' };
      }
      if (minDim >= 1440 || maxDim >= 2560) {
        return { text: `2K QHD · ${dimStr}`, tierClass: 'tier-2k' };
      }
      if (minDim >= 1000 || maxDim >= 1900) {
        return { text: `FHD · ${dimStr}`, tierClass: 'tier-fhd' };
      }
      if (minDim >= 700 || maxDim >= 1200) {
        return { text: `HD · ${dimStr}`, tierClass: 'tier-hd' };
      }
      return { text: `${imgTag} · ${dimStr}`, tierClass: 'tier-photo' };
    }
    return { text: imgTag, tierClass: 'tier-photo' };
  }

  // 8. Video Dimension and Tier Formatter
  if (width && height && width > 0 && height > 0) {
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);
    const dimStr = `${width}×${height}`;

    if (minDim >= 4000 || maxDim >= 7000) {
      return { text: `8K · ${dimStr}`, tierClass: 'tier-8k' };
    }
    if (minDim >= 2160 || maxDim >= 3840) {
      return { text: `4K · ${dimStr}`, tierClass: 'tier-4k' };
    }
    if (minDim >= 1440 || maxDim >= 2560) {
      return { text: `2K · ${dimStr}`, tierClass: 'tier-2k' };
    }
    if (minDim >= 1000 || maxDim >= 1900) {
      return { text: `FHD · ${dimStr}`, tierClass: 'tier-fhd' };
    }
    if (minDim >= 700 || maxDim >= 1200) {
      return { text: `HD · ${dimStr}`, tierClass: 'tier-hd' };
    }

    // Non-HD (e.g. 480p, 360p, 540p)
    return { text: dimStr, tierClass: 'tier-sd' };
  }

  // If dimensions not yet probed, check if format has explicit tier
  const rawTier = fmt.qualityTier && fmt.qualityTier !== 'original'
    ? fmt.qualityTier.toUpperCase()
    : fmt.label?.toUpperCase().includes('8K')
      ? '8K'
      : fmt.label?.toUpperCase().includes('4K')
        ? '4K'
        : fmt.label?.toUpperCase().includes('2K')
          ? '2K'
          : fmt.label?.toUpperCase().includes('1080')
            ? 'FHD'
            : fmt.label?.toUpperCase().includes('720')
              ? 'HD'
              : null;

  if (rawTier) {
    const normTier = rawTier.toUpperCase() === '1080P' ? 'FHD' : rawTier.toUpperCase();
    const tierClass =
      normTier === '8K' ? 'tier-8k' :
      normTier === '4K' || normTier === 'UHD' ? 'tier-4k' :
      normTier === '2K' ? 'tier-2k' :
      normTier === 'FHD' ? 'tier-fhd' : 'tier-hd';
    return { text: normTier, tierClass };
  }

  // Fallback for general valid extension
  if (ext && ext.length >= 2 && ext.length <= 5 && /^[a-z0-9]+$/i.test(ext)) {
    return { text: ext.toUpperCase(), tierClass: 'tier-sd' };
  }

  // Unsupported / Unknown format
  if (item.kind === 'unsupported' || item.kind === 'other') {
    const text = ext && ext.length <= 6 ? ext.toUpperCase() : 'UNKNOWN';
    return { text, tierClass: 'tier-unsupported' };
  }

  return null;
}

function inferRawTierBadge(rawTier?: string, ext?: string): string {
  if (rawTier) {
    const norm = rawTier.toUpperCase();
    if (norm === '1080P' || norm === '1080') return '1080p FHD';
    if (norm === '720P' || norm === '720') return '720p HD';
    if (norm === '4K' || norm === 'UHD') return '4K UHD';
    if (norm === '8K') return '8K UHD';
    return norm;
  }
  if (ext) return ext.toUpperCase();
  return 'HD';
}

const ItemDurationBadge: React.FC<{
  item: ResolvedMediaItem;
  knownDuration?: number;
}> = ({ item, knownDuration }) => {
  // Scan all formats for any durationSec — not just index 0
  const fmtDur = item.formats.find((f) => f.durationSec && f.durationSec > 0)?.durationSec;
  const dur = knownDuration || item.durationSec || fmtDur;
  const formatted = formatMediaDuration(dur);
  if (!formatted) return null;

  return (
    <span className="td-remote-item-duration-badge">
      <Clock size={10} />
      <span>{formatted}</span>
    </span>
  );
};

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

interface BatchMediaCardProps {
  item: BatchMediaItem;
  isSelected: boolean;
  isFocused: boolean;
  itemDur?: number;
  onCardClick: (item: BatchMediaItem) => void;
  onCardDoubleClick: (item: BatchMediaItem) => void;
  onToggleItem: (id: string) => void;
  t: (key: string, options?: any) => string;
}

const BatchMediaCard = React.memo(function BatchMediaCard({
  item,
  isSelected,
  isFocused,
  itemDur,
  onCardClick,
  onCardDoubleClick,
  onToggleItem,
  t,
}: BatchMediaCardProps) {
  const extMatch = item.filename.match(/\.([a-zA-Z0-9]+)$/);
  const extName = extMatch ? extMatch[1].toUpperCase() : '';
  const baseName = extMatch ? item.filename.slice(0, extMatch.index) : item.filename;

  return (
    <div
      className={`td-remote-media-item-card card-grid-mode ${isSelected ? 'selected' : ''} ${isFocused ? 'is-active-preview' : ''}`}
      onClick={() => onCardClick(item)}
      onDoubleClick={() => onCardDoubleClick(item)}
    >
      <div className="td-remote-item-thumb-wrap">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            className="td-remote-item-thumb-img"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="td-remote-item-thumb-fallback">
            {item.isVideo ? <Film size={26} /> : <ImageIcon size={26} />}
          </div>
        )}

        {item.qualityBadge && (
          <span className="td-remote-item-quality-badge tier-fhd">
            {item.qualityBadge}
          </span>
        )}

        <button
          type="button"
          className={`td-remote-item-checkbox ${isSelected ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleItem(item.id);
          }}
          aria-label={isSelected ? t('drive_tools.remote_gallery_deselect_all') : t('drive_tools.remote_gallery_select_all')}
        >
          {isSelected && <Check size={9.5} strokeWidth={3.8} />}
        </button>
      </div>

      <div className="td-remote-item-card-body">
        <span className="td-remote-item-card-title" title={item.filename}>
          <span className="td-remote-title-base">{baseName}</span>
          {extName ? <span className="td-remote-title-ext">.{extName}</span> : null}
        </span>
        <div className="td-remote-card-meta-row">
          {item.filesizeBytes ? (
            <span className="td-remote-meta-size">
              ~{formatDriveBytes(item.filesizeBytes)}
            </span>
          ) : <span />}
          {itemDur ? (
            <span className="td-remote-item-duration-badge">
              <Clock size={10} />
              <span>{formatMediaDuration(itemDur)}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export function RemoteUploadModal({
  isOpen,
  initialUrl,
  onClose,
  destinations,
  currentDestination,
  creds,
  transferSettings,
  onUpload,
}: RemoteUploadModalProps) {
  const { t } = useTranslation();
  useModalBackHandler(isOpen, onClose, 'remote-upload-modal');
  const [tab, setTab] = useState<RemoteUploadTab>('single');
  const [url, setUrl] = useState('');
  const [passcode, setPasscode] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [batchUrlsText, setBatchUrlsText] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(() =>
    resolveDefaultDeliveryMode(transferSettings)
  );
  const [remoteEngineMode, setRemoteEngineMode] = useState<RemoteEngineMode>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('autogram_remote_engine_mode') : null;
    if (stored === 'cloud_fetch' || stored === 'storage_local') return stored as RemoteEngineMode;
    return transferSettings?.remoteEngineMode || 'auto';
  });
  const [storagePolicy, setStoragePolicy] = useState<StorageLocalPolicy>('telegram');
  const [customDiskPath, setCustomDiskPath] = useState<string>('');
  const [inspection, setInspection] = useState<UrlInspection | null>(null);

  const [resolvedMedia, setResolvedMedia] = useState<ResolvedMediaInfo | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('');
  const [streamContainerFilter, setStreamContainerFilter] = useState<'all' | 'mp4' | 'webm' | 'sd' | 'audio' | 'subtitle' | 'matrix'>('all');
  const [matrixSearchQuery, setMatrixSearchQuery] = useState<string>('');
  const [subtitleSearchQuery, setSubtitleSearchQuery] = useState<string>('');
  const [copiedStreamUrl, setCopiedStreamUrl] = useState<boolean>(false);
  const [isPlayingStream, setIsPlayingStream] = useState<boolean>(false);
  const [selectedMediaItemIds, setSelectedMediaItemIds] = useState<Set<string>>(new Set());
  const [itemSelectedFormats, setItemSelectedFormats] = useState<Record<string, string>>({});
  const [activePreviewItemId, setActivePreviewItemId] = useState<string>('');

  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  const [selectedDest, setSelectedDest] = useState<DriveDestChoice>(
    currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' }
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showSupportedInfo, setShowSupportedInfo] = useState(false);
  const [activeTripletInfo, setActiveTripletInfo] = useState<'delivery' | 'engine' | 'policy' | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);
  const tripletInfoRef = useRef<HTMLDivElement | null>(null);
  const previewSectionRef = useRef<HTMLDivElement | null>(null);

  const inspectAbortRef = useRef<AbortController | null>(null);
  const inspectTimerRef = useRef<number | null>(null);

  const [batchGroups, setBatchGroups] = useState<BatchUrlResultGroup[]>([]);
  const [batchInspecting, setBatchInspecting] = useState(false);
  const [batchInspectProgress, setBatchInspectProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [selectedBatchItemIds, setSelectedBatchItemIds] = useState<Set<string>>(new Set());
  const [focusedBatchItem, setFocusedBatchItem] = useState<BatchMediaItem | null>(null);
  const [batchFilterType, setBatchFilterType] = useState<'all' | 'video' | 'photo' | 'selected'>('all');
  const [batchSearchQuery, setBatchSearchQuery] = useState('');
  const [isEditingBatchText, setIsEditingBatchText] = useState(true);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [copiedUrlGroupId, setCopiedUrlGroupId] = useState<string | null>(null);
  const [batchItemDurations, setBatchItemDurations] = useState<Record<string, number>>({});
  const [batchPlayableUrl, setBatchPlayableUrl] = useState<string>('');
  const [batchQualityPreference, setBatchQualityPreference] = useState<BatchQualityPreference>('1080p');
  const batchInspectAbortRef = useRef<AbortController | null>(null);
  const batchClickTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const prevIsOpenRef = useRef(false);
  const lastAppliedInitialUrlRef = useRef('');
  const lastProbedHandoffRef = useRef('');
  useEffect(() => {
    const rawHandoff = String(initialUrl || '').trim();
    const { cleanUrl, extractedPasscode } = parseRemoteShareInput(rawHandoff);
    const normalizedInitialUrl = cleanUrl;
    const openedNow = isOpen && !prevIsOpenRef.current;
    const receivedNewHandoff = isOpen && normalizedInitialUrl !== lastAppliedInitialUrlRef.current;
    if (openedNow || receivedNewHandoff) {
      setTab('single');
      setUrl(normalizedInitialUrl);
      setPasscode(extractedPasscode || '');
      setCustomFilename('');
      setBatchUrlsText('');
      setBatchGroups([]);
      setBatchInspecting(false);
      setBatchInspectProgress({ current: 0, total: 0 });
      setSelectedBatchItemIds(new Set());
      setFocusedBatchItem(null);
      setBatchFilterType('all');
      setCollapsedGroupIds(new Set());
      setIsEditingBatchText(true);
      setDeliveryMode(resolveDefaultDeliveryMode(transferSettings));
      const storedEngine = typeof localStorage !== 'undefined' ? localStorage.getItem('autogram_remote_engine_mode') : null;
      setRemoteEngineMode(storedEngine === 'cloud_fetch' || storedEngine === 'storage_local'
        ? storedEngine
        : (transferSettings?.remoteEngineMode || 'auto'));
      setInspection(null);
      setResolvedMedia(null);
      setSelectedFormatId('');
      setStreamContainerFilter('all');
      setMatrixSearchQuery('');
      setSubtitleSearchQuery('');
      setSelectedMediaItemIds(new Set());
      setItemSelectedFormats({});
      setGallerySearch('');
      setActiveSlideIndex(0);
      setSelectedDest(currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' });
      setErrorMsg('');
      setPickerOpen(false);
      lastAppliedInitialUrlRef.current = normalizedInitialUrl;
    }
    if (!isOpen) {
      lastAppliedInitialUrlRef.current = '';
      lastProbedHandoffRef.current = '';
      setPasscode('');
      setStreamContainerFilter('all');
      setMatrixSearchQuery('');
      setSubtitleSearchQuery('');
      setSelectedMediaItemIds(new Set());
      setItemSelectedFormats({});
      setGallerySearch('');
      setBatchGroups([]);
      setSelectedBatchItemIds(new Set());
      setFocusedBatchItem(null);
      setBatchSearchQuery('');
      setBatchItemDurations({});
      setBatchPlayableUrl('');
      setCopiedUrlGroupId(null);
      setCollapsedGroupIds(new Set());
      batchClickTimersRef.current.forEach((t) => clearTimeout(t));
      batchClickTimersRef.current.clear();
      setIsEditingBatchText(true);
      if (batchInspectAbortRef.current) {
        batchInspectAbortRef.current.abort();
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, currentDestination, initialUrl, transferSettings]);

  useEffect(() => {
    if (
      isOpen &&
      selectedDest.isForum &&
      selectedDest.id != null &&
      selectedDest.topicId != null &&
      (!selectedDest.topicName ||
        selectedDest.topicName.startsWith('Topik #') ||
        selectedDest.topicName.startsWith('Topic #') ||
        selectedDest.topicName.startsWith('Topik ')) &&
      creds
    ) {
      let active = true;
      driveListTopics(creds, selectedDest.id)
        .then((res) => {
          if (!active || !res?.topics) return;
          const found = res.topics.find((t: any) => Number(t.id) === Number(selectedDest.topicId));
          if (found?.title) {
            setSelectedDest((prev) => {
              if (Number(prev.topicId) === Number(selectedDest.topicId)) {
                return { ...prev, topicName: found.title };
              }
              return prev;
            });
          }
        })
        .catch(() => {
          /* fallback */
        });
      return () => {
        active = false;
      };
    }
  }, [isOpen, selectedDest.id, selectedDest.topicId, selectedDest.isForum, selectedDest.topicName, creds]);

  useEffect(() => {
    if (!isOpen || pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeTripletInfo) {
          setActiveTripletInfo(null);
          return;
        }
        if (showSupportedInfo) {
          setShowSupportedInfo(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, pickerOpen, showSupportedInfo, activeTripletInfo, onClose]);

  useEffect(() => {
    if (!showSupportedInfo && !activeTripletInfo) return;
    const onDocClick = (e: MouseEvent | PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (showSupportedInfo && infoRef.current && !infoRef.current.contains(target as Node)) {
        setShowSupportedInfo(false);
      }
      if (activeTripletInfo && tripletInfoRef.current && !tripletInfoRef.current.contains(target as Node)) {
        if (target && target.closest('.td-remote-col-info-btn')) {
          return;
        }
        setActiveTripletInfo(null);
      }
    };
    document.addEventListener('pointerdown', onDocClick, true);
    return () => document.removeEventListener('pointerdown', onDocClick, true);
  }, [showSupportedInfo, activeTripletInfo]);

  const probeUrl = useCallback(async (rawUrl: string, explicitPasscode?: string) => {
    if (inspectAbortRef.current) {
      inspectAbortRef.current.abort();
      inspectAbortRef.current = null;
    }

    const { cleanUrl, extractedPasscode } = parseRemoteShareInput(rawUrl);
    const activePasscode = explicitPasscode !== undefined ? explicitPasscode : (extractedPasscode || passcode);

    const trimmed = cleanUrl.trim();
    if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))) {
      setInspection(null);
      setResolvedMedia(null);
      return;
    }

    const baseName = inferFilenameFromUrl(trimmed);
    const dotIdx = baseName.lastIndexOf('.');
    const ext = dotIdx > 0 ? baseName.slice(dotIdx + 1) : '';
    const inferredKind = inferKindFromExt(ext);

    setInspection({
      url: trimmed,
      status: 'inspecting',
      filename: baseName,
      size: null,
      mimeType: null,
      kind: inferredKind,
    });

    const controller = new AbortController();
    inspectAbortRef.current = controller;

    try {
      const resolved = await resolveRemoteMediaUrl(trimmed, controller.signal, {
        passcode: activePasscode,
      });
      if (resolved) {
        setResolvedMedia(resolved);
        setSelectedFormatId(resolved.selectedFormatId || resolved.formats[0]?.id || '');
        setActiveSlideIndex(0);

        const bestFmt =
          resolved.formats.find((f) => f.id === resolved.selectedFormatId) || resolved.formats[0];
        const resName = getEffectiveFormatFilename(bestFmt, resolved, ext) || baseName;

        setInspection({
          url: trimmed,
          status: 'valid',
          filename: resName,
          size: bestFmt?.filesizeBytes || null,
          mimeType: bestFmt?.isVideo
            ? 'video/mp4'
            : bestFmt?.isAudio
              ? 'audio/mp3'
              : bestFmt?.isImage
                ? 'image/jpeg'
                : null,
          kind: bestFmt?.isVideo
            ? 'video'
            : bestFmt?.isAudio
              ? 'audio'
              : bestFmt?.isImage
                ? 'image'
                : inferKindFromExt(bestFmt?.ext || ext),
        });
        return;
      }
    } catch (error) {
      if (isRemoteUrlSafetyError(error)) {
        setResolvedMedia(null);
        setInspection({
          url: trimmed,
          status: 'error',
          filename: baseName,
          size: null,
          mimeType: null,
          kind: inferredKind,
        });
        setErrorMsg(t('drive.remote_err_private_target'));
        return;
      }
      /* Unknown-provider failures may still use the bounded HEAD fallback. */
    }

    try {
      const resp = await fetch(trimmed, {
        method: 'HEAD',
        signal: controller.signal,
      });

      if (resp.ok) {
        const ctype = resp.headers.get('content-type') || '';
        const clen = resp.headers.get('content-length');
        const sizeNum = clen ? parseInt(clen, 10) : null;
        const cd = resp.headers.get('content-disposition') || '';

        let fname = baseName;
        const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        if (cdMatch && cdMatch[1]) {
          fname = decodeURIComponent(cdMatch[1]);
        }

        let kind = inferredKind;
        if (ctype.startsWith('video/')) kind = 'video';
        else if (ctype.startsWith('image/')) kind = 'image';
        else if (ctype.startsWith('audio/')) kind = 'audio';
        else if (ctype.includes('zip') || ctype.includes('compressed')) kind = 'zip';
        else if (ctype.includes('pdf') || ctype.includes('document')) kind = 'doc';

        setInspection({
          url: trimmed,
          status: 'valid',
          filename: fname,
          size: sizeNum && !isNaN(sizeNum) ? sizeNum : null,
          mimeType: ctype || null,
          kind,
        });
      } else {
        setInspection({
          url: trimmed,
          status: 'direct_stream',
          filename: baseName,
          size: null,
          mimeType: null,
          kind: inferredKind,
        });
      }
    } catch {
      setInspection({
        url: trimmed,
        status: 'direct_stream',
        filename: baseName,
        size: null,
        mimeType: null,
        kind: inferredKind,
      });
    }
  }, [passcode, t]);

  useEffect(() => {
    const handoff = String(initialUrl || '').trim();
    if (
      !isOpen ||
      !handoff ||
      url.trim() !== handoff ||
      lastProbedHandoffRef.current === handoff
    ) return;
    lastProbedHandoffRef.current = handoff;
    const { cleanUrl, extractedPasscode } = parseRemoteShareInput(handoff);
    if (extractedPasscode) setPasscode(extractedPasscode);
    void probeUrl(cleanUrl, extractedPasscode);
  }, [initialUrl, isOpen, probeUrl, url]);

  const handleOpenInBrowser = async (targetUrl?: string) => {
    const raw = (targetUrl || url || '').trim();
    if (!raw) return;
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(raw);
    } catch {
      if (typeof window !== 'undefined') {
        window.open(raw, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleUrlChange = (val: string) => {
    const { cleanUrl, extractedPasscode } = parseRemoteShareInput(val);
    setUrl(cleanUrl);
    setPasscode(extractedPasscode || '');
    if (errorMsg) setErrorMsg('');

    if (inspectTimerRef.current) {
      window.clearTimeout(inspectTimerRef.current);
    }
    inspectTimerRef.current = window.setTimeout(() => {
      probeUrl(cleanUrl, extractedPasscode);
    }, 280);
  };

  const handlePasscodeChange = (codeVal: string) => {
    setPasscode(codeVal);
    if (errorMsg) setErrorMsg('');

    if (inspectTimerRef.current) {
      window.clearTimeout(inspectTimerRef.current);
    }
    inspectTimerRef.current = window.setTimeout(() => {
      probeUrl(url, codeVal);
    }, 300);
  };

  const handlePasteClipboard = async () => {
    try {
      let text = await nativeReadClipboardText();
      if (!text || !text.trim()) {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          text = await navigator.clipboard.readText();
        }
      }
      if (!text || !text.trim()) return;
      const clean = text.trim();
      if (tab === 'single') {
        handleUrlChange(clean);
      } else {
        setBatchUrlsText((prev) => (prev ? `${prev}\n${clean}` : clean));
      }
    } catch {
      /* clipboard read fallback */
    }
  };

  const batchUrls = useMemo(() => {
    return batchUrlsText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('http://') || s.startsWith('https://'));
  }, [batchUrlsText]);

  const pickerState = useMemo<DriveDestPickerState | null>(() => {
    if (!pickerOpen) return null;
    return {
      title: t('drive.remote_upload_select_target'),
      detail: t('drive.remote_upload_select_target_desc'),
      choices: destinations,
      creds,
      onConfirm: (choice: DriveDestChoice) => {
        setSelectedDest(choice);
        setPickerOpen(false);
      },
    };
  }, [pickerOpen, destinations, creds, t]);

  const cleanTargetDisplay = useMemo(() => {
    const raw = selectedDest.label || 'Saved Messages';
    const parts = raw.split(' › ');
    if (parts.length > 1) {
      return {
        title: parts[0].trim(),
        topicPill: parts.slice(1).join(' › ').trim(),
      };
    }
    if (selectedDest.topicName) {
      return {
        title: raw,
        topicPill: selectedDest.topicName,
      };
    }
    if (selectedDest.topicId != null && selectedDest.topicId > 0) {
      return {
        title: raw,
        topicPill: `Topik #${selectedDest.topicId}`,
      };
    }
    return {
      title: raw,
      topicPill: null,
    };
  }, [selectedDest.label, selectedDest.topicName, selectedDest.topicId]);

  const effectiveMediaItems: ResolvedMediaItem[] = useMemo(() => {
    if (!resolvedMedia) return [];
    if (resolvedMedia.mediaItems && resolvedMedia.mediaItems.length > 0) {
      return resolvedMedia.mediaItems;
    }
    return [];
  }, [resolvedMedia]);

  const [itemDurations, setItemDurations] = useState<Record<string, number>>({});
  const [itemResolutions, setItemResolutions] = useState<Record<string, { width: number; height: number }>>({});

  useEffect(() => {
    if (effectiveMediaItems.length > 0) {
      setSelectedMediaItemIds(new Set(effectiveMediaItems.map((item) => item.id)));
      const fmtMap: Record<string, string> = {};
      const durMap: Record<string, number> = {};
      for (const item of effectiveMediaItems) {
        fmtMap[item.id] = item.selectedFormatId || item.formats[0]?.id || '';
        // Scan ALL formats for a valid durationSec — some resolvers put it on non-first formats
        const itemDur =
          item.durationSec && item.durationSec > 0
            ? item.durationSec
            : item.formats.find((f) => f.durationSec && f.durationSec > 0)?.durationSec;
        if (itemDur) {
          durMap[item.id] = itemDur;
        }
      }
      setItemSelectedFormats(fmtMap);
      setItemDurations((prev) => ({ ...durMap, ...prev }));
      setActivePreviewItemId(effectiveMediaItems[0]?.id || '');
    } else {
      setSelectedMediaItemIds(new Set());
      setItemSelectedFormats({});
      setItemDurations({});
      setItemResolutions({});
      setActivePreviewItemId('');
    }
  }, [effectiveMediaItems]);


  useEffect(() => {
    if (resolvedMedia?.durationSec) {
      setItemDurations((prev) => ({
        ...prev,
        __main__: resolvedMedia.durationSec!,
      }));
    }
  }, [resolvedMedia?.durationSec]);

  // Probe single item duration & dimensions via Tauri local streaming proxy
  const probeSingleItemDuration = useCallback(async (item: ResolvedMediaItem) => {
    if (item.kind !== 'video') return;
    if (
      (itemDurations[item.id] && itemResolutions[item.id]) ||
      (item.durationSec && item.durationSec > 0 && itemResolutions[item.id])
    ) {
      return;
    }

    const fmt = item.formats.find((f) => f.directUrl) || item.formats[0];
    const rawUrl = fmt?.directUrl;
    if (!rawUrl) return;

    const referer =
      fmt.headers?.Referer ||
      (rawUrl.includes('overfetch.video') || rawUrl.includes('vidoy') || rawUrl.includes('streamrizz')
        ? 'https://streamrizz.com/'
        : rawUrl.includes('twimg.com') || rawUrl.includes('twitter.com') || rawUrl.includes('x.com')
        ? 'https://x.com/'
        : rawUrl.includes('tiktok.com') || rawUrl.includes('tiktokcdn.com')
        ? 'https://www.tiktok.com/'
        : undefined);

    let playUrl = rawUrl;
    if (detectTauriRuntime() && referer) {
      try {
        playUrl = await invoke<string>('get_remote_stream_proxy_url', { url: rawUrl, referer });
      } catch {
        playUrl = rawUrl;
      }
    }

    await new Promise<void>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.style.cssText =
        'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;opacity:0;';
      document.body.appendChild(video);

      let done = false;
      const tid = setTimeout(() => finish(), 4000);

      const finish = (durSec?: number, w?: number, h?: number) => {
        if (done) return;
        done = true;
        clearTimeout(tid);
        video.src = '';
        try {
          video.load();
        } catch (_) {}
        try {
          document.body.removeChild(video);
        } catch (_) {}

        if (durSec && isFinite(durSec) && durSec > 0) {
          const d = Math.round(durSec);
          setItemDurations((prev) => {
            if (prev[item.id] === d) return prev;
            return { ...prev, [item.id]: d };
          });
        }

        if (w && h && w > 0 && h > 0) {
          setItemResolutions((prev) => {
            const cur = prev[item.id];
            if (cur && cur.width === w && cur.height === h) return prev;
            return { ...prev, [item.id]: { width: w, height: h } };
          });
        }

        resolve();
      };

      video.addEventListener(
        'loadedmetadata',
        () => finish(video.duration, video.videoWidth, video.videoHeight),
        { once: true }
      );
      video.addEventListener('error', () => finish(), { once: true });
      video.src = playUrl;
      video.load();
    });
  }, [itemDurations, itemResolutions]);

  // Background duration loader: automatically probe video metadata across all effectiveMediaItems
  useEffect(() => {
    if (effectiveMediaItems.length === 0) return;

    let isCancelled = false;

    // Process with concurrency pool of 2
    const runQueue = async () => {
      const itemsToProbe = effectiveMediaItems.filter(
        (it) =>
          it.kind === 'video' &&
          (!itemDurations[it.id] || !itemResolutions[it.id]) &&
          (!it.durationSec || it.durationSec <= 0)
      );

      let index = 0;
      const worker = async () => {
        while (index < itemsToProbe.length && !isCancelled) {
          const current = itemsToProbe[index++];
          if (current) {
            await probeSingleItemDuration(current);
          }
        }
      };

      const concurrency = 2;
      const workers = Array.from({ length: Math.min(concurrency, itemsToProbe.length) }, () => worker());
      await Promise.all(workers);
    };

    runQueue();

    return () => {
      isCancelled = true;
    };
  }, [effectiveMediaItems, probeSingleItemDuration, itemDurations, itemResolutions]);


  const activePreviewItem = useMemo(() => {
    if (!effectiveMediaItems || effectiveMediaItems.length === 0) return null;
    return effectiveMediaItems.find((item) => item.id === activePreviewItemId) || effectiveMediaItems[0];
  }, [effectiveMediaItems, activePreviewItemId]);

  const activePreviewChosenFmtId = activePreviewItem
    ? itemSelectedFormats[activePreviewItem.id] || activePreviewItem.selectedFormatId || activePreviewItem.formats[0]?.id
    : '';
  const activePreviewChosenFmt = activePreviewItem?.formats.find((f) => f.id === activePreviewChosenFmtId) || activePreviewItem?.formats[0];

  const singleChosenFormat = useMemo(() => {
    return resolvedMedia?.formats.find((f) => f.id === selectedFormatId) || resolvedMedia?.formats[0];
  }, [resolvedMedia, selectedFormatId]);

  const targetMediaForPlayback = effectiveMediaItems.length > 1 ? activePreviewChosenFmt : singleChosenFormat;

  const [itemCustomNames, setItemCustomNames] = useState<Record<string, string>>({});
  const [isEditingActiveName, setIsEditingActiveName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');

  useEffect(() => {
    setIsEditingActiveName(false);
    setEditingNameValue('');
  }, [activePreviewItemId, resolvedMedia?.title]);

  const activeTargetExt = useMemo(() => {
    const activeChosenFmt = activePreviewItem
      ? activePreviewItem.formats.find(
          (f) => f.id === (itemSelectedFormats[activePreviewItem.id] || activePreviewItem.selectedFormatId)
        ) || activePreviewItem.formats[0]
      : resolvedMedia?.formats.find((f) => f.id === selectedFormatId) || resolvedMedia?.formats[0];
    return (activeChosenFmt?.ext || 'mp4').toLowerCase().replace(/^\./, '');
  }, [activePreviewItem, itemSelectedFormats, resolvedMedia, selectedFormatId]);

  const activeItemOriginalName = useMemo(() => {
    if (activePreviewItem) {
      const chosenFmtId = itemSelectedFormats[activePreviewItem.id] || activePreviewItem.selectedFormatId || activePreviewItem.formats[0]?.id;
      const chosenFmt = activePreviewItem.formats.find((f) => f.id === chosenFmtId) || activePreviewItem.formats[0];
      return getEffectiveFormatFilename(chosenFmt, resolvedMedia) || activePreviewItem.title || `media.${activeTargetExt}`;
    }
    if (resolvedMedia) {
      const chosenFmt = resolvedMedia.formats.find((f) => f.id === selectedFormatId) || resolvedMedia.formats[0];
      return getEffectiveFormatFilename(chosenFmt, resolvedMedia) || resolvedMedia.title || `media.${activeTargetExt}`;
    }
    return '';
  }, [activePreviewItem, itemSelectedFormats, resolvedMedia, selectedFormatId, activeTargetExt]);

  const activeItemCurrentName = useMemo(() => {
    let raw = '';
    if (activePreviewItem) {
      raw = itemCustomNames[activePreviewItem.id] || activeItemOriginalName;
    } else {
      raw = customFilename.trim() || activeItemOriginalName;
    }
    if (!raw) return '';
    const { base } = splitFilenameAndExt(raw, activeTargetExt);
    return `${base}.${activeTargetExt}`;
  }, [activePreviewItem, itemCustomNames, activeItemOriginalName, customFilename, activeTargetExt]);

  const isNameModified = useMemo(() => {
    return Boolean(activeItemCurrentName && activeItemCurrentName !== activeItemOriginalName);
  }, [activeItemCurrentName, activeItemOriginalName]);

  const saveCurrentEditingName = useCallback(() => {
    const normalized = sanitizeAndNormalizeFilename(editingNameValue, activeTargetExt);
    if (activePreviewItem) {
      setItemCustomNames((prev) => ({
        ...prev,
        [activePreviewItem.id]: normalized,
      }));
    } else {
      setCustomFilename(normalized);
    }
    setIsEditingActiveName(false);
  }, [editingNameValue, activeTargetExt, activePreviewItem]);

  const resetActiveName = useCallback(() => {
    if (activePreviewItem) {
      setItemCustomNames((prev) => {
        const next = { ...prev };
        delete next[activePreviewItem.id];
        return next;
      });
    } else {
      setCustomFilename('');
    }
    setIsEditingActiveName(false);
  }, [activePreviewItem]);

  const [activePlayableUrl, setActivePlayableUrl] = useState<string>('');

  useEffect(() => {
    const v = document.querySelector('.td-remote-active-player-video') as HTMLVideoElement | null;
    if (v && v.duration && isFinite(v.duration) && v.duration > 0) {
      const d = Math.round(v.duration);
      if (activePreviewItem) {
        setItemDurations((prev) => ({ ...prev, [activePreviewItem.id]: d }));
      }
    }
  }, [activePlayableUrl, activePreviewItem]);

  useEffect(() => {
    let isCancelled = false;
    const rawUrl = targetMediaForPlayback?.directUrl;
    if (!rawUrl) {
      setActivePlayableUrl('');
      return;
    }

    const referer = targetMediaForPlayback?.headers?.Referer || (
      rawUrl.includes('overfetch.video') || rawUrl.includes('vidoy') || rawUrl.includes('streamrizz')
        ? 'https://streamrizz.com/'
        : rawUrl.includes('twimg.com') || rawUrl.includes('twitter.com') || rawUrl.includes('x.com')
        ? 'https://x.com/'
        : rawUrl.includes('tiktok.com') || rawUrl.includes('tiktokcdn.com')
        ? 'https://www.tiktok.com/'
        : undefined
    );

    if (detectTauriRuntime() && referer) {
      invoke<string>('get_remote_stream_proxy_url', { url: rawUrl, referer })
        .then((proxied) => {
          if (!isCancelled) setActivePlayableUrl(proxied);
        })
        .catch(() => {
          if (!isCancelled) setActivePlayableUrl(rawUrl);
        });
    } else {
      setActivePlayableUrl(rawUrl);
    }

    return () => {
      isCancelled = true;
    };
  }, [targetMediaForPlayback?.directUrl, targetMediaForPlayback?.headers?.Referer]);

  const handleToggleItem = useCallback((itemId: string) => {
    setSelectedMediaItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleSelectAllItems = useCallback(() => {
    setSelectedMediaItemIds(new Set(effectiveMediaItems.map((item) => item.id)));
  }, [effectiveMediaItems]);

  const handleDeselectAllItems = useCallback(() => {
    setSelectedMediaItemIds(new Set());
  }, []);

  const clickTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const handleCardClick = useCallback((itemId: string) => {
    const existingTimer = clickTimersRef.current.get(itemId);
    if (existingTimer) {
      // 2nd click arrived within threshold! Cancel selection toggle and trigger double click stream preview
      clearTimeout(existingTimer);
      clickTimersRef.current.delete(itemId);
      setActivePreviewItemId(itemId);
      return;
    }

    const timer = setTimeout(() => {
      handleToggleItem(itemId);
      clickTimersRef.current.delete(itemId);
    }, 220);

    clickTimersRef.current.set(itemId, timer);
  }, [handleToggleItem]);

  const handleCardDoubleClick = useCallback((itemId: string) => {
    const existingTimer = clickTimersRef.current.get(itemId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      clickTimersRef.current.delete(itemId);
    }
    setActivePreviewItemId(itemId);
  }, []);

  useEffect(() => {
    return () => {
      clickTimersRef.current.forEach((t) => clearTimeout(t));
      clickTimersRef.current.clear();
    };
  }, []);

  const selectedItems = useMemo(() => {
    return effectiveMediaItems.filter((item) => selectedMediaItemIds.has(item.id));
  }, [effectiveMediaItems, selectedMediaItemIds]);

  const selectedBytes = useMemo(() => {
    return selectedItems.reduce((acc, item) => {
      const chosenFmtId = itemSelectedFormats[item.id] || item.selectedFormatId || item.formats[0]?.id;
      const chosenFmt = item.formats.find((f) => f.id === chosenFmtId) || item.formats[0];
      return acc + (chosenFmt?.filesizeBytes || 0);
    }, 0);
  }, [selectedItems, itemSelectedFormats]);

  const selectedRemoteSize = useMemo(() => {
    const active = resolvedMedia?.formats.find((f) => f.id === selectedFormatId) || resolvedMedia?.formats[0];
    return active?.filesizeBytes || inspection?.size || (tab === 'single' && selectedBytes > 0 ? selectedBytes : 0) || 0;
  }, [resolvedMedia, selectedFormatId, inspection?.size, tab, selectedBytes]);
  const autoRemoteEngine: RemoteEngineMode = selectedRemoteSize > 0 && selectedRemoteSize <= 20 * 1024 * 1024
    ? 'cloud_fetch'
    : 'storage_local';
  const effectiveRemoteEngine = remoteEngineMode === 'auto' ? autoRemoteEngine : remoteEngineMode;

  const [gallerySearch, setGallerySearch] = useState('');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'video' | 'image' | 'profile' | 'story' | 'audio' | 'zip' | 'doc' | 'unsupported'>('all');
  const [gallerySortBy, setGallerySortBy] = useState<'default' | 'name' | 'duration' | 'size'>('default');
  const [gallerySortOrder, setGallerySortOrder] = useState<'asc' | 'desc'>('asc');
  const [galleryViewMode, setGalleryViewMode] = useState<'grid' | 'list'>('grid');

  const filteredAndSortedItems = useMemo(() => {
    if (!effectiveMediaItems) return [];
    let list = [...effectiveMediaItems];

    if (galleryFilter === 'video') {
      list = list.filter((it) => it.kind === 'video');
    } else if (galleryFilter === 'image') {
      list = list.filter((it) => it.kind === 'image');
    } else if (galleryFilter === 'profile') {
      list = list.filter((it) => it.kind === 'profile');
    } else if (galleryFilter === 'story') {
      list = list.filter((it) => it.kind === 'story');
    } else if (galleryFilter === 'audio') {
      list = list.filter((it) => it.kind === 'audio');
    } else if (galleryFilter === 'zip') {
      list = list.filter((it) => it.kind === 'zip');
    } else if (galleryFilter === 'doc') {
      list = list.filter((it) => it.kind === 'doc');
    } else if (galleryFilter === 'unsupported') {
      list = list.filter((it) => it.kind === 'unsupported' || it.kind === 'other');
    }

    if (gallerySearch.trim()) {
      const q = gallerySearch.trim().toLowerCase();
      list = list.filter((it) => it.title.toLowerCase().includes(q));
    }

    if (gallerySortBy === 'name') {
      list.sort((a, b) =>
        gallerySortOrder === 'asc'
          ? a.title.localeCompare(b.title)
          : b.title.localeCompare(a.title)
      );
    } else if (gallerySortBy === 'duration') {
      list.sort((a, b) => {
        const durA = itemDurations[a.id] || a.durationSec || 0;
        const durB = itemDurations[b.id] || b.durationSec || 0;
        return gallerySortOrder === 'asc' ? durA - durB : durB - durA;
      });
    } else if (gallerySortBy === 'size') {
      list.sort((a, b) => {
        const szA = a.formats[0]?.filesizeBytes || 0;
        const szB = b.formats[0]?.filesizeBytes || 0;
        return gallerySortOrder === 'asc' ? szA - szB : szB - szA;
      });
    } else if (gallerySortBy === 'default') {
      if (gallerySortOrder === 'desc') {
        list.reverse();
      }
    }

    return list;
  }, [effectiveMediaItems, galleryFilter, gallerySearch, gallerySortBy, gallerySortOrder, itemDurations]);

  const handleSelectFormat = useCallback((fmt: StreamQualityFormat) => {
    setSelectedFormatId(fmt.id);
    if (isPlayingStream && fmt.directUrl) {
      setActivePlayableUrl(fmt.directUrl);
    }
    const newFilename = getEffectiveFormatFilename(fmt, resolvedMedia);
    setInspection((prev) =>
      prev
        ? {
            ...prev,
            filename: newFilename || prev.filename,
            size: fmt.filesizeBytes || prev.size,
            kind: fmt.isVideo
              ? 'video'
              : fmt.isAudio
                ? 'audio'
                : fmt.isImage
                  ? 'image'
                  : prev.kind,
          }
        : prev
    );
    const match = fmt.id.match(/photo_(\d+)/);
    if (match && match[1]) {
      const photoIdx = parseInt(match[1], 10) - 1;
      if (photoIdx >= 0 && (!resolvedMedia?.albumImages || photoIdx < resolvedMedia.albumImages.length)) {
        setActiveSlideIndex(photoIdx);
      }
    }
  }, [isPlayingStream, resolvedMedia]);

  const handleToggleFormat = useCallback((fmt: StreamQualityFormat) => {
    if (selectedFormatId === fmt.id) {
      setSelectedFormatId('');
      setInspection((prev) =>
        prev
          ? {
              ...prev,
              size: null,
            }
          : prev
      );
    } else {
      handleSelectFormat(fmt);
    }
  }, [selectedFormatId, handleSelectFormat]);

  const handlePlayFormat = useCallback((fmt: StreamQualityFormat) => {
    handleSelectFormat(fmt);
    setIsPlayingStream(true);
    if (fmt.directUrl) {
      setActivePlayableUrl(fmt.directUrl);
    }
  }, [handleSelectFormat]);

  const activeSlideUrl = useMemo(() => {
    const selFormat = resolvedMedia?.formats?.find((f) => f.id === selectedFormatId);
    if (selFormat?.isImage && selFormat.directUrl) {
      return selFormat.directUrl;
    }
    if (resolvedMedia?.albumImages && resolvedMedia.albumImages.length > 0) {
      return resolvedMedia.albumImages[activeSlideIndex] || resolvedMedia.albumImages[0];
    }
    return resolvedMedia?.thumbnailUrl || resolvedMedia?.authorAvatar || null;
  }, [resolvedMedia, selectedFormatId, activeSlideIndex]);

  const isSplitActive =
    Boolean(resolvedMedia || (inspection && url.trim().length > 0)) && tab === 'single';

  useEffect(() => {
    if (isSplitActive && previewSectionRef.current) {
      previewSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isSplitActive, resolvedMedia?.title]);

  const captureVideoCanvasThumbnail = (videoEl: HTMLVideoElement): string | null => {
    try {
      if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
      const canvas = document.createElement('canvas');
      const maxDim = 320;
      let w = videoEl.videoWidth;
      let h = videoEl.videoHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(videoEl, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      let isNonBlack = false;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] > 15 || data[i + 1] > 15 || data[i + 2] > 15) {
          isNonBlack = true;
          break;
        }
      }
      if (!isNonBlack) return null;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      return dataUrl && dataUrl.length > 50 ? dataUrl : null;
    } catch {
      return null;
    }
  };

  const probedItemIdsRef = useRef<Set<string>>(new Set());
  const isProbingRef = useRef<boolean>(false);
  const probeQueueRef = useRef<BatchMediaItem[]>([]);

  const processNextDurationProbe = useCallback(() => {
    if (isProbingRef.current || probeQueueRef.current.length === 0) return;
    const nextItem = probeQueueRef.current.shift();
    if (!nextItem) return;

    if (probedItemIdsRef.current.has(nextItem.id) || batchItemDurations[nextItem.id] || (nextItem.durationSec && nextItem.durationSec > 0)) {
      setTimeout(processNextDurationProbe, 40);
      return;
    }

    probedItemIdsRef.current.add(nextItem.id);
    isProbingRef.current = true;

    const rawUrl = nextItem.directUrl;
    if (!rawUrl) {
      isProbingRef.current = false;
      setTimeout(processNextDurationProbe, 40);
      return;
    }

    const referer =
      nextItem.headers?.Referer ||
      (rawUrl.includes('overfetch.video') || rawUrl.includes('vidoy') || rawUrl.includes('streamrizz')
        ? 'https://streamrizz.com/'
        : rawUrl.includes('twimg.com') || rawUrl.includes('twitter.com') || rawUrl.includes('x.com')
        ? 'https://x.com/'
        : rawUrl.includes('tiktok.com') || rawUrl.includes('tiktokcdn.com')
        ? 'https://www.tiktok.com/'
        : undefined);

    (async () => {
      let playUrl = rawUrl;
      if (detectTauriRuntime() && referer) {
        try {
          playUrl = await invoke<string>('get_remote_stream_proxy_url', { url: rawUrl, referer });
        } catch {
          playUrl = rawUrl;
        }
      }

      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.crossOrigin = 'anonymous';
      video.style.cssText =
        'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;opacity:0;';
      document.body.appendChild(video);

      let done = false;
      let tid: NodeJS.Timeout;
      const finish = (durSec?: number) => {
        if (done) return;
        done = true;
        clearTimeout(tid);

        // Try extracting visual thumbnail if missing
        if (!nextItem.thumbnailUrl) {
          const thumb = captureVideoCanvasThumbnail(video);
          if (thumb) {
            setBatchGroups((prev) =>
              prev.map((grp) => ({
                ...grp,
                items: grp.items.map((it) => (it.id === nextItem.id ? { ...it, thumbnailUrl: thumb } : it)),
              }))
            );
          }
        }

        video.src = '';
        try { video.load(); } catch (_) {}
        try { document.body.removeChild(video); } catch (_) {}
        if (durSec && isFinite(durSec) && durSec > 0) {
          const d = Math.round(durSec);
          setBatchItemDurations((prev) => {
            if (prev[nextItem.id] === d) return prev;
            return { ...prev, [nextItem.id]: d };
          });
        }
        isProbingRef.current = false;
        setTimeout(processNextDurationProbe, 120);
      };

      tid = setTimeout(() => finish(), 3500);
      video.onloadeddata = () => {
        if (video.duration && isFinite(video.duration) && video.duration > 0) {
          finish(video.duration);
        }
      };
      video.onloadedmetadata = () => {
        if (video.duration && isFinite(video.duration) && video.duration > 0) {
          finish(video.duration);
        }
      };
      video.onerror = () => finish();
      video.src = playUrl;
    })().catch(() => {
      isProbingRef.current = false;
      setTimeout(processNextDurationProbe, 120);
    });
  }, [batchItemDurations]);

  const queueDurationProbe = useCallback((item: BatchMediaItem) => {
    if (!item.isVideo || item.durationSec || batchItemDurations[item.id] || probedItemIdsRef.current.has(item.id)) return;
    probeQueueRef.current.push(item);
    processNextDurationProbe();
  }, [batchItemDurations, processNextDurationProbe]);

  const handleInspectBatchUrls = useCallback(async () => {
    if (!batchUrls.length) {
      setErrorMsg(t('drive.remote_err_no_batch_urls'));
      return;
    }
    setErrorMsg('');
    if (batchInspectAbortRef.current) {
      batchInspectAbortRef.current.abort();
    }
    const controller = new AbortController();
    batchInspectAbortRef.current = controller;
    setBatchInspecting(true);
    setBatchInspectProgress({ current: 0, total: batchUrls.length });
    setIsEditingBatchText(false);

    const initialGroups: BatchUrlResultGroup[] = batchUrls.map((u, idx) => ({
      id: `batch_grp_${idx}_${u}`,
      sourceUrl: u,
      status: 'resolving',
      platformName: 'Remote URL',
      title: u,
      items: [],
      collapsed: false,
    }));
    setBatchGroups(initialGroups);

    const updatedGroups: BatchUrlResultGroup[] = [...initialGroups];
    const newSelectedIds = new Set<string>();
    let firstValidItem: BatchMediaItem | null = null;
    let completedCount = 0;

    const concurrency = 3;
    const queue = batchUrls.map((u, idx) => ({ url: u, index: idx }));

    const worker = async () => {
      while (queue.length > 0) {
        if (controller.signal.aborted) return;
        const task = queue.shift();
        if (!task) break;
        const { url: singleUrl, index: idx } = task;

        try {
          const res = await resolveRemoteMediaUrl(singleUrl, controller.signal);
          if (controller.signal.aborted) return;

          const items: BatchMediaItem[] = [];
          if (res.mediaItems && res.mediaItems.length > 0) {
            res.mediaItems.forEach((mItem, mIdx) => {
              const bestFmt = selectFormatByPreference(mItem.formats, batchQualityPreference) || mItem.formats[0];
              const ext = bestFmt?.ext || (mItem.kind === 'image' ? 'jpg' : 'mp4');
              const filename = sanitizeFilename(mItem.title.endsWith(`.${ext}`) ? mItem.title : `${mItem.title}.${ext}`);
              const isVid = mItem.kind === 'video' || bestFmt?.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
              const rawTier = bestFmt?.qualityTier || (bestFmt?.badge ? bestFmt.badge : 'HD');
              const qualityBadge = inferRawTierBadge(rawTier, ext);
              const itemObj: BatchMediaItem = {
                id: `grp_${idx}_item_${mIdx}_${mItem.id}`,
                groupId: updatedGroups[idx].id,
                sourceUrl: singleUrl,
                title: mItem.title,
                filename,
                directUrl: bestFmt?.directUrl || singleUrl,
                thumbnailUrl: mItem.thumbnailUrl,
                filesizeBytes: bestFmt?.filesizeBytes,
                durationSec: mItem.durationSec || bestFmt?.durationSec,
                qualityBadge,
                headers: bestFmt?.headers,
                isVideo: !!isVid,
                kind: isVid ? 'video' : mItem.kind === 'image' ? 'photo' : 'document',
              };
              items.push(itemObj);
              newSelectedIds.add(itemObj.id);
              if (!firstValidItem) firstValidItem = itemObj;
            });
          } else if (res.formats && res.formats.length > 0) {
            const masterFmt = selectFormatByPreference(res.formats, batchQualityPreference) || res.formats[0];
            if (masterFmt.isAlbumPack && masterFmt.allAlbumUrls && masterFmt.allAlbumUrls.length > 0) {
              masterFmt.allAlbumUrls.forEach((imgUrl, imgIdx) => {
                const filename = `Photo_${imgIdx + 1}_${Date.now()}.jpg`;
                const itemObj: BatchMediaItem = {
                  id: `grp_${idx}_photo_${imgIdx}`,
                  groupId: updatedGroups[idx].id,
                  sourceUrl: singleUrl,
                  title: `${res.title || 'Photo'} #${imgIdx + 1}`,
                  filename,
                  directUrl: imgUrl,
                  thumbnailUrl: imgUrl,
                  qualityBadge: 'HD PHOTO',
                  headers: masterFmt.headers,
                  isVideo: false,
                  kind: 'photo',
                };
                items.push(itemObj);
                newSelectedIds.add(itemObj.id);
                if (!firstValidItem) firstValidItem = itemObj;
              });
            } else {
              const ext = masterFmt.ext || 'mp4';
              const filename = sanitizeFilename(res.title.endsWith(`.${ext}`) ? res.title : `${res.title}.${ext}`);
              const isVid = masterFmt.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
              const rawTier = masterFmt.qualityTier || (masterFmt.badge ? masterFmt.badge : 'HD');
              const qualityBadge = inferRawTierBadge(rawTier, ext);
              const itemObj: BatchMediaItem = {
                id: `grp_${idx}_master_0`,
                groupId: updatedGroups[idx].id,
                sourceUrl: singleUrl,
                title: res.title,
                filename,
                directUrl: masterFmt.directUrl,
                thumbnailUrl: res.thumbnailUrl,
                filesizeBytes: masterFmt.filesizeBytes,
                durationSec: res.durationSec || masterFmt.durationSec,
                qualityBadge: qualityBadge || (isVid ? '1080p FHD' : 'HD'),
                headers: masterFmt.headers,
                isVideo: !!isVid,
                kind: isVid ? 'video' : 'document',
              };
              items.push(itemObj);
              newSelectedIds.add(itemObj.id);
              if (!firstValidItem) firstValidItem = itemObj;
            }
          } else {
            const parsedName = singleUrl.split('/').filter(Boolean).pop() || `File_${Date.now()}`;
            const itemObj: BatchMediaItem = {
              id: `grp_${idx}_direct_0`,
              groupId: updatedGroups[idx].id,
              sourceUrl: singleUrl,
              title: res.title || parsedName,
              filename: sanitizeFilename(parsedName),
              directUrl: singleUrl,
              thumbnailUrl: res.thumbnailUrl,
              qualityBadge: 'DIRECT',
              isVideo: false,
              kind: 'document',
            };
            items.push(itemObj);
            newSelectedIds.add(itemObj.id);
            if (!firstValidItem) {
              firstValidItem = itemObj;
              setFocusedBatchItem((prev) => prev || itemObj);
            }
          }

          updatedGroups[idx] = {
            ...updatedGroups[idx],
            status: 'success',
            platformName: res.platformName || 'Remote Stream',
            title: res.title || singleUrl,
            items,
          };
          items.forEach((it) => queueDurationProbe(it));
        } catch (err: any) {
          if (controller.signal.aborted) return;
          updatedGroups[idx] = {
            ...updatedGroups[idx],
            status: 'error',
            errorMessage: err?.message || t('drive.remote_batch_error_title'),
            items: [],
          };
        } finally {
          completedCount++;
          setBatchInspectProgress({ current: completedCount, total: batchUrls.length });
          setBatchGroups([...updatedGroups]);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, batchUrls.length) }, () => worker());
    await Promise.all(workers);

    if (!controller.signal.aborted) {
      setSelectedBatchItemIds(newSelectedIds);
      if (firstValidItem) {
        setFocusedBatchItem(firstValidItem);
      }
      setBatchInspecting(false);
    }
  }, [batchUrls, t]);

  // Resolve stream proxy URL for focused batch video (handling Referer headers for Streamrizz, TikTok, X, etc.)
  useEffect(() => {
    let isCancelled = false;
    const rawUrl = focusedBatchItem?.directUrl;
    if (!rawUrl || !focusedBatchItem?.isVideo) {
      setBatchPlayableUrl('');
      return;
    }

    const referer =
      focusedBatchItem.headers?.Referer ||
      (rawUrl.includes('overfetch.video') || rawUrl.includes('vidoy') || rawUrl.includes('streamrizz')
        ? 'https://streamrizz.com/'
        : rawUrl.includes('twimg.com') || rawUrl.includes('twitter.com') || rawUrl.includes('x.com')
        ? 'https://x.com/'
        : rawUrl.includes('tiktok.com') || rawUrl.includes('tiktokcdn.com')
        ? 'https://www.tiktok.com/'
        : undefined);

    if (detectTauriRuntime() && referer) {
      invoke<string>('get_remote_stream_proxy_url', { url: rawUrl, referer })
        .then((proxied) => {
          if (!isCancelled) setBatchPlayableUrl(proxied);
        })
        .catch(() => {
          if (!isCancelled) setBatchPlayableUrl(rawUrl);
        });
    } else {
      setBatchPlayableUrl(rawUrl);
    }

    return () => {
      isCancelled = true;
    };
  }, [focusedBatchItem]);

  const handleToggleBatchItem = useCallback((itemId: string) => {
    setSelectedBatchItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  // Card single-click and double-click logic for batch media cards
  const handleBatchCardClick = useCallback((item: BatchMediaItem) => {
    const existingTimer = batchClickTimersRef.current.get(item.id);
    if (existingTimer) {
      // Double click arrived! Set focus on preview
      clearTimeout(existingTimer);
      batchClickTimersRef.current.delete(item.id);
      setFocusedBatchItem(item);
      return;
    }

    const timer = setTimeout(() => {
      handleToggleBatchItem(item.id);
      batchClickTimersRef.current.delete(item.id);
    }, 220);

    batchClickTimersRef.current.set(item.id, timer);
  }, [handleToggleBatchItem]);

  const handleBatchCardDoubleClick = useCallback((item: BatchMediaItem) => {
    const existingTimer = batchClickTimersRef.current.get(item.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      batchClickTimersRef.current.delete(item.id);
    }
    setFocusedBatchItem(item);
  }, []);

  const handleToggleBatchGroup = useCallback((groupId: string, selectAll: boolean) => {
    setSelectedBatchItemIds((prev) => {
      const next = new Set(prev);
      const targetGroup = batchGroups.find((g) => g.id === groupId);
      if (targetGroup) {
        targetGroup.items.forEach((it) => {
          if (selectAll) {
            next.add(it.id);
          } else {
            next.delete(it.id);
          }
        });
      }
      return next;
    });
  }, [batchGroups]);

  const handleToggleAllBatchItems = useCallback((selectAll: boolean) => {
    if (selectAll) {
      const allIds = new Set<string>();
      batchGroups.forEach((g) => {
        g.items.forEach((it) => allIds.add(it.id));
      });
      setSelectedBatchItemIds(allIds);
    } else {
      setSelectedBatchItemIds(new Set());
    }
  }, [batchGroups]);

  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleRetryBatchGroup = useCallback(async (groupId: string) => {
    const targetGroup = batchGroups.find((g) => g.id === groupId);
    if (!targetGroup) return;

    setBatchGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, status: 'resolving', errorMessage: undefined } : g))
    );

    try {
      const res = await resolveRemoteMediaUrl(targetGroup.sourceUrl);
      const items: BatchMediaItem[] = [];
      const grpIdx = batchGroups.findIndex((g) => g.id === groupId);

      if (res.mediaItems && res.mediaItems.length > 0) {
        res.mediaItems.forEach((mItem, mIdx) => {
          const bestFmt = selectFormatByPreference(mItem.formats, batchQualityPreference) || mItem.formats[0];
          const ext = bestFmt?.ext || (mItem.kind === 'image' ? 'jpg' : 'mp4');
          const filename = sanitizeFilename(mItem.title.endsWith(`.${ext}`) ? mItem.title : `${mItem.title}.${ext}`);
          const isVid = mItem.kind === 'video' || bestFmt?.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
          const rawTier = bestFmt?.qualityTier || (bestFmt?.badge ? bestFmt.badge : 'HD');
          const qualityBadge = inferRawTierBadge(rawTier, ext);
          const itemObj: BatchMediaItem = {
            id: `grp_${grpIdx}_item_${mIdx}_${mItem.id}`,
            groupId,
            sourceUrl: targetGroup.sourceUrl,
            title: mItem.title,
            filename,
            directUrl: bestFmt?.directUrl || targetGroup.sourceUrl,
            thumbnailUrl: mItem.thumbnailUrl,
            filesizeBytes: bestFmt?.filesizeBytes,
            durationSec: mItem.durationSec || bestFmt?.durationSec,
            qualityBadge,
            headers: bestFmt?.headers,
            isVideo: !!isVid,
            kind: isVid ? 'video' : mItem.kind === 'image' ? 'photo' : 'document',
          };
          items.push(itemObj);
        });
      } else if (res.formats && res.formats.length > 0) {
        const masterFmt = selectFormatByPreference(res.formats, batchQualityPreference) || res.formats[0];
        const ext = masterFmt.ext || 'mp4';
        const filename = sanitizeFilename(res.title.endsWith(`.${ext}`) ? res.title : `${res.title}.${ext}`);
        const isVid = masterFmt.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
        const rawTier = masterFmt.qualityTier || (masterFmt.badge ? masterFmt.badge : 'HD');
        const qualityBadge = inferRawTierBadge(rawTier, ext);
        const itemObj: BatchMediaItem = {
          id: `grp_${grpIdx}_master_0`,
          groupId,
          sourceUrl: targetGroup.sourceUrl,
          title: res.title,
          filename,
          directUrl: masterFmt.directUrl,
          thumbnailUrl: res.thumbnailUrl,
          filesizeBytes: masterFmt.filesizeBytes,
          durationSec: res.durationSec || masterFmt.durationSec,
          qualityBadge: qualityBadge || (isVid ? '1080p FHD' : 'HD'),
          headers: masterFmt.headers,
          isVideo: !!isVid,
          kind: isVid ? 'video' : 'document',
        };
        items.push(itemObj);
      }

      setBatchGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                status: 'success',
                platformName: res.platformName || 'Remote Stream',
                title: res.title || g.sourceUrl,
                items,
              }
            : g
        )
      );

      items.forEach((it) => queueDurationProbe(it));

      setSelectedBatchItemIds((prev) => {
        const next = new Set(prev);
        items.forEach((it) => next.add(it.id));
        return next;
      });

      if (items.length > 0 && !focusedBatchItem) {
        setFocusedBatchItem(items[0]);
      }
    } catch (err: any) {
      setBatchGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, status: 'error', errorMessage: err?.message || t('drive.remote_batch_error_title') }
            : g
        )
      );
    }
  }, [batchGroups, focusedBatchItem, t]);

  const handleRemoveBatchGroup = useCallback((groupId: string) => {
    const targetGroup = batchGroups.find((g) => g.id === groupId);
    if (!targetGroup) return;

    setSelectedBatchItemIds((prev) => {
      const next = new Set(prev);
      targetGroup.items.forEach((it) => next.delete(it.id));
      return next;
    });

    const remainingUrls = batchUrls.filter((u) => u !== targetGroup.sourceUrl);
    setBatchUrlsText(remainingUrls.join('\n'));
    setBatchGroups((prev) => prev.filter((g) => g.id !== groupId));

    if (focusedBatchItem && targetGroup.items.some((it) => it.id === focusedBatchItem.id)) {
      setFocusedBatchItem(null);
    }
  }, [batchGroups, batchUrls, focusedBatchItem]);

  const allBatchItems = useMemo(() => {
    const list: BatchMediaItem[] = [];
    batchGroups.forEach((g) => {
      if (g.status === 'success') {
        g.items.forEach((it) => list.push(it));
      }
    });
    return list;
  }, [batchGroups]);

  const selectedBatchItems = useMemo(() => {
    return allBatchItems.filter((it) => selectedBatchItemIds.has(it.id));
  }, [allBatchItems, selectedBatchItemIds]);

  const selectedBatchBytes = useMemo(() => {
    return selectedBatchItems.reduce((acc, it) => acc + (it.filesizeBytes || 0), 0);
  }, [selectedBatchItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (tab === 'single') {
      const targetUrl = url.trim();
      if (!targetUrl) {
        setErrorMsg(t('drive.remote_err_empty'));
        return;
      }
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        setErrorMsg(t('drive.remote_err_invalid_protocol'));
        return;
      }

      // Multi-media card upload flow
      if (effectiveMediaItems.length > 1) {
        if (selectedItems.length === 0) {
          setErrorMsg(t('drive.remote_btn_select_at_least_one'));
          return;
        }

        setSubmitting(true);
        try {
          const uploadUrls: string[] = [];
          const uploadFilenames: string[] = [];
          const uploadSizes: number[] = [];
          const uploadThumbs: string[] = [];

          for (const item of selectedItems) {
            const chosenFmtId = itemSelectedFormats[item.id] || item.selectedFormatId || item.formats[0]?.id;
            const chosenFmt = item.formats.find((f) => f.id === chosenFmtId) || item.formats[0];
            if (chosenFmt?.directUrl) {
              uploadUrls.push(chosenFmt.directUrl);
              const origName = getEffectiveFormatFilename(chosenFmt, resolvedMedia) || item.title;
              const finalName = itemCustomNames[item.id]?.trim() || origName;
              uploadFilenames.push(finalName);
              uploadSizes.push(chosenFmt.filesizeBytes || 0);
              uploadThumbs.push(chosenFmt.thumbnailUrl || item.thumbnailUrl || resolvedMedia?.thumbnailUrl || '');
            }
          }

          if (uploadUrls.length === 0) {
            setErrorMsg(t('drive.remote_btn_select_at_least_one'));
            return;
          }

          const effectiveQualityMode =
            deliveryMode === 'uncompressed'
              ? 'ORIGINAL'
              : deliveryMode === 'document'
                ? 'DOCUMENT'
                : 'SMART';
          const effectivePresentation =
            deliveryMode === 'document'
              ? 'document'
              : deliveryMode === 'uncompressed'
                ? 'original'
                : 'standard';

          const ok = await onUpload(uploadUrls, selectedDest, {
            customFilename: uploadFilenames.length === 1 ? (customFilename.trim() || uploadFilenames[0]) : undefined,
            customFilenames: uploadFilenames,
            sourceSizes: uploadSizes,
            thumbnailUrls: uploadThumbs,
            asDocument: deliveryMode === 'document',
            qualityMode: effectiveQualityMode,
            presentationOverride: effectivePresentation,
            remoteEngineMode,
            storagePolicy,
            customDiskPath: customDiskPath.trim() || undefined,
          });
          if (ok !== false) {
            onClose();
          }
        } catch (err: any) {
          setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
        } finally {
          setSubmitting(false);
        }
        return;
      }

      setSubmitting(true);
      try {
        let activeResolved = resolvedMedia;
        if (!activeResolved && (targetUrl.includes('tiktok.com') || targetUrl.includes('douyin.com') || targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be') || targetUrl.includes('instagram.com') || targetUrl.includes('terabox') || targetUrl.includes('pikpak') || targetUrl.includes('streamrizz.com') || targetUrl.includes('vidoy') || targetUrl.includes('overfetch.video') || targetUrl.includes('pinterest.com') || targetUrl.includes('pixiv.net') || targetUrl.includes('twitter.com') || targetUrl.includes('x.com') || targetUrl.includes('videe.cc') || targetUrl.includes('videy.co') || targetUrl.includes('vqso.de') || targetUrl.includes('slicedrive.com'))) {
          try {
            activeResolved = await resolveRemoteMediaUrl(targetUrl, undefined, { passcode });
          } catch {
            /* fallback */
          }
        }

        const activeFormat =
          activeResolved?.formats.find((f) => f.id === selectedFormatId) ||
          activeResolved?.formats[0];
        const effectiveUrl = activeFormat?.directUrl || targetUrl;
        const uploadUrls = (activeFormat?.isAlbumPack && activeFormat.allAlbumUrls && activeFormat.allAlbumUrls.length > 0)
          ? activeFormat.allAlbumUrls
          : [effectiveUrl];

        const effectiveFilename =
          customFilename.trim() ||
          getEffectiveFormatFilename(activeFormat, activeResolved);

        let liveVideoThumb: string | undefined = undefined;
        try {
          const activeVideoEl = document.querySelector<HTMLVideoElement>('.td-remote-big-canvas-video, .td-remote-stream-player-col video, .td-remote-media-player video');
          if (activeVideoEl && activeVideoEl.videoWidth > 0 && activeVideoEl.videoHeight > 0) {
            const c = document.createElement('canvas');
            c.width = Math.min(800, activeVideoEl.videoWidth);
            c.height = Math.round((c.width * activeVideoEl.videoHeight) / activeVideoEl.videoWidth);
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(activeVideoEl, 0, 0, c.width, c.height);
              const url = c.toDataURL('image/jpeg', 0.92);
              if (url && url.length > 100) {
                liveVideoThumb = url;
              }
            }
          }
        } catch {
          /* ignore */
        }

        const uploadSizes = activeFormat?.filesizeBytes ? [activeFormat.filesizeBytes] : undefined;
        const uploadThumbs = (liveVideoThumb || activeFormat?.thumbnailUrl || activeResolved?.thumbnailUrl)
          ? [liveVideoThumb || activeFormat?.thumbnailUrl || activeResolved?.thumbnailUrl!]
          : undefined;

        const effectiveQualityMode =
          deliveryMode === 'uncompressed'
            ? 'ORIGINAL'
            : deliveryMode === 'document'
              ? 'DOCUMENT'
              : 'SMART';
        const effectivePresentation =
          deliveryMode === 'document'
            ? 'document'
            : deliveryMode === 'uncompressed'
              ? 'original'
              : 'standard';

        const ok = await onUpload(uploadUrls, selectedDest, {
          customFilename: effectiveFilename,
          customFilenames: [effectiveFilename],
          sourceSizes: uploadSizes,
          thumbnailUrls: uploadThumbs,
          asDocument: deliveryMode === 'document',
          qualityMode: effectiveQualityMode,
          presentationOverride: effectivePresentation,
          remoteEngineMode,
          storagePolicy,
          customDiskPath: customDiskPath.trim() || undefined,
        });
        if (ok !== false) {
          onClose();
        }
      } catch (err: any) {
        setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
      } finally {
        setSubmitting(false);
      }
    } else {
      // BATCH TAB SUBMISSION
      if (batchGroups.length === 0 || isEditingBatchText) {
        // Trigger batch inspection first
        handleInspectBatchUrls();
        return;
      }

      if (selectedBatchItems.length === 0) {
        setErrorMsg(t('drive.remote_batch_no_selected_hint'));
        return;
      }

      setSubmitting(true);
      try {
        const uploadUrls = selectedBatchItems.map((it) => it.directUrl);
        const customFilenames = selectedBatchItems.map((it) => it.filename);
        const sourceSizes = selectedBatchItems.map((it) => it.filesizeBytes || 0);
        const thumbnailUrls = selectedBatchItems.map((it) => it.thumbnailUrl || '');

        const effectiveQualityMode =
          deliveryMode === 'uncompressed'
            ? 'ORIGINAL'
            : deliveryMode === 'document'
              ? 'DOCUMENT'
              : 'SMART';
        const effectivePresentation =
          deliveryMode === 'document'
            ? 'document'
            : deliveryMode === 'uncompressed'
              ? 'original'
              : 'standard';

        const ok = await onUpload(uploadUrls, selectedDest, {
          customFilenames,
          sourceSizes,
          thumbnailUrls,
          asDocument: deliveryMode === 'document',
          qualityMode: effectiveQualityMode,
          presentationOverride: effectivePresentation,
          remoteEngineMode,
          storagePolicy,
          customDiskPath: customDiskPath.trim() || undefined,
        });
        if (ok !== false) {
          onClose();
        }
      } catch (err: any) {
        setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
      } finally {
        setSubmitting(false);
      }
    }
  };

  const overlayMouseDownTargetRef = useRef<EventTarget | null>(null);

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    overlayMouseDownTargetRef.current = e.target;
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      overlayMouseDownTargetRef.current === e.currentTarget &&
      e.target === e.currentTarget &&
      !pickerOpen &&
      !submitting
    ) {
      onClose();
    }
    overlayMouseDownTargetRef.current = null;
  };

  const renderSupportedLinksPopover = () => {
    if (!showSupportedInfo) return null;
    return (
      <div
        className="td-remote-info-popover"
        role="dialog"
        aria-modal="false"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="td-remote-info-popover-header">
          <span className="td-remote-info-popover-title">
            <Info size={13} className="td-remote-info-title-icon" />
            <span>{t('drive.remote_info_popover_title')}</span>
          </span>
          <button
            type="button"
            className="td-remote-info-close"
            onClick={() => setShowSupportedInfo(false)}
            aria-label={t('drive.preview_close_btn')}
          >
            <X size={13} />
          </button>
        </div>

        {/* Section 1: Social & Video */}
        <div className="td-remote-info-group">
          <div className="td-remote-info-group-title">
            {t('drive.remote_info_cat_social')}
          </div>
          <div className="td-remote-info-tags">
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_tiktok')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_youtube')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_instagram')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_pinterest')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_pixiv')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_terabox')}</span>
          </div>
        </div>

        {/* Section 2: Cloud & Direct */}
        <div className="td-remote-info-group">
          <div className="td-remote-info-group-title">
            {t('drive.remote_info_cat_cloud')}
          </div>
          <div className="td-remote-info-tags">
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_pikpak')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_streamrizz')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_gdrive')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_dropbox')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_mediafire')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_direct')}</span>
          </div>
        </div>

        <div className="td-remote-info-footer">
          <Zap size={11} className="td-remote-info-footer-icon" />
          <span>{t('drive.remote_info_footer_note')}</span>
        </div>
      </div>
    );
  };

  const renderTripletInfoPopover = (type: 'delivery' | 'engine' | 'policy') => {
    if (activeTripletInfo !== type) return null;
    return (
      <div
        className="td-remote-triplet-popover"
        ref={tripletInfoRef}
        onClick={(e) => e.stopPropagation()}
        role="tooltip"
      >
        <div className="td-remote-triplet-popover-header">
          <span className="td-remote-triplet-popover-title">
            <Info size={12} className="text-sky-400" />
            <span>
              {type === 'delivery'
                ? t('drive_tools.remote_info_delivery_title')
                : type === 'engine'
                ? t('drive_tools.remote_info_engine_title')
                : t('drive_tools.remote_info_policy_title')}
            </span>
          </span>
          <button
            type="button"
            className="td-remote-info-close"
            onClick={(e) => {
              e.stopPropagation();
              setActiveTripletInfo(null);
            }}
            aria-label={t('drive.preview_close_btn')}
          >
            <X size={13} />
          </button>
        </div>

        {type === 'delivery' && (
          <>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#c084fc' }}>
                <Film size={10} /> {t('drive.remote_mode_uncompressed')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_uncompressed')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#38bdf8' }}>
                <Zap size={10} /> {t('drive.remote_mode_auto')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_auto')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#facc15' }}>
                <FileText size={10} /> {t('drive.remote_mode_doc')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_doc')}
              </span>
            </div>
          </>
        )}

        {type === 'engine' && (
          <>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#38bdf8' }}>
                <Zap size={10} /> {t('drive_tools.remote_engine_auto')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_engine_auto')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#34d399' }}>
                <Sparkles size={10} /> {t('drive_tools.remote_engine_cloud_fetch')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_engine_cloud_fetch')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#67e8f9' }}>
                <HardDrive size={10} /> {t('drive_tools.remote_engine_storage_local')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_engine_storage_local')}
              </span>
            </div>
          </>
        )}

        {type === 'policy' && (
          <>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#38bdf8' }}>
                <Zap size={10} /> {t('drive_tools.remote_policy_telegram')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_policy_telegram')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#818cf8' }}>
                <Folder size={10} /> {t('drive_tools.remote_policy_custom_disk')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_policy_custom_disk')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#34d399' }}>
                <Layers size={10} /> {t('drive_tools.remote_policy_disk_and_telegram')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_policy_disk_and_telegram')}
              </span>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderTripletAndDestinationControls = (isBatch?: boolean) => (
    <>
      {/* Row: Triplet Compact Row (Media Delivery Format, Transfer Engine, Storage Policy in 1 Row) */}
      <div className="td-remote-triplet-row">
        {/* Col 1: Media Delivery Format */}
        <div className="td-remote-triplet-col col-delivery">
          <div className="td-remote-triplet-header">
            <span className="td-remote-triplet-title">
              <Film size={11} className="text-purple-400" />
              <span>{t('drive.remote_delivery_mode_label')}</span>
            </span>
            <button
              type="button"
              className={`td-remote-col-info-btn${activeTripletInfo === 'delivery' ? ' active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTripletInfo((prev) => (prev === 'delivery' ? null : 'delivery'));
              }}
              title={t('drive_tools.remote_info_delivery_title')}
              aria-label={t('drive_tools.remote_info_delivery_title')}
            >
              <Info size={10} />
            </button>
          </div>
          {renderTripletInfoPopover('delivery')}
          <div className="td-remote-mode-pills">
            <button
              type="button"
              className={`td-remote-mode-pill${deliveryMode === 'uncompressed' ? ' active uncompressed' : ''}`}
              onClick={() => setDeliveryMode('uncompressed')}
              disabled={submitting}
              title={t('drive.remote_mode_uncompressed_hint')}
            >
              <Film size={11} />
              <span>{t('drive.remote_mode_uncompressed')}</span>
              {deliveryMode === 'uncompressed' && <Check size={10} />}
            </button>
            <button
              type="button"
              className={`td-remote-mode-pill${deliveryMode === 'auto' ? ' active auto' : ''}`}
              onClick={() => setDeliveryMode('auto')}
              disabled={submitting}
              title={t('drive.remote_mode_auto_hint')}
            >
              <Zap size={11} />
              <span>{t('drive.remote_mode_auto')}</span>
              {deliveryMode === 'auto' && <Check size={10} />}
            </button>
            <button
              type="button"
              className={`td-remote-mode-pill${deliveryMode === 'document' ? ' active doc' : ''}`}
              onClick={() => setDeliveryMode('document')}
              disabled={submitting}
              title={t('drive.remote_mode_doc_hint')}
            >
              <FileText size={11} />
              <span>{t('drive.remote_mode_doc')}</span>
              {deliveryMode === 'document' && <Check size={10} />}
            </button>
          </div>
        </div>

        {/* Col 2: Transfer Engine */}
        <div className="td-remote-triplet-col col-engine">
          <div className="td-remote-triplet-header">
            <span className="td-remote-triplet-title">
              <Zap size={11} className="text-sky-400" />
              <span>{t('drive_tools.remote_engine_mode_title')}</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {effectiveRemoteEngine === 'cloud_fetch' ? (
                <span className="td-remote-engine-badge zero-quota">
                  <Sparkles size={9} />
                  <span>{t('drive_tools.remote_zero_quota_badge')}</span>
                </span>
              ) : (
                <span className="td-remote-engine-badge storage-local">
                  <HardDrive size={9.5} />
                  <span>{t('drive_tools.remote_engine_storage_local')}</span>
                </span>
              )}
              <button
                type="button"
                className={`td-remote-col-info-btn${activeTripletInfo === 'engine' ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTripletInfo((prev) => (prev === 'engine' ? null : 'engine'));
                }}
                title={t('drive_tools.remote_info_engine_title')}
                aria-label={t('drive_tools.remote_info_engine_title')}
              >
                <Info size={10} />
              </button>
            </div>
          </div>
          {renderTripletInfoPopover('engine')}
          <div className="td-remote-engine-pills">
            {(['auto', 'cloud_fetch', 'storage_local'] as RemoteEngineMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`td-remote-engine-pill mode-${mode}${remoteEngineMode === mode ? ' active' : ''}`}
                disabled={submitting}
                onClick={() => {
                  setRemoteEngineMode(mode);
                  try { localStorage.setItem('autogram_remote_engine_mode', mode); } catch { /* ok */ }
                }}
              >
                {mode === 'auto' && <Zap size={10} />}
                {mode === 'cloud_fetch' && <Sparkles size={10} />}
                {mode === 'storage_local' && <HardDrive size={10} />}
                <span>
                  {mode === 'auto' ? t('drive_tools.remote_engine_auto') :
                   mode === 'cloud_fetch' ? t('drive_tools.remote_engine_cloud_fetch') :
                   t('drive_tools.remote_engine_storage_local')}
                </span>
                {remoteEngineMode === mode && <Check size={9} />}
              </button>
            ))}
          </div>
        </div>

        {/* Col 3: Storage Policy */}
        <div className="td-remote-triplet-col col-policy">
          <div className="td-remote-triplet-header">
            <span className="td-remote-triplet-title">
              <HardDrive size={11} className="text-emerald-400" />
              <span>{t('drive_tools.remote_storage_policy_label')}</span>
            </span>
            <button
              type="button"
              className={`td-remote-col-info-btn${activeTripletInfo === 'policy' ? ' active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTripletInfo((prev) => (prev === 'policy' ? null : 'policy'));
              }}
              title={t('drive_tools.remote_info_policy_title')}
              aria-label={t('drive_tools.remote_info_policy_title')}
            >
              <Info size={10} />
            </button>
          </div>
          {renderTripletInfoPopover('policy')}
          <div className="td-remote-engine-pills">
            {(['telegram', 'custom_disk', 'disk_and_telegram'] as StorageLocalPolicy[]).map((pol) => (
              <button
                key={pol}
                type="button"
                className={`td-remote-engine-pill${storagePolicy === pol ? ' active' : ''}`}
                disabled={submitting}
                onClick={() => setStoragePolicy(pol)}
              >
                {pol === 'telegram' && <Zap size={10} />}
                {pol === 'custom_disk' && <Folder size={10} />}
                {pol === 'disk_and_telegram' && <Layers size={10} />}
                <span>
                  {pol === 'telegram' ? t('drive_tools.remote_policy_telegram') :
                   pol === 'custom_disk' ? t('drive_tools.remote_policy_custom_disk') :
                   t('drive_tools.remote_policy_disk_and_telegram')}
                </span>
                {storagePolicy === pol && <Check size={9} />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Optional Custom Disk Path Row */}
      {(storagePolicy === 'custom_disk' || storagePolicy === 'disk_and_telegram') && (
        <div className="td-remote-custom-disk-row" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <input
            type="text"
            className="td-input-field"
            placeholder={t('drive_tools.remote_custom_disk_path_label')}
            value={customDiskPath}
            onChange={(e) => setCustomDiskPath(e.target.value)}
            style={{ flex: 1, height: 28, fontSize: '0.74rem' }}
          />
          <button
            type="button"
            className="td-chip-btn"
            style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, height: 28 }}
            onClick={async () => {
              try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const res = await open({ directory: true });
                if (res) setCustomDiskPath(String(res));
              } catch (e) {
                console.error('Folder picker error:', e);
              }
            }}
          >
            <Folder size={11} />
            <span>{t('drive_tools.remote_custom_disk_browse')}</span>
          </button>
        </div>
      )}

      {/* Row: Destination Selector (Hidden when Local Disk Only) */}
      {storagePolicy !== 'custom_disk' && (
        <div className="td-remote-field-group td-remote-dest-row">
          <button
            id={isBatch ? 'td-remote-target-batch' : 'td-remote-target'}
            type="button"
            className="td-remote-dest-card"
            onClick={() => setPickerOpen(true)}
            disabled={submitting}
            title={t('drive.btn_change_dest')}
          >
            <div className="td-remote-dest-main">
              <span className="td-dest-ico" aria-hidden>
                {selectedDest.kind === 'saved' ? (
                  <Home size={14} />
                ) : (
                  <PeerAvatar
                    peerId={selectedDest.id ?? 0}
                    creds={creds}
                    title={selectedDest.label}
                    fallback={kindIcon(selectedDest)}
                  />
                )}
              </span>
              <div className="td-remote-dest-info">
                <span className="td-remote-dest-title" title={cleanTargetDisplay.title}>
                  {cleanTargetDisplay.title}
                </span>
                {cleanTargetDisplay.topicPill && (
                  <span className="td-remote-dest-topic">
                    <Hash size={9} style={{ display: 'inline', verticalAlign: '-1px' }} />
                    {` ${cleanTargetDisplay.topicPill.replace(/^#\s*/, '')}`}
                  </span>
                )}
              </div>
            </div>
            <div className="td-remote-dest-actions">
              {renderBadge(selectedDest, t)}
              <span className="td-remote-dest-change-tag">
                {t('drive.btn_change_dest')}
                <ChevronRight size={11} style={{ marginLeft: 2 }} />
              </span>
            </div>
          </button>
        </div>
      )}
    </>
  );

  if (!isOpen) return null;

  const node = (
    <div
      className="td-confirm-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
    >
      <form
        onSubmit={handleSubmit}
        className={`td-confirm-panel input-dialog td-remote-upload-panel ${isSplitActive ? 'td-remote-split-active' : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <header className="td-confirm-head">
          <span className="td-confirm-icon input td-remote-head-icon" aria-hidden>
            <Link2 size={20} strokeWidth={2.25} />
          </span>
          <div className="td-confirm-head-text">
            <h2>{t('drive.remote_upload_url_title')}</h2>
            <p className="td-confirm-desc">{t('drive.remote_upload_url_subtitle')}</p>
          </div>
          <button
            type="button"
            className="td-confirm-close"
            onClick={onClose}
            disabled={submitting}
            aria-label={t('drive.preview_close_btn')}
          >
            <X size={18} />
          </button>
        </header>

        <div className="td-remote-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'single'}
            className={`td-remote-tab ${tab === 'single' ? 'active' : ''}`}
            onClick={() => setTab('single')}
            disabled={submitting}
          >
            <Link2 size={14} />
            <span>{t('drive.remote_tab_single')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'batch'}
            className={`td-remote-tab ${tab === 'batch' ? 'active' : ''}`}
            onClick={() => setTab('batch')}
            disabled={submitting}
          >
            <Layers size={14} />
            <span>{t('drive.remote_tab_batch')}</span>
            {batchUrls.length > 0 && (
              <span className="td-remote-tab-badge">{batchUrls.length}</span>
            )}
          </button>
        </div>

        <div className={`td-input-body td-remote-body ${isSplitActive ? 'td-remote-split-body' : ''} ${effectiveMediaItems.length > 1 ? 'td-remote-collection-mode' : ''}`}>
          {errorMsg && (
            <div className="td-input-error td-remote-error-box" role="alert">
              {errorMsg}
            </div>
          )}

          {tab === 'single' ? (
            <>
              {/* SECTION 1: INGESTION CONTROLS (Full-Width 1 Column) */}
              <div className="td-remote-section-1">
                <div className="td-remote-section-1-controls">
                  <div className="td-remote-unified-panel">
                    {/* Row 1: Source File URL */}
                    <div className="td-remote-field-group">
                      <div className="td-remote-label-row">
                        <label className="td-input-label" htmlFor="td-remote-url">
                          <span>{t('drive.source_url_label')}</span>
                        </label>
                      <div className="td-remote-label-actions">
                        {url.trim() && (
                          <button
                            type="button"
                            className="td-remote-paste-action"
                            onClick={() => probeUrl(url.trim(), passcode.trim())}
                            disabled={submitting || inspection?.status === 'inspecting'}
                            title={t('drive.remote_batch_reinspect_btn')}
                          >
                            <RefreshCw size={11} className={inspection?.status === 'inspecting' ? 'spin' : ''} />
                            <span>{t('drive.remote_batch_reinspect_btn')}</span>
                          </button>
                        )}
                        {url.trim() && (
                          <button
                            type="button"
                            className="td-remote-browser-action"
                            onClick={() => handleOpenInBrowser(url.trim())}
                            disabled={submitting}
                            title={t('drive.remote_open_in_browser')}
                          >
                            <ExternalLink size={11} />
                            <span>{t('drive.remote_open_in_browser')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="td-remote-paste-action"
                          onClick={handlePasteClipboard}
                          disabled={submitting}
                          title={t('drive.remote_paste_clipboard')}
                        >
                          <Clipboard size={10} />
                          <span>{t('drive.remote_paste_clipboard')}</span>
                        </button>
                      </div>
                    </div>
                    <div className="td-remote-input-wrap">
                      <span className="td-remote-input-icon">
                        <Link2 size={14} />
                      </span>
                      <input
                        id="td-remote-url"
                        className="td-input-field td-remote-url-input"
                        type="text"
                        placeholder={t('drive.remote_url_placeholder')}
                        value={url}
                        onChange={(e) => handleUrlChange(e.target.value)}
                        disabled={submitting}
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                      />
                      {url && (
                        <button
                          type="button"
                          className="td-remote-clear-btn"
                          onClick={() => handleUrlChange('')}
                          disabled={submitting}
                          aria-label={t('drive.remote_clear_input')}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Passcode (if required) */}
                  {(resolvedMedia?.requiresPassword || Boolean(passcode.trim())) && (
                    <div className="td-remote-field-group td-remote-passcode-field-animated">
                      <div className="td-remote-label-row">
                        <label className="td-input-label" htmlFor="td-remote-passcode">
                          {t('drive.remote_passcode_label')}
                        </label>
                        <div className="td-remote-label-actions">
                          {resolvedMedia?.requiresPassword && (
                            <span
                              className={`td-remote-passcode-status-badge ${
                                resolvedMedia.passwordError ? 'error' : 'required'
                              }`}
                            >
                              <KeyRound size={10} />
                              <span>
                                {resolvedMedia.passwordError
                                  ? t('drive.remote_passcode_invalid_badge')
                                  : t('drive.remote_passcode_required_badge')}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="td-remote-input-wrap">
                        <span className="td-remote-input-icon">
                          <KeyRound size={13} />
                        </span>
                        <input
                          id="td-remote-passcode"
                          className={`td-input-field td-remote-passcode-input ${
                            resolvedMedia?.requiresPassword ? 'highlight-required' : ''
                          }`}
                          type="text"
                          placeholder={t('drive.remote_passcode_placeholder')}
                          value={passcode}
                          onChange={(e) => handlePasscodeChange(e.target.value)}
                          disabled={submitting}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        {passcode && (
                          <button
                            type="button"
                            className="td-remote-clear-btn"
                            onClick={() => handlePasscodeChange('')}
                            disabled={submitting}
                            aria-label={t('drive.remote_clear_input')}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Triplet Compact Row (Media Delivery Format, Transfer Engine, Storage Policy) & Destination */}
                  {renderTripletAndDestinationControls(false)}
                </div>
              </div>
            </div>

          {/* STREAM PREVIEW SECTION: Side-by-Side Player & Media Cards Gallery */}
          {isSplitActive && (
            <div ref={previewSectionRef} className="td-remote-preview-section">
              {resolvedMedia ? (
                <div className="td-remote-meta-card">
                  <div className="td-remote-stream-split-wrap">
                    {/* Left Column: Player & Active Stream Details */}
                    <div className="td-remote-stream-player-col">
                      {/* Active Player Canvas */}
                      {(() => {
                        const activeFormatForCanvas = resolvedMedia?.formats?.find((f) => f.id === selectedFormatId) || resolvedMedia?.formats?.[0];
                        const ytMatch = (url || activePlayableUrl || resolvedMedia?.thumbnailUrl || '').match(/(?:v=|\/embed\/|\/watch\?v=|youtu\.be\/|\/v\/|\/e\/|watch\?.+&v=)([\w-]{11})/);
                        const vId = ytMatch ? ytMatch[1] : undefined;

                        const isDirectStream = Boolean(
                          activePlayableUrl &&
                          !activePlayableUrl.includes('youtube.com/watch') &&
                          !activePlayableUrl.includes('youtu.be/') &&
                          (
                            activePlayableUrl.startsWith('blob:') ||
                            activePlayableUrl.startsWith('http://localhost') ||
                            activePlayableUrl.startsWith('http://127.0.0.1') ||
                            /\.(mp4|webm|m4v|mov|mkv|ogg|mp3|m4a|aac)(\?.*)?$/i.test(activePlayableUrl) ||
                            activePlayableUrl.includes('googlevideo.com') ||
                            activePlayableUrl.includes('fbcdn.net') ||
                            activePlayableUrl.includes('cdninstagram.com') ||
                            activePlayableUrl.includes('tiktokcdn.com') ||
                            activePlayableUrl.includes('twimg.com')
                          )
                        );

                        return (
                          <div className="td-remote-big-canvas-wrap">
                            {isPlayingStream && isDirectStream ? (
                              <div className="td-remote-big-canvas-inner td-remote-single-player-canvas">
                                <video
                                  key={activePlayableUrl}
                                  src={activePlayableUrl}
                                  poster={activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia.thumbnailUrl}
                                  autoPlay
                                  controls
                                  preload="auto"
                                  playsInline
                                  className="td-remote-big-canvas-video td-remote-active-player-video"
                                  crossOrigin="anonymous"
                                  onLoadedData={(e) => {
                                    const v = e.currentTarget;
                                    if (resolvedMedia && !resolvedMedia.thumbnailUrl) {
                                      const thumb = captureVideoCanvasThumbnail(v);
                                      if (thumb) {
                                        setResolvedMedia((prev) => (prev ? { ...prev, thumbnailUrl: thumb } : prev));
                                      }
                                    }
                                  }}
                                  onLoadedMetadata={(e) => {
                                    const v = e.currentTarget;
                                    const dur = v.duration;
                                    const w = v.videoWidth;
                                    const h = v.videoHeight;
                                    if (resolvedMedia && !resolvedMedia.thumbnailUrl) {
                                      const thumb = captureVideoCanvasThumbnail(v);
                                      if (thumb) {
                                        setResolvedMedia((prev) => (prev ? { ...prev, thumbnailUrl: thumb } : prev));
                                      }
                                    }
                                    if (dur && isFinite(dur) && dur > 0) {
                                      const d = Math.round(dur);
                                      if (activePreviewItem) {
                                        setItemDurations((prev) => {
                                          if (prev[activePreviewItem.id] === d) return prev;
                                          return { ...prev, [activePreviewItem.id]: d };
                                        });
                                      }
                                    }
                                    if (w > 0 && h > 0 && activePreviewItem) {
                                      setItemResolutions((prev) => {
                                        const cur = prev[activePreviewItem.id];
                                        if (cur && cur.width === w && cur.height === h) return prev;
                                        return { ...prev, [activePreviewItem.id]: { width: w, height: h } };
                                      });
                                    }
                                  }}
                                  onDurationChange={(e) => {
                                    const dur = e.currentTarget.duration;
                                    if (dur && isFinite(dur) && dur > 0) {
                                      const d = Math.round(dur);
                                      if (activePreviewItem) {
                                        setItemDurations((prev) => {
                                          if (prev[activePreviewItem.id] === d) return prev;
                                          return { ...prev, [activePreviewItem.id]: d };
                                        });
                                      }
                                    }
                                  }}
                                />
                              </div>
                            ) : isPlayingStream && vId ? (
                              <div className="td-remote-big-canvas-inner td-remote-single-player-canvas">
                                <iframe
                                  key={vId}
                                  src={`https://www.youtube.com/embed/${vId}?autoplay=1&rel=0&modestbranding=1`}
                                  title={resolvedMedia.title}
                                  className="td-remote-big-canvas-video td-remote-embedded-iframe"
                                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                  allowFullScreen
                                  style={{ border: 'none', width: '100%', height: '100%', borderRadius: '8px' }}
                                />
                              </div>
                            ) : (activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia.thumbnailUrl) ? (
                              <div className="td-remote-big-canvas-inner">
                                <img
                                  src={activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia.thumbnailUrl}
                                  alt={resolvedMedia.title}
                                  className="td-remote-big-canvas-img"
                                  loading="eager"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    if (vId && !e.currentTarget.src.includes('hqdefault.jpg')) {
                                      e.currentTarget.src = `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
                                    }
                                  }}
                                />
                                {activeFormatForCanvas && (
                                  <button
                                    type="button"
                                    className="td-remote-canvas-center-play-btn"
                                    onClick={() => handlePlayFormat(activeFormatForCanvas)}
                                    title={t('drive.remote_stream_play_tooltip')}
                                  >
                                    <div className="td-remote-canvas-play-circle">
                                      <Play size={24} fill="currentColor" />
                                    </div>
                                    <span className="td-remote-canvas-play-hint">{t('drive.remote_stream_play_hint')}</span>
                                  </button>
                                )}
                                <div className="td-remote-canvas-badge-overlay">
                                  {resolvedMedia.albumImages && resolvedMedia.albumImages.length > 1 && (
                                    <span className="td-remote-canvas-slide-tag">
                                      <ImageIcon size={12} />
                                      <span>
                                        {t('drive.remote_split_slide_preview', {
                                          idx: activeSlideIndex + 1,
                                          total: resolvedMedia.albumImages.length,
                                        })}
                                      </span>
                                    </span>
                                  )}
                                  {resolvedMedia.durationSec ? (
                                    <span className="td-remote-canvas-duration-tag">
                                      <Clock size={11} />
                                      <span>{formatMediaDuration(resolvedMedia.durationSec)}</span>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              <div className="td-remote-big-canvas-fallback">
                                <Film size={36} className="td-remote-fallback-icon" />
                                <span>{t('drive_tools.remote_platform_stream_fallback', { platform: resolvedMedia.platformName })}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Active Item Editable Filename Bar (Replacing Specs Ribbon) */}
                      <div className="td-remote-stream-filename-bar">
                        {isEditingActiveName ? (
                          <div className="td-remote-filename-edit-form">
                            <div className="td-remote-filename-input-group">
                              <input
                                type="text"
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    saveCurrentEditingName();
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setIsEditingActiveName(false);
                                  }
                                }}
                                className="td-remote-filename-input"
                                placeholder={t('drive_tools.remote_filename_placeholder')}
                                autoFocus
                              />
                              <span
                                className="td-remote-filename-locked-ext"
                                title={t('drive_tools.remote_filename_locked_ext_tooltip', { ext: `.${activeTargetExt}` })}
                              >
                                .{activeTargetExt}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={saveCurrentEditingName}
                              className="td-remote-name-action-btn td-remote-name-save-btn"
                              title={t('drive_tools.remote_save_filename')}
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingActiveName(false)}
                              className="td-remote-name-action-btn td-remote-name-cancel-btn"
                              title={t('drive_tools.remote_cancel_edit_filename')}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="td-remote-filename-display">
                            <span className="td-remote-filename-text" title={activeItemCurrentName}>
                              {activeItemCurrentName}
                            </span>
                            <div className="td-remote-filename-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  const { base } = splitFilenameAndExt(activeItemCurrentName, activeTargetExt);
                                  setEditingNameValue(base);
                                  setIsEditingActiveName(true);
                                }}
                                className="td-remote-name-action-btn"
                                title={t('drive_tools.remote_edit_filename')}
                              >
                                <Pencil size={12} />
                              </button>
                              {isNameModified && (
                                <button
                                  type="button"
                                  onClick={resetActiveName}
                                  className="td-remote-name-action-btn td-remote-name-reset-btn"
                                  title={t('drive_tools.remote_reset_filename')}
                                >
                                  <RotateCcw size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Media Cards Gallery or Format Selection */}
                    <div className="td-remote-stream-gallery-col">
                      {effectiveMediaItems.length > 1 ? (
                        <>
                          <div className="td-remote-gallery-header-row">
                            <div className="td-remote-gallery-header-left">
                              <Layers size={13} className="text-sky-400 shrink-0" />
                              <span className="td-remote-gallery-title">
                                {t('drive_tools.remote_gallery_title')}
                              </span>
                              <span
                                className="td-remote-gallery-unified-pill"
                                title={t('drive_tools.remote_gallery_selected_pill_full', {
                                  selected: selectedMediaItemIds.size,
                                  total: effectiveMediaItems.length,
                                  size: selectedBytes > 0 ? `~${formatDriveBytes(selectedBytes)}` : '0 B',
                                })}
                              >
                                <span className="td-pill-count">
                                  {t('drive_tools.remote_gallery_selected_pill', {
                                    selected: selectedMediaItemIds.size,
                                    total: effectiveMediaItems.length,
                                  })}
                                </span>
                                {selectedBytes > 0 && (
                                  <>
                                    <span className="td-pill-dot">·</span>
                                    <span className="td-pill-size">~{formatDriveBytes(selectedBytes)}</span>
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="td-remote-gallery-header-right">
                              <button
                                type="button"
                                className="td-remote-gallery-btn-action"
                                onClick={handleSelectAllItems}
                                title={t('drive_tools.remote_gallery_select_all')}
                              >
                                <CheckCheck size={11} />
                                <span>{t('drive_tools.remote_gallery_select_all')}</span>
                              </button>
                              <button
                                type="button"
                                className="td-remote-gallery-btn-action"
                                onClick={handleDeselectAllItems}
                                title={t('drive_tools.remote_gallery_deselect_all')}
                              >
                                <XCircle size={11} />
                                <span>{t('drive_tools.remote_gallery_deselect_all')}</span>
                              </button>
                              <div className="td-remote-gallery-density-toggle">
                                <button
                                  type="button"
                                  className={`td-remote-density-btn ${galleryViewMode === 'grid' ? 'active' : ''}`}
                                  onClick={() => setGalleryViewMode('grid')}
                                  title={t('drive_tools.remote_gallery_view_grid')}
                                >
                                  <LayoutGrid size={12} />
                                </button>
                                <button
                                  type="button"
                                  className={`td-remote-density-btn ${galleryViewMode === 'list' ? 'active' : ''}`}
                                  onClick={() => setGalleryViewMode('list')}
                                  title={t('drive_tools.remote_gallery_view_list')}
                                >
                                  <List size={12} />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Search & Filters + Sort inline */}
                          <div className="td-remote-gallery-toolbar">
                            <div className="td-remote-gallery-toolbar-left">
                              <div className="td-remote-gallery-search-wrap">
                                <Search size={12} className="td-remote-gallery-search-icon" />
                                <input
                                  type="text"
                                  className="td-remote-gallery-search-input"
                                  placeholder={t('drive_tools.remote_gallery_search_placeholder', { count: effectiveMediaItems.length })}
                                  value={gallerySearch}
                                  onChange={(e) => setGallerySearch(e.target.value)}
                                />
                                {gallerySearch && (
                                  <button
                                    type="button"
                                    className="td-remote-gallery-search-clear"
                                    onClick={() => setGallerySearch('')}
                                  >
                                    <X size={11} />
                                  </button>
                                )}
                              </div>

                              <div
                                className="td-remote-gallery-filters"
                                onWheel={(e) => {
                                  if (e.deltaY !== 0) {
                                    e.currentTarget.scrollLeft += e.deltaY;
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className={`td-remote-filter-chip ${galleryFilter === 'all' ? 'active' : ''}`}
                                  onClick={() => setGalleryFilter('all')}
                                >
                                  {t('drive_tools.remote_gallery_filter_all', { count: effectiveMediaItems.length })}
                                </button>
                                {effectiveMediaItems.some((i) => i.kind === 'video') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'video' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('video')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_videos', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'video').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'image') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'image' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('image')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_photos', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'image').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'profile') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'profile' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('profile')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_profile', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'profile').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'story') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'story' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('story')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_stories', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'story').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'audio') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'audio' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('audio')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_audio', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'audio').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'zip') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'zip' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('zip')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_archives', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'zip').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'doc') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'doc' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('doc')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_documents', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'doc').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'unsupported' || i.kind === 'other') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip filter-unsupported ${galleryFilter === 'unsupported' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('unsupported')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_unsupported', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'unsupported' || i.kind === 'other').length,
                                    })}
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="td-remote-gallery-toolbar-right">
                              <div className="td-remote-sort-wrap">
                                <button
                                  type="button"
                                  className="td-remote-sort-toggle-btn"
                                  onClick={() => setGallerySortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                                  title={gallerySortOrder === 'asc' ? t('drive_tools.remote_gallery_sort_order_asc') : t('drive_tools.remote_gallery_sort_order_desc')}
                                >
                                  <div className="td-remote-sort-arrows">
                                    <ArrowUp size={8.5} strokeWidth={2.8} className={`td-remote-sort-arrow ${gallerySortOrder === 'asc' ? 'active' : ''}`} />
                                    <ArrowDown size={8.5} strokeWidth={2.8} className={`td-remote-sort-arrow ${gallerySortOrder === 'desc' ? 'active' : ''}`} />
                                  </div>
                                </button>
                                <select
                                  className="td-remote-gallery-sort-select"
                                  value={gallerySortBy}
                                  onChange={(e) => setGallerySortBy(e.target.value as any)}
                                  title={t('drive_tools.remote_gallery_sort_label')}
                                >
                                  <option value="default">{t('drive_tools.remote_gallery_sort_default')}</option>
                                  <option value="name">{t('drive_tools.remote_gallery_sort_name')}</option>
                                  <option value="duration">{t('drive_tools.remote_gallery_sort_duration')}</option>
                                  <option value="size">{t('drive_tools.remote_gallery_sort_size')}</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* Scrollable Media Cards */}
                          <div className={`td-remote-gallery-grid-wrap ${galleryViewMode === 'list' ? 'view-list' : 'view-grid'}`}>
                            {filteredAndSortedItems.length === 0 ? (
                              <div className="td-remote-multicard-empty">
                                {t('drive_tools.no_match_found')}
                              </div>
                            ) : (
                              filteredAndSortedItems.map((item) => {
                                const isSelected = selectedMediaItemIds.has(item.id);
                                const isActive = item.id === activePreviewItem?.id;
                                const chosenFmtId = itemSelectedFormats[item.id] || item.selectedFormatId || item.formats[0]?.id;
                                const chosenFmt = item.formats.find((f) => f.id === chosenFmtId) || item.formats[0];

                                const rawName = itemCustomNames[item.id] || item.title;
                                const fallbackExt = chosenFmt?.ext ? `.${chosenFmt.ext.toLowerCase()}` : '';
                                const lastDot = rawName.lastIndexOf('.');
                                let baseName = rawName;
                                let extName = fallbackExt;

                                if (lastDot > 0) {
                                  baseName = rawName.slice(0, lastDot);
                                  extName = rawName.slice(lastDot);
                                }
                                const fullDisplayName = `${baseName}${extName}`;
                                const badgeInfo = getSingleUnifiedBadgeInfo(item, itemResolutions[item.id]);
                                const durSec = itemDurations[item.id] || item.durationSec || chosenFmt?.durationSec;
                                const durFormatted = formatMediaDuration(durSec);

                                if (galleryViewMode === 'list') {
                                  return (
                                    <div
                                      key={item.id}
                                      className={`td-remote-list-item-row ${isSelected ? 'selected' : ''} ${isActive ? 'is-active-preview' : ''}`}
                                      onClick={() => handleCardClick(item.id)}
                                      onDoubleClick={() => handleCardDoubleClick(item.id)}
                                    >
                                      {/* Left: Circular Checkbox */}
                                      <button
                                        type="button"
                                        className={`td-remote-item-checkbox list-mode-check ${isSelected ? 'checked' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const existingTimer = clickTimersRef.current.get(item.id);
                                          if (existingTimer) {
                                            clearTimeout(existingTimer);
                                            clickTimersRef.current.delete(item.id);
                                          }
                                          handleToggleItem(item.id);
                                        }}
                                        aria-label={isSelected ? t('drive_tools.remote_gallery_deselect_all') : t('drive_tools.remote_gallery_select_all')}
                                      >
                                        {isSelected && <Check size={9.5} strokeWidth={3.8} />}
                                      </button>

                                      {/* Compact Thumbnail with hover play hint */}
                                      <div
                                        className="td-remote-list-thumb-wrap"
                                        onClick={(e) => {
                                          if (item.kind === 'video') {
                                            e.stopPropagation();
                                            handleCardDoubleClick(item.id);
                                          }
                                        }}
                                        title={item.kind === 'video' ? t('drive_tools.remote_gallery_play_video') : undefined}
                                      >
                                        {item.thumbnailUrl ? (
                                          <img
                                            src={item.thumbnailUrl}
                                            alt={item.title}
                                            className="td-remote-list-thumb-img"
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            onLoad={(e) => {
                                              const target = e.currentTarget;
                                              if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                                                setItemResolutions((prev) => {
                                                  if (prev[item.id]) return prev;
                                                  return {
                                                    ...prev,
                                                    [item.id]: { width: target.naturalWidth, height: target.naturalHeight }
                                                  };
                                                });
                                              }
                                              if (
                                                item.kind === 'video' &&
                                                (!itemDurations[item.id] || !itemResolutions[item.id]) &&
                                                (!item.durationSec || item.durationSec <= 0)
                                              ) {
                                                probeSingleItemDuration(item);
                                              }
                                            }}
                                          />
                                        ) : (
                                          <div className="td-remote-list-thumb-fallback">
                                            {item.kind === 'video' ? <Film size={18} /> : <ImageIcon size={18} />}
                                          </div>
                                        )}
                                        {item.kind === 'video' && (
                                          <div className="td-remote-list-thumb-play-hint">
                                            <Play size={11} fill="currentColor" />
                                          </div>
                                        )}
                                      </div>

                                      {/* Middle: Title & Structured Meta Information */}
                                      <div className="td-remote-list-info-col">
                                        <div className="td-remote-list-title-row" title={fullDisplayName}>
                                          <span className="td-remote-list-title-base">{baseName}</span>
                                          {extName ? <span className="td-remote-list-title-ext">{extName}</span> : null}
                                        </div>

                                        <div className="td-remote-list-meta-row">
                                          {badgeInfo && (
                                            <span className={`td-remote-item-quality-badge in-list ${badgeInfo.tierClass}`} title={badgeInfo.text}>
                                              {badgeInfo.text}
                                            </span>
                                          )}
                                          {chosenFmt?.filesizeBytes ? (
                                            <span className="td-remote-list-meta-size">
                                              ~{formatDriveBytes(chosenFmt.filesizeBytes)}
                                            </span>
                                          ) : null}
                                          {durFormatted ? (
                                            <span className="td-remote-list-meta-dur">
                                              <Clock size={9.5} />
                                              <span>{durFormatted}</span>
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>

                                      {/* Right: Active playing badge or quick stream button */}
                                      <div className="td-remote-list-actions-col">
                                        {isActive ? (
                                          <span className="td-remote-list-active-badge">
                                            <Play size={9.5} fill="currentColor" />
                                            <span>{t('drive_tools.remote_gallery_playing')}</span>
                                          </span>
                                        ) : item.kind === 'video' ? (
                                          <button
                                            type="button"
                                            className="td-remote-list-play-btn"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleCardDoubleClick(item.id);
                                            }}
                                            title={t('drive_tools.remote_gallery_play_video')}
                                          >
                                            <Play size={11} fill="currentColor" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                }

                                /* Grid mode card */
                                return (
                                  <div
                                    key={item.id}
                                    className={`td-remote-media-item-card card-grid-mode ${isSelected ? 'selected' : ''} ${isActive ? 'is-active-preview' : ''}`}
                                    onClick={() => handleCardClick(item.id)}
                                    onDoubleClick={() => handleCardDoubleClick(item.id)}
                                  >
                                    <div className="td-remote-item-thumb-wrap">
                                      {item.thumbnailUrl ? (
                                        <img
                                          src={item.thumbnailUrl}
                                          alt={item.title}
                                          className="td-remote-item-thumb-img"
                                          loading="lazy"
                                          referrerPolicy="no-referrer"
                                          onLoad={(e) => {
                                            const target = e.currentTarget;
                                            if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                                              setItemResolutions((prev) => {
                                                if (prev[item.id]) return prev;
                                                return {
                                                  ...prev,
                                                  [item.id]: { width: target.naturalWidth, height: target.naturalHeight }
                                                };
                                              });
                                            }
                                            if (
                                              item.kind === 'video' &&
                                              (!itemDurations[item.id] || !itemResolutions[item.id]) &&
                                              (!item.durationSec || item.durationSec <= 0)
                                            ) {
                                              probeSingleItemDuration(item);
                                            }
                                          }}
                                        />
                                      ) : (
                                        <div className="td-remote-item-thumb-fallback">
                                          {item.kind === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}
                                        </div>
                                      )}

                                      {/* TOP-LEFT: Quality pill badge with dynamic tier styling */}
                                      {badgeInfo && (
                                        <span
                                          className={`td-remote-item-quality-badge ${badgeInfo.tierClass}`}
                                          title={badgeInfo.text}
                                        >
                                          {badgeInfo.text}
                                        </span>
                                      )}

                                      {/* TOP-RIGHT: Modern Circular Selection Button */}
                                      <button
                                        type="button"
                                        className={`td-remote-item-checkbox ${isSelected ? 'checked' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const existingTimer = clickTimersRef.current.get(item.id);
                                          if (existingTimer) {
                                            clearTimeout(existingTimer);
                                            clickTimersRef.current.delete(item.id);
                                          }
                                          handleToggleItem(item.id);
                                        }}
                                        aria-label={isSelected ? t('drive_tools.remote_gallery_deselect_all') : t('drive_tools.remote_gallery_select_all')}
                                      >
                                        {isSelected && <Check size={9.5} strokeWidth={3.8} />}
                                      </button>
                                    </div>

                                    {/* CARD BODY: bottom gradient overlay */}
                                    <div className="td-remote-item-card-body">
                                      <span
                                        className="td-remote-item-card-title"
                                        title={fullDisplayName}
                                      >
                                        <span className="td-remote-title-base">{baseName}</span>
                                        {extName ? <span className="td-remote-title-ext">{extName}</span> : null}
                                      </span>
                                      <div className="td-remote-card-meta-row">
                                        {chosenFmt?.filesizeBytes ? (
                                          <span className="td-remote-meta-size">
                                            ~{formatDriveBytes(chosenFmt.filesizeBytes)}
                                          </span>
                                        ) : <span />}
                                        <ItemDurationBadge
                                          item={item}
                                          knownDuration={itemDurations[item.id] || item.durationSec}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </>
                      ) : resolvedMedia.formats.length > 0 ? (
                        (() => {
                          const QUALITY_ORDER: Record<string, number> = {
                            '8k': 1,
                            '4k': 2,
                            '2k': 3,
                            '1080p': 4,
                            '720p': 5,
                            '480p': 6,
                            '360p': 7,
                          };

                          const mp4VideoFmts = resolvedMedia.formats
                            .filter((f) => !f.isAudio && !f.isSubtitle && f.ext === 'mp4')
                            .sort((a, b) => (QUALITY_ORDER[a.qualityTier] || 99) - (QUALITY_ORDER[b.qualityTier] || 99) || (b.filesizeBytes || 0) - (a.filesizeBytes || 0));

                          const webmVideoFmts = resolvedMedia.formats
                            .filter((f) => !f.isAudio && !f.isSubtitle && f.ext === 'webm')
                            .sort((a, b) => (QUALITY_ORDER[a.qualityTier] || 99) - (QUALITY_ORDER[b.qualityTier] || 99) || (b.filesizeBytes || 0) - (a.filesizeBytes || 0));

                          const audioFmts = resolvedMedia.formats
                            .filter((f) => f.isAudio || f.qualityTier === 'audio')
                            .sort((a, b) => (b.filesizeBytes || 0) - (a.filesizeBytes || 0));

                          const subtitleFmts = resolvedMedia.formats.filter((f) => f.isSubtitle || f.qualityTier === 'subtitle');
                          const filteredSubtitleFmts = subtitleFmts.filter((f) => {
                            if (!subtitleSearchQuery.trim()) return true;
                            const q = subtitleSearchQuery.toLowerCase();
                            return (
                              f.label.toLowerCase().includes(q) ||
                              (f.resolution && f.resolution.toLowerCase().includes(q)) ||
                              (f.badge && f.badge.toLowerCase().includes(q))
                            );
                          });
                          const rawStreamsList = resolvedMedia.rawStreams || [];

                          const mp4Tiers = new Set(mp4VideoFmts.map((f) => f.qualityTier));
                          const superiorWebms = webmVideoFmts.filter((w) => {
                            if (!mp4Tiers.has(w.qualityTier)) return true;
                            const matchingMp4 = mp4VideoFmts.find((m) => m.qualityTier === w.qualityTier);
                            const webmIsHdr = w.badge?.includes('HDR') || w.resolution?.includes('HDR');
                            const mp4IsHdr = matchingMp4?.badge?.includes('HDR') || matchingMp4?.resolution?.includes('HDR');
                            if (webmIsHdr && !mp4IsHdr) return true;
                            return false;
                          });

                          const curatedGeneralVideos = [...mp4VideoFmts, ...superiorWebms].sort(
                            (a, b) => (QUALITY_ORDER[a.qualityTier] || 99) - (QUALITY_ORDER[b.qualityTier] || 99) || (b.filesizeBytes || 0) - (a.filesizeBytes || 0)
                          );

                          const activeFmt = resolvedMedia.formats.find((f) => f.id === selectedFormatId) || resolvedMedia.formats[0];

                          const hasVideos = mp4VideoFmts.length > 0 || webmVideoFmts.length > 0;
                          const hasAudio = audioFmts.length > 0;
                          const hasSubtitle = subtitleFmts.length > 0;
                          const hasRawMatrix = rawStreamsList.length > 0;

                          const filterCategoriesCount = [true, hasVideos, hasAudio, hasSubtitle, hasRawMatrix].filter(Boolean).length;
                          const hasMultipleFilters = filterCategoriesCount > 1;

                          const isGeneralTab = streamContainerFilter === 'general' || streamContainerFilter === 'all';
                          const isVideoTab = streamContainerFilter === 'video' || streamContainerFilter === 'mp4' || streamContainerFilter === 'webm';
                          const isAudioTab = streamContainerFilter === 'audio';
                          const isSubtitleTab = streamContainerFilter === 'subtitle';
                          const isAdvanceTab = streamContainerFilter === 'advance' || streamContainerFilter === 'matrix';

                          const filteredRawStreams = rawStreamsList.filter((s) => {
                            if (!matrixSearchQuery.trim()) return true;
                            const q = matrixSearchQuery.toLowerCase();
                            return (
                              String(s.itag).includes(q) ||
                              s.codec.toLowerCase().includes(q) ||
                              (s.qualityLabel && s.qualityLabel.toLowerCase().includes(q)) ||
                              s.mimeType.toLowerCase().includes(q) ||
                              s.type.toLowerCase().includes(q)
                            );
                          });

                          const renderFormatChip = (fmt: StreamQualityFormat) => {
                            const isSelected = selectedFormatId === fmt.id;
                            const isHdr = fmt.badge?.includes('HDR') || fmt.codec?.includes('HDR');
                            const is60fps = fmt.fps === 60 || fmt.resolution?.includes('60fps') || fmt.label?.includes('60fps');
                            let displayBadge = getFormatDisplayBadge(fmt, t);

                            if (isHdr && displayBadge) {
                              displayBadge = displayBadge.replace(/^HDR\s*[•·-]?\s*/i, '').trim() || undefined;
                            }
                            if (is60fps && displayBadge) {
                              displayBadge = displayBadge.replace(/60FPS\s*[•·-]?\s*/i, '').trim() || undefined;
                            }
                            if (displayBadge && fmt.isVideo && fmt.ext) {
                              displayBadge = displayBadge.replace(new RegExp(`\\s+${fmt.ext}$`, 'i'), '').trim() || undefined;
                            }

                            return (
                              <button
                                key={fmt.id}
                                type="button"
                                className={`td-remote-quality-chip ${isSelected ? 'active' : ''} tier-${fmt.qualityTier} ${fmt.isAlbumPack ? 'album-pack' : ''}`}
                                onClick={() => handleToggleFormat(fmt)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handlePlayFormat(fmt);
                                }}
                                title={isSelected ? t('drive.remote_unselect_card_tooltip') : t('drive.remote_stream_double_click_hint')}
                                disabled={submitting}
                              >
                                <div className="td-remote-quality-chip-top">
                                  <span className="td-remote-quality-chip-title">
                                    {getFormatDisplayLabel(fmt, resolvedMedia, t)}
                                  </span>
                                  {isSelected && <CheckCircle2 size={13} className="td-remote-chip-active-ico" />}
                                </div>
                                <div className="td-remote-quality-chip-meta">
                                  <div className="td-remote-quality-chip-badges">
                                    {is60fps && (
                                      <span className="td-badge-pill fps-60">{t('drive.remote_badge_fps_60')}</span>
                                    )}
                                    {isHdr && (
                                      <span className="td-badge-pill hdr">{t('drive.remote_badge_hdr')}</span>
                                    )}
                                    {displayBadge && (
                                      <span className={`td-remote-quality-chip-badge ${getBadgeModifierClass(displayBadge)}`}>
                                        {displayBadge}
                                      </span>
                                    )}
                                  </div>
                                  {fmt.filesizeBytes ? (
                                    <span className="td-remote-quality-chip-size">
                                      ~{formatDriveBytes(fmt.filesizeBytes)}
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            );
                          };

                          return (
                            <div className="td-remote-formats-container">
                              {resolvedMedia.isPlaylist && (
                                <div className="td-remote-playlist-banner">
                                  <Layers size={13} />
                                  <span>{t('drive.remote_playlist_detected_banner')}</span>
                                </div>
                              )}

                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                                <label className="td-input-label" style={{ marginBottom: 0 }}>
                                  {t('drive.remote_split_select_format_hint')}
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <button
                                    type="button"
                                    className="td-remote-select-action-btn"
                                    onClick={() => {
                                      const bestVideo = curatedGeneralVideos[0] || mp4VideoFmts[0] || webmVideoFmts[0] || resolvedMedia.formats[0];
                                      if (bestVideo) {
                                        handleSelectFormat(bestVideo);
                                      }
                                    }}
                                    title={t('drive.remote_select_all_btn')}
                                  >
                                    <CheckSquare size={11} />
                                    <span>{t('drive.remote_select_all_btn')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`td-remote-select-action-btn ${!selectedFormatId ? 'active' : ''}`}
                                    onClick={() => {
                                      setSelectedFormatId('');
                                      setInspection((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              size: null,
                                            }
                                          : prev
                                      );
                                    }}
                                    title={t('drive.remote_unselect_all_btn')}
                                  >
                                    <Square size={11} />
                                    <span>{t('drive.remote_unselect_all_btn')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="td-remote-paste-action"
                                    onClick={() => probeUrl(url.trim(), passcode.trim())}
                                    disabled={submitting || inspection?.status === 'inspecting'}
                                    title={t('drive.remote_batch_reinspect_btn')}
                                  >
                                    <RefreshCw size={10} className={inspection?.status === 'inspecting' ? 'spin' : ''} />
                                    <span>{t('drive.remote_batch_reinspect_btn')}</span>
                                  </button>
                                </div>
                              </div>

                              {hasMultipleFilters && (
                                <div className="td-remote-format-filter-bar">
                                  <button
                                    type="button"
                                    className={`td-remote-format-filter-chip ${isGeneralTab ? 'active' : ''}`}
                                    onClick={() => setStreamContainerFilter('general')}
                                  >
                                    <span>{t('drive.remote_format_filter_general')}</span>
                                    <span>({curatedGeneralVideos.length + audioFmts.length + subtitleFmts.length})</span>
                                  </button>
                                  {hasVideos && (
                                    <button
                                      type="button"
                                      className={`td-remote-format-filter-chip ${isVideoTab ? 'active' : ''}`}
                                      onClick={() => setStreamContainerFilter('video')}
                                    >
                                      <span>{t('drive.remote_format_filter_video_tab')}</span>
                                      <span>({mp4VideoFmts.length + webmVideoFmts.length})</span>
                                    </button>
                                  )}
                                  {hasAudio && (
                                    <button
                                      type="button"
                                      className={`td-remote-format-filter-chip ${isAudioTab ? 'active' : ''}`}
                                      onClick={() => setStreamContainerFilter('audio')}
                                    >
                                      <span>{t('drive.remote_format_filter_audio_tab')}</span>
                                      <span>({audioFmts.length})</span>
                                    </button>
                                  )}
                                  {hasSubtitle && (
                                    <button
                                      type="button"
                                      className={`td-remote-format-filter-chip ${isSubtitleTab ? 'active' : ''}`}
                                      onClick={() => setStreamContainerFilter('subtitle')}
                                    >
                                      <span>{t('drive.remote_format_filter_subtitle')}</span>
                                      <span>({subtitleFmts.length})</span>
                                    </button>
                                  )}
                                  {hasRawMatrix && (
                                    <button
                                      type="button"
                                      className={`td-remote-format-filter-chip matrix-toggle ${isAdvanceTab ? 'active' : ''}`}
                                      onClick={() => setStreamContainerFilter('advance')}
                                    >
                                      <span>{t('drive.remote_format_filter_advance')}</span>
                                      <span>({rawStreamsList.length})</span>
                                    </button>
                                  )}
                                </div>
                              )}

                              {isAdvanceTab && hasRawMatrix ? (
                                (() => {
                                  const rawMp4Videos = filteredRawStreams
                                    .filter((s) => s.type !== 'audio' && (s.mimeType.includes('mp4') || s.codec.includes('AVC') || s.codec.includes('H.264') || s.codec.includes('AV1')))
                                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                                  const rawWebmVideos = filteredRawStreams
                                    .filter((s) => s.type !== 'audio' && (s.mimeType.includes('webm') || s.codec.includes('VP9')))
                                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                                  const rawOtherVideos = filteredRawStreams
                                    .filter((s) => s.type !== 'audio' && !rawMp4Videos.some((m) => m.itag === s.itag) && !rawWebmVideos.some((w) => w.itag === s.itag))
                                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                                  const rawAudioStreams = filteredRawStreams
                                    .filter((s) => s.type === 'audio')
                                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                                  const renderMatrixRow = (s: RawStreamItem) => {
                                    const matchedFmt = resolvedMedia.formats.find((f) => (f.itag && f.itag === s.itag) || f.id === `raw_itag_${s.itag}`) || {
                                      id: `raw_itag_${s.itag}`,
                                      label: `${s.qualityLabel || s.codec} (itag ${s.itag})`,
                                      qualityTier: 'original' as const,
                                      resolution: `${s.qualityLabel || s.codec} • ${s.bitrateFormatted}`,
                                      ext: s.mimeType.includes('webm') || s.mimeType.includes('opus') ? 'webm' : (s.type === 'audio' ? 'm4a' : 'mp4'),
                                      filesizeBytes: s.filesizeBytes,
                                      directUrl: s.directUrl,
                                      isVideo: s.type === 'video' || s.type === 'muxed',
                                      isAudio: s.type === 'audio',
                                      badge: s.isHdr ? `HDR • ${s.bitrateFormatted}` : s.bitrateFormatted,
                                      itag: s.itag,
                                    };
                                    const isSelected = Boolean(
                                      selectedFormatId &&
                                      (selectedFormatId === matchedFmt.id || (activeFmt?.itag && activeFmt.itag === s.itag))
                                    );
                                    return (
                                      <tr
                                        key={s.itag}
                                        className={`td-remote-matrix-row ${isSelected ? 'selected' : ''}`}
                                        onClick={() => handleToggleFormat(matchedFmt)}
                                        onDoubleClick={(e) => {
                                          e.stopPropagation();
                                          handlePlayFormat(matchedFmt);
                                        }}
                                        title={isSelected ? t('drive.remote_unselect_card_tooltip') : t('drive.remote_stream_double_click_hint')}
                                      >
                                        <td>
                                          <span className="td-remote-matrix-itag-badge">{s.itag}</span>
                                        </td>
                                        <td>
                                          <span style={{ fontWeight: 700, color: s.isHdr ? '#fbbf24' : '#ffffff' }}>
                                            {s.qualityLabel}
                                          </span>
                                          {s.fps ? <span style={{ color: '#34d399', marginLeft: 4, fontSize: '0.62rem' }}>{`${s.fps}fps`}</span> : null}
                                        </td>
                                        <td>
                                          <span>{s.codec}</span>
                                          <span style={{ color: '#64748b', marginLeft: 4, fontSize: '0.62rem' }}>
                                            ({s.mimeType.split('/')[1] || s.mimeType})
                                          </span>
                                        </td>
                                        <td>
                                          <span style={{ color: s.isHdr ? '#fbbf24' : '#38bdf8', fontWeight: 650 }}>
                                            {s.bitrateFormatted}
                                          </span>
                                        </td>
                                        <td>
                                          {s.filesizeBytes ? `~${formatDriveBytes(s.filesizeBytes)}` : '-'}
                                        </td>
                                        <td>
                                          <span className={`td-remote-matrix-type-badge ${s.type}`}>
                                            {s.type}
                                          </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                          <button
                                            type="button"
                                            className={`td-remote-matrix-select-btn ${isSelected ? 'selected' : ''}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleToggleFormat(matchedFmt);
                                            }}
                                            onDoubleClick={(e) => {
                                              e.stopPropagation();
                                              handlePlayFormat(matchedFmt);
                                            }}
                                            title={isSelected ? t('drive.remote_unselect_card_tooltip') : t('drive.remote_stream_double_click_hint')}
                                          >
                                            {isSelected ? t('drive.remote_matrix_selected_badge') : t('drive.remote_matrix_select_btn')}
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  };

                                  return (
                                    <div className="td-remote-matrix-wrapper">
                                      <div className="td-remote-matrix-search-box">
                                        <Search size={13} style={{ color: '#94a3b8' }} />
                                        <input
                                          type="text"
                                          value={matrixSearchQuery}
                                          onChange={(e) => setMatrixSearchQuery(e.target.value)}
                                          placeholder={t('drive.remote_matrix_search_placeholder')}
                                        />
                                        {matrixSearchQuery && (
                                          <button
                                            type="button"
                                            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                                            onClick={() => setMatrixSearchQuery('')}
                                          >
                                            <X size={12} />
                                          </button>
                                        )}
                                      </div>

                                      <div className="td-remote-matrix-table-scroll">
                                        <table className="td-remote-matrix-table">
                                          <thead>
                                            <tr>
                                              <th>{t('drive.remote_matrix_col_itag')}</th>
                                              <th>{t('drive.remote_matrix_col_resolution')}</th>
                                              <th>{t('drive.remote_matrix_col_codec')}</th>
                                              <th>{t('drive.remote_matrix_col_bitrate')}</th>
                                              <th>{t('drive.remote_matrix_col_size')}</th>
                                              <th>{t('drive.remote_matrix_col_type')}</th>
                                              <th style={{ textAlign: 'right' }}>{t('drive.remote_matrix_select_btn')}</th>
                                            </tr>
                                          </thead>
                                          {filteredRawStreams.length === 0 ? (
                                            <tbody>
                                              <tr>
                                                <td colSpan={7} style={{ textAlign: 'center', padding: '16px', color: '#64748b' }}>
                                                  {t('drive.remote_matrix_empty_search')}
                                                </td>
                                              </tr>
                                            </tbody>
                                          ) : (
                                            <>
                                              {rawMp4Videos.length > 0 && (
                                                <tbody className="td-remote-matrix-group-tbody">
                                                  <tr className="td-remote-matrix-group-header-row">
                                                    <td colSpan={7}>
                                                      <div className="td-remote-matrix-group-header">
                                                        <Film size={12} style={{ color: '#38bdf8' }} />
                                                        <span>{t('drive.remote_matrix_group_mp4')}</span>
                                                        <span className="td-remote-matrix-group-badge">{rawMp4Videos.length}</span>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  {rawMp4Videos.map(renderMatrixRow)}
                                                </tbody>
                                              )}

                                              {rawWebmVideos.length > 0 && (
                                                <tbody className="td-remote-matrix-group-tbody">
                                                  <tr className="td-remote-matrix-group-header-row">
                                                    <td colSpan={7}>
                                                      <div className="td-remote-matrix-group-header">
                                                        <Film size={12} style={{ color: '#fbbf24' }} />
                                                        <span>{t('drive.remote_matrix_group_webm')}</span>
                                                        <span className="td-remote-matrix-group-badge">{rawWebmVideos.length}</span>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  {rawWebmVideos.map(renderMatrixRow)}
                                                </tbody>
                                              )}

                                              {rawOtherVideos.length > 0 && (
                                                <tbody className="td-remote-matrix-group-tbody">
                                                  <tr className="td-remote-matrix-group-header-row">
                                                    <td colSpan={7}>
                                                      <div className="td-remote-matrix-group-header">
                                                        <Film size={12} style={{ color: '#a855f7' }} />
                                                        <span>{t('drive.remote_matrix_group_other_video')}</span>
                                                        <span className="td-remote-matrix-group-badge">{rawOtherVideos.length}</span>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  {rawOtherVideos.map(renderMatrixRow)}
                                                </tbody>
                                              )}

                                              {rawAudioStreams.length > 0 && (
                                                <tbody className="td-remote-matrix-group-tbody">
                                                  <tr className="td-remote-matrix-group-header-row">
                                                    <td colSpan={7}>
                                                      <div className="td-remote-matrix-group-header">
                                                        <Music size={12} style={{ color: '#c084fc' }} />
                                                        <span>{t('drive.remote_matrix_group_audio')}</span>
                                                        <span className="td-remote-matrix-group-badge">{rawAudioStreams.length}</span>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                  {rawAudioStreams.map(renderMatrixRow)}
                                                </tbody>
                                              )}
                                            </>
                                          )}
                                        </table>
                                      </div>
                                    </div>
                                  );
                                })()
                              ) : isGeneralTab ? (
                                <>
                                  {curatedGeneralVideos.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header">
                                        <span className="td-remote-formats-section-title">
                                          <Film size={11} style={{ color: '#38bdf8' }} />
                                          <span>{t('drive.remote_section_mp4_video')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{curatedGeneralVideos.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {curatedGeneralVideos.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}

                                  {hasAudio && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header">
                                        <span className="td-remote-formats-section-title">
                                          <Music size={11} style={{ color: '#c084fc' }} />
                                          <span>{t('drive.remote_section_audio_tracks')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{audioFmts.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {audioFmts.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}

                                  {hasSubtitle && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header">
                                        <span className="td-remote-formats-section-title">
                                          <FileText size={11} style={{ color: '#2dd4bf' }} />
                                          <span>{t('drive.remote_section_subtitles')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{filteredSubtitleFmts.length}</span>
                                      </div>
                                      {subtitleFmts.length > 3 && (
                                        <div className="td-remote-sub-search-box">
                                          <Search size={12} style={{ color: '#94a3b8' }} />
                                          <input
                                            type="text"
                                            value={subtitleSearchQuery}
                                            onChange={(e) => setSubtitleSearchQuery(e.target.value)}
                                            placeholder={t('drive.remote_sub_search_placeholder')}
                                          />
                                          {subtitleSearchQuery && (
                                            <button
                                              type="button"
                                              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                                              onClick={() => setSubtitleSearchQuery('')}
                                            >
                                              <X size={12} />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                      {filteredSubtitleFmts.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '12px', color: '#64748b', fontSize: '0.7rem' }}>
                                          {t('drive.remote_sub_empty_search')}
                                        </div>
                                      ) : (
                                        <div className="td-remote-quality-grid">
                                          {filteredSubtitleFmts.map(renderFormatChip)}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </>
                              ) : isVideoTab ? (
                                <>
                                  {mp4VideoFmts.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header">
                                        <span className="td-remote-formats-section-title">
                                          <Film size={11} style={{ color: '#38bdf8' }} />
                                          <span>{t('drive.remote_section_mp4_video')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{mp4VideoFmts.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {mp4VideoFmts.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}

                                  {webmVideoFmts.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header">
                                        <span className="td-remote-formats-section-title">
                                          <Film size={11} style={{ color: '#fbbf24' }} />
                                          <span>{t('drive.remote_section_webm_video')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{webmVideoFmts.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {webmVideoFmts.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : isAudioTab ? (
                                <>
                                  {audioFmts.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header">
                                        <span className="td-remote-formats-section-title">
                                          <Music size={11} style={{ color: '#c084fc' }} />
                                          <span>{t('drive.remote_section_audio_tracks')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{audioFmts.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {audioFmts.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : isSubtitleTab ? (
                                <>
                                  {subtitleFmts.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header">
                                        <span className="td-remote-formats-section-title">
                                          <FileText size={11} style={{ color: '#2dd4bf' }} />
                                          <span>{t('drive.remote_section_subtitles')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{filteredSubtitleFmts.length}</span>
                                      </div>
                                      <div className="td-remote-sub-search-box">
                                        <Search size={12} style={{ color: '#94a3b8' }} />
                                        <input
                                          type="text"
                                          value={subtitleSearchQuery}
                                          onChange={(e) => setSubtitleSearchQuery(e.target.value)}
                                          placeholder={t('drive.remote_sub_search_placeholder')}
                                        />
                                        {subtitleSearchQuery && (
                                          <button
                                            type="button"
                                            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                                            onClick={() => setSubtitleSearchQuery('')}
                                          >
                                            <X size={12} />
                                          </button>
                                        )}
                                      </div>
                                      {filteredSubtitleFmts.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '12px', color: '#64748b', fontSize: '0.7rem' }}>
                                          {t('drive.remote_sub_empty_search')}
                                        </div>
                                      ) : (
                                        <div className="td-remote-quality-grid">
                                          {filteredSubtitleFmts.map(renderFormatChip)}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </>
                              ) : null}

                              {activeFmt && (
                                <div className="td-remote-selected-spec-card">
                                  <div className="td-remote-selected-spec-left">
                                    <div className="td-remote-selected-spec-icon-box">
                                      {activeFmt.isSubtitle ? <FileText size={15} /> : activeFmt.isAudio ? <Music size={15} /> : <Film size={15} />}
                                    </div>
                                    <div className="td-remote-selected-spec-details">
                                      <span className="td-remote-selected-spec-title">
                                        {getFormatDisplayLabel(activeFmt, resolvedMedia, t)}
                                      </span>
                                      <div className="td-remote-selected-spec-meta">
                                        <span>{activeFmt.resolution || activeFmt.badge}</span>
                                        <span>•</span>
                                        <span>{activeFmt.ext ? `.${activeFmt.ext.toUpperCase()}` : '.MP4'}</span>
                                        {activeFmt.filesizeBytes ? (
                                          <>
                                            <span>•</span>
                                            <span>~{formatDriveBytes(activeFmt.filesizeBytes)}</span>
                                          </>
                                        ) : null}
                                        {resolvedMedia.chapters && resolvedMedia.chapters.length > 0 ? (
                                          <>
                                            <span>•</span>
                                            <span style={{ color: '#c084fc', fontWeight: 650 }}>
                                              {t('drive.remote_chapters_count', { count: resolvedMedia.chapters.length })}
                                            </span>
                                          </>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="td-remote-selected-spec-right">
                                    {activeFmt.directUrl && (
                                      <button
                                        type="button"
                                        className={`td-remote-spec-copy-btn ${copiedStreamUrl ? 'copied' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard?.writeText(activeFmt.directUrl);
                                          setCopiedStreamUrl(true);
                                          setTimeout(() => setCopiedStreamUrl(false), 2000);
                                        }}
                                        title={t('drive.remote_spec_copy_url_btn')}
                                      >
                                        {copiedStreamUrl ? <Check size={11} /> : <Copy size={11} />}
                                        <span>{copiedStreamUrl ? t('drive.remote_spec_url_copied') : t('drive.remote_spec_copy_url_btn')}</span>
                                      </button>
                                    )}
                                    <span className="td-remote-meta-badge status valid">
                                      {t('drive.remote_spec_direct_ready')}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : inspection?.status === 'inspecting' ? (
                <div className="td-remote-preview-inspecting-card">
                  <Loader2 size={32} className="td-remote-inspecting-spinner" />
                  <div className="td-remote-inspecting-title">{t('drive.remote_inspecting')}</div>
                  <div className="td-remote-inspecting-subtitle">{t('drive.remote_split_inspecting_desc')}</div>
                </div>
              ) : inspection && url.trim() ? (
                <div className="td-remote-preview-content">
                  <div className={`td-remote-inspector-card kind-${inspection.kind}`}>
                    <div className="td-remote-inspector-icon">
                      {fileKindIcon(inspection.kind)}
                    </div>
                    <div className="td-remote-inspector-info">
                      <div className="td-remote-inspector-name" title={inspection.filename}>
                        {inspection.filename}
                      </div>
                      <div className="td-remote-inspector-meta">
                        {inspection.size ? (
                          <span className="td-remote-meta-badge size">
                            {formatDriveBytes(inspection.size)}
                          </span>
                        ) : (
                          <span className="td-remote-meta-badge stream">
                            {t('drive.remote_inspect_size_unknown')}
                          </span>
                        )}
                        <span className={`td-remote-meta-badge status ${inspection.status}`}>
                          {inspection.status === 'valid' ? (
                            <>
                              <CheckCircle2 size={11} />
                              <span>{t('drive.remote_inspect_valid')}</span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={11} />
                              <span>{t('drive.remote_inspect_direct_stream')}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>
          ) : (
            /* BATCH TAB */
            batchGroups.length === 0 || isEditingBatchText ? (
              <div className="td-remote-form-card">
                <div className="td-remote-field-group">
                  <div className="td-remote-label-row">
                    <div className="td-remote-label-left" ref={infoRef}>
                      <label className="td-input-label" htmlFor="td-remote-batch-input">
                        {t('drive.remote_tab_batch')}
                      </label>
                      <button
                        type="button"
                        className={`td-remote-info-trigger ${showSupportedInfo ? 'active' : ''}`}
                        onClick={() => setShowSupportedInfo((prev) => !prev)}
                        title={t('drive.remote_info_btn_aria')}
                        aria-label={t('drive.remote_info_btn_aria')}
                        aria-expanded={showSupportedInfo}
                      >
                        <Info size={12} />
                      </button>
                      {renderSupportedLinksPopover()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="td-remote-paste-action"
                        onClick={handlePasteClipboard}
                        disabled={submitting || batchInspecting}
                        title={t('drive.remote_paste_clipboard')}
                      >
                        <Clipboard size={12} />
                        <span>{t('drive.remote_paste_clipboard')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="td-remote-batch-quality-bar">
                    <div className="td-remote-batch-quality-label">
                      <SlidersHorizontal size={13} style={{ color: '#38bdf8' }} />
                      <span>{t('drive.remote_batch_quality_label')}</span>
                    </div>
                    <div className="td-remote-batch-quality-select-wrap">
                      <select
                        className="td-remote-batch-quality-select"
                        value={batchQualityPreference}
                        onChange={(e) => setBatchQualityPreference(e.target.value as BatchQualityPreference)}
                        disabled={submitting || batchInspecting}
                      >
                        <option value="best">{t('drive.remote_batch_quality_best')}</option>
                        <option value="1080p">{t('drive.remote_batch_quality_1080p')}</option>
                        <option value="720p">{t('drive.remote_batch_quality_720p')}</option>
                        <option value="audio">{t('drive.remote_batch_quality_audio')}</option>
                      </select>
                    </div>
                  </div>
                  <textarea
                    id="td-remote-batch-input"
                    className="td-input-field td-remote-batch-textarea"
                    rows={6}
                    placeholder={t('drive.remote_batch_placeholder')}
                    value={batchUrlsText}
                    onChange={(e) => {
                      setBatchUrlsText(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    disabled={submitting || batchInspecting}
                    spellCheck={false}
                  />
                  <div className="td-remote-batch-footer">
                    <span className="td-remote-batch-hint">
                      {batchUrls.length > 0
                        ? t('drive.remote_batch_count', { count: batchUrls.length })
                        : t('drive.remote_batch_empty_hint')}
                    </span>
                    <div className="td-remote-batch-footer-actions">
                      {batchGroups.length > 0 && (
                        <button
                          type="button"
                          className="td-btn-secondary td-remote-return-preview-btn"
                          onClick={() => setIsEditingBatchText(false)}
                          disabled={submitting || batchInspecting}
                          title={t('drive.remote_batch_view_preview_btn')}
                        >
                          <LayoutGrid size={13} />
                          <span>{t('drive.remote_batch_view_preview_btn')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="td-btn-primary td-remote-inspect-action-btn"
                        onClick={handleInspectBatchUrls}
                        disabled={batchUrls.length === 0 || batchInspecting || submitting}
                      >
                        {batchInspecting ? (
                          <>
                            <Loader2 size={13} className="spin" />
                            <span>
                              {t('drive.remote_batch_inspecting_status', {
                                current: batchInspectProgress.current,
                                total: batchInspectProgress.total,
                              })}
                            </span>
                          </>
                        ) : batchGroups.length > 0 ? (
                          <>
                            <RefreshCw size={13} />
                            <span>{t('drive.remote_batch_reinspect_all_btn')}</span>
                          </>
                        ) : (
                          <>
                            <Search size={13} />
                            <span>{t('drive.remote_batch_inspect_btn')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Delivery Format, Transfer Engine & Storage Policy Triplet Row in Batch tab */}
                {renderTripletAndDestinationControls(true)}
              </div>
            ) : (
              /* BATCH RESOLVED GALLERY & SPLIT PREVIEW */
              <div className="td-remote-stream-split-wrap is-batch-studio">
                {/* LEFT PANEL: FOCUSED MEDIA PREVIEW */}
                <div className="td-remote-stream-player-col">
                  <div className="td-remote-big-canvas-wrap">
                    {focusedBatchItem ? (
                      focusedBatchItem.isVideo ? (
                        <div className="td-remote-big-canvas-inner td-remote-single-player-canvas">
                          <video
                            key={batchPlayableUrl || focusedBatchItem.directUrl}
                            src={batchPlayableUrl || focusedBatchItem.directUrl}
                            poster={focusedBatchItem.thumbnailUrl}
                            controls
                            preload="metadata"
                            playsInline
                            className="td-remote-big-canvas-video td-remote-active-player-video"
                            crossOrigin="anonymous"
                            onLoadedData={(e) => {
                              const v = e.currentTarget;
                              if (focusedBatchItem && !focusedBatchItem.thumbnailUrl) {
                                const thumb = captureVideoCanvasThumbnail(v);
                                if (thumb) {
                                  setBatchGroups((prev) =>
                                    prev.map((grp) => ({
                                      ...grp,
                                      items: grp.items.map((it) => (it.id === focusedBatchItem.id ? { ...it, thumbnailUrl: thumb } : it)),
                                    }))
                                  );
                                }
                              }
                            }}
                            onLoadedMetadata={(e) => {
                              const v = e.currentTarget;
                              const dur = v.duration;
                              if (dur && isFinite(dur) && dur > 0 && focusedBatchItem) {
                                const d = Math.round(dur);
                                setBatchItemDurations((prev) => ({ ...prev, [focusedBatchItem.id]: d }));
                              }
                              if (focusedBatchItem && !focusedBatchItem.thumbnailUrl) {
                                const thumb = captureVideoCanvasThumbnail(v);
                                if (thumb) {
                                  setBatchGroups((prev) =>
                                    prev.map((grp) => ({
                                      ...grp,
                                      items: grp.items.map((it) => (it.id === focusedBatchItem.id ? { ...it, thumbnailUrl: thumb } : it)),
                                    }))
                                  );
                                }
                              }
                            }}
                          />
                        </div>
                      ) : focusedBatchItem.kind === 'photo' ? (
                        <div className="td-remote-big-canvas-inner">
                          <img
                            src={focusedBatchItem.directUrl || focusedBatchItem.thumbnailUrl}
                            alt={focusedBatchItem.title}
                            className="td-remote-big-canvas-img"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="td-remote-big-canvas-fallback">
                          <FileText size={36} className="td-remote-fallback-icon" />
                          <span>{focusedBatchItem.filename}</span>
                        </div>
                      )
                    ) : (
                      <div className="td-remote-big-canvas-fallback">
                        <Film size={36} className="td-remote-fallback-icon" />
                        <span>{t('drive.remote_split_ready_desc')}</span>
                      </div>
                    )}
                  </div>

                  {/* Active Item Details Bar */}
                  {focusedBatchItem && (
                    <div className="td-remote-stream-filename-bar">
                      <div className="td-remote-filename-display-view">
                        <div className="td-remote-filename-display-main" title={focusedBatchItem.filename}>
                          <span className="td-remote-filename-display-base">
                            {focusedBatchItem.filename.replace(/\.[a-zA-Z0-9]+$/, '')}
                          </span>
                          <span className="td-remote-filename-display-ext">
                            {focusedBatchItem.filename.match(/\.[a-zA-Z0-9]+$/)?.[0] || ''}
                          </span>
                        </div>
                        <div className="td-remote-stream-meta-ribbon">
                          {focusedBatchItem.qualityBadge && (
                            <span className="td-remote-stream-ribbon-badge">
                              {focusedBatchItem.qualityBadge}
                            </span>
                          )}
                          {focusedBatchItem.filesizeBytes ? (
                            <span className="td-remote-meta-size" style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600 }}>
                              ~{formatDriveBytes(focusedBatchItem.filesizeBytes)}
                            </span>
                          ) : null}
                          {(batchItemDurations[focusedBatchItem.id] || focusedBatchItem.durationSec) ? (
                            <span className="td-remote-item-duration-badge" style={{ fontSize: '0.65rem' }}>
                              <Clock size={10} />
                              <span>{formatMediaDuration(batchItemDurations[focusedBatchItem.id] || focusedBatchItem.durationSec)}</span>
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={`td-remote-quick-select-toggle ${selectedBatchItemIds.has(focusedBatchItem.id) ? 'active' : ''}`}
                            onClick={() => handleToggleBatchItem(focusedBatchItem.id)}
                          >
                            {selectedBatchItemIds.has(focusedBatchItem.id) ? (
                              <>
                                <Check size={11} strokeWidth={3} />
                                <span>{t('drive.preflight_include_item')}</span>
                              </>
                            ) : (
                              <>
                                <Square size={11} />
                                <span>{t('drive.preflight_skip_item')}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT PANEL: GROUPED CARDS & ACTIONS */}
                <div className="td-remote-stream-gallery-col">
                  {/* Header: Total summary & Action buttons */}
                  <div className="td-remote-gallery-header-row">
                    <div className="td-batch-header-title-group">
                      <div className="td-batch-header-icon-box">
                        <Layers size={13} />
                      </div>
                      <span className="td-batch-header-title-text">
                        {t('drive.remote_batch_all_groups_ready', { count: batchGroups.length })}
                      </span>
                      {allBatchItems.length > 0 && (
                        <div className="td-batch-header-stat-pill">
                          <span className="td-batch-stat-count">
                            {t('drive.remote_batch_item_count', { count: allBatchItems.length })}
                          </span>
                          <span className="td-batch-stat-sep">•</span>
                          <span className="td-batch-stat-size">
                            ~{formatDriveBytes(allBatchItems.reduce((acc, it) => acc + (it.filesizeBytes || 0), 0))}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="td-batch-header-actions-group">
                      <button
                        type="button"
                        className="td-batch-action-pill"
                        onClick={() => setIsEditingBatchText(true)}
                        title={t('drive.remote_batch_edit_urls')}
                      >
                        <Pencil size={11} />
                        <span>{t('drive.remote_batch_edit_urls')}</span>
                      </button>
                      <button
                        type="button"
                        className="td-batch-action-pill"
                        onClick={handleInspectBatchUrls}
                        disabled={batchInspecting}
                        title={t('drive.remote_batch_reinspect_btn')}
                      >
                        <RefreshCw size={11} className={batchInspecting ? 'spin' : ''} />
                        <span>{t('drive.remote_batch_reinspect_btn')}</span>
                      </button>

                      <div className="td-batch-actions-separator" />

                      <div className="td-batch-selection-segmented">
                        <button
                          type="button"
                          className="td-batch-seg-btn select-all"
                          onClick={() => handleToggleAllBatchItems(true)}
                          title={t('drive_tools.remote_gallery_select_all')}
                        >
                          <CheckSquare size={11} />
                          <span>{t('drive_tools.remote_gallery_select_all')}</span>
                        </button>
                        <button
                          type="button"
                          className="td-batch-seg-btn deselect-all"
                          onClick={() => handleToggleAllBatchItems(false)}
                          title={t('drive_tools.remote_gallery_deselect_all')}
                        >
                          <Square size={11} />
                          <span>{t('drive_tools.remote_gallery_deselect_all')}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Toolbar: Search input + Filter Chips */}
                  <div className="td-remote-gallery-toolbar">
                    <div className="td-remote-gallery-toolbar-left">
                      <div className="td-remote-gallery-search-wrap">
                        <Search size={11} className="td-remote-gallery-search-icon" />
                        <input
                          type="text"
                          className="td-remote-gallery-search-input"
                          placeholder={t('drive_tools.remote_gallery_search_placeholder', { count: allBatchItems.length })}
                          value={batchSearchQuery}
                          onChange={(e) => setBatchSearchQuery(e.target.value)}
                        />
                        {batchSearchQuery && (
                          <button
                            type="button"
                            className="td-remote-gallery-search-clear"
                            onClick={() => setBatchSearchQuery('')}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>

                      <div className="td-remote-gallery-filters">
                        <button
                          type="button"
                          className={`td-remote-filter-chip ${batchFilterType === 'all' ? 'active' : ''}`}
                          onClick={() => setBatchFilterType('all')}
                        >
                          {t('drive.remote_batch_filter_all')} ({allBatchItems.length})
                        </button>
                        {allBatchItems.some((i) => i.isVideo) && (
                          <button
                            type="button"
                            className={`td-remote-filter-chip ${batchFilterType === 'video' ? 'active' : ''}`}
                            onClick={() => setBatchFilterType('video')}
                          >
                            {t('drive.remote_batch_filter_video')} ({allBatchItems.filter((i) => i.isVideo).length})
                          </button>
                        )}
                        {allBatchItems.some((i) => i.kind === 'photo') && (
                          <button
                            type="button"
                            className={`td-remote-filter-chip ${batchFilterType === 'photo' ? 'active' : ''}`}
                            onClick={() => setBatchFilterType('photo')}
                          >
                            {t('drive.remote_batch_filter_photo')} ({allBatchItems.filter((i) => i.kind === 'photo').length})
                          </button>
                        )}
                        <button
                          type="button"
                          className={`td-remote-filter-chip ${batchFilterType === 'selected' ? 'active' : ''}`}
                          onClick={() => setBatchFilterType('selected')}
                        >
                          {t('drive.remote_batch_filter_selected')} ({selectedBatchItems.length})
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* GROUPS ACCORDION LIST */}
                  <div className="td-remote-batch-groups-list">
                    {batchGroups.map((group) => {
                      const groupFilteredItems = group.items.filter((it) => {
                        if (batchSearchQuery.trim()) {
                          const q = batchSearchQuery.trim().toLowerCase();
                          const matchName = it.filename.toLowerCase().includes(q);
                          const matchTitle = it.title ? it.title.toLowerCase().includes(q) : false;
                          if (!matchName && !matchTitle) return false;
                        }
                        if (batchFilterType === 'video') return it.isVideo;
                        if (batchFilterType === 'photo') return it.kind === 'photo';
                        if (batchFilterType === 'selected') return selectedBatchItemIds.has(it.id);
                        return true;
                      });
                      const allGroupSelected = group.items.length > 0 && group.items.every((it) => selectedBatchItemIds.has(it.id));
                      const someGroupSelected = group.items.some((it) => selectedBatchItemIds.has(it.id));
                      const groupTotalBytes = group.items.reduce((acc, it) => acc + (it.filesizeBytes || 0), 0);

                      const isCollapsed = collapsedGroupIds.has(group.id);

                      return (
                        <div
                          className={`td-remote-batch-group ${isCollapsed ? 'is-collapsed' : ''}`}
                          key={group.id}
                        >
                          <div className="td-remote-batch-group-head" onClick={() => handleToggleGroupCollapse(group.id)}>
                            <div className="td-remote-batch-group-head-left">
                              <span className="td-remote-batch-group-ico-wrap">
                                {group.status === 'resolving' ? (
                                  <Loader2 size={13} className="spin td-remote-batch-spinner" />
                                ) : group.status === 'error' ? (
                                  <XCircle size={13} className="td-remote-batch-err-ico" />
                                ) : (
                                  <Folder size={13} className="td-remote-batch-folder-ico" />
                                )}
                              </span>

                              <div className="td-remote-batch-group-info-col">
                                <div className="td-remote-batch-group-title-row">
                                  <span className="td-remote-batch-group-title" title={group.title}>
                                    {group.title}
                                  </span>
                                  {group.status === 'success' && (
                                    <span className="td-remote-batch-group-badge">
                                      {t('drive.remote_batch_item_count', { count: group.items.length })}{groupTotalBytes > 0 ? ` · ~${formatDriveBytes(groupTotalBytes)}` : ''}
                                    </span>
                                  )}
                                </div>

                                <div className="td-remote-batch-group-url-row">
                                  <span
                                    className="td-remote-batch-group-url"
                                    title={group.sourceUrl}
                                    onClick={(e) => {
                                      if (window.getSelection()?.toString().length) {
                                        e.stopPropagation();
                                      }
                                    }}
                                  >
                                    {group.sourceUrl}
                                  </span>
                                  <button
                                    type="button"
                                    className={`td-remote-batch-copy-url-btn ${copiedUrlGroupId === group.id ? 'is-copied' : ''}`}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await navigator.clipboard.writeText(group.sourceUrl);
                                        setCopiedUrlGroupId(group.id);
                                        setTimeout(() => setCopiedUrlGroupId(null), 1800);
                                      } catch (_) {}
                                    }}
                                    title={copiedUrlGroupId === group.id ? t('drive.remote_copied') : t('drive.remote_copy_link')}
                                    aria-label={copiedUrlGroupId === group.id ? t('drive.remote_copied') : t('drive.remote_copy_link')}
                                  >
                                    {copiedUrlGroupId === group.id ? (
                                      <Check size={9.5} className="text-emerald-400" />
                                    ) : (
                                      <Copy size={9.5} />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="td-remote-batch-open-url-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenInBrowser(group.sourceUrl);
                                    }}
                                    title={t('drive.remote_open_in_browser')}
                                    aria-label={t('drive.remote_open_in_browser')}
                                  >
                                    <ExternalLink size={9.5} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="td-remote-batch-group-head-right">
                              {group.status === 'success' && (
                                <button
                                  type="button"
                                  className={`td-remote-batch-group-select-btn ${allGroupSelected ? 'is-all-selected' : someGroupSelected ? 'is-partial-selected' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleBatchGroup(group.id, !allGroupSelected);
                                  }}
                                >
                                  {allGroupSelected ? (
                                    <>
                                      <CheckSquare size={11} />
                                      <span>{t('drive.remote_batch_group_deselect_all')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Square size={11} />
                                      <span>{t('drive.remote_batch_group_select_all')}</span>
                                    </>
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                className="td-remote-batch-group-collapse-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleGroupCollapse(group.id);
                                }}
                                aria-label={isCollapsed ? t('drive.remote_batch_expand_group') : t('drive.remote_batch_collapse_group')}
                              >
                                {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                              </button>
                            </div>
                          </div>

                          {!isCollapsed && (
                            <div className="td-remote-batch-group-body">
                              {group.status === 'resolving' ? (
                                <div className="td-remote-batch-resolving-row">
                                  <Loader2 size={16} className="spin" />
                                  <span>{t('drive.remote_inspecting')}</span>
                                </div>
                              ) : group.status === 'error' ? (
                                <div className="td-remote-batch-error-card">
                                  <div className="td-remote-batch-error-msg">
                                    {group.errorMessage || t('drive.remote_batch_error_title')}
                                  </div>
                                  <div className="td-remote-batch-error-actions">
                                    <button
                                      type="button"
                                      className="td-remote-batch-retry-btn"
                                      onClick={() => handleRetryBatchGroup(group.id)}
                                    >
                                      <RotateCcw size={12} />
                                      <span>{t('drive.remote_batch_retry_link')}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="td-remote-batch-remove-btn"
                                      onClick={() => handleRemoveBatchGroup(group.id)}
                                    >
                                      <Trash2 size={12} />
                                      <span>{t('drive.remote_batch_remove_link')}</span>
                                    </button>
                                  </div>
                                </div>
                              ) : groupFilteredItems.length === 0 ? (
                                <div className="td-remote-batch-no-items">
                                  {t('drive_tools.no_media_found')}
                                </div>
                              ) : (
                                <div className="td-remote-gallery-grid-wrap view-grid">
                                  {groupFilteredItems.map((item) => (
                                    <BatchMediaCard
                                      key={item.id}
                                      item={item}
                                      isSelected={selectedBatchItemIds.has(item.id)}
                                      isFocused={focusedBatchItem?.id === item.id}
                                      itemDur={batchItemDurations[item.id] || item.durationSec}
                                      onCardClick={handleBatchCardClick}
                                      onCardDoubleClick={handleBatchCardDoubleClick}
                                      onToggleItem={handleToggleBatchItem}
                                      t={t}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        <footer className="td-confirm-foot td-remote-foot">
          <div className="td-remote-foot-dest-summary">
            <span className="td-remote-foot-dest-label">{t('drive_tools.remote_footer_target_label')}</span>
            {storagePolicy === 'custom_disk' ? (
              <span className="td-remote-foot-dest-badge" title={customDiskPath || t('drive_tools.remote_custom_disk_path_label')}>
                <Folder size={12} />
                <span className="td-remote-foot-dest-text">
                  {customDiskPath ? customDiskPath.split(/[\\/]/).filter(Boolean).pop() || customDiskPath : t('drive_tools.remote_policy_custom_disk')}
                </span>
              </span>
            ) : storagePolicy === 'disk_and_telegram' ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap' }}>
                <span className="td-remote-foot-dest-badge" title={cleanTargetDisplay.title}>
                  {selectedDest.kind === 'saved' ? <Home size={12} /> : <Folder size={12} />}
                  <span className="td-remote-foot-dest-text">{cleanTargetDisplay.title}</span>
                  {cleanTargetDisplay.topicPill && (
                    <span className="td-remote-foot-topic-tag">
                      {cleanTargetDisplay.topicPill}
                    </span>
                  )}
                </span>
                <span className="td-remote-foot-dest-plus">+</span>
                <span className="td-remote-foot-dest-badge" title={customDiskPath || t('drive_tools.remote_custom_disk_path_label')}>
                  <Folder size={12} />
                  <span className="td-remote-foot-dest-text">
                    {customDiskPath ? customDiskPath.split(/[\\/]/).filter(Boolean).pop() || customDiskPath : t('drive_tools.remote_policy_custom_disk')}
                  </span>
                </span>
              </div>
            ) : (
              <span className="td-remote-foot-dest-badge" title={cleanTargetDisplay.title}>
                {selectedDest.kind === 'saved' ? <Home size={12} /> : <Folder size={12} />}
                <span className="td-remote-foot-dest-text">{cleanTargetDisplay.title}</span>
                {cleanTargetDisplay.topicPill && (
                  <span className="td-remote-foot-topic-tag">
                    {cleanTargetDisplay.topicPill}
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="td-remote-foot-actions">
            <button
              type="button"
              className="td-confirm-btn ghost"
              onClick={onClose}
              disabled={submitting || batchInspecting}
            >
              {t('accounts.cancel')}
            </button>
            <button
              type="submit"
              className="td-confirm-btn primary td-remote-submit-btn"
              disabled={
                submitting ||
                batchInspecting ||
                (tab === 'single'
                  ? !url.trim() || (effectiveMediaItems.length > 1 && selectedMediaItemIds.size === 0)
                  : batchGroups.length > 0 && !isEditingBatchText
                  ? selectedBatchItems.length === 0
                  : batchUrls.length === 0)
              }
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="spin" />
                  <span>{t('drive.uploading_status')}</span>
                </>
              ) : batchInspecting ? (
                <>
                  <Loader2 size={15} className="spin" />
                  <span>
                    {t('drive.remote_batch_inspecting_status', {
                      current: batchInspectProgress.current,
                      total: batchInspectProgress.total,
                    })}
                  </span>
                </>
              ) : (
                <>
                  {storagePolicy === 'custom_disk' ? (
                    <Folder size={15} strokeWidth={2.25} />
                  ) : storagePolicy === 'disk_and_telegram' ? (
                    <Layers size={15} strokeWidth={2.25} />
                  ) : (
                    <Link2 size={15} strokeWidth={2.25} />
                  )}
                  <span>
                    {tab === 'single'
                      ? effectiveMediaItems.length > 1
                        ? selectedMediaItemIds.size === 0
                          ? t('drive.remote_btn_select_at_least_one')
                          : storagePolicy === 'custom_disk'
                          ? t('drive_tools.remote_btn_save_count', {
                              count: selectedMediaItemIds.size,
                              size: selectedBytes > 0 ? ` (~${formatDriveBytes(selectedBytes)})` : '',
                            })
                          : storagePolicy === 'disk_and_telegram'
                          ? t('drive_tools.remote_btn_save_upload_count', {
                              count: selectedMediaItemIds.size,
                              size: selectedBytes > 0 ? ` (~${formatDriveBytes(selectedBytes)})` : '',
                            })
                          : t('drive.remote_btn_upload_count', {
                              count: selectedMediaItemIds.size,
                              size: selectedBytes > 0 ? ` (~${formatDriveBytes(selectedBytes)})` : '',
                            })
                        : storagePolicy === 'custom_disk'
                        ? t('drive_tools.remote_btn_save_single')
                        : storagePolicy === 'disk_and_telegram'
                        ? t('drive_tools.remote_btn_save_upload_single')
                        : t('drive.remote_btn_start_single')
                      : batchGroups.length > 0 && !isEditingBatchText
                      ? selectedBatchItems.length === 0
                        ? t('drive.remote_batch_no_selected_hint')
                        : storagePolicy === 'custom_disk'
                        ? t('drive_tools.remote_btn_save_count', {
                            count: selectedBatchItems.length,
                            size: selectedBatchBytes > 0 ? ` (~${formatDriveBytes(selectedBatchBytes)})` : '',
                          })
                        : storagePolicy === 'disk_and_telegram'
                        ? t('drive_tools.remote_btn_save_upload_count', {
                            count: selectedBatchItems.length,
                            size: selectedBatchBytes > 0 ? ` (~${formatDriveBytes(selectedBatchBytes)})` : '',
                          })
                        : t('drive.remote_batch_upload_btn', {
                            count: selectedBatchItems.length,
                            size: selectedBatchBytes > 0 ? `~${formatDriveBytes(selectedBatchBytes)}` : '',
                          })
                      : t('drive.remote_batch_inspect_btn')}
                  </span>
                </>
              )}
            </button>
          </div>
        </footer>
      </form>

      <DriveDestinationPicker state={pickerState} onClose={() => setPickerOpen(false)} />
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
