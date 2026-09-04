import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ForwarderWorkspace.css';
import {
  ArrowRightLeft,
  LayoutDashboard,
  ListChecks,
  Plus,
  History,
  Zap,
  Key,
  SlidersHorizontal,
  Inbox,
} from 'lucide-react';
import { Jobs } from '../Jobs';
import { DecisionInbox } from '../../components/Forwarder/DecisionInbox';
import { ForwarderOverview } from '../../components/Forwarder/ForwarderOverview';
import { useApiCredentialsStatus } from '../../lib/tauri/secureCredentials';

interface ForwarderWorkspaceProps {
  activeSession: string;
  onSwitchMode?: (mode: 'drives' | 'forwarder') => void;
  onBackToLauncher: () => void;
  onOpenSettings: () => void;
  onOpenApiSetup?: () => void;
}

export function ForwarderWorkspace({
  activeSession,
  onSwitchMode: _onSwitchMode,
  onBackToLauncher,
  onOpenSettings,
  onOpenApiSetup,
}: ForwarderWorkspaceProps) {
  const { t } = useTranslation();
  const { hasError: hasApiError } = useApiCredentialsStatus();
  const [activeTab, setActiveTab] = useState<'overview' | 'jobs' | 'new_job' | 'history' | 'decisions'>('overview');

  return (
    <div className="ag-forwarder-shell">
      {/* HEADER TOPBAR WITH DUAL-BAR QUICK SWITCHER & SESSION BADGE */}
      <header className="ag-forwarder-header">
        {/* LEFT: SESSION BADGE BUTTON (RETURN TO LAUNCHER) */}
        <div className="ag-forwarder-identity">
          <button
            type="button"
            onClick={onBackToLauncher}
            className="ag-forwarder-session"
            title={t('nav.switch_session')}
          >
            <Zap size={16} />
            <span className="ag-forwarder-session-name">{activeSession || t('ui.generated.session_utama_6c6254e')}</span>
            <span className="ag-forwarder-chevron" aria-hidden="true">▾</span>
          </button>

          <span className="ag-forwarder-divider" aria-hidden="true">|</span>

          <span className="ag-forwarder-product">
            <ArrowRightLeft size={18} aria-hidden="true" />
            <span>{t('nav.open_forwarder')}</span>
          </span>
        </div>


        {/* RIGHT: API & SETTINGS */}
        <div className="ag-forwarder-actions">
          {onOpenApiSetup && (
            <button
              type="button"
              onClick={onOpenApiSetup}
              className={`ag-forwarder-action ag-forwarder-api${hasApiError ? ' api-credentials-btn-error' : ''}`}
              title={hasApiError ? t('ui.generated.api_id_hash_belum_terisi_buka_settings_dan_simpa_9ccf412') : t('settings.api_config')}
              aria-label={t('settings.api_config')}
            >
              <Key size={15} />
              <span>{t('nav.api_credentials_btn')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className="ag-forwarder-action"
            title={t('nav.tab_forwarder_settings')}
          >
            <SlidersHorizontal size={15} />
            <span>{t('nav.settings')}</span>
          </button>
        </div>
      </header>

      <div className="ag-forwarder-layout">
        <aside className="ag-forwarder-sidebar">
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
          {activeTab === 'overview' ? (
            <ForwarderOverview
              onCreateJob={() => setActiveTab('new_job')}
              onOpenJobs={() => setActiveTab('jobs')}
              onOpenDecisions={() => setActiveTab('decisions')}
            />
          ) : activeTab === 'decisions' ? <DecisionInbox /> : <Jobs entryView={activeTab === 'new_job' ? 'new' : activeTab} />}
        </main>
      </div>
    </div>
  );
}
