import { TerminalSquare } from 'lucide-react';

interface ProgressBarProps {
  progress: number;
  isMigrating: boolean;
}

export function ProgressBar({ progress, isMigrating }: ProgressBarProps) {
  return (
    <div style={{ marginTop: '24px', opacity: isMigrating || progress > 0 ? 1 : 0.3, transition: 'var(--transition-safe)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
        <span style={{ color: 'var(--primary)' }}>Global Progress</span>
        <span>{progress.toFixed(1)}%</span>
      </div>
      <div className="progress-container">
        <div className="progress-fill" style={{ transform: `scaleX(${progress / 100})` }}></div>
      </div>
      <div className="monospace" style={{ marginTop: '12px', display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '6px' }}>
        <TerminalSquare size={16} />
        <span>{isMigrating ? `[ID: 15] Uploading media chunk...` : 'Standby. Waiting for command...'}</span>
      </div>
    </div>
  );
}
