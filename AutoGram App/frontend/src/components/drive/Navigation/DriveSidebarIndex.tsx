import { useTranslation } from 'react-i18next';
import {
  FolderPlus,
  Folder,
  RefreshCw,
  Home,
  HardDrive,
  Loader2,
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
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  applyDropEffect,
  beginFolderDrag,
  canAcceptDriveDrop,
  DRAG_SCROLL_EDGE_PX,
  DRAG_SCROLL_OUTSIDE_PX,
  DRAG_SCROLL_STEP_MIN_PX,
  DRAG_SCROLL_STEP_MAX_PX,
  DRAG_SCROLL_EASE_POWER,
  noteSidebarDragHover,
  noteSidebarDragScroll,
  shouldBlockDriveDrop,
  clearSidebarDragScrollGuard,
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

const LS_SEC_FOLDERS = 'td_sec_folders_open';
const LS_SEC_CHATS = 'td_sec_chats_open';
const LS_SEC_RECENTS = 'td_sec_recents_open';
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

/** Real Telegram profile photo with lucide/type fallback */
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
        if (!onContextMenu || dragLive || folderDragLive) return;
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
  const [recentsOpen, setRecentsOpen] = useState(() => readSecOpen(LS_SEC_RECENTS, true));
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
  /** Recents: force open while DnD so chips stay droppable; otherwise honor user toggle */
  const recentsExpanded = forceSectionsOpen || recentsOpen || collapsed;

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
    setRecentsOpen((o) => {
      if (!o) writeSecOpen(LS_SEC_RECENTS, true);
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
  const toggleRecents = useCallback(() => {
    setRecentsOpen((prev) => {
      const next = !prev;
      writeSecOpen(LS_SEC_RECENTS, next);
      return next;
    });
  }, []);
  const openRecentsSection = useCallback(() => {
    setRecentsOpen((prev) => {
      if (prev) return prev;
      writeSecOpen(LS_SEC_RECENTS, true);
      return true;
    });
  }, []);

  // Virtual list scrolls inside .td-chat-virtual (flex:1 fills leftover height).
  // On short viewports, chrome is compacted via CSS so this pane stays usable.
  const chatVirtualizer = useVirtualizer({
    count: chatRows.length,
    getScrollElement: () => chatListRef.current,
    estimateSize: () => (collapsed ? 44 : 44),
    overscan: collapsed ? 6 : 12,
  });

  /**
   * Collapsed rail: native wheel jumps many avatars at once (feels too fast).
   * Dampen wheel/trackpad deltas only in icon-rail mode.
   */
  useEffect(() => {
    if (!collapsed || drawerOpen) return;
    const SCALE = 0.32; // ~1/3 speed; still responsive on trackpad
    const LINE_PX = 18; // ~half of 40px hit target per "line" tick
    const softWheel = (e: WheelEvent) => {
      const el = e.currentTarget as HTMLElement;
      if (!el) return;
      // Let pinch-zoom / horizontal pan through
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= LINE_PX; // lines
      else if (e.deltaMode === 2) dy *= el.clientHeight * 0.35; // pages
      // Cap huge mouse-wheel notches so one tick ≈ one icon
      if (e.deltaMode === 0 && Math.abs(dy) > 80) {
        dy = Math.sign(dy) * (40 + (Math.abs(dy) - 40) * 0.15);
      }
      const next = el.scrollTop + dy * SCALE;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (max <= 0) return;
      e.preventDefault();
      el.scrollTop = Math.max(0, Math.min(max, next));
    };
    const opts: AddEventListenerOptions = { passive: false };
    const chat = chatListRef.current;
    const drives = folderStackRef.current;
    chat?.addEventListener('wheel', softWheel, opts);
    drives?.addEventListener('wheel', softWheel, opts);
    return () => {
      chat?.removeEventListener('wheel', softWheel, opts);
      drives?.removeEventListener('wheel', softWheel, opts);
    };
  }, [collapsed, drawerOpen, chatsExpanded, foldersExpanded, chatRows.length, folders.length]);

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

    /**
     * Depth 0 (just entered edge band) → crawl; depth 1 (extreme edge / past edge) → fast.
     * Ease-in power curve keeps most of the band slow; only the last portion ramps.
     */
    const edgeStep = (depth01: number) => {
      const d = Math.max(0, Math.min(1, depth01));
      const eased = Math.pow(d, DRAG_SCROLL_EASE_POWER);
      return (
        DRAG_SCROLL_STEP_MIN_PX +
        eased * (DRAG_SCROLL_STEP_MAX_PX - DRAG_SCROLL_STEP_MIN_PX)
      );
    };

    const canScroll = (el: HTMLElement, dir: 'up' | 'down') => {
      if (dir === 'up') return el.scrollTop > 1;
      return el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    };

    const applyScroll = (el: HTMLElement, dir: 'up' | 'down', step: number) => {
      // Accumulate fractional steps so slow speeds don't quantize to 0
      scrollCarry += Math.max(0, step);
      if (scrollCarry < 0.35) return;
      const px = scrollCarry;
      scrollCarry = 0;
      noteSidebarDragScroll(px);
      // While scrolling, clear drive highlight so green fly-by doesn't invite accidental drop
      setOverKey((prev) => (prev && prev.startsWith('drive:') ? null : prev));
      if (dir === 'up') el.scrollTop = Math.max(0, el.scrollTop - px);
      else {
        el.scrollTop = Math.min(
          Math.max(0, el.scrollHeight - el.clientHeight),
          el.scrollTop + px
        );
      }
    };

    /** Hover key with dwell/scroll guard for Drive rows */
    const applyHoverKey = (key: string | null) => {
      noteSidebarDragHover(key);
      if (key && shouldBlockDriveDrop(key)) {
        // Keep tracking dwell, but don't show "drop ready" green yet
        setOverKey(null);
        return;
      }
      setOverKey((prev) => (prev === key ? prev : key));
      if (key) setLastHoverDropKey(key);
    };

    const tryLoadMore = (el: HTMLElement) => {
      if (
        el.scrollTop + el.clientHeight >= el.scrollHeight - 100 &&
        Date.now() - loadMoreCool > 700
      ) {
        loadMoreCool = Date.now();
        onLoadMoreChats?.();
      }
    };

    /**
     * Nested scroll while dragging:
     * Prefer the list the pointer is *strictly* over. Chat top used to lose to
     * Drives bottom (pad overlap) which made scrolling chat upward feel stuck.
     */
    const scrollInnerOnly = (dir: 'up' | 'down', step: number) => {
      const folders = folderStackRef.current;
      const chat = chatListRef.current;
      const fR = folders?.getBoundingClientRect();
      const cR = chat?.getBoundingClientRect();
      // Generous hit pad — only used when not strictly over either list
      const pad = 20;
      const overFoldersStrict =
        !!fR && lastY >= fR.top && lastY <= fR.bottom;
      const overChatStrict =
        !!cR && lastY >= cR.top && lastY <= cR.bottom;
      const overFoldersPad =
        !!fR && lastY >= fR.top - pad && lastY <= fR.bottom + pad;
      const overChatPad =
        !!cR && lastY >= cR.top - pad && lastY <= cR.bottom + pad;

      const tryFolders = () => {
        if (folders && canScroll(folders, dir)) {
          applyScroll(folders, dir, step);
          return 'folders' as const;
        }
        return null;
      };
      const tryChat = () => {
        if (chat && canScroll(chat, dir)) {
          applyScroll(chat, dir, step);
          if (dir === 'down') tryLoadMore(chat);
          return 'chat' as const;
        }
        return null;
      };

      // Strict containment wins — fixes chat-up stolen by drives bottom pad.
      // No cross-list fallback when strictly over one pane (avoids yanking the other).
      if (overChatStrict && !overFoldersStrict) {
        return tryChat();
      }
      if (overFoldersStrict && !overChatStrict) {
        return tryFolders();
      }
      // Overlap: pick nearer list center, then fall back
      if (overChatStrict && overFoldersStrict && fR && cR) {
        const midF = (fR.top + fR.bottom) / 2;
        const midC = (cR.top + cR.bottom) / 2;
        if (Math.abs(lastY - midC) <= Math.abs(lastY - midF)) {
          return tryChat() ?? tryFolders();
        }
        return tryFolders() ?? tryChat();
      }
      // Near-pad only (gap between sections)
      if (overChatPad && !overFoldersPad) return tryChat();
      if (overFoldersPad && !overChatPad) return tryFolders();
      if (overChatPad) return tryChat() ?? tryFolders();
      if (overFoldersPad) return tryFolders() ?? tryChat();
      return null;
    };

    /**
     * When over Drives/Chats list → scroll that list first.
     * Otherwise outer nav, then fall back to inner.
     */
    const cascadeScroll = (dir: 'up' | 'down', step: number) => {
      const innerFirst = scrollInnerOnly(dir, step);
      if (innerFirst) return innerFirst;
      const nav = navRef.current;
      if (nav && canScroll(nav, dir)) {
        applyScroll(nav, dir, step);
        return 'nav';
      }
      return null;
    };

    const edgeScroll = () => {
      if (hasPointer) {
        const side = sidebarRef.current?.getBoundingClientRect();
        const nav = navRef.current;
        const navR = nav?.getBoundingClientRect();
        const refR = navR || side;
        if (refR && side) {
          const left = side.left - 8;
          const right = side.right + 8;
          const inX = lastX >= left && lastX <= right;
          if (inX) {
            const edge = Math.max(
              DRAG_SCROLL_EDGE_PX,
              Math.min(110, Math.floor(refR.height * 0.26))
            );
            const outside = DRAG_SCROLL_OUTSIDE_PX;
            const stepAt = (depth: number) => edgeStep(depth);
            const folders = folderStackRef.current?.getBoundingClientRect();
            const chat = chatListRef.current?.getBoundingClientRect();
            // Wider edge bands inside both lists for easier up/down scroll while DnD
            const drivesBand = Math.max(
              56,
              Math.min(72, Math.floor((folders?.height || 120) * 0.38))
            );
            // Match Drives band sizing so chat-up is as easy as drives-up
            const chatBand = Math.max(
              56,
              Math.min(80, Math.floor((chat?.height || 140) * 0.4))
            );
            const overFoldersStrict =
              !!folders && lastY >= folders.top && lastY <= folders.bottom;
            const overChatStrict =
              !!chat && lastY >= chat.top && lastY <= chat.bottom;

            // ── TOP of sidebar body ──
            if (lastY < refR.top + edge && lastY > refR.top - outside) {
              const depth =
                lastY < refR.top
                  ? 1
                  : Math.min(1, (refR.top + edge - lastY) / edge);
              // Prefer list under cursor (Drives/Chats), then nav
              cascadeScroll('up', stepAt(depth));
            }
            // ── BOTTOM of sidebar body ──
            else if (lastY > refR.bottom - edge && lastY < refR.bottom + outside) {
              const depth =
                lastY > refR.bottom
                  ? 1
                  : Math.min(1, (lastY - (refR.bottom - edge)) / edge);
              cascadeScroll('down', stepAt(depth));
            }
            // ── Mid-body / over Drives or Chats panes ──
            // When pointer is in Chats, handle chat bands first so the top of
            // the chat list is not stolen by the Drives bottom "scroll down" band.
            else if (overChatStrict && chat) {
              if (
                lastY > chat.bottom - chatBand &&
                lastY < chat.bottom + outside
              ) {
                const depth = Math.min(
                  1,
                  (lastY - (chat.bottom - chatBand)) / chatBand
                );
                scrollInnerOnly('down', stepAt(depth));
              } else if (
                lastY < chat.top + chatBand &&
                lastY > chat.top - outside
              ) {
                const depth = Math.min(
                  1,
                  (chat.top + chatBand - lastY) / chatBand
                );
                scrollInnerOnly('up', stepAt(depth));
              }
            } else if (overFoldersStrict && folders) {
              if (
                lastY > folders.bottom - drivesBand &&
                lastY < folders.bottom + outside
              ) {
                const depth = Math.min(
                  1,
                  (lastY - (folders.bottom - drivesBand)) / drivesBand
                );
                scrollInnerOnly('down', stepAt(depth));
              } else if (
                lastY < folders.top + drivesBand &&
                lastY > folders.top - outside
              ) {
                const depth = Math.min(
                  1,
                  (folders.top + drivesBand - lastY) / drivesBand
                );
                scrollInnerOnly('up', stepAt(depth));
              }
            } else {
              // Near edges outside strict rects (gap between sections / pad)
              if (
                chat &&
                lastY < chat.top + chatBand &&
                lastY > chat.top - outside
              ) {
                const depth = Math.min(
                  1,
                  (chat.top + chatBand - lastY) / chatBand
                );
                scrollInnerOnly('up', stepAt(depth));
              } else if (
                chat &&
                lastY > chat.bottom - chatBand &&
                lastY < chat.bottom + outside
              ) {
                const depth = Math.min(
                  1,
                  (lastY - (chat.bottom - chatBand)) / chatBand
                );
                scrollInnerOnly('down', stepAt(depth));
              } else if (
                folders &&
                lastY > folders.bottom - drivesBand &&
                lastY < folders.bottom + outside
              ) {
                const depth = Math.min(
                  1,
                  (lastY - (folders.bottom - drivesBand)) / drivesBand
                );
                scrollInnerOnly('down', stepAt(depth));
              } else if (
                folders &&
                lastY < folders.top + drivesBand &&
                lastY > folders.top - outside
              ) {
                const depth = Math.min(
                  1,
                  (folders.top + drivesBand - lastY) / drivesBand
                );
                scrollInnerOnly('up', stepAt(depth));
              }
            }
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
        return;
      }
      e.preventDefault();
      lastX = e.clientX;
      lastY = e.clientY;
      hasPointer = true;
      const key = hit(e.clientX, e.clientY);
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
      if (!isInternalMediaDragActive() && !mediaDragActive && !dragLive) return;
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
      applyHoverKey(key);
    };

    // Wheel during drag:
    // - scroll up: body first; if mentok atas → only scroll inner if pointer is over that list
    // - scroll down: body first, then inner
    const onWheel = (e: WheelEvent) => {
      if (
        !isInternalMediaDragActive() &&
        !mediaDragActive &&
        !dragLive &&
        !folderDragLive &&
        !isFolderReparentDragActive()
      )
        return;
      const side = sidebarRef.current?.getBoundingClientRect();
      if (!side) return;
      if (e.clientX < side.left - 12 || e.clientX > side.right + 12) return;
      lastX = e.clientX;
      lastY = e.clientY;
      hasPointer = true;
      const dir: 'up' | 'down' = e.deltaY < 0 ? 'up' : 'down';
      const step = Math.min(48, Math.max(8, Math.abs(e.deltaY)));
      const nav = navRef.current;

      if (dir === 'up') {
        // Prefer the list under the pointer first (chat-up / drives-up),
        // then outer nav — avoids chat feeling stuck while body still scrolls.
        if (scrollInnerOnly('up', step)) {
          e.preventDefault();
          return;
        }
        if (nav && canScroll(nav, 'up')) {
          applyScroll(nav, 'up', step);
          e.preventDefault();
        }
        return;
      }

      // down
      const which = cascadeScroll('down', step);
      if (which) e.preventDefault();
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
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('dragend', clear, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('dragenter', onDragEnter, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
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

  return (
    <aside
      ref={sidebarRef as React.RefObject<HTMLElement>}
      className={`td-sidebar ${collapsed ? 'is-collapsed' : ''} ${drawerOpen ? 'is-drawer-open' : ''} ${anyDragLive ? 'media-dnd' : ''}`}
      aria-label="Drive locations"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* Expand/collapse first (top) — users expect this control at the top of the rail */}
      <div className="td-rail-head">
        <button
          type="button"
          className="td-rail-brand td-rail-brand-toggle"
          onClick={onToggleCollapse}
          title={collapsed ? 'Perluas sidebar Drive' : 'Ciutkan sidebar Drive'}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Perluas sidebar Drive' : 'Ciutkan sidebar Drive'}
        >
          <div className="td-sidebar-logo">
            <HardDrive size={20} />
            {collapsed && (
              <span
                className={`td-sidebar-logo-dot td-rail-conn-dot ${pingState?.status || (connected ? 'excellent' : 'disconnected')} pulse`}
                title={getPingTooltip()}
              />
            )}
          </div>
          <div className="td-sidebar-brand-text">
            <strong>Drive</strong>
            <span>Telegram · [TD]</span>
          </div>
        </button>

        {onExitToApp && (
          <button
            type="button"
            className="td-rail-btn td-rail-back"
            onClick={() => {
              onExitToApp();
              onCloseDrawer?.();
            }}
            title={t("speedtest.sidebar_back_to_app")}
          >
            <ArrowLeft size={18} />
            <span className="td-rail-btn-label">
              <Rocket size={14} />
              AutoGram
            </span>
          </button>
        )}
      </div>

      <div className="td-sidebar-session td-only-expanded">
        <label className="td-label">{t("speedtest.session_header")}</label>
        <MediaSelect
          value={session}
          onChange={onSessionChange}
          ariaLabel="Telegram session"
          compact
          options={sessions.length
            ? sessions.map((name) => ({ value: name, label: getSessionDisplayName(name) }))
            : [{ value: '', label: 'Belum ada session', disabled: true }]}
        />
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
                {t('accounts.btn_relog', 'Login Ulang')}
              </button>
            )}
          </span>
        </div>
      </div>

      <div className="td-rail-actions td-rail-toolbar" role="toolbar" aria-label="Aksi Drive">
        <button
          type="button"
          className="td-rail-btn td-rail-tool"
          title={t("speedtest.sidebar_refresh_all")}
          aria-label={t("speedtest.sidebar_refresh_tooltip")}
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
          <span className="td-rail-btn-label">Muat</span>
        </button>
        <button
          type="button"
          className="td-rail-btn td-rail-tool"
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
          <FolderPlus size={16} aria-hidden />
          <span className="td-rail-btn-label">
            {createIsSubfolder ? '+ Folder' : '+ Drive'}
          </span>
        </button>
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
          Lepas di <strong>Drive atau folder lain</strong> untuk memindahkan · Esc batal
        </p>
      )}

      <nav
        ref={navRef as React.RefObject<HTMLElement>}
        className={`td-folder-nav ${anyDragLive ? 'is-drop-mode is-dnd-layout' : ''} ${
          !chatsExpanded ? 'chats-collapsed' : ''
        } ${!foldersExpanded ? 'folders-collapsed' : ''}`}
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
        {/* Universal location search — hidden while dragging (frees space for drop list) */}
        {!anyDragLive && (
          <div className="td-location-search td-only-expanded">
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
        {hasLocationQuery && !dragLive && (
          <p className="td-location-search-meta td-only-expanded">
            {[
              showSaved ? 1 : 0,
              folderRows.length,
              chatRows.length,
            ].reduce((a, b) => a + b, 0)}{' '}
            lokasi
            {chatsHasMore && chatRows.length === 0
              ? ' · muat chat lain jika belum muncul'
              : ''}
          </p>
        )}
        {/* Shortcuts moved to input title tooltips — strip was visual noise */}
        <div className="td-shortcuts-hint td-only-expanded" style={{ display: 'none' }}>
          Ctrl+K lokasi · Ctrl+F file · Ctrl+A pilih · Esc
        </div>

        {showSaved &&
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
                    title="Saved Messages"
                    fallback={<Home size={16} />}
                  />
                </span>
                <span className="td-folder-label">{t("speedtest.saved_messages")}</span>
              </DropRow>
            );
          })()}

        {/* Pinned favorites */}
        {!hasLocationQuery && pins.length > 0 && (
          <div className="td-recents td-pins td-only-expanded" data-pins="1">
            <div className="td-recents-label">
              <Pin size={12} aria-hidden />
              Disematkan
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
                  >
                    <span className="td-folder-label">{short}</span>
                  </DropRow>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent locations — expandable section; chips are drop targets during DnD */}
        {!hasLocationQuery && recents.length > 0 && (
          <div
            className={`td-recents td-only-expanded${recentsExpanded ? '' : ' is-collapsed-sec'}`}
            data-recent="1"
          >
            <button
              type="button"
              className={`td-section-toggle td-recents-toggle${dragLive ? ' is-dnd-target' : ''}`}
              aria-expanded={recentsExpanded}
              onClick={toggleRecents}
              onPointerEnter={() => {
                if (dragLive || isInternalMediaDragActive() || mediaDragActive) {
                  openRecentsSection();
                }
              }}
              onDragEnter={(e) => {
                if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
                e.preventDefault();
                openRecentsSection();
              }}
              onDragOver={(e) => {
                if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
                e.preventDefault();
                openRecentsSection();
              }}
              title={
                recentsExpanded
                  ? 'Ciutkan Terbaru'
                  : 'Perluas Terbaru — lokasi yang baru dibuka'
              }
            >
              <ChevronDown
                size={14}
                className={`td-section-chevron ${recentsExpanded ? 'is-open' : ''}`}
                aria-hidden
              />
              <Clock size={12} className="td-recents-toggle-ico" aria-hidden />
              <span className="td-section-toggle-label">{t("speedtest.sidebar_recents_header")}</span>
              <span className="td-chat-count" title={t("speedtest.sidebar_recents_tooltip")}>
                {recents.length}
              </span>
            </button>
            {recentsExpanded && (
              <div className="td-recents-list">
                {recents.slice(0, 6).map((r: any) => {
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
                  const short = recentDisplayLabel(r.label, 18);
                  return (
                    <DropRow
                      key={`${r.kind}:${r.id ?? 'me'}`}
                      dropKeyStr={key}
                      className={`td-recent-chip ${active ? 'active' : ''}`}
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
                    >
                      <span className="td-folder-label">{short}</span>
                    </DropRow>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Drives [TD] — compact stack while dragging so CHATS list gets height */}
        <div ref={folderStackRef} className="td-dnd-folder-stack">
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
            <span className="td-section-toggle-label">Drives [TD]</span>
            <span className="td-chat-count" title={t("speedtest.sidebar_td_count")}>
              {hasLocationQuery ? `${folderRows.length}/${folders.length}` : folders.length}
            </span>
          </button>
          {foldersExpanded && folders.length === 0 && !loadingFolders && !hasLocationQuery && (
            <p className="td-sidebar-hint td-only-expanded">
              <strong>Drive</strong> = root (penanda <code>[TD]</code>). Buka Drive lalu{' '}
              <strong>+ Folder</strong>; folder bisa berisi folder lagi. Chat di bawah.
            </p>
          )}
          {foldersExpanded && hasLocationQuery && folderRows.length === 0 && folders.length > 0 && (
            <p className="td-sidebar-hint td-only-expanded">Tidak ada Drive/folder cocok.</p>
          )}
          {foldersExpanded &&
            folderTreeRows.map(({ folder: f, depth, hasChildren }) => {
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
                  style={collapsed ? undefined : { paddingLeft: 8 + depth * 14 }}
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
                    ) : (
                      <span className="td-folder-tree-spacer" aria-hidden />
                    ))}
                  <span className="td-folder-ico">
                    <PeerAvatar
                      peerId={f.id}
                      creds={creds}
                      title={f.name}
                      fallback={<Folder size={16} />}
                    />
                  </span>
                  <span className="td-folder-label">{f.name}</span>
                  {/* Badges only on roots / orphan — nested keeps full name visible */}
                  {itemKind === 'drive' && !f.is_orphan && depth === 0 && (
                    <span className="td-badge-drive td-only-expanded" title={t("speedtest.sidebar_drive_root")}>
                      Drive
                    </span>
                  )}
                  {f.is_orphan && (
                    <span className="td-folder-orphan-badge td-only-expanded" title={t("speedtest.sidebar_orphan_parent")}>
                      Yatim
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
                title={`${f.name} (aktif — klik header untuk semua folder)`}
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
        <div
          className="td-zone-divider"
          role="separator"
          aria-label={t("speedtest.sidebar_resizer_aria")}
        >
          <span className="td-zone-divider-line" aria-hidden />
        </div>

        {/* Chats section */}
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
        {chatsExpanded && chatFolders.length > 0 && (
          <div className="td-chat-folders-wrap td-only-expanded">
            <span className="td-chat-folders-label">{t("speedtest.sidebar_chat_folders_header")}</span>
            <div className="td-chat-folders" role="tablist" aria-label={t("speedtest.sidebar_chat_folders_aria")}>
              {chatFolders.map((folder) => {
                const active = folder.id === activeChatFolderId;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    className={`td-chat-folder-chip${active ? ' active' : ''}`}
                    style={{ '--td-chat-folder-color': telegramFolderColor(folder.color) } as React.CSSProperties}
                    title={`${folder.id === 0 ? t("speedtest.all_chats") : folder.title}${folder.kind === 'shared' ? ' · folder bersama Telegram' : ''}`}
                    onClick={() => onSelectChatFolder?.(folder.id)}
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
                    <span>{folder.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {chatsExpanded && chatRows.length === 0 && !loadingChats && (
          <p className="td-sidebar-hint td-only-expanded">
            {hasLocationQuery
              ? chatsHasMore
                ? 'Belum ketemu di chat yang sudah termuat — scroll/muat daftar…'
                : 'Tidak ada chat yang cocok.'
              : 'Tidak ada chat. Refresh atau cek session.'}
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
            aria-label="Daftar chat"
          >
            <div
              className="td-chat-virtual-inner"
              style={{ height: chatVirtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualItems.map((vRow) => {
                const c = chatRows[vRow.index];
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
                          ? `${c.name} — lokasi sumber (pilih chat lain)`
                          : `${c.name} (${c.type}) — klik kanan menu${
                              c.is_forum ? ' · forum' : ''
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
                        <PeerAvatar
                          peerId={c.id}
                          creds={creds}
                          title={c.name}
                          fallback={<ChatIcon type={c.type} />}
                        />
                      </span>
                      <span className="td-folder-label">{c.name}</span>
                      {c.is_forum && (
                        <span
                          className="td-badge-forum td-only-expanded"
                          title={t('speedtest.group_with_topics')}
                        >
                          Topik
                        </span>
                      )}
                    </DropRow>
                  </div>
                );
              })}
            </div>
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
                title={`${c.name} (aktif — klik header untuk semua chat)`}
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
      </nav>

      <div className="td-sidebar-foot td-only-expanded p-3 border-t border-gray-100 dark:border-gray-800">
        {creds && isDriveSessionCircuitTripped(creds) ? (
          <div className="flex flex-col gap-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-lg">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium break-words leading-relaxed">
              {getDriveSessionError(creds) || 'Drive gagal terhubung.'}
            </p>
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-md transition-colors shadow-sm cursor-pointer"
              onClick={() => {
                resetDriveSessionCircuit(creds);
              }}
            >
              <RefreshCw className="w-3 h-3 animate-pulse" />
              Coba Lagi
            </button>
          </div>
        ) : (
          statusText && <p className="td-status-foot">{statusText}</p>
        )}
      </div>
    </aside>
  );
}
