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
  FileText,
  Check,
  Layers,
  Sparkles,
  Zap,
  Info,
  KeyRound,
  Search,
  Play,
  Rocket,
  Bookmark,
  CloudDownload,
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
  if (!fmt) return item.kind === 'video' ? '1080p FHD' : 'HD PHOTO';

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
  return '1080p FHD';
}

interface PlatformBadgeInfo {
  name: string;
  badgeClass: string;
}

function detectPlatformBadge(rawUrl: string): PlatformBadgeInfo | null {
  if (!rawUrl || !rawUrl.trim().startsWith('http')) return null;
  const l = rawUrl.toLowerCase();
  if (l.includes('youtube.com') || l.includes('youtu.be')) {
    return { name: 'YouTube Stream', badgeClass: 'text-red-400 border-red-500/30 bg-red-500/10' };
  }
  if (l.includes('instagram.com')) {
    return { name: 'Instagram Reel / Media', badgeClass: 'text-pink-400 border-pink-500/30 bg-pink-500/10' };
  }
  if (l.includes('tiktok.com')) {
    return { name: 'TikTok Video', badgeClass: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' };
  }
  if (l.includes('twitter.com') || l.includes('x.com')) {
    return { name: 'X / Twitter Media', badgeClass: 'text-sky-400 border-sky-500/30 bg-sky-500/10' };
  }
  if (l.includes('pinterest.com') || l.includes('pin.it')) {
    return { name: 'Pinterest Media', badgeClass: 'text-rose-400 border-rose-500/30 bg-rose-500/10' };
  }
  if (l.endsWith('.mp4') || l.includes('.mp4?')) {
    return { name: 'Direct MP4 Stream', badgeClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
  }
  if (l.endsWith('.zip') || l.endsWith('.rar') || l.endsWith('.7z')) {
    return { name: 'Sparse ZIP Stream', badgeClass: 'text-amber-400 border-amber-500/30 bg-amber-500/10' };
  }
  return { name: 'Direct HTTP Stream', badgeClass: 'text-sky-400 border-sky-500/30 bg-sky-500/10' };
}

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
  const infoRef = useRef<HTMLDivElement | null>(null);

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
        if (showSupportedInfo) {
          setShowSupportedInfo(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, pickerOpen, showSupportedInfo, onClose]);

  useEffect(() => {
    if (!showSupportedInfo) return;
    const onDocClick = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowSupportedInfo(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSupportedInfo]);

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

  const [gallerySearch, setGallerySearch] = useState('');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'video' | 'image'>('all');

  const filteredAndSortedItems = useMemo(() => {
    if (!effectiveMediaItems) return [];
    let list = [...effectiveMediaItems];

    if (galleryFilter === 'video') {
      list = list.filter((it) => it.kind === 'video');
    } else if (galleryFilter === 'image') {
      list = list.filter((it) => it.kind === 'image');
    }

    if (gallerySearch.trim()) {
      const q = gallerySearch.trim().toLowerCase();
      list = list.filter((it) => it.title.toLowerCase().includes(q));
    }

    return list;
  }, [effectiveMediaItems, galleryFilter, gallerySearch]);

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
                expandedBatchUrls.push(...res.albumImages);
                continue;
              } else if (res.formats && res.formats.length > 0) {
                expandedBatchUrls.push(res.formats[0].directUrl);
                continue;
              }
            } catch {
              // fallback
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
        className={`td-confirm-panel input-dialog td-remote-upload-panel td-remote-split-active`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {/* Top Nav Shell (Header) - Minimal Context */}
        <header className="td-confirm-head">
          <div className="flex items-center gap-3 text-[#8ed5ff]">
            <span className="td-remote-head-icon" aria-hidden>
              <Link2 size={18} strokeWidth={2.25} />
            </span>
            <div className="flex flex-col">
              <h2 className="text-sm font-bold text-white tracking-wide">
                {t('drive_tools.remote_upload_url_title')}
              </h2>
              <p className="text-[11px] text-[#bdc8d1]">
                {t('drive_tools.remote_upload_url_desc')}
              </p>
            </div>

            <div className="td-remote-tabs ml-3" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'single'}
                className={`td-remote-tab ${tab === 'single' ? 'active' : ''}`}
                onClick={() => setTab('single')}
                disabled={submitting}
              >
                <Link2 size={13} />
                <span>{t('drive_tools.remote_tab_single')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'batch'}
                className={`td-remote-tab ${tab === 'batch' ? 'active' : ''}`}
                onClick={() => setTab('batch')}
                disabled={submitting}
              >
                <Layers size={13} />
                <span>{t('drive_tools.remote_tab_batch')}</span>
                {batchUrls.length > 0 && (
                  <span className="bg-[#38bdf8] text-[#001e2c] text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                    {batchUrls.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          <button
            type="button"
            className="text-[#bdc8d1] hover:text-white hover:bg-[#343a3e] transition-colors rounded-full p-1.5 flex items-center justify-center border border-transparent hover:border-white/10"
            onClick={onClose}
            disabled={submitting}
            aria-label={t('speedtest.preview_close_btn')}
          >
            <X size={18} />
          </button>
        </header>

        <div className="td-remote-body td-remote-split-body custom-scrollbar">
          {errorMsg && (
            <div className="td-remote-error-box" role="alert">
              {errorMsg}
            </div>
          )}

          <div className="td-remote-studio-layout">
            {/* SECTION 1: SOURCE URL */}
            <div className="flex flex-col gap-2">
              <h2 className="td-remote-section-title">
                {t('drive_tools.remote_section_1_title')}
              </h2>
              <div className="td-remote-card-shell doppelrand">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2" ref={infoRef}>
                      <label className="text-xs font-semibold text-[#dee3e8]" htmlFor="td-remote-url">
                        {t('speedtest.source_url_label')}
                      </label>
                      <button
                        type="button"
                        className={`td-remote-info-trigger ${showSupportedInfo ? 'active' : ''}`}
                        onClick={() => setShowSupportedInfo((prev) => !prev)}
                        title={t('drive_tools.remote_info_btn_aria')}
                        aria-label={t('drive_tools.remote_info_btn_aria')}
                        aria-expanded={showSupportedInfo}
                      >
                        <Info size={11} />
                      </button>
                      {renderSupportedLinksPopover()}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {url.trim().startsWith('http') && (
                        <button
                          type="button"
                          className="td-remote-open-web-action"
                          onClick={() => handleOpenInBrowser(url.trim())}
                          disabled={submitting}
                          title={t('speedtest.remote_open_in_browser')}
                        >
                          <ExternalLink size={11} />
                          <span>{t('speedtest.remote_open_in_browser')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="td-remote-paste-action"
                        onClick={handlePasteClipboard}
                        disabled={submitting}
                        title={t('speedtest.remote_paste_clipboard')}
                      >
                        <Clipboard size={11} />
                        <span>{t('speedtest.remote_paste_clipboard')}</span>
                      </button>
                    </div>
                  </div>

                  {tab === 'single' ? (
                    <div className="flex flex-col gap-2">
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-[#87929a] pointer-events-none flex items-center justify-center">
                          <Link2 size={16} />
                        </span>
                        <input
                          id="td-remote-url"
                          className="w-full bg-[#080c10] text-[#dee3e8] text-xs font-mono rounded-lg border border-white/10 pl-9 pr-9 py-2.5 focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8] transition-all placeholder:text-[#87929a]/50 hover:border-white/20"
                          placeholder={t('drive_tools.remote_url_placeholder')}
                          type="text"
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
                            className="absolute right-2.5 text-[#87929a] hover:text-white"
                            onClick={() => handleUrlChange('')}
                            disabled={submitting}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      {/* Detected Platform Recognition Badge */}
                      {url.trim().startsWith('http') && (() => {
                        const badge = detectPlatformBadge(url.trim());
                        if (!badge) return null;
                        return (
                          <div className="flex items-center gap-2 pt-0.5">
                            <span className="text-[10.5px] font-mono font-semibold text-[#87929a]">{t('drive_tools.remote_platform_recognized')}:</span>
                            <span className={`td-remote-platform-badge ${badge.badgeClass}`}>
                              <Zap size={10} className="animate-pulse" />
                              <span>{badge.name}</span>
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <textarea
                        id="td-remote-batch-input"
                        className="w-full bg-[#080c10] text-[#dee3e8] text-xs font-mono rounded-lg border border-white/10 p-3 focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8] transition-all placeholder:text-[#87929a]/50 hover:border-white/20 custom-scrollbar"
                        rows={4}
                        placeholder={t('speedtest.remote_batch_placeholder')}
                        value={batchUrlsText}
                        onChange={(e) => {
                          setBatchUrlsText(e.target.value);
                          if (errorMsg) setErrorMsg('');
                        }}
                        disabled={submitting}
                        spellCheck={false}
                      />
                      <div className="text-[11px] text-[#87929a]">
                        {batchUrls.length > 0
                          ? t('speedtest.remote_batch_count', { count: batchUrls.length })
                          : t('speedtest.remote_batch_empty_hint')}
                      </div>
                    </div>
                  )}

                    {/* Passcode (if required) */}
                    {(resolvedMedia?.requiresPassword || Boolean(passcode.trim())) && (
                      <div className="flex flex-col gap-1.5 mt-1 td-remote-passcode-field-animated">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-[#dee3e8]" htmlFor="td-remote-passcode">
                            {t('speedtest.remote_passcode_label')}
                          </label>
                          {resolvedMedia?.requiresPassword && (
                            <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                              <KeyRound size={10} />
                              {resolvedMedia.passwordError
                                ? t('speedtest.remote_passcode_invalid_badge')
                                : t('speedtest.remote_passcode_required_badge')}
                            </span>
                          )}
                        </div>
                        <div className="relative flex items-center">
                          <span className="absolute left-3 text-[#87929a]">
                            <KeyRound size={14} />
                          </span>
                          <input
                            id="td-remote-passcode"
                            className="w-full bg-[#0f1418] text-[#dee3e8] text-xs rounded-lg border border-white/10 pl-9 pr-8 py-2 focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8]"
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
                              className="absolute right-2.5 text-[#87929a] hover:text-white"
                              onClick={() => handlePasscodeChange('')}
                              disabled={submitting}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Custom Filename (Optional) */}
                    {tab === 'single' && (
                      <div className="flex flex-col gap-1.5 mt-1">
                        <label className="text-xs font-semibold text-[#87929a]" htmlFor="td-custom-filename">
                          {t('speedtest.remote_custom_name_label')}
                        </label>
                        <input
                          id="td-custom-filename"
                          className="w-full bg-[#0f1418] text-[#dee3e8] text-xs rounded-lg border border-white/10 px-3 py-2 focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8] placeholder:text-[#87929a]/40"
                          type="text"
                          placeholder={
                            getEffectiveFormatFilename(
                              resolvedMedia?.formats.find((f) => f.id === selectedFormatId) ||
                                resolvedMedia?.formats[0],
                              resolvedMedia
                            ) ||
                            inspection?.filename ||
                            t('speedtest.remote_custom_name_placeholder')
                          }
                          value={customFilename}
                          onChange={(e) => setCustomFilename(e.target.value)}
                          disabled={submitting}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 2: INGESTION MATRIX */}
              <div className="flex flex-col gap-2">
                <h2 className="td-remote-section-title">
                  {t('drive_tools.remote_section_2_title')}
                </h2>
                <div className="td-remote-card-shell doppelrand">
                  {/* Horizontal Matrix Row */}
                  <div className="td-remote-matrix-grid">
                    {/* 1. Quality */}
                    <div className="td-remote-matrix-item">
                      <span className="td-remote-matrix-label">{t('drive_tools.remote_matrix_quality')}</span>
                      <div className="td-remote-segmented-group">
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${deliveryMode === 'uncompressed' || deliveryMode === 'auto' ? 'active' : ''}`}
                          onClick={() => setDeliveryMode(deliveryMode === 'document' ? 'auto' : deliveryMode)}
                          disabled={submitting}
                          title={t('speedtest.remote_mode_uncompressed_hint')}
                        >
                          <Zap size={13} />
                          <span className="text-[11px] font-semibold">{t('speedtest.remote_mode_uncompressed')}</span>
                        </button>
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${deliveryMode === 'document' ? 'active' : ''}`}
                          onClick={() => setDeliveryMode('document')}
                          disabled={submitting}
                          title={t('speedtest.remote_mode_doc_hint')}
                        >
                          <FileText size={13} />
                          <span className="text-[11px] font-semibold">{t('speedtest.remote_mode_doc')}</span>
                        </button>
                      </div>
                    </div>

                    {/* 2. Engine */}
                    <div className="td-remote-matrix-item">
                      <span className="td-remote-matrix-label">{t('drive_tools.remote_matrix_engine')}</span>
                      <div className="td-remote-segmented-group">
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${remoteEngineMode === 'auto' || remoteEngineMode === 'ram_pipe' ? 'active' : ''}`}
                          onClick={() => {
                            setRemoteEngineMode('auto');
                            try { localStorage.setItem('autogram_remote_engine_mode', 'auto'); } catch { /* ok */ }
                          }}
                          disabled={submitting}
                          title={t('drive_tools.remote_zero_disk_desc')}
                        >
                          <Zap size={13} />
                          <span className="text-[11px] font-semibold">{t('drive_tools.remote_engine_auto')}</span>
                        </button>
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${remoteEngineMode === 'cloud_fetch' ? 'active' : ''}`}
                          onClick={() => {
                            setRemoteEngineMode('cloud_fetch');
                            try { localStorage.setItem('autogram_remote_engine_mode', 'cloud_fetch'); } catch { /* ok */ }
                          }}
                          disabled={submitting}
                          title={t('drive_tools.remote_zero_quota_desc')}
                        >
                          <CloudDownload size={13} />
                          <span className="text-[11px] font-semibold">{t('drive_tools.remote_engine_cloud_fetch')}</span>
                        </button>
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${remoteEngineMode === 'storage_local' ? 'active' : ''}`}
                          onClick={() => {
                            setRemoteEngineMode('storage_local');
                            try { localStorage.setItem('autogram_remote_engine_mode', 'storage_local'); } catch { /* ok */ }
                          }}
                          disabled={submitting}
                          title={t('drive_tools.remote_mode_storage_local_desc')}
                        >
                          <Folder size={13} />
                          <span className="text-[11px] font-semibold">{t('drive_tools.remote_engine_storage_local')}</span>
                        </button>
                      </div>
                    </div>

                    {/* 3. Storage */}
                    <div className="td-remote-matrix-item">
                      <span className="td-remote-matrix-label">{t('drive_tools.remote_matrix_storage')}</span>
                      <div className="td-remote-segmented-group">
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${storagePolicy === 'telegram' ? 'active' : ''}`}
                          onClick={() => setStoragePolicy('telegram')}
                          disabled={submitting}
                          title={t('drive_tools.remote_policy_telegram')}
                        >
                          <Rocket size={13} />
                          <span className="text-[11px] font-semibold">{t('drive_tools.remote_policy_telegram')}</span>
                        </button>
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${storagePolicy === 'custom_disk' ? 'active' : ''}`}
                          onClick={() => setStoragePolicy('custom_disk')}
                          disabled={submitting}
                          title={t('drive_tools.remote_policy_custom_disk')}
                        >
                          <Folder size={13} />
                          <span className="text-[11px] font-semibold">{t('drive_tools.remote_policy_custom_disk')}</span>
                        </button>
                        <button
                          type="button"
                          className={`td-remote-segmented-btn ${storagePolicy === 'disk_and_telegram' ? 'active' : ''}`}
                          onClick={() => setStoragePolicy('disk_and_telegram')}
                          disabled={submitting}
                          title={t('drive_tools.remote_policy_disk_and_telegram')}
                        >
                          <Layers size={13} />
                          <span className="text-[11px] font-semibold">{t('drive_tools.remote_policy_disk_and_telegram')}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Custom disk folder picker if needed */}
                  {(storagePolicy === 'custom_disk' || storagePolicy === 'disk_and_telegram') && (
                    <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                      <input
                        type="text"
                        className="flex-1 bg-[#080c10] text-[#dee3e8] text-xs rounded border border-white/10 px-3 py-1.5 focus:border-[#38bdf8]"
                        placeholder={t('drive_tools.remote_custom_disk_path_label')}
                        value={customDiskPath}
                        onChange={(e) => setCustomDiskPath(e.target.value)}
                      />
                      <button
                        type="button"
                        className="px-3 py-1.5 bg-[#252e37] hover:bg-white/10 text-white rounded text-xs font-semibold flex items-center gap-1.5 border border-white/10"
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
                        <Folder size={12} />
                        <span>{t('drive_tools.remote_custom_disk_browse')}</span>
                      </button>
                    </div>
                  )}

                  {/* Destination Target Row */}
                  <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
                    <span className="td-remote-matrix-label">
                      {t('drive_tools.remote_dest_target_label')}
                    </span>
                    <button
                      type="button"
                      className="td-remote-dest-target-btn group"
                      onClick={() => setPickerOpen(true)}
                      disabled={submitting}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="td-remote-dest-target-icon">
                          {selectedDest.kind === 'saved' ? (
                            <Bookmark size={20} />
                          ) : (
                            <PeerAvatar
                              peerId={selectedDest.id ?? 0}
                              creds={creds}
                              title={selectedDest.label}
                              fallback={kindIcon(selectedDest)}
                            />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="font-bold text-sm text-[#dee3e8] group-hover:text-white truncate">
                            {cleanTargetDisplay.title}
                          </div>
                          <div className="text-xs text-[#87929a] truncate">
                            {cleanTargetDisplay.topicPill || t('drive_tools.remote_dest_personal_cloud')}
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={20} className="text-[#87929a] group-hover:text-[#38bdf8] transition-colors shrink-0" />
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION 3: PREVIEW MEDIA */}
              <div className="flex flex-col gap-2">
                <h2 className="td-remote-section-title">
                  {t('drive_tools.remote_section_3_title')}
                </h2>

                {/* Available Quality Stream Pills (if multiple available) */}
                {resolvedMedia && resolvedMedia.formats && resolvedMedia.formats.length > 1 && (
                  <div className="flex items-center gap-2 flex-wrap pb-1">
                    <span className="text-[10.5px] font-mono font-bold text-[#87929a] uppercase tracking-wider">
                      {t('drive_tools.remote_quality_formats_available', { count: resolvedMedia.formats.length })}:
                    </span>
                    <div className="td-remote-format-pills">
                      {resolvedMedia.formats.map((fmt) => {
                        const isSelected = (selectedFormatId || resolvedMedia.formats[0]?.id) === fmt.id;
                        return (
                          <button
                            key={fmt.id}
                            type="button"
                            className={`td-remote-format-pill ${isSelected ? 'active' : ''}`}
                            onClick={() => setSelectedFormatId(fmt.id)}
                            disabled={submitting}
                          >
                            <span>{fmt.label || fmt.resolution || fmt.qualityTier?.toUpperCase() || fmt.ext?.toUpperCase()}</span>
                            {fmt.filesizeBytes ? <span className="text-[9.5px] opacity-75 font-mono">({formatDriveBytes(fmt.filesizeBytes)})</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Cinematic Preview Hero */}
                <div className="td-remote-preview-hero doppelrand group">
                  {activePlayableUrl && (targetMediaForPlayback?.isVideo || !resolvedMedia?.albumImages || resolvedMedia.albumImages.length === 0) ? (
                    <video
                      key={activePlayableUrl}
                      src={activePlayableUrl}
                      poster={activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia?.thumbnailUrl}
                      controls
                      preload="metadata"
                      playsInline
                      className="td-remote-preview-hero-video td-remote-active-player-video"
                      onLoadedMetadata={(e) => {
                        const dur = e.currentTarget.duration;
                        if (dur && isFinite(dur) && dur > 0) {
                          const d = Math.round(dur);
                          setActiveVideoDuration(d);
                          if (activePreviewItem) {
                            setItemDurations((prev) => ({ ...prev, [activePreviewItem.id]: d }));
                          }
                        }
                      }}
                    />
                  ) : activeSlideUrl ? (
                    <>
                      <img
                        src={activeSlideUrl}
                        alt={resolvedMedia?.title || t('drive_tools.remote_preview_title')}
                        className="td-remote-preview-hero-img"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <div className="td-remote-play-overlay">
                        <div className="td-remote-play-circle glass-panel">
                          <Play size={24} className="text-white fill-white ml-0.5" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[#87929a] gap-2 p-4 text-center">
                      <Sparkles size={28} className="text-[#38bdf8] animate-pulse" />
                      <span className="text-xs font-medium text-[#dee3e8]">{t('speedtest.remote_split_ready_title')}</span>
                      <span className="text-[11px] text-[#87929a] max-w-xs">{t('speedtest.remote_split_ready_desc')}</span>
                    </div>
                  )}

                  {/* HUD Pill */}
                  {(resolvedMedia || activePlayableUrl || inspection) && (
                    <div className="td-remote-hud-pill glass-panel">
                      <span className="flex items-center gap-1.5 font-bold">
                        <span className="td-remote-hud-dot" />
                        <span>
                          {activePreviewItem
                            ? getSingleUnifiedBadge(activePreviewItem)
                            : (resolvedMedia?.formats[0]?.qualityTier?.toUpperCase() || t('drive_tools.remote_badge_fhd'))}
                        </span>
                      </span>
                      <span className="td-remote-hud-divider" />
                      <span className="font-mono font-bold tracking-wider">
                        {formatMediaDuration(activeVideoDuration || activePreviewItem?.durationSec || resolvedMedia?.durationSec) || '26:18'}
                      </span>
                      <span className="td-remote-hud-divider" />
                      <span className="text-[#38bdf8] flex items-center gap-1 font-semibold">
                        <Zap size={13} />
                        <span>{t('drive_tools.remote_direct_stream_badge')}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

            {/* SECTION 4: COLLECTION STUDIO */}
            <div className="flex flex-col gap-2">
              <h2 className="td-remote-section-title">
                {t('drive_tools.remote_section_4_title')}
              </h2>
              <div className="td-remote-collection-wrap doppelrand">
                <div className="td-remote-collection-header">
                  <span className="font-mono text-xs font-bold text-[#dee3e8] bg-[#080c10] border border-white/10 px-3 py-1 rounded-md shadow-inner">
                    {t('drive_tools.remote_items_detected', {
                      count: effectiveMediaItems.length > 0 ? effectiveMediaItems.length : 1,
                    })}
                    {selectedBytes > 0 ? ` • ${formatDriveBytes(selectedBytes)}` : ''}
                  </span>
                </div>

                {/* Sub-toolbar */}
                <div className="flex items-center justify-between gap-2 flex-wrap pb-1">
                  <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                    <div className="relative flex-1 max-w-[200px] flex items-center">
                      <Search size={12} className="absolute left-2.5 text-[#87929a] pointer-events-none" />
                      <input
                        type="text"
                        className="w-full bg-[#080c10] text-[#dee3e8] text-xs rounded-lg border border-white/10 pl-7 pr-6 py-1.5 focus:border-[#38bdf8] transition-all"
                        placeholder={t('drive_tools.remote_gallery_search_placeholder', {
                          count: effectiveMediaItems.length || 1,
                        })}
                        value={gallerySearch}
                        onChange={(e) => setGallerySearch(e.target.value)}
                      />
                      {gallerySearch && (
                        <button
                          type="button"
                          className="absolute right-2 text-[#87929a] hover:text-white"
                          onClick={() => setGallerySearch('')}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all ${
                          galleryFilter === 'all'
                            ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                            : 'bg-[#080c10] border-white/10 text-[#87929a] hover:text-white'
                        }`}
                        onClick={() => setGalleryFilter('all')}
                      >
                        {t('drive_tools.remote_gallery_filter_all', { count: effectiveMediaItems.length || 1 })}
                      </button>
                      <button
                        type="button"
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all ${
                          galleryFilter === 'video'
                            ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                            : 'bg-[#080c10] border-white/10 text-[#87929a] hover:text-white'
                        }`}
                        onClick={() => setGalleryFilter('video')}
                      >
                        {t('drive_tools.remote_gallery_filter_videos', {
                          count: effectiveMediaItems.filter((i) => i.kind === 'video').length || (inspection?.kind === 'video' ? 1 : 0),
                        })}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[#38bdf8] hover:underline"
                      onClick={handleSelectAllItems}
                    >
                      {t('drive_tools.remote_gallery_select_all')}
                    </button>
                    <span className="text-[#87929a]">/</span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[#87929a] hover:text-white"
                      onClick={handleDeselectAllItems}
                    >
                      {t('drive_tools.remote_gallery_deselect_all')}
                    </button>
                  </div>
                </div>

                {/* Bento Grid */}
                <div className="td-remote-bento-grid custom-scrollbar">
                  {filteredAndSortedItems.length > 0 ? (
                    filteredAndSortedItems.map((item) => {
                      const isSelected = selectedMediaItemIds.has(item.id);
                      const isActive = item.id === activePreviewItem?.id;

                      return (
                        <div
                          key={item.id}
                          className={`td-remote-bento-card ${isSelected ? 'selected' : ''} ${isActive ? 'is-active-preview' : ''}`}
                          onClick={() => setActivePreviewItemId(item.id)}
                        >
                          <img
                            src={item.thumbnailUrl || (resolvedMedia?.thumbnailUrl ?? '')}
                            alt={item.title}
                            className="w-full h-full object-cover opacity-70 hover:opacity-100 transition-all duration-300"
                            loading="lazy"
                          />

                          {/* Selection Checkbox */}
                          <div
                            className="td-remote-bento-check"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleItem(item.id);
                            }}
                          >
                            {isSelected && <Check size={14} strokeWidth={3} />}
                          </div>

                          {/* Resolution Badge Top-Right */}
                          <div className="td-remote-bento-res">
                            {getSingleUnifiedBadge(item)}
                          </div>

                          {/* Duration Badge Bottom-Right */}
                          {(itemDurations[item.id] || item.durationSec) ? (
                            <div className="td-remote-bento-dur">
                              {formatMediaDuration(itemDurations[item.id] || item.durationSec)}
                            </div>
                          ) : null}

                          {/* Title Wrap Gradient */}
                          <div className="td-remote-bento-title-wrap">
                            <div className="td-remote-bento-title" title={item.title}>
                              {item.title}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    /* Fallback single card if 1 file */
                    <div
                      className={`td-remote-bento-card selected is-active-preview`}
                    >
                      <img
                        src={resolvedMedia?.thumbnailUrl || activeSlideUrl || 'https://picsum.photos/seed/autogram_hero/400/600'}
                        alt={t('drive_tools.remote_preview_title')}
                        className="w-full h-full object-cover opacity-80"
                      />
                      <div className="td-remote-bento-check">
                        <Check size={14} strokeWidth={3} />
                      </div>
                      <div className="td-remote-bento-res">
                        {inspection?.kind === 'video' ? t('drive_tools.remote_badge_fhd') : t('drive_tools.remote_badge_hd')}
                      </div>
                      <div className="td-remote-bento-title-wrap">
                        <div className="td-remote-bento-title" title={customFilename || inspection?.filename || t('speedtest.remote_split_ready_title')}>
                          {customFilename || inspection?.filename || t('speedtest.remote_split_ready_title')}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Footer (Action Bar) */}
          <footer className="td-remote-foot doppelrand">
            <div className="flex items-center gap-4 pl-1">
              {/* Status Indicator */}
              <div className="td-remote-foot-status-indicator">
                <Zap size={15} className="animate-pulse" />
                <span>{t('drive_tools.remote_status_zero_disk')}</span>
              </div>
              {/* Target Info */}
              <div className="td-remote-foot-target-info">
                <ChevronRight size={16} className="text-[#87929a]" />
                <span>
                  {t('drive_tools.remote_status_target')}{' '}
                  <strong className="text-white font-bold">{cleanTargetDisplay.title}</strong>
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="td-remote-foot-actions">
              <button
                type="button"
                className="td-remote-foot-cancel-btn"
                onClick={onClose}
                disabled={submitting}
              >
                {t('accounts.cancel')}
              </button>
              <button
                type="submit"
                className="td-remote-foot-submit-btn bloom-primary"
                disabled={
                  submitting ||
                  (tab === 'single'
                    ? !url.trim() || (effectiveMediaItems.length > 1 && selectedMediaItemIds.size === 0)
                    : batchUrls.length === 0)
                }
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>{t('speedtest.uploading_status')}</span>
                  </>
                ) : (
                  <>
                    <Rocket size={17} />
                    <span>
                      {tab === 'single'
                        ? effectiveMediaItems.length > 1
                          ? selectedMediaItemIds.size === 0
                            ? t('speedtest.remote_btn_select_at_least_one')
                            : t('drive_tools.remote_btn_upload_count', { count: selectedMediaItemIds.size })
                          : t('drive_tools.remote_btn_start_single')
                        : t('drive_tools.remote_btn_start_batch', { count: batchUrls.length })}
                    </span>
                  </>
                )}
              </button>
            </div>
          </footer>
        </div>
      </form>

      <DriveDestinationPicker state={pickerState} onClose={() => setPickerOpen(false)} />
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
