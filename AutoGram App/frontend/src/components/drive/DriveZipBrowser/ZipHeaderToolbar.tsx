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
  const { t } = useTranslation();

  const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t('speedtest.zip_cat_all', 'All Files'), icon: <File size={14} /> },
    { id: 'image', label: t('speedtest.zip_cat_image', 'Images'), icon: <ImageIcon size={14} style={{ color: '#34d399' }} /> },
    { id: 'media', label: t('speedtest.zip_cat_media', 'Media'), icon: <Film size={14} style={{ color: '#818cf8' }} /> },
    { id: 'doc', label: t('speedtest.zip_cat_doc', 'Docs & Code'), icon: <FileText size={14} style={{ color: '#fbbf24' }} /> },
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
                  title="Previous Archive"
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
                  title="Next Archive"
                >
                  <ChevronRight size={18} />
                </button>
              )}
            </div>
          )}

          <h4 className="dzb-archive-name" title={archiveName || 'Archive Explorer'}>
            {archiveName || 'Archive Explorer'}
          </h4>

          {isPasswordProtected ? (
            <span className="dzb-badge-protected">
              <Lock size={12} /> {t('speedtest.zip_protected', 'Protected')}
            </span>
          ) : (
            <span className="dzb-badge-unlocked">
              <Unlock size={12} /> {t('speedtest.zip_unlocked', 'Unlocked')}
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
              <span>{t('speedtest.zip_extract_count', { count: selectedCount, defaultValue: `Extract (${selectedCount})` })}</span>
            </button>
          )}

          {onDownloadZip && (
            <button
              type="button"
              onClick={onDownloadZip}
              className="dzb-btn-secondary"
            >
              <Download size={16} />
              <span>{t('speedtest.zip_save_archive', 'Save Archive')}</span>
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
            placeholder={t('speedtest.ph_search_zip', 'Search zip entries...')}
            className="dzb-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="dzb-search-clear"
              title="Clear search"
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
