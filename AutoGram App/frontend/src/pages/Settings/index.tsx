import { useState, useEffect } from 'react';
import {
  Save,
  Key,
  ShieldCheck,
  Globe,
  Trash2,
  Terminal,
  Network,
  Zap,
  Wifi,
  Loader2,
  Sliders,
} from 'lucide-react';

import { detectTauriRuntime } from '../../lib/tauri/platform';
import {
  networkApplyAll,
  networkDetectVpn,
  networkGetConfig,
  networkIsAvailable,
  networkTestProxy,
  type NetworkConfigSnapshot,
  type ProxyStatus,
} from '../../lib/tauri/rustBackend';
import { useTranslation } from 'react-i18next';
import { ask } from '@tauri-apps/plugin-dialog';
import { runDaemonOnce } from '../../lib/tauri/workerBridge';
import { clearThumbCache } from '../../lib/media/thumbBatcher';
import { clearAvatarCache } from '../../lib/media/avatarBatcher';
import { clearPreviewCache } from '../../lib/media/previewCache';
import {
  clearPersistentThumbs,
  getPersistentThumbsSize,
} from '../../lib/media/thumbPersistentCache';
import {
  bootstrapSecureCredentials,
  setApiCredentials,
} from '../../lib/tauri/secureCredentials';
import {
  tgBackendStatus,
  type TgBackendStatus,
} from '../../lib/telegram';


import { PerfSection } from './PerfSection';
import { DebugSection } from './DebugLogsSection';
import { CACHE_LIMIT_STEPS, CACHE_LIMIT_LABELS } from './settingsUtils';

export function Settings() {
  const { t, i18n } = useTranslation();
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [isLoading, setIsLoading] = useState(true);
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
      if (!isNaN(val)) {
        // Migration for legacy non-binary 5000/10000 MB
        if (val === 5000) return 5120;
        if (val === 1000) return 1024;
        if (val === 2000) return 2048;
        if (val === 10000) return 10240;
        if (val === 20000) return 20480;
        if (val === 50000) return 51200;
        if (val === 100000) return 102400;
        return val;
      }
    }
    return 5120; // default 5 GB limit
  });

  const [autoPruneEnabled, setAutoPruneEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('autogram_auto_prune_enabled');
    return saved === null ? true : saved === 'true';
  });

  const handleToggleAutoPrune = (enabled: boolean) => {
    setAutoPruneEnabled(enabled);
    localStorage.setItem('autogram_auto_prune_enabled', String(enabled));
  };

  const handleTrimCache = async (overrideLimitMB?: number) => {
    const targetMb = overrideLimitMB !== undefined ? overrideLimitMB : cacheLimitMB;
    if (targetMb === 0) return;
    setIsTrimming(true);
    try {
      const limitBytes = targetMb * 1024 * 1024;
      const { prunePersistentThumbsToSize } = await import('../../lib/media/thumbPersistentCache');
      await prunePersistentThumbsToSize(limitBytes);
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();
      try {
        const { cacheTrimDisk } = await import('../../lib/db/jobsApi');
        await cacheTrimDisk(limitBytes);
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

  const handleCacheLimitChange = (newMb: number) => {
    setCacheLimitMB(newMb);
    localStorage.setItem('autogram_cache_limit_mb', String(newMb));
    if (newMb > 0 && cacheSize !== null && cacheSize > newMb * 1024 * 1024) {
      void handleTrimCache(newMb);
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
        const { cacheCalculateSize } = await import('../../lib/db/jobsApi');
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
        const { cacheClearDisk } = await import('../../lib/db/jobsApi');
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

        <PerfSection />

        <div className="glass-panel card">
          <div className="card-header">
            <ShieldCheck size={20} color="var(--accent)" />
            <h3>{t('settings.api_config')}</h3>
          </div>
          
          <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
            {t('settings.api_config_hint')}
          </p>
          
          {isLoading ? (
            <div style={{ color: 'var(--text-muted)' }}>{t('settings.loading_credentials')}</div>
          ) : (
            <div className="page-stack" style={{ gap: '1.25rem' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label title-with-icon">
                  <Key size={14} /> API ID
                </label>
                <input 
                  type="text" 
                  value={apiId} 
                  onChange={e => setApiId(e.target.value)} 
                  className="input-field" 
                  placeholder={t("settings.api_id_ph")}
                />
              </div>
              
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label title-with-icon">
                  <Key size={14} /> API Hash
                </label>
                <input 
                  type="password" 
                  value={apiHash} 
                  onChange={e => setApiHash(e.target.value)} 
                  className="input-field" 
                  placeholder={t("settings.api_hash_ph")} 
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
                  {isSaving ? '...' : t('settings.save_credentials')}
                </button>
                
                {saveStatus === 'success' && (
                  <span className="status-msg success">
                    ✓ {t('settings.credentials_saved')}
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="status-msg error">
                    {t('settings.credentials_error')}
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
              <h3>{t('settings.backend_native_title')}</h3>
            </div>
            <p className="field-hint" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
              {t('settings.backend_native_desc')}
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
              <h3>{t('settings.proxy_title')}</h3>
            </div>
            <p className="field-hint" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
              {t('settings.proxy_subtitle')}
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
                {t('settings.enable_proxy')}
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
                    <label className="input-label">Username</label>
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
                    <label className="input-label">Password</label>
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
                <Zap size={16} /> {t('settings.vpn_optimizer')}
              </label>

              <div className="page-header-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={netBusy}
                  onClick={() => void saveNetwork()}
                >
                  {netBusy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                  {t('settings.save_network')}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={netBusy}
                  onClick={() => void testProxy()}
                >
                  <Wifi size={16} /> {t('settings.test_proxy')}
                </button>
              </div>

              {netMsg && <p className="field-hint">{netMsg}</p>}
              {proxyStatus && (
                <p className="field-hint">
                  Proxy TCP:{' '}
                  <strong style={{ color: proxyStatus.reachable ? 'var(--success)' : 'var(--danger)' }}>
                    {proxyStatus.reachable ? 'OK' : 'Failed'}
                  </strong>
                  {proxyStatus.latencyMs >= 0 ? ` · ${proxyStatus.latencyMs} ms` : ''} · {proxyStatus.detail}
                </p>
              )}
              {netAvail != null && (
                <p className="field-hint">
                  {t('settings.proxy_reachability')} <strong>{netAvail ? t('settings.proxy_available') : t('settings.proxy_unavailable')}</strong>
                </p>
              )}
              {vpnHint != null && vpnHint && (
                <p className="field-hint">
                  Hint: Telegram DC slow/unreachable — consider enabling VPN Optimizer or Proxy.
                </p>
              )}
            </div>
          </div>
        )}

        <DebugSection />

        <div className="glass-panel card">
          <div className="card-header">
            <Trash2 size={20} color="var(--primary)" />
            <h3>{t('settings.cache_management')}</h3>
          </div>
          
          <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
            {t('settings.cache_management_desc')}
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
                <span className="input-label" style={{ margin: 0, fontSize: '0.9rem' }}>{t('settings.cache_detected_size')}</span>
                <p className="field-hint" style={{ margin: 0, marginTop: '2px', fontSize: '0.75rem' }}>IndexedDB + LocalStorage + Disk Cache Backend</p>
              </div>
              <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                <strong style={{ fontSize: '1.1rem', color: 'var(--primary)' }}>
                  {isCalculating ? '...' : formattedSize}
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
                    {t('settings.cache_limit_label')}
                  </span>
                </div>
                <strong style={{ fontSize: '0.95rem', color: cacheLimitMB === 0 ? 'var(--text-muted)' : 'var(--primary)' }}>
                  {cacheLimitMB === 0 ? 'Unlimited' : formatBytes(cacheLimitMB * 1024 * 1024)}
                </strong>
              </div>

              <div style={{ position: 'relative', marginTop: '4px', marginBottom: '8px' }}>
                <input
                  type="range"
                  min={0}
                  max={CACHE_LIMIT_STEPS.length - 1}
                  step={1}
                  value={CACHE_LIMIT_STEPS.indexOf(cacheLimitMB) !== -1 ? CACHE_LIMIT_STEPS.indexOf(cacheLimitMB) : 3}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    handleCacheLimitChange(CACHE_LIMIT_STEPS[idx] ?? 5120);
                  }}
                  style={{
                    width: '100%',
                    accentColor: 'var(--primary)',
                    cursor: 'pointer',
                    height: '6px',
                    borderRadius: '4px',
                    margin: 0,
                    display: 'block',
                  }}
                />

                <div style={{
                  position: 'relative',
                  width: '100%',
                  height: '22px',
                  marginTop: '10px',
                }}>
                  {CACHE_LIMIT_LABELS.map((lbl, idx) => {
                    const val = CACHE_LIMIT_STEPS[idx];
                    const isSelected = val === cacheLimitMB;
                    const pct = (idx / (CACHE_LIMIT_STEPS.length - 1)) * 100;
                    const transform = idx === 0 ? 'none' : idx === CACHE_LIMIT_STEPS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)';

                    return (
                      <span
                        key={lbl}
                        style={{
                          position: 'absolute',
                          left: `${pct}%`,
                          transform,
                          fontSize: '0.73rem',
                          color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: isSelected ? 700 : 400,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'color 0.2s ease, font-weight 0.2s ease',
                        }}
                        onClick={() => handleCacheLimitChange(val)}
                      >
                        {lbl}
                      </span>
                    );
                  })}
                </div>
              </div>

              {cacheSize !== null && cacheLimitMB > 0 && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{t('settings.cache_usage_label')}</span>
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
                </div>
              )}

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '10px',
                marginTop: '4px',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                fontSize: '0.8rem',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
                    {t('settings.auto_prune_title')}
                  </span>
                  <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                    {t('settings.auto_prune_desc')}
                  </span>
                </div>
                <label className="toggle-switch" style={{ marginLeft: '12px', flexShrink: 0, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoPruneEnabled}
                    onChange={(e) => handleToggleAutoPrune(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={calculateCacheSize} 
                disabled={isCalculating || isClearing || isTrimming}
              >
                {t('settings.calc_size_btn')}
              </button>
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.4)' }}
                onClick={handleClearCache} 
                disabled={isCalculating || isClearing || isTrimming}
              >
                {isClearing ? '...' : t('settings.clear_cache_btn')}
              </button>
            </div>

            <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.05)', margin: '0.5rem 0' }} />

            <div>
              <span className="input-label" style={{ display: 'block', fontSize: '0.9rem' }}>{t('settings.db_clear_title')}</span>
              <p className="field-hint" style={{ marginTop: '2px', marginBottom: '0.75rem', fontSize: '0.75rem', lineHeight: 1.4 }}>
                {t('settings.db_clear_desc')}
              </p>
              <button 
                type="button" 
                className="btn" 
                style={{ background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', border: '1px solid rgba(249, 115, 22, 0.35)' }}
                onClick={handleClearDatabase} 
                disabled={isCalculating || isClearing || isClearingDb}
              >
                {isClearingDb ? '...' : t('settings.clear_db_btn')}
              </button>
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
      </div>
    </main>
  );
}
