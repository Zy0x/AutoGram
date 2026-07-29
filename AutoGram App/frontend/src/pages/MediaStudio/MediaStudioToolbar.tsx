import React from 'react';
import {
  Search,
  Grid,
  List,
  Upload,
  ArrowUpDown,
  Image as ImageIcon,
  Film,
  FileText,
  File,
  Link as LinkIcon,
} from 'lucide-react';
import { DriveMediaFilter, DriveViewMode, DriveSortMode } from '../../lib/driveTypes';

type MediaStudioToolbarProps = {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  mediaFilter: DriveMediaFilter;
  onMediaFilterChange: (f: DriveMediaFilter) => void;
  viewMode: DriveViewMode;
  onViewModeChange: (v: DriveViewMode) => void;
  sortMode: DriveSortMode;
  onSortModeChange: (s: DriveSortMode) => void;
  onUploadClick: () => void;
};

export const MediaStudioToolbar: React.FC<MediaStudioToolbarProps> = ({
  searchQuery,
  onSearchChange,
  mediaFilter,
  onMediaFilterChange,
  viewMode,
  onViewModeChange,
  sortMode,
  onSortModeChange,
  onUploadClick,
}) => {
  const filters: { id: DriveMediaFilter; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Files', icon: <File className="w-3.5 h-3.5" /> },
    { id: 'image', label: 'Photos', icon: <ImageIcon className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'video', label: 'Videos', icon: <Film className="w-3.5 h-3.5 text-indigo-400" /> },
    { id: 'document', label: 'Documents', icon: <FileText className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'link', label: 'Links', icon: <LinkIcon className="w-3.5 h-3.5 text-sky-400" /> },
  ];

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md text-slate-200 select-none">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search Drive files & folders..."
          className="w-full pl-9 pr-4 py-1.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all font-mono"
        />
      </div>

      <div className="hidden md:flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => onMediaFilterChange(f.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              mediaFilter === f.id
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {f.icon}
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={sortMode}
            onChange={(e) => onSortModeChange(e.target.value as DriveSortMode)}
            className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-1.5 focus:outline-none focus:border-indigo-500 transition-all appearance-none pr-8 cursor-pointer font-mono"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
            <option value="size_desc">Size (Largest)</option>
            <option value="size_asc">Size (Smallest)</option>
          </select>
          <ArrowUpDown className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>

        <div className="flex items-center bg-slate-950 border border-slate-800 p-0.5 rounded-xl">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grid' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Grid View"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'list' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
            title="List View"
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={onUploadClick}
          className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
        >
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">Upload</span>
        </button>
      </div>
    </header>
  );
};
