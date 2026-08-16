import { useTranslation } from 'react-i18next';
import {
  FolderPlus,
  Folder,
  RefreshCw,
  Home,
  HardDrive,
  MessageSquare,
  Users,
  Hash,
  Bot,
  Search,
  ArrowLeft,
  Rocket,
  ChevronDown,
  ChevronRight,
  X,
  Clock,
  Pin,
  Filter,
  Sparkles,
  User,
  Radio,
  MessagesSquare,
  Check,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { createPortal } from 'react-dom';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import type { DriveChat, DriveChatFolder, DriveFolder } from '../../../lib/telegram/driveTypes';
import type { DriveDropTarget } from '../../../lib/telegram';
import type { DriveRecent } from '../../../lib/telegram';
import {
  recentDisplayLabel,
  isDriveSessionCircuitTripped,
  getDriveSessionError,
  resetDriveSessionCircuit,
  getSessionDisplayName,
  applyDropEffect,
  beginFolderDrag,
  canAcceptDriveDrop,
  noteSidebarDragHover,
  noteSidebarDragScroll,
  shouldBlockDriveDrop,
  clearSidebarDragScrollGuard,
  endDriveDrag,
  endFolderDrag,
  getActiveFolderDrag,
  getDragSourceFolderId,
  hasOsFiles,
  isDropKeySameAsSource,
  getLastHoverDropKey,
  isFolderReparentDragActive,
  isInternalMediaDragActive,
  isPointerDriveDragActive,
  pickDropKeyAtPoint,
  setLastHoverDropKey,
  subscribeDriveDragUi,
} from '../../../lib/telegram';
import {
  chatFolderDropKey,
  parseChatFolderDropKey,
} from '../utils/chatFolderDrop';
import { DRIVE_FOLDER_SOFT_LIMIT, driveItemKind } from '../../../lib/telegram/driveTypes';
import {
  getCachedAvatar,
  prefetchAvatars,
  requestAvatar,
} from '../../../lib/media/avatarBatcher';
import {
  buildChatSearchIndex,
  buildFolderTreeRows,
  filterChatsFast,
  filterFoldersFast,
  folderAncestorIds,
  matchesSavedMessagesQuery,
  wouldCreateFolderCycle,
} from '../../../lib/telegram';
import { MediaSelect } from './MediaSelect';
import {
  getSidebarLayoutModel,
  subscribeSidebarLayoutModel,
  type SidebarLayoutModel,
} from '../../../stores/sidebarLayoutStore';

const LS_SEC_FOLDERS = 'td_sec_folders_open';
const LS_SEC_CHATS = 'td_sec_chats_open';
const TELEGRAM_FOLDER_COLORS = ['#ef4444', '#f59e0b', '#8b5cf6', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899'];

function telegramFolderColor(color?: number | null): string {

  return color != null && color >= 0
    ? TELEGRAM_FOLDER_COLORS[color % TELEGRAM_FOLDER_COLORS.length]
    : '#8b5cf6';
}

function readSecOpen(key: string, fallback = true): boolean {

  try {
    const v = localStorage.getItem(key);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeSecOpen(key: string, open: boolean): void {

  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function formatRelativeAccessTime(timestamp: number | undefined, t: (key: string, opts?: any) => string): string {
  if (!timestamp) return t('speedtest.time_recently');
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) {
    return t('speedtest.time_just_now');
  }
  if (diffMin < 60) {
    return t('speedtest.time_minutes_ago', { count: diffMin });
  }
  if (diffHours < 24) {
    return t('speedtest.time_hours_ago', { count: diffHours });
  }
  if (diffDays === 1) {
    return t('speedtest.time_yesterday');
  }
  return t('speedtest.time_days_ago', { count: diffDays });
}

type Props = {
  folders: DriveFolder[];
  chats: DriveChat[];
  chatFolders?: DriveChatFolder[];
  activeChatFolderId?: number;
  onSelectChatFolder?: (id: number) => void;
  activePeerId: number | null;
  locationKind: 'saved' | 'drive' | 'chat';
  onSelectSaved: () => void;
  onSelectDrive: (id: number) => void;
  onSelectChat: (id: number) => void;
  /** Create root Drive, or Folder when opts.parentId / current Drive/Folder set */
  onCreate: (opts?: { parentId?: number | null }) => void;
  onRefresh: () => void;
  loadingFolders?: boolean;
  loadingChats?: boolean;
  session: string;
  sessions: string[];
  onSessionChange: (s: string) => void;
  statusText?: string;
  connected?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Universal location query — filters Saved, Drives/Folders, and chats */
  chatQuery: string;
  onChatQuery: (q: string) => void;
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
  chatsHasMore?: boolean;
  chatsLoadingMore?: boolean;
  onLoadMoreChats?: () => void;
  onExitToApp?: () => void;
  onOpenRelogModal?: () => void;
  onDropOnLocation?: (target: DriveDropTarget, e: React.DragEvent) => void;
  mediaDragActive?: boolean;
  /**
   * Peer/folder the drag started from — rows matching this are invalid drop
   * targets (same location). undefined = not known / no internal drag.
   */
  dragSourceFolderId?: number | null;
  /** API credentials — needed to load real profile photos */
  creds?: DriveCredentials | null;
  /** Recent locations for quick jump */
  recents?: DriveRecent[];
  onSelectRecent?: (r: DriveRecent) => void;
  /** Pinned favorites */
  pins?: DriveRecent[];
  onSelectPin?: (r: DriveRecent) => void;
  /** Right-click on Saved / Drive folder / chat row */
  onLocationContextMenu?: (info: {
    locationKind: 'saved' | 'drive' | 'chat';
    id: number | null;
    name: string;
    x: number;
    y: number;
  }) => void;
  /**
   * Folder reparent via DnD: drag folder A onto folder B.
   * targetId null = not used (only drive targets).
   */
  onFolderReparentDrop?: (info: {
    folderId: number;
    folderName: string;
    targetId: number;
    targetName: string;
  }) => void;
  /** Soft channel-limit banner text (optional override) */
  channelLimitWarning?: string | null;
  /** Real-time ping and connection strength state */
  pingState?: {
    status: 'offline' | 'disconnected' | 'excellent' | 'good' | 'fair' | 'poor' | 'transferring';
    ms: number | null;
  };
};

function ChatIcon({ type }: { type: string }) {

  if (type === 'user') return <Users size={16} />;
  if (type === 'bot') return <Bot size={16} />;
  if (type === 'group') return <MessageSquare size={16} />;
  return <Hash size={16} />;
}

const TELEGRAM_GRADIENTS = [
  'linear-gradient(135deg, #fd746c 0%, #ff9068 100%)', // Red Coral
  'linear-gradient(135deg, #f2994a 0%, #f2c94c 100%)', // Orange Amber
  'linear-gradient(135deg, #38ef7d 0%, #11998e 100%)', // Emerald Green
  'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)', // Cyan Blue
  'linear-gradient(135deg, #8a2387 0%, #e94057 100%)', // Violet Magenta
  'linear-gradient(135deg, #00b4db 0%, #0083b0 100%)', // Ocean Blue
  'linear-gradient(135deg, #fc466b 0%, #3f5efb 100%)', // Electric Pink
  'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)', // Deep Purple
];

function getPeerGradient(peerId: number): string {
  const index = Math.abs(peerId || 0) % TELEGRAM_GRADIENTS.length;
  return TELEGRAM_GRADIENTS[index];
}

function getPeerInitials(title?: string): string {
  if (!title) return '';
  const clean = title.trim();
  if (!clean) return '';
  
  const words = clean.split(/[\s~_\-\[\]()]+/).filter(Boolean);
  if (words.length >= 2) {
    const w1 = words[0].replace(/^[^\w#]/g, '');
    const w2 = words[1].replace(/^[^\w]/g, '');
    const c1 = w1[0] || '';
    const c2 = w2[0] || '';
    const initials = (c1 + c2).toUpperCase();
    if (initials) return initials.slice(0, 2);
  }
  
  const w1 = words[0] || clean;
  const cleaned = w1.replace(/^[^\w#]/g, '');
  if (cleaned.length >= 2 && cleaned.startsWith('#')) {
    return cleaned.slice(0, 2).toUpperCase();
  }
  return (cleaned.slice(0, 1) || clean.slice(0, 1)).toUpperCase();
}

/** Real Telegram profile photo with Lucide / Telegram-style initial avatar fallback */
function PeerAvatar({
  peerId,
  creds,
  fallback,
  title,
}: {
  peerId: number;
  creds: DriveCredentials | null | undefined;
  fallback: React.ReactNode;
  title?: string;
}) {
  const cached = getCachedAvatar(peerId);
  const [url, setUrl] = useState<string | null>(() =>
    cached === undefined ? null : cached
  );
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBroken(false);
    const hit = getCachedAvatar(peerId);
    if (hit !== undefined) {
      setUrl(hit);
      return;
    }
    setUrl(null);
    if (!creds) return;
    void requestAvatar(creds, peerId).then((u: string | null) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [peerId, creds]);

  if (url && !broken) {
    return (
      <img
        className="td-peer-avatar"
        src={url}
        alt=""
        title={title}
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }

  // Telegram-style colorful initials fallback for chats without custom photos
  if (peerId !== 0 && title) {
    const initials = getPeerInitials(title);
    if (initials) {
      return (
        <span
          className="td-peer-avatar-initials"
          style={{
            background: getPeerGradient(peerId),
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '11px',
            letterSpacing: '-0.2px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            textTransform: 'uppercase',
            userSelect: 'none',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
          }}
          title={title}
        >
          {initials}
        </span>
      );
    }
  }

  return <span className="td-peer-avatar-fallback">{fallback}</span>;
}

function dropKey(kind: string, id: number | null) {

  return `${kind}:${id ?? 'me'}`;
}

function parseDropKey(key: string): { kind: DriveDropTarget['kind']; id: number | null } | null {

  const idx = key.indexOf(':');
  if (idx < 0) return null;
  const kind = key.slice(0, idx) as DriveDropTarget['kind'];
  const idPart = key.slice(idx + 1);
  if (kind === 'saved') return { kind: 'saved', id: null };
  if (kind !== 'drive' && kind !== 'chat') return null;
  const id = Number(idPart);
  if (!Number.isFinite(id)) return null;
  return { kind, id };
}

type DropRowProps = {
  dropKeyStr: string;
  className: string;
  title: string;
  isOver: boolean;
  /** Same as drag source — not a valid drop target for internal media */
  invalidTarget?: boolean;
  dragLive: boolean;
  /** Folder-reparent drag is active (green targets on other drive folders) */
  folderDragLive?: boolean;
  onActivate: () => void;
  /** Double-click (e.g. expand/collapse tree) — does not replace single-click select */
  onDoubleActivate?: () => void;
  onHover: (key: string | null) => void;
  onDropTarget: (key: string, e: React.DragEvent) => void;
  acceptDrop: (e: React.DragEvent) => boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Make row a drag source for Drive/Folder reparent */
  folderDragSource?: { folderId: number; folderName: string } | null;
};

function DropRow({
  dropKeyStr,
  className,
  title,
  isOver,
  invalidTarget,
  dragLive,
  folderDragLive,
  onActivate,
  onDoubleActivate,
  onHover,
  onDropTarget,
  acceptDrop,
  children,
  style,
  onContextMenu,
  folderDragSource,
}: DropRowProps) {

  const anyDrag = dragLive || !!folderDragLive;
  const [locationKind, locationPeerId] = dropKeyStr.split(':', 2);
  const allow = (e: React.DragEvent) =>
    dragLive || !!folderDragLive || acceptDrop(e) || isFolderReparentDragActive();

  return (
    <div
      role="button"
      tabIndex={0}
      data-drop-key={dropKeyStr}
      data-drop-invalid={invalidTarget ? '1' : '0'}
      data-location-kind={locationKind}
      data-peer-id={locationPeerId}
      draggable={!!folderDragSource}
      className={`${className}${isOver && !invalidTarget ? ' is-drop-over' : ''}${
        isOver && invalidTarget ? ' is-drop-invalid' : ''
      }${anyDrag ? ' dnd-ready' : ''}${invalidTarget && anyDrag ? ' dnd-self' : ''}${
        folderDragSource && getActiveFolderDrag()?.folderId === folderDragSource.folderId
          ? ' is-folder-dragging'
          : ''
      }`}
      style={style}
      title={
        invalidTarget && anyDrag
          ? 'Lokasi sumber — pilih chat/folder lain'
          : folderDragSource
            ? `${title} · seret ke folder lain untuk pindah`
            : title
      }
      onClick={onActivate}
      onDoubleClick={(e) => {
        if (!onDoubleActivate || dragLive || folderDragLive) return;
        e.preventDefault();
        e.stopPropagation();
        onDoubleActivate();
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        if (dragLive || folderDragLive) {
          endDriveDrag();
          endFolderDrag();
          onHover(null);
        }
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
        // ArrowRight/Left toggle tree when handler provided
        if (onDoubleActivate && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          e.stopPropagation();
          onDoubleActivate();
        }
      }}
      onDragStart={(e) => {
        if (!folderDragSource) return;
        e.stopPropagation();
        beginFolderDrag(folderDragSource);
        try {
          e.dataTransfer.setData('text/plain', `folder:${folderDragSource.folderId}`);
          e.dataTransfer.setData(
            'application/x-autogram-folder',
            String(folderDragSource.folderId)
          );
          e.dataTransfer.effectAllowed = 'move';
          // Transparent drag image — less “stuck” native glyph in WebView2
          const img = document.createElement('div');
          img.textContent = folderDragSource.folderName;
          img.style.cssText =
            'position:fixed;top:-999px;left:-999px;padding:6px 10px;border-radius:8px;background:#1e293b;color:#f1f5f9;font:600 12px system-ui;border:1px solid #3b82f6;';
          document.body.appendChild(img);
          e.dataTransfer.setDragImage(img, 12, 12);
          window.setTimeout(() => img.remove(), 0);
        } catch {
          /* ignore */
        }
      }}
      onDragEnd={() => {
        endFolderDrag();
        onHover(null);
      }}
      onDragEnter={(e) => {
        if (!allow(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (invalidTarget && anyDrag) applyDropEffect(e.dataTransfer, 'none');
        else if (folderDragLive || isFolderReparentDragActive())
          applyDropEffect(e.dataTransfer, 'move');
        else if (dragLive || isInternalMediaDragActive()) applyDropEffect(e.dataTransfer, 'move');
        else if (hasOsFiles(e.dataTransfer)) applyDropEffect(e.dataTransfer, 'copy');
        else applyDropEffect(e.dataTransfer, 'move');
        onHover(dropKeyStr);
      }}
      onDragOver={(e) => {
        if (!allow(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (invalidTarget && anyDrag) {
          applyDropEffect(e.dataTransfer, 'none');
        } else if (folderDragLive || isFolderReparentDragActive()) {
          applyDropEffect(e.dataTransfer, 'move');
        } else if (dragLive || isInternalMediaDragActive()) {
          applyDropEffect(e.dataTransfer, 'move');
        } else if (hasOsFiles(e.dataTransfer)) {
          applyDropEffect(e.dataTransfer, 'copy');
        } else {
          applyDropEffect(e.dataTransfer, 'move');
        }
        onHover(dropKeyStr);
      }}
      onDragLeave={(e) => {
        // WebView often gives relatedTarget=null mid-drag — don't clear green on child hops
        const rel = e.relatedTarget as Node | null;
        if (!rel) return;
        if (e.currentTarget.contains(rel)) return;
        onHover(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onHover(null);
        // Pointer internal drag: SpeedTest pointerup owns completion
        if (isPointerDriveDragActive()) return;
        if (invalidTarget && anyDrag && !hasOsFiles(e.dataTransfer)) {
          endFolderDrag();
          return;
        }
        if (shouldBlockDriveDrop(dropKeyStr)) {
          endFolderDrag();
          return;
        }
        onDropTarget(dropKeyStr, e);
      }}
    >
      {children}
    </div>
  );
}

export function DriveSidebar({
  folders,
  chats,
  chatFolders = [{ id: 0, title: 'Semua Chat', kind: 'all' }],
  activeChatFolderId = 0,
  onSelectChatFolder,
  activePeerId,
  locationKind,
  onSelectSaved,
  onSelectDrive,
  onSelectChat,
  onCreate,
  onRefresh,
  loadingFolders,
  loadingChats,
  session,
  sessions,
  onSessionChange,
  statusText,
  connected,
  collapsed,
  onToggleCollapse,
  chatQuery,
  onChatQuery,
  drawerOpen,
  onCloseDrawer,
  chatsHasMore,
  chatsLoadingMore,
  onLoadMoreChats,
  onExitToApp,
  onOpenRelogModal,
  onDropOnLocation,
  mediaDragActive,
  dragSourceFolderId,
  creds,
  recents = [],
  onSelectRecent,
  pins = [],
  onSelectPin,
  onLocationContextMenu,
  onFolderReparentDrop,
  channelLimitWarning,
  pingState,
}: Props) {
  const { t } = useTranslation();
  const [isCompactSearchActive, setIsCompactSearchActive] = useState<boolean>(false);

  const getPingTooltip = () => {
    if (pingState?.status === 'transferring') return t('speedtest.ping_transferring');
    if (!pingState) return connected ? t('speedtest.ping_drive_connected') : t('speedtest.ping_connected');
    if (pingState.status === 'offline') return t('speedtest.ping_offline');
    if (pingState.status === 'disconnected') return t('speedtest.ping_disconnected');
    
    const msLabel = pingState.ms != null ? `${pingState.ms} ms` : '';
    let label = 'Koneksi';
    if (pingState.status === 'excellent') label = t('speedtest.ping_excellent');
    if (pingState.status === 'good') label = t('speedtest.ping_good');
    if (pingState.status === 'fair') label = t('speedtest.ping_fair');
    if (pingState.status === 'poor') label = t('speedtest.ping_poor');

    return `Telegram: ${label} ${msLabel ? `(${msLabel})` : ''}`;
  };

  // Sidebar layout model (Model A / B / C) — reactive
  const [layoutModel, setLayoutModel] = useState<SidebarLayoutModel>(
    () => getSidebarLayoutModel()
  );
  useEffect(() => {
    return subscribeSidebarLayoutModel(setLayoutModel);
  }, []);

  // Active tab for Model A / B (saved|recent|drives|chats|home|pins)
  type SidebarTab = 'saved' | 'recent' | 'drives' | 'chats' | 'home' | 'pins';
  const [activeTab, setActiveTab] = useState<SidebarTab>('drives');

  // Keep sidebar tab in sync when location changes
  useEffect(() => {
    if (locationKind === 'drive') {
      setActiveTab('drives');
    } else if (locationKind === 'chat') {
      setActiveTab('chats');
    }
  }, [locationKind, activePeerId]);

  const [manualSpin, setManualSpin] = useState(false);
  const handleRefreshClick = () => {
    setManualSpin(true);
    setTimeout(() => setManualSpin(false), 800);
    onRefresh();
  };
  // Timer ref for 250ms hover-tab switch during drag
  const tabSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTabSwitchRef = useRef<SidebarTab | null>(null);
  const scheduleTabSwitch = (tab: SidebarTab) => {
    // Following the newest hover target matters when the pointer crosses tabs
    // faster than the dwell delay. The old timer must never open a stale tab.
    if (pendingTabSwitchRef.current === tab && tabSwitchTimerRef.current !== null) return;
    if (tabSwitchTimerRef.current !== null) clearTimeout(tabSwitchTimerRef.current);
    pendingTabSwitchRef.current = tab;
    tabSwitchTimerRef.current = setTimeout(() => {
      tabSwitchTimerRef.current = null;
      pendingTabSwitchRef.current = null;
      setActiveTab(tab);
      window.requestAnimationFrame(() => {
        const selector = tab === 'recent'
          ? '.td-recents'
          : tab === 'drives'
            ? '.td-dnd-folder-stack'
            : '.td-chat-section';
        navRef.current?.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: 'nearest' });
      });
    }, 220);
  };
  const cancelTabSwitch = () => {
    if (tabSwitchTimerRef.current !== null) {
      clearTimeout(tabSwitchTimerRef.current);
      tabSwitchTimerRef.current = null;
    }
    pendingTabSwitchRef.current = null;
  };
  const chatFolderSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChatFolderSwitchRef = useRef<number | null>(null);
  const scheduleChatFolderSwitch = (folderId: number) => {
    if (
      folderId === activeChatFolderId ||
      (pendingChatFolderSwitchRef.current === folderId && chatFolderSwitchTimerRef.current !== null)
    ) return;
    if (chatFolderSwitchTimerRef.current !== null) clearTimeout(chatFolderSwitchTimerRef.current);
    pendingChatFolderSwitchRef.current = folderId;
    chatFolderSwitchTimerRef.current = setTimeout(() => {
      chatFolderSwitchTimerRef.current = null;
      pendingChatFolderSwitchRef.current = null;
      openChatsSection();
      setActiveTab('chats');
      onSelectChatFolder?.(folderId);
      window.requestAnimationFrame(() => {
        chatListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }, 260);
  };
  const cancelChatFolderSwitch = () => {
    if (chatFolderSwitchTimerRef.current !== null) {
      clearTimeout(chatFolderSwitchTimerRef.current);
      chatFolderSwitchTimerRef.current = null;
    }
    pendingChatFolderSwitchRef.current = null;
  };
  // Clean up timer on unmount
  useEffect(() => () => {
    cancelTabSwitch();
    cancelChatFolderSwitch();
  }, []);

  const [overKey, setOverKey] = useState<string | null>(null);
  const [, setMetaTick] = useState(0);
  useEffect(() => {
    const handleUpdate = () => setMetaTick((t) => t + 1);
    window.addEventListener('autogram_session_metadata_updated', handleUpdate);
    return () => window.removeEventListener('autogram_session_metadata_updated', handleUpdate);
  }, []);
  /** Immediate flag — does not wait for React setState after dragstart */
  const [liveInternalDrag, setLiveInternalDrag] = useState(() => isInternalMediaDragActive());
  const [liveFolderDrag, setLiveFolderDrag] = useState(() => isFolderReparentDragActive());
  /** Section expand — more space when one list is collapsed (Google Drive–style) */
  const [foldersOpen, setFoldersOpen] = useState(() => readSecOpen(LS_SEC_FOLDERS, true));
  const [chatsOpen, setChatsOpen] = useState(() => readSecOpen(LS_SEC_CHATS, true));
  /** Expanded parent folders in the Drive tree (folder-in-folder) */
  const [treeExpanded, setTreeExpanded] = useState<Set<number>>(() => new Set());
  const navRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const chatFolderScrollRef = useRef<Map<number, number>>(new Map());
  const lastChatFolderRef = useRef(activeChatFolderId);
  const folderStackRef = useRef<HTMLDivElement | null>(null);
  const labelMap = useRef<Map<string, string>>(new Map());
  const sourceFolder =
    dragSourceFolderId !== undefined
      ? dragSourceFolderId
      : getDragSourceFolderId();
  const isSelf = (key: string) => {
    const fd = getActiveFolderDrag();
    if (fd) {
      // Self or would create a cycle (drop into own descendant)
      if (key === dropKey('drive', fd.folderId)) return true;
      const parsed = parseDropKey(key);
      if (parsed?.kind === 'drive' && parsed.id != null) {
        return wouldCreateFolderCycle(folders, fd.folderId, parsed.id);
      }
      // Chat/saved are not folder-reparent targets
      if (parsed && parsed.kind !== 'drive') return true;
      return false;
    }
    return sourceFolder !== undefined && isDropKeySameAsSource(key, sourceFolder ?? null);
  };

  useEffect(() => {
    const previous = lastChatFolderRef.current;
    const el = chatListRef.current;
    if (el) chatFolderScrollRef.current.set(previous, el.scrollTop);
    lastChatFolderRef.current = activeChatFolderId;
    const restore = chatFolderScrollRef.current.get(activeChatFolderId) || 0;
    const frame = requestAnimationFrame(() => {
      if (chatListRef.current) chatListRef.current.scrollTop = restore;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeChatFolderId]);

  // Precomputed haystacks — search stays O(n) but cheap for 10k rows
  const chatIndex = useMemo(() => buildChatSearchIndex(chats), [chats]);
  const locationQuery = chatQuery;
  const hasLocationQuery = !!locationQuery.trim();
  const chatRows = useMemo(
    () => filterChatsFast(chatIndex, locationQuery),
    [chatIndex, locationQuery]
  );
  const folderRows = useMemo(
    () => filterFoldersFast(folders, locationQuery),
    [folders, locationQuery]
  );
  // First load: expand every parent so nested folders are visible by default
  const treeSeededRef = useRef(false);
  useEffect(() => {
    if (treeSeededRef.current || !folders.length) return;
    const idSet = new Set(folders.map((f: any) => f.id));
    const parents = new Set<number>();
    for (const f of folders) {
      if (f.parent_id != null && idSet.has(f.parent_id) && f.parent_id !== f.id) {
        parents.add(f.parent_id);
      }
    }
    if (parents.size) setTreeExpanded(parents);
    treeSeededRef.current = true;
  }, [folders]);

  // Auto-expand ancestors only when the *selected* folder changes — not on every
  // folders[] refresh (that was re-opening nodes the user just collapsed).
  const lastTreeExpandPeerRef = useRef<number | null>(null);
  useEffect(() => {
    if (locationKind !== 'drive' || activePeerId == null) {
      if (locationKind !== 'drive') lastTreeExpandPeerRef.current = null;
      return;
    }
    const ancestors = folderAncestorIds(folders, activePeerId);
    if (!ancestors.length) return;
    const peerChanged = lastTreeExpandPeerRef.current !== activePeerId;
    if (!peerChanged) return;
    lastTreeExpandPeerRef.current = activePeerId;
    setTreeExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [locationKind, activePeerId, folders]);

  const folderTreeRows = useMemo(() => {
    if (hasLocationQuery) {
      return buildFolderTreeRows(folderRows, { forceFlat: true });
    }
    return buildFolderTreeRows(folders, { expandedIds: treeExpanded });
  }, [folders, folderRows, hasLocationQuery, treeExpanded]);

  const pinnedDriveIds = useMemo(() => {
    return new Set(
      pins.filter((p: any) => p.kind === 'drive' && p.id != null).map((p: any) => Number(p.id))
    );
  }, [pins]);

  const pinnedChatIds = useMemo(() => {
    return new Set(
      pins.filter((p: any) => p.kind === 'chat' && p.id != null).map((p: any) => Number(p.id))
    );
  }, [pins]);

  const displayFolderTreeRows = useMemo(() => {
    if (pinnedDriveIds.size === 0) return folderTreeRows;
    return folderTreeRows.filter(({ folder: f }) => !pinnedDriveIds.has(f.id));
  }, [folderTreeRows, pinnedDriveIds]);

  const displayChatRows = useMemo(() => {
    if (pinnedChatIds.size === 0) return chatRows;
    return chatRows.filter((c) => !pinnedChatIds.has(c.id));
  }, [chatRows, pinnedChatIds]);

  const [chatTypeFilter, setChatTypeFilter] = useState<'all' | 'user' | 'group' | 'channel' | 'bot' | 'forum'>('all');
  const [typeFilterMenuOpen, setTypeFilterMenuOpen] = useState(false);
  const typeFilterMenuRef = useRef<HTMLDivElement>(null);
  const typeFilterButtonRef = useRef<HTMLButtonElement>(null);
  const chatFoldersScrollerRef = useRef<HTMLDivElement>(null);
  const [chatFoldersScrolled, setChatFoldersScrolled] = useState(false);
  const [typeFilterMenuPosition, setTypeFilterMenuPosition] = useState({ left: 0, top: 0 });

  const activeChatTypeLabel = chatTypeFilter === 'all' ? t('speedtest.filter_all_chats') :
    chatTypeFilter === 'user' ? t('speedtest.filter_private') :
    chatTypeFilter === 'group' ? t('speedtest.filter_groups') :
    chatTypeFilter === 'channel' ? t('speedtest.filter_channels') :
    chatTypeFilter === 'bot' ? t('speedtest.filter_bots') :
    t('speedtest.filter_forums');

  const toggleTypeFilterMenu = useCallback((event?: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event?.currentTarget.getBoundingClientRect() || typeFilterButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setTypeFilterMenuPosition({ left: rect.left, top: rect.bottom + 6 });
    }
    setTypeFilterMenuOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!typeFilterMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (
        typeFilterMenuRef.current &&
        !typeFilterMenuRef.current.contains(e.target as Node) &&
        !target?.closest?.('.td-chat-type-filter-pill') &&
        !target?.closest?.('[data-chat-type-dropdown]')
      ) {
        setTypeFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [typeFilterMenuOpen]);

  const filteredByTypeChats = useMemo(() => {
    if (chatTypeFilter === 'all') return displayChatRows;
    return displayChatRows.filter((c: any) => {
      if (chatTypeFilter === 'bot') return c.is_bot || c.type === 'bot';
      if (chatTypeFilter === 'forum') return !!c.is_forum;
      if (chatTypeFilter === 'group') return c.type === 'group' && !c.is_forum;
      if (chatTypeFilter === 'channel') return c.type === 'channel';
      if (chatTypeFilter === 'user') return (c.type === 'user' || !c.type) && !c.is_bot;
      return true;
    });
  }, [displayChatRows, chatTypeFilter]);

  const toggleTreeFolder = useCallback((id: number) => {
    setTreeExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const createIsSubfolder = locationKind === 'drive' && activePeerId != null;
  const activeDriveFolder = useMemo(
    () =>
      locationKind === 'drive' && activePeerId != null
        ? folders.find((f: any) => f.id === activePeerId) || null
        : null,
    [locationKind, activePeerId, folders]
  );

  const showSaved = useMemo(
    () => matchesSavedMessagesQuery(locationQuery),
    [locationQuery]
  );
  const filteredRecents = useMemo(() => {
    if (layoutModel === 'model_a') {
      const pinnedKeys = new Set(pins.map((p) => `${p.kind}:${p.id ?? 'me'}`));
      pinnedKeys.add('saved:me');
      return recents.filter((r) => !pinnedKeys.has(`${r.kind}:${r.id ?? 'me'}`));
    }
    return recents;
  }, [recents, pins, layoutModel]);
  const busy = !!(loadingFolders || loadingChats);

  // While searching or dragging, force sections open so targets stay reachable.
  // Include folder-reparent drag + live flag so short windows always show Chats list.
  const forceSectionsOpen =
    hasLocationQuery ||
    liveInternalDrag ||
    liveFolderDrag ||
    !!mediaDragActive ||
    isInternalMediaDragActive() ||
    isFolderReparentDragActive();
  const foldersExpanded = forceSectionsOpen || foldersOpen || collapsed;
  const chatsExpanded = forceSectionsOpen || chatsOpen || collapsed;

  // Persist open on drag so layout stays stable after first frame (no mid-drop collapse)
  useEffect(() => {
    const dragging =
      liveInternalDrag ||
      liveFolderDrag ||
      !!mediaDragActive ||
      isInternalMediaDragActive() ||
      isFolderReparentDragActive();
    if (!dragging) return;
    setFoldersOpen((o) => {
      if (!o) writeSecOpen(LS_SEC_FOLDERS, true);
      return true;
    });
    setChatsOpen((o) => {
      if (!o) writeSecOpen(LS_SEC_CHATS, true);
      return true;
    });
    // Clear filter so all drop targets show
    onChatQuery?.('');
    // Pin nav to top so DRIVES [TD] is visible (SS 231555: only Chats showed on small windows).
    // Zone auto-scroll can move down later if user aims at lower chats.
    window.requestAnimationFrame(() => {
      if (navRef.current) navRef.current.scrollTop = 0;
      if (folderStackRef.current) folderStackRef.current.scrollTop = 0;
      if (chatListRef.current) chatListRef.current.scrollTop = 0;
      // Ensure Drives header is in view (sticky + scroll)
      const drivesToggle = navRef.current?.querySelector(
        '.td-dnd-folder-stack .td-section-toggle'
      ) as HTMLElement | null;
      drivesToggle?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [liveInternalDrag, liveFolderDrag, mediaDragActive, onChatQuery]);

  const openFoldersSection = useCallback(() => {
    setFoldersOpen((prev) => {
      if (prev) return prev;
      writeSecOpen(LS_SEC_FOLDERS, true);
      return true;
    });
  }, []);
  const openChatsSection = useCallback(() => {
    setChatsOpen((prev) => {
      if (prev) return prev;
      writeSecOpen(LS_SEC_CHATS, true);
      return true;
    });
  }, []);

  const toggleFolders = useCallback(() => {
    setFoldersOpen((prev) => {
      const next = !prev;
      writeSecOpen(LS_SEC_FOLDERS, next);
      return next;
    });
  }, []);
  const toggleChats = useCallback(() => {
    setChatsOpen((prev) => {
      const next = !prev;
      writeSecOpen(LS_SEC_CHATS, next);
      return next;
    });
  }, []);

  // Virtual list scrolls inside .td-chat-virtual (flex:1 fills leftover height).
  // On short viewports, chrome is compacted via CSS so this pane stays usable.
  const chatVirtualizer = useVirtualizer({
    count: filteredByTypeChats.length,
    getScrollElement: () => chatListRef.current,
    estimateSize: () => (collapsed ? 44 : 44),
    overscan: collapsed ? 20 : 40,
  });

  /* Native smooth scrolling in collapsed mode */

  const virtualItems = chatVirtualizer.getVirtualItems();
  const vStart = virtualItems[0]?.index ?? 0;
  const vEnd = virtualItems[virtualItems.length - 1]?.index ?? -1;

  // Prefetch avatars ONLY for visible rows (+ folders + self) — never whole chatRows
  useEffect(() => {
    if (!creds) return;
    const ids: number[] = [0];
    for (const f of folders.slice(0, 12)) ids.push(f.id);
    if (vEnd >= vStart && vEnd >= 0) {
      for (let i = vStart; i <= vEnd; i++) {
        const c = chatRows[i];
        if (c) ids.push(c.id);
      }
    } else {
      for (const c of chatRows.slice(0, 12)) ids.push(c.id);
    }
    prefetchAvatars(creds, ids);
  }, [creds, folders, vStart, vEnd, chatRows]);

  // Near end of virtual list → load more pages (user scroll only — not auto full dump)
  useEffect(() => {
    if (collapsed || !chatsHasMore || chatsLoadingMore) return;
    if (vEnd < 0 || !chatRows.length) return;
    if (vEnd >= chatRows.length - 6) {
      onLoadMoreChats?.();
    }
  }, [vEnd, chatRows.length, chatsHasMore, chatsLoadingMore, collapsed, onLoadMoreChats]);

  // Re-measure when chrome changes (not on every chatRows identity)
  useEffect(() => {
    chatVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, folders.length, folderRows.length, chatQuery, foldersExpanded, chatsExpanded]);

  // Subscribe so green targets activate the same tick as beginDriveDrag()
  useEffect(() => {
    return subscribeDriveDragUi(() => {
      setLiveInternalDrag(isInternalMediaDragActive());
      setLiveFolderDrag(isFolderReparentDragActive());
      if (!isInternalMediaDragActive() && !isFolderReparentDragActive()) setOverKey(null);
    });
  }, []);

  const dragLive = !!(mediaDragActive || liveInternalDrag || isInternalMediaDragActive());
  const folderDragLive = !!(liveFolderDrag || isFolderReparentDragActive());
  /** Media move OR folder reparent — both need hit-test, green targets, document drop */
  const anyDragLive = dragLive || folderDragLive;

  const acceptDrop = useCallback(
    (e: React.DragEvent) =>
      canAcceptDriveDrop(
        e.dataTransfer,
        mediaDragActive || dragLive || isInternalMediaDragActive()
      ) || isFolderReparentDragActive(),
    [mediaDragActive, dragLive]
  );

  const handleHover = useCallback((key: string | null) => {
    noteSidebarDragHover(key);
    // No green "ready" on Drive rows while still scrolling / before dwell
    if (key && shouldBlockDriveDrop(key)) {
      setOverKey(null);
      return;
    }
    setOverKey(key);
    if (key) setLastHoverDropKey(key);
  }, []);

  const handleDropKey = useCallback(
    (key: string, e: React.DragEvent | DragEvent) => {
      // Accidental drop while scrolling past Drives (fly-by)
      if (shouldBlockDriveDrop(key)) {
        endFolderDrag();
        return;
      }
      const folderDrag = getActiveFolderDrag();
      if (folderDrag && onFolderReparentDrop) {
        const parsed = parseDropKey(key);
        if (
          parsed?.kind === 'drive' &&
          parsed.id != null &&
          parsed.id !== folderDrag.folderId &&
          !wouldCreateFolderCycle(folders, folderDrag.folderId, parsed.id)
        ) {
          const label = labelMap.current.get(key) || key;
          onFolderReparentDrop({
            folderId: folderDrag.folderId,
            folderName: folderDrag.folderName,
            targetId: parsed.id,
            targetName: label,
          });
        }
        endFolderDrag();
        return;
      }
      if (!onDropOnLocation) return;
      const parsed = parseDropKey(key);
      if (!parsed) return;
      const label = labelMap.current.get(key) || key;
      onDropOnLocation({ kind: parsed.kind, id: parsed.id, label }, e as React.DragEvent);
    },
    [onDropOnLocation, onFolderReparentDrop, folders]
  );

  const handleDropKeyRef = useRef(handleDropKey);
  handleDropKeyRef.current = handleDropKey;

  // Document-level tracking: geometry hit-test for HTML5 + pointer drag.
  // Hover only here — SpeedTest owns pointer-drop completion (avoids double-fire race).
  // Also edge auto-scrolls the virtual chat list so off-screen chats become drop targets.
  // IMPORTANT: include folder reparent drag — without it WebView2 folder→Drive DnD dies
  // (HTML5 drop alone is unreliable; document capture is required).
  useEffect(() => {
    if (!anyDragLive) {
      setOverKey(null);
      clearSidebarDragScrollGuard();
      return;
    }

    const hit = (clientX: number, clientY: number) => {
      const root = sidebarRef.current || navRef.current;
      return pickDropKeyAtPoint(clientX, clientY, root);
    };

    let lastY = 0;
    let lastX = 0;
    let hasPointer = false;
    let raf = 0;
    let loadMoreCool = 0;
    /** Fractional px accumulator — smooth sub-pixel crawl at low speeds */
    let scrollCarry = 0;
    /** Time-based velocity in px/s; independent from 60/120/144 Hz displays. */
    let currentVelocity = 0;
    let lastFrameAt = performance.now();
    /** Cooldown timestamp to pause auto-scroll while user is actively turning mouse wheel */
    let wheelScrollUntil = 0;
    /**
     * Speed to resume from after wheel cooldown expires.
     * Prevents RAF from abruptly re-accelerating from 0 after a wheel session.
     */
    let velocityAfterWheel = 0;

    const canScroll = (el: HTMLElement, dir: 'up' | 'down') => {
      if (dir === 'up') return el.scrollTop > 1;
      return el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    };

    const applyScroll = (el: HTMLElement, dir: 'up' | 'down', step: number) => {
      // Accumulate fractional steps so slow speeds don't quantize to 0
      scrollCarry += Math.max(0, step);
      if (scrollCarry < 0.1) return;
      const px = scrollCarry;
      scrollCarry = 0;
      noteSidebarDragScroll(px);
      if (dir === 'up') el.scrollTop = Math.max(0, el.scrollTop - px);
      else {
        el.scrollTop = Math.min(
          Math.max(0, el.scrollHeight - el.clientHeight),
          el.scrollTop + px
        );
      }
    };

    let lastHoverTime = 0;
    /** Hover key with dwell/scroll guard for Drive rows */
    const applyHoverKey = (key: string | null) => {
      noteSidebarDragHover(key);
      if (key && shouldBlockDriveDrop(key)) {
        // Keep tracking dwell, but don't show "drop ready" green yet
        setOverKey(null);
        return;
      }
      // During active high-speed auto-scrolling, suppress transient hover churn.
      // suppress state churn from rows rapidly flying past under stationary cursor.
      // This prevents React re-render stutter and stops visual hover flicker/glitches.
      if (currentVelocity > 700) {
        setOverKey(null);
        return;
      }
      const now = Date.now();
      if (now - lastHoverTime > 40 || !key) {
        lastHoverTime = now;
        setOverKey((prev) => (prev === key ? prev : key));
        if (key) setLastHoverDropKey(key);
      }
    };

    const tryLoadMore = (el: HTMLElement) => {
      if (
        el.scrollTop + el.clientHeight >= el.scrollHeight - Math.max(360, el.clientHeight * 0.75) &&
        Date.now() - loadMoreCool > 350
      ) {
        loadMoreCool = Date.now();
        onLoadMoreChats?.();
      }
    };

    /**
     * High-Speed Smooth Drag Auto-Scroll Controller
     * - Wide 140px edge zone for effortless, natural entry
     * - Speed range: 12px (entry) → 96px (deep edge) per RAF frame (~5760px/s)
     * - Fast EMA Lerp 0.50: instant speed buildup without frame drops
     * - OverKey state pause during active scroll eliminates DOM hover churn & glitches
     */
    const performDragAutoScroll = (_x: number, y: number, deltaSeconds: number) => {
      // Pause auto-scroll while user is actively turning mouse wheel.
      // Instead of hard-resetting to 0, decay gradually so that when
      // cooldown expires the speed re-enters smoothly from speedAfterWheel.
      if (Date.now() < wheelScrollUntil) {
        currentVelocity = currentVelocity * 0.80;
        return;
      }
      // Cooldown just expired: seed currentSpeed from the preserved snapshot
      // so auto-scroll doesn't restart from a dead stop (avoids the "jolt")
      if (velocityAfterWheel > 0) {
        currentVelocity = Math.max(currentVelocity, velocityAfterWheel);
        velocityAfterWheel = 0;
      }
      const side = sidebarRef.current?.getBoundingClientRect();
      if (!side) return;

      const chatEl = chatListRef.current;
      const foldersEl = folderStackRef.current;
      const navEl = navRef.current;

      const chatRect = chatEl?.getBoundingClientRect();
      const foldersRect = foldersEl?.getBoundingClientRect();
      const navRect = navEl?.getBoundingClientRect();

      const isOverChat = !!chatRect && y >= chatRect.top - 10 && y <= chatRect.bottom + 10;
      const isOverFolders = !!foldersRect && y >= foldersRect.top - 10 && y <= foldersRect.bottom + 10;

      let primaryTarget: HTMLElement | null = null;
      let targetRect: DOMRect | null = null;

      if (isOverChat && chatEl && chatEl.scrollHeight > chatEl.clientHeight + 2) {
        primaryTarget = chatEl;
        targetRect = chatRect;
      } else if (isOverFolders && foldersEl && foldersEl.scrollHeight > foldersEl.clientHeight + 2) {
        primaryTarget = foldersEl;
        targetRect = foldersRect;
      } else if (navEl && navEl.scrollHeight > navEl.clientHeight + 2) {
        primaryTarget = navEl;
        targetRect = navRect || side;
      }

      if (!primaryTarget || !targetRect) {
        // Gentle decay when no scrollable target found — avoids abrupt speed reset
        currentVelocity = currentVelocity * 0.82;
        return;
      }

      // Precision Deadband + Edge Hot-Zone Controller:
      // Visible list items in the main body (between top+28px and bottom-40px)
      // are 100% hoverable without premature auto-scrolling.
      // Auto-scrolling ONLY triggers when pushing into top/bottom hot-zones.
      const HOT_ZONE_BOTTOM = 88;
      const HOT_ZONE_TOP = 64;
      let dir: 'up' | 'down' | null = null;
      let dist = 0;
      let maxDepth = 120;

      if (y >= targetRect.bottom - HOT_ZONE_BOTTOM) {
        dir = 'down';
        dist = y - (targetRect.bottom - HOT_ZONE_BOTTOM);
        maxDepth = 120;
      } else if (y <= targetRect.top + HOT_ZONE_TOP) {
        dir = 'up';
        dist = (targetRect.top + HOT_ZONE_TOP) - y;
        maxDepth = 100;
      }

      if (!dir) {
        // Cursor is over visible list items (e.g. RANDOM LAVENDER):
        // Immediately halt auto-scroll so hover selection is 100% precise!
        currentVelocity = currentVelocity * 0.38;
        if (currentVelocity < 8) currentVelocity = 0;
        return;
      }

      // Progressive time-based velocity: responsive near the edge without
      // frame-rate-dependent jumps on high-refresh/DPI displays.
      const ratio = Math.max(0.0, Math.min(1.0, dist / maxDepth));
      const targetVelocity = 520 + Math.pow(ratio, 1.35) * 2480; // 520..3000 px/s
      const smoothing = 1 - Math.exp(-12 * deltaSeconds);
      currentVelocity += (targetVelocity - currentVelocity) * smoothing;
      const activeStep = Math.max(1, currentVelocity * deltaSeconds);

      // Execute cascade scroll: try primaryTarget first, then fallback to navEl
      if (canScroll(primaryTarget, dir)) {
        applyScroll(primaryTarget, dir, activeStep);
        if (dir === 'down' && primaryTarget === chatEl) {
          tryLoadMore(chatEl);
        }
      } else if (navEl && primaryTarget !== navEl && canScroll(navEl, dir)) {
        applyScroll(navEl, dir, activeStep);
      }
    };

    const edgeScroll = () => {
      const frameAt = performance.now();
      const deltaSeconds = Math.min(0.032, Math.max(0.001, (frameAt - lastFrameAt) / 1000));
      lastFrameAt = frameAt;
      if (hasPointer) {
        const side = sidebarRef.current?.getBoundingClientRect();
        if (side) {
          const left = side.left - 24;
          const right = side.right + 24;
          const inX = lastX >= left && lastX <= right;
          if (inX) {
            // Horizontal auto-scroll for chat folder chips strip during drag
            const chipScroller = chatFoldersScrollerRef.current;
            if (chipScroller) {
              const chipR = chipScroller.getBoundingClientRect();
              if (
                lastY >= chipR.top - 24 &&
                lastY <= chipR.bottom + 30
              ) {
                const edgeZone = 75;
                if (lastX >= chipR.right - edgeZone) {
                  const depth = Math.min(1, Math.max(0.2, (lastX - (chipR.right - edgeZone)) / edgeZone));
                  chipScroller.scrollLeft += Math.max(4, Math.floor(depth * 18));
                } else if (lastX <= chipR.left + edgeZone) {
                  const depth = Math.min(1, Math.max(0.2, (chipR.left + edgeZone - lastX) / edgeZone));
                  chipScroller.scrollLeft -= Math.max(4, Math.floor(depth * 18));
                }
              }
            }

            // Universal Desktop Standard Vertical Auto-Scroll Engine
            performDragAutoScroll(lastX, lastY, deltaSeconds);
          }
        }
      }
      raf = requestAnimationFrame(edgeScroll);
    };
    raf = requestAnimationFrame(edgeScroll);

    // HTML5 path (folder reparent + OS files + rare HTML5 media). Pointer media = highlight only.
    const onDragOver = (e: DragEvent) => {
      // Pointer-only internal *media* drag has no HTML5 DataTransfer — skip dropEffect war
      if (isPointerDriveDragActive() && !isFolderReparentDragActive()) {
        lastX = e.clientX;
        lastY = e.clientY;
        hasPointer = true;
        e.preventDefault();
        const key = hit(e.clientX, e.clientY);
        applyHoverKey(key);
        return;
      }
      e.preventDefault();
      lastX = e.clientX;
      lastY = e.clientY;
      hasPointer = true;
      const key = hit(e.clientX, e.clientY);
      if (key?.startsWith('tab:')) {
        scheduleTabSwitch(key.slice('tab:'.length) as SidebarTab);
        cancelChatFolderSwitch();
      } else if (parseChatFolderDropKey(key) != null) {
        cancelTabSwitch();
        scheduleChatFolderSwitch(parseChatFolderDropKey(key)!);
      } else {
        cancelTabSwitch();
        cancelChatFolderSwitch();
      }
      const folderDrag = getActiveFolderDrag();
      if (folderDrag || isFolderReparentDragActive()) {
        const invalid = !key || isSelf(key) || shouldBlockDriveDrop(key);
        applyDropEffect(e.dataTransfer, invalid ? 'none' : 'move');
        applyHoverKey(invalid ? null : key);
        return;
      }
      const self =
        !!key &&
        sourceFolder !== undefined &&
        isDropKeySameAsSource(key, sourceFolder ?? null);
      if (isInternalMediaDragActive() || dragLive) {
        const blockDrive = shouldBlockDriveDrop(key);
        applyDropEffect(e.dataTransfer, self || blockDrive ? 'none' : 'move');
        applyHoverKey(self || blockDrive ? null : key);
      } else if (hasOsFiles(e.dataTransfer as DataTransfer)) {
        applyDropEffect(e.dataTransfer, 'copy');
        applyHoverKey(key);
      } else {
        applyDropEffect(e.dataTransfer, 'none');
        applyHoverKey(null);
      }
    };

    const onDragEnter = (e: DragEvent) => {
      if (isPointerDriveDragActive() && !isFolderReparentDragActive()) return;
      e.preventDefault();
      if (isFolderReparentDragActive() || isInternalMediaDragActive() || dragLive) {
        applyDropEffect(e.dataTransfer, 'move');
      } else if (hasOsFiles(e.dataTransfer as DataTransfer)) {
        applyDropEffect(e.dataTransfer, 'copy');
      }
    };

    const onDrop = (e: DragEvent) => {
      // Pointer path completes in SpeedTest — do NOT double-fire media move
      if (isPointerDriveDragActive() && !isFolderReparentDragActive()) {
        e.preventDefault();
        e.stopPropagation();
        setOverKey(null);
        return;
      }
      const dt = e.dataTransfer;
      const isOs = !!(dt && hasOsFiles(dt));
      const isFolderDrag = isFolderReparentDragActive() || !!getActiveFolderDrag();
      const isInternal = isInternalMediaDragActive() || mediaDragActive;
      if (!isInternal && !isOs && !isFolderDrag) return;
      const key = hit(e.clientX, e.clientY) || getLastHoverDropKey();
      if (!key) {
        if (isFolderDrag) endFolderDrag();
        return;
      }
      const chatFolderId = parseChatFolderDropKey(key);
      if (chatFolderId != null) {
        e.preventDefault();
        e.stopPropagation();
        scheduleChatFolderSwitch(chatFolderId);
        endDriveDrag();
        setOverKey(null);
        return;
      }
      if (isFolderDrag) {
        e.preventDefault();
        e.stopPropagation();
        setOverKey(null);
        if (!isSelf(key) && !shouldBlockDriveDrop(key)) handleDropKeyRef.current(key, e);
        else endFolderDrag();
        return;
      }
      if (
        isInternal &&
        sourceFolder !== undefined &&
        isDropKeySameAsSource(key, sourceFolder ?? null) &&
        !isOs
      ) {
        e.preventDefault();
        e.stopPropagation();
        setOverKey(null);
        return;
      }
      if (shouldBlockDriveDrop(key)) {
        e.preventDefault();
        e.stopPropagation();
        setOverKey(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setOverKey(null);
      handleDropKeyRef.current(key, e);
    };

    // Pointer path: hover only (SpeedTest owns pointerup → move)
    const onPointerMove = (e: PointerEvent) => {
      if (
        !isInternalMediaDragActive() &&
        !mediaDragActive &&
        !dragLive &&
        !isPointerDriveDragActive() &&
        !isFolderReparentDragActive() &&
        !folderDragLive
      )
        return;
      lastX = e.clientX;
      lastY = e.clientY;
      hasPointer = true;
      // Hover on section headers → force-open that section (small windows / collapsed)
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      for (const node of stack) {
        if (!(node instanceof Element)) continue;
        const toggle = node.closest('.td-section-toggle');
        if (!toggle) continue;
        const label = (toggle.textContent || '').toLowerCase();
        if (label.includes('chat')) {
          openChatsSection();
          // Bring chats header into view when user aims at the collapse/expand row
          window.requestAnimationFrame(() => {
            toggle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            const nav = navRef.current;
            if (nav) {
              const tr = toggle.getBoundingClientRect();
              const nr = nav.getBoundingClientRect();
              if (tr.bottom > nr.bottom - 8) {
                nav.scrollTop += tr.bottom - nr.bottom + 48;
              }
            }
          });
        } else if (label.includes('drive')) {
          openFoldersSection();
        }
        break;
      }
      const key = hit(e.clientX, e.clientY);
      // Tab hover auto-switch (Model A / B): hover tab button for 250ms → switch
      if (key && key.startsWith('tab:')) {
        const tab = key.slice('tab:'.length) as SidebarTab;
        scheduleTabSwitch(tab);
        cancelChatFolderSwitch();
      } else if (parseChatFolderDropKey(key) != null) {
        cancelTabSwitch();
        scheduleChatFolderSwitch(parseChatFolderDropKey(key)!);
      } else {
        cancelTabSwitch();
        cancelChatFolderSwitch();
      }
      applyHoverKey(key);
    };

    // Direct Wheel Scroll during drag (Mouse wheel & Trackpad support)
    // Conflict-free design:
    //   1. Detect trackpad vs physical mouse wheel for optimal cooldown (60ms vs 180-350ms)
    //   2. Ignore trackpad surface micro-noise (<0.6px)
    //   3. Cascade scroll: if inner list hits top/bottom, pass remaining delta to navEl
    //   4. Preserve speedAfterWheel so auto-scroll smoothly continues when trackpad stops
    const onWheel = (e: WheelEvent) => {
      const isDragging =
        isPointerDriveDragActive() ||
        isInternalMediaDragActive() ||
        mediaDragActive ||
        dragLive ||
        folderDragLive ||
        isFolderReparentDragActive();

      if (!isDragging) return;

      const side = sidebarRef.current?.getBoundingClientRect();
      if (!side) return;
      if (e.clientX < side.left - 24 || e.clientX > side.right + 24) return;

      // Ignore tiny trackpad surface touch drift (<0.6px) to avoid interrupting auto-scroll
      if (Math.abs(e.deltaY) < 0.6 && Math.abs(e.deltaX) < 0.6) return;

      hasPointer = true;

      const chatEl = chatListRef.current;
      const foldersEl = folderStackRef.current;
      const navEl = navRef.current;

      const chatRect = chatEl?.getBoundingClientRect();
      const foldersRect = foldersEl?.getBoundingClientRect();

      const isOverChat = !!chatRect && e.clientY >= chatRect.top && e.clientY <= chatRect.bottom;
      const isOverFolders = !!foldersRect && e.clientY >= foldersRect.top && e.clientY <= foldersRect.bottom;

      let primaryTarget: HTMLElement | null = null;

      if (isOverChat && chatEl && chatEl.scrollHeight > chatEl.clientHeight) {
        primaryTarget = chatEl;
      } else if (isOverFolders && foldersEl && foldersEl.scrollHeight > foldersEl.clientHeight) {
        primaryTarget = foldersEl;
      } else if (navEl && navEl.scrollHeight > navEl.clientHeight) {
        primaryTarget = navEl;
      }

      if (primaryTarget || navEl) {
        e.preventDefault();

        // Trackpad detection: deltaMode===0 with small or fractional deltaY
        const isTrackpad = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && (
          !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40
        );

        // Normalize delta across deltaMode (PIXEL=0, LINE=1, PAGE=2)
        let pixelDelta: number;
        if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
          pixelDelta = e.deltaY * 28;
        } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
          const pageH = (primaryTarget || navEl)?.clientHeight || 400;
          pixelDelta = e.deltaY * (pageH * 0.85);
        } else {
          // Trackpad / pixel mode — direct delta, capped at ±250 max per frame
          pixelDelta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 250);
        }

        // Cooldown tuning:
        // Trackpad emits events every 8-16ms while finger moves.
        // A 60ms cooldown (~3 frames at 60Hz) is optimal so auto-scroll resumes
        // almost instantly 60ms after trackpad fingers stop!
        // Physical mouse wheel receives 180-350ms adaptive cooldown for discrete step clicks.
        const absDelta = Math.abs(pixelDelta);
        const cooldown = isTrackpad
          ? 60
          : (absDelta > 100 ? 350 : 180);

        wheelScrollUntil = Date.now() + cooldown;

        // Preserve auto-scroll speed snapshot so RAF re-enters smoothly when trackpad stops
        velocityAfterWheel = Math.max(currentVelocity, 900);

        // Cascade scroll execution: try primaryTarget first, pass remaining delta to navEl if primary hits bound
        const target = primaryTarget || navEl;
        if (target) {
          const oldTop = target.scrollTop;
          target.scrollTop = Math.max(
            0,
            Math.min(target.scrollHeight - target.clientHeight, oldTop + pixelDelta)
          );
          const consumed = target.scrollTop - oldTop;
          const remaining = pixelDelta - consumed;

          // Cascade unconsumed delta to outer container if inner list hit top/bottom bound
          if (Math.abs(remaining) > 0.5 && navEl && navEl !== target && navEl.scrollHeight > navEl.clientHeight) {
            navEl.scrollTop = Math.max(
              0,
              Math.min(navEl.scrollHeight - navEl.clientHeight, navEl.scrollTop + remaining)
            );
          }

          if (pixelDelta > 0 && target === chatEl) {
            tryLoadMore(chatEl);
          }
        }

        const key = hit(e.clientX, e.clientY);
        applyHoverKey(key);
      }
    };

    const onPointerUp = () => {
      // Delay clear so SpeedTest pointerup can still read last hover key
      window.setTimeout(() => {
        setOverKey(null);
      }, 0);
    };

    const clear = () => setOverKey(null);

    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('dragenter', onDragEnter, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('mousemove', onPointerMove as any, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('mouseup', onPointerUp, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('dragend', clear, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('dragenter', onDragEnter, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('mousemove', onPointerMove as any, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('mouseup', onPointerUp, true);
      document.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('dragend', clear, true);
    };
  }, [
    anyDragLive,
    dragLive,
    folderDragLive,
    mediaDragActive,
    sourceFolder,
    onLoadMoreChats,
    openChatsSection,
    openFoldersSection,
    folders,
  ]);

  const registerLabel = (key: string, label: string) => {
    labelMap.current.set(key, label);
  };

  const go = (fn: () => void) => {
    fn();
    onCloseDrawer?.();
  };

  const locationSearchRef = useRef<HTMLInputElement | null>(null);

  // Google Drive–style: Ctrl/Cmd+K focuses universal location search
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        // Allow re-focus only when not already typing in another field that isn't location search
        if (t !== locationSearchRef.current && t.closest('.td-location-search') == null) return;
      }
      e.preventDefault();
      locationSearchRef.current?.focus();
      locationSearchRef.current?.select();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [collapsed]);

  // Collapse sidebar is strictly disabled below 900x600 (drawer mode stays clean & expanded)
  const isCollapseAllowed = typeof window !== 'undefined'
    ? window.innerWidth >= 900 && window.innerHeight >= 600
    : true;
  const effectiveCollapsed = isCollapseAllowed ? collapsed : false;

  return (
    <aside
      ref={sidebarRef as React.RefObject<HTMLElement>}
      className={`td-sidebar ${effectiveCollapsed ? 'is-collapsed' : ''} ${drawerOpen ? 'is-drawer-open' : ''} ${anyDragLive ? 'media-dnd' : ''}`}
      aria-label={t('ui.generated.drive_locations_e6fade5')}
      data-collapsed={effectiveCollapsed ? 'true' : 'false'}
    >
      {/* Expand/collapse first (top) — users expect this control at the top of the rail */}
      <div className="td-rail-head">
        {onExitToApp && (
          <button
            type="button"
            className="td-rail-btn td-rail-back td-rail-back-compact"
            onClick={() => {
              onExitToApp();
              onCloseDrawer?.();
            }}
            title={t("speedtest.sidebar_back_to_app")}
            aria-label={t("speedtest.sidebar_back_to_app")}
          >
            <ArrowLeft size={18} />
          </button>
        )}

        <button
          type="button"
          className="td-rail-brand td-rail-brand-toggle"
          onClick={() => {
            if (!isCollapseAllowed) {
              onCloseDrawer?.();
            } else {
              onToggleCollapse?.();
            }
          }}
          title={
            isCollapseAllowed
              ? (effectiveCollapsed ? t('speedtest.sidebar_expand_tooltip') : t('speedtest.sidebar_collapse_tooltip'))
              : t('speedtest.sidebar_close_tooltip')
          }
          aria-expanded={isCollapseAllowed ? !effectiveCollapsed : undefined}
          aria-label={
            isCollapseAllowed
              ? (effectiveCollapsed ? t('speedtest.sidebar_expand_tooltip') : t('speedtest.sidebar_collapse_tooltip'))
              : t('speedtest.sidebar_close_tooltip')
          }
        >
          <div className="td-sidebar-logo">
            <HardDrive size={20} />
            {effectiveCollapsed && (
              <span
                className={`td-sidebar-logo-dot td-rail-conn-dot ${pingState?.status || (connected ? 'excellent' : 'disconnected')} pulse`}
                title={getPingTooltip()}
              />
            )}
          </div>
          <div className="td-sidebar-brand-text">
            <strong>{t('speedtest.header_drive_title')}</strong>
            <span>{t('speedtest.header_drive_subtitle')}</span>
          </div>
        </button>

        {onExitToApp && (
          <button
            type="button"
            className="td-rail-btn td-rail-back td-rail-back-wide"
            onClick={() => {
              onExitToApp();
              onCloseDrawer?.();
            }}
            title={t("speedtest.sidebar_back_to_app")}
          >
            <ArrowLeft size={18} />
            <span className="td-rail-btn-label">
              <Rocket size={14} />
              {t('nav.title')}
            </span>
          </button>
        )}
      </div>

      <div className="td-sidebar-session td-only-expanded">
        <div className="td-session-header-row">
          <div className="td-session-header-left">
            <label className="td-label">{t("speedtest.session_header")}</label>
            <button
              type="button"
              className={`td-session-refresh-btn${busy || manualSpin ? ' is-refreshing' : ''}`}
              title={t("speedtest.sidebar_refresh_all")}
              aria-label={t("speedtest.sidebar_refresh_tooltip")}
              onClick={handleRefreshClick}
              disabled={busy}
            >
              <RefreshCw size={12} className={busy || manualSpin ? 'spin' : ''} aria-hidden />
            </button>
          </div>
          <div className={`td-conn-indicator status-${pingState?.status || (connected ? 'excellent' : 'disconnected')}`}>
            <span className={`td-conn-dot ${pingState?.status || (connected ? 'excellent' : 'disconnected')} pulse`} />
            <span className="td-conn-text" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span>
                {pingState?.status === 'offline' && 'Internet Terputus (Device Offline)'}
                {pingState?.status === 'disconnected' && 'Terputus'}
                {pingState?.status === 'transferring' && 'Sedang mentransfer...'}
                {pingState?.status === 'excellent' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('speedtest.ping_excellent')}`}
                {pingState?.status === 'good' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('speedtest.ping_good')}`}
                {pingState?.status === 'fair' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('speedtest.ping_fair')}`}
                {pingState?.status === 'poor' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('speedtest.ping_poor')}`}
                {!pingState && (connected ? t('speedtest.ping_drive_connected') : t('speedtest.ping_not_connected'))}
              </span>
              {(!connected || pingState?.status === 'disconnected') && onOpenRelogModal && (
                <button
                  type="button"
                  className="td-chip-btn"
                  onClick={onOpenRelogModal}
                  style={{
                    background: 'var(--primary, #3b82f6)',
                    color: '#fff',
                    border: 'none',
                    fontSize: '0.68rem',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    marginLeft: '4px',
                  }}
                >
                  {t('accounts.btn_relog')}
                </button>
              )}
            </span>
          </div>
        </div>
        <MediaSelect
          value={session}
          onChange={onSessionChange}
          ariaLabel="Telegram session"
          compact
          options={sessions.length
            ? sessions.map((name) => ({ value: name, label: getSessionDisplayName(name) }))
            : [{ value: '', label: 'Belum ada session', disabled: true }]}
        />
      </div>

      <div className="td-rail-actions td-rail-toolbar" role="toolbar" aria-label={t('ui.generated.aksi_drive_47b8b0c')}>
        {isCompactSearchActive || Boolean(locationQuery && locationQuery.trim().length > 0) ? (
          <div className="td-location-search td-location-search-inline">
            <Search size={14} aria-hidden className="td-location-search-ico" />
            <input
              ref={locationSearchRef}
              type="text"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              value={locationQuery}
              onChange={(e) => onChatQuery(e.target.value)}
              placeholder={t("speedtest.sidebar_search_location_ph")}
              aria-label={t("speedtest.sidebar_search_aria")}
              title={t("speedtest.sidebar_search_title")}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (!locationQuery) {
                    setIsCompactSearchActive(false);
                  } else {
                    onChatQuery('');
                  }
                }
              }}
              onBlur={() => {
                if (!locationQuery) {
                  setIsCompactSearchActive(false);
                }
              }}
              onDragOver={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="td-location-search-clear"
              title={t('speedtest.clear_search')}
              aria-label={t("speedtest.sidebar_clear_search")}
              onClick={() => {
                onChatQuery('');
                setIsCompactSearchActive(false);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="td-sidebar-action-split-row">
            <button
              type="button"
              className="td-rail-btn td-rail-tool td-btn-new-folder is-full-width"
              title={
                createIsSubfolder
                  ? `Buat folder di dalam “${activeDriveFolder?.name || 'lokasi ini'}” (folder dalam Drive/Folder)`
                  : 'Buat Drive baru (channel privat [TD] di root). Buka Drive/Folder dulu untuk membuat folder di dalamnya.'
              }
              aria-label={createIsSubfolder ? 'Buat folder di dalam Drive/Folder' : 'Buat Drive baru'}
              onClick={() =>
                onCreate(
                  createIsSubfolder && activePeerId != null
                    ? { parentId: activePeerId }
                    : { parentId: null }
                )
              }
              onContextMenu={(e) => {
                // Right-click toolbar button → always offer nested create via parent pick path
                e.preventDefault();
                if (createIsSubfolder && activePeerId != null) {
                  onCreate({ parentId: activePeerId });
                } else {
                  onCreate({ parentId: null });
                }
              }}
            >
              <FolderPlus size={16} aria-hidden className="td-btn-add-icon" />
              <span className="td-rail-btn-label">
                {createIsSubfolder ? t('speedtest.btn_create_folder') : t('speedtest.btn_create_drive')}
              </span>
            </button>

            <button
              type="button"
              className="td-rail-btn td-sidebar-search-btn"
              onClick={() => {
                setIsCompactSearchActive(true);
                setTimeout(() => {
                  locationSearchRef.current?.focus();
                  locationSearchRef.current?.select();
                }, 30);
              }}
              title={t("speedtest.sidebar_search_title")}
              aria-label={t("speedtest.sidebar_search_aria")}
            >
              <Search size={16} />
            </button>
          </div>
        )}
      </div>

      {(channelLimitWarning ||
        folders.length >= DRIVE_FOLDER_SOFT_LIMIT) && (
        <p className="td-channel-limit-banner td-only-expanded" role="status">
          {channelLimitWarning ||
            `Sudah ${folders.length} Drive/Folder [TD] — mendekati batas channel Telegram (~500). Prefer pindah hierarki daripada buat baru.`}
        </p>
      )}

      {/* DnD hint only in status bar (SpeedTest) — avoid dark slab in sidebar */}
      {folderDragLive && !dragLive && (
        <p className="td-dnd-hint td-only-expanded">
          {t('ui.generated.lepas_di_4ee781a')} <strong>{t('ui.generated.drive_atau_folder_lain_df18d2b')}</strong> {t('ui.generated.untuk_memindahkan_esc_batal_ff0f8f2')}
        </p>
      )}

      {/* ── Fixed Controls Block (Search Bar + 3 Smart Tabs Bar) ── */}
      <div className="td-sidebar-fixed-controls">
          {/* Expanded mode: Search Bar */}
          {!anyDragLive && !collapsed && (
            <div className="td-location-search td-location-search-main">
              <Search size={14} aria-hidden className="td-location-search-ico" />
              <input
                ref={locationSearchRef}
                type="text"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
                value={locationQuery}
                onChange={(e) => onChatQuery(e.target.value)}
                placeholder={t("speedtest.sidebar_search_location_ph")}
                aria-label={t("speedtest.sidebar_search_aria")}
                title={t("speedtest.sidebar_search_title")}
                onDragOver={(e) => e.stopPropagation()}
              />
              {hasLocationQuery && (
                <button
                  type="button"
                  className="td-location-search-clear"
                  title={t('speedtest.clear_search')}
                  aria-label={t("speedtest.sidebar_clear_search")}
                  onClick={() => onChatQuery('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Expanded mode: Horizontal 3 Smart Tabs Bar */}
          {!collapsed && (layoutModel === 'model_a' || layoutModel === 'model_b') && (
            <div className="td-sidebar-tab-bar" role="tablist">
              {/* Tab 1: Recent Locations */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'recent'}
                data-drop-key="tab:recent"
                className={`td-sidebar-tab-btn${activeTab === 'recent' ? ' is-active' : ''}${overKey === 'tab:recent' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('recent')}
                title={t('speedtest.sidebar_recents_header')}
              >
                <Clock size={13} aria-hidden />
                <span className="td-sidebar-tab-label">{t('speedtest.sidebar_tab_recent')}</span>
                {filteredRecents.length > 0 && (
                  <span className="td-tab-badge">{filteredRecents.length}</span>
                )}
              </button>

              {/* Tab 2: Drives */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'drives'}
                data-drop-key="tab:drives"
                className={`td-sidebar-tab-btn${activeTab === 'drives' ? ' is-active' : ''}${overKey === 'tab:drives' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('drives')}
                title={t('ui.generated.drives_td_d85c6ed')}
              >
                <HardDrive size={13} aria-hidden />
                <span className="td-sidebar-tab-label">{t('speedtest.sidebar_tab_drives')}</span>
                {folders.length > 0 && (
                  <span className="td-tab-badge">{folders.length}</span>
                )}
              </button>

              {/* Tab 3: Telegram Chats & Groups */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'chats'}
                data-drop-key="tab:chats"
                className={`td-sidebar-tab-btn${activeTab === 'chats' ? ' is-active' : ''}${overKey === 'tab:chats' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('chats')}
                title={t('ui.generated.daftar_chat_71a8e93')}
              >
                <MessageSquare size={13} aria-hidden />
                <span className="td-sidebar-tab-label">{t('speedtest.sidebar_tab_telegram')}</span>
                {chats.length > 0 && (
                  <span className="td-tab-badge">{chatRows.length}</span>
                )}
              </button>
            </div>
          )}

          {/* Collapsed mode: Vertical 3 Mini Tab Icon Strip */}
          {collapsed && (layoutModel === 'model_a' || layoutModel === 'model_b') && (
            <div className="td-sidebar-collapsed-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'recent'}
                data-drop-key="tab:recent"
                className={`td-collapsed-tab-icon${activeTab === 'recent' ? ' is-active' : ''}${overKey === 'tab:recent' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('recent')}
                title={`${t('speedtest.sidebar_tab_recent')} (${filteredRecents.length})`}
              >
                <Clock size={15} aria-hidden />
                {filteredRecents.length > 0 && (
                  <span className="td-collapsed-badge">{filteredRecents.length}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'drives'}
                data-drop-key="tab:drives"
                className={`td-collapsed-tab-icon${activeTab === 'drives' ? ' is-active' : ''}${overKey === 'tab:drives' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('drives')}
                title={`${t('speedtest.sidebar_tab_drives')} (${folders.length})`}
              >
                <HardDrive size={15} aria-hidden />
                {folders.length > 0 && (
                  <span className="td-collapsed-badge">{folders.length}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'chats'}
                data-drop-key="tab:chats"
                className={`td-collapsed-tab-icon${activeTab === 'chats' ? ' is-active' : ''}${overKey === 'tab:chats' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('chats')}
                title={`${t('speedtest.sidebar_tab_telegram')} (${chatRows.length})`}
              >
                <MessageSquare size={15} aria-hidden />
                {chats.length > 0 && (
                  <span className="td-collapsed-badge">{chatRows.length}</span>
                )}
              </button>
            </div>
          )}
      </div>

      <nav
        ref={navRef as React.RefObject<HTMLElement>}
        className={`td-folder-nav ${anyDragLive ? 'is-drop-mode is-dnd-layout' : ''} ${
          hasLocationQuery ? 'is-search-mode' : ''
        } ${!chatsExpanded ? 'chats-collapsed' : ''} ${!foldersExpanded ? 'folders-collapsed' : ''} td-nav-model-${layoutModel}`}
        data-layout-model={layoutModel}
        data-active-tab={activeTab}
        data-has-query={hasLocationQuery ? 'true' : 'false'}
        onWheel={(e) => {
          if (collapsed && navRef.current) {
            e.preventDefault();
            navRef.current.scrollTop += e.deltaY;
          }
        }}
        onDragOver={(e) => {
          if (
            dragLive ||
            folderDragLive ||
            acceptDrop(e) ||
            isInternalMediaDragActive() ||
            isFolderReparentDragActive()
          ) {
            e.preventDefault();
            applyDropEffect(
              e.dataTransfer,
              isFolderReparentDragActive() || folderDragLive ? 'move' : 'move'
            );
          }
        }}
      >
        {hasLocationQuery && !dragLive && (
          <p className="td-location-search-meta td-only-expanded">
            {[
              showSaved ? 1 : 0,
              folderRows.length,
              chatRows.length,
            ].reduce((a, b) => a + b, 0)}{' '}
            {t('ui.generated.lokasi_9c8096b')}
            {chatsHasMore && chatRows.length === 0
              ? t('ui.generated.muat_chat_lain_jika_belum_muncul_38ef29f')
              : ''}
          </p>
        )}
        {/* ── Saved Messages & Pins Quick Bar (Shown in both Expanded and Collapsed Rail) ── */}
        {(layoutModel === 'model_a' || layoutModel === 'model_b') && !anyDragLive && !hasLocationQuery && (
          <div className="td-sidebar-quick-bar">
            {(() => {
              const key = dropKey('saved', null);
              registerLabel(key, 'Saved Messages');
              return (
                <DropRow
                  dropKeyStr={key}
                  className={`td-quick-item ${locationKind === 'saved' ? 'active' : ''}`}
                  title={t('speedtest.sidebar_saved_messages_tooltip')}
                  isOver={overKey === key}
                  invalidTarget={isSelf(key)}
                  dragLive={dragLive}
                  acceptDrop={acceptDrop}
                  onHover={handleHover}
                  onDropTarget={handleDropKey}
                  onActivate={() => go(onSelectSaved)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onLocationContextMenu?.({
                      locationKind: 'saved',
                      id: null,
                      name: t('speedtest.saved_messages') || 'Saved Messages',
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <span className="td-folder-ico">
                    <PeerAvatar peerId={0} creds={creds} title={t('speedtest.saved_messages')} fallback={<Home size={15} />} />
                  </span>
                  <span className="td-folder-label td-only-expanded">{t('speedtest.saved_messages')}</span>
                </DropRow>
              );
            })()}
            {pins.slice(0, 3).map((r: any) => {
              const key = r.kind === 'saved' ? dropKey('saved', null) : dropKey(r.kind, r.id as number);
              registerLabel(key, r.label);
              const active =
                (r.kind === 'saved' && locationKind === 'saved') ||
                (r.kind !== 'saved' && locationKind === r.kind && activePeerId === r.id);
              return (
                <DropRow
                  key={`qb:${r.kind}:${r.id ?? 'me'}`}
                  dropKeyStr={key}
                  className={`td-quick-item td-pin-item ${active ? 'active' : ''}`}
                  title={r.label}
                  isOver={overKey === key}
                  invalidTarget={isSelf(key)}
                  dragLive={dragLive}
                  acceptDrop={acceptDrop}
                  onHover={handleHover}
                  onDropTarget={handleDropKey}
                  onActivate={() => go(() => onSelectPin?.(r))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onLocationContextMenu?.({
                      locationKind: r.kind === 'saved' ? 'saved' : r.kind === 'drive' ? 'drive' : 'chat',
                      id: r.kind === 'saved' ? null : (r.id as number),
                      name: r.label,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <span className="td-folder-ico" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {r.kind === 'chat' && r.id != null ? (
                      <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<MessageSquare size={15} />} />
                    ) : r.kind === 'drive' && r.id != null ? (
                      <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<Folder size={15} />} />
                    ) : (
                      <Home size={15} />
                    )}
                    <span className="td-pin-badge-dot" title={r.label}>
                      <Pin size={8} className="td-pin-svg-icon" />
                    </span>
                  </span>
                  <span className="td-folder-label td-only-expanded">{recentDisplayLabel(r.label, 18)}</span>
                </DropRow>
              );
            })}
          </div>
        )}
        {/* Shortcuts moved to input title tooltips — strip was visual noise */}
        <div className="td-shortcuts-hint td-only-expanded" style={{ display: 'none' }}>
          {t('ui.generated.ctrl_k_lokasi_ctrl_f_file_ctrl_a_pilih_esc_398cbc6')}
        </div>

        {showSaved && layoutModel !== 'model_a' &&
          (() => {
            const key = dropKey('saved', null);
            registerLabel(key, 'Saved Messages');
            return (
              <DropRow
                dropKeyStr={key}
                className={`td-folder-row ${locationKind === 'saved' ? 'active' : ''}`}
                title={t("speedtest.sidebar_saved_messages_tooltip")}
                isOver={overKey === key}
                invalidTarget={isSelf(key)}
                dragLive={dragLive}
                acceptDrop={acceptDrop}
                onHover={handleHover}
                onDropTarget={handleDropKey}
                onActivate={() => go(onSelectSaved)}
                onContextMenu={(e) =>
                  onLocationContextMenu?.({
                    locationKind: 'saved',
                    id: null,
                    name: 'Saved Messages',
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
              >
                <span className="td-folder-ico">
                  <PeerAvatar
                    peerId={0}
                    creds={creds}
                    title={t('speedtest.saved_messages')}
                    fallback={<Home size={16} />}
                  />
                </span>
                <span className="td-folder-label">{t("speedtest.saved_messages")}</span>
              </DropRow>
            );
          })()}

        {/* Pinned favorites */}
        {!hasLocationQuery && pins.length > 0 && (layoutModel === 'model_c' || (layoutModel === 'model_b' && activeTab === 'pins')) && (
          <div className="td-recents td-pins td-only-expanded" data-pins="1">
            <div className="td-recents-label">
              <Pin size={12} aria-hidden />
              {t('ui.generated.disematkan_57b7b13')}
            </div>
            <div className="td-recents-list">
              {pins.slice(0, 8).map((r: any) => {
                const key =
                  r.kind === 'saved' ? dropKey('saved', null) : dropKey(r.kind, r.id as number);
                registerLabel(key, r.label);
                const active =
                  (r.kind === 'saved' && locationKind === 'saved') ||
                  (r.kind !== 'saved' &&
                    locationKind === r.kind &&
                    activePeerId === r.id);
                const short = recentDisplayLabel(r.label, 18);
                return (
                  <DropRow
                    key={`pin:${r.kind}:${r.id ?? 'me'}`}
                    dropKeyStr={key}
                    className={`td-recent-chip td-pin-chip ${active ? 'active' : ''}`}
                    title={
                      dragLive
                        ? `Lepas untuk kirim ke ${r.label}`
                        : r.label
                    }
                    isOver={overKey === key}
                    invalidTarget={isSelf(key)}
                    dragLive={dragLive}
                    acceptDrop={acceptDrop}
                    onHover={handleHover}
                    onDropTarget={handleDropKey}
                    onActivate={() => go(() => onSelectPin?.(r))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onLocationContextMenu?.({
                        locationKind: r.kind === 'saved' ? 'saved' : r.kind === 'drive' ? 'drive' : 'chat',
                        id: r.kind === 'saved' ? null : (r.id as number),
                        name: r.label,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    <span className="td-folder-label">{short}</span>
                  </DropRow>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent locations — flat clean section without heavy dropdown container */}
        {!hasLocationQuery && filteredRecents.length > 0 && (
          <div className="td-recents" data-recent="1">
            <div className="td-recents-header td-only-expanded">
              <Clock size={12} className="td-recents-icon" aria-hidden />
              <span className="td-recents-title">{t("speedtest.sidebar_recents_header")}</span>
              <span className="td-recents-count">{filteredRecents.length}</span>
            </div>
            <div className="td-recents-list">
              {filteredRecents.slice(0, 6).map((r: any) => {
                const key =
                  r.kind === 'saved'
                    ? dropKey('saved', null)
                    : dropKey(r.kind, r.id as number);
                registerLabel(key, r.label);
                const active =
                  (r.kind === 'saved' && locationKind === 'saved') ||
                  (r.kind !== 'saved' &&
                    locationKind === r.kind &&
                    activePeerId === r.id);
                const kindBadge = (() => {
                  if (r.kind === 'drive') return 'Drive';
                  if (r.kind === 'saved') return 'Saved';
                  // kind === 'chat': resolve type from stored metadata first,
                  // then fall back to live chats list (covers old localStorage entries without chatType)
                  const liveMeta = r.id != null ? chats.find((c) => c.id === r.id) : null;
                  const resolvedIsForum = r.isForum ?? !!(liveMeta?.is_forum);
                  const resolvedType = r.chatType ?? liveMeta?.type;
                  if (resolvedIsForum) return 'Groups - Forum';
                  if (resolvedType === 'channel') return 'Channel';
                  if (resolvedType === 'group') return 'Group';
                  if (resolvedType === 'bot') return 'Bot';
                  if (resolvedType === 'user') return 'Private Chat';
                  return 'Chat';
                })();
                return (
                  <DropRow
                    key={`${r.kind}:${r.id ?? 'me'}`}
                    dropKeyStr={key}
                    className={`td-folder-row ${active ? 'active' : ''}`}
                    title={
                      dragLive
                        ? `Lepas untuk kirim ke ${r.label}`
                        : r.label
                    }
                    isOver={overKey === key}
                    invalidTarget={isSelf(key)}
                    dragLive={dragLive}
                    acceptDrop={acceptDrop}
                    onHover={handleHover}
                    onDropTarget={handleDropKey}
                    onActivate={() => go(() => onSelectRecent?.(r))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onLocationContextMenu?.({
                        locationKind: r.kind === 'saved' ? 'saved' : r.kind === 'drive' ? 'drive' : 'chat',
                        id: r.kind === 'saved' ? null : (r.id as number),
                        name: r.label,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    <span className="td-folder-ico">
                      {r.kind === 'saved' ? (
                        <PeerAvatar peerId={0} creds={creds} title={r.label} fallback={<Home size={16} />} />
                      ) : r.kind === 'drive' ? (
                        <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<Folder size={16} />} />
                      ) : (
                        <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<MessageSquare size={16} />} />
                      )}
                    </span>
                    <div className="td-folder-text-col" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: '1px', lineHeight: 1.25 }}>
                      <span className="td-folder-label">{r.label}</span>
                      <span className="td-folder-subtext" style={{ fontSize: '0.68rem', color: 'var(--td-sub, #94a3b8)', opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formatRelativeAccessTime(r.at, t)}
                      </span>
                    </div>
                    <span className="td-location-badge" style={(() => {
                      const base = {
                        fontSize: '0.62rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontWeight: 600,
                        marginLeft: '8px',
                        flexShrink: 0 as const,
                      };
                      if (kindBadge === 'Groups - Forum') return { ...base, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.45)', color: '#c4b5fd' };
                      if (kindBadge === 'Channel') return { ...base, background: 'rgba(6,182,212,0.13)', border: '1px solid rgba(6,182,212,0.4)', color: '#67e8f9' };
                      if (kindBadge === 'Group') return { ...base, background: 'rgba(34,197,94,0.13)', border: '1px solid rgba(34,197,94,0.4)', color: '#86efac' };
                      if (kindBadge === 'Bot') return { ...base, background: 'rgba(16,185,129,0.13)', border: '1px solid rgba(16,185,129,0.4)', color: '#6ee7b7' };
                      if (kindBadge === 'Private Chat') return { ...base, background: 'rgba(148,163,184,0.13)', border: '1px solid rgba(148,163,184,0.4)', color: '#cbd5e1' };
                      if (kindBadge === 'Drive') return { ...base, background: 'rgba(249,115,22,0.13)', border: '1px solid rgba(249,115,22,0.4)', color: '#fdba74' };
                      if (kindBadge === 'Saved') return { ...base, background: 'rgba(59,130,246,0.13)', border: '1px solid rgba(59,130,246,0.4)', color: '#93c5fd' };
                      return { ...base, border: '1px solid color-mix(in srgb, var(--td-primary, #3b82f6) 40%, var(--td-border))', color: 'color-mix(in srgb, var(--td-primary, #3b82f6) 85%, var(--td-fg))' };
                    })()}>
                      {kindBadge}
                    </span>
                  </DropRow>
                );
              })}
            </div>
          </div>
        )}

        {/* Drives [TD] — compact stack while dragging so CHATS list gets height */}
        <div ref={folderStackRef} className="td-dnd-folder-stack">
          {(layoutModel === 'model_c' || hasLocationQuery) && (
            <button
              type="button"
              className={`td-section-toggle td-only-expanded${dragLive ? ' is-dnd-target' : ''}`}
              aria-expanded={foldersExpanded}
              onClick={toggleFolders}
              onPointerEnter={() => {
                if (dragLive || isInternalMediaDragActive() || mediaDragActive) openFoldersSection();
              }}
              onDragEnter={(e) => {
                if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
                e.preventDefault();
                openFoldersSection();
              }}
              onDragOver={(e) => {
                if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
                e.preventDefault();
                openFoldersSection();
              }}
              title={
                foldersExpanded
                  ? 'Ciutkan Drives — lebih luas untuk chat'
                  : 'Perluas Drives'
              }
            >
              <ChevronDown
                size={14}
                className={`td-section-chevron ${foldersExpanded ? 'is-open' : ''}`}
                aria-hidden
              />
              <span className="td-section-toggle-label">{t('ui.generated.drives_td_d85c6ed')}</span>
              <span className="td-chat-count" title={t("speedtest.sidebar_td_count")}>
                {hasLocationQuery ? `${folderRows.length}/${folders.length}` : folders.length}
              </span>
            </button>
          )}
          {foldersExpanded && folders.length === 0 && !loadingFolders && !hasLocationQuery && (
            <p className="td-sidebar-hint td-only-expanded">
              <strong>{t('speedtest.perspective_drive_short')}</strong> {t('ui.generated.root_penanda_7790d14')} <code>{t('ui.generated.td_1294383')}</code>{t('ui.generated.buka_drive_lalu_d92c640')}{' '}
              <strong>{t('ui.generated.folder_0d9a3d4')}</strong>{t('ui.generated.folder_bisa_berisi_folder_lagi_chat_di_bawah_bba5941')}
            </p>
          )}
          {foldersExpanded && hasLocationQuery && folderRows.length === 0 && folders.length > 0 && (
            <p className="td-sidebar-hint td-only-expanded">{t('speedtest.sidebar_drives_empty')}</p>
          )}
          {foldersExpanded &&
            displayFolderTreeRows.map(({ folder: f, depth, hasChildren }) => {
              const key = dropKey('drive', f.id);
              registerLabel(key, f.name);
              const isOpen = treeExpanded.has(f.id);
              const itemKind = driveItemKind(f);
              const nestTitle =
                f.is_orphan
                  ? `${f.title_raw || f.name} · Drive yatim (parent hilang) · klik kanan menu`
                  : hasChildren
                    ? `${f.title_raw || f.name} · ${
                        itemKind === 'folder' ? 'Folder' : 'Drive'
                      } · dobel-klik / panah untuk buka·tutup subfolder`
                    : itemKind === 'folder'
                      ? `${f.title_raw || f.name} · Folder · seret ke Drive/folder lain / klik kanan`
                      : `${f.title_raw || f.name} · Drive · seret atau klik kanan (+ Folder di dalam)`;
              return (
                <DropRow
                  key={f.id}
                  dropKeyStr={key}
                  className={`td-folder-row ${
                    locationKind === 'drive' && activePeerId === f.id ? 'active' : ''
                  } ${depth > 0 ? 'is-nested' : ''}${f.is_orphan ? ' is-orphan' : ''}${
                    itemKind === 'drive' ? ' is-drive-root' : ' is-drive-folder'
                  }`}
                  title={nestTitle}
                  isOver={overKey === key}
                  invalidTarget={isSelf(key)}
                  dragLive={dragLive}
                  folderDragLive={folderDragLive}
                  folderDragSource={{ folderId: f.id, folderName: f.name }}
                  acceptDrop={acceptDrop}
                  onHover={handleHover}
                  onDropTarget={handleDropKey}
                  onActivate={() => go(() => onSelectDrive(f.id))}
                  onDoubleActivate={
                    hasChildren && !collapsed ? () => toggleTreeFolder(f.id) : undefined
                  }
                  style={collapsed ? undefined : { paddingLeft: (depth === 0 && !hasChildren) ? 4 : 4 + depth * 14 }}
                  onContextMenu={(e) =>
                    onLocationContextMenu?.({
                      locationKind: 'drive',
                      id: f.id,
                      name: f.name,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                >
                  {/* Tree chevron/spacer only when expanded — spacer shifted icons off-center in rail */}
                  {!collapsed &&
                    (hasChildren ? (
                      <button
                        type="button"
                        className="td-folder-tree-toggle"
                        aria-label={isOpen ? 'Ciutkan folder' : 'Perluas folder'}
                        aria-expanded={isOpen}
                        title={isOpen ? t('speedtest.sidebar_collapse_subfolder') : t('speedtest.sidebar_expand_subfolder')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleTreeFolder(f.id);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                        }}
                        draggable={false}
                      >
                        {isOpen ? (
                          <ChevronDown size={14} aria-hidden />
                        ) : (
                          <ChevronRight size={14} aria-hidden />
                        )}
                      </button>
                    ) : depth > 0 ? (
                      <span className="td-folder-tree-spacer" aria-hidden />
                    ) : null)}
                  <span className="td-folder-ico">
                    <PeerAvatar
                      peerId={f.id}
                      creds={creds}
                      title={f.name}
                      fallback={<Folder size={16} />}
                    />
                  </span>
                  <span className="td-folder-label">{f.name}</span>
                  {/* Badges only on roots / orphan when searching or in stacked model */}
                  {itemKind === 'drive' && !f.is_orphan && depth === 0 && (layoutModel === 'model_c' || hasLocationQuery) && (
                    <span className="td-badge-drive td-only-expanded" title={t("speedtest.sidebar_drive_root")}>
                      {t('speedtest.perspective_drive_short')}
                    </span>
                  )}
                  {f.is_orphan && (
                    <span className="td-folder-orphan-badge td-only-expanded" title={t("speedtest.sidebar_orphan_parent")}>
                      {t('ui.generated.yatim_fbb507d')}
                    </span>
                  )}
                </DropRow>
              );
            })}
        </div>
        {/* Keep active folder reachable when section collapsed (not searching) */}
        {!foldersExpanded &&
          !collapsed &&
          locationKind === 'drive' &&
          activePeerId != null &&
          (() => {
            const f = folders.find((x) => x.id === activePeerId);
            if (!f) return null;
            const key = dropKey('drive', f.id);
            registerLabel(key, f.name);
            return (
              <DropRow
                dropKeyStr={key}
                className="td-folder-row active td-section-pinned"
                title={`${f.name} (${t('speedtest.active_folder_click_header')})`}
                isOver={overKey === key}
                invalidTarget={isSelf(key)}
                dragLive={dragLive}
                acceptDrop={acceptDrop}
                onHover={handleHover}
                onDropTarget={handleDropKey}
                onActivate={() => go(() => onSelectDrive(f.id))}
              >
                <span className="td-folder-ico">
                  <PeerAvatar
                    peerId={f.id}
                    creds={creds}
                    title={f.name}
                    fallback={<Folder size={16} />}
                  />
                </span>
                <span className="td-folder-label">{f.name}</span>
              </DropRow>
            );
          })()}

        {/* Quiet line between Drives (above) and Chats (below) — no extra zone icons */}
        {/* td-chat-section wraps the divider + header + list so CSS tab-switching can target it */}
        <div className="td-chat-section">
        {(layoutModel === 'model_c' || hasLocationQuery) && (
          <div
            className="td-zone-divider"
            role="separator"
            aria-label={t("speedtest.sidebar_resizer_aria")}
          >
            <span className="td-zone-divider-line" aria-hidden />
          </div>
        )}

        {/* Chats section toggle — only in stacked model or universal search */}
        {(layoutModel === 'model_c' || hasLocationQuery) && (
          <button
            type="button"
            className={`td-section-toggle td-only-expanded${dragLive ? ' is-dnd-target' : ''}`}
            aria-expanded={chatsExpanded}
            onClick={toggleChats}
            onPointerEnter={() => {
              if (dragLive || isInternalMediaDragActive() || mediaDragActive) openChatsSection();
            }}
            onDragEnter={(e) => {
              if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
              e.preventDefault();
              openChatsSection();
            }}
            onDragOver={(e) => {
              if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
              e.preventDefault();
              openChatsSection();
            }}
            title={
              chatsExpanded
                ? 'Ciutkan daftar chat — lebih luas untuk folder'
                : dragLive
                  ? 'Arahkan ke sini untuk buka daftar chat (drop target)'
                  : 'Perluas daftar chat'
            }
          >
            <ChevronDown
              size={14}
              className={`td-section-chevron ${chatsExpanded ? 'is-open' : ''}`}
              aria-hidden
            />
            <span className="td-section-toggle-label">{t("speedtest.sidebar_chats_header")}</span>
            {chatIndex.length > 0 && (
              <span className="td-chat-count" title={t("speedtest.sidebar_chats_tooltip")}>
                {hasLocationQuery
                  ? `${chatRows.length}/${chatIndex.length}`
                  : chatIndex.length}
                {chatsHasMore ? '+' : ''}
              </span>
            )}
          </button>
        )}
        {chatsExpanded && chatFolders.length > 0 && (
          <div className="td-chat-folders-wrap td-only-expanded">
            <span className="td-chat-folders-label">{t("speedtest.sidebar_chat_folders_header")}</span>
            <div
              ref={chatFoldersScrollerRef}
              className={`td-chat-folders-row${chatFoldersScrolled ? ' is-scrolled' : ''}`}
              onScroll={(event) => setChatFoldersScrolled(event.currentTarget.scrollLeft > 14)}
              onWheel={(e) => {
                if (e.currentTarget) {
                  e.preventDefault();
                  e.stopPropagation();
                  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                  e.currentTarget.scrollLeft += delta;
                }
              }}
            >
              <button
                type="button"
                className={`td-chat-type-filter-compact td-chat-type-filter-pill${chatTypeFilter !== 'all' ? ' active' : ''}${chatFoldersScrolled ? ' is-visible' : ''}`}
                onClick={toggleTypeFilterMenu}
                title={activeChatTypeLabel}
                aria-label={`${t('speedtest.filter_by_type')}: ${activeChatTypeLabel}`}
                aria-expanded={typeFilterMenuOpen}
                tabIndex={chatFoldersScrolled ? 0 : -1}
              >
                <Filter size={13} className="td-filter-icon" />
              </button>
              {/* Chat Type Filter Trigger Button */}
              <div className="td-chat-type-filter-container" ref={typeFilterMenuRef}>
                <button
                  ref={typeFilterButtonRef}
                  type="button"
                  className={`td-chat-folder-chip td-chat-type-filter-pill ${chatTypeFilter !== 'all' ? 'active' : ''}`}
                  onClick={toggleTypeFilterMenu}
                  title={t('speedtest.filter_by_type')}
                  aria-label={t('speedtest.filter_by_type')}
                  aria-expanded={typeFilterMenuOpen}
                >
                  <Filter size={13} className="td-filter-icon" />
                  <span className="td-active-filter-badge">{activeChatTypeLabel}</span>
                  <ChevronDown size={11} className={`td-filter-arrow ${typeFilterMenuOpen ? 'is-open' : ''}`} />
                </button>

                {typeFilterMenuOpen && createPortal(
                  <div
                    className="td-chat-type-dropdown"
                    role="menu"
                    data-chat-type-dropdown
                    style={{ left: typeFilterMenuPosition.left, top: typeFilterMenuPosition.top }}
                  >
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'all' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('all'); setTypeFilterMenuOpen(false); }}
                    >
                      <Sparkles size={14} style={{ color: '#f59e0b' }} />
                      <span>{t('speedtest.filter_all_chats')}</span>
                      {chatTypeFilter === 'all' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'user' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('user'); setTypeFilterMenuOpen(false); }}
                    >
                      <User size={14} style={{ color: '#38bdf8' }} />
                      <span>{t('speedtest.filter_private')}</span>
                      {chatTypeFilter === 'user' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'group' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('group'); setTypeFilterMenuOpen(false); }}
                    >
                      <Users size={14} style={{ color: '#818cf8' }} />
                      <span>{t('speedtest.filter_groups')}</span>
                      {chatTypeFilter === 'group' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'channel' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('channel'); setTypeFilterMenuOpen(false); }}
                    >
                      <Radio size={14} style={{ color: '#34d399' }} />
                      <span>{t('speedtest.filter_channels')}</span>
                      {chatTypeFilter === 'channel' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'bot' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('bot'); setTypeFilterMenuOpen(false); }}
                    >
                      <Bot size={14} style={{ color: '#c084fc' }} />
                      <span>{t('speedtest.filter_bots')}</span>
                      {chatTypeFilter === 'bot' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'forum' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('forum'); setTypeFilterMenuOpen(false); }}
                    >
                      <MessagesSquare size={14} style={{ color: '#f472b6' }} />
                      <span>{t('speedtest.filter_forums')}</span>
                      {chatTypeFilter === 'forum' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                  </div>,
                  document.body
                )}
              </div>

              <div className="td-chat-folders" role="tablist" aria-label={t("speedtest.sidebar_chat_folders_aria")}>
              {chatFolders.map((folder) => {
                const active = folder.id === activeChatFolderId;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    data-drop-key={chatFolderDropKey(folder.id)}
                    data-chat-folder-id={folder.id}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    className={`td-chat-folder-chip${active ? ' active' : ''}${overKey === chatFolderDropKey(folder.id) ? ' is-drag-hover is-drop-over' : ''}`}
                    style={{ '--td-chat-folder-color': telegramFolderColor(folder.color) } as React.CSSProperties}
                    title={`${folder.id === 0 ? t("speedtest.all_chats") : folder.title}${folder.kind === 'shared' ? ` · ${t("speedtest.shared_telegram_folder")}` : ''}`}
                    onClick={() => onSelectChatFolder?.(folder.id)}
                    onPointerEnter={() => {
                      if (!anyDragLive) return;
                      const key = chatFolderDropKey(folder.id);
                      handleHover(key);
                      scheduleChatFolderSwitch(folder.id);
                    }}
                    onPointerMove={() => {
                      if (!anyDragLive) return;
                      const key = chatFolderDropKey(folder.id);
                      handleHover(key);
                      scheduleChatFolderSwitch(folder.id);
                    }}
                    onPointerLeave={() => {
                      if (!anyDragLive) return;
                      cancelChatFolderSwitch();
                      handleHover(null);
                    }}
                    onDragEnter={(event) => {
                      if (!anyDragLive) return;
                      event.preventDefault();
                      applyDropEffect(event.dataTransfer, 'move');
                      const key = chatFolderDropKey(folder.id);
                      handleHover(key);
                      scheduleChatFolderSwitch(folder.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      const tabs = Array.from(
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []
                      );
                      const index = tabs.indexOf(event.currentTarget);
                      const next = event.key === 'ArrowRight'
                        ? (index + 1) % tabs.length
                        : (index - 1 + tabs.length) % tabs.length;
                      tabs[next]?.focus();
                      tabs[next]?.click();
                    }}
                  >
                    {folder.emoticon && <span aria-hidden>{folder.emoticon}</span>}
                    <span>{folder.id === 0 ? t("speedtest.all_chats") : folder.title}</span>
                  </button>
                );
              })}
              </div>
            </div>
          </div>
        )}
        {chatsExpanded && chatRows.length === 0 && !loadingChats && (
          <p className="td-sidebar-hint td-only-expanded">
            {hasLocationQuery
              ? chatsHasMore
                ? t('ui.generated.belum_ketemu_di_chat_yang_sudah_termuat_scroll_m_ba5501e')
                : t('ui.generated.tidak_ada_chat_yang_cocok_bed4d35')
              : t('ui.generated.tidak_ada_chat_refresh_atau_cek_session_fb2e1de')}
          </p>
        )}
        {chatsExpanded && chatRows.length === 0 && loadingChats && (
          <div className="td-only-expanded" style={{ padding: '4px 0' }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="td-sidebar-skeleton-row">
                <div className="td-sidebar-skeleton-avatar" />
                <div className="td-sidebar-skeleton-text">
                  <div className="td-sidebar-skeleton-line-primary" />
                  <div className="td-sidebar-skeleton-line-secondary" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Virtualized chat list — also shown on collapsed rail (avatar icons, hidden scrollbar). */}
        {chatsExpanded && (
          <div
            ref={chatListRef}
            className={`td-chat-virtual ${collapsed ? 'is-rail' : ''}`}
            role="list"
            aria-label={t('ui.generated.daftar_chat_71a8e93')}
          >
            {collapsed ? (
              <div className="td-chat-collapsed-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0', alignItems: 'center' }}>
                {filteredByTypeChats.map((c) => {
                  const key = dropKey('chat', c.id);
                  registerLabel(key, c.name);
                  const active = locationKind === 'chat' && activePeerId === c.id;
                  return (
                    <DropRow
                      key={c.id}
                      dropKeyStr={key}
                      className={`td-folder-row ${active ? 'active' : ''}`}
                      title={`${c.name} (${c.type})`}
                      isOver={overKey === key}
                      invalidTarget={isSelf(key)}
                      dragLive={dragLive}
                      acceptDrop={acceptDrop}
                      onHover={handleHover}
                      onDropTarget={handleDropKey}
                      onActivate={() => go(() => onSelectChat(c.id))}
                      onContextMenu={(e) =>
                        onLocationContextMenu?.({
                          locationKind: 'chat',
                          id: c.id,
                          name: c.name,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }
                    >
                      <span className="td-folder-ico">
                        <PeerAvatar peerId={c.id} creds={creds} title={c.name} fallback={<MessageSquare size={16} />} />
                      </span>
                      <span className="td-folder-label">{c.name}</span>
                      {c.is_forum && (
                        <span
                          className="td-badge-forum td-only-expanded"
                          title={t('speedtest.group_with_topics')}
                        >
                          {t('speedtest.label_topic')}
                        </span>
                      )}
                    </DropRow>
                  );
                })}
              </div>
            ) : (
              <div
                className="td-chat-virtual-inner"
                style={{ height: chatVirtualizer.getTotalSize(), position: 'relative' }}
              >
                {virtualItems.map((vRow) => {
                  const c = filteredByTypeChats[vRow.index];
                  if (!c) return null;
                  const key = dropKey('chat', c.id);
                  registerLabel(key, c.name);
                  return (
                    <div
                      key={c.id}
                      className="td-chat-virtual-row"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: vRow.size,
                        transform: `translateY(${vRow.start}px)`,
                      }}
                    >
                      <DropRow
                        dropKeyStr={key}
                        className={`td-folder-row ${
                          locationKind === 'chat' && activePeerId === c.id ? 'active' : ''
                        }`}
                        title={
                          isSelf(key)
                            ? `${c.name} — ${t('speedtest.source_location_choose_other')}`
                            : `${c.name} (${c.type}) — ${t('speedtest.right_click_menu')}${
                                c.is_forum ? ` · ${t('speedtest.label_topic')}` : ''
                              }`
                        }
                        isOver={overKey === key}
                        invalidTarget={isSelf(key)}
                        dragLive={dragLive}
                        acceptDrop={acceptDrop}
                        onHover={handleHover}
                        onDropTarget={handleDropKey}
                        onActivate={() => go(() => onSelectChat(c.id))}
                        onContextMenu={(e) =>
                          onLocationContextMenu?.({
                            locationKind: 'chat',
                            id: c.id,
                            name: c.name,
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                      >
                        <span className="td-folder-ico">
                          <PeerAvatar peerId={c.id} creds={creds} title={c.name} fallback={<MessageSquare size={16} />} />
                        </span>
                        <div className="td-folder-text-col" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: '1px', lineHeight: 1.25 }}>
                          <span className="td-folder-label">{c.name}</span>
                        </div>
                      </DropRow>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* Active chat pin when section collapsed */}
        {!chatsExpanded &&
          !collapsed &&
          locationKind === 'chat' &&
          activePeerId != null &&
          (() => {
            const c = chats.find((x) => x.id === activePeerId);
            if (!c) return null;
            const key = dropKey('chat', c.id);
            registerLabel(key, c.name);
            return (
              <DropRow
                dropKeyStr={key}
                className="td-folder-row active td-section-pinned"
                title={`${c.name} (${t('speedtest.active_chat_click_header')})`}
                isOver={overKey === key}
                invalidTarget={isSelf(key)}
                dragLive={dragLive}
                acceptDrop={acceptDrop}
                onHover={handleHover}
                onDropTarget={handleDropKey}
                onActivate={() => go(() => onSelectChat(c.id))}
              >
                <span className="td-folder-ico">
                  <PeerAvatar
                    peerId={c.id}
                    creds={creds}
                    title={c.name}
                    fallback={<ChatIcon type={c.type} />}
                  />
                </span>
                <span className="td-folder-label">{c.name}</span>
              </DropRow>
            );
          })()}
        {chatsExpanded && chatsHasMore && !collapsed && (
          <button
            type="button"
            className="td-folder-row td-load-more-chats"
            onClick={() => onLoadMoreChats?.()}
            disabled={chatsLoadingMore}
          >
            <span className="td-folder-label">
              {chatsLoadingMore
                ? `Memuat chat… (${chatIndex.length}+)`
                : `Muat chat lainnya… (${chatIndex.length} termuat)`}
            </span>
          </button>
        )}
        </div>{/* /td-chat-section */}
      </nav>

      <div className="td-sidebar-foot td-only-expanded p-3 border-t border-gray-100 dark:border-gray-800">
        {creds && isDriveSessionCircuitTripped(creds) ? (
          <div className="flex flex-col gap-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-lg">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium break-words leading-relaxed">
              {getDriveSessionError(creds) || t('ui.generated.drive_gagal_terhubung_8e7dd9a')}
            </p>
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-md transition-colors shadow-sm cursor-pointer"
              onClick={() => {
                resetDriveSessionCircuit(creds);
              }}
            >
              <RefreshCw className="w-3 h-3 animate-pulse" />
              {t('speedtest.btn_retry')}
            </button>
          </div>
        ) : (
          statusText && <p className="td-status-foot">{statusText}</p>
        )}
      </div>
    </aside>
  );
}
