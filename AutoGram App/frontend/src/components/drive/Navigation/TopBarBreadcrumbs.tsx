import React from 'react';
import { ChevronRight, Home, Folder, MessageSquare, Hash } from 'lucide-react';
import type { DriveFolder } from '../../../lib/telegram/driveTypes';

export interface TopBarBreadcrumbsProps {
  locationKind: 'drive' | 'saved' | 'chat';
  currentFolder: DriveFolder | null;
  breadcrumbs: DriveFolder[];
  onNavigateFolder: (id: number | null) => void;
  topicId?: number | null;
  topicTitle?: string | null;
}

export const TopBarBreadcrumbs: React.FC<TopBarBreadcrumbsProps> = ({
  locationKind,
  currentFolder,
  breadcrumbs,
  onNavigateFolder,
  topicId,
  topicTitle,
}) => {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto text-xs select-none no-scrollbar">
      <button
        type="button"
        onClick={() => onNavigateFolder(null)}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-all font-medium"
      >
        {locationKind === 'saved' ? (
          <>
            <Home size={14} className="text-amber-400" /> Saved Messages
          </>
        ) : locationKind === 'chat' ? (
          <>
            <MessageSquare size={14} className="text-emerald-400" /> Chat Telegram
          </>
        ) : (
          <>
            <Folder size={14} className="text-indigo-400" /> Drive Root
          </>
        )}
      </button>

      {breadcrumbs.map((b) => (
        <React.Fragment key={b.id}>
          <ChevronRight size={12} className="text-slate-600 flex-shrink-0" />
          <button
            type="button"
            onClick={() => onNavigateFolder(b.id)}
            className={`px-2 py-1 rounded-lg transition-all font-medium truncate max-w-[150px] ${
              currentFolder?.id === b.id
                ? 'bg-indigo-600/20 text-indigo-300 font-bold border border-indigo-500/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            {b.name}
          </button>
        </React.Fragment>
      ))}

      {topicId != null && (
        <>
          <ChevronRight size={12} className="text-slate-600 flex-shrink-0" />
          <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[11px] font-semibold flex items-center gap-1">
            <Hash size={11} /> {topicTitle || `Topik #${topicId}`}
          </span>
        </>
      )}
    </div>
  );
};
