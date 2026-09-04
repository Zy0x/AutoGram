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

      {/* SUB-NAV TABS FOR FORWARDER WORKSPACE */}
      <div className="ag-forwarder-tabs" role="tablist">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`ag-forwarder-tab${activeTab === 'overview' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'overview'}
        >
          <LayoutDashboard size={14} />
          <span>{t('jobs.forwarder_tab_overview')}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('jobs')}
          className={`ag-forwarder-tab${activeTab === 'jobs' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'jobs'}
        >
          <ListChecks size={14} />
          <span>{t('jobs.forwarder_tab_jobs')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('decisions')}
          className={`ag-forwarder-tab${activeTab === 'decisions' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'decisions'}
        >
          <Inbox size={14} />
          <span>{t('jobs.decision_inbox_tab')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('new_job')}
          className={`ag-forwarder-tab${activeTab === 'new_job' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'new_job'}
        >
          <Plus size={14} />
          <span>{t('nav.tab_new_job')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`ag-forwarder-tab${activeTab === 'history' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'history'}
        >
          <History size={14} />
          <span>{t('nav.tab_history')}</span>
        </button>
      </div>

      {/* MAIN VIEWPORT */}
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
  );
}
