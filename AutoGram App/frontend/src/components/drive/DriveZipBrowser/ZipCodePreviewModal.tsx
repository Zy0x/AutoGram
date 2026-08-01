import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileCode, Copy, Check, Download, FileWarning } from 'lucide-react';
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
  const [copied, setCopied] = React.useState(false);

  if (!entry) return null;

  const content = preview?.text || null;
  const mediaUrl = preview?.data_url || localUrl || null;
  const kind = preview?.kind || 'meta';

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="dzb-modal-overlay" role="dialog" aria-modal="true" aria-label={entry.name}>
      <div className="dzb-modal-card dzb-preview-modal">
        <div className="dzb-modal-header">
          <div className="dzb-modal-title">
            <FileCode size={18} />
            <span title={entry.name}>{entry.name}</span>
          </div>

          <div className="dzb-modal-actions">
            {content && (
              <button type="button" onClick={handleCopy} className="dzb-btn-secondary dzb-btn-compact">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{t(copied ? 'speedtest.zip_btn_copied' : 'speedtest.zip_btn_copy')}</span>
              </button>
            )}
            {onExtract && (
              <button type="button" onClick={onExtract} className="dzb-btn-secondary dzb-btn-compact">
                <Download size={14} />
                <span>{t('speedtest.zip_extract_entry')}</span>
              </button>
            )}
            <button type="button" onClick={onClose} className="dzb-action-icon-btn" title={t('speedtest.zip_close')}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="dzb-modal-body dzb-preview-body">
          {isLoading ? (
            <div className="dzb-loading-box">
              <div className="dzb-spinner" />
              <span>{t('speedtest.zip_reading_entry')}</span>
            </div>
          ) : error ? (
            <div className="dzb-error-box"><span>{error}</span></div>
          ) : kind === 'text' && content != null ? (
            <VSCodeCodeViewer text={content} name={entry.name} />
          ) : kind === 'image' && mediaUrl ? (
            <img className="dzb-preview-image" src={mediaUrl} alt={entry.name} />
          ) : kind === 'video' && mediaUrl ? (
            <video className="dzb-preview-media" src={mediaUrl} controls autoPlay preload="metadata" />
          ) : kind === 'audio' && mediaUrl ? (
            <div className="dzb-preview-audio-wrap">
              <audio className="dzb-preview-audio" src={mediaUrl} controls autoPlay preload="metadata" />
            </div>
          ) : kind === 'pdf' && mediaUrl ? (
            <iframe className="dzb-preview-pdf" src={mediaUrl} title={entry.name} />
          ) : (
            <div className="dzb-binary-preview">
              <FileWarning size={42} />
              <h3>{t('speedtest.zip_binary_title')}</h3>
              <p>{t('speedtest.zip_binary_desc')}</p>
              <span>{formatDriveBytes(entry.size)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
