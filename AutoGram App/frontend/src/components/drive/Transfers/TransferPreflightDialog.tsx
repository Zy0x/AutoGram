import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CopyCheck,
  FileSearch,
  FileText,
  Film,
  HardDrive,
  Image as ImageIcon,
  ImageOff,
  Info,
  Loader2,
  Music,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requestThumb } from '../../../lib/media/thumbBatcher';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
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
import type { RemoteEngineMode } from '../../../lib/telegram/driveTypes';

function transferPreviewSource(path: string, thumbnailUrl?: string | null): string | null {
  if (thumbnailUrl && (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://') || thumbnailUrl.startsWith('data:'))) {
    return thumbnailUrl;
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    if (path.match(/\.(jpe?g|png|webp|gif)($|\?)/i)) {
      return path;
    }
    return null;
  }
  return convertFileSrc(path);
}

function PreflightSourceThumb({
  item,
}: {
  item: QualityPreflightItem;
}) {
  const { t } = useTranslation();
  const [capturedThumb, setCapturedThumb] = useState<string | null>(null);

  const initialSource = transferPreviewSource(item.sourcePath, item.thumbnailUrl);
  const isVideo =
    item.category === 'video' ||
    /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|ts)($|\?)/i.test(item.sourceName || item.sourcePath);

  useEffect(() => {
    if (initialSource || !isVideo) return;
    const rawPath = item.sourcePath;
    if (!rawPath) return;

    let active = true;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const cleanup = () => {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignore */
      }
    };

    const handleSeeked = () => {
      try {
        if (!active) return;
        const width = video.videoWidth || 320;
        const height = video.videoHeight || 180;
        if (width <= 0 || height <= 0) return;
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(320, width);
        canvas.height = Math.round((canvas.width * height) / width);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          let isNonBlack = false;
          for (let i = 0; i < data.length; i += 16) {
            if (data[i] > 15 || data[i + 1] > 15 || data[i + 2] > 15) {
              isNonBlack = true;
              break;
            }
          }
          if (isNonBlack) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            if (dataUrl && dataUrl.startsWith('data:image/jpeg') && dataUrl.length > 200) {
              setCapturedThumb(dataUrl);
            }
          }
        }
      } catch {
        /* ignore CORS restriction */
      } finally {
        cleanup();
      }
    };

    const handleLoadedMetadata = () => {
      try {
        const dur = video.duration || 10;
        const targetTime = Math.min(1.0, dur > 2 ? 1.0 : dur / 2);
        video.currentTime = targetTime;
      } catch {
        cleanup();
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', cleanup, { once: true });

    if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
      video.src = rawPath;
    } else {
      video.src = convertFileSrc(rawPath);
    }

    const tid = setTimeout(cleanup, 4000);
    return () => {
      active = false;
      clearTimeout(tid);
      cleanup();
    };
  }, [initialSource, isVideo, item.sourcePath]);

  const effectiveSrc = initialSource || capturedThumb;

  if (effectiveSrc) {
    return <img src={effectiveSrc} alt={t('drive.preflight_source_thumb_alt')} />;
  }

  if (isVideo) {
    return (
      <div className="td-preflight-icon-thumb is-video" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
        <Film size={22} className="text-sky-400" aria-hidden />
      </div>
    );
  }

  if (item.category === 'photo' || /\.(jpe?g|png|webp|gif|bmp|heic|avif)($|\?)/i.test(item.sourceName)) {
    return (
      <div className="td-preflight-icon-thumb is-photo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
        <ImageIcon size={22} className="text-emerald-400" aria-hidden />
      </div>
    );
  }

  if (item.category === 'audio' || /\.(mp3|flac|m4a|wav|ogg|opus|aac)($|\?)/i.test(item.sourceName)) {
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

  useEffect(() => {
    const messageId = Number(match.telegramMessageId || 0);
    if (!creds || messageId <= 0) {
      setThumb(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const peerId = match.destinationId === 'me' ? 'me' : match.destinationId;
    const folderId = peerId === 'me' ? null : Number(peerId);
    setLoading(true);
    void requestThumb(creds, Number.isFinite(folderId) ? folderId : null, messageId, {
      priority: 'visible',
      peerId,
      topicId: match.topicId,
      locationType: peerId === 'me' ? 'saved_messages' : 'group',
      signal: controller.signal,
    }).then((value) => {
      if (!controller.signal.aborted) {
        setThumb(value);
        setLoading(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setThumb(null);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [creds, match.destinationId, match.telegramMessageId, match.topicId]);

  return (
    <div className={`td-preflight-compare-media ${loading ? 'is-loading' : ''}`}>
      {thumb ? (
        <img src={thumb} alt={t('drive.preflight_existing_thumb_alt')} />
      ) : (
        <div className="td-preflight-thumb-empty">
          <ImageOff size={20} aria-hidden />
          <span>{loading ? t('drive.preflight_existing_thumb_loading') : t('drive.preflight_existing_thumb_missing')}</span>
        </div>
      )}
    </div>
  );
}

type Props = {
  report: QualityPreflightReport | null;
  creds: DriveCredentials | null;
  onConfirm: (decision: PreflightReviewDecision) => void;
  onCancel: () => void;
  onOpenSettings?: () => void;
  hasStackedModal?: boolean;
};

export function TransferPreflightDialog({
  report,
  creds,
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
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (report) setChoices(defaultDuplicateChoices(report));
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

  const handleConfirm = useCallback(() => {
    if (!report || report.hasBlockingIssues || queuedCount === 0 || isConfirming) return;
    setIsConfirming(true);
    try {
      onConfirm(buildPreflightReviewDecision(report, choices));
    } catch (err) {
      console.error('Preflight confirm error:', err);
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

  if (!report || typeof document === 'undefined') return null;

  const visibleItems = report.items.slice(0, 100);
  const hiddenCount = Math.max(0, report.items.length - visibleItems.length);
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
          <div className="td-preflight-overview-stats">
            <div className="td-preflight-stat-pill">
              <strong>{report.items.length}</strong>
              <span>{t('drive.preflight_files')}</span>
            </div>
            {duplicateCount > 0 && (
              <div className="td-preflight-stat-pill is-duplicate">
                <strong>{duplicateCount}</strong>
                <span>{t('drive.preflight_duplicates_found')}</span>
              </div>
            )}
            <div className="td-preflight-stat-pill is-queue">
              <strong>{queuedCount}</strong>
              <span>{t('drive.preflight_will_queue')}</span>
            </div>
            {skippedCount > 0 && (
              <div className="td-preflight-stat-pill is-skip">
                <strong>{skippedCount}</strong>
                <span>{t('drive.preflight_will_skip')}</span>
              </div>
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
                  <div className="td-preflight-modes-grid">
                    {/* Card 1: Engine */}
                    <div className="td-preflight-mode-card">
                      <div className="td-preflight-mode-header-line">
                        <span className="td-preflight-mode-badge is-engine">
                          <Zap size={11} aria-hidden />
                          <span>
                            {report.remoteEngineMode === 'cloud_fetch'
                              ? 'Zero Quota Cloud Direct'
                              : report.remoteEngineMode === 'ram_pipe'
                                ? 'Zero Disk RAM-Pipe'
                                : 'Smart MTProto V4'}
                          </span>
                        </span>
                        <span className="td-preflight-mode-title">{t('drive.preflight_modes_engine_title')}</span>
                      </div>
                      <p className="td-preflight-mode-desc">{t('drive.preflight_modes_engine_desc')}</p>
                    </div>

                    {/* Card 2: Delivery & Packaging */}
                    <div className="td-preflight-mode-card">
                      <div className="td-preflight-mode-header-line">
                        <span className="td-preflight-mode-badge is-delivery">
                          <Sparkles size={11} aria-hidden />
                          <span>{t('drive.preflight_delivery_high_quality')} • Grid {report.albumGridSize || 10}</span>
                        </span>
                        <span className="td-preflight-mode-title">{t('drive.preflight_modes_delivery_title')}</span>
                      </div>
                      <p className="td-preflight-mode-desc">{t('drive.preflight_modes_delivery_desc')}</p>
                    </div>

                    {/* Card 3: Storage Policy */}
                    <div className="td-preflight-mode-card">
                      <div className="td-preflight-mode-header-line">
                        <span className="td-preflight-mode-badge is-storage">
                          <HardDrive size={11} aria-hidden />
                          <span>{t('drive.preflight_storage_cloud_only')}</span>
                        </span>
                        <span className="td-preflight-mode-title">{t('drive.preflight_modes_storage_title')}</span>
                      </div>
                      <p className="td-preflight-mode-desc">{t('drive.preflight_modes_storage_desc')}</p>
                    </div>

                    {/* Card 4: Duplicate & Safety */}
                    <div className="td-preflight-mode-card">
                      <div className="td-preflight-mode-header-line">
                        <span className="td-preflight-mode-badge is-safety">
                          <ShieldCheck size={11} aria-hidden />
                          <span>{t('drive.preflight_duplicate_4level')}</span>
                        </span>
                        <span className="td-preflight-mode-title">{t('drive.preflight_modes_duplicate_title')}</span>
                      </div>
                      <p className="td-preflight-mode-desc">{t('drive.preflight_modes_duplicate_desc')}</p>
                    </div>
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
          {visibleItems.map((item) => {
            const duplicate = item.duplicateMatch;
            const choice = choices[item.sourcePath] || 'upload';
            const isExpanded = expandedDetails[item.sourcePath] || false;
            return (
              <article
                className={`td-preflight-item ${duplicate ? 'is-duplicate' : 'is-clean-item'} ${choice === 'skip' ? 'is-skipped' : 'is-uploading'}`}
                key={`${item.index}-${item.sourcePath}`}
              >
                <div className="td-preflight-card-main">
                  {/* Left: Thumbnail container with index number */}
                  <div className="td-preflight-thumb-wrap">
                    <div className="td-preflight-thumb">
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
                        <span className={`td-preflight-match-badge ${duplicate.matchLevel === 'exact_sha256' ? 'is-exact' : ''}`}>
                          <CopyCheck size={11} aria-hidden />
                          <span>{t(`drive.preflight_match_${duplicate.matchLevel}`)}</span>
                        </span>
                      ) : (
                        <span className="td-preflight-ready-tag">
                          <CheckCircle2 size={11} aria-hidden />
                          <span>{t('drive.preflight_ready_badge')}</span>
                        </span>
                      )}

                      {/* Engine Mode Pill Badge: Modern Glowing Glass Pill */}
                      {(item.sourcePath.startsWith('http://') || item.sourcePath.startsWith('https://')) && (
                        ((report.remoteEngineMode as RemoteEngineMode | undefined) === 'cloud_fetch' ||
                          (report.remoteEngineMode !== 'ram_pipe' && item.sourceSize > 0 && item.sourceSize <= 20 * 1024 * 1024)) ? (
                          <span className="td-preflight-engine-tag is-cloud-fetch">
                            <Sparkles size={10} aria-hidden />
                            <span>{t('drive_tools.remote_zero_quota_badge')}</span>
                          </span>
                        ) : (
                          <span className="td-preflight-engine-tag is-ram-pipe">
                            <Zap size={10} aria-hidden />
                            <span>{t('drive_tools.remote_zero_disk_badge')}</span>
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

                {/* Expandable technical details */}
                {isExpanded && !duplicate && (
                  <dl className="td-preflight-tech-dl">
                    <div><dt>{t('drive.preflight_category')}</dt><dd>{t(`drive.preflight_category_${item.category}`)}</dd></div>
                    <div><dt>{t('drive.preflight_transform')}</dt><dd>{t(`drive.preflight_transform_${item.transform}`)}</dd></div>
                    <div><dt>{t('drive.preflight_payload')}</dt><dd>{t(`drive.preflight_payload_${item.payloadClass}`)}</dd></div>
                  </dl>
                )}
              </article>
            );
          })}
          {hiddenCount > 0 && <p className="td-xfer-hint">{t('drive.preflight_more_items', { count: hiddenCount })}</p>}
        </div>

        <footer className="td-preflight-foot">
          <div className="td-preflight-foot-left">
            {onOpenSettings && (
              <button
                type="button"
                className="td-chip-btn"
                onClick={onOpenSettings}
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
  );

  return createPortal(node, document.body);
}
