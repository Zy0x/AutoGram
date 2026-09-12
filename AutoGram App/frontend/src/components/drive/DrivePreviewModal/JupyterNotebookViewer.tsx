import React, { useMemo, useState } from 'react';
import { BookOpen, Copy, Check } from 'lucide-react';

interface Props {
  rawJson: string;
  fileName: string;
}

interface NotebookCell {
  cell_type: 'markdown' | 'code' | 'raw';
  execution_count?: number | null;
  source: string[] | string;
  outputs?: Array<{
    output_type: string;
    text?: string[] | string;
    data?: {
      'text/plain'?: string[] | string;
      'image/png'?: string;
      'image/jpeg'?: string;
      'text/html'?: string[] | string;
    };
    execution_count?: number | null;
  }>;
}

export const JupyterNotebookViewer: React.FC<Props> = ({ rawJson, fileName: _fileName }) => {
  const [copiedCell, setCopiedCell] = useState<number | null>(null);

  const notebook = useMemo(() => {
    try {
      return JSON.parse(rawJson);
    } catch {
      return null;
    }
  }, [rawJson]);

  const cells: NotebookCell[] = useMemo(() => {
    if (!notebook || !Array.isArray(notebook.cells)) return [];
    return notebook.cells;
  }, [notebook]);

  const handleCopyCode = (codeStr: string, idx: number) => {
    navigator.clipboard.writeText(codeStr);
    setCopiedCell(idx);
    setTimeout(() => setCopiedCell(null), 2000);
  };

  if (!notebook) {
    return (
      <div style={{ padding: '24px', color: '#f87171', textAlign: 'center' }}>
        Berkas bukan merupakan format Jupyter Notebook (.ipynb) JSON yang valid.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-modal, var(--bg-card))', color: 'var(--text-primary)', overflowY: 'auto', padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '16px', borderBottom: '1px solid var(--border-default)', marginBottom: '20px' }}>
        <BookOpen size={18} className="text-amber-400" />
        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)', color: 'var(--accent-primary)', fontWeight: 600 }}>
          Jupyter Notebook ({cells.length} cells: {cells.filter(c => c.cell_type === 'code').length} code, {cells.filter(c => c.cell_type === 'markdown').length} markdown)
        </span>
      </div>

      {/* Cells List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        {cells.map((cell, idx) => {
          const srcText = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');

          if (cell.cell_type === 'markdown') {
            return (
              <div
                key={idx}
                style={{
                  padding: '14px 18px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '8px',
                  lineHeight: '1.6',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {srcText}
              </div>
            );
          }

          if (cell.cell_type === 'code') {
            return (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                {/* Code Header Bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--accent-primary)', fontWeight: 600 }}>
                    In [{cell.execution_count != null ? cell.execution_count : ' '}]:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(srcText, idx)}
                    style={{ padding: '2px 8px', fontSize: '11px', borderRadius: '4px', background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    {copiedCell === idx ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    <span>{copiedCell === idx ? 'Tersalin' : 'Salin'}</span>
                  </button>
                </div>

                {/* Code Content */}
                <pre style={{ margin: 0, padding: '12px 16px', fontSize: '12px', fontFamily: 'Consolas, Monaco, monospace', color: 'var(--text-primary)', background: 'transparent', overflowX: 'auto' }}>
                  <code>{srcText}</code>
                </pre>

                {/* Outputs */}
                {Array.isArray(cell.outputs) && cell.outputs.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', padding: '10px 16px' }}>
                    {cell.outputs.map((out, outIdx) => {
                      const outText = out.text ? (Array.isArray(out.text) ? out.text.join('') : String(out.text)) : out.data?.['text/plain'] ? (Array.isArray(out.data['text/plain']) ? out.data['text/plain'].join('') : String(out.data['text/plain'])) : '';
                      const imgPng = out.data?.['image/png'];
                      const imgJpeg = out.data?.['image/jpeg'];

                      return (
                        <div key={outIdx} style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                          {out.execution_count != null && (
                            <span style={{ color: '#f43f5e', marginRight: '6px', fontWeight: 600 }}>
                              Out [{out.execution_count}]:
                            </span>
                          )}
                          {imgPng && (
                            <img src={`data:image/png;base64,${imgPng}`} alt="Output Plot" style={{ maxWidth: '100%', borderRadius: '6px', margin: '8px 0' }} />
                          )}
                          {imgJpeg && (
                            <img src={`data:image/jpeg;base64,${imgJpeg}`} alt="Output Plot" style={{ maxWidth: '100%', borderRadius: '6px', margin: '8px 0' }} />
                          )}
                          {outText && (
                            <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{outText}</pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
};
