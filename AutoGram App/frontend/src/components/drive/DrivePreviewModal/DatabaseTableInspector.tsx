import React, { useState, useMemo } from 'react';
import { Database, Table, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  rawSqlOrText: string;
  fileName: string;
}

export const DatabaseTableInspector: React.FC<Props> = ({ rawSqlOrText, fileName: _fileName }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // Extract SQL Tables / CREATE TABLE Statements
  const tables = useMemo(() => {
    const extracted: Array<{ name: string; columns: string[]; rawSchema: string }> = [];
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?\s*\(([^;]+)\)/gi;
    let match: RegExpExecArray | null;

    while ((match = createTableRegex.exec(rawSqlOrText)) !== null) {
      const tableName = match[1];
      const colDefs = match[2]
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      extracted.push({
        name: tableName,
        columns: colDefs,
        rawSchema: match[0],
      });
    }

    return extracted;
  }, [rawSqlOrText]);

  const [activeTableIdx, setActiveTableIdx] = useState(0);
  const activeTable = tables[activeTableIdx] || tables[0];

  const handleCopy = () => {
    void navigator.clipboard.writeText(rawSqlOrText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="td-db-inspector-wrap">
      <div className="td-db-toolbar">
        <div className="td-db-toolbar-left">
          <Database size={16} className="text-emerald-400" />
          <span className="td-db-title font-semibold">
            {t('drive.db_inspector_title', 'Inspektor Skema & Tabel Database')}
          </span>
          <span className="td-db-stats">
            ({tables.length} {t('drive.tables_found', 'tabel ditemukan')})
          </span>
        </div>

        <div className="td-db-toolbar-right">
          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={handleCopy}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? t('drive.copied', 'Tersalin') : t('drive.copy_schema', 'Salin Skema')}</span>
          </button>
        </div>
      </div>

      <div className="td-db-content-layout">
        {/* Left Table Navigation */}
        <div className="td-db-tables-nav">
          <div className="td-db-nav-header">Daftar Tabel ({tables.length})</div>
          <div className="td-db-nav-list">
            {tables.map((tbl, idx) => (
              <button
                key={idx}
                type="button"
                className={`td-db-table-item ${activeTableIdx === idx ? 'is-active' : ''}`}
                onClick={() => setActiveTableIdx(idx)}
              >
                <Table size={13} className="text-slate-400" />
                <span className="font-mono">{tbl.name}</span>
                <span className="td-db-col-count">{tbl.columns.length}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Table Column Viewer */}
        <div className="td-db-table-detail">
          {activeTable ? (
            <div className="td-db-columns-card">
              <div className="td-db-table-title-row">
                <h3>Tabel: <code className="text-sky-400 font-mono">{activeTable.name}</code></h3>
                <span className="td-db-columns-badge">{activeTable.columns.length} Kolom</span>
              </div>

              <div className="td-db-cols-table-scroll">
                <table className="td-table-grid">
                  <thead>
                    <tr>
                      <th className="td-table-th-num">#</th>
                      <th className="td-table-th">Definisi Kolom / Tipe Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTable.columns.map((col, cIdx) => (
                      <tr key={cIdx} className="td-table-tr">
                        <td className="td-table-td-num">{cIdx + 1}</td>
                        <td className="td-table-td font-mono">{col}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="td-db-raw-sql-box">
                <div className="td-db-sql-label">DDL Schema:</div>
                <pre className="font-mono">{activeTable.rawSchema}</pre>
              </div>
            </div>
          ) : (
            <div className="td-db-empty-state">
              <p>Tidak ditemukan definisi DDL CREATE TABLE terstruktur dalam file ini.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
