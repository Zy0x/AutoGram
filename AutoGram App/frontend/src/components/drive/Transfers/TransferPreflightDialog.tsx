import { AlertTriangle, CheckCircle2, FileSearch, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import type { QualityPreflightReport } from '../../../lib/transfer/qualityPreflight';

type Props = {
  report: QualityPreflightReport | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function TransferPreflightDialog({ report, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  if (!report) return null;

  const visibleItems = report.items.slice(0, 100);
  const hiddenCount = Math.max(0, report.items.length - visibleItems.length);

  return (
    <div className="td-xfer-settings-overlay td-preflight-overlay" role="presentation">
      <section className="td-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-preflight-title">
        <header className="td-xfer-settings-head">
          <div className="td-xfer-settings-title">
            <FileSearch size={20} aria-hidden />
            <div>
              <h2 id="transfer-preflight-title">{t('speedtest.preflight_title')}</h2>
              <p>{t('speedtest.preflight_subtitle')}</p>
            </div>
          </div>
          <button type="button" className="td-icon-btn" onClick={onCancel} aria-label={t('speedtest.topbar_cancel')}>
            <X size={18} />
          </button>
        </header>

        <div className="td-preflight-summary" role="status">
          <span>{t('speedtest.preflight_item_count', { count: report.items.length })}</span>
          <span>{t('speedtest.preflight_limit', { value: formatDriveBytes(report.effectiveMaxBytes) })}</span>
          <span>{t('speedtest.preflight_caption_limit', { count: report.captionLimit })}</span>
          <span>{t(`speedtest.preflight_capability_${report.capabilitySource}`)}</span>
        </div>

        {report.engineMode === 'safe_rollback' && (
          <div className="td-xfer-note" role="status">
            <AlertTriangle size={16} aria-hidden />
            <span>{t('speedtest.preflight_safe_rollback')}</span>
          </div>
        )}

        {report.captionSummaryIndex != null && (
          <div className="td-xfer-note" role="status">
            <CheckCircle2 size={16} aria-hidden />
            <span>{t('speedtest.preflight_caption_assignment', { index: report.captionSummaryIndex + 1 })}</span>
          </div>
        )}

        {report.captionWarnings.map((warning) => (
          <div className="td-xfer-note" role="alert" key={warning}>
            <AlertTriangle size={16} aria-hidden />
            <span>{t(`speedtest.preflight_warning_${warning}`, {
              length: report.captionLengthUtf16,
              limit: report.captionLimit,
            })}</span>
          </div>
        ))}

        {report.albumIsProvisional && (
          <div className="td-xfer-note">
            <AlertTriangle size={16} aria-hidden />
            <span>{t('speedtest.preflight_album_provisional')}</span>
          </div>
        )}

        <div className="td-preflight-items">
          {visibleItems.map((item) => (
            <article className="td-preflight-item" key={`${item.index}-${item.sourceName}`}>
              <div className="td-preflight-item-head">
                {item.requiresConfirmation ? <AlertTriangle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
                <strong>{item.index + 1}. {item.sourceName}</strong>
                <span>{formatDriveBytes(item.sourceSize)}</span>
              </div>
              <dl>
                <div><dt>{t('speedtest.preflight_category')}</dt><dd>{t(`speedtest.preflight_category_${item.category}`)}</dd></div>
                <div><dt>{t('speedtest.preflight_transform')}</dt><dd>{t(`speedtest.preflight_transform_${item.transform}`)}</dd></div>
                <div><dt>{t('speedtest.preflight_payload')}</dt><dd>{t(`speedtest.preflight_payload_${item.payloadClass}`)}</dd></div>
                <div><dt>{t('speedtest.preflight_album')}</dt><dd>{t(item.albumEligible ? 'speedtest.preflight_album_eligible' : 'speedtest.preflight_album_separate')}</dd></div>
              </dl>
              <p className="td-preflight-reason">{t(`speedtest.preflight_reason_${item.reasonCode}`)}</p>
              {!!item.warnings.length && (
                <ul>
                  {item.warnings.map((warning) => <li key={warning}>{t(`speedtest.preflight_warning_${warning}`)}</li>)}
                </ul>
              )}
              {!!item.rejectedAlternatives.length && (
                <p className="td-xfer-hint">
                  {t('speedtest.preflight_rejected')}: {item.rejectedAlternatives.map((reason) => t(`speedtest.preflight_rejected_${reason}`)).join(', ')}
                </p>
              )}
            </article>
          ))}
          {hiddenCount > 0 && <p className="td-xfer-hint">{t('speedtest.preflight_more_items', { count: hiddenCount })}</p>}
        </div>

        <footer className="td-xfer-settings-foot">
          <button type="button" className="td-chip-btn" onClick={onCancel}>{t('speedtest.topbar_cancel')}</button>
          <button type="button" className="td-btn-primary" onClick={onConfirm} disabled={report.hasBlockingIssues}>{t('speedtest.preflight_confirm')}</button>
        </footer>
      </section>
    </div>
  );
}
