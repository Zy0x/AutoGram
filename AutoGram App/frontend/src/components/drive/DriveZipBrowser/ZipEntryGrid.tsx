import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Folder,
  Archive,
  Image as ImageIcon,
  Film,
  FileText,
  File,
  Eye,
  Download,
  LockKeyhole,
  Loader2,
} from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import {
  entryLabel,
  isZipArchiveName,
  type ZipEntry,
} from './zipUtils';
import { isMediaThumbnailSupported } from './ZipThumbnailManager';

type ZipEntryGridProps = {
  dirs: string[];
  files: ZipEntry[];
  currentPath: string;
  onNavigateDir: (path: string) => void;
  selectedEntries: Set<string>;
  onSelectEntry: (name: string, e: React.MouseEvent) => void;
  onPreviewCode: (entry: ZipEntry) => void;
  onExtractEntry: (entry: ZipEntry) => void;
  onExtractDirectory: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, target: { kind: 'file'; entry: ZipEntry } | { kind: 'dir'; path: string }) => void;
  thumbnails?: Map<string, string>;
  loadingThumbnails?: Set<string>;
  onLoadThumbnail?: (entry: ZipEntry) => void;
};

function EntryIcon({ name, size = 32 }: { name: string; size?: number }) {
  const lower = name.toLowerCase();
  if (isZipArchiveName(lower)) return <Archive size={size} className="dzb-grid-icon archive" />;
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|heic|heif)$/.test(lower)) return <ImageIcon size={size} className="dzb-grid-icon image" />;
  if (/\.(mp4|mkv|avi|mov|webm|m4v|mp3|m4a|aac|flac|wav|opus|ogg)$/.test(lower)) return <Film size={size} className="dzb-grid-icon media" />;
  if (/\.(txt|json|md|mdx|py|rs|ts|tsx|js|jsx|css|html|log|sh|csv|xml|ya?ml|toml|ini|sql|pdf)$/.test(lower)) return <FileText size={size} className="dzb-grid-icon document" />;
  return <File size={size} className="dzb-grid-icon generic" />;
}

function getExtensionTag(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : 'FILE';
}

export const ZipEntryGrid: React.FC<ZipEntryGridProps> = ({
  dirs,
  files,
  currentPath,
  onNavigateDir,
  selectedEntries,
  onSelectEntry,
  onPreviewCode,
  onExtractEntry,
  onExtractDirectory,
  onContextMenu,
  thumbnails,
  loadingThumbnails,
  onLoadThumbnail,
}) => {
  const { t } = useTranslation();

  return (
    <div className="dzb-grid-layout" role="grid">
      {/* Directories First */}
      {dirs.map((directory) => {
        const label = entryLabel(directory, currentPath);
        const selected = selectedEntries.has(directory);

        return (
          <div
            key={directory}
            data-entry-name={directory}
            className={`td-file-card dzb-grid-card directory ${selected ? 'selected' : ''}`}
            onClick={(e) => onSelectEntry(directory, e)}
            onDoubleClick={() => onNavigateDir(directory)}
            onContextMenu={(e) => onContextMenu(e, { kind: 'dir', path: directory })}
            role="gridcell"
            tabIndex={0}
            title={t('drive.zip_folder_double_click')}
          >
            <div className="td-file-card-inner dzb-grid-card-inner directory-card">
              <div className="td-file-perspective-badges dzb-top-badges">
                <span className="td-tag-badge dzb-tag-badge folder">{t('drive.zip_tag_folder')}</span>
              </div>

              <div className="td-file-thumb-empty dzb-thumb-empty directory-bg">
                <div className="dzb-folder-orb">
                  <Folder size={38} className="dzb-folder-icon" />
                </div>
              </div>

              <div className="td-file-card-meta dzb-card-meta on-empty">
                <div className="td-file-card-name dzb-card-name" title={label}>
                  {label}
                </div>
                <div className="td-file-card-sub dzb-card-sub">
                  <span className="td-file-card-size dzb-card-size">{t('drive.zip_tag_folder')}</span>
                </div>
              </div>

              <div className="td-file-card-actions dzb-card-actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExtractDirectory(directory);
                  }}
                  className="td-file-act dzb-action-icon-btn small"
                  title={t('drive.zip_extract_directory')}
                >
                  <Download size={13} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Files */}
      {files.map((entry) => {
        const label = entryLabel(entry.name, currentPath);
        const selected = selectedEntries.has(entry.name);
        const compressed = entry.compressed_size ?? entry.compressedSize ?? entry.size;
        const ratio = entry.size > 0 ? Math.max(0, Math.round(((entry.size - compressed) / entry.size) * 100)) : 0;
        const extTag = getExtensionTag(entry.name);
        const thumbUrl = thumbnails?.get(entry.name);
        const isThumbLoading = loadingThumbnails?.has(entry.name);

        return (
          <div
            key={entry.name}
            data-entry-name={entry.name}
            className={`td-file-card dzb-grid-card ${selected ? 'selected' : ''}`}
            onClick={(e) => onSelectEntry(entry.name, e)}
            onDoubleClick={() => onPreviewCode(entry)}
            onContextMenu={(e) => onContextMenu(e, { kind: 'file', entry })}
            role="gridcell"
            tabIndex={0}
            title={entry.name}
          >
            <div className="td-file-card-inner dzb-grid-card-inner">
              <div className="td-file-perspective-badges dzb-top-badges">
                {entry.encrypted && (
                  <span className="dzb-lock-pill" title={t('drive.zip_protected')}>
                    <LockKeyhole size={11} />
                  </span>
                )}
                <span className={`td-tag-badge dzb-tag-badge`}>{extTag}</span>
              </div>

              {thumbUrl ? (
                <div className="td-file-thumb-full dzb-thumb-full">
                  <img
                    src={thumbUrl}
                    alt={entry.name}
                    className="dzb-thumb-img"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="td-file-thumb-grad dzb-thumb-grad" />
                </div>
              ) : isThumbLoading ? (
                <div className="td-file-thumb-empty dzb-thumb-loading-wrap">
                  <div className="td-thumb-loading dzb-thumb-loading">
                    <Loader2 size={24} className="spin animate-spin" />
                    <span>{t('drive.zip_thumbnail_loading')}</span>
                  </div>
                </div>
              ) : (
                <div className="td-file-thumb-empty dzb-thumb-empty">
                  <div className="dzb-icon-orb-center">
                    <EntryIcon name={entry.name} size={36} />
                  </div>
                  {isMediaThumbnailSupported(entry.name) && onLoadThumbnail && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLoadThumbnail(entry);
                      }}
                      className="dzb-orb-preview-pill"
                      title={entry.encrypted ? t('drive.zip_password_for_media_title') : t('drive.zip_load_thumbnail')}
                    >
                      {entry.encrypted ? <LockKeyhole size={11} /> : <Eye size={11} />}
                      <span>{t('drive.zip_btn_load_preview')}</span>
                    </button>
                  )}
                </div>
              )}

              <div className={`td-file-card-meta dzb-card-meta ${thumbUrl ? 'on-media' : 'on-empty'}`}>
                <div className="td-file-card-name dzb-card-name" title={label}>
                  {label}
                </div>
                <div className="td-file-card-sub dzb-card-sub">
                  <div className="td-file-card-sub-row dzb-card-sub-row">
                    <span className="td-file-card-size dzb-card-size">{formatDriveBytes(entry.size)}</span>
                    {ratio > 10 && (
                      <span className="dzb-ratio-badge" title={`${t('drive.zip_col_compressed')}: ${formatDriveBytes(compressed)}`}>
                        −{ratio}%
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="td-file-card-actions dzb-card-actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreviewCode(entry);
                  }}
                  className="td-file-act dzb-action-icon-btn small"
                  title={isZipArchiveName(entry.name) ? t('drive.zip_open_nested') : t('drive.zip_preview_content')}
                >
                  {isZipArchiveName(entry.name) ? <Archive size={13} /> : <Eye size={13} />}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExtractEntry(entry);
                  }}
                  className="td-file-act ok dzb-action-icon-btn small"
                  title={t('drive.zip_extract_entry')}
                >
                  <Download size={13} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
