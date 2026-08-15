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
  Zap,
  User,
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
  type StreamQualityFormat,
} from '../../../lib/telegram/linkResolvers';
import {
  type DriveTransferSettings,
  resolveDefaultDeliveryMode,
} from '../Transfers/transferSettingsModel';

interface RemoteUploadModalProps {
  isOpen: boolean;
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
  transferSettings,
  onUpload,
}: RemoteUploadModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RemoteUploadTab>('single');
  const [url, setUrl] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [batchUrlsText, setBatchUrlsText] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(() =>
    resolveDefaultDeliveryMode(transferSettings)
  );
  const [inspection, setInspection] = useState<UrlInspection | null>(null);

  const [resolvedMedia, setResolvedMedia] = useState<ResolvedMediaInfo | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('');

  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  const [selectedDest, setSelectedDest] = useState<DriveDestChoice>(
    currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' }
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const inspectAbortRef = useRef<AbortController | null>(null);
  const inspectTimerRef = useRef<number | null>(null);

  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setTab('single');
      setUrl('');
      setCustomFilename('');
      setBatchUrlsText('');
      setDeliveryMode(resolveDefaultDeliveryMode(transferSettings));
      setInspection(null);
      setResolvedMedia(null);
      setSelectedFormatId('');
      setActiveSlideIndex(0);
      setSelectedDest(currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' });
      setErrorMsg('');
      setPickerOpen(false);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, currentDestination, transferSettings]);

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
      const resolved = await resolveRemoteMediaUrl(trimmed, controller.signal);
      if (resolved) {
        setResolvedMedia(resolved);
        setSelectedFormatId(resolved.selectedFormatId || resolved.formats[0]?.id || '');
        setActiveSlideIndex(0);

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
  }, []);

  const handleUrlChange = (val: string) => {
    setUrl(val);
    if (errorMsg) setErrorMsg('');

    if (inspectTimerRef.current) {
      window.clearTimeout(inspectTimerRef.current);
    }
    inspectTimerRef.current = window.setTimeout(() => {
      probeUrl(val);
    }, 280);
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
    return {
      title: raw,
      topicPill: null,
    };
  }, [selectedDest.label]);

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
    if (fmt.filesizeBytes) {
      setInspection((prev) => (prev ? { ...prev, size: fmt.filesizeBytes } : prev));
    }
    const match = fmt.id.match(/photo_(\d+)/);
    if (match && match[1]) {
      const photoIdx = parseInt(match[1], 10) - 1;
      if (photoIdx >= 0 && (!resolvedMedia?.albumImages || photoIdx < resolvedMedia.albumImages.length)) {
        setActiveSlideIndex(photoIdx);
      }
    }
  };

  const activeSlideUrl = useMemo(() => {
    if (resolvedMedia?.albumImages && resolvedMedia.albumImages.length > 0) {
      return resolvedMedia.albumImages[activeSlideIndex] || resolvedMedia.albumImages[0];
    }
    return resolvedMedia?.thumbnailUrl || null;
  }, [resolvedMedia, activeSlideIndex]);

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

      setSubmitting(true);
      try {
        let activeResolved = resolvedMedia;
        if (!activeResolved && (targetUrl.includes('tiktok.com') || targetUrl.includes('douyin.com') || targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be') || targetUrl.includes('instagram.com') || targetUrl.includes('terabox') || targetUrl.includes('pinterest.com') || targetUrl.includes('pixiv.net'))) {
          try {
            activeResolved = await resolveRemoteMediaUrl(targetUrl);
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
          (activeResolved?.title
            ? activeResolved.title.includes('.')
              ? activeResolved.title
              : `${activeResolved.title}.${activeFormat?.ext || 'mp4'}`
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

        await onUpload(uploadUrls, selectedDest, {
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

  if (!isOpen) return null;

  const node = (
    <div className="td-confirm-overlay" role="presentation" onClick={handleOverlayClick}>
      <form
        onSubmit={handleSubmit}
        className={`td-confirm-panel input-dialog td-remote-upload-panel ${isSplitActive ? 'td-remote-split-active' : ''}`}
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
                      placeholder="https://vt.tiktok.com/... atau https://youtube.com/..."
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
              </div>
            ) : (
              <div className="td-remote-form-card">
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
                        <User size={12} />
                        <span>{resolvedMedia.author}</span>
                      </div>
                    )}
                  </div>

                  <div className="td-remote-big-canvas-wrap">
                    {activeSlideUrl ? (
                      <div className="td-remote-big-canvas-inner">
                        <img
                          src={activeSlideUrl}
                          alt={resolvedMedia.title}
                          className="td-remote-big-canvas-img"
                          loading="lazy"
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
                                <span className="td-remote-quality-chip-title">{fmt.label}</span>
                                {isSelected && <CheckCircle2 size={13} className="td-remote-chip-active-ico" />}
                              </div>
                              <div className="td-remote-quality-chip-meta">
                                {fmt.badge && (
                                  <span className="td-remote-quality-chip-badge">{fmt.badge}</span>
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
