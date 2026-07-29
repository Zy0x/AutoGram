import React, { useState } from 'react';
import { X, FolderInput, HardDrive, Folder } from 'lucide-react';
import { DriveFolder } from '../../../lib/driveTypes';

type ZipExtractModalProps = {
  isOpen: boolean;
  selectedCount: number;
  folders: DriveFolder[];
  onClose: () => void;
  onConfirmExtract: (targetFolderId: number | null) => void;
};

export const ZipExtractModal: React.FC<ZipExtractModalProps> = ({
  isOpen,
  selectedCount,
  folders,
  onClose,
  onConfirmExtract,
}) => {
  const [targetFolderId, setTargetFolderId] = useState<number | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn select-none">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FolderInput className="w-4 h-4 text-indigo-400" />
            Extract {selectedCount} Entry(ies) to Drive
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-3">
          Select target Drive folder where extracted files will be saved:
        </p>

        <div className="max-h-56 overflow-y-auto space-y-1 mb-5 p-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium">
          <button
            onClick={() => setTargetFolderId(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
              targetFolderId === null ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <HardDrive className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Saved Messages (Drive Root)</span>
          </button>

          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => setTargetFolderId(f.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                targetFolderId === f.id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Folder className="w-4 h-4 text-amber-400 shrink-0 fill-amber-400/20" />
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirmExtract(targetFolderId)}
            className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all"
          >
            Start Extraction
          </button>
        </div>
      </div>
    </div>
  );
};
