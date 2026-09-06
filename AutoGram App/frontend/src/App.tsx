import { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import './App.css';
import { LocalDownloadsPanel } from './features/remote-download/LocalDownloadsPanel';
import { SplashScreen } from './components/layout/SplashScreen';

import { isMediaStudioAvailable } from './lib/tauri/capabilities';
import { bootstrapSecureCredentials, notifyApiCredentialsChanged, notifyApiError } from './lib/tauri/secureCredentials';
import { bootstrapDebugMode, debugLog } from './lib/utils/debugMode';
import { initGlobalHorizontalWheelScroll } from './lib/utils/horizontalWheelScroll';
import { initGlobalMouseBackGesture, useMouseBackNavigation } from './lib/platform/mouseBackGesture';
import { useModalBackHandler } from './lib/platform/modalBackStack';
import { checkAndAutoPruneCache } from './lib/db/autoCachePruner';
import { ErrorBoundary } from './components/common/ErrorBoundary';

import { loadSelectableSessions, type SessionOption } from './lib/telegram';

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
const ApiSetupScreen = lazyWithRetry(() =>
  import('./pages/ApiSetupScreen').then((m) => ({ default: m.ApiSetupScreen }))
);
const SessionLauncher = lazyWithRetry(() =>
  import('./pages/SessionLauncher').then((m) => ({ default: m.SessionLauncher }))
);
const ForwarderWorkspace = lazyWithRetry(() =>
  import('./pages/ForwarderWorkspace').then((m) => ({ default: m.ForwarderWorkspace }))
);
const Settings = lazyWithRetry(() =>
  import('./pages/Settings').then((m) => ({ default: m.Settings }))
);
const Accounts = lazyWithRetry(() =>
  import('./pages/Accounts').then((m) => ({ default: m.Accounts }))
);

function App() {
  const { t } = useTranslation();
  const [showSplash, setShowSplash] = useState(true);
  const [apiChecked, setApiChecked] = useState(false);
  const [apiValid, setApiValid] = useState(true);
  const [fallbackNotice, setFallbackNotice] = useState<boolean>(false);
  const [appMode, setAppMode] = useState<'launcher' | 'drives' | 'forwarder' | 'settings' | 'api'>('launcher');

  const [currentSession, setCurrentSession] = useState<string>(() => {
    return (
      localStorage.getItem('autogram_drive_session') ||
      localStorage.getItem('autogram_default_session') ||
      'Lavender'
    );
  });
  const [forwarderSessions, setForwarderSessions] = useState<SessionOption[]>([]);
  const [forwarderSessionsLoading, setForwarderSessionsLoading] = useState(false);

  const persistActiveSession = useCallback((sessionName: string) => {
    const nextSession = String(sessionName || '').trim();
    if (!nextSession) return;
    setCurrentSession(nextSession);
    localStorage.setItem('autogram_drive_session', nextSession);
  }, []);

  const refreshForwarderSessions = useCallback(async () => {
    setForwarderSessionsLoading(true);
    try {
      const sessions = await loadSelectableSessions({ verify: false });
      setForwarderSessions(sessions);
      setCurrentSession((current) => {
        if (current && sessions.some((session) => session.name === current)) return current;
        const next = sessions[0]?.name || current;
        if (next) localStorage.setItem('autogram_drive_session', next);
        return next;
      });
    } catch (error) {
      console.warn('Unable to load Forwarder session inventory', error);
    } finally {
      setForwarderSessionsLoading(false);
    }
  }, []);

  // Universal horizontal mouse wheel scroll listener for all horizontal scrollable strips
  useEffect(() => {
    return initGlobalHorizontalWheelScroll();
  }, []);

  // Universal mouse back button & trackpad gesture navigation listener
  useEffect(() => {
    return initGlobalMouseBackGesture();
  }, []);

  useEffect(() => {
    if (appMode !== 'forwarder') return;
    void refreshForwarderSessions();
    window.addEventListener('autogram_session_metadata_updated', refreshForwarderSessions);
    return () => window.removeEventListener('autogram_session_metadata_updated', refreshForwarderSessions);
  }, [appMode, refreshForwarderSessions]);

  // Check Telegram API Credentials & Startup Behavior on boot
  useEffect(() => {
    let active = true;
    bootstrapSecureCredentials()
      .then(({ apiId, apiHash }) => {
        if (active) {
          const valid = Boolean(apiId && apiHash && String(apiId).trim() && String(apiHash).trim());
          setApiValid(valid);
          setApiChecked(true);
          if (valid) {
            notifyApiCredentialsChanged();

            // Evaluate Startup Screen & Default Account pre-flight
            const behavior = localStorage.getItem('autogram_startup_behavior') || 'launcher';
            let targetMode = 'launcher';
            if (behavior === 'drives') targetMode = 'drives';
            else if (behavior === 'forwarder') targetMode = 'forwarder';
            else if (behavior === 'last') targetMode = localStorage.getItem('autogram_app_mode') || 'launcher';

            if (targetMode === 'drives' || targetMode === 'forwarder') {
              const defSess = localStorage.getItem('autogram_default_session') || localStorage.getItem('autogram_drive_session') || '';
              loadSelectableSessions({ verify: false })
                .then((usable) => {
                  if (!active) return;
                  const match = usable.find((s) => s.name === defSess || (!defSess && s.name));
                  if (match) {
                    setCurrentSession(match.name);
                    localStorage.setItem('autogram_drive_session', match.name);
                    setAppMode(targetMode as any);
                    localStorage.setItem('autogram_app_mode', targetMode);
                  } else {
                    setAppMode('launcher');
                    localStorage.setItem('autogram_app_mode', 'launcher');
                    setFallbackNotice(true);
                  }
                })
                .catch(() => {
                  if (active) {
                    setAppMode('launcher');
                    setFallbackNotice(true);
                  }
                });
            } else {
              setAppMode(targetMode as any);
            }
          } else {
            notifyApiError();
          }
        }
      })
      .catch(() => {
        if (active) {
          setApiValid(false);
          setApiChecked(true);
          notifyApiError();
        }
      });

    void bootstrapDebugMode()
      .then((on) => {
        if (on) debugLog('app', 'Debug Mode active after boot');
      })
      .catch(() => undefined);

    const timer = setTimeout(() => {
      void checkAndAutoPruneCache();
    }, 60000);

    const interval = setInterval(() => {
      void checkAndAutoPruneCache();
    }, 5 * 60 * 1000);

    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  // Auto-dismiss fallback notice after 5 seconds
  useEffect(() => {
    if (fallbackNotice) {
      const timer = setTimeout(() => {
        setFallbackNotice(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [fallbackNotice]);

  const handleSelectMode = (sessionName: string, mode: 'drives' | 'forwarder') => {
    setFallbackNotice(false);
    persistActiveSession(sessionName);
    setAppMode(mode);
    localStorage.setItem('autogram_app_mode', mode);
  };

  const handleSwitchMode = (mode: 'drives' | 'forwarder') => {
    setAppMode(mode);
    localStorage.setItem('autogram_app_mode', mode);
  };

  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  // Bind top-level modals to modal back stack
  useModalBackHandler(apiModalOpen, () => setApiModalOpen(false), 'global-api-modal');
  useModalBackHandler(accountModalOpen, () => setAccountModalOpen(false), 'global-account-modal');

  // Root fallback navigation: if no modal or inner component intercepted Back, return to launcher
  useMouseBackNavigation(
    {
      priority: -100,
      onBack: () => {
        if (apiModalOpen) {
          setApiModalOpen(false);
          return true;
        }
        if (accountModalOpen) {
          setAccountModalOpen(false);
          return true;
        }
        if (appMode === 'settings' || appMode === 'forwarder') {
          setAppMode('launcher');
          localStorage.setItem('autogram_app_mode', 'launcher');
          return true;
        }
        // In drives mode, back gesture must remain inside Drives and never kick user to launcher
        return false;
      },
    },
    [accountModalOpen, apiModalOpen, appMode]
  );

  const renderAppContent = () => {
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
        <>
          {fallbackNotice && (
            <div
              className="ag-startup-fallback"
              style={{
                background: 'rgba(245, 158, 11, 0.15)',
                borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
                color: '#f59e0b',
                padding: '10px 20px',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                zIndex: 9999,
              }}
            >
              <span>{t('nav.startup_fallback_notice')}</span>
              <button
                type="button"
                className="ag-startup-fallback-close"
                onClick={() => setFallbackNotice(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#f59e0b',
                  fontSize: '1.1rem',
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <SessionLauncher
            onSelectMode={handleSelectMode}
            onOpenAccounts={() => {
              setAccountModalOpen(true);
            }}
            onOpenSettings={() => {
              setAppMode('settings');
              localStorage.setItem('autogram_app_mode', 'settings');
            }}
            onOpenApiSetup={() => {
              setApiModalOpen(true);
            }}
          />
        </>
      );
    }

    if (appMode === 'settings') {
      return (
        <div className="app-layout">
          <div className="app-content" id="app-content">
            <Settings
              onBackToLauncher={() => {
                setAppMode('launcher');
                localStorage.setItem('autogram_app_mode', 'launcher');
              }}
              onOpenApiSetup={() => {
                setApiModalOpen(true);
              }}
            />
          </div>
        </div>
      );
    }

    // 4. DEDICATED FORWARDER WORKSPACE SUITE
    if (appMode === 'forwarder') {
      return (
        <ForwarderWorkspace
          activeSession={currentSession}
          sessionOptions={forwarderSessions}
          sessionsLoading={forwarderSessionsLoading}
          onRefreshSessions={refreshForwarderSessions}
          onRequestSessionChange={persistActiveSession}
          onBackToLauncher={() => {
            setAppMode('launcher');
            localStorage.setItem('autogram_app_mode', 'launcher');
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
                    setAccountModalOpen(true);
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
  };

  return (
    <Suspense
      fallback={
        <main className="main-content main-content-fill td-page">
          <div className="td-boot-fallback" role="status">
            {t('ui.generated.memuat_drives_780fc8f')}
          </div>
        </main>
      }
    >
      {renderAppContent()}
      <LocalDownloadsPanel />
      {apiModalOpen && (
        <ApiSetupScreen
          isModal
          onClose={() => setApiModalOpen(false)}
          onComplete={() => {
            setApiValid(true);
            setApiModalOpen(false);
          }}
        />
      )}
      {accountModalOpen && (
        <Accounts
          isModal
          onClose={() => setAccountModalOpen(false)}
          onAccountAdded={() => {
            setAccountModalOpen(false);
          }}
        />
      )}
    </Suspense>
  );
}

export default App;
