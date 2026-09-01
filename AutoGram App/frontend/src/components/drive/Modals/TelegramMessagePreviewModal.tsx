import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useModalBackHandler } from '../../../lib/platform/modalBackStack';
import {
  X,
  Copy,
  Check,
  Video,
  Image as ImageIcon,
  CheckCheck,
  Share2,
  Play,
  Send,
  Download,
  ExternalLink,
  FolderOpen,
  UserPlus,
  Eye,
} from 'lucide-react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import {
  driveFileDisplayName,
  formatDriveBytes,
  isVideoDriveFile,
  isImageDriveFile,
  isAudioDriveFile,
  canShowDriveThumb,
} from '../../../lib/telegram/driveTypes';
import {
  buildTelegramMessageUrl,
  extractTelegramMessageUrls,
  isTelegramActionLink,
} from '../../../lib/telegram/utils/telegramMessageUrl';
import { openUrl } from '@tauri-apps/plugin-opener';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { nativeWriteClipboardText } from '../../../lib/tauri/desktopClipboard';
import {
  getCachedThumb,
  getCachedSaverThumb,
  buildThumbCacheKey,
  requestThumb,
} from '../../../lib/media/thumbBatcher';
import { loadPersistentThumb } from '../../../lib/media/thumbPersistentCache';
import { getCachedPreview, loadPreviewCached } from '../../../lib/media/previewCache';
import { tgDebugGetMessage } from '../../../lib/telegram/core/telegramBackend';

export interface TelegramMessagePreviewModalProps {
  file: DriveFile | null;
  isOpen: boolean;
  onClose: () => void;
  chatName?: string;
  topicName?: string;
  creds?: DriveCredentials | null;
  folderId?: number | null;
  onSendToRemoteLink?: (url: string) => void;
  onOpenTelegramLink?: (url: string) => void;
  onBrowseTelegramDrive?: (url: string) => void;
  onJoinTelegramChat?: (url: string) => void;
  onPreviewMedia?: (file: DriveFile) => void;
  escapeDisabled?: boolean;
}

function normalizeSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  if (
    src.startsWith('data:image/') ||
    src.startsWith('blob:') ||
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('asset:')
  ) {
    return src;
  }
  try {
    return convertFileSrc(src);
  } catch {
    return src;
  }
}

function getTelegramAvatarGradient(name: string, id?: number | string | null): string {
  const gradients = [
    'linear-gradient(135deg, #e17076, #ff885e)', // Red-orange
    'linear-gradient(135deg, #faa774, #e56576)', // Orange-pink
    'linear-gradient(135deg, #a695e7, #7e65d4)', // Purple
    'linear-gradient(135deg, #7bc862, #4fae60)', // Green
    'linear-gradient(135deg, #6ec9cb, #36a7aa)', // Cyan
    'linear-gradient(135deg, #65aadd, #2f7fc2)', // Blue
    'linear-gradient(135deg, #ee7aae, #d44e8c)', // Pink
  ];
  let hash = 0;
  const str = String(id || name || 'Telegram');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % gradients.length;
  return gradients[idx];
}

function getAvatarInitials(name: string): string {
  const clean = name.replace(/[\[\]\(\)\-_@#]/g, ' ').trim();
  if (!clean) return 'TG';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function TelegramMessagePreviewModal({
  file,
  isOpen,
  onClose,
  chatName,
  topicName,
  creds,
  folderId,
  onSendToRemoteLink,
  onOpenTelegramLink,
  onBrowseTelegramDrive,
  onJoinTelegramChat,
  onPreviewMedia,
  escapeDisabled = false,
}: TelegramMessagePreviewModalProps) {
  const { t } = useTranslation();
  useModalBackHandler(isOpen, onClose, 'telegram-message-preview-modal');
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [exactMessageText, setExactMessageText] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const overlayMouseDownTargetRef = useRef<EventTarget | null>(null);

  const scopedFolderId = file?.folder_id ?? folderId ?? null;
  const itemPeerId = scopedFolderId != null && scopedFolderId !== 0 ? String(scopedFolderId) : (file?.peer_id || 'me');
  const itemTopicId = file?.topic_id ?? null;
  const thumbLocator = { peerId: itemPeerId, topicId: itemTopicId };

  const getInitialImage = (): string | null => {
    if (!file) return null;
    // 1. Check full preview cache
    const previewHit = getCachedPreview(scopedFolderId, file.id, 'auto', creds?.session, itemPeerId, itemTopicId);
    if (previewHit?.data_url) return normalizeSrc(previewHit.data_url);
    if (previewHit?.path) return normalizeSrc(previewHit.path);

    // 2. Check thumbnail cache
    const mem = getCachedThumb(scopedFolderId, file.id, thumbLocator);
    if (mem) return normalizeSrc(mem);
    if (creds?.session) {
      const saver = getCachedSaverThumb(scopedFolderId, file.id, creds.session, thumbLocator);
      if (saver) return normalizeSrc(saver);
    }
    if (file.thumb_data_url || file.thumbDataUrl) {
      return normalizeSrc((file.thumb_data_url || file.thumbDataUrl) as string);
    }
    return null;
  };

  const [imageSrc, setImageSrc] = useState<string | null>(getInitialImage);

  useEffect(() => {
    if (!isOpen || escapeDisabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [escapeDisabled, isOpen, onClose]);

  // Sync thumbnail / full image preview and fetch from backend if missing
  useEffect(() => {
    if (!file || !isOpen) return;
    setImgError(false);
    setImgLoaded(false);

    let isMounted = true;
    const current = getInitialImage();
    if (current) {
      setImageSrc(current);
    }

    if (creds?.session) {
      const isImg = isImageDriveFile(file);

      // Attempt full image preview fetch if image
      if (isImg && !current) {
        void loadPreviewCached(creds, file.id, scopedFolderId, 'auto', {
          peerId: itemPeerId,
          topicId: itemTopicId,
          accountId: file.account_id || creds.session,
        }).then((res) => {
          if (!isMounted || !res) return;
          const url = res.data_url || res.path;
          if (url) {
            setImageSrc(normalizeSrc(url));
            setImgError(false);
          }
        }).catch(() => {
          // Fall back to thumb request
        });
      }

      // Check IndexedDB persistent thumbnail cache
      const balancedKey = buildThumbCacheKey(
        scopedFolderId,
        file.id,
        'balanced',
        creds.session,
        itemPeerId,
        itemTopicId
      );
      void loadPersistentThumb(balancedKey).then((persisted) => {
        if (isMounted && persisted && !imageSrc) {
          setImageSrc(normalizeSrc(persisted));
        }
      });

      if (canShowDriveThumb(file)) {
        void requestThumb(creds, scopedFolderId, file.id, {
          priority: 'visible',
          peerId: itemPeerId,
          topicId: itemTopicId,
        });
      }
    }

    const onThumbReady = (ev: Event) => {
      if (!isMounted) return;
      const hit = getCachedThumb(scopedFolderId, file.id, thumbLocator);
      if (hit) {
        setImageSrc(normalizeSrc(hit));
        setImgError(false);
        return;
      }
      const detail = (ev as CustomEvent).detail as { key?: string; url?: string } | undefined;
      if (detail?.key && detail?.url && creds?.session) {
        const expectedBalanced = buildThumbCacheKey(
          scopedFolderId,
          file.id,
          'balanced',
          creds.session,
          itemPeerId,
          itemTopicId
        );
        const expectedSaver = buildThumbCacheKey(
          scopedFolderId,
          file.id,
          'saver',
          creds.session,
          itemPeerId,
          itemTopicId
        );
        if (detail.key === expectedBalanced || detail.key === expectedSaver) {
          setImageSrc(normalizeSrc(detail.url));
          setImgError(false);
        }
      }
    };

    window.addEventListener('autogram-thumb-ready', onThumbReady);
    return () => {
      isMounted = false;
      window.removeEventListener('autogram-thumb-ready', onThumbReady);
    };
  }, [file?.id, scopedFolderId, itemPeerId, itemTopicId, creds?.session, isOpen]);

  useEffect(() => {
    if (!isOpen || !file || !creds?.session || !creds.apiId || !creds.apiHash) {
      setExactMessageText(null);
      return;
    }
    let cancelled = false;
    setMessageLoading(true);
    void tgDebugGetMessage({
      session: creds.session,
      apiId: Number(creds.apiId),
      apiHash: creds.apiHash,
      peerId: itemPeerId,
      telegramMessageId: file.id,
    }).then((result) => {
      if (cancelled) return;
      setExactMessageText(result?.ok && result.data?.found ? result.data.text ?? '' : null);
    }).finally(() => {
      if (!cancelled) setMessageLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [creds?.apiHash, creds?.apiId, creds?.session, file?.id, isOpen, itemPeerId]);

  if (!isOpen || !file) return null;

  const tgUrl = buildTelegramMessageUrl(file);
  const exactUrls = extractTelegramMessageUrls(exactMessageText || '');
  const indexedUrls = file.icon_type === 'link'
    ? (file.link_urls?.length
        ? file.link_urls
        : String(file.drive_format || file.driveFormat || file.original_name || file.name || '')
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean))
    : [];
  const linkUrls = Array.from(new Set([...exactUrls, ...indexedUrls]));
  const isLink = linkUrls.length > 0;
  const isVideo = isVideoDriveFile(file);
  const isImage = isImageDriveFile(file) || file.icon_type === 'image' || file.mime_type?.startsWith('image/');
  const isAudio = isAudioDriveFile(file) || file.icon_type === 'audio' || file.icon_type === 'voice' || file.mime_type?.startsWith('audio/');
  const isDocument = !isLink && !isImage && !isVideo && !isAudio;
  const isVisualMedia = isImage || isVideo || (imageSrc && !imgError);

  const displayName = driveFileDisplayName(file);
  const isSavedMessages = file.is_saved_messages || file.peer_kind === 'saved_messages' || file.peer_id === 'me';

  const senderName = isSavedMessages
    ? t('drive.account_saved_messages', { defaultValue: 'Saved Messages' })
    : chatName || file.peer_username || t('drive.tg_preview_sender_unknown');

  const avatarGradient = getTelegramAvatarGradient(senderName, file.peer_id);
  const avatarInitials = isSavedMessages ? '⭐' : getAvatarInitials(senderName);

  const captionText = exactMessageText ?? '';

  // Telegram date formatting
  const fileDate = file.created_at ? new Date(file.created_at) : new Date();
  const isToday = new Date().toDateString() === fileDate.toDateString();
  const dateHeader = isToday
    ? t('drive.tg_preview_today', { defaultValue: 'Today' })
    : fileDate.toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: fileDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      });

  const timeOnly = fileDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const durationStr = formatDuration(file.duration || file.duration_s);
  const fileExt = (file.file_ext || file.name.split('.').pop() || 'FILE').toUpperCase();

  const handleCopyCaption = async () => {
    if (!captionText) return;
    await nativeWriteClipboardText(captionText);
    setCopiedCaption(true);
    setTimeout(() => setCopiedCaption(false), 2000);
  };

  const handleCopyLink = async () => {
    if (!tgUrl) return;
    await nativeWriteClipboardText(tgUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyUrl = async (url: string) => {
    await nativeWriteClipboardText(url);
    setCopiedUrl(url);
    window.setTimeout(() => setCopiedUrl((current) => current === url ? null : current), 1600);
  };

  const handleOpenTelegram = async () => {
    if (!tgUrl) return;
    try {
      await openUrl(tgUrl);
    } catch (err) {
      console.error('[TelegramMessagePreviewModal] Open Telegram link failed:', err);
    }
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    overlayMouseDownTargetRef.current = e.target;
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (overlayMouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
      onClose();
    }
    overlayMouseDownTargetRef.current = null;
  };

  const modalNode = (
    <div
      className="tg-msg-preview-backdrop"
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="tg-msg-preview-dialog"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('drive.tg_preview_title')}
      >
        {/* Telegram Desktop Top Header Bar (No redundant duplicate actions) */}
        <div className="tg-msg-preview-header">
          <div className="tg-msg-preview-header-left">
            <div
              className="tg-msg-preview-chat-avatar"
              style={{ background: avatarGradient }}
            >
              <span>{avatarInitials}</span>
            </div>
            <div className="tg-msg-preview-chat-meta">
              <div className="tg-msg-preview-chat-name" title={senderName}>
                {senderName}
              </div>
              <div className="tg-msg-preview-chat-subtitle">
                {isSavedMessages
                  ? t('drive_tools.account_saved_messages')
                  : topicName
                    ? `#${topicName}`
                    : file.peer_kind === 'channel'
                      ? t('drive_tools.peer_kind_channel')
                      : file.peer_kind === 'supergroup' || file.peer_kind === 'basic_group'
                        ? t('drive_tools.peer_kind_group')
                        : t('drive_tools.peer_kind_chat')}
                {file.id ? ` · ${t('drive_tools.message_id_label', { id: file.id })}` : ''}
              </div>
            </div>
          </div>
          <div className="tg-msg-preview-header-right">
            <button
              type="button"
              className="tg-msg-preview-close-btn"
              onClick={onClose}
              aria-label={t('drive_tools.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Telegram Wallpaper Area */}
        <div className="tg-msg-preview-canvas">
          {/* Floating Date Badge Header */}
          <div className="tg-date-bubble-container">
            <span className="tg-date-bubble">{dateHeader}</span>
          </div>

          {/* Message Row with Left Avatar */}
          <div className="tg-msg-row">
            <div
              className="tg-msg-row-avatar"
              style={{ background: avatarGradient }}
              title={senderName}
            >
              <span>{avatarInitials}</span>
            </div>

            {/* Telegram Chat Bubble with authentic corner tail */}
            <div className={`tg-msg-bubble${isVisualMedia ? ' has-media' : ''}`}>
              {/* Sender / Channel Title */}
              <div className="tg-msg-bubble-sender-row">
                <span className="tg-msg-bubble-sender-name">{senderName}</span>
                {topicName && (
                  <span className="tg-msg-bubble-topic-badge">#{topicName}</span>
                )}
              </div>

              {/* 1. Visual Media (Photo / Video Thumbnail) */}
              {isVisualMedia && (
                <div
                  className={`tg-msg-bubble-media-wrapper${isVideo ? ' is-video' : ''}${onPreviewMedia ? ' is-interactive' : ''}`}
                  onClick={() => {
                    if (onPreviewMedia) onPreviewMedia(file);
                  }}
                  style={{ cursor: onPreviewMedia ? 'pointer' : 'default' }}
                  title={onPreviewMedia ? t('drive.preview_media_desc') : undefined}
                >
                  {imageSrc && !imgError ? (
                    <>
                      <img
                        src={imageSrc}
                        alt={displayName}
                        className={`tg-msg-bubble-img${imgLoaded ? ' is-loaded' : ''}`}
                        onLoad={() => setImgLoaded(true)}
                        onError={() => setImgError(true)}
                      />
                      {onPreviewMedia && (
                        <div className="tg-msg-bubble-media-hover-overlay">
                          <Eye size={18} />
                          <span>{t('drive.preview_media_action')}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="tg-msg-bubble-media-placeholder">
                      {isVideo ? (
                        <Video size={38} className="tg-placeholder-icon" />
                      ) : (
                        <ImageIcon size={38} className="tg-placeholder-icon" />
                      )}
                      <span className="tg-placeholder-text">
                        {t('drive.tg_preview_image_loading', { defaultValue: 'Loading preview…' })}
                      </span>
                    </div>
                  )}

                  {/* Video Play Button Overlay */}
                  {isVideo && (
                    <div className="tg-msg-bubble-video-overlay">
                      <div className="tg-msg-video-play-btn">
                        <Play size={22} fill="#ffffff" color="#ffffff" style={{ marginLeft: 3 }} />
                      </div>
                      {durationStr && (
                        <div className="tg-msg-video-duration-badge">
                          <span>{durationStr}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* URL messages: one rich lightweight card, or a compact list
                  when Telegram stored multiple links in the same message. */}
              {isLink && (
                <div className={`tg-msg-link-preview${linkUrls.length > 1 ? ' is-multiple' : ''}`}>
                  <div className="tg-msg-link-heading">
                    {linkUrls.length > 1
                      ? t('drive.link_preview_multiple', { count: linkUrls.length })
                      : t('drive.link_preview_single')}
                  </div>
                  <div className="tg-msg-link-list">
                    {linkUrls.map((url, index) => {
                      let host = url;
                      try {
                        host = new URL(url).hostname.replace(/^www\./i, '');
                      } catch {
                        // Keep the original text for non-standard Telegram URLs.
                      }
                      return (
                        <div
                          className="tg-msg-link-row"
                          key={`${file.id}-${index}`}
                          title={url}
                        >
                          <button
                            type="button"
                            className="tg-msg-link-open"
                            onClick={() => {
                              if (isTelegramActionLink(url) && onBrowseTelegramDrive) {
                                onBrowseTelegramDrive(url);
                              } else {
                                void openUrl(url).catch(() => undefined);
                              }
                            }}
                            title={
                              isTelegramActionLink(url)
                                ? t('telegram_actions.browse_drive_desc')
                                : t('drive.link_preview_open')
                            }
                          >
                            <span className="tg-msg-link-domain">{host}</span>
                            <span className="tg-msg-link-url">{url}</span>
                          </button>
                          <div className="tg-msg-link-actions-group">
                            <button
                              type="button"
                              className="tg-msg-link-icon-action"
                              onClick={() => void handleCopyUrl(url)}
                              title={t('drive.link_preview_copy')}
                              aria-label={t('drive.link_preview_copy')}
                            >
                              {copiedUrl === url ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                            {isTelegramActionLink(url) ? (
                              <>
                                {(onBrowseTelegramDrive || onOpenTelegramLink) && (
                                  <button
                                    type="button"
                                    className="tg-msg-link-icon-action tg-msg-link-browse-btn"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      if (onBrowseTelegramDrive) {
                                        onBrowseTelegramDrive(url);
                                      } else if (onOpenTelegramLink) {
                                        onOpenTelegramLink(url);
                                      }
                                    }}
                                    title={t('telegram_actions.browse_drive')}
                                    aria-label={t('telegram_actions.browse_drive')}
                                  >
                                    <FolderOpen size={14} aria-hidden />
                                  </button>
                                )}
                                {(onJoinTelegramChat || onOpenTelegramLink) && (
                                  <button
                                    type="button"
                                    className="tg-msg-link-icon-action tg-msg-link-join-btn"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      if (onJoinTelegramChat) {
                                        onJoinTelegramChat(url);
                                      } else if (onOpenTelegramLink) {
                                        onOpenTelegramLink(url);
                                      }
                                    }}
                                    title={t('telegram_actions.action_join_title')}
                                    aria-label={t('telegram_actions.action_join_title')}
                                  >
                                    <UserPlus size={14} aria-hidden />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="tg-msg-link-icon-action"
                                  onClick={() => void openUrl(url).catch(() => undefined)}
                                  title={t('drive.link_preview_open')}
                                  aria-label={t('drive.link_preview_open')}
                                >
                                  <ExternalLink size={14} aria-hidden />
                                </button>
                              </>
                            ) : (
                              <>
                                {onSendToRemoteLink && (
                                  <button
                                    type="button"
                                    className="tg-msg-link-icon-action"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      onSendToRemoteLink(url);
                                    }}
                                    title={t('drive.link_preview_send_remote')}
                                    aria-label={t('drive.link_preview_send_remote')}
                                  >
                                    <Send size={14} aria-hidden />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="tg-msg-link-icon-action"
                                  onClick={() => void openUrl(url).catch(() => undefined)}
                                  title={t('drive.link_preview_open')}
                                  aria-label={t('drive.link_preview_open')}
                                >
                                  <ExternalLink size={14} aria-hidden />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Audio Player Layout */}
              {isAudio && (
                <div className="tg-msg-bubble-audio-box">
                  <div className="tg-msg-audio-play-circle">
                    <Play size={18} fill="#ffffff" color="#ffffff" style={{ marginLeft: 2 }} />
                  </div>
                  <div className="tg-msg-audio-info">
                    <div className="tg-msg-audio-title" title={displayName}>
                      {displayName}
                    </div>
                    <div className="tg-msg-audio-waveform">
                      <div className="tg-audio-bar" style={{ height: '45%' }} />
                      <div className="tg-audio-bar" style={{ height: '70%' }} />
                      <div className="tg-audio-bar" style={{ height: '95%' }} />
                      <div className="tg-audio-bar" style={{ height: '60%' }} />
                      <div className="tg-audio-bar" style={{ height: '35%' }} />
                      <div className="tg-audio-bar" style={{ height: '80%' }} />
                      <div className="tg-audio-bar" style={{ height: '100%' }} />
                      <div className="tg-audio-bar" style={{ height: '65%' }} />
                      <div className="tg-audio-bar" style={{ height: '40%' }} />
                      <div className="tg-audio-bar" style={{ height: '85%' }} />
                      <div className="tg-audio-bar" style={{ height: '55%' }} />
                      <div className="tg-audio-bar" style={{ height: '30%' }} />
                    </div>
                    <div className="tg-msg-audio-sub">
                      <span>{durationStr || formatDriveBytes(file.size)}</span>
                      <span>·</span>
                      <span>{formatDriveBytes(file.size)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. Document / File Card Layout */}
              {isDocument && !imageSrc && (
                <div className="tg-msg-bubble-doc-card">
                  <div className="tg-msg-bubble-doc-icon-circle">
                    <Download size={20} color="#ffffff" />
                  </div>
                  <div className="tg-msg-bubble-doc-meta">
                    <div className="tg-msg-bubble-doc-filename" title={displayName}>
                      {displayName}
                    </div>
                    <div className="tg-msg-bubble-doc-sub">
                      <span className="tg-doc-size">{formatDriveBytes(file.size)}</span>
                      <span className="tg-doc-ext-badge">{fileExt}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Message Caption / Text Content */}
              {messageLoading && (
                <div className="tg-msg-bubble-caption-loading" role="status">
                  {t('drive.tg_preview_loading_message')}
                </div>
              )}
              {captionText && (
                <div className="tg-msg-bubble-caption-text">
                  {captionText}
                </div>
              )}

              {/* 5. Telegram Footer Inside Bubble: Views + Timestamp + Double Checkmarks */}
              <div className="tg-msg-bubble-footer">
                <div className="tg-msg-bubble-time-block">
                  <span className="tg-msg-bubble-time">{timeOnly}</span>
                  <CheckCheck size={14} className="tg-msg-bubble-check" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Telegram-style Quick Action Strip (Non-redundant, clean) */}
        <div className="tg-msg-preview-footer">
          {isVisualMedia && onPreviewMedia && (
            <button
              type="button"
              className="tg-msg-action-btn is-accent"
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                fontWeight: 600,
              }}
              onClick={() => onPreviewMedia(file)}
              title={t('drive.preview_media_desc')}
            >
              <Eye size={14} />
              <span>{t('drive.preview_media_action')}</span>
            </button>
          )}

          {captionText && (
            <button
              type="button"
              className="tg-msg-action-btn"
              onClick={handleCopyCaption}
              title={captionText}
            >
              {copiedCaption ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
              <span>
                {copiedCaption
                  ? t('drive.tg_preview_copied')
                  : t('drive.tg_preview_copy_caption')}
              </span>
            </button>
          )}

          {tgUrl && (
            <button
              type="button"
              className="tg-msg-action-btn"
              onClick={handleCopyLink}
              title={tgUrl}
            >
              {copiedLink ? <Check size={14} color="#10b981" /> : <Share2 size={14} />}
              <span>
                {copiedLink
                  ? t('drive.tg_preview_copied')
                  : t('drive.ctx_menu_copy_tg')}
              </span>
            </button>
          )}

          {tgUrl && (
            <button
              type="button"
              className="tg-msg-action-btn is-primary"
              onClick={handleOpenTelegram}
            >
              <Send size={14} />
              <span>{t('drive.ctx_menu_open_tg')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalNode, document.body);
}
