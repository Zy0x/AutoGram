import React from 'react';
import {
  Folder,
  File,
  FileText,
  Image as ImageIcon,
  Film,
  ChevronRight,
  Eye,
  Download,
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
  const pathParts = currentPath.split('/').filter(Boolean);

  const getFileIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|svg)$/.test(lower)) {
      return <ImageIcon className="w-4 h-4 text-emerald-400" />;
    }
    if (/\.(mp4|mkv|avi|mov|webm|mp3|flac|wav)$/.test(lower)) {
      return <Film className="w-4 h-4 text-indigo-400" />;
    }
    if (/\.(txt|json|md|py|rs|ts|tsx|js|jsx|css|html|log|sh)$/.test(lower)) {
      return <FileText className="w-4 h-4 text-amber-400" />;
    }
    return <File className="w-4 h-4 text-slate-400" />;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 text-slate-200 select-none">
      <div className="flex items-center gap-1 px-4 py-2 bg-slate-900/60 border-b border-slate-800/80 text-xs font-mono text-slate-400 overflow-x-auto">
        <button
          onClick={() => onNavigateDir('')}
          className="hover:text-indigo-400 transition-colors"
        >
          root
        </button>
        {pathParts.map((part, idx) => {
          const subPath = pathParts.slice(0, idx + 1).join('/') + '/';
          return (
            <React.Fragment key={subPath}>
              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
              <button
                onClick={() => onNavigateDir(subPath)}
                className="hover:text-indigo-400 transition-colors truncate max-w-[120px]"
              >
                {part}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-900/40 sticky top-0 backdrop-blur-md">
              <th className="py-2.5 px-4 w-10 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={onSelectAll}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                />
              </th>
              <th className="py-2.5 px-4">Entry Name</th>
              <th className="py-2.5 px-4 w-28 text-right">Size</th>
              <th className="py-2.5 px-4 w-28 text-right">Compressed</th>
              <th className="py-2.5 px-4 w-24 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 text-xs font-mono">
            {dirs.map((d: any) => (
              <tr
                key={d}
                onDoubleClick={() => onNavigateDir(d)}
                className="hover:bg-slate-900/60 cursor-pointer transition-colors"
              >
                <td className="py-2 px-4 text-center text-slate-600">—</td>
                <td className="py-2 px-4 font-sans font-medium text-amber-300 flex items-center gap-2 truncate">
                  <Folder className="w-4 h-4 text-amber-400 shrink-0 fill-amber-400/20" />
                  <span>{entryLabel(d, currentPath)}</span>
                </td>
                <td className="py-2 px-4 text-right text-slate-500">—</td>
                <td className="py-2 px-4 text-right text-slate-500">—</td>
                <td className="py-2 px-4 text-right" />
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
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-950/40 text-indigo-200' : 'hover:bg-slate-900/60 text-slate-300'
                  }`}
                >
                  <td className="py-2 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                    />
                  </td>
                  <td className="py-2 px-4 font-sans font-medium flex items-center gap-2 truncate max-w-sm">
                    {getFileIcon(e.name)}
                    <span className="truncate">{entryLabel(e.name, currentPath)}</span>
                  </td>
                  <td className="py-2 px-4 text-right text-slate-300">{formatDriveBytes(e.size)}</td>
                  <td className="py-2 px-4 text-right text-slate-400">
                    {formatDriveBytes(compSize)}
                    {ratio > 0 && <span className="text-[10px] text-emerald-400 ml-1">(-{ratio}%)</span>}
                  </td>
                  <td className="py-2 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(evt) => {
                          evt.stopPropagation();
                          onPreviewCode(e);
                        }}
                        className="p-1 text-slate-400 hover:text-indigo-400 rounded transition-colors"
                        title="Preview Content"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(evt) => {
                          evt.stopPropagation();
                          onExtractEntry(e);
                        }}
                        className="p-1 text-slate-400 hover:text-emerald-400 rounded transition-colors"
                        title="Extract Entry"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
