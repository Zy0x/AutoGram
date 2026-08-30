import React from 'react';
import {
  Search,
  Grid,
  List,
  Upload,
  Image as ImageIcon,
  Film,
  FileText,
  File,
  Link as LinkIcon,
  Sticker,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DriveMediaFilter, DriveViewMode, DriveSortMode } from '../../lib/telegram/driveTypes';

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
  const { t } = useTranslation();

  const filters: { id: DriveMediaFilter; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t('drive.filter_all'), icon: <File className="w-3.5 h-3.5" /> },
    { id: 'image', label: t('drive.filter_images'), icon: <ImageIcon className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'video', label: t('drive.filter_videos'), icon: <Film className="w-3.5 h-3.5 text-indigo-400" /> },
    { id: 'document', label: t('drive.filter_docs'), icon: <FileText className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'link', label: t('drive.view_links'), icon: <LinkIcon className="w-3.5 h-3.5 text-sky-400" /> },
    { id: 'stickers', label: t('drive.tab_telegram_stickers'), icon: <Sticker className="w-3.5 h-3.5 text-violet-400" /> },
  ];

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md text-slate-200 select-none">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('drive.search_placeholder')}
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
        <select
          value={sortMode}
          onChange={(e) => onSortModeChange(e.target.value as DriveSortMode)}
        >
          <option value="newest">{t('drive.sort_newest_first')}</option>
          <option value="oldest">{t('drive.sort_oldest_first')}</option>
          <option value="name_asc">{t('drive.sort_name_asc')}</option>
          <option value="name_desc">{t('drive.sort_name_desc')}</option>
          <option value="size_desc">{t('drive.sort_size_desc')}</option>
          <option value="size_asc">{t('drive.sort_size_asc')}</option>
        </select>

        <div className="flex items-center bg-slate-950 border border-slate-800 p-0.5 rounded-xl">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grid' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
            title={t("drive.grid_view_tooltip")}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'list' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
            title={t("drive.list_view_tooltip")}
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={onUploadClick}
          className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
        >
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">{t('drive.btn_upload')}</span>
        </button>
      </div>
    </header>
  );
};
