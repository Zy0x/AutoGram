import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  Folder,
  Plus,
  Play,
  History,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';
import { Jobs } from '../Jobs';

interface ForwarderWorkspaceProps {
  activeSession: string;
  onSwitchMode: (mode: 'drives' | 'forwarder') => void;
  onBackToLauncher: () => void;
  onOpenSettings: () => void;
}

export function ForwarderWorkspace({
  activeSession,
  onSwitchMode,
  onBackToLauncher,
  onOpenSettings,
}: ForwarderWorkspaceProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'jobs' | 'new_job' | 'history' | 'settings'>('jobs');

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: '#090e17',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* HEADER TOPBAR WITH DUAL-BAR QUICK SWITCHER & SESSION BADGE */}
      <header
        style={{
          height: '60px',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(11, 16, 26, 0.95)',
          backdropFilter: 'blur(16px)',
          zIndex: 40,
        }}
      >
        {/* LEFT: SESSION BADGE BUTTON (RETURN TO LAUNCHER) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            onClick={onBackToLauncher}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '6px 14px',
              borderRadius: '12px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              transition: 'all 0.15s ease',
            }}
            title={t('nav.switch_session', 'Ganti Session / Hub')}
          >
            <Zap size={16} />
            <span>{activeSession || 'Session Utama'}</span>
            <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>▾</span>
          </button>

          <span style={{ color: '#475569', fontSize: '0.8rem' }}>|</span>

          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowRightLeft size={18} style={{ color: '#818cf8' }} />
            <span>Forwarder Suite</span>
          </span>
        </div>

        {/* CENTER: DUAL-BAR WORKSPACE MODE SWITCHER (1-CLICK TOGGLE) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '3px',
            gap: '2px',
          }}
        >
          <button
            type="button"
            onClick={() => onSwitchMode('drives')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              borderRadius: '9px',
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Folder size={15} />
            <span>{t('nav.mode_drives', 'Drives')}</span>
          </button>

          <button
            type="button"
            onClick={() => onSwitchMode('forwarder')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(67, 56, 202, 0.4) 100%)',
              border: '1px solid rgba(129, 140, 248, 0.4)',
              color: '#ffffff',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
            }}
          >
            <ArrowRightLeft size={15} style={{ color: '#818cf8' }} />
            <span>{t('nav.mode_forwarder', 'Forwarder')}</span>
          </button>
        </div>

        {/* RIGHT: SETTINGS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={onOpenSettings}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
            title="Pengaturan Forwarder"
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </header>

      {/* SUB-NAV TABS FOR FORWARDER WORKSPACE */}
      <div
        style={{
          height: '44px',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(15, 23, 42, 0.6)',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('jobs')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: activeTab === 'jobs' ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
            border: activeTab === 'jobs' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
            color: activeTab === 'jobs' ? '#818cf8' : '#94a3b8',
            fontSize: '0.8rem',
            fontWeight: activeTab === 'jobs' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          <Play size={14} />
          <span>{t('nav.tab_jobs_active', 'Job Aktif & Runtime')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('new_job')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: activeTab === 'new_job' ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
            border: activeTab === 'new_job' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
            color: activeTab === 'new_job' ? '#818cf8' : '#94a3b8',
            fontSize: '0.8rem',
            fontWeight: activeTab === 'new_job' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          <Plus size={14} />
          <span>{t('nav.tab_new_job', 'Buat Job Baru')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: activeTab === 'history' ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
            border: activeTab === 'history' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
            color: activeTab === 'history' ? '#818cf8' : '#94a3b8',
            fontSize: '0.8rem',
            fontWeight: activeTab === 'history' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          <History size={14} />
          <span>{t('nav.tab_history', 'Riwayat & Log')}</span>
        </button>
      </div>

      {/* MAIN VIEWPORT */}
      <main style={{ flex: 1, overflow: 'auto', padding: '0' }}>
        <Jobs />
      </main>
    </div>
  );
}
