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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
        <ShieldCheck size={18} className="text-emerald-400" />
        Kredensial API Telegram (API ID &amp; API Hash)
      </h3>

      <p className="text-xs text-slate-400">
        API ID dan API Hash digunakan oleh Grammers (Rust MTProto) untuk mengotentikasi koneksi langsung ke server Telegram.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            API ID Telegram
          </label>
          <input
            type="text"
            value={apiId}
            onChange={(e) => setApiId(e.target.value)}
            placeholder={t('settings.api_id_ph')}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            API Hash Telegram
          </label>
          <input
            type="password"
            value={apiHash}
            onChange={(e) => setApiHash(e.target.value)}
            placeholder={t('settings.api_hash_ph')}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        {saveStatus === 'success' && (
          <span className="text-xs text-emerald-400 font-medium">
            {t('settings.creds_save_success')}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-xs text-red-400 font-medium">
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
          {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Kredensial
        </button>
      </div>
    </div>
  );
};
