import React from 'react';
import { AlertTriangle, ShieldAlert, FileQuestion, Wrench, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MagicSniffResult } from '../../../lib/media/magicBytesSniffer';

interface Props {
  sniffResult: MagicSniffResult;
  currentFilename: string;
  onFixExtension: (suggestedFilename: string) => void;
  isFixing?: boolean;
}

export const SecurityMismatchBanner: React.FC<Props> = ({
  sniffResult,
  currentFilename,
  onFixExtension,
  isFixing = false,
}) => {
  const { t } = useTranslation();

  if (sniffResult.severity === 'safe') return null;

  const isDanger = sniffResult.severity === 'danger' || sniffResult.isSuspiciousExecutable;
  const isWarning = sniffResult.severity === 'warning';

  return (
    <div
      className={`td-mismatch-banner ${
        isDanger ? 'is-danger' : isWarning ? 'is-warning' : 'is-info'
      }`}
      role="alert"
    >
      <div className="td-mismatch-banner-main">
        <div className="td-mismatch-icon">
          {isDanger ? (
            <ShieldAlert size={18} className="td-mismatch-danger-ico" />
          ) : isWarning ? (
            <AlertTriangle size={18} className="td-mismatch-warn-ico" />
          ) : (
            <FileQuestion size={18} className="td-mismatch-info-ico" />
          )}
        </div>
        <div className="td-mismatch-text">
          <div className="td-mismatch-title">
            {isDanger
              ? t('drive.security_danger_executable_title')
              : isWarning
              ? t('drive.security_mismatch_title')
              : t('drive.security_missing_ext_title')}
          </div>
          <div className="td-mismatch-desc">
            {isDanger ? (
              <span>
                {t('drive.security_danger_executable_desc', {
                  format: sniffResult.formatLabel,
                  name: currentFilename,
                })}
              </span>
            ) : isWarning ? (
              <span>
                {t('drive.security_mismatch_desc', {
                  name: currentFilename,
                  format: sniffResult.formatLabel,
                  ext: sniffResult.detectedExt,
                })}
              </span>
            ) : (
              <span>
                {t('drive.security_missing_ext_desc', {
                  format: sniffResult.formatLabel,
                  ext: sniffResult.detectedExt,
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {!isDanger && sniffResult.suggestedFilename && (
        <div className="td-mismatch-actions">
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
        </div>
      )}
    </div>
  );
};
