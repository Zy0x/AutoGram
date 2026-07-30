import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Folder,
  File,
  FileText,
  Image as ImageIcon,
  Film,
  ChevronRight,
  Eye,
  Download,
  FolderOpen,
} from 'lucide-react';
import { ZipEntry, entryLabel } from './zipUtils';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';

type ZipEntryTableProps = {
  dirs: string[];
  files: ZipEntry[];
  currentPath: string;
  onNavigateDir: (path: string) => void;
  selectedEntries: Set<string>;
  onToggleSelectEntry: (name: string) => void;
  onSelectAll: () => void;
  isAllSelected: boolean;
  onPreviewCode: (entry: ZipEntry) => void;
  onExtractEntry: (entry: ZipEntry) => void;
};

export const ZipEntryTable: React.FC<ZipEntryTableProps> = ({
  dirs,
  files,
  currentPath,
  onNavigateDir,
  selectedEntries,
  onToggleSelectEntry,
  onSelectAll,
  isAllSelected,
  onPreviewCode,
  onExtractEntry,
}) => {
  const { t } = useTranslation();
  const pathParts = currentPath.split('/').filter(Boolean);

  const getFileIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|svg)$/.test(lower)) {
      return <ImageIcon size={18} style={{ color: '#34d399', flexShrink: 0 }} />;
    }
    if (/\.(mp4|mkv|avi|mov|webm|mp3|flac|wav)$/.test(lower)) {
      return <Film size={18} style={{ color: '#818cf8', flexShrink: 0 }} />;
    }
    if (/\.(txt|json|md|py|rs|ts|tsx|js|jsx|css|html|log|sh)$/.test(lower)) {
      return <FileText size={18} style={{ color: '#fbbf24', flexShrink: 0 }} />;
    }
    return <File size={18} style={{ color: '#94a3b8', flexShrink: 0 }} />;
  };

  const isEmpty = dirs.length === 0 && files.length === 0;

  return (
    <div className="dzb-content">
      {/* Breadcrumb Path Bar */}
      <div className="dzb-breadcrumbs">
        <button
          type="button"
          onClick={() => onNavigateDir('')}
          className="dzb-crumb-btn"
        >
          <FolderOpen size={14} style={{ color: '#fbbf24' }} />
          <span>root</span>
        </button>

        {pathParts.map((part, idx) => {
          const subPath = pathParts.slice(0, idx + 1).join('/') + '/';
          return (
            <React.Fragment key={subPath}>
              <span className="dzb-crumb-sep">
                <ChevronRight size={14} />
              </span>
              <button
                type="button"
                onClick={() => onNavigateDir(subPath)}
                className="dzb-crumb-btn"
              >
                <span>{part}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {isEmpty ? (
        <div className="dzb-empty-box">
          <File size={36} style={{ opacity: 0.3 }} />
          <span>{t('speedtest.zip_empty_search', 'No matching entries found in this archive')}</span>
        </div>
      ) : (
        <>
          {/* Desktop Table View (>= 640px) */}
          <table className="dzb-table-container">
            <thead className="dzb-table-head">
              <tr>
                <th style={{ width: '44px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={onSelectAll}
                    className="dzb-checkbox"
                  />
                </th>
                <th>{t('speedtest.zip_col_name', 'Entry Name')}</th>
                <th style={{ width: '120px', textAlign: 'right' }}>{t('speedtest.zip_col_size', 'Size')}</th>
                <th style={{ width: '130px', textAlign: 'right' }}>{t('speedtest.zip_col_compressed', 'Compressed')}</th>
                <th style={{ width: '110px', textAlign: 'right' }}>{t('speedtest.zip_col_actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {dirs.map((d) => (
                <tr
                  key={d}
                  onClick={() => onNavigateDir(d)}
                  onDoubleClick={() => onNavigateDir(d)}
                  className="dzb-table-row"
                >
                  <td className="dzb-table-cell" style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                  <td className="dzb-table-cell" style={{ fontWeight: 600, color: '#fbbf24' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Folder size={18} style={{ color: '#fbbf24', flexShrink: 0 }} />
                      <span>{entryLabel(d, currentPath)}</span>
                    </div>
                  </td>
                  <td className="dzb-table-cell" style={{ textAlign: 'right', color: '#64748b' }}>—</td>
                  <td className="dzb-table-cell" style={{ textAlign: 'right', color: '#64748b' }}>—</td>
                  <td className="dzb-table-cell" style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateDir(d);
                      }}
                      className="dzb-action-icon-btn"
                      title="Open folder"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}

              {files.map((e) => {
                const isSelected = selectedEntries.has(e.name);
                const compSize = e.compressed_size || e.compressedSize || e.size;
                const ratio = e.size > 0 ? Math.round(((e.size - compSize) / e.size) * 100) : 0;

                return (
                  <tr
                    key={e.name}
                    onClick={() => onToggleSelectEntry(e.name)}
                    onDoubleClick={() => onPreviewCode(e)}
                    className={`dzb-table-row ${isSelected ? 'selected' : ''}`}
                  >
                    <td className="dzb-table-cell" style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelectEntry(e.name)}
                        onClick={(evt) => evt.stopPropagation()}
                        className="dzb-checkbox"
                      />
                    </td>
                    <td className="dzb-table-cell">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '380px', overflow: 'hidden' }}>
                        {getFileIcon(e.name)}
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {entryLabel(e.name, currentPath)}
                        </span>
                      </div>
                    </td>
                    <td className="dzb-table-cell" style={{ textAlign: 'right', color: '#cbd5e1' }}>
                      {formatDriveBytes(e.size)}
                    </td>
                    <td className="dzb-table-cell" style={{ textAlign: 'right', color: '#94a3b8' }}>
                      {formatDriveBytes(compSize)}
                      {ratio > 0 && <span className="dzb-ratio-badge" style={{ marginLeft: '6px' }}>(-{ratio}%)</span>}
                    </td>
                    <td className="dzb-table-cell" style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        <button
                          type="button"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            onPreviewCode(e);
                          }}
                          className="dzb-action-icon-btn"
                          title={t('speedtest.zip_preview_content', 'Preview Content')}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            onExtractEntry(e);
                          }}
                          className="dzb-action-icon-btn"
                          title={t('speedtest.zip_extract_entry', 'Extract Entry')}
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile Card List View (< 640px) */}
          <div className="dzb-mobile-cards">
            {dirs.map((d) => (
              <div
                key={d}
                onClick={() => onNavigateDir(d)}
                className="dzb-card"
              >
                <div className="dzb-card-header">
                  <Folder size={20} style={{ color: '#fbbf24', flexShrink: 0 }} />
                  <span className="dzb-card-title" style={{ color: '#fbbf24', fontWeight: 600 }}>
                    {entryLabel(d, currentPath)}
                  </span>
                  <ChevronRight size={18} style={{ color: '#64748b', flexShrink: 0 }} />
                </div>
              </div>
            ))}

            {files.map((e) => {
              const isSelected = selectedEntries.has(e.name);
              const compSize = e.compressed_size || e.compressedSize || e.size;
              const ratio = e.size > 0 ? Math.round(((e.size - compSize) / e.size) * 100) : 0;

              return (
                <div
                  key={e.name}
                  onClick={() => onToggleSelectEntry(e.name)}
                  className={`dzb-card ${isSelected ? 'selected' : ''}`}
                >
                  <div className="dzb-card-header">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelectEntry(e.name)}
                      onClick={(evt) => evt.stopPropagation()}
                      className="dzb-checkbox"
                    />
                    {getFileIcon(e.name)}
                    <span className="dzb-card-title">{entryLabel(e.name, currentPath)}</span>
                  </div>

                  <div className="dzb-card-details">
                    <span>{formatDriveBytes(e.size)}</span>
                    <div>
                      <span>{formatDriveBytes(compSize)}</span>
                      {ratio > 0 && <span className="dzb-ratio-badge" style={{ marginLeft: '6px' }}>(-{ratio}%)</span>}
                    </div>
                  </div>

                  <div className="dzb-card-actions">
                    <button
                      type="button"
                      onClick={(evt) => {
                        evt.stopPropagation();
                        onPreviewCode(e);
                      }}
                      className="dzb-action-icon-btn"
                      title={t('speedtest.zip_preview_content', 'Preview Content')}
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={(evt) => {
                        evt.stopPropagation();
                        onExtractEntry(e);
                      }}
                      className="dzb-action-icon-btn"
                      title={t('speedtest.zip_extract_entry', 'Extract Entry')}
                    >
                      <Download size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
