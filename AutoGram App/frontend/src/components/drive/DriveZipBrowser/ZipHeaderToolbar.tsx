import React from 'react';
import { useTranslation } from 'react-i18next';
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
  X,
  Archive,
  CornerUpLeft,
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
  nestedDepth?: number;
  onBackNested?: () => void;
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
  nestedDepth = 0,
  onBackNested,
}) => {
  const { t } = useTranslation();

  const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t('speedtest.zip_cat_all'), icon: <File size={14} /> },
    { id: 'image', label: t('speedtest.zip_cat_image'), icon: <ImageIcon size={14} /> },
    { id: 'media', label: t('speedtest.zip_cat_media'), icon: <Film size={14} /> },
    { id: 'doc', label: t('speedtest.zip_cat_doc'), icon: <FileText size={14} /> },
    { id: 'archive', label: t('speedtest.zip_cat_archive'), icon: <Archive size={14} /> },
  ];

  return (
    <header className="dzb-toolbar">
      {/* Top row: Archive name, status badge, prev/next buttons */}
      <div className="dzb-toolbar-top">
        <div className="dzb-title-group">
          {(onPrev || onNext) && (
            <div className="dzb-nav-group">
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  className="dzb-nav-btn"
                  title={t('speedtest.zip_previous_archive')}
                >
                  <ChevronLeft size={18} />
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  className="dzb-nav-btn"
                  title={t('speedtest.zip_next_archive')}
                >
                  <ChevronRight size={18} />
                </button>
              )}
            </div>
          )}

          {onBackNested && (
            <button type="button" onClick={onBackNested} className="dzb-nav-btn" title={t('speedtest.zip_back_parent')}>
              <CornerUpLeft size={17} />
            </button>
          )}

          <h4 className="dzb-archive-name" title={archiveName || t('speedtest.zip_archive_explorer')}>
            {archiveName || t('speedtest.zip_archive_explorer')}
          </h4>

          {nestedDepth > 0 && <span className="dzb-depth-badge">{t('speedtest.zip_nested_depth', { count: nestedDepth })}</span>}

          {isPasswordProtected ? (
            <span className="dzb-badge-protected">
              <Lock size={12} /> {t('speedtest.zip_protected')}
            </span>
          ) : (
            <span className="dzb-badge-unlocked">
              <Unlock size={12} /> {t('speedtest.zip_unlocked')}
            </span>
          )}
        </div>

        {/* Top actions for Mobile Extract / Download if needed */}
        <div className="dzb-action-group">
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onExtractSelected}
              className="dzb-btn-primary"
            >
              <FolderInput size={16} />
              <span>{t('speedtest.zip_extract_count', { count: selectedCount })}</span>
            </button>
          )}

          {onDownloadZip && (
            <button
              type="button"
              onClick={onDownloadZip}
              className="dzb-btn-secondary"
            >
              <Download size={16} />
              <span>{t('speedtest.zip_save_archive')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Controls Row: Search Input + Scrollable Category Filter Pills */}
      <div className="dzb-toolbar-controls">
        <div className="dzb-search-box">
          <Search className="dzb-search-icon" size={16} />
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
              className="dzb-search-clear"
              title={t('speedtest.zip_clear_search')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="dzb-categories">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onCategoryChange(c.id)}
              className={`dzb-cat-tab ${category === c.id ? 'active' : ''}`}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
};
