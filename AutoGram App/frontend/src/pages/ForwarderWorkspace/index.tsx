import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ForwarderWorkspace.css';
import {
  ArrowRightLeft,
  LayoutDashboard,
  ListChecks,
  Plus,
  History,
  Inbox,
  ArrowLeft,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-react';
import { Jobs } from '../Jobs';
import { DecisionInbox } from '../../components/Forwarder/DecisionInbox';
import { ForwarderOverview } from '../../components/Forwarder/ForwarderOverview';
import { useMouseBackNavigation } from '../../lib/platform/mouseBackGesture';
import { MediaSelect, type MediaSelectOption } from '../../components/drive/Navigation/MediaSelect';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { getSessionDisplayName, type SessionOption } from '../../lib/telegram';

interface ForwarderWorkspaceProps {
  activeSession: string;
  sessionOptions: SessionOption[];
  sessionsLoading?: boolean;
  onRefreshSessions?: () => void;
  onRequestSessionChange: (sessionName: string) => void;
  onBackToLauncher: () => void;
}

export function ForwarderWorkspace({
  activeSession,
  sessionOptions,
  sessionsLoading = false,
  onRefreshSessions,
  onRequestSessionChange,
  onBackToLauncher,
}: ForwarderWorkspaceProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'jobs' | 'new_job' | 'history' | 'decisions'>('overview');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('autogram_forwarder_sidebar_collapsed') === 'true');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState(0);

  const sessionSelectOptions = useMemo<MediaSelectOption[]>(() => {
    const known: MediaSelectOption[] = sessionOptions.map((session) => ({
      value: session.name,
      label: session.label || getSessionDisplayName(session.name),
      disabled: ['expired', 'error', 'revoked'].includes(String(session.status || '').toLowerCase()),
    }));
    if (activeSession && !known.some((session) => session.value === activeSession)) {
      known.unshift({ value: activeSession, label: getSessionDisplayName(activeSession) });
    }
    return known.length
      ? known
      : [{ value: '', label: t('jobs.forwarder_session_unavailable'), disabled: true }];
  }, [activeSession, sessionOptions, t]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 841px)');
    const closeDesktopDrawer = () => {
      if (mediaQuery.matches) setDrawerOpen(false);
    };
    closeDesktopDrawer();
    mediaQuery.addEventListener('change', closeDesktopDrawer);
    return () => mediaQuery.removeEventListener('change', closeDesktopDrawer);
  }, []);

  const setSidebarCollapsed = (next: boolean) => {
    setCollapsed(next);
    localStorage.setItem('autogram_forwarder_sidebar_collapsed', String(next));
  };

  const commitSessionChange = (nextSession: string) => {
    if (!nextSession || nextSession === activeSession) return;
    onRequestSessionChange(nextSession);
    setEditorDirty(false);
    setPendingSession(null);
    setDrawerOpen(false);
    setActiveTab('overview');
    setSessionRevision((revision) => revision + 1);
  };

  const requestSessionChange = (nextSession: string) => {
    if (!nextSession || nextSession === activeSession) return;
    if (editorDirty) {
      setPendingSession(nextSession);
      return;
    }
    commitSessionChange(nextSession);
  };

  // Mouse Back Button (Button 3) & Trackpad Swipe Navigation
  useMouseBackNavigation(
    {
      onBack: () => {
        if (activeTab !== 'overview') {
          setActiveTab('overview');
          return true;
        }
        onBackToLauncher();
        return true;
      },
    },
    [activeTab, onBackToLauncher]
  );

  return (
    <div className="ag-forwarder-shell" data-forwarder-shell>
      {drawerOpen && (
        <button
          type="button"
          className="ag-forwarder-drawer-backdrop"
          aria-label={t('jobs.forwarder_close_navigation')}
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <div className={`ag-forwarder-layout${collapsed ? ' is-sidebar-collapsed' : ''}`}>
        <aside
          id="ag-forwarder-sidebar"
          className={`ag-forwarder-sidebar${collapsed ? ' is-collapsed' : ''}${drawerOpen ? ' is-drawer-open' : ''}`}
          aria-label={t('nav.open_forwarder')}
        >
          <div className="ag-forwarder-rail-head">
            <button
              type="button"
              onClick={onBackToLauncher}
              className="ag-forwarder-back-button ag-forwarder-rail-back"
              title={t('nav.back_to_launcher')}
              aria-label={t('nav.back_to_launcher')}
            >
              <ArrowLeft size={19} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ag-forwarder-rail-brand"
              onClick={() => setSidebarCollapsed(!collapsed)}
              title={collapsed ? t('jobs.forwarder_expand_navigation') : t('jobs.forwarder_collapse_navigation')}
              aria-label={collapsed ? t('jobs.forwarder_expand_navigation') : t('jobs.forwarder_collapse_navigation')}
              aria-expanded={!collapsed}
            >
              <span className="ag-forwarder-brand-icon" aria-hidden="true"><ArrowRightLeft size={20} /></span>
              <span className="ag-forwarder-brand-copy">
                <strong>{t('nav.open_forwarder')}</strong>
                <span>{t('nav.forwarder_workspace_desc')}</span>
              </span>
              {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
            </button>
          </div>

          <section className="ag-forwarder-session-card" aria-label={t('nav.switch_session')}>
            <div className="ag-forwarder-session-heading">
              <span className="ag-forwarder-session-label">{t('jobs.forwarder_session_section')}</span>
              <button
                type="button"
                className="ag-forwarder-session-refresh"
                onClick={onRefreshSessions}
                disabled={sessionsLoading}
                title={t('jobs.forwarder_refresh_accounts')}
                aria-label={t('jobs.forwarder_refresh_accounts')}
              >
                <RefreshCw size={14} className={sessionsLoading ? 'spin' : ''} aria-hidden="true" />
              </button>
            </div>
            <MediaSelect
              value={activeSession}
              options={sessionSelectOptions}
              onChange={requestSessionChange}
              ariaLabel={t('nav.switch_session')}
              disabled={sessionsLoading && !sessionSelectOptions.some((option) => option.value)}
              compact
              className="ag-forwarder-session-select"
              onOpen={onRefreshSessions}
            />
          </section>

          <nav className="ag-forwarder-side-nav" aria-label={t('nav.open_forwarder')}>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`ag-forwarder-side-link${activeTab === 'overview' ? ' is-active' : ''}`}
              aria-current={activeTab === 'overview' ? 'page' : undefined}
            >
              <LayoutDashboard size={17} aria-hidden="true" />
              <span>{t('jobs.forwarder_tab_overview')}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('jobs')}
              className={`ag-forwarder-side-link${activeTab === 'jobs' ? ' is-active' : ''}`}
              aria-current={activeTab === 'jobs' ? 'page' : undefined}
            >
              <ListChecks size={17} aria-hidden="true" />
              <span>{t('jobs.forwarder_tab_jobs')}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('decisions')}
              className={`ag-forwarder-side-link${activeTab === 'decisions' ? ' is-active' : ''}`}
              aria-current={activeTab === 'decisions' ? 'page' : undefined}
            >
              <Inbox size={17} aria-hidden="true" />
              <span>{t('jobs.decision_inbox_tab')}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`ag-forwarder-side-link${activeTab === 'history' ? ' is-active' : ''}`}
              aria-current={activeTab === 'history' ? 'page' : undefined}
            >
              <History size={17} aria-hidden="true" />
              <span>{t('nav.tab_history')}</span>
            </button>
            <div className="ag-forwarder-side-separator" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setActiveTab('new_job')}
              className={`ag-forwarder-side-link ag-forwarder-side-create${activeTab === 'new_job' ? ' is-active' : ''}`}
              aria-current={activeTab === 'new_job' ? 'page' : undefined}
            >
              <Plus size={18} aria-hidden="true" />
              <span>{t('nav.tab_new_job')}</span>
            </button>
          </nav>
        </aside>

        <main className="ag-forwarder-main">
          <header className="ag-forwarder-mobile-bar">
            <button
              type="button"
              className="ag-forwarder-mobile-menu"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('jobs.forwarder_open_navigation')}
              aria-controls="ag-forwarder-sidebar"
              aria-expanded={drawerOpen}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <span>{t('nav.open_forwarder')}</span>
          </header>
          {activeTab === 'overview' ? (
            <ForwarderOverview
              key={`overview-${activeSession}-${sessionRevision}`}
              onCreateJob={() => setActiveTab('new_job')}
              onOpenJobs={() => setActiveTab('jobs')}
              onOpenDecisions={() => setActiveTab('decisions')}
            />
          ) : activeTab === 'decisions' ? <DecisionInbox key={`decisions-${activeSession}-${sessionRevision}`} /> : (
            <Jobs
              key={`jobs-${activeSession}-${sessionRevision}`}
              entryView={activeTab === 'new_job' ? 'new' : activeTab}
              onDraftDirtyChange={setEditorDirty}
            />
          )}
        </main>
      </div>
      <ConfirmModal
        isOpen={pendingSession !== null}
        title={t('jobs.forwarder_session_switch_draft_title')}
        description={t('jobs.forwarder_session_switch_draft_description', {
          session: pendingSession ? getSessionDisplayName(pendingSession) : '',
        })}
        confirmText={t('jobs.forwarder_session_switch_confirm')}
        cancelText={t('common.cancel')}
        variant="warning"
        onConfirm={() => pendingSession && commitSessionChange(pendingSession)}
        onCancel={() => setPendingSession(null)}
      />
    </div>
  );
}
