import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  Upload,
  Download,
  RotateCcw,
  Search,
  Zap,
  Film,
  Sliders,
  ShieldAlert,
  AlertTriangle,
  Sparkles,
  FolderTree,
  CopyCheck,
  HardDriveUpload,
  Network,
  SlidersHorizontal,
  X,
  ArrowLeft,
  ChevronRight,
  PlaySquare,
  Loader2,
} from 'lucide-react';
import { clearPlaybackHistory } from '../../../lib/telegram/cache/playbackHistory';
import type {
  DriveTransferSettings,
  DriveTransferSettingsProfile,
} from '../../../lib/telegram/driveTypes';
import { NetworkSection } from '../../../pages/Settings/NetworkSection';
import { UploadSettingsSection } from './UploadSettingsSection';
import { EncodingSettingsSection } from './EncodingSettingsSection';
import { AdvancedSettingsSection } from './AdvancedSettingsSection';
import { DownloadSettingsSection } from './DownloadSettingsSection';
import { PlaybackSettingsSection } from './PlaybackSettingsSection';
import { LimitsRecoverySettingsSection } from './LimitsRecoverySettingsSection';
import { AlbumStrategyControl } from './AlbumStrategyControl';
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
import { configureTrafficGovernor, setTrafficGovernorDataSaver } from '../../../lib/tauri/rustBackend';

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
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`td-toggle-switch ${size}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="td-toggle-switch-knob" />
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
  const [clearingPlaybackHistory, setClearingPlaybackHistory] = useState(false);
  const [clearedPlaybackSuccess, setClearedPlaybackSuccess] = useState(false);

  const handleClearPlaybackHistory = () => {
    if (clearingPlaybackHistory) return;
    setClearingPlaybackHistory(true);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        clearPlaybackHistory(window.localStorage);
      }
      setClearedPlaybackSuccess(true);
      setTimeout(() => setClearedPlaybackSuccess(false), 2500);
    } catch {
      /* ignore */
    } finally {
      setClearingPlaybackHistory(false);
    }
  };

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
  const [ffmpegStatus, setFfmpegStatus] = useState<{
    installed?: boolean;
    version?: string | null;
    latestVersion?: string | null;
    updateAvailable?: boolean;
    executable?: string | null;
    ffprobeExecutable?: string | null;
    source?: string;
    supportsHttp?: boolean;
    av1Decoder?: string | null;
    supportsNvenc?: boolean;
    error?: string | null;
  } | null>(null);
  const [ffmpegBusy, setFfmpegBusy] = useState(false);

  // Session picker state for alternate account pool
  const [availableSessions, setAvailableSessions] = useState<SessionOption[]>([]);

  const refreshYtdlpStatus = async (showToast = false) => {
    setYtdlpBusy(true);
    try {
      const result = await invoke<typeof ytdlpStatus>('ytdlp_plugin_status', { refresh: showToast });
      setYtdlpStatus(result || { installed: true, version: 'Bawaan / Ready', source: 'app_data' });
      if (showToast) {
        triggerCaptionToast(t('drive_tools.ytdlp_check_success', { version: result?.version || 'Ready' }));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not allowed') || msg.includes('not found') || msg.includes('Command not found')) {
        setYtdlpStatus({ installed: true, version: 'Bawaan / Ready', source: 'app_data' });
        if (showToast) {
          triggerCaptionToast(t('drive_tools.ytdlp_check_success', { version: 'Bawaan / Ready' }));
        }
      } else {
        setYtdlpStatus({ error: msg });
        if (showToast) {
          triggerCaptionToast(t('drive_tools.ytdlp_runtime_error', { error: msg }));
        }
      }
    } finally {
      setYtdlpBusy(false);
    }
  };

  const refreshFfmpegStatus = async (customPath?: string, showToast = false) => {
    setFfmpegBusy(true);
    try {
      const res = await invoke<any>('ffmpeg_plugin_status', { customPath: customPath ?? draft.ffmpegCustomPath });
      setFfmpegStatus(res);
      if (showToast) {
        if (res?.installed) {
          const v = res.version ? (res.version.includes('version') ? res.version.split(' ')[2] : res.version) : 'Ready';
          triggerCaptionToast(t('drive_tools.plugin_ffmpeg_check_success', { version: v }));
        } else {
          triggerCaptionToast(t('drive_tools.plugin_ffmpeg_status_not_found'));
        }
      }
    } catch (error) {
      setFfmpegStatus({ installed: false, version: null, source: 'none' });
      if (showToast) {
        triggerCaptionToast(t('drive_tools.plugin_ffmpeg_status_not_found'));
      }
    } finally {
      setFfmpegBusy(false);
    }
  };

  const handleUpdateFfmpeg = async () => {
    setFfmpegBusy(true);
    try {
      const res = await invoke<any>('ffmpeg_update_plugin', { force: true });
      setFfmpegStatus(res);
      triggerCaptionToast(t('drive_tools.plugin_ffmpeg_update_success'));
    } catch (err) {
      console.error('Failed to update FFmpeg plugin', err);
      const message = err instanceof Error ? err.message : String(err);
      triggerCaptionToast(t('drive_tools.plugin_ffmpeg_update_failed', { error: message }));
      void refreshFfmpegStatus(undefined, false);
    } finally {
      setFfmpegBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'ytdlp') {
      void refreshYtdlpStatus(false);
      void refreshFfmpegStatus(undefined, false);
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

  // The traffic governor sees these only as user ceilings. It may reserve a
  // little capacity for a critical preview, but it never raises parallelism
  // above the Transfer Settings selected by the user.
  useEffect(() => {
    void configureTrafficGovernor(draft.uploadConcurrency, draft.downloadConcurrency);
    void setTrafficGovernorDataSaver(draft.playbackDataSaver !== false);
  }, [draft.downloadConcurrency, draft.uploadConcurrency, draft.playbackDataSaver]);

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
      case 'playback':
        sectionFields = {
          rememberPlaybackPosition: defaults.rememberPlaybackPosition,
          playbackDataSaver: defaults.playbackDataSaver,
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
          remoteHideManifests: defaults.remoteHideManifests,
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
    { id: 'playback', label: t('drive.tools_tab_playback'), desc: t('drive.tools_tab_playback_desc'), icon: PlaySquare },
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
        <UploadSettingsSection
          activeTab={activeTab}
          ctx={{
            t,
            draft,
            patch,
            transferActive,
            currentDeliveryFormat,
            applyDeliveryFormatMode,
            captionTab,
            setCaptionTab,
            editorMode,
            setEditorMode,
            captionToast,
            captionTextareaRef,
            editableDivRef,
            handleEditableInput,
            execCaptionFormatting,
            handleCaptionKeyDown,
            telegramPreviewHtml,
            copyCaptionOutput,
          }}
        />

        {/* DEDICATED PAGE: DOWNLOAD */}
        <DownloadSettingsSection activeTab={activeTab} ctx={{ t, draft, patch, transferActive }} />
        <PlaybackSettingsSection
          activeTab={activeTab}
          ctx={{ t, draft, patch, transferActive, embedded, clearingPlaybackHistory, clearedPlaybackSuccess, handleClearPlaybackHistory }}
        />

        {/* DEDICATED PAGE: PERFORMANCE & ENCODING VIDEO */}
        <EncodingSettingsSection
          activeTab={activeTab}
          ctx={{
            t,
            draft,
            patch,
            hardwareOptions,
            currentEncoderMode,
            hardwareCapabilities,
            transferActive,
            applyUnifiedEncodingMode,
            fetchHardwareCapabilities,
          }}
        />
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
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <AlbumStrategyControl
                    draft={draft}
                    patch={patch}
                    transferActive={!!transferActive}
                  />

                  {/* ALBUM INCOMPATIBLE MEDIA HANDLING SYNC BANNER */}
                  <div style={{ padding: '16px', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '12px' }}>
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
        <LimitsRecoverySettingsSection
          activeTab={activeTab}
          ctx={{ t, draft, patch, transferActive, availableSessions, getSessionMetadata }}
        />
        {/* DEDICATED PAGE: PLUG-IN & EXTENSIONS */}
        {activeTab === 'ytdlp' && (
          <div className="td-xfer-focused-panel td-plugin-overview-container" id="section-ytdlp-plugin">
            <div className="td-plugin-overview-grid">
              {/* 1. KARTU YT-DLP EXTRACTOR ENGINE */}
              <div className="td-settings-card td-plugin-card">
                {/* Header */}
                <div className="td-plugin-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="td-plugin-icon-box">
                      <Download size={18} style={{ color: '#c084fc' }} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                        {t('drive_tools.plugin_section_ytdlp_title')}
                      </h4>
                      <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.35, minHeight: '38px' }}>
                        {t('drive_tools.plugin_section_ytdlp_desc')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Middle Switches & Status */}
                <div className="td-plugin-status-box">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>{t('drive_tools.ytdlp_auto_update_title')}</span>
                    <ToggleSwitch
                      checked={draft.ytdlpAutoUpdate !== false}
                      disabled={!!transferActive}
                      onChange={(val) => patch({ ytdlpAutoUpdate: val })}
                      size="sm"
                      ariaLabel={t('drive_tools.ytdlp_auto_update_title')}
                    />
                  </div>
                  <div className="td-plugin-status-runtime-row">
                    <span>{t('drive_tools.ytdlp_runtime_status')}:</span>
                    <strong style={{ color: ytdlpStatus?.error ? '#f87171' : ytdlpStatus?.installed ? '#4ade80' : '#38bdf8' }}>
                      {ytdlpBusy ? t('drive_tools.ytdlp_runtime_checking') : ytdlpStatus?.error
                        ? t('drive_tools.ytdlp_runtime_error', { error: ytdlpStatus.error })
                        : ytdlpStatus?.installed
                          ? t('drive_tools.ytdlp_runtime_installed', { version: ytdlpStatus.version || 'Ready' })
                          : t('drive_tools.plugin_status_ready')}
                    </strong>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="td-plugin-card-footer">
                  <div className="td-plugin-action-group">
                    <button
                      type="button"
                      className="td-chip-btn"
                      disabled={ytdlpBusy}
                      onClick={() => void refreshYtdlpStatus(true)}
                      style={{ justifyContent: 'center' }}
                    >
                      <RotateCcw size={13} className={ytdlpBusy ? 'spin' : ''} />
                      <span>{t('drive_tools.ytdlp_check_now')}</span>
                    </button>
                    <button
                      type="button"
                      className="td-chip-btn td-chip-primary"
                      disabled={ytdlpBusy || !!transferActive}
                      onClick={() => void updateYtdlpPlugin()}
                      style={{ justifyContent: 'center' }}
                    >
                      {ytdlpBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                      <span>{ytdlpBusy ? t('drive_tools.ytdlp_updating') : t('drive_tools.ytdlp_update_now')}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. KARTU FFMPEG & FFPROBE RUNTIME PLUGIN */}
              <div className="td-settings-card td-plugin-card">
                {/* Header */}
                <div className="td-plugin-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="td-plugin-icon-box" style={{ background: 'rgba(168, 85, 247, 0.12)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                      <Film size={18} style={{ color: '#c084fc' }} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                        {t('drive_tools.plugin_ffmpeg_title_short')}
                      </h4>
                      <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.35, minHeight: '38px' }}>
                        {t('drive_tools.plugin_ffmpeg_overview_desc')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Middle Switches & Status */}
                <div className="td-plugin-status-box">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
                      {t('drive_tools.plugin_ffmpeg_auto_mux_title')}
                    </span>
                    <ToggleSwitch
                      checked={draft.ytdlpAutoMuxFfmpeg !== false}
                      disabled={!!transferActive}
                      onChange={(val) => patch({ ytdlpAutoMuxFfmpeg: val })}
                      size="sm"
                      ariaLabel={t('drive_tools.plugin_ffmpeg_auto_mux_title')}
                    />
                  </div>
                  <div className="td-plugin-status-runtime-row">
                    <span>{t('drive_tools.plugin_ffmpeg_status_label')}:</span>
                    <strong style={{ color: ffmpegStatus?.installed ? '#4ade80' : '#f59e0b' }}>
                      {ffmpegBusy ? t('drive_tools.plugin_ffmpeg_btn_updating') : ffmpegStatus?.installed
                        ? t('drive_tools.plugin_ffmpeg_status_installed', { version: ffmpegStatus.version ? (ffmpegStatus.version.includes('version') ? ffmpegStatus.version.split(' ')[2] : ffmpegStatus.version) : t('drive_tools.plugin_status_ready') })
                        : t('drive_tools.plugin_ffmpeg_status_not_found')}
                    </strong>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="td-plugin-card-footer">
                  <div className="td-plugin-action-group">
                    <button
                      type="button"
                      className="td-chip-btn"
                      disabled={ffmpegBusy}
                      onClick={() => void refreshFfmpegStatus(undefined, true)}
                      style={{ justifyContent: 'center' }}
                    >
                      <RotateCcw size={13} className={ffmpegBusy ? 'spin' : ''} />
                      <span>{t('drive_tools.plugin_ffmpeg_btn_check')}</span>
                    </button>
                    <button
                      type="button"
                      className="td-chip-btn td-chip-primary"
                      disabled={ffmpegBusy || !!transferActive}
                      onClick={() => void handleUpdateFfmpeg()}
                      style={{ justifyContent: 'center' }}
                    >
                      {ffmpegBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                      <span>{ffmpegBusy ? t('drive_tools.plugin_ffmpeg_btn_updating') : t('drive_tools.plugin_ffmpeg_btn_update')}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. KARTU PLACEHOLDER PLUG-IN LAINNYA */}
              <div className="td-plugin-placeholder-card">
                <div className="td-plugin-placeholder-icon">
                  <Sparkles size={18} style={{ color: '#94a3b8' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
                    {t('drive_tools.plugin_more_title')}
                  </h4>
                </div>
                <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748b', maxWidth: '280px', lineHeight: 1.4 }}>
                  {t('drive_tools.plugin_more_desc')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: PENGATURAN LANJUTAN */}
        <AdvancedSettingsSection
          activeTab={activeTab}
          ctx={{
            t,
            draft,
            patch,
            triggerCaptionToast,
            setShowResetConfirm,
            showPresetDrawer,
            setShowPresetDrawer,
            activePresetId,
            SYSTEM_TRANSFER_PRESETS,
            setSelectedProfileId,
            setProfileName,
            activeTab,
            applyPreset,
            profiles,
            profileName,
            selectedProfileId,
            isDropdownOpen,
            setIsDropdownOpen,
            dropdownDirection,
            triggerRef,
            toggleDropdown,
            loadProfile,
            saveProfile,
            deleteProfile,
            transferActive,
            onChange,
            settings,
          }}
        />
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
