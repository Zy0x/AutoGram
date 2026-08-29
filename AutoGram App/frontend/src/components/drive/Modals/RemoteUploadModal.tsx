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
  Grid3X3,
  LayoutGrid,
  Layers,
  Sparkles,
  Zap,
  Info,
  KeyRound,
  Search,
  Play,
  Clock,
  HardDrive,
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
  ) => Promise<void>;
}

type RemoteUploadTab = 'single' | 'batch';
type DeliveryMode = 'auto' | 'uncompressed' | 'document';
type UrlKind = 'video' | 'image' | 'audio' | 'zip' | 'doc' | 'other';

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
    return <span className="td-dest-badge saved">{t('speedtest.dest_badge_saved')}</span>;
  }
  if (c.isForum) {
    return <span className="td-dest-badge forum">{t('speedtest.dest_badge_forum')}</span>;
  }
  if (c.kind === 'drive') {
    return <span className="td-dest-badge td">{t('speedtest.dest_badge_drive')}</span>;
  }
  if (c.type === 'group' || c.type === 'supergroup') {
    return <span className="td-dest-badge group">{t('speedtest.dest_badge_group')}</span>;
  }
  if (c.type === 'channel') {
    return <span className="td-dest-badge channel">{t('speedtest.dest_badge_channel')}</span>;
  }
  if (c.type === 'bot') {
    return <span className="td-dest-badge bot">{t('speedtest.dest_badge_bot')}</span>;
  }
  return <span className="td-dest-badge user">{t('speedtest.dest_badge_user')}</span>;
}

function getFormatDisplayLabel(
  fmt: StreamQualityFormat,
  resolvedMedia: ResolvedMediaInfo | null,
  t: any
): string {
  if (fmt.id === 'tiktok_profile_avatar') {
    return t('speedtest.remote_fmt_creator_avatar');
  }
  if (fmt.id === 'tiktok_photo_all_pack' || (fmt.isAlbumPack && resolvedMedia?.platform === 'tiktok')) {
    const total = resolvedMedia?.albumImages?.length || '';
    return t('speedtest.remote_fmt_album_pack', { total });
  }
  if (fmt.id === 'pikpak_all_files_pack') {
    const count = resolvedMedia?.totalItems || resolvedMedia?.formats.filter((f) => !f.isAlbumPack).length || 0;
    const sizeStr = fmt.filesizeBytes ? ` ~${formatDriveBytes(fmt.filesizeBytes)}` : '';
    return t('speedtest.remote_pikpak_batch_pack', { count, size: sizeStr });
  }
  if (fmt.id === 'streamrizz_all_files_pack') {
    const count = resolvedMedia?.totalItems || resolvedMedia?.formats.filter((f) => !f.isAlbumPack).length || 0;
    const sizeStr = fmt.filesizeBytes ? ` ~${formatDriveBytes(fmt.filesizeBytes)}` : '';
    return t('speedtest.remote_streamrizz_batch_pack', { count, size: sizeStr });
  }
  if (fmt.id.startsWith('tiktok_photo_')) {
    const total = resolvedMedia?.albumImages?.length || 1;
    const match = fmt.id.match(/photo_(\d+)/);
    if (match && match[1]) {
      const idx = parseInt(match[1], 10);
      if (total <= 1) {
        return t('speedtest.remote_fmt_single_photo');
      }
      return t('speedtest.remote_fmt_slide_photo', { idx, total });
    }
  }
  if (fmt.label === 'remote_web_page_handoff') {
    return t('speedtest.remote_web_page_handoff');
  }
  return fmt.label;
}

function getFormatDisplayBadge(fmt: StreamQualityFormat, t: any): string | undefined {
  if (fmt.badge === 'remote_web_page') {
    return t('speedtest.remote_web_page_badge');
  }
  if (fmt.badge === 'PASSCODE ERROR') {
    return t('speedtest.remote_passcode_invalid_badge');
  }
  if (fmt.badge === 'PASSWORD PROTECTED') {
    return t('speedtest.remote_passcode_required_badge');
  }
  return fmt.badge;
}

function getEffectiveFormatFilename(
  fmt?: StreamQualityFormat,
  resolved?: ResolvedMediaInfo | null,
  fallbackExt?: string
): string {
  if (!resolved && !fmt) return '';
  if (fmt?.customFilename) return fmt.customFilename;
  const rawTitle = sanitizeFilename(fmt?.customTitle || resolved?.title || '');
  if (!rawTitle) return `remote_file.${fmt?.ext || fallbackExt || 'mp4'}`;
  return rawTitle.includes('.') ? rawTitle : `${rawTitle}.${fmt?.ext || fallbackExt || 'mp4'}`;
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

function getSingleUnifiedBadge(item: ResolvedMediaItem): string {
  const fmt = item.formats[0];
  if (!fmt) return item.kind === 'video' ? 'HD VIDEO' : 'HD PHOTO';

  const dim = fmt.badge && fmt.badge.includes('×')
    ? fmt.badge
    : fmt.resolution && fmt.resolution.includes('x')
      ? fmt.resolution
      : null;
  const tier = fmt.qualityTier && fmt.qualityTier !== 'original'
    ? fmt.qualityTier.toUpperCase()
    : fmt.label?.includes('HD')
      ? 'HD'
      : null;

  if (dim && tier) {
    const cleanTier =
      tier === '4K'
        ? '4K UHD'
        : tier === '2K'
          ? '2K QHD'
          : tier === '1080P'
            ? '1080p FHD'
            : tier === '720P'
              ? '720p HD'
              : tier;
    return `${cleanTier} • ${dim}`;
  }
  if (dim) {
    return dim;
  }
  if (tier) {
    return tier === '4K'
      ? '4K UHD'
      : tier === '2K'
        ? '2K QHD'
        : tier === '1080P'
          ? '1080p FHD'
          : tier === '720P'
            ? '720p HD'
            : tier;
  }
  if (fmt.isImage || item.kind === 'image') {
    return 'HD PHOTO';
  }
  if (fmt.ext === 'zip' || fmt.ext === 'rar' || fmt.ext === '7z') {
    return 'ZIP ARCHIVE';
  }
  return 'HD VIDEO';
}

const ItemDurationBadge: React.FC<{
  item: ResolvedMediaItem;
  knownDuration?: number;
}> = ({ item, knownDuration }) => {
  const dur = knownDuration || item.durationSec || item.formats[0]?.durationSec;
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
    if (stored === 'cloud_fetch' || stored === 'storage_local' || stored === 'ram_pipe') return stored as RemoteEngineMode;
    return transferSettings?.remoteEngineMode || 'auto';
  });
  const [storagePolicy, setStoragePolicy] = useState<StorageLocalPolicy>('telegram');
  const [customDiskPath, setCustomDiskPath] = useState<string>('');
  const [inspection, setInspection] = useState<UrlInspection | null>(null);

  const [resolvedMedia, setResolvedMedia] = useState<ResolvedMediaInfo | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('');
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

  const inspectAbortRef = useRef<AbortController | null>(null);
  const inspectTimerRef = useRef<number | null>(null);

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
      setDeliveryMode(resolveDefaultDeliveryMode(transferSettings));
      const storedEngine = typeof localStorage !== 'undefined' ? localStorage.getItem('autogram_remote_engine_mode') : null;
      setRemoteEngineMode(storedEngine === 'cloud_fetch' || storedEngine === 'ram_pipe'
        ? storedEngine
        : (transferSettings?.remoteEngineMode || 'auto'));
      setInspection(null);
      setResolvedMedia(null);
      setSelectedFormatId('');
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
      setSelectedMediaItemIds(new Set());
      setItemSelectedFormats({});
      setGallerySearch('');
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
    const onDocClick = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowSupportedInfo(false);
      }
      if (tripletInfoRef.current && !tripletInfoRef.current.contains(e.target as Node)) {
        setActiveTripletInfo(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
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
        setErrorMsg(t('speedtest.remote_err_private_target'));
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
      title: t('speedtest.remote_upload_select_target'),
      detail: t('speedtest.remote_upload_select_target_desc'),
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

  useEffect(() => {
    if (effectiveMediaItems.length > 0) {
      setSelectedMediaItemIds(new Set(effectiveMediaItems.map((item) => item.id)));
      const fmtMap: Record<string, string> = {};
      const durMap: Record<string, number> = {};
      for (const item of effectiveMediaItems) {
        fmtMap[item.id] = item.selectedFormatId || item.formats[0]?.id || '';
        if (item.durationSec && item.durationSec > 0) {
          durMap[item.id] = item.durationSec;
        } else if (item.formats[0]?.durationSec && item.formats[0].durationSec > 0) {
          durMap[item.id] = item.formats[0].durationSec;
        }
      }
      setItemSelectedFormats(fmtMap);
      setItemDurations((prev) => ({ ...durMap, ...prev }));
      setActivePreviewItemId(effectiveMediaItems[0]?.id || '');
    } else {
      setSelectedMediaItemIds(new Set());
      setItemSelectedFormats({});
      setItemDurations({});
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

  const [activePlayableUrl, setActivePlayableUrl] = useState<string>('');
  const [activeVideoDuration, setActiveVideoDuration] = useState<number | null>(null);

  useEffect(() => {
    setActiveVideoDuration(null);
    const v = document.querySelector('.td-remote-active-player-video') as HTMLVideoElement | null;
    if (v && v.duration && isFinite(v.duration) && v.duration > 0) {
      const d = Math.round(v.duration);
      setActiveVideoDuration(d);
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
    : 'ram_pipe';
  const effectiveRemoteEngine = remoteEngineMode === 'auto' ? autoRemoteEngine : remoteEngineMode;

  const [gallerySearch, setGallerySearch] = useState('');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'video' | 'image' | 'long'>('all');
  const [gallerySort, setGallerySort] = useState<'default' | 'name' | 'duration' | 'size'>('default');
  const [galleryDensity, setGalleryDensity] = useState<'compact' | 'comfortable'>('comfortable');

  const filteredAndSortedItems = useMemo(() => {
    if (!effectiveMediaItems) return [];
    let list = [...effectiveMediaItems];

    if (galleryFilter === 'video') {
      list = list.filter((it) => it.kind === 'video');
    } else if (galleryFilter === 'image') {
      list = list.filter((it) => it.kind === 'image');
    } else if (galleryFilter === 'long') {
      list = list.filter((it) => {
        const dur = itemDurations[it.id] || it.durationSec || 0;
        return dur >= 600;
      });
    }

    if (gallerySearch.trim()) {
      const q = gallerySearch.trim().toLowerCase();
      list = list.filter((it) => it.title.toLowerCase().includes(q));
    }

    if (gallerySort === 'name') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (gallerySort === 'duration') {
      list.sort((a, b) => {
        const durA = itemDurations[a.id] || a.durationSec || 0;
        const durB = itemDurations[b.id] || b.durationSec || 0;
        return durB - durA;
      });
    } else if (gallerySort === 'size') {
      list.sort((a, b) => {
        const szA = a.formats[0]?.filesizeBytes || 0;
        const szB = b.formats[0]?.filesizeBytes || 0;
        return szB - szA;
      });
    }

    return list;
  }, [effectiveMediaItems, galleryFilter, gallerySearch, gallerySort, itemDurations]);

  const handleSelectFormat = (fmt: StreamQualityFormat) => {
    setSelectedFormatId(fmt.id);
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
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (tab === 'single') {
      const targetUrl = url.trim();
      if (!targetUrl) {
        setErrorMsg(t('speedtest.remote_err_empty'));
        return;
      }
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        setErrorMsg(t('speedtest.remote_err_invalid_protocol'));
        return;
      }

      // Multi-media card upload flow
      if (effectiveMediaItems.length > 1) {
        if (selectedItems.length === 0) {
          setErrorMsg(t('speedtest.remote_btn_select_at_least_one'));
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
              uploadFilenames.push(getEffectiveFormatFilename(chosenFmt, resolvedMedia));
              uploadSizes.push(chosenFmt.filesizeBytes || 0);
              uploadThumbs.push(chosenFmt.thumbnailUrl || item.thumbnailUrl || resolvedMedia?.thumbnailUrl || '');
            }
          }

          if (uploadUrls.length === 0) {
            setErrorMsg(t('speedtest.remote_btn_select_at_least_one'));
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

          await onUpload(uploadUrls, selectedDest, {
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
          onClose();
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
        if (!activeResolved && (targetUrl.includes('tiktok.com') || targetUrl.includes('douyin.com') || targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be') || targetUrl.includes('instagram.com') || targetUrl.includes('terabox') || targetUrl.includes('pikpak') || targetUrl.includes('streamrizz.com') || targetUrl.includes('vidoy') || targetUrl.includes('overfetch.video') || targetUrl.includes('pinterest.com') || targetUrl.includes('pixiv.net') || targetUrl.includes('twitter.com') || targetUrl.includes('x.com') || targetUrl.includes('videe.cc') || targetUrl.includes('videy.co'))) {
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

        const uploadSizes = activeFormat?.filesizeBytes ? [activeFormat.filesizeBytes] : undefined;
        const uploadThumbs = (activeFormat?.thumbnailUrl || activeResolved?.thumbnailUrl)
          ? [activeFormat?.thumbnailUrl || activeResolved?.thumbnailUrl!]
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

        await onUpload(uploadUrls, selectedDest, {
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
        onClose();
      } catch (err: any) {
        setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
      } finally {
        setSubmitting(false);
      }
    } else {
      if (!batchUrls.length) {
        setErrorMsg(t('speedtest.remote_err_no_batch_urls'));
        return;
      }

      setSubmitting(true);
      try {
        const expandedBatchUrls: string[] = [];
        for (const singleUrl of batchUrls) {
          const lower = singleUrl.toLowerCase();
          if (
            lower.includes('tiktok.com') ||
            lower.includes('douyin.com') ||
            lower.includes('youtube.com') ||
            lower.includes('youtu.be') ||
            lower.includes('pinterest.com')
          ) {
            try {
              const res = await resolveRemoteMediaUrl(singleUrl);
              if (res.albumImages && res.albumImages.length > 0) {
                // Expand slideshow to all high-definition photos in the album pack
                expandedBatchUrls.push(...res.albumImages);
                continue;
              } else if (res.formats && res.formats.length > 0) {
                // Use highest peak quality master stream
                expandedBatchUrls.push(res.formats[0].directUrl);
                continue;
              }
            } catch {
              // fallback to raw url
            }
          }
          expandedBatchUrls.push(singleUrl);
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

        await onUpload(expandedBatchUrls, selectedDest, {
          asDocument: deliveryMode === 'document',
          qualityMode: effectiveQualityMode,
          presentationOverride: effectivePresentation,
          remoteEngineMode,
          storagePolicy,
          customDiskPath: customDiskPath.trim() || undefined,
        });
        onClose();
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
            <span>{t('speedtest.remote_info_popover_title')}</span>
          </span>
          <button
            type="button"
            className="td-remote-info-close"
            onClick={() => setShowSupportedInfo(false)}
            aria-label={t('speedtest.preview_close_btn')}
          >
            <X size={13} />
          </button>
        </div>

        {/* Section 1: Social & Video */}
        <div className="td-remote-info-group">
          <div className="td-remote-info-group-title">
            {t('speedtest.remote_info_cat_social')}
          </div>
          <div className="td-remote-info-tags">
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_tiktok')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_youtube')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_instagram')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_pinterest')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_pixiv')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_terabox')}</span>
          </div>
        </div>

        {/* Section 2: Cloud & Direct */}
        <div className="td-remote-info-group">
          <div className="td-remote-info-group-title">
            {t('speedtest.remote_info_cat_cloud')}
          </div>
          <div className="td-remote-info-tags">
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_pikpak')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_streamrizz')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_gdrive')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_dropbox')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_mediafire')}</span>
            <span className="td-remote-info-tag">{t('speedtest.remote_info_tag_direct')}</span>
          </div>
        </div>

        <div className="td-remote-info-footer">
          <Zap size={11} className="td-remote-info-footer-icon" />
          <span>{t('speedtest.remote_info_footer_note')}</span>
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
            className="td-remote-info-popover-close"
            onClick={(e) => {
              e.stopPropagation();
              setActiveTripletInfo(null);
            }}
            aria-label={t('speedtest.preview_close_btn')}
          >
            <X size={11} />
          </button>
        </div>

        {type === 'delivery' && (
          <>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#c084fc' }}>
                <Film size={10} /> {t('speedtest.remote_mode_uncompressed')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_uncompressed')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#38bdf8' }}>
                <Zap size={10} /> {t('speedtest.remote_mode_auto')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_auto')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#facc15' }}>
                <FileText size={10} /> {t('speedtest.remote_mode_doc')}
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
              <span className="td-remote-triplet-popover-key" style={{ color: '#60a5fa' }}>
                <Folder size={10} /> {t('drive_tools.remote_engine_storage_local')}
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
            <h2>{t('speedtest.remote_upload_url_title')}</h2>
            <p className="td-confirm-desc">{t('speedtest.remote_upload_url_subtitle')}</p>
          </div>
          <button
            type="button"
            className="td-confirm-close"
            onClick={onClose}
            disabled={submitting}
            aria-label={t('speedtest.preview_close_btn')}
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
            <span>{t('speedtest.remote_tab_single')}</span>
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
            <span>{t('speedtest.remote_tab_batch')}</span>
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
                          <span>{t('speedtest.source_url_label')}</span>
                        </label>
                      <div className="td-remote-label-actions">
                        {url.trim() && (
                          <button
                            type="button"
                            className="td-remote-browser-action"
                            onClick={() => handleOpenInBrowser(url.trim())}
                            disabled={submitting}
                            title={t('speedtest.remote_open_in_browser')}
                          >
                            <ExternalLink size={10} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="td-remote-paste-action"
                          onClick={handlePasteClipboard}
                          disabled={submitting}
                          title={t('speedtest.remote_paste_clipboard')}
                        >
                          <Clipboard size={10} />
                          <span>{t('speedtest.remote_paste_clipboard')}</span>
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
                        placeholder={t('speedtest.remote_url_placeholder')}
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
                          aria-label={t('speedtest.remote_clear_input')}
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
                          {t('speedtest.remote_passcode_label')}
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
                                  ? t('speedtest.remote_passcode_invalid_badge')
                                  : t('speedtest.remote_passcode_required_badge')}
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
                          placeholder={t('speedtest.remote_passcode_placeholder')}
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
                            aria-label={t('speedtest.remote_clear_input')}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Row 2: Triplet Compact Row (Media Delivery Format, Transfer Engine, Storage Policy in 1 Row) */}
                  <div className="td-remote-triplet-row">
                    {/* Col 1: Media Delivery Format */}
                    <div className="td-remote-triplet-col col-delivery">
                      <div className="td-remote-triplet-header">
                        <span className="td-remote-triplet-title">
                          <Film size={11} className="text-purple-400" />
                          <span>{t('speedtest.remote_delivery_mode_label')}</span>
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
                          title={t('speedtest.remote_mode_uncompressed_hint')}
                        >
                          <Film size={11} />
                          <span>{t('speedtest.remote_mode_uncompressed')}</span>
                          {deliveryMode === 'uncompressed' && <Check size={10} />}
                        </button>
                        <button
                          type="button"
                          className={`td-remote-mode-pill${deliveryMode === 'auto' ? ' active auto' : ''}`}
                          onClick={() => setDeliveryMode('auto')}
                          disabled={submitting}
                          title={t('speedtest.remote_mode_auto_hint')}
                        >
                          <Zap size={11} />
                          <span>{t('speedtest.remote_mode_auto')}</span>
                          {deliveryMode === 'auto' && <Check size={10} />}
                        </button>
                        <button
                          type="button"
                          className={`td-remote-mode-pill${deliveryMode === 'document' ? ' active doc' : ''}`}
                          onClick={() => setDeliveryMode('document')}
                          disabled={submitting}
                          title={t('speedtest.remote_mode_doc_hint')}
                        >
                          <FileText size={11} />
                          <span>{t('speedtest.remote_mode_doc')}</span>
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
                            <span className="td-remote-engine-badge zero-disk">
                              <Zap size={9} />
                              <span>{t('drive_tools.remote_zero_disk_badge')}</span>
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
                            className={`td-remote-engine-pill${remoteEngineMode === mode ? ' active' : ''}`}
                            disabled={submitting}
                            onClick={() => {
                              setRemoteEngineMode(mode);
                              try { localStorage.setItem('autogram_remote_engine_mode', mode); } catch { /* ok */ }
                            }}
                          >
                            {mode === 'auto' && <Zap size={10} />}
                            {mode === 'cloud_fetch' && <Sparkles size={10} />}
                            {mode === 'storage_local' && <Folder size={10} />}
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

                  {/* Row 4: Destination Selector (Hidden when Local Disk Only) */}
                  {storagePolicy !== 'custom_disk' && (
                    <div className="td-remote-field-group td-remote-dest-row">
                      <button
                        id="td-remote-target"
                        type="button"
                        className="td-remote-dest-card"
                        onClick={() => setPickerOpen(true)}
                        disabled={submitting}
                        title={t('speedtest.btn_change_dest')}
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
                            {t('speedtest.btn_change_dest')}
                            <ChevronRight size={11} style={{ marginLeft: 2 }} />
                          </span>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

          {/* STREAM PREVIEW SECTION: Placed after Section 1 (Full-Width Inspector) */}
          {isSplitActive && (
            <div className="td-remote-preview-section">
              {resolvedMedia ? (
                <div className="td-remote-meta-card">
                  <div className="td-remote-preview-head-row">
                    <div className="td-remote-media-badges">
                      <span className={`td-remote-platform-badge ${resolvedMedia.platform}`}>
                        {resolvedMedia.platformName}
                      </span>
                      {resolvedMedia.formats.some((f) => f.isCleanNoWatermark) && (
                        <span className="td-remote-clean-badge">
                          <Sparkles size={11} />
                          <span>{t('speedtest.remote_clean_no_watermark')}</span>
                        </span>
                      )}
                    </div>
                    <span className="td-remote-live-canvas-pill">
                      <span className="td-remote-live-canvas-dot" />
                      <span>{t('speedtest.remote_split_live_canvas_badge')}</span>
                    </span>
                  </div>

                  <div className="td-remote-media-title" title={activePreviewItem?.title || resolvedMedia.title}>
                    {activePreviewItem?.title || resolvedMedia.title}
                  </div>

                  {/* Active Player Canvas */}
                  <div className="td-remote-big-canvas-wrap">
                    {activePlayableUrl && (targetMediaForPlayback?.isVideo || !resolvedMedia.albumImages || resolvedMedia.albumImages.length === 0) ? (
                      <div className="td-remote-big-canvas-inner td-remote-single-player-canvas">
                        <video
                          key={activePlayableUrl}
                          src={activePlayableUrl}
                          poster={activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia.thumbnailUrl}
                          controls
                          preload="metadata"
                          playsInline
                          className="td-remote-big-canvas-video td-remote-active-player-video"
                          onLoadedMetadata={(e) => {
                            const dur = e.currentTarget.duration;
                            if (dur && isFinite(dur) && dur > 0) {
                              const d = Math.round(dur);
                              setActiveVideoDuration(d);
                              if (activePreviewItem) {
                                setItemDurations((prev) => {
                                  if (prev[activePreviewItem.id] === d) return prev;
                                  return { ...prev, [activePreviewItem.id]: d };
                                });
                              }
                            }
                          }}
                          onDurationChange={(e) => {
                            const dur = e.currentTarget.duration;
                            if (dur && isFinite(dur) && dur > 0) {
                              const d = Math.round(dur);
                              setActiveVideoDuration((prev) => (prev === d ? prev : d));
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
                    ) : activeSlideUrl ? (
                      <div className="td-remote-big-canvas-inner">
                        <img
                          src={activeSlideUrl}
                          alt={resolvedMedia.title}
                          className="td-remote-big-canvas-img"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <div className="td-remote-canvas-badge-overlay">
                          {resolvedMedia.albumImages && resolvedMedia.albumImages.length > 1 && (
                            <span className="td-remote-canvas-slide-tag">
                              <ImageIcon size={12} />
                              <span>
                                {t('speedtest.remote_split_slide_preview', {
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

                  {/* Active Item Specs Ribbon */}
                  <div className="td-remote-specs-ribbon">
                    <span className="td-remote-spec-item">
                      <Film size={11} className="text-sky-400" />
                      <span>{targetMediaForPlayback?.isVideo ? t('drive_tools.remote_spec_video_stream') : t('drive_tools.remote_spec_media_item')}</span>
                    </span>
                    {(activeVideoDuration || activePreviewItem?.durationSec || resolvedMedia.durationSec) ? (
                      <span className="td-remote-spec-item">
                        <Clock size={11} className="text-amber-400" />
                        <span>{formatMediaDuration(activeVideoDuration || activePreviewItem?.durationSec || resolvedMedia.durationSec)}</span>
                      </span>
                    ) : null}
                    {effectiveMediaItems.length > 1 && (
                      <span className="td-remote-spec-item">
                        <Layers size={11} className="text-purple-400" />
                        <span>{t('drive_tools.remote_gallery_selected_count', { selected: selectedMediaItemIds.size, total: effectiveMediaItems.length })}</span>
                      </span>
                    )}
                  </div>

                  {/* Format Chips (for Single File or Active Item) */}
                  {effectiveMediaItems.length <= 1 && resolvedMedia.formats.length > 0 && (
                    <div className="td-remote-formats-container" style={{ marginTop: 8 }}>
                      <label className="td-input-label">
                        {t('speedtest.remote_split_select_format_hint')}
                      </label>
                      <div className="td-remote-quality-grid">
                        {resolvedMedia.formats.map((fmt) => {
                          const isSelected = selectedFormatId === fmt.id;
                          return (
                            <button
                              key={fmt.id}
                              type="button"
                              className={`td-remote-quality-chip ${isSelected ? 'active' : ''} tier-${fmt.qualityTier} ${fmt.isAlbumPack ? 'album-pack' : ''}`}
                              onClick={() => handleSelectFormat(fmt)}
                              disabled={submitting}
                            >
                              <div className="td-remote-quality-chip-top">
                                <span className="td-remote-quality-chip-title">
                                  {getFormatDisplayLabel(fmt, resolvedMedia, t)}
                                </span>
                                {isSelected && <CheckCircle2 size={13} className="td-remote-chip-active-ico" />}
                              </div>
                              <div className="td-remote-quality-chip-meta">
                                {getFormatDisplayBadge(fmt, t) && (
                                  <span className="td-remote-quality-chip-badge">{getFormatDisplayBadge(fmt, t)}</span>
                                )}
                                {fmt.filesizeBytes ? (
                                  <span className="td-remote-quality-chip-size">
                                    ~{formatDriveBytes(fmt.filesizeBytes)}
                                  </span>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : inspection?.status === 'inspecting' ? (
                <div className="td-remote-preview-inspecting-card">
                  <Loader2 size={32} className="td-remote-inspecting-spinner" />
                  <div className="td-remote-inspecting-title">{t('speedtest.remote_inspecting')}</div>
                  <div className="td-remote-inspecting-subtitle">{t('speedtest.remote_split_inspecting_desc')}</div>
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
                            {t('speedtest.remote_inspect_size_unknown')}
                          </span>
                        )}
                        <span className={`td-remote-meta-badge status ${inspection.status}`}>
                          {inspection.status === 'valid' ? (
                            <>
                              <CheckCircle2 size={11} />
                              <span>{t('speedtest.remote_inspect_valid')}</span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={11} />
                              <span>{t('speedtest.remote_inspect_direct_stream')}</span>
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

          {/* SECTION 2: FULL-WIDTH STUDIO MEDIA GALLERY (Active when multiple items) */}
          {effectiveMediaItems.length > 1 && (
            <div className="td-remote-section-2-gallery">
              <div className="td-remote-gallery-header-row">
                <div className="td-remote-gallery-header-left">
                  <Layers size={15} className="text-sky-400" />
                  <span className="td-remote-gallery-title">
                    {t('drive_tools.remote_gallery_title')}
                  </span>
                  <span className="td-remote-gallery-count-pill">
                    {t('drive_tools.remote_gallery_selected_count', {
                      selected: selectedMediaItemIds.size,
                      total: effectiveMediaItems.length,
                    })}
                  </span>
                      {selectedBytes > 0 && (
                        <span className="td-remote-gallery-size-pill">
                          ~{formatDriveBytes(selectedBytes)}
                        </span>
                      )}
                    </div>
                    <div className="td-remote-gallery-header-right">
                      <button
                        type="button"
                        className="td-remote-gallery-btn-action"
                        onClick={handleSelectAllItems}
                      >
                        {t('drive_tools.remote_gallery_select_all')}
                      </button>
                      <button
                        type="button"
                        className="td-remote-gallery-btn-action"
                        onClick={handleDeselectAllItems}
                      >
                        {t('drive_tools.remote_gallery_deselect_all')}
                      </button>
                      <div className="td-remote-gallery-density-toggle">
                        <button
                          type="button"
                          className={`td-remote-density-btn ${galleryDensity === 'compact' ? 'active' : ''}`}
                          onClick={() => setGalleryDensity('compact')}
                          title={t('drive_tools.remote_gallery_density_compact')}
                        >
                          <Grid3X3 size={13} />
                        </button>
                        <button
                          type="button"
                          className={`td-remote-density-btn ${galleryDensity === 'comfortable' ? 'active' : ''}`}
                          onClick={() => setGalleryDensity('comfortable')}
                          title={t('drive_tools.remote_gallery_density_comfortable')}
                        >
                          <LayoutGrid size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Gallery Sub-toolbar: Search & Filters */}
                  <div className="td-remote-gallery-toolbar">
                    <div className="td-remote-gallery-toolbar-left">
                      <div className="td-remote-gallery-search-wrap">
                        <Search size={13} className="td-remote-gallery-search-icon" />
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
                            <X size={12} />
                          </button>
                        )}
                      </div>

                      <div className="td-remote-gallery-filters">
                        <button
                          type="button"
                          className={`td-remote-filter-chip ${galleryFilter === 'all' ? 'active' : ''}`}
                          onClick={() => setGalleryFilter('all')}
                        >
                          {t('drive_tools.remote_gallery_filter_all', { count: effectiveMediaItems.length })}
                        </button>
                        <button
                          type="button"
                          className={`td-remote-filter-chip ${galleryFilter === 'video' ? 'active' : ''}`}
                          onClick={() => setGalleryFilter('video')}
                        >
                          {t('drive_tools.remote_gallery_filter_videos', {
                            count: effectiveMediaItems.filter((i) => i.kind === 'video').length,
                          })}
                        </button>
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
                      </div>
                    </div>

                    <div className="td-remote-gallery-toolbar-right">
                      <select
                        className="td-remote-gallery-sort-select"
                        value={gallerySort}
                        onChange={(e) => setGallerySort(e.target.value as any)}
                      >
                        <option value="default">{t('drive_tools.remote_gallery_sort_default')}</option>
                        <option value="name">{t('drive_tools.remote_gallery_sort_name_asc')}</option>
                        <option value="duration">{t('drive_tools.remote_gallery_sort_duration_desc')}</option>
                        <option value="size">{t('drive_tools.remote_gallery_sort_size_desc')}</option>
                      </select>
                    </div>
                  </div>

                  {/* Responsive Grid of Cards with Zero Redundant Badges */}
                  <div className={`td-remote-gallery-grid-wrap ${galleryDensity === 'compact' ? 'density-compact' : 'density-comfortable'}`}>
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

                        return (
                          <div
                            key={item.id}
                            className={`td-remote-media-item-card ${isSelected ? 'selected' : ''} ${isActive ? 'is-active-preview' : ''}`}
                            onClick={() => {
                              setActivePreviewItemId(item.id);
                            }}
                          >
                            <div className="td-remote-item-thumb-wrap">
                              <button
                                type="button"
                                className={`td-remote-item-checkbox ${isSelected ? 'checked' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleItem(item.id);
                                }}
                                aria-label={isSelected ? t('drive_tools.remote_gallery_deselect_all') : t('drive_tools.remote_gallery_select_all')}
                              >
                                {isSelected ? <Check size={14} strokeWidth={3} /> : <div className="td-remote-check-unselected" />}
                              </button>

                              {/* Single Unified Non-Redundant Quality / Dimension Badge at Top-Right */}
                              <span className="td-remote-item-single-badge">
                                {getSingleUnifiedBadge(item)}
                              </span>

                              {item.thumbnailUrl ? (
                                <img
                                  src={item.thumbnailUrl}
                                  alt={item.title}
                                  className="td-remote-item-thumb-img"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="td-remote-item-thumb-fallback">
                                  {item.kind === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}
                                </div>
                              )}

                              {item.kind === 'video' && (
                                <div className="td-remote-item-play-overlay">
                                  <div className="td-remote-item-play-icon-badge">
                                    <Play size={13} fill="currentColor" />
                                  </div>
                                </div>
                              )}

                              {/* Duration Badge at Bottom-Right */}
                              <ItemDurationBadge
                                item={item}
                                knownDuration={itemDurations[item.id] || item.durationSec}
                              />
                            </div>

                            {/* Clean Non-Redundant Card Footer: Title + Size/Ext */}
                            <div className="td-remote-item-card-body">
                              <span className="td-remote-item-card-title" title={item.title}>
                                {item.title}
                              </span>
                              <div className="td-remote-item-card-meta-clean">
                                <span className="td-remote-meta-size">
                                  {chosenFmt?.filesizeBytes ? `~${formatDriveBytes(chosenFmt.filesizeBytes)}` : ''}
                                </span>
                                <span className="td-remote-meta-ext">
                                  {chosenFmt?.ext ? chosenFmt.ext.toUpperCase() : ''}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* BATCH TAB */
            <div className="td-remote-form-card">
              <div className="td-remote-field-group">
                <div className="td-remote-label-row">
                  <div className="td-remote-label-left" ref={infoRef}>
                    <label className="td-input-label" htmlFor="td-remote-batch-input">
                      {t('speedtest.remote_tab_batch')}
                    </label>
                    <button
                      type="button"
                      className={`td-remote-info-trigger ${showSupportedInfo ? 'active' : ''}`}
                      onClick={() => setShowSupportedInfo((prev) => !prev)}
                      title={t('speedtest.remote_info_btn_aria')}
                      aria-label={t('speedtest.remote_info_btn_aria')}
                      aria-expanded={showSupportedInfo}
                    >
                      <Info size={12} />
                    </button>
                    {renderSupportedLinksPopover()}
                  </div>
                  <button
                    type="button"
                    className="td-remote-paste-action"
                    onClick={handlePasteClipboard}
                    disabled={submitting}
                    title={t('speedtest.remote_paste_clipboard')}
                  >
                    <Clipboard size={12} />
                    <span>{t('speedtest.remote_paste_clipboard')}</span>
                  </button>
                </div>
                <textarea
                  id="td-remote-batch-input"
                  className="td-input-field td-remote-batch-textarea"
                  rows={5}
                  placeholder={t('speedtest.remote_batch_placeholder')}
                  value={batchUrlsText}
                  onChange={(e) => {
                    setBatchUrlsText(e.target.value);
                    if (errorMsg) setErrorMsg('');
                  }}
                  disabled={submitting}
                  spellCheck={false}
                />
                <div className="td-remote-batch-footer">
                  <span className="td-remote-batch-hint">
                    {batchUrls.length > 0
                      ? t('speedtest.remote_batch_count', { count: batchUrls.length })
                      : t('speedtest.remote_batch_empty_hint')}
                  </span>
                </div>
              </div>
            </div>
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
              disabled={submitting}
            >
              {t('accounts.cancel')}
            </button>
            <button
              type="submit"
              className="td-confirm-btn primary td-remote-submit-btn"
              disabled={
                submitting ||
                (tab === 'single'
                  ? !url.trim() || (effectiveMediaItems.length > 1 && selectedMediaItemIds.size === 0)
                  : batchUrls.length === 0)
              }
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="spin" />
                  <span>{t('speedtest.uploading_status')}</span>
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
                          ? t('speedtest.remote_btn_select_at_least_one')
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
                          : t('speedtest.remote_btn_upload_count', {
                              count: selectedMediaItemIds.size,
                              size: selectedBytes > 0 ? ` (~${formatDriveBytes(selectedBytes)})` : '',
                            })
                        : storagePolicy === 'custom_disk'
                        ? t('drive_tools.remote_btn_save_single')
                        : storagePolicy === 'disk_and_telegram'
                        ? t('drive_tools.remote_btn_save_upload_single')
                        : t('speedtest.remote_btn_start_single')
                      : storagePolicy === 'custom_disk'
                      ? t('drive_tools.remote_btn_save_batch', { count: batchUrls.length })
                      : storagePolicy === 'disk_and_telegram'
                      ? t('drive_tools.remote_btn_save_upload_batch', { count: batchUrls.length })
                      : t('speedtest.remote_btn_start_batch', { count: batchUrls.length })}
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
