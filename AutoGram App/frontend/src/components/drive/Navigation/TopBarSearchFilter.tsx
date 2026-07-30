import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';

export interface TopBarSearchFilterProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeCategory: string;
  onSelectCategory: (cat: string) => void;
  categories: { id: string; label: string; count?: number }[];
}

export const TopBarSearchFilter: React.FC<TopBarSearchFilterProps> = ({
  searchQuery,
  onSearchChange,
  activeCategory,
  onSelectCategory,
  categories,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('speedtest.topbar_search_files_ph')}
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

      {/* Category Filter Pills */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategory(cat.id)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 flex-shrink-0 ${
              activeCategory === cat.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <span>{cat.label}</span>
            {cat.count != null && (
              <span className="text-[10px] opacity-75 font-mono">({cat.count})</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
