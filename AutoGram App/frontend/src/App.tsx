import { useState, useEffect, lazy, Suspense } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Accounts } from './pages/Accounts';
import { Jobs } from './pages/Jobs';
import { Sync } from './pages/Sync';
import { Statistics } from './pages/Statistics';
import { Profiles } from './pages/Profiles';
import { Automation } from './pages/Automation';
import { canUseLocalTelegramWorker } from './lib/platform';
import { isMediaStudioAvailable } from './lib/capabilities';
import { runDaemonOnce } from './lib/jobProcess';
import { bootstrapSecureCredentials } from './lib/secureCredentials';
import { bootstrapDebugMode, debugLog } from './lib/debugMode';

/** Code-split Media Studio — keeps main shell light until tab opens */
const SpeedTest = lazy(() =>
  import('./pages/SpeedTest').then((m) => ({ default: m.SpeedTest }))
);

const DESKTOP_ONLY_TABS = new Set(['speedtest']);

function initialTab(): string {
  const saved = localStorage.getItem('lastActiveTab') || 'dashboard';
  if (DESKTOP_ONLY_TABS.has(saved) && !isMediaStudioAvailable()) {
    return 'dashboard';
  }
  return saved;
}

function App() {
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

  // Bootstrap secure credentials, debug flag, reconcile zombie jobs (desktop worker)
  useEffect(() => {
    void bootstrapSecureCredentials().catch(() => undefined);
    void bootstrapDebugMode()
      .then((on) => {
        if (on) debugLog('app', 'Debug Mode active after boot');
      })
      .catch(() => undefined);
    if (!canUseLocalTelegramWorker()) return;
    const reconcileJobs = async () => {
      try {
        await runDaemonOnce(['--action', 'reconcile']);
      } catch (err) {
        console.error('Failed to reconcile jobs:', err);
      }
    };
    reconcileJobs();
  }, []);

  const driveFocus = activeTab === 'speedtest' && isMediaStudioAvailable();

  return (
    <div className={`app-layout ${driveFocus ? 'app-layout-drive-focus' : ''}`}>
      {/* Hide AutoGram nav inside Media Studio / Drive for full-width workspace */}
      {!driveFocus && <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />}

      <div className={`app-content ${driveFocus ? 'app-content-drive' : ''}`} id="app-content">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'jobs' && <Jobs />}
        {activeTab === 'sync' && <Sync />}
        {activeTab === 'stats' && <Statistics />}
        {activeTab === 'accounts' && <Accounts />}
        {activeTab === 'profiles' && <Profiles />}
        {activeTab === 'automation' && <Automation />}
        {activeTab === 'speedtest' && isMediaStudioAvailable() && (
          <Suspense
            fallback={
              <main className="main-content main-content-fill td-page">
                <div className="td-boot-fallback" role="status">
                  Memuat Media Studio…
                </div>
              </main>
            }
          >
            <SpeedTest onExitToApp={() => setActiveTab('dashboard')} />
          </Suspense>
        )}
        {activeTab === 'settings' && <Settings />}
      </div>
    </div>
  );
}

export default App;
