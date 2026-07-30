import { useTranslation } from 'react-i18next';
import React from 'react';
import { Shield, Trash2, CheckCircle2 } from 'lucide-react';

export interface SessionManagerTableProps {
  sessions: { session: string; phone?: string; label?: string; created_at?: string }[];
  activeSession: string | null;
  onSelectActive: (s: string) => void;
  onDeleteSession: (s: string) => void;
}

export const SessionManagerTable: React.FC<SessionManagerTableProps> = ({
  sessions,
  activeSession,
  onSelectActive,
  onDeleteSession,
}) => {
  const { t } = useTranslation();
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
          <Shield size={16} className="text-emerald-400" />
          Daftar Sesi Telegram Aktif ({sessions.length})
        </h3>
      </div>

      <div className="divide-y divide-slate-800/80">
        {sessions.map((s) => {
          const isActive = s.session === activeSession;
          return (
            <div
              key={s.session}
              className={`p-4 flex items-center justify-between transition-all ${
                isActive ? 'bg-indigo-950/20' : 'hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-xl border ${
                    isActive
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-slate-200">
                    {s.label || s.phone || s.session}
                  </h4>
                  <p className="text-[11px] font-mono text-slate-500">{s.session}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => onSelectActive(s.session)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all"
                  >
                    Gunakan Sesi
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDeleteSession(s.session)}
                  className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-all"
                  title={t('accounts.delete_title')}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
