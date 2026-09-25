import { useTranslation } from 'react-i18next';
import {
  Users,
  Hash,
  Bot,
  MessageSquare,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { parseTelegramPathId, describePath, type ParsedTelegramPath } from '../../../lib/telegram/interaction/pathSearchParser';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  getSessionMetadata,
  applyDropEffect,
  beginFolderDrag,
  shouldBlockDriveDrop,
  endDriveDrag,
  endFolderDrag,
  getActiveFolderDrag,
  getDragSourceFolderId,
  hasOsFiles,
  isDropKeySameAsSource,
  isFolderReparentDragActive,
  isInternalMediaDragActive,
  isPointerDriveDragActive,
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
import { SidebarView } from './SidebarView';
import { useSidebarDrop, type SidebarTab } from './useSidebarDrop';
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
  if (!timestamp) return t('drive.time_recently');
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) {
    return t('drive.time_just_now');
  }
  if (diffMin < 60) {
    return t('drive.time_minutes_ago', { count: diffMin });
  }
  if (diffHours < 24) {
    return t('drive.time_hours_ago', { count: diffHours });
  }
  if (diffDays === 1) {
    return t('drive.time_yesterday');
  }
  return t('drive.time_days_ago', { count: diffDays });
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
  /**
   * Called when the user executes a Quick Jump via Path ID.
   * The parent is responsible for navigation + toast feedback.
   */
  onNavigatePath?: (path: ParsedTelegramPath) => void;
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
  const cached = getCachedAvatar(peerId, creds?.session);
  const [url, setUrl] = useState<string | null>(() =>
    cached === undefined ? null : cached
  );
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBroken(false);
    const hit = getCachedAvatar(peerId, creds?.session);
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
  isSpringHovering?: boolean;
};

function DropRow({
  dropKeyStr,
  className,
  title,
  isOver,
  isSpringHovering,
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
      }${isSpringHovering && !invalidTarget ? ' is-spring-hovering' : ''}${anyDrag ? ' dnd-ready' : ''}${invalidTarget && anyDrag ? ' dnd-self' : ''}${
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
            'position:fixed;top:-999px;left:-999px;padding:6px 10px;border-radius:8px;background:var(--bg-card, #1e293b);color:#f1f5f9;font:600 12px system-ui;border:1px solid var(--accent-primary, #3b82f6);';
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
        // Pointer internal drag: Cloud Drives pointerup owns completion
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
  onNavigatePath,
}: Props) {
  const { t } = useTranslation();
  const [isCompactSearchActive, setIsCompactSearchActive] = useState<boolean>(false);

  const getPingTooltip = () => {
    if (pingState?.status === 'transferring') return t('drive.ping_transferring');
    if (!pingState) return connected ? t('drive.ping_drive_connected') : t('drive.ping_connected');
    if (pingState.status === 'offline') return t('drive.ping_offline');
    if (pingState.status === 'disconnected') return t('drive.ping_disconnected');
    
    const msLabel = pingState.ms != null ? `${pingState.ms} ms` : '';
    let label = 'Koneksi';
    if (pingState.status === 'excellent') label = t('drive.ping_excellent');
    if (pingState.status === 'good') label = t('drive.ping_good');
    if (pingState.status === 'fair') label = t('drive.ping_fair');
    if (pingState.status === 'poor') label = t('drive.ping_poor');

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

  const [, setMetaTick] = useState(0);
  useEffect(() => {
    const handleUpdate = () => setMetaTick((t) => t + 1);
    window.addEventListener('autogram_session_metadata_updated', handleUpdate);
    return () => window.removeEventListener('autogram_session_metadata_updated', handleUpdate);
  }, []);

  /** Section expand — more space when one list is collapsed (Google Drive–style) */
  const [foldersOpen, setFoldersOpen] = useState(() => readSecOpen(LS_SEC_FOLDERS, true));
  const [chatsOpen, setChatsOpen] = useState(() => readSecOpen(LS_SEC_CHATS, true));

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

  /** Expanded parent folders in the Drive tree (folder-in-folder) */
  const [treeExpanded, setTreeExpanded] = useState<Set<number>>(() => new Set());
  const navRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const chatFolderScrollRef = useRef<Map<number, number>>(new Map());
  const lastChatFolderRef = useRef(activeChatFolderId);
  const folderStackRef = useRef<HTMLDivElement | null>(null);
  const chatFoldersScrollerRef = useRef<HTMLDivElement | null>(null);
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

  const {
    overKey,
    springHoverKey,
    dragLive,
    folderDragLive,
    anyDragLive,
    acceptDrop,
    handleHover,
    handleDropKey,
  } = useSidebarDrop({
    folders,
    activePeerId,
    locationKind,
    onSelectSaved,
    onSelectDrive,
    onSelectChat,
    setTreeExpanded,
    openFoldersSection,
    openChatsSection,
    sidebarRef,
    navRef,
    chatListRef,
    folderStackRef,
    chatFoldersScrollerRef,
    onLoadMoreChats,
    scheduleTabSwitch,
    cancelTabSwitch,
    scheduleChatFolderSwitch,
    cancelChatFolderSwitch,
    isSelf,
    onFolderReparentDrop,
    onDropOnLocation,
    labelMap,
    mediaDragActive,
    dragSourceFolderId,
  });

  const BoundDropRow = useCallback(
    (props: DropRowProps) => (
      <DropRow
        {...props}
        dragLive={props.dragLive || anyDragLive}
        isSpringHovering={springHoverKey === props.dropKeyStr}
      />
    ),
    [springHoverKey, anyDragLive]
  );

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

  // Detect Path ID format — when detected, quick jump card is shown instead of normal filter
  const parsedPath = useMemo<ParsedTelegramPath>(
    () => parseTelegramPathId(locationQuery),
    [locationQuery]
  );
  const isPathIdMode = parsedPath.isPathId;

  // Resolve human-readable names for parsed Path ID segments (Account, Chat, Topic, Media)
  const resolvedPathInfo = useMemo(() => {
    if (!parsedPath.isPathId) return null;

    // 1. Account Name
    let accountName: string | null = null;
    let accountTooltip: string | null = null;
    if (parsedPath.accountSegment) {
      const target = parsedPath.accountSegment.trim();
      const targetLower = target.toLowerCase();
      const targetCleanUser = targetLower.replace(/^@/, '');
      const targetDigits = target.replace(/[^0-9]/g, '');

      for (const s of sessions) {
        if (s.toLowerCase() === targetLower) {
          accountName = getSessionDisplayName(s) || s;
          accountTooltip = `${t('ui.path_jump.label_user_id')}: ${target}`;
          break;
        }
        const meta = getSessionMetadata(s);
        if (meta) {
          if (
            (meta.telegramUserId && String(meta.telegramUserId).trim() === target) ||
            (meta.username && meta.username.toLowerCase().replace(/^@/, '') === targetCleanUser) ||
            (meta.userFullName && meta.userFullName.toLowerCase() === targetLower) ||
            (meta.phone && targetDigits.length >= 6 && meta.phone.replace(/[^0-9]/g, '') === targetDigits)
          ) {
            accountName = meta.userFullName || meta.username || getSessionDisplayName(s) || s;
            accountTooltip = `${t('ui.path_jump.label_user_id')}: ${meta.telegramUserId || target}`;
            break;
          }
        }
      }
      if (!accountName) {
        accountName = parsedPath.accountSegment;
        accountTooltip = `${t('ui.path_jump.label_user_id')}: ${parsedPath.accountSegment}`;
      }
    }

    // 2. Chat / Drive / Saved Messages Name
    let chatName: string | null = null;
    let chatTooltip: string | null = null;
    if (parsedPath.isSavedMessages) {
      chatName = t('drive.saved_messages');
      chatTooltip = t('drive.saved_messages');
    } else if (parsedPath.chatId !== null) {
      const cid = parsedPath.chatId;
      const matchFolder = folders.find((f) => {
        const fid = f.id;
        return (
          fid === cid ||
          fid === Math.abs(cid) ||
          fid === -1000_000_000_000 - Math.abs(cid) ||
          Math.abs(fid) === Math.abs(cid)
        );
      });
      if (matchFolder) {
        chatName = matchFolder.name;
        chatTooltip = `${t('ui.path_jump.label_chat_id')}: ${matchFolder.id}`;
      } else {
        const matchChat = chats.find((c) => {
          const chid = c.id;
          return (
            chid === cid ||
            chid === Math.abs(cid) ||
            chid === -1000_000_000_000 - Math.abs(cid) ||
            Math.abs(chid) === Math.abs(cid)
          );
        });
        if (matchChat) {
          chatName = matchChat.name;
          chatTooltip = `${t('ui.path_jump.label_chat_id')}: ${matchChat.id}`;
        }
      }
    } else if (parsedPath.tmeUsername) {
      const username = parsedPath.tmeUsername.toLowerCase().replace(/^@/, '');
      const matchChat = chats.find(
        (c) => (c.username || '').toLowerCase().replace(/^@/, '') === username
      );
      if (matchChat) {
        chatName = matchChat.name;
        chatTooltip = `@${parsedPath.tmeUsername} (ID: ${matchChat.id})`;
      } else {
        chatName = `@${parsedPath.tmeUsername}`;
        chatTooltip = `@${parsedPath.tmeUsername}`;
      }
    }

    if (!chatName && (parsedPath.chatSegmentRaw || parsedPath.chatId)) {
      chatName = parsedPath.chatSegmentRaw ?? String(parsedPath.chatId);
      chatTooltip = `${t('ui.path_jump.label_chat_id')}: ${chatName}`;
    }

    // 3. Topic Name
    let topicName: string | null = null;
    let topicTooltip: string | null = null;
    if (parsedPath.topicId !== null) {
      const targetTopicId = parsedPath.topicId;
      topicTooltip = `${t('ui.path_jump.label_topic_id')}: ${targetTopicId}`;

      const currentSess = creds?.session || '';
      if (currentSess && parsedPath.chatId) {
        try {
          const rawTopics = localStorage.getItem(
            `autogram_drive_topics_v1_${encodeURIComponent(currentSess)}_${parsedPath.chatId}`
          );
          if (rawTopics) {
            const parsed = JSON.parse(rawTopics);
            const found = (parsed.topics || []).find((tp: any) => tp.id === targetTopicId);
            if (found && found.title) {
              topicName = found.title;
            }
          }
        } catch {}
      }
      if (!topicName) {
        topicName = `T${targetTopicId}`;
      }
    }

    // 4. Media / Message Name
    let mediaName: string | null = null;
    let mediaTooltip: string | null = null;
    if (parsedPath.messageId !== null) {
      const targetMsgId = parsedPath.messageId;
      mediaTooltip = `${t('ui.path_jump.label_message_id')}: #${targetMsgId}`;

      const currentSess = creds?.session || '';
      if (currentSess) {
        try {
          const rawLoc = localStorage.getItem(
            `autogram_drive_locations_v1_${encodeURIComponent(currentSess)}`
          );
          if (rawLoc) {
            const parsed = JSON.parse(rawLoc);
            const entries = parsed.entries || {};
            for (const key of Object.keys(entries)) {
              const files = entries[key].files || [];
              const f = files.find((item: any) => item.id === targetMsgId);
              if (f && f.name) {
                mediaName = f.name;
                break;
              }
            }
          }
        } catch {}
      }
      if (!mediaName) {
        mediaName = `#${targetMsgId}`;
      }
    }

    return {
      accountName,
      accountTooltip,
      chatName,
      chatTooltip,
      topicName,
      topicTooltip,
      mediaName,
      mediaTooltip,
    };
  }, [parsedPath, sessions, folders, chats, creds, t]);

  const pathSteps = useMemo(() => {
    if (!resolvedPathInfo) return [];
    const steps: { type: 'account' | 'chat' | 'topic' | 'media'; tag: string; name: string; tooltip?: string }[] = [];
    if (resolvedPathInfo.accountName) {
      steps.push({
        type: 'account',
        tag: 'U',
        name: resolvedPathInfo.accountName,
        tooltip: resolvedPathInfo.accountTooltip || undefined,
      });
    }
    if (resolvedPathInfo.chatName) {
      steps.push({
        type: 'chat',
        tag: 'D',
        name: resolvedPathInfo.chatName,
        tooltip: resolvedPathInfo.chatTooltip || undefined,
      });
    }
    if (resolvedPathInfo.topicName) {
      steps.push({
        type: 'topic',
        tag: 'T',
        name: resolvedPathInfo.topicName,
        tooltip: resolvedPathInfo.topicTooltip || undefined,
      });
    }
    if (resolvedPathInfo.mediaName) {
      steps.push({
        type: 'media',
        tag: '#',
        name: resolvedPathInfo.mediaName,
        tooltip: resolvedPathInfo.mediaTooltip || undefined,
      });
    }
    return steps;
  }, [resolvedPathInfo]);

  // When in Path ID mode, show chat/folder list normally (do not filter to 0 rows)
  // so the user can see context while the Quick Jump card is shown above.
  const chatRows = useMemo(
    () => filterChatsFast(chatIndex, isPathIdMode ? '' : locationQuery),
    [chatIndex, locationQuery, isPathIdMode]
  );
  const folderRows = useMemo(
    () => filterFoldersFast(folders, isPathIdMode ? '' : locationQuery),
    [folders, locationQuery, isPathIdMode]
  );
  // A Drive is a root Telegram storage group. Logical folders/topics nested
  // inside it must not inflate the Drives badge.
  const rootDriveCount = useMemo(
    () => folders.filter((folder) => folder.parent_id == null).length,
    [folders]
  );
  const matchingRootDriveCount = useMemo(
    () => folderRows.filter((folder) => folder.parent_id == null).length,
    [folderRows]
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

  // Prune treeExpanded of any folders that no longer exist (e.g. after folder deletion)
  useEffect(() => {
    if (!folders.length) {
      setTreeExpanded((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const liveIds = new Set(folders.map((f: any) => f.id));
    setTreeExpanded((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (liveIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
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
  const [chatFoldersScrolled, setChatFoldersScrolled] = useState(false);
  const [typeFilterMenuPosition, setTypeFilterMenuPosition] = useState({ left: 0, top: 0 });

  const activeChatTypeLabel = chatTypeFilter === 'all' ? t('drive.filter_all_chats') :
    chatTypeFilter === 'user' ? t('drive.filter_private') :
    chatTypeFilter === 'group' ? t('drive.filter_groups') :
    chatTypeFilter === 'channel' ? t('drive.filter_channels') :
    chatTypeFilter === 'bot' ? t('drive.filter_bots') :
    t('drive.filter_forums');

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

  const matchingRecents = useMemo(() => {
    if (!hasLocationQuery || isPathIdMode) return filteredRecents;
    const q = locationQuery.toLowerCase().trim();
    return filteredRecents.filter((r) =>
      (r.label || '').toLowerCase().includes(q)
    );
  }, [filteredRecents, locationQuery, hasLocationQuery, isPathIdMode]);
  const busy = !!(loadingFolders || loadingChats);

  // While searching or dragging, force sections open so targets stay reachable.
  const forceSectionsOpen = hasLocationQuery || anyDragLive;
  const foldersExpanded = forceSectionsOpen || foldersOpen || collapsed;
  const chatsExpanded = forceSectionsOpen || chatsOpen || collapsed;

  // Persist open on drag so layout stays stable after first frame (no mid-drop collapse)
  useEffect(() => {
    if (!anyDragLive) return;
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
  }, [anyDragLive, onChatQuery]);

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
    if (!filteredByTypeChats.length) {
      if (chatsHasMore) onLoadMoreChats?.();
      return;
    }
    if (vEnd < 0) return;
    if (vEnd >= filteredByTypeChats.length - 4) {
      onLoadMoreChats?.();
    }
  }, [vEnd, filteredByTypeChats.length, chatsHasMore, chatsLoadingMore, collapsed, onLoadMoreChats]);

  // Re-measure when chrome changes (not on every chatRows identity)
  useEffect(() => {
    chatVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, folders.length, folderRows.length, chatQuery, foldersExpanded, chatsExpanded]);


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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          // Allow re-focus only when not already typing in another field that isn't location search
          if (t !== locationSearchRef.current && t.closest('.td-location-search') == null) return;
        }
        e.preventDefault();
        locationSearchRef.current?.focus();
        locationSearchRef.current?.select();
      } else if (e.key === 'Escape' && hasLocationQuery) {
        onChatQuery('');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [collapsed, hasLocationQuery, onChatQuery]);

  // Collapse sidebar is strictly disabled below 900x600 (drawer mode stays clean & expanded)
  const isCollapseAllowed = typeof window !== 'undefined'
    ? window.innerWidth >= 900 && window.innerHeight >= 600
    : true;
  const effectiveCollapsed = isCollapseAllowed ? collapsed : false;
  return (
    <SidebarView
      ctx={{
        t, folders, chats, chatFolders, activeChatFolderId, onSelectChatFolder, activePeerId,
        locationKind, onSelectSaved, onSelectDrive, onSelectChat, onCreate, onRefresh,
        loadingFolders, loadingChats, session, sessions, onSessionChange, statusText, connected,
        collapsed, onToggleCollapse, chatQuery, onChatQuery, drawerOpen, onCloseDrawer,
        chatsHasMore, chatsLoadingMore, onLoadMoreChats, onExitToApp, onOpenRelogModal,
        onDropOnLocation, mediaDragActive, dragSourceFolderId, creds, recents, onSelectRecent,
        pins, onSelectPin, onLocationContextMenu, onFolderReparentDrop, channelLimitWarning,
        pingState, onNavigatePath, isCompactSearchActive, setIsCompactSearchActive, getPingTooltip,
        layoutModel, activeTab, setActiveTab, manualSpin, handleRefreshClick, scheduleTabSwitch,
        cancelTabSwitch, scheduleChatFolderSwitch, cancelChatFolderSwitch, navRef, sidebarRef,
        chatListRef, chatFolderScrollRef, lastChatFolderRef, folderStackRef, labelMap, sourceFolder,
        isSelf, chatIndex, locationQuery, hasLocationQuery, parsedPath, isPathIdMode,
        resolvedPathInfo, pathSteps, chatRows, folderRows, rootDriveCount, matchingRootDriveCount,
        treeSeededRef, lastTreeExpandPeerRef, treeExpanded, setTreeExpanded, folderTreeRows,
        pinnedDriveIds, pinnedChatIds, displayFolderTreeRows, displayChatRows, typeFilterMenuRef,
        typeFilterButtonRef, chatFoldersScrollerRef, activeChatTypeLabel, toggleTypeFilterMenu,
        filteredByTypeChats, toggleTreeFolder, createIsSubfolder, activeDriveFolder, showSaved,
        filteredRecents, matchingRecents, busy, forceSectionsOpen, foldersExpanded, chatsExpanded,
        openFoldersSection, openChatsSection, toggleFolders, toggleChats, chatVirtualizer,
        virtualItems, vStart, vEnd, overKey, dragLive, folderDragLive, anyDragLive, acceptDrop,
        handleHover, handleDropKey, registerLabel, go, locationSearchRef, isCollapseAllowed,
        effectiveCollapsed, chatFoldersScrolled, setChatFoldersScrolled, chatTypeFilter,
        setChatTypeFilter, typeFilterMenuOpen, setTypeFilterMenuOpen, typeFilterMenuPosition,
        DRIVE_FOLDER_SOFT_LIMIT, driveItemKind, describePath, chatFolderDropKey, parseChatFolderDropKey,
        applyDropEffect, recentDisplayLabel, getDriveSessionError, isDriveSessionCircuitTripped,
        resetDriveSessionCircuit, getSessionDisplayName, telegramFolderColor, formatRelativeAccessTime,
        dropKey, isInternalMediaDragActive, isFolderReparentDragActive, DropRow: BoundDropRow, PeerAvatar, ChatIcon,
      }}
    />
  );
}
