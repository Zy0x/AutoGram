import { Rocket, LayoutDashboard, Settings, Users, ArrowRightLeft, RefreshCw, BarChart3, Bookmark, CalendarClock, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isMediaStudioAvailable } from '../../lib/tauri/capabilities';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

/** Two primary workspaces first: Forwarder (jobs) + Drives (media studio). */
const NAV_ITEMS = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' as const, short: 'Home', full: 'Beranda', desktopOnly: false },
  { id: 'jobs', icon: ArrowRightLeft, labelKey: 'nav.forwarder' as const, short: 'Forward', full: 'Forwarder', desktopOnly: false },
  { id: 'media-studio', icon: HardDrive, labelKey: 'nav.drives' as const, short: 'Drives', full: 'Drives', desktopOnly: true },
  { id: 'accounts', icon: Users, labelKey: 'nav.accounts' as const, short: 'Akun', full: 'Accounts', desktopOnly: false },
  { id: 'profiles', icon: Bookmark, labelKey: null, short: 'Profil', full: 'Profiles', desktopOnly: false },
  { id: 'automation', icon: CalendarClock, labelKey: null, short: 'Auto', full: 'Automation', desktopOnly: false },
  { id: 'sync', icon: RefreshCw, labelKey: null, short: 'Sync', full: 'Sync', desktopOnly: false },
  { id: 'stats', icon: BarChart3, labelKey: null, short: 'Stats', full: 'Statistics', desktopOnly: false },
  { id: 'settings', icon: Settings, labelKey: 'nav.settings' as const, short: 'Setelan', full: 'Settings', desktopOnly: false },
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
          <p>{t('nav.subtitle')}</p>
        </div>
      </div>

      <nav className="sidebar-nav" role="navigation">
        {visibleItems.map(({ id, icon: Icon, labelKey, short, full }) => {
          const desktopLabel = labelKey ? t(labelKey) : full;

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
        <p>{t('nav.engine_tag')}</p>
      </div>
    </aside>
  );
}
