import { useState } from 'react';
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
  ChevronDown,
  Zap,
} from 'lucide-react';
import { Jobs } from '../Jobs';
import { DecisionInbox } from '../../components/Forwarder/DecisionInbox';
import { ForwarderOverview } from '../../components/Forwarder/ForwarderOverview';

interface ForwarderWorkspaceProps {
  activeSession: string;
  onSwitchMode?: (mode: 'drives' | 'forwarder') => void;
  onBackToLauncher: () => void;
}

export function ForwarderWorkspace({
  activeSession,
  onSwitchMode: _onSwitchMode,
  onBackToLauncher,
}: ForwarderWorkspaceProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'jobs' | 'new_job' | 'history' | 'decisions'>('overview');

  return (
    <div className="ag-forwarder-shell">
      <header className="ag-forwarder-header">
        <div className="ag-forwarder-identity">
          <button
            type="button"
            onClick={onBackToLauncher}
            className="ag-forwarder-back-button"
            title={t('nav.back_to_launcher')}
            aria-label={t('nav.back_to_launcher')}
          >
            <ArrowLeft size={19} aria-hidden="true" />
          </button>
          <span className="ag-forwarder-product">
            <ArrowRightLeft size={18} aria-hidden="true" />
            <span>{t('nav.open_forwarder')}</span>
          </span>
        </div>
      </header>

      <div className="ag-forwarder-layout">
        <aside className="ag-forwarder-sidebar">
          <button
            type="button"
            onClick={onBackToLauncher}
            className="ag-forwarder-session"
            title={t('nav.switch_session')}
            aria-label={t('nav.switch_session')}
          >
            <Zap size={16} aria-hidden="true" />
            <span className="ag-forwarder-session-name">{activeSession || t('ui.generated.session_utama_6c6254e')}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
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
