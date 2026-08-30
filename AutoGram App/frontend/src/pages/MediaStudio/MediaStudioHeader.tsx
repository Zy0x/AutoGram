import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, RefreshCw, HardDrive } from 'lucide-react';
import { getSessionDisplayName } from '../../lib/telegram';

export interface MediaStudioHeaderProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  activeSession: string;
  sessions: string[];
  onSelectSession: (session: string) => void;
}

export const MediaStudioHeader: React.FC<MediaStudioHeaderProps> = ({
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing,
  activeSession,
  sessions,
  onSelectSession,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/80 border-b border-slate-800 p-4 backdrop-blur-md sticky top-0 z-20">
      {/* Session Selector & Title */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
          <HardDrive size={20} />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            {t('ui.generated.drive_studio_2291ebb')}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>{t('drive.active_session_label')}</span>
            <select
              value={activeSession}
              onChange={(e) => onSelectSession(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-2 py-0.5 text-xs text-indigo-400 font-mono focus:ring-1 focus:ring-indigo-500 outline-none"
            >
              {sessions.map((s) => (
                <option key={s} value={s}>
                  {getSessionDisplayName(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Search & Actions */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('drive.search_media_ph')}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all disabled:opacity-50"
          title={t('drive.refresh_drive')}
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-indigo-400' : ''} />
        </button>
      </div>
    </div>
  );
};
