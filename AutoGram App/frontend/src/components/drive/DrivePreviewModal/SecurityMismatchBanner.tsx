import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ShieldAlert,
  FileQuestion,
  Wrench,
  CheckCircle2,
  Info,
  X,
  ShieldCheck,
  HelpCircle,
  ArrowRight,
  FileCode2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MagicSniffResult } from '../../../lib/media/magicBytesSniffer';

interface Props {
  sniffResult: MagicSniffResult;
  currentFilename: string;
  hexBytes?: Uint8Array | null;
  onFixExtension: (suggestedFilename: string) => void;
  isFixing?: boolean;
  onDismiss?: () => void;
}

export const SecurityMismatchBanner: React.FC<Props> = ({
  sniffResult,
  currentFilename,
  hexBytes,
  onFixExtension,
  isFixing = false,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const [showExplanationModal, setShowExplanationModal] = useState(false);

  if (sniffResult.severity === 'safe') return null;

  const isDanger = sniffResult.severity === 'danger' || sniffResult.isSuspiciousExecutable;
  const isWarning = sniffResult.severity === 'warning';
  const currentExt = currentFilename.split('.').pop()?.toLowerCase() || '';

  return (
    <>
      <div
        className={`td-mismatch-banner ${
          isDanger ? 'is-danger' : isWarning ? 'is-warning' : 'is-info'
        }`}
        role="alert"
      >
        <div className="td-mismatch-banner-main">
          <div className="td-mismatch-icon" aria-hidden="true">
            {isDanger ? (
              <ShieldAlert size={16} className="td-mismatch-danger-ico" />
            ) : isWarning ? (
              <AlertTriangle size={16} className="td-mismatch-warn-ico" />
            ) : (
              <FileQuestion size={16} className="td-mismatch-info-ico" />
            )}
          </div>
          <div className="td-mismatch-text">
            <div className="td-mismatch-title">
              {isDanger
                ? t('drive.security_danger_executable_title')
                : isWarning
                ? t('drive.security_mismatch_compact_title', {
                    format: sniffResult.formatLabel,
                    ext: sniffResult.detectedExt,
                  })
                : t('drive.security_missing_ext_title')}
            </div>
            {isDanger && (
              <div className="td-mismatch-desc">
                {t('drive.security_danger_executable_desc', {
                  format: sniffResult.formatLabel,
                  name: currentFilename,
                })}
              </div>
            )}
          </div>
        </div>

        <div className="td-mismatch-actions">
          {/* Info Button ("i") to open detailed explanation modal */}
          <button
            type="button"
            className="td-mismatch-info-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowExplanationModal(true);
            }}
            title={t('drive.security_mismatch_info_tooltip')}
            aria-label={t('drive.security_mismatch_info_tooltip')}
          >
            <Info size={15} />
          </button>

          {/* Quick Fix Extension button */}
          {!isDanger && sniffResult.suggestedFilename && (
            <button
              type="button"
              className="td-btn-primary td-btn-sm td-mismatch-fix-btn"
              onClick={() => onFixExtension(sniffResult.suggestedFilename)}
              disabled={isFixing}
              title={t('drive.security_fix_ext_tooltip')}
            >
              {isFixing ? (
                <CheckCircle2 size={13} className="animate-spin" />
              ) : (
                <Wrench size={13} />
              )}
              <span>
                {t('drive.security_fix_to_ext', {
                  ext: sniffResult.detectedExt,
                })}
              </span>
            </button>
          )}

          {/* Dismiss Button (✕) */}
          {onDismiss && (
            <button
              type="button"
              className="td-mismatch-dismiss-btn"
              onClick={onDismiss}
              title={t('drive.security_mismatch_dismiss_tooltip')}
              aria-label={t('drive.security_mismatch_dismiss_tooltip')}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Explanation Dialog Modal rendered via Portal */}
      {showExplanationModal &&
        createPortal(
          <ExtensionMismatchExplanationModal
            currentFilename={currentFilename}
            currentExt={currentExt}
            sniffResult={sniffResult}
            hexBytes={hexBytes}
            isDanger={isDanger}
            isFixing={isFixing}
            onClose={() => setShowExplanationModal(false)}
            onFixExtension={(newFilename) => {
              onFixExtension(newFilename);
              setShowExplanationModal(false);
            }}
          />,
          document.body
        )}
    </>
  );
};

interface ExplanationModalProps {
  currentFilename: string;
  currentExt: string;
  sniffResult: MagicSniffResult;
  hexBytes?: Uint8Array | null;
  isDanger: boolean;
  isFixing: boolean;
  onClose: () => void;
  onFixExtension: (suggestedFilename: string) => void;
}

const ExtensionMismatchExplanationModal: React.FC<ExplanationModalProps> = ({
  currentFilename,
  currentExt,
  sniffResult,
  isDanger,
  isFixing,
  onClose,
  onFixExtension,
}) => {
  const { t } = useTranslation();

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="td-mismatch-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="td-mismatch-dialog-title"
    >
      <div className="td-mismatch-modal-card">
        {/* Header */}
        <div className="td-mismatch-modal-header">
          <div className="td-mismatch-modal-header-info">
            <div className="td-mismatch-modal-icon-badge">
              <HelpCircle size={20} className="text-cyan-400" />
            </div>
            <div>
              <h3 id="td-mismatch-dialog-title" className="td-mismatch-modal-title">
                {t('drive.security_dialog_title')}
              </h3>
              <p className="td-mismatch-modal-subtitle">
                {t('drive.security_dialog_subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="td-mismatch-modal-close-btn"
            onClick={onClose}
            title={t('drive.security_dialog_close_btn')}
            aria-label={t('drive.security_dialog_close_btn')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Content */}
        <div className="td-mismatch-modal-body">
          {/* File Comparison Card */}
          <div className="td-mismatch-compare-card">
            <div className="td-mismatch-compare-item">
              <span className="td-mismatch-compare-label">{t('drive.security_dialog_file_label')}</span>
              <span className="td-mismatch-compare-value td-file-name-text" title={currentFilename}>
                {currentFilename}
              </span>
            </div>

            <div className="td-mismatch-compare-grid">
              <div className="td-mismatch-chip-box is-current">
                <span className="td-mismatch-chip-label">{t('drive.security_dialog_current_ext')}</span>
                <span className="td-mismatch-chip-value">.{currentExt || '-'}</span>
              </div>
              <div className="td-mismatch-compare-arrow">
                <ArrowRight size={16} />
              </div>
              <div className="td-mismatch-chip-box is-detected">
                <span className="td-mismatch-chip-label">{t('drive.security_dialog_detected_format')}</span>
                <span className="td-mismatch-chip-value">
                  .{sniffResult.detectedExt} ({sniffResult.formatLabel})
                </span>
              </div>
            </div>

            <div className="td-mismatch-magic-hint">
              <FileCode2 size={13} className="opacity-70 flex-shrink-0" />
              <span>
                {t('drive.security_dialog_detected_magic', {
                  format: sniffResult.formatLabel,
                  ext: sniffResult.detectedExt,
                })}
              </span>
            </div>
          </div>

          {/* Common Reasons Section */}
          <div className="td-mismatch-reasons-section">
            <h4 className="td-mismatch-reasons-title">{t('drive.security_dialog_reasons_heading')}</h4>
            <div className="td-mismatch-reasons-list">
              <div className="td-mismatch-reason-item">
                <div className="td-mismatch-reason-num">1</div>
                <div className="td-mismatch-reason-content">
                  <div className="td-mismatch-reason-heading">
                    {t('drive.security_dialog_reason_telegram_title')}
                  </div>
                  <div className="td-mismatch-reason-text">
                    {t('drive.security_dialog_reason_telegram_desc')}
                  </div>
                </div>
              </div>

              <div className="td-mismatch-reason-item">
                <div className="td-mismatch-reason-num">2</div>
                <div className="td-mismatch-reason-content">
                  <div className="td-mismatch-reason-heading">
                    {t('drive.security_dialog_reason_tools_title')}
                  </div>
                  <div className="td-mismatch-reason-text">
                    {t('drive.security_dialog_reason_tools_desc')}
                  </div>
                </div>
              </div>

              <div className="td-mismatch-reason-item">
                <div className="td-mismatch-reason-num">3</div>
                <div className="td-mismatch-reason-content">
                  <div className="td-mismatch-reason-heading">
                    {t('drive.security_dialog_reason_rename_title')}
                  </div>
                  <div className="td-mismatch-reason-text">
                    {t('drive.security_dialog_reason_rename_desc')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Safety & Playability Assurance */}
          <div className={`td-mismatch-safety-box ${isDanger ? 'is-danger' : 'is-safe'}`}>
            <div className="td-mismatch-safety-icon">
              {isDanger ? (
                <ShieldAlert size={18} className="text-rose-400" />
              ) : (
                <ShieldCheck size={18} className="text-emerald-400" />
              )}
            </div>
            <div>
              <div className="td-mismatch-safety-title">
                {t('drive.security_dialog_safety_heading')}
              </div>
              <div className="td-mismatch-safety-desc">
                {isDanger
                  ? t('drive.security_danger_executable_desc', {
                      format: sniffResult.formatLabel,
                      name: currentFilename,
                    })
                  : t('drive.security_dialog_safety_desc')}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="td-mismatch-modal-footer">
          {!isDanger && sniffResult.suggestedFilename && (
            <button
              type="button"
              className="td-btn-primary td-mismatch-modal-fix-btn"
              onClick={() => onFixExtension(sniffResult.suggestedFilename)}
              disabled={isFixing}
            >
              {isFixing ? (
                <CheckCircle2 size={15} className="animate-spin" />
              ) : (
                <Wrench size={15} />
              )}
              <span>
                {t('drive.security_fix_to_ext', {
                  ext: sniffResult.detectedExt,
                })}
              </span>
            </button>
          )}

          <button
            type="button"
            className="td-btn-secondary td-mismatch-modal-close-action"
            onClick={onClose}
          >
            {t('drive.security_dialog_close_btn')}
          </button>
        </div>
      </div>
    </div>
  );
};

