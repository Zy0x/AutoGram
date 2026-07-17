/**
 * Media Studio → AutoGram Drive (Telegram-Drive model)
 * Tab id remains `speedtest`. Desktop only.
 *
 * Root = Saved Messages · Drives [TD] (root) · Folders nested under Drives · Any chat loadable.
 */
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { HardDrive, AlertTriangle } from 'lucide-react';
import { canUseLocalTelegramWorker } from '../lib/platform';
import {
  openDriveMoveConfirm,
  closeDriveMoveConfirm,
  subscribeDriveMoveConfirmStore,
  getDriveMoveConfirmSnapshot,
  getDriveMoveConfirmVersion,
} from '../lib/driveMoveUi';
import {
  bootstrapSecureCredentials,
  deleteWorkerTempFile,
  getApiHashSync,
  getApiIdSync,
  writeWorkerTempJson,
} from '../lib/secureCredentials';
import { loadSelectableSessionNames } from '../lib/sessionPicker';
import {
  driveBootstrap,
  driveListChatFolders,
  driveListChats,
  driveScanFolders,
  driveCreateFolder,
  driveDeleteFolder,
  driveListFiles,
  driveMediaStats,
  driveListTopics,
  driveDeleteBatch,
  driveRename,
  driveRenameFolder,
  driveSetFolderParent,
  driveMove,
  driveUploadSpawn,
  driveDownloadBatchSpawn,
  driveDownloadSpawn,
  cancelDriveJob,
  cleanupPartialDownloads,
  setDriveTransferPaused,
  clearDriveTransferPause,
  isTransferJobActive,
  parseEventLine,
  parseJsonOutput,
  friendlyDriveError,
  isPeerEntityError,
  CHAT_BULK_PAGE,
  type DriveCredentials,
  type ChatListCursor,
} from '../lib/driveApi';
import {
  cancelScheduledDriveSessionStop,
  ensureDriveSession,
  isDriveSessionReady,
  scheduleDriveSessionStop,
} from '../lib/driveSession';
import {
  loadDriveLocationSnapshot,
  saveDriveLocationSnapshot,
} from '../lib/driveLocationCache';
import {
  loadDriveSidebarSnapshot,
  saveDriveSidebarSnapshot,
} from '../lib/driveSidebarCache';
import {
  loadDriveTopicsSnapshot,
  saveDriveTopicsSnapshot,
} from '../lib/driveTopicsCache';
import {
  driveSyncBackoffMs,
  getDriveLiveSyncPlan,
  reconcileDriveLiveHead,
} from '../lib/driveLiveSync';
import {
  driveScrollLocationKey,
  loadDriveScrollPosition,
  saveDriveScrollPosition,
} from '../lib/driveScrollMemory';
import { getDrivePerfProfile, perfStatusHint } from '../lib/devicePerformance';
import {
  clampMediaBytes,
  clampMediaTotal,
  loadedMediaBytes,
  loadedUniqueMediaCount,
} from '../lib/driveMediaTotals';
import type {
  DriveChat,
  DriveChatFolder,
  DriveFile,
  DriveFolder,
  DriveGridZoom,
  DriveMediaFilter,
  DriveSortMode,
  DriveThumbQuality,
  DriveTopic,
  DriveTopicFilter,
  DriveViewMode,
  TransferSession,
} from '../lib/driveTypes';
import {
  DEFAULT_DRIVE_SORT,
  DRIVE_FOLDER_SOFT_LIMIT,
  driveFileDisplayName,
  driveItemKind,
  labelDriveItem,
  EMPTY_TRANSFER_SESSION,
  clampGridZoom,
  formatDriveBytes,
  isDriveGridZoom,
  isDriveSortMode,
  isDriveThumbQuality,
  loadTransferSettings,
  saveTransferSettings,
  type DriveTransferSettings as TransferSettingsState,
} from '../lib/driveTypes';
import {
  applyTransferEvent,
  applyTransferStdoutLine,
  clearFinishedItems,
  markTransferFinished,
  seedTransferSession,
  setSessionPaused,
  transferBadge,
} from '../lib/transferProgress';
import { debugLog, isDebugMode } from '../lib/debugMode';
import {
  applyClickSelection,
  invertSelectionOnDisplayed,
  pruneSelectionToDisplayed,
  selectAllDisplayed,
  type MarqueeMode,
} from '../lib/driveSelection';
import {
  computeSpaceUsage,
  createNavHistory,
  EMPTY_ADV_FILTER,
  filterAndSortDriveFilesPower,
  filterSkipDuplicates,
  getDriveClipboard,
  isAdvFilterActive,
  navBack,
  navCurrent,
  navForward,
  navPush,
  setDriveClipboard,
  type DriveAdvFilter,
  type DriveNavHistory,
} from '../lib/drivePower';
import {
  DriveToolsPanel,
  type DriveToolsTab,
} from '../components/media-drive/DriveToolsPanel';
import {
  clearThumbCache,
  invalidateThumbFailures,
  setThumbContext,
  setThumbBootstrapMode,
  setThumbQuality,
  setThumbsPaused,
} from '../lib/thumbBatcher';
import { clearAvatarCache, invalidateAvatarFailures } from '../lib/avatarBatcher';
import {
  CHAT_SOFT_PREFETCH_DELAY_MS,
  INITIAL_STATS_DELAY_MS,
  MIN_FOLDER_SCAN_DELAY_MS,
  progressiveSettleDelayMs,
  stagedInitialPageSize,
  stagedLoadMorePageSize,
} from '../lib/driveLoadStaging';
import {
  beginDriveDrag,
  clearLastOsPaths,
  endDriveDrag,
  endFolderDrag,
  extractOsPaths,
  getActiveDriveDrag,
  getDriveDragData,
  getLastOsPaths,
  hasOsFiles,
  applyDropEffect,
  isDropKeySameAsSource,
  isExternalOsFileDrag,
  isInternalMediaDragActive,
  isPointerDriveDragActive,
  parseDropKey,
  pickDropKeyAtPoint,
  DRAG_THRESHOLD_PX,
  getLastHoverDropKey,
  setLastHoverDropKey,
  sameDriveLocation,
  setDriveDragData,
  setLastOsPaths,
  setPointerDriveDragActive,
  shouldBlockDriveDrop,
  waitForOsPaths,
  type DriveDropTarget,
} from '../lib/driveDrag';
import {
  buildDriveBreadcrumbSegments,
  folderDirectChildIds,
  wouldCreateFolderCycle,
  withFolderOrphanFlags,
} from '../lib/chatSearch';
import { DriveSidebar } from '../components/media-drive/DriveSidebar';
import { DriveTopBar, type DriveCrumbSeg } from '../components/media-drive/DriveTopBar';
import { DriveExplorer } from '../components/media-drive/DriveExplorer';
import { DrivePreviewModal } from '../components/media-drive/DrivePreviewModal';
import { DriveContextMenu } from '../components/media-drive/DriveContextMenu';
import { DriveTransferManager } from '../components/media-drive/DriveTransferManager';
import { DriveTransferSettings as TransferSettingsModal } from '../components/media-drive/DriveTransferSettings';
import {
  DriveConfirmDialog,
  type DriveConfirmState,
} from '../components/media-drive/DriveConfirmDialog';
import {
  DriveInputDialog,
  type DriveInputState,
} from '../components/media-drive/DriveInputDialog';
import {
  DriveDestinationPicker,
  type DriveDestChoice,
  type DriveDestPickerState,
} from '../components/media-drive/DriveDestinationPicker';
import type { JobChild } from '../lib/jobProcess';
import {
  clearDriveSessionEphemeralCaches,
  isDrivePinned,
  loadDrivePeer,
  loadDrivePins,
  loadDriveRecents,
  pushDriveRecent,
  saveDrivePeer,
  shouldRecordDriveRecent,
  toggleDrivePin,
  type DriveRecent,
} from '../lib/driveRecents';

const LS_VIEW = 'autogram_drive_view';
const LS_COLLAPSE = 'autogram_drive_rail';
const LS_SORT = 'autogram_drive_sort';
const LS_THUMB_Q = 'autogram_drive_thumb_q';
const LS_GRID_ZOOM = 'autogram_drive_grid_zoom';
const LS_TM_MIN = 'autogram_transfer_minimized';
/** Last used Telegram session — restore instantly so drive boot need not wait list-sessions */
const LS_SESSION = 'autogram_drive_session';
/** Cached picker names for first paint of session <select> */
const LS_SESSIONS_CACHE = 'autogram_drive_sessions_cache';
function readSessionsCache(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SESSIONS_CACHE) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(String).filter(Boolean);
  } catch {
    return [];
  }
}

function writeSessionsCache(list: string[]) {
  try {
    localStorage.setItem(LS_SESSIONS_CACHE, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

async function writeWorkerJson(name: string, data: any): Promise<string> {
  // P0: no python -c — write via Rust path jail under worker/temp
  return writeWorkerTempJson(name, data);
}

type LocationKind = 'saved' | 'drive' | 'chat';

type SpeedTestProps = {
  onExitToApp?: () => void;
};

export function SpeedTest({ onExitToApp }: SpeedTestProps = {}) {
  if (!canUseLocalTelegramWorker()) {
    return (
      <main className="main-content page-stack">
        <header className="page-header">
          <h2 className="title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HardDrive size={26} color="var(--primary)" />
            Media Studio / Drive
          </h2>
          <p className="subtitle">Desktop application only</p>
        </header>
        <div className="card" role="status" style={{ padding: 20, maxWidth: 560 }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Drive (upload, re-encode, thumbnail, Telethon) berjalan di{' '}
            <strong>aplikasi desktop AutoGram</strong>.
          </p>
          {onExitToApp && (
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={onExitToApp}>
              Kembali ke AutoGram
            </button>
          )}
        </div>
      </main>
    );
  }
  return <MediaDriveDesktop onExitToApp={onExitToApp} />;
}

function MediaDriveDesktop({ onExitToApp }: SpeedTestProps) {
  // Instant restore from cache — avoids waiting list-sessions before first paint boot
  const [sessions, setSessions] = useState<string[]>(() => readSessionsCache());
  const [session, setSession] = useState(() => {
    try {
      return localStorage.getItem(LS_SESSION) || '';
    } catch {
      return '';
    }
  });
  // Peer is ALWAYS session-scoped — never restore another account's channel id.
  const initial = (() => {
    try {
      const sess = localStorage.getItem(LS_SESSION) || '';
      return loadDrivePeer(sess);
    } catch {
      return { kind: 'saved' as LocationKind, id: null };
    }
  })();
  // Paint the persisted location before secure credentials/Telethon are ready.
  // Network refresh remains authoritative and replaces this snapshot later.
  const [initialLocationCache] = useState(() => {
    if (!session) return null;
    try {
      return loadDriveLocationSnapshot(localStorage, session, initial.id, null);
    } catch {
      return null;
    }
  });
  const [initialSidebarCache] = useState(() => {
    if (!session) return null;
    try {
      return loadDriveSidebarSnapshot(localStorage, session);
    } catch {
      return null;
    }
  });
  const [folders, setFolders] = useState<DriveFolder[]>(() => initialSidebarCache?.folders ?? []);
  const [chats, setChats] = useState<DriveChat[]>(() => initialSidebarCache?.chats ?? []);
  const [chatFolders, setChatFolders] = useState<DriveChatFolder[]>([
    { id: 0, title: 'Semua Chat', kind: 'all' },
  ]);
  const [activeChatFolderId, setActiveChatFolderId] = useState(() => {
    try {
      return Number(localStorage.getItem(`autogram_chat_folder_${session}`) || 0) || 0;
    } catch {
      return 0;
    }
  });
  // Async bootstrap/list requests must not overwrite a folder selected while
  // the request was still running. Keep the latest value available without
  // waiting for React to commit the state update.
  const activeChatFolderIdRef = useRef(activeChatFolderId);
  const chatFolderRequestRef = useRef(0);
  const chatFolderSnapshotsRef = useRef<
    Map<number, { chats: DriveChat[]; hasMore: boolean; offset: number; cursor: ChatListCursor | null }>
  >(new Map());
  const [chatsHasMore, setChatsHasMore] = useState(() => initialSidebarCache?.chatsHasMore ?? false);
  /** Telethon dialog cursor — O(1) next page (not skip-N) */
  const chatsCursorRef = useRef<ChatListCursor | null>(initialSidebarCache?.cursor ?? null);

  // Cache files and total counts for faster navigation
  const filesCacheRef = useRef<Map<string, DriveFile[]>>(
    new Map(initialLocationCache ? [[`${initial.id}_`, initialLocationCache.files]] : [])
  );
  const filesTotalCountRef = useRef<Map<string, number>>(
    new Map(
      initialLocationCache?.totalCount != null
        ? [[`${initial.id}_`, initialLocationCache.totalCount]]
        : []
    )
  );
  const filesTotalBytesRef = useRef<Map<string, number>>(
    new Map(
      initialLocationCache?.totalBytes != null
        ? [[`${initial.id}_`, initialLocationCache.totalBytes]]
        : []
    )
  );
  /** In-flight media_stats per cache key — avoid duplicate walks */
  const mediaStatsLockRef = useRef<Set<string>>(new Set());
  /** Defer media_stats so list_topics / first list_files win the Telethon pipe */
  const mediaStatsTimerRef = useRef<number | null>(null);
  /** Forum topics cache — re-open group / switch filter stays snappy */
  const topicsCacheRef = useRef<
    Map<number, { topics: DriveTopic[]; is_forum: boolean; ts: number }>
  >(new Map());
  const topicsInFlightRef = useRef<Map<number, Promise<any>>>(new Map());

  const chatBulkLock = useRef(false);
  /** Declared early — handleSessionChange clears these before paint. */
  const lastBootSessionRef = useRef<string | null>(null);
  const pendingRestorePeerRef = useRef<{ kind: LocationKind; id: number | null } | null>(null);
  const lastRecentKeyRef = useRef('');
  const [chatsOffset, setChatsOffset] = useState(() => initialSidebarCache?.chatsOffset ?? 0);
  const [chatsLoadingMore, setChatsLoadingMore] = useState(false);
  const [locationKind, setLocationKind] = useState<LocationKind>(initial.kind);
  const [activePeerId, setActivePeerId] = useState<number | null>(initial.id);
  const [files, setFiles] = useState<DriveFile[]>(() => initialLocationCache?.files ?? []);
  const [filesHasMore, setFilesHasMore] = useState(() => initialLocationCache?.hasMore ?? false);
  /** Accurate totals for the whole location (not just loaded page) */
  const [totalFileCount, setTotalFileCount] = useState<number | null>(
    () => clampMediaTotal(initialLocationCache?.totalCount, initialLocationCache?.files ?? [])
  );
  const [totalBytes, setTotalBytes] = useState<number | null>(
    () => clampMediaBytes(initialLocationCache?.totalBytes, initialLocationCache?.files ?? [])
  );
  /** True when media_stats finished unique walk (not estimate) */
  const [statsAccurate, setStatsAccurate] = useState(false);
  /** Per-type breakdown from accurate media_stats (location-wide) */
  const [statsByType, setStatsByType] = useState<
    { type: string; count: number; bytes: number }[] | null
  >(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [nextOffsetId, setNextOffsetId] = useState<number | null>(
    () => initialLocationCache?.nextOffsetId ?? null
  );
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMoreFiles, setLoadingMoreFiles] = useState(false);
  const [progressiveReady, setProgressiveReady] = useState(false);
  /** Forum topics for active group — null filter = Semua media */
  const [topics, setTopics] = useState<DriveTopic[]>([]);
  const [topicFilter, setTopicFilter] = useState<DriveTopicFilter>(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [isForumChat, setIsForumChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Ready');
  const [scaleHint, setScaleHint] = useState<string | null>(null);
  const [recents, setRecents] = useState<DriveRecent[]>(() =>
    session ? loadDriveRecents(session) : []
  );
  const [pins, setPins] = useState<DriveRecent[]>(() =>
    session ? loadDrivePins(session) : []
  );
  const [advFilter, setAdvFilter] = useState<DriveAdvFilter>({ ...EMPTY_ADV_FILTER });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<DriveToolsTab>('copy');
  const [navHist, setNavHist] = useState<DriveNavHistory>(() =>
    createNavHistory({ kind: initial.kind, id: initial.id })
  );
  const navSkipRef = useRef(false);
  const [lastDownloadDir, setLastDownloadDir] = useState<string | null>(null);
  const lastDownloadRetryRef = useRef<{
    ids: number[];
    saveDir: string;
    names: string[];
  } | null>(null);
  /** Filled after requestMoveToTarget is defined — used by Ctrl+V keyboard */
  const pasteMoveRef = useRef<
    (clip: {
      mode: 'copy' | 'cut';
      messageIds: number[];
      fromFolderId: number | null;
    }) => void
  >(() => {});
  /** Filled after moveMessageIds is defined — smart copy / batch */
  const runMoveCopyRef = useRef<
    (
      messageIds: number[],
      fromFolderId: number | null,
      toFolderId: number | null,
      targetLabel: string,
      opts?: { deleteSource?: boolean; topicId?: number | null }
    ) => void
  >(() => {});
  const peerGen = useRef(0);
  const loadMoreLock = useRef(false);
  const topicFilterRef = useRef<DriveTopicFilter>(null);
  const liveFilesRef = useRef(files);
  const liveSyncLockRef = useRef(false);
  const liveSyncLastAtRef = useRef<Map<string, number>>(new Map());
  const liveSyncFailuresRef = useRef(0);
  const liveSyncBackoffUntilRef = useRef(0);

  useEffect(() => {
    liveFilesRef.current = files;
  }, [files]);

  useEffect(() => {
    activeChatFolderIdRef.current = activeChatFolderId;
  }, [activeChatFolderId]);

  const [viewMode, setViewMode] = useState<DriveViewMode>(
    () => (localStorage.getItem(LS_VIEW) as DriveViewMode) || 'grid'
  );
  const explorerScrollKey = useMemo(
    () => driveScrollLocationKey(locationKind, activePeerId, topicFilter, viewMode),
    [locationKind, activePeerId, topicFilter, viewMode]
  );
  const explorerInitialScrollTop = useMemo(() => {
    if (!session) return 0;
    try {
      return loadDriveScrollPosition(localStorage, session, explorerScrollKey);
    } catch {
      return 0;
    }
  }, [session, explorerScrollKey]);
  const rememberExplorerScroll = useCallback(
    (key: string, top: number) => {
      if (!session) return;
      saveDriveScrollPosition(localStorage, session, key, top);
    },
    [session]
  );
  const [gridZoom, setGridZoom] = useState<DriveGridZoom>(() => {
    try {
      const raw = localStorage.getItem(LS_GRID_ZOOM);
      if (raw != null && isDriveGridZoom(Number(raw))) return Number(raw) as DriveGridZoom;
    } catch {
      /* ignore */
    }
    // Low-end: fewer columns = fewer thumbs competing for RAM/CPU
    return clampGridZoom(getDrivePerfProfile().defaultGridZoom) as DriveGridZoom;
  });
  const [query, setQuery] = useState('');
  const [chatQuery, setChatQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<DriveMediaFilter>('all');
  const [sortMode, setSortMode] = useState<DriveSortMode>(() => {
    try {
      const raw = localStorage.getItem(LS_SORT);
      if (isDriveSortMode(raw)) return raw;
    } catch {
      /* ignore */
    }
    return DEFAULT_DRIVE_SORT;
  });
  const [thumbQuality, setThumbQualityState] = useState<DriveThumbQuality>(() => {
    try {
      const raw = localStorage.getItem(LS_THUMB_Q);
      if (isDriveThumbQuality(raw)) return raw;
    } catch {
      /* ignore */
    }
    // Auto "Hemat" on low-end / mid when user never chose
    return getDrivePerfProfile().defaultThumbQuality;
  });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  /** Anchor for Shift-range — always interpreted on displayed (filter+sort) order */
  const selectionAnchorRef = useRef<number | null>(null);
  /** Latest displayed id order from explorer (filter + sort) */
  const displayedIdsRef = useRef<number[]>([]);

  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'file'; x: number; y: number; file: DriveFile }
    | { kind: 'canvas'; x: number; y: number }
    | {
        kind: 'location';
        x: number;
        y: number;
        locationKind: 'saved' | 'drive' | 'chat';
        id: number | null;
        name: string;
      }
    | null
  >(null);

  const [transferSettings, setTransferSettings] = useState<TransferSettingsState>(() =>
    loadTransferSettings()
  );
  const [transferSettingsOpen, setTransferSettingsOpen] = useState(false);
  const [transfer, setTransfer] = useState<TransferSession>(() => ({ ...EMPTY_TRANSFER_SESSION }));
  const [transferMinimized, setTransferMinimized] = useState(
    () => localStorage.getItem(LS_TM_MIN) === '1'
  );
  const childRef = useRef<JobChild | null>(null);
  const transferHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Local paths of in-progress downloads (for Stop cleanup). */
  const downloadArtifactsRef = useRef<Set<string>>(new Set());
  /** Local confirm (delete/download) + external store for DnD move */
  const [confirmDlg, setConfirmDlg] = useState<DriveConfirmState | null>(null);
  // Version primitive forces re-render; then read latest state from store
  const moveConfirmVersion = useSyncExternalStore(
    subscribeDriveMoveConfirmStore,
    getDriveMoveConfirmVersion,
    () => 0
  );
  const moveConfirmFromStore =
    moveConfirmVersion > 0 ? getDriveMoveConfirmSnapshot() : null;
  // Prefer store (DnD) when set; else local dialogs
  const activeConfirm = moveConfirmFromStore ?? confirmDlg;
  useEffect(() => {
    try {
      (window as unknown as { __confirmDlgKind?: string | null }).__confirmDlgKind =
        activeConfirm?.kind ?? null;
      (window as unknown as { __confirmDlgDetail?: string | null }).__confirmDlgDetail =
        activeConfirm?.detail ?? null;
      (window as unknown as { __moveConfirmVer?: number }).__moveConfirmVer = moveConfirmVersion;
    } catch {
      /* ignore */
    }
  }, [activeConfirm, moveConfirmVersion]);
  const [inputDlg, setInputDlg] = useState<DriveInputState | null>(null);
  const [destPicker, setDestPicker] = useState<DriveDestPickerState | null>(null);

  // Default expanded; only collapse if user previously chose so
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_COLLAPSE) === '1');
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Mobile drawer: always open at full panel width (never icon-rail 72px). */
  const openDrawer = useCallback(() => {
    setCollapsed(false);
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const [dragActive, setDragActive] = useState(false);
  /** Dragging media from grid/list toward sidebar locations */
  const [mediaDragActive, setMediaDragActive] = useState(false);
  /** Warm drive-serve connected (not just credentials filled) */
  const [driveReady, setDriveReady] = useState(false);

  // Prefer sync cache (App already bootstraps credentials) — no blank wait for invoke
  const [apiCreds, setApiCreds] = useState(() => ({
    apiId: getApiIdSync(),
    apiHash: getApiHashSync(),
  }));
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const creds: DriveCredentials | null = useMemo(() => {
    const id = apiCreds.apiId;
    const hash = apiCreds.apiHash;
    if (!session || !id || !hash) return null;
    return { session, apiId: id, apiHash: hash };
  }, [session, apiCreds.apiId, apiCreds.apiHash]);

  // Persist last session so next open can boot immediately
  useEffect(() => {
    if (!session) return;
    try {
      localStorage.setItem(LS_SESSION, session);
    } catch {
      /* ignore */
    }
  }, [session]);

  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    void driveListChatFolders(creds)
      .then((res) => {
        if (cancelled) return;
        const incoming = (res?.folders || []) as DriveChatFolder[];
        const list = incoming.length
          ? incoming
          : [{ id: 0, title: 'Semua Chat', kind: 'all' as const }];
        setChatFolders(list);
        if (!list.some((folder) => folder.id === activeChatFolderIdRef.current)) {
          activeChatFolderIdRef.current = 0;
          setActiveChatFolderId(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChatFolders([{ id: 0, title: 'Semua Chat', kind: 'all' }]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [creds]);

  const breadcrumbSegs = useMemo((): DriveCrumbSeg[] => {
    const topicTitle =
      isForumChat && topicFilter != null
        ? topics.find((x) => x.id === topicFilter)?.title || null
        : null;
    return buildDriveBreadcrumbSegments(folders, {
      locationKind,
      activePeerId,
      chats,
      topicTitle,
    });
  }, [locationKind, activePeerId, folders, chats, isForumChat, topicFilter, topics]);

  const breadcrumb = useMemo(() => {
    if (breadcrumbSegs.length <= 1) return 'Saved Messages';
    return breadcrumbSegs
      .slice(1)
      .map((s) => s.label)
      .join(' / ');
  }, [breadcrumbSegs]);

  const channelLimitWarning = useMemo(() => {
    if (folders.length >= DRIVE_FOLDER_SOFT_LIMIT) {
      return `Sudah ${folders.length} Drive/Folder [TD] — mendekati batas channel Telegram (~500). Prefer pindah hierarki daripada buat baru.`;
    }
    return null;
  }, [folders.length]);

  const peerId = locationKind === 'saved' ? null : activePeerId;
  const activePeerRef = useRef<number | null>(peerId);
  activePeerRef.current = peerId;
  const topicsRequestSeqRef = useRef(0);

  // Own every thumbnail request by session + location + topic. This cancels
  // queued work from the previous view before newly-visible cards mount.
  useEffect(() => {
    setThumbContext(creds, peerId, topicFilter);
  }, [creds, peerId, topicFilter]);

  useEffect(() => {
    topicFilterRef.current = topicFilter;
  }, [topicFilter]);

  useEffect(() => {
    localStorage.setItem(LS_VIEW, viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem(LS_GRID_ZOOM, String(gridZoom));
  }, [gridZoom]);

  const handleGridZoom = (z: DriveGridZoom) => {
    setGridZoom(clampGridZoom(z));
  };

  useEffect(() => {
    localStorage.setItem(LS_SORT, sortMode);
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem(LS_THUMB_Q, thumbQuality);
    setThumbQuality(thumbQuality);
  }, [thumbQuality]);

  // Sync batcher quality on first mount
  useEffect(() => {
    setThumbQuality(thumbQuality);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_COLLAPSE, collapsed ? '1' : '0');
  }, [collapsed]);

  const handleThumbQuality = (q: DriveThumbQuality) => {
    if (q === thumbQuality) return;
    setThumbQualityState(q);
    setThumbQuality(q); // clears mem cache + soft-fails
    clearThumbCache();
    invalidateThumbFailures();
    // Force cards to re-request (quality key changes disk path on worker)
    setStatusText(
      q === 'saver'
        ? 'Thumb: Hemat data — memuat ulang…'
        : q === 'sharp'
          ? 'Thumb: Jelas lean — tajam dari layer Telegram (hemat data)…'
          : 'Thumb: Seimbang — memuat ulang…'
    );
  };

  // Never persist peer under a session that just changed while location still
  // holds the previous account's PeerChannel id (fatal cross-session poison).
  const peerPersistSessionRef = useRef(session);
  useEffect(() => {
    if (!session) return;
    if (peerPersistSessionRef.current !== session) {
      peerPersistSessionRef.current = session;
      return;
    }
    saveDrivePeer(session, {
      kind: locationKind,
      id: locationKind === 'saved' ? null : activePeerId,
    });
  }, [session, locationKind, activePeerId]);

  /**
   * Invalidate every in-flight Drive RPC (refreshLocations / refreshFiles /
   * media_stats / liveSync). Must run synchronously on session switch so
   * old-session responses cannot re-apply setFiles/setChats after UI clear.
   */
  const invalidateDriveGenerations = useCallback(() => {
    peerGen.current += 1;
  }, []);

  /** PeerChannel / missing entity → Saved Messages + wipe stored peer for this session. */
  const recoverInvalidPeerLocation = useCallback(
    (e: unknown, opts?: { gen?: number }) => {
      if (opts?.gen != null && opts.gen !== peerGen.current) return false;
      if (!isPeerEntityError(e)) return false;
      if (session) {
        saveDrivePeer(session, { kind: 'saved', id: null });
      }
      setLocationKind('saved');
      setActivePeerId(null);
      setTopicFilter(null);
      setError(friendlyDriveError(e));
      setStatusText('Lokasi tidak valid di session ini');
      setFiles([]);
      setFilesHasMore(false);
      setNextOffsetId(null);
      return true;
    },
    [session]
  );

  /** Sync session switch — clear UI before paint so Terbaru/location never bleed. */
  const handleSessionChange = useCallback((nextSession: string) => {
    const next = String(nextSession || '').trim();
    if (!next || next === session) return;

    // Kill in-flight work for the previous account immediately.
    invalidateDriveGenerations();

    // Block peer persist for the transition render (old location × new session).
    peerPersistSessionRef.current = '';
    lastBootSessionRef.current = null; // force boot effect to treat as switch
    pendingRestorePeerRef.current = loadDrivePeer(next);
    lastRecentKeyRef.current = '';

    setError(null);
    setChats([]);
    setChatsHasMore(false);
    setChatsOffset(0);
    chatsCursorRef.current = null;
    setFolders([]);
    setFiles([]);
    setFilesHasMore(false);
    setNextOffsetId(null);
    setTotalFileCount(null);
    setTotalBytes(null);
    setStatsAccurate(false);
    setStatsByType(null);
    setTopics([]);
    setTopicFilter(null);
    setIsForumChat(false);
    setSelectedIds([]);
    selectionAnchorRef.current = null;
    setChatFolders([{ id: 0, title: 'Semua Chat', kind: 'all' }]);
    setActiveChatFolderId(0);
    filesCacheRef.current.clear();
    filesTotalCountRef.current.clear();
    filesTotalBytesRef.current.clear();
    chatFolderSnapshotsRef.current.clear();
    try {
      clearAvatarCache();
    } catch {
      /* ignore */
    }
    clearDriveSessionEphemeralCaches(next);

    // Always open Saved Messages until this session proves a peer is valid.
    setLocationKind('saved');
    setActivePeerId(null);
    setRecents(loadDriveRecents(next));
    setPins(loadDrivePins(next));
    try {
      setActiveChatFolderId(
        Number(localStorage.getItem(`autogram_chat_folder_${next}`) || 0) || 0
      );
    } catch {
      setActiveChatFolderId(0);
    }

    // Paint this session's sidebar/root cache only (never previous account).
    try {
      const sidebar = loadDriveSidebarSnapshot(localStorage, next);
      if (sidebar) {
        setFolders(sidebar.folders);
        setChats(sidebar.chats);
        setChatsHasMore(sidebar.chatsHasMore);
        setChatsOffset(sidebar.chatsOffset);
        chatsCursorRef.current = sidebar.cursor;
      }
      const location = loadDriveLocationSnapshot(localStorage, next, null, null);
      if (location) {
        filesCacheRef.current.set('null_', location.files);
        setFiles(location.files);
        setFilesHasMore(location.hasMore);
        setNextOffsetId(location.nextOffsetId);
        if (location.totalCount != null) setTotalFileCount(location.totalCount);
        if (location.totalBytes != null) setTotalBytes(location.totalBytes);
      }
    } catch {
      /* ignore */
    }

    setStatusText('Mengganti session…');
    setDriveReady(false);
    setSession(next);
  }, [session, invalidateDriveGenerations]);

  const sortedPreviewList = useMemo(() => {
    // Same filter + sort as explorer so next/prev matches visible order
    return filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter,
    });
  }, [files, query, mediaFilter, sortMode, advFilter]);

  const previewIndex = previewFile ? sortedPreviewList.findIndex((f) => f.id === previewFile.id) : -1;

  // If App bootstrap still running, fill creds ASAP so drive boot can start
  useEffect(() => {
    if (apiCreds.apiId && apiCreds.apiHash) return;
    let cancelled = false;
    void bootstrapSecureCredentials().then((c) => {
      if (!cancelled && (c.apiId || c.apiHash)) {
        setApiCreds({ apiId: c.apiId, apiHash: c.apiHash });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apiCreds.apiId, apiCreds.apiHash]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      // Parallel: creds refresh + offline session list (do not serialize)
      const [c, list] = await Promise.all([
        bootstrapSecureCredentials(),
        loadSelectableSessionNames(),
      ]);
      setApiCreds({ apiId: c.apiId, apiHash: c.apiHash });
      writeSessionsCache(list);
      setSessions(list);
      // Resolve next session name without writing state yet
      let next = '';
      if (session && list.includes(session)) {
        next = session;
      } else {
        try {
          const last = localStorage.getItem(LS_SESSION) || '';
          if (last && list.includes(last)) next = last;
        } catch {
          /* ignore */
        }
        if (!next) next = list[0] || '';
      }
      // MUST go through handleSessionChange when identity changes — raw
      // setSession leaves A's peer/location and poisons B's Terbaru.
      if (next && next !== session) {
        handleSessionChange(next);
      } else if (!session && next) {
        setSession(next);
      }
      if (!c.apiId || !c.apiHash) {
        setError(
          'API ID/Hash belum terisi. Buka Settings → simpan credentials (atau pastikan worker/.env ada), lalu refresh.'
        );
      }
    } catch (e: any) {
      setError(`Sessions: ${e?.message || e}`);
    } finally {
      setSessionsLoading(false);
    }
  }, [session, handleSessionChange]);

  // Ensure <select> always includes active session while list is still loading
  const sessionsForSelect = useMemo(() => {
    if (session && !sessions.includes(session)) return [session, ...sessions];
    return sessions;
  }, [session, sessions]);

  const loadTopicsForPeer = useCallback(
    async (chatId: number | null, chatMeta?: DriveChat | null) => {
      const requestSeq = ++topicsRequestSeqRef.current;
      const isCurrent = () =>
        requestSeq === topicsRequestSeqRef.current && activePeerRef.current === chatId;
      if (!isCurrent()) return;
      if (!creds || chatId == null) {
        setTopics([]);
        setIsForumChat(false);
        setTopicFilter(null);
        topicFilterRef.current = null;
        return;
      }
      const meta = chatMeta ?? chats.find((c) => c.id === chatId) ?? null;
      const now = Date.now();
      let cached = topicsCacheRef.current.get(chatId);
      if (!cached) {
        try {
          const persisted = loadDriveTopicsSnapshot(localStorage, creds.session, chatId, now);
          if (persisted) {
            cached = {
              topics: persisted.topics,
              is_forum: persisted.is_forum,
              ts: persisted.savedAt,
            };
            topicsCacheRef.current.set(chatId, cached);
          }
        } catch {
          /* persistent topic cache is best-effort */
        }
      }
      // Only skip when we KNOW it is not a forum (never skip unknown — many [TD]
      // megagroups are forums and used as Drive folders).
      if (meta && meta.is_forum === false && !cached?.is_forum) {
        setTopics([]);
        setIsForumChat(false);
        setTopicFilter(null);
        topicFilterRef.current = null;
        return;
      }
      // Render a recent memory/persistent snapshot immediately, then revalidate.
      if (cached && now - cached.ts < 5 * 60_000) {
        if (!isCurrent()) return;
        setTopics(cached.topics);
        setIsForumChat(cached.is_forum);
        if (!cached.is_forum) {
          setTopicFilter(null);
          topicFilterRef.current = null;
        }
        // Only a just-fetched result may suppress duplicate boot-effect requests.
        if (now - cached.ts < 15_000) {
          setTopicsLoading(false);
          return;
        }
      }
      // Show bar immediately while RPC runs
      if (meta?.is_forum === true || (cached?.is_forum && (cached.topics?.length ?? 0) > 0)) {
        setIsForumChat(true);
      }
      setTopicsLoading(true);
      try {
        let request = topicsInFlightRef.current.get(chatId);
        if (!request) {
          request = driveListTopics(creds, chatId).finally(() => {
            if (topicsInFlightRef.current.get(chatId) === request) {
              topicsInFlightRef.current.delete(chatId);
            }
          });
          topicsInFlightRef.current.set(chatId, request);
        }
        const res = await request;
        const list: DriveTopic[] = res.topics || [];
        const forum = !!res.is_forum || list.length > 0 || meta?.is_forum === true;
        const savedAt = Date.now();
        topicsCacheRef.current.set(chatId, { topics: list, is_forum: forum, ts: savedAt });
        try {
          saveDriveTopicsSnapshot(localStorage, creds.session, chatId, list, forum, savedAt);
        } catch {
          /* persistent topic cache is best-effort */
        }
        if (!isCurrent()) return;
        setTopics(list);
        setIsForumChat(forum);
        if (!forum) {
          setTopicFilter(null);
          topicFilterRef.current = null;
        }
      } catch {
        if (isCurrent() && !cached) {
          setTopics([]);
          setIsForumChat(meta?.is_forum === true);
        }
      } finally {
        if (isCurrent()) setTopicsLoading(false);
      }
    },
    [creds, chats]
  );

  /**
   * Accurate location totals (count + bytes) independent of pagination.
   * Starts right after first page (does not wait for scroll). Grid stays fast
   * because only metadata is walked; progressive peek polls update the pill.
   */
  const refreshMediaStats = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!creds) return;
      const tid = topicFilterRef.current;
      const cacheKey = `${peerId}_${tid || ''}`;
      // Never start a second concurrent walk for the same location
      if (mediaStatsLockRef.current.has(cacheKey)) return;
      mediaStatsLockRef.current.add(cacheKey);
      setStatsLoading(true);
      if (opts?.force !== false) setStatsAccurate(false);
      const gen = peerGen.current;

      const applyRes = (res: any, _mode: 'progress' | 'final') => {
        if (gen !== peerGen.current) return;
        // Ignore stats that don't match the active topic scope (all ↔ topic)
        const activeTid =
          topicFilterRef.current != null && Number(topicFilterRef.current) > 0
            ? Number(topicFilterRef.current)
            : null;
        const resTid =
          res?.topic_id != null && Number(res.topic_id) > 0
            ? Number(res.topic_id)
            : null;
        if (activeTid !== resTid) return;
        const isFinal =
          res?.accurate === true && res?.incomplete === false && !res?.estimate;
        if (res?.total_count != null) {
          const n = Number(res.total_count);
          if (Number.isFinite(n) && n >= 0) {
            setTotalFileCount((prev) => {
              // Final unique is authoritative. Progress may raise lower bound only
              // when not marked pure estimate-without-sizes.
              const loaded = loadedUniqueMediaCount(liveFilesRef.current);
              let next = Math.max(n, loaded);
              if (!isFinal) {
                if (res?.estimate && res?.total_bytes == null) {
                  // Counter lower-bound only — don't overwrite a better unique partial
                  next = prev != null ? Math.max(prev, n, loaded) : Math.max(n, loaded);
                } else {
                  next = prev != null ? Math.max(prev, n, loaded) : Math.max(n, loaded);
                }
              }
              filesTotalCountRef.current.set(cacheKey, next);
              return next;
            });
          }
        }
        if (res?.total_bytes != null) {
          const b = Number(res.total_bytes);
          if (Number.isFinite(b) && b >= 0) {
            setTotalBytes((prev) => {
              const loaded = loadedMediaBytes(liveFilesRef.current);
              const next = isFinal
                ? Math.max(b, loaded)
                : prev != null
                  ? Math.max(prev, b, loaded)
                  : Math.max(b, loaded);
              filesTotalBytesRef.current.set(cacheKey, next);
              return next;
            });
          }
        }
        if (Array.isArray(res?.by_type) && res.by_type.length) {
          const rows = res.by_type
            .map((r: any) => ({
              type: String(r.type || 'file'),
              count: Number(r.count) || 0,
              bytes: Number(r.bytes) || 0,
            }))
            .filter((r: { count: number }) => r.count > 0);
          if (rows.length) setStatsByType(rows);
        }
        if (isFinal) setStatsAccurate(true);
        else if (res?.estimate || res?.incomplete) setStatsAccurate(false);
      };

      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let firstPoll: number | undefined;
      let pollInFlight = false;
      try {
        const walkPromise = driveMediaStats(creds, peerId, {
          topicId: tid,
          force: opts?.force !== false,
        });

        const poll = async () => {
          if (gen !== peerGen.current || pollInFlight) return;
          pollInFlight = true;
          try {
            const snap = await driveMediaStats(creds, peerId, {
              topicId: tid,
              peek: true,
            });
            if (snap?.pending) return;
            if (snap?.total_count != null || snap?.total_bytes != null) {
              applyRes(snap, snap?.incomplete === false ? 'final' : 'progress');
            }
          } catch {
            /* ignore peek errors */
          } finally {
            pollInFlight = false;
          }
        };
        firstPoll = window.setTimeout(() => {
          void poll();
        }, 350);
        pollTimer = setInterval(() => {
          void poll();
        }, 1200);

        const res = await walkPromise;
        if (firstPoll != null) window.clearTimeout(firstPoll);
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (gen !== peerGen.current) return;
        applyRes(res, 'final');
      } catch {
        /* keep previous / loaded-only hint */
      } finally {
        if (firstPoll != null) window.clearTimeout(firstPoll);
        if (pollTimer) clearInterval(pollTimer);
        mediaStatsLockRef.current.delete(cacheKey);
        if (gen === peerGen.current) setStatsLoading(false);
      }
    },
    [creds, peerId]
  );

  /** Defer media_stats so list_topics + first list_files win the Telethon pipe.
   *  Low-end: delayed full walk (still runs — storage accuracy needs it).
   *  urgent: Storage tab / user needs totals now. */
  const scheduleMediaStats = useCallback(
    (opts?: { force?: boolean; delayMs?: number; urgent?: boolean }) => {
      if (mediaStatsTimerRef.current != null) {
        window.clearTimeout(mediaStatsTimerRef.current);
        mediaStatsTimerRef.current = null;
      }
      const perf = getDrivePerfProfile();
      // Always eventually compute accurate unique totals for the location.
      // Low-end waits longer so boot/thumbs stay smooth.
      let delay = opts?.delayMs ?? perf.statsDelayMs;
      if (!perf.fullMediaStats && !opts?.urgent) {
        delay = Math.max(delay, 8000);
      }
      // Give small/medium locations time to exhaust metadata pagination first;
      // that path is exact and much cheaper than six history-wide filter walks.
      if (!opts?.urgent) {
        const metadataGraceMs = perf.tier === 'high' ? 5_000 : perf.tier === 'mid' ? 8_000 : 12_000;
        delay = Math.max(delay, metadataGraceMs);
      }
      if (opts?.urgent) delay = Math.min(delay, 400);
      mediaStatsTimerRef.current = window.setTimeout(() => {
        mediaStatsTimerRef.current = null;
        void refreshMediaStats({ force: opts?.force !== false });
      }, delay);
    },
    [refreshMediaStats]
  );

  // Storage tab needs accurate location size — force unique walk immediately
  useEffect(() => {
    if (!toolsOpen || toolsTab !== 'space' || !creds) return;
    if (statsAccurate && totalBytes != null) return;
    scheduleMediaStats({ force: true, delayMs: 200, urgent: true });
  }, [toolsOpen, toolsTab, creds, peerId, scheduleMediaStats, statsAccurate, totalBytes]);

  const refreshLocations = useCallback(async () => {
    if (!creds) return;
    // Staged load: paint chats/folders/files as each RPC finishes (never wait for all).
    // Warm session uses 3 parallel cmds; one-shot falls back to bootstrap.
    invalidateAvatarFailures();
    setLoadingFolders(true);
    setLoadingChats(true);
    setLoadingFiles(true);
    setStatsAccurate(false);
    setStatsByType(null);
    setError(null);
    const gen = ++peerGen.current;
    const tid = topicFilterRef.current;
    const bootKey = `${peerId}_${tid || ''}`;
    setSelectedIds([]);
    selectionAnchorRef.current = null;
    let nChats = 0;
    let nFolders = 0;
    let nFiles = 0;
    let filesHasMoreLocal = false;
    let knownTotal: number | null = null;
    let knownTotalAccurate = false;

    // Topic controls are independent from the potentially huge media listing.
    // Start their priority RPC immediately instead of waiting for files/chats.
    if (peerId != null) {
      const meta = chats.find((c) => c.id === peerId) ?? null;
      void loadTopicsForPeer(peerId, meta);
    }

    const bumpStatus = () => {
      if (gen !== peerGen.current) return;
      setStatusText(
        `${nFolders} TD · ${nChats} chats · ${
          knownTotal != null
            ? filesHasMoreLocal
              ? `${nFiles} / ${knownTotal}${knownTotalAccurate ? '' : '+'}`
              : String(knownTotal)
            : `${nFiles}${filesHasMoreLocal ? '+' : ''}`
        } files`
      );
    };

    try {
      setStatusText('Memuat Drive…');

      // Prefer staged RPCs when warm session is ready (true progressive UI).
      // The first file page gets exclusive network priority; secondary panels
      // start only after it paints so a large dialog/topic list cannot starve it.
      if (isDriveSessionReady()) {
        if (peerId == null) {
          setTopics([]);
          setIsForumChat(false);
        }

        const applyFiles = (res: any) => {
          if (gen !== peerGen.current) return;
          const page: DriveFile[] = res.files || [];
          nFiles = page.length;
          filesHasMoreLocal = !!res.has_more;
          filesCacheRef.current.set(bootKey, page);
          liveSyncLastAtRef.current.set(bootKey, Date.now());
          liveSyncFailuresRef.current = 0;
          liveSyncBackoffUntilRef.current = 0;
          if (res.total_count != null) {
            const n = Number(res.total_count);
            if (Number.isFinite(n)) {
              knownTotal = clampMediaTotal(n, page);
              knownTotalAccurate = res.stats_accurate === true;
              if (knownTotal != null) {
                filesTotalCountRef.current.set(bootKey, knownTotal);
                setTotalFileCount(knownTotal);
              }
            }
          }
          if (res.total_bytes != null) {
            const b = clampMediaBytes(res.total_bytes, page);
            if (b != null) {
              filesTotalBytesRef.current.set(bootKey, b);
              setTotalBytes(b);
            }
          }
          startTransition(() => {
            setFiles(page);
            setFilesHasMore(!!res.has_more);
            setNextOffsetId(res.next_offset_id ?? null);
          });
          try {
            saveDriveLocationSnapshot(localStorage, creds.session, peerId, tid, {
              files: page,
              hasMore: !!res.has_more,
              nextOffsetId: res.next_offset_id ?? null,
              totalCount: knownTotal,
              totalBytes: res.total_bytes != null ? Number(res.total_bytes) : null,
            });
          } catch {
            /* cache is best-effort */
          }
          setLoadingFiles(false);
          bumpStatus();
          const tinyComplete =
            !res.has_more &&
            !res.stats_pending &&
            knownTotal != null &&
            knownTotal <= page.length &&
            res.total_bytes != null;
          if (!tinyComplete) {
            setScaleHint(
              res.has_more
                ? 'Folder besar — grid dimuat bertahap; jumlah & ukuran total dihitung otomatis di latar.'
                : 'Jumlah & ukuran total dihitung akurat di latar…'
            );
            // Stats after topics/files settle (no-op on low-end fullMediaStats=false)
            setStatsAccurate(false);
            scheduleMediaStats({
              force: true,
              delayMs: Math.max(INITIAL_STATS_DELAY_MS, getDrivePerfProfile().statsDelayMs),
            });
            if (getDrivePerfProfile().tier === 'low') {
              setScaleHint(
                (res.has_more
                  ? 'Mode Hemat: grid kecil, thumb ringan. Scroll untuk memuat lagi.'
                  : null) as string | null
              );
            }
          } else {
            setStatsAccurate(true);
            setScaleHint(null);
          }
        };

        const perf = getDrivePerfProfile();
        // 1) Files first (main grid). The device-tier cap fills the viewport
        // without making a constrained device allocate a large initial page.
        const filesP = driveListFiles(creds, peerId, {
          pageSize: stagedInitialPageSize(perf.tier, perf.filePage),
          topicId: tid,
          quickStats: false,
        })
          .then(applyFiles)
          .catch((e) => {
            if (gen !== peerGen.current) return;
            // Warm path must recover PeerChannel here — .catch swallows so the
            // outer try/catch never sees the error (poisoned location stick).
            if (peerId != null && recoverInvalidPeerLocation(e, { gen })) return;
            setError(friendlyDriveError(e));
          })
          .finally(() => {
            if (gen === peerGen.current) setLoadingFiles(false);
          });

        // 2) Secondary panels only begin after the latency-critical page settles.
        const chatsP = filesP
          .then(() => driveListChats(creds, { limit: perf.chatPage }))
          .then((cr) => {
            if (gen !== peerGen.current) return;
            const list = cr.chats || [];
            nChats = list.length;
            const cur: ChatListCursor = {
              offset_id: cr.next_offset_id ?? null,
              offset_date: cr.next_offset_date ?? null,
              offset_peer_id: cr.next_offset_peer_id ?? null,
            };
            const nextCursor =
              cur.offset_id || cur.offset_date || cur.offset_peer_id ? cur : null;
            chatFolderSnapshotsRef.current.set(0, {
              chats: list,
              hasMore: !!cr.has_more,
              offset: cr.next_offset ?? list.length,
              cursor: nextCursor,
            });
            if (activeChatFolderIdRef.current === 0) {
              startTransition(() => {
                setChats(list);
                setChatsOffset(cr.next_offset ?? list.length);
                setChatsHasMore(!!cr.has_more);
              });
              chatsCursorRef.current = nextCursor;
            }
            try {
              saveDriveSidebarSnapshot(localStorage, creds.session, {
                chats: list,
                chatsHasMore: !!cr.has_more,
                chatsOffset: cr.next_offset ?? list.length,
                cursor: nextCursor,
              });
            } catch {
              /* sidebar cache is best-effort */
            }
            // Provisional Drives [TD] from chat page (no full dialog walk)
            const tdFromChats: DriveFolder[] = list
              .filter((c: DriveChat) => c.is_drive_folder)
              .map((c: DriveChat) => ({
                id: c.id,
                name: c.name,
                title_raw: c.title_raw || c.name,
                username: c.username ?? null,
                is_drive_folder: true,
                parent_id: null,
              }));
            if (tdFromChats.length && nFolders === 0) {
              nFolders = tdFromChats.length;
              const provisionalFolders = withFolderOrphanFlags(tdFromChats);
              startTransition(() => {
                setFolders((prev) => (prev.length > 0 ? prev : provisionalFolders));
              });
              try {
                saveDriveSidebarSnapshot(localStorage, creds.session, {
                  folders: provisionalFolders,
                });
              } catch {
                /* sidebar cache is best-effort */
              }
              setLoadingFolders(false);
            }
            setLoadingChats(false);
            bumpStatus();
            if (peerId != null) {
              const meta = list.find((c: DriveChat) => c.id === peerId) ?? null;
              void loadTopicsForPeer(peerId, meta);
            } else if (creds) {
              try {
                setTimeout(() => {
                  sessionStorage.setItem(`drive_root_chats_${creds.session}`, JSON.stringify(list));
                }, 100);
              } catch {}
            }
          })
          .catch((e) => {
            if (gen === peerGen.current) setError(friendlyDriveError(e));
          })
          .finally(() => {
            if (gen === peerGen.current) setLoadingChats(false);
          });

        // 3) Full folder scan after lightweight secondary panels.
        const foldersP = chatsP.then(
          () =>
            new Promise<void>((resolve) => {
              const run = () => {
                void driveScanFolders(creds)
                  .then((fr: { folders?: DriveFolder[] } | DriveFolder[]) => {
                    if (gen !== peerGen.current) return;
                    const list = (Array.isArray(fr) ? fr : fr?.folders || []) as DriveFolder[];
                    nFolders = Array.isArray(list) ? list.length : 0;
                    const normalized = withFolderOrphanFlags(Array.isArray(list) ? list : []);
                    startTransition(() => {
                      setFolders(normalized);
                    });
                    try {
                      saveDriveSidebarSnapshot(localStorage, creds.session, {
                        folders: normalized,
                      });
                    } catch {
                      /* sidebar cache is best-effort */
                    }
                    setLoadingFolders(false);
                    bumpStatus();
                  })
                  .catch(() => {
                    /* keep provisional TD from chats */
                  })
                  .finally(() => {
                    if (gen === peerGen.current) setLoadingFolders(false);
                    resolve();
                  });
              };
              // Keep the full dialog walk eventual/live without making it
              // compete with first paint and visible thumbnails.
              const d = Math.max(MIN_FOLDER_SCAN_DELAY_MS, getDrivePerfProfile().folderScanDelayMs);
              if (d > 0) window.setTimeout(run, d);
              else run();
            })
        );

        // "Ready" means the grid is usable; sidebar/folders continue progressively.
        await filesP;
        void chatsP;
        void foldersP;
        if (gen !== peerGen.current) return;
        bumpStatus();
        return;
      }

      // One-shot fallback: single bootstrap RPC (no warm worker)
      // Chats+files only inside bootstrap; folders scan deferred (was 30–60s on large accounts)
      setStatusText('Menyambungkan (mode satu-kali)…');
      const boot = await driveBootstrap(creds, peerId, {
        filePageSize: getDrivePerfProfile().filePage,
        chatPageSize: getDrivePerfProfile().chatPage,
        topicId: tid,
      });
      if (gen !== peerGen.current) return;
      const bootCursor: ChatListCursor = {
        offset_id: boot.chats_next_offset_id ?? null,
        offset_date: boot.chats_next_offset_date ?? null,
        offset_peer_id: boot.chats_next_offset_peer_id ?? null,
      };
      const bootNextCursor =
        bootCursor.offset_id || bootCursor.offset_date || bootCursor.offset_peer_id
          ? bootCursor
          : null;
      chatFolderSnapshotsRef.current.set(0, {
        chats: boot.chats || [],
        hasMore: !!boot.chats_has_more,
        offset: boot.chats_next_offset ?? (boot.chats || []).length,
        cursor: bootNextCursor,
      });
      startTransition(() => {
        setFolders(withFolderOrphanFlags(boot.folders || []));
        if (activeChatFolderIdRef.current === 0) {
          setChats(boot.chats || []);
          setChatsOffset(boot.chats_next_offset ?? (boot.chats || []).length);
          setChatsHasMore(!!boot.chats_has_more);
        }
        setFiles(boot.files || []);
        setFilesHasMore(!!boot.files_has_more);
        setNextOffsetId(boot.next_offset_id ?? null);
      });
      if (peerId === null && tid === null) {
        try {
          setTimeout(() => {
            sessionStorage.setItem(`drive_root_chats_${creds.session}`, JSON.stringify(boot.chats || []));
            sessionStorage.setItem(`drive_root_files_${creds.session}`, JSON.stringify({
              files: boot.files || [],
              totalCount: boot.total_count,
              totalBytes: boot.total_bytes
            }));
          }, 100);
        } catch {}
      }
      setLoadingChats(false);
      setLoadingFiles(false);
      if (activeChatFolderIdRef.current === 0) chatsCursorRef.current = bootNextCursor;
      try {
        saveDriveSidebarSnapshot(localStorage, creds.session, {
          folders: withFolderOrphanFlags(boot.folders || []),
          chats: boot.chats || [],
          chatsHasMore: !!boot.chats_has_more,
          chatsOffset: boot.chats_next_offset ?? (boot.chats || []).length,
          cursor: bootNextCursor,
        });
      } catch {
        /* sidebar cache is best-effort */
      }
      if (boot.total_count != null) {
        const n = clampMediaTotal(boot.total_count, boot.files || []);
        if (n != null) {
          filesTotalCountRef.current.set(bootKey, n);
          setTotalFileCount(n);
        }
      }
      if (boot.total_bytes != null) {
        const b = clampMediaBytes(boot.total_bytes, boot.files || []);
        if (b != null) {
          filesTotalBytesRef.current.set(bootKey, b);
          setTotalBytes(b);
        }
      }
      if (boot.files_has_more || boot.stats_pending || boot.total_bytes == null) {
        setScaleHint(
          boot.files_has_more
            ? 'Folder besar — grid dimuat bertahap; jumlah & ukuran total dihitung otomatis di latar (tanpa menunggu scroll).'
            : 'Jumlah & ukuran total dihitung akurat di latar…'
        );
        scheduleMediaStats({ force: true, delayMs: INITIAL_STATS_DELAY_MS });
      } else {
        setStatsAccurate(true);
        setScaleHint(null);
        const fl = boot.files || [];
        const n =
          boot.total_count != null && Number.isFinite(Number(boot.total_count))
            ? Number(boot.total_count)
            : fl.length;
        const exactBytes =
          boot.total_bytes != null
            ? Number(boot.total_bytes)
            : fl.reduce((s: number, f: DriveFile) => s + (f.size || 0), 0);
        setTotalFileCount(n);
        setTotalBytes(exactBytes);
        filesTotalCountRef.current.set(bootKey, n);
        filesTotalBytesRef.current.set(bootKey, exactBytes);
      }
      const el = boot.elapsed_s != null ? ` · ${boot.elapsed_s}s` : '';
      const nFilesBoot = (boot.files || []).length;
      const known = clampMediaTotal(boot.total_count, boot.files || []);
      setStatusText(
        `${(boot.folders || []).length} TD · ${(boot.chats || []).length} chats · ${
          known != null
            ? boot.files_has_more
              ? `${nFilesBoot} / ${known}${boot.stats_accurate === true ? '' : '+'}`
              : String(known)
            : `${nFilesBoot}${boot.files_has_more ? '+' : ''}`
        } files${el}`
      );
      if (peerId != null) {
        const meta = (boot.chats || []).find((c: DriveChat) => c.id === peerId) ?? null;
        void loadTopicsForPeer(peerId, meta);
      } else {
        setTopics([]);
        setIsForumChat(false);
      }
      // Defer full TD folder walk (expensive) after first paint
      void driveScanFolders(creds)
        .then((fr: { folders?: DriveFolder[] } | DriveFolder[]) => {
          if (gen !== peerGen.current) return;
          const list = (Array.isArray(fr) ? fr : fr?.folders || []) as DriveFolder[];
          const normalized = withFolderOrphanFlags(Array.isArray(list) ? list : []);
          startTransition(() => {
            setFolders(normalized);
          });
          try {
            saveDriveSidebarSnapshot(localStorage, creds.session, { folders: normalized });
          } catch {
            /* sidebar cache is best-effort */
          }
        })
        .catch(() => {
          /* ignore */
        })
        .finally(() => {
          if (gen === peerGen.current) setLoadingFolders(false);
        });
    } catch (e: any) {
      if (gen !== peerGen.current) return;
      if (peerId != null && recoverInvalidPeerLocation(e, { gen })) return;
      setError(friendlyDriveError(e));
    } finally {
      if (gen === peerGen.current) {
        setLoadingFolders(false);
        setLoadingChats(false);
        setLoadingFiles(false);
      }
    }
  }, [creds, peerId, loadTopicsForPeer, scheduleMediaStats, recoverInvalidPeerLocation]);

  const selectChatFolder = useCallback(async (folderId: number, force = false) => {
    const previousFolderId = activeChatFolderIdRef.current;
    if (!creds || (!force && folderId === previousFolderId)) return;
    chatFolderSnapshotsRef.current.set(previousFolderId, {
      chats,
      hasMore: chatsHasMore,
      offset: chatsOffset,
      cursor: chatsCursorRef.current,
    });
    activeChatFolderIdRef.current = folderId;
    setActiveChatFolderId(folderId);
    try {
      localStorage.setItem(`autogram_chat_folder_${creds.session}`, String(folderId));
    } catch {
      /* preference is best-effort */
    }
    const cached = chatFolderSnapshotsRef.current.get(folderId);
    if (cached) {
      setChats(cached.chats);
      setChatsHasMore(cached.hasMore);
      setChatsOffset(cached.offset);
      chatsCursorRef.current = cached.cursor;
    } else {
      setChats([]);
      setChatsHasMore(false);
      setChatsOffset(0);
      chatsCursorRef.current = null;
    }
    const requestId = ++chatFolderRequestRef.current;
    setLoadingChats(true);
    try {
      const res = await driveListChats(creds, {
        limit: getDrivePerfProfile().chatPage,
        chatFolderId: folderId,
      });
      if (
        requestId !== chatFolderRequestRef.current ||
        activeChatFolderIdRef.current !== folderId
      ) return;
      const list = (res?.chats || []) as DriveChat[];
      const cursor: ChatListCursor = {
        offset_id: res?.next_offset_id ?? null,
        offset_date: res?.next_offset_date ?? null,
        offset_peer_id: res?.next_offset_peer_id ?? null,
      };
      setChats(list);
      setChatsHasMore(!!res?.has_more);
      setChatsOffset(res?.next_offset ?? list.length);
      chatsCursorRef.current =
        cursor.offset_id || cursor.offset_date || cursor.offset_peer_id ? cursor : null;
      chatFolderSnapshotsRef.current.set(folderId, {
        chats: list,
        hasMore: !!res?.has_more,
        offset: res?.next_offset ?? list.length,
        cursor: chatsCursorRef.current,
      });
    } catch (e: any) {
      if (
        requestId === chatFolderRequestRef.current &&
        activeChatFolderIdRef.current === folderId
      ) setError(friendlyDriveError(e));
    } finally {
      if (
        requestId === chatFolderRequestRef.current &&
        activeChatFolderIdRef.current === folderId
      ) setLoadingChats(false);
    }
  }, [creds, chats, chatsHasMore, chatsOffset]);

  const restoredChatFolderRef = useRef<string>('');
  useEffect(() => {
    if (!creds || activeChatFolderId === 0) return;
    if (!chatFolders.some((folder) => folder.id === activeChatFolderId)) return;
    const key = `${creds.session}:${activeChatFolderId}`;
    if (restoredChatFolderRef.current === key) return;
    restoredChatFolderRef.current = key;
    void selectChatFolder(activeChatFolderId, true);
  }, [creds, activeChatFolderId, chatFolders, selectChatFolder]);

  const loadMoreChats = useCallback(async () => {
    if (!creds || !chatsHasMore || chatsLoadingMore || chatBulkLock.current) return;
    chatBulkLock.current = true;
    setChatsLoadingMore(true);
    // Pause avatar flood while paging dialogs (reduces force-close risk)
    try {
      const { setAvatarsPaused } = await import('../lib/avatarBatcher');
      setAvatarsPaused(true);
    } catch {
      /* ignore */
    }
    try {
      const requestFolderId = activeChatFolderIdRef.current;
      const cursor = chatsCursorRef.current;
      const cr = await driveListChats(creds, {
        limit: Math.min(CHAT_BULK_PAGE, getDrivePerfProfile().chatPage),
        offset: cursor ? 0 : chatsOffset,
        cursor,
        chatFolderId: requestFolderId,
      });
      if (activeChatFolderIdRef.current !== requestFolderId) return;
      const incoming: DriveChat[] = cr.chats || [];
      setChats((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...incoming.filter((c) => !seen.has(c.id))];
      });
      setChatsOffset(cr.next_offset ?? chatsOffset + incoming.length);
      setChatsHasMore(!!cr.has_more);
      if (cr.has_more) {
        chatsCursorRef.current = {
          offset_id: cr.next_offset_id ?? null,
          offset_date: cr.next_offset_date ?? null,
          offset_peer_id: cr.next_offset_peer_id ?? null,
        };
      } else {
        chatsCursorRef.current = null;
      }
    } catch (e: any) {
      setError(friendlyDriveError(e));
    } finally {
      setChatsLoadingMore(false);
      chatBulkLock.current = false;
      try {
        const { setAvatarsPaused } = await import('../lib/avatarBatcher');
        setAvatarsPaused(false);
      } catch {
        /* ignore */
      }
    }
  }, [creds, chatsHasMore, chatsLoadingMore, chatsOffset]);

  // Soft prefetch: keep paging dialogs (Nagram-like completeness) until softMax.
  // Low-end still prefetches a modest amount so folders are not "only a few".
  const softPrefetchDone = useRef(false);
  useEffect(() => {
    softPrefetchDone.current = false;
  }, [creds?.session]);
  useEffect(() => {
    if (!creds) return;
    if (!chatsHasMore || chatsLoadingMore) return;
    if (chats.length === 0) return;
    const softMax = Math.max(80, getDrivePerfProfile().chatSoftPrefetchMax || 0);
    if (chats.length >= softMax) {
      softPrefetchDone.current = true;
      return;
    }
    let cancelled = false;
    let idleId: number | undefined;
    let t: number | undefined;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    const run = () => {
      if (cancelled) return;
      void loadMoreChats();
    };
    t = window.setTimeout(() => {
      if (cancelled) return;
      if (typeof ric === 'function') idleId = ric(run, { timeout: 4_000 });
      else run();
    }, Math.min(CHAT_SOFT_PREFETCH_DELAY_MS, 600));
    return () => {
      cancelled = true;
      if (idleId != null) {
        const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        cic?.(idleId);
      }
      if (t != null) window.clearTimeout(t);
    };
  }, [creds, chatsHasMore, chatsLoadingMore, chats.length, loadMoreChats]);

  // After chats for THIS session arrive, restore last peer only if known here.
  useEffect(() => {
    const pending = pendingRestorePeerRef.current;
    if (!pending || !creds) return;
    if (pending.kind === 'saved' || pending.id == null) {
      pendingRestorePeerRef.current = null;
      return;
    }
    // Wait until we have some dialog signal for this session
    if (chats.length === 0 && folders.length === 0 && loadingChats) return;
    const id = pending.id;
    const known =
      chats.some((c) => c.id === id) ||
      folders.some((f) => f.id === id);
    pendingRestorePeerRef.current = null;
    if (!known) {
      // Stale peer from another life of this session name — clear storage.
      saveDrivePeer(creds.session, { kind: 'saved', id: null });
      return;
    }
    setLocationKind(pending.kind);
    setActivePeerId(id);
  }, [creds, chats, folders, loadingChats]);

  const refreshFiles = useCallback(async () => {
    if (!creds) return;
    const gen = ++peerGen.current;
    // Allow thumb re-fetch after manual refresh (soft-fails cleared; success cache kept)
    invalidateThumbFailures();
    setThumbsPaused(true);
    setLoadingFiles(true);
    setStatsAccurate(false);
    setStatsByType(null);
    setError(null);
    setSelectedIds([]);
    selectionAnchorRef.current = null;
    let tid = topicFilterRef.current;
    let cacheKey = `${peerId}_${tid || ''}`;

    // Instant cache restore
    const cachedFiles = filesCacheRef.current.get(cacheKey);
    let persisted: ReturnType<typeof loadDriveLocationSnapshot> = null;
    if (!cachedFiles) {
      try {
        persisted = loadDriveLocationSnapshot(localStorage, creds.session, peerId, tid);
      } catch {
        persisted = null;
      }
    }
    const instantFiles = cachedFiles ?? persisted?.files;
    if (instantFiles) {
      setFiles(instantFiles);
      const cachedCount = filesTotalCountRef.current.get(cacheKey);
      if (cachedCount != null) setTotalFileCount(clampMediaTotal(cachedCount, instantFiles));
      else if (persisted?.totalCount != null) {
        setTotalFileCount(clampMediaTotal(persisted.totalCount, instantFiles));
      }
      const cachedBytes = filesTotalBytesRef.current.get(cacheKey);
      if (cachedBytes != null) setTotalBytes(clampMediaBytes(cachedBytes, instantFiles));
      else if (persisted?.totalBytes != null) {
        setTotalBytes(clampMediaBytes(persisted.totalBytes, instantFiles));
      }
      if (persisted) {
        filesCacheRef.current.set(cacheKey, persisted.files);
        setFilesHasMore(persisted.hasMore);
        setNextOffsetId(persisted.nextOffsetId);
        setLoadingFiles(false);
      }
    } else {
      setFiles([]);
      setTotalFileCount(null);
      setTotalBytes(null);
    }

    try {
      setStatusText(tid != null ? 'Listing files (topik)…' : 'Listing files…');
      const perf = getDrivePerfProfile();
      let res = await driveListFiles(creds, peerId, {
        pageSize: stagedInitialPageSize(perf.tier, perf.filePage),
        topicId: tid,
        quickStats: false,
      });
      if (gen !== peerGen.current) return;
      if (res?.invalid_topic && tid != null) {
        // Recover stale/deleted/cross-peer topic selection without showing a
        // fatal location error. Reopen the active peer as "Semua media".
        tid = null;
        cacheKey = `${peerId}_`;
        setTopicFilter(null);
        topicFilterRef.current = null;
        topicsRequestSeqRef.current += 1;
        setTopics([]);
        setIsForumChat(false);
        res = await driveListFiles(creds, peerId, {
          pageSize: stagedInitialPageSize(perf.tier, perf.filePage),
          topicId: null,
          quickStats: false,
        });
        if (gen !== peerGen.current) return;
        if (peerId != null) void loadTopicsForPeer(peerId);
      }
      const page: DriveFile[] = res.files || [];

      // Update cache — only apply totals that belong to this peer+topic key
      filesCacheRef.current.set(cacheKey, page);
      liveSyncLastAtRef.current.set(cacheKey, Date.now());
      liveSyncFailuresRef.current = 0;
      liveSyncBackoffUntilRef.current = 0;
      if (res.total_count != null) {
        const n = clampMediaTotal(res.total_count, page);
        if (n != null) {
          // Topic-scoped lower bound from server; never carry all-media count here
          filesTotalCountRef.current.set(cacheKey, n);
          setTotalFileCount(n);
        }
      } else if (tid != null) {
        // Prefer null over stale all-media number while topic stats load
        const known = filesTotalCountRef.current.get(cacheKey);
        setTotalFileCount(known != null ? known : null);
      }
      if (res.total_bytes != null) {
        const b = clampMediaBytes(res.total_bytes, page);
        if (b != null) {
          filesTotalBytesRef.current.set(cacheKey, b);
          setTotalBytes(b);
        }
      }

      if (peerId === null && tid === null) {
        try {
          sessionStorage.setItem(`drive_root_files_${creds.session}`, JSON.stringify({
            files: page,
            totalCount: res.total_count,
            totalBytes: res.total_bytes
          }));
        } catch {}
      }

      setFiles(page);
      const hasMore = !!res.has_more;
      setFilesHasMore(hasMore);
      setNextOffsetId(res.next_offset_id ?? null);
      try {
        saveDriveLocationSnapshot(localStorage, creds.session, peerId, tid, {
          files: page,
          hasMore,
          nextOffsetId: res.next_offset_id ?? null,
          totalCount: res.total_count ?? filesTotalCountRef.current.get(cacheKey) ?? null,
          totalBytes: res.total_bytes ?? filesTotalBytesRef.current.get(cacheKey) ?? null,
        });
      } catch {
        /* cache is best-effort */
      }
      const topicNote = tid != null ? ' · topik' : '';
      // Status uses accurate total when known
      const knownTotal =
        clampMediaTotal(res.total_count, page);
      if (knownTotal != null) {
        setStatusText(
          hasMore || knownTotal > page.length
            ? `${page.length} / ${knownTotal} files${topicNote}`
            : `${knownTotal} files${topicNote}`
        );
      } else {
        setStatusText(`${page.length}${hasMore ? '+' : ''} files${topicNote}`);
      }
      // Always refine unique count+size in background (never freeze at page size 28/40).
      // Only skip when server already proved the whole location is smaller than one page.
      const tinyComplete =
        !hasMore &&
        !res.stats_pending &&
        knownTotal != null &&
        knownTotal <= page.length &&
        res.total_bytes != null;
      if (tinyComplete) {
        const exactBytes =
          res.total_bytes != null
            ? Number(res.total_bytes)
            : page.reduce((s, f) => s + (f.size || 0), 0);
        setTotalFileCount(knownTotal ?? page.length);
        setTotalBytes(exactBytes);
        filesTotalCountRef.current.set(cacheKey, knownTotal ?? page.length);
        filesTotalBytesRef.current.set(cacheKey, exactBytes);
        setStatsAccurate(true);
        setScaleHint(null);
      } else {
        setScaleHint(
          hasMore
            ? 'Folder besar — grid dimuat bertahap; jumlah & ukuran total dihitung otomatis di latar (tanpa menunggu scroll).'
            : 'Jumlah & ukuran total dihitung akurat di latar…'
        );
        // Topic history can still be large. Keep it in the same late stage so
        // switching topic never reintroduces a startup CPU/network spike.
        scheduleMediaStats({
          force: true,
          delayMs: INITIAL_STATS_DELAY_MS,
        });
      }
    } catch (e: any) {
      if (gen !== peerGen.current) return;
      if (peerId != null && recoverInvalidPeerLocation(e, { gen })) return;
      setError(friendlyDriveError(e));
      setStatusText('List failed');
    } finally {
      if (gen === peerGen.current) {
        setLoadingFiles(false);
        // Resume thumbs after list settles
        window.setTimeout(() => {
          if (gen === peerGen.current) {
            invalidateThumbFailures();
            setThumbsPaused(false);
          }
        }, getDrivePerfProfile().thumbResumeMs);
      }
    }
  }, [creds, peerId, scheduleMediaStats, loadTopicsForPeer, recoverInvalidPeerLocation]);

  const loadMoreFiles = useCallback(async () => {
    if (!creds || !filesHasMore || loadingMoreFiles || loadMoreLock.current) return;
    if (nextOffsetId == null) return;
    loadMoreLock.current = true;
    setLoadingMoreFiles(true);
    // Metadata and media use independent worker lanes. Keep thumbnails moving
    // on mid/high devices; only constrained devices pause during pagination.
    const pauseThumbsForPaging = getDrivePerfProfile().tier === 'low';
    if (pauseThumbsForPaging) setThumbsPaused(true);
    setStatusText('Memuat lebih banyak…');
    const gen = peerGen.current;
    const tid = topicFilterRef.current;
    const offsetAtStart = nextOffsetId;
    try {
      const res = await driveListFiles(creds, peerId, {
        pageSize: stagedLoadMorePageSize(
          getDrivePerfProfile().tier,
          getDrivePerfProfile().loadMorePage
        ),
        offsetId: offsetAtStart,
        topicId: tid,
        quickStats: false,
      });
      if (gen !== peerGen.current) return;
      const page: DriveFile[] = res.files || [];
      // Avoid stuck pagination if API returned empty but claimed has_more
      if (!page.length) {
        setFilesHasMore(false);
        setNextOffsetId(null);
        setStatusText('Semua media dimuat');
        scheduleMediaStats({ force: true, delayMs: 200 });
        return;
      }
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        const merged = [...prev, ...page.filter((f) => !seen.has(f.id))];
        if (merged.length >= 10000) {
          setScaleHint('Folder sangat besar (10k+) — gunakan filter/search; muat bertahap.');
        } else if (merged.length >= 1000) {
          setScaleHint('1.000+ item dimuat bertahap — hanya baris terlihat yang di-render.');
        }
        const known = filesTotalCountRef.current.get(`${peerId}_${tid || ''}`);
        setStatusText(
          known != null
            ? `${merged.length} / ${known}${statsAccurate ? '' : '+'} files`
            : `${merged.length}${res.has_more ? '+' : ''} files`
        );

        // Update cache with merged data
        const cacheKey = `${peerId}_${tid || ''}`;
        filesCacheRef.current.set(cacheKey, merged);
        // Only raise lower-bound from page payloads — never shrink during scroll
        // (background media_stats owns the accurate total)
        if (res.total_count != null) {
          const n = Number(res.total_count);
          if (Number.isFinite(n)) {
            setTotalFileCount((prev) => {
              const next = prev != null ? Math.max(prev, n, merged.length) : Math.max(n, merged.length);
              filesTotalCountRef.current.set(cacheKey, next);
              return next;
            });
          }
        }

        return merged;
      });
      setFilesHasMore(!!res.has_more);
      const next = res.next_offset_id ?? null;
      // Guard: if cursor did not advance, stop to avoid infinite slow loop
      if (next != null && Number(next) === Number(offsetAtStart)) {
        setFilesHasMore(false);
        setNextOffsetId(null);
      } else {
        setNextOffsetId(next);
      }
      // Scrolled to end: loaded length is a lower bound; prefer media_stats if higher
      if (!res.has_more) {
        setFiles((prev) => {
          const exactBytes = prev.reduce((s, f) => s + (f.size || 0), 0);
          const cacheKey = `${peerId}_${tid || ''}`;
          // Every filter is exhausted: the merged ID set and its metadata are
          // now the authoritative location-wide totals.
          setTotalFileCount(prev.length);
          setTotalBytes(exactBytes);
          filesTotalCountRef.current.set(cacheKey, prev.length);
          filesTotalBytesRef.current.set(cacheKey, exactBytes);
          setStatsAccurate(true);
          setStatsLoading(false);
          if (mediaStatsTimerRef.current != null) {
            window.clearTimeout(mediaStatsTimerRef.current);
            mediaStatsTimerRef.current = null;
          }
          return prev;
        });
      }
    } catch (e: any) {
      if (gen === peerGen.current) {
        setError(friendlyDriveError(e));
        setStatusText('Load more gagal');
      }
    } finally {
      if (pauseThumbsForPaging) setThumbsPaused(false);
      // Short cooldown — was 400ms, felt stuck on "Scroll for more…"
      setTimeout(() => {
        loadMoreLock.current = false;
      }, 120);
      setLoadingMoreFiles(false);
    }
  }, [
    creds,
    peerId,
    filesHasMore,
    loadingMoreFiles,
    nextOffsetId,
    scheduleMediaStats,
    statsAccurate,
  ]);

  // Cheap exact path for bounded locations. This fetches metadata only and is
  // device-tier capped, so low-end devices never render an unbounded library.
  useEffect(() => {
    if (!creds || !filesHasMore || loadingFiles || loadingMoreFiles) return;
    if (nextOffsetId == null || totalFileCount == null) return;
    const tier = getDrivePerfProfile().tier;
    // Even the low tier already virtualizes/renders about 64 visible metadata
    // rows during live sync; completing up to 80 avoids a costly full scan
    // without materially increasing memory pressure.
    const cap = tier === 'high' ? 200 : tier === 'mid' ? 120 : 80;
    if (totalFileCount > cap || files.length >= totalFileCount) return;
    const timer = window.setTimeout(() => {
      void loadMoreFiles();
    }, tier === 'high' ? 350 : tier === 'mid' ? 750 : 1_500);
    return () => window.clearTimeout(timer);
  }, [
    creds,
    filesHasMore,
    loadingFiles,
    loadingMoreFiles,
    nextOffsetId,
    totalFileCount,
    files.length,
    loadMoreFiles,
  ]);

  const syncActiveLocationLive = useCallback(
    async (reason: 'interval' | 'focus') => {
      if (!creds || loadingFiles || loadingMoreFiles || liveSyncLockRef.current) return;
      if (document.visibilityState === 'hidden') return;

      const plan = getDriveLiveSyncPlan(getDrivePerfProfile().tier);
      const now = Date.now();
      if (now < liveSyncBackoffUntilRef.current) return;
      const tid = topicFilterRef.current;
      const cacheKey = `${peerId}_${tid || ''}`;
      const minAge = reason === 'focus' ? plan.focusMinAgeMs : plan.intervalMs;
      const lastAt = liveSyncLastAtRef.current.get(cacheKey) || 0;
      if (now - lastAt < minAge) return;

      liveSyncLockRef.current = true;
      const gen = peerGen.current;
      const loadedBefore = liveFilesRef.current.length;
      const cursorBefore = nextOffsetId;
      const hasMoreBefore = filesHasMore;
      try {
        const res = await driveListFiles(creds, peerId, {
          pageSize: plan.pageSize,
          topicId: tid,
          quickStats: false,
        });
        if (gen !== peerGen.current || tid !== topicFilterRef.current) return;
        if (res?.invalid_topic && tid != null) {
          void refreshFiles();
          return;
        }

        const liveHead: DriveFile[] = res.files || [];
        const previousHead = liveFilesRef.current.slice(0, liveHead.length);
        const headChanged =
          previousHead.length !== liveHead.length ||
          previousHead.some((file, index) => file.id !== liveHead[index]?.id);
        const keptExtendedPages = !!res.has_more && loadedBefore > liveHead.length;
        const merged = reconcileDriveLiveHead(
          liveFilesRef.current,
          liveHead,
          !!res.has_more
        );
        liveFilesRef.current = merged;
        filesCacheRef.current.set(cacheKey, merged);
        setFiles(merged);

        if (!keptExtendedPages) {
          setFilesHasMore(!!res.has_more);
          setNextOffsetId(res.next_offset_id ?? null);
        } else {
          setFilesHasMore(hasMoreBefore || !!res.has_more);
          setNextOffsetId(cursorBefore);
        }

        const mayApplyListTotals =
          !statsAccurate || (res.stats_accurate === true && !headChanged);
        if (
          mayApplyListTotals &&
          res.total_count != null &&
          Number.isFinite(Number(res.total_count))
        ) {
          const total = clampMediaTotal(res.total_count, merged) ?? merged.length;
          filesTotalCountRef.current.set(cacheKey, total);
          setTotalFileCount(total);
        }
        if (
          mayApplyListTotals &&
          res.total_bytes != null &&
          Number.isFinite(Number(res.total_bytes))
        ) {
          const bytes = clampMediaBytes(res.total_bytes, merged) ?? loadedMediaBytes(merged);
          filesTotalBytesRef.current.set(cacheKey, bytes);
          setTotalBytes(bytes);
        }

        try {
          saveDriveLocationSnapshot(localStorage, creds.session, peerId, tid, {
            files: merged,
            hasMore: keptExtendedPages ? hasMoreBefore || !!res.has_more : !!res.has_more,
            nextOffsetId: keptExtendedPages ? cursorBefore : res.next_offset_id ?? null,
            totalCount: filesTotalCountRef.current.get(cacheKey) ?? null,
            totalBytes: filesTotalBytesRef.current.get(cacheKey) ?? null,
          });
        } catch {
          /* live data remains authoritative even if cache persistence fails */
        }

        liveSyncLastAtRef.current.set(cacheKey, Date.now());
        liveSyncFailuresRef.current = 0;
        liveSyncBackoffUntilRef.current = 0;
        if (headChanged) {
          setStatsAccurate(false);
          const tier = getDrivePerfProfile().tier;
          const recountDelay = tier === 'high' ? 1_500 : tier === 'mid' ? 3_000 : 6_000;
          scheduleMediaStats({ force: true, delayMs: recountDelay });
        }
        setStatusText(`Sinkron live · ${merged.length}${res.has_more ? '+' : ''} files`);
      } catch {
        // Smart backoff: retain the last visible data and reduce Telegram load.
        liveSyncFailuresRef.current += 1;
        liveSyncBackoffUntilRef.current =
          Date.now() + driveSyncBackoffMs(plan, liveSyncFailuresRef.current);
      } finally {
        liveSyncLockRef.current = false;
      }
    },
    [
      creds,
      peerId,
      loadingFiles,
      loadingMoreFiles,
      nextOffsetId,
      filesHasMore,
      statsAccurate,
      refreshFiles,
      scheduleMediaStats,
    ]
  );

  useEffect(() => {
    if (!creds) return;
    const plan = getDriveLiveSyncPlan(getDrivePerfProfile().tier);
    const timer = window.setInterval(() => {
      void syncActiveLocationLive('interval');
    }, plan.intervalMs);
    const onFocus = () => void syncActiveLocationLive('focus');
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [creds, peerId, topicFilter, syncActiveLocationLive]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Session/location bootstrap is deliberately staged. The first live file
  // page remains immediate; proactive thumbnails and auto-pagination unlock
  // only after that page has had time to paint without background contention.
  useEffect(() => {
    setProgressiveReady(false);
    setThumbBootstrapMode(true);
    if (!creds || loadingFiles) return;
    const timer = window.setTimeout(() => {
      setProgressiveReady(true);
      setThumbBootstrapMode(false);
    }, progressiveSettleDelayMs(getDrivePerfProfile().tier));
    return () => window.clearTimeout(timer);
  }, [creds?.session, peerId, topicFilter, loadingFiles]);

  useEffect(() => {
    return () => setThumbBootstrapMode(false);
  }, []);

  const bootDone = useRef(false);

  // Boot: warm session + bootstrap. Uses last session immediately (no wait for list-sessions).
  useEffect(() => {
    if (!creds) {
      setDriveReady(false);
      return;
    }
    let cancelled = false;
    bootDone.current = false;
    setDriveReady(false);
    softPrefetchDone.current = false;
    const switched = lastBootSessionRef.current !== creds.session;
    lastBootSessionRef.current = creds.session;
    // Only wipe lists on real session switch — keeps UI stable on StrictMode remount
    if (switched) {
      // FATAL: never keep previous session's location / recents / peer in UI.
      // Always boot into Saved Messages first — peer restore only after this
      // session's chat list proves the peer exists (avoids PeerChannel bleed).
      // Invalidate generations first so in-flight A responses cannot re-apply.
      invalidateDriveGenerations();
      setError(null);
      setChats([]);
      setChatsHasMore(false);
      setChatsOffset(0);
      chatsCursorRef.current = null;
      setFolders([]);
      setFiles([]);
      setFilesHasMore(false);
      setNextOffsetId(null);
      setTotalFileCount(null);
      setTotalBytes(null);
      setChatFolders([{ id: 0, title: 'Semua Chat', kind: 'all' }]);
      setTopicFilter(null);
      filesCacheRef.current.clear();
      filesTotalCountRef.current.clear();
      filesTotalBytesRef.current.clear();
      chatFolderSnapshotsRef.current.clear();
      lastRecentKeyRef.current = '';
      clearAvatarCache();
      clearDriveSessionEphemeralCaches(creds.session);

      setLocationKind('saved');
      setActivePeerId(null);
      setRecents(loadDriveRecents(creds.session));
      setPins(loadDrivePins(creds.session));
      try {
        setActiveChatFolderId(
          Number(localStorage.getItem(`autogram_chat_folder_${creds.session}`) || 0) || 0
        );
      } catch {
        setActiveChatFolderId(0);
      }
      // Queue preferred peer for this session only (never previous account's id).
      pendingRestorePeerRef.current = loadDrivePeer(creds.session);

      try {
        const sidebar = loadDriveSidebarSnapshot(localStorage, creds.session);
        if (sidebar) {
          setFolders(sidebar.folders);
          setChats(sidebar.chats);
          setChatsHasMore(sidebar.chatsHasMore);
          setChatsOffset(sidebar.chatsOffset);
          chatsCursorRef.current = sidebar.cursor;
          setLoadingChats(false);
          setLoadingFolders(false);
        }
        // Only paint Saved Messages root cache for the NEW session
        const location = loadDriveLocationSnapshot(localStorage, creds.session, null, null);
        if (location) {
          const key = `null_`;
          filesCacheRef.current.set(key, location.files);
          setFiles(location.files);
          setFilesHasMore(location.hasMore);
          setNextOffsetId(location.nextOffsetId);
          if (location.totalCount != null) {
            filesTotalCountRef.current.set(key, location.totalCount);
            setTotalFileCount(location.totalCount);
          }
          if (location.totalBytes != null) {
            filesTotalBytesRef.current.set(key, location.totalBytes);
            setTotalBytes(location.totalBytes);
          }
          setLoadingFiles(false);
        } else {
          const cachedFiles = sessionStorage.getItem(`drive_root_files_${creds.session}`);
          if (cachedFiles) {
            const parsed = JSON.parse(cachedFiles);
            setFiles(parsed.files || []);
            if (parsed.totalCount != null) setTotalFileCount(Number(parsed.totalCount));
            if (parsed.totalBytes != null) setTotalBytes(Number(parsed.totalBytes));
          }
        }
        if (!sidebar) {
          const cachedChats = sessionStorage.getItem(`drive_root_chats_${creds.session}`);
          if (cachedChats) {
            setChats(JSON.parse(cachedChats));
          }
        }
      } catch {}
    }
    (async () => {
      try {
        setStatusText(switched ? 'Menyambungkan Drive…' : 'Memuat Drive…');
        setLoadingFolders(true);
        setLoadingChats(true);
        setLoadingFiles(true);
        // Freeze thumbs/avatars during connect+list — prevents Not Responding /
        // force-close from one-shot thumb workers and flood of concurrent RPCs.
        setThumbsPaused(true);
        try {
          const { setAvatarsPaused } = await import('../lib/avatarBatcher');
          setAvatarsPaused(true);
        } catch {
          /* ignore */
        }
        const ok = await ensureDriveSession(creds);
        if (cancelled) return;
        // Show "terhubung" as soon as worker is warm — don't wait for lists
        setDriveReady(ok || isDriveSessionReady());
        setStatusText(ok || isDriveSessionReady() ? 'Drive terhubung · memuat…' : 'Memuat Drive…');
        await refreshLocations();
        if (!cancelled) {
          bootDone.current = true;
          setDriveReady(isDriveSessionReady() || ok);
          const perfHint = perfStatusHint();
          setStatusText(
            isDriveSessionReady()
              ? perfHint
                ? `Drive siap · ${perfHint}`
                : 'Drive siap'
              : 'Drive (mode satu-kali)'
          );
          if (perfHint) {
            setScaleHint((h) => h || 'Mode Hemat aktif: thumb ringan, halaman kecil, stats ditunda agar perangkat tidak berat.');
          }
          // Clear soft-fails from boot, then release thumbs.
          // High/Turbo: resume almost immediately so first page thumbs fill in parallel.
          // Low-end: longer pause so list_topics / connect finish first.
          invalidateThumbFailures();
          const perf = getDrivePerfProfile();
          const resumeMs = Math.max(40, perf.thumbResumeMs);
          window.setTimeout(() => {
            if (cancelled) return;
            setThumbsPaused(false);
            invalidateThumbFailures();
          }, resumeMs);
          try {
            const { setAvatarsPaused } = await import('../lib/avatarBatcher');
            window.setTimeout(() => {
              if (!cancelled) setAvatarsPaused(false);
            }, resumeMs + (perf.tier === 'high' ? 40 : 200));
          } catch {
            /* ignore */
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(friendlyDriveError(e));
          setLoadingFolders(false);
          setLoadingChats(false);
          setLoadingFiles(false);
          setDriveReady(false);
          setStatusText('Siap');
          try {
            const { setAvatarsPaused } = await import('../lib/avatarBatcher');
            setAvatarsPaused(false);
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds?.session, creds?.apiId]);

  // Leave Media Studio: cancel active transfer/move + stop warm worker
  useEffect(() => {
    // StrictMode remount must cancel teardown synchronously, before any async
    // credential/session bootstrap has a chance to run.
    cancelScheduledDriveSessionStop();
    return () => {
      setDriveReady(false);
      scheduleDriveSessionStop();
      try {
        if (moveAbortRef.current) moveAbortRef.current.cancelled = true;
      } catch {
        /* ignore */
      }
      void (async () => {
        try {
          if (isTransferJobActive() || childRef.current) {
            await clearDriveTransferPause();
            await cancelDriveJob();
            childRef.current?.dispose?.();
            childRef.current = null;
          }
        } catch {
          /* ignore */
        }
      })();
    };
  }, []);

  // Peer change after boot — topic discovery and file listing start independently.
  const prevPeer = useRef(peerId);
  useEffect(() => {
    if (!creds || !bootDone.current) {
      prevPeer.current = peerId;
      return;
    }
    if (prevPeer.current === peerId) return;
    prevPeer.current = peerId;
    // Cancel deferred stats for previous peer
    if (mediaStatsTimerRef.current != null) {
      window.clearTimeout(mediaStatsTimerRef.current);
      mediaStatsTimerRef.current = null;
    }
    setStatsAccurate(false);
    setStatsByType(null);
    setTotalFileCount(null);
    setTotalBytes(null);
    setTopicFilter(null);
    topicFilterRef.current = null;
    topicsRequestSeqRef.current += 1;
    // Instant restore from topics cache if any; otherwise clear + loading
    if (peerId != null) {
      const cached = topicsCacheRef.current.get(peerId);
      if (cached && Date.now() - cached.ts < 5 * 60_000) {
        setTopics(cached.topics);
        setIsForumChat(cached.is_forum);
      } else {
        const meta = chats.find((c) => c.id === peerId) ?? null;
        setTopics([]);
        setIsForumChat(meta?.is_forum === true);
      }
    } else {
      setTopics([]);
      setIsForumChat(false);
    }
    // Topic discovery must never wait for a large media page to finish.
    if (peerId != null) {
      const meta = chats.find((c) => c.id === peerId) ?? null;
      void loadTopicsForPeer(peerId, meta);
    }
    void refreshFiles();
  }, [peerId, creds, chats, refreshFiles, loadTopicsForPeer]);

  const handleTopicFilter = useCallback(
    (t: DriveTopicFilter) => {
      if (activePeerRef.current !== peerId) return;
      if (t != null && !topics.some((topic) => topic.id === t)) return;
      if (t === topicFilterRef.current) return;
      setTopicFilter(t);
      topicFilterRef.current = t;
      setError(null);
      // Drop previous location totals immediately so all-media count
      // never sticks on a single topic while the new list loads.
      const cacheKey = `${peerId}_${t || ''}`;
      const cachedCount = filesTotalCountRef.current.get(cacheKey);
      const cachedBytes = filesTotalBytesRef.current.get(cacheKey);
      if (cachedCount != null) {
        setTotalFileCount(cachedCount);
      } else {
        setTotalFileCount(null);
      }
      if (cachedBytes != null) {
        setTotalBytes(cachedBytes);
      } else {
        setTotalBytes(null);
      }
      setStatsByType(null);
      setStatsAccurate(false);
      setStatsLoading(true);
      // Cancel deferred stats for previous topic scope
      if (mediaStatsTimerRef.current != null) {
        window.clearTimeout(mediaStatsTimerRef.current);
        mediaStatsTimerRef.current = null;
      }
      // Reload media for selected topic (or all media when null)
      void refreshFiles();
    },
    [refreshFiles, peerId, topics]
  );

  const applyProgressEvent = useCallback((ev: any) => {
    setTransfer((prev) => applyTransferEvent(prev, ev || {}));
  }, []);

  /** Capture worker transfer debug lines (+ events already via applyProgressEvent). */
  const onTransferStdout = useCallback((line: string) => {
    const text = String(line);
    if (text.includes('[EVENT]')) {
      const ev = parseEventLine(text);
      if (ev) {
        applyProgressEvent(ev);
        // Track download dests for Stop cleanup
        const t = String(ev.type || '');
        const p = (ev.payload || ev) as Record<string, unknown>;
        if (t === 'DriveItemStarted' || t === 'StudioItemStarted') {
          const path = String(p.path || p.dest || '');
          if (path && (path.includes('\\') || path.includes('/'))) {
            downloadArtifactsRef.current.add(path);
          }
        }
        if (t === 'DriveItemDone' || t === 'StudioItemDone' || t === 'DriveDownloadDone') {
          const path = String(p.path || '');
          const status = String(p.status || 'done').toLowerCase();
          if (path && (status === 'done' || status === 'ok' || status === 'success' || t === 'DriveDownloadDone')) {
            downloadArtifactsRef.current.delete(path);
          }
        }
      }
    }
    if (text.includes('[TRANSFER]') || text.includes('[DEBUG]')) {
      setTransfer((prev) => applyTransferStdoutLine(prev, text));
      if (isDebugMode()) {
        try {
          const m = text.includes('[DEBUG]') ? '[DEBUG]' : '[TRANSFER]';
          console.info('[AutoGram transfer]', text.slice(text.indexOf(m)));
        } catch {
          /* ignore */
        }
      }
    }
  }, [applyProgressEvent]);

  const toggleTransferMinimize = useCallback(() => {
    setTransferMinimized((m) => {
      const next = !m;
      localStorage.setItem(LS_TM_MIN, next ? '1' : '0');
      return next;
    });
  }, []);

  /** Never auto-clear session — only auto-minimize after finish so history stays. */
  const scheduleTransferHide = useCallback(() => {
    if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
    transferHideTimer.current = setTimeout(() => {
      setTransfer((t) => {
        if (t.active) return t;
        // Keep finished/failed history; just collapse to FAB
        return t;
      });
      setTransferMinimized(true);
      localStorage.setItem(LS_TM_MIN, '1');
    }, 12000);
  }, []);

  const openTransferManager = useCallback(() => {
    if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
    setTransferMinimized(false);
    localStorage.setItem(LS_TM_MIN, '0');
  }, []);

  const getDisplayedIds = useCallback(() => {
    if (displayedIdsRef.current.length) return displayedIdsRef.current;
    return filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter,
    }).map((f) => f.id);
  }, [files, query, mediaFilter, sortMode, advFilter]);

  const getDisplayedFiles = useCallback(() => {
    return filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter,
    });
  }, [files, query, mediaFilter, sortMode, advFilter]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    selectionAnchorRef.current = null;
  }, []);

  const handleSelect = useCallback(
    (e: React.MouseEvent, id: number) => {
      e.stopPropagation();
      // Multi-select must never paint OS/browser text selection on names/sizes
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          /* ignore */
        }
      }
      const displayedIds = getDisplayedIds();
      const ctrlKey = e.ctrlKey;
      const metaKey = e.metaKey;
      const shiftKey = e.shiftKey;
      setSelectedIds((prev) => {
        const result = applyClickSelection({
          displayedIds,
          selectedIds: prev,
          anchorId: selectionAnchorRef.current,
          clickedId: id,
          ctrlKey,
          metaKey,
          shiftKey,
        });
        selectionAnchorRef.current = result.anchorId;
        return result.selectedIds;
      });
    },
    [getDisplayedIds]
  );

  const handleToggleSelection = useCallback((id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    selectionAnchorRef.current = id;
  }, []);

  /**
   * Marquee commit: explorer already computed final ids (content-stable hits
   * + base selection for add/subtract). Set directly — do not re-apply mode
   * against prev (that dropped prior selection after scroll).
   */
  const handleMarqueeSelect = useCallback((finalIds: number[], _mode: MarqueeMode) => {
    setSelectedIds(finalIds);
    if (finalIds.length) {
      const displayedIds = displayedIdsRef.current;
      let lastHit = finalIds[finalIds.length - 1];
      for (let i = displayedIds.length - 1; i >= 0; i--) {
        if (finalIds.includes(displayedIds[i])) {
          lastHit = displayedIds[i];
          break;
        }
      }
      selectionAnchorRef.current = lastHit;
    }
  }, []);

  const handleSelectAllDisplayed = useCallback(() => {
    const ids = getDisplayedIds();
    setSelectedIds(selectAllDisplayed(ids));
    selectionAnchorRef.current = ids.length ? ids[ids.length - 1] : null;
  }, [getDisplayedIds]);

  const handleInvertSelection = useCallback(() => {
    const ids = getDisplayedIds();
    setSelectedIds((prev) => invertSelectionOnDisplayed(ids, prev));
  }, [getDisplayedIds]);

  // When filter / sort / search changes, drop selections that are no longer visible
  // so bulk actions never hit hidden items by mistake.
  useEffect(() => {
    const ids = filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter,
    }).map((f) => f.id);
    displayedIdsRef.current = ids;
    setSelectedIds((prev) => pruneSelectionToDisplayed(prev, ids));
    if (selectionAnchorRef.current != null && !ids.includes(selectionAnchorRef.current)) {
      selectionAnchorRef.current = null;
    }
  }, [files, query, mediaFilter, sortMode, advFilter]);

  // Browser-style location history (skip when navigating via back/forward)
  useEffect(() => {
    if (navSkipRef.current) {
      navSkipRef.current = false;
      return;
    }
    setNavHist((h) => navPush(h, { kind: locationKind, id: activePeerId }));
  }, [locationKind, activePeerId]);

  // Auto-hide error banner after a while (user can still Tutup)
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 14_000);
    return () => window.clearTimeout(t);
  }, [error]);

  const handleCreateFolder = (opts?: { parentId?: number | null }) => {
    // Open the name dialog even if warm session is still connecting — confirm path
    // will re-check creds + ensureDriveSession so "+ Drive" / "+ Folder" is not a silent no-op.
    if (!creds) {
      setError('Session / API belum siap. Pilih session Lavender, pastikan API ID & Hash terisi, lalu Muat.');
      return;
    }
    // Nested folder: explicit parent only when provided.
    // Default from toolbar/canvas without opts: nest when already inside a Drive folder.
    const parentId =
      opts?.parentId !== undefined
        ? opts.parentId
        : locationKind === 'drive' && activePeerId != null
          ? activePeerId
          : null;
    const parentName =
      parentId != null
        ? folders.find((f) => f.id === parentId)?.name || `Folder ${parentId}`
        : null;
    setError(null);
    setInputDlg({
      kind: 'create-folder',
      title: parentId != null ? 'Buat folder' : 'Buat Drive [TD]',
      description:
        parentId != null
          ? `Di dalam “${parentName}”. Folder bisa berisi subfolder.`
          : 'Drive root di Media Studio (channel privat Telegram [TD]).',
      label: parentId != null ? 'Nama folder' : 'Nama Drive',
      placeholder: parentId != null ? 'mis. Semester 1' : 'mis. Materi Kelas A',
      confirmLabel: parentId != null ? 'Buat folder' : 'Buat Drive',
      onConfirm: (name) => {
        void (async () => {
          try {
            if (!creds) {
              setError('Session / API belum siap.');
              return;
            }
            setStatusText(
              parentId != null ? `Membuat folder di ${parentName}…` : 'Membuat Drive [TD]…'
            );
            // Warm Telethon before CreateChannel — avoids disconnect / half-ready races
            try {
              await ensureDriveSession(creds);
            } catch {
              /* one-shot fallback inside driveCreateFolder */
            }
            const res = await driveCreateFolder(creds, name, { parentId });
            if (res?.warning) {
              setStatusText(String(res.warning));
            }
            const newId =
              res?.folder?.id != null && Number.isFinite(Number(res.folder.id))
                ? Number(res.folder.id)
                : null;
            await refreshLocations();
            if (newId != null) {
              setLocationKind('drive');
              setActivePeerId(newId);
              setTopicFilter(null);
              topicFilterRef.current = null;
              setStatusText(
                parentId != null
                  ? `Folder siap: ${res?.folder?.name || name}`
                  : `Drive siap: ${res?.folder?.name || name}`
              );
            } else {
              setStatusText(
                parentId != null
                  ? 'Folder dibuat — pilih di sidebar Drives [TD]'
                  : 'Drive dibuat — pilih di sidebar Drives [TD]'
              );
            }
          } catch (e: any) {
            const raw = String(e?.message || e || '');
            const low = raw.toLowerCase();
            let msg = raw;
            if (
              low.includes('cannot create channels') ||
              low.includes('createchannelrequest') ||
              low.includes('channels too much') ||
              low.includes('channelstoomuch')
            ) {
              msg =
                'Telegram menolak membuat channel untuk Drive/Folder. ' +
                'Setiap Drive/Folder [TD] = 1 channel privat. Cek: batas channel penuh, ' +
                'akun dibatasi, atau terlalu sering create. Coba buat channel manual di Telegram dulu.';
            } else if (!msg) {
              msg =
                parentId != null
                  ? 'Gagal membuat folder'
                  : 'Gagal membuat Drive [TD]';
            }
            setError(msg);
            setStatusText('Siap');
          }
        })();
      },
    });
  };

  const applyFolderListPatch = useCallback((folder: DriveFolder | null | undefined) => {
    if (!folder?.id) return;
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === folder.id ? { ...f, ...folder } : f));
      if (!next.some((f) => f.id === folder.id)) next.push(folder);
      return withFolderOrphanFlags(next);
    });
  }, []);

  const handleRenameFolder = (folderId: number, folderName: string) => {
    if (!creds) return setError('Pilih session dan isi API ID / Hash dulu.');
    const row = folders.find((f) => f.id === folderId);
    const kindLabel = labelDriveItem(row);
    setInputDlg({
      kind: 'rename',
      title: `Ganti nama ${kindLabel}`,
      description: `Nama ${kindLabel.toLowerCase()} di Telegram. Suffix [TD] ditambahkan otomatis.`,
      label: `Nama ${kindLabel}`,
      placeholder: folderName,
      defaultValue: folderName,
      confirmLabel: 'Simpan',
      onConfirm: (name) => {
        void (async () => {
          try {
            setStatusText(`Mengganti nama ${kindLabel.toLowerCase()}…`);
            try {
              await ensureDriveSession(creds);
            } catch {
              /* one-shot */
            }
            const res = await driveRenameFolder(creds, folderId, name);
            applyFolderListPatch(res?.folder);
            await refreshLocations();
            setStatusText(`${kindLabel} diganti nama: ${res?.folder?.name || name}`);
          } catch (e: any) {
            setError(String(e?.message || e || `Gagal ganti nama ${kindLabel.toLowerCase()}`));
            setStatusText('Siap');
          }
        })();
      },
    });
  };

  const handleReparentFolder = (
    folderId: number,
    folderName: string,
    preferredTarget?: { id: number; name: string }
  ) => {
    if (!creds) return setError('Pilih session dan isi API ID / Hash dulu.');

    const runReparent = (parentId: number | null, parentLabel: string) => {
      if (parentId != null && wouldCreateFolderCycle(folders, folderId, parentId)) {
        setError('Tidak bisa memindahkan Drive/Folder ke dalam turunannya sendiri (siklus).');
        return;
      }
      if (parentId === folderId) {
        setError('Folder tidak bisa menjadi induk dirinya sendiri.');
        return;
      }
      void (async () => {
        try {
          setStatusText(
            parentId == null
              ? `Menjadikan “${folderName}” root…`
              : `Memindahkan “${folderName}” → ${parentLabel}…`
          );
          try {
            await ensureDriveSession(creds);
          } catch {
            /* one-shot */
          }
          const res = await driveSetFolderParent(creds, folderId, parentId);
          applyFolderListPatch(res?.folder);
          await refreshLocations();
          setStatusText(
            parentId == null
              ? `“${folderName}” sekarang folder root`
              : `“${folderName}” dipindah ke ${parentLabel}`
          );
        } catch (e: any) {
          setError(String(e?.message || e || 'Gagal memindahkan folder'));
          setStatusText('Siap');
        }
      })();
    };

    if (preferredTarget) {
      setConfirmDlg({
        kind: 'move',
        entity: 'folder',
        names: [folderName],
        detail: `→ folder “${preferredTarget.name}” (metadata parent, bukan salin file)`,
        onConfirm: () => runReparent(preferredTarget.id, preferredTarget.name),
      });
      return;
    }

    const choices = [
      {
        id: null as number | null,
        label: '— Drive root (tanpa induk) —',
        kind: 'drive' as const,
      },
      ...folders
        .filter((f) => f.id !== folderId && !wouldCreateFolderCycle(folders, folderId, f.id))
        .map((f) => ({
          id: f.id as number | null,
          label:
            driveItemKind(f) === 'drive' ? `${f.name} (Drive)` : `${f.name} (Folder)`,
          kind: 'drive' as const,
        })),
    ];
    const row = folders.find((f) => f.id === folderId);
    const kindLabel = labelDriveItem(row);
    setDestPicker({
      title: `Pindah ${kindLabel.toLowerCase()} “${folderName}” ke…`,
      detail:
        'Pilih Drive atau Folder induk. Hierarki via metadata parent= di Telegram (bukan salin file). Kosongkan ke root = jadi Drive.',
      choices,
      onConfirm: (choice) => {
        runReparent(choice.id, choice.label);
      },
    });
  };

  const handleDeleteFolder = (folderId: number, folderName: string) => {
    if (!creds) return setError('Pilih session dan isi API ID / Hash dulu.');
    const row = folders.find((f) => f.id === folderId);
    const kind = driveItemKind(row);
    const kindLabel = labelDriveItem(row);
    const childIds = folderDirectChildIds(folders, folderId);
    const childNames = childIds.map(
      (id) => folders.find((f) => f.id === id)?.name || `Folder ${id}`
    );
    setConfirmDlg({
      kind: 'delete',
      entity: 'folder',
      folderKind: kind,
      names: [folderName],
      // Info only — dialog always cascades (delete all nested content)
      childFolderNames: childNames,
      childFolderCount: childIds.length,
      onConfirm: () => {
        void (async () => {
          try {
            setStatusText(
              childIds.length
                ? `Menghapus ${kindLabel.toLowerCase()} “${folderName}” + isinya…`
                : `Menghapus ${kindLabel.toLowerCase()} “${folderName}”…`
            );
            try {
              await ensureDriveSession(creds);
            } catch {
              /* one-shot fallback */
            }
            // Always cascade: user expects full delete of Drive/Folder + nested content
            await driveDeleteFolder(creds, folderId, {
              cascade: true,
              detachChildren: false,
            });
            if (locationKind === 'drive' && activePeerId === folderId) {
              setLocationKind('saved');
              setActivePeerId(null);
              setTopicFilter(null);
              topicFilterRef.current = null;
              setFiles([]);
            }
            await refreshLocations();
            setStatusText(`${kindLabel} dihapus: ${folderName}`);
          } catch (e: any) {
            setError(String(e?.message || e || `Gagal menghapus ${kindLabel.toLowerCase()}`));
            setStatusText('Siap');
          }
        })();
      },
    });
  };

  /**
   * Buat folder di dalam Drive/Folder: pilih induk dulu (dari Saved Messages / canvas).
   * "Buat folder di sini" memakai handleCreateFolder({ parentId: current }).
   */
  const handleCreateSubfolder = () => {
    if (!creds) return setError('Pilih session dan isi API ID / Hash dulu.');
    if (!folders.length) {
      setError(
        'Belum ada Drive [TD]. Buat Drive root dulu (+ Drive), lalu buat Folder di dalamnya.'
      );
      return;
    }
    setDestPicker({
      title: 'Pilih Drive/Folder induk',
      detail:
        'Folder baru akan muncul di bawah Drive atau Folder yang dipilih (folder dalam folder diperbolehkan).',
      choices: folders.map((f) => ({
        id: f.id,
        label:
          driveItemKind(f) === 'drive'
            ? `${f.name} (Drive)`
            : `${f.name} (Folder)`,
        kind: 'drive' as const,
      })),
      onConfirm: (choice) => {
        if (choice.id == null) {
          setError('Pilih Drive atau Folder sebagai induk.');
          return;
        }
        handleCreateFolder({ parentId: choice.id });
      },
    });
  };

  const runUploadPaths = async (
    paths: string[],
    opts?: { targetFolderId?: number | null; targetLabel?: string; skipTopic?: boolean }
  ) => {
    if (!creds || !paths.length) return;
    if (isTransferJobActive() || transfer.active) {
      setError('Transfer lain masih berjalan. Stop dulu di Transfer Manager, lalu unggah lagi.');
      openTransferManager();
      return;
    }
    // Normalize Windows paths (quotes / long-path prefixes sometimes leak from DnD)
    const cleanPaths = paths
      .map((p) => String(p || '').trim().replace(/^["']|["']$/g, ''))
      .filter((p) => p && (p.includes('\\') || p.includes('/') || /^[a-zA-Z]:/.test(p)));
    if (!cleanPaths.length) {
      setError('Path file tidak valid. Coba lagi drop dari File Explorer.');
      return;
    }
    const uploadPeer =
      opts && 'targetFolderId' in (opts || {}) ? (opts!.targetFolderId as number | null) : peerId;
    const destLabel =
      opts?.targetLabel ||
      (uploadPeer == null ? 'Saved Messages' : breadcrumb) ||
      'Drive';
    const label = `→ ${destLabel}`;
    const names = cleanPaths.map((p) => p.split(/[/\\]/).pop() || p);
    if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
    void clearDriveTransferPause();
    setTransfer(
      seedTransferSession({
        direction: 'upload',
        names,
        label,
      })
    );
    setTransferMinimized(false);
    localStorage.setItem(LS_TM_MIN, '0');
    setError(null);
    setStatusText(`Mengunggah ${names[0]}${names.length > 1 ? ` (+${names.length - 1})` : ''} ${label}…`);
    debugLog('drive', 'upload start', { count: cleanPaths.length, dest: destLabel });
    setTransfer((t) => ({
      ...t,
      banner: 'Menyiapkan unggahan (session eksklusif)…',
      overallPercent: Math.max(t.overallPercent, 1),
    }));
    try {
      const defaultCap = (transferSettings.globalCaption || '').trim();
      // Default caption = basename WITHOUT extension when possible.
      // After HQ re-encode (webm→mp4) the document filename carries the real ext;
      // a caption like "clip.webm" would otherwise stick as the Drive display name.
      const filesPayload = cleanPaths.map((path) => {
        const base = path.split(/[/\\]/).pop() || path;
        const stem = base.includes('.') ? base.replace(/\.[^.]+$/, '') : base;
        return {
          path,
          caption: defaultCap || stem || base,
        };
      });
      const options: Record<string, unknown> = {
        quality_mode: transferSettings.forceDocumentDefault
          ? 'ORIGINAL'
          : transferSettings.qualityMode,
        concurrency: transferSettings.uploadConcurrency,
        group_as_album: transferSettings.groupAsAlbum,
        silent: transferSettings.silent,
        spoiler: transferSettings.spoiler,
        global_caption: (transferSettings.globalCaption || '').trim() || undefined,
        reencodeHardware: transferSettings.reencodeHardware,
        reencodePreset: transferSettings.reencodePreset,
      };
      // Upload into selected forum topic only when targeting current peer
      if (!opts?.skipTopic && sameDriveLocation(uploadPeer, peerId)) {
        const tid = topicFilterRef.current;
        if (tid != null && tid > 0) options.topic_id = tid;
      }
      const filesJson = await writeWorkerJson('drive_files', filesPayload);
      const optionsJson = await writeWorkerJson('drive_opts', options);
      let uploadError: string | null = null;
      let uploadedIds: number[] = [];
      let exitCode: number | null = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          driveUploadSpawn(creds, uploadPeer, filesJson, optionsJson, {
            onStdoutLine: (line) => {
              const text = String(line);
              onTransferStdout(text);
              if (text.includes('[JSON_OUTPUT]')) {
                const data = parseJsonOutput(text);
                if (data?.status === 'error') {
                  uploadError = data.error || 'Upload failed';
                  setError(uploadError);
                } else if (data && Array.isArray((data as any).items)) {
                  uploadedIds = ((data as any).items as any[])
                    .map((it) => Number(it?.message_id))
                    .filter((n) => Number.isFinite(n) && n > 0);
                }
              }
            },
            onStderrLine: (line) => onTransferStdout(String(line)),
            onClose: (code) => {
              exitCode = code;
              resolve();
            },
          })
            .then((child) => {
              childRef.current = child;
            })
            .catch(reject);
        });
      } finally {
        void deleteWorkerTempFile(filesJson);
        void deleteWorkerTempFile(optionsJson);
        childRef.current = null;
      }
      if (sameDriveLocation(uploadPeer, peerId)) {
        // Force refresh files after upload so media and thumbnails are visible immediately
        await refreshFiles();
      }
      if (uploadedIds.length) {
        setStatusText(
          `Upload selesai${label}: ${names.join(', ')} · ${uploadedIds.length} msg`
        );
      }
      // Prefer committed message ids over process exit code: worker can exit
      // non-zero after Telegram already accepted the file (false "gagal").
      const committed = uploadedIds.length > 0;
      if (committed) {
        setStatusText(
          `Upload selesai${label}: ${names.join(', ')} · ${uploadedIds.length} msg`
        );
        if (uploadError || (exitCode != null && exitCode !== 0)) {
          // Soft warning only — do not mark Transfer Manager as failed
          setError(
            `Upload terkirim, tetapi worker mengakhiri dengan peringatan` +
              (exitCode != null && exitCode !== 0 ? ` (exit ${exitCode})` : '') +
              (uploadError ? `: ${uploadError}` : '')
          );
        }
        setTransfer((t) => markTransferFinished(t, 'done'));
      } else if (uploadError || (exitCode != null && exitCode !== 0)) {
        setStatusText(`Upload gagal${label}`);
        if (!uploadError && exitCode) setError(`Upload exit code ${exitCode}`);
        setTransfer((t) => markTransferFinished(t, 'failed'));
      } else {
        setStatusText(`Upload selesai${label}: ${names.join(', ')}`);
        setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      // If events already marked items done with message ids, keep success UI
      setTransfer((t) => {
        const anyDone = t.items.some((i) => i.status === 'done');
        if (anyDone) {
          setStatusText(`Upload selesai${label} (peringatan: ${msg})`);
          return markTransferFinished(t, 'done');
        }
        setError(msg);
        setStatusText('Upload gagal');
        return markTransferFinished(t, 'failed');
      });
    } finally {
      void clearDriveTransferPause();
      setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
      scheduleTransferHide();
    }
  };

  const handleUpload = async () => {
    if (!creds) return setError('Select session and set API credentials.');
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ multiple: true, title: 'Upload to Drive' });
      const paths: string[] = [];
      if (typeof selected === 'string') paths.push(selected);
      else if (Array.isArray(selected)) paths.push(...selected.filter(Boolean));
      if (!paths.length) return;
      await runUploadPaths(paths);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const runDownloadSelected = async () => {
    if (!creds || !selectedIds.length) return;
    if (isTransferJobActive() || transfer.active) {
      setError('Transfer lain masih berjalan. Stop dulu di Transfer Manager.');
      openTransferManager();
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, multiple: false, title: 'Download folder' });
      const saveDir = typeof dir === 'string' ? dir : Array.isArray(dir) ? dir[0] : null;
      if (!saveDir) return;
      const names = selectedIds.map((id) => {
        const f = files.find((x) => x.id === id);
        return f?.name || `msg_${id}`;
      });
      setLastDownloadDir(saveDir);
      lastDownloadRetryRef.current = {
        ids: [...selectedIds],
        saveDir,
        names: [...names],
      };
      if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
      void clearDriveTransferPause();
      downloadArtifactsRef.current = new Set();
      setTransfer(
        seedTransferSession({
          direction: 'download',
          names,
          label: `${selectedIds.length} file → folder`,
        })
      );
      setTransferMinimized(false);
      localStorage.setItem(LS_TM_MIN, '0');
      const idsJson = await writeWorkerJson('drive_ids', selectedIds);
      const optsJson = await writeWorkerJson('drive_dl_opts', {
        concurrency: transferSettings.downloadConcurrency,
      });
      let exitCode: number | null = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          driveDownloadBatchSpawn(creds, peerId, idsJson, saveDir, optsJson, {
            onStdoutLine: (line) => onTransferStdout(String(line)),
            onStderrLine: (line) => onTransferStdout(String(line)),
            onClose: (code) => {
              exitCode = code;
              resolve();
            },
          })
            .then((c) => {
              childRef.current = c;
            })
            .catch(reject);
        });
      } finally {
        void deleteWorkerTempFile(idsJson);
        void deleteWorkerTempFile(optsJson);
        childRef.current = null;
      }
      if (exitCode != null && exitCode !== 0) {
        setError(`Download exit code ${exitCode}`);
        setStatusText('Download gagal');
        setTransfer((t) => markTransferFinished(t, 'failed'));
      } else {
        if (transferSettings.notifyDownloadDone) {
          setStatusText(`Downloaded to ${saveDir}`);
        } else {
          setStatusText('Download selesai');
        }
        setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
      }
    } catch (e: any) {
      setError(String(e?.message || e));
      setTransfer((t) => markTransferFinished(t, 'failed'));
    } finally {
      void clearDriveTransferPause();
      setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
      scheduleTransferHide();
    }
  };

  const handleDownloadSelected = () => {
    if (!creds || !selectedIds.length) return;
    const names = selectedIds.map((id) => {
      const f = files.find((x) => x.id === id);
      return f?.name || `msg_${id}`;
    });
    setConfirmDlg({
      kind: 'download',
      names,
      onConfirm: () => {
        void runDownloadSelected();
      },
    });
  };

  const runDownloadOne = async (file: DriveFile) => {
    setSelectedIds([file.id]);
    selectionAnchorRef.current = file.id;
    if (!creds) return;
    if (isTransferJobActive() || transfer.active) {
      setError('Transfer lain masih berjalan. Stop dulu di Transfer Manager.');
      openTransferManager();
      return;
    }
    try {
      const defaultName = file.name.replace(/[<>:"/\\|?*]/g, '_');
      const { save } = await import('@tauri-apps/plugin-dialog');
      const savePath = await save({ defaultPath: defaultName, title: 'Simpan file' });
      if (!savePath) return;
      if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
      void clearDriveTransferPause();
      downloadArtifactsRef.current = new Set([savePath]);
      setTransfer(
        seedTransferSession({
          direction: 'download',
          names: [file.name],
          label: file.name,
          totals: file.size > 0 ? [file.size] : undefined,
        })
      );
      setTransferMinimized(false);
      localStorage.setItem(LS_TM_MIN, '0');
      let exitCode: number | null = 0;
      await new Promise<void>((resolve, reject) => {
        driveDownloadSpawn(creds, file.id, peerId, savePath, {
          onStdoutLine: (line) => onTransferStdout(String(line)),
          onStderrLine: (line) => onTransferStdout(String(line)),
          onClose: (code) => {
            exitCode = code;
            resolve();
          },
        })
          .then((c) => {
            childRef.current = c;
          })
          .catch(reject);
      });
      childRef.current = null;
      if (exitCode != null && exitCode !== 0) {
        setError(`Download exit code ${exitCode}`);
        setTransfer((t) => markTransferFinished(t, 'failed'));
      } else {
        setStatusText(`Tersimpan: ${file.name}`);
        setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
      }
    } catch (e: any) {
      setError(String(e?.message || e));
      setTransfer((t) => markTransferFinished(t, 'failed'));
    } finally {
      void clearDriveTransferPause();
      setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
      scheduleTransferHide();
    }
  };

  const downloadOne = (file: DriveFile) => {
    if (!creds) return;
    setConfirmDlg({
      kind: 'download',
      names: [file.name],
      onConfirm: () => {
        void runDownloadOne(file);
      },
    });
  };

  const openOneInSystem = async (file: DriveFile) => {
    if (!creds) return setError('Pilih session dan API credentials dulu.');
    try {
      setStatusText(`Membuka ${file.name}…`);
      const { openDriveFileInSystem } = await import('../lib/documentOpen');
      await openDriveFileInSystem(creds, file, peerId);
      setStatusText(`Dibuka: ${file.name}`);
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatusText('Siap');
    }
  };

  const openOneWithApp = async (file: DriveFile) => {
    if (!creds) return setError('Pilih session dan API credentials dulu.');
    try {
      setStatusText(`Buka dengan… ${file.name}`);
      const { openDriveFileWithApp } = await import('../lib/documentOpen');
      await openDriveFileWithApp(creds, file, peerId, null, (p) => {
        setStatusText(p.message);
      });
      setStatusText('Dialog Windows dibuka — pilih aplikasi');
      window.setTimeout(() => setStatusText('Siap'), 4000);
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatusText('Siap');
    }
  };

  const revealOne = async (file: DriveFile) => {
    if (!creds) return setError('Pilih session dan API credentials dulu.');
    try {
      const { ensureLocalDocument, revealInFolder } = await import('../lib/documentOpen');
      const path = await ensureLocalDocument(creds, file, peerId);
      await revealInFolder(path);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const executeDeleteIds = useCallback(
    async (ids: number[]) => {
      if (!creds || !ids.length) return;
      const n = ids.length;
      try {
        setStatusText(n === 1 ? 'Menghapus…' : `Menghapus ${n} file…`);
        const res = await driveDeleteBatch(creds, ids, peerId);
        const failed = Array.isArray((res as any)?.failed) ? (res as any).failed : [];
        setSelectedIds([]);
        selectionAnchorRef.current = null;
        await refreshFiles();
        if (failed.length) {
          setError(
            `Hapus sebagian gagal (${failed.length}): ${
              failed[0]?.error || failed[0]?.id || 'error'
            }`
          );
          setStatusText(
            `Terhapus ${n - failed.length}/${n}${failed.length ? ` · ${failed.length} gagal` : ''}`
          );
        } else {
          setStatusText(n === 1 ? 'File dihapus' : `${n} file dihapus`);
        }
      } catch (e: any) {
        setError(String(e?.message || e));
      }
    },
    [creds, peerId, refreshFiles]
  );

  const handleDeleteIds = useCallback(
    (ids: number[]) => {
      if (!creds || !ids.length) return;
      const names = ids.map((id) => {
        const f = files.find((x) => x.id === id);
        return f?.name || `msg_${id}`;
      });
      setConfirmDlg({
        kind: 'delete',
        names,
        onConfirm: () => {
          void executeDeleteIds(ids);
        },
      });
    },
    [creds, files, executeDeleteIds]
  );

  const handleRename = (file: DriveFile) => {
    if (!creds) return;
    setInputDlg({
      kind: 'rename',
      title: 'Ubah nama file',
      description: 'Nama ditampilkan di Drive (caption pesan Telegram).',
      label: 'Nama baru',
      defaultValue: driveFileDisplayName(file),
      placeholder: driveFileDisplayName(file),
      confirmLabel: 'Simpan',
      onConfirm: (name) => {
        if (name === file.name) return;
        void (async () => {
          try {
            await driveRename(creds, file.id, peerId, name);
            await refreshFiles();
            setStatusText('Nama diperbarui');
          } catch (e: any) {
            setError(String(e?.message || e));
          }
        })();
      },
    });
  };

  const handleBulkRename = useCallback(
    (pairs: { id: number; newName: string }[]) => {
      if (!creds || !pairs.length) return;
      setToolsOpen(false);
      void (async () => {
        let ok = 0;
        let fail = 0;
        setStatusText(`Bulk rename 0/${pairs.length}…`);
        for (const p of pairs) {
          try {
            await driveRename(creds, p.id, peerId, p.newName);
            ok++;
          } catch {
            fail++;
          }
          setStatusText(`Bulk rename ${ok + fail}/${pairs.length}…`);
        }
        await refreshFiles();
        setStatusText(
          fail
            ? `Rename selesai: ${ok} ok, ${fail} gagal`
            : `Rename ${ok} file selesai`
        );
      })();
    },
    [creds, peerId, refreshFiles]
  );

  const handleSmartCopy = useCallback(
    async (opts: {
      messageIds: number[];
      toFolderId: number | null;
      targetLabel: string;
      skipDuplicates: boolean;
    }) => {
      if (!creds || !opts.messageIds.length) return;
      setToolsOpen(false);
      let ids = opts.messageIds;
      let skipped = 0;
      if (opts.skipDuplicates) {
        try {
          setStatusText('Cek duplikat di tujuan…');
          const destRes = await driveListFiles(creds, opts.toFolderId, { pageSize: 200 });
          const destFiles = [...((destRes?.files || []) as DriveFile[])];
          // Also pull more pages lightly
          let offset = destRes?.next_offset_id as number | null | undefined;
          let pages = 0;
          while (offset && pages < 4) {
            pages++;
            const more = await driveListFiles(creds, opts.toFolderId, {
              pageSize: 200,
              offsetId: offset,
            });
            const batch = (more?.files || []) as DriveFile[];
            destFiles.push(...batch);
            offset = more?.next_offset_id;
            if (!batch.length) break;
          }
          const sources = files.filter((f) => ids.includes(f.id));
          const { toCopy, skipped: sk } = filterSkipDuplicates(sources, destFiles);
          skipped = sk.length;
          ids = toCopy.map((f) => f.id);
          if (!ids.length) {
            setStatusText(
              skipped
                ? `Semua ${skipped} file sudah ada di tujuan (skip duplikat)`
                : 'Tidak ada file untuk disalin'
            );
            return;
          }
        } catch (e: any) {
          setError(`Gagal cek duplikat: ${String(e?.message || e)}`);
          // continue without skip
        }
      }
      if (skipped) {
        setStatusText(`Skip ${skipped} duplikat · salin ${ids.length}…`);
      }
      runMoveCopyRef.current(ids, peerId, opts.toFolderId, opts.targetLabel, {
        deleteSource: false,
        topicId: null,
      });
      if (skipped) {
        setStatusText(`Salin ${ids.length} file (skip ${skipped} duplikat)`);
      }
    },
    [creds, files, peerId]
  );

  const locationLabel = useMemo(() => {
    if (locationKind === 'saved') return 'Saved Messages';
    if (locationKind === 'drive') {
      return (
        folders.find((f) => f.id === activePeerId)?.name ||
        `Drive ${activePeerId}`
      );
    }
    return chats.find((c) => c.id === activePeerId)?.name || `Chat ${activePeerId}`;
  }, [locationKind, activePeerId, folders, chats]);

  const spaceHint = useMemo(() => {
    // Prefer location total_bytes (unique media_stats when accurate)
    if (statsAccurate && totalBytes != null && totalBytes >= 0) {
      const sizeStr = formatDriveBytes(totalBytes);
      return sizeStr;
    }
    const u = computeSpaceUsage(files);
    if (!u.fileCount) return statsLoading ? 'Menghitung…' : null;
    const sizeStr = formatDriveBytes(u.totalBytes);
    if (statsLoading) return `${sizeStr}+…`;
    if (filesHasMore || (totalFileCount != null && files.length < totalFileCount)) {
      return `${sizeStr}+`;
    }
    return sizeStr;
  }, [files, totalFileCount, totalBytes, statsLoading, filesHasMore, statsAccurate]);

  const currentPinned = useMemo(
    () =>
      !!session &&
      isDrivePinned(session, {
        kind: locationKind,
        id: locationKind === 'saved' ? null : activePeerId,
      }),
    [session, locationKind, activePeerId, pins]
  );

  const goNav = useCallback((dir: 'back' | 'forward') => {
    const h = dir === 'back' ? navBack(navHist) : navForward(navHist);
    if (!h) return;
    navSkipRef.current = true;
    setNavHist(h);
    const loc = navCurrent(h);
    setLocationKind(loc.kind);
    setActivePeerId(loc.id);
    setTopicFilter(null);
    topicFilterRef.current = null;
  }, [navHist]);

  /** Build destination list for move/send picker (Saved + TD folders + chats). */
  const buildMoveDestinations = useCallback((): DriveDestChoice[] => {
    return [
      { id: null, label: 'Saved Messages', isForum: false, kind: 'saved' },
      ...folders
        .filter((f) => f.id !== peerId)
        .map((f) => ({
          id: f.id as number | null,
          label: f.name,
          isForum: false,
          kind: 'drive' as const,
        })),
      ...chats
        .filter((c) => c.id !== peerId)
        .slice(0, 120)
        .map((c) => ({
          id: c.id as number | null,
          label: c.name,
          isForum: !!c.is_forum,
          kind: 'chat' as const,
        })),
    ];
  }, [folders, chats, peerId]);

  // Remember recent locations when user navigates (for sidebar quick jump).
  // ALWAYS bound to active session — never write into another account's list.
  const recentsSessionRef = useRef(session);
  useEffect(() => {
    if (!session) return;
    // Skip the first effect cycle after session identity changes so a stale
    // locationKind/peer from the previous account cannot land in B's Terbaru
    // (even if loadSessions or boot race left location uncleared for one paint).
    if (recentsSessionRef.current !== session) {
      recentsSessionRef.current = session;
      lastRecentKeyRef.current = '';
      return;
    }
    if (locationKind !== 'saved' && activePeerId == null) return;
    // Never push a peer that is not known in THIS session's lists (foreign PeerChannel).
    if (
      !shouldRecordDriveRecent({
        session,
        locationKind,
        peerId: locationKind === 'saved' ? null : activePeerId,
        knownPeerIds: [...chats.map((c) => c.id), ...folders.map((f) => f.id)],
      })
    ) {
      return;
    }
    const k = `${session}:${locationKind}:${activePeerId ?? 'me'}`;
    let label = 'Saved Messages';
    if (locationKind === 'drive') {
      label =
        folders.find((f) => f.id === activePeerId)?.name ||
        chats.find((c) => c.id === activePeerId)?.name ||
        `Folder ${activePeerId}`;
    } else if (locationKind === 'chat') {
      label =
        chats.find((c) => c.id === activePeerId)?.name ||
        folders.find((f) => f.id === activePeerId)?.name ||
        `Chat ${activePeerId}`;
    }
    // Re-push when label becomes real (folders/chats loaded) even if same key
    const generic = /^Folder |^Chat /.test(label);
    if (lastRecentKeyRef.current === k && generic) return;
    if (lastRecentKeyRef.current === k && !generic) {
      // upgrade label once
      setRecents(
        pushDriveRecent(session, {
          kind: locationKind,
          id: locationKind === 'saved' ? null : activePeerId,
          label,
        })
      );
      return;
    }
    lastRecentKeyRef.current = k;
    setRecents(
      pushDriveRecent(session, {
        kind: locationKind,
        id: locationKind === 'saved' ? null : activePeerId,
        label,
      })
    );
  }, [session, locationKind, activePeerId, folders, chats]);

  // Auto-clear ephemeral status (stuck "Drop dibatalkan" etc.)
  useEffect(() => {
    if (mediaDragActive) return;
    if (!/^(Drop dibatalkan|Drag dibatalkan|Sudah di lokasi)/i.test(statusText)) return;
    const t = window.setTimeout(() => {
      setStatusText((s) =>
        /^(Drop dibatalkan|Drag dibatalkan|Sudah di lokasi)/i.test(s) ? 'Siap' : s
      );
    }, 2200);
    return () => window.clearTimeout(t);
  }, [statusText, mediaDragActive]);

  // Keyboard: Ctrl/Cmd+A/F/D/X/C/V, F2, Enter, arrows, Alt+←/→, Escape, Delete, F5
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      // Preview owns Escape / arrows while open (incl. when tools panel is behind)
      if (previewFile) return;
      // Confirm / input / dest pickers own Escape
      if (confirmDlg || inputDlg || destPicker) return;
      if (contextMenu) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setContextMenu(null);
        }
        return;
      }
      if (toolsOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setToolsOpen(false);
          return;
        }
        // Toggle close with same shortcut used to open
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
          e.preventDefault();
          setToolsOpen(false);
          return;
        }
        // Block global Drive shortcuts while tools panel is open
        return;
      }
      // Ctrl+F → focus file search (even from another input except location search hijack)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const el = document.querySelector('.td-search') as HTMLInputElement | null;
        el?.focus();
        el?.select();
        return;
      }
      // Ctrl+Shift+T → tools
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        setToolsOpen(true);
        return;
      }
      // Alt+Left / Alt+Right — location history
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') {
          const h = navBack(navHist);
          if (h) {
            navSkipRef.current = true;
            setNavHist(h);
            const loc = navCurrent(h);
            setLocationKind(loc.kind);
            setActivePeerId(loc.id);
            setTopicFilter(null);
            topicFilterRef.current = null;
          }
        } else {
          const h = navForward(navHist);
          if (h) {
            navSkipRef.current = true;
            setNavHist(h);
            const loc = navCurrent(h);
            setLocationKind(loc.kind);
            setActivePeerId(loc.id);
            setTopicFilter(null);
            topicFilterRef.current = null;
          }
        }
        return;
      }
      if (inField) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        handleSelectAllDisplayed();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDownloadSelected();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          const names = selectedIds.map((id) => files.find((f) => f.id === id)?.name || `msg_${id}`);
          setDriveClipboard({
            mode: 'cut',
            messageIds: [...selectedIds],
            fromFolderId: peerId,
            names,
            at: Date.now(),
          });
          setStatusText(`Cut ${selectedIds.length} file — Ctrl+V di lokasi tujuan`);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !e.shiftKey) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          const names = selectedIds.map((id) => files.find((f) => f.id === id)?.name || `msg_${id}`);
          setDriveClipboard({
            mode: 'copy',
            messageIds: [...selectedIds],
            fromFolderId: peerId,
            names,
            at: Date.now(),
          });
          setStatusText(`Copy ${selectedIds.length} file — Ctrl+V di lokasi tujuan`);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        const clip = getDriveClipboard();
        if (clip && clip.messageIds.length) {
          e.preventDefault();
          pasteMoveRef.current(clip);
          if (clip.mode === 'copy') {
            setStatusText('Pilih Salin di dialog konfirmasi');
          }
        }
        return;
      }
      if (e.key === 'F2' && selectedIds.length === 1) {
        e.preventDefault();
        const f = files.find((x) => x.id === selectedIds[0]);
        if (f) handleRename(f);
        return;
      }
      if (e.key === 'Enter' && selectedIds.length === 1) {
        e.preventDefault();
        const f = files.find((x) => x.id === selectedIds[0]);
        if (f) setPreviewFile(f);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        const ids = getDisplayedIds();
        if (!ids.length) return;
        e.preventDefault();
        const cur =
          selectedIds.length === 1
            ? ids.indexOf(selectedIds[0])
            : selectionAnchorRef.current != null
              ? ids.indexOf(selectionAnchorRef.current)
              : -1;
        const delta =
          e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(ids.length - 1, (cur < 0 ? 0 : cur) + delta));
        const nextId = ids[nextIdx];
        if (e.shiftKey && selectionAnchorRef.current != null) {
          const result = applyClickSelection({
            displayedIds: ids,
            selectedIds,
            anchorId: selectionAnchorRef.current,
            clickedId: nextId,
            ctrlKey: false,
            metaKey: false,
            shiftKey: true,
          });
          setSelectedIds(result.selectedIds);
        } else {
          setSelectedIds([nextId]);
          selectionAnchorRef.current = nextId;
        }
        return;
      }
      if (e.key === 'Escape') {
        // Drag cancel / modal dialogs own Escape first
        if (isInternalMediaDragActive()) return;
        // confirm / input / dest / context already handled above
        if (drawerOpen) {
          closeDrawer();
          return;
        }
        clearSelection();
        setError(null);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.key === 'Backspace' && selectedIds.length === 0) {
          // Navigate up: parent of drive folder if nested
          if (locationKind === 'drive' && activePeerId != null) {
            const folder = folders.find((f) => f.id === activePeerId);
            if (folder?.parent_id != null) {
              e.preventDefault();
              setLocationKind('drive');
              setActivePeerId(folder.parent_id);
              return;
            }
          }
          return;
        }
        if (selectedIds.length > 0) {
          e.preventDefault();
          void handleDeleteIds(selectedIds);
        }
        return;
      }
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault();
        void refreshFiles();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    handleSelectAllDisplayed,
    clearSelection,
    previewFile,
    contextMenu,
    drawerOpen,
    closeDrawer,
    selectedIds,
    refreshFiles,
    handleDeleteIds,
    confirmDlg,
    inputDlg,
    destPicker,
    toolsOpen,
    navHist,
    files,
    peerId,
    locationKind,
    activePeerId,
    folders,
    getDisplayedIds,
    handleDownloadSelected,
    handleRename,
  ]);

  // Desktop: drawer is unused — clear sticky open/collapsed clash after resize
  useEffect(() => {
    const onResize = () => {
      if (typeof window === 'undefined') return;
      if (window.innerWidth > 900 && drawerOpen) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [drawerOpen]);

  /** Abort flag for sequential move/forward batch (Stop di TM / unmount). */
  const moveAbortRef = useRef<{ cancelled: boolean } | null>(null);
  const moveActiveRef = useRef(false);

  const cancelMoveBatch = useCallback(() => {
    if (moveAbortRef.current) moveAbortRef.current.cancelled = true;
  }, []);

  type MoveRunOpts = {
    deleteSource?: boolean;
    topicId?: number | null;
  };

  const moveMessageIds = async (
    messageIds: number[],
    fromFolderId: number | null,
    toFolderId: number | null,
    targetLabel: string,
    opts?: MoveRunOpts
  ) => {
    if (!creds || !messageIds.length) return;
    if (sameDriveLocation(fromFolderId, toFolderId) && !opts?.topicId) {
      setStatusText('Sudah di lokasi ini — pilih chat/folder lain');
      return;
    }
    if (isTransferJobActive() || transfer.active || moveActiveRef.current) {
      setError('Transfer/pindah masih berjalan — Stop dulu di Transfer Manager.');
      openTransferManager();
      return;
    }
    const deleteSource = opts?.deleteSource !== false;
    const topicId =
      opts?.topicId != null && Number(opts.topicId) > 0 ? Number(opts.topicId) : null;
    const verb = deleteSource ? 'Memindahkan' : 'Menyalin';
    const modeLabel = deleteSource ? 'Pindah' : 'Salin';
    setError(null);
    setStatusText(`${verb} ${messageIds.length} file → ${targetLabel}…`);
    if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
    const moveNames = messageIds.map((id) => {
      const f = files.find((x) => x.id === id);
      return f?.name || `msg_${id}`;
    });
    moveAbortRef.current = { cancelled: false };
    moveActiveRef.current = true;
    setTransfer(
      seedTransferSession({
        direction: 'move',
        names: moveNames,
        label: `${modeLabel} → ${targetLabel}${topicId ? ' · topik' : ''}`,
      })
    );
    setTransferMinimized(false);
    localStorage.setItem(LS_TM_MIN, '0');
    let done = 0;
    const failed: string[] = [];
    let cancelled = false;
    try {
      for (let i = 0; i < messageIds.length; i++) {
        if (moveAbortRef.current?.cancelled) {
          cancelled = true;
          // Mark remaining as cancelled
          setTransfer((t) => {
            const items = t.items.map((it, idx) =>
              idx >= i && it.status !== 'done' && it.status !== 'failed'
                ? { ...it, status: 'cancelled' as const }
                : it
            );
            return { ...t, items, active: false, paused: false, speed_mb_s: 0 };
          });
          break;
        }
        const id = messageIds[i];
        setTransfer((t) =>
          applyTransferEvent(t, {
            type: 'StudioItemStarted',
            index: i,
            path: moveNames[i],
          })
        );
        try {
          await driveMove(creds, id, fromFolderId, toFolderId, {
            deleteSource,
            topicId,
          });
          done += 1;
          setTransfer((t) =>
            applyTransferEvent(t, {
              type: 'StudioItemDone',
              index: i,
              status: 'done',
            })
          );
        } catch (e: any) {
          failed.push(`${id}: ${e?.message || e}`);
          setTransfer((t) =>
            applyTransferEvent(t, {
              type: 'StudioItemDone',
              index: i,
              status: 'failed',
              error: String(e?.message || e),
            })
          );
        }
        setTransfer((t) => ({
          ...t,
          overallPercent: Math.round((100 * (i + 1)) / messageIds.length),
          transferred: i + 1,
          total: messageIds.length,
        }));
      }
      if (!cancelled) {
        setSelectedIds([]);
        selectionAnchorRef.current = null;
        await refreshFiles();
      }
      if (cancelled) {
        setStatusText(
          `Dibatalkan · ${done}/${messageIds.length} terkirim${
            failed.length ? ` · ${failed.length} gagal` : ''
          }`
        );
        setTransfer((t) => markTransferFinished(t, 'cancelled'));
      } else if (!done && failed.length) {
        setError(
          `Gagal kirim ke “${targetLabel}”: ${failed[0]}. ` +
            'Pastikan akun boleh kirim media di chat itu (bukan read-only / di-ban / slowmode).'
        );
        setStatusText(`${modeLabel} gagal`);
        setTransfer((t) => markTransferFinished(t, 'failed'));
      } else {
        setStatusText(
          done
            ? `${modeLabel} ${done} file → ${targetLabel}${
                failed.length ? ` · ${failed.length} gagal` : ''
              }`
            : `${modeLabel} gagal`
        );
        if (failed.length) {
          setError(`Sebagian gagal (${failed.length}): ${failed[0]}`);
        }
        setTransfer((t) =>
          markTransferFinished(t, done && !failed.length ? 'done' : done ? 'done' : 'failed')
        );
      }
    } catch (e: any) {
      setError(String(e?.message || e));
      setTransfer((t) => markTransferFinished(t, 'failed'));
    } finally {
      moveActiveRef.current = false;
      moveAbortRef.current = null;
      setTransfer((t) => (t.active ? markTransferFinished(t, done ? 'done' : 'failed') : t));
      scheduleTransferHide();
    }
  };

  /**
   * After drop / pick destination: confirm mode (move|copy) + forum topic if needed.
   */
  const requestMoveToTarget = useCallback(
    async (
      messageIds: number[],
      fromFolderId: number | null,
      toFolderId: number | null,
      targetLabel: string,
      meta?: { isForum?: boolean }
    ) => {
      try {
        (window as unknown as { __lastMoveReq?: unknown }).__lastMoveReq = {
          messageIds,
          fromFolderId,
          toFolderId,
          targetLabel,
          hasCreds: !!creds,
          transferActive: !!(transfer.active || moveActiveRef.current),
          exclusiveJob: isTransferJobActive(),
          t: Date.now(),
        };
      } catch {
        /* ignore */
      }
      if (!creds || !messageIds.length) {
        setError(!creds ? 'Session/API belum siap — pilih session dulu.' : 'Tidak ada file untuk dipindah.');
        return;
      }
      if (sameDriveLocation(fromFolderId, toFolderId)) {
        setStatusText('Sudah di lokasi ini — pilih chat/folder lain');
        setError(null);
        return;
      }
      // Only block if a MOVE is already running — exclusive upload/download should not
      // swallow the confirm dialog (user can still cancel / queue after confirm).
      if (moveActiveRef.current) {
        setError('Pindah masih berjalan — tunggu selesai atau Stop di Transfer Manager.');
        openTransferManager();
        return;
      }
      const names = messageIds.map((id) => {
        const f = files.find((x) => x.id === id);
        return f?.name || `msg_${id}`;
      });
      const chatMeta = toFolderId != null ? chats.find((c) => c.id === toFolderId) : null;
      let isForum = !!(meta?.isForum || chatMeta?.is_forum);
      const maybeNeedsTopics = isForum || chatMeta?.type === 'group';

      const buildState = (topicsList: DriveTopic[], forum: boolean): DriveConfirmState => ({
        kind: 'move',
        names,
        detail: `→ ${targetLabel}`,
        isForum: forum,
        topics: topicsList,
        onConfirm: (choice) => {
          if (isTransferJobActive() || transfer.active || moveActiveRef.current) {
            setError('Transfer/pindah masih berjalan — Stop dulu di Transfer Manager.');
            openTransferManager();
            return;
          }
          const moveChoice =
            choice && 'mode' in choice
              ? choice
              : { mode: 'move' as const, topicId: null as number | null };
          void moveMessageIds(messageIds, fromFolderId, toFolderId, targetLabel, {
            deleteSource: moveChoice.mode !== 'copy',
            topicId: moveChoice.topicId ?? null,
          });
        },
      });

      // Dual path: React setState + external store (native DnD / useSyncExternalStore)
      const openMoveDlg = (s: DriveConfirmState) => {
        openDriveMoveConfirm(s);
        setConfirmDlg(s);
      };
      openMoveDlg(buildState([], isForum));
      setStatusText('Siap');
      try {
        (window as unknown as { __lastMoveReq?: Record<string, unknown> }).__lastMoveReq = {
          ...((window as unknown as { __lastMoveReq?: Record<string, unknown> }).__lastMoveReq || {}),
          dialogOpened: true,
          isForum,
          t2: Date.now(),
          overlayNow: !!document.querySelector('.td-confirm-overlay'),
        };
      } catch {
        /* ignore */
      }

      if (toFolderId != null && maybeNeedsTopics) {
        try {
          const res = await driveListTopics(creds, toFolderId);
          const topicsList = (res?.topics || []) as DriveTopic[];
          if (res?.is_forum || topicsList.length) isForum = true;
          if (topicsList.length || isForum) {
            openMoveDlg(buildState(topicsList, isForum));
          }
        } catch {
          /* keep dialog without topics */
        }
      }
    },
    // moveMessageIds closes over latest state; openTransferManager stable enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [creds, files, chats, transfer.active, openTransferManager]
  );

  const openMoveDestinationPicker = useCallback(
    (messageIds: number[], names: string[]) => {
      if (!creds || !messageIds.length) return;
      const choices = buildMoveDestinations();
      if (!choices.length) {
        setError('Tidak ada tujuan. Muat ulang daftar chat/folder.');
        return;
      }
      setDestPicker({
        title:
          messageIds.length === 1
            ? 'Kirim media ke…'
            : `Kirim ${messageIds.length} file ke…`,
        detail:
          names.length === 1
            ? names[0]
            : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`,
        choices,
        onConfirm: (dest) => {
          void requestMoveToTarget(messageIds, peerId, dest.id, dest.label, {
            isForum: !!dest.isForum,
          });
        },
      });
    },
    [creds, peerId, buildMoveDestinations, requestMoveToTarget]
  );

  const handleMove = (file: DriveFile) => {
    if (!creds) return;
    openMoveDestinationPicker([file.id], [file.name]);
  };

  const dragGenRef = useRef(0);
  /** Ghost chip for pointer-drag (HTML5 ghost is unreliable in WebView) */
  const [dragGhost, setDragGhost] = useState<{
    x: number;
    y: number;
    count: number;
    label: string;
  } | null>(null);
  const pointerDragRef = useRef<{
    active: boolean;
    pointerId: number;
    ids: number[];
    fromFolderId: number | null;
    lastX?: number;
    lastY?: number;
  } | null>(null);
  /** Prevent double-drop (HTML5 drop + pointerup) */
  const dropLockRef = useRef(false);
  /** If HTML5 drop hit a sidebar row without paths, remember target for Tauri drop */
  const pendingOsDropTargetRef = useRef<DriveDropTarget | null>(null);
  /** Detach sync pointer listeners (must not wait for React useEffect) */
  const pointerListenCleanupRef = useRef<(() => void) | null>(null);
  const pointerFinishedRef = useRef(false);

  const resolveDropTargetLabel = useCallback(
    (key: string): DriveDropTarget | null => {
      const parsed = parseDropKey(key);
      if (!parsed) return null;
      if (parsed.kind === 'saved') {
        return { kind: 'saved', id: null, label: 'Saved Messages' };
      }
      if (parsed.kind === 'drive') {
        const f = folders.find((x) => x.id === parsed.id);
        return { kind: 'drive', id: parsed.id, label: f?.name || `Folder ${parsed.id}` };
      }
      const c = chats.find((x) => x.id === parsed.id);
      return { kind: 'chat', id: parsed.id, label: c?.name || `Chat ${parsed.id}` };
    },
    [folders, chats]
  );

  // Live refs so sync pointer handlers always see latest callbacks
  const resolveDropTargetLabelRef = useRef(resolveDropTargetLabel);
  resolveDropTargetLabelRef.current = resolveDropTargetLabel;
  const requestMoveToTargetRef = useRef(requestMoveToTarget);
  requestMoveToTargetRef.current = requestMoveToTarget;
  pasteMoveRef.current = (clip) => {
    const label =
      locationKind === 'saved'
        ? 'Saved Messages'
        : folders.find((f) => f.id === activePeerId)?.name ||
          chats.find((c) => c.id === activePeerId)?.name ||
          'Lokasi ini';
    void requestMoveToTarget(clip.messageIds, clip.fromFolderId, peerId, label, {
      isForum: isForumChat,
    }).then(() => {
      if (clip.mode === 'cut') setDriveClipboard(null);
    });
  };
  runMoveCopyRef.current = (messageIds, fromFolderId, toFolderId, targetLabel, opts) => {
    void moveMessageIds(messageIds, fromFolderId, toFolderId, targetLabel, opts);
  };
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const detachPointerDragListeners = useCallback(() => {
    if (pointerListenCleanupRef.current) {
      try {
        pointerListenCleanupRef.current();
      } catch {
        /* ignore */
      }
      pointerListenCleanupRef.current = null;
    }
  }, []);

  const clearMediaDragUi = useCallback(() => {
    detachPointerDragListeners();
    pointerFinishedRef.current = true;
    setMediaDragActive(false);
    setPointerDriveDragActive(false);
    setLastHoverDropKey(null);
    // Ghost is React-managed — never el.remove() (causes removeChild NotFoundError and blocks dialog)
    setDragGhost(null);
    pointerDragRef.current = null;
    // Keep pointerFinishedRef true until next prime (prevents double-finish after cleanup)
    setDragActive(false);
    document.body.classList.remove('td-dnd-internal', 'td-dnd-external');
    // Only clear residual *classes* — do not detach React-owned nodes from the DOM
    try {
      document.querySelectorAll('.td-file-card.is-dragging, .td-list-row.is-dragging').forEach((el) => {
        el.classList.remove('is-dragging');
      });
      document.querySelectorAll('.td-drag-ghost').forEach((el) => {
        (el as HTMLElement).style.visibility = 'hidden';
        (el as HTMLElement).style.pointerEvents = 'none';
      });
      document.querySelectorAll('.td-shell.is-media-dnd').forEach((el) => {
        el.classList.remove('is-media-dnd');
      });
    } catch {
      /* ignore */
    }
    setStatusText((s) =>
      s.startsWith('Seret ') || s.startsWith('Lepas file') || s.startsWith('Drop dibatalkan')
        ? 'Siap'
        : s
    );
  }, [detachPointerDragListeners]);

  const armMediaDragUi = useCallback(
    (ids: number[]) => {
      // Internal move (Google Drive model): no OS upload overlay — only sidebar targets
      setDragActive(false);
      setMediaDragActive(true);
      document.body.classList.add('td-dnd-internal');
      document.body.classList.remove('td-dnd-external');
      // Expand rail *before* pointer moves far — mid-drag layout shift steals drop targets
      if (collapsed) setCollapsed(false);
      if (typeof window !== 'undefined' && window.innerWidth <= 900) openDrawer();
      // Clear location filter so all drop targets are listed during drag
      setChatQuery('');
      setStatusText(
        ids.length === 1
          ? 'Seret ke chat/folder di sidebar · Esc batal'
          : `Seret ${ids.length} item ke chat/folder · Esc batal`
      );
    },
    [collapsed, openDrawer]
  );

  /** Attach window pointer listeners IMMEDIATELY (not useEffect) — fixes stuck-on-drag race. */
  const attachPointerDragListeners = useCallback(() => {
    detachPointerDragListeners();
    pointerFinishedRef.current = false;

    const finishOnce = (fn: () => void) => {
      if (pointerFinishedRef.current) return;
      pointerFinishedRef.current = true;
      fn();
    };

    const onMove = (ev: PointerEvent) => {
      if (pointerFinishedRef.current) return;
      if (!pointerDragRef.current?.active) return;
      pointerDragRef.current.lastX = ev.clientX;
      pointerDragRef.current.lastY = ev.clientY;
      setDragGhost((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g));
    };

    const onUp = (ev: PointerEvent | MouseEvent) => {
      // Accept left-button release, touch end, or cancel.
      // WebView2 sometimes reports button=-1 on pointerup (not only 0).
      const typ = ev.type;
      if (typ !== 'pointerup' && typ !== 'pointercancel' && typ !== 'mouseup') return;
      if (typ !== 'pointercancel' && 'button' in ev && typeof ev.button === 'number') {
        // Ignore only clear right/middle button releases (1, 2, …)
        if (ev.button > 0) return;
      }

      finishOnce(() => {
        detachPointerDragListeners();
        if (dropLockRef.current) {
          setDragGhost(null);
          dropLockRef.current = false;
          return;
        }
        const payload = getActiveDriveDrag();
        // Prefer event coords; fall back to last move (some WebView ups report 0,0)
        const cx =
          Number.isFinite(ev.clientX) && (ev.clientX !== 0 || ev.clientY !== 0)
            ? ev.clientX
            : pointerDragRef.current?.lastX ?? ev.clientX;
        const cy =
          Number.isFinite(ev.clientY) && (ev.clientX !== 0 || ev.clientY !== 0)
            ? ev.clientY
            : pointerDragRef.current?.lastY ?? ev.clientY;
        // 1) geometry  2) live DOM highlight  3) last hover key from sidebar module
        let key = pickDropKeyAtPoint(cx, cy);
        if (!key) {
          try {
            key =
              document.querySelector('[data-drop-key].is-drop-over')?.getAttribute('data-drop-key') ||
              document.querySelector('.is-drop-over[data-drop-key]')?.getAttribute('data-drop-key') ||
              null;
          } catch {
            key = null;
          }
        }
        if (!key) key = getLastHoverDropKey();

        // Debug (devtools / remote audit)
        try {
          (window as unknown as { __lastDnDDrop?: unknown }).__lastDnDDrop = {
            typ,
            button: 'button' in ev ? ev.button : null,
            cx,
            cy,
            key,
            payloadIds: payload?.messageIds || null,
            fromFolderId: payload?.fromFolderId ?? null,
            hover: getLastHoverDropKey(),
            t: Date.now(),
          };
        } catch {
          /* ignore */
        }

        if (!payload?.messageIds?.length) {
          endDriveDrag();
          clearMediaDragUi();
          return;
        }
        if (key) {
          if (isDropKeySameAsSource(key, payload.fromFolderId)) {
            endDriveDrag();
            clearMediaDragUi();
            setStatusText('Sudah di lokasi ini — pilih chat/folder lain');
            return;
          }
          // Guard: scrolling past Drives — require stable hover (no accidental drop)
          if (shouldBlockDriveDrop(key)) {
            endDriveDrag();
            clearMediaDragUi();
            setStatusText('Tahan sebentar di Drive/Folder untuk melepaskan (hindari lepas saat scroll)');
            return;
          }
          dropLockRef.current = true;
          // Capture before clearMediaDragUi wipes hover/payload UI
          const target = resolveDropTargetLabelRef.current(key);
          const moveIds = [...payload.messageIds];
          const moveFrom = payload.fromFolderId;
          endDriveDrag();
          clearMediaDragUi();
          if (target) {
            const toId = target.kind === 'saved' ? null : target.id;
            const chatMeta =
              toId != null ? chatsRef.current.find((c) => c.id === toId) : null;
            // Dispatch to React-owned listener (native pointerup setState can be dropped
            // after HMR / outside React batch — CustomEvent is reliable).
            const dropDetail = {
              messageIds: moveIds,
              fromFolderId: moveFrom,
              toFolderId: toId,
              targetLabel: target.label,
              isForum: !!chatMeta?.is_forum,
            };
            // Call React path immediately via ref AND event (belt + suspenders)
            try {
              (window as unknown as { __dropMoveDispatched?: unknown }).__dropMoveDispatched = {
                ...dropDetail,
                t: Date.now(),
              };
            } catch {
              /* ignore */
            }
            const fireMove = () => {
              try {
                void requestMoveToTargetRef.current(
                  dropDetail.messageIds,
                  dropDetail.fromFolderId,
                  dropDetail.toFolderId,
                  dropDetail.targetLabel,
                  { isForum: dropDetail.isForum }
                );
              } catch (e) {
                console.error('requestMove after drop failed', e);
              }
              dropLockRef.current = false;
            };
            // Defer past clearMediaDragUi commit so setConfirmDlg is not lost mid-reconcile
            window.requestAnimationFrame(() => {
              window.setTimeout(fireMove, 0);
            });
          } else {
            dropLockRef.current = false;
            setStatusText('Tujuan tidak dikenali — coba lagi');
          }
          return;
        }
        endDriveDrag();
        clearMediaDragUi();
        setLastHoverDropKey(null);
        setStatusText('Drop dibatalkan — lepas di baris chat/folder (biru)');
      });
    };

    // mouseup fallback: Playwright CDP / some WebView builds emit mouse without pointer
    const onMouseUp = (ev: MouseEvent) => {
      // Only primary button; button can be 0. Ignore right-click.
      if (ev.button > 0) return;
      onUp(ev);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('mouseup', onMouseUp, true);
    // Safety: lost capture / tab blur must not leave ghost forever
    const onBlur = () => {
      finishOnce(() => {
        detachPointerDragListeners();
        endDriveDrag();
        clearMediaDragUi();
        setStatusText('Drag dibatalkan');
      });
    };
    window.addEventListener('blur', onBlur);

    pointerListenCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [clearMediaDragUi, detachPointerDragListeners]);

  // Escape cancels active media drag (ghost + in-memory payload)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isInternalMediaDragActive() && !mediaDragActive && !dragGhost) return;
      e.preventDefault();
      e.stopPropagation();
      endDriveDrag();
      clearMediaDragUi();
      dropLockRef.current = false;
      setStatusText('Drag dibatalkan (Escape)');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mediaDragActive, clearMediaDragUi, dragGhost]);

  // Safety net: if pointer ended but React state stuck (lost events / CDP), auto-clear
  useEffect(() => {
    if (!mediaDragActive && !dragGhost) return;
    const t = window.setTimeout(() => {
      // Still active after 45s with no pointer → force clear (never leave ghost forever)
      if (!pointerDragRef.current?.active && (mediaDragActive || dragGhost)) {
        endDriveDrag();
        clearMediaDragUi();
      }
    }, 45_000);
    return () => window.clearTimeout(t);
  }, [mediaDragActive, dragGhost, clearMediaDragUi]);

  // Unmount safety
  useEffect(() => {
    return () => {
      detachPointerDragListeners();
    };
  }, [detachPointerDragListeners]);

  const handleDragStartFile = (e: React.DragEvent, file: DriveFile) => {
    // Multi-select: drag all selected if this file is in selection; else just this file
    const ids =
      selectedIds.includes(file.id) && selectedIds.length > 1 ? [...selectedIds] : [file.id];
    setDriveDragData(e.dataTransfer, { messageIds: ids, fromFolderId: peerId });
    dragGenRef.current += 1;
    dropLockRef.current = false;
    const label =
      ids.length > 1
        ? `${ids.length} item`
        : file.name.length > 28
          ? `${file.name.slice(0, 26)}…`
          : file.name;
    setDragGhost({
      x: e.clientX || 0,
      y: e.clientY || 0,
      count: ids.length,
      label,
    });
    // HTML5 fallback: also attach pointer listeners if any residual pointer events
    setPointerDriveDragActive(true);
    pointerDragRef.current = {
      active: true,
      pointerId: -1,
      ids,
      fromFolderId: peerId,
    };
    attachPointerDragListeners();
    armMediaDragUi(ids);
  };

  const handleDragEndFile = () => {
    // Delay clear so drop handler can read payload first
    window.setTimeout(() => {
      if (dropLockRef.current) {
        dropLockRef.current = false;
        return;
      }
      // If pointer path already finished, no-op
      if (!isInternalMediaDragActive() && !mediaDragActive) return;
      endDriveDrag();
      clearMediaDragUi();
    }, 80);
  };

  /**
   * Prime drag as soon as pointer moves past threshold.
   * Listeners attach SYNCHRONOUSLY so release before next React paint still works.
   *
   * Accepts React.PointerEvent or a minimal native-like shape (document arm path).
   */
  const handleMediaDragPrime = useCallback(
    (
      file: DriveFile,
      e: React.PointerEvent | { clientX: number; clientY: number; pointerId?: number; button?: number; pointerType?: string; currentTarget?: EventTarget | null }
    ) => {
      const button = 'button' in e ? e.button : 0;
      const pointerType = 'pointerType' in e ? e.pointerType : 'mouse';
      if (button !== 0 && pointerType === 'mouse') return;
      const ids =
        selectedIds.includes(file.id) && selectedIds.length > 1 ? [...selectedIds] : [file.id];
      const label =
        ids.length > 1
          ? `${ids.length} item`
          : file.name.length > 28
            ? `${file.name.slice(0, 26)}…`
            : file.name;

      // Already primed — just update ghost position
      if (getActiveDriveDrag()?.messageIds?.length && pointerDragRef.current?.active) {
        setDragGhost({
          x: e.clientX,
          y: e.clientY,
          count: ids.length,
          label,
        });
        return;
      }

      beginDriveDrag({ messageIds: ids, fromFolderId: peerId });
      setPointerDriveDragActive(true);
      dropLockRef.current = false;
      pointerFinishedRef.current = false;
      const pid = typeof e.pointerId === 'number' ? e.pointerId : 1;
      pointerDragRef.current = {
        active: true,
        pointerId: pid,
        ids,
        fromFolderId: peerId,
        lastX: e.clientX,
        lastY: e.clientY,
      };

      // Keep receiving events even if card unmounts / sidebar expands
      try {
        const capEl = (e.currentTarget as HTMLElement | null) || null;
        if (capEl && typeof e.pointerId === 'number') {
          capEl.setPointerCapture?.(e.pointerId);
        }
      } catch {
        /* ignore */
      }

      // CRITICAL: attach before any setState that triggers re-render
      attachPointerDragListeners();

      armMediaDragUi(ids);
      setDragGhost({
        x: e.clientX,
        y: e.clientY,
        count: ids.length,
        label,
      });
    },
    [selectedIds, peerId, armMediaDragUi, attachPointerDragListeners]
  );

  /**
   * Document-level drag arm (WebView2 / CDP-safe).
   * React element onPointer* sometimes miss trusted CDP mouse events; native
   * document capture always sees them. Cards expose data-msg-id for lookup.
   */
  const filesRef = useRef(files);
  filesRef.current = files;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const handleMediaDragPrimeRef = useRef(handleMediaDragPrime);
  handleMediaDragPrimeRef.current = handleMediaDragPrime;

  /**
   * Document capture contextmenu — WebView2-safe tools menu.
   * React onContextMenu on explorer can miss / lag after HMR; native capture
   * always blocks the browser menu and opens Drive tools (file or canvas).
   */
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      // Only inside Media Studio main content explorer area
      const inExplorer = t.closest('.td-explorer');
      if (!inExplorer) return;
      // Never steal from real dialogs / open menus / form fields
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (t.closest('.drive-context-menu, .drive-modal, .td-preview-modal, dialog')) return;

      e.preventDefault();
      e.stopPropagation();

      const fileEl = t.closest('[data-drive-file], .td-file-card, .td-list-row') as HTMLElement | null;
      if (fileEl) {
        const rawId =
          fileEl.getAttribute('data-msg-id') ||
          fileEl.getAttribute('data-file-id') ||
          fileEl.closest('[data-msg-id], [data-file-id]')?.getAttribute('data-msg-id') ||
          fileEl.closest('[data-file-id]')?.getAttribute('data-file-id');
        const id = rawId != null ? Number(rawId) : NaN;
        const file =
          Number.isFinite(id) && id !== 0
            ? filesRef.current.find((f) => f.id === id) || null
            : null;
        if (file) {
          setContextMenu({ kind: 'file', x: e.clientX, y: e.clientY, file });
          setSelectedIds((prev) => {
            if (prev.includes(file.id)) return prev;
            selectionAnchorRef.current = file.id;
            return [file.id];
          });
          return;
        }
      }

      // Empty canvas / gap between cards
      setContextMenu({ kind: 'canvas', x: e.clientX, y: e.clientY });
    };

    // Capture phase: run before bubble handlers / WebView default
    document.addEventListener('contextmenu', onCtx, true);
    return () => document.removeEventListener('contextmenu', onCtx, true);
  }, []);

  // React-owned drop completion (opened from native pointerup via CustomEvent)
  useEffect(() => {
    const onDropMove = (ev: Event) => {
      const d = (ev as CustomEvent).detail as {
        messageIds?: number[];
        fromFolderId?: number | null;
        toFolderId?: number | null;
        targetLabel?: string;
        isForum?: boolean;
      } | null;
      if (!d?.messageIds?.length || !d.targetLabel) return;
      void requestMoveToTargetRef.current(
        d.messageIds,
        d.fromFolderId ?? null,
        d.toFolderId ?? null,
        d.targetLabel,
        { isForum: !!d.isForum }
      );
    };
    window.addEventListener('autogram-drive-drop-move', onDropMove as EventListener);
    return () => window.removeEventListener('autogram-drive-drop-move', onDropMove as EventListener);
  }, []);

  useEffect(() => {
    let down: {
      x: number;
      y: number;
      id: number;
      fileId: number;
      el: HTMLElement;
    } | null = null;
    let primed = false;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      if (t.closest('button, a, input, label, .td-select-check, .td-file-act')) return;
      const card = t.closest('[data-drive-file][data-msg-id]') as HTMLElement | null;
      if (!card) return;
      const fileId = Number(card.getAttribute('data-msg-id'));
      if (!Number.isFinite(fileId)) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, fileId, el: card };
      primed = false;
      try {
        card.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!down || primed) return;
      if (e.pointerId !== down.id && e.pointerId !== 0) {
        // some hosts reuse pointerId oddly — still allow if buttons pressed
        if (e.buttons !== 1) return;
      }
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist < DRAG_THRESHOLD_PX) return;
      const file = filesRef.current.find((f) => f.id === down!.fileId);
      if (!file) return;
      primed = true;
      handleMediaDragPrimeRef.current(file, {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: down.id,
        button: 0,
        pointerType: e.pointerType || 'mouse',
        currentTarget: down.el,
      });
    };

    const onUp = () => {
      if (!down) return;
      try {
        if (down.el.hasPointerCapture?.(down.id)) down.el.releasePointerCapture(down.id);
      } catch {
        /* ignore */
      }
      down = null;
      primed = false;
    };

    // mousemove fallback for hosts that drop pointermove mid-gesture
    const onMouseMove = (e: MouseEvent) => {
      if (!down || primed || e.buttons !== 1) return;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist < DRAG_THRESHOLD_PX) return;
      const file = filesRef.current.find((f) => f.id === down!.fileId);
      if (!file) return;
      primed = true;
      handleMediaDragPrimeRef.current(file, {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: down.id,
        button: 0,
        pointerType: 'mouse',
        currentTarget: down.el,
      });
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    document.addEventListener('mousemove', onMouseMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('mousemove', onMouseMove, true);
    };
  }, []);

  const handleDropOnLocation = async (target: DriveDropTarget, e: React.DragEvent) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    if (dropLockRef.current) return;
    setDragActive(false);
    if (!creds) {
      endDriveDrag();
      clearMediaDragUi();
      clearLastOsPaths();
      return setError('Select session first.');
    }
    const toId = target.kind === 'saved' ? null : target.id;

    // In-memory payload first (reliable); DataTransfer as fallback
    const internal = getActiveDriveDrag() || getDriveDragData(e.dataTransfer);

    if (internal?.messageIds?.length) {
      if (sameDriveLocation(internal.fromFolderId, toId)) {
        endDriveDrag();
        clearMediaDragUi();
        setStatusText('Sudah di lokasi ini — pilih chat/folder lain');
        return;
      }
      dropLockRef.current = true;
      endDriveDrag();
      clearMediaDragUi();
      try {
        const chatMeta = toId != null ? chats.find((c) => c.id === toId) : null;
        await requestMoveToTarget(
          internal.messageIds,
          internal.fromFolderId,
          toId,
          target.label,
          { isForum: !!chatMeta?.is_forum }
        );
      } finally {
        dropLockRef.current = false;
      }
      return;
    }

    // OS files: prefer Tauri-cached absolute paths (HTML5 File.path is empty in WebView2)
    let paths = extractOsPaths(e.dataTransfer);
    if (!paths.length && e.dataTransfer && hasOsFiles(e.dataTransfer)) {
      pendingOsDropTargetRef.current = target;
      paths = await waitForOsPaths(500);
    }
    if (paths.length) {
      dropLockRef.current = true;
      endDriveDrag();
      clearMediaDragUi();
      clearLastOsPaths();
      try {
        await runUploadPaths(paths, {
          targetFolderId: toId,
          targetLabel: target.label,
          skipTopic: true,
        });
      } finally {
        dropLockRef.current = false;
      }
      return;
    }

    // HTML5 saw Files but path still empty — keep target for late Tauri drop
    if (e.dataTransfer && hasOsFiles(e.dataTransfer)) {
      pendingOsDropTargetRef.current = target;
      return;
    }

    endDriveDrag();
    clearMediaDragUi();
    setError('Drop tidak dikenali. Seret file dari File Explorer ke baris Saved Messages (hijau).');
  };

  const cancelTransfer = async () => {
    debugLog('drive', 'transfer stop');
    const wasDownload = transfer.direction === 'download';
    const wasMove = transfer.direction === 'move' || moveActiveRef.current;
    const tracked = Array.from(downloadArtifactsRef.current);
    // Abort sequential move/forward batch (not a worker job)
    cancelMoveBatch();
    await clearDriveTransferPause();
    await cancelDriveJob();
    childRef.current?.dispose?.();
    childRef.current = null;
    if (wasMove && !wasDownload) {
      downloadArtifactsRef.current.clear();
      setTransfer((t) => markTransferFinished(t, 'cancelled'));
      setStatusText('Pindah/salin dihentikan');
      scheduleTransferHide();
      return;
    }
    // Wipe incomplete downloads (.part + partial final) for cleanliness
    if (wasDownload || tracked.length) {
      try {
        const res = await cleanupPartialDownloads(tracked);
        debugLog('drive', 'partial cleanup after stop', res);
        if (res.count > 0) {
          setStatusText(`Transfer dihentikan · ${res.count} file parsial dihapus`);
        } else {
          setStatusText('Transfer dihentikan');
        }
      } catch {
        setStatusText('Transfer dihentikan');
      }
    } else {
      setStatusText('Transfer dihentikan');
    }
    downloadArtifactsRef.current.clear();
    setTransfer((t) => markTransferFinished(t, 'cancelled'));
    scheduleTransferHide();
  };

  const pauseTransfer = async () => {
    debugLog('drive', 'transfer pause');
    await setDriveTransferPaused(true);
    setTransfer((t) => setSessionPaused(t, true));
  };

  const resumeTransfer = async () => {
    debugLog('drive', 'transfer resume');
    await setDriveTransferPaused(false);
    setTransfer((t) => setSessionPaused(t, false));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    document.body.classList.remove('td-dnd-external');
    // Internal media = pointer path only (never HTML5 double-complete)
    if (
      isPointerDriveDragActive() ||
      mediaDragActive ||
      getActiveDriveDrag() ||
      getDriveDragData(e.dataTransfer) ||
      isInternalMediaDragActive()
    ) {
      return;
    }
    // Prefer Tauri onDragDropEvent (paths). HTML5 often races with empty File.path —
    // if Tauri already handled (or is handling), skip.
    if (dropLockRef.current) {
      return;
    }
    setMediaDragActive(false);
    endDriveDrag();
    if (!creds) {
      return setError('Select session first.');
    }
    // Immediate paths from File.path / cache
    let paths = extractOsPaths(e.dataTransfer);
    if (!paths.length && hasOsFiles(e.dataTransfer)) {
      // Wait for Tauri native paths (WebView2 File.path is usually empty)
      paths = await waitForOsPaths(500);
    }
    if (!paths.length) {
      // Still empty — Tauri drop handler may still fire with paths; don't error here
      return;
    }
    dropLockRef.current = true;
    clearLastOsPaths();
    try {
      // Prefer pending sidebar target (HTML5 drop on row before Tauri fires)
      const pending = pendingOsDropTargetRef.current;
      pendingOsDropTargetRef.current = null;
      if (pending) {
        const toId = pending.kind === 'saved' ? null : pending.id;
        await runUploadPaths(paths, {
          targetFolderId: toId,
          targetLabel: pending.label,
          skipTopic: true,
        });
      } else {
        await runUploadPaths(paths);
      }
    } finally {
      dropLockRef.current = false;
    }
  };

  // Stable refs for Tauri drop handler (avoid re-subscribe on every render)
  const credsRef = useRef(creds);
  credsRef.current = creds;
  const resolveDropRef = useRef(resolveDropTargetLabel);
  resolveDropRef.current = resolveDropTargetLabel;
  const runUploadRef = useRef(runUploadPaths);
  runUploadRef.current = runUploadPaths;

  // Tauri 2 native file drop — reliable absolute paths (HTML5 File.path is empty)
  useEffect(() => {
    if (!canUseLocalTelegramWorker()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let handling = false;

    const physicalToClient = async (x: number, y: number) => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const factor = await getCurrentWindow().scaleFactor();
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || factor : factor;
        // Prefer window scaleFactor; fall back to DPR
        const f = factor > 0 ? factor : dpr;
        return { clientX: x / f, clientY: y / f, factor: f };
      } catch {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        return { clientX: x / dpr, clientY: y / dpr, factor: dpr };
      }
    };

    const resolveDropTargetAt = async (pos: { x: number; y: number }) => {
      // Try several coordinate spaces — WebView2/Tauri position can be physical or CSS
      const { clientX, clientY, factor } = await physicalToClient(pos.x, pos.y);
      const candidates: Array<[number, number]> = [
        [clientX, clientY],
        [pos.x, pos.y],
        [pos.x / (window.devicePixelRatio || 1), pos.y / (window.devicePixelRatio || 1)],
        [pos.x / factor, pos.y / factor],
      ];
      for (const [x, y] of candidates) {
        const key = pickDropKeyAtPoint(x, y);
        if (!key) continue;
        const t = resolveDropRef.current(key);
        if (t) return t;
      }
      return pendingOsDropTargetRef.current;
    };

    const collectPayloadPaths = (payload: Record<string, unknown>): string[] => {
      const raw =
        (payload as { paths?: unknown }).paths ??
        (payload as { path?: unknown }).path ??
        null;
      if (Array.isArray(raw)) {
        setLastOsPaths(raw);
      } else if (raw != null) {
        setLastOsPaths([raw]);
      }
      return getLastOsPaths();
    };

    void (async () => {
      try {
        // Prefer Webview API; Window also emits drag-drop on some Tauri 2 builds
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const unsubs: Array<() => void> = [];

        const onNativeDrag = async (event: { payload: { type: string; paths?: string[]; path?: string; position?: { x: number; y: number } } }) => {
          if (cancelled) return;
          const payload = event.payload as Record<string, unknown> & {
            type: string;
            paths?: string[];
            position?: { x: number; y: number };
          };

          if (payload.type === 'enter' || payload.type === 'over') {
            // Internal media drag → sidebar targets only (no upload overlay)
            if (isInternalMediaDragActive()) {
              setDragActive(false);
              return;
            }
            collectPayloadPaths(payload);
            // Any native enter/over from OS shell ⇒ external file drag
            document.body.classList.add('td-dnd-external');
            document.body.classList.remove('td-dnd-internal');
            setDragActive(true);
            if (payload.position) {
              const t = await resolveDropTargetAt(payload.position);
              void t;
            }
            return;
          }

          if (payload.type === 'leave' || payload.type === 'cancel') {
            setDragActive(false);
            document.body.classList.remove('td-dnd-external');
            // Do NOT clear paths immediately — drop often follows leave by a few ms
            window.setTimeout(() => {
              if (!dropLockRef.current && !handling) clearLastOsPaths();
            }, 900);
            // Keep pendingOsDropTarget a bit for drop resolution
            return;
          }

          if (payload.type === 'drop') {
            setDragActive(false);
            document.body.classList.remove('td-dnd-external');
            // Ignore during internal media drag (forward handled by pointer/HTML5 path)
            if (isInternalMediaDragActive()) {
              clearLastOsPaths();
              pendingOsDropTargetRef.current = null;
              return;
            }
            // If HTML5 already started the same upload, skip
            if (handling || dropLockRef.current) {
              clearLastOsPaths();
              pendingOsDropTargetRef.current = null;
              return;
            }

            let paths = collectPayloadPaths(payload);
            if (!paths.length) {
              // Brief retry — some hosts deliver paths one tick late
              await new Promise((r) => window.setTimeout(r, 80));
              paths = getLastOsPaths();
            }
            if (!paths.length) {
              paths = await waitForOsPaths(350);
            }
            if (!paths.length) {
              pendingOsDropTargetRef.current = null;
              setError(
                'Drop file gagal: path tidak terbaca. Coba tombol Upload, atau drop lagi dari File Explorer.'
              );
              clearLastOsPaths();
              return;
            }

            const c = credsRef.current;
            if (!c) {
              clearLastOsPaths();
              pendingOsDropTargetRef.current = null;
              setError('Select session first.');
              return;
            }

            handling = true;
            dropLockRef.current = true;
            try {
              const pos = payload.position;
              const target = pos
                ? await resolveDropTargetAt(pos)
                : pendingOsDropTargetRef.current;
              pendingOsDropTargetRef.current = null;
              const uploadPaths = paths.slice();
              clearLastOsPaths();

              if (target) {
                const toId = target.kind === 'saved' ? null : target.id;
                await runUploadRef.current(uploadPaths, {
                  targetFolderId: toId,
                  targetLabel: target.label,
                  skipTopic: true,
                });
              } else {
                // Drop on explorer / empty area → current folder
                await runUploadRef.current(uploadPaths);
              }
            } finally {
              handling = false;
              dropLockRef.current = false;
            }
          }
        };

        unsubs.push(await getCurrentWebview().onDragDropEvent(onNativeDrag as any));
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          unsubs.push(await getCurrentWindow().onDragDropEvent(onNativeDrag as any));
        } catch {
          /* window API optional */
        }
        unlisten = () => {
          unsubs.forEach((u) => {
            try {
              u();
            } catch {
              /* ignore */
            }
          });
        };
      } catch {
        /* not in Tauri or API unavailable */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <main
      className={`main-content main-content-fill main-content-flush td-page${
        mediaDragActive ? ' is-internal-dnd' : ''
      }`}
      onDragEnter={(e) => {
        // Pointer internal drag has no HTML5 DataTransfer cycle — ignore
        if (isPointerDriveDragActive() || mediaDragActive) {
          setDragActive(false);
          return;
        }
        e.preventDefault();
        if (isExternalOsFileDrag(e.dataTransfer)) {
          setDragActive(true);
          applyDropEffect(e.dataTransfer, 'copy');
        } else {
          setDragActive(false);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDragOver={(e) => {
        if (isPointerDriveDragActive() || mediaDragActive) {
          setDragActive(false);
          return;
        }
        e.preventDefault();
        if (isExternalOsFileDrag(e.dataTransfer)) {
          applyDropEffect(e.dataTransfer, 'copy');
        } else {
          setDragActive(false);
        }
      }}
      onDrop={onDrop}
    >
      {/* Hide drawer scrim while dragging media — otherwise z-order fights and the rail looks 50% black */}
      {drawerOpen && !mediaDragActive && (
        <div className="td-drawer-backdrop" onClick={closeDrawer} />
      )}
      {/* Google Drive–style floating stack ghost (internal media only) */}
      {dragGhost && (
        <div
          className="td-drag-ghost"
          style={{ left: dragGhost.x + 14, top: dragGhost.y + 14 }}
          aria-hidden
        >
          <span className="td-drag-ghost-stack" aria-hidden>
            <span className="td-drag-ghost-card c3" />
            <span className="td-drag-ghost-card c2" />
            <span className="td-drag-ghost-card c1" />
          </span>
          <span className="td-drag-ghost-meta">
            <span className="td-drag-ghost-count">
              {dragGhost.count > 99 ? '99+' : dragGhost.count}
            </span>
            <span className="td-drag-ghost-label">{dragGhost.label}</span>
          </span>
        </div>
      )}
      <div
        className={`td-shell ${collapsed ? 'rail-collapsed' : ''}${
          mediaDragActive ? ' is-media-dnd' : ''
        }${dragActive ? ' is-os-dnd' : ''}`}
      >
        <DriveSidebar
          folders={folders}
          chats={chats}
          chatFolders={chatFolders}
          activeChatFolderId={activeChatFolderId}
          onSelectChatFolder={(id) => void selectChatFolder(id)}
          activePeerId={activePeerId}
          locationKind={locationKind}
          onSelectSaved={() => {
            setLocationKind('saved');
            setActivePeerId(null);
            setTopicFilter(null);
            topicFilterRef.current = null;
            setTopics([]);
            setIsForumChat(false);
          }}
          onSelectDrive={(id) => {
            setLocationKind('drive');
            setActivePeerId(id);
            setTopicFilter(null);
            topicFilterRef.current = null;
          }}
          onSelectChat={(id) => {
            setLocationKind('chat');
            setActivePeerId(id);
            setTopicFilter(null);
            topicFilterRef.current = null;
          }}
          recents={recents}
          pins={pins}
          onSelectRecent={(r) => {
            if (r.kind === 'saved') {
              setLocationKind('saved');
              setActivePeerId(null);
            } else if (r.kind === 'drive') {
              setLocationKind('drive');
              setActivePeerId(r.id);
            } else {
              setLocationKind('chat');
              setActivePeerId(r.id);
            }
            setTopicFilter(null);
            topicFilterRef.current = null;
          }}
          onSelectPin={(r) => {
            if (r.kind === 'saved') {
              setLocationKind('saved');
              setActivePeerId(null);
            } else if (r.kind === 'drive') {
              setLocationKind('drive');
              setActivePeerId(r.id);
            } else {
              setLocationKind('chat');
              setActivePeerId(r.id);
            }
            setTopicFilter(null);
            topicFilterRef.current = null;
          }}
          onCreate={handleCreateFolder}
          onLocationContextMenu={(info) => {
            setContextMenu({
              kind: 'location',
              x: info.x,
              y: info.y,
              locationKind: info.locationKind,
              id: info.id,
              name: info.name,
            });
          }}
          onFolderReparentDrop={(info) => {
            endFolderDrag();
            handleReparentFolder(info.folderId, info.folderName, {
              id: info.targetId,
              name: info.targetName,
            });
          }}
          channelLimitWarning={channelLimitWarning}
          onRefresh={refreshLocations}
          loadingFolders={loadingFolders}
          loadingChats={loadingChats}
          session={session}
          sessions={sessionsForSelect}
          onSessionChange={handleSessionChange}
          statusText={
            sessionsLoading && !sessions.length
              ? 'Memuat daftar session…'
              : statusText
          }
          connected={driveReady || isDriveSessionReady()}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          chatQuery={chatQuery}
          onChatQuery={setChatQuery}
          drawerOpen={drawerOpen}
          onCloseDrawer={closeDrawer}
          chatsHasMore={chatsHasMore}
          chatsLoadingMore={chatsLoadingMore}
          onLoadMoreChats={loadMoreChats}
          onExitToApp={onExitToApp}
          onDropOnLocation={handleDropOnLocation}
          mediaDragActive={mediaDragActive}
          dragSourceFolderId={
            mediaDragActive || isInternalMediaDragActive()
              ? getActiveDriveDrag()?.fromFolderId ?? peerId
              : undefined
          }
          creds={creds}
        />

        <div className="td-main">
          <DriveTopBar
            folderName={breadcrumb}
            breadcrumbSegs={breadcrumbSegs}
            onBreadcrumbNavigate={(seg) => {
              if (seg.kind === 'start' || seg.kind === 'saved') {
                setLocationKind('saved');
                setActivePeerId(null);
              } else if (seg.kind === 'drive' && seg.id != null) {
                setLocationKind('drive');
                setActivePeerId(seg.id);
              } else if (seg.kind === 'chat' && seg.id != null) {
                setLocationKind('chat');
                setActivePeerId(seg.id);
              }
              setTopicFilter(null);
              topicFilterRef.current = null;
            }}
            viewMode={viewMode}
            onViewMode={setViewMode}
            query={query}
            onQuery={setQuery}
            mediaFilter={mediaFilter}
            onMediaFilter={setMediaFilter}
            sortMode={sortMode}
            onSortMode={setSortMode}
            thumbQuality={thumbQuality}
            onThumbQuality={handleThumbQuality}
            gridZoom={gridZoom}
            onGridZoom={handleGridZoom}
            selectedCount={selectedIds.length}
            onClearSelection={clearSelection}
            onSelectAll={handleSelectAllDisplayed}
            onInvertSelection={handleInvertSelection}
            onUpload={handleUpload}
            onDownload={handleDownloadSelected}
            onDelete={() => handleDeleteIds(selectedIds)}
            transferBusy={transfer.active}
            actionsDisabled={transfer.active}
            onMoveSelected={() => {
              if (!selectedIds.length) return;
              const names = selectedIds.map((id) => {
                const f = files.find((x) => x.id === id);
                return f?.name || `msg_${id}`;
              });
              openMoveDestinationPicker(selectedIds, names);
            }}
            onRefresh={refreshFiles}
            onOpenTransferSettings={() => setTransferSettingsOpen(true)}
            onOpenTransferManager={openTransferManager}
            transferHasHistory={
              transfer.active || (transfer.items?.length ?? 0) > 0 || !!transfer.banner
            }
            transferBadgeCount={transferBadge(transfer).count}
            transferBadgeKind={transferBadge(transfer).kind}
            onOpenLocations={openDrawer}
            loading={loadingFiles}
            fileCount={
              statsAccurate && totalFileCount != null
                ? totalFileCount
                : files.length
            }
            isForum={isForumChat}
            topics={topics}
            topicFilter={topicFilter}
            onTopicFilter={handleTopicFilter}
            topicsLoading={topicsLoading}
            onOpenTools={() => {
              setToolsTab(isAdvFilterActive(advFilter) ? 'filter' : 'copy');
              setToolsOpen(true);
            }}
            toolsActive={toolsOpen || isAdvFilterActive(advFilter)}
            canNavBack={navHist.index > 0}
            canNavForward={navHist.index < navHist.stack.length - 1}
            onNavBack={() => goNav('back')}
            onNavForward={() => goNav('forward')}
            isPinned={currentPinned}
            onTogglePin={() => {
              if (!session) return;
              setPins(
                toggleDrivePin(session, {
                  kind: locationKind,
                  id: locationKind === 'saved' ? null : activePeerId,
                  label: locationLabel,
                })
              );
            }}
            spaceLabel={spaceHint}
            statsLoading={statsLoading}
            statsAccurate={statsAccurate}
          />

          <DriveTransferManager
            session={transfer}
            minimized={transferMinimized}
            forceShow={!transferMinimized}
            onToggleMinimize={toggleTransferMinimize}
            onPause={
              transfer.active && transfer.direction !== 'move' ? pauseTransfer : undefined
            }
            onResume={
              transfer.active && transfer.direction !== 'move' ? resumeTransfer : undefined
            }
            onStop={transfer.active || moveActiveRef.current ? cancelTransfer : undefined}
            onClearDone={() => setTransfer((t) => clearFinishedItems(t))}
            onDismiss={() => {
              // Explicit clear history only — does not fire on outside click
              if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
              setTransfer({ ...EMPTY_TRANSFER_SESSION });
              setTransferMinimized(true);
              localStorage.setItem(LS_TM_MIN, '1');
            }}
            downloadFolderPath={lastDownloadDir}
            onOpenDownloadFolder={
              lastDownloadDir
                ? () => {
                    void (async () => {
                      try {
                        if (!canUseLocalTelegramWorker()) {
                          setError('Buka folder hanya di desktop app');
                          return;
                        }
                        const mod = await import('@tauri-apps/plugin-opener');
                        if (typeof mod.openPath === 'function') {
                          await mod.openPath(lastDownloadDir);
                        }
                      } catch (e: any) {
                        setError(`Tidak bisa buka folder: ${String(e?.message || e)}`);
                      }
                    })();
                  }
                : undefined
            }
            canRetryFailed={
              !transfer.active &&
              !!lastDownloadRetryRef.current &&
              transfer.direction === 'download' &&
              (transfer.items || []).some((i) => i.status === 'failed')
            }
            onRetryFailed={() => {
              const r = lastDownloadRetryRef.current;
              if (!r || !creds) return;
              setSelectedIds(r.ids);
              void (async () => {
                // Re-run download to same folder
                if (isTransferJobActive() || transfer.active) {
                  setError('Transfer masih berjalan.');
                  return;
                }
                try {
                  if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
                  void clearDriveTransferPause();
                  setTransfer(
                    seedTransferSession({
                      direction: 'download',
                      names: r.names,
                      label: `Retry ${r.ids.length} file`,
                    })
                  );
                  setTransferMinimized(false);
                  const idsJson = await writeWorkerJson('drive_ids', r.ids);
                  const optsJson = await writeWorkerJson('drive_dl_opts', {
                    concurrency: transferSettings.downloadConcurrency,
                  });
                  let exitCode: number | null = 0;
                  try {
                    await new Promise<void>((resolve, reject) => {
                      driveDownloadBatchSpawn(creds, peerId, idsJson, r.saveDir, optsJson, {
                        onStdoutLine: (line) => onTransferStdout(String(line)),
                        onStderrLine: (line) => onTransferStdout(String(line)),
                        onClose: (code) => {
                          exitCode = code;
                          resolve();
                        },
                      })
                        .then((c) => {
                          childRef.current = c;
                        })
                        .catch(reject);
                    });
                  } finally {
                    void deleteWorkerTempFile(idsJson);
                    void deleteWorkerTempFile(optsJson);
                    childRef.current = null;
                  }
                  if (exitCode != null && exitCode !== 0) {
                    setTransfer((t) => markTransferFinished(t, 'failed'));
                  } else {
                    setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
                    setStatusText(`Retry selesai → ${r.saveDir}`);
                  }
                } catch (e: any) {
                  setError(String(e?.message || e));
                  setTransfer((t) => markTransferFinished(t, 'failed'));
                } finally {
                  void clearDriveTransferPause();
                  setTransfer((t) => (t.active ? markTransferFinished(t, 'done') : t));
                  scheduleTransferHide();
                }
              })();
            }}
          />

          <DriveToolsPanel
            open={toolsOpen}
            tab={toolsTab}
            onTab={setToolsTab}
            onClose={() => setToolsOpen(false)}
            files={getDisplayedFiles()}
            selectedFiles={files.filter((f) => selectedIds.includes(f.id))}
            advFilter={advFilter}
            onAdvFilter={setAdvFilter}
            folders={folders}
            chats={chats}
            locationKind={locationKind}
            locationLabel={locationLabel}
            busy={transfer.active || loadingFiles}
            creds={creds}
            folderId={peerId}
            locationTotalCount={totalFileCount}
            locationTotalBytes={totalBytes}
            locationStatsLoading={statsLoading}
            locationStatsAccurate={statsAccurate}
            locationByType={statsByType}
            filesHasMore={filesHasMore}
            topicFilter={topicFilter}
            isForum={isForumChat}
            onPreviewFile={(f) => {
              // Keep tools open behind preview (z-index above tools) so user can resume dups after Esc
              setPreviewFile(f);
            }}
            onDeleteIds={(ids) => {
              setToolsOpen(false);
              handleDeleteIds(ids);
            }}
            onBulkRename={handleBulkRename}
            onSmartCopy={(opts) => {
              void handleSmartCopy(opts);
            }}
          />

          <TransferSettingsModal
            open={transferSettingsOpen}
            settings={transferSettings}
            transferActive={transfer.active}
            onClose={() => setTransferSettingsOpen(false)}
            onChange={(next: TransferSettingsState) => {
              setTransferSettings(next);
              saveTransferSettings(next);
            }}
          />

          {error && (
            <div className="td-error-banner" role="alert">
              <AlertTriangle size={15} />
              <span>{error}</span>
              <button type="button" className="td-chip-btn" onClick={() => setError(null)}>
                Tutup
              </button>
            </div>
          )}

          <DriveExplorer
            files={files}
            loading={loadingFiles}
            loadingMore={loadingMoreFiles}
            hasMore={filesHasMore}
            onLoadMore={loadMoreFiles}
            progressiveReady={progressiveReady}
            scrollKey={explorerScrollKey}
            initialScrollTop={explorerInitialScrollTop}
            onScrollPositionChange={rememberExplorerScroll}
            scaleHint={scaleHint}
            error={error && files.length === 0 ? error : null}
            viewMode={viewMode}
            selectedIds={selectedIds}
            query={query}
            mediaFilter={mediaFilter}
            sortMode={sortMode}
            advFilter={advFilter}
            gridZoom={gridZoom}
            onGridZoom={handleGridZoom}
            folderId={peerId}
            folderName={breadcrumb}
            creds={creds}
            onSelect={handleSelect}
            onToggleSelection={handleToggleSelection}
            onMarqueeSelect={handleMarqueeSelect}
            onClearSelection={clearSelection}
            onDisplayedIdsChange={(ids) => {
              displayedIdsRef.current = ids;
            }}
            onOpen={(f) => setPreviewFile(f)}
            onPreview={(f) => setPreviewFile(f)}
            onDownload={(f) => downloadOne(f)}
            onDelete={(f) => handleDeleteIds([f.id])}
            onUpload={handleUpload}
            onCreateFolder={handleCreateFolder}
            dragActive={dragActive}
            internalDragActive={mediaDragActive}
            draggingIds={
              mediaDragActive
                ? getActiveDriveDrag()?.messageIds || pointerDragRef.current?.ids || []
                : []
            }
            onDragStartFile={handleDragStartFile}
            onDragEndFile={handleDragEndFile}
            onMediaDragPrime={handleMediaDragPrime}
            thumbQuality={thumbQuality}
            onContextMenu={(e, f) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ kind: 'file', x: e.clientX, y: e.clientY, file: f });
              if (!selectedIds.includes(f.id)) {
                setSelectedIds([f.id]);
                selectionAnchorRef.current = f.id;
              }
            }}
            onCanvasContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ kind: 'canvas', x: e.clientX, y: e.clientY });
            }}
          />
        </div>
      </div>

      {previewFile && creds && (
        <DrivePreviewModal
          file={previewFile}
          folderId={peerId}
          creds={creds}
          onClose={() => setPreviewFile(null)}
          hasPrev={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < sortedPreviewList.length - 1}
          neighborIds={
            previewIndex >= 0
              ? [
                  sortedPreviewList[previewIndex - 1]?.id,
                  sortedPreviewList[previewIndex + 1]?.id,
                  sortedPreviewList[previewIndex + 2]?.id,
                  sortedPreviewList[previewIndex + 3]?.id,
                  sortedPreviewList[previewIndex - 2]?.id,
                ].filter((id): id is number => typeof id === 'number' && id > 0)
              : []
          }
          onPrev={() => {
            if (previewIndex > 0) setPreviewFile(sortedPreviewList[previewIndex - 1]);
          }}
          onNext={() => {
            if (previewIndex >= 0 && previewIndex < sortedPreviewList.length - 1) {
              setPreviewFile(sortedPreviewList[previewIndex + 1]);
            }
          }}
        />
      )}

      {contextMenu && (
        <DriveContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={
            contextMenu.kind === 'file'
              ? { kind: 'file', file: contextMenu.file }
              : contextMenu.kind === 'location'
                ? {
                    kind: 'location',
                    locationKind: contextMenu.locationKind,
                    id: contextMenu.id,
                    name: contextMenu.name,
                  }
                : { kind: 'canvas' }
          }
          onClose={() => setContextMenu(null)}
          onPreview={
            contextMenu.kind === 'file'
              ? () => setPreviewFile(contextMenu.file)
              : undefined
          }
          onDownload={
            contextMenu.kind === 'file'
              ? () => downloadOne(contextMenu.file)
              : undefined
          }
          onOpenSystem={
            contextMenu.kind === 'file'
              ? () => openOneInSystem(contextMenu.file)
              : undefined
          }
          onOpenWith={
            contextMenu.kind === 'file'
              ? () => openOneWithApp(contextMenu.file)
              : undefined
          }
          onReveal={
            contextMenu.kind === 'file' ? () => revealOne(contextMenu.file) : undefined
          }
          onRename={
            contextMenu.kind === 'file' ? () => handleRename(contextMenu.file) : undefined
          }
          onDelete={
            contextMenu.kind === 'file'
              ? () => handleDeleteIds([contextMenu.file.id])
              : contextMenu.kind === 'canvas' && selectedIds.length > 0
                ? () => handleDeleteIds(selectedIds)
                : undefined
          }
          onMove={
            contextMenu.kind === 'file' ? () => handleMove(contextMenu.file) : undefined
          }
          onUpload={contextMenu.kind === 'canvas' ? handleUpload : undefined}
          onCreateFolder={
            contextMenu.kind === 'canvas'
              ? locationKind === 'drive' && activePeerId != null
                ? () => handleCreateFolder({ parentId: activePeerId })
                : () => handleCreateFolder({ parentId: null })
              : undefined
          }
          onCreateSubfolder={
            contextMenu.kind === 'location' && contextMenu.locationKind === 'drive' && contextMenu.id != null
              ? () => handleCreateFolder({ parentId: contextMenu.id })
              : contextMenu.kind === 'canvas' &&
                  (folders.length > 0 || (locationKind === 'drive' && activePeerId != null))
                ? handleCreateSubfolder
                : undefined
          }
          onOpenLocation={
            contextMenu.kind === 'location'
              ? () => {
                  if (contextMenu.locationKind === 'saved') {
                    setLocationKind('saved');
                    setActivePeerId(null);
                  } else if (contextMenu.locationKind === 'drive' && contextMenu.id != null) {
                    setLocationKind('drive');
                    setActivePeerId(contextMenu.id);
                  } else if (contextMenu.locationKind === 'chat' && contextMenu.id != null) {
                    setLocationKind('chat');
                    setActivePeerId(contextMenu.id);
                  }
                  setTopicFilter(null);
                  topicFilterRef.current = null;
                }
              : undefined
          }
          onDeleteFolder={
            contextMenu.kind === 'location' &&
            contextMenu.locationKind === 'drive' &&
            contextMenu.id != null
              ? () => handleDeleteFolder(contextMenu.id as number, contextMenu.name)
              : undefined
          }
          onRenameFolder={
            contextMenu.kind === 'location' &&
            contextMenu.locationKind === 'drive' &&
            contextMenu.id != null
              ? () => handleRenameFolder(contextMenu.id as number, contextMenu.name)
              : undefined
          }
          onReparentFolder={
            contextMenu.kind === 'location' &&
            contextMenu.locationKind === 'drive' &&
            contextMenu.id != null
              ? () => handleReparentFolder(contextMenu.id as number, contextMenu.name)
              : undefined
          }
          renameFolderLabel={
            contextMenu.kind === 'location' && contextMenu.locationKind === 'drive'
              ? `Ganti nama ${labelDriveItem(folders.find((f) => f.id === contextMenu.id))}…`
              : undefined
          }
          reparentFolderLabel="Pindah ke Drive/Folder…"
          deleteFolderLabel={
            contextMenu.kind === 'location' && contextMenu.locationKind === 'drive'
              ? `Hapus ${labelDriveItem(folders.find((f) => f.id === contextMenu.id))}…`
              : undefined
          }
          onCopyId={
            contextMenu.kind === 'location' && contextMenu.id != null
              ? () => {
                  const id = String(contextMenu.id);
                  void navigator.clipboard?.writeText(id).then(
                    () => setStatusText(`ID disalin: ${id}`),
                    () => setStatusText(`ID: ${id}`)
                  );
                }
              : undefined
          }
          onRefresh={contextMenu.kind === 'canvas' ? () => void refreshFiles() : undefined}
          onSelectAll={
            contextMenu.kind === 'canvas' ? handleSelectAllDisplayed : undefined
          }
          onClearSelection={
            contextMenu.kind === 'canvas' ? clearSelection : undefined
          }
          selectedCount={selectedIds.length}
          createFolderLabel={
            locationKind === 'drive' && activePeerId != null
              ? 'Buat folder di sini'
              : 'Buat Drive [TD] (root)'
          }
          createSubfolderLabel={
            locationKind === 'drive' && activePeerId != null
              ? 'Buat folder di Drive/Folder lain…'
              : 'Buat folder di…'
          }
          locationLabel={
            locationKind === 'saved'
              ? 'Saved Messages'
              : locationKind === 'drive'
                ? (() => {
                    const f = folders.find((x) => x.id === activePeerId);
                    const k = labelDriveItem(f);
                    return f ? `${f.name} (${k})` : 'Drive';
                  })()
                : chats.find((c) => c.id === activePeerId)?.name || 'Chat'
          }
        />
      )}

      <DriveConfirmDialog
        state={activeConfirm}
        onClose={() => {
          closeDriveMoveConfirm();
          setConfirmDlg(null);
        }}
      />
      <DriveInputDialog state={inputDlg} onClose={() => setInputDlg(null)} />
      <DriveDestinationPicker state={destPicker} onClose={() => setDestPicker(null)} />
    </main>
  );
}
