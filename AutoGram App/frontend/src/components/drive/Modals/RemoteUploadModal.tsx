import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  Film,
  Image as ImageIcon,
  Music,
  Archive,
  FileText,
  FileCode,
  CheckCircle2,
  Layers,
  Sparkles,
  Play,
} from 'lucide-react';
import type { DriveDestChoice, DriveDestPickerState } from './DriveDestinationPicker';
import { DriveDestinationPicker } from './DriveDestinationPicker';
import type { DriveCredentials } from '../../../lib/telegram/driveApi/driveApiUtils';
import { PeerAvatar } from '../Navigation/sidebarUtils';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { nativeReadClipboardText } from '../../../lib/tauri/desktopClipboard';
import {
  resolveRemoteMediaUrl,
  type ResolvedMediaInfo,
} from '../../../lib/telegram/linkResolvers';

interface RemoteUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  destinations: DriveDestChoice[];
  currentDestination?: DriveDestChoice;
  creds?: DriveCredentials | null;
  onUpload: (
    urls: string | string[],
    destination: DriveDestChoice,
    opts?: {
      customFilename?: string;
      asDocument?: boolean;
      qualityMode?: string;
      presentationOverride?: 'document' | 'original' | 'standard' | 'compressed';
    }
  ) => Promise<void>;
}

type RemoteUploadTab = 'single' | 'batch';
type DeliveryMode = 'auto' | 'uncompressed' | 'document';
type UrlKind = 'video' | 'image' | 'audio' | 'zip' | 'doc' | 'other';

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

export function RemoteUploadModal({
  isOpen,
  onClose,
  destinations,
  currentDestination,
  creds,
  onUpload,
}: RemoteUploadModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RemoteUploadTab>('single');
  const [url, setUrl] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [batchUrlsText, setBatchUrlsText] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('auto');
  const [inspection, setInspection] = useState<UrlInspection | null>(null);

  const [resolvedMedia, setResolvedMedia] = useState<ResolvedMediaInfo | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('');

  const [selectedDest, setSelectedDest] = useState<DriveDestChoice>(
    currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' }
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const inspectAbortRef = useRef<AbortController | null>(null);
  const inspectTimerRef = useRef<number | null>(null);

  // Track opening transition so state is only initialized once upon opening
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setTab('single');
      setUrl('');
      setCustomFilename('');
      setBatchUrlsText('');
      setDeliveryMode('auto');
      setInspection(null);
      setResolvedMedia(null);
      setSelectedFormatId('');
      setSelectedDest(currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' });
      setErrorMsg('');
      setPickerOpen(false);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, currentDestination]);

  // Handle Escape key to close modal (only if inner destination picker is not open)
  useEffect(() => {
    if (!isOpen || pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, pickerOpen, onClose]);

  // Live URL & Media inspection engine (debounced)
  const probeUrl = useCallback(async (rawUrl: string) => {
    if (inspectAbortRef.current) {
      inspectAbortRef.current.abort();
      inspectAbortRef.current = null;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))) {
      setInspection(null);
      setResolvedMedia(null);
      return;
    }

    const baseName = inferFilenameFromUrl(trimmed);
    const dotIdx = baseName.lastIndexOf('.');
    const ext = dotIdx > 0 ? baseName.slice(dotIdx + 1) : '';
    const inferredKind = inferKindFromExt(ext);

    // Initial instant preview before network resolve
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
      // 1. Run through Modular Smart Link Resolver
      const resolved = await resolveRemoteMediaUrl(trimmed, controller.signal);
      if (resolved) {
        setResolvedMedia(resolved);
        setSelectedFormatId(resolved.selectedFormatId || resolved.formats[0]?.id || '');

        const bestFmt =
          resolved.formats.find((f) => f.id === resolved.selectedFormatId) || resolved.formats[0];
        const resName = resolved.title
          ? resolved.title.includes('.')
            ? resolved.title
            : `${resolved.title}.${bestFmt?.ext || ext || 'mp4'}`
          : baseName;

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
    } catch {
      /* fallback */
    }

    // Direct stream fallback inspection
    setInspection({
      url: trimmed,
      status: 'direct_stream',
      filename: baseName,
      size: null,
      mimeType: null,
      kind: inferredKind,
    });
  }, []);

  const handleUrlChange = (val: string) => {
    setUrl(val);
    if (errorMsg) setErrorMsg('');
    if (inspectTimerRef.current) window.clearTimeout(inspectTimerRef.current);
    inspectTimerRef.current = window.setTimeout(() => {
      void probeUrl(val);
    }, 280);
  };

  const handlePasteClipboard = async () => {
    const text = await nativeReadClipboardText();
    if (text) {
      if (tab === 'single') {
        handleUrlChange(text);
      } else {
        setBatchUrlsText((prev) => (prev ? `${prev}\n${text}` : text));
      }
    }
  };

  // Extract valid URLs from batch text
  const batchUrls = useMemo(() => {
    return batchUrlsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('http://') || line.startsWith('https://'));
  }, [batchUrlsText]);

  // Clean target label presentation (stripping awkward prefix duplication)
  const cleanTargetDisplay = useMemo(() => {
    const raw = selectedDest.label || 'Saved Messages';
    let cleanLabel = raw;
    if (cleanLabel.startsWith('#') && selectedDest.topicId) {
      cleanLabel = cleanLabel.replace(/^#\s*/, '');
    }
    return {
      title: cleanLabel,
      topicPill: selectedDest.topicId ? `# Topik ${selectedDest.topicId}` : null,
    };
  }, [selectedDest]);

  // Stable destination picker state to prevent re-instantiation
  const pickerState = useMemo<DriveDestPickerState | null>(() => {
    if (!pickerOpen) return null;
    return {
      title: t('speedtest.remote_upload_select_target'),
      detail: t('speedtest.remote_upload_select_target_desc'),
      choices: destinations,
      creds,
      onConfirm: (choice) => {
        setSelectedDest(choice);
        setPickerOpen(false);
      },
    };
  }, [pickerOpen, destinations, creds, t]);

  if (!isOpen) return null;

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

      setSubmitting(true);
      try {
        const activeFormat =
          resolvedMedia?.formats.find((f) => f.id === selectedFormatId) ||
          resolvedMedia?.formats[0];
        const effectiveUrl = activeFormat?.directUrl || targetUrl;
        const effectiveFilename =
          customFilename.trim() ||
          (resolvedMedia?.title
            ? resolvedMedia.title.includes('.')
              ? resolvedMedia.title
              : `${resolvedMedia.title}.${activeFormat?.ext || 'mp4'}`
            : undefined);

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

        await onUpload([effectiveUrl], selectedDest, {
          customFilename: effectiveFilename,
          asDocument: deliveryMode === 'document',
          qualityMode: effectiveQualityMode,
          presentationOverride: effectivePresentation,
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

        await onUpload(batchUrls, selectedDest, {
          asDocument: deliveryMode === 'document',
          qualityMode: effectiveQualityMode,
          presentationOverride: effectivePresentation,
        });
        onClose();
      } catch (err: any) {
        setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleOverlayClick = () => {
    if (!pickerOpen && !submitting) {
      onClose();
    }
  };

  const node = (
    <div className="td-confirm-overlay" role="presentation" onClick={handleOverlayClick}>
      <form
        onSubmit={handleSubmit}
        className="td-confirm-panel input-dialog td-remote-upload-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
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

        {/* Tab Switcher: Single File vs Batch URLs */}
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

        <div className="td-input-body td-remote-body">
          {errorMsg && (
            <div className="td-input-error td-remote-error-box" role="alert">
              {errorMsg}
            </div>
          )}

          {tab === 'single' ? (
            <>
              {/* Single URL Input Row */}
              <div className="td-remote-field-group">
                <div className="td-remote-label-row">
                  <label className="td-input-label" htmlFor="td-remote-url">
                    {t('speedtest.source_url_label')}
                  </label>
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
                <div className="td-remote-input-wrap">
                  <span className="td-remote-input-icon">
                    <Link2 size={16} />
                  </span>
                  <input
                    id="td-remote-url"
                    className="td-input-field td-remote-url-input"
                    type="text"
                    placeholder="https://example.com/media.mp4"
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

              {/* Rich Streaming Media Preview Card (YouTube, TikTok, Terabox, Pinterest, etc.) */}
              {resolvedMedia && (resolvedMedia.thumbnailUrl || resolvedMedia.platform !== 'direct') ? (
                <div className="td-remote-media-card">
                  {resolvedMedia.thumbnailUrl && (
                    <div className="td-remote-media-thumb-wrap">
                      <img
                        src={resolvedMedia.thumbnailUrl}
                        alt={resolvedMedia.title}
                        className="td-remote-media-thumb"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <div className="td-remote-media-play-overlay">
                        <Play size={18} fill="currentColor" />
                      </div>
                      {resolvedMedia.durationSec ? (
                        <span className="td-remote-media-duration">
                          {formatMediaDuration(resolvedMedia.durationSec)}
                        </span>
                      ) : null}
                    </div>
                  )}
                  <div className="td-remote-media-details">
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
                        <span>{resolvedMedia.author}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : inspection && url.trim() ? (
                /* Standard File Inspector Card */
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
                        {inspection.status === 'inspecting' ? (
                          <>
                            <Loader2 size={11} className="spin" />
                            <span>{t('speedtest.remote_inspecting')}</span>
                          </>
                        ) : inspection.status === 'valid' ? (
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
              ) : null}

              {/* Stream Quality & Format Selector (YouTube 8K/4K/1080p, TikTok HD, Audio) */}
              {resolvedMedia && resolvedMedia.formats.length > 1 && (
                <div className="td-remote-field-group">
                  <label className="td-input-label">
                    {t('speedtest.remote_quality_selector_label')}
                  </label>
                  <div className="td-remote-quality-grid">
                    {resolvedMedia.formats.map((fmt) => {
                      const isSelected = selectedFormatId === fmt.id;
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          className={`td-remote-quality-chip ${isSelected ? 'active' : ''} tier-${fmt.qualityTier}`}
                          onClick={() => {
                            setSelectedFormatId(fmt.id);
                            if (fmt.filesizeBytes) {
                              setInspection((prev) =>
                                prev ? { ...prev, size: fmt.filesizeBytes } : prev
                              );
                            }
                          }}
                          disabled={submitting}
                        >
                          <span className="td-remote-quality-chip-title">{fmt.label}</span>
                          {fmt.badge && (
                            <span className="td-remote-quality-chip-badge">{fmt.badge}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Filename Override (Optional) */}
              <div className="td-remote-field-group">
                <label className="td-input-label" htmlFor="td-custom-filename">
                  {t('speedtest.remote_custom_name_label')}
                </label>
                <input
                  id="td-custom-filename"
                  className="td-input-field td-custom-filename-input"
                  type="text"
                  placeholder={
                    inspection?.filename || t('speedtest.remote_custom_name_placeholder')
                  }
                  value={customFilename}
                  onChange={(e) => setCustomFilename(e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </>
          ) : (
            /* Batch URLs Textarea */
            <div className="td-remote-field-group">
              <div className="td-remote-label-row">
                <label className="td-input-label" htmlFor="td-remote-batch-input">
                  {t('speedtest.remote_tab_batch')}
                </label>
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
          )}

          {/* Delivery Format Option: Auto Media vs Uncompressed Stream vs Document */}
          <div className="td-remote-field-group">
            <label className="td-input-label">{t('speedtest.remote_delivery_mode_label')}</label>
            <div className="td-remote-mode-selector">
              <button
                type="button"
                className={`td-remote-mode-btn ${deliveryMode === 'auto' ? 'active' : ''}`}
                onClick={() => setDeliveryMode('auto')}
                disabled={submitting}
              >
                <Film size={14} />
                <div className="td-remote-mode-text">
                  <span className="td-remote-mode-title">{t('speedtest.remote_mode_auto')}</span>
                  <span className="td-remote-mode-desc">{t('speedtest.remote_mode_auto_hint')}</span>
                </div>
              </button>
              <button
                type="button"
                className={`td-remote-mode-btn ${deliveryMode === 'uncompressed' ? 'active' : ''}`}
                onClick={() => setDeliveryMode('uncompressed')}
                disabled={submitting}
              >
                <Sparkles size={14} />
                <div className="td-remote-mode-text">
                  <span className="td-remote-mode-title">{t('speedtest.remote_mode_uncompressed')}</span>
                  <span className="td-remote-mode-desc">{t('speedtest.remote_mode_uncompressed_hint')}</span>
                </div>
              </button>
              <button
                type="button"
                className={`td-remote-mode-btn ${deliveryMode === 'document' ? 'active' : ''}`}
                onClick={() => setDeliveryMode('document')}
                disabled={submitting}
              >
                <FileText size={14} />
                <div className="td-remote-mode-text">
                  <span className="td-remote-mode-title">{t('speedtest.remote_mode_doc')}</span>
                  <span className="td-remote-mode-desc">{t('speedtest.remote_mode_doc_hint')}</span>
                </div>
              </button>
            </div>
          </div>

          {/* Target Folder / Channel Destination Card */}
          <div className="td-remote-field-group">
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
              (tab === 'single' ? !url.trim() : batchUrls.length === 0)
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
                    ? t('speedtest.remote_btn_start_single')
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
