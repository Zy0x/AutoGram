import i18n from 'i18next';
import React, { useState } from 'react';
import { FolderPlus, Trash2, Edit3, FolderInput, X } from 'lucide-react';
import { DriveFolder, DriveFile } from '../../lib/telegram/driveTypes';
import { useTranslation } from 'react-i18next';

type MediaStudioModalsProps = {
  // New Folder Modal
  showNewFolderModal: boolean;
  onCloseNewFolderModal: () => void;
  onCreateFolder: (name: string) => void;

  // Rename File Modal
  renameTargetFile: DriveFile | null;
  onCloseRenameModal: () => void;
  onConfirmRename: (fileId: number, newName: string) => void;

  // Delete Confirm Modal
  deleteTargetFiles: DriveFile[];
  onCloseDeleteModal: () => void;
  onConfirmDelete: (files: DriveFile[]) => void;

  // Move Target Folder Picker Modal
  moveTargetFiles: DriveFile[];
  folders: DriveFolder[];
  onCloseMoveModal: () => void;
  onConfirmMove: (files: DriveFile[], targetFolderId: number | null) => void;
};

export const MediaStudioModals: React.FC<MediaStudioModalsProps> = ({
  showNewFolderModal,
  onCloseNewFolderModal,
  onCreateFolder,
  renameTargetFile,
  onCloseRenameModal,
  onConfirmRename,
  deleteTargetFiles,
  onCloseDeleteModal,
  onConfirmDelete,
  moveTargetFiles,
  folders,
  onCloseMoveModal,
  onConfirmMove,
}) => {
  const { t } = useTranslation();
  const [folderName, setFolderName] = useState('');
  const [newName, setNewName] = useState(renameTargetFile?.name || '');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);

  return (
    <>
      {/* 1. New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-indigo-400" />
                {t('ui.generated.create_new_folder_a0d80fa')}
              </h3>
              <button onClick={onCloseNewFolderModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder={i18n.t("drive.ph_folder_name")}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 mb-4 focus:outline-none focus:border-indigo-500 font-mono"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCloseNewFolderModal}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
              >
                {t('accounts.cancel')}
              </button>
              <button
                onClick={() => {
                  if (folderName.trim()) {
                    onCreateFolder(folderName.trim());
                    setFolderName('');
                  }
                }}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all"
              >
                {t('ui.generated.create_6e157c5')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Rename File Modal */}
      {renameTargetFile && (
        <div className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-amber-400" />
                {t('ui.generated.rename_file_46c3b1d')}
              </h3>
              <button onClick={onCloseRenameModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              defaultValue={renameTargetFile.name}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 mb-4 focus:outline-none focus:border-indigo-500 font-mono"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCloseRenameModal}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
              >
                {t('accounts.cancel')}
              </button>
              <button
                onClick={() => {
                  if (newName.trim()) {
                    onConfirmRename(renameTargetFile.id, newName.trim());
                  }
                }}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all"
              >
                {t('drive.ctx_menu_rename')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Delete Confirmation Modal */}
      {deleteTargetFiles.length > 0 && (
        <div className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-red-400">
                <Trash2 className="w-4 h-4" />
                {t('ui.generated.confirm_batch_delete_629c87e')}
              </h3>
              <button onClick={onCloseDeleteModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 mb-4">
              {t('ui.generated.are_you_sure_you_want_to_permanently_delete_a4fae6b')} {deleteTargetFiles.length} {t('ui.generated.item_s_from_telegram_drive_this_action_cannot_be_8b71e9b')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCloseDeleteModal}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
              >
                {t('accounts.cancel')}
              </button>
              <button
                onClick={() => onConfirmDelete(deleteTargetFiles)}
                className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white shadow-lg shadow-red-600/30 transition-all"
              >
                {t('drive.preview_delete_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Move Target Folder Selector Modal */}
      {moveTargetFiles.length > 0 && (
        <div className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-indigo-400" />
                {t('ui.generated.move_to_folder_250ae30')}
              </h3>
              <button onClick={onCloseMoveModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 mb-4 p-2 bg-slate-950 border border-slate-800 rounded-xl">
              <button
                onClick={() => setSelectedFolderId(null)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedFolderId === null ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {t('ui.generated.saved_messages_root_2532e61')}
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFolderId(f.id)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedFolderId === f.id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCloseMoveModal}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
              >
                {t('accounts.cancel')}
              </button>
              <button
                onClick={() => onConfirmMove(moveTargetFiles, selectedFolderId)}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all"
              >
                {t('drive.topbar_move')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
