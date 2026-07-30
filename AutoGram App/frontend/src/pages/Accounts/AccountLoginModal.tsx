import { useTranslation } from 'react-i18next';
import React from 'react';
import { X, Phone, ShieldCheck, Loader2 } from 'lucide-react';

export interface AccountLoginModalProps {
  open: boolean;
  onClose: () => void;
  phone: string;
  setPhone: (p: string) => void;
  code: string;
  setCode: (c: string) => void;
  password2FA: string;
  setPassword2FA: (p: string) => void;
  step: 'phone' | 'code' | '2fa';
  onSendPhone: () => void;
  onSendCode: () => void;
  onSend2FA: () => void;
  loading?: boolean;
  error?: string | null;
}

export const AccountLoginModal: React.FC<AccountLoginModalProps> = ({
  open,
  onClose,
  phone,
  setPhone,
  code,
  setCode,
  password2FA,
  setPassword2FA,
  step,
  onSendPhone,
  onSendCode,
  onSend2FA,
  loading,
  error,
}) => {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[14000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Phone size={18} className="text-indigo-400" />
            Tambah Sesi Telegram Baru
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-950/60 border border-red-900/60 rounded-xl text-xs text-red-300">
            {error}
          </div>
        )}

        {step === 'phone' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              Nomor HP (Format Internasional +62 / +1 …)
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+628123456789"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 font-mono"
            />
            <button
              type="button"
              disabled={loading || !phone.trim()}
              onClick={onSendPhone}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Kirim Kode OTP'}
            </button>
          </div>
        )}

        {step === 'code' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              Masukkan Kode OTP dari Telegram
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="12345"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-center text-lg tracking-widest text-slate-100 focus:ring-1 focus:ring-indigo-500 font-mono"
            />
            <button
              type="button"
              disabled={loading || !code.trim()}
              onClick={onSendCode}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Verifikasi OTP'}
            </button>
          </div>
        )}

        {step === '2fa' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-amber-400" />
              Password 2FA (Cloud Password)
            </label>
            <input
              type="password"
              value={password2FA}
              onChange={(e) => setPassword2FA(e.target.value)}
              placeholder={t('accounts.passcode_ph')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              disabled={loading || !password2FA.trim()}
              onClick={onSend2FA}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Masuk Sesi'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
