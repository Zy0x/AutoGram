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
} from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import {
  entryLabel,
  isZipArchiveName,
  type ZipEntry,
} from './zipUtils';

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
            className={`dzb-grid-card directory ${selected ? 'selected' : ''}`}
            onClick={(e) => onSelectEntry(directory, e)}
            onDoubleClick={() => onNavigateDir(directory)}
            onContextMenu={(e) => onContextMenu(e, { kind: 'dir', path: directory })}
            role="gridcell"
            tabIndex={0}
            title={t('speedtest.zip_folder_double_click')}
          >
            <div className="dzb-grid-card-top">
              <span className="dzb-grid-badge folder">{t('speedtest.zip_tag_folder')}</span>
            </div>

            <div className="dzb-grid-card-center">
              <div className="dzb-folder-orb">
                <Folder size={36} className="dzb-folder-icon" />
              </div>
            </div>

            <div className="dzb-grid-card-bottom">
              <span className="dzb-grid-filename" title={label}>
                {label}
              </span>

              <div className="dzb-grid-card-actions">
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

        return (
          <div
            key={entry.name}
            data-entry-name={entry.name}
            className={`dzb-grid-card ${selected ? 'selected' : ''}`}
            onClick={(e) => onSelectEntry(entry.name, e)}
            onDoubleClick={() => onPreviewCode(entry)}
            onContextMenu={(e) => onContextMenu(e, { kind: 'file', entry })}
            role="gridcell"
            tabIndex={0}
            title={entry.name}
          >
            <div className="dzb-grid-card-top">
              <div className="dzb-grid-top-badges">
                {entry.encrypted && (
                  <span className="dzb-lock-pill" title={t('speedtest.zip_protected')}>
                    <LockKeyhole size={11} />
                  </span>
                )}
                <span className="dzb-grid-badge">{extTag}</span>
              </div>
            </div>

            <div className="dzb-grid-card-center">
              <div className="dzb-icon-orb">
                <EntryIcon name={entry.name} size={36} />
              </div>
            </div>

            <div className="dzb-grid-card-bottom">
              <span className="dzb-grid-filename" title={label}>
                {label}
              </span>

              <div className="dzb-grid-meta-row">
                <span className="dzb-grid-size">{formatDriveBytes(entry.size)}</span>
                {ratio > 10 && <span className="dzb-ratio-badge">−{ratio}%</span>}

                <div className="dzb-grid-card-actions">
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
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
