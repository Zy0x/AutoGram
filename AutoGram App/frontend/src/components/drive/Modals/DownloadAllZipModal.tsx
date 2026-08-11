import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CheckCircle2, FileArchive, Loader2, RefreshCw, X } from 'lucide-react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { countPerspectiveMedia } from '../utils/mediaStatistics';

export type ZipCategory = 'all' | 'images' | 'videos' | 'audio' | 'documents' | 'archives';

type Props = {
  open: boolean;
  locationLabel: string;
  indexing: boolean;
  ready: boolean;
  scannedCount: number;
  expectedCount: number | null;
  indexedFiles: DriveFile[];
  error?: string | null;
  onIndex: () => void;
  onCreate: (category: ZipCategory) => void;
  onClose: () => void;
};

export function DownloadAllZipModal({
  open,
  locationLabel,
  indexing,
  ready,
  scannedCount,
  expectedCount,
  indexedFiles,
  error,
  onIndex,
  onCreate,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ZipCategory>('all');
  const counts = useMemo(() => countPerspectiveMedia(indexedFiles, 'drive'), [indexedFiles]);
  const selectedCount = category === 'all' ? indexedFiles.length : counts[category] || 0;
  if (!open) return null;

  const categories: ZipCategory[] = ['all', 'images', 'videos', 'audio', 'documents', 'archives'];
  const progress = expectedCount && expectedCount > 0
    ? Math.min(100, Math.round((scannedCount / expectedCount) * 100))
    : indexing ? 12 : ready ? 100 : 0;

  return (
    <div className="td-modal-backdrop td-zip-preflight-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="td-zip-preflight"
        role="dialog"
        aria-modal="true"
        aria-labelledby="td-zip-preflight-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="td-zip-preflight-header">
          <div className="td-zip-preflight-icon"><FileArchive size={20} /></div>
          <div>
            <h2 id="td-zip-preflight-title">{t('speedtest.zip_preflight_title')}</h2>
            <p>{t('speedtest.zip_preflight_location', { location: locationLabel })}</p>
          </div>
          <button type="button" className="td-icon-btn" onClick={onClose} aria-label={t('speedtest.close_aria')}>
            <X size={17} />
          </button>
        </header>

        <div className={`td-zip-index-card${ready ? ' is-ready' : ''}`} data-index-ready={ready ? 'true' : 'false'}>
          <div className="td-zip-index-row">
            <span className="td-zip-index-status">
              {indexing ? <Loader2 size={16} className="spin" /> : ready ? <CheckCircle2 size={16} /> : <Archive size={16} />}
              <strong>{indexing ? t('speedtest.zip_indexing') : ready ? t('speedtest.zip_index_ready') : t('speedtest.zip_index_required')}</strong>
            </span>
            <span className="td-zip-index-count">
              {expectedCount != null ? `${scannedCount.toLocaleString()} / ${expectedCount.toLocaleString()}` : scannedCount.toLocaleString()}
            </span>
          </div>
          <div className="td-zip-progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} role="progressbar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>{t('speedtest.zip_index_explain')}</p>
          {error && <div className="td-zip-error" role="alert">{error}</div>}
        </div>

        <div className="td-zip-options" aria-disabled={!ready}>
          <div className="td-zip-options-heading">
            <strong>{t('speedtest.zip_include_heading')}</strong>
            <span>{t('speedtest.zip_selected_count', { count: selectedCount.toLocaleString() })}</span>
          </div>
          <div className="td-zip-category-grid" role="radiogroup" aria-label={t('speedtest.zip_include_heading')}>
            {categories.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={category === id}
                className={category === id ? 'is-active' : ''}
                disabled={!ready}
                onClick={() => setCategory(id)}
              >
                <span>{t(`speedtest.zip_category_${id}`)}</span>
                <b>{(id === 'all' ? indexedFiles.length : counts[id] || 0).toLocaleString()}</b>
              </button>
            ))}
          </div>
        </div>

        <footer className="td-zip-preflight-actions">
          <button type="button" className="td-btn-secondary" onClick={onClose}>{t('speedtest.cancel')}</button>
          <button type="button" className="td-btn-secondary" onClick={onIndex} disabled={indexing}>
            <RefreshCw size={15} className={indexing ? 'spin' : undefined} />
            {ready ? t('speedtest.zip_rescan') : t('speedtest.zip_start_index')}
          </button>
          <button
            type="button"
            className="td-btn-primary"
            disabled={!ready || indexing || selectedCount === 0}
            onClick={() => onCreate(category)}
          >
            <FileArchive size={16} />
            {t('speedtest.zip_create_button', { count: selectedCount.toLocaleString() })}
          </button>
        </footer>
      </section>
    </div>
  );
}
