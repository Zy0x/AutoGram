import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyRound,
  ExternalLink,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  ArrowLeft,
  X,
} from 'lucide-react';
import { bootstrapSecureCredentials, setApiCredentials } from '../../lib/tauri/secureCredentials';

interface ApiSetupScreenProps {
  onComplete: () => void;
  onClose?: () => void;
  onBack?: () => void;
  isModal?: boolean;
}

export function ApiSetupScreen({ onComplete, onClose, onBack, isModal = false }: ApiSetupScreenProps) {
  const { t } = useTranslation();
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [showHash, setShowHash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    bootstrapSecureCredentials()
      .then(({ apiId: savedId, apiHash: savedHash }) => {
        if (savedId) setApiId(savedId);
        if (savedHash) setApiHash(savedHash);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModal && onClose && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModal, onClose, saving]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedId = apiId.trim();
    const trimmedHash = apiHash.trim();

    if (!trimmedId || !trimmedHash) {
      setError(
        t(
          'nav.api_setup_error_empty'
        )
      );
      return;
    }

    if (!/^\d+$/.test(trimmedId)) {
      setError(t('ui.generated.api_id_harus_berupa_karakter_angka_contoh_123456_2ca721a'));
      return;
    }

    setSaving(true);
    try {
      await setApiCredentials(trimmedId, trimmedHash);
      onComplete();
    } catch (err: any) {
      setError(err?.message || t('ui.generated.gagal_menyimpan_api_credentials_silakan_coba_lag_4907244'));
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

  if (isModal) {
    return (
      <div
        className="modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget && !saving && onClose) {
            onClose();
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-modal-title"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.72)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          padding: '16px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: '510px',
            width: '100%',
            background: 'linear-gradient(150deg, rgba(20, 26, 38, 0.96) 0%, rgba(11, 16, 26, 0.98) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '20px',
            padding: '24px 28px',
            boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.85), 0 0 40px rgba(56, 189, 248, 0.2)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            position: 'relative',
            maxHeight: '96vh',
            overflowY: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            boxSizing: 'border-box',
          }}
        >
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                zIndex: 10,
              }}
              aria-label={t('speedtest.preview_close_btn')}
            >
              <X size={16} />
            </button>
          )}

          {/* LOGO & TITLE */}
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 8px auto',
                boxShadow: '0 6px 16px rgba(56, 189, 248, 0.35)',
              }}
            >
              <KeyRound size={22} style={{ color: '#ffffff' }} />
            </div>

            <h2 id="api-modal-title" style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 4px 0', letterSpacing: '-0.02em' }}>
              {t('nav.api_setup_title')}
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
              {t('nav.api_setup_subtitle')}
            </p>
          </div>

          {/* GUIDE CARD */}
          <div
            style={{
              padding: '12px 15px',
              borderRadius: '12px',
              background: 'rgba(56, 189, 248, 0.06)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              fontSize: '0.78rem',
              color: '#cbd5e1',
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '0.8rem' }}>
              <ShieldCheck size={15} />
              {t('nav.api_setup_guide_title')}
            </strong>
            <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <li>{t('nav.api_setup_step1')}</li>
              <li>{t('nav.api_setup_step2')}</li>
              <li>{t('nav.api_setup_step3')}</li>
            </ul>

            <button
              type="button"
              onClick={handleOpenTelegramOrg}
              style={{
                marginTop: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{t('ui.generated.buka_my_telegram_org_ba7df45')}</span>
              <ExternalLink size={12} />
            </button>
          </div>

          {/* ERROR ALERT */}
          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                fontSize: '0.8rem',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* FORM */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                {t('nav.api_id_label')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                placeholder={t('ui.generated.contoh_1234567_25ccc85')}
                required
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  fontSize: '0.88rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
                {t('nav.api_hash_label')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showHash ? 'text' : 'password'}
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  placeholder={t('ui.generated.contoh_0123456789abcdef0123456789abcdef_ece8eb0')}
                  required
                  style={{
                    width: '100%',
                    padding: '9px 38px 9px 12px',
                    borderRadius: '10px',
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#f8fafc',
                    fontSize: '0.88rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowHash(!showHash)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showHash ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              style={{
                marginTop: '4px',
                padding: '11px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.88rem',
                fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 6px 16px rgba(56, 189, 248, 0.3)',
                transition: 'all 0.18s ease',
              }}
            >
              <span>{t('nav.api_setup_submit')}</span>
              <ArrowRight size={16} />
            </button>
          </form>

          <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b', textAlign: 'center' }}>
            {t('ui.generated.credentials_anda_disimpan_secara_terenkripsi_ama_b24611b')}
          </p>
        </div>
      </div>
    );
  }

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
        padding: '24px 16px',
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          maxWidth: '520px',
          width: '100%',
          background: 'linear-gradient(150deg, rgba(20, 26, 38, 0.9) 0%, rgba(11, 16, 26, 0.98) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '20px',
          padding: '28px 32px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(56, 189, 248, 0.15)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: '-4px',
            }}
          >
            <ArrowLeft size={15} />
            <span>{t('nav.back_to_launcher')}</span>
          </button>
        )}
        {/* LOGO & TITLE */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px auto',
              boxShadow: '0 6px 18px rgba(56, 189, 248, 0.35)',
            }}
          >
            <KeyRound size={24} style={{ color: '#ffffff' }} />
          </div>

          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, margin: '0 0 6px 0', letterSpacing: '-0.02em' }}>
            {t('nav.api_setup_title')}
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
            {t(
              'nav.api_setup_subtitle'
            )}
          </p>
        </div>

        {/* GUIDE CARD */}
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '14px',
            background: 'rgba(56, 189, 248, 0.06)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            fontSize: '0.8rem',
            color: '#cbd5e1',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '0.82rem' }}>
            <ShieldCheck size={16} />
            {t('nav.api_setup_guide_title')}
          </strong>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <li>{t('nav.api_setup_step1')}</li>
            <li>{t('nav.api_setup_step2')}</li>
            <li>{t('nav.api_setup_step3')}</li>
          </ul>

          <button
            type="button"
            onClick={handleOpenTelegramOrg}
            style={{
              marginTop: '10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 11px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{t('ui.generated.buka_my_telegram_org_ba7df45')}</span>
            <ExternalLink size={12} />
          </button>
        </div>

        {/* ERROR ALERT */}
        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
              {t('nav.api_id_label')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              placeholder={t('ui.generated.contoh_1234567_25ccc85')}
              required
              style={{
                width: '100%',
                padding: '10px 14px',
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
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '4px' }}>
              {t('nav.api_hash_label')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showHash ? 'text' : 'password'}
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                placeholder={t('ui.generated.contoh_0123456789abcdef0123456789abcdef_ece8eb0')}
                required
                style={{
                  width: '100%',
                  padding: '10px 42px 10px 14px',
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
              marginTop: '6px',
              padding: '12px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
              border: 'none',
              color: '#ffffff',
              fontSize: '0.92rem',
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
            <span>{t('nav.api_setup_submit')}</span>
            <ArrowRight size={18} />
          </button>
        </form>

        <p style={{ margin: 0, fontSize: '0.74rem', color: '#64748b', textAlign: 'center' }}>
          {t('ui.generated.credentials_anda_disimpan_secara_terenkripsi_ama_b24611b')}
        </p>
      </div>
    </div>
  );
}
