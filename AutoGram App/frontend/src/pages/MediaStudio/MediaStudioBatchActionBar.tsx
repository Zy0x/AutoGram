import React from 'react';
import { Trash2, Download, CheckSquare, XSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface MediaStudioBatchActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBatchDownload?: () => void;
  onBatchDelete?: () => void;
  isProcessing?: boolean;
}

export const MediaStudioBatchActionBar: React.FC<MediaStudioBatchActionBarProps> = ({
  selectedCount,
  onClearSelection,
  onBatchDownload,
  onBatchDelete,
  isProcessing,
}) => {
  const { t } = useTranslation();
  if (selectedCount <= 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-950/90 border border-indigo-500/40 text-slate-100 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center gap-2 border-r border-slate-800 pr-4">
        <CheckSquare size={16} className="text-indigo-400" />
        <span className="text-xs font-bold text-slate-100 font-mono">{selectedCount} {t('drive.filter_all')}</span>
      </div>

      <div className="flex items-center gap-2">
        {onBatchDownload && (
          <button
            type="button"
            disabled={isProcessing}
            onClick={onBatchDownload}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl transition-all flex items-center gap-1.5"
          >
            <Download size={14} /> {t('drive.download_batch')}
          </button>
        )}

        {onBatchDelete && (
          <button
            type="button"
            disabled={isProcessing}
            onClick={onBatchDelete}
            className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-xs font-semibold text-white rounded-xl transition-all flex items-center gap-1.5"
          >
            <Trash2 size={14} /> {t('drive.delete_batch_confirm')}
          </button>
        )}

        <button
          type="button"
          onClick={onClearSelection}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all ml-1"
          title={t('drive.clear_selection')}
        >
          <XSquare size={16} />
        </button>
      </div>
    </div>
  );
};
