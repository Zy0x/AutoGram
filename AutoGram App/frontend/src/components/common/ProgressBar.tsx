import { TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ProgressBarProps {
  progress: number;
  isMigrating: boolean;
}

export function ProgressBar({ progress, isMigrating }: ProgressBarProps) {
  const { t } = useTranslation();
  return (
    <div style={{ marginTop: '24px', opacity: isMigrating || progress > 0 ? 1 : 0.3, transition: 'var(--transition-safe)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
        <span style={{ color: 'var(--primary)' }}>{t('dashboard.global_progress')}</span>
        <span>{progress.toFixed(1)}%</span>
      </div>
      <div className="progress-container">
        <div className="progress-fill" style={{ transform: `scaleX(${progress / 100})` }}></div>
      </div>
      <div className="monospace" style={{ marginTop: '12px', display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '6px' }}>
        <TerminalSquare size={16} />
        <span>{isMigrating ? t('ui.generated.id_15_uploading_media_chunk_3c5c622') : t('ui.generated.standby_waiting_for_command_ecbab71')}</span>
      </div>
    </div>
  );
}
