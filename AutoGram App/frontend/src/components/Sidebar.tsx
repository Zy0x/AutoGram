import { Rocket, LayoutDashboard, Settings, Users, ListTodo, RefreshCw, BarChart3, Bookmark, CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { t } = useTranslation();

  return (
    <aside className="app-sidebar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ background: 'var(--primary)', padding: '8px', borderRadius: '8px' }}>
          <Rocket size={24} color="white" />
        </div>
        <div className="hide-on-mobile">
          <h1 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>AutoGram</h1>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Migration Platform</p>
        </div>
      </div>

      <nav>
        <button 
          className={`sidebar-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <LayoutDashboard size={20} />
          <span>{t('nav.dashboard')}</span>
        </button>
        <button 
          className={`sidebar-btn ${activeTab === 'jobs' ? 'active' : ''}`}
          onClick={() => setActiveTab('jobs')}
        >
          <ListTodo size={20} />
          <span>Jobs / Tasks</span>
        </button>
        <button 
          className={`sidebar-btn ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync')}
        >
          <RefreshCw size={20} />
          <span>Sync Settings</span>
        </button>
        <button 
          className={`sidebar-btn ${activeTab === 'profiles' ? 'active' : ''}`}
          onClick={() => setActiveTab('profiles')}
        >
          <Bookmark size={20} />
          <span>Profiles (Templates)</span>
        </button>
        <button 
          className={`sidebar-btn ${activeTab === 'automation' ? 'active' : ''}`}
          onClick={() => setActiveTab('automation')}
        >
          <CalendarClock size={20} />
          <span>Automation (Cron)</span>
        </button>
        <button 
          className={`sidebar-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          <BarChart3 size={20} />
          <span>Statistics</span>
        </button>
        <button 
          className={`sidebar-btn ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          <Users size={18} /> 
          <span>{t('nav.accounts')}</span>
        </button>
        <button 
          className={`sidebar-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={20} />
          <span>{t('nav.settings')}</span>
        </button>
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          AutoGram v2.1.0
        </p>
      </div>
    </aside>
  );
}
