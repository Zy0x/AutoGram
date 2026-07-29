import React from 'react';
import {
  Search,
  Download,
  Lock,
  Unlock,
  FileText,
  Image as ImageIcon,
  Film,
  File,
  ChevronLeft,
  ChevronRight,
  FolderInput,
} from 'lucide-react';
import { Category } from './zipUtils';

type ZipHeaderToolbarProps = {
  archiveName?: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  category: Category;
  onCategoryChange: (cat: Category) => void;
  isPasswordProtected?: boolean;
  onExtractSelected: () => void;
  selectedCount: number;
  onDownloadZip?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
};

export const ZipHeaderToolbar: React.FC<ZipHeaderToolbarProps> = ({
  archiveName,
  searchQuery,
  onSearchChange,
  category,
  onCategoryChange,
  isPasswordProtected,
  onExtractSelected,
  selectedCount,
  onDownloadZip,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}) => {
  const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Files', icon: <File className="w-3.5 h-3.5" /> },
    { id: 'image', label: 'Images', icon: <ImageIcon className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'media', label: 'Media', icon: <Film className="w-3.5 h-3.5 text-indigo-400" /> },
    { id: 'doc', label: 'Docs & Code', icon: <FileText className="w-3.5 h-3.5 text-amber-400" /> },
  ];

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md select-none text-slate-100">
      {/* Archive Name & Navigation */}
      <div className="flex items-center gap-2 min-w-0">
        {onPrev && (
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 transition-all"
            title="Previous"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            disabled={!hasNext}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 transition-all"
            title="Next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        <div className="min-w-0">
          <h4 className="font-semibold text-xs sm:text-sm text-slate-200 truncate flex items-center gap-2" title={archiveName}>
            <span>{archiveName || 'Archive Explorer'}</span>
            {isPasswordProtected ? (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-950/60 text-amber-300 border border-amber-800/40">
                <Lock className="w-3 h-3" /> Protected
              </span>
            ) : (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                <Unlock className="w-3 h-3" /> Unlocked
              </span>
            )}
          </h4>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search zip entries..."
          className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all font-mono"
        />
      </div>

      {/* Category Pills */}
      <div className="hidden sm:flex items-center gap-1 bg-slate-950 border border-slate-800 p-0.5 rounded-xl">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => onCategoryChange(c.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
              category === c.id ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {c.icon}
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      {/* Extract & Download Actions */}
      <div className="flex items-center gap-2">
        {selectedCount > 0 && (
          <button
            onClick={onExtractSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all"
          >
            <FolderInput className="w-3.5 h-3.5" />
            <span>Extract ({selectedCount})</span>
          </button>
        )}

        {onDownloadZip && (
          <button
            onClick={onDownloadZip}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700/60 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save Archive</span>
          </button>
        )}
      </div>
    </header>
  );
};
