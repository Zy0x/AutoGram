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
  Layers,
  Sparkles,
  Zap,
  CloudLightning,
  User,
  Info,
  KeyRound,
  CheckSquare,
  Square,
  Search,
  Circle,
  Play,
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
import type { RemoteEngineMode } from '../../../lib/telegram/driveTypes';

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

function formatMediaDuration(sec?: number): string | null {
  if (!sec || isNaN(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h > 0) {
    return `${h}:${remM.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${remM}:${s.toString().padStart(2, '0')}`;
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
    if (stored === 'cloud_fetch' || stored === 'ram_pipe') return stored;
    return transferSettings?.remoteEngineMode || 'auto';
  });
  const [inspection, setInspection] = useState<UrlInspection | null>(null);

  const [resolvedMedia, setResolvedMedia] = useState<ResolvedMediaInfo | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('');
  const [selectedMediaItemIds, setSelectedMediaItemIds] = useState<Set<string>>(new Set());
  const [itemSelectedFormats, setItemSelectedFormats] = useState<Record<string, string>>({});
  const [itemFilterText, setItemFilterText] = useState('');
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
      setItemFilterText('');
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
      setItemFilterText('');
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

  useEffect(() => {
    if (effectiveMediaItems.length > 0) {
      setSelectedMediaItemIds(new Set(effectiveMediaItems.map((item) => item.id)));
      const fmtMap: Record<string, string> = {};
      for (const item of effectiveMediaItems) {
        fmtMap[item.id] = item.selectedFormatId || item.formats[0]?.id || '';
      }
      setItemSelectedFormats(fmtMap);
      setItemFilterText('');
      setActivePreviewItemId(effectiveMediaItems[0]?.id || '');
    } else {
      setSelectedMediaItemIds(new Set());
      setItemSelectedFormats({});
      setItemFilterText('');
      setActivePreviewItemId('');
    }
  }, [effectiveMediaItems]);

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

  const handleItemFormatChange = useCallback((itemId: string, formatId: string) => {
    setItemSelectedFormats((prev) => ({
      ...prev,
      [itemId]: formatId,
    }));
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

  const filteredMediaItems = useMemo(() => {
    if (!itemFilterText.trim()) return effectiveMediaItems;
    const query = itemFilterText.trim().toLowerCase();
    return effectiveMediaItems.filter((item) => item.title.toLowerCase().includes(query));
  }, [effectiveMediaItems, itemFilterText]);

  const handleSelectSlide = (idx: number) => {
    setActiveSlideIndex(idx);
    const matchingFormat = resolvedMedia?.formats.find(
      (f) => f.id === `tiktok_photo_${idx + 1}`
    );
    if (matchingFormat) {
      setSelectedFormatId(matchingFormat.id);
    }
  };

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
        if (!activeResolved && (targetUrl.includes('tiktok.com') || targetUrl.includes('douyin.com') || targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be') || targetUrl.includes('instagram.com') || targetUrl.includes('terabox') || targetUrl.includes('pikpak') || targetUrl.includes('streamrizz.com') || targetUrl.includes('vidoy') || targetUrl.includes('overfetch.video') || targetUrl.includes('pinterest.com') || targetUrl.includes('pixiv.net') || targetUrl.includes('twitter.com') || targetUrl.includes('x.com'))) {
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

        <div className={`td-input-body td-remote-body ${isSplitActive ? 'td-remote-split-body' : ''}`}>
          <div className="td-remote-left-pane">
            {errorMsg && (
              <div className="td-input-error td-remote-error-box" role="alert">
                {errorMsg}
              </div>
            )}

            {tab === 'single' ? (
              <div className="td-remote-form-card">
                <div className="td-remote-field-group">
                  <div className="td-remote-label-row">
                    <div className="td-remote-label-left" ref={infoRef}>
                      <label className="td-input-label" htmlFor="td-remote-url">
                        {t('speedtest.source_url_label')}
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
                    <div className="td-remote-label-actions">
                      {url.trim().startsWith('http') && (
                        <button
                          type="button"
                          className="td-remote-open-web-action"
                          onClick={() => handleOpenInBrowser(url.trim())}
                          disabled={submitting}
                          title={t('speedtest.remote_open_in_browser')}
                        >
                          <ExternalLink size={12} />
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
                        <Clipboard size={12} />
                        <span>{t('speedtest.remote_paste_clipboard')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="td-remote-input-wrap">
                    <span className="td-remote-input-icon">
                      <Link2 size={16} />
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
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

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
                            <KeyRound size={11} />
                            <span>
                              {resolvedMedia.passwordError
                                ? t('speedtest.remote_passcode_invalid_badge')
                                : t('speedtest.remote_passcode_required_badge')}
                            </span>
                          </span>
                        )}
                        {url.trim().startsWith('http') && (
                          <button
                            type="button"
                            className="td-remote-open-web-action"
                            onClick={() => handleOpenInBrowser(url.trim())}
                            disabled={submitting}
                            title={t('speedtest.remote_open_web_for_code')}
                          >
                            <ExternalLink size={11} />
                            <span>{t('speedtest.remote_open_web_for_code')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="td-remote-input-wrap">
                      <span className="td-remote-input-icon">
                        <KeyRound size={15} />
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
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="td-remote-field-group">
                  <label className="td-input-label" htmlFor="td-custom-filename">
                    {t('speedtest.remote_custom_name_label')}
                  </label>
                  <input
                    id="td-custom-filename"
                    className="td-input-field td-custom-filename-input"
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
              </div>
            ) : (
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

            <div className="td-remote-field-group td-remote-form-card">
              <label className="td-input-label">{t('speedtest.remote_delivery_mode_label')}</label>
              <div className="td-remote-mode-selector">
                <button
                  type="button"
                  className={`td-remote-mode-btn ${deliveryMode === 'uncompressed' ? 'active' : ''}`}
                  onClick={() => setDeliveryMode('uncompressed')}
                  disabled={submitting}
                >
                  <span className="td-remote-mode-icon uncompressed">
                    <Film size={15} />
                  </span>
                  <div className="td-remote-mode-text">
                    <span className="td-remote-mode-title">{t('speedtest.remote_mode_uncompressed')}</span>
                    <span className="td-remote-mode-desc">{t('speedtest.remote_mode_uncompressed_hint')}</span>
                  </div>
                  {deliveryMode === 'uncompressed' && (
                    <span className="td-remote-mode-active-indicator">
                      <CheckCircle2 size={13} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`td-remote-mode-btn ${deliveryMode === 'auto' ? 'active' : ''}`}
                  onClick={() => setDeliveryMode('auto')}
                  disabled={submitting}
                >
                  <span className="td-remote-mode-icon auto">
                    <Zap size={15} />
                  </span>
                  <div className="td-remote-mode-text">
                    <span className="td-remote-mode-title">{t('speedtest.remote_mode_auto')}</span>
                    <span className="td-remote-mode-desc">{t('speedtest.remote_mode_auto_hint')}</span>
                  </div>
                  {deliveryMode === 'auto' && (
                    <span className="td-remote-mode-active-indicator">
                      <CheckCircle2 size={13} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`td-remote-mode-btn ${deliveryMode === 'document' ? 'active' : ''}`}
                  onClick={() => setDeliveryMode('document')}
                  disabled={submitting}
                >
                  <span className="td-remote-mode-icon doc">
                    <FileText size={15} />
                  </span>
                  <div className="td-remote-mode-text">
                    <span className="td-remote-mode-title">{t('speedtest.remote_mode_doc')}</span>
                    <span className="td-remote-mode-desc">{t('speedtest.remote_mode_doc_hint')}</span>
                  </div>
                  {deliveryMode === 'document' && (
                    <span className="td-remote-mode-active-indicator">
                      <CheckCircle2 size={13} />
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Smart Delivery Engine Status (Telegram external fetch / bounded RAM pipe) */}
            <div className="td-remote-field-group td-remote-form-card td-remote-engine-card">
              <div className="td-remote-engine-header">
                <div className="td-remote-engine-title-wrap">
                  <CloudLightning size={14} className="text-cyan-400" />
                  <span className="td-remote-engine-title">{t('drive_tools.remote_engine_mode_title')}</span>
                </div>
                {effectiveRemoteEngine === 'cloud_fetch' ? (
                  <span className="td-remote-engine-badge zero-quota">
                    <Sparkles size={11} />
                    <span>{t('drive_tools.remote_zero_quota_badge')}</span>
                  </span>
                ) : (
                  <span className="td-remote-engine-badge zero-disk">
                    <Zap size={11} />
                    <span>{t('drive_tools.remote_zero_disk_badge')}</span>
                  </span>
                )}
              </div>
              <p className="td-remote-engine-desc">
                {effectiveRemoteEngine === 'cloud_fetch'
                  ? t('drive_tools.remote_zero_quota_desc')
                  : t('drive_tools.remote_zero_disk_desc')}
              </p>
              <label className="td-input-label" htmlFor="td-remote-engine-mode">
                {t('drive_tools.remote_engine_selector_label')}
              </label>
              <select
                id="td-remote-engine-mode"
                className="td-input-field"
                value={remoteEngineMode}
                disabled={submitting}
                onChange={(event) => {
                  const next = event.target.value as RemoteEngineMode;
                  setRemoteEngineMode(next);
                  try { localStorage.setItem('autogram_remote_engine_mode', next); } catch { /* best effort */ }
                }}
              >
                <option value="auto">{t('drive_tools.remote_engine_auto')}</option>
                <option value="cloud_fetch">{t('drive_tools.remote_engine_cloud_fetch')}</option>
                <option value="ram_pipe">{t('drive_tools.remote_engine_ram_pipe')}</option>
              </select>
              <p className="td-remote-engine-desc td-remote-engine-note">
                {t('drive_tools.remote_engine_selector_hint')}
              </p>
            </div>

            <div className="td-remote-field-group td-remote-form-card">
              <label className="td-input-label" htmlFor="td-remote-target">
                {t('speedtest.destination_folder_label')}
              </label>
              <div className="td-remote-dest-wrap">
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
                        <Home size={16} />
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
                          <Hash size={11} style={{ display: 'inline', verticalAlign: '-1px' }} />
                          {` ${cleanTargetDisplay.topicPill.replace(/^#\s*/, '')}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="td-remote-dest-actions">
                    {renderBadge(selectedDest, t)}
                    <span className="td-remote-dest-change-tag">
                      {t('speedtest.btn_change_dest')}
                      <ChevronRight size={13} style={{ marginLeft: 3 }} />
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {tab === 'single' && isSplitActive && (
            <div className="td-remote-right-pane">
              <div className="td-remote-preview-head-row">
                <div className="td-remote-preview-head-titles">
                  <h3 className="td-remote-preview-title">{t('speedtest.remote_split_preview_title')}</h3>
                  <p className="td-remote-preview-subtitle">{t('speedtest.remote_split_preview_subtitle')}</p>
                </div>
                <span className="td-remote-live-canvas-pill">
                  <span className="td-remote-live-canvas-dot" />
                  <span>{t('speedtest.remote_split_live_canvas_badge')}</span>
                </span>
              </div>

              {resolvedMedia ? (
                <div className="td-remote-preview-content">
                  <div className="td-remote-meta-card">
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
                    <div className="td-remote-media-title" title={resolvedMedia.title}>
                      {resolvedMedia.title}
                    </div>
                    {resolvedMedia.author && (
                      <div className="td-remote-media-author">
                        {resolvedMedia.authorAvatar ? (
                          <img
                            src={resolvedMedia.authorAvatar}
                            alt={resolvedMedia.author}
                            className="td-remote-author-avatar-img"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <User size={12} />
                        )}
                        <span>{resolvedMedia.author}</span>
                      </div>
                    )}
                    {resolvedMedia.resolutionTrace && (
                      <section
                        className="td-remote-resolution-trace"
                        aria-label={t('speedtest.remote_resolution_trace_title')}
                      >
                        <div className="td-remote-resolution-trace-head">
                          <span>{t('speedtest.remote_resolution_trace_title')}</span>
                          <span className={`is-${resolvedMedia.resolutionTrace.securityStatus}`}>
                            <CheckCircle2 size={11} />
                            {t(`speedtest.remote_security_${resolvedMedia.resolutionTrace.securityStatus}`)}
                          </span>
                        </div>
                        <div className="td-remote-resolution-stages">
                          {resolvedMedia.resolutionTrace.stages.map((stage) => (
                            <span key={stage} className="is-complete">
                              <CheckCircle2 size={11} />
                              {t(`speedtest.remote_stage_${stage}`)}
                            </span>
                          ))}
                        </div>
                        <div className="td-remote-resolution-summary">
                          <span>{resolvedMedia.resolutionTrace.resolverName}</span>
                          <span>
                            {t('speedtest.remote_resolution_candidates', {
                              count: resolvedMedia.resolutionTrace.candidateCount,
                            })}
                          </span>
                          {resolvedMedia.resolutionTrace.inspectedPages != null && (
                            <span>
                              {t('speedtest.remote_resolution_pages', {
                                count: resolvedMedia.resolutionTrace.inspectedPages,
                              })}
                            </span>
                          )}
                        </div>
                      </section>
                    )}
                  </div>

                  {effectiveMediaItems.length > 1 ? (
                    <div className="td-remote-multicard-container">
                      {/* Active Live Media Preview Player at the Top */}
                      {activePreviewItem && (
                        <div className="td-remote-active-player-wrap">
                          <div className="td-remote-active-player-canvas">
                            {activePreviewChosenFmt?.directUrl && activePreviewItem.kind === 'video' ? (
                              activePlayableUrl ? (
                                <video
                                  key={activePlayableUrl}
                                  src={activePlayableUrl}
                                  poster={activePreviewItem.thumbnailUrl}
                                  controls
                                  preload="metadata"
                                  playsInline
                                  className="td-remote-active-player-video"
                                />
                              ) : (
                                <div className="td-remote-item-thumb-fallback flex items-center justify-center">
                                  <Loader2 size={28} className="animate-spin text-sky-400" />
                                </div>
                              )
                            ) : activePreviewItem.thumbnailUrl ? (
                              <img
                                src={activePreviewItem.thumbnailUrl}
                                alt={activePreviewItem.title}
                                className="td-remote-active-player-poster"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="td-remote-item-thumb-fallback">
                                <Film size={36} />
                              </div>
                            )}
                          </div>
                          <div className="td-remote-active-player-meta">
                            <div className="td-remote-active-player-title-wrap">
                              <Film size={15} className="text-cyan-400 shrink-0" />
                              <span className="td-remote-active-player-title" title={activePreviewItem.title}>
                                {activePreviewItem.title}
                              </span>
                            </div>
                            <div className="td-remote-active-player-badges">
                              <span className="td-remote-item-card-badge">
                                {(activePreviewChosenFmt && getFormatDisplayBadge(activePreviewChosenFmt, t)) || activePreviewChosenFmt?.resolution || t('speedtest.remote_badge_hd')}
                              </span>
                              {activePreviewChosenFmt?.filesizeBytes ? (
                                <span className="td-remote-item-card-size">
                                  ~{formatDriveBytes(activePreviewChosenFmt.filesizeBytes)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="td-remote-multicard-toolbar">
                        <div className="td-remote-multicard-counter-wrap">
                          <Layers size={15} className="td-remote-multicard-counter-icon" />
                          <span>
                            {t('speedtest.remote_multicard_count', {
                              selected: selectedMediaItemIds.size,
                              total: effectiveMediaItems.length,
                            })}
                          </span>
                          {selectedBytes > 0 && (
                            <span className="td-remote-multicard-size-badge">
                              ~{formatDriveBytes(selectedBytes)}
                            </span>
                          )}
                        </div>
                        <div className="td-remote-multicard-actions">
                          <button
                            type="button"
                            className="td-remote-multicard-btn"
                            onClick={handleSelectAllItems}
                            disabled={submitting || selectedMediaItemIds.size === effectiveMediaItems.length}
                          >
                            <CheckSquare size={13} />
                            <span>{t('speedtest.remote_btn_select_all')}</span>
                          </button>
                          <button
                            type="button"
                            className="td-remote-multicard-btn"
                            onClick={handleDeselectAllItems}
                            disabled={submitting || selectedMediaItemIds.size === 0}
                          >
                            <Square size={13} />
                            <span>{t('speedtest.remote_btn_deselect_all')}</span>
                          </button>
                        </div>
                      </div>

                      {effectiveMediaItems.length > 4 && (
                        <div className="td-remote-multicard-search">
                          <Search size={13} />
                          <input
                            type="text"
                            value={itemFilterText}
                            onChange={(e) => setItemFilterText(e.target.value)}
                            placeholder={t('speedtest.remote_filter_media_placeholder')}
                            spellCheck={false}
                          />
                          {itemFilterText && (
                            <button
                              type="button"
                              onClick={() => setItemFilterText('')}
                              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      )}

                      {filteredMediaItems.length === 0 ? (
                        <div className="td-remote-multicard-empty">
                          {t('speedtest.remote_no_filter_match')}
                        </div>
                      ) : (
                        <div className="td-remote-multicard-grid">
                          {filteredMediaItems.map((item, idx) => {
                            const isSelected = selectedMediaItemIds.has(item.id);
                            const isActivePreview = item.id === activePreviewItem?.id;
                            const chosenFmtId = itemSelectedFormats[item.id] || item.selectedFormatId || item.formats[0]?.id;
                            const chosenFmt = item.formats.find((f) => f.id === chosenFmtId) || item.formats[0];

                            return (
                              <div
                                key={item.id}
                                className={`td-remote-media-item-card ${isSelected ? 'selected' : ''} ${isActivePreview ? 'is-active-preview' : ''}`}
                                onClick={() => handleToggleItem(item.id)}
                                role="checkbox"
                                aria-checked={isSelected}
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    handleToggleItem(item.id);
                                  }
                                }}
                              >
                                <div
                                  className="td-remote-item-thumb-wrap"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivePreviewItemId(item.id);
                                  }}
                                  title={item.title}
                                >
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
                                      {item.kind === 'video' ? (
                                        <Film size={24} />
                                      ) : item.kind === 'audio' ? (
                                        <Music size={24} />
                                      ) : item.kind === 'image' ? (
                                        <ImageIcon size={24} />
                                      ) : (
                                        <FileText size={24} />
                                      )}
                                    </div>
                                  )}

                                  {item.kind === 'video' && (
                                    <div className="td-remote-item-play-overlay">
                                      <span className="td-remote-item-play-icon-badge">
                                        <Play size={12} fill="currentColor" />
                                      </span>
                                    </div>
                                  )}

                                  <span className="td-remote-item-index-badge">#{idx + 1}</span>

                                  <button
                                    type="button"
                                    className={`td-remote-item-checkbox ${isSelected ? 'checked' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleItem(item.id);
                                    }}
                                    aria-label={isSelected ? t('speedtest.remote_btn_deselect_all') : t('speedtest.remote_btn_select_all')}
                                  >
                                    {isSelected ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                                  </button>
                                </div>

                                <div className="td-remote-item-card-body">
                                  <div className="td-remote-item-card-title" title={item.title}>
                                    {item.title}
                                  </div>

                                  <div className="td-remote-item-card-controls">
                                    {item.formats.length > 1 ? (
                                      <select
                                        className="td-remote-item-format-select"
                                        value={chosenFmtId}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleItemFormatChange(item.id, e.target.value);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {item.formats.map((f) => (
                                          <option key={f.id} value={f.id}>
                                            {f.resolution || f.qualityTier || f.label}
                                            {f.filesizeBytes ? ` (~${formatDriveBytes(f.filesizeBytes)})` : ''}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <div className="td-remote-item-card-meta">
                                        <span className="td-remote-item-card-badge">
                                          {getFormatDisplayBadge(chosenFmt, t) || chosenFmt?.resolution || chosenFmt?.qualityTier || t('speedtest.remote_badge_hd')}
                                        </span>
                                        <span className="td-remote-item-card-size">
                                          {chosenFmt?.filesizeBytes
                                            ? `~${formatDriveBytes(chosenFmt.filesizeBytes)}`
                                            : t('speedtest.remote_inspect_size_unknown')}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="td-remote-big-canvas-wrap">
                        {activeSlideUrl ? (
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
                                  {formatMediaDuration(resolvedMedia.durationSec)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : resolvedMedia.formats[0]?.badge === 'remote_web_page' || resolvedMedia.formats[0]?.label === 'remote_web_page_handoff' ? (
                          <div className="td-remote-big-canvas-fallback td-remote-web-page-card">
                            <ExternalLink size={32} className="td-remote-fallback-icon" />
                            <span className="td-remote-web-handoff-title">{t('speedtest.remote_web_handoff_title')}</span>
                            <p className="td-remote-web-handoff-desc">{t('speedtest.remote_web_handoff_desc')}</p>
                            <button
                              type="button"
                              className="td-remote-open-web-card-btn"
                              onClick={() => handleOpenInBrowser(resolvedMedia.url)}
                            >
                              <ExternalLink size={13} />
                              <span>{t('speedtest.remote_btn_open_web')}</span>
                            </button>
                          </div>
                        ) : (
                          <div className="td-remote-big-canvas-fallback">
                            <Film size={36} className="td-remote-fallback-icon" />
                            <span>{t('drive_tools.remote_platform_stream_fallback', { platform: resolvedMedia.platformName })}</span>
                          </div>
                        )}
                      </div>

                      {resolvedMedia.albumImages && resolvedMedia.albumImages.length > 1 && (
                        <div className="td-remote-album-strip-container">
                          <div className="td-remote-album-strip-header">
                            <span className="td-remote-album-strip-count">
                              <ImageIcon size={12} />
                              <span>{t('speedtest.remote_album_strip_count', { count: resolvedMedia.albumImages.length })}</span>
                            </span>
                            <span className="td-remote-album-strip-active-note">
                              {t('speedtest.remote_split_slide_preview', {
                                idx: activeSlideIndex + 1,
                                total: resolvedMedia.albumImages.length,
                              })}
                            </span>
                          </div>
                          <div className="td-remote-album-strip">
                            {resolvedMedia.albumImages.map((imgUrl, idx) => {
                              const isActive = idx === activeSlideIndex;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  className={`td-remote-album-thumb-wrap ${isActive ? 'active' : ''}`}
                                  onClick={() => handleSelectSlide(idx)}
                                  title={t('speedtest.remote_photo_n', {
                                    idx: idx + 1,
                                    total: resolvedMedia.albumImages?.length || 0,
                                  })}
                                >
                                  <img
                                    src={imgUrl}
                                    alt={`Slide ${idx + 1}`}
                                    className="td-remote-album-thumb"
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                  <span className="td-remote-album-thumb-idx">#{idx + 1}</span>
                                  {isActive && (
                                    <span className="td-remote-album-thumb-check">
                                      <CheckCircle2 size={10} />
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {resolvedMedia.formats.length > 0 && (
                        <div className="td-remote-formats-container">
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
                    </>
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
              ) : (
                <div className="td-remote-preview-ready">
                  <div className="td-remote-ready-icon-wrap">
                    <Sparkles size={24} />
                  </div>
                  <h4 className="td-remote-ready-title">{t('speedtest.remote_split_ready_title')}</h4>
                  <p className="td-remote-ready-desc">{t('speedtest.remote_split_ready_desc')}</p>
                  <div className="td-remote-ready-pill-grid">
                    <span className="td-remote-ready-pill">{t('drive_tools.remote_sample_tiktok')}</span>
                    <span className="td-remote-ready-pill">{t('drive_tools.remote_sample_youtube')}</span>
                    <span className="td-remote-ready-pill">{t('drive_tools.remote_sample_instagram')}</span>
                    <span className="td-remote-ready-pill">{t('drive_tools.remote_sample_audio')}</span>
                    <span className="td-remote-ready-pill">{t('drive_tools.remote_sample_direct')}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="td-confirm-foot td-remote-foot">
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
                <Link2 size={15} strokeWidth={2.25} />
                <span>
                  {tab === 'single'
                    ? effectiveMediaItems.length > 1
                      ? selectedMediaItemIds.size === 0
                        ? t('speedtest.remote_btn_select_at_least_one')
                        : t('speedtest.remote_btn_upload_count', {
                            count: selectedMediaItemIds.size,
                            size: selectedBytes > 0 ? ` (~${formatDriveBytes(selectedBytes)})` : '',
                          })
                      : t('speedtest.remote_btn_start_single')
                    : t('speedtest.remote_btn_start_batch', { count: batchUrls.length })}
                </span>
              </>
            )}
          </button>
        </footer>
      </form>

      <DriveDestinationPicker state={pickerState} onClose={() => setPickerOpen(false)} />
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
