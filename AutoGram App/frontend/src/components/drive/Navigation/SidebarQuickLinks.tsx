import React from 'react';
import { Home, Bookmark, Clock, Trash2, Download } from 'lucide-react';

export interface SidebarQuickLinksProps {
  activeView: string;
  onSelectView: (view: string) => void;
}

export const SidebarQuickLinks: React.FC<SidebarQuickLinksProps> = ({
  activeView,
  onSelectView,
}) => {
  const items = [
    { id: 'root', label: 'Drive Root', icon: <Home size={16} className="text-indigo-400" /> },
    { id: 'saved', label: 'Saved Messages', icon: <Bookmark size={16} className="text-amber-400" /> },
    { id: 'recents', label: 'Baru Dilihat', icon: <Clock size={16} className="text-cyan-400" /> },
    { id: 'downloads', label: 'Transfer Active', icon: <Download size={16} className="text-emerald-400" /> },
    { id: 'trash', label: 'Tong Sampah', icon: <Trash2 size={16} className="text-rose-400" /> },
  ];

  return (
    <div className="space-y-1">
      <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
        Navigasi Cepat
      </span>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelectView(item.id)}
          className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-xl transition-all ${
            activeView === item.id
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
              : 'text-slate-300 hover:text-white hover:bg-slate-900'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};
