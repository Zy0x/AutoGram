import { useState, useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import { SplashScreen } from './components/layout/SplashScreen';
import { ApiSetupScreen } from './pages/ApiSetupScreen';
import { SessionLauncher } from './pages/SessionLauncher';
import { ForwarderWorkspace } from './pages/ForwarderWorkspace';
import { Settings } from './pages/Settings';

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

function App() {
  const { t } = useTranslation();
  const [showSplash, setShowSplash] = useState(true);
  const [apiChecked, setApiChecked] = useState(false);
  const [apiValid, setApiValid] = useState(true);
  const [appMode, setAppMode] = useState<'launcher' | 'drives' | 'forwarder' | 'settings'>(() => {
    return (localStorage.getItem('autogram_app_mode') as any) || 'launcher';
  });
  const [currentSession, setCurrentSession] = useState<string>(() => {
    return (
      localStorage.getItem('autogram_drive_session') ||
      localStorage.getItem('autogram_default_session') ||
      'Lavender'
    );
  });

  // Check Telegram API Credentials on boot
  useEffect(() => {
    let active = true;
    bootstrapSecureCredentials()
      .then(({ apiId, apiHash }) => {
        if (active) {
          const valid = Boolean(apiId && apiHash && String(apiId).trim() && String(apiHash).trim());
          setApiValid(valid);
          setApiChecked(true);
        }
      })
      .catch(() => {
        if (active) {
          setApiValid(false);
          setApiChecked(true);
        }
      });

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
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const handleSelectMode = (sessionName: string, mode: 'drives' | 'forwarder') => {
    setCurrentSession(sessionName);
    localStorage.setItem('autogram_drive_session', sessionName);
    setAppMode(mode);
    localStorage.setItem('autogram_app_mode', mode);
  };

  const handleSwitchMode = (mode: 'drives' | 'forwarder') => {
    setAppMode(mode);
    localStorage.setItem('autogram_app_mode', mode);
  };

  // 1. ANIMATED SPLASH SCREEN (Shown once on boot)
  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  // 2. TELEGRAM API CREDENTIALS ONBOARDING (If API ID / Hash missing)
  if (apiChecked && !apiValid) {
    return (
      <ApiSetupScreen
        onComplete={() => {
          setApiValid(true);
          setAppMode('launcher');
          localStorage.setItem('autogram_app_mode', 'launcher');
        }}
      />
    );
  }

  // 3. LANDING LAUNCHER SESSION HUB
  if (appMode === 'launcher') {
    return (
      <SessionLauncher
        onSelectMode={handleSelectMode}
        onOpenAccounts={() => {
          setAppMode('drives');
        }}
        onOpenSettings={() => {
          setAppMode('settings');
          localStorage.setItem('autogram_app_mode', 'settings');
        }}
      />
    );
  }

  if (appMode === 'settings') {
    return (
      <Settings
        onBackToLauncher={() => {
          setAppMode('launcher');
          localStorage.setItem('autogram_app_mode', 'launcher');
        }}
      />
    );
  }

  // 4. DEDICATED FORWARDER WORKSPACE SUITE
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
          setAppMode('settings');
          localStorage.setItem('autogram_app_mode', 'settings');
        }}
      />
    );
  }

  // 5. DRIVES WORKSPACE (MEDIA STUDIO)
  return (
    <div className="app-layout app-layout-drive-focus">
      <div className="app-content app-content-drive" id="app-content">
        <ErrorBoundary
          fallbackTitle={t('nav.error_title')}
          onReset={() => {
            setAppMode('launcher');
            localStorage.setItem('autogram_app_mode', 'launcher');
          }}
        >
          {isMediaStudioAvailable() && (
            <Suspense
              fallback={
                <main className="main-content main-content-fill td-page">
                  <div className="td-boot-fallback" role="status">
                    {t('ui.generated.memuat_drives_780fc8f')}
                  </div>
                </main>
              }
            >
              <MediaStudio
                onExitToApp={() => {
                  setAppMode('launcher');
                  localStorage.setItem('autogram_app_mode', 'launcher');
                }}
                onNavigateToAccounts={() => {
                  setAppMode('drives');
                }}
                onSwitchMode={handleSwitchMode}
                onBackToLauncher={() => {
                  setAppMode('launcher');
                  localStorage.setItem('autogram_app_mode', 'launcher');
                }}
              />
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;
