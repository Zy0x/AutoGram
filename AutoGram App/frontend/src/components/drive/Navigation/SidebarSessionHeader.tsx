import React from 'react';
import { RefreshCw, Loader2, ArrowLeft } from 'lucide-react';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { MediaSelect } from './MediaSelect';

export interface SidebarSessionHeaderProps {
  creds: DriveCredentials | null;
  sessions: { session: string; phone?: string; label?: string }[];
  onSelectSession: (s: string) => void;
  onRefreshDrive: () => void;
  loadingDrive?: boolean;
  circuitTripped?: boolean;
  onResetCircuit?: () => void;
  onExitToApp?: () => void;
}

export const SidebarSessionHeader: React.FC<SidebarSessionHeaderProps> = ({
  creds,
  sessions,
  onSelectSession,
  onRefreshDrive,
  loadingDrive,
  circuitTripped,
  onResetCircuit,
  onExitToApp,
}) => {
  return (
    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/60 backdrop-blur-md select-none">
      {onExitToApp && (
        <button
          type="button"
          onClick={onExitToApp}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
          title="Kembali ke App Utama"
        >
          <ArrowLeft size={16} />
        </button>
      )}

      <div className="flex-1 min-w-0">
        <MediaSelect
          className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg"
          value={creds?.session || ''}
          onChange={onSelectSession}
          options={sessions.map((s) => ({
            value: s.session,
            label: s.label || s.phone || s.session,
          }))}
          ariaLabel="Pilih Sesi Telegram"
        />
      </div>

      <button
        type="button"
        onClick={circuitTripped && onResetCircuit ? onResetCircuit : onRefreshDrive}
        disabled={loadingDrive}
        className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
          circuitTripped
            ? 'bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30'
            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
        }`}
        title={circuitTripped ? 'Coba Sambung Ulang (Circuit Tripped)' : 'Muat Ulang Drive'}
      >
        {loadingDrive ? (
          <Loader2 size={16} className="animate-spin text-indigo-400" />
        ) : (
          <RefreshCw size={16} className={circuitTripped ? 'animate-pulse text-red-400' : ''} />
        )}
      </button>
    </div>
  );
};
