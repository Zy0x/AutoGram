import React, { useState, useMemo } from 'react';
import { Binary, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  bytes: Uint8Array;
  fileName: string;
}

const BYTES_PER_ROW = 16;
const ROWS_PER_PAGE = 32; // 512 bytes per page

export const HexInspector: React.FC<Props> = ({ bytes, fileName: _fileName }) => {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState(false);

  const totalBytes = bytes.length;
  const totalRows = Math.ceil(totalBytes / BYTES_PER_ROW);
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));

  const startRow = page * ROWS_PER_PAGE;
  const endRow = Math.min(totalRows, startRow + ROWS_PER_PAGE);

  const rows = useMemo(() => {
    const r: Array<{
      offset: string;
      hexPairs: string[];
      asciiChars: string[];
    }> = [];

    for (let rowIdx = startRow; rowIdx < endRow; rowIdx++) {
      const rowOffset = rowIdx * BYTES_PER_ROW;
      const offsetHex = rowOffset.toString(16).padStart(8, '0').toUpperCase();
      const hexPairs: string[] = [];
      const asciiChars: string[] = [];

      for (let col = 0; col < BYTES_PER_ROW; col++) {
        const byteIdx = rowOffset + col;
        if (byteIdx < totalBytes) {
          const b = bytes[byteIdx];
          hexPairs.push(b.toString(16).padStart(2, '0').toUpperCase());
          // Printable ASCII 32..126
          if (b >= 32 && b <= 126) {
            asciiChars.push(String.fromCharCode(b));
          } else {
            asciiChars.push('·');
          }
        } else {
          hexPairs.push('  ');
          asciiChars.push(' ');
        }
      }

      r.push({ offset: offsetHex, hexPairs, asciiChars });
    }

    return r;
  }, [bytes, startRow, endRow, totalBytes]);

  const handleCopyDump = () => {
    const dumpText = rows
      .map(
        (r) =>
          `${r.offset}  ${r.hexPairs.slice(0, 8).join(' ')}  ${r.hexPairs.slice(8).join(' ')}  |${r.asciiChars.join('')}|`
      )
      .join('\n');
    void navigator.clipboard.writeText(dumpText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="td-hex-inspector-wrap">
      <div className="td-hex-inspector-toolbar">
        <div className="td-hex-inspector-title">
          <Binary size={16} className="text-amber-400" />
          <span>{t('drive.hex_inspector_title')}</span>
          <span className="td-hex-byte-count">
            ({totalBytes.toLocaleString()} bytes)
          </span>
        </div>

        <div className="td-hex-controls">
          <button
            type="button"
            className="td-btn-secondary td-btn-sm"
            onClick={handleCopyDump}
            title={t('drive.hex_copy_page')}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? t('drive.copied') : t('drive.hex_copy')}</span>
          </button>

          {totalPages > 1 && (
            <div className="td-hex-pagination">
              <button
                type="button"
                className="td-btn-secondary td-btn-xs"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="td-hex-page-label">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="td-btn-secondary td-btn-xs"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="td-hex-grid-container">
        <div className="td-hex-grid font-mono">
          <div className="td-hex-header-row">
            <span className="td-hex-col-offset">OFFSET</span>
            <span className="td-hex-col-hex">
              00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F
            </span>
            <span className="td-hex-col-ascii">DECODED ASCII</span>
          </div>

          {rows.map((row, idx) => (
            <div key={idx} className="td-hex-row">
              <span className="td-hex-offset-val">{row.offset}</span>
              <span className="td-hex-bytes-val">
                <span className="td-hex-half">{row.hexPairs.slice(0, 8).join(' ')}</span>
                <span className="td-hex-sep">  </span>
                <span className="td-hex-half">{row.hexPairs.slice(8).join(' ')}</span>
              </span>
              <span className="td-hex-ascii-val">
                {row.asciiChars.map((ch, cIdx) => (
                  <span
                    key={cIdx}
                    className={ch === '·' ? 'td-hex-unprintable' : 'td-hex-printable'}
                  >
                    {ch}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
