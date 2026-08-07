import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyRound,
  ExternalLink,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { setApiCredentials } from '../../lib/tauri/secureCredentials';

interface ApiSetupScreenProps {
  onComplete: () => void;
}

export function ApiSetupScreen({ onComplete }: ApiSetupScreenProps) {
  const { t } = useTranslation();
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [showHash, setShowHash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedId = apiId.trim();
    const trimmedHash = apiHash.trim();

    if (!trimmedId || !trimmedHash) {
      setError(
        t(
          'nav.api_setup_error_empty',
          'API ID dan API Hash wajib diisi sebelum melanjutkan.'
        )
      );
      return;
    }

    if (!/^\d+$/.test(trimmedId)) {
      setError('API ID harus berupa karakter angka (contoh: 1234567).');
      return;
    }

    setSaving(true);
    try {
      await setApiCredentials(trimmedId, trimmedHash);
      onComplete();
    } catch (err: any) {
      setError(err?.message || 'Gagal menyimpan API Credentials. Silakan coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenTelegramOrg = () => {
    if ((window as any).__TAURI_INTERNALS__) {
      import('@tauri-apps/plugin-shell')
        .then(({ open }) => open('https://my.telegram.org'))
        .catch(() => window.open('https://my.telegram.org', '_blank'));
    } else {
      window.open('https://my.telegram.org', '_blank');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'radial-gradient(ellipse at top, #111827 0%, #060911 100%)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          maxWidth: '560px',
          width: '100%',
          background: 'linear-gradient(150deg, rgba(20, 26, 38, 0.9) 0%, rgba(11, 16, 26, 0.98) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '24px',
          padding: '36px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(56, 189, 248, 0.15)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {/* LOGO & TITLE */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
              boxShadow: '0 8px 20px rgba(56, 189, 248, 0.35)',
            }}
          >
            <KeyRound size={28} style={{ color: '#ffffff' }} />
          </div>

          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
            {t('nav.api_setup_title', 'Setup API Telegram AutoGram')}
          </h2>
          <p style={{ fontSize: '0.88rem', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
            {t(
              'nav.api_setup_subtitle',
              'Masukkan API ID dan API Hash akun Telegram Anda untuk mengaktifkan koneksi Grammers & MTProto.'
            )}
          </p>
        </div>

        {/* GUIDE CARD */}
        <div
          style={{
            padding: '18px 20px',
            borderRadius: '16px',
            background: 'rgba(56, 189, 248, 0.06)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            fontSize: '0.82rem',
            color: '#cbd5e1',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '0.85rem' }}>
            <ShieldCheck size={16} />
            {t('nav.api_setup_guide_title', 'Cara Memperoleh API Credentials:')}
          </strong>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <li>{t('nav.api_setup_step1', '1. Buka my.telegram.org di browser dan masuk dengan nomor telepon Telegram Anda.')}</li>
            <li>{t('nav.api_setup_step2', "2. Pilih menu 'API development tools'.")}</li>
            <li>{t('nav.api_setup_step3', "3. Buat aplikasi baru (misal: 'AutoGram') untuk memperoleh App api_id dan api_hash.")}</li>
          </ul>

          <button
            type="button"
            onClick={handleOpenTelegramOrg}
            style={{
              marginTop: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span>Buka my.telegram.org</span>
            <ExternalLink size={13} />
          </button>
        </div>

        {/* ERROR ALERT */}
        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: '0.82rem',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* FORM */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              {t('nav.api_id_label', 'API ID Telegram')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              placeholder="Contoh: 1234567"
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '12px',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#f8fafc',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              {t('nav.api_hash_label', 'API Hash Telegram')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showHash ? 'text' : 'password'}
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                placeholder="Contoh: 0123456789abcdef0123456789abcdef"
                required
                style={{
                  width: '100%',
                  padding: '12px 42px 12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowHash(!showHash)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                {showHash ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              marginTop: '8px',
              padding: '14px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
              border: 'none',
              color: '#ffffff',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: saving ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 8px 20px rgba(56, 189, 248, 0.3)',
              transition: 'all 0.18s ease',
            }}
          >
            <span>{t('nav.api_setup_submit', 'Simpan & Lanjutkan')}</span>
            <ArrowRight size={18} />
          </button>
        </form>

        <p style={{ margin: 0, fontSize: '0.74rem', color: '#64748b', textAlign: 'center' }}>
          Credentials Anda disimpan secara terenkripsi aman di perangkat lokal via Tauri Encrypted Store.
        </p>
      </div>
    </div>
  );
}
