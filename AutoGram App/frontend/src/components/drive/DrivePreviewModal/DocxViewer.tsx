import React, { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { Loader2, FileText } from 'lucide-react';

interface Props {
  data: ArrayBuffer | Uint8Array | Blob | string;
  fileName: string;
  onOpenSystem?: () => void;
  zoom?: number;
}

export const DocxViewer: React.FC<Props> = ({ data, onOpenSystem, zoom = 1 }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          trimXmlDeclaration: true,
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

  return (
    <div className="autogram-docx-viewer-wrap" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0b0f19', color: '#f8fafc', overflow: 'hidden' }}>

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
        .autogram-docx-container .docx-wrapper {
          background: transparent !important;
          padding: 16px 0 !important;
        }
        .autogram-docx-container .docx-wrapper > section.docx {
          background: #ffffff !important;
          color: #000000 !important;
          margin-bottom: 24px !important;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45) !important;
          border-radius: 2px !important;
          box-sizing: border-box !important;
        }
      `}</style>
    </div>
  );
};
