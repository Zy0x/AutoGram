import React from 'react';
import { FileText, ExternalLink, Download, RefreshCw } from 'lucide-react';
import { VSCodeCodeViewer } from '../../common/VSCodeCodeViewer';
import { isDesktop } from '../../../lib/tauri/platform';
import { useTranslation } from 'react-i18next';

export interface DocumentViewerProps {
  isText?: boolean;
  textBody?: string | null;
  fileName: string;
  isPdf?: boolean;
  pdfUrl?: string | null;
  pdfFrameRef?: React.RefObject<HTMLIFrameElement | null>;
  onOpenSystem?: () => void;
  onDownload: () => void;
  onRetry: () => void;
  hint?: string | null;
  tooLarge?: boolean;
  openingSystem?: boolean;
  saving?: boolean;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  isText,
  textBody,
  fileName,
  isPdf,
  pdfUrl,
  pdfFrameRef,
  onOpenSystem,
    onDownload,
  onRetry,
  hint,
  tooLarge,
  openingSystem,
  saving,
}) => {
  const { t } = useTranslation();
  if (isText && textBody != null) {
    return (
      <div className="w-full h-full bg-slate-950 overflow-hidden">
        <VSCodeCodeViewer text={textBody} name={fileName} />
      </div>
    );
  }

  if (isPdf && pdfUrl) {
    return (
      <div className="w-full h-full bg-slate-900">
        <iframe
          ref={pdfFrameRef as any}
          src={pdfUrl}
          title={fileName}
          className="w-full h-full border-0"
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-slate-950 text-slate-100 text-center space-y-4">
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-indigo-400">
        <FileText size={48} />
      </div>
      <div>
        <h4 className="font-semibold text-sm text-slate-200">{fileName}</h4>
        <p className="text-xs text-slate-400 max-w-md mt-1">
          {hint ||
            (tooLarge
              ? t('ui.generated.file_besar_gunakan_download_atau_buka_di_aplikas_a379897')
              : t('ui.generated.pratinjau_penuh_tidak_tersedia_di_app_buka_denga_c9dd2b5'))}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-center pt-2">
        {isDesktop() && onOpenSystem && (
          <button
            type="button"
            disabled={openingSystem}
            onClick={onOpenSystem}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5"
          >
            <ExternalLink size={14} /> {t('ui.generated.buka_di_sistem_e955444')}
          </button>
        )}

        <button
          type="button"
          disabled={saving}
          onClick={onDownload}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl transition-all flex items-center gap-1.5"
        >
          <Download size={14} /> {t('ui.generated.unduh_file_a79402d')}
        </button>

        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-xl transition-all flex items-center gap-1.5"
        >
          <RefreshCw size={14} /> {t('drive.btn_retry')}
        </button>
      </div>
    </div>
  );
};
