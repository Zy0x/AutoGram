import React, { useEffect, useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Search, FileSpreadsheet, Loader2, Copy, Check } from 'lucide-react';

interface Props {
  data: ArrayBuffer | Uint8Array | Blob | string;
  fileName: string;
  onOpenSystem?: () => void;
}

export const SpreadsheetViewer: React.FC<Props> = ({ data, fileName: _fileName, onOpenSystem: _onOpenSystem }) => {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkbook() {
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

        if (cancelled) return;
        const wb = XLSX.read(buffer, { type: 'array' });
        setWorkbook(wb);
        if (wb.SheetNames.length > 0) {
          setActiveSheet(wb.SheetNames[0]);
        }
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          console.error('[SpreadsheetViewer] Failed to parse:', err);
          setError(err?.message || 'Gagal memproses berkas spreadsheet');
          setLoading(false);
        }
      }
    }

    void loadWorkbook();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const sheetData = useMemo(() => {
    if (!workbook || !activeSheet || !workbook.Sheets[activeSheet]) return [];
    const ws = workbook.Sheets[activeSheet];
    return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
  }, [workbook, activeSheet]);

  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return sheetData;
    const q = searchQuery.toLowerCase();
    return sheetData.filter((row) =>
      row.some((cell) => String(cell).toLowerCase().includes(q))
    );
  }, [sheetData, searchQuery]);

  const handleCopyCsv = () => {
    if (!workbook || !activeSheet || !workbook.Sheets[activeSheet]) return;
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[activeSheet]);
    navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0b0f19', color: '#f8fafc', overflow: 'hidden' }}>
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: 'rgba(15, 23, 42, 0.92)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          gap: '12px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileSpreadsheet size={16} className="text-emerald-400" />
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              fontWeight: 600,
            }}
          >
            {workbook?.SheetNames.length || 1} Sheet ({sheetData.length} baris)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: '8px', color: '#94a3b8' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari di spreadsheet..."
              style={{
                padding: '4px 8px 4px 28px',
                fontSize: '12px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#f8fafc',
                outline: 'none',
                width: '180px',
              }}
            />
          </div>

          <button
            type="button"
            onClick={handleCopyCsv}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: 'rgba(16, 185, 129, 0.2)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#6ee7b7',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Tersalin' : 'Salin CSV'}</span>
          </button>
        </div>
      </div>

      {/* Sheet Tabs Bar */}
      {workbook && workbook.SheetNames.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 16px',
            background: '#090d16',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {workbook.SheetNames.map((sheet) => (
            <button
              key={sheet}
              type="button"
              onClick={() => setActiveSheet(sheet)}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                background: activeSheet === sheet ? '#059669' : 'transparent',
                color: activeSheet === sheet ? '#ffffff' : '#94a3b8',
                fontWeight: activeSheet === sheet ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {sheet}
            </button>
          ))}
        </div>
      )}

      {/* Main Grid View */}
      <div style={{ flex: 1, overflow: 'auto', background: '#090d16', position: 'relative' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: '#94a3b8' }}>
            <Loader2 size={32} className="spin text-emerald-400" />
            <span style={{ fontSize: '13px', fontWeight: 500 }}>Membaca lembar kerja spreadsheet...</span>
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: '#f87171' }}>
            <FileSpreadsheet size={36} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Gagal Membaca Spreadsheet</span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>{error}</span>
          </div>
        )}

        {!loading && !error && filteredData.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontSize: '13px' }}>
            Lembar kerja kosong atau data tidak ditemukan.
          </div>
        )}

        {!loading && !error && filteredData.length > 0 && (
          <table
            style={{
              width: 'max-content',
              minWidth: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              textAlign: 'left',
              fontFamily: 'monospace',
            }}
          >
            <thead>
              <tr style={{ background: '#0f172a', position: 'sticky', top: 0, zIndex: 5 }}>
                <th style={{ padding: '6px 10px', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', width: '40px', textAlign: 'center' }}>#</th>
                {(filteredData[0] || []).map((_, idx) => (
                  <th key={idx} style={{ padding: '6px 12px', border: '1px solid rgba(255,255,255,0.08)', color: '#38bdf8', fontWeight: 600 }}>
                    {String.fromCharCode(65 + (idx % 26))}{idx >= 26 ? Math.floor(idx / 26) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, rowIdx) => (
                <tr key={rowIdx} style={{ background: rowIdx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '5px 10px', border: '1px solid rgba(255,255,255,0.06)', color: '#64748b', textAlign: 'center', fontWeight: 600, background: '#0d1117' }}>
                    {rowIdx + 1}
                  </td>
                  {row.map((cell, colIdx) => (
                    <td key={colIdx} style={{ padding: '5px 12px', border: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0', whiteSpace: 'nowrap' }}>
                      {String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
