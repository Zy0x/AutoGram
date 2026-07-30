import React from 'react';

export interface FilterTabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

export interface MediaStudioFilterTabsProps {
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  tabs: FilterTabItem[];
}

export const MediaStudioFilterTabs: React.FC<MediaStudioFilterTabsProps> = ({
  activeTab,
  onSelectTab,
  tabs,
}) => {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-4 py-2 bg-slate-950/40 border-b border-slate-800/60">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelectTab(tab.id)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 flex-shrink-0 ${
            activeTab === tab.id
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.count != null && (
            <span className="text-[10px] opacity-75 font-mono">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
};
