import React from 'react';
import { useTranslation } from 'react-i18next';
import { FolderInput, CheckSquare, X, Layers } from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';

type ZipFloatingActionBarProps = {
  selectedCount: number;
  selectedBytes: number;
  onExtract: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  isAllSelected: boolean;
};

export const ZipFloatingActionBar: React.FC<ZipFloatingActionBarProps> = ({
  selectedCount,
  selectedBytes,
  onExtract,
  onSelectAll,
  onClear,
  isAllSelected,
}) => {
  const { t } = useTranslation();

  if (selectedCount <= 0) return null;

  return (
    <div className="dzb-floating-bar-wrap" role="toolbar" aria-label={t('speedtest.zip_batch_extract')}>
      <div className="dzb-floating-bar">
        <div className="dzb-floating-info">
          <Layers size={18} className="dzb-floating-icon" />
          <span className="dzb-floating-count">
            {t('speedtest.zip_batch_selected', {
              count: selectedCount,
              size: formatDriveBytes(selectedBytes),
            })}
          </span>
        </div>

        <div className="dzb-floating-actions">
          <button
            type="button"
            onClick={onSelectAll}
            className="dzb-floating-btn secondary"
            title={t('speedtest.zip_batch_select_all')}
          >
            <CheckSquare size={15} />
            <span>{isAllSelected ? t('speedtest.zip_batch_clear') : t('speedtest.zip_batch_select_all')}</span>
          </button>

          <button
            type="button"
            onClick={onExtract}
            className="dzb-floating-btn primary"
            title={t('speedtest.zip_batch_extract')}
          >
            <FolderInput size={16} />
            <span>{t('speedtest.zip_batch_extract')}</span>
          </button>

          <button
            type="button"
            onClick={onClear}
            className="dzb-floating-btn icon-only"
            title={t('speedtest.zip_batch_clear')}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
