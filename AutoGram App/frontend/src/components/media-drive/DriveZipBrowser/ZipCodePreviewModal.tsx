import React from 'react';
import { X, FileCode, Copy, Check } from 'lucide-react';
import { VSCodeCodeViewer } from '../../common/VSCodeCodeViewer';
import { ZipEntry } from './zipUtils';

type ZipCodePreviewModalProps = {
  entry: ZipEntry | null;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
};

export const ZipCodePreviewModal: React.FC<ZipCodePreviewModalProps> = ({
  entry,
  content,
  isLoading,
  error,
  onClose,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!entry) return null;

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn select-none">
      <div className="w-full max-w-4xl h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 text-xs font-mono text-slate-300">
          <span className="flex items-center gap-2 truncate max-w-md">
            <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="truncate">{entry.name}</span>
          </span>

          <div className="flex items-center gap-2">
            {content && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs transition-all"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs text-slate-200 select-text">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-slate-500 gap-2">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span>Extracting & reading entry...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2">
              <span>{error}</span>
            </div>
          ) : (
            <VSCodeCodeViewer text={content || ''} name={entry.name} />
          )}
        </div>
      </div>
    </div>
  );
};
