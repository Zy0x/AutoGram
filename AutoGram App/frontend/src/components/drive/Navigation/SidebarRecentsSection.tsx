import { useTranslation } from 'react-i18next';
import React from 'react';
import { Clock, Home, Folder, MessageSquare } from 'lucide-react';
import type { DriveRecent } from '../../../lib/telegram';
import { recentDisplayLabel } from '../../../lib/telegram';


export interface SidebarRecentsSectionProps {
  recents: DriveRecent[];
  onSelectRecent: (rec: DriveRecent) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}

export const SidebarRecentsSection: React.FC<SidebarRecentsSectionProps> = ({
  recents,
  onSelectRecent,
  isOpen,
  onToggleOpen,
}) => {
  const { t } = useTranslation();
  if (!recents || recents.length === 0) return null;

  return (
    <div className="mb-3">
      <div
        onClick={onToggleOpen}
        className="flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 transition-colors select-none"
      >
        <span className="flex items-center gap-1.5">
          <Clock size={12} className="text-indigo-400" />
          {t('drive.sidebar_recents_header')}
        </span>
        <span className="text-[10px] text-slate-500 font-mono">{recents.length}</span>
      </div>

      {isOpen && (
        <div className="space-y-0.5 px-1.5 mt-1">
          {recents.slice(0, 8).map((rec, i) => (
            <button
              key={`recent-${rec.kind}-${rec.id}-${i}`}
              type="button"
              onClick={() => onSelectRecent(rec)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all text-left truncate"
            >
              {rec.kind === 'saved' && <Home size={13} className="text-amber-400 flex-shrink-0" />}
              {rec.kind === 'drive' && <Folder size={13} className="text-indigo-400 flex-shrink-0" />}
              {rec.kind === 'chat' && <MessageSquare size={13} className="text-emerald-400 flex-shrink-0" />}
              <span className="truncate">{recentDisplayLabel(rec.label, 18)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
