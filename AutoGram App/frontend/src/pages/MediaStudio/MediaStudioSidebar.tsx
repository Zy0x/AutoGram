import React from 'react';
import {
  HardDrive,
  Folder,
  FolderPlus,
  MessageSquare,
  ChevronRight,
  UserCheck,
  Hash,
  RefreshCw,
} from 'lucide-react';
import { DriveFolder, DriveChat, DriveTopic } from '../../lib/driveTypes';

type MediaStudioSidebarProps = {
  sessions: string[];
  currentSession: string;
  onSelectSession: (sess: string) => void;
  folders: DriveFolder[];
  activeFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  chats: DriveChat[];
  activePeerId: string | number | null;
  onSelectPeer: (id: string | number | null) => void;
  topics: DriveTopic[];
  activeTopicId: number | null;
  onSelectTopic: (id: number | null) => void;
  isRailCollapsed: boolean;
  onToggleRail: () => void;
  onNewFolder: () => void;
  onRefreshSidebar: () => void;
};

export const MediaStudioSidebar: React.FC<MediaStudioSidebarProps> = ({
  sessions,
  currentSession,
  onSelectSession,
  folders,
  activeFolderId,
  onSelectFolder,
  chats,
  activePeerId,
  onSelectPeer,
  topics,
  activeTopicId,
  onSelectTopic,
  isRailCollapsed,
  onToggleRail,
  onNewFolder,
  onRefreshSidebar,
}) => {
  if (isRailCollapsed) {
    return (
      <aside className="w-14 h-full bg-slate-900/90 border-r border-slate-800/80 flex flex-col items-center py-4 gap-4 backdrop-blur-md select-none">
        <button
          onClick={onToggleRail}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
          title="Expand Sidebar"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <div className="w-8 h-px bg-slate-800" />
        <button
          onClick={() => onSelectFolder(null)}
          className={`p-2.5 rounded-xl transition-all ${
            activeFolderId === null ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title="Drive Root"
        >
          <HardDrive className="w-5 h-5" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 h-full bg-slate-900/90 border-r border-slate-800/80 flex flex-col backdrop-blur-md select-none text-slate-200">
      <div className="p-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <select
            value={currentSession}
            onChange={(e) => onSelectSession(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 font-mono truncate"
          >
            {sessions.length === 0 && <option value="">No Active Account</option>}
            {sessions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={onRefreshSidebar}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
          title="Refresh Sidebar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 px-2">
            <span>Drives & Folders</span>
            <button
              onClick={onNewFolder}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors"
              title="New Folder"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => onSelectFolder(null)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-all ${
              activeFolderId === null && activePeerId === null
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
            }`}
          >
            <HardDrive className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="truncate">Saved Messages (Root)</span>
          </button>

          <div className="mt-1 pl-2 space-y-0.5 border-l border-slate-800 ml-3">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => onSelectFolder(f.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                  activeFolderId === f.id
                    ? 'bg-indigo-950/60 text-indigo-300 font-medium border border-indigo-800/50'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        </div>

        {topics.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 px-2">
              Forum Topics
            </div>
            <div className="space-y-0.5">
              <button
                onClick={() => onSelectTopic(null)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                  activeTopicId === null ? 'bg-slate-800 text-slate-100 font-medium' : 'text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                <Hash className="w-3.5 h-3.5 text-indigo-400" />
                <span>All Topics</span>
              </button>
              {topics.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelectTopic(t.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                    activeTopicId === t.id ? 'bg-indigo-950/60 text-indigo-300 font-medium' : 'text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5 text-slate-500" />
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {chats.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 px-2">
              Chats & Channels
            </div>
            <div className="space-y-0.5">
              {chats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelectPeer(c.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                    activePeerId === c.id ? 'bg-indigo-950/60 text-indigo-300 font-medium' : 'text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
