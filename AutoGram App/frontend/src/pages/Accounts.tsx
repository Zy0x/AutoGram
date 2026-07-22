import { useState, useEffect, useRef } from 'react';
import { Users, Phone, Key, Plus, RefreshCcw, Lock, Trash2, ArrowLeft, QrCode, Smartphone } from 'lucide-react';
import 'react-phone-number-input/style.css';
import PhoneInput, { getCountryCallingCode } from 'react-phone-number-input';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getApiCredentials } from '../lib/secureCredentials';
import { tgAuthStatus, tgListSessions, tgLogin } from '../lib/telegramBackend';
import { invalidateSessionListCache } from '../lib/sessionPicker';

const safeGetCallingCode = (val: string) => {
  if (!val) return '';
  try {
    return getCountryCallingCode(val as any);
  } catch (e) {
    return '';
  }
};

const CustomCountrySelect = ({ value, onChange, options, iconComponent: Icon }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: rect.left });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        ref.current && !ref.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div 
      ref={ref} 
      className="PhoneInputCountry"
      style={{ cursor: 'pointer', height: '100%' }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(!isOpen);
      }}
    >
      {Icon && <Icon country={value} label="Country" />}
      <div className="PhoneInputCountrySelectArrow" style={{ marginLeft: '4px', borderStyle: 'solid', borderWidth: '4px 4px 0 4px', borderColor: 'var(--text-muted) transparent transparent transparent' }} />
      
      {isOpen && createPortal(
        <div 
          ref={dropdownRef}
          style={{ 
          position: 'fixed', top: pos.top, left: pos.left, width: '280px', 
          maxHeight: '250px', overflowY: 'auto',
          background: 'var(--bg-secondary, #1a1b23)', border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.8)', zIndex: 9999,
          display: 'flex', flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
        >
           <div style={{ padding: '8px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-secondary, #1a1b23)', zIndex: 2 }}>
             <input 
               autoFocus
               type="text" 
               placeholder="Search country..." 
               value={search}
               onChange={e => setSearch(e.target.value)}
               style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '4px', color: '#fff', outline: 'none' }}
             />
           </div>
           {options.filter((o: any) => o.label && o.label.toLowerCase().includes(search.toLowerCase())).map((o: any) => (
             <div 
               key={o.value || 'zz'}
               onClick={(e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 onChange(o.value);
                 setIsOpen(false);
                 setSearch('');
               }}
               style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
               onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
               onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
             >
               {Icon && <Icon country={o.value} label={o.label} />}
               <span style={{ color: 'var(--text-main)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
               {o.value && <span style={{ color: 'var(--text-muted)' }}>+{safeGetCallingCode(o.value)}</span>}
             </div>
           ))}
        </div>,
        document.body
      )}
    </div>
  )
}

export function Accounts() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<{
    name: string;
    status?: string;
    userLabel?: string;
    latencyMs?: number;
  }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Active Sessions State
  const [activeSessions, setActiveSessions] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('ACTIVE_SESSIONS') || '[]');
      return Array.isArray(stored) ? stored.map(String).filter(Boolean).slice(0, 1) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem('ACTIVE_SESSIONS', JSON.stringify(activeSessions));
  }, [activeSessions]);

  const toggleSession = (name: string) => {
    // One interactive owner prevents two accounts from competing for Media
    // Studio state. Jobs still carry their explicit session independently.
    setActiveSessions(prev => prev.includes(name) ? [] : [name]);
  };
  
  // Wizard State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sessionName, setSessionName] = useState("");
  const [phone, setPhone] = useState<string | undefined>("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  
  // QR Login State
  const [loginMethod, setLoginMethod] = useState<'qr' | 'phone'>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrExpiresIn, setQrExpiresIn] = useState<number>(0);
  const QR_JOB_ID = 888888;
  const unlistenQrRef = useRef<(() => void) | null>(null);
  const qrCountdownTimerRef = useRef<any>(null);

  const stopQrTimers = async () => {
    if (unlistenQrRef.current) {
      unlistenQrRef.current();
      unlistenQrRef.current = null;
    }
    if (qrCountdownTimerRef.current) {
      clearInterval(qrCountdownTimerRef.current);
      qrCountdownTimerRef.current = null;
    }
    try {
      await invoke('kill_worker_job', { jobId: QR_JOB_ID });
    } catch {}
    if (sessionName) {
      try {
        await invoke('cancel_rust_qr_login', { session: sessionName });
      } catch {}
    }
  };

  useEffect(() => {
    return () => {
      stopQrTimers();
    };
  }, []);

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const loadSessions = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      // Ensure API credentials recovered (secure store / worker .env) before list
      const { bootstrapSecureCredentials } = await import('../lib/secureCredentials');
      const { apiId, apiHash } = await bootstrapSecureCredentials();

      const list = await tgListSessions();
      setSessions(list.map((s) => ({ name: s.name, status: s.status })));
      setIsLoading(false);
      const validNames = list.map((s: any) => s.name);
      setActiveSessions((prev) => prev.filter((p) => validNames.includes(p)).slice(0, 1));

      if (!apiId || !apiHash) {
        setErrorMsg(
          t('accounts.error_api_required') ||
            'API ID / Hash belum terisi. Buka Settings untuk menyimpan credentials — session file tetap aman di disk.'
        );
        return;
      }

      await Promise.all(
        list.map(async (saved) => {
          const started = performance.now();
          const result = await tgAuthStatus({
            session: saved.name,
            apiId: Number(apiId),
            apiHash,
          });
          const latencyMs = Math.max(0, Math.round(performance.now() - started));
          const connected = !!result?.ok && !!result.data?.authorized;
          const user = result?.data?.user;
          const userLabel = user
            ? user.username
              ? `@${user.username}`
              : user.firstName || undefined
            : undefined;
          setSessions((current) =>
            current.map((row) =>
              row.name === saved.name
                ? {
                    ...row,
                    status: connected ? 'connected' : result?.error ? 'error' : 'expired',
                    userLabel,
                    latencyMs,
                  }
                : row
            )
          );
        })
      );
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (/requires desktop|requires tauri/i.test(msg)) {
        setErrorMsg(
          'Daftar session butuh aplikasi desktop AutoGram. Buka lewat Tauri (bukan browser saja).'
        );
      } else {
        console.error(e);
        setErrorMsg(msg);
      }
      // Do not clear existing sessions on transient failure
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const closeWizard = async () => {
    if (isProcessing) return;
    await stopQrTimers();
    if (sessionName) {
      const current = sessions.find((s) => s.name === sessionName);
      if (!current || current.status !== 'connected') {
        try {
          await invoke('delete_session_rust', { session: sessionName });
        } catch {}
      }
    }
    setIsWizardOpen(false);
    loadSessions();
  };

  const openWizard = () => {
    stopQrTimers();
    setStep(1);
    setLoginMethod("qr");
    setQrDataUrl(null);
    setQrExpiresIn(0);
    setSessionName("");
    setPhone("");
    setCode("");
    setPassword("");
    setPasswordHint("");
    setErrorMsg("");
    setAuthNotice("");
    setIsWizardOpen(true);
  };

  const finishAuthorization = async (name: string) => {
    const { apiId, apiHash } = await getApiCredentials();
    let verified = false;
    let userLabel = '';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const status = await tgAuthStatus({
        session: name,
        apiId: Number(apiId),
        apiHash,
      });
      if (status?.ok && status.data?.authorized) {
        verified = true;
        const user = status.data.user;
        userLabel = user?.username ? `@${user.username}` : user?.firstName || '';
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 350 + attempt * 150));
    }
    if (!verified) {
      setErrorMsg('Telegram menerima login, tetapi koneksi Grammers belum terverifikasi. Coba lagi tanpa menghapus session.');
      setIsProcessing(false);
      return false;
    }
    await stopQrTimers();
    invalidateSessionListCache();
    setActiveSessions([name]);
    setAuthNotice(`Terkoneksi dan terverifikasi${userLabel ? ` sebagai ${userLabel}` : ''}.`);
    setIsWizardOpen(false);
    setIsProcessing(false);
    await loadSessions();
    return true;
  };

  const handleStartQrLogin = async () => {
    if (!sessionName) {
      setErrorMsg('Nama sesi wajib diisi.');
      return;
    }

    if (!(await checkApiCredentials())) return;

    await stopQrTimers();
    setIsProcessing(true);
    setErrorMsg('');
    setQrDataUrl(null);

    try {
      const { apiId, apiHash } = await getApiCredentials();

      if (isTauri()) {
        const unlisten = await listen<any>('qr-event', async (event) => {
          const payload = event.payload || {};
          if (payload.session && payload.session !== sessionName) return;

          if (payload.status === 'already_authorized') {
            await finishAuthorization(sessionName);
          } else if (payload.status === 'qr_code' && payload.url) {
            const dataUrl = await QRCode.toDataURL(payload.url, { margin: 2, width: 240 });
            setQrDataUrl(dataUrl);

            const exp = Number(payload.expires) || 0;
            const nowSec = Math.floor(Date.now() / 1000);
            const rem = Math.max(0, exp - nowSec) || 60;
            setQrExpiresIn(rem);
            setIsProcessing(false);

            if (qrCountdownTimerRef.current) clearInterval(qrCountdownTimerRef.current);
            qrCountdownTimerRef.current = setInterval(() => {
              setQrExpiresIn((prev) => Math.max(0, prev - 1));
            }, 1000);
          } else if (payload.status === 'success') {
            await finishAuthorization(sessionName);
          } else if (payload.status === '2fa_required') {
            await stopQrTimers();
            setPasswordHint(String(payload.password_hint || ''));
            setStep(3);
            setIsProcessing(false);
          } else if (payload.status === 'error') {
            await stopQrTimers();
            setErrorMsg(payload.error || 'Gagal login via QR code');
            setIsProcessing(false);
          }
        });

        unlistenQrRef.current = unlisten;

        await invoke('start_rust_qr_login', {
          session: sessionName,
          apiId: Number(apiId),
          apiHash: apiHash || '',
        });
      } else {
        throw new Error('Login Telegram hanya tersedia di aplikasi desktop AutoGram.');
      }
    } catch (e: any) {
      setErrorMsg(String(e?.message || e));
      setIsProcessing(false);
    }
  };

  const handleDeleteSession = async (name: string) => {
    if (!window.confirm(t('accounts.delete_confirm', { name }))) return;

    setIsLoading(true);
    setSessions((prev) => prev.filter((s) => s.name !== name));
    setActiveSessions((prev) => prev.filter((p) => p !== name));

    try {
      if (isTauri()) {
        try {
          await invoke('delete_session_rust', { session: name });
        } catch {}
      }

      invalidateSessionListCache();
      await loadSessions();
    } catch (e) {
      console.error(e);
      await loadSessions();
    } finally {
      setIsLoading(false);
    }
  };

  const checkApiCredentials = async () => {
    const { apiId, apiHash } = await getApiCredentials();
    if (!apiId || !apiHash) {
      setErrorMsg(t('accounts.error_api_required'));
      return false;
    }
    return true;
  };

  const handleError = (data: any) => {
    if (data.error === 'flood_wait') {
      const minutes = Math.ceil(data.seconds / 60);
      const waitTime = minutes > 60 ? `${Math.ceil(minutes/60)} jam` : `${minutes} menit`;
      setErrorMsg(t('error.flood_wait', { time: waitTime }));
    } else if (data.error === 'code_expired') {
      setErrorMsg(t('error.code_expired'));
      setStep(1);
    } else if (data.error === 'invalid_api_id') {
      setErrorMsg(t('error.invalid_api_id'));
    } else if (data.error === 'timeout') {
      setErrorMsg(t('error.timeout'));
    } else if (data.error === 'db_locked') {
      setErrorMsg(t('error.db_locked'));
    } else if (data.error === 'invalid_otp') {
      setErrorMsg(t('error.invalid_otp'));
    } else if (data.error === 'invalid_password') {
      setErrorMsg(t('error.invalid_password'));
    } else {
      setErrorMsg(data.error);
    }
  };

  const handleSendCode = async () => {
    if (!sessionName || !phone) {
      setErrorMsg(t('accounts.error_fields_required'));
      return;
    }

    if (!(await checkApiCredentials())) return;

    const finalPhone = phone;
    setIsProcessing(true);
    setErrorMsg('');
    try {
      const { apiId, apiHash } = await getApiCredentials();
      const result = await tgLogin({
        session: sessionName,
        phone: finalPhone || '',
        apiId: Number(apiId),
        apiHash,
      });
      const data = result?.data;

      if (!result?.ok || !data) {
        handleError({ error: result?.userMessage || result?.error?.message || result?.error?.code || 'Gagal mengirim kode login.' });
      } else if (data.status === 'already_authorized' || data.status === 'authorized') {
        await finishAuthorization(sessionName);
      } else if (data.status === 'code_sent') {
        setPhone(finalPhone);
        setStep(2);
      }
    } catch (e: any) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignIn = async () => {
    if (!code) return;

    setIsProcessing(true);
    setErrorMsg('');

    try {
      const { apiId, apiHash } = await getApiCredentials();
      const result = await tgLogin({
        session: sessionName,
        phone: phone || '',
        code,
        apiId: Number(apiId),
        apiHash,
      });
      const data = result?.data;

      if (!result?.ok || !data) {
        handleError({ error: result?.userMessage || result?.error?.message || result?.error?.code || 'Kode login ditolak.' });
      } else if (data.status === 'password_required' || data.needsPassword) {
        setPasswordHint(data.passwordHint || '');
        setStep(3);
      } else if (data.status === 'authorized') {
        await finishAuthorization(sessionName);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignIn2FA = async () => {
    if (!password) return;

    setIsProcessing(true);
    setErrorMsg('');

    try {
      const { apiId, apiHash } = await getApiCredentials();
      const result = await tgLogin({
        session: sessionName,
        password,
        apiId: Number(apiId),
        apiHash,
      });
      const data = result?.data;

      if (!result?.ok || !data) {
        handleError({ error: result?.userMessage || result?.error?.message || result?.error?.code || 'Password 2FA ditolak.' });
      } else if (data.status === 'authorized') {
        await finishAuthorization(sessionName);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="main-content page-stack">
      <header className="page-header">
        <h2 className="title">{t('accounts.title')}</h2>
        <p className="subtitle">{t('accounts.subtitle')}</p>
      </header>

      {authNotice && (
        <div className="alert alert-success" role="status">
          {authNotice}
        </div>
      )}

      <div className="grid-layout" style={{ gridTemplateColumns: '1fr' }}>
        <div className="glass-panel card">
          <div className="card-header card-header-spread">
            <div className="title-with-icon">
              <Users size={20} color="var(--primary)" aria-hidden />
              <h3 style={{ margin: 0 }}>{t('accounts.saved_sessions')}</h3>
            </div>
            <div className="page-header-actions">
                <button type="button" className="btn btn-primary" onClick={openWizard}>
                  <Plus size={16} /> {t('accounts.btn_add')}
                </button>
            </div>
          </div>
          
          <div className="card-body">
            {isLoading ? (
              <div className="title-with-icon" style={{ color: 'var(--text-muted)' }}>
                <RefreshCcw size={16} className="spin" /> {t('accounts.loading_sessions')}
              </div>
            ) : sessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('accounts.no_accounts')}</p>
            ) : (
              sessions.map((s, idx) => (
                <div key={idx} className="list-row">
                  <div className="list-row-main">
                    <div className="avatar-circle">
                      <Users size={20} color="var(--primary)" aria-hidden />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h4 style={{ margin: 0, opacity: s.status === 'expired' ? 0.7 : 1, wordBreak: 'break-word' }}>
                        {s.name}
                      </h4>
                      <span className={`session-status status-${s.status || 'ok'}`}>
                        {s.status === 'connected'
                          ? `Terkoneksi${s.userLabel ? ` · ${s.userLabel}` : ''}${s.latencyMs != null ? ` · ${s.latencyMs} ms` : ''}`
                          : s.status === 'checking' || s.status === 'migration_required'
                            ? 'Memverifikasi koneksi…'
                            : s.status === 'expired'
                              ? t('accounts.status_expired')
                              : t('accounts.status_error')}
                      </span>
                    </div>
                  </div>
                  <div className="list-row-actions" style={{ opacity: s.status === 'connected' ? 1 : 0.65 }}>
                    <div className="title-with-icon" style={{ gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: activeSessions.includes(s.name) ? 'var(--primary)' : 'var(--text-muted)', fontWeight: activeSessions.includes(s.name) ? '600' : 'normal' }}>
                        {activeSessions.includes(s.name) ? t('accounts.active_target') : t('accounts.inactive')}
                      </span>
                      <div 
                        role="switch"
                        aria-checked={activeSessions.includes(s.name)}
                        tabIndex={0}
                        onClick={() => s.status === 'connected' && toggleSession(s.name)}
                        onKeyDown={(e) => { if (s.status === 'connected' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSession(s.name); } }}
                        className={`session-toggle ${activeSessions.includes(s.name) ? 'on' : ''}`}
                      >
                        <div className="session-toggle-knob" />
                      </div>
                    </div>
                    
                    <button 
                      type="button"
                      onClick={() => handleDeleteSession(s.name)}
                      className="btn btn-secondary btn-icon btn-danger-soft"
                      title={t('accounts.delete_title')}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Login Wizard Modal */}
      {isWizardOpen && (
        <div className="modal-overlay" onClick={closeWizard}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {step > 1 && (
                <button 
                  onClick={() => setStep(step === 3 ? 2 : 1)} 
                  disabled={isProcessing}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    color: 'var(--text-muted)', 
                    cursor: 'pointer', 
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  title={t('accounts.go_back')}
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                {step === 1 ? t('accounts.step_connect') : step === 2 ? t('accounts.step_verify') : t('accounts.step_2fa')}
              </h3>
            </div>
            
            <div className="modal-body" style={{ padding: '24px' }}>
              {errorMsg && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem' }}>
                  {errorMsg}
                </div>
              )}
              
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Method Tabs */}
                  <div style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <button
                      type="button"
                      onClick={() => { setLoginMethod('qr'); stopQrTimers(); setQrDataUrl(null); }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: loginMethod === 'qr' ? 'var(--primary)' : 'transparent',
                        color: loginMethod === 'qr' ? '#fff' : 'var(--text-muted)',
                        fontWeight: '600',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                      }}
                    >
                      <QrCode size={16} /> Scan QR Code
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginMethod('phone'); stopQrTimers(); setQrDataUrl(null); }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: loginMethod === 'phone' ? 'var(--primary)' : 'transparent',
                        color: loginMethod === 'phone' ? '#fff' : 'var(--text-muted)',
                        fontWeight: '600',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                      }}
                    >
                      <Phone size={16} /> Nomor Telepon & OTP
                    </button>
                  </div>

                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">{t('accounts.session_name')}</label>
                    <input id="session-name-input" type="text" className="input-field" placeholder="MyAccount" value={sessionName} onChange={e => setSessionName(e.target.value)} spellCheck={false} autoComplete="off" disabled={isProcessing} />
                  </div>

                  {loginMethod === 'qr' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginTop: '4px' }}>
                      {!qrDataUrl ? (
                        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleStartQrLogin} disabled={isProcessing || !sessionName}>
                          {isProcessing ? <RefreshCcw className="spin" size={18} /> : <span style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}><QrCode size={18} /> Buat QR Code Login</span>}
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', width: '100%' }}>
                          <div style={{ background: '#ffffff', padding: '12px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <img src={qrDataUrl} alt="Telegram Login QR Code" style={{ width: '200px', height: '200px', display: 'block' }} />
                            {qrExpiresIn > 0 && (
                              <span style={{ fontSize: '0.75rem', color: '#333', fontWeight: '600', marginTop: '6px' }}>
                                Masa berlaku: {qrExpiresIn}s
                              </span>
                            )}
                          </div>

                          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-muted)', width: '100%' }}>
                            <div style={{ fontWeight: '600', color: 'var(--text-main)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Smartphone size={16} color="var(--primary)" /> Langkah-langkah scan di HP:
                            </div>
                            <ol style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.5' }}>
                              <li>Buka aplikasi <strong>Telegram</strong> di Smartphone Anda.</li>
                              <li>Masuk ke <strong>Pengaturan (Settings) &gt; Perangkat (Devices)</strong>.</li>
                              <li>Ketuk <strong>Hubungkan Perangkat (Link Desktop Device)</strong>.</li>
                              <li>Arahkan kamera HP ke QR Code di atas.</li>
                            </ol>
                          </div>

                          <div className="field-hint" role="status" style={{ textAlign: 'center' }}>
                            QR diperbarui otomatis saat kedaluwarsa. AutoGram sedang menunggu konfirmasi Telegram.
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Phone size={14} /> {t('accounts.phone_number')}
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <PhoneInput
                            id="phone-input"
                            countrySelectComponent={CustomCountrySelect}
                            placeholder="62878xxxx"
                            value={phone}
                            onChange={setPhone}
                            onKeyDown={(e: any) => { 
                              if (e.key === 'Enter') {
                                if (sessionName && phone && !isProcessing) handleSendCode();
                                else if (!sessionName) document.getElementById('session-name-input')?.focus();
                              }
                            }}
                            autoComplete="off"
                            international
                            withCountryCallingCode
                            className="input-field phone-input-container"
                            disabled={isProcessing}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                      <button className="btn btn-primary" onClick={handleSendCode} disabled={isProcessing || !sessionName || !phone}>
                        {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.send_code')}
                      </button>
                    </>
                  )}
                </div>
              )}

              {step === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {t('accounts.verify_desc')}
                  </p>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Key size={14} /> {t('accounts.otp_code')}
                    </label>
                    <input type="text" className="input-field" placeholder="12345" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && code && !isProcessing) handleSignIn() }} disabled={isProcessing} />
                  </div>
                  <button className="btn btn-primary" onClick={handleSignIn} disabled={isProcessing || !code}>
                    {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.verify_code')}
                  </button>
                </div>
              )}

              {step === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {t('accounts.2fa_desc')}
                    {passwordHint ? ` Hint: ${passwordHint}` : ''}
                  </p>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Lock size={14} /> {t('accounts.2fa_password')}
                    </label>
                    <input type="password" className="input-field" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && password && !isProcessing) handleSignIn2FA() }} disabled={isProcessing} />
                  </div>
                  <button className="btn btn-primary" onClick={handleSignIn2FA} disabled={isProcessing || !password}>
                    {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.submit_password')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
