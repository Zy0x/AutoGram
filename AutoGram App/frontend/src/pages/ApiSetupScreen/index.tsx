import { useState, useEffect, useRef } from 'react';
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
  HelpCircle,
  BookOpen,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import {
  bootstrapSecureCredentials,
  setApiCredentials,
  verifyTelegramApiCredentials,
  notifyApiError,
} from '../../lib/tauri/secureCredentials';

interface ApiSetupScreenProps {
  onComplete: () => void;
  onClose?: () => void;
  onBack?: () => void;
  isModal?: boolean;
}

export function ApiSetupScreen({ onComplete, onClose, onBack, isModal = false }: ApiSetupScreenProps) {
  const { t } = useTranslation();
  const mouseDownOnBackdropRef = useRef(false);

  // ── Ghost Mode: credentials live in a ref (never in DOM value attribute) ───
  // When saved credentials exist: inputs show a masked placeholder,
  // NOT the real value. The real value is only used at submit time.
  // This prevents credential exposure via DevTools → Elements panel.
  const savedCredsRef = useRef<{ apiId: string; apiHash: string } | null>(null);

  // What the user has TYPED (empty = user hasn't modified the field)
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');

  // Whether the API Hash field has been actively edited by the user this session
  const [apiHashDirty, setApiHashDirty] = useState(false);

  // Reveal state — when true, TEMPORARILY put the real hash value into the input
  const [showHash, setShowHash] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showGuide, setShowGuide] = useState(false);
  const [hasInteractedGuide, setHasInteractedGuide] = useState(false);
  const [hasClickedTelegramLink, setHasClickedTelegramLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load saved credentials into ref ONLY — never into state/DOM
  useEffect(() => {
    bootstrapSecureCredentials()
      .then((creds) => {
        if (creds.apiId || creds.apiHash) {
          savedCredsRef.current = { apiId: creds.apiId, apiHash: creds.apiHash };
          // Pre-fill apiId display (less sensitive than hash)
          if (creds.apiId) setApiId(creds.apiId);
          // Hash stays masked — do NOT setApiHash here
        }
      })
      .catch(() => {});
  }, []);

  // Toggle reveal: pull real hash into input temporarily, or clear it out
  const handleToggleShowHash = () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    if (!showHash) {
      // Reveal: put real value into state temporarily
      const real = savedCredsRef.current?.apiHash || apiHash;
      setApiHash(real);
      setShowHash(true);
      // Auto-hide after 30 seconds for safety
      revealTimerRef.current = setTimeout(() => {
        if (!apiHashDirty) setApiHash('');
        setShowHash(false);
      }, 30_000);
    } else {
      // Hide: if user hasn't edited, wipe real value from DOM immediately
      if (!apiHashDirty) setApiHash('');
      setShowHash(false);
    }
  };

  // Cleanup reveal timer on unmount
  useEffect(() => () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
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
    setSuccessMsg(null);

    // Resolve effective values: apiId always taken from state (visible field),
    // apiHash: use saved ref when user hasn't modified the field (ghost mode)
    const effectiveId = (apiId || savedCredsRef.current?.apiId || '').trim();
    const effectiveHash = apiHashDirty ? apiHash.trim() : (savedCredsRef.current?.apiHash || apiHash).trim();

    if (!effectiveId || !effectiveHash) {
      setError(t('nav.api_setup_error_empty'));
      return;
    }

    if (!/^\d{4,10}$/.test(effectiveId)) {
      setError(t('nav.api_setup_error_id_invalid'));
      return;
    }

    if (!/^[a-fA-F0-9]{32}$/.test(effectiveHash)) {
      setError(t('nav.api_setup_error_hash_invalid'));
      return;
    }

    setSaving(true);
    try {
      const checkRes = await verifyTelegramApiCredentials(effectiveId, effectiveHash);
      if (!checkRes.ok) {
        setError(t(`nav.${checkRes.errorKey || 'api_setup_error_telegram'}`));
        notifyApiError();
        setSaving(false);
        return;
      }

      await setApiCredentials(effectiveId, effectiveHash);
      // Update ref so subsequent ghost-mode reads are current
      savedCredsRef.current = { apiId: effectiveId, apiHash: effectiveHash };
      // Clear revealed value from DOM now that save succeeded
      if (!apiHashDirty) setApiHash('');
      setShowHash(false);
      setSuccessMsg(t('nav.api_setup_success_verified'));

      setTimeout(() => {
        setSaving(false);
        onComplete();
      }, 750);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      setError(msg || t('ui.generated.gagal_menyimpan_api_credentials_silakan_coba_lag_4907244'));
      notifyApiError();
      setSaving(false);
    }
  };

  const handleOpenTelegramOrg = () => {
    setHasClickedTelegramLink(true);
    if ((window as any).__TAURI_INTERNALS__) {
      import('@tauri-apps/plugin-shell')
        .then(({ open }) => open('https://my.telegram.org'))
        .catch(() => window.open('https://my.telegram.org', '_blank'));
    } else {
      window.open('https://my.telegram.org', '_blank');
    }
  };

  const renderGuideCard = (onCloseGuide?: () => void) => (
    <div
      className="guide-card-enter"
      style={{
        flex: '1 1 420px',
        maxWidth: '460px',
        width: '100%',
        height: 'fit-content',
        alignSelf: 'center',
        background: 'linear-gradient(150deg, rgba(16, 26, 44, 0.98) 0%, rgba(10, 16, 30, 0.98) 100%)',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '20px',
        padding: '20px 22px',
        boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.85), 0 0 32px rgba(56, 189, 248, 0.16)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        position: 'relative',
        boxSizing: 'border-box',
        willChange: 'transform, opacity',
      }}
    >
      {/* GUIDE HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(14, 165, 233, 0.1) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
              flexShrink: 0,
              boxShadow: '0 0 16px rgba(56, 189, 248, 0.2)',
            }}
          >
            <BookOpen size={17} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em' }}>
              {t('nav.how_to_get_title')}
            </h3>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={handleOpenTelegramOrg}
            className={`guide-link-btn ${!hasClickedTelegramLink ? 'guide-link-btn-pulse' : ''}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '7px',
              background: 'rgba(56, 189, 248, 0.16)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.18s ease',
            }}
          >
            <span>{t('ui.generated.buka_my_telegram_org_ba7df45')}</span>
            <ExternalLink size={11} />
          </button>
          {onCloseGuide && (
            <button
              type="button"
              onClick={onCloseGuide}
              className="guide-close-btn"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                transition: 'all 0.18s ease',
              }}
              aria-label={t('speedtest.preview_close_btn')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* STEPS LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', color: '#cbd5e1' }}>
        <div className="guide-step-item" style={{ padding: '7px 10px', borderRadius: '9px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px', fontSize: '0.78rem' }}>
            {t('nav.how_to_get_step1_title')}
          </strong>
          <span style={{ color: '#94a3b8', lineHeight: 1.35 }}>{t('nav.how_to_get_step1_desc')}</span>
        </div>

        <div className="guide-step-item" style={{ padding: '7px 10px', borderRadius: '9px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px', fontSize: '0.78rem' }}>
            {t('nav.how_to_get_step2_title')}
          </strong>
          <span style={{ color: '#94a3b8', lineHeight: 1.35 }}>{t('nav.how_to_get_step2_desc')}</span>
        </div>

        <div className="guide-step-item" style={{ padding: '7px 10px', borderRadius: '9px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px', fontSize: '0.78rem' }}>
            {t('nav.how_to_get_step3_title')}
          </strong>
          <span style={{ color: '#94a3b8', lineHeight: 1.35 }}>{t('nav.how_to_get_step3_desc')}</span>
        </div>

        <div className="guide-step-item" style={{ padding: '7px 10px', borderRadius: '9px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px', fontSize: '0.78rem' }}>
            {t('nav.how_to_get_step4_title')}
          </strong>
          <span style={{ color: '#94a3b8', lineHeight: 1.35 }}>{t('nav.how_to_get_step4_desc')}</span>
        </div>

        <div className="guide-step-item" style={{ padding: '7px 10px', borderRadius: '9px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '2px', fontSize: '0.78rem' }}>
            {t('nav.how_to_get_step5_title')}
          </strong>
          <span style={{ color: '#94a3b8', lineHeight: 1.35 }}>{t('nav.how_to_get_step5_desc')}</span>
        </div>
      </div>

      {/* FOOTER TIP */}
      <div
        style={{
          padding: '6px 10px',
          borderRadius: '8px',
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          fontSize: '0.72rem',
          color: '#cbd5e1',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <ShieldCheck size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
        <span>{t('nav.how_to_get_tip')}</span>
      </div>
    </div>
  );

  return isModal ? (
    <div
      className="modal-overlay api-modal-container"
      onMouseDown={(e) => {
        mouseDownOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownOnBackdropRef.current && !saving && onClose) {
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
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '16px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          maxWidth: showGuide ? '930px' : '450px',
          width: '100%',
          transition: 'max-width 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          flexWrap: 'wrap',
        }}
      >
        {/* MAIN CREDENTIALS FORM CARD */}
        <div
          className="api-card-enter"
          style={{
            flex: '1 1 420px',
            maxWidth: '450px',
            width: '100%',
            height: 'fit-content',
            alignSelf: 'center',
            background: 'linear-gradient(150deg, rgba(18, 24, 38, 0.96) 0%, rgba(10, 14, 24, 0.98) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '20px',
            padding: '22px 24px',
            boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.85), 0 0 30px rgba(56, 189, 248, 0.15)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            position: 'relative',
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
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
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

          {/* HEADER: COMPACT ICON & TITLE */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#38bdf8',
              }}
            >
              <KeyRound size={20} />
            </div>
            <div>
              <h2 id="api-modal-title" style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, letterSpacing: '-0.01em', color: '#ffffff' }}>
                {t('nav.api_setup_title')}
              </h2>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '2px 0 0 0', lineHeight: 1.35 }}>
                {t('nav.api_setup_subtitle')}
              </p>
            </div>
          </div>

          {/* ACTION BAR: HOW TO GET GUIDE TRIGGER */}
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '10px',
              background: 'rgba(56, 189, 248, 0.06)',
              border: '1px solid rgba(56, 189, 248, 0.18)',
              fontSize: '0.76rem',
              color: '#cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={15} style={{ color: '#38bdf8', flexShrink: 0 }} />
              <span>{t('nav.api_setup_guide_title')}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setHasInteractedGuide(true);
                setShowGuide(!showGuide);
              }}
              className={`how-to-get-btn ${
                error
                  ? 'how-to-get-btn-error-pulse'
                  : !hasInteractedGuide && !showGuide
                  ? 'how-to-get-btn-pulse'
                  : ''
              }`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 11px',
                borderRadius: '7px',
                background: error
                  ? 'rgba(239, 68, 68, 0.22)'
                  : showGuide
                  ? 'rgba(56, 189, 248, 0.3)'
                  : 'rgba(56, 189, 248, 0.15)',
                border: error
                  ? '1px solid rgba(248, 113, 113, 0.7)'
                  : '1px solid rgba(56, 189, 248, 0.38)',
                color: error ? '#fca5a5' : '#38bdf8',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all 0.2s ease',
              }}
            >
              <HelpCircle size={13} />
              <span>{t('nav.how_to_get_btn')}</span>
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
                fontSize: '0.78rem',
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* SUCCESS ALERT */}
          {successMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 12px',
                borderRadius: '10px',
                background: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                color: '#34d399',
                fontSize: '0.82rem',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)',
              }}
            >
              <CheckCircle size={16} style={{ flexShrink: 0 }} />
              <span>{successMsg}</span>
            </div>
          )}

          {/* FORM INPUTS */}
          <form
            onSubmit={handleSubmit}
            className={error ? 'ag-shake-error' : undefined}
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: error ? '#fca5a5' : '#cbd5e1', marginBottom: '4px' }}>
                {t('nav.api_id_label')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={apiId}
                onChange={(e) => {
                  if (error) setError(null);
                  setApiId(e.target.value);
                }}
                placeholder={t('ui.generated.contoh_1234567_25ccc85')}
                required
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  background: error ? 'rgba(239, 68, 68, 0.08)' : 'rgba(15, 23, 42, 0.8)',
                  border: error ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: error ? '0 0 14px rgba(239, 68, 68, 0.35)' : 'none',
                  color: '#f8fafc',
                  fontSize: '0.86rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'all 0.2s ease',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: error ? '#fca5a5' : '#cbd5e1', marginBottom: '4px' }}>
                {t('nav.api_hash_label')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showHash ? 'text' : 'password'}
                  value={apiHash}
                  onChange={(e) => {
                    if (error) setError(null);
                    setApiHash(e.target.value);
                    setApiHashDirty(true);
                  }}
                  placeholder={
                    savedCredsRef.current?.apiHash && !apiHashDirty
                      ? '••••••••••••••••••••••••••••••••'
                      : t('ui.generated.contoh_0123456789abcdef0123456789abcdef_ece8eb0')
                  }
                  required
                  style={{
                    width: '100%',
                    padding: '9px 36px 9px 12px',
                    borderRadius: '10px',
                    background: error ? 'rgba(239, 68, 68, 0.08)' : 'rgba(15, 23, 42, 0.8)',
                    border: error ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: error ? '0 0 14px rgba(239, 68, 68, 0.35)' : 'none',
                    color: '#f8fafc',
                    fontSize: '0.86rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s ease',
                  }}
                />
                <button
                  type="button"
                  onClick={handleToggleShowHash}
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
                  {showHash ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              style={{
                marginTop: '4px',
                padding: '10px',
                borderRadius: '10px',
                background: saving
                  ? 'rgba(56, 189, 248, 0.2)'
                  : 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
                border: saving ? '1px solid rgba(56, 189, 248, 0.4)' : 'none',
                color: saving ? '#38bdf8' : '#ffffff',
                fontSize: '0.88rem',
                fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: saving ? 'none' : '0 4px 14px rgba(56, 189, 248, 0.25)',
                transition: 'all 0.18s ease',
              }}
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>{t('nav.api_setup_verifying')}</span>
                </>
              ) : (
                <>
                  <span>{t('nav.api_setup_submit')}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div
            style={{
              margin: 0,
              fontSize: '0.74rem',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              textAlign: 'center',
              lineHeight: 1.3,
            }}
          >
            <ShieldCheck size={15} style={{ flexShrink: 0, color: '#64748b' }} />
            <span>{t('ui.generated.credentials_anda_disimpan_secara_terenkripsi_ama_b24611b')}</span>
          </div>
        </div>

        {/* SIDE CARD: HOW TO GET GUIDE MODAL */}
        {showGuide && renderGuideCard(() => setShowGuide(false))}
      </div>
    </div>
  ) : (
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
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          maxWidth: showGuide ? '960px' : '460px',
          width: '100%',
          transition: 'max-width 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          flexWrap: 'wrap',
        }}
      >
        <div
          className="api-card-enter"
          style={{
            flex: '1 1 420px',
            maxWidth: '460px',
            width: '100%',
            height: 'fit-content',
            alignSelf: 'center',
            background: 'linear-gradient(150deg, rgba(18, 24, 38, 0.9) 0%, rgba(10, 14, 24, 0.98) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '20px',
            padding: '24px 28px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(56, 189, 248, 0.15)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxSizing: 'border-box',
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

          {/* HEADER: COMPACT ICON & TITLE */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#38bdf8',
              }}
            >
              <KeyRound size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em', color: '#ffffff' }}>
                {t('nav.api_setup_title')}
              </h2>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '2px 0 0 0', lineHeight: 1.4 }}>
                {t('nav.api_setup_subtitle')}
              </p>
            </div>
          </div>

          {/* ACTION BAR: HOW TO GET GUIDE TRIGGER */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(56, 189, 248, 0.06)',
              border: '1px solid rgba(56, 189, 248, 0.18)',
              fontSize: '0.78rem',
              color: '#cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={16} style={{ color: '#38bdf8', flexShrink: 0 }} />
              <span>{t('nav.api_setup_guide_title')}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setHasInteractedGuide(true);
                setShowGuide(!showGuide);
              }}
              className={`how-to-get-btn ${!hasInteractedGuide && !showGuide ? 'how-to-get-btn-pulse' : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 11px',
                borderRadius: '7px',
                background: showGuide ? 'rgba(56, 189, 248, 0.3)' : 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                fontSize: '0.76rem',
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <HelpCircle size={13} />
              <span>{t('nav.how_to_get_btn')}</span>
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
                  onChange={(e) => {
                    setApiHash(e.target.value);
                    setApiHashDirty(true);
                  }}
                  placeholder={
                    savedCredsRef.current?.apiHash && !apiHashDirty
                      ? '••••••••••••••••••••••••••••••••'
                      : t('ui.generated.contoh_0123456789abcdef0123456789abcdef_ece8eb0')
                  }
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
                  onClick={handleToggleShowHash}
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

          <div
            style={{
              margin: 0,
              fontSize: '0.74rem',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              textAlign: 'center',
              lineHeight: 1.3,
            }}
          >
            <ShieldCheck size={15} style={{ flexShrink: 0, color: '#64748b' }} />
            <span>{t('ui.generated.credentials_anda_disimpan_secara_terenkripsi_ama_b24611b')}</span>
          </div>
        </div>

        {/* SIDE CARD GUIDE */}
        {showGuide && renderGuideCard(() => setShowGuide(false))}
      </div>
    </div>
  );
}
