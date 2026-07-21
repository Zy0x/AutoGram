import { Rocket, LayoutDashboard, Settings, Users, ListTodo, RefreshCw, BarChart3, Bookmark, CalendarClock, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isMediaStudioAvailable } from '../lib/capabilities';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const NAV_ITEMS = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' as const, short: 'Home', full: 'Dashboard', desktopOnly: false },
  { id: 'jobs', icon: ListTodo, labelKey: null, short: 'Jobs', full: 'Jobs / Tasks', desktopOnly: false },
  { id: 'speedtest', icon: Gauge, labelKey: 'nav.speedtest' as const, short: 'Media', full: 'Media Studio', desktopOnly: true },
  { id: 'sync', icon: RefreshCw, labelKey: null, short: 'Sync', full: 'Sync Settings', desktopOnly: false },
  { id: 'profiles', icon: Bookmark, labelKey: null, short: 'Profiles', full: 'Profiles', desktopOnly: false },
  { id: 'automation', icon: CalendarClock, labelKey: null, short: 'Auto', full: 'Automation', desktopOnly: false },
  { id: 'stats', icon: BarChart3, labelKey: null, short: 'Stats', full: 'Statistics', desktopOnly: false },
  { id: 'accounts', icon: Users, labelKey: 'nav.accounts' as const, short: 'Accounts', full: 'Accounts', desktopOnly: false },
  { id: 'settings', icon: Settings, labelKey: 'nav.settings' as const, short: 'Settings', full: 'Settings', desktopOnly: false },
];

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { t } = useTranslation();
  const showMediaStudio = isMediaStudioAvailable();
  const visibleItems = NAV_ITEMS.filter((item) => !item.desktopOnly || showMediaStudio);

  return (
    <aside className="app-sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <Rocket size={22} color="white" aria-hidden />
        </div>
        <div className="sidebar-brand-text">
          <h1>AutoGram</h1>
          <p>Migration Platform</p>
        </div>
      </div>

      <nav className="sidebar-nav" role="navigation">
        {visibleItems.map(({ id, icon: Icon, labelKey, short, full }) => {
          const translated = labelKey ? t(labelKey) : full;
          const desktopLabel =
            full === 'Dashboard' || full === 'Accounts' || full === 'Settings' || full === 'Media Studio'
              ? (labelKey ? translated : full)
              : full;

          return (
            <button
              key={id}
              type="button"
              className={`sidebar-btn ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
              aria-current={activeTab === id ? 'page' : undefined}
              title={desktopLabel}
            >
              <Icon size={20} aria-hidden />
              <span className="sidebar-label-short">{short}</span>
              <span className="sidebar-label-full">{desktopLabel}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <p>AutoGram v2.1.63</p>
      </div>
    </aside>
  );
}
