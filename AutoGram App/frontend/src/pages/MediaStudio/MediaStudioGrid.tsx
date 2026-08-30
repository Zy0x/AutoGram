import React from 'react';
import {
  File,
  Folder,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  CheckCircle2,
  HardDrive,
  Download,
  Trash2,
  Edit2,
} from 'lucide-react';
import { DriveFile, DriveFolder, DriveViewMode, formatDriveBytes } from '../../lib/telegram/driveTypes';
import { useTranslation } from 'react-i18next';

type MediaStudioGridProps = {
  folders: DriveFolder[];
  files: DriveFile[];
  viewMode: DriveViewMode;
  isLoading: boolean;
  selectedFileIds: Set<number>;
  onToggleSelectFile: (id: number, e: React.MouseEvent) => void;
  onOpenFolder: (id: number) => void;
  onOpenFilePreview: (file: DriveFile) => void;
  onRenameFile: (file: DriveFile) => void;
  onDeleteFile: (file: DriveFile) => void;
  onDownloadFile: (file: DriveFile) => void;
  isDragOver: boolean;
};

export const MediaStudioGrid: React.FC<MediaStudioGridProps> = ({
  folders,
  files,
  viewMode,
  isLoading,
  selectedFileIds,
  onToggleSelectFile,
  onOpenFolder,
  onOpenFilePreview,
  onRenameFile,
  onDeleteFile,
  onDownloadFile,
  isDragOver,
}) => {
  const { t } = useTranslation();
  const getFileIcon = (file: DriveFile) => {
    const mime = (file.mime_type || '').toLowerCase();
    const name = file.name.toLowerCase();

    if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/.test(name)) {
      return <ImageIcon className="w-8 h-8 text-emerald-400" />;
    }
    if (mime.startsWith('video/') || /\.(mp4|mkv|avi|mov|webm)$/.test(name)) {
      return <Film className="w-8 h-8 text-indigo-400" />;
    }
    if (mime.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg)$/.test(name)) {
      return <Music className="w-8 h-8 text-pink-400" />;
    }
    if (mime.startsWith('text/') || /\.(txt|json|md|rs|ts|js|py)$/.test(name)) {
      return <FileText className="w-8 h-8 text-amber-400" />;
    }
    return <File className="w-8 h-8 text-slate-400" />;
  };

  if (isLoading && files.length === 0 && folders.length === 0) {
    return (
      <div className="flex-1 p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-pulse">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-44 bg-slate-900/60 rounded-2xl border border-slate-800/60" />
        ))}
      </div>
    );
  }

  if (!isLoading && files.length === 0 && folders.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
        <div className="w-20 h-20 mb-4 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 shadow-xl">
          <HardDrive className="w-10 h-10 text-indigo-400/80" />
        </div>
        <h3 className="text-base font-semibold text-slate-200 mb-1">{t('ui.generated.no_media_files_found_7ddaa3b')}</h3>
        <p className="text-xs text-slate-400 max-w-sm">
          {t('ui.generated.this_drive_location_is_empty_drag_drop_files_her_2ae585b')}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 relative ${isDragOver ? 'bg-indigo-950/20' : ''}`}>
      {isDragOver && (
        <div className="absolute inset-0 z-40 bg-indigo-950/70 backdrop-blur-sm border-2 border-dashed border-indigo-500 rounded-2xl flex flex-col items-center justify-center text-indigo-300 animate-fadeIn pointer-events-none">
          <HardDrive className="w-16 h-16 animate-bounce mb-3" />
          <span className="text-base font-semibold">{t('drive.drop_to_upload')}</span>
        </div>
      )}

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {folders.map((f) => (
            <div
              key={`folder-${f.id}`}
              onDoubleClick={() => onOpenFolder(f.id)}
              className="group relative flex flex-col justify-between p-3.5 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-700 rounded-2xl cursor-pointer transition-all shadow-md select-none"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-950/40 border border-amber-800/30 flex items-center justify-center text-amber-400">
                  <Folder className="w-5 h-5 fill-amber-400/20" />
                </div>
              </div>
              <div className="min-w-0">
                <h4 className="font-semibold text-xs text-slate-200 truncate" title={f.name}>
                  {f.name}
                </h4>
                <span className="text-[10px] text-slate-400 font-mono">{t('drive.folder_label')}</span>
              </div>
            </div>
          ))}

          {files.map((file) => {
            const isSelected = selectedFileIds.has(file.id);
            const thumb = file.thumb_data_url || file.thumbDataUrl;
            return (
              <div
                key={`file-${file.id}`}
                onClick={(e) => onToggleSelectFile(file.id, e)}
                onDoubleClick={() => onOpenFilePreview(file)}
                className={`group relative flex flex-col justify-between p-3.5 rounded-2xl border cursor-pointer transition-all shadow-md select-none ${
                  isSelected
                    ? 'bg-indigo-950/60 border-indigo-500 shadow-indigo-600/10'
                    : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-800 hover:border-slate-700'
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelectFile(file.id, e);
                  }}
                  className={`absolute top-2.5 right-2.5 z-10 p-1 rounded-lg transition-all ${
                    isSelected ? 'text-indigo-400' : 'text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 fill-current" />
                </button>

                <div className="w-full h-24 mb-2 rounded-xl bg-slate-950/60 border border-slate-800/60 flex items-center justify-center overflow-hidden">
                  {thumb ? (
                    <img src={thumb} alt={file.name} className="w-full h-full object-cover" />
                  ) : (
                    getFileIcon(file)
                  )}
                </div>

                <div className="min-w-0">
                  <h4 className="font-medium text-xs text-slate-200 truncate" title={file.name}>
                    {file.name}
                  </h4>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">{formatDriveBytes(file.size)}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl select-none">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-950/50">
                <th className="py-3 px-4 w-10 text-center">#</th>
                <th className="py-3 px-4">{t('drive.col_name')}</th>
                <th className="py-3 px-4 w-32">{t('drive.media_size')}</th>
                <th className="py-3 px-4 w-36">{t('settings.proxy_type_label')}</th>
                <th className="py-3 px-4 w-28 text-right">{t('automation.col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {folders.map((f) => (
                <tr
                  key={`folder-row-${f.id}`}
                  onDoubleClick={() => onOpenFolder(f.id)}
                  className="hover:bg-slate-800/60 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-4 text-center">
                    <Folder className="w-4 h-4 text-amber-400 mx-auto" />
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-200 truncate max-w-xs">{f.name}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-400">—</td>
                  <td className="py-2.5 px-4 text-slate-400">{t('drive.folder_label')}</td>
                  <td className="py-2.5 px-4 text-right" />
                </tr>
              ))}

              {files.map((file) => {
                const isSelected = selectedFileIds.has(file.id);
                return (
                  <tr
                    key={`file-row-${file.id}`}
                    onClick={(e) => onToggleSelectFile(file.id, e)}
                    onDoubleClick={() => onOpenFilePreview(file)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-indigo-950/40 text-indigo-200' : 'hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <td className="py-2.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                      />
                    </td>
                    <td className="py-2.5 px-4 font-medium truncate max-w-xs">{file.name}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-400">{formatDriveBytes(file.size)}</td>
                    <td className="py-2.5 px-4 text-slate-400 truncate max-w-[100px]">{file.mime_type || t('ui.generated.file_2c3cafa')}</td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDownloadFile(file);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-200 rounded"
                          title={t('drive.label_download')}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRenameFile(file);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-200 rounded"
                          title={t('drive.ctx_menu_rename')}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteFile(file);
                          }}
                          className="p-1 text-slate-400 hover:text-red-400 rounded"
                          title={t('drive.preview_delete_btn')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
