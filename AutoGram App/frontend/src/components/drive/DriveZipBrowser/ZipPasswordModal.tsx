import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, LockKeyhole, X } from 'lucide-react';

type Props = {
  open: boolean;
  archiveLabel: string;
  error?: string | null;
  busy?: boolean;
  suggestions?: string[];
  onClose: () => void;
  onSubmit: (password: string) => void;
};

export function ZipPasswordModal({ open, archiveLabel, error, busy, suggestions = [], onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  if (!open) return null;

  return (
    <div className="dzb-modal-overlay" role="dialog" aria-modal="true" aria-label={t('speedtest.zip_password_title')}>
      <form
        className="dzb-modal-card dzb-password-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (password) onSubmit(password);
        }}
      >
        <div className="dzb-modal-header">
          <div className="dzb-modal-title">
            <LockKeyhole size={18} />
            <span>{t('speedtest.zip_password_title')}</span>
          </div>
          <button type="button" className="dzb-action-icon-btn" onClick={onClose} title={t('speedtest.zip_close')}>
            <X size={18} />
          </button>
        </div>
        <div className="dzb-modal-body dzb-password-body">
          <p>{t('speedtest.zip_password_desc', { archive: archiveLabel })}</p>
          <label className="dzb-password-field">
            <span>{t('speedtest.zip_password_label')}</span>
            <div>
              <KeyRound size={16} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('speedtest.zip_password_placeholder')}
                autoFocus
                autoComplete="off"
              />
            </div>
          </label>
          {suggestions.length > 0 && (
            <section className="dzb-password-suggestions" aria-label={t('speedtest.zip_password_candidates')}>
              <span>{t('speedtest.zip_password_candidates')}</span>
              <div>
                {suggestions.map((candidate) => (
                  <button key={candidate} type="button" onClick={() => setPassword(candidate)}>
                    {candidate}
                  </button>
                ))}
              </div>
              <small>{t('speedtest.zip_password_candidates_hint')}</small>
            </section>
          )}
          {error && <p className="dzb-password-error" role="alert">{error}</p>}
        </div>
        <div className="dzb-modal-footer">
          <button type="button" className="dzb-btn-secondary" onClick={onClose}>{t('speedtest.zip_btn_cancel')}</button>
          <button type="submit" className="dzb-btn-primary" disabled={!password || busy}>
            {busy ? t('speedtest.zip_password_checking') : t('speedtest.zip_password_unlock')}
          </button>
        </div>
      </form>
    </div>
  );
}
