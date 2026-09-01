import React, { useState, useMemo } from 'react';
import { Copy, Check, Eye, Code, FileText } from 'lucide-react';
import { CodeScriptViewer } from './CodeScriptViewer';

interface Props {
  content: string;
  fileName: string;
}

export const MarkdownViewer: React.FC<Props> = ({ content, fileName }) => {
  const [viewMode, setViewMode] = useState<'visual' | 'raw'>('visual');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Convert basic markdown to safe structured elements
  const renderedElements = useMemo(() => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockLines: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];

    const flushTable = (key: string) => {
      if (tableRows.length === 0) return;
      const headers = tableRows[0];
      const dataRows = tableRows.slice(1);
      elements.push(
        <div key={key} style={{ margin: '16px 0', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255, 255, 255, 0.05)' }}>
                {headers.map((h, i) => (
                  <th key={i} style={{ padding: '8px 12px', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#38bdf8', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((r, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)' }}>
                  {r.map((c, ci) => (
                    <td key={ci} style={{ padding: '7px 12px', border: '1px solid rgba(255, 255, 255, 0.08)', color: '#e2e8f0' }}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    };

    const flushCodeBlock = (key: string) => {
      if (codeBlockLines.length === 0) return;
      elements.push(
        <div key={key} style={{ margin: '14px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.1)', background: '#090d16' }}>
          {codeBlockLang && (
            <div style={{ padding: '4px 12px', background: 'rgba(255, 255, 255, 0.04)', fontSize: '11px', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              {codeBlockLang.toUpperCase()}
            </div>
          )}
          <pre style={{ margin: 0, padding: '12px', overflowX: 'auto', fontSize: '12.5px', fontFamily: 'monospace', color: '#e2e8f0', lineHeight: 1.45 }}>
            {codeBlockLines.join('\n')}
          </pre>
        </div>
      );
      codeBlockLines = [];
      inCodeBlock = false;
      codeBlockLang = '';
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block fence
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          flushCodeBlock(`code-${i}`);
        } else {
          if (inTable) flushTable(`tbl-${i}`);
          inCodeBlock = true;
          codeBlockLang = line.slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // Markdown Tables
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        // Skip separator row |---|---|
        if (cells.every((c) => /^:?-+:?$/.test(c))) {
          continue;
        }
        inTable = true;
        tableRows.push(cells);
        continue;
      } else if (inTable) {
        flushTable(`tbl-${i}`);
      }

      // Headings
      if (line.startsWith('# ')) {
        elements.push(<h1 key={i} style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc', margin: '20px 0 10px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '8px' }}>{line.slice(2)}</h1>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={i} style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9', margin: '18px 0 8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '6px' }}>{line.slice(3)}</h2>);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={i} style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0', margin: '14px 0 6px' }}>{line.slice(4)}</h3>);
      } else if (line.startsWith('#### ')) {
        elements.push(<h4 key={i} style={{ fontSize: '14px', fontWeight: 600, color: '#cbd5e1', margin: '12px 0 4px' }}>{line.slice(5)}</h4>);
      } else if (line.startsWith('> ')) {
        // Blockquote
        elements.push(
          <blockquote key={i} style={{ margin: '12px 0', padding: '8px 16px', borderLeft: '3px solid #38bdf8', background: 'rgba(56, 189, 248, 0.08)', color: '#bae6fd', borderRadius: '0 6px 6px 0', fontSize: '13px' }}>
            {line.slice(2)}
          </blockquote>
        );
      } else if (line.startsWith('- [ ] ') || line.startsWith('- [x] ') || line.startsWith('- [X] ')) {
        // Task list
        const checked = line.startsWith('- [x] ') || line.startsWith('- [X] ');
        elements.push(
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0', fontSize: '13.5px', color: checked ? '#94a3b8' : '#f8fafc' }}>
            <input type="checkbox" checked={checked} readOnly style={{ accentColor: '#38bdf8' }} />
            <span style={{ textDecoration: checked ? 'line-through' : 'none' }}>{line.slice(6)}</span>
          </div>
        );
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        // Bullet list
        elements.push(
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '3px 0 3px 12px', fontSize: '13.5px', color: '#e2e8f0' }}>
            <span style={{ color: '#38bdf8', lineHeight: '1.4' }}>•</span>
            <span style={{ flex: 1, lineHeight: '1.5' }}>{line.slice(2)}</span>
          </div>
        );
      } else if (/^\d+\.\s/.test(line)) {
        // Numbered list
        const match = line.match(/^(\d+\.)\s(.*)$/);
        elements.push(
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '3px 0 3px 12px', fontSize: '13.5px', color: '#e2e8f0' }}>
            <span style={{ color: '#38bdf8', fontWeight: 600, minWidth: '18px' }}>{match ? match[1] : '1.'}</span>
            <span style={{ flex: 1, lineHeight: '1.5' }}>{match ? match[2] : line}</span>
          </div>
        );
      } else if (line.trim() === '---' || line.trim() === '***') {
        elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '20px 0' }} />);
      } else if (!line.trim()) {
        elements.push(<div key={i} style={{ height: '10px' }} />);
      } else {
        elements.push(
          <p key={i} style={{ margin: '4px 0', fontSize: '13.5px', lineHeight: '1.6', color: '#e2e8f0', userSelect: 'text' }}>
            {line}
          </p>
        );
      }
    }

    if (inCodeBlock) flushCodeBlock('code-end');
    if (inTable) flushTable('tbl-end');

    return elements;
  }, [content]);

  if (viewMode === 'raw') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px 16px', background: '#0e1422', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setViewMode('visual')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
          >
            <Eye size={13} />
            <span>Lihat Visual Render</span>
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CodeScriptViewer code={content} language="markdown" fileName={fileName} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0b0f19', color: '#f8fafc', overflow: 'hidden' }}>
      {/* Top Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#0e1422',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={16} className="text-sky-400" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
            {fileName}
          </span>
          <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontWeight: 700 }}>
            MARKDOWN
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setViewMode('raw')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#cbd5e1',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '11.5px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="Lihat Kode Sumber Mentah"
          >
            <Code size={13} />
            <span>Kode Mentah</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#cbd5e1',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '11.5px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="Salin Isi Dokumen"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? 'Tersalin' : 'Salin'}</span>
          </button>
        </div>
      </div>

      {/* Rendered Content Canvas */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 32px',
          maxWidth: '920px',
          margin: '0 auto',
          width: '100%',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text',
        }}
      >
        {renderedElements}
      </div>
    </div>
  );
};
