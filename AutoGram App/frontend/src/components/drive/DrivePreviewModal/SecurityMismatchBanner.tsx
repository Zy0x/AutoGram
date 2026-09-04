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
  hexBytes,
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

  const detectedHex = React.useMemo(() => {
    if (hexBytes && hexBytes.length >= 3) {
      const sliceLen = Math.min(hexBytes.length, 12);
      return Array.from(hexBytes.slice(0, sliceLen))
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    }
    if (sniffResult.detectedExt === 'jpg' || sniffResult.detectedExt === 'jpeg') {
      return 'FF D8 FF E0 00 10 4A 46 49 46 00 01';
    }
    if (sniffResult.detectedExt === 'png') {
      return '89 50 4E 47 0D 0A 1A 0A';
    }
    if (sniffResult.detectedExt === 'webp') {
      return '52 49 46 46 00 00 00 00 57 45 42 50';
    }
    return 'FF D8 FF ...';
  }, [hexBytes, sniffResult.detectedExt]);

  const detectedAscii = React.useMemo(() => {
    if (hexBytes && hexBytes.length >= 3) {
      const sliceLen = Math.min(hexBytes.length, 12);
      return Array.from(hexBytes.slice(0, sliceLen))
        .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '·'))
        .join('');
    }
    if (sniffResult.detectedExt === 'jpg' || sniffResult.detectedExt === 'jpeg') {
      return 'ÿØÿà··JFIF··';
    }
    return '···';
  }, [hexBytes, sniffResult.detectedExt]);

  const expectedSignature = React.useMemo(() => {
    const clean = currentExt.toLowerCase().trim();
    switch (clean) {
      case 'heic':
      case 'heif':
        return {
          hex: '00 00 00 18 66 74 79 70 68 65 69 63',
          ascii: '....ftypheic',
          box: 'ISO BMFF (ftypheic / ftypmif1)',
        };
      case 'jpg':
      case 'jpeg':
        return {
          hex: 'FF D8 FF E0 00 10 4A 46 49 46',
          ascii: 'ÿØÿà..JFIF',
          box: 'JPEG SOI Marker',
        };
      case 'png':
        return {
          hex: '89 50 4E 47 0D 0A 1A 0A',
          ascii: '.PNG....',
          box: 'Portable Network Graphics',
        };
      case 'webp':
        return {
          hex: '52 49 46 46 .. .. .. .. 57 45 42 50',
          ascii: 'RIFF....WEBP',
          box: 'Google WebP RIFF',
        };
      case 'mp4':
      case 'mov':
        return {
          hex: '00 00 00 20 66 74 79 70',
          ascii: '....ftyp',
          box: 'ISO Base Media / QuickTime',
        };
      case 'zip':
        return {
          hex: '50 4B 03 04',
          ascii: 'PK..',
          box: 'ZIP Local File Header',
        };
      default:
        return {
          hex: `Signature .${clean}`,
          ascii: '....',
          box: `Header .${clean}`,
        };
    }
  }, [currentExt]);

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

          {/* Technical Proof & Magic Bytes Inspector Card */}
          <div className="td-mismatch-tech-card">
            <div className="td-mismatch-tech-header">
              <FileCode2 size={16} />
              <span>{t('drive.security_dialog_technical_heading')}</span>
            </div>

            <div className="td-mismatch-tech-grid">
              {/* Detected Bytes */}
              <div className="td-mismatch-hex-box is-detected">
                <span className="td-mismatch-hex-box-label">
                  {t('drive.security_dialog_detected_hex')}
                </span>
                <span className="td-mismatch-hex-code">{detectedHex}</span>
                <span className="td-mismatch-ascii-val">
                  {t('drive.security_dialog_ascii_label')} {detectedAscii}
                </span>
                <div className="text-[10px] text-emerald-400 font-semibold mt-1">
                  {t('drive.security_dialog_interpretation_label')} {sniffResult.formatLabel} (.{sniffResult.detectedExt})
                </div>
              </div>

              {/* Expected Bytes for file's current extension */}
              <div className="td-mismatch-hex-box is-expected">
                <span className="td-mismatch-hex-box-label">
                  {t('drive.security_dialog_expected_hex', { ext: currentExt || '?' })}
                </span>
                <span className="td-mismatch-hex-code">{expectedSignature.hex}</span>
                <span className="td-mismatch-ascii-val">
                  {t('drive.security_dialog_ascii_label')} {expectedSignature.ascii}
                </span>
                <div className="text-[10px] text-amber-400 font-semibold mt-1">
                  {expectedSignature.box}
                </div>
              </div>
            </div>

            {/* Direct Browser Rendering Concrete Proof */}
            <div className="td-mismatch-render-proof">
              <CheckCircle2 size={16} className="td-mismatch-render-proof-icon" />
              <div>
                <div className="td-mismatch-render-proof-title">
                  {t('drive.security_dialog_proof_render_title')}
                </div>
                <div className="td-mismatch-render-proof-desc">
                  {t('drive.security_dialog_proof_render_body')}
                </div>
              </div>
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

