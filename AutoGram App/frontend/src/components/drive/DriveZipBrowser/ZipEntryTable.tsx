import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ChevronRight, Download, Eye, File, FileText, Film, Folder, FolderOpen, Image as ImageIcon, LockKeyhole } from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { entryLabel, isZipArchiveName, type ZipEntry } from './zipUtils';

type Props = {
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
  onExtractDirectory: (path: string) => void;
};

function EntryIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (isZipArchiveName(lower)) return <Archive size={18} className="dzb-file-icon archive" />;
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|heic|heif)$/.test(lower)) return <ImageIcon size={18} className="dzb-file-icon image" />;
  if (/\.(mp4|mkv|avi|mov|webm|m4v|mp3|m4a|aac|flac|wav|opus|ogg)$/.test(lower)) return <Film size={18} className="dzb-file-icon media" />;
  if (/\.(txt|json|md|mdx|py|rs|ts|tsx|js|jsx|css|html|log|sh|csv|xml|ya?ml|toml|ini|sql|pdf)$/.test(lower)) return <FileText size={18} className="dzb-file-icon document" />;
  return <File size={18} className="dzb-file-icon generic" />;
}

export function ZipEntryTable({
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
  onExtractDirectory,
}: Props) {
  const { t } = useTranslation();
  const pathParts = currentPath.split('/').filter(Boolean);
  const empty = dirs.length === 0 && files.length === 0;

  return (
    <div className="dzb-content">
      <nav className="dzb-breadcrumbs" aria-label={t('speedtest.zip_breadcrumbs')}>
        <button type="button" onClick={() => onNavigateDir('')} className="dzb-crumb-btn">
          <FolderOpen size={14} /> <span>{t('speedtest.zip_root')}</span>
        </button>
        {pathParts.map((part, index) => {
          const subPath = `${pathParts.slice(0, index + 1).join('/')}/`;
          return (
            <Fragment key={subPath}>
              <ChevronRight size={14} className="dzb-crumb-sep" />
              <button type="button" onClick={() => onNavigateDir(subPath)} className="dzb-crumb-btn">{part}</button>
            </Fragment>
          );
        })}
      </nav>

      {empty ? (
        <div className="dzb-empty-box"><File size={36} /><span>{t('speedtest.zip_empty_search')}</span></div>
      ) : (
        <>
          <table className="dzb-table-container">
            <thead className="dzb-table-head">
              <tr>
                <th className="dzb-col-check"><input type="checkbox" checked={isAllSelected} onChange={onSelectAll} className="dzb-checkbox" aria-label={t('speedtest.zip_select_all')} /></th>
                <th>{t('speedtest.zip_col_name')}</th>
                <th className="dzb-col-size">{t('speedtest.zip_col_size')}</th>
                <th className="dzb-col-compressed">{t('speedtest.zip_col_compressed')}</th>
                <th className="dzb-col-actions">{t('speedtest.zip_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {dirs.map((directory) => {
                const label = entryLabel(directory, currentPath);
                return (
                  <tr key={directory} className={`dzb-table-row ${selectedEntries.has(directory) ? 'selected' : ''}`} onDoubleClick={() => onNavigateDir(directory)}>
                    <td className="dzb-table-cell dzb-col-check"><input type="checkbox" checked={selectedEntries.has(directory)} onChange={() => onToggleSelectEntry(directory)} className="dzb-checkbox" aria-label={t('speedtest.zip_select_directory', { name: label })} /></td>
                    <td className="dzb-table-cell"><button type="button" className="dzb-entry-name directory" onClick={() => onNavigateDir(directory)}><Folder size={18} /><span>{label}</span></button></td>
                    <td className="dzb-table-cell dzb-col-size">—</td>
                    <td className="dzb-table-cell dzb-col-compressed">—</td>
                    <td className="dzb-table-cell dzb-col-actions"><div className="dzb-row-actions"><button type="button" onClick={() => onExtractDirectory(directory)} className="dzb-action-icon-btn" title={t('speedtest.zip_extract_directory')}><Download size={16} /></button><button type="button" onClick={() => onNavigateDir(directory)} className="dzb-action-icon-btn" title={t('speedtest.zip_open_folder')}><ChevronRight size={16} /></button></div></td>
                  </tr>
                );
              })}
              {files.map((entry) => {
                const selected = selectedEntries.has(entry.name);
                const compressed = entry.compressed_size ?? entry.compressedSize ?? entry.size;
                const ratio = entry.size > 0 ? Math.max(0, Math.round(((entry.size - compressed) / entry.size) * 100)) : 0;
                return (
                  <tr key={entry.name} className={`dzb-table-row ${selected ? 'selected' : ''}`} onClick={() => onToggleSelectEntry(entry.name)} onDoubleClick={() => onPreviewCode(entry)}>
                    <td className="dzb-table-cell dzb-col-check"><input type="checkbox" checked={selected} onChange={() => onToggleSelectEntry(entry.name)} onClick={(event) => event.stopPropagation()} className="dzb-checkbox" aria-label={t('speedtest.zip_select_entry', { name: entry.name })} /></td>
                    <td className="dzb-table-cell"><div className="dzb-entry-name"><EntryIcon name={entry.name} />{entry.encrypted && <LockKeyhole size={13} className="dzb-entry-lock" aria-label={t('speedtest.zip_protected')} />}<span title={entry.name}>{entryLabel(entry.name, currentPath)}</span></div></td>
                    <td className="dzb-table-cell dzb-col-size">{formatDriveBytes(entry.size)}</td>
                    <td className="dzb-table-cell dzb-col-compressed">{formatDriveBytes(compressed)}{ratio > 0 && <span className="dzb-ratio-badge">−{ratio}%</span>}</td>
                    <td className="dzb-table-cell dzb-col-actions"><div className="dzb-row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onPreviewCode(entry); }} className="dzb-action-icon-btn" title={isZipArchiveName(entry.name) ? t('speedtest.zip_open_nested') : t('speedtest.zip_preview_content')}>{isZipArchiveName(entry.name) ? <Archive size={16} /> : <Eye size={16} />}</button><button type="button" onClick={(event) => { event.stopPropagation(); onExtractEntry(entry); }} className="dzb-action-icon-btn" title={t('speedtest.zip_extract_entry')}><Download size={16} /></button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="dzb-mobile-cards">
            {dirs.map((directory) => {
              const label = entryLabel(directory, currentPath);
              return <article key={directory} className={`dzb-card ${selectedEntries.has(directory) ? 'selected' : ''}`}><div className="dzb-card-header"><input type="checkbox" checked={selectedEntries.has(directory)} onChange={() => onToggleSelectEntry(directory)} className="dzb-checkbox" aria-label={t('speedtest.zip_select_directory', { name: label })} /><button type="button" className="dzb-entry-name directory" onClick={() => onNavigateDir(directory)}><Folder size={20} /><span>{label}</span></button></div><div className="dzb-card-actions"><button type="button" onClick={() => onExtractDirectory(directory)} className="dzb-action-icon-btn" title={t('speedtest.zip_extract_directory')}><Download size={18} /></button><button type="button" onClick={() => onNavigateDir(directory)} className="dzb-action-icon-btn" title={t('speedtest.zip_open_folder')}><ChevronRight size={18} /></button></div></article>;
            })}
            {files.map((entry) => {
              const compressed = entry.compressed_size ?? entry.compressedSize ?? entry.size;
              return <article key={entry.name} className={`dzb-card ${selectedEntries.has(entry.name) ? 'selected' : ''}`}><div className="dzb-card-header"><input type="checkbox" checked={selectedEntries.has(entry.name)} onChange={() => onToggleSelectEntry(entry.name)} className="dzb-checkbox" aria-label={t('speedtest.zip_select_entry', { name: entry.name })} /><EntryIcon name={entry.name} />{entry.encrypted && <LockKeyhole size={13} className="dzb-entry-lock" />}<span className="dzb-card-title">{entryLabel(entry.name, currentPath)}</span></div><div className="dzb-card-details"><span>{formatDriveBytes(entry.size)}</span><span>{formatDriveBytes(compressed)}</span></div><div className="dzb-card-actions"><button type="button" onClick={() => onPreviewCode(entry)} className="dzb-action-icon-btn" title={isZipArchiveName(entry.name) ? t('speedtest.zip_open_nested') : t('speedtest.zip_preview_content')}>{isZipArchiveName(entry.name) ? <Archive size={18} /> : <Eye size={18} />}</button><button type="button" onClick={() => onExtractEntry(entry)} className="dzb-action-icon-btn" title={t('speedtest.zip_extract_entry')}><Download size={18} /></button></div></article>;
            })}
          </div>
        </>
      )}
    </div>
  );
}
