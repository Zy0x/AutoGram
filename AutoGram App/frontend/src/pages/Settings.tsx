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
  Network,
  Zap,
  Wifi,
  Loader2,
  Sliders,
} from 'lucide-react';

const CACHE_LIMIT_STEPS = [0, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const CACHE_LIMIT_LABELS = ['Bebas', '1 GB', '2 GB', '5 GB', '10 GB', '20 GB', '50 GB', '100 GB'];
import { detectTauriRuntime } from '../lib/platform';
import {
  networkApplyAll,
  networkDetectVpn,
  networkGetConfig,
  networkIsAvailable,
  networkTestProxy,
  type NetworkConfigSnapshot,
  type ProxyStatus,
} from '../lib/rustBackend';
import { useTranslation } from 'react-i18next';
import { ask } from '@tauri-apps/plugin-dialog';
import { runDaemonOnce } from '../lib/workerBridge';
import { clearThumbCache } from '../lib/thumbBatcher';
import { clearAvatarCache } from '../lib/avatarBatcher';
import { clearPreviewCache } from '../lib/previewCache';
import {
  clearPersistentThumbs,
  getPersistentThumbsSize,
} from '../lib/thumbPersistentCache';
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
import {
  tgBackendStatus,
  type TgBackendStatus,
} from '../lib/telegramBackend';

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
  const [tgBackend, setTgBackend] = useState<TgBackendStatus | null>(null);

  const [isCalculating, setIsCalculating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [clearStatus, setClearStatus] = useState<"idle" | "success" | "error">("idle");
  const [cacheLimitMB, setCacheLimitMB] = useState<number>(() => {
    const saved = localStorage.getItem('autogram_cache_limit_mb');
    if (saved !== null) {
      const val = Number(saved);
      if (!isNaN(val)) return val;
    }
    return 5000; // default 5 GB limit
  });

  const handleCacheLimitChange = (newMb: number) => {
    setCacheLimitMB(newMb);
    localStorage.setItem('autogram_cache_limit_mb', String(newMb));
  };

  const handleTrimCache = async () => {
    if (cacheLimitMB === 0) return;
    setIsTrimming(true);
    try {
      const limitBytes = cacheLimitMB * 1024 * 1024;
      const { prunePersistentThumbsToSize } = await import('../lib/thumbPersistentCache');
      await prunePersistentThumbsToSize(limitBytes);
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();
      try {
        const { cacheClearDisk } = await import('../lib/jobsApi');
        await cacheClearDisk();
      } catch { /* best effort */ }
      await calculateCacheSize();
      setClearStatus('success');
      setTimeout(() => setClearStatus('idle'), 4000);
    } catch (err) {
      console.error('Failed to trim cache', err);
    } finally {
      setIsTrimming(false);
    }
  };

  const [isClearingDb, setIsClearingDb] = useState(false);
  const [dbClearStatus, setDbClearStatus] = useState<"idle" | "success" | "error">("idle");

  // Proxy / VPN (Rust-owned; applied to Telethon via worker env)
  const [netCfg, setNetCfg] = useState<NetworkConfigSnapshot | null>(null);
  const [netBusy, setNetBusy] = useState(false);
  const [netMsg, setNetMsg] = useState<string | null>(null);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [netAvail, setNetAvail] = useState<boolean | null>(null);
  const [vpnHint, setVpnHint] = useState<boolean | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formattedSize = cacheSize !== null ? formatBytes(cacheSize) : 'Belum dihitung';

  const calculateCacheSize = async () => {
    setIsCalculating(true);
    try {
      // 1. IndexedDB Persistent Thumbs
      let idbSize = 0;
      try {
        idbSize = await getPersistentThumbsSize();
      } catch (e) {
        console.warn('Failed to calculate IDB size', e);
      }

      // 2. LocalStorage (Locations, sidebar, topics caches)
      let localSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('autogram_drive_locations_v1_') ||
          key.startsWith('autogram_drive_sidebar_v1_') ||
          key.startsWith('autogram_drive_topics_v1_')
        )) {
          const val = localStorage.getItem(key) || '';
          localSize += (key.length + val.length) * 2; // UTF-16 bytes approx
        }
      }

      // 3. Disk Cache Backend (Rust FS)
      let diskSize = 0;
      try {
        const { cacheCalculateSize } = await import('../lib/jobsApi');
        const out = await cacheCalculateSize();
        diskSize = Number(out?.bytes || 0);
      } catch (e) {
        console.warn('Failed to calculate disk cache size', e);
      }

      setCacheSize(idbSize + localSize + diskSize);
    } catch (err) {
      console.error('Failed to calculate cache size', err);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleClearCache = async () => {
    const confirmed = await ask(
      'Apakah Anda yakin ingin menghapus semua cache? Semua thumbnail, pratinjau media, dan riwayat folder lokal akan dibersihkan.',
      {
        title: 'Konfirmasi Hapus Cache',
        kind: 'warning',
        okLabel: 'Hapus',
        cancelLabel: 'Batal'
      }
    );
    if (!confirmed) return;

    setIsClearing(true);
    setClearStatus('idle');
    try {
      // 1. Memory Caches
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();

      // 2. IndexedDB
      await clearPersistentThumbs();

      // 3. LocalStorage
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('autogram_drive_locations_v1_') ||
          key.startsWith('autogram_drive_sidebar_v1_') ||
          key.startsWith('autogram_drive_topics_v1_')
        )) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }

      // 4. Disk Cache Backend (Rust)
      try {
        const { cacheClearDisk } = await import('../lib/jobsApi');
        await cacheClearDisk();
      } catch (e) {
        console.error('Failed to clear disk cache', e);
      }

      // Recalculate size
      await calculateCacheSize();
      setClearStatus('success');
      setTimeout(() => setClearStatus('idle'), 5000);
    } catch (err) {
      console.error('Failed to clear cache', err);
      setClearStatus('error');
    } finally {
      setIsClearing(false);
    }
  };

  const handleClearDatabase = async () => {
    const confirmed = await ask(
      'Apakah Anda yakin ingin mengosongkan seluruh database transfer? Tindakan ini akan menghapus semua riwayat transfer, de-duplikasi berkas, riwayat scan, dan resume state secara permanen. Pemindaian berikutnya akan dipaksa mengambil data segar langsung via API Telegram.',
      {
        title: 'Konfirmasi Kosongkan Database',
        kind: 'warning',
        okLabel: 'Kosongkan',
        cancelLabel: 'Batal'
      }
    );
    if (!confirmed) return;

    setIsClearingDb(true);
    setDbClearStatus('idle');
    try {
      const res = await runDaemonOnce(['--action', 'clear-transfer-database']);
      if (res.code === 0) {
        setDbClearStatus('success');
      } else {
        console.warn('Clear transfer database reported non-zero code', res);
        setDbClearStatus('error');
      }
      setTimeout(() => setDbClearStatus('idle'), 5000);
    } catch (err) {
      console.error('Failed to clear transfer database', err);
      setDbClearStatus('error');
      setTimeout(() => setDbClearStatus('idle'), 5000);
    } finally {
      setIsClearingDb(false);
    }
  };

  // Auto-calculate on mount
  useEffect(() => {
    void calculateCacheSize();
  }, []);

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

  // Load network (proxy/VPN) from Rust
  useEffect(() => {
    if (!detectTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      const cfg = await networkGetConfig();
      if (!cancelled && cfg) setNetCfg(cfg);
      const avail = await networkIsAvailable();
      if (!cancelled) setNetAvail(avail);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Telegram MTProto backend (Grammers / Telethon dual-path)
  useEffect(() => {
    if (!detectTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      const st = await tgBackendStatus();
      if (!cancelled && st) setTgBackend(st);
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  const saveNetwork = async () => {
    if (!netCfg) return;
    setNetBusy(true);
    setNetMsg(null);
    try {
      const ok = await networkApplyAll(netCfg);
      setNetMsg(
        ok
          ? 'Network settings saved. Restart Drive session / reconnect so Telethon picks up proxy.'
          : 'Failed to save network settings.'
      );
    } finally {
      setNetBusy(false);
    }
  };

  const testProxy = async () => {
    setNetBusy(true);
    try {
      if (netCfg) await networkApplyAll(netCfg);
      const st = await networkTestProxy();
      setProxyStatus(st);
      const hint = await networkDetectVpn();
      setVpnHint(hint);
      const avail = await networkIsAvailable();
      setNetAvail(avail);
    } finally {
      setNetBusy(false);
    }
  };

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

        {detectTauriRuntime() && (
          <div className="glass-panel card">
            <div className="card-header">
              <Terminal size={20} color="var(--primary)" />
              <h3>Telegram Backend Native</h3>
            </div>
            <p className="field-hint" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
              <strong>Grammers</strong> adalah backend MTProto aktif untuk Account, Session, daftar media,
              preview dokumen, progressive video, chunk, dan seek.
            </p>
            <div className="page-stack" style={{ gap: '0.75rem' }}>
              <p className="field-hint" style={{ margin: 0 }}>
                Aktif:{' '}
                <strong style={{ color: 'var(--primary)' }}>
                  {tgBackend?.activeLabel || tgBackend?.active || '…'}
                </strong>
                {tgBackend?.grammersCompiled ? ' · Grammers compiled' : ''}
              </p>
              <p className="field-hint" style={{ margin: 0 }}>
                Account, perpindahan session, preview dokumen, dan progressive video dikunci ke
                Grammers + Rust agar hanya ada satu sumber koneksi dan satu pemilik session.
              </p>
              {tgBackend?.notes?.length ? (
                <ul className="field-hint" style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.45 }}>
                  {tgBackend.notes.slice(0, 4).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        )}

        {detectTauriRuntime() && netCfg && (
          <div className="glass-panel card">
            <div className="card-header">
              <Network size={20} color="var(--primary)" />
              <h3>Proxy &amp; VPN Optimizer</h3>
            </div>
            <p className="field-hint" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
              Diambil dari fitur Telegram-Drive: routing SOCKS5/HTTP/MTProto + penyesuaian timeout/retry
              untuk jaringan lambat/VPN. Disimpan di Rust; worker Python (Telethon) memakainya lewat env.
            </p>

            <div className="page-stack" style={{ gap: '1rem' }}>
              <label className="title-with-icon" style={{ gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={netCfg.proxy.enabled}
                  onChange={(e) =>
                    setNetCfg({
                      ...netCfg,
                      proxy: { ...netCfg.proxy, enabled: e.target.checked },
                    })
                  }
                />
                Enable Proxy
              </label>

              {netCfg.proxy.enabled && (
                <>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Type</label>
                    <select
                      className="input-field"
                      value={netCfg.proxy.proxyType}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          proxy: { ...netCfg.proxy, proxyType: e.target.value },
                        })
                      }
                    >
                      <option value="socks5">SOCKS5</option>
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="mtproto">MTProto (Telegram)</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Host</label>
                    <input
                      className="input-field"
                      value={netCfg.proxy.host}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          proxy: { ...netCfg.proxy, host: e.target.value },
                        })
                      }
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Port</label>
                    <input
                      className="input-field"
                      type="number"
                      value={netCfg.proxy.port}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          proxy: {
                            ...netCfg.proxy,
                            port: Math.max(1, Math.min(65535, Number(e.target.value) || 1080)),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Username (opsional)</label>
                    <input
                      className="input-field"
                      value={netCfg.proxy.username}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          proxy: { ...netCfg.proxy, username: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Password (opsional)</label>
                    <input
                      className="input-field"
                      type="password"
                      value={netCfg.proxy.password}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          proxy: { ...netCfg.proxy, password: e.target.value },
                        })
                      }
                    />
                  </div>
                  {netCfg.proxy.proxyType === 'mtproto' && (
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label">MTProto secret (hex)</label>
                      <input
                        className="input-field"
                        value={netCfg.proxy.secret || ''}
                        onChange={(e) =>
                          setNetCfg({
                            ...netCfg,
                            proxy: { ...netCfg.proxy, secret: e.target.value },
                          })
                        }
                        placeholder="dd… or ee…"
                      />
                    </div>
                  )}
                </>
              )}

              <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0.25rem 0' }} />

              <label className="title-with-icon" style={{ gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={netCfg.vpn.enabled}
                  onChange={(e) =>
                    setNetCfg({
                      ...netCfg,
                      vpn: { ...netCfg.vpn, enabled: e.target.checked },
                    })
                  }
                />
                <Zap size={16} /> VPN Optimizer (timeout &amp; retry agresif)
              </label>

              {netCfg.vpn.enabled && (
                <>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Timeout multiplier (1–8)</label>
                    <input
                      className="input-field"
                      type="number"
                      min={1}
                      max={8}
                      value={netCfg.vpn.timeoutMultiplier}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          vpn: {
                            ...netCfg.vpn,
                            timeoutMultiplier: Math.max(1, Math.min(8, Number(e.target.value) || 3)),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Connection retries</label>
                    <input
                      className="input-field"
                      type="number"
                      min={3}
                      max={30}
                      value={netCfg.vpn.connectionRetries}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          vpn: {
                            ...netCfg.vpn,
                            connectionRetries: Math.max(3, Math.min(30, Number(e.target.value) || 15)),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Keep-alive (detik, 0=off)</label>
                    <input
                      className="input-field"
                      type="number"
                      min={0}
                      max={180}
                      value={netCfg.vpn.keepAliveIntervalSec}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          vpn: {
                            ...netCfg.vpn,
                            keepAliveIntervalSec: Math.max(0, Math.min(180, Number(e.target.value) || 0)),
                          },
                        })
                      }
                    />
                  </div>
                  <label className="title-with-icon" style={{ gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={netCfg.vpn.floodWaitRespect}
                      onChange={(e) =>
                        setNetCfg({
                          ...netCfg,
                          vpn: { ...netCfg.vpn, floodWaitRespect: e.target.checked },
                        })
                      }
                    />
                    Hormati FloodWait panjang
                  </label>
                </>
              )}

              <div className="page-header-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={netBusy}
                  onClick={() => void saveNetwork()}
                >
                  {netBusy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                  Simpan Network
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={netBusy}
                  onClick={() => void testProxy()}
                >
                  <Wifi size={16} /> Test proxy / DC
                </button>
              </div>

              {netMsg && <p className="field-hint">{netMsg}</p>}
              {proxyStatus && (
                <p className="field-hint">
                  Proxy TCP:{' '}
                  <strong style={{ color: proxyStatus.reachable ? 'var(--success)' : 'var(--danger)' }}>
                    {proxyStatus.reachable ? 'OK' : 'Gagal'}
                  </strong>
                  {proxyStatus.latencyMs >= 0 ? ` · ${proxyStatus.latencyMs} ms` : ''} · {proxyStatus.detail}
                </p>
              )}
              {netAvail != null && (
                <p className="field-hint">
                  Telegram DC / proxy reachability: <strong>{netAvail ? 'tersedia' : 'tidak tersedia'}</strong>
                </p>
              )}
              {vpnHint != null && vpnHint && (
                <p className="field-hint">
                  Hint: DC Telegram lambat/gagal — pertimbangkan aktifkan VPN Optimizer atau Proxy.
                </p>
              )}
            </div>
          </div>
        )}

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

        <div className="glass-panel card">
          <div className="card-header">
            <Trash2 size={20} color="var(--primary)" />
            <h3>Manajemen Cache &amp; Penyimpanan</h3>
          </div>
          
          <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
            Aplikasi menyimpan data sementara secara lokal (thumbnail, data pratinjau, riwayat folder/sidebar, dan log transient) untuk mempercepat performa navigasi. Hapus cache jika Anda ingin membebaskan ruang penyimpanan atau memuat ulang data segar dari Telegram.
          </p>

          <div className="page-stack" style={{ gap: '1.25rem' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              <div>
                <span className="input-label" style={{ margin: 0, fontSize: '0.9rem' }}>Ukuran Cache Terdeteksi:</span>
                <p className="field-hint" style={{ margin: 0, marginTop: '2px', fontSize: '0.75rem' }}>IndexedDB + LocalStorage + Disk Cache Backend</p>
              </div>
              <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                <strong style={{ fontSize: '1.1rem', color: 'var(--primary)' }}>
                  {isCalculating ? 'Menghitung...' : formattedSize}
                </strong>
              </div>
            </div>

            {/* Slider Pembatas Ukuran Cache */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              padding: '14px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sliders size={16} color="var(--primary)" />
                  <span className="input-label" style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600 }}>
                    Batas Maksimum Ukuran Cache:
                  </span>
                </div>
                <strong style={{ fontSize: '0.95rem', color: cacheLimitMB === 0 ? 'var(--text-muted)' : 'var(--primary)' }}>
                  {cacheLimitMB === 0 ? 'Tanpa Batas (Unlimited)' : formatBytes(cacheLimitMB * 1024 * 1024)}
                </strong>
              </div>

              <input
                type="range"
                min={0}
                max={CACHE_LIMIT_STEPS.length - 1}
                step={1}
                value={CACHE_LIMIT_STEPS.indexOf(cacheLimitMB) !== -1 ? CACHE_LIMIT_STEPS.indexOf(cacheLimitMB) : 3}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  handleCacheLimitChange(CACHE_LIMIT_STEPS[idx] ?? 5000);
                }}
                style={{
                  width: '100%',
                  accentColor: 'var(--primary)',
                  cursor: 'pointer',
                  height: '6px',
                  borderRadius: '4px',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {CACHE_LIMIT_LABELS.map((lbl, idx) => {
                  const val = CACHE_LIMIT_STEPS[idx];
                  const isSelected = val === cacheLimitMB;
                  return (
                    <span
                      key={lbl}
                      style={{
                        color: isSelected ? 'var(--primary)' : 'inherit',
                        fontWeight: isSelected ? 700 : 400,
                        cursor: 'pointer',
                        transition: 'color 0.2s ease',
                      }}
                      onClick={() => handleCacheLimitChange(val)}
                    >
                      {lbl}
                    </span>
                  );
                })}
              </div>

              {/* Cache Usage Progress Bar */}
              {cacheSize !== null && cacheLimitMB > 0 && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Penggunaan dari Batas:</span>
                    <span style={{ color: cacheSize > cacheLimitMB * 1024 * 1024 ? '#ef4444' : 'var(--text-bright)', fontWeight: 600 }}>
                      {formattedSize} / {formatBytes(cacheLimitMB * 1024 * 1024)} ({Math.round((cacheSize / (cacheLimitMB * 1024 * 1024)) * 100)}%)
                    </span>
                  </div>
                  <div style={{ height: '6px', width: '100%', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, Math.round((cacheSize / (cacheLimitMB * 1024 * 1024)) * 100))}%`,
                      background: cacheSize > cacheLimitMB * 1024 * 1024
                        ? 'linear-gradient(90deg, #f97316, #ef4444)'
                        : (cacheSize / (cacheLimitMB * 1024 * 1024)) > 0.75
                          ? 'linear-gradient(90deg, #eab308, #f97316)'
                          : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>

                  {cacheSize > cacheLimitMB * 1024 * 1024 && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginTop: '10px',
                      padding: '8px 12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#f87171',
                      fontSize: '0.78rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                        <span>Cache terdeteksi melebihi batas <strong>{formatBytes(cacheLimitMB * 1024 * 1024)}</strong>!</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '3px 10px', fontSize: '0.75rem', borderColor: '#ef4444', color: '#ef4444', whiteSpace: 'nowrap' }}
                        onClick={handleTrimCache}
                        disabled={isTrimming || isCalculating || isClearing}
                      >
                        {isTrimming ? 'Memangkas...' : 'Pangkas Ke Batas'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={calculateCacheSize} 
                disabled={isCalculating || isClearing || isTrimming}
              >
                Hitung Ukuran
              </button>
              {cacheSize !== null && cacheLimitMB > 0 && cacheSize > cacheLimitMB * 1024 * 1024 && (
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', border: '1px solid rgba(249, 115, 22, 0.35)' }}
                  onClick={handleTrimCache} 
                  disabled={isCalculating || isClearing || isTrimming}
                >
                  {isTrimming ? 'Memangkas...' : 'Pangkas Ke Batas'}
                </button>
              )}
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.4)' }}
                onClick={handleClearCache} 
                disabled={isCalculating || isClearing || isTrimming}
              >
                {isClearing ? 'Membersihkan...' : 'Hapus Semua Cache'}
              </button>
            </div>

            <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.05)', margin: '0.5rem 0' }} />

            <div>
              <span className="input-label" style={{ display: 'block', fontSize: '0.9rem' }}>Database Transfer &amp; De-duplikasi:</span>
              <p className="field-hint" style={{ marginTop: '2px', marginBottom: '0.75rem', fontSize: '0.75rem', lineHeight: 1.4 }}>
                Menghapus seluruh riwayat berkas terunggah, resume state, audit log, dan cache pemindaian lokal. Gunakan ini jika Anda ingin Transfer Manager melakukan pemindaian segar ulang via API Telegram untuk mendeteksi berkas yang hilang/dihapus di tujuan.
              </p>
              <button 
                type="button" 
                className="btn" 
                style={{ background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', border: '1px solid rgba(249, 115, 22, 0.35)' }}
                onClick={handleClearDatabase} 
                disabled={isCalculating || isClearing || isClearingDb}
              >
                {isClearingDb ? 'Mengosongkan DB...' : 'Kosongkan Database Transfer'}
              </button>
            </div>

            {clearStatus === 'success' && (
              <span className="status-msg success" style={{ display: 'block', marginTop: '0.5rem' }}>
                ✓ Cache berhasil dibersihkan! Navigasi Anda akan dimuat ulang dari awal.
              </span>
            )}
            {clearStatus === 'error' && (
              <span className="status-msg error" style={{ display: 'block', marginTop: '0.5rem' }}>
                Gagal membersihkan cache disk.
              </span>
            )}

            {dbClearStatus === 'success' && (
              <span className="status-msg success" style={{ display: 'block', marginTop: '0.5rem' }}>
                ✓ Database transfer berhasil dikosongkan! Riwayat transfer kini bersih seperti baru.
              </span>
            )}
            {dbClearStatus === 'error' && (
              <span className="status-msg error" style={{ display: 'block', marginTop: '0.5rem' }}>
                Gagal mengosongkan database transfer. Periksa log konsol untuk detailnya.
              </span>
            )}
          </div>

        </div>
      </div>
    </main>
  );
}
