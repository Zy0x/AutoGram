import React, { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { Loader2, FileText, ZoomIn, ZoomOut, RotateCcw, Copy, Check } from 'lucide-react';

interface Props {
  data: ArrayBuffer | Uint8Array | Blob | string;
  fileName: string;
  onOpenSystem?: () => void;
}

export const DocxViewer: React.FC<Props> = ({ data, fileName, onOpenSystem }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAndRender() {
      setLoading(true);
      setError(null);

      try {
        let buffer: ArrayBuffer;
        if (typeof data === 'string') {
          if (data.startsWith('data:') || data.startsWith('http')) {
            const res = await fetch(data);
            buffer = await res.arrayBuffer();
          } else {
            try {
              const { readFile } = await import('@tauri-apps/plugin-fs');
              const bytes = await readFile(data);
              buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            } catch {
              const res = await fetch(data);
              buffer = await res.arrayBuffer();
            }
          }
        } else if (data instanceof Blob) {
          buffer = await data.arrayBuffer();
        } else if (data instanceof Uint8Array) {
          buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        } else {
          buffer = data;
        }

        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';

        await renderAsync(buffer, containerRef.current, undefined, {
          className: 'autogram-docx-page',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          experimental: true,
          useBase64URL: true,
        });

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[DocxViewer] Render failed:', err);
          setError(err?.message || 'Gagal merender dokumen DOCX');
          setLoading(false);
        }
      }
    }

    void loadAndRender();

    return () => {
      cancelled = true;
    };
  }, [data]);

  const handleCopyText = () => {
    if (!containerRef.current) return;
    const text = containerRef.current.innerText || '';
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="autogram-docx-viewer-wrap" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0b0f19', color: '#f8fafc', overflow: 'hidden' }}>
      <div
        className="autogram-docx-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={16} className="text-blue-400" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
            {fileName}
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
              fontWeight: 600,
            }}
          >
            DOCX
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
            title="Perkecil (Zoom Out)"
            style={{ padding: '4px 8px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1', cursor: 'pointer' }}
          >
            <ZoomOut size={13} />
          </button>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', minWidth: '40px', textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={() => setZoom((z) => Math.min(2.0, Math.round((z + 0.1) * 10) / 10))}
            title="Perbesar (Zoom In)"
            style={{ padding: '4px 8px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1', cursor: 'pointer' }}
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={() => setZoom(1)}
            title="Reset Zoom 100%"
            style={{ padding: '4px 8px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1', cursor: 'pointer' }}
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={handleCopyText}
            title="Salin Seluruh Teks"
            style={{ padding: '4px 10px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#93c5fd', cursor: 'pointer', fontWeight: 600 }}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? 'Tersalin' : 'Salin Teks'}</span>
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px',
          background: '#090d16',
        }}
      >
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: 'auto', gap: '12px', color: '#94a3b8' }}>
            <Loader2 size={32} className="spin text-blue-400" />
            <span style={{ fontSize: '13px', fontWeight: 500 }}>Merender dokumen Word (.docx)...</span>
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: 'auto', gap: '12px', color: '#f87171', maxWidth: '400px', textAlign: 'center' }}>
            <FileText size={36} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Gagal Membaca Dokumen DOCX</span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>{error}</span>
            {onOpenSystem && (
              <button
                type="button"
                onClick={onOpenSystem}
                style={{ marginTop: '8px', padding: '6px 14px', borderRadius: '8px', background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
              >
                Buka di Microsoft Word
              </button>
            )}
          </div>
        )}

        <div
          ref={containerRef}
          className="autogram-docx-container"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease',
            display: loading || error ? 'none' : 'block',
            maxWidth: '100%',
          }}
        />
      </div>

      <style>{`
        .autogram-docx-container {
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
          border-radius: 8px;
        }
        .autogram-docx-page {
          background: #ffffff !important;
          color: #0f172a !important;
          margin-bottom: 24px !important;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
          border-radius: 4px !important;
          padding: 48px !important;
          box-sizing: border-box !important;
        }
        .autogram-docx-page p {
          margin-bottom: 0.8em !important;
          line-height: 1.6 !important;
        }
        .autogram-docx-page table {
          border-collapse: collapse !important;
          width: 100% !important;
          margin: 16px 0 !important;
        }
        .autogram-docx-page td, .autogram-docx-page th {
          border: 1px solid #cbd5e1 !important;
          padding: 8px 12px !important;
        }
        .autogram-docx-page th {
          background: #f1f5f9 !important;
          font-weight: 600 !important;
        }
      `}</style>
    </div>
  );
};
