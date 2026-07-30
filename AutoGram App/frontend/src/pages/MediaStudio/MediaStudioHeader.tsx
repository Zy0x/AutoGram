import React from 'react';
import { Search, X, RefreshCw, HardDrive } from 'lucide-react';

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
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/80 border-b border-slate-800 p-4 backdrop-blur-md sticky top-0 z-20">
      {/* Session Selector & Title */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
          <HardDrive size={20} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            AutoGram Drive &amp; Media Studio
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-slate-400">Sesi Aktif:</span>
            <select
              value={activeSession}
              onChange={(e) => onSelectSession(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-0.5 text-xs text-indigo-300 font-medium focus:ring-1 focus:ring-indigo-500"
            >
              {sessions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Search & Actions */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 md:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari file media..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:ring-1 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-all"
          title="Refresh Drive"
        >
          <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-indigo-400' : ''} />
        </button>
      </div>
    </div>
  );
};
