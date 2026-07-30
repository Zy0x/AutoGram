import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link2, X, Loader2 } from 'lucide-react';

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
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [folderId, setFolderId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Reset fields only when modal is opened
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setFolderId(null);
      setErrorMsg('');
    }
  }, [isOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    
    const targetUrl = url.trim();
    if (!targetUrl) {
      setErrorMsg('Silakan masukkan URL file.');
      return;
    }
    
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      setErrorMsg('URL harus diawali dengan http:// atau https://');
      return;
    }
    
    setSubmitting(true);
    try {
      // Verifikasi URL via FastAPI lokal
      const verifyRes = await fetch(`http://127.0.0.1:8550/api/v1/verify-url?url=${encodeURIComponent(targetUrl)}`);
      if (!verifyRes.ok) {
        throw new Error(`Gagal menghubungi server verifikasi (HTTP ${verifyRes.status})`);
      }
      const data = await verifyRes.json() as { valid: boolean; error?: string; filename?: string; size?: number };
      if (!data.valid) {
        throw new Error(data.error || 'URL tidak valid atau tidak merujuk ke file media langsung.');
      }

      await onUpload(targetUrl, folderId);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal melakukan remote upload.');
    } finally {
      setSubmitting(false);
    }
  };

  const node = (
    <div className="td-confirm-overlay" role="presentation" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="td-confirm-panel input-dialog td-dialog-kind-rename"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="td-confirm-head">
          <span className="td-confirm-icon input" aria-hidden>
            <Link2 size={20} strokeWidth={2} />
          </span>
          <div className="td-confirm-head-text">
            <h2>Remote Upload (URL)</h2>
            <p className="td-confirm-desc">Unggah file langsung dari URL publik ke Telegram Cloud</p>
          </div>
          <button 
            type="button" 
            className="td-confirm-close" 
            onClick={onClose} 
            disabled={submitting}
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </header>

        <div className="td-input-body">
          {errorMsg && (
            <p className="td-input-error" role="alert" style={{ marginBottom: '4px' }}>
              {errorMsg}
            </p>
          )}

          <label className="td-input-label" htmlFor="td-remote-url">
            URL File Sumber
          </label>
          <input
            id="td-remote-url"
            className="td-input-field"
            type="text"
            placeholder="https://example.com/file.zip"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (errorMsg) setErrorMsg('');
            }}
            disabled={submitting}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />

          <label className="td-input-label" htmlFor="td-remote-folder" style={{ marginTop: '6px' }}>
            Folder / Channel Tujuan
          </label>
          <select
            id="td-remote-folder"
            className="td-input-field"
            value={folderId === null ? '' : folderId}
            onChange={(e) => setFolderId(e.target.value === '' ? null : Number(e.target.value))}
            disabled={submitting}
            style={{ cursor: 'pointer', appearance: 'auto' }}
          >
            <option value="">Pesan Tersimpan (Saved Messages)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>

        <footer className="td-confirm-foot">
          <button 
            type="button" 
            className="td-confirm-btn ghost" 
            onClick={onClose} 
            disabled={submitting}
          >
            Batal
          </button>
          <button
            type="submit"
            className="td-confirm-btn primary"
            disabled={submitting || !url.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Mengunggah...</span>
              </>
            ) : (
              <>
                <Link2 size={15} strokeWidth={2.25} />
                <span>{t('speedtest.start_upload')}</span>
              </>
            )}
          </button>
        </footer>
      </form>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
