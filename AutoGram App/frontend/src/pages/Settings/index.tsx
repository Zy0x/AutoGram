import { useState, useEffect } from 'react';
import {
  Globe,
  Trash2,
  Sliders,
  ArrowLeft,
  Settings2,
  Key,
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { runDaemonOnce } from '../../lib/tauri/workerBridge';
import { clearThumbCache } from '../../lib/media/thumbBatcher';
import { clearAvatarCache } from '../../lib/media/avatarBatcher';
import { clearPreviewCache } from '../../lib/media/previewCache';
import { clearZipBrowserCache } from '../../components/drive/DriveZipBrowser/zipUtils';
import {
  clearPersistentThumbs,
  getPersistentThumbsSize,
} from '../../lib/media/thumbPersistentCache';
import { clearMediaCache } from '../../lib/db/mediaStudioDb';

import { PerfSection } from './PerfSection';
import { NetworkSection } from './NetworkSection';
import { DebugSection } from './DebugLogsSection';
import { CACHE_LIMIT_STEPS, CACHE_LIMIT_LABELS } from './settingsUtils';
import './Settings.css';

interface SettingsProps {
  onBackToLauncher?: () => void;
  onOpenApiSetup?: () => void;
}

export function Settings({ onBackToLauncher, onOpenApiSetup }: SettingsProps) {
  const { t, i18n } = useTranslation();

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
      clearZipBrowserCache();
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

  const [isConfirmClearCacheOpen, setIsConfirmClearCacheOpen] = useState(false);
  const [isConfirmClearDbOpen, setIsConfirmClearDbOpen] = useState(false);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formattedSize = cacheSize !== null ? formatBytes(cacheSize) : t('settings.cache_not_calculated');

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

      // 3. Disk Cache Backend (Rust FS: Chunk, Part, Previews, Temp)
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

  const handleClearCache = () => {
    setIsConfirmClearCacheOpen(true);
  };

  const executeClearCache = async () => {
    setIsConfirmClearCacheOpen(false);
    setIsClearing(true);
    setClearStatus('idle');
    try {
      // 1. Memory Caches
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();
      clearZipBrowserCache();

      // 2. IndexedDB Caches
      await clearPersistentThumbs();
      await clearMediaCache();

      // 3. LocalStorage & SessionStorage Caches
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('autogram_drive_locations_v1_') ||
          key.startsWith('autogram_drive_sidebar_v1_') ||
          key.startsWith('autogram_drive_topics_v1_') ||
          key.startsWith('autogram_drive_scroll_v1_') ||
          key.startsWith('autogram_drive_peer_v2_') ||
          key === 'autogram_drive_peer'
        )) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      const sessionKeysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('drive_root_files_')) sessionKeysToRemove.push(key);
      }
      for (const key of sessionKeysToRemove) sessionStorage.removeItem(key);

      // 4. Disk Cache Backend (Rust FS: Chunk, Part, Previews, Temp)
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

  const handleClearDatabase = () => {
    setIsConfirmClearDbOpen(true);
  };

  const executeClearDatabase = async () => {
    setIsConfirmClearDbOpen(false);
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

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <main className="main-content settings-page">
      <header className="settings-header">
        <div className="settings-header-copy">
          <span className="settings-header-icon" aria-hidden>
            <Settings2 size={22} strokeWidth={2} />
          </span>
          <div>
            <h2 className="title">{t('settings.title')}</h2>
            <p className="subtitle">{t('settings.subtitle')}</p>
          </div>
        </div>
        <div className="settings-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onOpenApiSetup && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onOpenApiSetup}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                borderColor: 'rgba(56, 189, 248, 0.3)',
                background: 'rgba(56, 189, 248, 0.1)',
                color: '#38bdf8',
              }}
              title={t('settings.api_config')}
            >
              <Key size={16} />
              <span>{t('settings.api_config')}</span>
            </button>
          )}
          {onBackToLauncher && (
            <button type="button" className="btn btn-secondary settings-back-button" onClick={onBackToLauncher}>
              <ArrowLeft size={17} />
              {t('nav.back_to_launcher')}
            </button>
          )}
        </div>
      </header>

      <div className="settings-grid">
        {/* 1. INTERFACE LANGUAGE */}
        <div className="glass-panel card settings-section-general">
          <div className="card-header">
            <Globe size={20} color="var(--primary)" />
            <h3>{t('settings.general')}</h3>
          </div>
          
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label title-with-icon" htmlFor="settings-language">
              {t('settings.language')}
            </label>
            <p className="field-hint">
              {t('settings.language_desc')}
            </p>
            <select 
              id="settings-language"
              className="input-field" 
              value={i18n.language} 
              onChange={(e) => changeLanguage(e.target.value)}
            >
              <option value="en">{t('settings.language_english')}</option>
              <option value="id">{t('settings.language_indonesian')}</option>
            </select>
          </div>
        </div>

        {/* 2. DEVICE PERFORMANCE OPTIMIZATION */}
        <PerfSection />

        {/* 4. PROXY & VPN OPTIMIZER (UNIFIED COMPONENT SHARED WITH DRIVES SETTINGS) */}
        <NetworkSection />

        {/* 5. DEBUG MODE (ACCURATE & GLOBAL FOR FORWARDER & DRIVES) */}
        <DebugSection />

        {/* 6. GLOBAL CACHE CONTROL (TOTAL OVERALL SYSTEM CACHE CONTROL) */}
        <div className="glass-panel card settings-section-cache">
          <div className="card-header">
            <Trash2 size={20} color="var(--primary)" />
            <h3>{t('settings.cache_management')}</h3>
          </div>
          
          <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
            {t('settings.cache_management_desc')}
          </p>

          <div className="page-stack" style={{ gap: '1.25rem' }}>
            <div className="settings-cache-summary" style={{
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
                <p className="field-hint" style={{ margin: 0, marginTop: '2px', fontSize: '0.75rem' }}>{t('settings.cache_storage_sources')}</p>
              </div>
              <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                <strong style={{ fontSize: '1.1rem', color: 'var(--primary)' }}>
                  {isCalculating ? '...' : formattedSize}
                </strong>
              </div>
            </div>

            {/* Slider Pembatas Ukuran Cache */}
            <div className="settings-cache-limit" style={{
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
                  <label className="input-label" htmlFor="settings-cache-limit" style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600 }}>
                    {t('settings.cache_limit_label')}
                  </label>
                </div>
                <strong style={{ fontSize: '0.95rem', color: cacheLimitMB === 0 ? 'var(--text-muted)' : 'var(--primary)' }}>
                  {cacheLimitMB === 0 ? t('ui.generated.unlimited_b8bef37') : formatBytes(cacheLimitMB * 1024 * 1024)}
                </strong>
              </div>

              <div style={{ position: 'relative', marginTop: '4px', marginBottom: '8px' }}>
                <input
                  id="settings-cache-limit"
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

                <div className="settings-cache-labels" style={{
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
                        className="settings-cache-tick"
                        data-selected={isSelected ? 'true' : 'false'}
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

              <div className="settings-auto-prune" style={{
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

            <div className="settings-action-row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={calculateCacheSize} 
                disabled={isCalculating || isClearing || isTrimming}
                style={{ minHeight: '44px', flex: '1 1 auto' }}
              >
                {t('settings.calc_size_btn')}
              </button>
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.4)', minHeight: '44px', flex: '1 1 auto' }}
                onClick={handleClearCache} 
                disabled={isCalculating || isClearing || isTrimming}
              >
                {isClearing ? '...' : t('settings.clear_cache_btn')}
              </button>
            </div>

            <hr className="settings-divider" style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.05)', margin: '0.5rem 0' }} />

            <div className="settings-danger-zone">
              <span className="input-label" style={{ display: 'block', fontSize: '0.9rem' }}>{t('settings.db_clear_title')}</span>
              <p className="field-hint" style={{ marginTop: '2px', marginBottom: '0.75rem', fontSize: '0.75rem', lineHeight: 1.4 }}>
                {t('settings.db_clear_desc')}
              </p>
              <button 
                type="button" 
                className="btn" 
                style={{ background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', border: '1px solid rgba(249, 115, 22, 0.35)', minHeight: '44px', width: '100%' }}
                onClick={handleClearDatabase} 
                disabled={isCalculating || isClearing || isClearingDb}
              >
                {isClearingDb ? '...' : t('settings.clear_db_btn')}
              </button>
              {clearStatus === 'success' && (
                <span className="status-msg success" style={{ display: 'block', marginTop: '0.5rem' }}>
                  {t('settings.cache_clear_success')}
                </span>
              )}
              {clearStatus === 'error' && (
                <span className="status-msg error" style={{ display: 'block', marginTop: '0.5rem' }}>
                  {t('settings.cache_clear_error')}
                </span>
              )}

              {dbClearStatus === 'success' && (
                <span className="status-msg success" style={{ display: 'block', marginTop: '0.5rem' }}>
                  {t('settings.database_clear_success')}
                </span>
              )}
              {dbClearStatus === 'error' && (
                <span className="status-msg error" style={{ display: 'block', marginTop: '0.5rem' }}>
                  {t('settings.database_clear_error')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={isConfirmClearCacheOpen}
        title={t('settings.confirm_clear_cache_title')}
        description={t('settings.confirm_clear_cache_msg')}
        variant="warning"
        confirmText={t('settings.clear_cache')}
        cancelText={t('common.cancel')}
        isLoading={isClearing}
        onConfirm={executeClearCache}
        onCancel={() => setIsConfirmClearCacheOpen(false)}
      />

      <ConfirmModal
        isOpen={isConfirmClearDbOpen}
        title={t('settings.confirm_clear_db_title')}
        description={t('settings.confirm_clear_db_msg')}
        variant="danger"
        confirmText={t('settings.clear_db_btn')}
        cancelText={t('common.cancel')}
        isLoading={isClearingDb}
        onConfirm={executeClearDatabase}
        onCancel={() => setIsConfirmClearDbOpen(false)}
      />
    </main>
  );
}
