import React, { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Download,
  Lock,
  FileText,
  Image as ImageIcon,
  Film,
  File,
  X,
  Archive,
  CornerUpLeft,
  LayoutGrid,
  List,
  ArrowUpDown,
  Home,
  FolderInput,
  ArrowUp,
  Eye,
  Loader2,
} from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import {
  middleTruncateFilename,
  type Category,
  type SortOption,
  type ViewMode,
} from './zipUtils';

type ZipHeaderToolbarProps = {
  archiveName?: string;
  totalFiles: number;
  totalBytes: number;
  dominantType?: 'images' | 'media' | 'mixed';
  searchQuery: string;
  onSearchChange: (q: string) => void;
  category: Category;
  onCategoryChange: (cat: Category) => void;
  categoryCounts: Record<Category, number>;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortOption: SortOption;
  onSortChange: (sort: SortOption) => void;
  isPasswordProtected?: boolean;
  onDownloadZip?: () => void;
  onExtractAll?: () => void;
  onClose?: () => void;
  nestedDepth?: number;
  onBackNested?: () => void;
  currentPath: string;
  onNavigateDir: (path: string) => void;
  currentFolderItemCount: number;
  unloadedMediaCount?: number;
  isLoadingAllMedia?: boolean;
  onLoadAllThumbnails?: () => void;
};

export const ZipHeaderToolbar: React.FC<ZipHeaderToolbarProps> = ({
  archiveName,
  totalFiles,
  totalBytes,
  dominantType = 'mixed',
  searchQuery,
  onSearchChange,
  category,
  onCategoryChange,
  categoryCounts,
  viewMode,
  onViewModeChange,
  sortOption,
  onSortChange,
  isPasswordProtected,
  onDownloadZip,
  onExtractAll,
  onClose,
  nestedDepth = 0,
  onBackNested,
  currentPath,
  onNavigateDir,
  currentFolderItemCount,
  unloadedMediaCount = 0,
  isLoadingAllMedia,
  onLoadAllThumbnails,
}) => {
  const { t } = useTranslation();
  const [showSortMenu, setShowSortMenu] = useState(false);

  const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t('speedtest.zip_cat_all'), icon: <File size={13} /> },
    { id: 'image', label: t('speedtest.zip_cat_image'), icon: <ImageIcon size={13} /> },
    { id: 'media', label: t('speedtest.zip_cat_media'), icon: <Film size={13} /> },
    { id: 'doc', label: t('speedtest.zip_cat_doc'), icon: <FileText size={13} /> },
    { id: 'archive', label: t('speedtest.zip_cat_archive'), icon: <Archive size={13} /> },
  ];

  const sortOptions: { id: SortOption; label: string }[] = [
    { id: 'name-asc', label: t('speedtest.zip_sort_name_asc') },
    { id: 'name-desc', label: t('speedtest.zip_sort_name_desc') },
    { id: 'size-desc', label: t('speedtest.zip_sort_size_desc') },
    { id: 'size-asc', label: t('speedtest.zip_sort_size_asc') },
    { id: 'type', label: t('speedtest.zip_sort_type') },
  ];

  const pathParts = currentPath.split('/').filter(Boolean);
  const canNavigateUp = pathParts.length > 0 || (nestedDepth > 0 && !!onBackNested);

  const handleNavigateUp = () => {
    if (pathParts.length > 1) {
      const parentPath = `${pathParts.slice(0, -1).join('/')}/`;
      onNavigateDir(parentPath);
    } else if (pathParts.length === 1) {
      onNavigateDir('');
    } else if (nestedDepth > 0 && onBackNested) {
      onBackNested();
    }
  };

  const rawTitle = archiveName || t('speedtest.zip_archive_explorer');
  const truncatedTitle = middleTruncateFilename(rawTitle, 40);

  return (
    <header className="dzb-header-workbench">
      {/* LAYER 1: Archive Identity & Primary Controls */}
      <div className="dzb-identity-bar">
        {/* Left: Icon + Name + Badges */}
        <div className="dzb-identity-left">
          {onBackNested && (
            <button
              type="button"
              onClick={onBackNested}
              className="dzb-back-nested-btn"
              title={t('speedtest.zip_back_parent')}
            >
              <CornerUpLeft size={16} />
            </button>
          )}

          <div className="dzb-archive-badge-icon">
            <Archive size={20} className="dzb-archive-svg" />
          </div>

          <div className="dzb-archive-titles">
            <div className="dzb-title-row">
              <h2 className="dzb-archive-name" title={rawTitle}>
                {truncatedTitle}
              </h2>

              {nestedDepth > 0 && (
                <span className="dzb-badge-nested">
                  {t('speedtest.zip_nested_depth', { count: nestedDepth })}
                </span>
              )}

              {isPasswordProtected && (
                <span className="dzb-badge-locked" title={t('speedtest.zip_protected')}>
                  <Lock size={12} />
                  <span>{t('speedtest.zip_protected')}</span>
                </span>
              )}
            </div>

            <div className="dzb-subtitle-row">
              <span className="dzb-meta-stat">
                {t('speedtest.zip_meta_files', { count: totalFiles })}
              </span>
              <span className="dzb-meta-dot">•</span>
              <span className="dzb-meta-stat">{formatDriveBytes(totalBytes)}</span>
              {dominantType !== 'mixed' && (
                <>
                  <span className="dzb-meta-dot">•</span>
                  <span className="dzb-meta-type">
                    {dominantType === 'images'
                      ? t('speedtest.zip_dominant_images')
                      : t('speedtest.zip_dominant_media')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: View Toggle, Extract All, Save, Close */}
        <div className="dzb-identity-right">
          {viewMode === 'grid' && unloadedMediaCount > 0 && onLoadAllThumbnails && (
            <button
              type="button"
              onClick={onLoadAllThumbnails}
              disabled={isLoadingAllMedia}
              className="dzb-btn-load-all-media"
              title={t('speedtest.zip_preview_all_media', { count: unloadedMediaCount })}
            >
              {isLoadingAllMedia ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Eye size={14} />
              )}
              <span>{t('speedtest.zip_preview_all_media', { count: unloadedMediaCount })}</span>
            </button>
          )}

          <div className="dzb-view-toggle-group">
            <button
              type="button"
              onClick={() => onViewModeChange('list')}
              className={`dzb-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              title={t('speedtest.zip_view_list')}
            >
              <List size={16} />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('grid')}
              className={`dzb-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              title={t('speedtest.zip_view_grid')}
            >
              <LayoutGrid size={16} />
            </button>
          </div>

          {onExtractAll && (
            <button
              type="button"
              onClick={onExtractAll}
              className="dzb-btn-save-archive"
              title={t('speedtest.zip_btn_extract_all')}
            >
              <FolderInput size={15} />
              <span>{t('speedtest.zip_btn_extract_all')}</span>
            </button>
          )}

          {onDownloadZip && (
            <button
              type="button"
              onClick={onDownloadZip}
              className="dzb-btn-save-archive"
              title={t('speedtest.zip_save_archive')}
            >
              <Download size={15} />
              <span>{t('speedtest.zip_save_archive')}</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="dzb-close-btn"
              title={t('speedtest.zip_close')}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* LAYER 2: Command & Breadcrumbs Navigation Bar */}
      <div className="dzb-command-bar">
        {/* Breadcrumb Path Bar */}
        <nav className="dzb-breadcrumbs-bar" aria-label={t('speedtest.zip_breadcrumbs')}>
          <button
            type="button"
            onClick={handleNavigateUp}
            disabled={!canNavigateUp}
            className="dzb-crumb-up-btn"
            title={
              pathParts.length > 0
                ? t('speedtest.zip_up_one_level')
                : nestedDepth > 0
                ? t('speedtest.zip_back_parent')
                : t('speedtest.zip_up_disabled')
            }
            aria-label={t('speedtest.zip_up_one_level')}
          >
            <ArrowUp size={13} strokeWidth={2.4} />
          </button>

          <button
            type="button"
            onClick={() => onNavigateDir('')}
            className={`dzb-crumb-item ${pathParts.length === 0 ? 'active' : ''}`}
            title={t('speedtest.zip_back_to_root')}
          >
            <Home size={13} />
            <span>{t('speedtest.zip_root')}</span>
          </button>

          {pathParts.map((part, index) => {
            const subPath = `${pathParts.slice(0, index + 1).join('/')}/`;
            const isLast = index === pathParts.length - 1;
            return (
              <Fragment key={subPath}>
                <span className="dzb-crumb-divider">/</span>
                <button
                  type="button"
                  onClick={() => onNavigateDir(subPath)}
                  className={`dzb-crumb-item ${isLast ? 'active' : ''}`}
                >
                  {part}
                </button>
              </Fragment>
            );
          })}

          <span className="dzb-folder-count">
            ({t('speedtest.zip_items_count', { count: currentFolderItemCount })})
          </span>
        </nav>

        {/* Search, Filter Pills & Sort */}
        <div className="dzb-controls-row">
          {/* Real-Time Search Box */}
          <div className="dzb-search-wrap">
            <Search className="dzb-search-icon" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('speedtest.ph_search_zip')}
              className="dzb-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="dzb-search-clear-btn"
                title={t('speedtest.zip_clear_search')}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Category Filter Chips with Live Counters */}
          <div className="dzb-category-chips">
            {categories.map((c) => {
              const count = categoryCounts[c.id] || 0;
              const isActive = category === c.id;

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCategoryChange(c.id)}
                  className={`dzb-chip-btn ${isActive ? 'active' : ''}`}
                >
                  {c.icon}
                  <span>{c.label}</span>
                  <span className="dzb-chip-counter">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Sort Selector Dropdown */}
          <div className="dzb-sort-container">
            <button
              type="button"
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="dzb-sort-trigger-btn"
              title={t('speedtest.zip_sort_by')}
            >
              <ArrowUpDown size={14} />
              <span>{sortOptions.find((s) => s.id === sortOption)?.label}</span>
            </button>

            {showSortMenu && (
              <div className="dzb-sort-dropdown" onMouseLeave={() => setShowSortMenu(false)}>
                {sortOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onSortChange(opt.id);
                      setShowSortMenu(false);
                    }}
                    className={`dzb-sort-option ${sortOption === opt.id ? 'active' : ''}`}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
