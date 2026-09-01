import React, { useState, useMemo, useEffect } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scanSensitiveData } from '../../../lib/media/sensitiveDataDetector';
import { SensitiveDataAlert } from './SensitiveDataAlert';

interface Props {
  code: string;
  language?: string;
  fileName: string;
  wordWrap?: boolean;
  searchOpen?: boolean;
  onToggleSearch?: () => void;
}

export const CodeScriptViewer: React.FC<Props> = ({
  code,
  language: _language = 'text',
  fileName: _fileName,
  wordWrap: controlledWordWrap,
  searchOpen: controlledSearchOpen,
  onToggleSearch,
}) => {
  const { t } = useTranslation();
  const [internalWordWrap] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [internalSearchOpen, setInternalSearchOpen] = useState(false);
  const [isMasked, setIsMasked] = useState(false);

  const wordWrap = controlledWordWrap !== undefined ? controlledWordWrap : internalWordWrap;
  const isSearchOpen = controlledSearchOpen !== undefined ? controlledSearchOpen : internalSearchOpen;
  const toggleSearch = onToggleSearch || (() => setInternalSearchOpen((prev) => !prev));

  // Scan sensitive tokens in code
  const scanResult = useMemo(() => scanSensitiveData(code), [code]);

  const activeText = isMasked ? scanResult.maskedText : code;
  const lines = useMemo(() => activeText.split('\n'), [activeText]);

  // Keyboard shortcut Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSearch]);

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
    <div className="td-code-viewer-wrap" style={{ position: 'relative' }}>
      {/* Top Secrets Detection Alert Banner */}
      {scanResult.hasSecrets && (
        <SensitiveDataAlert
          scanResult={scanResult}
          isMasked={isMasked}
          onToggleMask={() => setIsMasked((prev) => !prev)}
        />
      )}

      {/* Floating In-Page Search Box (Triggered via Header or Ctrl+F) */}
      {isSearchOpen && (
        <div
          className="td-code-search-box is-floating"
          style={{
            position: 'absolute',
            top: '8px',
            right: '16px',
            zIndex: 10,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '8px',
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          <Search size={13} className="text-sky-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('drive.search_placeholder')}
            className="td-code-search-input"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f8fafc',
              fontSize: '12px',
              width: '160px',
            }}
            autoFocus
          />
          {filteredLineIndices && (
            <span className="td-code-search-count" style={{ fontSize: '11px', color: '#94a3b8', paddingRight: '4px' }}>
              {filteredLineIndices.length} {t('drive.matches')}
            </span>
          )}
          <button
            type="button"
            className="td-btn-secondary td-btn-xs"
            onClick={toggleSearch}
            style={{ padding: '2px 6px', fontSize: '11px', borderRadius: '4px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Code Editor Body — Full Bleed without Redundant Toolbar */}
      <div className={`td-code-viewer-body ${wordWrap ? 'is-wrapped' : ''}`}>
        <div className="td-code-lines font-mono">
          {lines.map((line, idx) => {
            const isMatch = filteredLineIndices?.includes(idx);
            return (
              <div
                key={idx}
                className={`td-code-line ${isMatch ? 'is-search-match' : ''}`}
              >
                <span
                  className="td-code-gutter"
                  aria-hidden="true"
                  data-line={idx + 1}
                  unselectable="on"
                >
                  {idx + 1}
                </span>
                <span className="td-code-text">{line || ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
