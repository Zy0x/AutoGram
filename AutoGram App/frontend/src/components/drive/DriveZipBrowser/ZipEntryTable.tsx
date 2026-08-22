import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Download,
  Eye,
  File,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  LockKeyhole,
  Loader2,
} from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { entryLabel, isZipArchiveName, type ZipEntry } from './zipUtils';
import { isMediaThumbnailSupported } from './ZipThumbnailManager';

type ZipEntryTableProps = {
  dirs: string[];
  files: ZipEntry[];
  currentPath: string;
  onNavigateDir: (path: string) => void;
  selectedEntries: Set<string>;
  onSelectEntry: (name: string, e: React.MouseEvent) => void;
  onSelectAll: () => void;
  isAllSelected: boolean;
  onPreviewCode: (entry: ZipEntry) => void;
  onExtractEntry: (entry: ZipEntry) => void;
  onExtractDirectory: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, target: { kind: 'file'; entry: ZipEntry } | { kind: 'dir'; path: string }) => void;
  thumbnails?: Map<string, string>;
  loadingThumbnails?: Set<string>;
  onLoadThumbnail?: (entry: ZipEntry) => void;
};

function EntryIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (isZipArchiveName(lower)) return <Archive size={17} className="dzb-file-icon archive" />;
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|heic|heif)$/.test(lower)) return <ImageIcon size={17} className="dzb-file-icon image" />;
  if (/\.(mp4|mkv|avi|mov|webm|m4v|mp3|m4a|aac|flac|wav|opus|ogg)$/.test(lower)) return <Film size={17} className="dzb-file-icon media" />;
  if (/\.(txt|json|md|mdx|py|rs|ts|tsx|js|jsx|css|html|log|sh|csv|xml|ya?ml|toml|ini|sql|pdf)$/.test(lower)) return <FileText size={17} className="dzb-file-icon document" />;
  return <File size={17} className="dzb-file-icon generic" />;
}

function getExtensionBadge(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : 'FILE';
}

export const ZipEntryTable: React.FC<ZipEntryTableProps> = ({
  dirs,
  files,
  currentPath,
  onNavigateDir,
  selectedEntries,
  onSelectEntry,
  onSelectAll,
  isAllSelected,
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
    <div className="dzb-table-wrap">
      <table className="dzb-table">
        <thead className="dzb-thead">
          <tr>
            <th className="dzb-th-name">
              <div className="dzb-th-name-inner">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={onSelectAll}
                  className="dzb-checkbox"
                  title={t('speedtest.zip_select_all')}
                  aria-label={t('speedtest.zip_select_all')}
                />
                <span>{t('speedtest.zip_col_name')}</span>
              </div>
            </th>
            <th className="dzb-th-type">{t('speedtest.zip_sort_type')}</th>
            <th className="dzb-th-size">{t('speedtest.zip_col_size')}</th>
            <th className="dzb-th-actions">{t('speedtest.zip_col_actions')}</th>
          </tr>
        </thead>
        <tbody className="dzb-tbody">
          {/* Directories */}
          {dirs.map((directory) => {
            const label = entryLabel(directory, currentPath);
            const selected = selectedEntries.has(directory);

            return (
              <tr
                key={directory}
                data-entry-name={directory}
                className={`dzb-tr directory ${selected ? 'selected' : ''}`}
                onClick={(e) => onSelectEntry(directory, e)}
                onDoubleClick={() => onNavigateDir(directory)}
                onContextMenu={(e) => onContextMenu(e, { kind: 'dir', path: directory })}
              >
                <td className="dzb-td-name">
                  <div className="dzb-name-cell">
                    <Folder size={18} className="dzb-folder-icon" />
                    <span className="dzb-entry-text" title={label}>
                      {label}
                    </span>
                  </div>
                </td>
                <td className="dzb-td-type">
                  <span className="dzb-type-pill folder">{t('speedtest.zip_tag_folder')}</span>
                </td>
                <td className="dzb-td-size">—</td>
                <td className="dzb-td-actions">
                  <div className="dzb-row-actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExtractDirectory(directory);
                      }}
                      className="dzb-action-icon-btn small"
                      title={t('speedtest.zip_extract_directory')}
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}

          {/* Files */}
          {files.map((entry) => {
            const label = entryLabel(entry.name, currentPath);
            const selected = selectedEntries.has(entry.name);
            const compressed = entry.compressed_size ?? entry.compressedSize ?? entry.size;
            const ratio = entry.size > 0 ? Math.max(0, Math.round(((entry.size - compressed) / entry.size) * 100)) : 0;
            const ext = getExtensionBadge(entry.name);
            const thumbUrl = thumbnails?.get(entry.name);
            const isThumbLoading = loadingThumbnails?.has(entry.name);

            return (
              <tr
                key={entry.name}
                data-entry-name={entry.name}
                className={`dzb-tr ${selected ? 'selected' : ''}`}
                onClick={(e) => onSelectEntry(entry.name, e)}
                onDoubleClick={() => onPreviewCode(entry)}
                onContextMenu={(e) => onContextMenu(e, { kind: 'file', entry })}
              >
                <td className="dzb-td-name">
                  <div className="dzb-name-cell">
                    {thumbUrl ? (
                      <div className="dzb-table-thumb-wrap">
                        <img src={thumbUrl} alt="" className="dzb-table-thumb-img" />
                      </div>
                    ) : isThumbLoading ? (
                      <div className="dzb-table-thumb-loading">
                        <Loader2 size={16} className="dzb-micro-spinner animate-spin" />
                      </div>
                    ) : (
                      <EntryIcon name={entry.name} />
                    )}
                    {entry.encrypted && (
                      <span className="dzb-lock-icon" title={t('speedtest.zip_protected')}>
                        <LockKeyhole size={13} />
                      </span>
                    )}
                    <span className="dzb-entry-text" title={entry.name}>
                      {label}
                    </span>
                  </div>
                </td>
                <td className="dzb-td-type">
                  <span className="dzb-type-pill">{ext}</span>
                </td>
                <td className="dzb-td-size">
                  <div className="dzb-size-cell">
                    <span>{formatDriveBytes(entry.size)}</span>
                    {ratio > 10 && (
                      <span className="dzb-ratio-badge" title={`${t('speedtest.zip_col_compressed')}: ${formatDriveBytes(compressed)}`}>
                        −{ratio}%
                      </span>
                    )}
                  </div>
                </td>
                <td className="dzb-td-actions">
                  <div className="dzb-row-actions">
                    {isMediaThumbnailSupported(entry.name) && !thumbUrl && onLoadThumbnail && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLoadThumbnail(entry);
                        }}
                        className="dzb-action-icon-btn small thumb-btn"
                        title={t('speedtest.zip_load_thumbnail')}
                      >
                        {isThumbLoading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreviewCode(entry);
                      }}
                      className="dzb-action-icon-btn small"
                      title={isZipArchiveName(entry.name) ? t('speedtest.zip_open_nested') : t('speedtest.zip_preview_content')}
                    >
                      {isZipArchiveName(entry.name) ? <Archive size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExtractEntry(entry);
                      }}
                      className="dzb-action-icon-btn small"
                      title={t('speedtest.zip_extract_entry')}
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
