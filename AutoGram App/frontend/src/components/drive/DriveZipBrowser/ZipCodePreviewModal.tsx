import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileCode, Copy, Check } from 'lucide-react';
import { VSCodeCodeViewer } from '../../common/VSCodeCodeViewer';
import { ZipEntry } from './zipUtils';

type ZipCodePreviewModalProps = {
  entry: ZipEntry | null;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
};

export const ZipCodePreviewModal: React.FC<ZipCodePreviewModalProps> = ({
  entry,
  content,
  isLoading,
  error,
  onClose,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);

  if (!entry) return null;

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="dzb-modal-overlay">
      <div className="dzb-modal-card" style={{ height: '85vh' }}>
        <div className="dzb-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <FileCode size={18} style={{ color: '#818cf8', flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.name}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {content && (
              <button
                type="button"
                onClick={handleCopy}
                className="dzb-btn-secondary"
                style={{ height: '36px', minHeight: '36px', padding: '0 10px', fontSize: '0.78rem' }}
              >
                {copied ? <Check size={14} style={{ color: '#34d399' }} /> : <Copy size={14} />}
                <span>{copied ? t('speedtest.zip_btn_copied', 'Copied') : t('speedtest.zip_btn_copy', 'Copy')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="dzb-action-icon-btn"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="dzb-modal-body" style={{ background: '#050810', padding: 0 }}>
          {isLoading ? (
            <div className="dzb-loading-box">
              <div className="dzb-spinner" />
              <span>{t('speedtest.zip_reading_entry', 'Extracting & reading entry…')}</span>
            </div>
          ) : error ? (
            <div className="dzb-error-box" style={{ color: '#f87171' }}>
              <span>{error}</span>
            </div>
          ) : (
            <VSCodeCodeViewer text={content || ''} name={entry.name} />
          )}
        </div>
      </div>
    </div>
  );
};
