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
import { isMediaStudioAvailable } from './lib/capabilities';
import { bootstrapSecureCredentials } from './lib/secureCredentials';
import { bootstrapDebugMode, debugLog } from './lib/debugMode';
import { checkAndAutoPruneCache } from './lib/autoCachePruner';

/** Code-split Media Studio — keeps main shell light until tab opens */
const MediaStudio = lazy(() =>
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
            <MediaStudio onExitToApp={() => setActiveTab('dashboard')} />
          </Suspense>
        )}
        {activeTab === 'settings' && <Settings />}
      </div>
    </div>
  );
}

export default App;
