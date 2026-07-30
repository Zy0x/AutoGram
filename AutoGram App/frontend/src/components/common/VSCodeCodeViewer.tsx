import { useTranslation } from 'react-i18next';
/**
 * Reusable Universal VSCode Dark+ Style Code & Text Viewer Component.
 * High-performance regex syntax highlighter for 20+ programming, markup, and data languages.
 * Supports active line highlighting, line numbers, word-wrap toggle, JSON auto-formatting, and copy code.
 */
import { useMemo, useState } from 'react';
import { Check, Copy, WrapText, Code2, Sparkles } from 'lucide-react';
import { formatDriveBytes } from '../../lib/telegram/driveTypes';

export interface VSCodeCodeViewerProps {
  text: string;
  name: string;
  maxCharLimit?: number;
}

/** Language detector based on file extension */
function detectLanguage(filename: string): { lang: string; name: string } {

  const ext = (filename.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'ts':
    case 'cts':
    case 'mts':
      return { lang: 'typescript', name: 'TYPESCRIPT' };
    case 'tsx':
      return { lang: 'tsx', name: 'REACT TSX' };
    case 'js':
    case 'cjs':
    case 'mjs':
      return { lang: 'javascript', name: 'JAVASCRIPT' };
    case 'jsx':
      return { lang: 'jsx', name: 'REACT JSX' };
    case 'py':
    case 'pyw':
    case 'pyi':
      return { lang: 'python', name: 'PYTHON' };
    case 'rs':
      return { lang: 'rust', name: 'RUST' };
    case 'json':
    case 'json5':
    case 'jsonc':
      return { lang: 'json', name: 'JSON' };
    case 'html':
    case 'htm':
    case 'xhtml':
      return { lang: 'html', name: 'HTML' };
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return { lang: 'css', name: 'CSS' };
    case 'sql':
      return { lang: 'sql', name: 'SQL' };
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
    case 'bat':
    case 'cmd':
      return { lang: 'shell', name: 'SHELL' };
    case 'yaml':
    case 'yml':
      return { lang: 'yaml', name: 'YAML' };
    case 'toml':
    case 'ini':
    case 'cfg':
      return { lang: 'toml', name: 'TOML' };
    case 'md':
    case 'markdown':
      return { lang: 'markdown', name: 'MARKDOWN' };
    case 'c':
    case 'h':
      return { lang: 'c', name: 'C' };
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return { lang: 'cpp', name: 'C++' };
    case 'java':
      return { lang: 'java', name: 'JAVA' };
    case 'go':
      return { lang: 'go', name: 'GO' };
    case 'php':
      return { lang: 'php', name: 'PHP' };
    case 'rb':
      return { lang: 'ruby', name: 'RUBY' };
    case 'xml':
    case 'svg':
      return { lang: 'xml', name: 'XML' };
    default:
      return { lang: 'plaintext', name: ext.toUpperCase() || 'TXT' };
  }
}

/** Tokenizer regex for high-performance syntax highlighting */
const KEYWORDS =
  /\b(const|let|var|function|fn|pub|struct|enum|impl|trait|class|interface|type|extends|implements|import|export|from|default|return|if|else|switch|case|break|continue|for|while|do|try|catch|finally|throw|async|await|yield|new|this|super|static|public|private|protected|readonly|typeof|instanceof|void|null|undefined|true|false|select|insert|update|delete|where|from|join|on|group|by|order|limit|as|create|table|drop|alter|index|into|values|set|with|union|all|and|or|not|in|is|like|between|def|lambda|pass|with|raise|except|import|as|self|mod|crate|use|mut|move|unsafe|match|where|type)\b/g;

const NUMBERS = /\b(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+(\.\d+)?([eE][+-]?\d+)?)\b/g;
const STRINGS = /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)/g;
const COMMENTS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|<!--[\s\S]*?-->)/g;
const FUNCTIONS = /\b([a-zA-Z_]\w*)(?=\s*\()/g;
const TYPES = /\b([A-Z]\w*)\b/g;
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

  // Highlight comments first to avoid nested highlighting inside comments
  let commentPlaceholder: string[] = [];
  let html = line.replace(COMMENTS, (match) => {
    const idx = commentPlaceholder.length;
    commentPlaceholder.push(`<span class="vscode-tok-comment">${escapeHtml(match)}</span>`);
    return `___COMMENT_${idx}___`;
  });

  // String placeholders
  let stringPlaceholder: string[] = [];
  html = html.replace(STRINGS, (match) => {
    const idx = stringPlaceholder.length;
    stringPlaceholder.push(`<span class="vscode-tok-string">${escapeHtml(match)}</span>`);
    return `___STRING_${idx}___`;
  });

  // Escape remaining code
  html = escapeHtml(html);

  // Apply syntax rules
  if (lang === 'html' || lang === 'xml' || lang === 'jsx' || lang === 'tsx') {
    html = html.replace(TAGS, (match) => `<span class="vscode-tok-tag">${match}</span>`);
  }

  html = html
    .replace(KEYWORDS, (match) => `<span class="vscode-tok-keyword">${match}</span>`)
    .replace(FUNCTIONS, (match) => `<span class="vscode-tok-function">${match}</span>`)
    .replace(TYPES, (match) => `<span class="vscode-tok-type">${match}</span>`)
    .replace(NUMBERS, (match) => `<span class="vscode-tok-number">${match}</span>`);

  // Restore string placeholders
  stringPlaceholder.forEach((str, i) => {
    html = html.replace(`___STRING_${i}___`, str);
  });

  // Restore comment placeholders
  commentPlaceholder.forEach((cmt, i) => {
    html = html.replace(`___COMMENT_${i}___`, cmt);
  });

  return html;
}

export function VSCodeCodeViewer({
  text,
  name,
  maxCharLimit = 1_000_000,
}: VSCodeCodeViewerProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [formattedText, setFormattedText] = useState<string | null>(null);

  const activeText = formattedText ?? text;
  const isTruncated = activeText.length > maxCharLimit;
  const displayText = isTruncated ? activeText.slice(0, maxCharLimit) : activeText;

  const langInfo = useMemo(() => detectLanguage(name), [name]);
  const lines = useMemo(() => displayText.split('\n'), [displayText]);

  const canFormatJson = useMemo(() => {
    if (langInfo.lang !== 'json' && !name.toLowerCase().endsWith('.json')) return false;
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }, [text, langInfo.lang, name]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleFormatJson = () => {
    if (formattedText) {
      setFormattedText(null);
    } else {
      try {
        const obj = JSON.parse(text);
        setFormattedText(JSON.stringify(obj, null, 2));
      } catch {
        /* ignore */
      }
    }
  };

  const highlightedLines = useMemo(() => {
    // For very large text files (> 3000 lines), render plain text fast without regex tokenize
    if (lines.length > 3000) {
      return lines.map((l) => escapeHtml(l) || '&nbsp;');
    }
    return lines.map((line) => highlightLine(line, langInfo.lang));
  }, [lines, langInfo.lang]);

  return (
    <div className="vscode-editor-container">
      <div className="vscode-editor-head">
        <div className="vscode-head-left">
          <Code2 size={15} className="vscode-icon-blue" />
          <span className="vscode-lang-tag">{langInfo.name}</span>
          <span className="vscode-head-meta">
            {lines.length.toLocaleString()} baris · {formatDriveBytes(activeText.length)}
          </span>
          {formattedText && (
            <span className="vscode-badge-formatted">
              <Sparkles size={11} /> Format JSON
            </span>
          )}
        </div>

        <div className="vscode-head-actions">
          {canFormatJson && (
            <button
              type="button"
              className={`vscode-action-btn ${formattedText ? 'is-active' : ''}`}
              onClick={handleFormatJson}
              title={formattedText ? 'Kembalikan format asli' : 'Rapikan Format JSON'}
            >
              <Sparkles size={13} />
              <span>{formattedText ? 'Format Asli' : 'Pretty JSON'}</span>
            </button>
          )}

          <button
            type="button"
            className={`vscode-action-btn ${wordWrap ? 'is-active' : ''}`}
            onClick={() => setWordWrap(!wordWrap)}
            title="Potong baris panjang (Word Wrap)"
          >
            <WrapText size={13} />
            <span>Wrap</span>
          </button>

          <button
            type="button"
            className="vscode-action-btn is-primary"
            onClick={() => void handleCopyCode()}
            title={t('speedtest.copy_code_tooltip') || "Copy code to clipboard"}
          >
            {copied ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
            <span>{copied ? 'Tersalin!' : 'Salin Kode'}</span>
          </button>
        </div>
      </div>

      <div className={`vscode-editor-body ${wordWrap ? 'is-wrap' : 'is-scroll'}`}>
        <div className="vscode-line-numbers" aria-hidden="true">
          {lines.map((_, i) => (
            <span key={i + 1} className="vscode-num">
              {i + 1}
            </span>
          ))}
        </div>

        <pre className="vscode-code-pre">
          {highlightedLines.map((lineHtml, i) => (
            <div
              key={i + 1}
              className="vscode-code-line"
              dangerouslySetInnerHTML={{ __html: lineHtml }}
            />
          ))}
          {isTruncated && (
            <div className="vscode-code-truncated">
              ⚠️ Tampilan dipotong pada 1.000.000 karakter untuk performa. Gunakan tombol 'Salin Kode' atau 'Unduh' untuk isi utuh.
            </div>
          )}
        </pre>
      </div>
    </div>
  );
}
