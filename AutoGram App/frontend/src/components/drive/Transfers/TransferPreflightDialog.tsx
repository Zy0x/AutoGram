import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  CopyCheck,
  Cpu,
  ExternalLink,
  FileCode,
  FileSearch,
  FileText,
  Film,
  Folder,
  Globe,
  HardDrive,
  Image as ImageIcon,
  ImageOff,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  Music,
  Network,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DrivePreviewModal } from '../DrivePreviewModal';
import { buildThumbCacheKey, getThumbQuality, requestThumb } from '../../../lib/media/thumbBatcher';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { getSessionDisplayName } from '../../../lib/telegram';
import {
  DEFAULT_TRANSFER_SETTINGS,
  formatDriveBytes,
  type DriveFile,
  type DriveTransferSettings,
  type RemoteEngineMode,
} from '../../../lib/telegram/driveTypes';
import type { SubMenuCategory } from './transferSettingsSearchRegistry';
import { calculateAlbumPartition } from './AlbumStrategyControl';
import {
  buildPreflightReviewDecision,
  defaultDuplicateChoices,
} from '../../../lib/transfer/preflightDuplicateDecision';
import type {
  PreflightReviewDecision,
  QualityPreflightDuplicateMatch,
  QualityPreflightItem,
  QualityPreflightReport,
  TransferDuplicateChoice,
} from '../../../lib/transfer/qualityPreflight';

const preflightThumbCache = new Map<string, string>();
const preflightDurationCache = new Map<string, number>();

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function transferPreviewSource(path: string, thumbnailUrl?: string | null): string | null {
  if (
    thumbnailUrl &&
    (thumbnailUrl.startsWith('http://') ||
      thumbnailUrl.startsWith('https://') ||
      thumbnailUrl.startsWith('data:') ||
      thumbnailUrl.startsWith('asset://') ||
      thumbnailUrl.startsWith('blob:'))
  ) {
    return thumbnailUrl;
  }
  if (thumbnailUrl && /\.(jpe?g|png|webp|gif|bmp|heic|avif)($|\?)/i.test(thumbnailUrl)) {
    return convertFileSrc(thumbnailUrl);
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    if (path.match(/\.(jpe?g|png|webp|gif|bmp|heic|avif)($|\?)/i)) {
      return path;
    }
    return null;
  }
  if (path.match(/\.(jpe?g|png|webp|gif|bmp|heic|avif)($|\?)/i)) {
    return convertFileSrc(path);
  }
  return null;
}

function PreflightSourceThumb({
  item,
}: {
  item: QualityPreflightItem;
}) {
  const { t } = useTranslation();
  const rawPath = item.sourcePath || '';
  const initialSource = transferPreviewSource(rawPath, item.thumbnailUrl);
  const [capturedThumb, setCapturedThumb] = useState<string | null>(() => {
    return rawPath ? preflightThumbCache.get(rawPath) || null : null;
  });
  const [duration, setDuration] = useState<number | null>(() => {
    return rawPath ? preflightDurationCache.get(rawPath) || null : null;
  });
  const [imgError, setImgError] = useState(false);

  const isVideo =
    item.category === 'video' ||
    /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|ts)($|\?)/i.test(item.sourceName || rawPath);

  useEffect(() => {
    if (!isVideo || !rawPath) return;

    const hasCachedThumb = preflightThumbCache.has(rawPath) || !!initialSource;
    const hasCachedDuration = preflightDurationCache.has(rawPath);

    if (hasCachedThumb && hasCachedDuration) {
      if (duration == null && preflightDurationCache.has(rawPath)) {
        setDuration(preflightDurationCache.get(rawPath) || null);
      }
      return;
    }

    let active = true;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignore */
      }
    };

    const doCapture = () => {
      try {
        if (!active || cleanedUp) return;
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;
        if (!vWidth || !vHeight || vWidth <= 0 || vHeight <= 0) return;

        const width = Math.min(480, vWidth);
        const height = Math.round((width * vHeight) / vWidth);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (dataUrl && dataUrl.startsWith('data:image/jpeg') && dataUrl.length > 200) {
          preflightThumbCache.set(rawPath, dataUrl);
          setCapturedThumb(dataUrl);
        }
      } catch (err) {
        console.warn('[Preflight] Canvas capture error:', err);
      } finally {
        cleanup();
      }
    };

    const updateDuration = () => {
      if (!active || cleanedUp) return;
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0) {
        preflightDurationCache.set(rawPath, dur);
        setDuration(dur);
      }
    };

    const onLoadedMetadata = () => {
      if (!active || cleanedUp) return;
      updateDuration();

      if (!hasCachedThumb) {
        const dur = video.duration;
        const targetTime = Number.isFinite(dur) && dur > 0 ? Math.min(1.0, dur > 2 ? 1.0 : dur / 2) : 1.0;
        try {
          video.currentTime = targetTime;
        } catch {
          requestAnimationFrame(doCapture);
        }
      } else {
        cleanup();
      }
    };

    const onSeeked = () => {
      if (!active || cleanedUp) return;
      updateDuration();
      requestAnimationFrame(doCapture);
    };

    video.addEventListener('durationchange', updateDuration);
    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('loadeddata', updateDuration);
    video.addEventListener('canplay', updateDuration);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', cleanup, { once: true });

    video.src = rawPath.startsWith('http://') || rawPath.startsWith('https://')
      ? rawPath
      : convertFileSrc(rawPath);

    const tid = setTimeout(() => {
      if (active && !cleanedUp) {
        if (!hasCachedThumb) doCapture();
        cleanup();
      }
    }, 3000);

    return () => {
      active = false;
      clearTimeout(tid);
      cleanup();
    };
  }, [initialSource, isVideo, rawPath, capturedThumb, duration]);

  const effectiveSrc = (!imgError && initialSource) || capturedThumb;

  if (effectiveSrc) {
    return (
      <div className="td-preflight-thumb-media">
        <img
          src={effectiveSrc}
          alt={t('drive.preflight_source_thumb_alt')}
          onError={() => setImgError(true)}
        />
        {isVideo && duration != null && duration > 0 && (
          <span className="td-preflight-thumb-duration-badge" aria-label={`Durasi ${formatDuration(duration)}`}>
            {formatDuration(duration)}
          </span>
        )}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="td-preflight-icon-thumb is-video" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', position: 'relative' }}>
        <Film size={22} className="text-sky-400" aria-hidden />
        {duration != null && duration > 0 && (
          <span className="td-preflight-thumb-duration-badge" aria-label={`Durasi ${formatDuration(duration)}`}>
            {formatDuration(duration)}
          </span>
        )}
      </div>
    );
  }

  if (item.category === 'photo' || /\.(jpe?g|png|webp|gif|bmp|heic|avif)($|\?)/i.test(item.sourceName || rawPath)) {
    return (
      <div className="td-preflight-icon-thumb is-photo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
        <ImageIcon size={22} className="text-emerald-400" aria-hidden />
      </div>
    );
  }

  if (item.category === 'audio' || /\.(mp3|flac|m4a|wav|ogg|opus|aac)($|\?)/i.test(item.sourceName || rawPath)) {
    return (
      <div className="td-preflight-icon-thumb is-audio" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
        <Music size={22} className="text-purple-400" aria-hidden />
      </div>
    );
  }

  return <FileText size={22} className="text-slate-400" aria-hidden />;
}

function TelegramDuplicateThumb({
  match,
  creds,
}: {
  match: QualityPreflightDuplicateMatch;
  creds: DriveCredentials | null;
}) {
  const { t } = useTranslation();
  const [thumb, setThumb] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missingReason, setMissingReason] = useState<string | null>(null);

  useEffect(() => {
    const messageId = Number(match.telegramMessageId || 0);
    if (!creds || messageId <= 0) {
      setThumb(null);
      setLoading(false);
      setMissingReason('invalid_locator');
      return;
    }
    const controller = new AbortController();
    const peerId = match.destinationId === 'me' ? 'me' : match.destinationId;
    const folderId = peerId === 'me' ? null : Number(peerId);
    const topicId = match.topicId ?? null;

    // Video thumbnails may be generated asynchronously by the native worker
    // (FFmpeg/sparse-media path).  The first request intentionally resolves
    // with null while that work is queued, so subscribe to the same event used
    // by the drive cards and repaint the preflight card when the frame arrives.
    const onThumbReady = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { key?: string; url?: string }
        | undefined;
      if (!detail?.key || !detail.url) return;
      const quality = getThumbQuality();
      const expectedKeys = new Set([
        buildThumbCacheKey(folderId, messageId, quality, creds.session, peerId, topicId),
        // `thumb_single_ready` is emitted without a forum topic.  Message IDs
        // are unique within a Telegram peer, so accepting the topic-less key
        // is safe and lets topic preflight cards receive late video frames.
        buildThumbCacheKey(folderId, messageId, quality, creds.session, peerId, null),
      ]);
      if (!expectedKeys.has(detail.key)) return;
      setThumb(detail.url);
      setLoading(false);
      setMissingReason(null);
    };
    const onThumbResult = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { peerId?: string; telegramMessageId?: number; status?: string; reason?: string | null }
        | undefined;
      if (!detail || String(detail.peerId || '') !== peerId || Number(detail.telegramMessageId) !== messageId) return;
      if (detail.status === 'ready') return;
      setThumb(null);
      setLoading(false);
      setMissingReason(detail.reason || 'unavailable');
    };
    window.addEventListener('autogram-thumb-ready', onThumbReady);
    window.addEventListener('autogram-thumb-result', onThumbResult);
    setThumb(null);
    setMissingReason(null);
    setLoading(true);
    void requestThumb(creds, Number.isFinite(folderId) ? folderId : null, messageId, {
      priority: 'visible',
      peerId,
      topicId,
      locationType: peerId === 'me' ? 'saved_messages' : 'group',
      signal: controller.signal,
    }).then((value) => {
      if (!controller.signal.aborted) {
        setThumb(value);
        setLoading(false);
        if (value) setMissingReason(null);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setThumb(null);
        setLoading(false);
        setMissingReason('request_failed');
      }
    });
    return () => {
      controller.abort();
      window.removeEventListener('autogram-thumb-ready', onThumbReady);
      window.removeEventListener('autogram-thumb-result', onThumbResult);
    };
  }, [creds, match.destinationId, match.telegramMessageId, match.topicId]);

  return (
    <div className={`td-preflight-compare-media ${loading ? 'is-loading' : ''}`}>
      {thumb ? (
        <img src={thumb} alt={t('drive.preflight_existing_thumb_alt')} />
      ) : (
        <div className="td-preflight-thumb-empty">
          <ImageOff size={20} aria-hidden />
          <span>
            {loading
              ? t('drive.preflight_existing_thumb_loading')
              : missingReason === 'MessageNotReturned'
                ? t('drive.preflight_existing_thumb_stale')
                : t('drive.preflight_existing_thumb_missing')}
          </span>
        </div>
      )}
    </div>
  );
}

function PreflightTransferInfoBento({
  item,
  report,
  creds,
  transferSettings,
}: {
  item: QualityPreflightItem;
  report: QualityPreflightReport;
  creds: DriveCredentials | null;
  transferSettings?: DriveTransferSettings;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const isRemoteUrl = item.sourcePath.startsWith('http://') || item.sourcePath.startsWith('https://');
  const isTelegramMigrate = item.sourcePath.startsWith('tg://') || item.sourcePath.startsWith('telegram://') || item.sourcePath.startsWith('tgmsg:');
  const isZipStream = item.sourcePath.includes('.zip#') || item.sourcePath.startsWith('zip://');

  let sourceTypeBadge = t('drive.preflight_bento_source_type_local');
  let domain = '';
  let sourceFolder = '';

  if (isRemoteUrl) {
    sourceTypeBadge = t('drive.preflight_bento_source_type_remote');
    try {
      domain = new URL(item.sourcePath).hostname;
    } catch {
      domain = 'remote';
    }
  } else if (isTelegramMigrate) {
    sourceTypeBadge = t('drive.preflight_bento_source_type_telegram');
  } else if (isZipStream) {
    sourceTypeBadge = t('drive.preflight_bento_source_type_zip');
  } else {
    sourceTypeBadge = t('drive.preflight_bento_source_type_local');
    const parts = item.sourcePath.split(/[/\\]/);
    if (parts.length > 1) {
      sourceFolder = parts[parts.length - 2] || parts[0];
    }
  }

  const handleCopy = (text: string) => {
    try {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // MIME & Extension
  const dotIdx = item.sourceName.lastIndexOf('.');
  const ext = dotIdx > 0 ? item.sourceName.slice(dotIdx + 1).toLowerCase() : '';
  const extMap: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    zip: 'application/zip',
    pdf: 'application/pdf',
    bin: 'application/octet-stream',
  };
  const mimeType = extMap[ext] || (item.category === 'video' ? 'video/mp4' : item.category === 'photo' ? 'image/jpeg' : item.category === 'audio' ? 'audio/mpeg' : 'application/octet-stream');

  // Real-time Delivery Mode Calculation synced with transferSettings
  const effectivePresentation = transferSettings?.presentationOverride ?? 'automatic';
  const isForceDoc =
    transferSettings?.forceDocumentDefault === true ||
    effectivePresentation === 'force_document' ||
    item.asDocument === true ||
    item.payloadClass === 'document_group' ||
    item.payloadClass === 'original_document_batch';

  const isForceNative = effectivePresentation === 'force_native_media';

  const effectiveDeliveryMode = isForceDoc
    ? 'document'
    : isForceNative
    ? (item.category === 'photo' ? 'photo' : item.category === 'audio' ? 'audio' : 'video')
    : (item.category === 'video' ? 'video' : item.category === 'photo' ? 'photo' : item.category === 'audio' ? 'audio' : 'document');

  let deliveryLabel = t('drive.preflight_bento_delivery_doc');
  if (effectiveDeliveryMode === 'video') {
    deliveryLabel = t('drive.preflight_bento_delivery_stream');
  } else if (effectiveDeliveryMode === 'photo') {
    deliveryLabel = t('drive.preflight_bento_delivery_photo');
  } else if (effectiveDeliveryMode === 'audio') {
    deliveryLabel = t('drive.preflight_bento_delivery_audio');
  }

  // Real-time Album & Packaging Strategy
  const isAlbum = transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum;
  const albumSize = transferSettings?.albumGroupSize ?? DEFAULT_TRANSFER_SETTINGS.albumGroupSize;
  const packingStyle = transferSettings?.albumPacking ?? DEFAULT_TRANSFER_SETTINGS.albumPacking;
  const packagingLabel = isAlbum
    ? packingStyle === 'smart_adaptive'
      ? 'Smart Adaptive'
      : packingStyle === 'balanced'
      ? 'Safe Balanced'
      : packingStyle === 'maximum'
      ? 'Max 10'
      : `Grid ${albumSize}`
    : t('drive.preflight_delivery_single');

  // Real-time Transcode & Re-encode Strategy
  const encoderStrategy = transferSettings?.encoderStrategy ?? DEFAULT_TRANSFER_SETTINGS.encoderStrategy;
  const isNoReencode = encoderStrategy === 'disable_reencode';
  const hwEncoder = transferSettings?.reencodeHardware ?? DEFAULT_TRANSFER_SETTINGS.reencodeHardware;
  const preset = transferSettings?.reencodePreset ?? DEFAULT_TRANSFER_SETTINGS.reencodePreset;

  const transcodeLabel = isNoReencode
    ? t('drive.preflight_transcode_disabled')
    : `${hwEncoder === 'auto' ? 'Auto GPU' : hwEncoder.toUpperCase()} • ${preset}`;

  // Engine Mode Name
  const engineLabel = report.remoteEngineMode === 'cloud_fetch'
    ? 'Zero Quota Cloud Direct'
    : report.remoteEngineMode === 'storage_local'
    ? t('drive_tools.remote_engine_storage_local')
    : 'Smart MTProto V4';

  const uploadWorkers = transferSettings?.uploadConcurrency ?? DEFAULT_TRANSFER_SETTINGS.uploadConcurrency;
  const duplicatePolicy = transferSettings?.duplicatePolicy ?? DEFAULT_TRANSFER_SETTINGS.duplicatePolicy;

  return (
    <div className="td-preflight-info-bento">
      {/* 1. Source & Origin Card */}
      <div className="td-preflight-bento-card is-source">
        <div className="td-preflight-bento-head">
          <div className="td-preflight-bento-icon is-source">
            {isRemoteUrl ? <Globe size={13} aria-hidden /> : isTelegramMigrate ? <Send size={13} aria-hidden /> : <Folder size={13} aria-hidden />}
          </div>
          <span className="td-preflight-bento-label">{t('drive.preflight_bento_source_title')}</span>
          <button
            type="button"
            className={`td-preflight-bento-copy ${copied ? 'is-copied' : ''}`}
            onClick={() => handleCopy(item.sourcePath)}
            title={isRemoteUrl ? t('drive.preflight_bento_copy_url') : t('drive.preflight_bento_copy_path')}
          >
            {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
            <span>{copied ? t('drive.preflight_bento_copied') : (isRemoteUrl ? t('drive.preflight_bento_copy_url') : t('drive.preflight_bento_copy_path'))}</span>
          </button>
        </div>
        <div className="td-preflight-bento-value">
          <div className="td-preflight-bento-tags-row">
            <span className={`td-preflight-bento-tag ${isRemoteUrl ? 'is-remote' : isTelegramMigrate ? 'is-tg' : 'is-local'}`}>
              {sourceTypeBadge}
            </span>
            {domain && <span className="td-preflight-bento-tag is-domain">{domain}</span>}
            {sourceFolder && <span className="td-preflight-bento-tag is-folder">{sourceFolder}</span>}
          </div>
          <span className="td-preflight-bento-text" title={item.sourcePath}>{item.sourcePath}</span>
        </div>
      </div>

      {/* 2. Destination Telegram Card */}
      <div className="td-preflight-bento-card is-dest">
        <div className="td-preflight-bento-head">
          <div className="td-preflight-bento-icon is-dest">
            <Send size={13} aria-hidden />
          </div>
          <span className="td-preflight-bento-label">{t('drive.preflight_bento_dest_title')}</span>
        </div>
        <div className="td-preflight-bento-value">
          <span className="td-preflight-bento-tag is-saved">
            {item.duplicateMatch?.destinationId === 'me' ? 'Saved Messages' : (item.duplicateMatch?.destinationId || 'Saved Messages (Cloud)')}
          </span>
          <span className="td-preflight-bento-subtext">
            {creds?.session ? `${t('drive.session_label', { defaultValue: 'Sesi' })}: ${getSessionDisplayName(creds.session)}` : t('drive.preflight_bento_main_account', { defaultValue: 'Akun Utama • AutoGram MTProto' })}
          </span>
        </div>
      </div>

      {/* 3. Format & Delivery Card */}
      <div className="td-preflight-bento-card is-delivery">
        <div className="td-preflight-bento-head">
          <div className="td-preflight-bento-icon is-delivery">
            <FileCode size={13} aria-hidden />
          </div>
          <span className="td-preflight-bento-label">{t('drive.preflight_bento_delivery_title')}</span>
        </div>
        <div className="td-preflight-bento-value">
          <div className="td-preflight-bento-tags-row">
            <span className="td-preflight-bento-tag is-ext">.{ext ? ext.toUpperCase() : 'FILE'}</span>
            <span className="td-preflight-bento-mime">{mimeType}</span>
            <span className={`td-preflight-bento-tag ${isAlbum ? 'is-album' : 'is-single'}`}>
              {packagingLabel}
            </span>
          </div>
          <span className="td-preflight-bento-subtext">
            {deliveryLabel} • {transcodeLabel}
          </span>
        </div>
      </div>

      {/* 4. Engine & Integrity Card */}
      <div className="td-preflight-bento-card is-integrity">
        <div className="td-preflight-bento-head">
          <div className="td-preflight-bento-icon is-integrity">
            <ShieldCheck size={13} aria-hidden />
          </div>
          <span className="td-preflight-bento-label">{t('drive.preflight_bento_integrity_title')}</span>
        </div>
        <div className="td-preflight-bento-value">
          <div className="td-preflight-bento-tags-row">
            <span className="td-preflight-bento-tag is-engine">{engineLabel}</span>
            <span className="td-preflight-bento-tag is-workers">
              {`↑ ${uploadWorkers} Worker`}
            </span>
          </div>
          <span className="td-preflight-bento-subtext">
            {item.duplicateMatch ? t('drive.preflight_bento_integrity_dup') : t('drive.preflight_bento_integrity_clean')} • {duplicatePolicy === 'SKIP' ? t('drive.preflight_will_skip') : t('drive.preflight_duplicate_badge_force', { defaultValue: 'Paksa' })}
          </span>
        </div>
      </div>
    </div>
  );
}

type Props = {
  report: QualityPreflightReport | null;
  creds: DriveCredentials | null;
  transferSettings?: DriveTransferSettings;
  onTransferSettingsChange?: (next: DriveTransferSettings) => void;
  onConfirm: (decision: PreflightReviewDecision) => void;
  onCancel: () => void;
  onOpenSettings?: (category?: SubMenuCategory) => void;
  hasStackedModal?: boolean;
};

export function TransferPreflightDialog({
  report,
  creds,
  transferSettings,
  onTransferSettingsChange,
  onConfirm,
  onCancel,
  onOpenSettings,
  hasStackedModal,
}: Props) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<Record<string, TransferDuplicateChoice>>({});
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [activePopover, setActivePopover] = useState<
    'transform' | 'clean' | 'album' | 'duplicate' | 'rollback' | 'caption' | 'modes_summary' | null
  >(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'queue' | 'skip' | 'duplicate'>('all');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);

  const handleSettingChange = useCallback(
    (patch: Partial<DriveTransferSettings>) => {
      const base = transferSettings ?? DEFAULT_TRANSFER_SETTINGS;
      const next = { ...base, ...patch };
      onTransferSettingsChange?.(next);
      // Show a brief shimmer to signal recalculation
      setIsReevaluating(true);
      setTimeout(() => setIsReevaluating(false), 800);
    },
    [transferSettings, onTransferSettingsChange]
  );

  useEffect(() => {
    if (report) {
      setChoices(defaultDuplicateChoices(report));
      setIsConfirming(false);
    }
  }, [report]);

  const duplicateCount = useMemo(
    () => report?.items.filter((item) => item.duplicateMatch).length || 0,
    [report]
  );
  const skippedCount = useMemo(
    () => report?.items.filter((item) => choices[item.sourcePath] === 'skip').length || 0,
    [choices, report]
  );
  const queuedCount = Math.max(0, (report?.items.length || 0) - skippedCount);

  const convertCount = useMemo(() => {
    if (typeof report?.transformConvertCount === 'number') return report.transformConvertCount;
    return report?.items.filter((i) => i.transform === 'convert_webp_png').length || 0;
  }, [report]);

  const reencodeCount = useMemo(() => {
    if (typeof report?.transformReencodeCount === 'number') return report.transformReencodeCount;
    return report?.items.filter((i) => i.transform === 'reencode').length || 0;
  }, [report]);

  const handleConfirm = useCallback(async () => {
    if (!report || report.hasBlockingIssues || queuedCount === 0 || isConfirming) return;
    setIsConfirming(true);
    try {
      await Promise.resolve(onConfirm(buildPreflightReviewDecision(report, choices)));
    } catch (err) {
      console.error('Preflight confirm error:', err);
    } finally {
      setIsConfirming(false);
    }
  }, [report, choices, queuedCount, isConfirming, onConfirm]);

  useEffect(() => {
    if (!report) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activePopover) {
          setActivePopover(null);
          e.stopPropagation();
        } else {
          onCancel();
        }
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !activePopover) {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        handleConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [report, activePopover, onCancel, handleConfirm]);

  const filteredItems = useMemo(() => {
    if (!report?.items) return [];
    if (activeFilter === 'queue') {
      return report.items.filter((item) => (choices[item.sourcePath] || 'upload') !== 'skip');
    }
    if (activeFilter === 'skip') {
      return report.items.filter((item) => (choices[item.sourcePath] || 'upload') === 'skip');
    }
    if (activeFilter === 'duplicate') {
      return report.items.filter((item) => !!item.duplicateMatch);
    }
    return report.items;
  }, [report, activeFilter, choices]);

  const [previewItem, setPreviewItem] = useState<QualityPreflightItem | null>(null);

  const previewFile = useMemo<DriveFile | null>(() => {
    if (!previewItem) return null;
    const ext = previewItem.sourceName.split('.').pop()?.toLowerCase() || '';
    const kind =
      previewItem.category === 'video' || /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|ts)($|\?)/i.test(previewItem.sourceName)
        ? 'video'
        : previewItem.category === 'photo' || /\.(jpe?g|png|webp|gif|bmp|heic|avif)($|\?)/i.test(previewItem.sourceName)
        ? 'image'
        : previewItem.category === 'audio' || /\.(mp3|flac|wav|ogg|m4a|aac|opus)($|\?)/i.test(previewItem.sourceName)
        ? 'audio'
        : ext === 'pdf'
        ? 'pdf'
        : ['txt', 'json', 'js', 'ts', 'jsx', 'tsx', 'rs', 'py', 'html', 'css', 'md', 'xml', 'yaml', 'yml', 'toml'].includes(ext)
        ? 'text'
        : 'other';

    return {
      id: 998000000 + previewItem.index,
      folder_id: null,
      name: previewItem.sourceName,
      size: previewItem.sourceSize,
      mime_type: null,
      file_ext: ext,
      icon_type: kind,
      original_name: previewItem.sourceName,
    };
  }, [previewItem]);

  const customPreviewSrc = useMemo(() => {
    if (!previewItem) return null;
    const raw = previewItem.sourcePath || '';
    if (!raw) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return convertFileSrc(raw);
  }, [previewItem]);

  const currentPreviewIndex = useMemo(() => {
    if (!previewItem) return -1;
    return filteredItems.findIndex((it) => it.sourcePath === previewItem.sourcePath);
  }, [previewItem, filteredItems]);

  const hasPrevPreview = currentPreviewIndex > 0;
  const hasNextPreview = currentPreviewIndex >= 0 && currentPreviewIndex < filteredItems.length - 1;

  const handlePrevPreview = useCallback(() => {
    if (hasPrevPreview) {
      setPreviewItem(filteredItems[currentPreviewIndex - 1]);
    }
  }, [hasPrevPreview, currentPreviewIndex, filteredItems]);

  const handleNextPreview = useCallback(() => {
    if (hasNextPreview) {
      setPreviewItem(filteredItems[currentPreviewIndex + 1]);
    }
  }, [hasNextPreview, currentPreviewIndex, filteredItems]);

  if (!report || typeof document === 'undefined') return null;

  const visibleItems = filteredItems.slice(0, 100);
  const hiddenCount = Math.max(0, filteredItems.length - visibleItems.length);
  const setChoice = (path: string, choice: TransferDuplicateChoice) => {
    setChoices((current) => ({ ...current, [path]: choice }));
  };
  const setAllDuplicates = (choice: TransferDuplicateChoice) => {
    setChoices((current) => {
      const next = { ...current };
      report.items.forEach((item) => {
        if (item.duplicateMatch) next[item.sourcePath] = choice;
      });
      return next;
    });
  };
  const toggleTechDetails = (path: string) => {
    setExpandedDetails((current) => ({ ...current, [path]: !current[path] }));
  };

  const node = (
    <>
      <div className={`td-preflight-overlay ${hasStackedModal ? 'has-stacked-modal' : ''}`} role="presentation">
      <section className="td-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-preflight-title">
        <header className="td-preflight-head">
          <div className="td-preflight-head-main">
            <div className="td-preflight-head-icon">
              <FileSearch size={18} aria-hidden />
            </div>
            <div className="td-preflight-head-text">
              <h2 id="transfer-preflight-title">{t('drive.preflight_title')}</h2>
              <p>{t('drive.preflight_review_help')}</p>
            </div>
          </div>
          <button type="button" className="td-icon-btn" onClick={onCancel} aria-label={t('drive.topbar_cancel')}>
            <X size={18} />
          </button>
        </header>

        <div className="td-preflight-overview" role="status">
          <div className="td-preflight-overview-stats" role="tablist" aria-label="Preflight item filter">
            <button
              type="button"
              role="tab"
              aria-selected={activeFilter === 'all'}
              aria-pressed={activeFilter === 'all'}
              className={`td-preflight-stat-pill is-filter ${activeFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setActiveFilter('all')}
              title={t('drive.preflight_filter_all', { count: report.items.length })}
            >
              <span>{t('drive.preflight_filter_all_label')}</span>
              <span className="td-preflight-pill-count">{report.items.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeFilter === 'queue'}
              aria-pressed={activeFilter === 'queue'}
              className={`td-preflight-stat-pill is-queue is-filter ${activeFilter === 'queue' ? 'is-active' : ''}`}
              onClick={() => setActiveFilter((prev) => (prev === 'queue' ? 'all' : 'queue'))}
              title={t('drive.preflight_filter_queue', { count: queuedCount })}
            >
              <Check size={11} aria-hidden />
              <span>{t('drive.preflight_filter_queue_label')}</span>
              <span className="td-preflight-pill-count">{queuedCount}</span>
            </button>
            {skippedCount > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={activeFilter === 'skip'}
                aria-pressed={activeFilter === 'skip'}
                className={`td-preflight-stat-pill is-skip is-filter ${activeFilter === 'skip' ? 'is-active' : ''}`}
                onClick={() => setActiveFilter((prev) => (prev === 'skip' ? 'all' : 'skip'))}
                title={t('drive.preflight_filter_skip', { count: skippedCount })}
              >
                <X size={11} aria-hidden />
                <span>{t('drive.preflight_filter_skip_label')}</span>
                <span className="td-preflight-pill-count">{skippedCount}</span>
              </button>
            )}
            {duplicateCount > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={activeFilter === 'duplicate'}
                aria-pressed={activeFilter === 'duplicate'}
                className={`td-preflight-stat-pill is-duplicate is-filter ${activeFilter === 'duplicate' ? 'is-active' : ''}`}
                onClick={() => setActiveFilter((prev) => (prev === 'duplicate' ? 'all' : 'duplicate'))}
                title={t('drive.preflight_filter_duplicate', { count: duplicateCount })}
              >
                <CopyCheck size={11} aria-hidden />
                <span>{t('drive.preflight_filter_duplicate_label')}</span>
                <span className="td-preflight-pill-count">{duplicateCount}</span>
              </button>
            )}
          </div>
          <div className="td-preflight-limit">
            <span>{t('drive.preflight_limit', { value: formatDriveBytes(report.effectiveMaxBytes) })}</span>
            <span className="td-preflight-limit-sep">•</span>
            <span>{t('drive.preflight_caption_limit', { count: report.captionLimit })}</span>
          </div>
        </div>

        {(convertCount > 0 || reencodeCount > 0) && (
          <div className="td-preflight-banner is-transform" role="status">
            <div className="td-preflight-banner-left">
              <div className="td-preflight-banner-icon">
                <RefreshCw size={13} aria-hidden />
              </div>
              <span className="td-preflight-banner-text">
                {convertCount > 0 && reencodeCount > 0
                  ? t('drive.preflight_transform_banner_summary', { convertCount, reencodeCount })
                  : convertCount > 0
                  ? t('drive.preflight_transform_banner_convert', { convertCount })
                  : t('drive.preflight_transform_banner_reencode', { reencodeCount })}
              </span>
            </div>
            <button
              type="button"
              className={`td-preflight-info-btn ${activePopover === 'transform' ? 'is-active' : ''}`}
              onClick={() => setActivePopover(activePopover === 'transform' ? null : 'transform')}
              aria-label={t('drive.preflight_info_button')}
              title={t('drive.preflight_info_button')}
            >
              <Info size={12} aria-hidden />
            </button>
          </div>
        )}

        {/* Real-time Album Partition Summary Banner */}
        {(transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum) && (() => {
          const eligibleItems = report.items.filter((it) => it.albumEligible);
          if (eligibleItems.length <= 1) return null;

          const videoCount = eligibleItems.filter((it) => it.category === 'video' || /\.(mp4|mkv|mov|webm|avi|wmv|ts|flv|3gp)/i.test(it.sourceName)).length;
          const photoCount = eligibleItems.length - videoCount;
          const mediaType = videoCount > 0 && photoCount === 0 ? 'video' : photoCount > 0 && videoCount === 0 ? 'photo' : 'mixed';
          const strategy = transferSettings?.albumPacking || DEFAULT_TRANSFER_SETTINGS.albumPacking;
          const customSize = transferSettings?.albumGroupSize || DEFAULT_TRANSFER_SETTINGS.albumGroupSize;
          const avoidSingle = transferSettings?.albumAvoidSingle ?? DEFAULT_TRANSFER_SETTINGS.albumAvoidSingle;
          const partition = calculateAlbumPartition(eligibleItems.length, strategy, mediaType === 'mixed' ? 'video' : mediaType, customSize, avoidSingle);
          const fullCollages = partition.sizes.filter((s) => s > 1).length;
          const stratName = strategy === 'smart_adaptive'
            ? t('drive.album_strategy_smart_adaptive')
            : strategy === 'balanced'
            ? t('drive.album_strategy_safe_balanced')
            : strategy === 'maximum'
            ? t('drive.album_strategy_maximum')
            : t('drive.album_strategy_custom');

          const typeLabel = mediaType === 'mixed'
            ? `${t('drive.album_type_media_visual')} ${t('drive.album_type_composition', { photos: photoCount, videos: videoCount })}`
            : mediaType === 'video'
            ? t('drive.album_simulator_type_video')
            : t('drive.album_simulator_type_photo');

          return (
            <div
              className="td-preflight-banner"
              style={{
                background: partition.isSafe ? 'rgba(56, 189, 248, 0.1)' : 'rgba(245, 158, 11, 0.12)',
                border: partition.isSafe ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(245, 158, 11, 0.35)',
                color: '#f8fafc',
                padding: '10px 14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                marginBottom: '10px',
              }}
              role="status"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={14} style={{ color: partition.isSafe ? '#38bdf8' : '#f59e0b', flexShrink: 0 }} />
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                  {t('drive.album_preflight_plan_summary', {
                    count: eligibleItems.length,
                    type: typeLabel,
                    groups: fullCollages,
                    partition: partition.sizes.join(' + '),
                    strategy: stratName,
                  })}
                </span>
              </div>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: partition.isSafe ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                  color: partition.isSafe ? '#34d399' : '#fbbf24',
                  whiteSpace: 'nowrap',
                }}
              >
                {partition.isSafe ? t('drive.album_strategy_smart_badge') : t('drive.album_strategy_maximum_warning')}
              </span>
            </div>
          );
        })()}

        {duplicateCount === 0 ? (
          <div className="td-preflight-banner is-clean" role="status">
            <div className="td-preflight-banner-left">
              <div className="td-preflight-banner-icon">
                <CheckCircle2 size={14} className="td-clean-icon" aria-hidden />
              </div>
              <span className="td-preflight-banner-text">
                {t('drive.preflight_all_clean_banner')}
                {report.albumIsProvisional && report.plannedAlbumSizes.length > 0 && (
                  <span className="td-preflight-sub-hint">
                    {' '}• {t('drive.preflight_album_grid_plan', {
                      size: report.albumGridSize,
                      groups: report.plannedAlbumSizes.join(' + '),
                    })}
                  </span>
                )}
              </span>
            </div>
            <button
              type="button"
              className={`td-preflight-info-btn ${activePopover === (report.albumIsProvisional ? 'album' : 'clean') ? 'is-active' : ''}`}
              onClick={() =>
                setActivePopover(
                  activePopover === (report.albumIsProvisional ? 'album' : 'clean')
                    ? null
                    : report.albumIsProvisional
                    ? 'album'
                    : 'clean',
                )
              }
              aria-label={t('drive.preflight_info_button')}
              title={t('drive.preflight_info_button')}
            >
              <Info size={12} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="td-preflight-banner is-duplicate" role="status">
            <div className="td-preflight-banner-left">
              <div className="td-preflight-banner-icon">
                <CopyCheck size={14} aria-hidden />
              </div>
              <span className="td-preflight-banner-text">
                {t('drive.preflight_duplicate_detected_short', { count: duplicateCount })}
              </span>
            </div>
            <div className="td-preflight-banner-actions">
              <button type="button" className="td-banner-pill-btn" onClick={() => setAllDuplicates('skip')}>
                {t('drive.preflight_skip_all_duplicates')}
              </button>
              <button type="button" className="td-banner-pill-btn" onClick={() => setAllDuplicates('upload')}>
                {t('drive.preflight_send_all_duplicates')}
              </button>
              <button
                type="button"
                className={`td-preflight-info-btn ${activePopover === 'duplicate' ? 'is-active' : ''}`}
                onClick={() => setActivePopover(activePopover === 'duplicate' ? null : 'duplicate')}
                aria-label={t('drive.preflight_info_button')}
                title={t('drive.preflight_info_button')}
              >
                <Info size={12} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {report.engineMode === 'safe_rollback' && (
          <div className="td-preflight-banner is-warning" role="status">
            <div className="td-preflight-banner-left">
              <div className="td-preflight-banner-icon">
                <AlertTriangle size={13} aria-hidden />
              </div>
              <span className="td-preflight-banner-text">
                {t('drive.preflight_safe_rollback')}
              </span>
            </div>
            <button
              type="button"
              className={`td-preflight-info-btn ${activePopover === 'rollback' ? 'is-active' : ''}`}
              onClick={() => setActivePopover(activePopover === 'rollback' ? null : 'rollback')}
              aria-label={t('drive.preflight_info_button')}
              title={t('drive.preflight_info_button')}
            >
              <Info size={12} aria-hidden />
            </button>
          </div>
        )}

        {activePopover && (
          <div className="td-preflight-popover-overlay" onClick={() => setActivePopover(null)}>
            <div
              className={`td-preflight-popover-card ${activePopover === 'modes_summary' ? 'is-modes-card' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="td-preflight-popover-head">
                <div className="td-preflight-popover-title-row">
                  <div className={`td-preflight-popover-icon ${activePopover === 'modes_summary' ? 'is-modes' : ''}`}>
                    {activePopover === 'modes_summary' ? (
                      <Sliders size={15} aria-hidden />
                    ) : (
                      <Info size={15} aria-hidden />
                    )}
                  </div>
                  <strong>
                    {activePopover === 'modes_summary' && t('drive.preflight_modes_modal_title')}
                    {activePopover === 'transform' && t('drive.preflight_info_title_transform')}
                    {activePopover === 'clean' && t('drive.preflight_info_title_clean')}
                    {activePopover === 'album' && t('drive.preflight_info_title_album')}
                    {activePopover === 'duplicate' && t('drive.preflight_info_title_duplicate')}
                    {activePopover === 'rollback' && t('drive.preflight_info_title_rollback')}
                    {activePopover === 'caption' && t('drive.preflight_info_title_caption')}
                  </strong>
                </div>
                <button type="button" className="td-icon-btn" onClick={() => setActivePopover(null)} aria-label="Close">
                  <X size={15} />
                </button>
              </div>

              {activePopover === 'modes_summary' ? (
                <div className="td-preflight-popover-body is-modes-body">
                  {/* Recalculating shimmer banner */}
                  {isReevaluating && (
                    <div className="td-preflight-modes-recalc-banner">
                      <Loader2 size={12} className="td-preflight-modes-recalc-spin" aria-hidden />
                      <span>{t('drive.preflight_modes_recalculating')}</span>
                    </div>
                  )}

                  <div className="td-preflight-modes-grid-6">

                    {/* Card 1: Video Encoding & Acceleration (tab: encoding) */}
                    <div className="td-preflight-mode-card-6">
                      <div className="td-preflight-mode6-header">
                        <div className="td-preflight-mode6-icon is-encoding">
                          <Cpu size={12} aria-hidden />
                        </div>
                        <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_encoding_title')}</span>
                        <button
                          type="button"
                          className="td-preflight-mode-deeplink"
                          onClick={() => onOpenSettings?.('encoding')}
                          title={t('drive.preflight_modes_configure_link')}
                        >
                          <ExternalLink size={11} aria-hidden />
                        </button>
                      </div>
                      <div className="td-preflight-mode6-toggle-row">
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.encoderStrategy ?? DEFAULT_TRANSFER_SETTINGS.encoderStrategy) !== 'disable_reencode' ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ encoderStrategy: 'auto_adaptive' })}
                        >
                          {t('drive.preflight_modes_opt_gpu_auto')}
                        </button>
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.encoderStrategy ?? DEFAULT_TRANSFER_SETTINGS.encoderStrategy) === 'disable_reencode' ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ encoderStrategy: 'disable_reencode' })}
                        >
                          {t('drive.preflight_modes_opt_no_reencode')}
                        </button>
                      </div>
                      <span className="td-preflight-mode6-badge is-encoding">
                        {(transferSettings?.encoderStrategy ?? DEFAULT_TRANSFER_SETTINGS.encoderStrategy) === 'disable_reencode'
                          ? 'No Re-encode'
                          : (transferSettings?.reencodeHardware ?? DEFAULT_TRANSFER_SETTINGS.reencodeHardware)}
                        {' · '}
                        {(transferSettings?.reencodePreset ?? DEFAULT_TRANSFER_SETTINGS.reencodePreset)}
                      </span>
                    </div>

                    {/* Card 2: Delivery Format (tab: upload) */}
                    <div className="td-preflight-mode-card-6">
                      <div className="td-preflight-mode6-header">
                        <div className="td-preflight-mode6-icon is-delivery">
                          <Film size={12} aria-hidden />
                        </div>
                        <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_delivery_title')}</span>
                        <button
                          type="button"
                          className="td-preflight-mode-deeplink"
                          onClick={() => onOpenSettings?.('upload')}
                          title={t('drive.preflight_modes_configure_link')}
                        >
                          <ExternalLink size={11} aria-hidden />
                        </button>
                      </div>
                      <div className="td-preflight-mode6-toggle-row">
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${!(transferSettings?.forceDocumentDefault ?? DEFAULT_TRANSFER_SETTINGS.forceDocumentDefault) ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ forceDocumentDefault: false })}
                        >
                          {t('drive.preflight_modes_opt_visual_stream')}
                        </button>
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.forceDocumentDefault ?? DEFAULT_TRANSFER_SETTINGS.forceDocumentDefault) ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ forceDocumentDefault: true })}
                        >
                          {t('drive.preflight_modes_opt_raw_document')}
                        </button>
                      </div>
                      <span className="td-preflight-mode6-badge is-delivery">
                        {transferSettings?.qualityMode ?? DEFAULT_TRANSFER_SETTINGS.qualityMode}
                      </span>
                    </div>

                    {/* Card 3: Album Grid Packaging (tab: albums) */}
                    <div className="td-preflight-mode-card-6">
                      <div className="td-preflight-mode6-header">
                        <div className="td-preflight-mode6-icon is-album">
                          <Layers size={12} aria-hidden />
                        </div>
                        <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_album_title')}</span>
                        <button
                          type="button"
                          className="td-preflight-mode-deeplink"
                          onClick={() => onOpenSettings?.('albums')}
                          title={t('drive.preflight_modes_configure_link')}
                        >
                          <ExternalLink size={11} aria-hidden />
                        </button>
                      </div>
                      <div className="td-preflight-mode6-toggle-row">
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum) ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ groupAsAlbum: true })}
                        >
                          {t('drive.preflight_modes_opt_album_grid', { size: transferSettings?.albumGroupSize ?? DEFAULT_TRANSFER_SETTINGS.albumGroupSize })}
                        </button>
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${!(transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum) ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ groupAsAlbum: false })}
                        >
                          {t('drive.preflight_modes_opt_album_separate')}
                        </button>
                      </div>
                      <span className="td-preflight-mode6-badge is-album">
                        {(transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum)
                          ? `Grid ${transferSettings?.albumGroupSize ?? DEFAULT_TRANSFER_SETTINGS.albumGroupSize} · ${transferSettings?.albumPacking ?? DEFAULT_TRANSFER_SETTINGS.albumPacking}`
                          : 'Individual Files'}
                      </span>
                    </div>

                    {/* Card 4: Duplicate Prevention (tab: duplicates) */}
                    <div className="td-preflight-mode-card-6">
                      <div className="td-preflight-mode6-header">
                        <div className="td-preflight-mode6-icon is-safety">
                          <ShieldCheck size={12} aria-hidden />
                        </div>
                        <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_duplicate_title')}</span>
                        <button
                          type="button"
                          className="td-preflight-mode-deeplink"
                          onClick={() => onOpenSettings?.('duplicates')}
                          title={t('drive.preflight_modes_configure_link')}
                        >
                          <ExternalLink size={11} aria-hidden />
                        </button>
                      </div>
                      <div className="td-preflight-mode6-toggle-row">
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.duplicatePolicy ?? DEFAULT_TRANSFER_SETTINGS.duplicatePolicy) === 'SKIP' ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ duplicatePolicy: 'SKIP' })}
                        >
                          {t('drive.preflight_modes_opt_dup_skip')}
                        </button>
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.duplicatePolicy ?? DEFAULT_TRANSFER_SETTINGS.duplicatePolicy) === 'FORCE_UPLOAD' ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ duplicatePolicy: 'FORCE_UPLOAD' })}
                        >
                          {t('drive.preflight_modes_opt_dup_force')}
                        </button>
                      </div>
                      <span className="td-preflight-mode6-badge is-safety">
                        {t('drive.preflight_duplicate_4level')}
                        {' · '}
                        {transferSettings?.scanMode ?? DEFAULT_TRANSFER_SETTINGS.scanMode}
                      </span>
                    </div>

                    {/* Card 5: Network & Concurrency (tab: network) */}
                    <div className="td-preflight-mode-card-6">
                      <div className="td-preflight-mode6-header">
                        <div className="td-preflight-mode6-icon is-network">
                          <Network size={12} aria-hidden />
                        </div>
                        <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_network_title')}</span>
                        <button
                          type="button"
                          className="td-preflight-mode-deeplink"
                          onClick={() => onOpenSettings?.('network')}
                          title={t('drive.preflight_modes_configure_link')}
                        >
                          <ExternalLink size={11} aria-hidden />
                        </button>
                      </div>
                      <div className="td-preflight-mode6-info-row">
                        <span className="td-preflight-mode6-badge is-network">
                          {t('drive.preflight_modes_workers_badge', { count: transferSettings?.uploadConcurrency ?? DEFAULT_TRANSFER_SETTINGS.uploadConcurrency })}
                        </span>
                        <span className="td-preflight-mode6-badge is-network-alt">
                          {t('drive.preflight_modes_floodwait_badge')}
                        </span>
                      </div>
                      <span className="td-preflight-mode6-subtext">
                        {`↑ ${transferSettings?.uploadConcurrency ?? DEFAULT_TRANSFER_SETTINGS.uploadConcurrency} · ↓ ${transferSettings?.downloadConcurrency ?? DEFAULT_TRANSFER_SETTINGS.downloadConcurrency} · max ${transferSettings?.maxReuploadPerHour ?? DEFAULT_TRANSFER_SETTINGS.maxReuploadPerHour}/h`}
                      </span>
                    </div>

                    {/* Card 6: Caption & Limits (tab: limits_recovery) */}
                    <div className="td-preflight-mode-card-6">
                      <div className="td-preflight-mode6-header">
                        <div className="td-preflight-mode6-icon is-caption">
                          <MessageSquare size={12} aria-hidden />
                        </div>
                        <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_caption_title')}</span>
                        <button
                          type="button"
                          className="td-preflight-mode-deeplink"
                          onClick={() => onOpenSettings?.('limits_recovery')}
                          title={t('drive.preflight_modes_configure_link')}
                        >
                          <ExternalLink size={11} aria-hidden />
                        </button>
                      </div>
                      <div className="td-preflight-mode6-toggle-row">
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.captionOverflowPolicy ?? DEFAULT_TRANSFER_SETTINGS.captionOverflowPolicy) === 'truncate_with_warning' ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ captionOverflowPolicy: 'truncate_with_warning' })}
                        >
                          {t('drive.preflight_modes_caption_truncate_opt')}
                        </button>
                        <button
                          type="button"
                          className={`td-preflight-mode6-pill ${(transferSettings?.captionOverflowPolicy ?? DEFAULT_TRANSFER_SETTINGS.captionOverflowPolicy) === 'split' ? 'is-active' : ''}`}
                          onClick={() => handleSettingChange({ captionOverflowPolicy: 'split' })}
                        >
                          {t('drive.preflight_modes_caption_split_opt')}
                        </button>
                      </div>
                      <span className="td-preflight-mode6-badge is-caption">
                        {t('drive.preflight_modes_caption_limit_badge', { count: 1024 })}
                        {' · '}
                        {transferSettings?.captionParseMode ?? DEFAULT_TRANSFER_SETTINGS.captionParseMode}
                      </span>
                    </div>

                  </div>

                  {/* Reset to Defaults */}
                  <div className="td-preflight-modes-footer">
                    <button
                      type="button"
                      className="td-preflight-modes-reset-btn"
                      onClick={() => onTransferSettingsChange?.(DEFAULT_TRANSFER_SETTINGS)}
                    >
                      <RotateCcw size={12} aria-hidden />
                      <span>{t('drive.preflight_modes_reset_defaults')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="td-preflight-popover-body">
                  <div className="td-preflight-popover-section">
                    <span className="td-preflight-popover-label">{t('drive.preflight_popover_section_location')}</span>
                    <div className="td-preflight-popover-pill">
                      <Settings size={12} aria-hidden />
                      <span>
                        {activePopover === 'transform' && t('drive.preflight_info_loc_transform')}
                        {activePopover === 'clean' && t('drive.preflight_info_loc_clean')}
                        {activePopover === 'album' && t('drive.preflight_info_loc_album')}
                        {activePopover === 'duplicate' && t('drive.preflight_info_loc_duplicate')}
                        {activePopover === 'rollback' && t('drive.preflight_info_loc_rollback')}
                        {activePopover === 'caption' && t('drive.preflight_info_loc_caption')}
                      </span>
                    </div>
                  </div>
                  <div className="td-preflight-popover-section">
                    <span className="td-preflight-popover-label">{t('drive.preflight_popover_section_analysis')}</span>
                    <p className="td-preflight-popover-desc">
                      {activePopover === 'transform' && t('drive.preflight_info_desc_transform')}
                      {activePopover === 'clean' && t('drive.preflight_info_desc_clean')}
                      {activePopover === 'album' && t('drive.preflight_info_desc_album')}
                      {activePopover === 'duplicate' && t('drive.preflight_info_desc_duplicate')}
                      {activePopover === 'rollback' && t('drive.preflight_info_desc_rollback')}
                      {activePopover === 'caption' && t('drive.preflight_info_desc_caption')}
                    </p>
                  </div>
                  <div className="td-preflight-popover-section">
                    <span className="td-preflight-popover-label">{t('drive.preflight_popover_section_adjust')}</span>
                    <p className="td-preflight-popover-disable">
                      {activePopover === 'transform' && t('drive.preflight_info_disable_transform')}
                      {activePopover === 'clean' && t('drive.preflight_info_disable_clean')}
                      {activePopover === 'album' && t('drive.preflight_info_disable_album')}
                      {activePopover === 'duplicate' && t('drive.preflight_info_disable_duplicate')}
                      {activePopover === 'rollback' && t('drive.preflight_info_disable_rollback')}
                      {activePopover === 'caption' && t('drive.preflight_info_disable_caption')}
                    </p>
                  </div>
                </div>
              )}

              {onOpenSettings && (
                <div className="td-preflight-popover-foot">
                  <button
                    type="button"
                    className="td-btn-primary td-preflight-popover-btn"
                    onClick={() => {
                      setActivePopover(null);
                      onOpenSettings();
                    }}
                  >
                    <Settings size={14} aria-hidden />
                    <span>{t('drive.preflight_info_open_settings')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="td-preflight-items">
          {visibleItems.length === 0 ? (
            <div className="td-preflight-empty-filter">
              <p>{t('drive.preflight_filter_empty')}</p>
              <button
                type="button"
                className="td-chip-btn"
                onClick={() => setActiveFilter('all')}
              >
                {t('drive.preflight_filter_all', { count: report.items.length })}
              </button>
            </div>
          ) : (
            visibleItems.map((item) => {
              const duplicate = item.duplicateMatch;
              const choice = choices[item.sourcePath] || 'upload';
              const isExpanded = expandedDetails[item.sourcePath] || false;
              return (
                <article
                  className={`td-preflight-item ${duplicate ? 'is-duplicate' : 'is-clean-item'} ${choice === 'skip' ? 'is-skipped' : 'is-included'}`}
                  key={`${item.index}-${item.sourcePath}`}
                >
                  <div className="td-preflight-card-main">
                    {/* Left: Thumbnail container with index number */}
                    <div className="td-preflight-thumb-wrap">
                      <div
                        className="td-preflight-thumb is-clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => setPreviewItem(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPreviewItem(item);
                          }
                        }}
                        title={t('drive.preflight_click_to_preview')}
                        aria-label={`${item.sourceName} - ${t('drive.preflight_click_to_preview')}`}
                      >
                        <PreflightSourceThumb item={item} />
                      </div>
                      <span className="td-preflight-index-pill">{item.index + 1}</span>
                    </div>

                    {/* Center: File Title, Size, and Glow Badges */}
                    <div className="td-preflight-card-body">
                      <div className="td-preflight-title-row">
                        <span className="td-preflight-card-title" title={item.sourceName}>{item.sourceName}</span>
                        <span className="td-preflight-card-size">{formatDriveBytes(item.sourceSize)}</span>
                      </div>

                      <div className="td-preflight-tags-row">
                        {duplicate ? (
                          <>
                            <span className="td-preflight-status-badge is-duplicate">
                              <CopyCheck size={11} aria-hidden />
                              <span>{t('drive.preflight_badge_duplicate')}</span>
                            </span>
                            <span className={`td-preflight-match-badge ${duplicate.matchLevel === 'exact_sha256' ? 'is-exact' : ''}`}>
                              <span>{t(`drive.preflight_match_${duplicate.matchLevel}`)}</span>
                            </span>
                            {choice === 'skip' ? (
                              <span className="td-preflight-status-badge is-skipped">
                                <X size={11} aria-hidden />
                                <span>{t('drive.preflight_badge_skipped')}</span>
                              </span>
                            ) : (
                              <span className="td-preflight-status-badge is-forced">
                                <Send size={10} aria-hidden />
                                <span>{t('drive.preflight_badge_force_upload')}</span>
                              </span>
                            )}
                          </>
                        ) : choice === 'skip' ? (
                          <span className="td-preflight-status-badge is-skipped">
                            <X size={11} aria-hidden />
                            <span>{t('drive.preflight_badge_skipped')}</span>
                          </span>
                        ) : (
                          <span className="td-preflight-status-badge is-ready">
                            <CheckCircle2 size={11} aria-hidden />
                            <span>{t('drive.preflight_ready_badge')}</span>
                          </span>
                        )}

                        {/* Engine Mode Pill Badge: Modern Glowing Glass Pill */}
                        {(item.sourcePath.startsWith('http://') || item.sourcePath.startsWith('https://')) && (
                          ((report.remoteEngineMode as RemoteEngineMode | undefined) === 'cloud_fetch' ||
                            (report.remoteEngineMode === undefined && item.sourceSize > 0 && item.sourceSize <= 20 * 1024 * 1024)) ? (
                            <span className="td-preflight-engine-tag is-cloud-fetch">
                              <Sparkles size={10} aria-hidden />
                              <span>{t('drive_tools.remote_zero_quota_badge')}</span>
                            </span>
                          ) : (
                            <span className="td-preflight-engine-tag is-storage-local">
                              <HardDrive size={10} aria-hidden />
                              <span>{t('drive_tools.remote_engine_storage_local')}</span>
                            </span>
                          )
                        )}

                        {item.transform === 'convert_webp_png' && (
                          <span className="td-preflight-transform-tag is-convert">
                            <RefreshCw size={10} aria-hidden />
                            <span>{t('drive.preflight_transform_badge_convert_webp_png')}</span>
                          </span>
                        )}
                        {item.transform === 'reencode' && (
                          <span className="td-preflight-transform-tag is-reencode">
                            <Video size={10} aria-hidden />
                            <span>{t('drive.preflight_transform_badge_reencode_video')}</span>
                          </span>
                        )}

                        {!duplicate && (
                          <button
                            type="button"
                            className="td-preflight-details-toggle"
                            onClick={() => toggleTechDetails(item.sourcePath)}
                            aria-expanded={isExpanded}
                          >
                            <span>{isExpanded ? t('drive.preflight_hide_details') : t('drive.preflight_toggle_details')}</span>
                            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                        )}
                      </div>
                    </div>

                  {/* Right: Decision action buttons */}
                  <div className="td-preflight-card-actions">
                    <button
                      type="button"
                      className={`td-preflight-choice is-skip ${choice === 'skip' ? 'is-selected' : ''}`}
                      onClick={() => setChoice(item.sourcePath, 'skip')}
                      aria-pressed={choice === 'skip'}
                    >
                      {choice === 'skip' && <Check size={13} aria-hidden />}
                      <span>{t('drive.preflight_skip_item')}</span>
                    </button>
                    <button
                      type="button"
                      className={`td-preflight-choice is-upload ${choice === 'upload' ? 'is-selected' : ''}`}
                      onClick={() => setChoice(item.sourcePath, 'upload')}
                      aria-pressed={choice === 'upload'}
                    >
                      <Send size={13} aria-hidden />
                      <span>{duplicate ? t('drive.preflight_send_anyway') : t('drive.preflight_include_item')}</span>
                    </button>
                  </div>
                </div>

                {/* Duplicate comparison grid if item is duplicate */}
                {duplicate && (
                  <div className="td-preflight-compare-grid">
                    <section>
                      <span className="td-preflight-compare-label">{t('drive.preflight_source_file')}</span>
                      <div className="td-preflight-compare-media">
                        <PreflightSourceThumb item={item} />
                      </div>
                      <strong title={item.sourceName}>{item.sourceName}</strong>
                      <span>{formatDriveBytes(item.sourceSize)}</span>
                    </section>
                    <div className="td-preflight-compare-link" aria-hidden><CopyCheck size={18} /></div>
                    <section>
                      <span className="td-preflight-compare-label">{t('drive.preflight_existing_telegram')}</span>
                      <TelegramDuplicateThumb match={duplicate} creds={creds} />
                      <strong title={duplicate.existingName}>{duplicate.existingName}</strong>
                      <span>
                        {formatDriveBytes(duplicate.existingSize)} · {t('drive.preflight_message_id', { id: duplicate.telegramMessageId ?? '?' })}
                      </span>
                    </section>
                  </div>
                )}

                {/* Expandable transfer info bento */}
                {isExpanded && !duplicate && (
                  <PreflightTransferInfoBento
                    item={item}
                    report={report}
                    creds={creds}
                    transferSettings={transferSettings}
                  />
                )}
              </article>
            );
          }))}
          {hiddenCount > 0 && <p className="td-xfer-hint">{t('drive.preflight_more_items', { count: hiddenCount })}</p>}
        </div>

        <footer className="td-preflight-foot">
          <div className="td-preflight-foot-left">
            {onOpenSettings && (
              <button
                type="button"
                className="td-chip-btn"
                onClick={() => onOpenSettings()}
                title={t('drive.preflight_drive_settings_title')}
              >
                <Settings size={13} aria-hidden style={{ marginRight: 4 }} />
                <span>{t('drive.preflight_drive_settings')}</span>
              </button>
            )}
            <button type="button" className="td-chip-btn" onClick={onCancel}>{t('drive.topbar_cancel')}</button>
          </div>
          <div className="td-preflight-foot-right">
            <button
              type="button"
              className={`td-preflight-modes-btn ${activePopover === 'modes_summary' ? 'is-active' : ''}`}
              onClick={() => setActivePopover((prev) => (prev === 'modes_summary' ? null : 'modes_summary'))}
              title={t('drive.preflight_view_modes_title')}
              aria-expanded={activePopover === 'modes_summary'}
            >
              <Sliders size={13} aria-hidden />
              <span>{t('drive.preflight_active_modes_btn')}</span>
            </button>
            <button
              type="button"
              className={`td-btn-primary td-preflight-confirm-btn ${isConfirming ? 'is-loading' : ''}`}
              onClick={handleConfirm}
              disabled={report.hasBlockingIssues || queuedCount === 0 || isConfirming}
            >
              {isConfirming ? (
                <Loader2 size={14} className="td-spin" aria-hidden />
              ) : (
                <Send size={14} aria-hidden />
              )}
              <span>{t('drive.preflight_confirm_selection', { queue: queuedCount, skip: skippedCount })}</span>
            </button>
          </div>
        </footer>
      </section>
    </div>

    {previewItem && previewFile && (
      <DrivePreviewModal
        file={previewFile}
        folderId={null}
        creds={creds || { session: '', apiId: '0', apiHash: '' }}
        onClose={() => setPreviewItem(null)}
        hasPrev={hasPrevPreview}
        hasNext={hasNextPreview}
        onPrev={hasPrevPreview ? handlePrevPreview : undefined}
        onNext={hasNextPreview ? handleNextPreview : undefined}
        customSource={{
          src: customPreviewSrc,
          kind: previewFile.icon_type as any,
          loading: false,
          error: null,
          indexCounter:
            filteredItems.length > 1 && currentPreviewIndex >= 0
              ? { current: currentPreviewIndex + 1, total: filteredItems.length }
              : undefined,
        }}
      />
    )}
  </>
  );

  return createPortal(node, document.body);
}
