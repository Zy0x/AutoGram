import { useState, useEffect } from 'react';
import {
  Save,
  Key,
  ShieldCheck,
  Globe,
  Bug,
  Copy,
  Trash2,
  FileText,
  AlertTriangle,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  bootstrapSecureCredentials,
  setApiCredentials,
} from '../lib/secureCredentials';
import {
  isDebugMode,
  setDebugMode,
  subscribeDebugMode,
  getDebugLogBuffer,
  clearDebugLogBuffer,
  debugLogFileHint,
  debugLog,
  copyTextWithFallback,
} from '../lib/debugMode';

export function Settings() {
  const { t, i18n } = useTranslation();
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [isLoading, setIsLoading] = useState(true);
  const [debugOn, setDebugOn] = useState(() => isDebugMode());
  const [debugBusy, setDebugBusy] = useState(false);
  const [logSnap, setLogSnap] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // Load from encrypted store (migrates legacy localStorage once)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await bootstrapSecureCredentials();
        if (!cancelled) {
          setApiId(c.apiId);
          setApiHash(c.apiHash);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeDebugMode((on) => {
      setDebugOn(on);
      setLogSnap(getDebugLogBuffer());
    });
  }, []);

  // Refresh buffer while settings open + debug on
  useEffect(() => {
    if (!debugOn) return;
    const id = window.setInterval(() => setLogSnap(getDebugLogBuffer()), 1500);
    setLogSnap(getDebugLogBuffer());
    return () => window.clearInterval(id);
  }, [debugOn]);

  const toggleDebug = async (next: boolean) => {
    setDebugBusy(true);
    try {
      await setDebugMode(next);
      setDebugOn(next);
      debugLog('settings', next ? 'user enabled Debug Mode' : 'user disabled Debug Mode');
      setLogSnap(getDebugLogBuffer());
    } finally {
      setDebugBusy(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("idle");
    try {
      await setApiCredentials(apiId, apiHash);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <main className="main-content page-stack">
      <header className="page-header">
        <h2 className="title">{t('settings.title')}</h2>
        <p className="subtitle">{t('settings.subtitle')}</p>
      </header>

      <div className="grid-layout">
        <div className="glass-panel card">
          <div className="card-header">
            <Globe size={20} color="var(--primary)" />
            <h3>{t('settings.general')}</h3>
          </div>
          
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label title-with-icon">
              {t('settings.language')}
            </label>
            <p className="field-hint">
              {t('settings.language_desc')}
            </p>
            <select 
              className="input-field" 
              value={i18n.language} 
              onChange={(e) => changeLanguage(e.target.value)}
            >
              <option value="en">English (US)</option>
              <option value="id">Bahasa Indonesia</option>
            </select>
          </div>
        </div>

        <div className="glass-panel card">
          <div className="card-header">
            <ShieldCheck size={20} color="var(--accent)" />
            <h3>{t('settings.api_config')}</h3>
          </div>
          
          <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
            Dapatkan API ID &amp; API Hash dari{' '}
            <strong>my.telegram.org</strong>. Di desktop, kredensial disimpan{' '}
            <strong>terenkripsi</strong> (bukan LocalStorage browser). Jangan bagikan hash ke orang lain.
          </p>
          
          {isLoading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading existing credentials...</div>
          ) : (
            <div className="page-stack" style={{ gap: '1.25rem' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label title-with-icon">
                  <Key size={14} /> {t('settings.api_id')}
                </label>
                <input 
                  type="text" 
                  value={apiId} 
                  onChange={e => setApiId(e.target.value)} 
                  className="input-field" 
                  placeholder={t('settings.api_id_placeholder')}
                />
              </div>
              
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label title-with-icon">
                  <Key size={14} /> {t('settings.api_hash')}
                </label>
                <input 
                  type="password" 
                  value={apiHash} 
                  onChange={e => setApiHash(e.target.value)} 
                  className="input-field" 
                  placeholder={t('settings.api_hash_placeholder')} 
                />
              </div>
              
              <div className="page-header-actions" style={{ marginTop: '0.25rem' }}>
                <button 
                  type="button"
                  className="btn btn-primary" 
                  onClick={handleSave}
                  disabled={isSaving || !apiId || !apiHash}
                >
                  <Save size={18} />
                  {isSaving ? '...' : t('settings.save_btn')}
                </button>
                
                {saveStatus === 'success' && (
                  <span className="status-msg success">
                    ✓ {t('settings.save_success')}
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="status-msg error">
                    Failed to save settings.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={`glass-panel card dbg-card ${debugOn ? 'is-on' : ''}`}>
          <div className="dbg-head">
            <div className="dbg-head-left">
              <span className={`dbg-icon-badge ${debugOn ? 'on' : ''}`} aria-hidden>
                <Bug size={18} strokeWidth={2.25} />
              </span>
              <div className="dbg-head-text">
                <h3>Debug Mode</h3>
                <p>Log penuh AutoGram &amp; Telegram Drive</p>
              </div>
            </div>
            <button
              type="button"
              className={`dbg-switch ${debugOn ? 'on' : ''} ${debugBusy ? 'busy' : ''}`}
              role="switch"
              aria-checked={debugOn}
              aria-label={debugOn ? 'Matikan Debug Mode' : 'Nyalakan Debug Mode'}
              disabled={debugBusy}
              onClick={() => void toggleDebug(!debugOn)}
            >
              <span className="dbg-switch-track">
                <span className="dbg-switch-knob" />
              </span>
              <span className="dbg-switch-label">{debugOn ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <p className="dbg-desc">
            Menangkap log worker + UI untuk men-debug unduhan yang mengulang, fallback, dan error
            transfer. Sedikit lebih lambat saat aktif.{' '}
            <strong>Jangan bagikan log</strong> — bisa berisi path &amp; nama file.
          </p>

          <div className="dbg-status-row">
            <span className={`dbg-pill ${debugOn ? 'live' : 'idle'}`}>
              <span className="dbg-pill-dot" />
              {debugOn ? 'Aktif' : 'Nonaktif'}
            </span>
            <span className="dbg-meta-sep" aria-hidden>
              ·
            </span>
            <span className="dbg-meta">Worker + UI + transfer</span>
          </div>

          {debugOn && (
            <div className="dbg-body">
              <div className="dbg-paths">
                <div className="dbg-path-chip" title="Flag file yang dibaca worker">
                  <FileText size={13} />
                  <div className="dbg-path-text">
                    <span className="dbg-path-label">Flag</span>
                    <code>temp/autogram_debug.txt</code>
                  </div>
                </div>
                <div className="dbg-path-chip" title="File log di disk">
                  <Terminal size={13} />
                  <div className="dbg-path-text">
                    <span className="dbg-path-label">Log file</span>
                    <code>{debugLogFileHint()}</code>
                  </div>
                </div>
              </div>

              <div className="dbg-console">
                <div className="dbg-console-bar">
                  <span className="dbg-console-title">
                    <span className="dbg-live-dot" />
                    Live buffer
                    <span className="dbg-console-count">{logSnap.length}</span>
                  </span>
                  <div className="dbg-console-actions">
                    <button
                      type="button"
                      className="dbg-icon-btn"
                      title="Salin buffer (fallback jika clipboard diblokir WebView)"
                      onClick={() => {
                        const text = getDebugLogBuffer().join('\n') || '(kosong)';
                        void copyTextWithFallback(text).then((ok) => {
                          setCopied(ok);
                          window.setTimeout(() => setCopied(false), 2000);
                          if (!ok) {
                            debugLog('settings', 'clipboard copy failed — use manual select');
                          }
                        });
                      }}
                    >
                      <Copy size={14} />
                      <span>{copied ? 'Tersalin ✓' : 'Salin'}</span>
                    </button>
                    <button
                      type="button"
                      className="dbg-icon-btn danger"
                      title="Hapus buffer"
                      onClick={() => {
                        clearDebugLogBuffer();
                        setLogSnap([]);
                      }}
                    >
                      <Trash2 size={14} />
                      <span>Clear</span>
                    </button>
                  </div>
                </div>
                <pre className="dbg-console-pre" aria-label="Debug log buffer">
                  {logSnap.length
                    ? logSnap.slice(-48).join('\n')
                    : 'Buffer kosong — jalankan unduh, unggah, atau buka Media Studio untuk mengisi log.'}
                </pre>
              </div>

              <div className="dbg-tip" role="note">
                <AlertTriangle size={14} />
                <p>
                  Job yang sudah jalan (drive-serve / unduhan) perlu diulang setelah toggle agar flag
                  terbaca penuh.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
