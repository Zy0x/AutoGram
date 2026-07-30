import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FolderInput, HardDrive, Folder } from 'lucide-react';
import { DriveFolder } from '../../../lib/telegram/driveTypes';

type ZipExtractModalProps = {
  isOpen: boolean;
  selectedCount: number;
  folders: DriveFolder[];
  onClose: () => void;
  onConfirmExtract: (targetFolderId: number | null) => void;
};

export const ZipExtractModal: React.FC<ZipExtractModalProps> = ({
  isOpen,
  selectedCount,
  folders,
  onClose,
  onConfirmExtract,
}) => {
  const { t } = useTranslation();
  const [targetFolderId, setTargetFolderId] = useState<number | null>(null);

  if (!isOpen) return null;

  return (
    <div className="dzb-modal-overlay">
      <div className="dzb-modal-card" style={{ maxWidth: '480px' }}>
        <div className="dzb-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderInput size={18} style={{ color: '#818cf8', flexShrink: 0 }} />
            <span>
              {t('speedtest.zip_extract_title', 'Extract ZIP File')} ({selectedCount})
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="dzb-action-icon-btn"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="dzb-modal-body">
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '12px' }}>
            {t('speedtest.zip_extract_dest_desc', 'Select target Drive folder where extracted files will be saved:')}
          </p>

          <div
            style={{
              maxHeight: '220px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              padding: '6px',
              background: '#050810',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              marginBottom: '16px',
            }}
          >
            <button
              type="button"
              onClick={() => setTargetFolderId(null)}
              className={`dzb-cat-tab ${targetFolderId === null ? 'active' : ''}`}
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                height: '44px',
                padding: '0 12px',
                borderRadius: '8px',
              }}
            >
              <HardDrive size={18} style={{ color: '#818cf8', flexShrink: 0 }} />
              <span>{t('speedtest.zip_drive_root', 'Saved Messages (Drive Root)')}</span>
            </button>

            {folders.map((f: any) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTargetFolderId(f.id)}
                className={`dzb-cat-tab ${targetFolderId === f.id ? 'active' : ''}`}
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  height: '44px',
                  padding: '0 12px',
                  borderRadius: '8px',
                }}
              >
                <Folder size={18} style={{ color: '#fbbf24', flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="dzb-modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="dzb-btn-secondary"
          >
            {t('speedtest.zip_btn_cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirmExtract(targetFolderId)}
            className="dzb-btn-primary"
          >
            {t('speedtest.zip_start_extract', 'Start Extraction')}
          </button>
        </div>
      </div>
    </div>
  );
};
