import React from 'react';
import { Image, Film, Music, FileText, Archive, Package } from 'lucide-react';

export interface SidebarCategoryListProps {
  activeCategory: string;
  onSelectCategory: (cat: string) => void;
}

export const SidebarCategoryList: React.FC<SidebarCategoryListProps> = ({
  activeCategory,
  onSelectCategory,
}) => {
  const categories = [
    { id: 'image', label: 'Foto & Gambar', icon: <Image size={15} className="text-blue-400" /> },
    { id: 'video', label: 'Video & Film', icon: <Film size={15} className="text-purple-400" /> },
    { id: 'audio', label: 'Audio & Musik', icon: <Music size={15} className="text-emerald-400" /> },
    { id: 'document', label: 'Dokumen & PDF', icon: <FileText size={15} className="text-amber-400" /> },
    { id: 'archive', label: 'Arsip (ZIP/RAR)', icon: <Archive size={15} className="text-orange-400" /> },
    { id: 'apk', label: 'Aplikasi Android', icon: <Package size={15} className="text-lime-400" /> },
  ];

  return (
    <div className="space-y-1">
      <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
        Kategori Media
      </span>
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onSelectCategory(cat.id)}
          className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-xl transition-all ${
            activeCategory === cat.id
              ? 'bg-slate-900 text-indigo-300 font-bold border border-slate-800'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-950'
          }`}
        >
          {cat.icon}
          <span>{cat.label}</span>
        </button>
      ))}
    </div>
  );
};
