import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  FileCode,
  Copy,
  Check,
  Download,
  FileWarning,
  Film,
  Music,
  Image as ImageIcon,
  FileText,
  Archive,
  File,
  Lock,
  Zap,
  AlertCircle
} from 'lucide-react';
import { VSCodeCodeViewer } from '../../common/VSCodeCodeViewer';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import type { ZipEntry, ZipPreviewResult } from './zipUtils';

type ZipCodePreviewModalProps = {
  entry: ZipEntry | null;
  preview: ZipPreviewResult | null;
  localUrl?: string | null;
  isLoading: boolean;
  error: string | null;
  onExtract?: () => void;
  onClose: () => void;
};

function getFileTypeMeta(filename: string, kind: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', '3gp'].includes(ext) || kind === 'video') {
    return {
      icon: Film,
      color: '#38bdf8',
      bgColor: 'rgba(56, 189, 248, 0.12)',
      label: ext.toUpperCase() || 'VIDEO',
      isMedia: true,
    };
  }

  if (['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus', 'wma'].includes(ext) || kind === 'audio') {
    return {
      icon: Music,
      color: '#34d399',
      bgColor: 'rgba(52, 211, 153, 0.12)',
      label: ext.toUpperCase() || 'AUDIO',
      isMedia: true,
    };
  }

  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif', 'heic'].includes(ext) || kind === 'image') {
    return {
      icon: ImageIcon,
      color: '#c084fc',
      bgColor: 'rgba(192, 132, 252, 0.12)',
      label: ext.toUpperCase() || 'IMAGE',
      isMedia: true,
    };
  }

  if (['js', 'ts', 'tsx', 'jsx', 'json', 'rs', 'py', 'html', 'css', 'sql', 'sh', 'md', 'xml', 'yaml', 'yml', 'toml'].includes(ext) || kind === 'text') {
    return {
      icon: FileCode,
      color: '#fbbf24',
      bgColor: 'rgba(251, 191, 36, 0.12)',
      label: ext.toUpperCase() || 'CODE',
      isMedia: false,
    };
  }

  if (ext === 'pdf' || kind === 'pdf') {
    return {
      icon: FileText,
      color: '#fb7185',
      bgColor: 'rgba(251, 113, 133, 0.12)',
      label: 'PDF',
      isMedia: false,
    };
  }

  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) {
    return {
      icon: Archive,
      color: '#818cf8',
      bgColor: 'rgba(129, 140, 248, 0.12)',
      label: ext.toUpperCase() || 'ARCHIVE',
      isMedia: false,
    };
  }

  return {
    icon: File,
    color: '#94a3b8',
    bgColor: 'rgba(148, 163, 184, 0.12)',
    label: ext.toUpperCase() || 'FILE',
    isMedia: false,
  };
}

export const ZipCodePreviewModal: React.FC<ZipCodePreviewModalProps> = ({
  entry,
  preview,
  localUrl,
  isLoading,
  error,
  onExtract,
  onClose,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!entry) return null;

  const content = preview?.text || null;
  const mediaUrl = preview?.data_url || localUrl || null;
  const kind = preview?.kind || 'meta';
  const meta = getFileTypeMeta(entry.name, kind);
  const IconComponent = meta.icon;

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const compressionRatio =
    entry.compressed_size != null && entry.size > 0 && entry.compressed_size < entry.size
      ? Math.round(((entry.size - entry.compressed_size) / entry.size) * 100)
      : null;

  return (
    <div className="dzb-modal-overlay" role="dialog" aria-modal="true" aria-label={entry.name}>
      <div className="dzb-modal-card dzb-preview-modal">
        {/* Header Toolbar */}
        <div className="dzb-preview-header">
          <div className="dzb-preview-header-left">
            <div
              className="dzb-preview-icon-badge"
              style={{ backgroundColor: meta.bgColor, color: meta.color }}
            >
              <IconComponent size={18} strokeWidth={2.2} />
            </div>

            <div className="dzb-preview-title-col">
              <div className="dzb-preview-filename" title={entry.name}>
                {entry.name}
              </div>

              <div className="dzb-preview-tags">
                <span className="dzb-preview-tag-pill dzb-pill-type" style={{ color: meta.color }}>
                  {meta.label}
                </span>

                <span className="dzb-preview-tag-pill dzb-pill-size">
                  {formatDriveBytes(entry.size)}
                </span>

                {compressionRatio != null && (
                  <span className="dzb-preview-tag-pill dzb-pill-ratio">
                    {t('speedtest.zip_ratio_tag', { ratio: compressionRatio })}
                  </span>
                )}

                {entry.encrypted && (
                  <span className="dzb-preview-tag-pill dzb-pill-encrypted">
                    <Lock size={11} />
                    <span>{t('speedtest.zip_tag_encrypted')}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="dzb-preview-header-actions">
            {content && (
              <button
                type="button"
                onClick={handleCopy}
                className="dzb-btn-secondary dzb-btn-compact dzb-preview-action-btn"
                title={t(copied ? 'speedtest.zip_btn_copied' : 'speedtest.zip_btn_copy')}
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{t(copied ? 'speedtest.zip_btn_copied' : 'speedtest.zip_btn_copy')}</span>
              </button>
            )}

            {onExtract && (
              <button
                type="button"
                onClick={onExtract}
                className="dzb-btn-primary dzb-btn-compact dzb-preview-action-btn"
                title={t('speedtest.zip_extract_entry')}
              >
                <Download size={14} />
                <span>{t('speedtest.zip_extract_entry')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="dzb-preview-close-btn"
              title={t('speedtest.zip_close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body with Rich Media Viewers */}
        <div className="dzb-modal-body dzb-preview-body">
          {isLoading ? (
            <div className="dzb-preview-loading-card">
              <div className="dzb-dual-ring-wrap">
                <div className="dzb-dual-ring-spinner" />
                <div
                  className="dzb-loading-icon-center"
                  style={{ color: meta.color }}
                >
                  <IconComponent size={22} />
                </div>
              </div>

              <div className="dzb-loading-title-box">
                <h4 className="dzb-loading-title">{t('speedtest.zip_reading_entry')}</h4>
                <p className="dzb-loading-sub">{t('speedtest.zip_sparse_reading_dots')}</p>
              </div>

              <div className="dzb-loading-shimmer-bar">
                <div className="dzb-loading-shimmer-thumb" />
              </div>

              <div className="dzb-loading-badge">
                <Zap size={12} className="text-amber-400" />
                <span>{t('speedtest.zip_sparse_direct_decrypt')}</span>
              </div>
            </div>
          ) : error ? (
            <div className="dzb-preview-error-card">
              <div className="dzb-error-icon-wrap">
                <AlertCircle size={36} className="text-rose-400" />
              </div>
              <h4 className="dzb-error-title">{t('speedtest.zip_thumbnail_failed')}</h4>
              <p className="dzb-error-msg">{error}</p>
            </div>
          ) : kind === 'text' && content != null ? (
            <div className="dzb-preview-code-wrap">
              <VSCodeCodeViewer text={content} name={entry.name} />
            </div>
          ) : kind === 'image' && mediaUrl ? (
            <div className="dzb-preview-image-wrap">
              <img className="dzb-preview-image" src={mediaUrl} alt={entry.name} />
            </div>
          ) : kind === 'video' && mediaUrl ? (
            <div className="dzb-preview-video-wrap">
              <video
                className="dzb-preview-video"
                src={mediaUrl}
                controls
                autoPlay
                preload="metadata"
                playsInline
              />
            </div>
          ) : kind === 'audio' && mediaUrl ? (
            <div className="dzb-preview-audio-card">
              <div className="dzb-audio-disc-wrap">
                <div className="dzb-audio-disc">
                  <div className="dzb-audio-disc-center">
                    <Music size={24} className="text-emerald-400" />
                  </div>
                </div>
              </div>

              <div className="dzb-audio-details">
                <h4 className="dzb-audio-name" title={entry.name}>{entry.name}</h4>
                <span className="dzb-audio-size">{formatDriveBytes(entry.size)}</span>
              </div>

              <div className="dzb-audio-player-box">
                <audio
                  className="dzb-preview-audio-element"
                  src={mediaUrl}
                  controls
                  autoPlay
                  preload="metadata"
                />
              </div>
            </div>
          ) : kind === 'pdf' && mediaUrl ? (
            <div className="dzb-preview-pdf-wrap">
              <iframe className="dzb-preview-pdf" src={mediaUrl} title={entry.name} />
            </div>
          ) : (
            <div className="dzb-preview-binary-card">
              <div className="dzb-binary-icon-wrap">
                <FileWarning size={48} className="text-amber-400" />
              </div>
              <h3 className="dzb-binary-title">{t('speedtest.zip_binary_title')}</h3>
              <p className="dzb-binary-desc">{t('speedtest.zip_binary_desc')}</p>
              <div className="dzb-binary-meta">
                <span>{formatDriveBytes(entry.size)}</span>
              </div>
              {onExtract && (
                <button
                  type="button"
                  onClick={onExtract}
                  className="dzb-btn-primary dzb-binary-extract-btn"
                >
                  <Download size={16} />
                  <span>{t('speedtest.zip_preview_extract_btn')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
