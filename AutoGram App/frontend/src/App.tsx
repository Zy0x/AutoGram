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
import { SplashScreen } from './components/layout/SplashScreen';
import { SessionLauncher } from './pages/SessionLauncher';
import { ForwarderWorkspace } from './pages/ForwarderWorkspace';

import { isMediaStudioAvailable } from './lib/tauri/capabilities';
import { bootstrapSecureCredentials } from './lib/tauri/secureCredentials';
import { bootstrapDebugMode, debugLog } from './lib/utils/debugMode';
import { checkAndAutoPruneCache } from './lib/db/autoCachePruner';
import { ErrorBoundary } from './components/common/ErrorBoundary';

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

const MediaStudio = lazyWithRetry(() =>
  import('./pages/MediaStudio').then((m) => ({ default: m.MediaStudio }))
);

const DESKTOP_ONLY_TABS = new Set(['speedtest', 'media-studio']);

function initialTab(): string {
  const saved = localStorage.getItem('lastActiveTab') || 'media-studio';
  if (DESKTOP_ONLY_TABS.has(saved) && !isMediaStudioAvailable()) {
    return 'dashboard';
  }
  return saved;
}

function App() {
  const { t } = useTranslation();
  const [showSplash, setShowSplash] = useState(true);
  const [appMode, setAppMode] = useState<'launcher' | 'drives' | 'forwarder'>(() => {
    return (localStorage.getItem('autogram_app_mode') as any) || 'launcher';
  });
  const [currentSession, setCurrentSession] = useState<string>(() => {
    return (
      localStorage.getItem('autogram_drive_session') ||
      localStorage.getItem('autogram_default_session') ||
      'Lavender'
    );
  });
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    localStorage.setItem('lastActiveTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (DESKTOP_ONLY_TABS.has(activeTab) && !isMediaStudioAvailable()) {
      setActiveTab('dashboard');
    }
  }, [activeTab]);

  useEffect(() => {
    void bootstrapSecureCredentials().catch(() => undefined);
    void bootstrapDebugMode()
      .then((on) => {
        if (on) debugLog('app', 'Debug Mode active after boot');
      })
      .catch(() => undefined);

    const timer = setTimeout(() => {
      void checkAndAutoPruneCache();
    }, 5000);

    const interval = setInterval(() => {
      void checkAndAutoPruneCache();
    }, 15 * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const handleSelectMode = (sessionName: string, mode: 'drives' | 'forwarder') => {
    setCurrentSession(sessionName);
    localStorage.setItem('autogram_drive_session', sessionName);
    setAppMode(mode);
    localStorage.setItem('autogram_app_mode', mode);
    if (mode === 'drives') {
      setActiveTab('media-studio');
    }
  };

  const handleSwitchMode = (mode: 'drives' | 'forwarder') => {
    setAppMode(mode);
    localStorage.setItem('autogram_app_mode', mode);
    if (mode === 'drives') {
      setActiveTab('media-studio');
    }
  };

  // 1. ANIMATED SPLASH SCREEN (Shown once on boot)
  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  // 2. LANDING LAUNCHER SESSION HUB
  if (appMode === 'launcher') {
    return (
      <SessionLauncher
        onSelectMode={handleSelectMode}
        onOpenAccounts={() => {
          setActiveTab('accounts');
          setAppMode('drives');
        }}
        onOpenSettings={() => {
          setActiveTab('settings');
          setAppMode('drives');
        }}
      />
    );
  }

  // 3. DEDICATED FORWARDER WORKSPACE SUITE
  if (appMode === 'forwarder') {
    return (
      <ForwarderWorkspace
        activeSession={currentSession}
        onSwitchMode={handleSwitchMode}
        onBackToLauncher={() => {
          setAppMode('launcher');
          localStorage.setItem('autogram_app_mode', 'launcher');
        }}
        onOpenSettings={() => {
          setActiveTab('settings');
          setAppMode('drives');
        }}
      />
    );
  }

  // 4. DRIVES WORKSPACE (MEDIA STUDIO)
  const driveFocus =
    (activeTab === 'speedtest' || activeTab === 'media-studio') && isMediaStudioAvailable();

  return (
    <div className={`app-layout ${driveFocus ? 'app-layout-drive-focus' : ''}`}>
      {!driveFocus && <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />}

      <div className={`app-content ${driveFocus ? 'app-content-drive' : ''}`} id="app-content">
        <ErrorBoundary
          fallbackTitle={t('nav.error_title', 'Terjadi Kesalahan pada Halaman Ini')}
          onReset={() => setActiveTab('dashboard')}
        >
          {activeTab === 'dashboard' && <Dashboard onNavigate={setActiveTab} />}
          {activeTab === 'jobs' && <Jobs />}
          {activeTab === 'sync' && <Sync />}
          {activeTab === 'stats' && <Statistics />}
          {activeTab === 'accounts' && <Accounts />}
          {activeTab === 'profiles' && <Profiles />}
          {activeTab === 'automation' && <Automation />}
          {(activeTab === 'speedtest' || activeTab === 'media-studio') &&
            isMediaStudioAvailable() && (
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
                  onExitToApp={() => {
                    setAppMode('launcher');
                    localStorage.setItem('autogram_app_mode', 'launcher');
                  }}
                  onNavigateToAccounts={() => setActiveTab('accounts')}
                  onSwitchMode={handleSwitchMode}
                  onBackToLauncher={() => {
                    setAppMode('launcher');
                    localStorage.setItem('autogram_app_mode', 'launcher');
                  }}
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
