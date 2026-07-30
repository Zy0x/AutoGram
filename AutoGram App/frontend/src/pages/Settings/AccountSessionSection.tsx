import React from 'react';
import { Key, ShieldCheck, Save, Loader2 } from 'lucide-react';

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
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Key size={13} className="text-indigo-400" /> Telegram API ID
          </label>
          <input
            type="text"
            value={apiId}
            onChange={(e) => setApiId(e.target.value)}
            placeholder="misal: 123456"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 font-mono focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Key size={13} className="text-indigo-400" /> Telegram API Hash
          </label>
          <input
            type="password"
            value={apiHash}
            onChange={(e) => setApiHash(e.target.value)}
            placeholder="misal: 0123456789abcdef0123456789abcdef"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 font-mono focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        {saveStatus === 'success' && (
          <span className="text-xs text-emerald-400 font-medium">✓ Kredensial berhasil disimpan di Rust Keychain!</span>
        )}
        {saveStatus === 'error' && (
          <span className="text-xs text-red-400 font-medium">✕ Gagal menyimpan kredensial.</span>
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
