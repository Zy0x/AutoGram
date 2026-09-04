import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { X, Phone, ShieldCheck, Loader2, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useModalBackHandler } from '../../lib/platform/modalBackStack';

export interface AccountLoginModalProps {
  open: boolean;
  onClose: () => void;
  phone: string;
  setPhone: (p: string) => void;
  code: string;
  setCode: (c: string) => void;
  password2FA: string;
  setPassword2FA: (p: string) => void;
  passwordHint?: string;
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
  passwordHint,
  step,
  onSendPhone,
  onSendCode,
  onSend2FA,
  loading,
  error,
}) => {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  useModalBackHandler(open, onClose, 'account-login-modal');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[14000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Phone size={18} className="text-indigo-400" />
            {t('ui.generated.tambah_sesi_telegram_baru_2a7c0fa')}
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
              {t('ui.generated.nomor_hp_format_internasional_62_1_7ffc22a')}
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('accounts.ph_phone_example')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 font-mono"
            />
            <button
              type="button"
              disabled={loading || !phone.trim()}
              onClick={onSendPhone}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : t('ui.generated.kirim_kode_otp_6745ef8')}
            </button>
          </div>
        )}

        {step === 'code' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              {t('ui.generated.masukkan_kode_otp_dari_telegram_82840f8')}
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('accounts.ph_code_example')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-center text-lg tracking-widest text-slate-100 focus:ring-1 focus:ring-indigo-500 font-mono"
            />
            <button
              type="button"
              disabled={loading || !code.trim()}
              onClick={onSendCode}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : t('ui.generated.verifikasi_otp_32064bd')}
            </button>
          </div>
        )}

        {step === '2fa' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-amber-400" />
              {t('ui.generated.password_2fa_cloud_password_59a3bd2')}
            </label>
            {passwordHint && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-medium">
                <Sparkles size={13} />
                {t('accounts.password_hint_badge', { hint: passwordHint })}
              </div>
            )}
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password2FA}
                onChange={(e) => setPassword2FA(e.target.value)}
                placeholder={t('accounts.passcode_ph')}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                title={showPassword ? t('accounts.hide_password') : t('accounts.show_password')}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              type="button"
              disabled={loading || !password2FA.trim()}
              onClick={onSend2FA}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : t('ui.generated.masuk_sesi_e12562f')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
