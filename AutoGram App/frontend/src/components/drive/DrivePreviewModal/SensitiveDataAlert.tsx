import React from 'react';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SensitiveScanResult } from '../../../lib/media/sensitiveDataDetector';

interface Props {
  scanResult: SensitiveScanResult;
  isMasked: boolean;
  onToggleMask: () => void;
}

export const SensitiveDataAlert: React.FC<Props> = ({
  scanResult,
  isMasked,
  onToggleMask,
}) => {
  const { t } = useTranslation();

  if (!scanResult.hasSecrets) return null;

  return (
    <div className="td-sensitive-alert" role="status">
      <div className="td-sensitive-alert-main">
        <div className="td-sensitive-alert-icon">
          <KeyRound size={15} className="text-amber-400" />
        </div>
        <div className="td-sensitive-alert-text">
          <strong>
            {t('drive.sensitive_detected_title', {
              count: scanResult.totalFound,
            })}
          </strong>
          <span className="td-sensitive-alert-sub">
            ({scanResult.secrets.map((s) => s.label).slice(0, 3).join(', ')})
          </span>
        </div>
      </div>

      <div className="td-sensitive-alert-actions">
        <button
          type="button"
          className={`td-btn-secondary td-btn-sm ${isMasked ? 'is-active' : ''}`}
          onClick={onToggleMask}
          title={
            isMasked
              ? t('drive.sensitive_show_tooltip')
              : t('drive.sensitive_mask_tooltip')
          }
        >
          {isMasked ? <EyeOff size={13} /> : <Eye size={13} />}
          <span>
            {isMasked
              ? t('drive.sensitive_masked_btn')
              : t('drive.sensitive_unmasked_btn')}
          </span>
        </button>
      </div>
    </div>
  );
};
