import React, { useState, useMemo, useEffect } from 'react';
import {
  Code2,
  Copy,
  Check,
  WrapText,
  Sparkles,
  Search,
  FolderTree,
  FileCode,
  Braces,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scanSensitiveData } from '../../../lib/media/sensitiveDataDetector';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { SensitiveDataAlert } from './SensitiveDataAlert';

interface Props {
  code: string;
  language?: string;
  fileName: string;
  wordWrap?: boolean;
  searchOpen?: boolean;
  onToggleSearch?: () => void;
  isJson?: boolean;
  onSwitchToTree?: () => void;
}

/** Language detector and brand info based on file extension */
function detectLanguage(filename: string, explicitLang?: string): {
  lang: string;
  name: string;
  badgeBg: string;
  badgeColor: string;
} {
  const ext = (explicitLang || filename.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'ts':
    case 'cts':
    case 'mts':
      return { lang: 'typescript', name: 'TYPESCRIPT', badgeBg: 'rgba(49, 120, 198, 0.2)', badgeColor: '#60a5fa' };
    case 'tsx':
      return { lang: 'tsx', name: 'REACT TSX', badgeBg: 'rgba(56, 189, 248, 0.2)', badgeColor: '#38bdf8' };
    case 'js':
    case 'cjs':
    case 'mjs':
      return { lang: 'javascript', name: 'JAVASCRIPT', badgeBg: 'rgba(247, 223, 30, 0.18)', badgeColor: '#fde047' };
    case 'jsx':
      return { lang: 'jsx', name: 'REACT JSX', badgeBg: 'rgba(56, 189, 248, 0.2)', badgeColor: '#38bdf8' };
    case 'py':
    case 'pyw':
    case 'pyi':
      return { lang: 'python', name: 'PYTHON', badgeBg: 'rgba(55, 118, 171, 0.2)', badgeColor: '#93c5fd' };
    case 'rs':
      return { lang: 'rust', name: 'RUST', badgeBg: 'rgba(222, 165, 132, 0.2)', badgeColor: '#fca5a5' };
    case 'json':
    case 'json5':
    case 'jsonc':
    case 'ipynb':
      return { lang: 'json', name: 'JSON', badgeBg: 'rgba(203, 203, 65, 0.2)', badgeColor: '#fef08a' };
    case 'html':
    case 'htm':
    case 'xhtml':
      return { lang: 'html', name: 'HTML', badgeBg: 'rgba(227, 76, 38, 0.2)', badgeColor: '#fb923c' };
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return { lang: 'css', name: 'CSS', badgeBg: 'rgba(86, 61, 124, 0.2)', badgeColor: '#c084fc' };
    case 'sql':
      return { lang: 'sql', name: 'SQL', badgeBg: 'rgba(227, 140, 0, 0.2)', badgeColor: '#fbbf24' };
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
    case 'bat':
    case 'cmd':
      return { lang: 'shell', name: 'SHELL', badgeBg: 'rgba(78, 170, 37, 0.2)', badgeColor: '#86efac' };
    case 'yaml':
    case 'yml':
      return { lang: 'yaml', name: 'YAML', badgeBg: 'rgba(203, 23, 30, 0.2)', badgeColor: '#fca5a5' };
    case 'toml':
    case 'ini':
    case 'cfg':
    case 'env':
    case 'conf':
      return { lang: 'toml', name: 'CONFIG', badgeBg: 'rgba(156, 163, 175, 0.2)', badgeColor: '#e2e8f0' };
    case 'md':
    case 'markdown':
      return { lang: 'markdown', name: 'MARKDOWN', badgeBg: 'rgba(8, 63, 161, 0.2)', badgeColor: '#93c5fd' };
    case 'c':
    case 'h':
      return { lang: 'c', name: 'C', badgeBg: 'rgba(243, 75, 125, 0.2)', badgeColor: '#f472b6' };
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return { lang: 'cpp', name: 'C++', badgeBg: 'rgba(243, 75, 125, 0.2)', badgeColor: '#f472b6' };
    case 'java':
      return { lang: 'java', name: 'JAVA', badgeBg: 'rgba(176, 114, 25, 0.2)', badgeColor: '#fdba74' };
    case 'kt':
    case 'kts':
      return { lang: 'kotlin', name: 'KOTLIN', badgeBg: 'rgba(127, 82, 255, 0.2)', badgeColor: '#c084fc' };
    case 'go':
      return { lang: 'go', name: 'GO', badgeBg: 'rgba(0, 173, 216, 0.2)', badgeColor: '#67e8f9' };
    case 'php':
      return { lang: 'php', name: 'PHP', badgeBg: 'rgba(79, 93, 149, 0.2)', badgeColor: '#a5b4fc' };
    case 'rb':
      return { lang: 'ruby', name: 'RUBY', badgeBg: 'rgba(112, 21, 22, 0.2)', badgeColor: '#f87171' };
    case 'xml':
    case 'svg':
      return { lang: 'xml', name: 'XML', badgeBg: 'rgba(0, 96, 172, 0.2)', badgeColor: '#38bdf8' };
    default:
      return { lang: 'plaintext', name: ext.toUpperCase() || 'TXT', badgeBg: 'rgba(255, 255, 255, 0.08)', badgeColor: '#e2e8f0' };
  }
}

/** Tokenizer regexes for high-performance syntax highlighting */
const COMMENTS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|<!--[\s\S]*?-->|--[^\n]*)/g;
const STRINGS = /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)/g;
const JSON_KEYS = /"([^"\\]|\\.)*"(?=\s*:)/g;
const KEYWORDS =
  /\b(const|let|var|function|fn|pub|struct|enum|impl|trait|class|interface|type|extends|implements|import|export|from|default|return|if|else|switch|case|break|continue|for|while|do|try|catch|finally|throw|async|await|yield|new|this|super|static|public|private|protected|readonly|typeof|instanceof|void|select|insert|update|delete|where|join|on|group|by|order|limit|as|create|table|drop|alter|index|into|values|set|with|union|all|and|or|not|in|is|like|between|def|lambda|pass|raise|except|mod|crate|use|mut|move|unsafe|match|package|func|val)\b/g;
const CONTROL_FLOW = /\b(return|throw|yield|break|continue|if|else|switch|case|try|catch|finally|match)\b/g;
const BOOLEANS_NULLS = /\b(true|false|null|undefined|None|True|False|nil|NaN|Infinity)\b/g;
const NUMBERS = /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+(\.\d+)?([eE][+-]?\d+)?)\b/g;
const FUNCTIONS = /\b([a-zA-Z_]\w*)(?=\s*\()/g;
const TYPES = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
const TAGS = /<\/?([a-zA-Z0-9-]+)(\s+[^>]*>|>)?/g;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightLine(line: string, lang: string): string {
  if (!line || line.trim() === '') return '&nbsp;';

  // 1. Comments first (so they are preserved without nested tokens)
  const commentPlaceholder: string[] = [];
  let html = line.replace(COMMENTS, (match) => {
    const idx = commentPlaceholder.length;
    commentPlaceholder.push(`<span class="vscode-tok-comment">${escapeHtml(match)}</span>`);
    return `___COMMENT_${idx}___`;
  });

  // 2. JSON keys vs normal strings
  const stringPlaceholder: string[] = [];
  if (lang === 'json') {
    html = html.replace(JSON_KEYS, (match) => {
      const idx = stringPlaceholder.length;
      stringPlaceholder.push(`<span class="vscode-tok-property">${escapeHtml(match)}</span>`);
      return `___STR_${idx}___`;
    });
  }

  html = html.replace(STRINGS, (match) => {
    const idx = stringPlaceholder.length;
    stringPlaceholder.push(`<span class="vscode-tok-string">${escapeHtml(match)}</span>`);
    return `___STR_${idx}___`;
  });

  // 3. Escape remaining HTML entities
  html = escapeHtml(html);

  // 4. HTML / JSX Tags
  if (lang === 'html' || lang === 'xml' || lang === 'jsx' || lang === 'tsx') {
    html = html.replace(TAGS, (match) => `<span class="vscode-tok-tag">${match}</span>`);
  }

  // 5. Control Flow & Keywords
  html = html
    .replace(CONTROL_FLOW, (match) => `<span class="vscode-tok-control">${match}</span>`)
    .replace(KEYWORDS, (match) => `<span class="vscode-tok-keyword">${match}</span>`)
    .replace(BOOLEANS_NULLS, (match) => `<span class="vscode-tok-boolean">${match}</span>`)
    .replace(FUNCTIONS, (match) => `<span class="vscode-tok-function">${match}</span>`)
    .replace(TYPES, (match) => `<span class="vscode-tok-type">${match}</span>`)
    .replace(NUMBERS, (match) => `<span class="vscode-tok-number">${match}</span>`);

  // 6. Restore strings and comments
  stringPlaceholder.forEach((str, i) => {
    html = html.replace(`___STR_${i}___`, str);
  });

  commentPlaceholder.forEach((cmt, i) => {
    html = html.replace(`___COMMENT_${i}___`, cmt);
  });

  return html;
}

export const CodeScriptViewer: React.FC<Props> = ({
  code,
  language: explicitLang = 'text',
  fileName,
  wordWrap: controlledWordWrap,
  searchOpen: controlledSearchOpen,
  onToggleSearch,
  isJson: explicitIsJson,
  onSwitchToTree,
}) => {
  const { t } = useTranslation();
  const [internalWordWrap, setInternalWordWrap] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [internalSearchOpen, setInternalSearchOpen] = useState(false);
  const [isMasked, setIsMasked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formattedText, setFormattedText] = useState<string | null>(null);

  const wordWrap = controlledWordWrap !== undefined ? controlledWordWrap : internalWordWrap;
  const isSearchOpen = controlledSearchOpen !== undefined ? controlledSearchOpen : internalSearchOpen;
  const toggleSearch = onToggleSearch || (() => setInternalSearchOpen((prev) => !prev));

  const langInfo = useMemo(() => detectLanguage(fileName, explicitLang), [fileName, explicitLang]);
  const isJson = explicitIsJson || langInfo.lang === 'json' || fileName.toLowerCase().endsWith('.json');

  // Active text (formatted or original, masked or unmasked)
  const baseText = formattedText ?? code;
  const scanResult = useMemo(() => scanSensitiveData(baseText), [baseText]);
  const activeText = isMasked ? scanResult.maskedText : baseText;
  const lines = useMemo(() => activeText.split('\n'), [activeText]);

  // Check if JSON can be pretty-formatted
  const canFormatJson = useMemo(() => {
    if (!isJson) return false;
    try {
      JSON.parse(code);
      return true;
    } catch {
      return false;
    }
  }, [code, isJson]);

  const handleToggleFormatJson = () => {
    if (formattedText) {
      setFormattedText(null);
    } else {
      try {
        const parsed = JSON.parse(code);
        setFormattedText(JSON.stringify(parsed, null, 2));
      } catch {
        /* invalid json */
      }
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

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

  // Syntax-highlighted HTML lines
  const highlightedLines = useMemo(() => {
    if (lines.length > 5000) {
      return lines.map((l) => escapeHtml(l) || '&nbsp;');
    }
    return lines.map((line) => highlightLine(line, langInfo.lang));
  }, [lines, langInfo.lang]);

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

      {/* VS Code Breadcrumb & Mini Toolbar */}
      <div className="td-code-breadcrumb-bar">
        <div className="td-code-breadcrumb-left">
          <span
            className="td-code-lang-pill"
            style={{
              background: langInfo.badgeBg,
              color: langInfo.badgeColor,
              borderColor: `${langInfo.badgeColor}40`,
            }}
          >
            <Code2 size={12} strokeWidth={2.4} />
            <span>{langInfo.name}</span>
          </span>
          <span className="td-code-file-title">{fileName}</span>
          <span className="td-code-meta-badge">
            • {lines.length.toLocaleString()} {t('drive.lines')} • {formatDriveBytes(activeText.length)}
          </span>
        </div>

        <div className="td-code-breadcrumb-right">
          {/* Format JSON Pretty Toggle */}
          {canFormatJson && (
            <button
              type="button"
              className={`td-code-action-pill ${formattedText ? 'is-active' : ''}`}
              onClick={handleToggleFormatJson}
              title={formattedText ? t('drive.restore_original_format') : t('drive.format_json_pretty')}
            >
              <Sparkles size={12} />
              <span>{formattedText ? t('drive.restore_original_format') : t('drive.format_json_pretty')}</span>
            </button>
          )}

          {/* Switch to Tree View (JSON only) */}
          {isJson && onSwitchToTree && (
            <button
              type="button"
              className="td-code-action-pill"
              onClick={onSwitchToTree}
              title={t('drive.view_tree_mode')}
            >
              <FolderTree size={12} />
              <span>{t('drive.tab_preview_tree')}</span>
            </button>
          )}

          {/* Word Wrap Toggle */}
          <button
            type="button"
            className={`td-code-action-pill ${wordWrap ? 'is-active' : ''}`}
            onClick={() => setInternalWordWrap((prev) => !prev)}
            title={t('drive.toggle_word_wrap')}
          >
            <WrapText size={12} />
            <span>Wrap</span>
          </button>

          {/* In-File Search Toggle */}
          <button
            type="button"
            className={`td-code-action-pill ${isSearchOpen ? 'is-active' : ''}`}
            onClick={toggleSearch}
            title={t('drive.search_placeholder')}
          >
            <Search size={12} />
            <span>Cari</span>
          </button>

          {/* Copy Code */}
          <button
            type="button"
            className="td-code-action-pill is-primary"
            onClick={() => void handleCopyCode()}
            title={t('drive.copy')}
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            <span>{copied ? t('drive.copied') : t('drive.copy')}</span>
          </button>
        </div>
      </div>

      {/* Floating In-Page Search Box */}
      {isSearchOpen && (
        <div
          className="td-code-search-box is-floating"
          style={{
            position: 'absolute',
            top: '42px',
            right: '16px',
            zIndex: 10,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '8px',
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
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

      {/* VS Code Code Editor Body */}
      <div className={`td-code-viewer-body ${wordWrap ? 'is-wrapped' : 'is-scroll'}`}>
        <div className="td-code-lines font-mono">
          {highlightedLines.map((lineHtml, idx) => {
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
                <span
                  className="td-code-text"
                  dangerouslySetInnerHTML={{ __html: lineHtml }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* VS Code Status Bar */}
      <div className="td-code-status-bar">
        <div className="td-code-status-left">
          <span className="td-code-status-item">
            <FileCode size={11} />
            <span>{langInfo.name}</span>
          </span>
          <span className="td-code-status-item">
            {lines.length.toLocaleString()} {t('drive.lines')}
          </span>
        </div>
        <div className="td-code-status-right">
          <span className="td-code-status-item">UTF-8</span>
          <span className="td-code-status-item">Spaces: 2</span>
          <span className="td-code-status-item">
            <Braces size={11} />
            <span>VS Code Dark+</span>
          </span>
        </div>
      </div>
    </div>
  );
};

