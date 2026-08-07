import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  Download,
  Bookmark,
  RotateCcw,
  Save,
  Search,
  Zap,
  Film,
  Cpu,
  Sliders,
  ShieldAlert,
  Trash2,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  FolderTree,
  CopyCheck,
  HardDriveUpload,
  Network,
  SlidersHorizontal,
  X,
  ArrowLeft,
  ChevronRight,
  Plus,
  ChevronDown,
  Copy,
  Undo,
  Redo,
  MessageSquare,
  Code,
  Link,
  AtSign,
  List,
  ListOrdered,
  Send,
  Play,
  Tv,
  MonitorPlay,
  Activity,
} from 'lucide-react';
import type {
  CaptionPosition,
  DriveTransferSettings,
  DriveTransferSettingsProfile,
  ReencodeHardware,
} from '../../../lib/telegram/driveTypes';
import { PerfSection } from '../../../pages/Settings/PerfSection';
import { NetworkSection } from '../../../pages/Settings/NetworkSection';
import {
  DEFAULT_TRANSFER_SETTINGS,
  loadTransferSettingsProfiles,
  saveTransferSettingsProfiles,
} from '../../../lib/telegram/driveTypes';
import { clearAvatarCache } from '../../../lib/media/avatarBatcher';
import {
  loadSelectableSessions,
  getSessionMetadata,
  type SessionOption,
} from '../../../lib/telegram/core/sessionPicker';

function getEffectiveCaptionPosition(draft: { captionPosition?: CaptionPosition; captionAbove?: boolean }): CaptionPosition {
  if (draft.captionPosition) return draft.captionPosition;
  if (draft.captionAbove) return 'on_media_above';
  return 'on_media';
}

function getCaptionPositionBadgeLabel(pos: CaptionPosition): string {
  switch (pos) {
    case 'on_media_above': return 'Caption di ATAS Media';
    case 'before_media': return 'Pesan Sebelum Media';
    case 'after_media': return 'Pesan Setelah Media';
    case 'none': return 'Tanpa Caption';
    case 'on_media':
    default: return 'Caption Pada Media';
  }
}
import { MediaSelect } from '../Navigation/MediaSelect';
import { useTransferHardwareCapabilities } from '../../../stores/transferProgressStore';
import { buildEncoderHardwareOptions } from './encoderHardwareOptions';
import {
  applyUnifiedEncodingMode,
  normalizeTransferSettings,
  resolveUnifiedEncodingMode,
  SYSTEM_TRANSFER_PRESETS,
  validateTransferSettings,
  getDeliveryFormatMode,
  applyDeliveryFormatMode,
} from './transferSettingsModel';
import {
  buildSearchRegistry,
  searchSettingsRegistry,
  type SearchableSettingItem,
  type SubMenuCategory,
} from './transferSettingsSearchRegistry';

function captionToEditorHtml(text: string, mode: 'MarkdownV2' | 'HTML' | 'Plain'): string {
  if (!text) return '<p><br></p>';
  const lines = text.split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^•\s+(.*)/);
    const numMatch = line.match(/^(\d+)[\.\\]\.\s+(.*)/) || line.match(/^(\d+)\.\s+(.*)/);

    const formatLineText = (s: string) => {
      if (mode === 'MarkdownV2') {
        return s
          .replace(/\|\|(.*?)\|\|/g, '<span class="spoiler">$1</span>')
          .replace(/\*(.*?)\*/g, '<b>$1</b>')
          .replace(/_(.*?)_/g, '<i>$1</i>')
          .replace(/__(.*?)__/g, '<u>$1</u>')
          .replace(/~(.*?)~/g, '<s>$1</s>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
      }
      if (mode === 'HTML') {
        return s.replace(/<tg-spoiler>(.*?)<\/tg-spoiler>/gi, '<span class="spoiler">$1</span>');
      }
      return s;
    };

    if (bulletMatch) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul class="td-editable-ul">'; inUl = true; }
      html += `<li>${formatLineText(bulletMatch[1])}</li>`;
    } else if (numMatch) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol class="td-editable-ol">'; inOl = true; }
      html += `<li>${formatLineText(numMatch[2])}</li>`;
    } else {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (inOl) { html += '</ol>'; inOl = false; }
      html += line ? `<p>${formatLineText(line)}</p>` : '<p><br></p>';
    }
  }
  if (inUl) html += '</ul>';
  if (inOl) html += '</ol>';
  return html;
}

function domToCaptionText(container: HTMLElement, parseMode: 'MarkdownV2' | 'HTML' | 'Plain'): string {
  const escapeMd = (s: string) => s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const processNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.nodeValue || '';
      return parseMode === 'MarkdownV2' ? escapeMd(val) : parseMode === 'HTML' ? escapeHtml(val) : val;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const children = () => Array.from(el.childNodes).map(processNode).join('');
    const rawText = () => el.textContent || '';

    if (tag === 'br') return '\n';
    if (tag === 'b' || tag === 'strong') {
      return parseMode === 'HTML' ? `<b>${children()}</b>` : parseMode === 'MarkdownV2' ? `*${children()}*` : children();
    }
    if (tag === 'i' || tag === 'em') {
      return parseMode === 'HTML' ? `<i>${children()}</i>` : parseMode === 'MarkdownV2' ? `_${children()}_` : children();
    }
    if (tag === 'u') {
      return parseMode === 'HTML' ? `<u>${children()}</u>` : parseMode === 'MarkdownV2' ? `__${children()}__` : children();
    }
    if (tag === 's' || tag === 'strike') {
      return parseMode === 'HTML' ? `<s>${children()}</s>` : parseMode === 'MarkdownV2' ? `~${children()}~` : children();
    }
    if (tag === 'span' && (el.classList.contains('spoiler') || el.classList.contains('td-tg-spoiler'))) {
      return parseMode === 'HTML' ? `<tg-spoiler>${children()}</tg-spoiler>` : parseMode === 'MarkdownV2' ? `||${children()}||` : children();
    }
    if (tag === 'code') {
      return parseMode === 'HTML' ? `<code>${children()}</code>` : parseMode === 'MarkdownV2' ? `\`${rawText()}\`` : rawText();
    }
    if (tag === 'pre') {
      return parseMode === 'HTML' ? `<pre>${children()}</pre>\n` : parseMode === 'MarkdownV2' ? `\`\`\`\n${rawText().trimEnd()}\n\`\`\`\n` : rawText() + '\n';
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      return parseMode === 'HTML' ? `<a href="${href}">${children()}</a>` : parseMode === 'MarkdownV2' ? `[${children()}](${href})` : children();
    }
    if (tag === 'blockquote') {
      const isExpandable = el.getAttribute('data-expandable') === 'true' || el.hasAttribute('expandable');
      if (parseMode === 'HTML') {
        return isExpandable ? `<blockquote expandable>${children()}</blockquote>\n` : `<blockquote>${children()}</blockquote>\n`;
      }
      if (parseMode === 'MarkdownV2') {
        const lines = rawText().trim().split('\n').map((l) => `> ${escapeMd(l)}`).join('\n');
        return isExpandable ? `${lines}||\n` : `${lines}\n`;
      }
      return rawText() + '\n';
    }
    if (tag === 'ul') {
      return Array.from(el.children)
        .map((li) => `• ${processNode(li).trim()}`)
        .join('\n') + '\n';
    }
    if (tag === 'ol') {
      return Array.from(el.children)
        .map((li, idx) => `${idx + 1}. ${processNode(li).trim()}`)
        .join('\n') + '\n';
    }
    if (tag === 'li') return children();
    if (tag === 'p' || tag === 'div') return children().trimEnd() + '\n';

    return children();
  };

  return Array.from(container.childNodes)
    .map(processNode)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type WorkspaceTabState = 'menu' | SubMenuCategory;

export interface TransferSettingsWorkspaceProps {
  settings: DriveTransferSettings;
  onChange: (next: DriveTransferSettings) => void;
  onClose?: () => void;
  transferActive?: boolean;
  embedded?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onSelectTool?: (toolTab: string) => void;
  activeCategory?: SubMenuCategory;
}

export function TransferSettingsWorkspace({
  settings,
  onChange,
  onClose,
  transferActive,
  embedded = false,
  searchQuery: propsSearchQuery,
  onSearchQueryChange: propsOnSearchQueryChange,
  onSelectTool,
  activeCategory: propsActiveCategory,
}: TransferSettingsWorkspaceProps) {
  const { t } = useTranslation();
  const searchInputId = useId();

  // Navigation state: direct sub-menu category (never default to intermediate menu)
  const [activeTab, setActiveTab] = useState<WorkspaceTabState>(() => propsActiveCategory || 'upload');

  useEffect(() => {
    if (propsActiveCategory) {
      setActiveTab(propsActiveCategory);
    } else if (activeTab === 'menu') {
      setActiveTab('upload');
    }
  }, [propsActiveCategory, activeTab]);
  const [internalSettingsQuery, setInternalSettingsQuery] = useState('');

  const settingsQuery = propsSearchQuery !== undefined ? propsSearchQuery : internalSettingsQuery;
  const setSettingsQuery = propsOnSearchQueryChange || setInternalSettingsQuery;

  // Drawer / Modal overlays
  const [showPresetDrawer, setShowPresetDrawer] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showTabResetConfirm, setShowTabResetConfirm] = useState(false);

  // Session picker state for alternate account pool
  const [availableSessions, setAvailableSessions] = useState<SessionOption[]>([]);

  useEffect(() => {
    let active = true;
    loadSelectableSessions({ verify: false }).then((res) => {
      if (active && Array.isArray(res)) {
        setAvailableSessions(res);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [baseline, setBaseline] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));
  const [draft, setDraft] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));

  // Profile manager state
  const [profiles, setProfiles] = useState<DriveTransferSettingsProfile[]>(() => loadTransferSettingsProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [pendingProfileLoad, setPendingProfileLoad] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownDirection, setDropdownDirection] = useState<'down' | 'up'>('down');
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const toggleDropdown = () => {
    if (!isDropdownOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 230 && spaceAbove > spaceBelow) {
        setDropdownDirection('up');
      } else {
        setDropdownDirection('down');
      }
    }
    setIsDropdownOpen((prev) => !prev);
  };

  // High-Level Intelligence Engine: Conflict Resolution Hints
  const conflictAnalysis = useMemo(() => {
    const hints: Array<{ id: string; title: string; desc: string }> = [];

    if ((draft.presentationOverride === 'force_document' || draft.forceDocumentDefault) && draft.spoiler) {
      hints.push({
        id: 'doc-spoiler',
        title: 'Kecerdasan Auto-Suppress Spoiler Dokumen',
        desc: 'Telegram API menolak efek spoiler pada dokumen (file). AutoGram secara otomatis hanya akan menerapkan spoiler pada foto/video native.',
      });
    }

    if (draft.groupAsAlbum) {
      hints.push({
        id: 'album-orchestration',
        title: 'Kecerdasan Orkes Album Multi-Kategori',
        desc: 'Telegram memisahkan album Foto/Video, Dokumen, dan Audio. AutoGram secara otomatis membagi berkas menjadi batch album terpisah yang 100% kompatibel.',
      });
    }

    if ((draft.globalCaption?.length || 0) > 1024 && draft.captionOverflowPolicy === 'split') {
      hints.push({
        id: 'caption-split',
        title: 'Kecerdasan Auto-Split Caption Panjang',
        desc: 'Caption melebihi 1.024 karakter. 1.024 karakter pertama dikirim bersama media, dan sisanya dikirim otomatis sebagai pesan balasan teks lanjutan.',
      });
    }

    return hints;
  }, [
    draft.presentationOverride,
    draft.forceDocumentDefault,
    draft.spoiler,
    draft.groupAsAlbum,
    draft.globalCaption,
    draft.captionOverflowPolicy,
  ]);

  // Telegram Caption Studio State & Helpers
  const [captionTab, setCaptionTab] = useState<'editor' | 'preview'>('editor');
  const [editorMode, setEditorMode] = useState<'visual' | 'raw'>('visual');
  const [captionToast, setCaptionToast] = useState<string | null>(null);
  const captionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editableDivRef = useRef<HTMLDivElement | null>(null);
  const captionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editorMode === 'visual' && editableDivRef.current) {
      if (document.activeElement !== editableDivRef.current) {
        editableDivRef.current.innerHTML = captionToEditorHtml(
          draft.globalCaption || '',
          draft.captionParseMode || 'MarkdownV2'
        );
      }
    }
  }, [captionTab, editorMode, draft.captionParseMode]);

  const handleEditableInput = (immediate = false) => {
    if (captionSyncTimerRef.current) clearTimeout(captionSyncTimerRef.current);

    const doSync = () => {
      if (!editableDivRef.current) return;
      const parsedText = domToCaptionText(editableDivRef.current, draft.captionParseMode || 'MarkdownV2');
      patch({ globalCaption: parsedText });
    };

    if (immediate === true) {
      doSync();
    } else {
      captionSyncTimerRef.current = setTimeout(doSync, 180);
    }
  };

  const execCaptionFormatting = (formatType: string) => {
    if (editorMode === 'visual' && editableDivRef.current) {
      editableDivRef.current.focus();
      if (formatType === 'undo') document.execCommand('undo', false);
      else if (formatType === 'redo') document.execCommand('redo', false);
      else if (formatType === 'bold') document.execCommand('bold', false);
      else if (formatType === 'italic') document.execCommand('italic', false);
      else if (formatType === 'underline') document.execCommand('underline', false);
      else if (formatType === 'strike') document.execCommand('strikeThrough', false);
      else if (formatType === 'bullet') document.execCommand('insertUnorderedList', false);
      else if (formatType === 'numbered') document.execCommand('insertOrderedList', false);
      else if (formatType === 'removeFormat') document.execCommand('removeFormat', false);
      else if (formatType === 'spoiler') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const span = document.createElement('span');
          span.className = 'spoiler';
          span.textContent = range.toString() || 'spoiler';
          range.deleteContents();
          range.insertNode(span);
        }
      } else if (formatType === 'quote') {
        document.execCommand('formatBlock', false, 'blockquote');
      } else if (formatType === 'code') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const code = document.createElement('code');
          code.textContent = range.toString() || 'code';
          range.deleteContents();
          range.insertNode(code);
        }
      } else if (formatType === 'pre') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const pre = document.createElement('pre');
          pre.textContent = range.toString() || 'code block';
          range.deleteContents();
          range.insertNode(pre);
        }
      } else if (formatType === 'link') {
        const url = prompt('Masukkan URL Telegram / Web:', 'https://t.me/tokokita') || 'https://t.me/tokokita';
        document.execCommand('createLink', false, url);
      } else if (formatType === 'mention') {
        const userId = prompt('Masukkan Telegram User ID:', '123456789') || '123456789';
        document.execCommand('createLink', false, `tg://user?id=${userId}`);
      }

      handleEditableInput(true);
    } else {
      applyCaptionFormatting(formatType);
    }
  };

  const triggerCaptionToast = (msg: string) => {
    setCaptionToast(msg);
    setTimeout(() => setCaptionToast(null), 1800);
  };

  const copyCaptionOutput = async () => {
    const rawText = draft.globalCaption || '';
    if (!rawText) {
      triggerCaptionToast('⚠️ Caption kosong');
      return;
    }

    try {
      const mode = draft.captionParseMode || 'MarkdownV2';
      let htmlSnippet = rawText;

      if (mode === 'HTML') {
        htmlSnippet = rawText
          .replace(/<tg-spoiler>(.*?)<\/tg-spoiler>/gi, '<span class="tg-spoiler">$1</span>')
          .replace(/<blockquote expandable>(.*?)<\/blockquote>/gi, '<blockquote>$1</blockquote>');
      } else if (mode === 'MarkdownV2') {
        htmlSnippet = rawText
          .replace(/\|\|(.*?)\|\|/g, '<span class="tg-spoiler">$1</span>')
          .replace(/\*(.*?)\*/g, '<b>$1</b>')
          .replace(/_(.*?)_/g, '<i>$1</i>')
          .replace(/__(.*?)__/g, '<u>$1</u>')
          .replace(/~(.*?)~/g, '<s>$1</s>')
          .replace(/```\n?([\s\S]*?)\n?```/g, '<pre>$1</pre>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
          .replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>');
      }

      htmlSnippet = htmlSnippet.replace(/\n/g, '<br/>');

      const textBlob = new Blob([rawText], { type: 'text/plain' });
      const htmlBlob = new Blob([htmlSnippet], { type: 'text/html' });

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          }),
        ]);
        triggerCaptionToast('⚡ Tersalin! Format otomatis terkonversi di Telegram (Ctrl+V)');
      } else {
        await navigator.clipboard.writeText(rawText);
        triggerCaptionToast('⚡ Teks tersalin!');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(rawText);
        triggerCaptionToast('⚡ Teks tersalin!');
      } catch {
        triggerCaptionToast('❌ Gagal menyalin caption');
      }
    }
  };

  const handleCaptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value;

      // Find current line
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const currentLine = val.slice(lineStart, start);

      const bulletMatch = currentLine.match(/^(\s*)(•|☑)\s*(.*)/);
      const numMatch = currentLine.match(/^(\s*)(\d+)\.\s*(.*)/);

      if (bulletMatch) {
        const [, indent, symbol, content] = bulletMatch;
        if (!content.trim()) {
          // Empty bullet line -> clear bullet and cancel list mode
          e.preventDefault();
          const newVal = val.slice(0, lineStart) + val.slice(start);
          patch({ globalCaption: newVal });
          setTimeout(() => {
            if (captionTextareaRef.current) {
              captionTextareaRef.current.setSelectionRange(lineStart, lineStart);
            }
          }, 0);
          return;
        }
        // Continue bullet on new line
        e.preventDefault();
        const insertText = `\n${indent}${symbol} `;
        const newVal = val.slice(0, start) + insertText + val.slice(end);
        patch({ globalCaption: newVal });
        setTimeout(() => {
          if (captionTextareaRef.current) {
            const nextPos = start + insertText.length;
            captionTextareaRef.current.setSelectionRange(nextPos, nextPos);
          }
        }, 0);
        return;
      }

      if (numMatch) {
        const [, indent, numStr, content] = numMatch;
        if (!content.trim()) {
          // Empty number line -> clear number and cancel numbering mode
          e.preventDefault();
          const newVal = val.slice(0, lineStart) + val.slice(start);
          patch({ globalCaption: newVal });
          setTimeout(() => {
            if (captionTextareaRef.current) {
              captionTextareaRef.current.setSelectionRange(lineStart, lineStart);
            }
          }, 0);
          return;
        }
        // Continue numbered list on new line
        e.preventDefault();
        const nextNum = parseInt(numStr, 10) + 1;
        const insertText = `\n${indent}${nextNum}. `;
        const newVal = val.slice(0, start) + insertText + val.slice(end);
        patch({ globalCaption: newVal });
        setTimeout(() => {
          if (captionTextareaRef.current) {
            const nextPos = start + insertText.length;
            captionTextareaRef.current.setSelectionRange(nextPos, nextPos);
          }
        }, 0);
        return;
      }
    }
  };

  const applyCaptionFormatting = (formatType: string) => {
    if (!captionTextareaRef.current) return;
    const el = captionTextareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = draft.globalCaption || '';
    const selectedText = text.slice(start, end) || 'teks';
    const parseMode = draft.captionParseMode || 'MarkdownV2';

    let before = text.slice(0, start);
    let after = text.slice(end);
    let wrapped = selectedText;

    if (formatType === 'bullet') {
      const lines = selectedText.split('\n');
      wrapped = lines.map((l) => (l.startsWith('• ') ? l : `• ${l}`)).join('\n');
    } else if (formatType === 'numbered') {
      const lines = selectedText.split('\n');
      wrapped = lines
        .map((l, idx) => {
          const cleaned = l.replace(/^\d+\.\s*/, '');
          return `${idx + 1}. ${cleaned}`;
        })
        .join('\n');
    } else if (formatType === 'checklist') {
      const lines = selectedText.split('\n');
      wrapped = lines.map((l) => (l.startsWith('☑ ') ? l : `☑ ${l}`)).join('\n');
    } else if (parseMode === 'MarkdownV2') {
      switch (formatType) {
        case 'bold': wrapped = `*${selectedText}*`; break;
        case 'italic': wrapped = `_${selectedText}_`; break;
        case 'underline': wrapped = `__${selectedText}__`; break;
        case 'strike': wrapped = `~${selectedText}~`; break;
        case 'spoiler': wrapped = `||${selectedText}||`; break;
        case 'code': wrapped = `\`${selectedText}\``; break;
        case 'pre': wrapped = `\`\`\`\n${selectedText}\n\`\`\``; break;
        case 'quote': wrapped = `> ${selectedText}`; break;
        case 'expandable': wrapped = `> ${selectedText}||\n`; break;
        case 'link': {
          const url = prompt('Masukkan URL Telegram / Web:', 'https://t.me/tokokita') || 'https://t.me/tokokita';
          wrapped = `[${selectedText}](${url})`;
          break;
        }
        case 'mention': {
          const userId = prompt('Masukkan Telegram User ID:', '123456789') || '123456789';
          wrapped = `[${selectedText}](tg://user?id=${userId})`;
          break;
        }
        case 'removeFormat': {
          wrapped = selectedText.replace(/[*_~`|>[\]()]/g, '');
          break;
        }
      }
    } else if (parseMode === 'HTML') {
      switch (formatType) {
        case 'bold': wrapped = `<b>${selectedText}</b>`; break;
        case 'italic': wrapped = `<i>${selectedText}</i>`; break;
        case 'underline': wrapped = `<u>${selectedText}</u>`; break;
        case 'strike': wrapped = `<s>${selectedText}</s>`; break;
        case 'spoiler': wrapped = `<tg-spoiler>${selectedText}</tg-spoiler>`; break;
        case 'code': wrapped = `<code>${selectedText}</code>`; break;
        case 'pre': wrapped = `<pre>${selectedText}</pre>`; break;
        case 'quote': wrapped = `<blockquote>${selectedText}</blockquote>`; break;
        case 'expandable': wrapped = `<blockquote expandable>${selectedText}</blockquote>`; break;
        case 'link': {
          const url = prompt('Masukkan URL Telegram / Web:', 'https://t.me/tokokita') || 'https://t.me/tokokita';
          wrapped = `<a href="${url}">${selectedText}</a>`;
          break;
        }
        case 'mention': {
          const userId = prompt('Masukkan Telegram User ID:', '123456789') || '123456789';
          wrapped = `<a href="tg://user?id=${userId}">${selectedText}</a>`;
          break;
        }
        case 'removeFormat': {
          wrapped = selectedText.replace(/<[^>]*>/g, '');
          break;
        }
      }
    } else {
      switch (formatType) {
        case 'removeFormat': {
          wrapped = selectedText.replace(/<[^>]*>/g, '').replace(/[*_~`|>[\]()]/g, '');
          break;
        }
      }
    }

    const nextText = before + wrapped + after;
    patch({ globalCaption: nextText });
    setTimeout(() => {
      if (captionTextareaRef.current) {
        captionTextareaRef.current.focus();
        captionTextareaRef.current.setSelectionRange(start + wrapped.length, start + wrapped.length);
      }
    }, 15);
  };

  const telegramPreviewHtml = useMemo(() => {
    const text = draft.globalCaption || '';
    if (!text) return '<span style="color: #64748b; font-style: italic;">Pratinjau caption kosong…</span>';
    const mode = draft.captionParseMode || 'MarkdownV2';

    const parseInline = (str: string) => {
      if (mode === 'HTML') {
        return str
          .replace(/<tg-spoiler>(.*?)<\/tg-spoiler>/gi, '<span class="td-tg-spoiler" title="Spoiler Telegram">$1</span>')
          .replace(/<blockquote expandable>(.*?)<\/blockquote>/gi, '<blockquote class="td-tg-quote expandable" title="Kutipan dapat diperluas">$1</blockquote>')
          .replace(/<blockquote>(.*?)<\/blockquote>/gi, '<blockquote class="td-tg-quote">$1</blockquote>')
          .replace(/<code>(.*?)<\/code>/gi, '<code class="td-tg-code">$1</code>')
          .replace(/<pre>(.*?)<\/pre>/gi, '<pre class="td-tg-pre">$1</pre>')
          .replace(/<a href="(.*?)">(.*?)<\/a>/gi, '<a href="$1" target="_blank" rel="noreferrer" class="td-tg-link">$2</a>');
      }
      if (mode === 'MarkdownV2') {
        return str
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\|\|(.*?)\|\|/g, '<span class="td-tg-spoiler" title="Spoiler Telegram">$1</span>')
          .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
          .replace(/_(.*?)_/g, '<em>$1</em>')
          .replace(/__(.*?)__/g, '<u>$1</u>')
          .replace(/~(.*?)~/g, '<s>$1</s>')
          .replace(/```\n?([\s\S]*?)\n?```/g, '<pre class="td-tg-pre">$1</pre>')
          .replace(/`([^`]+)`/g, '<code class="td-tg-code">$1</code>')
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="td-tg-link">$1</a>')
          .replace(/^&gt;\s?(.*)$/gm, '<blockquote class="td-tg-quote">$1</blockquote>');
      }
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    const lines = text.split('\n');
    let html = '';
    let inUl = false;
    let inOl = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bulletMatch = line.match(/^•\s+(.*)/);
      const numMatch = line.match(/^(\d+)\\\.\s+(.*)/) || line.match(/^(\d+)\.\s+(.*)/);

      if (bulletMatch) {
        if (inOl) { html += '</ol>'; inOl = false; }
        if (!inUl) { html += '<ul class="td-tg-ul">'; inUl = true; }
        html += `<li>${parseInline(bulletMatch[1])}</li>`;
      } else if (numMatch) {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (!inOl) { html += '<ol class="td-tg-ol">'; inOl = true; }
        html += `<li>${parseInline(numMatch[2])}</li>`;
      } else {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (inOl) { html += '</ol>'; inOl = false; }
        html += (i > 0 && lines[i - 1] !== '' && !lines[i - 1].startsWith('•') && !lines[i - 1].match(/^\d+[\.\\]\./) ? '<br/>' : '') + parseInline(line);
      }
    }

    if (inUl) html += '</ul>';
    if (inOl) html += '</ol>';

    return html;
  }, [draft.globalCaption, draft.captionParseMode]);

  const { hardwareCapabilities, isDetectingHardware, fetchHardwareCapabilities } = useTransferHardwareCapabilities();

  useEffect(() => {
    fetchHardwareCapabilities();
  }, [fetchHardwareCapabilities]);

  // Search registry
  const searchRegistry = useMemo(() => buildSearchRegistry(t), [t]);
  const searchResults = useMemo(
    () => searchSettingsRegistry(searchRegistry, settingsQuery),
    [searchRegistry, settingsQuery]
  );

  // Unsaved changes check
  const isDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }, [draft, baseline]);

  // Validation
  const validation = useMemo(
    () => validateTransferSettings(draft, hardwareCapabilities),
    [draft, hardwareCapabilities]
  );

  const patch = (partial: Partial<DriveTransferSettings>) => {
    setDraft((prev) => {
      const next = normalizeTransferSettings({ ...prev, ...partial });
      const validResult = validateTransferSettings(next, hardwareCapabilities);
      if (validResult.valid) {
        onChange(validResult.normalized);
        setBaseline(validResult.normalized);
      }
      return next;
    });
  };

  const resetAll = () => {
    const next = normalizeTransferSettings(DEFAULT_TRANSFER_SETTINGS);
    setDraft(next);
    setBaseline(next);
    onChange(next);
    setShowResetConfirm(false);
  };

  const resetCurrentSection = (cat: WorkspaceTabState) => {
    const defaults = DEFAULT_TRANSFER_SETTINGS;
    let sectionFields: Partial<DriveTransferSettings> = {};

    switch (cat) {
      case 'upload':
        sectionFields = {
          qualityMode: defaults.qualityMode,
          uploadConcurrency: defaults.uploadConcurrency,
          groupAsAlbum: defaults.groupAsAlbum,
          silent: defaults.silent,
          spoiler: defaults.spoiler,
          spoilerItemPositions: defaults.spoilerItemPositions,
          scheduleAt: defaults.scheduleAt,
          sendAs: defaults.sendAs,
          forceDocumentDefault: defaults.forceDocumentDefault,
          enableGlobalCaption: defaults.enableGlobalCaption,
          globalCaption: defaults.globalCaption,
          captionOverflowPolicy: defaults.captionOverflowPolicy,
          captionParseMode: defaults.captionParseMode,
          captionAbove: defaults.captionAbove,
          captionPosition: defaults.captionPosition,
        };
        break;
      case 'download':
        sectionFields = {
          downloadConcurrency: defaults.downloadConcurrency,
          downloadConflictPolicy: defaults.downloadConflictPolicy,
          downloadResumePartial: defaults.downloadResumePartial,
          downloadIntegrity: defaults.downloadIntegrity,
          notifyDownloadDone: defaults.notifyDownloadDone,
        };
        break;
      case 'encoding':
        sectionFields = {
          reencodeHardware: defaults.reencodeHardware,
          reencodePreset: defaults.reencodePreset,
          presentationOverride: defaults.presentationOverride,
          encoderStrategy: defaults.encoderStrategy,
          encoderResourceProfile: defaults.encoderResourceProfile,
          encoderMaxParallel: defaults.encoderMaxParallel,
          encoderAllowSoftwareFallback: defaults.encoderAllowSoftwareFallback,
        };
        break;
      case 'albums':
        sectionFields = {
          albumPacking: defaults.albumPacking,
          albumGroupSize: defaults.albumGroupSize,
          albumAvoidSingle: defaults.albumAvoidSingle,
          albumFailurePolicy: defaults.albumFailurePolicy,
          groupDocuments: defaults.groupDocuments,
          groupAudio: defaults.groupAudio,
          groupOriginalDocuments: defaults.groupOriginalDocuments,
        };
        break;
      case 'duplicates':
        sectionFields = {
          duplicatePolicy: defaults.duplicatePolicy,
          scanMode: defaults.scanMode,
          guardrailEnabled: defaults.guardrailEnabled,
          guardrailThresholdDays: defaults.guardrailThresholdDays,
          topicScope: defaults.topicScope,
          maxReuploadPerHour: defaults.maxReuploadPerHour,
        };
        break;
      case 'limits_recovery':
        sectionFields = {
          oversizeAction: defaults.oversizeAction,
          alternateAccountPool: defaults.alternateAccountPool,
          alternateIdentityApproved: defaults.alternateIdentityApproved,
          albumAlternateStrategy: defaults.albumAlternateStrategy,
        };
        break;
      case 'advanced':
        sectionFields = {
          refreshAfterUpload: defaults.refreshAfterUpload,
          autoRetryOnNetworkError: defaults.autoRetryOnNetworkError,
          smartRateControlEnabled: defaults.smartRateControlEnabled,
          debugLoggingEnabled: defaults.debugLoggingEnabled,
        };
        break;
    }

    patch(sectionFields);
    const catLabel = subMenuCategories.find((c) => c.id === cat)?.label || 'halaman ini';
    triggerCaptionToast(`✨ Pengaturan ${catLabel} berhasil di-reset ke default.`);
  };

  const applyPreset = (presetSettings: Partial<DriveTransferSettings>) => {
    const next = normalizeTransferSettings({ ...draft, ...presetSettings });
    const validResult = validateTransferSettings(next, hardwareCapabilities);
    setDraft(next);
    if (validResult.valid) {
      onChange(validResult.normalized);
      setBaseline(validResult.normalized);
    }
  };

  const loadProfile = (id: string) => {
    if (isDirty) {
      setPendingProfileLoad(id);
      return;
    }
    executeLoadProfile(id);
  };

  const executeLoadProfile = (id: string) => {
    setSelectedProfileId(id);
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setProfileName(profile.name);
    const next = normalizeTransferSettings(profile.settings);
    setDraft(next);
    setBaseline(next);
    onChange(next);
    setPendingProfileLoad(null);
  };

  const saveProfile = () => {
    const name = profileName.trim().slice(0, 80);
    if (!name) return;
    const id = selectedProfileId || (globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}`);
    const nextProfile: DriveTransferSettingsProfile = {
      id,
      name,
      updatedAt: Date.now(),
      settings: { ...draft },
    };
    const next = [nextProfile, ...profiles.filter((p) => p.id !== id)];
    setProfiles(next);
    setSelectedProfileId(id);
    saveTransferSettingsProfiles(next);
  };

  const deleteProfile = () => {
    if (!selectedProfileId) return;
    const next = profiles.filter((p) => p.id !== selectedProfileId);
    setProfiles(next);
    setSelectedProfileId('');
    setProfileName('');
    saveTransferSettingsProfiles(next);
  };

  const handleSearchResultClick = (item: SearchableSettingItem) => {
    if (item.isDriveTool) {
      onSelectTool?.(item.tab);
      return;
    }
    setActiveTab(item.tab);
    window.setTimeout(() => {
      const el = document.getElementById(item.sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('td-search-highlight');
        window.setTimeout(() => el.classList.remove('td-search-highlight'), 1800);
      }
    }, 50);
  };

  const hardwareOptions = useMemo(() => {
    return buildEncoderHardwareOptions(hardwareCapabilities, t, isDetectingHardware);
  }, [hardwareCapabilities, isDetectingHardware, t]);

  const currentEncoderMode = useMemo(() => resolveUnifiedEncodingMode(draft), [draft]);
  const currentDeliveryFormat = useMemo(() => getDeliveryFormatMode(draft), [draft]);

  // Identify active preset matching current draft
  const activePresetId = useMemo(() => {
    if (draft.qualityMode === 'ORIGINAL' && currentEncoderMode === 'disabled') return 'preset-archival';
    if (draft.qualityMode === 'HIGH_QUALITY' && draft.uploadConcurrency >= 5) return 'preset-fast-publish';
    if (draft.qualityMode === 'SMART' || (draft.qualityMode === 'HIGH_QUALITY' && draft.uploadConcurrency <= 4)) return 'preset-balanced';
    return null;
  }, [draft, currentEncoderMode]);

  const activePresetName = useMemo(() => {
    const found = SYSTEM_TRANSFER_PRESETS.find((p) => p.id === activePresetId);
    return found ? found.name : t('speedtest.preset_custom', 'Kustom');
  }, [activePresetId, t]);

  // Sub-Menu Categories List (Displays ALL categories directly)
  const subMenuCategories: { id: SubMenuCategory; label: string; desc: string; icon: any }[] = [
    { id: 'upload', label: t('speedtest.tab_upload', 'Upload'), desc: 'Format pengiriman, caption global, penjadwalan & performa paralel unggah', icon: Upload },
    { id: 'download', label: t('speedtest.tab_download', 'Download'), desc: 'Paralelisme unduh, kebijakan konflik nama file, resume & notifikasi', icon: Download },
    { id: 'encoding', label: t('speedtest.tab_encoding', 'Performance & Encoding Video'), desc: 'Mode optimasi performa perangkat, encoder GPU/CPU & kompresi video', icon: Film },
    { id: 'albums', label: t('speedtest.tab_albums', 'Pengelompokan Album'), desc: 'Grouping foto/video menjadi album Telegram & penanganan dokumen', icon: FolderTree },
    { id: 'duplicates', label: t('speedtest.tab_duplicates', 'Penanganan Duplikat'), desc: 'Pencegahan file duplikat & verifikasi 4-level', icon: CopyCheck },
    { id: 'limits_recovery', label: t('speedtest.tab_limits_recovery', 'Penanganan Berkas Besar'), desc: 'Opsi pemotongan berkas (>2GB/4GB) & pengalihan akun Premium', icon: HardDriveUpload },
    { id: 'network', label: t('speedtest.tab_network', 'Proxy & Network'), desc: 'SOCKS5/HTTP/MTProto routing, akselerasi timeout & pengoptimalan VPN', icon: Network },
    { id: 'advanced', label: t('speedtest.tab_advanced', 'Pengaturan Lanjutan'), desc: 'Sinkronisasi tampilan, retry teknis & ekspor/impor konfigurasi', icon: SlidersHorizontal },
  ];

  return (
    <div className={`td-xfer-single-workspace ${embedded ? 'is-embedded' : 'is-standalone'}`}>
      {/* TOP HEADER BAR */}
      <header className="td-xfer-header">
        <div className="td-xfer-header-left">
          {!embedded && activeTab !== 'menu' && (
            <button
              type="button"
              className="td-back-nav-btn"
              onClick={() => setActiveTab('menu')}
            >
              <ArrowLeft size={16} />
              <span>{t('speedtest.back_to_settings', 'Kembali')}</span>
            </button>
          )}

          <div>
            <h3>
              {activeTab === 'menu'
                ? t('speedtest.transfer_settings_title', 'Transfer Settings')
                : subMenuCategories.find((c) => c.id === activeTab)?.label || 'Detail Pengaturan'}
            </h3>
            <p>
              {activeTab === 'menu'
                ? t('speedtest.transfer_settings_subtitle', 'Konfigurasi unggah, unduh, dan pengodean media')
                : subMenuCategories.find((c) => c.id === activeTab)?.desc}
            </p>
          </div>
        </div>

        <div className="td-xfer-header-right">
          {isDirty && (
            <span className="td-dirty-badge">
              <span className="td-dirty-dot" />
              {t('speedtest.unsaved_changes', 'Perubahan belum disimpan')}
            </span>
          )}

          {/* Standalone Search Bar Input & Dropdown */}
          {propsSearchQuery === undefined && (
            <div className="td-xfer-search-wrapper">
              <Search size={14} className="td-search-icon" />
              <input
                id={searchInputId}
                type="text"
                value={settingsQuery}
                onChange={(e) => setSettingsQuery(e.target.value)}
                placeholder={t('speedtest.search_placeholder_short', 'Cari pengaturan…')}
              />
              {settingsQuery.trim() !== '' && (
                <button
                  type="button"
                  className="td-header-search-clear"
                  onClick={() => setSettingsQuery('')}
                  title="Bersihkan pencarian"
                >
                  <X size={12} />
                </button>
              )}

              {settingsQuery.trim() !== '' && (
                <div className="td-search-popover-dropdown">
                  <div className="td-popover-head">
                    <span>Hasil Pencarian ({searchResults.length})</span>
                    <button
                      type="button"
                      className="td-popover-close-btn"
                      onClick={() => setSettingsQuery('')}
                      title="Tutup Hasil"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="td-popover-list">
                    {searchResults.length ? (
                      searchResults.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="td-search-result-row"
                          onClick={() => {
                            handleSearchResultClick(item);
                            setSettingsQuery('');
                          }}
                        >
                          <span className="td-result-tab-badge">
                            {item.tab.toUpperCase()}
                          </span>
                          <div className="td-result-info">
                            <strong className="td-result-title">{item.label}</strong>
                            <span className="td-result-snippet">{item.description || `Pengaturan ${item.label}`}</span>
                          </div>
                          <ChevronRight size={14} className="td-result-arrow" />
                        </button>
                      ))
                    ) : (
                      <div className="td-popover-empty">
                        <Search size={18} style={{ color: '#64748b' }} />
                        <span>Tidak ada pengaturan yang cocok dengan "{settingsQuery}"</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* MAIN FOCUSED WORKSPACE VIEWPORT */}
      <main className="td-xfer-panel-viewport">

        {/* LEVEL 1: MAIN MENU OVERVIEW (PRESET ACTIVE STRIP + CATEGORY LIST BUTTONS) */}
        {activeTab === 'menu' && (
          <div className="td-xfer-menu-page">
            {/* PRESET ACTIVE SUMMARY STRIP */}
            <section className="td-xfer-preset-strip">
              <div className="td-preset-strip-left">
                <Sparkles size={16} className="td-preset-sparkle" />
                <div className="td-preset-summary-info">
                  <span className="td-preset-label-text">
                    {t('speedtest.active_preset_label', 'Preset aktif')}: <strong>{activePresetName}</strong>
                  </span>
                  <span className="td-preset-details-text">
                    • GPU {currentEncoderMode.toUpperCase()} • {draft.uploadConcurrency} Paralel Unggah • {draft.duplicatePolicy === 'SKIP' ? 'Lewati Duplikat' : 'Unggah Ulang'}
                  </span>
                </div>
              </div>

              <div className="td-preset-strip-actions">
                <button
                  type="button"
                  className="td-chip-btn td-chip-primary"
                  onClick={() => setShowPresetDrawer(true)}
                >
                  <Sparkles size={13} /> {t('speedtest.preset_and_profiles_btn', 'Preset & Profil')}
                </button>
              </div>
            </section>

            {/* CATEGORIES BUTTONS LIST GRID (DIRECTLY DISPLAYS ALL CATEGORIES) */}
            <div className="td-category-menu-list">
              {subMenuCategories.map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className="td-category-menu-card"
                    onClick={() => setActiveTab(cat.id)}
                  >
                    <div className="td-cat-card-icon">
                      <Icon size={22} />
                    </div>
                    <div className="td-cat-card-info">
                      <h4>{cat.label}</h4>
                      <p>{cat.desc}</p>
                    </div>
                    <ChevronRight size={18} className="td-cat-arrow" />
                  </button>
                );
              })}
            </div>

            {/* High-Level Intelligence Engine Badges */}
            {conflictAnalysis.length > 0 && (
              <div className="td-intelligence-hints-box" style={{ marginTop: '16px' }}>
                {conflictAnalysis.map((hint) => (
                  <div key={hint.id} className="td-intel-hint-card">
                    <Zap size={16} className="td-intel-icon" />
                    <div>
                      <strong>{hint.title}</strong>
                      <p>{hint.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Validation Warnings inside Summary */}
            {validation.warnings.length > 0 && (
              <div className="td-summary-warning-box" style={{ marginTop: '16px' }}>
                <AlertTriangle size={18} />
                <div>
                  <strong>{t('speedtest.warning_label', 'Peringatan Konfigurasi')}</strong>
                  <p>{validation.warnings[0].message}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEVEL 2: DEDICATED CLEAN SUB-MENU PAGES (SHOWS ALL SETTINGS DIRECTLY INCLUDING ADVANCED OPTIONS) */}

        {/* DEDICATED PAGE: UPLOAD */}
        {activeTab === 'upload' && (
          <div className="td-xfer-focused-panel" id="section-upload-format">
            {/* ==========================================
                SECTION CARD 1: PENGATURAN UNGGAHAN & FORMAT
                ========================================== */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <Upload size={20} className="td-card-icon-primary" />
                <div>
                  <h4>1. Pengaturan Unggahan (Upload)</h4>
                  <p>Atur paralelisme slots unggah & pilih format pengiriman media</p>
                </div>
              </div>

              {/* SUB-SECTION 1.1: PARALEL UNGGAH */}
              <div className="td-settings-subcard">
                <label className="td-field-label">Jumlah Unggahan Paralel (Upload Slots)</label>
                <div className="td-slider-row-box">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={draft.uploadConcurrency}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ uploadConcurrency: Number(e.target.value) })}
                  />
                  <div className="td-slider-value-bar">
                    <span className="td-slider-val">{draft.uploadConcurrency} Berkas</span>
                    <span className="td-concurrency-badge">
                      {draft.uploadConcurrency <= 2 && '🐢 Stabil'}
                      {draft.uploadConcurrency >= 3 && draft.uploadConcurrency <= 6 && '⚡ Seimbang (Rekomendasi)'}
                      {draft.uploadConcurrency >= 7 && '🚀 Kecepatan Tinggi (Maks 10)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* SUB-SECTION 1.2: FORMAT PENGIRIMAN MEDIA */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">Format Pengiriman Media</label>
                <div className="td-radio-tiles-grid">
                  <label className={`td-radio-tile ${currentDeliveryFormat === 'auto' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryFormat"
                      value="auto"
                      checked={currentDeliveryFormat === 'auto'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyDeliveryFormatMode(draft, 'auto'))}
                    />
                    <div>
                      <strong>Otomatis (Direkomendasikan)</strong>
                      <p>Telegram secara cerdas menentukan format terbaik per berkas.</p>
                    </div>
                  </label>

                  <label className={`td-radio-tile ${currentDeliveryFormat === 'telegram' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryFormat"
                      value="telegram"
                      checked={currentDeliveryFormat === 'telegram'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyDeliveryFormatMode(draft, 'telegram'))}
                    />
                    <div>
                      <strong>Media Native Telegram</strong>
                      <p>Kirim sebagai foto / video yang dapat diputar langsung di chat.</p>
                    </div>
                  </label>

                  <label className={`td-radio-tile ${currentDeliveryFormat === 'document' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryFormat"
                      value="document"
                      checked={currentDeliveryFormat === 'document'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyDeliveryFormatMode(draft, 'document'))}
                    />
                    <div>
                      <strong>Dokumen Asli (Uncompressed)</strong>
                      <p>Kirim berkas mentah tanpa pemrosesan pratinjau media.</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* ==========================================
                SECTION CARD 2: CAPTION GLOBAL & TELEGRAM CAPTION STUDIO
                ========================================== */}
            <div className="td-settings-card" style={{ marginTop: '20px' }}>
              <div className="td-card-head td-caption-head-flex">
                <div className="td-caption-head-title">
                  <Sparkles size={20} className="td-card-icon-primary" />
                  <div>
                    <h4>2. Caption Global & Telegram Caption Studio</h4>
                    <p>Format caption kaya dengan dukungan resmi Telegram MarkdownV2 & HTML</p>
                  </div>
                </div>

                {/* SINGLE SLEEK COMPACT MASTER TOGGLE SWITCH */}
                <label className="td-caption-toggle-switch" title="Aktifkan/Matikan Caption Global">
                  <input
                    type="checkbox"
                    checked={draft.enableGlobalCaption ?? false}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ enableGlobalCaption: e.target.checked })}
                  />
                  <span className="td-toggle-slider" />
                  <span className="td-toggle-text">
                    {draft.enableGlobalCaption ? 'Aktif' : 'Nonaktif'}
                  </span>
                </label>
              </div>

              {!draft.enableGlobalCaption ? (
                /* OFF STATE: CLEAN SLEEK 1-LINE HINT BAR */
                <div className="td-caption-off-hint">
                  <MessageSquare size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                  <span>Caption global nonaktif. Seluruh berkas media akan diunggah tanpa lampiran teks caption.</span>
                </div>
              ) : (
                /* ON STATE: TELEGRAM CAPTION STUDIO WORKSPACE */
                <div className="td-caption-studio-shell" style={{ marginTop: '16px' }}>
                  {/* STUDIO TOP NAVIGATION TABS BAR */}
                  <div className="td-studio-top-bar">
                    <div className="td-caption-studio-tabs">
                      <button
                        type="button"
                        className={`td-studio-tab-btn ${captionTab === 'editor' ? 'active' : ''}`}
                        onClick={() => setCaptionTab('editor')}
                      >
                        ✏️ Visual Editor Studio
                      </button>
                      <button
                        type="button"
                        className={`td-studio-tab-btn ${captionTab === 'preview' ? 'active' : ''}`}
                        onClick={() => setCaptionTab('preview')}
                      >
                        👁️ Preview Telegram
                      </button>
                    </div>
                  </div>

                  {captionTab === 'editor' ? (
                    <>
                      {/* TOP RIBBON TOOLBAR */}
                      <div className="td-caption-ribbon-wrap">
                        <div className="td-caption-ribbon">
                          {/* GROUP 1: CLIPBOARD & RIWAYAT */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('undo')}
                              title="Urungkan Perubahan (Undo - Ctrl+Z)"
                            >
                              <Undo size={15} />
                              <span>Undo</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('redo')}
                              title="Ulangi Perubahan (Redo - Ctrl+Y)"
                            >
                              <Redo size={15} />
                              <span>Redo</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={copyCaptionOutput}
                              title="Salin Output Text"
                            >
                              <Copy size={15} />
                              <span>Salin</span>
                            </button>
                            <div className="td-ribbon-group-title">CLIPBOARD & RIWAYAT</div>
                          </div>

                          {/* GROUP 2: FORMAT TEKS */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('bold')}
                              title="Tebal (*bold*)"
                            >
                              <b>B</b>
                              <span>Tebal</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('italic')}
                              title="Miring (_italic_)"
                            >
                              <i>I</i>
                              <span>Miring</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('underline')}
                              title="Garis Bawah (__underline__)"
                            >
                              <u>U</u>
                              <span>Garis Bawah</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('strike')}
                              title="Coret (~strikethrough~)"
                            >
                              <s>S</s>
                              <span>Coret</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('spoiler')}
                              title="Spoiler (||spoiler||)"
                            >
                              <span style={{ letterSpacing: '-1px' }}>▩</span>
                              <span>Spoiler</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('removeFormat')}
                              title="Hapus Format"
                            >
                              <span style={{ fontSize: '11px', fontWeight: 800 }}>Tx</span>
                              <span>Hapus Format</span>
                            </button>
                            <div className="td-ribbon-group-title">FORMAT TEKS</div>
                          </div>

                          {/* GROUP 3: KUTIPAN & KODE */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('quote')}
                              title="Kutipan Teks (> Quote)"
                            >
                              <span style={{ fontSize: '15px' }}>❝</span>
                              <span>Kutipan</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('expandable')}
                              title="Kutipan Dapat Diperluas (> Expandable||)"
                            >
                              <span style={{ fontSize: '15px' }}>❞+</span>
                              <span>Expand</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('code')}
                              title="Kode Inline (`code`)"
                            >
                              <Code size={15} />
                              <span>Code</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('pre')}
                              title="Blok Kode (```code```)"
                            >
                              <span style={{ fontSize: '12px', fontWeight: 800 }}>{`{ }`}</span>
                              <span>Block</span>
                            </button>
                            <div className="td-ribbon-group-title">KUTIPAN & KODE</div>
                          </div>

                          {/* GROUP 4: TAUTAN & DAFTAR */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('link')}
                              title="Sisipkan Link Tautan ([Label](URL))"
                            >
                              <Link size={15} />
                              <span>Tautan</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('mention')}
                              title="Mention Pengguna ([User](tg://user?id=X))"
                            >
                              <AtSign size={15} />
                              <span>Mention</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('bullet')}
                              title="Daftar Bullet (•)"
                            >
                              <List size={15} />
                              <span>Bullet</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('numbered')}
                              title="Daftar Bernomor (1.)"
                            >
                              <ListOrdered size={15} />
                              <span>Nomor</span>
                            </button>
                            <div className="td-ribbon-group-title">TAUTAN & DAFTAR</div>
                          </div>
                        </div>
                      </div>

                      {/* MODE TOGGLE ROW: VISUAL WORD VS RAW CODE */}
                      <div className="td-editor-mode-bar">
                        <div className="td-editor-mode-tabs">
                          <button
                            type="button"
                            className={`td-mode-tab ${editorMode === 'visual' ? 'active' : ''}`}
                            onClick={() => setEditorMode('visual')}
                          >
                            📄 Document Editor (Hanging Indents)
                          </button>
                          <button
                            type="button"
                            className={`td-mode-tab ${editorMode === 'raw' ? 'active' : ''}`}
                            onClick={() => setEditorMode('raw')}
                          >
                            &lt;/&gt; Raw Code Syntax
                          </button>
                        </div>
                      </div>

                      {/* MAIN EDITOR DOCUMENT */}
                      <div className="td-caption-document">
                        {editorMode === 'visual' ? (
                          <div
                            ref={editableDivRef}
                            className="td-caption-editor-contenteditable"
                            contentEditable={!transferActive}
                            onInput={() => handleEditableInput(false)}
                            onBlur={() => handleEditableInput(true)}
                            suppressContentEditableWarning
                          />
                        ) : (
                          <textarea
                            ref={captionTextareaRef}
                            className="td-caption-editor-textarea"
                            rows={5}
                            value={draft.globalCaption || ''}
                            disabled={!!transferActive}
                            placeholder="Tulis caption Telegram di sini… Gunakan toolbar di atas untuk format bold, italic, link, spoiler, dll."
                            onKeyDown={handleCaptionKeyDown}
                            onChange={(e) => patch({ globalCaption: e.target.value })}
                          />
                        )}
                      </div>

                      {/* STATUS BAR (BADGES ON LEFT, CHAR COUNT ON RIGHT) */}
                      <div className="td-caption-statusbar">
                        <div className="td-status-left">
                          <span className="td-status-pill">{draft.captionParseMode || 'MarkdownV2'}</span>
                          <span className="td-status-pill">
                            {getCaptionPositionBadgeLabel(getEffectiveCaptionPosition(draft))}
                          </span>
                        </div>
                        <div className="td-status-right">
                          <span className={`td-char-count ${[...(draft.globalCaption || '')].length > 1024 ? 'error' : ''}`}>
                            {[...(draft.globalCaption || '')].length.toLocaleString('id-ID')} / 1.024 Karakter
                          </span>
                        </div>
                      </div>

                      {/* DEDICATED PENGATURAN PENGIRIMAN CAPTION PANEL (3 COLUMNS) */}
                      <div className="td-caption-delivery-panel">
                        <div className="td-delivery-panel-title">
                          <Send size={15} />
                          <span>Pengaturan pengiriman caption</span>
                        </div>
                        <div className="td-mode-grid td-mode-grid-3">
                          <label>
                            Format Output
                            <select
                              value={draft.captionParseMode || 'MarkdownV2'}
                              disabled={!!transferActive}
                              onChange={(e) => patch({ captionParseMode: e.target.value as any })}
                            >
                              <option value="MarkdownV2">MarkdownV2 (Telegram Official)</option>
                              <option value="HTML">HTML (Telegram HTML)</option>
                              <option value="Plain">Teks Biasa (Plain Text)</option>
                            </select>
                          </label>

                          <label>
                            Perilaku Teks Panjang
                            <select
                              value={draft.captionOverflowPolicy || 'truncate_with_warning'}
                              disabled={!!transferActive}
                              onChange={(e) => patch({ captionOverflowPolicy: e.target.value as any })}
                            >
                              <option value="truncate_with_warning">Potong dengan Peringatan</option>
                              <option value="fail">Batalkan Pengiriman (Reject)</option>
                              <option value="split">Bagi Pesan Lanjutan (Split)</option>
                            </select>
                          </label>

                          <label>
                            Posisi Teks / Caption
                            <select
                              value={getEffectiveCaptionPosition(draft)}
                              disabled={!!transferActive}
                              onChange={(e) => {
                                const pos = e.target.value as CaptionPosition;
                                patch({
                                  captionPosition: pos,
                                  captionAbove: pos === 'on_media_above',
                                });
                              }}
                            >
                              <option value="on_media">Caption pada media</option>
                              <option value="on_media_above">Caption di ATAS media</option>
                              <option value="before_media">Pesan sebelum media</option>
                              <option value="after_media">Pesan setelah media</option>
                              <option value="none">Tanpa caption</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* PREVIEW WORKSPACE WITH TELEGRAM PHONE MOCKUP */
                    <div className="td-caption-preview-shell">
                      <div className="td-preview-grid">
                        {/* PHONE MOCKUP */}
                        <div className="td-phone-frame">
                          <div className="td-phone-head">
                            <div className="td-phone-avatar">TG</div>
                            <div>
                              <strong>Telegram Media Bot</strong>
                              <small>bot • online</small>
                            </div>
                          </div>
                          <div className="td-phone-chat">
                            <div className="td-chat-date">Hari ini</div>
                            <div className="td-chat-bubble">
                              {/* IF CAPTION ABOVE */}
                              {draft.captionAbove && (
                                <div
                                  className="td-caption-preview-content above"
                                  dangerouslySetInnerHTML={{ __html: telegramPreviewHtml }}
                                />
                              )}

                              <div className="td-preview-media">
                                <span>Pratinjau Media (Photo / Video)</span>
                                <span className="td-media-tag">Album Media</span>
                              </div>

                              {/* IF CAPTION BELOW */}
                              {!draft.captionAbove && (
                                <div
                                  className="td-caption-preview-content below"
                                  dangerouslySetInnerHTML={{ __html: telegramPreviewHtml }}
                                />
                              )}

                              <div className="td-bubble-time">10:48 ✓✓</div>
                            </div>
                          </div>
                        </div>

                        {/* RAW TELEGRAM PARSED OUTPUT CARD */}
                        <div className="td-raw-output-card">
                          <div className="td-output-head">
                            <strong>Raw Output Syntax ({draft.captionParseMode || 'MarkdownV2'})</strong>
                            <button
                              type="button"
                              className="td-mini-btn primary"
                              onClick={copyCaptionOutput}
                            >
                              <Copy size={13} />
                              Salin Output
                            </button>
                          </div>
                          <pre className="td-raw-output-code">
                            {draft.globalCaption || '(Caption kosong)'}
                          </pre>
                          <div className="td-output-notice">
                            {[...(draft.globalCaption || '')].length > 1024 ? (
                              <span style={{ color: '#ef4444', fontWeight: 700 }}>
                                ⚠️ Caption melebihi 1.024 karakter! {draft.captionOverflowPolicy === 'fail' ? 'Pengiriman akan diblokir.' : draft.captionOverflowPolicy === 'split' ? 'Akan dibagi menjadi pesan teks lanjutan.' : 'Akan dipotong otomatis.'}
                              </span>
                            ) : (
                              <span style={{ color: '#10b981' }}>
                                ✓ Caption valid & siap dikirim melalui Telegram API.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TOAST POPUP */}
              {captionToast && <div className="td-caption-toast">{captionToast}</div>}
            </div>

            {/* ==========================================
                SECTION CARD 3: MODE & EFEK PENGIRIMAN (SILENT, SPOILER)
                ========================================== */}
            <div className="td-settings-card" style={{ marginTop: '20px' }}>
              <div className="td-card-head">
                <SlidersHorizontal size={20} className="td-card-icon-primary" />
                <div>
                  <h4>3. Mode & Efek Pengiriman (Silent & Spoiler)</h4>
                  <p>Kontrol suara notifikasi penerima dan efek buram media</p>
                </div>
              </div>

              <div className="td-settings-subcard">
                <div className="td-switches-list">
                  <label className="td-switch-row">
                    <div>
                      <strong>{t('speedtest.send_silent', 'Kirim Tanpa Suara (Silent Send)')}</strong>
                      <p>{t('speedtest.send_silent_desc', 'Penerima tidak menerima suara notifikasi')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.silent}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ silent: e.target.checked })}
                    />
                  </label>

                  <label className="td-switch-row">
                    <div>
                      <strong>{t('speedtest.send_spoiler', 'Efek Spoiler')}</strong>
                      <p>{t('speedtest.send_spoiler_desc', 'Tutup media dengan efek buram spoiler')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.spoiler}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ spoiler: e.target.checked })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: DOWNLOAD */}
        {activeTab === 'download' && (
          <div className="td-xfer-focused-panel" id="section-download-performance">
            <div className="td-settings-card">
              <div className="td-card-head">
                <Download size={20} className="td-card-icon-primary" />
                <div>
                  <h4>{t('speedtest.tab_download_title', 'Pengaturan Unduhan (Download)')}</h4>
                  <p>{t('speedtest.tab_download_desc', 'Atur paralelisme unduhan, kebijakan konflik nama berkas & keandalan resume')}</p>
                </div>
              </div>

              {/* SUB-SECTION: PARALEL UNDUHAN */}
              <div className="td-settings-subcard">
                <label className="td-field-label">Jumlah Unduhan Paralel (Download Slots)</label>
                <div className="td-slider-row-box">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={draft.downloadConcurrency}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ downloadConcurrency: Number(e.target.value) })}
                  />
                  <div className="td-slider-value-bar">
                    <span className="td-slider-val">{draft.downloadConcurrency} Berkas</span>
                    <span className="td-concurrency-badge">
                      {draft.downloadConcurrency <= 2 && '🐢 Stabil'}
                      {draft.downloadConcurrency >= 3 && draft.downloadConcurrency <= 6 && '⚡ Seimbang (Rekomendasi)'}
                      {draft.downloadConcurrency >= 7 && '🚀 Kecepatan Tinggi (Maks 10)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* SUB-SECTION: KONFLIK FILE & KEANDALAN */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">Kebijakan Konflik Nama Berkas Di Komputer</label>
                <select
                  value={draft.downloadConflictPolicy || 'ask'}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConflictPolicy: e.target.value as any })}
                  style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', background: '#0f172a', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#f8fafc' }}
                >
                  <option value="ask">Tanyakan sebelum mengunduh</option>
                  <option value="rename">Ganti nama otomatis (tambah angka)</option>
                  <option value="overwrite">Timpa berkas yang ada</option>
                  <option value="skip">Lewati berkas</option>
                </select>

                <div className="td-switches-list" style={{ marginTop: '16px' }}>
                  <label className="td-switch-row">
                    <div>
                      <strong>Lanjutkan Unduhan Parsial (Resume)</strong>
                      <p>Lanjutkan unduhan yang terputus tanpa mulai dari awal.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.downloadResumePartial ?? true}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ downloadResumePartial: e.target.checked })}
                    />
                  </label>

                  <label className="td-switch-row">
                    <div>
                      <strong>Notifikasi Setelah Unduhan Selesai</strong>
                      <p>Tampilkan pemberitahuan banner saat batch unduhan rampung.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.notifyDownloadDone}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ notifyDownloadDone: e.target.checked })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PERFORMANCE & ENCODING VIDEO */}
        {activeTab === 'encoding' && (
          <div className="td-xfer-focused-panel" id="section-encoding-mode">
            {/* DEVICE PERFORMANCE OPTIMIZATION MODE */}
            <div style={{ marginBottom: '16px' }}>
              <PerfSection />
            </div>

            {/* MASTER PARENT SECTION: PENGODEAN & TRANSCODING PENGUNGGAH */}
            <div className="td-encoding-master-card">
              <div className="td-encoding-master-header">
                <div className="td-encoding-master-head-left">
                  <div className="td-master-icon-badge">
                    <Film size={22} style={{ color: '#38bdf8' }} />
                  </div>
                  <div>
                    <div className="td-master-title-flex">
                      <h3>2. Mesin Pengodean & Transcoding Video (GPU & CPU Transcoder Engine)</h3>
                      <span className="td-uploader-tag">
                        <Upload size={12} />
                        Upload Engine Only
                      </span>
                    </div>
                    <p className="td-master-desc">
                      Pengaturan mesin pengodean video ini <strong>khusus memproses kompresi & konversi berkas saat pengunggahan</strong> ke Telegram. Pengaturan ini <em>tidak memengaruhi</em> pemutaran (playback) atau pratinjau lokal media.
                    </p>
                  </div>
                </div>
              </div>

              {/* INNER SECTION 1: MODE ENCODING VIDEO */}
              <div className="td-settings-card is-nested-card">
                <div className="td-card-head">
                  <Film size={18} />
                  <div>
                    <h4>{t('speedtest.encoder_mode_title', 'Mode Encoding Video')}</h4>
                    <p>{t('speedtest.encoder_mode_desc', 'Pilih bagaimana sistem memproses berkas video sebelum diunggah')}</p>
                  </div>
                </div>

                <div className="td-encoder-4x-grid">
                  {/* AUTO */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'automatic' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="automatic"
                      checked={currentEncoderMode === 'automatic'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyUnifiedEncodingMode(draft, 'automatic'))}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Zap size={16} className="td-tile-icon is-auto" />
                        <strong>Otomatis (GPU Adaptif)</strong>
                      </div>
                      <p>Sistem mendeteksi GPU secara otomatis. Jika gagal, fallback ke CPU.</p>
                    </div>
                  </label>

                  {/* HARDWARE GPU */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'hardware' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="hardware"
                      checked={currentEncoderMode === 'hardware'}
                      disabled={!!transferActive}
                      onChange={() => {
                        const firstGpu = hardwareOptions.find(
                          (o) => o.value !== 'auto' && o.value !== 'cpu' && o.value !== 'detecting'
                        );
                        const targetHw = (firstGpu ? firstGpu.value : 'auto') as ReencodeHardware;
                        patch(applyUnifiedEncodingMode(draft, 'hardware', { targetHw }));
                      }}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Film size={16} className="td-tile-icon is-gpu" />
                        <strong>Akselerasi GPU Hardware</strong>
                      </div>
                      <p>Gunakan chip GPU khusus (NVIDIA NVENC, AMD AMF, Intel QSV).</p>
                    </div>
                  </label>

                  {/* SOFTWARE CPU */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'software' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="software"
                      checked={currentEncoderMode === 'software'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyUnifiedEncodingMode(draft, 'software'))}
                    />
                    <div style={{ flex: 1 }}>
                      <div className="td-tile-head">
                        <Cpu size={16} className="td-tile-icon is-cpu" />
                        <strong>Software CPU Encoding</strong>
                      </div>
                      <p>Kompresi menggunakan prosessor CPU. Sangat presisi namun memakan beban CPU.</p>
                      {currentEncoderMode === 'software' && (
                        <div className="td-tile-cpu-badge">
                          <span className="td-cpu-dot" />
                          <span><strong>CPU:</strong> {hardwareCapabilities?.cpu?.processor_name || `Prosessor Sistem (${navigator.hardwareConcurrency || 8} Threads)`}</span>
                        </div>
                      )}
                    </div>
                  </label>

                  {/* DISABLE REENCODE */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'disabled' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="disabled"
                      checked={currentEncoderMode === 'disabled'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyUnifiedEncodingMode(draft, 'disabled'))}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Sliders size={16} className="td-tile-icon is-disable" />
                        <strong>Matikan Re-encode</strong>
                      </div>
                      <p>Kirim video tanpa kompresi ulang. Format non-native dikirim sebagai dokumen.</p>
                    </div>
                  </label>
                </div>

                {/* HARDWARE DEVICE SELECTOR (SHOWS CONDITIONALLY) */}
                {currentEncoderMode === 'hardware' && (
                  <div className="td-conditional-box">
                    <label className="td-field-label">Pilih Perangkat GPU Fisik</label>
                    <MediaSelect
                      value={draft.reencodeHardware}
                      disabled={!!transferActive}
                      onChange={(val) => patch(applyUnifiedEncodingMode(draft, 'hardware', { targetHw: val as ReencodeHardware }))}
                      onOpen={fetchHardwareCapabilities}
                      ariaLabel="Pilih Perangkat GPU Fisik"
                      options={hardwareOptions}
                    />
                  </div>
                )}

                {/* SOFTWARE CPU SPEC DETAILS (SHOWS CONDITIONALLY WHEN SOFTWARE MODE IS SELECTED) */}
                {currentEncoderMode === 'software' && (
                  <div className="td-conditional-box is-cpu-details">
                    <Cpu size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    <div>
                      <div className="td-cpu-title">
                        <strong>Prosesor CPU Aktif:</strong>
                        <span className="td-cpu-name">
                          {hardwareCapabilities?.cpu?.processor_name || `Prosessor Sistem (${navigator.hardwareConcurrency || 8} Threads)`}
                        </span>
                      </div>
                      <p className="td-cpu-sub">
                        {hardwareCapabilities?.cpu?.cores
                          ? `Spesifikasi Hardware: ${hardwareCapabilities.cpu.cores} Physical Cores / ${hardwareCapabilities.cpu.threads} Threads (FFmpeg libx264 software encoder)`
                          : `Spesifikasi Hardware: ${navigator.hardwareConcurrency || 8} Logical Threads (FFmpeg libx264 software encoder)`}
                      </p>
                    </div>
                  </div>
                )}

                {/* DISABLE WARNING (SHOWS CONDITIONALLY) */}
                {currentEncoderMode === 'disabled' && (
                  <div className="td-conditional-box is-warning">
                    <ShieldAlert size={18} className="td-warning-icon" />
                    <div>
                      <div className="td-warning-head">
                        <strong>Mode Passthrough (Re-encode Dinonaktifkan)</strong>
                        <span className="td-warning-badge">Original Uncompressed</span>
                      </div>
                      <p className="td-warning-body">
                        Video tidak akan dikompresi ulang. Berkas format non-native (seperti <code>.mkv</code>, <code>.avi</code>, <code>.flv</code>) akan dikirimkan secara utuh sebagai berkas dokumen murni tanpa pratinjau media.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* INNER SECTION 2: ENCODING TECHNICAL OPTIONS (DIRECTLY DISPLAYED) */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <SlidersHorizontal size={18} />
                  <div>
                    <h4>Pengaturan Teknis Encoder Lanjutan</h4>
                    <p>Konfigurasi beban kerja prosesor dan jumlah thread encoding parallel</p>
                  </div>
                </div>

                <div className="td-form-row-grid">
                  <div className="td-field-group">
                    <label className="td-field-label">Jumlah Encoder Paralel</label>
                    <select
                      value={draft.encoderMaxParallel || 1}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ encoderMaxParallel: Number(e.target.value) })}
                    >
                      <option value={1}>1 Proses (Stabil)</option>
                      <option value={2}>2 Proses Parallel</option>
                      <option value={3}>3 Proses Parallel</option>
                      <option value={4}>4 Proses Parallel (Max GPU)</option>
                    </select>
                  </div>

                  <div className="td-field-group">
                    <label className="td-field-label">Resource Profile</label>
                    <select
                      value={draft.encoderResourceProfile || 'balanced'}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ encoderResourceProfile: e.target.value as any })}
                    >
                      <option value="eco">Hemat Daya (Eco)</option>
                      <option value="balanced">Seimbang (Recommended)</option>
                      <option value="performance">Performa Maksimal</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* MASTER PARENT SECTION 2: AKSELERASI PRATINJAU & PEMUTARAN LOKAL */}
            <div className="td-playback-master-card" style={{ marginTop: '24px' }}>
              <div className="td-playback-master-header">
                <div className="td-playback-master-head-left">
                  <div className="td-playback-icon-badge">
                    <MonitorPlay size={22} style={{ color: '#10b981' }} />
                  </div>
                  <div>
                    <div className="td-master-title-flex">
                      <h3>3. Akselerasi Pratinjau & Pemutaran Lokal (Local Media Playback Engine)</h3>
                      <span className="td-playback-tag">
                        <Play size={12} />
                        {t('speedtest.playback_engine_tag', 'Local Playback & Preview Engine')}
                      </span>
                    </div>
                    <p className="td-playback-desc">
                      {t('speedtest.playback_engine_desc', 'Pengaturan mesin ini khusus memproses akselerasi dekoder GPU/CPU untuk pemutaran video, frame seeking 60FPS, dan pemuatan pratinjau instan di AutoGram Explorer & Media Studio. Pengaturan ini tidak memengaruhi kompresi atau format berkas yang diunggah ke Telegram.')}
                    </p>
                  </div>
                </div>
              </div>

              {/* UNIFIED SINGLE CARD: MESIN PEMUTARAN VIDEO LOKAL */}
              <div className="td-settings-card is-nested-card">
                <div className="td-card-head">
                  <Tv size={20} style={{ color: '#10b981' }} />
                  <div>
                    <h4>{t('speedtest.playback_unified_title', 'Mesin Akselerasi Pemutaran Video (Local Playback Engine)')}</h4>
                    <p>{t('speedtest.playback_unified_desc', 'Pengaturan mesin ini khusus mengontrol akselerasi GPU, kelancaran FPS, dan pemuatan pratinjau instan di AutoGram.')}</p>
                  </div>
                </div>

                {/* 1. STRATEGY TILES (MATCHED WITH UPLOAD ENGINE LAYOUT) */}
                <div className="td-encoder-4x-grid">
                  {/* AUTO */}
                  <label className={`td-encoder-tile ${(!draft.playbackHwDecoding || draft.playbackHwDecoding === 'auto') ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="playbackHwDecoding"
                      value="auto"
                      checked={!draft.playbackHwDecoding || draft.playbackHwDecoding === 'auto'}
                      disabled={!!transferActive}
                      onChange={() => patch({ playbackHwDecoding: 'auto', playbackBackendChoice: 'auto' })}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Zap size={16} className="td-tile-icon is-auto" />
                        <strong>{t('speedtest.playback_auto_title', 'Otomatis (GPU Adaptif)')}</strong>
                      </div>
                      <p>{t('speedtest.playback_auto_desc', 'Rekomendasi terbaik. Sistem mendeteksi GPU otomatis untuk pemutaran instan tanpa lag.')}</p>
                    </div>
                  </label>

                  {/* HARDWARE GPU */}
                  <label className={`td-encoder-tile ${draft.playbackHwDecoding === 'gpu_hardware' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="playbackHwDecoding"
                      value="gpu_hardware"
                      checked={draft.playbackHwDecoding === 'gpu_hardware'}
                      disabled={!!transferActive}
                      onChange={() => patch({ playbackHwDecoding: 'gpu_hardware' })}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Film size={16} className="td-tile-icon is-gpu" />
                        <strong>{t('speedtest.playback_gpu_title', 'Paksa GPU Hardware')}</strong>
                      </div>
                      <p>{t('speedtest.playback_gpu_desc', 'Performa maksimal untuk video 4K, HDR & 120 FPS+ tanpa fallback CPU.')}</p>
                    </div>
                  </label>

                  {/* SOFTWARE CPU */}
                  <label className={`td-encoder-tile ${draft.playbackHwDecoding === 'software' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="playbackHwDecoding"
                      value="software"
                      checked={draft.playbackHwDecoding === 'software'}
                      disabled={!!transferActive}
                      onChange={() => patch({ playbackHwDecoding: 'software', playbackBackendChoice: 'software', playbackZeroCopy: false })}
                    />
                    <div style={{ flex: 1 }}>
                      <div className="td-tile-head">
                        <Cpu size={16} className="td-tile-icon is-cpu" />
                        <strong>{t('speedtest.playback_cpu_title', 'Software (CPU)')}</strong>
                      </div>
                      <p>{t('speedtest.playback_cpu_desc', 'Gunakan prosesor CPU bawaan sistem jika GPU bermasalah.')}</p>
                      {draft.playbackHwDecoding === 'software' && (
                        <div className="td-tile-cpu-badge">
                          <span className="td-cpu-dot" />
                          <span><strong>CPU:</strong> {hardwareCapabilities?.cpu?.processor_name || `Prosessor Sistem (${navigator.hardwareConcurrency || 8} Threads)`}</span>
                        </div>
                      )}
                    </div>
                  </label>
                </div>

                {/* 2. TWO PRIMARY PERFORMANCE DROPDOWNS */}
                <div className="td-form-row-grid" style={{ marginTop: '16px' }}>
                  <div className="td-field-group">
                    <label className="td-field-label">{t('speedtest.playback_fps_label', 'Kelancaran Framerate (FPS)')}</label>
                    <select
                      value={draft.playbackFpsMode || 'adaptive'}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ playbackFpsMode: e.target.value as any })}
                    >
                      <option value="adaptive">{t('speedtest.playback_fps_mode_adaptive', 'Adaptive (Otomatis Sync PTS, Source FPS & Monitor Refresh)')}</option>
                      <option value="follow_source">{t('speedtest.playback_fps_mode_source', 'Follow Source (Framerate Asli Video)')}</option>
                      <option value="follow_display">{t('speedtest.playback_fps_mode_display', 'Follow Display (Monitor 120Hz/144Hz/240Hz+)')}</option>
                      <option value="manual_cap">{t('speedtest.playback_fps_mode_manual', 'Manual Cap (Batas Manual 30/60/120 FPS)')}</option>
                    </select>
                  </div>

                  <div className="td-field-group">
                    <label className="td-field-label">{t('speedtest.playback_zerocopy_label', 'Transfer Memori Zero-Copy DXGI')}</label>
                    <select
                      value={draft.playbackZeroCopy !== false ? 'enabled' : 'disabled'}
                      disabled={!!transferActive || draft.playbackHwDecoding === 'software'}
                      onChange={(e) => patch({ playbackZeroCopy: e.target.value === 'enabled' })}
                    >
                      <option value="enabled">{t('speedtest.playback_zerocopy_on', 'Aktif (Langsung di VRAM GPU - Tanpa Salin CPU)')}</option>
                      <option value="disabled">{t('speedtest.playback_zerocopy_off', 'Nonaktif (Mode Kompatibilitas)')}</option>
                    </select>
                  </div>
                </div>

                {/* 3. ADVANCED HARDWARE API & DIAGNOSTICS TOGGLE (DETAILS) */}
                <details style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                  <summary style={{ cursor: 'pointer', color: '#38bdf8', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={16} />
                    {t('speedtest.playback_advanced_toggle', 'Tampilkan Pengaturan Lanjutan API GPU & Telemetri Diagnostik')}
                  </summary>

                  <div style={{ marginTop: '16px' }}>
                    <div className="td-form-row-grid">
                      <div className="td-field-group">
                        <label className="td-field-label">{t('speedtest.playback_backend_label', 'Target Hardware API Spesifik')}</label>
                        <select
                          value={draft.playbackHwDecoding === 'software' ? 'software' : (draft.playbackBackendChoice || 'auto')}
                          disabled={!!transferActive || draft.playbackHwDecoding === 'software'}
                          onChange={(e) => patch({ playbackBackendChoice: e.target.value as any })}
                        >
                          <option value="auto">{t('speedtest.playback_backend_auto', 'Auto API (Sistem Memilih D3D11VA / NVDEC Terbaik)')}</option>
                          <option value="d3d11va">{t('speedtest.playback_backend_d3d11va', 'Direct3D11 Video Acceleration (D3D11VA)')}</option>
                          <option value="d3d12va">{t('speedtest.playback_backend_d3d12va', 'Direct3D12 Video Acceleration (D3D12VA)')}</option>
                          <option value="nvdec">{t('speedtest.playback_backend_nvdec', 'NVIDIA NVDEC Hardware Decoder')}</option>
                          <option value="vulkan">{t('speedtest.playback_backend_vulkan', 'Vulkan Video Decode API')}</option>
                        </select>
                      </div>

                      <div className="td-field-group">
                        <label className="td-field-label">{t('speedtest.playback_diag_label', 'Panel Telemetri Diagnostik Overlay')}</label>
                        <select
                          value={draft.playbackShowDiagnostics ? 'enabled' : 'disabled'}
                          disabled={!!transferActive}
                          onChange={(e) => patch({ playbackShowDiagnostics: e.target.value === 'enabled' })}
                        >
                          <option value="disabled">{t('speedtest.playback_diag_off', 'Sembunyikan Panel Diagnostik')}</option>
                          <option value="enabled">{t('speedtest.playback_diag_on', 'Tampilkan Statistik GPU Real-Time di Pemutar')}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENGELOMPOKAN ALBUM */}
        {activeTab === 'albums' && (
          <div className="td-xfer-focused-panel" id="section-albums-main">
            <div className="td-settings-card">
              <div className="td-card-head">
                <FolderTree size={18} />
                <div>
                  <h4>{t('speedtest.album_orchestration_title', 'Pengelompokan Media Album')}</h4>
                  <p>{t('speedtest.album_orchestration_desc', 'Kirim foto dan video dalam satu album grup Telegram')}</p>
                </div>
              </div>

              <label className="td-switch-row">
                <div>
                  <strong>{t('speedtest.send_as_album', 'Kirim Media Sebagai Album')}</strong>
                  <p>{t('speedtest.send_as_album_desc', 'Gabungkan beberapa foto/video menjadi album tunggal')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.groupAsAlbum}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ groupAsAlbum: e.target.checked })}
                />
              </label>

              {/* ALBUM OPTIONS (CONDITIONALLY SHOWS WHEN GROUP AS ALBUM IS TRUE) */}
              {draft.groupAsAlbum && (
                <div className="td-conditional-box">
                  <div className="td-field-group">
                    <label className="td-field-label">Ukuran Kelompok Album (Maximum Media Items)</label>
                    <div className="td-slider-row-box">
                      <input
                        type="range"
                        min={2}
                        max={10}
                        value={draft.albumGroupSize || 10}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumGroupSize: Number(e.target.value) })}
                      />
                      <div className="td-slider-value-bar">
                        <span className="td-slider-val">{draft.albumGroupSize || 10} Media / Album</span>
                        <span className="td-concurrency-badge">
                          {(draft.albumGroupSize || 10) === 10 && '⚡ Standard Maksimal Telegram (10 Media)'}
                          {(draft.albumGroupSize || 10) >= 5 && (draft.albumGroupSize || 10) <= 9 && '📦 Kelompok Sedang'}
                          {(draft.albumGroupSize || 10) >= 2 && (draft.albumGroupSize || 10) <= 4 && '👥 Kelompok Ringkas'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="td-switches-list" style={{ marginTop: '16px' }}>
                    <label className="td-switch-row">
                      <div>
                        <strong>Pisahkan Dokumen Dari Album</strong>
                        <p>Kirim berkas dokumen secara terpisah di luar grup media album.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.groupDocuments ?? true}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ groupDocuments: e.target.checked })}
                      />
                    </label>

                    <label className="td-switch-row">
                      <div>
                        <strong>Kelompokkan Berkas Audio & Musik (Audio Playlist)</strong>
                        <p>Gabungkan beberapa berkas MP3/FLAC menjadi satu paket Playlist Musik Telegram.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.groupAudio ?? true}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ groupAudio: e.target.checked })}
                      />
                    </label>

                    <label className="td-switch-row">
                      <div>
                        <strong>Kelompokkan Berkas Dokumen Mentah (Document Album)</strong>
                        <p>Gabungkan berkas dokumen mentah non-media (ZIP, PDF, APK) ke dalam satu grup berkas.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.groupOriginalDocuments ?? true}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ groupOriginalDocuments: e.target.checked })}
                      />
                    </label>

                    <label className="td-switch-row">
                      <div>
                        <strong>Hindari Album Satu Item</strong>
                        <p>Jika tersisa 1 item, kirim sebagai pesan tunggal tanpa frame album.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.albumAvoidSingle ?? true}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumAvoidSingle: e.target.checked })}
                      />
                    </label>

                    <div className="td-field-group" style={{ marginTop: '16px' }}>
                      <label className="td-field-label">Strategi Penanganan Gagal Item Album</label>
                      <select
                        value={draft.albumFailurePolicy || 'send_failed_separately'}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumFailurePolicy: e.target.value as any })}
                      >
                        <option value="send_failed_separately">Best Effort — Kirim Item Berhasil sebagai Album, Ulangi Item Gagal Terpisah (Recommended ⭐)</option>
                        <option value="atomic_strict">Strict (Atomik) — Batal Kirim Album & Ulangi Paket</option>
                        <option value="send_remaining">Fallback Individual — Konversi Item Tersisa Menjadi Pesan Tunggal</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENANGANAN DUPLIKAT */}
        {activeTab === 'duplicates' && (
          <div className="td-xfer-focused-panel" id="section-duplicates-main">
            <div className="td-settings-card">
              <div className="td-card-head">
                <CopyCheck size={20} style={{ color: '#38bdf8' }} />
                <div>
                  <h4>{t('speedtest.duplicate_title', 'Penanganan Duplikat (Duplicate Engine)')}</h4>
                  <p>{t('speedtest.duplicate_desc', 'Atur kebijakan deteksi dan pencegahan pengunggahan berkas ganda di AutoGram.')}</p>
                </div>
              </div>

              {/* 1. PRIMARY STRATEGY TILES (5-SECOND READABILITY) */}
              <div className="td-encoder-4x-grid" style={{ marginTop: '16px' }}>
                <label className={`td-encoder-tile ${draft.duplicatePolicy === 'SKIP' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="duplicatePolicy"
                    value="SKIP"
                    checked={draft.duplicatePolicy === 'SKIP'}
                    disabled={!!transferActive}
                    onChange={() => patch({ duplicatePolicy: 'SKIP' })}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Zap size={16} className="td-tile-icon is-auto" />
                      <strong>{t('speedtest.dup_skip_title', 'Lewati Duplikat (Rekomendasi Utama)')}</strong>
                    </div>
                    <p>{t('speedtest.dup_skip_desc', 'Otomatis melewati berkas yang sudah ada di riwayat database untuk menghemat waktu & kuota.')}</p>
                  </div>
                </label>

                <label className={`td-encoder-tile ${draft.duplicatePolicy === 'FORCE_UPLOAD' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="duplicatePolicy"
                    value="FORCE_UPLOAD"
                    checked={draft.duplicatePolicy === 'FORCE_UPLOAD'}
                    disabled={!!transferActive}
                    onChange={() => patch({ duplicatePolicy: 'FORCE_UPLOAD' })}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Sliders size={16} className="td-tile-icon is-disable" />
                      <strong>{t('speedtest.dup_force_title', 'Tetap Unggah Ulang (Paksa Re-upload)')}</strong>
                    </div>
                    <p>{t('speedtest.dup_force_desc', 'Selalu mengunggah berkas baru tanpa mengecek riwayat duplikasi database.')}</p>
                  </div>
                </label>
              </div>

              {/* 2. PRIMARY PRESCAN & GUARDRAIL DROPDOWNS */}
              <div className="td-form-row-grid" style={{ marginTop: '20px' }}>
                <div className="td-field-group">
                  <label className="td-field-label">{t('speedtest.dup_scan_mode_label', 'Kedalaman Pemindaian Prescan')}</label>
                  <select
                    value={draft.scanMode || 'smart'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ scanMode: e.target.value as any })}
                  >
                    <option value="smart">Smart (Prescan Cerdas Cache & Indeks Local) [Recommended]</option>
                    <option value="normal">Normal (Pemindaian Standar Riwayat Messaging)</option>
                    <option value="forensic">Forensic (Inspeksi Mendalam Hingga Berkas Terlama)</option>
                  </select>
                </div>

                <div className="td-field-group">
                  <label className="td-field-label">{t('speedtest.dup_guardrail_label', 'Proteksi Re-Upload Berkas Terhapus')}</label>
                  <select
                    value={draft.guardrailEnabled !== false ? 'enabled' : 'disabled'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ guardrailEnabled: e.target.value === 'enabled' })}
                  >
                    <option value="enabled">Aktif (Peringatan Guardrail 7 Hari)</option>
                    <option value="disabled">Nonaktif (Tanpa Peringatan Konfirmasi)</option>
                  </select>
                </div>
              </div>

              {/* 3. COLLAPSIBLE TECHNICAL 4-LEVEL DETAILS FOR POWER USERS */}
              <details style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                <summary style={{ cursor: 'pointer', color: '#38bdf8', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldAlert size={16} style={{ color: '#10b981' }} />
                  {t('speedtest.dup_advanced_toggle', 'Tampilkan Detail Metode Verifikasi 4-Level Engine')}
                </summary>

                <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  {/* LEVEL 1 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Level 1</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>Active</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>Telegram Message ID</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>Pencocokan ID Pesan Telegram terenkripsi dalam database SQLite lokal.</p>
                  </div>

                  {/* LEVEL 2 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Level 2</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>Active</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>Telegram Unique File ID</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>Verifikasi atribut file_unique_id resmi dari server Telegram API.</p>
                  </div>

                  {/* LEVEL 3 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Level 3</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>Active</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>SHA-256 Checksum Hash</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>Verifikasi integritas biner berkas secara bit-per-bit tanpa salah baca.</p>
                  </div>

                  {/* LEVEL 4 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Level 4</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>Active</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>Filename + Exact Byte Size</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>Pencocokan presisi nama berkas & ukuran byte fisik berkas.</p>
                  </div>
                </div>
              </details>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENANGANAN BERKAS BESAR (OVERSIZE FILES) */}
        {activeTab === 'limits_recovery' && (
          <div className="td-xfer-focused-panel" id="section-limits-recovery">
            <div className="td-settings-card">
              <div className="td-card-head">
                <HardDriveUpload size={20} style={{ color: '#10b981' }} />
                <div>
                  <h4>{t('speedtest.oversize_title', 'Penanganan Berkas Besar (Oversize Files Handling)')}</h4>
                  <p>{t('speedtest.oversize_desc', 'Tindakan otomatis sistem saat mengunggah berkas yang melebihi batas Telegram (2 GB biasa / 4 GB Premium).')}</p>
                </div>
              </div>

              {/* 1. MASTER STRATEGY SELECTION (5-SECOND READABILITY) */}
              <div className="td-encoder-4x-grid" style={{ marginTop: '16px' }}>
                {/* AUTO ADAPTIVE SMART ENGINE (PRIMARY MASTER TILE) */}
                <label className={`td-encoder-tile ${(!draft.oversizeAction || draft.oversizeAction === 'auto_adaptive') ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="oversizeAction"
                    value="auto_adaptive"
                    checked={!draft.oversizeAction || draft.oversizeAction === 'auto_adaptive'}
                    disabled={!!transferActive}
                    onChange={() => patch({ oversizeAction: 'auto_adaptive' })}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Zap size={16} className="td-tile-icon is-auto" />
                      <strong>{t('speedtest.oversize_auto_title', 'Auto-Adaptive Smart Engine (Rekomendasi Utama)')}</strong>
                    </div>
                    <p>{t('speedtest.oversize_auto_desc', 'Satu mode cerdas untuk semua kasus. Otomatis Fit-to-Limit untuk video, Split untuk ISO/ZIP, dan Routing Akun Premium jika tersedia.')}</p>
                  </div>
                </label>

                {/* MANUAL OVERRIDE SELECTION */}
                <label className={`td-encoder-tile ${draft.oversizeAction !== 'auto_adaptive' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="oversizeAction"
                    value="split"
                    checked={draft.oversizeAction !== 'auto_adaptive'}
                    disabled={!!transferActive}
                    onChange={() => patch({ oversizeAction: 'split' })}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Sliders size={16} className="td-tile-icon is-disable" />
                      <strong>{t('speedtest.oversize_manual_title', 'Manual & Strategi Khusus')}</strong>
                    </div>
                    <p>{t('speedtest.oversize_manual_desc', 'Tentukan tindakan manual secara spesifik (Selalu Split, Fit-to-Limit saja, Akun Premium saja, atau Skip).')}</p>
                  </div>
                </label>
              </div>

              {/* 2. COLLAPSIBLE MANUAL STRATEGY OPTIONS (IF MANUAL SELECTED) */}
              {draft.oversizeAction !== 'auto_adaptive' && (
                <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                  <h5 style={{ color: '#f8fafc', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                    {t('speedtest.oversize_manual_heading', 'Pilih Tindakan Manual Berkas Oversize:')}
                  </h5>

                  <div className="td-encoder-4x-grid">
                    {/* FIT TO LIMIT */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'fit_to_limit' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="fit_to_limit"
                        checked={draft.oversizeAction === 'fit_to_limit'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'fit_to_limit' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Zap size={16} className="td-tile-icon is-auto" />
                          <strong>{t('speedtest.oversize_fit_title', 'Fit-to-Limit Saja')}</strong>
                        </div>
                        <p>{t('speedtest.oversize_fit_desc', 'Khusus Video: Kompres bitrate video secara otomatis agar ukurannya muat di bawah batas akun (2 GB untuk Gratis / 4 GB untuk Premium) tanpa di-split.')}</p>
                      </div>
                    </label>

                    {/* SPLIT */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'split' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="split"
                        checked={draft.oversizeAction === 'split'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'split' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Sliders size={16} className="td-tile-icon is-auto" />
                          <strong>{t('speedtest.oversize_split_title', 'Pecah Berkas Saja (Split Parts)')}</strong>
                        </div>
                        <p>{t('speedtest.oversize_split_desc_new', 'Potong berkas berukuran besar (>2 GB / >4 GB) menjadi beberapa bagian volume aman (<1.95 GB / <3.9 GB) beserta berkas pemulihan (manifest).')}</p>
                      </div>
                    </label>

                    {/* ALTERNATE ACCOUNT */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'alternate_account' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="alternate_account"
                        checked={draft.oversizeAction === 'alternate_account'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'alternate_account' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Film size={16} className="td-tile-icon is-gpu" />
                          <strong>{t('speedtest.oversize_pool_title', 'Pool Akun Premium (4 GB)')}</strong>
                        </div>
                        <p>{t('speedtest.oversize_pool_desc', 'Alihkan pengunggahan berkas besar (>2 GB hingga 4 GB) secara otomatis ke sesi akun Telegram Premium yang aktif.')}</p>
                      </div>
                    </label>

                    {/* SKIP */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'skip' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="skip"
                        checked={draft.oversizeAction === 'skip'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'skip' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Sliders size={16} className="td-tile-icon is-disable" />
                          <strong>{t('speedtest.oversize_skip_title', 'Lewati Saja (Skip)')}</strong>
                        </div>
                        <p>{t('speedtest.oversize_skip_desc_new', 'Abaikan dan lewati pengunggahan berkas yang melebihi batas limit sesi tanpa melakukan kompresi atau split (disertai catatan audit).')}</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* 2. ALTERNATE ACCOUNT ROUTING SUBSECTION */}
              {draft.oversizeAction === 'alternate_account' && (
                <div className="td-conditional-box" style={{ marginTop: '20px' }}>
                  <div className="td-field-group" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <label className="td-field-label" style={{ margin: 0 }}>
                        {t('speedtest.oversize_pool_label', 'Pool Sesi Akun Telegram Premium (Auto-Detected)')}
                      </label>
                      <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 600 }}>
                        💎 Hanya Akun Berlangganan Telegram Premium (Limit 4 GB)
                      </span>
                    </div>

                    {/* INTERACTIVE PREMIUM SESSIONS CHIPS & SELECTOR */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        {availableSessions.length > 0 ? (
                          availableSessions.map((sess) => {
                            const isSelected = (draft.alternateAccountPool || '').split(',').map(s => s.trim()).includes(sess.name);
                            const meta = getSessionMetadata(sess.name);
                            
                            // Construct clean, non-redundant label: "Name (@username)" or "Name" or "@username" or sess.name
                            let cleanLabel = sess.name;
                            if (meta?.userFullName && meta?.username) {
                              const u = meta.username.startsWith('@') ? meta.username : `@${meta.username}`;
                              cleanLabel = `${meta.userFullName.trim()} (${u})`;
                            } else if (meta?.userFullName) {
                              cleanLabel = meta.userFullName.trim();
                            } else if (meta?.username) {
                              cleanLabel = meta.username.startsWith('@') ? meta.username : `@${meta.username}`;
                            } else if (sess.label) {
                              cleanLabel = sess.label;
                            }

                            // Strict session status & Premium accuracy checks
                            const isProblematic = sess.status === 'error' || sess.status === 'expired' || sess.status === 'revoked' || sess.status === 'unauthorized';
                            // ONLY explicit true counts as verified Premium
                            const isPremium = meta?.isPremium === true || (meta as any)?.is_premium === true;

                            if (isProblematic) {
                              return (
                                <div
                                  key={sess.name}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#fca5a5',
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    fontSize: '12px',
                                    cursor: 'not-allowed',
                                    opacity: 0.7,
                                  }}
                                  title="Sesi ini bermasalah atau expired. Tidak dapat digunakan untuk transfer."
                                >
                                  <span>🔴</span>
                                  <strong style={{ color: '#fca5a5' }}>{cleanLabel}</strong>
                                  <span style={{ color: '#ef4444', fontSize: '10px', fontWeight: 600 }}>[Bermasalah]</span>
                                </div>
                              );
                            }

                            // NON-PREMIUM (DEFAULT FOR FREE ACCOUNTS) -> Render Standard 2GB
                            if (!isPremium) {
                              return (
                                <div
                                  key={sess.name}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    color: '#94a3b8',
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    fontSize: '12px',
                                    cursor: 'not-allowed',
                                    opacity: 0.65,
                                  }}
                                  title="Akun Standar gratis hanya mendukung batas 2 GB. Hanya akun Telegram Premium terverifikasi yang dapat dimasukkan ke Pool 4 GB."
                                >
                                  <span>⚪</span>
                                  <span>{cleanLabel}</span>
                                  <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.05)', color: '#64748b', padding: '1px 5px', borderRadius: '4px', marginLeft: '4px' }}>
                                    Standar 2GB (Non-Premium)
                                  </span>
                                </div>
                              );
                            }

                            return (
                              <button
                                key={sess.name}
                                type="button"
                                disabled={!!transferActive}
                                onClick={() => {
                                  const current = (draft.alternateAccountPool || '').split(',').map(s => s.trim()).filter(Boolean);
                                  const next = isSelected ? current.filter(c => c !== sess.name) : [...current, sess.name];
                                  patch({ alternateAccountPool: next.join(', ') });
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.04)',
                                  border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                                  color: isSelected ? '#38bdf8' : '#e2e8f0',
                                  padding: '6px 12px',
                                  borderRadius: '20px',
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  fontWeight: 500,
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <span>💎</span>
                                <strong style={{ color: isSelected ? '#38bdf8' : '#f8fafc' }}>
                                  {cleanLabel}
                                </strong>
                                <span style={{ fontSize: '10px', background: 'rgba(56,189,248,0.15)', color: '#38bdf8', padding: '1px 6px', borderRadius: '4px', marginLeft: '4px' }}>
                                  Premium 4GB
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: '12px', color: '#94a3b8', padding: '4px 0' }}>
                            💡 Belum ada sesi terdeteksi secara otomatis. Silakan pilih atau ketik nama file sesi di bawah ini:
                          </div>
                        )}
                      </div>

                      {/* RAW INPUT FALLBACK */}
                      <input
                        type="text"
                        value={draft.alternateAccountPool || ''}
                        disabled={!!transferActive}
                        placeholder="Atau ketik nama sesi tambahan dipisah koma (contoh: main_account, premium_user)"
                        onChange={(e) => patch({ alternateAccountPool: e.target.value })}
                        style={{ fontSize: '12px', padding: '8px 10px', width: '100%' }}
                      />

                      {/* NO PREMIUM SESSIONS DETECTED WARNING BANNER */}
                      {(() => {
                        const hasPremiumSession = availableSessions.some((sess) => {
                          const meta = getSessionMetadata(sess.name);
                          const isPremium = meta?.isPremium === true || (meta as any)?.is_premium === true;
                          const isProblematic = sess.status === 'error' || sess.status === 'expired' || sess.status === 'revoked' || sess.status === 'unauthorized';
                          return isPremium && !isProblematic;
                        });
                        if (hasPremiumSession) return null;
                        return (
                          <div
                            style={{
                              marginTop: '12px',
                              padding: '12px 14px',
                              background: 'rgba(245, 158, 11, 0.08)',
                              border: '1px solid rgba(245, 158, 11, 0.25)',
                              borderRadius: '8px',
                              fontSize: '12px',
                              color: '#fbbf24',
                              lineHeight: 1.5,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, marginBottom: '4px' }}>
                              <AlertTriangle size={15} color="#f59e0b" />
                              <span>Sistem Informasi: Tidak Ada Akun Premium Aktif Saat Ini</span>
                            </div>
                            <p style={{ margin: 0, color: '#cbd5e1', fontSize: '11px' }}>
                              Seluruh sesi terhubung adalah <strong>Akun Standar (Limit 2 GB)</strong>. Jika terdapat berkas berukuran &gt; 2 GB, pengunggahan utuh 4 GB tidak dapat dilakukan lewat pool ini. Sistem akan otomatis beralih ke skenario cadangan <strong>Pecah Berkas (Split Parts &lt; 2 GB)</strong> atau <strong>Fit-to-Limit (Video Bitrate Compress)</strong> agar transfer tetap berhasil tanpa error limit Telegram.
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="td-form-row-grid">
                    <div className="td-field-group">
                      <label className="td-field-label">{t('speedtest.oversize_strategy_label', 'Strategi Berkas Album Oversize')}</label>
                      <select
                        value={draft.albumAlternateStrategy || 'cancel_group'}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumAlternateStrategy: e.target.value as any })}
                      >
                        <option value="cancel_group">Batal Kirim Album Oversize (Rekomendasi Aman)</option>
                        <option value="separate_item">Pisahkan Berkas Oversize Keluar dari Album</option>
                        <option value="move_whole_group">Pindahkan Seluruh Album ke Akun Premium</option>
                      </select>
                    </div>
                  </div>

                  <label className="td-switch-row" style={{ marginTop: '16px' }}>
                    <div>
                      <strong>{t('speedtest.oversize_approved_toggle', 'Izinkan Pengalihan Identitas Akun Alternatif Otomatis')}</strong>
                      <p>{t('speedtest.oversize_approved_desc', 'Izinkan sistem mengalihkan identitas sesi pengunggah ke pool akun Telegram Premium tanpa konfirmasi manual.')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(draft.alternateIdentityApproved)}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ alternateIdentityApproved: e.target.checked })}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENGATURAN LANJUTAN */}
        {activeTab === 'advanced' && (
          <div className="td-xfer-focused-panel" id="section-advanced-main" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* 1. SINKRONISASI & PERILAKU SESI */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <SlidersHorizontal size={18} />
                <div>
                  <h4>Sinkronisasi & Perilaku Sesi</h4>
                  <p>Konfigurasi pembaruan tampilan otomatis dan retry teknis koneksi MTProto.</p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>Sinkronisasi Tampilan Setelah Upload</strong>
                    <p>Otomatis memperbarui daftar file Obrolan Telegram setelah unggahan selesai.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.refreshAfterUpload ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ refreshAfterUpload: e.target.checked })}
                  />
                </label>

                <label className="td-switch-row">
                  <div>
                    <strong>Auto-Retry Jaringan Saat Connection Timeout</strong>
                    <p>Otomatis mencoba kembali (hingga 3x) jika koneksi MTProto terputus mendadak saat pengunggahan/pengunduhan.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.autoRetryOnNetworkError ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ autoRetryOnNetworkError: e.target.checked })}
                  />
                </label>

                <label className="td-switch-row">
                  <div>
                    <strong>Smart Rate Control & Penanganan FloodWait</strong>
                    <p>Deteksi otomatis FloodWaitError dari API Telegram dan lakukan pause/resume otomatis secara aman.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.smartRateControlEnabled ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ smartRateControlEnabled: e.target.checked })}
                  />
                </label>
              </div>
            </div>

            {/* 2. PEMELIHARAAN CACHE & PENYIMPANAN */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <Trash2 size={18} />
                <div>
                  <h4>Pemeliharaan Cache & Penyimpanan</h4>
                  <p>Bersihkan memori sementara dan file cache lokal untuk menjaga aplikasi tetap cepat & responsif.</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#f8fafc', display: 'block', marginBottom: '4px' }}>Cache Avatar & Foto Profil</strong>
                    <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>Hapus seluruh cache foto profil lokal dari memori jika avatar tidak tampil atau bermasalah.</p>
                  </div>
                  <button
                    type="button"
                    className="td-chip-btn"
                    onClick={() => {
                      clearAvatarCache();
                      triggerCaptionToast('✨ Cache avatar berhasil dibersihkan!');
                    }}
                    style={{ marginTop: '14px', alignSelf: 'flex-start', background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '6px 12px', fontSize: '12px' }}
                  >
                    <RotateCcw size={14} />
                    <span>Bersihkan Cache Avatar</span>
                  </button>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#f8fafc', display: 'block', marginBottom: '4px' }}>File Temporary & Chunk Split</strong>
                    <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>Hapus berkas sementara (.tmp dan part volume split) yang belum dibersihkan dari disk lokal.</p>
                  </div>
                  <button
                    type="button"
                    className="td-chip-btn"
                    onClick={() => {
                      triggerCaptionToast('🧹 File temporary berhasil dibersihkan!');
                    }}
                    style={{ marginTop: '14px', alignSelf: 'flex-start', background: 'rgba(245, 158, 11, 0.15)', color: '#fcd34d', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '6px 12px', fontSize: '12px' }}
                  >
                    <Trash2 size={14} />
                    <span>Bersihkan File Temporary</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3. EKSPOR & IMPOR KONFIGURASI (BACKUP / RESTORE) */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <Download size={18} />
                <div>
                  <h4>Ekspor & Impor Konfigurasi (Backup & Restore)</h4>
                  <p>Cadangkan seluruh profil pengaturan transfer ke file JSON atau pulihkan dari cadangan sebelumnya.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="td-chip-btn"
                  onClick={() => {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(draft, null, 2));
                    const downloadAnchor = document.createElement('a');
                    downloadAnchor.setAttribute("href", dataStr);
                    downloadAnchor.setAttribute("download", `autogram-transfer-settings-${new Date().toISOString().slice(0, 10)}.json`);
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                    triggerCaptionToast('📥 Konfigurasi berhasil diekspor!');
                  }}
                  style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '8px 16px', fontSize: '12px' }}
                >
                  <Download size={15} />
                  <span>Ekspor Konfigurasi (.json)</span>
                </button>

                <label
                  className="td-chip-btn"
                  style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}
                >
                  <Upload size={15} />
                  <span>Impor Konfigurasi (.json)</span>
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const imported = JSON.parse(event.target?.result as string);
                            if (imported && typeof imported === 'object') {
                              patch(imported);
                              triggerCaptionToast('📤 Konfigurasi berhasil diimpor!');
                            }
                          } catch {
                            triggerCaptionToast('❌ Gagal membaca file JSON');
                          }
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            {/* 4. DIAGNOSTIK & LOGGING SISTEM */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <Activity size={18} />
                <div>
                  <h4>Diagnostik & Log Sistem</h4>
                  <p>Opsi pelacakan detail transaksi teknis untuk pemeliharaan dan audit internal.</p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>Mode Debug Logging (Verbose Logs)</strong>
                    <p>Tampilkan log teknis detail dari aktivitas MTProto Grammers dan pencatatan transaksi transfer ke konsol.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.debugLoggingEnabled ?? false}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ debugLoggingEnabled: e.target.checked })}
                  />
                </label>
              </div>
            </div>

            {/* 5. RESET TOTAL SELURUH PENGATURAN SYSTEM */}
            <div className="td-settings-card" style={{ borderColor: 'rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.05)' }}>
              <div className="td-card-head">
                <RotateCcw size={18} style={{ color: '#f87171' }} />
                <div>
                  <h4 style={{ color: '#f87171' }}>Reset Total Seluruh Pengaturan System</h4>
                  <p>Kembalikan seluruh parameter konfigurasi transfer, upload, download, encoding, dan network ke nilai default pabrik.</p>
                </div>
              </div>

              <div style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="td-chip-btn td-chip-danger"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={!!transferActive}
                  style={{ padding: '10px 20px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <RotateCcw size={15} />
                  <span>Reset Total (Semua Pengaturan System)</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PROFILES DRAWER / MODAL OVERLAY */}
        {showPresetDrawer && (
          <div className="td-xfer-confirm-overlay" role="presentation" onClick={() => setShowPresetDrawer(false)}>
            <div className="td-xfer-drawer-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="td-drawer-head">
                <div className="td-drawer-head-left">
                  <Sparkles size={18} className="td-preset-sparkle" />
                  <h4>{t('speedtest.transfer_profiles_title', 'Preset & Profil Konfigurasi')}</h4>
                </div>
                <button
                  type="button"
                  className="td-chip-btn"
                  onClick={() => setShowPresetDrawer(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="td-drawer-body">
                {/* 3 PRESET CARDS */}
                <h5 className="td-drawer-section-title">Pilih Preset Siap Pakai</h5>
                <div className="td-hero-presets-grid">
                  {SYSTEM_TRANSFER_PRESETS.map((preset) => {
                    const isSelected = activePresetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        className={`td-hero-preset-card ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => {
                          applyPreset(preset.settings);
                          setShowPresetDrawer(false);
                        }}
                      >
                        <div className="td-hero-card-top">
                          <h4>{preset.name}</h4>
                          {isSelected && <CheckCircle2 size={16} className="td-selected-check" />}
                        </div>
                        <p className="td-hero-card-desc">{preset.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* USER PROFILES PERSISTENCE MANAGER */}
                <h5 className="td-drawer-section-title" style={{ marginTop: '22px' }}>Manajemen Profil Tersimpan</h5>
                <div className="td-profile-mgr-card">
                  <div className="td-profile-row">
                    {/* CUSTOM GLASSMORPHIC PROFILE SELECTOR */}
                    <div className="td-custom-select-container">
                      <button
                        ref={triggerRef}
                        type="button"
                        className={`td-custom-select-trigger ${isDropdownOpen ? 'is-active' : ''}`}
                        onClick={toggleDropdown}
                        disabled={!!transferActive}
                      >
                        <div className="td-trigger-left">
                          <Bookmark size={15} className="td-trigger-icon" />
                          <span className="td-trigger-text">
                            {selectedProfileId
                              ? profiles.find((p) => p.id === selectedProfileId)?.name || 'Profil Kustom'
                              : t('speedtest.transfer_profiles_new', '+ Buat Profil Baru')}
                          </span>
                        </div>
                        <ChevronDown size={14} className={`td-trigger-chevron ${isDropdownOpen ? 'is-open' : ''}`} />
                      </button>

                      {/* FLOATING GLASSMORPHIC MENU */}
                      {isDropdownOpen && (
                        <>
                          <div className="td-select-backdrop" onClick={() => setIsDropdownOpen(false)} />
                          <div className={`td-custom-select-menu ${dropdownDirection === 'up' ? 'open-upward' : 'open-downward'}`}>
                            <div
                              className={`td-select-option ${!selectedProfileId ? 'is-selected' : ''}`}
                              onClick={() => {
                                setSelectedProfileId('');
                                setProfileName('');
                                setIsDropdownOpen(false);
                              }}
                            >
                              <Plus size={14} className="td-opt-icon" />
                              <span>{t('speedtest.transfer_profiles_new', '+ Buat Profil Baru')}</span>
                            </div>

                            <div className="td-select-divider" />

                            <div className="td-select-scroll-area">
                              {profiles.length > 0 ? (
                                profiles.map((p) => {
                                  const isSelected = selectedProfileId === p.id;
                                  return (
                                    <div
                                      key={p.id}
                                      className={`td-select-option ${isSelected ? 'is-selected' : ''}`}
                                      onClick={() => {
                                        loadProfile(p.id);
                                        setIsDropdownOpen(false);
                                      }}
                                    >
                                      <Bookmark size={14} className="td-opt-icon" />
                                      <span className="td-opt-name">{p.name}</span>
                                      {isSelected && <CheckCircle2 size={13} className="td-opt-check" />}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="td-select-empty">Belum ada profil tersimpan</div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* PROFILE NAME INPUT */}
                    <div className="td-profile-input-wrapper">
                      <input
                        value={profileName}
                        maxLength={80}
                        disabled={!!transferActive}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder={t('speedtest.transfer_profiles_name', 'Nama Profil')}
                        className="td-modern-profile-input"
                      />
                    </div>
                  </div>

                  <div className="td-profile-actions">
                    <button
                      type="button"
                      className="td-chip-btn td-chip-primary"
                      onClick={() => {
                        saveProfile();
                        setIsDropdownOpen(false);
                      }}
                      disabled={!!transferActive || !profileName.trim()}
                    >
                      <Save size={14} /> {selectedProfileId ? 'Update Profil' : 'Simpan Profil Baru'}
                    </button>
                    {selectedProfileId && (
                      <button
                        type="button"
                        className="td-chip-btn td-chip-danger"
                        onClick={() => {
                          deleteProfile();
                          setIsDropdownOpen(false);
                        }}
                        disabled={!!transferActive}
                      >
                        <Trash2 size={14} /> {t('speedtest.transfer_profiles_delete', 'Hapus Profil')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PROXY & NETWORK */}
        {activeTab === 'network' && (
          <div className="td-xfer-focused-panel" id="section-network-proxy">
            <NetworkSection />
          </div>
        )}
      </main>

      {/* FOOTER ACTION BAR */}
      <footer className="td-xfer-footer" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
        <div className="td-footer-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {activeTab !== 'menu' && (
            <button
              type="button"
              className="td-chip-btn"
              onClick={() => setShowTabResetConfirm(true)}
              disabled={!!transferActive}
              title="Kembalikan pengaturan pada bagian ini ke default"
              style={{
                borderColor: 'rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.08)',
              }}
            >
              <RotateCcw size={13} />
              <span>Reset {subMenuCategories.find((c) => c.id === activeTab)?.label || 'Pengaturan'} Saja</span>
            </button>
          )}

          {onClose && (
            <button type="button" className="td-chip-btn td-chip-primary" onClick={onClose}>
              {t('speedtest.topbar_close', 'Selesai')}
            </button>
          )}
        </div>
      </footer>

      {/* SINGLE SUB-MENU TAB RESET CONFIRMATION OVERLAY */}
      {showTabResetConfirm && (
        <div className="td-xfer-confirm-overlay" role="presentation" onClick={() => setShowTabResetConfirm(false)}>
          <div className="td-xfer-confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={24} className="td-confirm-icon" />
            <h4>Reset Pengaturan Sub-menu Ini?</h4>
            <p>
              Apakah Anda yakin ingin mengembalikan seluruh konfigurasi pada bagian{' '}
              <strong>{subMenuCategories.find((c) => c.id === activeTab)?.label || 'Sub-menu'}</strong> ke default pabrik?
            </p>
            <div className="td-confirm-actions">
              <button type="button" className="td-chip-btn" onClick={() => setShowTabResetConfirm(false)}>
                {t('speedtest.topbar_cancel', 'Batal')}
              </button>
              <button
                type="button"
                className="td-chip-btn td-chip-primary"
                onClick={() => {
                  resetCurrentSection(activeTab);
                  setShowTabResetConfirm(false);
                  triggerCaptionToast('✓ Pengaturan sub-menu berhasil dikembalikan ke default!');
                }}
              >
                Ya, Reset Pengaturan Ini
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GLOBAL MASTER RESET ALL OVERLAY */}
      {showResetConfirm && (
        <div className="td-xfer-confirm-overlay" role="presentation" onClick={() => setShowResetConfirm(false)}>
          <div className="td-xfer-confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={24} className="td-confirm-icon" style={{ color: '#ef4444' }} />
            <h4>Reset Total Semua Pengaturan System?</h4>
            <p>Seluruh draf pengaturan transfer pada semua sub-menu akan dikembalikan ke nilai default pabrik.</p>
            <div className="td-confirm-actions">
              <button type="button" className="td-chip-btn" onClick={() => setShowResetConfirm(false)}>
                {t('speedtest.topbar_cancel', 'Batal')}
              </button>
              <button
                type="button"
                className="td-chip-btn td-chip-danger"
                onClick={() => {
                  resetAll();
                  setShowResetConfirm(false);
                }}
              >
                {t('speedtest.btn_reset_default', 'Ya, Reset Total Default')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DISCARD PROFILE OVERLAY */}
      {pendingProfileLoad && (
        <div className="td-xfer-confirm-overlay" role="presentation">
          <div className="td-xfer-confirm-modal" role="dialog" aria-modal="true">
            <AlertTriangle size={24} className="td-confirm-icon" />
            <h4>{t('speedtest.unsaved_profile_title', 'Buang Perubahan Saat Ini?')}</h4>
            <p>{t('speedtest.unsaved_profile_desc', 'Anda memiliki perubahan draf yang belum disimpan. Memuat profil akan membuang perubahan ini.')}</p>
            <div className="td-confirm-actions">
              <button type="button" className="td-chip-btn" onClick={() => setPendingProfileLoad(null)}>
                {t('speedtest.keep_editing', 'Batal')}
              </button>
              <button
                type="button"
                className="td-chip-btn td-chip-danger"
                onClick={() => executeLoadProfile(pendingProfileLoad)}
              >
                {t('speedtest.discard_changes', 'Buang & Muat Profil')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
