import React, { useState, useMemo, useEffect } from 'react';
import { Copy, Check, WrapText, Search, FileCode } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scanSensitiveData } from '../../../lib/media/sensitiveDataDetector';
import { SensitiveDataAlert } from './SensitiveDataAlert';

interface Props {
  code: string;
  language?: string;
  fileName: string;
}

export const CodeScriptViewer: React.FC<Props> = ({ code, language = 'text', fileName: _fileName }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [isMasked, setIsMasked] = useState(false);

  // Scan sensitive tokens in code
  const scanResult = useMemo(() => scanSensitiveData(code), [code]);

  const activeText = isMasked ? scanResult.maskedText : code;
  const lines = useMemo(() => activeText.split('\n'), [activeText]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(activeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Keyboard shortcut Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredLineIndices = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(q)) indices.push(idx);
    });
    return indices;
  }, [lines, searchQuery]);

  return (
    <div className="td-code-viewer-wrap">
      {/* Top Secrets Detection Alert Banner */}
      {scanResult.hasSecrets && (
        <SensitiveDataAlert
          scanResult={scanResult}
          isMasked={isMasked}
          onToggleMask={() => setIsMasked((prev) => !prev)}
        />
      )}

      {/* Code Header Bar */}
      <div className="td-code-viewer-header">
        <div className="td-code-header-left">
          <FileCode size={16} className="text-sky-400" />
          <span className="td-code-lang-badge">{language.toUpperCase()}</span>
          <span className="td-code-line-count">
            {lines.length.toLocaleString()} {t('drive.lines', 'baris')}
          </span>
        </div>

        <div className="td-code-header-right">
          {showSearch && (
            <div className="td-code-search-box">
              <Search size={13} className="text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('drive.search_placeholder', 'Cari dalam kode...')}
                className="td-code-search-input"
                autoFocus
              />
              {filteredLineIndices && (
                <span className="td-code-search-count">
                  {filteredLineIndices.length} {t('drive.matches', 'cocok')}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            className={`td-btn-secondary td-btn-xs ${showSearch ? 'is-active' : ''}`}
            onClick={() => setShowSearch((prev) => !prev)}
            title="Ctrl + F"
          >
            <Search size={13} />
          </button>

          <button
            type="button"
            className={`td-btn-secondary td-btn-xs ${wordWrap ? 'is-active' : ''}`}
            onClick={() => setWordWrap((prev) => !prev)}
            title={t('drive.toggle_word_wrap', 'Bungkus baris panjang')}
          >
            <WrapText size={13} />
          </button>

          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={handleCopy}
            title={t('drive.copy_code', 'Salin seluruh kode')}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? t('drive.copied', 'Tersalin') : t('drive.copy', 'Salin')}</span>
          </button>
        </div>
      </div>

      {/* Code Editor Body */}
      <div className={`td-code-viewer-body ${wordWrap ? 'is-wrapped' : ''}`}>
        <div className="td-code-lines font-mono">
          {lines.map((line, idx) => {
            const isMatch = filteredLineIndices?.includes(idx);
            return (
              <div
                key={idx}
                className={`td-code-line ${isMatch ? 'is-search-match' : ''}`}
              >
                <span className="td-code-gutter">{idx + 1}</span>
                <span className="td-code-text">{line || ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
