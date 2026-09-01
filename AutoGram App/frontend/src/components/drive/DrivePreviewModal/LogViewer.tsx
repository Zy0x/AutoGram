import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Terminal, Search, ArrowDownToLine, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  logContent: string;
  fileName: string;
}

type LogLevel = 'all' | 'error' | 'warn' | 'info' | 'debug';

export const LogViewer: React.FC<Props> = ({ logContent, fileName: _fileName }) => {
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] = useState<LogLevel>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(false);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rawLines = useMemo(() => logContent.split(/\r?\n/), [logContent]);

  const parsedLines = useMemo(() => {
    return rawLines.map((line, idx) => {
      const lower = line.toLowerCase();
      let level: 'error' | 'warn' | 'info' | 'debug' | 'plain' = 'plain';
      if (lower.includes('error') || lower.includes('fail') || lower.includes('fatal') || lower.includes('crit')) {
        level = 'error';
      } else if (lower.includes('warn')) {
        level = 'warn';
      } else if (lower.includes('info') || lower.includes('notice')) {
        level = 'info';
      } else if (lower.includes('debug') || lower.includes('trace')) {
        level = 'debug';
      }
      return { idx: idx + 1, text: line, level };
    });
  }, [rawLines]);

  const filteredLines = useMemo(() => {
    return parsedLines.filter((line) => {
      if (activeFilter !== 'all' && line.level !== activeFilter) return false;
      if (searchQuery.trim()) {
        return line.text.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [parsedLines, activeFilter, searchQuery]);

  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  const handleCopy = () => {
    const text = filteredLines.map((l) => l.text).join('\n');
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const errorCount = useMemo(() => parsedLines.filter((l) => l.level === 'error').length, [parsedLines]);
  const warnCount = useMemo(() => parsedLines.filter((l) => l.level === 'warn').length, [parsedLines]);

  return (
    <div className="td-log-viewer-wrap">
      <div className="td-log-toolbar">
        <div className="td-log-toolbar-left">
          <Terminal size={16} className="text-amber-400" />
          <span className="td-log-title font-semibold">
            {t('drive.log_viewer_title')}
          </span>
          <span className="td-log-stats">
            ({filteredLines.length.toLocaleString()} / {rawLines.length.toLocaleString()} {t('drive.lines')})
          </span>
        </div>

        <div className="td-log-toolbar-right">
          {/* Level Filter Chips */}
          <div className="td-log-filter-group">
            <button
              type="button"
              className={`td-log-filter-btn ${activeFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              Semua
            </button>
            <button
              type="button"
              className={`td-log-filter-btn is-error ${activeFilter === 'error' ? 'is-active' : ''}`}
              onClick={() => setActiveFilter('error')}
            >
              Error ({errorCount})
            </button>
            <button
              type="button"
              className={`td-log-filter-btn is-warn ${activeFilter === 'warn' ? 'is-active' : ''}`}
              onClick={() => setActiveFilter('warn')}
            >
              Warn ({warnCount})
            </button>
          </div>

          <div className="td-log-search-box">
            <Search size={13} className="text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('drive.search_log_placeholder')}
              className="td-log-search-input"
            />
          </div>

          <button
            type="button"
            className={`td-btn-secondary td-btn-xs ${autoScroll ? 'is-active' : ''}`}
            onClick={() => setAutoScroll((prev) => !prev)}
            title={t('drive.auto_scroll')}
          >
            <ArrowDownToLine size={13} />
          </button>

          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={handleCopy}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? t('drive.copied') : t('drive.copy')}</span>
          </button>
        </div>
      </div>

      <div className="td-log-viewer-body font-mono" ref={bodyRef}>
        {filteredLines.map((line) => (
          <div key={line.idx} className={`td-log-row is-${line.level}`}>
            <span className="td-log-gutter">{line.idx}</span>
            <span className="td-log-text">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
