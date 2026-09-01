import React, { useState, useMemo } from 'react';
import { Table, Search, ArrowUpDown, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  rawCsv: string;
  delimiter?: string;
  fileName: string;
}

export const TabularDataViewer: React.FC<Props> = ({ rawCsv, delimiter = ',', fileName: _fileName }) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [copied, setCopied] = useState(false);

  // Parse CSV rows cleanly
  const { headers, rows } = useMemo(() => {
    const lines = rawCsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };

    // Auto-detect delimiter if not specified
    const activeDelim = delimiter || (lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',');

    const parseLine = (line: string): string[] => {
      const entries: string[] = [];
      let inQuotes = false;
      let cur = '';
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === activeDelim && !inQuotes) {
          entries.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      entries.push(cur.trim());
      return entries;
    };

    const headerCols = parseLine(lines[0]);
    const bodyRows = lines.slice(1).map(parseLine);
    return { headers: headerCols, rows: bodyRows };
  }, [rawCsv, delimiter]);

  // Filter rows
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(q)));
  }, [rows, searchQuery]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const valA = a[sortCol] || '';
      const valB = b[sortCol] || '';
      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortAsc ? numA - numB : numB - numA;
      }
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }, [filteredRows, sortCol, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  const handleHeaderClick = (idx: number) => {
    if (sortCol === idx) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(idx);
      setSortAsc(true);
    }
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(rawCsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="td-table-viewer-wrap">
      <div className="td-table-toolbar">
        <div className="td-table-toolbar-left">
          <Table size={16} className="text-sky-400" />
          <span className="td-table-title font-semibold">
            {t('drive.table_viewer_title', 'Pratinjau Tabel Data')}
          </span>
          <span className="td-table-stats">
            ({rows.length.toLocaleString()} {t('drive.rows', 'baris')} × {headers.length} {t('drive.cols', 'kolom')})
          </span>
        </div>

        <div className="td-table-toolbar-right">
          <div className="td-table-search-box">
            <Search size={13} className="text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              placeholder={t('drive.search_table_placeholder', 'Filter tabel...')}
              className="td-table-search-input"
            />
          </div>

          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={handleCopy}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? t('drive.copied', 'Tersalin') : t('drive.copy_csv', 'Salin CSV')}</span>
          </button>
        </div>
      </div>

      <div className="td-table-grid-scroll">
        <table className="td-table-grid">
          <thead>
            <tr>
              <th className="td-table-th-num">#</th>
              {headers.map((h, idx) => (
                <th
                  key={idx}
                  onClick={() => handleHeaderClick(idx)}
                  className="td-table-th is-sortable"
                >
                  <div className="td-table-th-inner">
                    <span>{h || `Kolom ${idx + 1}`}</span>
                    <ArrowUpDown size={12} className="td-sort-icon" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, rIdx) => (
              <tr key={rIdx} className="td-table-tr">
                <td className="td-table-td-num">{page * pageSize + rIdx + 1}</td>
                {headers.map((_, cIdx) => (
                  <td key={cIdx} className="td-table-td">
                    {row[cIdx] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="td-table-pagination-bar">
          <div className="td-table-page-info">
            {t('drive.showing_range', 'Menampilkan {{start}} - {{end}} dari {{total}} baris', {
              start: page * pageSize + 1,
              end: Math.min(sortedRows.length, (page + 1) * pageSize),
              total: sortedRows.length,
            })}
          </div>

          <div className="td-table-page-nav">
            <button
              type="button"
              className="td-btn-secondary td-btn-xs"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="td-table-page-curr">
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
        </div>
      )}
    </div>
  );
};
