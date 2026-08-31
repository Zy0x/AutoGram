import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
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
  Activity,
  Image,
  PlaySquare,
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
export type { SubMenuCategory };

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

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
}

function ToggleSwitch({ checked, disabled, onChange, size = 'md', ariaLabel }: ToggleSwitchProps) {
  const isSm = size === 'sm';
  const width = isSm ? 34 : 40;
  const height = isSm ? 18 : 22;
  const knobSize = isSm ? 14 : 16;
  const knobOffset = isSm ? 16 : 18;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: `${width}px`,
        height: `${height}px`,
        padding: '2px',
        borderRadius: '9999px',
        border: checked ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.16)',
        background: checked
          ? 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)'
          : 'rgba(255, 255, 255, 0.1)',
        boxShadow: checked ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        flexShrink: 0,
        outline: 'none',
      }}
    >
      <span
        style={{
          display: 'block',
          width: `${knobSize}px`,
          height: `${knobSize}px`,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 2px 5px rgba(0, 0, 0, 0.35)',
          transform: checked ? `translateX(${knobOffset}px)` : 'translateX(0px)',
          transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease',
        }}
      />
    </button>
  );
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

  // Navigation state: allow 'menu' (main menu overview) or specific sub-menu category
  const [activeTab, setActiveTab] = useState<WorkspaceTabState>(() => propsActiveCategory || 'menu');

  useEffect(() => {
    if (propsActiveCategory) {
      setActiveTab(propsActiveCategory);
    }
  }, [propsActiveCategory]);
  const [internalSettingsQuery, setInternalSettingsQuery] = useState('');

  const settingsQuery = propsSearchQuery !== undefined ? propsSearchQuery : internalSettingsQuery;
  const setSettingsQuery = propsOnSearchQueryChange || setInternalSettingsQuery;

  // Drawer / Modal overlays
  const [showPresetDrawer, setShowPresetDrawer] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showTabResetConfirm, setShowTabResetConfirm] = useState(false);
  const [ytdlpStatus, setYtdlpStatus] = useState<{
    installed?: boolean;
    version?: string | null;
    latestVersion?: string | null;
    source?: string;
    error?: string | null;
  } | null>(null);
  const [ytdlpBusy, setYtdlpBusy] = useState(false);
  const [showPluginAdvanced, setShowPluginAdvanced] = useState(false);

  // Session picker state for alternate account pool
  const [availableSessions, setAvailableSessions] = useState<SessionOption[]>([]);

  const refreshYtdlpStatus = async (refresh = false) => {
    setYtdlpBusy(true);
    try {
      const result = await invoke<typeof ytdlpStatus>('ytdlp_plugin_status', { refresh });
      setYtdlpStatus(result || { installed: true, version: 'Bawaan / Ready', source: 'app_data' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not allowed') || msg.includes('not found') || msg.includes('Command not found')) {
        setYtdlpStatus({ installed: true, version: 'Bawaan / Ready', source: 'app_data' });
      } else {
        setYtdlpStatus({ error: msg });
      }
    } finally {
      setYtdlpBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'ytdlp') {
      void refreshYtdlpStatus(false);
    }
  }, [activeTab]);

  const updateYtdlpPlugin = async () => {
    setYtdlpBusy(true);
    try {
      await invoke('ytdlp_update_plugin', { force: true });
      await refreshYtdlpStatus(false);
      triggerCaptionToast(t('drive_tools.ytdlp_update_success'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setYtdlpStatus({ error: message });
      triggerCaptionToast(t('drive_tools.ytdlp_update_failed', { error: message }));
    } finally {
      setYtdlpBusy(false);
    }
  };

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
          .replace(/<tg-spoiler>(.*?)<\/tg-spoiler>/gi, '<span class="td-tg-spoiler" title="' + t('drive.tg_spoiler_tooltip') + '">$1</span>')
          .replace(/<blockquote expandable>(.*?)<\/blockquote>/gi, '<blockquote class="td-tg-quote expandable" title="' + t('drive.expandable_quote_tooltip') + '">$1</blockquote>')
          .replace(/<blockquote>(.*?)<\/blockquote>/gi, '<blockquote class="td-tg-quote">$1</blockquote>')
          .replace(/<code>(.*?)<\/code>/gi, '<code class="td-tg-code">$1</code>')
          .replace(/<pre>(.*?)<\/pre>/gi, '<pre class="td-tg-pre">$1</pre>')
          .replace(/<a href="(.*?)">(.*?)<\/a>/gi, '<a href="$1" target="_blank" rel="noreferrer" class="td-tg-link">$2</a>');
      }
      if (mode === 'MarkdownV2') {
        return str
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\|\|(.*?)\|\|/g, '<span class="td-tg-spoiler" title="' + t('drive.tg_spoiler_tooltip') + '">$1</span>')
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
          hideRestrictedMedia: defaults.hideRestrictedMedia,
        };
        break;
      case 'ytdlp':
        sectionFields = {
          ytdlpEnabled: defaults.ytdlpEnabled,
          ytdlpAutoUpdate: defaults.ytdlpAutoUpdate,
          ytdlpCheckIntervalHours: defaults.ytdlpCheckIntervalHours,
          ytdlpCustomPath: defaults.ytdlpCustomPath,
          ytdlpCookiesMode: defaults.ytdlpCookiesMode,
          ytdlpCookiesBrowser: defaults.ytdlpCookiesBrowser,
          ytdlpCookiesPath: defaults.ytdlpCookiesPath,
          ytdlpPoToken: defaults.ytdlpPoToken,
          ytdlpExtractorArgs: defaults.ytdlpExtractorArgs,
          ytdlpCustomArgs: defaults.ytdlpCustomArgs,
          ffmpegCustomPath: defaults.ffmpegCustomPath,
          ytdlpAutoMuxFfmpeg: defaults.ytdlpAutoMuxFfmpeg,
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
    return found ? found.name : t('drive.preset_custom');
  }, [activePresetId, t]);

  // Sub-Menu Categories List (Displays ALL categories directly)
  const subMenuCategories: { id: SubMenuCategory; label: string; desc: string; icon: any }[] = [
    { id: 'upload', label: t('drive.tools_tab_upload'), desc: t('drive.tools_tab_upload_desc'), icon: Upload },
    { id: 'download', label: t('drive.tools_tab_download'), desc: t('drive.tools_tab_download_desc'), icon: Download },
    { id: 'encoding', label: t('drive.tools_tab_encoding'), desc: t('drive.tools_tab_encoding_desc'), icon: Film },
    { id: 'albums', label: t('drive.tools_tab_album'), desc: t('drive.tools_tab_album_desc'), icon: FolderTree },
    { id: 'duplicates', label: t('drive.tools_tab_duplicate'), desc: t('drive.tools_tab_duplicate_desc'), icon: CopyCheck },
    { id: 'limits_recovery', label: t('drive.tools_tab_oversize'), desc: t('drive.tools_tab_oversize_desc'), icon: HardDriveUpload },
    { id: 'network', label: t('drive.tools_tab_network'), desc: t('drive.tools_tab_network_desc'), icon: Network },
    { id: 'ytdlp', label: t('drive.tools_tab_ytdlp'), desc: t('drive.tools_tab_ytdlp_desc'), icon: Sliders },
    { id: 'advanced', label: t('drive.tools_tab_advanced'), desc: t('drive.tools_tab_advanced_desc'), icon: SlidersHorizontal },
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
              <span>{t('drive.back_to_settings')}</span>
            </button>
          )}

          <div>
            <h3>
              {activeTab === 'menu'
                ? t('drive.transfer_settings_title')
                : subMenuCategories.find((c) => c.id === activeTab)?.label || t('ui.generated.detail_pengaturan_416949e')}
            </h3>
            <p>
              {activeTab === 'menu'
                ? t('drive.transfer_settings_subtitle')
                : subMenuCategories.find((c) => c.id === activeTab)?.desc}
            </p>
          </div>
        </div>

        <div className="td-xfer-header-right">
          {isDirty && (
            <span className="td-dirty-badge">
              <span className="td-dirty-dot" />
              {t('drive.unsaved_changes')}
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
                placeholder={t('drive.search_placeholder_short')}
              />
              {settingsQuery.trim() !== '' && (
                <button
                  type="button"
                  className="td-header-search-clear"
                  onClick={() => setSettingsQuery('')}
                  title={t('drive.zip_clear_search')}
                >
                  <X size={12} />
                </button>
              )}

              {settingsQuery.trim() !== '' && (
                <div className="td-search-popover-dropdown">
                  <div className="td-popover-head">
                    <span>{t('ui.generated.hasil_pencarian_4d6cedf')}{searchResults.length})</span>
                    <button
                      type="button"
                      className="td-popover-close-btn"
                      onClick={() => setSettingsQuery('')}
                      title={t('ui.generated.tutup_hasil_d1570bb')}
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
                        <span>{t('ui.generated.tidak_ada_pengaturan_yang_cocok_dengan_14f47c1')}{settingsQuery}"</span>
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
                    {t('drive.active_preset_label')}: <strong>{activePresetName}</strong>
                  </span>
                  <span className="td-preset-details-text">
                    {t('ui.generated.gpu_d113891')} {currentEncoderMode.toUpperCase()} • {draft.uploadConcurrency} {t('ui.generated.paralel_unggah_eb8a36f')} {draft.duplicatePolicy === 'SKIP' ? t('ui.generated.lewati_duplikat_7fe07e8') : t('ui.generated.unggah_ulang_d32b3c4')}
                  </span>
                </div>
              </div>

              <div className="td-preset-strip-actions">
                <button
                  type="button"
                  className="td-chip-btn td-chip-primary"
                  onClick={() => setShowPresetDrawer(true)}
                >
                  <Sparkles size={13} /> {t('drive.preset_and_profiles_btn')}
                </button>
              </div>
            </section>

            <section className="td-settings-subcard" style={{ marginBottom: '16px' }}>
              <label className="td-switch-row">
                <div>
                  <strong>{t('drive.dry_run_title')}</strong>
                  <p>{t('drive.dry_run_description')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.dryRun}
                  disabled={!!transferActive}
                  onChange={(event) => patch({ dryRun: event.target.checked })}
                />
              </label>
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
                  <strong>{t('drive.warning_label')}</strong>
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
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Upload size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.1_pengaturan_unggahan_upload_550bb37')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.atur_paralelisme_slots_unggah_pilih_format_pengi_e1ea5d9')}
                  </p>
                </div>
              </div>

              {/* SUB-SECTION 1.1: PARALEL UNGGAH */}
              <div className="td-settings-subcard">
                <label className="td-field-label">{t('ui.generated.jumlah_unggahan_paralel_upload_slots_9227f37')}</label>
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
                    <span className="td-slider-val">{draft.uploadConcurrency} {t('drive.tab_telegram_files')}</span>
                    <span className="td-concurrency-badge">
                      {draft.uploadConcurrency <= 2 && t('drive_tools.concurrency_badge_stable')}
                      {draft.uploadConcurrency >= 3 && draft.uploadConcurrency <= 6 && t('drive_tools.concurrency_badge_balanced')}
                      {draft.uploadConcurrency >= 7 && t('drive_tools.concurrency_badge_high_speed')}
                    </span>
                  </div>
                </div>
              </div>

              {/* SUB-SECTION 1.2: FORMAT PENGIRIMAN MEDIA */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">{t('drive.remote_delivery_mode_label')}</label>
                <div className="td-radio-tiles-grid">
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
                      <strong>{t('drive.remote_mode_uncompressed')}</strong>
                      <p>{t('drive.remote_mode_uncompressed_hint')}</p>
                    </div>
                  </label>

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
                      <strong>{t('drive.remote_mode_auto')}</strong>
                      <p>{t('drive.remote_mode_auto_hint')}</p>
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
                      <strong>{t('drive.remote_mode_doc')}</strong>
                      <p>{t('drive.remote_mode_doc_hint')}</p>
                    </div>
                  </label>
                </div>
              </div>


            </div>

            {/* ==========================================
                SECTION CARD 2: CAPTION GLOBAL & TELEGRAM CAPTION STUDIO
                ========================================== */}
            <div
              className="td-settings-card"
              style={{
                marginTop: '20px',
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div className="td-card-head td-caption-head-flex" style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '10px',
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Sparkles size={18} style={{ color: '#38bdf8' }} />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                      {t('ui.generated.2_caption_global_telegram_caption_studio_9288052')}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                      {t('ui.generated.format_caption_kaya_dengan_dukungan_resmi_telegr_f16850e')}
                    </p>
                  </div>
                </div>

                {/* SINGLE SLEEK COMPACT MASTER TOGGLE SWITCH */}
                <label className="td-caption-toggle-switch" title={t('ui.generated.aktifkan_matikan_caption_global_b916eac')}>
                  <input
                    type="checkbox"
                    checked={draft.enableGlobalCaption ?? false}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ enableGlobalCaption: e.target.checked })}
                  />
                  <span className="td-toggle-slider" />
                  <span className="td-toggle-text">
                    {draft.enableGlobalCaption ? t('nav.status_active') : t('accounts.inactive')}
                  </span>
                </label>
              </div>

              {!draft.enableGlobalCaption ? (
                /* OFF STATE: CLEAN SLEEK 1-LINE HINT BAR */
                <div className="td-caption-off-hint">
                  <MessageSquare size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                  <span>{t('ui.generated.caption_global_nonaktif_seluruh_berkas_media_aka_9c469b6')}</span>
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
                        {t('ui.generated.visual_editor_studio_e30e5cb')}
                      </button>
                      <button
                        type="button"
                        className={`td-studio-tab-btn ${captionTab === 'preview' ? 'active' : ''}`}
                        onClick={() => setCaptionTab('preview')}
                      >
                        {t('ui.generated.preview_telegram_b2908af')}
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
                              title={t('ui.generated.urungkan_perubahan_undo_ctrl_z_91a3bb2')}
                            >
                              <Undo size={15} />
                              <span>{t('ui.generated.undo_39fc721')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('redo')}
                              title={t('ui.generated.ulangi_perubahan_redo_ctrl_y_97b4e38')}
                            >
                              <Redo size={15} />
                              <span>{t('ui.generated.redo_471b94d')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={copyCaptionOutput}
                              title={t('ui.generated.salin_output_text_923d2a5')}
                            >
                              <Copy size={15} />
                              <span>{t('settings.debug_copy_logs')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.clipboard_riwayat_a7ca77c')}</div>
                          </div>

                          {/* GROUP 2: FORMAT TEKS */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('bold')}
                              title={t('ui.generated.tebal_bold_5fc4707')}
                            >
                              <b>{t('ui.generated.b_ae4f281')}</b>
                              <span>{t('ui.generated.tebal_0ad31d3')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('italic')}
                              title={t('ui.generated.miring_italic_1004d6d')}
                            >
                              <i>{t('ui.generated.i_ca73ab6')}</i>
                              <span>{t('ui.generated.miring_fab1614')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('underline')}
                              title={t('ui.generated.garis_bawah_underline_fb19c77')}
                            >
                              <u>{t('ui.generated.u_b2c7c0c')}</u>
                              <span>{t('ui.generated.garis_bawah_83126c3')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('strike')}
                              title={t('ui.generated.coret_strikethrough_ce5f6b3')}
                            >
                              <s>{t('ui.generated.s_02aa629')}</s>
                              <span>{t('ui.generated.coret_39a5112')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('spoiler')}
                              title={t('ui.generated.spoiler_spoiler_6fae38e')}
                            >
                              <span style={{ letterSpacing: '-1px' }}>▩</span>
                              <span>{t('ui.generated.spoiler_875786e')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('removeFormat')}
                              title={t('ui.generated.hapus_format_c2bd6be')}
                            >
                              <span style={{ fontSize: '11px', fontWeight: 800 }}>{t('ui.generated.tx_766e40f')}</span>
                              <span>{t('ui.generated.hapus_format_c2bd6be')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.format_teks_d5de901')}</div>
                          </div>

                          {/* GROUP 3: KUTIPAN & KODE */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('quote')}
                              title={t('ui.generated.kutipan_teks_quote_15f4ae1')}
                            >
                              <span style={{ fontSize: '15px' }}>❝</span>
                              <span>{t('ui.generated.kutipan_31ac832')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('expandable')}
                              title={t('ui.generated.kutipan_dapat_diperluas_expandable_15775ac')}
                            >
                              <span style={{ fontSize: '15px' }}>❞+</span>
                              <span>{t('ui.generated.expand_9869e50')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('code')}
                              title={t('ui.generated.kode_inline_code_2f8ebb2')}
                            >
                              <Code size={15} />
                              <span>{t('ui.generated.code_adac693')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('pre')}
                              title={t('ui.generated.blok_kode_code_d4c45f9')}
                            >
                              <span style={{ fontSize: '12px', fontWeight: 800 }}>{`{ }`}</span>
                              <span>{t('ui.generated.block_82dd2cd')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.kutipan_kode_00b3af8')}</div>
                          </div>

                          {/* GROUP 4: TAUTAN & DAFTAR */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('link')}
                              title={t('ui.generated.sisipkan_link_tautan_label_url_445690c')}
                            >
                              <Link size={15} />
                              <span>{t('drive.tab_telegram_links')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('mention')}
                              title={t('ui.generated.mention_pengguna_user_tg_user_id_x_5b8ac13')}
                            >
                              <AtSign size={15} />
                              <span>{t('ui.generated.mention_5125802')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('bullet')}
                              title={t('ui.generated.daftar_bullet_b0e264a')}
                            >
                              <List size={15} />
                              <span>{t('ui.generated.bullet_b98da0c')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('numbered')}
                              title={t('ui.generated.daftar_bernomor_1_04d27b3')}
                            >
                              <ListOrdered size={15} />
                              <span>{t('ui.generated.nomor_8d33471')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.tautan_daftar_e0c7b2e')}</div>
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
                            {t('ui.generated.document_editor_hanging_indents_0091478')}
                          </button>
                          <button
                            type="button"
                            className={`td-mode-tab ${editorMode === 'raw' ? 'active' : ''}`}
                            onClick={() => setEditorMode('raw')}
                          >
                            {t('ui.generated.raw_code_syntax_81426a7')}
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
                            placeholder={t('ui.generated.tulis_caption_telegram_di_sini_gunakan_toolbar_d_755cdcf')}
                            onKeyDown={handleCaptionKeyDown}
                            onChange={(e) => patch({ globalCaption: e.target.value })}
                          />
                        )}
                      </div>

                      {/* STATUS BAR (BADGES ON LEFT, CHAR COUNT ON RIGHT) */}
                      <div className="td-caption-statusbar">
                        <div className="td-status-left">
                          <span className="td-status-pill">{draft.captionParseMode || t('ui.generated.markdownv2_b563e42')}</span>
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
                          <span>{t('ui.generated.pengaturan_pengiriman_caption_47f9269')}</span>
                        </div>
                        <div className="td-mode-grid td-mode-grid-3">
                          <label>
                            {t('ui.generated.format_output_126976b')}
                            <select
                              value={draft.captionParseMode || 'MarkdownV2'}
                              disabled={!!transferActive}
                              onChange={(e) => patch({ captionParseMode: e.target.value as any })}
                            >
                              <option value="MarkdownV2">{t('ui.generated.markdownv2_telegram_official_bfabe8a')}</option>
                              <option value="HTML">{t('ui.generated.html_telegram_html_00b37d3')}</option>
                              <option value="Plain">{t('ui.generated.teks_biasa_plain_text_bcf0495')}</option>
                            </select>
                          </label>

                          <label>
                            {t('ui.generated.perilaku_teks_panjang_eec1c91')}
                            <select
                              value={draft.captionOverflowPolicy || 'truncate_with_warning'}
                              disabled={!!transferActive}
                              onChange={(e) => patch({ captionOverflowPolicy: e.target.value as any })}
                            >
                              <option value="truncate_with_warning">{t('ui.generated.potong_dengan_peringatan_f09940d')}</option>
                              <option value="fail">{t('ui.generated.batalkan_pengiriman_reject_5a3d693')}</option>
                              <option value="split">{t('ui.generated.bagi_pesan_lanjutan_split_657e81a')}</option>
                            </select>
                          </label>

                          <label>
                            {t('ui.generated.posisi_teks_caption_1a72892')}
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
                              <option value="on_media">{t('ui.generated.caption_pada_media_e9f1adc')}</option>
                              <option value="on_media_above">{t('ui.generated.caption_di_atas_media_7b5138c')}</option>
                              <option value="before_media">{t('ui.generated.pesan_sebelum_media_b3c3e3b')}</option>
                              <option value="after_media">{t('ui.generated.pesan_setelah_media_800a6cd')}</option>
                              <option value="none">{t('ui.generated.tanpa_caption_7232696')}</option>
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
                            <div className="td-phone-avatar">{t('ui.generated.tg_02af935')}</div>
                            <div>
                              <strong>{t('ui.generated.telegram_media_bot_8ad2370')}</strong>
                              <small>{t('ui.generated.bot_online_3ed93ac')}</small>
                            </div>
                          </div>
                          <div className="td-phone-chat">
                            <div className="td-chat-date">{t('ui.generated.hari_ini_2c6ad14')}</div>
                            <div className="td-chat-bubble">
                              {/* IF CAPTION ABOVE */}
                              {draft.captionAbove && (
                                <div
                                  className="td-caption-preview-content above"
                                  dangerouslySetInnerHTML={{ __html: telegramPreviewHtml }}
                                />
                              )}

                              <div className="td-preview-media">
                                <span>{t('ui.generated.pratinjau_media_photo_video_f1117ee')}</span>
                                <span className="td-media-tag">{t('ui.generated.album_media_5831167')}</span>
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
                            <strong>{t('ui.generated.raw_output_syntax_ee1cd96')}{draft.captionParseMode || t('ui.generated.markdownv2_b563e42')})</strong>
                            <button
                              type="button"
                              className="td-mini-btn primary"
                              onClick={copyCaptionOutput}
                            >
                              <Copy size={13} />
                              {t('ui.generated.salin_output_8ba65b3')}
                            </button>
                          </div>
                          <pre className="td-raw-output-code">
                            {draft.globalCaption || t('ui.generated.caption_kosong_7ae074e')}
                          </pre>
                          <div className="td-output-notice">
                            {[...(draft.globalCaption || '')].length > 1024 ? (
                              <span style={{ color: '#ef4444', fontWeight: 700 }}>
                                {t('ui.generated.caption_melebihi_1_024_karakter_a247041')} {draft.captionOverflowPolicy === 'fail' ? t('ui.generated.pengiriman_akan_diblokir_3f131ea') : draft.captionOverflowPolicy === 'split' ? t('ui.generated.akan_dibagi_menjadi_pesan_teks_lanjutan_b77440c') : t('ui.generated.akan_dipotong_otomatis_15d30b6')}
                              </span>
                            ) : (
                              <span style={{ color: '#10b981' }}>
                                {t('ui.generated.caption_valid_siap_dikirim_melalui_telegram_api_96be30b')}
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
            <div
              className="td-settings-card"
              style={{
                marginTop: '20px',
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <SlidersHorizontal size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.3_mode_efek_pengiriman_silent_spoiler_4b1812a')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.kontrol_suara_notifikasi_penerima_dan_efek_buram_34b7c9e')}
                  </p>
                </div>
              </div>

              <div className="td-settings-subcard">
                <div className="td-switches-list">
                  <label className="td-switch-row">
                    <div>
                      <strong>{t('drive.send_silent')}</strong>
                      <p>{t('drive.send_silent_desc')}</p>
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
                      <strong>{t('drive.send_spoiler')}</strong>
                      <p>{t('drive.send_spoiler_desc')}</p>
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
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Download size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    1. {t('drive.tab_download_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.tab_download_desc')}
                  </p>
                </div>
              </div>

              {/* SUB-SECTION: PARALEL UNDUHAN */}
              <div className="td-settings-subcard">
                <label className="td-field-label">{t('ui.generated.jumlah_unduhan_paralel_download_slots_53a87b8')}</label>
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
                    <span className="td-slider-val">{draft.downloadConcurrency} {t('drive.tab_telegram_files')}</span>
                    <span className="td-concurrency-badge">
                      {draft.downloadConcurrency <= 2 && t('drive_tools.concurrency_badge_stable')}
                      {draft.downloadConcurrency >= 3 && draft.downloadConcurrency <= 6 && t('drive_tools.concurrency_badge_balanced')}
                      {draft.downloadConcurrency >= 7 && t('drive_tools.concurrency_badge_high_speed')}
                    </span>
                  </div>
                </div>
              </div>

              {/* SUB-SECTION: KONFLIK FILE & KEANDALAN */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">{t('ui.generated.kebijakan_konflik_nama_berkas_di_komputer_cccc51f')}</label>
                <select
                  value={draft.downloadConflictPolicy || 'ask'}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConflictPolicy: e.target.value as any })}
                  style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', background: '#0f172a', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#f8fafc' }}
                >
                  <option value="ask">{t('ui.generated.tanyakan_sebelum_mengunduh_3820b14')}</option>
                  <option value="rename">{t('ui.generated.ganti_nama_otomatis_tambah_angka_a0d1700')}</option>
                  <option value="overwrite">{t('ui.generated.timpa_berkas_yang_ada_9047d33')}</option>
                  <option value="skip">{t('ui.generated.lewati_berkas_99bd0e6')}</option>
                </select>

                <div className="td-switches-list" style={{ marginTop: '16px' }}>
                  <label className="td-switch-row">
                    <div>
                      <strong>{t('ui.generated.lanjutkan_unduhan_parsial_resume_bf66f33')}</strong>
                      <p>{t('ui.generated.lanjutkan_unduhan_yang_terputus_tanpa_mulai_dari_bc66c48')}</p>
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
                      <strong>{t('ui.generated.notifikasi_setelah_unduhan_selesai_1e18950')}</strong>
                      <p>{t('ui.generated.tampilkan_pemberitahuan_banner_saat_batch_unduha_2eb7249')}</p>
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
                      <h3>{t('ui.generated.2_mesin_pengodean_transcoding_video_gpu_cpu_tran_c0e0d0e')}</h3>
                      <span className="td-uploader-tag">
                        <Upload size={12} />
                        {t('ui.generated.upload_engine_only_2369298')}
                      </span>
                    </div>
                    <p className="td-master-desc">
                      {t('ui.generated.pengaturan_mesin_pengodean_video_ini_bb7810f')} <strong>{t('ui.generated.khusus_memproses_kompresi_konversi_berkas_saat_p_b386d61')}</strong> {t('ui.generated.ke_telegram_pengaturan_ini_c6e5108')} <em>{t('ui.generated.tidak_memengaruhi_b2368ba')}</em> {t('ui.generated.pemutaran_playback_atau_pratinjau_lokal_media_0edd5c9')}
                    </p>
                  </div>
                </div>
              </div>

              {/* INNER SECTION 1: MODE ENCODING VIDEO */}
              <div className="td-settings-card is-nested-card">
                <div className="td-card-head">
                  <Film size={18} />
                  <div>
                    <h4>{t('drive.encoder_mode_title')}</h4>
                    <p>{t('drive.encoder_mode_desc')}</p>
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
                        <strong>{t('drive.playback_auto_title')}</strong>
                      </div>
                      <p>{t('ui.generated.sistem_mendeteksi_gpu_secara_otomatis_jika_gagal_afc9537')}</p>
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
                        <strong>{t('ui.generated.akselerasi_gpu_hardware_76da0bf')}</strong>
                      </div>
                      <p>{t('ui.generated.gunakan_chip_gpu_khusus_nvidia_nvenc_amd_amf_int_7c08c13')}</p>
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
                        <strong>{t('ui.generated.software_cpu_encoding_6796da9')}</strong>
                      </div>
                      <p>{t('ui.generated.kompresi_menggunakan_prosessor_cpu_sangat_presis_23def45')}</p>
                      {currentEncoderMode === 'software' && (
                        <div className="td-tile-cpu-badge">
                          <span className="td-cpu-dot" />
                          <span><strong>{t('ui.generated.cpu_81c4c3f')}</strong> {hardwareCapabilities?.cpu?.processor_name || `Prosessor Sistem (${navigator.hardwareConcurrency || 8} Threads)`}</span>
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
                        <strong>{t('ui.generated.matikan_re_encode_a0b64dd')}</strong>
                      </div>
                      <p>{t('ui.generated.kirim_video_tanpa_kompresi_ulang_format_non_nati_25f8548')}</p>
                    </div>
                  </label>
                </div>

                {/* HARDWARE DEVICE SELECTOR (SHOWS CONDITIONALLY) */}
                {currentEncoderMode === 'hardware' && (
                  <div className="td-conditional-box">
                    <label className="td-field-label">{t('ui.generated.pilih_perangkat_gpu_fisik_6e93d3c')}</label>
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
                        <strong>{t('ui.generated.prosesor_cpu_aktif_58e1ed6')}</strong>
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
                        <strong>{t('ui.generated.mode_passthrough_re_encode_dinonaktifkan_0efd863')}</strong>
                        <span className="td-warning-badge">{t('ui.generated.original_uncompressed_bbac47b')}</span>
                      </div>
                      <p className="td-warning-body">
                        {t('ui.generated.video_tidak_akan_dikompresi_ulang_berkas_format__614305a')} <code>.mkv</code>, <code>.avi</code>, <code>.flv</code>{t('ui.generated.akan_dikirimkan_secara_utuh_sebagai_berkas_dokum_9521d58')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* INNER SECTION 2: PILAR 1 — FORMAT GAMBAR NON-STANDAR */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <Image size={18} style={{ color: '#38bdf8' }} />
                  <div>
                    <h4>{t('drive.media_pillar_image_title')}</h4>
                    <p>{t('drive.media_pillar_image_desc')}</p>
                  </div>
                </div>

                <div className="td-field-group" style={{ marginTop: '10px' }}>
                  <label className="td-field-label">{t('drive.image_delivery_strategy_label')}</label>
                  <select
                    value={draft.imageTranscodeScope === 'none' ? 'raw' : 'transcode'}
                    disabled={!!transferActive}
                    onChange={(e) => {
                      const isRaw = e.target.value === 'raw';
                      if (isRaw) {
                        patch({
                          imageTranscodeScope: 'none',
                          imageTranscodeFormats: [],
                          albumIncompatImageMode: 'document',
                          preventStickerConversion: false,
                        });
                      } else {
                        const allImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                        patch({
                          imageTranscodeScope: 'all_incompatible',
                          imageTranscodeFormats: allImgs,
                          imageTranscodeTarget: 'jpeg',
                          albumIncompatImageMode: 'transcode',
                          preventStickerConversion: true,
                        });
                      }
                    }}
                  >
                    <option value="raw">{t('drive.image_delivery_strategy_raw')}</option>
                    <option value="transcode">{t('drive.image_delivery_strategy_transcode')}</option>
                  </select>
                  <p className="td-field-hint" style={{ marginTop: '6px' }}>
                    {draft.imageTranscodeScope === 'none'
                      ? t('drive.image_delivery_strategy_raw_desc')
                      : t('drive.image_delivery_strategy_transcode_desc')}
                  </p>
                </div>

                {/* Tingkat 2, 3, & 4: Progressive Disclosure saat Konversi Aktif */}
                {draft.imageTranscodeScope !== 'none' && (
                  <div style={{ marginTop: '14px', padding: '12px', background: 'rgba(15, 23, 42, 0.45)', border: '1px solid rgba(51, 65, 85, 0.5)', borderRadius: '10px' }}>
                    <div>
                      <label className="td-field-label" style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {t('drive.image_transcode_scope_label')}
                      </label>
                      <select
                        value={draft.imageTranscodeScope || 'all_incompatible'}
                        disabled={!!transferActive}
                        onChange={(e) => {
                          const nextScope = e.target.value as any;
                          const allImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                          const commonImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl'];
                          const graphicsImgs = ['tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                          let nextFormats = draft.imageTranscodeFormats || allImgs;
                          if (nextScope === 'all_incompatible') nextFormats = allImgs;
                          else if (nextScope === 'common_web') nextFormats = commonImgs;
                          else if (nextScope === 'graphics_raw') nextFormats = graphicsImgs;
                          else if (nextScope === 'none') nextFormats = [];
                          patch({
                            imageTranscodeScope: nextScope,
                            imageTranscodeFormats: nextFormats,
                            imageTranscodeTarget: 'jpeg',
                            albumIncompatImageMode: nextScope === 'none' ? 'document' : 'transcode',
                          });
                        }}
                      >
                        <option value="all_incompatible">{t('drive.image_transcode_scope_all')}</option>
                        <option value="common_web">{t('drive.image_transcode_scope_common')}</option>
                        <option value="graphics_raw">{t('drive.image_transcode_scope_graphics')}</option>
                        <option value="custom">{t('drive.image_transcode_scope_custom')}</option>
                      </select>
                      <p className="td-field-hint" style={{ fontSize: '11px', marginTop: '4px' }}>
                        {draft.imageTranscodeScope === 'common_web'
                          ? t('drive.image_transcode_scope_common_desc')
                          : draft.imageTranscodeScope === 'graphics_raw'
                          ? t('drive.image_transcode_scope_graphics_desc')
                          : draft.imageTranscodeScope === 'custom'
                          ? t('drive.image_transcode_scope_custom_desc')
                          : t('drive.image_transcode_scope_all_desc')}
                      </p>
                    </div>

                    {/* Interactive Checklist saat Custom Scope */}
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(51, 65, 85, 0.4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(226, 232, 240, 0.9)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {t('drive.image_transcode_formats_label')}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              const allImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                              patch({ imageTranscodeScope: 'all_incompatible', imageTranscodeFormats: allImgs, imageTranscodeTarget: 'jpeg', albumIncompatImageMode: 'transcode' });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', border: '1px solid rgba(56, 189, 248, 0.4)', color: '#7dd3fc', cursor: 'pointer' }}
                          >
                            {t('drive.image_transcode_select_all')}
                          </button>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              patch({ imageTranscodeScope: 'custom', imageTranscodeFormats: [], albumIncompatImageMode: 'document' });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5', cursor: 'pointer' }}
                          >
                            {t('drive.image_transcode_deselect_all')}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: '6px' }}>
                        {[
                          { ext: 'png', key: 'image_transcode_fmt_png' },
                          { ext: 'webp', key: 'image_transcode_fmt_webp' },
                          { ext: 'heic', key: 'image_transcode_fmt_heic' },
                          { ext: 'heif', key: 'image_transcode_fmt_heic' },
                          { ext: 'avif', key: 'image_transcode_fmt_avif' },
                          { ext: 'jxl', key: 'image_transcode_fmt_jxl' },
                          { ext: 'tiff', key: 'image_transcode_fmt_tiff' },
                          { ext: 'bmp', key: 'image_transcode_fmt_bmp' },
                          { ext: 'svg', key: 'image_transcode_fmt_svg' },
                          { ext: 'psd', key: 'image_transcode_fmt_psd' },
                          { ext: 'tga', key: 'image_transcode_fmt_tga' },
                          { ext: 'raw', key: 'image_transcode_fmt_raw' },
                          { ext: 'dng', key: 'image_transcode_fmt_raw' },
                          { ext: 'cr2', key: 'image_transcode_fmt_cr2' },
                          { ext: 'cr3', key: 'image_transcode_fmt_cr2' },
                          { ext: 'nef', key: 'image_transcode_fmt_nef' },
                          { ext: 'arw', key: 'image_transcode_fmt_arw' },
                          { ext: 'orf', key: 'image_transcode_fmt_orf' },
                          { ext: 'rw2', key: 'image_transcode_fmt_rw2' },
                          { ext: 'raf', key: 'image_transcode_fmt_raf' },
                        ].map(({ ext }) => {
                          const activeFormats = draft.imageTranscodeFormats || ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                          const isChecked = activeFormats.includes(ext);
                          return (
                            <label
                              key={ext}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '5px 8px',
                                minHeight: '32px',
                                background: isChecked ? 'rgba(56, 189, 248, 0.16)' : 'rgba(30, 41, 59, 0.4)',
                                border: isChecked ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(51, 65, 85, 0.4)',
                                borderRadius: '6px',
                                cursor: transferActive ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s ease',
                                userSelect: 'none',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!!transferActive}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  let next = [...activeFormats];
                                  if (checked && !next.includes(ext)) {
                                    next.push(ext);
                                  } else if (!checked) {
                                    next = next.filter((item) => item !== ext);
                                  }
                                  patch({
                                    imageTranscodeScope: 'custom',
                                    imageTranscodeFormats: next,
                                    imageTranscodeTarget: 'jpeg',
                                    albumIncompatImageMode: next.length > 0 ? 'transcode' : 'document',
                                  });
                                }}
                                style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '11px', fontWeight: 600, color: isChecked ? '#7dd3fc' : '#94a3b8' }}>
                                .{ext.toUpperCase()}
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      <div style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(148, 163, 184, 0.85)' }}>
                        {t('drive.image_transcode_hint_active', {
                          count: (draft.imageTranscodeFormats || []).length,
                          total: 20,
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* INNER SECTION 3: PILAR 2 — FORMAT ANIMASI & STIKER */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <PlaySquare size={18} style={{ color: '#a855f7' }} />
                  <div>
                    <h4>{t('drive.media_pillar_anim_title')}</h4>
                    <p>{t('drive.media_pillar_anim_desc')}</p>
                  </div>
                </div>

                <div className="td-field-group" style={{ marginTop: '10px' }}>
                  <label className="td-field-label">{t('drive.anim_delivery_strategy_label')}</label>
                  <select
                    value={draft.albumIncompatAnimMode || 'document'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ albumIncompatAnimMode: e.target.value as any })}
                  >
                    <option value="document">{t('drive.anim_delivery_strategy_raw')}</option>
                    <option value="transcode">{t('drive.anim_delivery_strategy_transcode')}</option>
                  </select>
                  <p className="td-field-hint" style={{ marginTop: '6px' }}>
                    {(draft.albumIncompatAnimMode || 'document') === 'document'
                      ? t('drive.anim_delivery_strategy_raw_desc')
                      : t('drive.anim_delivery_strategy_transcode_desc')}
                  </p>
                </div>
              </div>

              {/* INNER SECTION 4: PILAR 3 — FORMAT VIDEO NON-MP4 */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <Film size={18} style={{ color: '#38bdf8' }} />
                  <div>
                    <h4>{t('drive.media_pillar_video_title')}</h4>
                    <p>{t('drive.media_pillar_video_desc')}</p>
                  </div>
                </div>

                <div className="td-field-group" style={{ marginTop: '10px' }}>
                  <label className="td-field-label">{t('drive.video_delivery_strategy_label')}</label>
                  <select
                    value={draft.videoTranscodeScope === 'none' ? 'raw' : 'transcode'}
                    disabled={!!transferActive || currentEncoderMode === 'disabled'}
                    onChange={(e) => {
                      const isRaw = e.target.value === 'raw';
                      if (isRaw) {
                        patch({ videoTranscodeScope: 'none', videoTranscodeFormats: [] });
                      } else {
                        const allFormats = ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                        patch({ videoTranscodeScope: 'all_non_mp4', videoTranscodeFormats: allFormats });
                      }
                    }}
                  >
                    <option value="transcode">{t('drive.video_delivery_strategy_transcode')}</option>
                    <option value="raw">{t('drive.video_delivery_strategy_raw')}</option>
                  </select>
                  <p className="td-field-hint" style={{ marginTop: '6px' }}>
                    {draft.videoTranscodeScope === 'none'
                      ? t('drive.video_delivery_strategy_raw_desc')
                      : t('drive.video_delivery_strategy_transcode_desc')}
                  </p>
                </div>

                {/* Progressive Disclosure saat Transcode Video Aktif */}
                {draft.videoTranscodeScope !== 'none' && currentEncoderMode !== 'disabled' && (
                  <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(15, 23, 42, 0.45)', border: '1px solid rgba(51, 65, 85, 0.5)', borderRadius: '10px' }}>
                    <div className="td-field-group">
                      <label className="td-field-label" style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {t('drive.video_transcode_scope_label')}
                      </label>
                      <select
                        value={draft.videoTranscodeScope || 'all_non_mp4'}
                        disabled={!!transferActive}
                        onChange={(e) => {
                          const nextScope = e.target.value as any;
                          const allFormats = ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                          const commonFormats = ['mkv', 'mov', 'webm', 'avi', '3gp'];
                          const legacyFormats = ['wmv', 'ts', 'flv', 'm2ts', 'vob', 'ogv', 'f4v', 'asf'];
                          let nextFormats = draft.videoTranscodeFormats || allFormats;
                          if (nextScope === 'all_non_mp4') nextFormats = allFormats;
                          else if (nextScope === 'common_containers') nextFormats = commonFormats;
                          else if (nextScope === 'legacy_broadcast') nextFormats = legacyFormats;
                          patch({ videoTranscodeScope: nextScope, videoTranscodeFormats: nextFormats });
                        }}
                      >
                        <option value="all_non_mp4">{t('drive.video_transcode_scope_all')}</option>
                        <option value="common_containers">{t('drive.video_transcode_scope_common')}</option>
                        <option value="legacy_broadcast">{t('drive.video_transcode_scope_legacy')}</option>
                        <option value="custom">{t('drive.video_transcode_scope_custom')}</option>
                      </select>
                      <p className="td-field-hint" style={{ fontSize: '11px', marginTop: '4px' }}>
                        {draft.videoTranscodeScope === 'common_containers'
                          ? t('drive.video_transcode_scope_common_desc')
                          : draft.videoTranscodeScope === 'legacy_broadcast'
                          ? t('drive.video_transcode_scope_legacy_desc')
                          : draft.videoTranscodeScope === 'custom'
                          ? t('drive.video_transcode_scope_custom_desc')
                          : t('drive.video_transcode_scope_all_desc')}
                      </p>
                    </div>

                    {/* Interactive Checklist saat Custom Scope */}
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(51, 65, 85, 0.4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(226, 232, 240, 0.9)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {t('drive.video_transcode_formats_label')}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              const allFormats = ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                              patch({ videoTranscodeScope: 'all_non_mp4', videoTranscodeFormats: allFormats });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#93c5fd', cursor: 'pointer' }}
                          >
                            {t('drive.video_transcode_select_all')}
                          </button>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              patch({ videoTranscodeScope: 'custom', videoTranscodeFormats: [] });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5', cursor: 'pointer' }}
                          >
                            {t('drive.video_transcode_deselect_all')}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: '6px' }}>
                        {[
                          { ext: 'mkv', key: 'video_transcode_fmt_mkv' },
                          { ext: 'mov', key: 'video_transcode_fmt_mov' },
                          { ext: 'webm', key: 'video_transcode_fmt_webm' },
                          { ext: 'avi', key: 'video_transcode_fmt_avi' },
                          { ext: 'wmv', key: 'video_transcode_fmt_wmv' },
                          { ext: 'ts', key: 'video_transcode_fmt_ts' },
                          { ext: 'm2ts', key: 'video_transcode_fmt_m2ts' },
                          { ext: 'vob', key: 'video_transcode_fmt_vob' },
                          { ext: 'flv', key: 'video_transcode_fmt_flv' },
                          { ext: 'ogv', key: 'video_transcode_fmt_ogv' },
                          { ext: '3gp', key: 'video_transcode_fmt_3gp' },
                          { ext: 'f4v', key: 'video_transcode_fmt_f4v' },
                          { ext: 'asf', key: 'video_transcode_fmt_asf' },
                          { ext: 'mpg', key: 'video_transcode_fmt_mpg' },
                          { ext: 'mxf', key: 'video_transcode_fmt_mxf' },
                          { ext: 'divx', key: 'video_transcode_fmt_divx' },
                        ].map(({ ext }) => {
                          const activeFormats = draft.videoTranscodeFormats || ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                          const isChecked = activeFormats.includes(ext);
                          return (
                            <label
                              key={ext}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '5px 8px',
                                minHeight: '32px',
                                background: isChecked ? 'rgba(59, 130, 246, 0.16)' : 'rgba(30, 41, 59, 0.4)',
                                border: isChecked ? '1px solid rgba(59, 130, 246, 0.45)' : '1px solid rgba(51, 65, 85, 0.4)',
                                borderRadius: '6px',
                                cursor: transferActive ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s ease',
                                userSelect: 'none',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!!transferActive}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  let next = [...activeFormats];
                                  if (checked && !next.includes(ext)) {
                                    next.push(ext);
                                  } else if (!checked) {
                                    next = next.filter((item) => item !== ext);
                                  }
                                  patch({
                                    videoTranscodeScope: 'custom',
                                    videoTranscodeFormats: next,
                                  });
                                }}
                                style={{ accentColor: '#3b82f6', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '11px', fontWeight: 600, color: isChecked ? '#93c5fd' : '#94a3b8' }}>
                                .{ext.toUpperCase()}
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      <div style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(148, 163, 184, 0.85)' }}>
                        {t('drive.video_transcode_hint_active', {
                          count: (draft.videoTranscodeFormats || []).length,
                          total: 16,
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* INNER SECTION 5: PENGATURAN TEKNIS ENCODER LANJUTAN */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <SlidersHorizontal size={18} />
                  <div>
                    <h4>{t('ui.generated.pengaturan_teknis_encoder_lanjutan_fe4b216')}</h4>
                    <p>{t('ui.generated.konfigurasi_beban_kerja_prosesor_dan_jumlah_thre_3924794')}</p>
                  </div>
                </div>

                <div className="td-form-row-grid">
                  <div className="td-field-group">
                    <label className="td-field-label">{t('ui.generated.jumlah_encoder_paralel_1df6b4e')}</label>
                    <select
                      value={draft.encoderMaxParallel || 1}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ encoderMaxParallel: Number(e.target.value) })}
                    >
                      <option value={1}>{t('ui.generated.1_proses_stabil_bee7b71')}</option>
                      <option value={2}>{t('ui.generated.2_proses_parallel_9b25c47')}</option>
                      <option value={3}>{t('ui.generated.3_proses_parallel_d6b725d')}</option>
                      <option value={4}>{t('ui.generated.4_proses_parallel_max_gpu_29ddcd2')}</option>
                    </select>
                  </div>

                  <div className="td-field-group">
                    <label className="td-field-label">{t('ui.generated.resource_profile_efe8abb')}</label>
                    <select
                      value={draft.encoderResourceProfile || 'balanced'}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ encoderResourceProfile: e.target.value as any })}
                    >
                      <option value="eco">{t('ui.generated.hemat_daya_eco_b94e982')}</option>
                      <option value="balanced">{t('ui.generated.seimbang_recommended_0e149f1')}</option>
                      <option value="performance">{t('ui.generated.performa_maksimal_3d6c941')}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENGELOMPOKAN ALBUM */}
        {activeTab === 'albums' && (
          <div className="td-xfer-focused-panel" id="section-albums-main">
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FolderTree size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    1. {t('drive.album_orchestration_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.album_orchestration_desc')}
                  </p>
                </div>
              </div>

              <label className="td-switch-row">
                <div>
                  <strong>{t('drive.send_as_album')}</strong>
                  <p>{t('drive.send_as_album_desc')}</p>
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
                    <label className="td-field-label">{t('drive.album_grid_size')}</label>
                    <div className="td-slider-row-box">
                      <input
                        type="range"
                        min={2}
                        max={10}
                        value={draft.albumGroupSize || 10}
                        disabled={!!transferActive}
                        onChange={(e) => {
                          const size = Number(e.target.value);
                          patch({
                            albumGroupSize: size,
                            // Auto-switch packing mode: custom when < 10, maximum when at 10
                            albumPacking: size < 10 ? 'custom' : 'maximum',
                          });
                        }}
                      />
                      <div className="td-slider-value-bar">
                        <span className="td-slider-val">{t('drive.album_grid_size_value', { size: draft.albumGroupSize || 10 })}</span>
                        <span className="td-concurrency-badge">
                          {(draft.albumGroupSize || 10) === 10 && t('drive.album_grid_size_max')}
                          {(draft.albumGroupSize || 10) >= 5 && (draft.albumGroupSize || 10) <= 9 && t('drive.album_grid_size_medium')}
                          {(draft.albumGroupSize || 10) >= 2 && (draft.albumGroupSize || 10) <= 4 && t('drive.album_grid_size_compact')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="td-xfer-hint">
                    {t('drive.album_grid_size_desc', { size: draft.albumGroupSize || 10 })}
                  </p>

                  <div className="td-switches-list" style={{ marginTop: '16px' }}>
                    <label className="td-switch-row">
                      <div>
                        <strong>{t('ui.generated.pisahkan_dokumen_dari_album_1bd3539')}</strong>
                        <p>{t('ui.generated.kirim_berkas_dokumen_secara_terpisah_di_luar_gru_92cbf17')}</p>
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
                        <strong>{t('ui.generated.kelompokkan_berkas_audio_musik_audio_playlist_8adcc13')}</strong>
                        <p>{t('ui.generated.gabungkan_beberapa_berkas_mp3_flac_menjadi_satu__a219840')}</p>
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
                        <strong>{t('ui.generated.kelompokkan_berkas_dokumen_mentah_document_album_0c09d9d')}</strong>
                        <p>{t('ui.generated.gabungkan_berkas_dokumen_mentah_non_media_zip_pd_5cf68c3')}</p>
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
                        <strong>{t('ui.generated.hindari_album_satu_item_1d27987')}</strong>
                        <p>{t('ui.generated.jika_tersisa_1_item_kirim_sebagai_pesan_tunggal__1ed9e2d')}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.albumAvoidSingle ?? true}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumAvoidSingle: e.target.checked })}
                      />
                    </label>

                    <div className="td-field-group" style={{ marginTop: '16px' }}>
                      <label className="td-field-label">{t('ui.generated.strategi_penanganan_gagal_item_album_c19fb1f')}</label>
                      <select
                        value={draft.albumFailurePolicy || 'send_failed_separately'}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumFailurePolicy: e.target.value as any })}
                      >
                        <option value="send_failed_separately">{t('ui.generated.best_effort_kirim_item_berhasil_sebagai_album_ul_c6a176a')}</option>
                        <option value="atomic_strict">{t('ui.generated.strict_atomik_batal_kirim_album_ulangi_paket_1beec2e')}</option>
                        <option value="send_remaining">{t('ui.generated.fallback_individual_konversi_item_tersisa_menjad_e4ccb1a')}</option>
                      </select>
                    </div>

                    {/* ALBUM INCOMPATIBLE MEDIA HANDLING SYNC BANNER */}
                    <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Film size={16} />
                            {t('drive.album_media_hub_sync_title')}
                          </strong>
                          <p style={{ margin: '6px 0 0', fontSize: '0.79rem', color: '#94a3b8', lineHeight: 1.5 }}>
                            {t('drive.album_media_hub_sync_desc')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab('encoding')}
                          style={{
                            flexShrink: 0,
                            padding: '6px 12px',
                            background: 'rgba(56, 189, 248, 0.15)',
                            border: '1px solid rgba(56, 189, 248, 0.4)',
                            borderRadius: '8px',
                            color: '#7dd3fc',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {t('drive.album_media_hub_sync_btn')}
                        </button>
                      </div>
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
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <CopyCheck size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    1. {t('drive.duplicate_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.duplicate_desc')}
                  </p>
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
                      <strong>{t('drive.dup_skip_title')}</strong>
                    </div>
                    <p>{t('drive.dup_skip_desc')}</p>
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
                      <strong>{t('drive.dup_force_title')}</strong>
                    </div>
                    <p>{t('drive.dup_force_desc')}</p>
                  </div>
                </label>
              </div>

              {/* 2. PRIMARY PRESCAN & GUARDRAIL DROPDOWNS */}
              <div className="td-form-row-grid" style={{ marginTop: '20px' }}>
                <div className="td-field-group">
                  <label className="td-field-label">{t('drive.dup_scan_mode_label')}</label>
                  <select
                    value={draft.scanMode || 'smart'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ scanMode: e.target.value as any })}
                  >
                    <option value="smart">{t('ui.generated.smart_prescan_cerdas_cache_indeks_local_recommen_72f8d2f')}</option>
                    <option value="normal">{t('ui.generated.normal_pemindaian_standar_riwayat_messaging_54a6a63')}</option>
                    <option value="forensic">{t('ui.generated.forensic_inspeksi_mendalam_hingga_berkas_terlama_62fd45e')}</option>
                  </select>
                </div>

                <div className="td-field-group">
                  <label className="td-field-label">{t('drive.dup_guardrail_label')}</label>
                  <select
                    value={draft.guardrailEnabled !== false ? 'enabled' : 'disabled'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ guardrailEnabled: e.target.value === 'enabled' })}
                  >
                    <option value="enabled">{t('ui.generated.aktif_peringatan_guardrail_7_hari_00946e0')}</option>
                    <option value="disabled">{t('ui.generated.nonaktif_tanpa_peringatan_konfirmasi_59a487e')}</option>
                  </select>
                </div>
              </div>

              {/* 3. COLLAPSIBLE TECHNICAL 4-LEVEL DETAILS FOR POWER USERS */}
              <details style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                <summary style={{ cursor: 'pointer', color: '#38bdf8', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldAlert size={16} style={{ color: '#10b981' }} />
                  {t('drive.dup_advanced_toggle')}
                </summary>

                <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  {/* LEVEL 1 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('drive.dup_level_1')}</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>{t('nav.status_active')}</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>{t('drive.dup_level1_title')}</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>{t('drive.dup_level1_desc')}</p>
                  </div>

                  {/* LEVEL 2 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('drive.dup_level_2')}</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>{t('nav.status_active')}</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>{t('drive.dup_level2_title')}</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>{t('drive.dup_level2_desc')}</p>
                  </div>

                  {/* LEVEL 3 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('drive.dup_level_3')}</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>{t('nav.status_active')}</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>{t('drive.dup_level3_title')}</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>{t('drive.dup_level3_desc')}</p>
                  </div>

                  {/* LEVEL 4 */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('drive.dup_level_4')}</span>
                      <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>{t('nav.status_active')}</span>
                    </div>
                    <strong style={{ color: '#f8fafc', fontSize: '13px', display: 'block', marginBottom: '2px' }}>{t('drive.dup_level4_title')}</strong>
                    <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0, lineHeight: 1.4 }}>{t('drive.dup_level4_desc')}</p>
                  </div>
                </div>
              </details>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENANGANAN BERKAS BESAR (OVERSIZE FILES) */}
        {activeTab === 'limits_recovery' && (
          <div className="td-xfer-focused-panel" id="section-limits-recovery">
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <HardDriveUpload size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    1. {t('drive.oversize_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.oversize_desc')}
                  </p>
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
                      <strong>{t('drive.oversize_auto_title')}</strong>
                    </div>
                    <p>{t('drive.oversize_auto_desc')}</p>
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
                      <strong>{t('drive.oversize_manual_title')}</strong>
                    </div>
                    <p>{t('drive.oversize_manual_desc')}</p>
                  </div>
                </label>
              </div>

              {/* 2. COLLAPSIBLE MANUAL STRATEGY OPTIONS (IF MANUAL SELECTED) */}
              {draft.oversizeAction !== 'auto_adaptive' && (
                <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                  <h5 style={{ color: '#f8fafc', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                    {t('drive.oversize_manual_heading')}
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
                          <strong>{t('drive.oversize_fit_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_fit_desc')}</p>
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
                          <strong>{t('drive.oversize_split_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_split_desc_new')}</p>
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
                          <strong>{t('drive.oversize_pool_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_pool_desc')}</p>
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
                          <strong>{t('drive.oversize_skip_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_skip_desc_new')}</p>
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
                        {t('drive.oversize_pool_label')}
                      </label>
                      <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 600 }}>
                        {t('ui.generated.hanya_akun_berlangganan_telegram_premium_limit_4_be2f015')}
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
                                  title={t('ui.generated.sesi_ini_bermasalah_atau_expired_tidak_dapat_dig_bf5427d')}
                                >
                                  <span>🔴</span>
                                  <strong style={{ color: '#fca5a5' }}>{cleanLabel}</strong>
                                  <span style={{ color: '#ef4444', fontSize: '10px', fontWeight: 600 }}>{t('ui.generated.bermasalah_20b37d7')}</span>
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
                                  title={t('ui.generated.akun_standar_gratis_hanya_mendukung_batas_2_gb_h_f0cf918')}
                                >
                                  <span>⚪</span>
                                  <span>{cleanLabel}</span>
                                  <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.05)', color: '#64748b', padding: '1px 5px', borderRadius: '4px', marginLeft: '4px' }}>
                                    {t('ui.generated.standar_2gb_non_premium_806fe3e')}
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
                                  {t('ui.generated.premium_4gb_9f5be98')}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: '12px', color: '#94a3b8', padding: '4px 0' }}>
                            {t('ui.generated.belum_ada_sesi_terdeteksi_secara_otomatis_silaka_1adac26')}
                          </div>
                        )}
                      </div>

                      {/* RAW INPUT FALLBACK */}
                      <input
                        type="text"
                        value={draft.alternateAccountPool || ''}
                        disabled={!!transferActive}
                        placeholder={t('ui.generated.atau_ketik_nama_sesi_tambahan_dipisah_koma_conto_bd5a6e4')}
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
                              <span>{t('ui.generated.sistem_informasi_tidak_ada_akun_premium_aktif_sa_d22e47d')}</span>
                            </div>
                            <p style={{ margin: 0, color: '#cbd5e1', fontSize: '11px' }}>
                              {t('ui.generated.seluruh_sesi_terhubung_adalah_20bd1da')} <strong>{t('ui.generated.akun_standar_limit_2_gb_be2ff4a')}</strong>. Jika terdapat berkas berukuran &gt; 2 GB, pengunggahan utuh 4 GB tidak dapat dilakukan lewat pool ini. Sistem akan otomatis beralih ke skenario cadangan <strong>{t('ui.generated.pecah_berkas_split_parts_2_gb_ed7053d')}</strong> {t('ui.generated.atau_a713ae9')} <strong>{t('ui.generated.fit_to_limit_video_bitrate_compress_da6fbd4')}</strong> {t('ui.generated.agar_transfer_tetap_berhasil_tanpa_error_limit_t_ede2eb0')}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="td-form-row-grid">
                    <div className="td-field-group">
                      <label className="td-field-label">{t('drive.oversize_strategy_label')}</label>
                      <select
                        value={draft.albumAlternateStrategy || 'cancel_group'}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumAlternateStrategy: e.target.value as any })}
                      >
                        <option value="cancel_group">{t('ui.generated.batal_kirim_album_oversize_rekomendasi_aman_8d16b45')}</option>
                        <option value="separate_item">{t('ui.generated.pisahkan_berkas_oversize_keluar_dari_album_41e0701')}</option>
                        <option value="move_whole_group">{t('ui.generated.pindahkan_seluruh_album_ke_akun_premium_b8f3bb2')}</option>
                      </select>
                    </div>
                  </div>

                  <label className="td-switch-row" style={{ marginTop: '16px' }}>
                    <div>
                      <strong>{t('drive.oversize_approved_toggle')}</strong>
                      <p>{t('drive.oversize_approved_desc')}</p>
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

        {/* DEDICATED PAGE: PLUG-IN & URL EXTRACTOR */}
        {activeTab === 'ytdlp' && (
          <div className="td-xfer-focused-panel" id="section-ytdlp-plugin" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '16px',
            }}>
              {/* 1. KARTU YT-DLP EXTRACTOR ENGINE */}
              <div className="td-settings-card" style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.9) 0%, rgba(8, 12, 22, 0.98) 100%)',
                border: draft.ytdlpEnabled !== false ? '1px solid rgba(168, 85, 247, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '18px 20px',
                boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '14px',
                transition: 'all 0.2s ease',
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '38px', height: '38px', borderRadius: '10px',
                      background: 'rgba(168, 85, 247, 0.16)', border: '1px solid rgba(168, 85, 247, 0.35)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Download size={18} style={{ color: '#c084fc' }} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>{t('drive_tools.plugin_section_ytdlp_title')}</h4>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: '6px',
                          background: 'rgba(56, 189, 248, 0.14)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)',
                        }}>
                          {t('drive_tools.plugin_tag_remote_url')}
                        </span>
                      </div>
                      <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.3 }}>
                        {t('drive_tools.plugin_section_ytdlp_desc')}
                      </p>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={draft.ytdlpEnabled !== false}
                    disabled={!!transferActive}
                    onChange={(val) => patch({ ytdlpEnabled: val })}
                    size="md"
                    ariaLabel={t('drive_tools.ytdlp_enabled_title')}
                  />
                </div>

                {/* Middle Switches & Status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0, 0, 0, 0.22)', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>{t('drive_tools.ytdlp_auto_update_title')}</span>
                    <ToggleSwitch
                      checked={draft.ytdlpAutoUpdate !== false}
                      disabled={!!transferActive || draft.ytdlpEnabled === false}
                      onChange={(val) => patch({ ytdlpAutoUpdate: val })}
                      size="sm"
                      ariaLabel={t('drive_tools.ytdlp_auto_update_title')}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: '#94a3b8', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '6px' }}>
                    <span>{t('drive_tools.ytdlp_runtime_status')}</span>
                    <strong style={{ color: ytdlpStatus?.error ? '#f87171' : ytdlpStatus?.installed ? '#4ade80' : '#38bdf8' }}>
                      {ytdlpBusy ? t('drive_tools.ytdlp_runtime_checking') : ytdlpStatus?.error
                        ? t('drive_tools.ytdlp_runtime_error', { error: ytdlpStatus.error })
                        : ytdlpStatus?.installed
                          ? t('drive_tools.ytdlp_runtime_installed', { version: ytdlpStatus.version || 'Ready' })
                          : t('drive_tools.plugin_status_ready')}
                    </strong>
                  </div>
                </div>

                {/* Advanced Options Accordion */}
                {showPluginAdvanced && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    padding: '12px',
                    borderRadius: '10px',
                    background: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}>
                    <div>
                      <label className="td-field-label" htmlFor="ytdlp-custom-path-compact" style={{ fontSize: '0.78rem' }}>
                        {t('drive_tools.plugin_custom_path_title')}
                      </label>
                      <input
                        id="ytdlp-custom-path-compact"
                        type="text"
                        placeholder={t('drive_tools.plugin_custom_path_placeholder')}
                        value={draft.ytdlpCustomPath ?? ''}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ ytdlpCustomPath: e.target.value })}
                        style={{ width: '100%', fontSize: '0.8rem', padding: '6px 10px', marginTop: '4px' }}
                      />
                    </div>
                    <div>
                      <label className="td-field-label" htmlFor="ytdlp-po-token-compact" style={{ fontSize: '0.78rem' }}>
                        {t('drive_tools.plugin_po_token_title')}
                      </label>
                      <input
                        id="ytdlp-po-token-compact"
                        type="text"
                        placeholder={t('drive_tools.plugin_po_token_placeholder')}
                        value={draft.ytdlpPoToken || ''}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ ytdlpPoToken: e.target.value })}
                        style={{ width: '100%', fontSize: '0.8rem', padding: '6px 10px', marginTop: '4px' }}
                      />
                    </div>
                  </div>
                )}

                {/* Footer Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
                  <button
                    type="button"
                    className="td-chip-btn"
                    onClick={() => setShowPluginAdvanced((prev) => !prev)}
                    style={{ fontSize: '0.74rem', padding: '5px 8px', color: '#94a3b8' }}
                  >
                    <SlidersHorizontal size={11} /> {showPluginAdvanced ? t('drive_tools.plugin_advanced_hide') : t('drive_tools.plugin_advanced_toggle')}
                  </button>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="td-chip-btn"
                      disabled={ytdlpBusy}
                      onClick={() => void refreshYtdlpStatus(true)}
                      style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                    >
                      <RotateCcw size={12} /> {t('drive_tools.ytdlp_check_now')}
                    </button>
                    <button
                      type="button"
                      className="td-chip-btn td-chip-primary"
                      disabled={ytdlpBusy || draft.ytdlpEnabled === false}
                      onClick={() => void updateYtdlpPlugin()}
                      style={{ fontSize: '0.78rem', padding: '6px 12px', fontWeight: 700 }}
                    >
                      <Download size={12} /> {t('drive_tools.ytdlp_update_now')}
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. KARTU PLACEHOLDER PLUG-IN LAINNYA */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.35)',
                border: '1px dashed rgba(255, 255, 255, 0.14)',
                borderRadius: '16px',
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                gap: '8px',
                minHeight: '180px',
              }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sparkles size={18} style={{ color: '#94a3b8' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
                    {t('drive_tools.plugin_more_title')}
                  </h4>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 600, padding: '2px 6px', borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.06)', color: '#94a3b8',
                  }}>
                    {t('drive_tools.plugin_tag_upcoming')}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748b', maxWidth: '280px', lineHeight: 1.4 }}>
                  {t('drive_tools.plugin_more_desc')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENGATURAN LANJUTAN */}
        {activeTab === 'advanced' && (
          <div className="td-xfer-focused-panel" id="section-advanced-main" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* 1. SINKRONISASI & PERILAKU SESI */}
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <SlidersHorizontal size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.1_sinkronisasi_perilaku_sesi_18b0462')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.konfigurasi_pembaruan_tampilan_otomatis_dan_retr_1b4ee7d')}
                  </p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>{t('ui.generated.sinkronisasi_tampilan_setelah_upload_c71a159')}</strong>
                    <p>{t('ui.generated.otomatis_memperbarui_daftar_file_obrolan_telegra_cd476e0')}</p>
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
                    <strong>{t('ui.generated.auto_retry_jaringan_saat_connection_timeout_fc83e89')}</strong>
                    <p>{t('ui.generated.otomatis_mencoba_kembali_hingga_3x_jika_koneksi__349891c')}</p>
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
                    <strong>{t('ui.generated.smart_rate_control_penanganan_floodwait_6bd3236')}</strong>
                    <p>{t('ui.generated.deteksi_otomatis_floodwaiterror_dari_api_telegra_baa76cc')}</p>
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

            {/* 2. FILTER & TAMPILAN KONTEN DRIVE */}
            <div
              id="section-hide-restricted-media"
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ShieldAlert size={18} style={{ color: '#f87171' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('drive.hide_restricted_media_section_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.hide_restricted_media_section_subtitle')}
                  </p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>{t('drive.hide_restricted_media_title')}</strong>
                    <p>{t('drive.hide_restricted_media_desc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.hideRestrictedMedia ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ hideRestrictedMedia: e.target.checked })}
                  />
                </label>
              </div>
            </div>

            {/* 3. EKSPOR & IMPOR KONFIGURASI (BACKUP / RESTORE) */}
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Download size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.3_ekspor_impor_konfigurasi_backup_restore_e4087b9')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.cadangkan_seluruh_profil_pengaturan_transfer_ke__be6f6c5')}
                  </p>
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
                  <span>{t('ui.generated.ekspor_konfigurasi_json_51d3bc2')}</span>
                </button>

                <label
                  className="td-chip-btn"
                  style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}
                >
                  <Upload size={15} />
                  <span>{t('ui.generated.impor_konfigurasi_json_7a2ac70')}</span>
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
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Activity size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.4_diagnostik_log_sistem_13e7eee')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.opsi_pelacakan_detail_transaksi_teknis_untuk_pem_07becf1')}
                  </p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>{t('ui.generated.mode_debug_logging_verbose_logs_b4e437d')}</strong>
                    <p>{t('ui.generated.tampilkan_log_teknis_detail_dari_aktivitas_mtpro_30943cd')}</p>
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
                  <h4 style={{ color: '#f87171' }}>{t('ui.generated.reset_total_seluruh_pengaturan_system_4daa4d2')}</h4>
                  <p>{t('ui.generated.kembalikan_seluruh_parameter_konfigurasi_transfe_0b5e4d6')}</p>
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
                  <span>{t('ui.generated.reset_total_semua_pengaturan_system_268e487')}</span>
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
                  <h4>{t('drive.transfer_profiles_title')}</h4>
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
                <h5 className="td-drawer-section-title">{t('ui.generated.pilih_preset_siap_pakai_1e9d594')}</h5>
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
                <h5 className="td-drawer-section-title" style={{ marginTop: '22px' }}>{t('ui.generated.manajemen_profil_tersimpan_31a53ba')}</h5>
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
                              ? profiles.find((p) => p.id === selectedProfileId)?.name || t('ui.generated.profil_kustom_bade686')
                              : t('drive.transfer_profiles_new')}
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
                              <span>{t('drive.transfer_profiles_new')}</span>
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
                                <div className="td-select-empty">{t('ui.generated.belum_ada_profil_tersimpan_1f0da59')}</div>
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
                        placeholder={t('drive.transfer_profiles_name')}
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
                      <Save size={14} /> {selectedProfileId ? t('ui.generated.update_profil_9912b6e') : t('ui.generated.simpan_profil_baru_aa5b30a')}
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
                        <Trash2 size={14} /> {t('drive.transfer_profiles_delete')}
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
              title={t('ui.generated.kembalikan_pengaturan_pada_bagian_ini_ke_default_2ce753b')}
              style={{
                borderColor: 'rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.08)',
              }}
            >
              <RotateCcw size={13} />
              <span>{t('drive.label_rotate_reset')} {t('ui.generated.sub_menu_db25b1c')}</span>
            </button>
          )}

          {onClose && (
            <button type="button" className="td-chip-btn td-chip-primary" onClick={onClose}>
              {t('drive.topbar_close')}
            </button>
          )}
        </div>
      </footer>

      {/* SINGLE SUB-MENU TAB RESET CONFIRMATION OVERLAY */}
      {showTabResetConfirm && (
        <div className="td-xfer-confirm-overlay" role="presentation" onClick={() => setShowTabResetConfirm(false)}>
          <div className="td-xfer-confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={26} className="td-confirm-icon" style={{ color: '#f87171' }} />
            <h4>{t('ui.generated.reset_pengaturan_sub_menu_ini_81897b1')}</h4>
            <p>
              {t('ui.generated.apakah_anda_yakin_ingin_mengembalikan_seluruh_ko_6e227a4')}{' '}
              <strong>{subMenuCategories.find((c) => c.id === activeTab)?.label || t('ui.generated.sub_menu_db25b1c')}</strong> {t('ui.generated.ke_default_pabrik_d9354c3')}
            </p>
            <div className="td-confirm-actions">
              <button
                type="button"
                className="td-chip-btn"
                onClick={() => setShowTabResetConfirm(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#cbd5e1',
                  fontWeight: 600,
                }}
              >
                {t('drive.topbar_cancel')}
              </button>
              <button
                type="button"
                className="td-chip-btn td-chip-danger"
                onClick={() => {
                  resetCurrentSection(activeTab);
                  setShowTabResetConfirm(false);
                  triggerCaptionToast('✓ Pengaturan sub-menu berhasil dikembalikan ke default!');
                }}
                style={{
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.35)',
                }}
              >
                {t('ui.generated.ya_reset_pengaturan_ini_70ef71e')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GLOBAL MASTER RESET ALL OVERLAY */}
      {showResetConfirm && (
        <div className="td-xfer-confirm-overlay" role="presentation" onClick={() => setShowResetConfirm(false)}>
          <div className="td-xfer-confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <AlertTriangle size={26} className="td-confirm-icon" style={{ color: '#ef4444' }} />
            <h4>{t('ui.generated.reset_total_semua_pengaturan_system_d650e3b')}</h4>
            <p>{t('ui.generated.seluruh_draf_pengaturan_transfer_pada_semua_sub__5a01241')}</p>
            <div className="td-confirm-actions">
              <button
                type="button"
                className="td-chip-btn"
                onClick={() => setShowResetConfirm(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#cbd5e1',
                  fontWeight: 600,
                }}
              >
                {t('drive.topbar_cancel')}
              </button>
              <button
                type="button"
                className="td-chip-btn td-chip-danger"
                onClick={() => {
                  resetAll();
                  setShowResetConfirm(false);
                }}
                style={{
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.35)',
                }}
              >
                {t('drive.btn_reset_default')}
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
            <h4>{t('drive.unsaved_profile_title')}</h4>
            <p>{t('drive.unsaved_profile_desc')}</p>
            <div className="td-confirm-actions">
              <button type="button" className="td-chip-btn" onClick={() => setPendingProfileLoad(null)}>
                {t('drive.keep_editing')}
              </button>
              <button
                type="button"
                className="td-chip-btn td-chip-danger"
                onClick={() => executeLoadProfile(pendingProfileLoad)}
              >
                {t('drive.discard_changes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
