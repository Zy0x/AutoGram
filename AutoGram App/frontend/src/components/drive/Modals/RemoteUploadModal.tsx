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
  Layers,
  Clock,
} from 'lucide-react';
import type { DriveDestChoice, DriveDestPickerState } from './DriveDestinationPicker';
import { DriveDestinationPicker } from './DriveDestinationPicker';
import type { DriveCredentials } from '../../../lib/telegram/driveApi/driveApiUtils';
import { driveListTopics } from '../../../lib/telegram/driveApi/driveFoldersApi';
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
  type RemoteMuxSpec,
} from '../../../lib/telegram/linkResolvers';
import { isRemoteUrlSafetyError } from '../../../lib/telegram/linkResolvers/urlSafety';
import {
  type DriveTransferSettings,
  resolveDefaultDeliveryMode,
} from '../Transfers/transferSettingsModel';
import type { RemoteEngineMode, StorageLocalPolicy } from '../../../lib/telegram/driveTypes';
import {
  canTransferResolvedFormat,
  formatMediaDuration,
  getEffectiveFormatFilename,
  inferFilenameFromUrl,
  inferKindFromExt,
  isInspectableRemoteUrl,
  isManifestFormat,
  mergeRemoteDiscoveryResults,
  sanitizeAndNormalizeFilename,
  splitFilenameAndExt,
  type BatchQualityPreference,
  type DeliveryMode,
  type RemoteUploadTab,
  type UrlInspection,
} from '../../../features/remote-upload/domain';
import { RemoteUploadSinglePanel } from './RemoteUploadSinglePanel';
import { RemoteUploadBatchPanel } from './RemoteUploadBatchPanel';
import { createRemoteUploadRenderers } from './remoteUploadRenderers';
import { createRemoteUploadSubmitHandler } from './remoteUploadSubmit';
import { useRemoteUploadBatchActions } from './useRemoteUploadBatchActions';
import { fileKindIcon, renderBadge, getBadgeModifierClass, getMeasuredFormatBadge } from './remoteUploadUiPrimitives';
import type { BatchMediaItem, BatchUrlResultGroup } from '../../../features/remote-upload/domain';
import { getProviderReferer, hasKnownRemoteProvider } from '../../../features/remote-upload/providerCatalog';
export type { BatchMediaItem, BatchUrlResultGroup } from '../../../features/remote-upload/domain';
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
      /** One optional adaptive video/audio pair per uploaded URL. */
      remoteMuxes?: Array<RemoteMuxSpec | null>;
    }
  ) => Promise<boolean | void>;
} function getFormatDisplayLabel(
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
  // Do not surface a resolver/provider badge as a quality claim. Labels such
  // as "8K" or "60 FPS" are occasionally derived from a page title by an
  // upstream provider. Resolution, FPS and HDR have dedicated rendering below
  // and are only shown from measured format metadata.
  if (fmt.isVideo) {
    const bitrate = Number(fmt.bitrate || 0);
    return bitrate > 0
      ? t('drive.remote_format_bitrate_mbps', { value: (bitrate / 1_000_000).toFixed(bitrate >= 10_000_000 ? 1 : 2) })
      : undefined;
  }
  if (fmt.isAudio || fmt.qualityTier === 'audio') {
    const bitrate = Number(fmt.audioBitrate || fmt.bitrate || 0);
    return bitrate > 0 ? t('drive.remote_format_bitrate_kbps', { value: Math.round(bitrate / 1_000) }) : undefined;
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

  // Only extractor/probe dimensions are evidence. Labels, badges, and page
  // titles are presentation text and must never manufacture a 4K/8K tier.
  const width = knownRes?.width || fmt.width;
  const height = knownRes?.height || fmt.height;

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
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [assistedSessionId, setAssistedSessionId] = useState<string | null>(null);
  type StreamContainerFilter = 'all' | 'general' | 'video' | 'mp4' | 'webm' | 'sd' | 'audio' | 'subtitle' | 'advance' | 'matrix';
  const [streamContainerFilter, setStreamContainerFilter] = useState<StreamContainerFilter>('all');
  const [matrixSearchQuery, setMatrixSearchQuery] = useState<string>('');
  const [matrixHideM3u8, setMatrixHideM3u8] = useState<boolean>(() => transferSettings?.remoteHideManifests !== false);
  const [subtitleSearchQuery, setSubtitleSearchQuery] = useState<string>('');
  const [subtitleTypeFilter, setSubtitleTypeFilter] = useState<'all' | 'id' | 'en' | 'manual' | 'auto' | 'srt' | 'vtt' | 'ass'>('all');
  const [copiedStreamUrl, setCopiedStreamUrl] = useState<boolean>(false);
  const [isPlayingStream, setIsPlayingStream] = useState<boolean>(false);
  const [selectedMediaItemIds, setSelectedMediaItemIds] = useState<Set<string>>(new Set());
  const [itemSelectedFormats, setItemSelectedFormats] = useState<Record<string, string>>({});
  const [activePreviewItemId, setActivePreviewItemId] = useState<string>('');
  const playRequestRef = useRef(0);

  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  useEffect(() => {
    if (isOpen) setMatrixHideM3u8(transferSettings?.remoteHideManifests !== false);
  }, [isOpen, transferSettings?.remoteHideManifests]);

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
  const inspectRunningRef = useRef(false);
  const inspectRequestIdRef = useRef(0);
  const queuedInspectRef = useRef<{
    rawUrl: string;
    explicitPasscode?: string;
    forceRefresh: boolean;
    requestId: number;
  } | null>(null);

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
      setDiscoveryLoading(false);
      setAssistedSessionId(null);
      setStreamContainerFilter('all');
      setMatrixSearchQuery('');
      setSubtitleSearchQuery('');
      setSubtitleTypeFilter('all');
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
      if (inspectTimerRef.current !== null) {
        window.clearTimeout(inspectTimerRef.current);
        inspectTimerRef.current = null;
      }
      inspectRequestIdRef.current += 1;
      queuedInspectRef.current = null;
      inspectAbortRef.current?.abort();
      inspectAbortRef.current = null;
      lastAppliedInitialUrlRef.current = '';
      lastProbedHandoffRef.current = '';
      setPasscode('');
      setStreamContainerFilter('all');
      setMatrixSearchQuery('');
      setSubtitleSearchQuery('');
      setSubtitleTypeFilter('all');
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

  const probeUrl = useCallback(async (
    rawUrl: string,
    explicitPasscode?: string,
    forceRefresh = false,
  ) => {
    const request = {
      rawUrl,
      explicitPasscode,
      forceRefresh,
      requestId: ++inspectRequestIdRef.current,
    };
    if (inspectRunningRef.current) {
      queuedInspectRef.current = request;
      inspectAbortRef.current?.abort();
      return;
    }

    inspectRunningRef.current = true;
    const isCurrentRequest = () => inspectRequestIdRef.current === request.requestId;
    let activeController: AbortController | null = null;
    try {
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
    activeController = controller;
    inspectAbortRef.current = controller;

    try {
      const resolved = await resolveRemoteMediaUrl(trimmed, controller.signal, {
        passcode: activePasscode,
        forceRefresh,
      });
      if (!isCurrentRequest() || controller.signal.aborted) return;
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
      if (!isCurrentRequest() || controller.signal.aborted) return;
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

    if (!isCurrentRequest() || controller.signal.aborted) return;
    try {
      const resp = await fetch(trimmed, {
        method: 'HEAD',
        signal: controller.signal,
      });
      if (!isCurrentRequest() || controller.signal.aborted) return;

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
      if (!isCurrentRequest() || controller.signal.aborted) return;
      setInspection({
        url: trimmed,
        status: 'direct_stream',
        filename: baseName,
        size: null,
        mimeType: null,
        kind: inferredKind,
      });
    }
    } finally {
      if (inspectAbortRef.current === activeController) {
        inspectAbortRef.current = null;
      }
      inspectRunningRef.current = false;
      const queued = queuedInspectRef.current;
      queuedInspectRef.current = null;
      if (queued) {
        void probeUrl(queued.rawUrl, queued.explicitPasscode, queued.forceRefresh);
      }
    }
  }, [passcode, t]);

  const handleLoadMoreDiscovery = useCallback(async () => {
    const current = resolvedMedia;
    const cursor = current?.discovery?.cursor;
    if (!current || !cursor || current.discovery?.complete || discoveryLoading) return;
    setDiscoveryLoading(true);
    try {
      const next = await resolveRemoteMediaUrl(current.url || url, undefined, {
        passcode,
        discoveryCursor: cursor,
      });
      setResolvedMedia((previous) => {
        if (!previous) return next;
        return mergeRemoteDiscoveryResults(previous, next);
      });
    } finally {
      setDiscoveryLoading(false);
    }
  }, [discoveryLoading, passcode, resolvedMedia, url]);

  const handleOpenAssistedInspector = useCallback(async () => {
    const target = (resolvedMedia?.url || url).trim();
    if (!target || !detectTauriRuntime()) return;
    try {
      const launch = await invoke<{ sessionId: string }>('open_remote_assisted_inspector', { url: target });
      setAssistedSessionId(launch.sessionId);
    } catch {
      setErrorMsg(t('drive.remote_discovery_blocked'));
    }
  }, [resolvedMedia?.url, t, url]);

  useEffect(() => {
    if (!assistedSessionId || !detectTauriRuntime()) return;
    let active = true;
    const poll = async () => {
      try {
        const urls = await invoke<string[]>('take_remote_assisted_candidates', { sessionId: assistedSessionId });
        for (const candidateUrl of urls) {
          if (!active) return;
          const result = await resolveRemoteMediaUrl(candidateUrl);
          if (!active || result.formats.length === 0) continue;
          setResolvedMedia((previous) => previous ? mergeRemoteDiscoveryResults(previous, result) : result);
        }
      } catch {
        // The temporary inspector may have expired or been closed; no session
        // data is retained in the React state beyond its opaque identifier.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [assistedSessionId]);

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

    if (inspectTimerRef.current !== null) {
      window.clearTimeout(inspectTimerRef.current);
      inspectTimerRef.current = null;
    }
    if (!isInspectableRemoteUrl(cleanUrl)) {
      inspectRequestIdRef.current += 1;
      queuedInspectRef.current = null;
      inspectAbortRef.current?.abort();
      setInspection(null);
      setResolvedMedia(null);
      return;
    }
    inspectTimerRef.current = window.setTimeout(() => {
      inspectTimerRef.current = null;
      probeUrl(cleanUrl, extractedPasscode);
    }, 850);
  };

  const handlePasscodeChange = (codeVal: string) => {
    setPasscode(codeVal);
    if (errorMsg) setErrorMsg('');

    if (inspectTimerRef.current !== null) {
      window.clearTimeout(inspectTimerRef.current);
      inspectTimerRef.current = null;
    }
    if (!isInspectableRemoteUrl(url)) return;
    inspectTimerRef.current = window.setTimeout(() => {
      inspectTimerRef.current = null;
      probeUrl(url, codeVal);
    }, 650);
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

    const referer = fmt.headers?.Referer || getProviderReferer(rawUrl);

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

    const referer = targetMediaForPlayback?.headers?.Referer || getProviderReferer(rawUrl);

    if (detectTauriRuntime()) {
      invoke<string>('get_remote_stream_proxy_url', { url: rawUrl, referer })
        .then((proxied) => {
          if (!isCancelled) setActivePlayableUrl(proxied);
        })
        .catch(() => {
          if (!isCancelled) setActivePlayableUrl('');
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
    if (fmt.isStreamable === false) {
      setIsPlayingStream(false);
      setActivePlayableUrl('');
    } else if (isPlayingStream && fmt.directUrl) {
      setActivePlayableUrl('');
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
    if (!canTransferResolvedFormat(fmt)) return;
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

  const handlePlayFormat = useCallback(async (fmt: StreamQualityFormat) => {
    if (fmt.isDownloadable === false && fmt.isStreamable !== true) return;
    const requestId = ++playRequestRef.current;
    handleSelectFormat(fmt);
    if (fmt.isStreamable === false) {
      setIsPlayingStream(false);
      setActivePlayableUrl('');
      return;
    }
    setIsPlayingStream(true);
    if (fmt.directUrl) {
      // Preview always uses the selected verified URL. The local range proxy
      // preserves provider Referer requirements while upload retains the
      // original URL and never falls back to a provider container player.
      if (detectTauriRuntime()) {
        try {
          const referer = fmt.headers?.Referer ||
            (fmt.directUrl.includes('youtube') || fmt.directUrl.includes('googlevideo.com')
              ? 'https://www.youtube.com/'
              : undefined);
          const proxyUrl = await invoke<string>('get_remote_stream_proxy_url', {
            url: fmt.directUrl,
            referer,
          });
          if (proxyUrl && requestId === playRequestRef.current) setActivePlayableUrl(proxyUrl);
        } catch {
          if (requestId === playRequestRef.current) setActivePlayableUrl('');
        }
      } else {
        setActivePlayableUrl(fmt.directUrl);
      }
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

    const referer = nextItem.headers?.Referer || getProviderReferer(rawUrl);

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

  const {
    handleInspectBatchUrls, handleToggleBatchItem, handleBatchCardClick, handleBatchCardDoubleClick,
    handleToggleBatchGroup, handleToggleAllBatchItems, handleToggleGroupCollapse,
    handleRetryBatchGroup, handleRemoveBatchGroup, allBatchItems, selectedBatchItems, selectedBatchBytes,
  } = useRemoteUploadBatchActions({
    t, batchUrls, setErrorMsg, batchInspectAbortRef, setBatchInspecting, setBatchInspectProgress,
    setIsEditingBatchText, setBatchGroups, setSelectedBatchItemIds, setFocusedBatchItem, batchGroups,
    focusedBatchItem, batchUrlsText, setBatchUrlsText, selectedBatchItemIds, batchItemDurations,
    setBatchItemDurations, batchPlayableUrl, setBatchPlayableUrl, batchQualityPreference,
    setBatchQualityPreference, queueDurationProbe, batchClickTimersRef, setCollapsedGroupIds,
    getMeasuredFormatBadge,
  });

  const handleSubmit = createRemoteUploadSubmitHandler({
    t, setErrorMsg, setSubmitting, tab, url, passcode, customFilename, resolvedMedia, effectiveMediaItems,
    selectedMediaItemIds, selectedItems, selectedDest, onUpload, onClose, deliveryMode,
    remoteEngineMode, storagePolicy, customDiskPath, selectedBatchItems, batchGroups,
    isEditingBatchText, handleInspectBatchUrls, canTransferResolvedFormat,
    getEffectiveFormatFilename, resolveRemoteMediaUrl, hasKnownRemoteProvider,
    inspection, selectedFormatId, itemCustomNames, itemSelectedFormats, activePreviewItem,
    captureVideoCanvasThumbnail, formatDriveBytes,
  });


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

  const { renderSupportedLinksPopover, renderTripletAndDestinationControls } =
    createRemoteUploadRenderers({
      t, showSupportedInfo, setShowSupportedInfo, activeTripletInfo, setActiveTripletInfo,
      tripletInfoRef, selectedDest, creds, cleanTargetDisplay, customDiskPath, setCustomDiskPath,
      deliveryMode, setDeliveryMode, effectiveRemoteEngine, remoteEngineMode, setRemoteEngineMode,
      storagePolicy, setStoragePolicy, submitting, setPickerOpen,
      renderBadge,
    });

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
            <RemoteUploadSinglePanel ctx={{
              t,url,passcode,submitting,inspection,setInspection,probeUrl,handleOpenInBrowser,handlePasteClipboard,handleUrlChange,
              resolvedMedia,handlePasscodeChange,renderTripletAndDestinationControls,isSplitActive,previewSectionRef,
              selectedFormatId,setSelectedFormatId,activePlayableUrl,isPlayingStream,activePreviewItem,activeSlideUrl,captureVideoCanvasThumbnail,
              setResolvedMedia,effectiveMediaItems,activeSlideIndex,setActiveSlideIndex,activeTargetExt,activeItemCurrentName,
              isEditingActiveName,setIsEditingActiveName,editingNameValue,setEditingNameValue,saveCurrentEditingName,resetActiveName,itemCustomNames,
              setItemCustomNames,isNameModified,handleSelectFormat,handleToggleFormat,handlePlayFormat,selectedMediaItemIds,
              handleToggleItem,handleSelectAllItems,handleDeselectAllItems,filteredAndSortedItems,galleryViewMode,
              setGalleryViewMode,galleryFilter,setGalleryFilter,gallerySearch,setGallerySearch,gallerySortBy,setGallerySortBy,
              gallerySortOrder,setGallerySortOrder,itemDurations,setItemDurations,itemResolutions,setItemResolutions,itemSelectedFormats,setItemSelectedFormats,
              selectedBytes,streamContainerFilter,setStreamContainerFilter,matrixSearchQuery,setMatrixSearchQuery,
              matrixHideM3u8,setMatrixHideM3u8,subtitleSearchQuery,setSubtitleSearchQuery,subtitleTypeFilter,
              setSubtitleTypeFilter,copiedStreamUrl,setCopiedStreamUrl,handleLoadMoreDiscovery,discoveryLoading,
              handleOpenAssistedInspector,probeSingleItemDuration,ItemDurationBadge,fileKindIcon,getFormatDisplayLabel,
              getFormatDisplayBadge,getBadgeModifierClass,getSingleUnifiedBadgeInfo,isManifestFormat,splitFilenameAndExt,
              formatMediaDuration,formatDriveBytes,handleCardClick,handleCardDoubleClick,clickTimersRef
            }} />
          ) : (
            <RemoteUploadBatchPanel ctx={{
              t,showSupportedInfo,setShowSupportedInfo,handlePasteClipboard,submitting,errorMsg,setErrorMsg,setIsEditingBatchText,
              batchGroups,isEditingBatchText,batchSearchQuery,setBatchSearchQuery,batchFilterType,setBatchFilterType,selectedBatchItemIds,
              collapsedGroupIds,copiedUrlGroupId,batchItemDurations,batchQualityPreference,setBatchQualityPreference,
              focusedBatchItem,handleToggleBatchItem,handleBatchCardClick,handleBatchCardDoubleClick,
              handleToggleBatchGroup,handleToggleAllBatchItems,handleToggleGroupCollapse,handleRetryBatchGroup,
              handleRemoveBatchGroup,handleOpenInBrowser,handleOpenAssistedInspector,handleInspectBatchUrls,
              batchUrlsText,setBatchUrlsText,batchUrls,batchInspecting,batchInspectProgress,infoRef,
              renderSupportedLinksPopover,renderTripletAndDestinationControls,selectedBatchItems,selectedBatchBytes,
              allBatchItems,batchPlayableUrl,captureVideoCanvasThumbnail,setBatchGroups,setBatchItemDurations,
              setCopiedUrlGroupId,storagePolicy,formatDriveBytes
            }} />

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
                  ? !url.trim() || !resolvedMedia || resolvedMedia.formats.length === 0 || (effectiveMediaItems.length > 1 && selectedMediaItemIds.size === 0)
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
