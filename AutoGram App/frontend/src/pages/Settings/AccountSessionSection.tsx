import { useTranslation } from 'react-i18next';
import React from 'react';
import { ShieldCheck, Save, Loader2 } from 'lucide-react';

export interface AccountSessionSectionProps {
  apiId: string;
  setApiId: (id: string) => void;
  apiHash: string;
  setApiHash: (hash: string) => void;
  onSaveCredentials: () => void;
  isSaving?: boolean;
  saveStatus?: 'idle' | 'success' | 'error';
}

export const AccountSessionSection: React.FC<AccountSessionSectionProps> = ({
  apiId,
  setApiId,
  apiHash,
  setApiHash,
  onSaveCredentials,
  isSaving,
  saveStatus,
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-2xl p-5 space-y-4 shadow-xl border"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-default)',
        color: 'var(--text-primary)',
      }}
    >
      <h3
        className="text-sm font-bold flex items-center gap-2 pb-3 border-b"
        style={{
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
        }}
      >
        <ShieldCheck size={18} className="text-emerald-400" />
        {t('ui.generated.kredensial_api_telegram_api_id_api_hash_a9eae53')}
      </h3>

      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {t('ui.generated.api_id_dan_api_hash_digunakan_oleh_grammers_rust_d74bf8e')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
            {t('nav.api_id_label')}
          </label>
          <input
            type="text"
            value={apiId}
            onChange={(e) => setApiId(e.target.value)}
            placeholder={t('settings.api_id_ph')}
            className="w-full rounded-xl px-3.5 py-2 text-xs font-mono focus:ring-1 focus:ring-indigo-500 border"
            style={{
              background: 'var(--input-bg)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
            {t('nav.api_hash_label')}
          </label>
          <input
            type="password"
            value={apiHash}
            onChange={(e) => setApiHash(e.target.value)}
            placeholder={t('settings.api_hash_ph')}
            className="w-full rounded-xl px-3.5 py-2 text-xs font-mono focus:ring-1 focus:ring-indigo-500 border"
            style={{
              background: 'var(--input-bg)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        {saveStatus === 'success' && (
          <span className="text-xs text-emerald-500 font-medium">
            {t('settings.creds_save_success')}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-xs text-red-500 font-medium">
            {t('settings.creds_save_fail')}
          </span>
        )}
        {saveStatus === 'idle' && <span />}

        <button
          type="button"
          disabled={isSaving || !apiId.trim() || !apiHash.trim()}
          onClick={onSaveCredentials}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2"
        >
          {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {t('settings.save_credentials')}
        </button>
      </div>
    </div>
  );
};
