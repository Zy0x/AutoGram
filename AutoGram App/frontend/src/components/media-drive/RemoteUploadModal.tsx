import React, { useState } from 'react';
import { X, Globe, ChevronDown, Loader2 } from 'lucide-react';

export interface DriveFolderOption {
  id: number;
  name: string;
}

interface RemoteUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  folders: DriveFolderOption[];
  onUpload: (url: string, folderId: number | null) => Promise<void>;
}

export function RemoteUploadModal({ isOpen, onClose, folders, onUpload }: RemoteUploadModalProps) {
  const [url, setUrl] = useState('');
  const [folderId, setFolderId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    
    if (!url.trim()) {
      setErrorMsg('Silakan masukkan URL file.');
      return;
    }
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setErrorMsg('URL harus diawali dengan http:// atau https://');
      return;
    }
    
    setSubmitting(true);
    try {
      await onUpload(url.trim(), folderId);
      setUrl('');
      setFolderId(null);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal melakukan remote upload.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-all duration-150 animate-in fade-in"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="w-[450px] overflow-hidden rounded-xl border border-[var(--border-color,rgba(255,255,255,0.08))] bg-[var(--bg-panel,#171821)] text-[var(--text-normal,#e2e8f0)] shadow-2xl transition-all duration-150 animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color,rgba(255,255,255,0.08))] p-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--primary,#e2a532)]">
            <Globe className="h-5 h-5" />
            Remote Upload (URL)
          </h3>
          <button 
            type="button" 
            onClick={onClose} 
            className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
              {errorMsg}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400">URL File</label>
            <input
              type="text"
              placeholder="https://example.com/movie.mp4"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-[var(--border-color,rgba(255,255,255,0.08))] bg-black/20 px-3 py-2 text-sm outline-none focus:border-[var(--primary,#e2a532)]/50 transition-colors"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400">Folder / Channel Tujuan</label>
            <div className="relative">
              <select
                value={folderId === null ? '' : folderId}
                onChange={(e) => setFolderId(e.target.value === '' ? null : Number(e.target.value))}
                disabled={submitting}
                className="w-full appearance-none rounded-lg border border-[var(--border-color,rgba(255,255,255,0.08))] bg-black/20 pl-3 pr-10 py-2 text-sm outline-none cursor-pointer focus:border-[var(--primary,#e2a532)]/50 transition"
              >
                <option value="">Pesan Tersimpan (Saved Messages)</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end border-t border-[var(--border-color,rgba(255,255,255,0.08))] bg-white/[0.02] p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-[var(--border-color,rgba(255,255,255,0.08))] hover:bg-white/5 px-4 py-2 text-sm font-semibold transition"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 rounded-lg bg-[var(--primary,#e2a532)] hover:bg-[var(--primary,#e2a532)]/90 px-4 py-2 text-sm font-semibold text-black transition disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Mengunggah...
              </>
            ) : (
              'Mulai Unggah'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
