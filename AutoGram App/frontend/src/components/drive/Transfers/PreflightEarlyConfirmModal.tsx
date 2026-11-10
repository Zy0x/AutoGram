import { HelpCircle, Loader2, Send, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface PreflightEarlyConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onSkipDuplicates: () => void;
  onSendAll: () => void;
  itemCount: number;
  duplicateCount: number;
  queuedCount: number;
  skippedCount: number;
}

export function PreflightEarlyConfirmModal({
  open,
  onClose,
  onSkipDuplicates,
  onSendAll,
  itemCount,
  duplicateCount,
  queuedCount,
  skippedCount,
}: PreflightEarlyConfirmModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="td-preflight-popover-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="td-early-confirm-title"
    >
      <div className="td-preflight-early-card" onClick={(e) => e.stopPropagation()}>
        <div className="td-preflight-early-head">
          <div className="td-preflight-early-title-row">
            <div className="td-preflight-early-icon">
              <HelpCircle size={18} aria-hidden />
            </div>
            <strong id="td-early-confirm-title">{t('drive.preflight_early_modal_title')}</strong>
          </div>
          <button
            type="button"
            className="td-preflight-popover-close"
            onClick={onClose}
            aria-label={t('drive.preflight_modal_close')}
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        <div className="td-preflight-early-body">
          <div className="td-preflight-early-status-badge">
            <Loader2 size={14} className="animate-spin text-sky-400" aria-hidden />
            <span>
              {t('drive.preflight_early_modal_status', {
                count: itemCount,
                dups: duplicateCount,
              })}
            </span>
          </div>

          <p className="td-preflight-early-desc">
            {t('drive.preflight_early_modal_desc')}
          </p>

          <div className="td-preflight-early-options">
            {/* Opsi 1: Lewati Duplikat (Rekomendasi) */}
            <button
              type="button"
              className="td-preflight-early-opt is-recommended"
              onClick={onSkipDuplicates}
            >
              <div className="td-preflight-early-opt-header">
                <div className="td-preflight-early-opt-icon is-skip">
                  <ShieldCheck size={20} aria-hidden />
                </div>
                <div className="td-preflight-early-opt-title-group">
                  <div className="td-preflight-early-opt-title-row">
                    <span className="td-preflight-early-opt-title">
                      {t('drive.preflight_early_opt_skip_title')}
                    </span>
                    <span className="td-preflight-early-badge-rec">
                      {t('drive.preflight_early_badge_recommended')}
                    </span>
                  </div>
                  <p className="td-preflight-early-opt-desc">
                    {t('drive.preflight_early_opt_skip_desc')}
                  </p>
                </div>
              </div>
              <div className="td-preflight-early-opt-action">
                <span className="td-preflight-early-opt-action-text">
                  {t('drive.preflight_early_opt_skip_btn', {
                    queue: queuedCount,
                    skip: skippedCount,
                  })}
                </span>
              </div>
            </button>

            {/* Opsi 2: Tetap Kirim Seluruhnya */}
            <button
              type="button"
              className="td-preflight-early-opt is-send-all"
              onClick={onSendAll}
            >
              <div className="td-preflight-early-opt-header">
                <div className="td-preflight-early-opt-icon is-send">
                  <Send size={18} aria-hidden />
                </div>
                <div className="td-preflight-early-opt-title-group">
                  <div className="td-preflight-early-opt-title-row">
                    <span className="td-preflight-early-opt-title">
                      {t('drive.preflight_early_opt_send_all_title')}
                    </span>
                  </div>
                  <p className="td-preflight-early-opt-desc">
                    {t('drive.preflight_early_opt_send_all_desc')}
                  </p>
                </div>
              </div>
              <div className="td-preflight-early-opt-action">
                <span className="td-preflight-early-opt-action-text">
                  {t('drive.preflight_early_opt_send_all_btn', { count: itemCount })}
                </span>
              </div>
            </button>
          </div>
        </div>

        <div className="td-preflight-early-foot">
          <button
            type="button"
            className="td-chip-btn"
            onClick={onClose}
          >
            {t('drive.preflight_early_wait_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}
