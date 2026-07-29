import React, { useState } from 'react';
import { FolderPlus, Trash2, Edit3, FolderInput, X } from 'lucide-react';
import { DriveFolder, DriveFile } from '../../lib/driveTypes';

type SpeedTestModalsProps = {
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

export const SpeedTestModals: React.FC<SpeedTestModalsProps> = ({
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
  const [folderName, setFolderName] = useState('');
  const [newName, setNewName] = useState(renameTargetFile?.name || '');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);

  return (
    <>
      {/* 1. New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-indigo-400" />
                Create New Folder
              </h3>
              <button onClick={onCloseNewFolderModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 mb-4 focus:outline-none focus:border-indigo-500 font-mono"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCloseNewFolderModal}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
              >
                Cancel
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
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Rename File Modal */}
      {renameTargetFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-amber-400" />
                Rename File
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
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newName.trim()) {
                    onConfirmRename(renameTargetFile.id, newName.trim());
                  }
                }}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Delete Confirmation Modal */}
      {deleteTargetFiles.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-red-400">
                <Trash2 className="w-4 h-4" />
                Confirm Batch Delete
              </h3>
              <button onClick={onCloseDeleteModal} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 mb-4">
              Are you sure you want to permanently delete {deleteTargetFiles.length} item(s) from Telegram Drive? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCloseDeleteModal}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirmDelete(deleteTargetFiles)}
                className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white shadow-lg shadow-red-600/30 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Move Target Folder Selector Modal */}
      {moveTargetFiles.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-indigo-400" />
                Move to Folder
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
                Saved Messages (Root)
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
                Cancel
              </button>
              <button
                onClick={() => onConfirmMove(moveTargetFiles, selectedFolderId)}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all"
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
