import { useState, useEffect } from 'react';
import {
  Globe,
  Trash2,
  ArrowLeft,
  Settings2,
  Key,
  SlidersHorizontal,
  AlertTriangle,
  RotateCw,
  Folder,
  Loader2,
  CheckCircle,
  ExternalLink,
  Zap,
  UserCheck,
  Check,
  Terminal,
  PanelLeft,
} from 'lucide-react';
import { isDebugMode, setDebugMode, subscribeDebugMode } from '../../lib/utils/debugMode';
import {
  getSidebarLayoutModel,
  setSidebarLayoutModel,
  subscribeSidebarLayoutModel,
  type SidebarLayoutModel,
} from '../../stores/sidebarLayoutStore';
import { useTranslation } from 'react-i18next';
import {
  loadSelectableSessions,
  getSessionDisplayName,
  getSessionMetadata,
  getActiveSessionTargets,
  SESSION_METADATA_EVENT,
  type SessionOption,
} from '../../lib/telegram';

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
import { clearMediaStudioCache, getMediaStudioCacheSize } from '../../lib/db/mediaStudioDb';
import {
  clearClientCacheStorage,
  getClientCacheStorageSize,
} from '../../lib/db/clientCacheStorage';

import { NetworkSection } from './NetworkSection';
import { SpecificCacheModal } from './SpecificCacheModal';
import { CACHE_LIMIT_STEPS, PRESET_CACHE_LIMIT_VALUES } from './settingsUtils';
import './Settings.css';

import { useApiCredentialsStatus } from '../../lib/tauri/secureCredentials';
import { useGitHubUpdater, CURRENT_APP_VERSION } from '../../lib/tauri/githubUpdater';
import { useMouseBackNavigation } from '../../lib/platform/mouseBackGesture';
import { CustomAccountSelect } from './CustomAccountSelect';
import { StorageSettingsSection } from './StorageSettingsSection';

interface SettingsProps {
  onBackToLauncher?: () => void;
  onOpenApiSetup?: () => void;
}

export function Settings({ onBackToLauncher, onOpenApiSetup }: SettingsProps) {
  const { t, i18n } = useTranslation();
  const { hasError: hasApiError } = useApiCredentialsStatus();
  const {
    status: updateStatus,
    latestVersion,
    downloadProgress,
    autoCheck,
    autoDownload,
    autoInstallOnExit,
    notifyOnUpdate,
    releaseChannel,
    lastCheckedAt,
    releaseUrl,
    checkNow: recheckUpdate,
    startDownload,
    installUpdate,
    setAutoCheck,
    setAutoDownload,
    setAutoInstallOnExit,
    setNotifyOnUpdate,
    setReleaseChannel,
  } = useGitHubUpdater();

  const [isCalculating, setIsCalculating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [cacheBreakdown, setCacheBreakdown] = useState<{
    cacheBytes: number;
    tempBytes: number;
    thumbsBytes: number;
    staleBytes: number;
    localBytes: number;
  } | null>(null);
  const [clearStatus, setClearStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [clearSummary, setClearSummary] = useState<{ removed: number; freed: number } | null>(null);

  const [isSpecificModalOpen, setIsSpecificModalOpen] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);

  // Available disk free space in bytes
  const [freeDiskBytes, setFreeDiskBytes] = useState<number | null>(null);

  // Custom Cache Location state
  const [customCacheInfo, setCustomCacheInfo] = useState<{
    customPath: string | null;
    activePath: string;
    isFallback: boolean;
    defaultPath: string;
  } | null>(null);
  const [isMigrateModalOpen, setIsMigrateModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [pendingNewPath, setPendingNewPath] = useState<string | null>(null);

  // Mouse Back Button (Button 3) & Trackpad Swipe Navigation
  useMouseBackNavigation(
    {
      onBack: () => {
        if (isSpecificModalOpen) {
          setIsSpecificModalOpen(false);
          return true;
        }
        if (isMigrateModalOpen) {
          setIsMigrateModalOpen(false);
          return true;
        }
        if (isResetModalOpen) {
          setIsResetModalOpen(false);
          return true;
        }
        if (onBackToLauncher) {
          onBackToLauncher();
          return true;
        }
        return false;
      },
    },
    [isSpecificModalOpen, isMigrateModalOpen, isResetModalOpen, onBackToLauncher]
  );
  const [isMigrating, setIsMigrating] = useState(false);
  const [activeMigrationAction, setActiveMigrationAction] = useState<'move' | 'wipe' | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);

  type SettingsTab = 'general' | 'startup' | 'updates' | 'network' | 'storage';
  const [activeTab, setActiveTab] = useState<SettingsTab>('startup');

  const [startupBehavior, setStartupBehaviorState] = useState<string>(() => {
    return localStorage.getItem('autogram_startup_behavior') || 'launcher';
  });

  const setStartupBehavior = (mode: string) => {
    setStartupBehaviorState(mode);
    localStorage.setItem('autogram_startup_behavior', mode);
  };

  const [defaultAccount, setDefaultAccountState] = useState<string>(() => {
    return localStorage.getItem('autogram_default_session') || '';
  });

  const [debugOn, setDebugOn] = useState<boolean>(() => isDebugMode());
  const [sidebarModel, setSidebarModelState] = useState<SidebarLayoutModel>(() => getSidebarLayoutModel());

  useEffect(() => {
    return subscribeDebugMode((on) => setDebugOn(on));
  }, []);

  useEffect(() => {
    return subscribeSidebarLayoutModel((m) => setSidebarModelState(m));
  }, []);

  const handleSidebarModelChange = (m: SidebarLayoutModel) => {
    setSidebarModelState(m);
    setSidebarLayoutModel(m);
  };

  const handleToggleDebug = (on: boolean) => {
    setDebugOn(on);
    setDebugMode(on).catch(() => {});
  };

  const setDefaultAccount = (sessionName: string) => {
    setDefaultAccountState(sessionName);
    localStorage.setItem('autogram_default_session', sessionName);
    window.dispatchEvent(new CustomEvent('autogram-default-session-changed'));
  };

  const [availableSessions, setAvailableSessions] = useState<SessionOption[]>([]);

  useEffect(() => {
    const syncDefault = () => {
      const s = localStorage.getItem('autogram_default_session') || '';
      setDefaultAccountState(s);
    };

    const loadSessions = () => {
      syncDefault();
      loadSelectableSessions({ verify: false })
        .then((res) => {
          if (Array.isArray(res)) {
            setAvailableSessions(res);
            const currentDef = localStorage.getItem('autogram_default_session') || '';
            if (!currentDef && res.length > 0) {
              setDefaultAccountState(res[0].name);
              localStorage.setItem('autogram_default_session', res[0].name);
            }
          }
        })
        .catch(() => {});
    };

    loadSessions();
    window.addEventListener('autogram-default-session-changed', syncDefault);
    window.addEventListener('storage', syncDefault);
    window.addEventListener(SESSION_METADATA_EVENT, loadSessions);

    return () => {
      window.removeEventListener('autogram-default-session-changed', syncDefault);
      window.removeEventListener('storage', syncDefault);
      window.removeEventListener(SESSION_METADATA_EVENT, loadSessions);
    };
  }, []);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchCustomCacheDir = async () => {
    try {
      const { getCustomCacheDir, getAvailableDiskSpace } = await import('../../lib/db/jobsApi');
      const info = await getCustomCacheDir();
      setCustomCacheInfo(info);
      if (info?.activePath) {
        const ds = await getAvailableDiskSpace(info.activePath);
        if (ds && ds.free_bytes > 0) setFreeDiskBytes(ds.free_bytes);
      }
    } catch (e) {
      console.warn('Failed to fetch custom cache dir', e);
    }
  };

  useEffect(() => {
    void fetchCustomCacheDir();
  }, []);

  const handleBrowseCacheFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.custom_cache_location_title'),
      });
      if (selected && typeof selected === 'string') {
        const normalized = selected.trim().replace(/[\/\\]+$/, '');
        const targetPath = normalized.toLowerCase().endsWith('autogram')
          ? normalized
          : `${normalized}\\AutoGram`;
        setPendingNewPath(targetPath);
        setIsMigrateModalOpen(true);
      }
    } catch (err) {
      console.error('Failed to open directory dialog', err);
    }
  };

  const executeCacheMigration = async (action: 'move' | 'wipe') => {
    if (!pendingNewPath) return;
    setIsMigrating(true);
    setActiveMigrationAction(action);
    try {
      const { setCustomCacheDir, getAvailableDiskSpace } = await import('../../lib/db/jobsApi');
      const info = await setCustomCacheDir(pendingNewPath, action);
      setCustomCacheInfo(info);
      if (info?.activePath) {
        const ds = await getAvailableDiskSpace(info.activePath);
        if (ds && ds.free_bytes > 0) setFreeDiskBytes(ds.free_bytes);
      }
      await calculateCacheSize();
      setIsMigrateModalOpen(false);
      setPendingNewPath(null);
      showToast('success', t('settings.custom_cache_success_move'));
    } catch (err) {
      console.error('Failed to set custom cache dir', err);
      showToast('error', t('settings.custom_cache_error_action'));
    } finally {
      setIsMigrating(false);
      setActiveMigrationAction(null);
    }
  };

  const executeResetToDefault = async (action: 'move' | 'wipe') => {
    setIsMigrating(true);
    setActiveMigrationAction(action);
    try {
      const { setCustomCacheDir, resetCustomCacheDir, cacheClearDisk, getAvailableDiskSpace } = await import('../../lib/db/jobsApi');
      if (action === 'move' && customCacheInfo?.defaultPath) {
        await setCustomCacheDir(customCacheInfo.defaultPath, 'move');
      } else if (action === 'wipe') {
        await cacheClearDisk();
      }
      const info = await resetCustomCacheDir();
      setCustomCacheInfo(info);
      if (info?.activePath) {
        const ds = await getAvailableDiskSpace(info.activePath);
        if (ds && ds.free_bytes > 0) setFreeDiskBytes(ds.free_bytes);
      }
      await calculateCacheSize();
      setIsResetModalOpen(false);
      showToast('success', t('settings.custom_cache_success_reset'));
    } catch (err) {
      console.error('Failed to reset custom cache dir', err);
      showToast('error', t('settings.custom_cache_error_action'));
    } finally {
      setIsMigrating(false);
      setActiveMigrationAction(null);
    }
  };

  // Custom limit modal state
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [customInputValue, setCustomInputValue] = useState<string>('7.5');
  const [customUnit, setCustomUnit] = useState<'MB' | 'GB'>('GB');

  // Load cache limit (default 5 GB = 5120 MB)
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
    void import('../../lib/db/jobsApi').then(({ cacheSetPolicy }) =>
      cacheSetPolicy(cacheLimitMB * 1024 * 1024, enabled)
    );
  };

  const handleTrimCache = async (overrideLimitMB?: number) => {
    const targetMb = overrideLimitMB !== undefined ? overrideLimitMB : cacheLimitMB;
    if (targetMb === 0) return;
    setIsTrimming(true);
    try {
      const limitBytes = targetMb * 1024 * 1024;
      const { prunePersistentThumbsToSize } = await import('../../lib/media/thumbPersistentCache');
      const studioBytes = await getMediaStudioCacheSize().catch(() => 0);
      await prunePersistentThumbsToSize(Math.max(0, limitBytes - studioBytes));
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();
      clearZipBrowserCache();
      try {
        const [{ cacheTrimDisk, cacheSetPolicy }, thumbBytes] = await Promise.all([
          import('../../lib/db/jobsApi'),
          getPersistentThumbsSize().catch(() => 0),
        ]);
        const diskBudget = Math.max(0, limitBytes - studioBytes - thumbBytes);
        await cacheTrimDisk(diskBudget);
        await cacheSetPolicy(limitBytes, autoPruneEnabled);
      } catch {
        /* best effort */
      }
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
    void import('../../lib/db/jobsApi').then(({ cacheSetPolicy }) =>
      cacheSetPolicy(newMb * 1024 * 1024, autoPruneEnabled)
    );
    if (newMb > 0 && cacheSize !== null && cacheSize > newMb * 1024 * 1024) {
      void handleTrimCache(newMb);
    }
  };

  const handleSaveCustomLimit = () => {
    const sanitized = customInputValue.replace(',', '.');
    const parsed = parseFloat(sanitized);
    if (isNaN(parsed) || parsed <= 0) return;
    const mbValue = customUnit === 'GB' ? Math.round(parsed * 1024) : Math.round(parsed);
    handleCacheLimitChange(mbValue);
    setIsCustomModalOpen(false);
  };

  useEffect(() => {
    void import('../../lib/db/jobsApi')
      .then(({ cacheSetPolicy }) =>
        cacheSetPolicy(cacheLimitMB * 1024 * 1024, autoPruneEnabled)
      )
      .catch((error) => console.warn('Failed to synchronize cache policy', error));
  }, [cacheLimitMB, autoPruneEnabled]);

  const [isClearingDb, setIsClearingDb] = useState(false);

  const [isConfirmClearCacheOpen, setIsConfirmClearCacheOpen] = useState(false);
  const [isConfirmClearDbOpen, setIsConfirmClearDbOpen] = useState(false);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formattedSize = cacheSize !== null ? formatBytes(cacheSize) : t('settings.cache_not_calculated');

  const calculateCacheSize = async () => {
    setIsCalculating(true);
    try {
      // 1. IndexedDB Persistent Thumbs & Media Studio Caches
      let idbSize = 0;
      try {
        const thumbSize = await getPersistentThumbsSize();
        const studioSize = await getMediaStudioCacheSize();
        idbSize = thumbSize + studioSize;
      } catch (e) {
        console.warn('Failed to calculate IDB size', e);
      }

      // 2. Rebuildable browser caches only. Session, pins, preferences, and
      // transfer queues are application state and must never inflate cache size.
      const localSize = getClientCacheStorageSize();

      // 3. Disk Cache Backend (Rust FS: Chunk, Part, Previews, Temp)
      let diskCacheBytes = 0;
      let diskTempBytes = 0;
      let diskThumbsBytes = 0;
      let diskStaleBytes = 0;
      try {
        const { cacheCalculateSize } = await import('../../lib/db/jobsApi');
        const out: any = await cacheCalculateSize();
        if (out) {
          diskCacheBytes = Number(out.cacheBytes || 0);
          diskTempBytes  = Number(out.tempBytes  || 0) + Number(out.sysTempBytes || 0);
          diskThumbsBytes = Number(out.thumbsBytes || 0);
          diskStaleBytes  = Number(out.staleBytes  || 0);
        }
      } catch (e) {
        console.warn('Failed to calculate disk cache size', e);
      }

      // Build breakdown — thumbs merges disk thumbs + IDB
      const breakdown = {
        cacheBytes:  diskCacheBytes,
        tempBytes:   diskTempBytes,
        thumbsBytes: diskThumbsBytes + idbSize,
        staleBytes:  diskStaleBytes,
        localBytes:  localSize,
      };
      setCacheBreakdown(breakdown);

      // ⚠️ Total is DERIVED from breakdown so it always matches badge sum
      // staleBytes is a subset of tempBytes (informational only) — not added again
      setCacheSize(
        breakdown.cacheBytes +
        breakdown.tempBytes  +
        breakdown.thumbsBytes +
        breakdown.localBytes
      );
    } catch (err) {
      console.error('Failed to calculate cache size', err);
    } finally {
      setIsCalculating(false);
    }
  };

  const [includeConfigReset, setIncludeConfigReset] = useState(false);

  const resetAllConfigAndPreferences = () => {
    const preferenceKeys = [
      'autogram_startup_behavior',
      'autogram_default_session',
      'autogram_cache_limit_mb',
      'autogram_auto_prune_enabled',
      'autogram_prefer_split_preview',
      'autogram_job_profiles',
      'autogram_drive_view',
      'autogram_drive_rail',
      'autogram_drive_sort',
      'autogram_drive_thumb_q',
      'autogram_drive_grid_zoom',
      'autogram_transfer_minimized',
    ];
    preferenceKeys.forEach((key) => localStorage.removeItem(key));

    setStartupBehaviorState('launcher');
    setDefaultAccountState('');
    setCacheLimitMB(5120);
    setAutoPruneEnabled(true);

    window.dispatchEvent(new CustomEvent('autogram-default-session-changed'));
  };

  const handleClearCache = () => {
    setIncludeConfigReset(false);
    setIsConfirmClearCacheOpen(true);
  };

  const executeClearCache = async () => {
    setIsConfirmClearCacheOpen(false);
    setIsClearing(true);
    setClearStatus('idle');
    setClearSummary(null);
    try {
      // 1. Memory Caches
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();
      clearZipBrowserCache();

      // Browser caches. Account/session identity, pins, user preferences,
      // queued transfers, and the Transfer Database are intentionally excluded.
      const clientResult = clearClientCacheStorage();

      // IndexedDB and Rust disk caches are independent. Clear them together so
      // a multi-gigabyte disk cache does not wait behind browser database work.
      const { cacheClearDisk } = await import('../../lib/db/jobsApi');
      const [, , diskResult] = await Promise.all([
        clearPersistentThumbs(),
        clearMediaStudioCache(),
        cacheClearDisk(),
      ]);
      if (diskResult.status !== 'success' || diskResult.remainingBytes > 0) {
        throw new Error(`cache clear incomplete: ${diskResult.remainingBytes} bytes remain`);
      }

      // 5. Reset app config & settings preferences if explicitly requested by user
      if (includeConfigReset) {
        resetAllConfigAndPreferences();
      }

      // Broadcast global cache cleared event to all mounted workspaces (MediaStudio, DriveExplorer)
      window.dispatchEvent(new CustomEvent('autogram-cache-cleared', { detail: { scope: 'all' } }));

      // Recalculate size
      await calculateCacheSize();
      setClearSummary({
        removed: clientResult.removedEntries + diskResult.removedFiles,
        freed: clientResult.freedBytes + diskResult.freedBytes,
      });
      setClearStatus('success');
      showToast(
        'success',
        includeConfigReset
          ? t('settings.clear_cache_success_with_config')
          : t('settings.clear_cache_success_cache_only')
      );
      setTimeout(() => setClearStatus('idle'), 5000);
    } catch (err) {
      console.error('Failed to clear cache', err);
      setClearStatus('error');
      showToast('error', String(t('drive.cache_clear_error')));
    } finally {
      setIsClearing(false);
    }
  };

  const [isPurgingOrphans, setIsPurgingOrphans] = useState(false);

  const handlePurgeOrphanedSessions = async () => {
    setIsPurgingOrphans(true);
    try {
      const { purgeOrphanedSessions } = await import('../../lib/telegram');
      const { purgedCount } = await purgeOrphanedSessions();
      const reloaded = await loadSelectableSessions({ force: true, verify: false });
      setAvailableSessions(reloaded);

      if (purgedCount > 0) {
        showToast('success', t('settings.purge_orphaned_success', { count: purgedCount }));
      } else {
        showToast('success', t('settings.purge_orphaned_none'));
      }
    } catch (err) {
      console.error('Failed to purge orphaned sessions', err);
      showToast('error', String(t('drive.cache_clear_error')));
    } finally {
      setIsPurgingOrphans(false);
    }
  };

  const [dbClearStatus, setDbClearStatus] = useState<'idle' | 'success' | 'error'>('idle');

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

  // Auto-calculate & fetch free disk space on mount
  useEffect(() => {
    void calculateCacheSize();
    void (async () => {
      try {
        const { getAvailableDiskSpace } = await import('../../lib/db/jobsApi');
        const res = await getAvailableDiskSpace();
        if (res?.free_bytes && res.free_bytes > 0) {
          setFreeDiskBytes(res.free_bytes);
          return;
        }
      } catch {}

      if (navigator.storage && navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          if (estimate.quota && estimate.usage !== undefined) {
            setFreeDiskBytes(estimate.quota - estimate.usage);
          }
        } catch {}
      }
    })();
  }, []);

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  // Sync custom input field with custom limit value if active
  useEffect(() => {
    if (cacheLimitMB > 0 && !PRESET_CACHE_LIMIT_VALUES.includes(cacheLimitMB)) {
      if (cacheLimitMB >= 1024 && cacheLimitMB % 1024 === 0) {
        setCustomInputValue(String(cacheLimitMB / 1024));
        setCustomUnit('GB');
      } else {
        setCustomInputValue(String(cacheLimitMB));
        setCustomUnit('MB');
      }
    }
  }, [cacheLimitMB]);

  // Is custom mode active?
  const isCustomMode = isCustomModalOpen || (cacheLimitMB > 0 && !PRESET_CACHE_LIMIT_VALUES.includes(cacheLimitMB));

  // Current slider step index calculation
  const currentStepIndex = (() => {
    if (isCustomMode) return 0; // Custom (index 0)
    if (cacheLimitMB === 0) return 8; // Unlimited (index 8)
    const idx = CACHE_LIMIT_STEPS.indexOf(cacheLimitMB);
    return idx !== -1 ? idx : 0;
  })();

  const handleSliderIndexChange = (idx: number) => {
    if (idx === 0) {
      setIsCustomModalOpen(true);
    } else {
      setIsCustomModalOpen(false); // Close custom panel when preset step is selected
      const mb = CACHE_LIMIT_STEPS[idx];
      if (mb !== undefined && mb >= 0) {
        handleCacheLimitChange(mb);
      }
    }
  };

  const selectedLimitBytes = cacheLimitMB * 1024 * 1024;

  const isCacheExceedingLimit =
    cacheSize !== null && cacheLimitMB > 0 && selectedLimitBytes > 0 && cacheSize > selectedLimitBytes;
  const excessBytes = isCacheExceedingLimit ? cacheSize! - selectedLimitBytes : 0;

  const isCacheExceedingDiskSpace =
    cacheSize !== null && freeDiskBytes !== null && freeDiskBytes > 0 && cacheSize > freeDiskBytes;

  // Warn when the configured limit is larger than the physical disk (impossible to ever reach)
  const isLimitExceedsDisk =
    cacheLimitMB > 0 &&
    freeDiskBytes !== null &&
    freeDiskBytes > 0 &&
    cacheLimitMB * 1024 * 1024 > freeDiskBytes;

  const isDiskLow =
    freeDiskBytes !== null &&
    freeDiskBytes > 0 &&
    freeDiskBytes < 2 * 1024 * 1024 * 1024 &&
    !isCacheExceedingDiskSpace;

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
              className={hasApiError ? 'api-credentials-btn-error' : 'btn btn-secondary'}
              onClick={onOpenApiSetup}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                ...(hasApiError
                  ? {}
                  : {
                      borderColor: 'rgba(56, 189, 248, 0.3)',
                      background: 'rgba(56, 189, 248, 0.1)',
                      color: '#38bdf8',
                    }),
              }}
              title={hasApiError ? t('ui.generated.api_id_hash_belum_terisi_buka_settings_dan_simpa_9ccf412') : t('settings.api_config')}
            >
              <Key size={16} />
              <span>{t('settings.api_config')}</span>
            </button>
          )}
          {onBackToLauncher && (
            <button type="button" className="btn btn-secondary settings-back-button" onClick={onBackToLauncher}>
              <ArrowLeft size={17} />
              <span style={{ whiteSpace: 'nowrap' }}>{t('settings.back_to_session_hub')}</span>
            </button>
          )}
        </div>
      </header>

      <div className="settings-layout-sidebar">
        {/* LEFT SIDEBAR NAVIGATION */}
        <nav className="settings-sidebar-nav" aria-label={t('settings.navigation_aria')}>
          <button
            type="button"
            className={`settings-sidebar-nav-item ${activeTab === 'startup' ? 'active' : ''}`}
            onClick={() => setActiveTab('startup')}
          >
            <Zap size={18} />
            <span>{t('settings.tab_startup')}</span>
          </button>

          <button
            type="button"
            className={`settings-sidebar-nav-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <Globe size={18} />
            <span>{t('settings.tab_general')}</span>
          </button>

          <button
            type="button"
            className={`settings-sidebar-nav-item ${activeTab === 'updates' ? 'active' : ''}`}
            onClick={() => setActiveTab('updates')}
          >
            <RotateCw size={18} />
            <span>{t('settings.tab_updates')}</span>
          </button>

          <button
            type="button"
            className={`settings-sidebar-nav-item ${activeTab === 'network' ? 'active' : ''}`}
            onClick={() => setActiveTab('network')}
          >
            <SlidersHorizontal size={18} />
            <span>{t('settings.tab_network')}</span>
          </button>

          <button
            type="button"
            className={`settings-sidebar-nav-item ${activeTab === 'storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('storage')}
          >
            <Trash2 size={18} />
            <span>{t('settings.tab_storage')}</span>
          </button>

        </nav>

        {/* RIGHT CONTENT PANEL */}
        <div className="settings-content-panel">
          {/* TAB 1: STARTUP SCREEN & DEFAULT ACCOUNT */}
          {activeTab === 'startup' && (
            <div className="glass-panel card settings-section-startup" style={{ position: 'relative', zIndex: isAccountDropdownOpen ? 100 : 1 }}>
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Zap size={20} color="var(--primary)" />
                  <h3>{t('settings.startup_behavior_section')}</h3>
                </div>
                {defaultAccount && (
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '12px',
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#38bdf8',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <UserCheck size={12} />
                    <span>{getSessionDisplayName(defaultAccount)}</span>
                  </span>
                )}
              </div>

              <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
                {t('settings.startup_behavior_section_desc')}
              </p>

              {/* STARTUP MODE CARDS GRID */}
              <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.84rem', fontWeight: 600, color: '#f8fafc' }}>
                  {t('settings.startup_mode_label')}
                </label>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>
                  {t('settings.startup_mode_desc')}
                </span>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  {/* Launcher Hub Option */}
                  <div
                    className={`startup-option-card ${startupBehavior === 'launcher' ? 'is-active' : ''}`}
                    onClick={() => setStartupBehavior('launcher')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '0.85rem', color: startupBehavior === 'launcher' ? '#38bdf8' : '#f8fafc' }}>
                        {t('settings.startup_mode_launcher')}
                      </strong>
                      {startupBehavior === 'launcher' && <CheckCircle size={15} color="#38bdf8" />}
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 }}>
                      {t('settings.startup_mode_launcher_desc')}
                    </span>
                  </div>

                  {/* Direct Drives Option */}
                  <div
                    className={`startup-option-card ${startupBehavior === 'drives' ? 'is-active' : ''}`}
                    onClick={() => setStartupBehavior('drives')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '0.85rem', color: startupBehavior === 'drives' ? '#38bdf8' : '#f8fafc' }}>
                        {t('settings.startup_mode_drives')}
                      </strong>
                      {startupBehavior === 'drives' && <CheckCircle size={15} color="#38bdf8" />}
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 }}>
                      {t('settings.startup_mode_drives_desc')}
                    </span>
                  </div>

                  {/* Direct Forwarder Option */}
                  <div
                    className={`startup-option-card ${startupBehavior === 'forwarder' ? 'is-active' : ''}`}
                    onClick={() => setStartupBehavior('forwarder')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '0.85rem', color: startupBehavior === 'forwarder' ? '#38bdf8' : '#f8fafc' }}>
                        {t('settings.startup_mode_forwarder')}
                      </strong>
                      {startupBehavior === 'forwarder' && <CheckCircle size={15} color="#38bdf8" />}
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 }}>
                      {t('settings.startup_mode_forwarder_desc')}
                    </span>
                  </div>

                  {/* Remember Last Workspace Option */}
                  <div
                    className={`startup-option-card ${startupBehavior === 'last' ? 'is-active' : ''}`}
                    onClick={() => setStartupBehavior('last')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '0.85rem', color: startupBehavior === 'last' ? '#38bdf8' : '#f8fafc' }}>
                        {t('settings.startup_mode_last')}
                      </strong>
                      {startupBehavior === 'last' && <CheckCircle size={15} color="#38bdf8" />}
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 }}>
                      {t('settings.startup_mode_last_desc')}
                    </span>
                  </div>
                </div>
              </div>

              {/* DEFAULT ACCOUNT DROPDOWN (2-WAY SYNCED) */}
              <div className="input-group" style={{ marginBottom: 0, paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <label className="input-label title-with-icon" htmlFor="settings-default-account">
                  {t('settings.default_account_label')}
                </label>
                <p className="field-hint">{t('settings.default_account_desc')}</p>

                {availableSessions.length > 0 ? (
                  <CustomAccountSelect
                    value={defaultAccount}
                    onChange={(val) => setDefaultAccount(val)}
                    options={availableSessions}
                    placeholder={t('settings.default_account_select_placeholder')}
                    onOpenChange={(open) => setIsAccountDropdownOpen(open)}
                  />
                ) : (
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#94a3b8',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    {t('settings.no_accounts_available')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: INTERFACE & LANGUAGE + DEBUG MODE */}
          {activeTab === 'general' && (
            <>
              <div className="glass-panel card settings-section-general">
                <div className="card-header">
                  <Globe size={20} color="var(--primary)" />
                  <h3>{t('settings.general')}</h3>
                </div>

                <div className="input-group" style={{ marginBottom: '20px' }}>
                  <label className="input-label title-with-icon" htmlFor="settings-language">
                    {t('settings.language')}
                  </label>
                  <p className="field-hint">{t('settings.language_desc')}</p>
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

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label title-with-icon">
                    <PanelLeft size={18} color="#38bdf8" style={{ marginRight: '6px' }} />
                    {t('settings.sidebar_layout_title')}
                  </label>
                  <p className="field-hint">{t('settings.sidebar_layout_desc')}</p>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: '12px',
                      marginTop: '10px',
                    }}
                  >
                    {/* MODEL A CARD */}
                    <div
                      onClick={() => handleSidebarModelChange('model_a')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        background:
                          sidebarModel === 'model_a'
                            ? 'rgba(56, 189, 248, 0.12)'
                            : 'rgba(15, 23, 42, 0.6)',
                        border:
                          sidebarModel === 'model_a'
                            ? '2px solid #38bdf8'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                        boxShadow:
                          sidebarModel === 'model_a'
                            ? '0 0 16px rgba(56, 189, 248, 0.25)'
                            : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                        }}
                      >
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('settings.sidebar_model_a_title')}
                        </strong>
                        {sidebarModel === 'model_a' && <Check size={16} color="#38bdf8" />}
                      </div>
                      <p
                        style={{
                          fontSize: '0.76rem',
                          color: '#94a3b8',
                          lineHeight: '1.4',
                          margin: 0,
                        }}
                      >
                        {t('settings.sidebar_model_a_desc')}
                      </p>
                    </div>

                    {/* MODEL B CARD */}
                    <div
                      onClick={() => handleSidebarModelChange('model_b')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        background:
                          sidebarModel === 'model_b'
                            ? 'rgba(56, 189, 248, 0.12)'
                            : 'rgba(15, 23, 42, 0.6)',
                        border:
                          sidebarModel === 'model_b'
                            ? '2px solid #38bdf8'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                        boxShadow:
                          sidebarModel === 'model_b'
                            ? '0 0 16px rgba(56, 189, 248, 0.25)'
                            : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                        }}
                      >
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('settings.sidebar_model_b_title')}
                        </strong>
                        {sidebarModel === 'model_b' && <Check size={16} color="#38bdf8" />}
                      </div>
                      <p
                        style={{
                          fontSize: '0.76rem',
                          color: '#94a3b8',
                          lineHeight: '1.4',
                          margin: 0,
                        }}
                      >
                        {t('settings.sidebar_model_b_desc')}
                      </p>
                    </div>

                    {/* MODEL C CARD */}
                    <div
                      onClick={() => handleSidebarModelChange('model_c')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        background:
                          sidebarModel === 'model_c'
                            ? 'rgba(56, 189, 248, 0.12)'
                            : 'rgba(15, 23, 42, 0.6)',
                        border:
                          sidebarModel === 'model_c'
                            ? '2px solid #38bdf8'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                        boxShadow:
                          sidebarModel === 'model_c'
                            ? '0 0 16px rgba(56, 189, 248, 0.25)'
                            : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                        }}
                      >
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('settings.sidebar_model_c_title')}
                        </strong>
                        {sidebarModel === 'model_c' && <Check size={16} color="#38bdf8" />}
                      </div>
                      <p
                        style={{
                          fontSize: '0.76rem',
                          color: '#94a3b8',
                          lineHeight: '1.4',
                          margin: 0,
                        }}
                      >
                        {t('settings.sidebar_model_c_desc')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass-panel card settings-section-debug" style={{ marginTop: '16px' }}>
                <div className="card-header">
                  <Terminal size={20} color="var(--primary)" />
                  <h3>{t('settings.debug_title')}</h3>
                </div>
                <p className="field-hint" style={{ marginTop: 0, marginBottom: '14px' }}>
                  {t('settings.debug_desc')}
                </p>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                      {t('settings.debug_enable')}
                    </strong>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {debugOn
                        ? t('settings.debug_hint_active')
                        : t('settings.debug_hint_inactive')}
                    </span>
                  </div>
                  <label className="settings-switch" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={debugOn}
                      onChange={(e) => handleToggleDebug(e.target.checked)}
                    />
                    <span className="settings-slider round" />
                  </label>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: APPLICATION UPDATES & RELEASE CHANNEL */}
          {activeTab === 'updates' && (
            <div className="glass-panel card settings-section-updates">
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <RotateCw size={20} color="var(--primary)" />
                  <h3>{t('settings.auto_update_section')}</h3>
                </div>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '3px 10px',
                    borderRadius: '12px',
                    background: releaseChannel === 'beta' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    border: releaseChannel === 'beta' ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)',
                    color: releaseChannel === 'beta' ? '#f59e0b' : '#10b981',
                  }}
                >
                  {releaseChannel === 'beta'
                    ? t('settings.channel_beta_stream')
                    : t('settings.channel_stable_stream')}
                </span>
              </div>

              <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
                {t('settings.auto_update_section_desc')}
              </p>

              {/* RELEASE CHANNEL SELECTOR (SEGMENTED CARDS) */}
              <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.84rem', fontWeight: 600, color: '#f8fafc' }}>
                  {t('settings.release_channel_label')}
                </label>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>
                  {t('settings.release_channel_desc')}
                </span>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  {/* Stable Channel Pill */}
                  <div
                    className={`channel-option-card is-stable ${releaseChannel === 'stable' ? 'is-active' : ''}`}
                    onClick={() => setReleaseChannel('stable')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '0.85rem', color: releaseChannel === 'stable' ? '#10b981' : '#f8fafc' }}>
                        {t('settings.channel_stable')}
                      </strong>
                      {releaseChannel === 'stable' && <CheckCircle size={15} color="#10b981" />}
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 }}>
                      {t('settings.channel_stable_desc')}
                    </span>
                  </div>

                  {/* Beta Channel Pill */}
                  <div
                    className={`channel-option-card is-beta ${releaseChannel === 'beta' ? 'is-active' : ''}`}
                    onClick={() => setReleaseChannel('beta')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '0.85rem', color: releaseChannel === 'beta' ? '#f59e0b' : '#f8fafc' }}>
                        {t('settings.channel_beta')}
                      </strong>
                      {releaseChannel === 'beta' && <CheckCircle size={15} color="#f59e0b" />}
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 }}>
                      {t('settings.channel_beta_desc')}
                    </span>
                  </div>
                </div>
              </div>

              {/* TOGGLES LIST (NATIVE AUTOGRAM SETTINGS SWITCHES) */}
              <div className="td-switches-list">
                {/* Auto-Check Toggle */}
                <label className="td-switch-row">
                  <div>
                    <strong>{t('settings.auto_check_updates_label')}</strong>
                    <p>{t('settings.auto_check_updates_desc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoCheck}
                    onChange={(e) => setAutoCheck(e.target.checked)}
                  />
                </label>

                {/* Background Auto-Download Toggle */}
                <label className="td-switch-row">
                  <div>
                    <strong>{t('settings.auto_download_updates_label')}</strong>
                    <p>{t('settings.auto_download_updates_desc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoDownload}
                    onChange={(e) => setAutoDownload(e.target.checked)}
                  />
                </label>

                {/* Auto-Install on Exit Toggle */}
                <label className="td-switch-row">
                  <div>
                    <strong>{t('settings.auto_install_exit_label')}</strong>
                    <p>{t('settings.auto_install_exit_desc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoInstallOnExit}
                    onChange={(e) => setAutoInstallOnExit(e.target.checked)}
                  />
                </label>

                {/* Update Notification Toggle */}
                <label className="td-switch-row">
                  <div>
                    <strong>{t('settings.notify_update_label')}</strong>
                    <p>{t('settings.notify_update_desc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifyOnUpdate}
                    onChange={(e) => setNotifyOnUpdate(e.target.checked)}
                  />
                </label>
              </div>

              {/* FOOTER BAR: Current Version, Last Checked & Action */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.80rem', color: '#94a3b8' }}>{t('settings.current_version_label')}:</span>
                    <strong style={{ fontSize: '0.86rem', color: '#38bdf8' }}>
                      {t('settings.version_prefix')}{CURRENT_APP_VERSION}
                    </strong>
                    <a
                      href={releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: '0.75rem',
                        color: '#38bdf8',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        marginLeft: '6px',
                        opacity: 0.85,
                      }}
                      title={t('settings.view_release_notes')}
                    >
                      <span>{t('settings.view_release_notes')}</span>
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {t('settings.last_checked_label')}:{' '}
                    {lastCheckedAt
                      ? new Date(lastCheckedAt).toLocaleTimeString(i18n.language === 'id' ? 'id-ID' : 'en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }) +
                        ' (' +
                        new Date(lastCheckedAt).toLocaleDateString(i18n.language === 'id' ? 'id-ID' : 'en-US', {
                          day: 'numeric',
                          month: 'short',
                        }) +
                        ')'
                      : t('settings.last_checked_never')}
                  </span>
                </div>

                <div>
                  {updateStatus === 'updateAvailable' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void startDownload()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px' }}
                    >
                      <RotateCw size={14} />
                      <span>{t('settings.btn_download_update', { version: latestVersion })}</span>
                    </button>
                  ) : updateStatus === 'downloading' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px', borderColor: '#0284c7', color: '#38bdf8' }}
                    >
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t('nav.updater_downloading', { percent: downloadProgress })}</span>
                    </button>
                  ) : updateStatus === 'readyToInstall' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void installUpdate()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
                    >
                      <CheckCircle size={14} />
                      <span>{t('settings.btn_install_restart', { version: latestVersion })}</span>
                    </button>
                  ) : updateStatus === 'installing' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px' }}
                    >
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t('nav.updater_installing')}</span>
                    </button>
                  ) : updateStatus === 'checking' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px' }}
                    >
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t('nav.updater_checking')}</span>
                    </button>
                  ) : updateStatus === 'rateLimited' || updateStatus === 'networkError' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void recheckUpdate()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px', borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' }}
                      title={updateStatus === 'rateLimited' ? t('nav.updater_rate_limited') : t('nav.updater_network_error')}
                    >
                      <RotateCw size={14} />
                      <span>{updateStatus === 'rateLimited' ? t('nav.updater_rate_limited') : t('nav.updater_network_error')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void recheckUpdate()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 14px' }}
                    >
                      <RotateCw size={14} />
                      <span>{t('settings.btn_check_updates')}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: NETWORK & PROXY */}
          {activeTab === 'network' && (
            <NetworkSection />
          )}

          {/* TAB 5: STORAGE & CACHE */}
          {activeTab === 'storage' && (
            <StorageSettingsSection
              t={t}
              cacheBreakdown={cacheBreakdown}
              customCacheInfo={customCacheInfo}
              isCustomModalOpen={isCustomModalOpen}
              customInputValue={customInputValue}
              customUnit={customUnit}
              setIsCustomModalOpen={setIsCustomModalOpen}
              setCustomInputValue={setCustomInputValue}
              setCustomUnit={setCustomUnit}
              handleSaveCustomLimit={handleSaveCustomLimit}
              handleBrowseCacheFolder={handleBrowseCacheFolder}
              setIsResetModalOpen={setIsResetModalOpen}
              freeDiskBytes={freeDiskBytes}
              isDiskLow={isDiskLow}
              isCacheExceedingDiskSpace={isCacheExceedingDiskSpace}
              isLimitExceedsDisk={isLimitExceedsDisk}
              isCacheExceedingLimit={isCacheExceedingLimit}
              excessBytes={excessBytes}
              selectedLimitBytes={selectedLimitBytes}
              isCalculating={isCalculating}
              calculateCacheSize={calculateCacheSize}
              isTrimming={isTrimming}
              handleTrimCache={handleTrimCache}
              isClearing={isClearing}
              isClearingDb={isClearingDb}
              clearStatus={clearStatus}
              clearSummary={clearSummary}
              formatBytes={formatBytes}
              isPurgingOrphans={isPurgingOrphans}
              handlePurgeOrphanedSessions={handlePurgeOrphanedSessions}
              availableSessions={availableSessions}
              getActiveSessionTargets={getActiveSessionTargets}
              getSessionMetadata={getSessionMetadata}
              handleClearCache={handleClearCache}
              handleClearDatabase={handleClearDatabase}
              dbClearStatus={dbClearStatus}
              autoPruneEnabled={autoPruneEnabled}
              handleToggleAutoPrune={handleToggleAutoPrune}
              isSpecificModalOpen={isSpecificModalOpen}
              setIsSpecificModalOpen={setIsSpecificModalOpen}
              currentStepIndex={currentStepIndex}
              handleSliderIndexChange={handleSliderIndexChange}
              cacheSize={cacheSize}
              cacheLimitMB={cacheLimitMB}
              formattedSize={formattedSize}
            />
          )}

    </div>
  </div>

      {/* MODAL MIGRASI DIREKTORI CACHE KUSTOM */}
      {isMigrateModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(3, 7, 18, 0.8)',
            backdropFilter: 'blur(8px)',
            padding: '16px',
          }}
          onClick={() => {
            if (!isMigrating) {
              setIsMigrateModalOpen(false);
              setPendingNewPath(null);
            }
          }}
        >
          <div
            className="cache-migrate-modal-content"
            style={{
              width: '100%',
              maxWidth: '520px',
              background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98) 0%, rgba(10, 15, 30, 0.99) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Folder size={22} style={{ color: '#38bdf8' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                {t('settings.custom_cache_migrate_modal_title')}
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.5 }}>
              {t('settings.custom_cache_migrate_modal_msg')}
            </p>

            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                fontFamily: 'monospace',
                fontSize: '0.82rem',
                wordBreak: 'break-all',
              }}
            >
              {pendingNewPath}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
              <button
                type="button"
                className="cache-option-card-move"
                onClick={() => void executeCacheMigration('move')}
                disabled={isMigrating}
              >
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#38bdf8', display: 'block', lineHeight: 1.3 }}>
                  📦 {t('settings.custom_cache_migrate_option_move')}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 400, display: 'block', lineHeight: 1.45, whiteSpace: 'normal' }}>
                  {t('settings.custom_cache_migrate_option_move_desc')}
                </span>
              </button>

              <button
                type="button"
                className="cache-option-card-wipe"
                onClick={() => void executeCacheMigration('wipe')}
                disabled={isMigrating}
              >
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fca5a5', display: 'block', lineHeight: 1.3 }}>
                  🧹 {t('settings.custom_cache_migrate_option_wipe')}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#f87171', opacity: 0.9, fontWeight: 400, display: 'block', lineHeight: 1.45, whiteSpace: 'normal' }}>
                  {t('settings.custom_cache_migrate_option_wipe_desc')}
                </span>
              </button>
            </div>

            {isMigrating && (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  marginTop: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Loader2 size={18} style={{ color: '#38bdf8' }} className="cache-progress-spin" />
                  <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
                    {activeMigrationAction === 'move'
                      ? t('settings.custom_cache_progress_moving')
                      : t('settings.custom_cache_progress_wiping')}
                  </span>
                </div>
                <div className="cache-progress-bar-indeterminate" />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  {t('settings.custom_cache_progress_wait')}
                </span>
              </div>
            )}

            <button
              type="button"
              className="cache-modal-cancel-btn"
              onClick={() => {
                setIsMigrateModalOpen(false);
                setPendingNewPath(null);
              }}
              disabled={isMigrating}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* RESET TO DEFAULT CONFIRMATION MODAL */}
      {isResetModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => {
            if (!isMigrating) setIsResetModalOpen(false);
          }}
        >
          <div
            className="cache-migrate-modal-content"
            style={{
              width: '100%',
              maxWidth: '520px',
              background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98) 0%, rgba(10, 15, 30, 0.99) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <RotateCw size={22} style={{ color: '#38bdf8' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                {t('settings.custom_cache_reset_modal_title')}
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.5 }}>
              {t('settings.custom_cache_reset_modal_msg')}
            </p>

            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                fontFamily: 'monospace',
                fontSize: '0.82rem',
                wordBreak: 'break-all',
              }}
            >
              {customCacheInfo?.defaultPath || t('settings.default_cache_path')}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
              <button
                type="button"
                className="cache-option-card-move"
                onClick={() => void executeResetToDefault('move')}
                disabled={isMigrating}
              >
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#38bdf8', display: 'block', lineHeight: 1.3 }}>
                  📦 {t('settings.custom_cache_reset_option_move')}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 400, display: 'block', lineHeight: 1.45, whiteSpace: 'normal' }}>
                  {t('settings.custom_cache_reset_option_move_desc')}
                </span>
              </button>

              <button
                type="button"
                className="cache-option-card-wipe"
                onClick={() => void executeResetToDefault('wipe')}
                disabled={isMigrating}
              >
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fca5a5', display: 'block', lineHeight: 1.3 }}>
                  🧹 {t('settings.custom_cache_reset_option_wipe')}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#f87171', opacity: 0.9, fontWeight: 400, display: 'block', lineHeight: 1.45, whiteSpace: 'normal' }}>
                  {t('settings.custom_cache_reset_option_wipe_desc')}
                </span>
              </button>
            </div>

            {isMigrating && (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  marginTop: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Loader2 size={18} style={{ color: '#38bdf8' }} className="cache-progress-spin" />
                  <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
                    {activeMigrationAction === 'move'
                      ? t('settings.custom_cache_progress_moving')
                      : t('settings.custom_cache_progress_wiping')}
                  </span>
                </div>
                <div className="cache-progress-bar-indeterminate" />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  {t('settings.custom_cache_progress_wait')}
                </span>
              </div>
            )}

            <button
              type="button"
              className="cache-modal-cancel-btn"
              onClick={() => setIsResetModalOpen(false)}
              disabled={isMigrating}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODALS */}
      <ConfirmModal
        isOpen={isConfirmClearCacheOpen}
        title={t('settings.clear_cache_modal_title')}
        description={
          <div>
            <p style={{ margin: '0 0 12px 0' }}>{t('settings.clear_cache_modal_msg')}</p>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                background: 'rgba(2, 6, 23, 0.45)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                borderRadius: '10px',
                cursor: 'pointer',
                userSelect: 'none',
                marginTop: '12px',
                transition: 'border-color 150ms ease, background-color 150ms ease',
              }}
              className="clear-cache-config-option"
            >
              <input
                type="checkbox"
                checked={includeConfigReset}
                onChange={(e) => setIncludeConfigReset(e.target.checked)}
                style={{
                  width: '17px',
                  height: '17px',
                  marginTop: '2px',
                  accentColor: '#ef4444',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--td-text, #f1f5f9)' }}>
                  {t('settings.clear_cache_reset_config_option')}
                </span>
                <span style={{ fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 }}>
                  {t('settings.clear_cache_reset_config_help')}
                </span>
              </div>
            </label>
          </div>
        }
        confirmText={t('settings.clear_cache_confirm')}
        cancelText={t('common.cancel')}
        variant="danger"
        onConfirm={executeClearCache}
        onCancel={() => setIsConfirmClearCacheOpen(false)}
      />

      <ConfirmModal
        isOpen={isConfirmClearDbOpen}
        title={t('ui.generated.konfirmasi_clear_transfer_database_a123f45')}
        description={t('ui.generated.apakah_anda_yakin_ingin_menghapus_seluruh_riway_b567c89')}
        confirmText={t('ui.generated.ya_hapus_database_c890d12')}
        cancelText={t('common.cancel')}
        variant="danger"
        onConfirm={executeClearDatabase}
        onCancel={() => setIsConfirmClearDbOpen(false)}
      />

      {/* SPECIFIC & PER-SESSION CACHE OVERLAY */}
      <SpecificCacheModal
        isOpen={isSpecificModalOpen}
        onClose={() => setIsSpecificModalOpen(false)}
        onRefreshGlobalSize={calculateCacheSize}
      />

      {/* FLOATING TOAST NOTIFICATION BANNER */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 10000,
            padding: '12px 18px',
            borderRadius: '12px',
            background: toastMessage.type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)',
            backdropFilter: 'blur(10px)',
            color: '#ffffff',
            fontSize: '0.88rem',
            fontWeight: 700,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            animation: 'cacheModalPopIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          }}
        >
          {toastMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <span>{toastMessage.text}</span>
        </div>
      )}
    </main>
  );
}
