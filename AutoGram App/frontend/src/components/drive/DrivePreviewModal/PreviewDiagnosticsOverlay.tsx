import { Copy, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PreviewDiagnosticEvent, TrafficSnapshot } from '../../../lib/tauri/rustBackend';

type PreviewDiagnosticsOverlayProps = {
  events: PreviewDiagnosticEvent[];
  traffic: TrafficSnapshot | null;
  onClose: () => void;
  onClear: () => void;
};

function formatRate(value?: number | null): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '—';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current >= 10 ? current.toFixed(0) : current.toFixed(1)} ${units[unit]}`;
}

function detailText(details: Record<string, unknown>): string {
  const values = Object.entries(details)
    .slice(0, 5)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  return values.join(' · ');
}

export function PreviewDiagnosticsOverlay({
  events,
  traffic,
  onClose,
  onClear,
}: PreviewDiagnosticsOverlayProps) {
  const { t } = useTranslation();
  const runwayLabel = traffic?.previewRunwaySeconds != null
    ? `${traffic.previewRunwaySeconds.toFixed(1)} s`
    : traffic?.previewObservation === 'waiting_metadata'
      ? t('drive.preview_log_waiting_metadata')
      : traffic?.previewObservation === 'idle'
        ? t('drive.preview_log_idle')
        : traffic?.previewObservation === 'not_observable'
          ? t('drive.preview_log_not_observable')
          : '—';
  const copy = async () => {
    const data = JSON.stringify({ traffic, events }, null, 2);
    try {
      await navigator.clipboard.writeText(data);
    } catch {
      // Clipboard support is optional; diagnostics remain readable in the overlay.
    }
  };

  return (
    <aside
      className="drive-preview-diagnostics"
      role="dialog"
      aria-label={t('drive.preview_log_title')}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="drive-preview-info-head">
        <strong className="drive-preview-info-title">{t('drive.preview_log_title')}</strong>
        <div className="drive-preview-diagnostics-actions">
          <button type="button" className="td-icon-btn drive-preview-info-close" title={t('drive.preview_log_copy')} onClick={() => void copy()}>
            <Copy size={13} />
          </button>
          <button type="button" className="td-icon-btn drive-preview-info-close" title={t('drive.preview_log_clear')} onClick={onClear}>
            <Trash2 size={13} />
          </button>
          <button type="button" className="td-icon-btn drive-preview-info-close" title={t('drive.close_info')} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      <dl className="drive-preview-diagnostics-summary">
        <div><dt>{t('drive.preview_log_buffer_runway')}</dt><dd>{runwayLabel}</dd></div>
        <div><dt>{t('drive.preview_log_stream')}</dt><dd>{formatRate(traffic?.stream.goodputBps)}</dd></div>
        <div><dt>{t('drive.preview_log_download')}</dt><dd>{formatRate(traffic?.download.goodputBps)}</dd></div>
        <div><dt>{t('drive.preview_log_upload')}</dt><dd>{formatRate(traffic?.upload.goodputBps)}</dd></div>
        <div><dt>{t('drive.preview_log_governor')}</dt><dd>{traffic?.governorReason || '—'}</dd></div>
      </dl>

      <div className="drive-preview-diagnostics-events" aria-live="polite">
        {events.length === 0 ? (
          <p>{t('drive.preview_log_empty')}</p>
        ) : (
          events.slice().reverse().map((entry) => (
            <article className={`is-${entry.level}`} key={`${entry.sequence}-${entry.timestampMs}`}>
              <time>{new Date(entry.timestampMs).toLocaleTimeString()}</time>
              <strong>{entry.category} · {entry.event}</strong>
              {Object.keys(entry.details || {}).length > 0 && <span>{detailText(entry.details)}</span>}
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
