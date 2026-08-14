import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X,
  ExternalLink,
  Copy,
  Check,
  MessageSquare,
  FileText,
  Video,
  Music,
  Image as ImageIcon,
  CheckCheck,
  Share2,
} from 'lucide-react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import {
  driveFileDisplayName,
  formatDriveBytes,
  isVideoDriveFile,
} from '../../../lib/telegram/driveTypes';
import { buildTelegramMessageUrl } from '../../../lib/telegram/utils/telegramMessageUrl';
import { openUrl } from '@tauri-apps/plugin-opener';

export interface TelegramMessagePreviewModalProps {
  file: DriveFile | null;
  isOpen: boolean;
  onClose: () => void;
  chatName?: string;
  topicName?: string;
}

export function TelegramMessagePreviewModal({
  file,
  isOpen,
  onClose,
  chatName,
  topicName,
}: TelegramMessagePreviewModalProps) {
  const { t } = useTranslation();
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen || !file) return null;

  const tgUrl = buildTelegramMessageUrl(file);
  const isVideo = isVideoDriveFile(file);
  const isImage = file.icon_type === 'image' || file.mime_type?.startsWith('image/');
  const isAudio = file.icon_type === 'audio' || file.icon_type === 'voice' || file.mime_type?.startsWith('audio/');
  const displayName = driveFileDisplayName(file);
  const thumbUrl = (file.thumb_data_url || file.thumbDataUrl || '') as string;
  const isSavedMessages = file.is_saved_messages || file.peer_kind === 'saved_messages' || file.peer_id === 'me';

  const captionText = file.original_name || file.name || '';
  const dateFormatted = file.created_at
    ? new Date(file.created_at).toLocaleString([], {
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      })
    : '';

  const timeOnly = file.created_at
    ? new Date(file.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '12:00';

  const senderName = isSavedMessages
    ? t('speedtest.account_saved_messages', { defaultValue: 'Saved Messages' })
    : chatName || file.peer_username || t('speedtest.tg_preview_sender_unknown');

  const handleCopyCaption = async () => {
    if (!captionText) return;
    try {
      await navigator.clipboard.writeText(captionText);
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 2000);
    } catch (err) {
      console.error('[TelegramMessagePreviewModal] Copy text failed:', err);
    }
  };

  const handleCopyLink = async () => {
    if (!tgUrl) return;
    try {
      await navigator.clipboard.writeText(tgUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('[TelegramMessagePreviewModal] Copy link failed:', err);
    }
  };

  const handleOpenTelegram = async () => {
    if (!tgUrl) return;
    try {
      await openUrl(tgUrl);
    } catch (err) {
      console.error('[TelegramMessagePreviewModal] Open Telegram link failed:', err);
    }
  };

  const modalNode = (
    <div
      className="tg-msg-preview-backdrop"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="tg-msg-preview-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('speedtest.tg_preview_title')}
      >
        {/* Header */}
        <div className="tg-msg-preview-header">
          <div className="tg-msg-preview-header-left">
            <div className="tg-msg-preview-brand-icon">
              <MessageSquare size={16} />
            </div>
            <div>
              <div className="tg-msg-preview-title">
                {t('speedtest.tg_preview_title')}
              </div>
              <div className="tg-msg-preview-subtitle">
                {senderName} {topicName ? `· #${topicName}` : ''} {file.id ? `· ID #${file.id}` : ''}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="tg-msg-preview-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Telegram Chat Wallpaper Canvas */}
        <div className="tg-msg-preview-canvas">
          {/* Telegram Bubble */}
          <div className="tg-msg-bubble">
            {/* Sender / Chat Title */}
            <div className="tg-msg-bubble-sender">
              <span>{senderName}</span>
              {topicName && (
                <span className="tg-msg-bubble-topic-badge">#{topicName}</span>
              )}
            </div>

            {/* Media Attachment Preview (if image/video or thumb exists) */}
            {thumbUrl && thumbUrl.startsWith('data:image/') ? (
              <div className="tg-msg-bubble-media">
                <img
                  src={thumbUrl}
                  alt={displayName}
                  className="tg-msg-bubble-media-img"
                />
                {isVideo && (
                  <div className="tg-msg-bubble-video-badge">
                    <Video size={14} />
                    <span>{formatDriveBytes(file.size)}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="tg-msg-bubble-doc-card">
                <div className="tg-msg-bubble-doc-icon">
                  {isVideo ? (
                    <Video size={20} />
                  ) : isImage ? (
                    <ImageIcon size={20} />
                  ) : isAudio ? (
                    <Music size={20} />
                  ) : (
                    <FileText size={20} />
                  )}
                </div>
                <div className="tg-msg-bubble-doc-info">
                  <div className="tg-msg-bubble-doc-name" title={displayName}>
                    {displayName}
                  </div>
                  <div className="tg-msg-bubble-doc-size">
                    {formatDriveBytes(file.size)}
                  </div>
                </div>
              </div>
            )}

            {/* Message Caption Text */}
            {captionText && captionText !== displayName ? (
              <div className="tg-msg-bubble-text">{captionText}</div>
            ) : (
              <div className="tg-msg-bubble-text is-filename">{displayName}</div>
            )}

            {/* Bubble Meta Timestamp + Checkmark */}
            <div className="tg-msg-bubble-meta">
              <span className="tg-msg-bubble-time">{dateFormatted || timeOnly}</span>
              <CheckCheck size={14} className="tg-msg-bubble-check" />
            </div>
          </div>
        </div>

        {/* Footer Action Buttons */}
        <div className="tg-msg-preview-footer">
          <button
            type="button"
            className="tg-msg-action-btn"
            onClick={handleCopyCaption}
            title={captionText}
          >
            {copiedCaption ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
            <span>
              {copiedCaption
                ? t('speedtest.tg_preview_copied')
                : t('speedtest.tg_preview_copy_caption')}
            </span>
          </button>

          {tgUrl && (
            <button
              type="button"
              className="tg-msg-action-btn"
              onClick={handleCopyLink}
            >
              {copiedLink ? <Check size={14} color="#10b981" /> : <Share2 size={14} />}
              <span>
                {copiedLink
                  ? t('speedtest.tg_preview_copied')
                  : t('speedtest.ctx_menu_copy_tg')}
              </span>
            </button>
          )}

          {tgUrl && (
            <button
              type="button"
              className="tg-msg-action-btn is-primary"
              onClick={handleOpenTelegram}
            >
              <ExternalLink size={14} />
              <span>{t('speedtest.ctx_menu_open_tg')}</span>
            </button>
          )}

          <button
            type="button"
            className="tg-msg-action-btn is-close"
            onClick={onClose}
          >
            <span>{t('ui.close', { defaultValue: 'Tutup' })}</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalNode, document.body);
}
