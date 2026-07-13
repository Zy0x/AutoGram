import { useState, useEffect, useRef } from 'react';
import { Users, Phone, Key, Plus, RefreshCcw, Lock, Trash2, ArrowLeft } from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import 'react-phone-number-input/style.css';
import PhoneInput, { getCountryCallingCode } from 'react-phone-number-input';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';

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
  const [sessions, setSessions] = useState<{name: string, status?: string}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Active Sessions State
  const [activeSessions, setActiveSessions] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ACTIVE_SESSIONS') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem('ACTIVE_SESSIONS', JSON.stringify(activeSessions));
  }, [activeSessions]);

  const toggleSession = (name: string) => {
    setActiveSessions(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]);
  };
  
  // Wizard State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sessionName, setSessionName] = useState("");
  const [phone, setPhone] = useState<string | undefined>("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const apiId = localStorage.getItem('API_ID');
      const apiHash = localStorage.getItem('API_HASH');
      
      const command = Command.create('python', [
        '../../worker/auth_manager.py', 
        '--action', 'list-sessions',
        '--api-id', apiId || "",
        '--api-hash', apiHash || ""
      ]);
      const result = await command.execute();
      
      if (!result.stdout && result.stderr) {
        throw new Error(t('error.python_error', { error: result.stderr }));
      }
      
      let data;
      try {
        data = JSON.parse(result.stdout);
      } catch (e) {
        throw new Error(t('error.json_error', { error: (result.stdout || result.stderr) }));
      }
      
      if(data.sessions) {
        setSessions(data.sessions);
        // Hapus sesi aktif dari state jika sudah tidak ada di file (misal dihapus dari luar)
        const validNames = data.sessions.map((s: any) => s.name);
        setActiveSessions(prev => prev.filter(p => validNames.includes(p)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const openWizard = () => {
    setStep(1);
    setSessionName("");
    setPhone("");
    setCode("");
    setPassword("");
    setErrorMsg("");
    setIsWizardOpen(true);
  };

  const handleDeleteSession = async (name: string) => {
    if (!window.confirm(t('accounts.delete_confirm', { name }))) return;
    
    setIsLoading(true);
    try {
      const command = Command.create('python', ['../../worker/auth_manager.py', '--action', 'delete-session', '--session', name]);
      const result = await command.execute();
      
      if (!result.stdout && result.stderr) {
        throw new Error(t('error.python_error', { error: result.stderr }));
      }
      
      await loadSessions();
    } catch (e) {
      console.error(e);
      alert(String(e));
      setIsLoading(false);
    }
  };

  const checkApiCredentials = () => {
    const apiId = localStorage.getItem('API_ID');
    const apiHash = localStorage.getItem('API_HASH');
    
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
    
    if (!checkApiCredentials()) return;

    // `react-phone-number-input` always returns full E.164 format like '+628123456789'
    const finalPhone = phone;
    
    setIsProcessing(true);
    setErrorMsg("");
    try {
      const apiId = localStorage.getItem('API_ID');
      const apiHash = localStorage.getItem('API_HASH');

      const command = Command.create('python', [
        '../../worker/auth_manager.py', 
        '--action', 'send-code', 
        '--session', sessionName, 
        '--phone', finalPhone || "",
        '--api-id', apiId || "",
        '--api-hash', apiHash || ""
      ]);
      
      const result = await command.execute();
      
      if (!result.stdout && result.stderr) {
        throw new Error(t('error.python_error', { error: result.stderr }));
      }
      
      let data;
      try {
        data = JSON.parse(result.stdout);
      } catch (e) {
        throw new Error(t('error.json_error', { error: (result.stdout || result.stderr) }));
      }
      
      if(data.error) {
        handleError(data);
      } else if (data.status === 'already_authorized') {
        setIsWizardOpen(false);
        loadSessions();
      } else if (data.status === 'code_sent') {
        setPhoneCodeHash(data.phone_code_hash);
        // Simpan nomor yang sudah diformat ke state agar bisa dipakai tahap selanjutnya
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
    
    const apiId = localStorage.getItem('API_ID');
    const apiHash = localStorage.getItem('API_HASH');
    
    setIsProcessing(true);
    setErrorMsg("");
    
    try {
      const command = Command.create('python', [
        '../../worker/auth_manager.py', 
        '--action', 'sign-in', 
        '--session', sessionName, 
        '--phone', phone || "",
        '--code', code,
        '--hash', phoneCodeHash,
        '--api-id', apiId || "",
        '--api-hash', apiHash || ""
      ]);
      
      const result = await command.execute();
      
      if (!result.stdout && result.stderr) {
        throw new Error(t('error.python_error', { error: result.stderr }));
      }
      
      let data;
      try {
        data = JSON.parse(result.stdout);
      } catch (e) {
        throw new Error(t('error.json_error', { error: (result.stdout || result.stderr) }));
      }
      
      if(data.error) {
        handleError(data);
      } else if (data.status === '2fa_required') {
        setStep(3);
      } else if (data.status === 'success') {
        setIsWizardOpen(false);
        loadSessions();
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignIn2FA = async () => {
    if (!password) return;
    
    const apiId = localStorage.getItem('API_ID');
    const apiHash = localStorage.getItem('API_HASH');
    
    setIsProcessing(true);
    setErrorMsg("");
    
    try {
      const command = Command.create('python', [
        '../../worker/auth_manager.py', 
        '--action', 'sign-in-2fa', 
        '--session', sessionName, 
        '--password', password,
        '--api-id', apiId || "",
        '--api-hash', apiHash || ""
      ]);
      
      const result = await command.execute();
      
      if (!result.stdout && result.stderr) {
        throw new Error(t('error.python_error', { error: result.stderr }));
      }
      
      let data;
      try {
        data = JSON.parse(result.stdout);
      } catch (e) {
        throw new Error(t('error.json_error', { error: (result.stdout || result.stderr) }));
      }
      
      if(data.error) {
        handleError(data);
      } else if (data.status === 'success') {
        setIsWizardOpen(false);
        loadSessions();
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="main-content">
      <header style={{ marginBottom: '32px' }}>
        <h2 className="title">{t('accounts.title')}</h2>
        <p className="subtitle">{t('accounts.subtitle')}</p>
      </header>

      <div className="grid-layout">
        <div className="glass-panel card">
          <div className="card-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={20} color="var(--primary)" />
              <h3 style={{ margin: 0 }}>{t('accounts.saved_sessions')}</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {sessions.length > 0 && (
                <button 
                  onClick={() => setActiveSessions(sessions.length === activeSessions.length ? [] : sessions.map(s => s.name))}
                  style={{ 
                    background: 'transparent', border: '1px solid var(--border-light)', 
                    color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  {sessions.length === activeSessions.length ? t('accounts.deselect_all') : t('accounts.select_all')}
                </button>
              )}
                <button className="btn btn-primary" onClick={openWizard} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={16} /> {t('accounts.btn_add')}
                </button>
            </div>
          </div>
          
          <div className="card-body">
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                <RefreshCcw size={16} className="spin" /> {t('accounts.loading_sessions')}
              </div>
            ) : sessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('accounts.no_accounts')}</p>
            ) : (
              sessions.map((s, idx) => (
                <div key={idx} style={{ 
                  background: 'var(--bg-tertiary)', 
                  padding: '16px', 
                  borderRadius: '12px',
                  marginBottom: '12px',
                  border: '1px solid var(--border-light)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ background: 'rgba(99, 102, 241, 0.2)', padding: '10px', borderRadius: '50%' }}>
                      <Users size={20} color="var(--primary)" />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, opacity: s.status === 'expired' ? 0.7 : 1 }}>
                        {s.name}
                      </h4>
                      <span style={{ 
                        fontSize: '0.8rem', 
                        color: s.status === 'expired' ? '#ef4444' : s.status === 'error' ? '#f59e0b' : 'var(--accent)',
                        fontWeight: s.status === 'expired' ? '600' : 'normal'
                      }}>
                        {s.status === 'expired' ? t('accounts.status_expired') : s.status === 'error' ? t('accounts.status_error') : t('accounts.status_connected')}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', opacity: s.status === 'expired' ? 0.5 : 1, pointerEvents: s.status === 'expired' ? 'none' : 'auto' }}>
                    <div 
                      style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <span style={{ fontSize: '0.85rem', color: activeSessions.includes(s.name) ? 'var(--primary)' : 'var(--text-muted)', fontWeight: activeSessions.includes(s.name) ? '600' : 'normal' }}>
                        {activeSessions.includes(s.name) ? t('accounts.active_target') : t('accounts.inactive')}
                      </span>
                      <div 
                        onClick={() => toggleSession(s.name)}
                        style={{
                        width: '44px',
                        height: '24px',
                        background: activeSessions.includes(s.name) ? 'var(--primary)' : 'var(--border-light)',
                        borderRadius: '24px',
                        position: 'relative',
                        transition: 'background 0.3s',
                        cursor: 'pointer'
                      }}>
                        <div style={{
                          width: '20px',
                          height: '20px',
                          background: '#fff',
                          borderRadius: '50%',
                          position: 'absolute',
                          top: '2px',
                          left: activeSessions.includes(s.name) ? '22px' : '2px',
                          transition: 'left 0.3s',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }} />
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => handleDeleteSession(s.name)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: 'none',
                        padding: '8px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        color: 'rgb(239, 68, 68)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s'
                      }}
                      title={t('accounts.delete_title')}
                      onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                      onMouseOut={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
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
        <div className="modal-overlay" onClick={() => !isProcessing && setIsWizardOpen(false)}>
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
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">{t('accounts.session_name')}</label>
                    <input id="session-name-input" type="text" className="input-field" placeholder="MyAccount" value={sessionName} onChange={e => setSessionName(e.target.value)} spellCheck={false} autoComplete="off" onKeyDown={e => { 
                      if (e.key === 'Enter') {
                        if (sessionName && phone && !isProcessing) handleSendCode();
                        else if (!phone) document.getElementById('phone-input')?.focus();
                      }
                    }} disabled={isProcessing} />
                  </div>
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
