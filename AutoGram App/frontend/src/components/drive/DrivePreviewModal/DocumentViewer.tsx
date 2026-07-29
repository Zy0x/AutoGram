import React, { useState, useEffect } from 'react';
import { FileText, FileCode, AlertCircle, Download, ExternalLink } from 'lucide-react';
import { DriveFile } from '../../../lib/driveTypes';
import { DriveCredentials } from '../../../lib/driveApi';
import { DriveZipBrowser } from '../DriveZipBrowser';

type DocumentViewerProps = {
  file: DriveFile;
  kind: 'text' | 'pdf' | 'zip' | 'other';
  src: string;
  creds: DriveCredentials;
  folderId: number | null;
  onDownload: () => void;
  onOpenSystem: () => void;
};

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  file,
  kind,
  src,
  creds,
  folderId,
  onDownload,
  onOpenSystem,
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'text' || !src) return;
    setIsLoadingText(true);
    setTextError(null);

    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.text();
      })
      .then((txt) => {
        setTextContent(txt);
        setIsLoadingText(false);
      })
      .catch((err) => {
        setTextError(err.message || 'Failed to load text content');
        setIsLoadingText(false);
      });
  }, [kind, src]);

  if (kind === 'pdf') {
    return (
      <div className="w-full h-full p-2 sm:p-4">
        <iframe
          src={`${src}#toolbar=0&navpanes=0`}
          title={file.name}
          className="w-full h-full rounded-xl border border-slate-800 bg-slate-950 shadow-2xl"
        />
      </div>
    );
  }

  if (kind === 'zip') {
    return (
      <div className="w-full h-full p-2 sm:p-4 max-w-4xl mx-auto overflow-hidden">
        <div className="w-full h-full bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
          <DriveZipBrowser creds={creds} messageId={file.id} folderId={folderId} archiveName={file.name} />
        </div>
      </div>
    );
  }

  if (kind === 'text') {
    return (
      <div className="w-full max-w-4xl mx-auto h-[80vh] flex flex-col p-4">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border border-slate-800 border-b-0 rounded-t-xl text-xs font-mono text-slate-400">
          <span className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-indigo-400" />
            {file.name}
          </span>
          <span>{textContent ? `${textContent.split('\n').length} lines` : ''}</span>
        </div>
        <div className="flex-1 bg-slate-950 border border-slate-800 rounded-b-xl overflow-auto p-4 font-mono text-xs text-slate-200 leading-relaxed select-text">
          {isLoadingText ? (
            <div className="flex items-center justify-center h-full text-slate-500 gap-2">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span>Loading document...</span>
            </div>
          ) : textError ? (
            <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2">
              <AlertCircle className="w-6 h-6" />
              <span>{textError}</span>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words">{textContent}</pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto p-8 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md text-center text-slate-100 flex flex-col items-center">
      <div className="w-20 h-20 mb-6 rounded-2xl bg-indigo-950/40 border border-indigo-800/40 flex items-center justify-center text-indigo-400">
        <FileText className="w-10 h-10" />
      </div>
      <h3 className="font-semibold text-lg text-slate-100 mb-2 truncate max-w-full" title={file.name}>
        {file.name}
      </h3>
      <p className="text-xs text-slate-400 mb-6">
        Preview is not available for this file format ({file.mime_type || 'unknown'}). You can open it in an external application or save it locally.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSystem}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition-all"
        >
          <ExternalLink className="w-4 h-4 text-emerald-400" />
          <span>Open External</span>
        </button>
        <button
          onClick={onDownload}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-lg shadow-indigo-600/30 transition-all"
        >
          <Download className="w-4 h-4" />
          <span>Save File</span>
        </button>
      </div>
    </div>
  );
};
