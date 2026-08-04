import { useState, useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Accounts } from './pages/Accounts';
import { Jobs } from './pages/Jobs';
import { Sync } from './pages/Sync';
import { Statistics } from './pages/Statistics';
import { Profiles } from './pages/Profiles';
import { Automation } from './pages/Automation';
import { isMediaStudioAvailable } from './lib/tauri/capabilities';
import { bootstrapSecureCredentials } from './lib/tauri/secureCredentials';
import { bootstrapDebugMode, debugLog } from './lib/utils/debugMode';
import { checkAndAutoPruneCache } from './lib/db/autoCachePruner';

import { ErrorBoundary } from './components/common/ErrorBoundary';

/**
 * Helper to lazy load components with automatic retry on dynamic import failure
 * (e.g. when Vite HMR invalidates module URLs or network drops briefly).
 */
function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await componentImport();
    } catch (firstError) {
      await new Promise((res) => setTimeout(res, 500));
      try {
        return await componentImport();
      } catch (secondError) {
        const pageHasAlreadyBeenReloaded = sessionStorage.getItem('retry-lazy-refreshed');
        if (!pageHasAlreadyBeenReloaded) {
          sessionStorage.setItem('retry-lazy-refreshed', 'true');
          window.location.reload();
          return new Promise(() => {});
        }
        sessionStorage.removeItem('retry-lazy-refreshed');
        throw secondError;
      }
    }
  });
}

/** Code-split Media Studio — keeps main shell light until tab opens */
const MediaStudio = lazyWithRetry(() =>
  import('./pages/MediaStudio').then((m) => ({ default: m.MediaStudio }))
);

const DESKTOP_ONLY_TABS = new Set(['speedtest', 'media-studio']);

function initialTab(): string {
  const saved = localStorage.getItem('lastActiveTab') || 'dashboard';
  if (DESKTOP_ONLY_TABS.has(saved) && !isMediaStudioAvailable()) {
    return 'dashboard';
  }
  return saved;
}

function App() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    localStorage.setItem('lastActiveTab', activeTab);
  }, [activeTab]);

  // Desktop-only tabs: never stay on Media Studio in web runtime
  useEffect(() => {
    if (DESKTOP_ONLY_TABS.has(activeTab) && !isMediaStudioAvailable()) {
      setActiveTab('dashboard');
    }
  }, [activeTab]);

  // Bootstrap secure credentials + debug. Jobs/executions live in Rust SQLite —
  // no Python daemon reconcile on boot (Grammers-only path).
  useEffect(() => {
    void bootstrapSecureCredentials().catch(() => undefined);
    void bootstrapDebugMode()
      .then((on) => {
        if (on) debugLog('app', 'Debug Mode active after boot');
      })
      .catch(() => undefined);

    // Initial startup cache check & auto-prune (delayed 5s to avoid boot lag)
    const timer = setTimeout(() => {
      void checkAndAutoPruneCache();
    }, 5000);

    // Periodic background check every 15 minutes
    const interval = setInterval(() => {
      void checkAndAutoPruneCache();
    }, 15 * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const driveFocus = (activeTab === 'speedtest' || activeTab === 'media-studio') && isMediaStudioAvailable();

  return (
    <div className={`app-layout ${driveFocus ? 'app-layout-drive-focus' : ''}`}>
      {/* Hide AutoGram nav inside Media Studio / Drive for full-width workspace */}
      {!driveFocus && <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />}

      <div className={`app-content ${driveFocus ? 'app-content-drive' : ''}`} id="app-content">
        <ErrorBoundary fallbackTitle={t('nav.error_title', 'Terjadi Kesalahan pada Halaman Ini')} onReset={() => setActiveTab('dashboard')}>
          {activeTab === 'dashboard' && <Dashboard onNavigate={setActiveTab} />}
          {activeTab === 'jobs' && <Jobs />}
          {activeTab === 'sync' && <Sync />}
          {activeTab === 'stats' && <Statistics />}
          {activeTab === 'accounts' && <Accounts />}
          {activeTab === 'profiles' && <Profiles />}
          {activeTab === 'automation' && <Automation />}
          {(activeTab === 'speedtest' || activeTab === 'media-studio') && isMediaStudioAvailable() && (
            <Suspense
              fallback={
                <main className="main-content main-content-fill td-page">
                  <div className="td-boot-fallback" role="status">
                    Memuat Drives…
                  </div>
                </main>
              }
            >
              <MediaStudio
                onExitToApp={() => setActiveTab('dashboard')}
                onNavigateToAccounts={() => setActiveTab('accounts')}
              />
            </Suspense>
          )}
          {activeTab === 'settings' && <Settings />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;
