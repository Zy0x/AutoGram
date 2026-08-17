import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  CheckCircle2,
  Clock,
  Database,
  FileArchive,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
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
  totalBytes?: number | null;
  error?: string | null;
  onIndex: () => void;
  onCreate: (category: ZipCategory) => void;
  onClose: () => void;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DownloadAllZipModal({
  open,
  locationLabel,
  indexing,
  ready,
  scannedCount,
  expectedCount,
  indexedFiles,
  totalBytes,
  error,
  onIndex,
  onCreate,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ZipCategory>('all');
  const counts = useMemo(() => countPerspectiveMedia(indexedFiles, 'drive'), [indexedFiles]);
  const selectedCount = category === 'all' ? indexedFiles.length : counts[category] || 0;

  // Selected files byte calculation
  const selectedBytes = useMemo(() => {
    if (!ready || !indexedFiles.length) return totalBytes || 0;
    if (category === 'all') {
      return indexedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    }
    return indexedFiles
      .filter((f) => {
        const countsObj = countPerspectiveMedia([f], 'drive');
        return countsObj[category] > 0;
      })
      .reduce((sum, f) => sum + (f.size || 0), 0);
  }, [ready, indexedFiles, category, totalBytes]);

  if (!open) return null;

  const categories: ZipCategory[] = ['all', 'images', 'videos', 'audio', 'documents', 'archives'];
  const progress = expectedCount && expectedCount > 0
    ? Math.min(100, Math.round((scannedCount / expectedCount) * 100))
    : indexing ? 15 : ready ? 100 : 0;

  // Estimation metrics for pre-scan state
  const totalFilesEstimate = expectedCount && expectedCount > 0
    ? expectedCount
    : Math.max(scannedCount, indexedFiles.length, 1);
  const remainingFilesToIndex = ready ? 0 : Math.max(0, totalFilesEstimate - scannedCount);
  const estIndexSeconds = ready
    ? 0
    : Math.max(2, Math.ceil((remainingFilesToIndex / 250) * 1.3));
  const estTimeFormatted = estIndexSeconds < 60
    ? `~${estIndexSeconds}s`
    : `~${Math.ceil(estIndexSeconds / 60)} min`;

  const estTotalSizeFormatted = selectedBytes > 0
    ? formatBytes(selectedBytes)
    : formatBytes(totalFilesEstimate * 1.8 * 1024 * 1024);

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
          <div className="td-zip-preflight-icon"><FileArchive size={22} /></div>
          <div>
            <h2 id="td-zip-preflight-title">{t('speedtest.zip_preflight_title')}</h2>
            <p>{t('speedtest.zip_preflight_location', { location: locationLabel })}</p>
          </div>
          <button type="button" className="td-icon-btn" onClick={onClose} aria-label={t('speedtest.close_aria')}>
            <X size={17} />
          </button>
        </header>

        {/* 1. Pre-Scan Estimation Summary Card (Visible when idle / not yet indexed) */}
        {!ready && !indexing && (
          <div className="td-zip-pre-card">
            <div className="td-zip-pre-header">
              <span className="td-zip-pre-badge">
                <Sparkles size={14} />
                <strong>{t('speedtest.zip_pre_estimation_heading')}</strong>
              </span>
              <span className="td-zip-pre-location">{locationLabel}</span>
            </div>

            <div className="td-zip-est-grid">
              <div className="td-zip-est-box">
                <div className="td-zip-est-label">
                  <Database size={13} />
                  <span>{t('speedtest.zip_pre_files_est')}</span>
                </div>
                <div className="td-zip-est-val">
                  {totalFilesEstimate.toLocaleString()}
                  <span className="td-zip-est-unit">{t('speedtest.zip_pre_items_unit')}</span>
                </div>
              </div>

              <div className="td-zip-est-box">
                <div className="td-zip-est-label">
                  <Clock size={13} />
                  <span>{t('speedtest.zip_pre_time_est')}</span>
                </div>
                <div className="td-zip-est-val">
                  {estTimeFormatted}
                  <span className="td-zip-est-unit-safe" title={t('speedtest.zip_pre_flood_safe')}>
                    <Zap size={10} /> {t('speedtest.zip_pre_safe_pace')}
                  </span>
                </div>
              </div>

              <div className="td-zip-est-box">
                <div className="td-zip-est-label">
                  <HardDrive size={13} />
                  <span>{t('speedtest.zip_pre_size_est')}</span>
                </div>
                <div className="td-zip-est-val">
                  {estTotalSizeFormatted}
                </div>
              </div>
            </div>

            <div className="td-zip-resilience-banner">
              <ShieldCheck size={16} className="td-zip-resilience-icon" />
              <p>{t('speedtest.zip_pre_resilience_badge')}</p>
            </div>
          </div>
        )}

        {/* 2. Live Indexing Progress or Ready Card */}
        {(indexing || ready) && (
          <div className={`td-zip-index-card${ready ? ' is-ready' : ''}`} data-index-ready={ready ? 'true' : 'false'}>
            <div className="td-zip-index-row">
              <span className="td-zip-index-status">
                {indexing ? <Loader2 size={16} className="spin" /> : ready ? <CheckCircle2 size={16} /> : <Archive size={16} />}
                <strong>{indexing ? t('speedtest.zip_indexing') : ready ? t('speedtest.zip_ready_all_scanned') : t('speedtest.zip_index_required')}</strong>
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
        )}

        {/* 3. Category Filter Selection (Active when ready) */}
        <div className="td-zip-options" aria-disabled={!ready}>
          <div className="td-zip-options-heading">
            <strong>{t('speedtest.zip_include_heading')}</strong>
            <span>
              {t('speedtest.zip_selected_count', { count: selectedCount.toLocaleString() })}
              {ready && selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ''}
            </span>
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
          <button type="button" className="td-btn-secondary" onClick={onClose}>{t('speedtest.zip_btn_cancel')}</button>
          
          {!ready ? (
            <button
              type="button"
              className="td-btn-primary td-zip-btn-start"
              onClick={onIndex}
              disabled={indexing}
            >
              {indexing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
              {indexing ? t('speedtest.zip_indexing') : t('speedtest.zip_btn_start_index')}
            </button>
          ) : (
            <>
              <button type="button" className="td-btn-secondary" onClick={onIndex} disabled={indexing}>
                <RefreshCw size={15} className={indexing ? 'spin' : undefined} />
                {t('speedtest.zip_rescan')}
              </button>
              <button
                type="button"
                className="td-btn-primary"
                disabled={!ready || indexing || selectedCount === 0}
                onClick={() => onCreate(category)}
              >
                <FileArchive size={16} />
                {t('speedtest.zip_create_button', { count: selectedCount.toLocaleString() })}
                {selectedBytes > 0 ? ` (${formatBytes(selectedBytes)})` : ''}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
