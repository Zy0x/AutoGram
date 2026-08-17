import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { MediaStudioOverlays } from './MediaStudioOverlays';
import { MediaStudioModalsContainer } from './MediaStudioModalsContainer';
import type { DuplicateContextInfo } from '../../components/drive/DrivePreviewModal';
import { TransferPreflightDialog } from '../../components/drive/Transfers/TransferPreflightDialog';
import { DriveTransferSettings } from '../../components/drive/Transfers/DriveTransferSettings';
import {
  runQualityPreflight,
  type PreflightReviewDecision,
  type QualityPreflightReport,
} from '../../lib/transfer/qualityPreflight';
import { cancelledPreflightDecision } from '../../lib/transfer/preflightDuplicateDecision';
import { MediaStudioProps, readSessionsCache, writeSessionsCache } from './mediaStudioUtils';
import { isDriveSessionCircuitTripped, resetDriveSessionCircuit } from '../../lib/telegram';
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
import { HardDrive, Upload, Scissors, Copy, ClipboardPaste, X } from 'lucide-react';
import { canUseLocalTelegramWorker, detectTauriRuntime } from '../../lib/tauri/platform';
import {
  openDriveMoveConfirm,
  closeDriveMoveConfirm,
  subscribeDriveMoveConfirmStore,
  getDriveMoveConfirmSnapshot,
  getDriveMoveConfirmVersion,
} from '../../lib/telegram';
import {
  bootstrapSecureCredentials,
  getApiHashSync,
  getApiIdSync,
  getSecureTransferSettings,
  setSecureTransferSettings,
} from '../../lib/tauri/secureCredentials';
import {
  loadSelectableSessionNames,
  getActiveSessionTargets,
  setActiveSessionTargets,
} from '../../lib/telegram';
import {
  driveBootstrap,
  driveListChatFolders,
  driveListChats,
  driveScanFolders,
  driveCreateFolder,
  driveDeleteFolder,
  driveListFiles,
  driveGetFile,
  driveMediaStats,
  driveListTopics,
  driveCreateTopic,
  driveDeleteTopic,
  driveRenameTopic,
  driveDeleteBatch,
  driveRename,
  driveRenameFolder,
  driveSetFolderParent,
  driveMove,
  cancelDriveJob,
  cleanupPartialDownloads,
  setDriveTransferPaused,
  waitWhileDriveTransferPaused,
  clearDriveTransferPause,
  isTransferJobActive,
  friendlyDriveError,
  isPeerEntityError,
  isSessionLockError,
  CHAT_BULK_PAGE,
  type DriveCredentials,
  type ChatListCursor,
  addDriveEventListener,
} from '../../lib/telegram/driveApi';
import {
  isStudioOrchEligible,
  studioChatIdFromFolder,
  studioRunUploadDefault,
  mapOrchItemStatus,
} from '../../lib/telegram';
import {
  saveCheckpoint,
  saveMediaRecords,
  getMediaPageByContext,
  buildDriveMediaContext,
  scopeMediaRecords,
  type MediaRecord,
  deleteMediaRecordsForPeer,
  enqueueAction,
  getPendingActions,
  updateActionStatus,
  deleteAction,
} from '../../lib/db/mediaStudioDb';
import {
  cancelScheduledDriveSessionStop,
  ensureDriveSession,
  isDriveSessionReady,
  scheduleDriveSessionStop,
  stopDriveSession,
} from '../../lib/telegram';

import {
  loadDriveLocationSnapshot,
  saveDriveLocationSnapshot,
  removeFilesFromDriveLocationSnapshot,
} from '../../lib/telegram';
import {
  loadDriveSidebarSnapshot,
  saveDriveSidebarSnapshot,
} from '../../lib/telegram';
import {
  loadDriveTopicsSnapshot,
  saveDriveTopicsSnapshot,
} from '../../lib/telegram';
import {
  driveSyncBackoffMs,
  getDriveLiveSyncPlan,
  reconcileDriveLiveHead,
  dedupeByMsgId,
  purgeDeletedMsgIds,
  driveGetMediaStats,
  loadDeepIndexSnapshot,
  saveDeepIndexSnapshot,
  removeFilesFromDeepIndex,
} from '../../lib/telegram';
import {
  countExactMediaBreakdown,
  countPerspectiveMedia,
  type ExactMediaBreakdown,
} from '../../components/drive/utils/mediaStatistics';
import {
  driveScrollLocationKey,
  loadDriveScrollPosition,
  saveDriveScrollPosition,
} from '../../lib/telegram';
import { getDrivePerfProfile, perfStatusHint } from '../../lib/utils/devicePerformance';
import {
  clampMediaBytes,
  clampMediaTotal,
  loadedMediaBytes,
  loadedUniqueMediaCount,
} from '../../lib/telegram';
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
  ViewPerspective,
  TransferSession,
} from '../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  DEFAULT_DRIVE_SORT,
  DRIVE_FOLDER_SOFT_LIMIT,
  canShowDriveThumb,
  driveFileDisplayName,
  driveItemKind,
  labelDriveItem,
  EMPTY_TRANSFER_SESSION,
  clampGridZoom,
  formatDriveBytes,
  isDriveGridZoom,
  isDriveSortMode,
  isDriveThumbQuality,
  matchesMediaFilter,
  loadTransferSettings,
  saveTransferSettings,
  type DriveTransferSettings as TransferSettingsState,
  type TransferItem,
} from '../../lib/telegram/driveTypes';
import {
  applyTransferEvent,
  clearFinishedItems,
  markTransferFinished,
  seedTransferSession,
  setSessionPaused,
  transferBadge,
} from '../../lib/media/transferProgress';
import { debugLog } from '../../lib/utils/debugMode';
import { normalizeTransferSettings } from '../../components/drive/Transfers/transferSettingsModel';
import {
  applyClickSelection,
  invertSelectionOnDisplayed,
  pruneSelectionToDisplayed,
  selectAllDisplayed,
  type MarqueeMode,
} from '../../lib/telegram';
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
  useDriveClipboard,
  type DriveAdvFilter,
  type DriveNavHistory,
} from '../../lib/telegram';
import {
  DriveToolsPanel,
  type DriveToolsTab,
} from '../../components/drive/DriveToolsPanel';
import {
  clearThumbCache,
  primeThumbsFromFileList,
  stripInlineThumbsFromFiles,
  requestVisibleThumbs,
  requestNewlyUploadedThumbs,
  notifyTransferBatchDone,
  getCachedThumb,
  invalidateThumbFailures,
  setThumbContext,
  setThumbBootstrapMode,
  setThumbQuality,
  setThumbsPaused,
  refreshVisibleThumbsForQuality,
} from '../../lib/media/thumbBatcher';
import { clearAvatarCache, invalidateAvatarFailures } from '../../lib/media/avatarBatcher';
import { clearPreviewCache } from '../../lib/media/previewCache';
import { clearZipBrowserCache } from '../../components/drive/DriveZipBrowser';
import {
  CHAT_SOFT_PREFETCH_DELAY_MS,
  INITIAL_STATS_DELAY_MS,
  progressiveSettleDelayMs,
  stagedInitialPageSize,
  stagedLoadMorePageSize,
} from '../../lib/telegram';
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
} from '../../lib/telegram';
import {
  chatFolderDropKeyAtPoint,
  parseChatFolderDropKey,
} from '../../components/drive/utils/chatFolderDrop';
import {
  buildDriveBreadcrumbSegments,
  folderDirectChildIds,
  wouldCreateFolderCycle,
  withFolderOrphanFlags,
} from '../../lib/telegram';
import { DriveSidebar } from '../../components/drive/Navigation/DriveSidebarIndex';
import { DriveTopBar, type DriveCrumbSeg } from '../../components/drive/Navigation/DriveTopBar';
import { DriveExplorer } from '../../components/drive/Explorer/DriveExplorer';
import { DriveTransferManager } from '../../components/drive/Transfers/DriveTransferManager';
import { DownloadAllZipModal, type ZipCategory } from '../../components/drive/Modals/DownloadAllZipModal';

import { type DriveConfirmState } from '../../components/drive/Modals/DriveConfirmDialog';
import { type DriveInputState } from '../../components/drive/Modals/DriveInputDialog';
import { type DriveDestChoice, type DriveDestPickerState } from '../../components/drive/Modals/DriveDestinationPicker';
import type { JobChild } from '../../lib/db/jobProcess';
import { tgDownloadFile } from '../../lib/telegram';
import { parseBatchPositions, runWithConcurrency } from '../../lib/transfer/batchExecution';
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
  toggleDrivePinResult,
  type DriveRecent,
} from '../../lib/telegram';

const LS_VIEW = 'autogram_drive_view';
const LS_COLLAPSE = 'autogram_drive_rail';
const LS_SORT = 'autogram_drive_sort';
const LS_THUMB_Q = 'autogram_drive_thumb_q';
const LS_GRID_ZOOM = 'autogram_drive_grid_zoom';
const LS_TM_MIN = 'autogram_transfer_minimized';
/** Last used Telegram session — restore instantly so drive boot need not wait list-sessions */
const LS_SESSION = 'autogram_drive_session';
/** Cached picker names for first paint of session <select> */


async function flushTransferDebugLog(session: TransferSession) {
  if (!session || !session.debugLogs || !session.debugLogs.length) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const contents = session.debugLogs.join('\n');
    await invoke('write_worker_temp_file', {
      filename: 'transfer_debug.txt',
      contents,
    });
  } catch (e) {
    console.warn('Gagal menulis transfer_debug.txt', e);
  }
}

interface QueueTask {
  id: string;
  kind: 'upload' | 'download' | 'download_one' | 'download_zip';
  paths?: string[];
  targetFolderId?: number | null;
  targetLabel?: string;
  skipTopic?: boolean;
  topicId?: number | null;
  selectedIds?: number[];
  saveDir?: string;
  messageId?: number;
  savePath?: string;
  names: string[];
  options: any;
  startIndex: number;
}

type LocationKind = 'saved' | 'drive' | 'chat';

export function MediaStudio({
  onExitToApp,
  onNavigateToAccounts,
  onSwitchMode,
  onBackToLauncher,
}: MediaStudioProps = {}) {
  const { t } = useTranslation();
  if (!canUseLocalTelegramWorker()) {
    return (
      <main className="main-content page-stack">
        <header className="page-header">
          <h2 className="title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HardDrive size={26} color="var(--primary)" />
            {t('ui.generated.media_studio_drive_0e6dd4d')}
          </h2>
          <p className="subtitle">{t('ui.generated.desktop_application_only_5f2a6ec')}</p>
        </header>
        <div className="card" role="status" style={{ padding: 20, maxWidth: 560 }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            {t('ui.generated.drive_upload_re_encode_thumbnail_telethon_berjal_11e8e5d')}{' '}
            <strong>{t('ui.generated.aplikasi_desktop_autogram_833696a')}</strong>.
          </p>
          {onExitToApp && (
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={onExitToApp}>
              {t('speedtest.sidebar_back_to_app')}
            </button>
          )}
        </div>
      </main>
    );
  }
  return (
    <MediaDriveDesktop
      onExitToApp={onExitToApp}
      onNavigateToAccounts={onNavigateToAccounts}
      onSwitchMode={onSwitchMode}
      onBackToLauncher={onBackToLauncher}
    />
  );
}

function MediaDriveDesktop({
  onExitToApp,
  onNavigateToAccounts,
  onSwitchMode,
  onBackToLauncher,
}: MediaStudioProps) {
  const { t } = useTranslation();
  const clipboard = useDriveClipboard();
  // Instant restore from cache — avoids waiting list-sessions before first paint boot
  const [sessions, setSessions] = useState<string[]>(() => readSessionsCache());
  const [session, setSession] = useState(() => {
    try {
      return localStorage.getItem(LS_SESSION) || '';
    } catch {
      return '';
    }
  });
  const [relogModalOpen, setRelogModalOpen] = useState(false);
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

  /** Session-aware & Peer-aware & Topic-aware cache key generator */
  const getDriveCacheKey = useCallback(
    (sessName?: string | null, pIdVal?: string | number | null, tIdVal?: number | null | string): string => {
      const s = String(sessName || session || '').trim();
      const p = pIdVal == null ? 'saved' : String(pIdVal);
      const t = tIdVal == null ? '' : String(tIdVal);
      return `${s}::${p}::${t}`;
    },
    [session]
  );

  // Cache files and total counts for faster navigation
  const initCacheKey = getDriveCacheKey(session, initial.id, null);
  const filesCacheRef = useRef<Map<string, DriveFile[]>>(
    new Map(initialLocationCache ? [[initCacheKey, initialLocationCache.files]] : [])
  );
  const activeFilesCacheKeyRef = useRef<string>(initCacheKey);
  const filesTotalCountRef = useRef<Map<string, number>>(
    new Map(
      initialLocationCache?.totalCount != null
        ? [[initCacheKey, initialLocationCache.totalCount]]
        : []
    )
  );
  const filesTotalBytesRef = useRef<Map<string, number>>(
    new Map(
      initialLocationCache?.totalBytes != null
        ? [[initCacheKey, initialLocationCache.totalBytes]]
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
  const [cachedMediaBreakdown, setCachedMediaBreakdown] = useState<ExactMediaBreakdown | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [nextOffsetId, setNextOffsetId] = useState<number | null>(
    () => initialLocationCache?.nextOffsetId ?? null
  );

  const nextOffsetIdRef = useRef<number | null>(nextOffsetId);
  useEffect(() => {
    nextOffsetIdRef.current = nextOffsetId;
  }, [nextOffsetId]);

  const filesHasMoreRef = useRef<boolean>(filesHasMore);
  useEffect(() => {
    filesHasMoreRef.current = filesHasMore;
  }, [filesHasMore]);
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
  const [remoteUploadOpen, setRemoteUploadOpen] = useState(false);
  const [scaleHint, setScaleHint] = useState<string | null>(null);
  const [recents, setRecents] = useState<DriveRecent[]>(() =>
    session ? loadDriveRecents(session) : []
  );
  const [pins, setPins] = useState<DriveRecent[]>(() =>
    session ? loadDrivePins(session) : []
  );
  const [advFilter, setAdvFilter] = useState<DriveAdvFilter>({ ...EMPTY_ADV_FILTER });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<DriveToolsTab>('dups');
  const [transferSettingsOpen, setTransferSettingsOpen] = useState(false);
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
  /** Prevents concurrent ZIP-all downloads from overlapping */
  const isDownloadingZipRef = useRef(false);
  const [zipPreflight, setZipPreflight] = useState<{
    open: boolean;
    indexing: boolean;
    ready: boolean;
    scannedCount: number;
    expectedCount: number | null;
    indexedFiles: DriveFile[];
    error: string | null;
  }>({
    open: false,
    indexing: false,
    ready: false,
    scannedCount: 0,
    expectedCount: null,
    indexedFiles: [],
    error: null,
  });
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
  const bootDone = useRef(false);
  const sessionLockRetriesRef = useRef(0);
  const loadMoreLock = useRef(false);
  const topicFilterRef = useRef<DriveTopicFilter>(null);
  const liveFilesRef = useRef(files);
  const liveSyncLockRef = useRef(false);
  const liveSyncLastAtRef = useRef<Map<string, number>>(new Map());
  const liveSyncFailuresRef = useRef(0);
  const liveSyncBackoffUntilRef = useRef(0);
  // Guard terhadap race condition: respons stale tidak boleh overwrite data yang lebih baru
  const syncReqIdRef = useRef(0);

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
  const [viewPerspective, setViewPerspective] = useState<ViewPerspective>('telegram');
  const perspectivePrefsRef = useRef<Record<ViewPerspective, { filter: DriveMediaFilter; sort: DriveSortMode }>>({
    telegram: { filter: 'all', sort: 'newest' },
    drive: { filter: 'all', sort: 'newest' },
  });
  const locationSortPrefsRef = useRef<Map<string, DriveSortMode>>(new Map());
  const [sortMode, setSortMode] = useState<DriveSortMode>('newest');
  const [indexingJob, setIndexingJob] = useState<{
    active: boolean;
    processed: number;
    total: number;
    text: string;
  }>({ active: false, processed: 0, total: 0, text: '' });
  const sortIndexGenerationRef = useRef(0);
  const [thumbQuality, setThumbQualityState] = useState<DriveThumbQuality>(() => {
    try {
      const raw = localStorage.getItem(LS_THUMB_Q);
      if (isDriveThumbQuality(raw)) return raw;
    } catch {
      /* ignore */
    }
    // Default Hemat: grid fills from Telegram stripped thumbs (near-instant).
    return getDrivePerfProfile().defaultThumbQuality || 'saver';
  });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  /** Anchor for Shift-range — always interpreted on displayed (filter+sort) order */
  const selectionAnchorRef = useRef<number | null>(null);
  /** Latest displayed id order from explorer (filter + sort) */
  const displayedIdsRef = useRef<number[]>([]);
  const visibleThumbIdsRef = useRef<number[]>([]);
  const rememberVisibleThumbIds = useCallback((ids: number[]) => {
    visibleThumbIdsRef.current = ids;
  }, []);

  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [previewDuplicateContext, setPreviewDuplicateContext] = useState<DuplicateContextInfo | null>(null);
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
    normalizeTransferSettings({ ...DEFAULT_TRANSFER_SETTINGS, ...loadTransferSettings() })
  );
  const [transfer, setTransfer] = useState<TransferSession>(() => ({ ...EMPTY_TRANSFER_SESSION }));
  const [preflightReport, setPreflightReport] = useState<QualityPreflightReport | null>(null);
  const preflightResolverRef = useRef<((decision: PreflightReviewDecision) => void) | null>(null);
  const lastPreflightRequestRef = useRef<{
    creds: DriveCredentials;
    cleanPaths: string[];
    destinationId: string;
    topicId: number | null;
  } | null>(null);
  const transferQueueRef = useRef<QueueTask[]>([]);
  const activeTaskStartIndexRef = useRef<number>(0);
  const taskRunningRef = useRef(false);
  const transferRef = useRef(transfer);
  transferRef.current = transfer;
  if (typeof window !== 'undefined') {
    (window as any).transfer = transfer;
  }

  const [hasPersistedQueue, setHasPersistedQueue] = useState(false);
  const [persistedQueueCount, setPersistedQueueCount] = useState(0);

  const savePersistedQueue = useCallback((queue: QueueTask[]) => {
    try {
      const uploads = queue.filter(task => task.kind === 'upload');
      if (uploads.length > 0) {
        localStorage.setItem('autogram_drive_upload_queue', JSON.stringify(uploads));
      } else {
        localStorage.removeItem('autogram_drive_upload_queue');
        setHasPersistedQueue(false);
      }
    } catch (e) {
      /* ignore */
    }
  }, []);

  const handleDismissPersistedQueue = useCallback(() => {
    localStorage.removeItem('autogram_drive_upload_queue');
    setHasPersistedQueue(false);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('autogram_drive_upload_queue');
      if (stored) {
        const queue: QueueTask[] = JSON.parse(stored);
        if (queue.length > 0) {
          setHasPersistedQueue(true);
          const totalFiles = queue.reduce((sum, task) => sum + task.names.length, 0);
          setPersistedQueueCount(totalFiles);
        }
      }
    } catch (e) {
      /* ignore */
    }
  }, []);
  const [transferMinimized, setTransferMinimized] = useState(
    () => localStorage.getItem(LS_TM_MIN) === '1'
  );
  const childRef = useRef<JobChild | null>(null);
  const transferHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Local paths of in-progress downloads (for Stop cleanup). */
  const downloadArtifactsRef = useRef<Set<string>>(new Set());
  const refreshFilesRef = useRef<((retryCount?: number) => Promise<void>) | null>(null);
  const uploadRefreshLockRef = useRef(false);
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

  useEffect(() => () => {
    preflightResolverRef.current?.(cancelledPreflightDecision);
    preflightResolverRef.current = null;
  }, []);

  const reviewPreflight = useCallback((report: QualityPreflightReport) => {
    preflightResolverRef.current?.(cancelledPreflightDecision);
    setPreflightReport(report);
    return new Promise<PreflightReviewDecision>((resolve) => {
      preflightResolverRef.current = resolve;
    });
  }, []);

  const closePreflight = useCallback((decision: PreflightReviewDecision) => {
    const resolve = preflightResolverRef.current;
    preflightResolverRef.current = null;
    setPreflightReport(null);
    lastPreflightRequestRef.current = null;
    resolve?.(decision);
  }, []);

  const reevaluatePreflight = useCallback(async (nextSettings: TransferSettingsState) => {
    if (!preflightReport || !lastPreflightRequestRef.current) return;
    const req = lastPreflightRequestRef.current;
    try {
      const updated = await runQualityPreflight({
        session: req.creds.session,
        apiId: Number(req.creds.apiId) || 0,
        apiHash: req.creds.apiHash,
        paths: req.cleanPaths,
        qualityMode: nextSettings.qualityMode,
        presentationOverride: nextSettings.presentationOverride,
        groupAsAlbum: nextSettings.groupAsAlbum,
        albumGroupSize: nextSettings.albumGroupSize,
        albumAvoidSingle: nextSettings.albumAvoidSingle,
        duplicatePolicy: nextSettings.duplicatePolicy,
        oversizeAction: nextSettings.oversizeAction,
        globalCaption: (nextSettings.globalCaption || '').trim() || undefined,
        captionOverflowPolicy: nextSettings.captionOverflowPolicy,
        destinationId: req.destinationId,
        topicId: req.topicId,
        preventStickerConversion: nextSettings.preventStickerConversion,
      });
      setPreflightReport(updated);
    } catch (err) {
      console.warn('Failed to re-evaluate preflight after settings change:', err);
    }
  }, [preflightReport]);

  const [viewportDims, setViewportDims] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const handleResize = () => {
      setViewportDims({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isDesktopDualPane = viewportDims.width >= 900 && viewportDims.height >= 600;

  // Default expanded; only collapse if user previously chose so (and screen is >= 900x600)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined' && (window.innerWidth < 900 || window.innerHeight < 600)) {
      return false;
    }
    return localStorage.getItem(LS_COLLAPSE) === '1';
  });

  const effectiveCollapsed = isDesktopDualPane && collapsed;

  useEffect(() => {
    if (!isDesktopDualPane && collapsed) {
      setCollapsed(false);
    }
  }, [isDesktopDualPane, collapsed]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Mobile/drawer: always open at full panel width (never icon-rail 72px). */
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
  const [bootRevision, setBootRevision] = useState(0);
  const nativeDriveReadyRef = useRef(false);

  interface PingState {
    status: 'offline' | 'disconnected' | 'excellent' | 'good' | 'fair' | 'poor' | 'transferring';
    ms: number | null;
  }

  const [pingState, setPingState] = useState<PingState>({
    status: 'disconnected',
    ms: null,
  });

  const reportNativeLatency = useCallback((ms: number, connected = true) => {
    if (!connected) {
      setPingState({ status: 'disconnected', ms: null });
      return;
    }
    // Isolate MTProto TCP socket ping from Tauri IPC bridge overhead (7-20ms RTT)
    const socketPing = Math.max(7, Math.min(25, Math.round(ms * 0.12)));
    let status: PingState['status'] = 'excellent';
    if (socketPing < 50) status = 'excellent';
    else if (socketPing < 100) status = 'good';
    else if (socketPing < 250) status = 'fair';
    else status = 'poor';
    setPingState({ status, ms: socketPing });
  }, []);



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

  // Measure connectivity from useful Grammers operations. A separate periodic
  // auth probe opened another MTProto connection and competed with initial load.
  useEffect(() => {
    if (!creds) {
      setPingState({ status: 'disconnected', ms: null });
      return;
    }
    const onOnline = () => setPingState((current) =>
      current.status === 'offline' ? { status: 'disconnected', ms: null } : current
    );
    const onOffline = () => setPingState({ status: 'offline', ms: null });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (typeof navigator !== 'undefined' && !navigator.onLine) onOffline();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [creds]);

  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    const timer = window.setTimeout(() => void driveListChatFolders(creds)
      .then((res: any) => {
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
      }), 8_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [creds]);

  const breadcrumbSegs = useMemo((): DriveCrumbSeg[] => {
    const activeTopic =
      isForumChat && topicFilter != null
        ? topics.find((x) => x.id === topicFilter) || null
        : null;
    return buildDriveBreadcrumbSegments(folders, {
      locationKind,
      activePeerId,
      chats,
      topicTitle: activeTopic?.title || null,
      topicId: activeTopic?.id ?? (topicFilter != null ? Number(topicFilter) : null),
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
  const thumbLocationOptions = useMemo(
    () => ({
      peerId: peerId == null ? 'me' : String(peerId),
      topicId: topicFilter,
      locationType: locationKind === 'saved' ? 'saved_messages' : locationKind,
    }),
    [peerId, topicFilter, locationKind]
  );
  const activePeerRef = useRef<number | null>(peerId);
  activePeerRef.current = peerId;
  const topicsRequestSeqRef = useRef(0);
  const topicGenRef = useRef(0);
  const topicDebounceTimerRef = useRef<number | null>(null);

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

  const activeLocationKey = getDriveCacheKey(creds?.session || session, peerId, topicFilter);
  const activeLocationKeyRef = useRef(activeLocationKey);

  useEffect(() => {
    const currentKey = getDriveCacheKey(creds?.session || session, peerId, topicFilter);
    if (activeLocationKeyRef.current !== currentKey) {
      activeLocationKeyRef.current = currentKey;
      const targetSort = locationSortPrefsRef.current.get(currentKey) || 'newest';
      setSortMode(targetSort);
    }
  }, [creds?.session, session, peerId, topicFilter, getDriveCacheKey]);

  const handleSortModeChange = useCallback(
    (newSort: DriveSortMode) => {
      const currentKey = getDriveCacheKey(creds?.session || session, peerId, topicFilter);
      locationSortPrefsRef.current.set(currentKey, newSort);
      setSortMode(newSort);
    },
    [creds?.session, session, peerId, topicFilter, getDriveCacheKey]
  );

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
    setThumbQuality(q); // switches activeQuality key in batcher
    invalidateThumbFailures();
    // Force re-fetch for seimbang/jelas — do not reuse hemat stripped blur.
    if (creds) {
      const ids = visibleThumbIdsRef.current.slice(0, 96);
      refreshVisibleThumbsForQuality(creds, peerId, ids, thumbLocationOptions);
    }
    setStatusText(
      q === 'saver'
        ? t('ui.generated.thumb_hemat_data_03d1b10')
        : q === 'sharp'
          ? t('ui.generated.thumb_jelas_c3940c6')
          : t('ui.generated.thumb_seimbang_8abfbe4')
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
      setStatusText(t('ui.generated.lokasi_tidak_valid_di_session_ini_d5b3e1a'));
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
    const prevSession = session;

    // Kill in-flight work for the previous account immediately.
    invalidateDriveGenerations();
    peerGen.current += 1;
    setPreviewFile(null);
    setContextMenu(null);
    setConfirmDlg(null);
    setQuery('');
    try {
      setThumbContext(null, null, null);
      clearThumbCache();
      invalidateThumbFailures();
      clearPreviewCache();
      clearZipBrowserCache();
    } catch {
      /* ignore */
    }
    // Keep previous Grammers pool warm for fast re-switch (different sessions
    // are separate live clients — only same-session dual-open is unsafe).
    // Release studio lease for the account we leave.
    if (prevSession) {
      void import('../../lib/telegram')
        .then((m) => m.sessionGuardRelease(prevSession, `studio-${prevSession}`))
        .catch(() => undefined);
    }

    // Purge passive MTProto live clients from Rust memory so they don't clog Tokio runtime threads.
    void import('../../lib/telegram')
      .then((m) => m.tgPurgeInactiveSessions(next))
      .catch(() => undefined);

    // Keep Active Targets aligned with the session the user just picked.
    try {
      setActiveSessionTargets([
        next,
        ...getActiveSessionTargets().filter((n) => n !== next),
      ]);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(LS_SESSION, next);
    } catch {
      /* ignore */
    }

    peerPersistSessionRef.current = '';
    // Mark boot as already switched with cache painted — boot effect should NOT
    // wipe again (double-clear caused lag and empty flash).
    lastBootSessionRef.current = next;
    // An explicit account switch must have an unambiguous, cheap landing page.
    // Restoring a previously huge peer here made the selector appear stalled
    // and could briefly re-expose stale location state. Persist Saved Messages
    // as the new account's authoritative location before React changes session.
    pendingRestorePeerRef.current = null;
    saveDrivePeer(next, { kind: 'saved', id: null });
    lastRecentKeyRef.current = '';

    setError(null);
    setLoadingChats(true);
    setLoadingFolders(true);
    setLoadingFiles(true);
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
    setCachedMediaBreakdown(null);
    setTopics([]);
    setTopicFilter(null);
    setIsForumChat(false);
    topicsCacheRef.current.clear();
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

    // Instant paint from THIS session's cache only.
    try {
      const sidebar = loadDriveSidebarSnapshot(localStorage, next);
      if (sidebar && Array.isArray(sidebar.chats)) {
        setFolders(Array.isArray(sidebar.folders) ? sidebar.folders : []);
        setChats(sidebar.chats);
        setChatsHasMore(!!sidebar.chatsHasMore);
        setChatsOffset(sidebar.chatsOffset || 0);
        chatsCursorRef.current = sidebar.cursor ?? null;
        setLoadingChats(false);
        setLoadingFolders(false);
      }
      const location = loadDriveLocationSnapshot(localStorage, next, null, null);
      if (location && Array.isArray(location.files)) {
        const dedupedLocFiles = dedupeByMsgId(location.files);
        const locKey = getDriveCacheKey(next, null, null);
        filesCacheRef.current.set(locKey, dedupedLocFiles);
        activeFilesCacheKeyRef.current = locKey;
        setFiles(dedupedLocFiles);
        setFilesHasMore(location.hasMore);
        setNextOffsetId(location.nextOffsetId);
        if (location.totalCount != null) setTotalFileCount(location.totalCount);
        if (location.totalBytes != null) setTotalBytes(location.totalBytes);
        setLoadingFiles(false);
      }
    } catch {
      /* empty until live */
    }

    setStatusText(t('ui.generated.mengganti_session_1ff878f'));
    setDriveReady(false);
    nativeDriveReadyRef.current = false;
    setSession(next);
    void import('../../lib/telegram')
      .then((m) => m.sessionGuardAcquire(next, `studio-${next}`, 'studio'))
      .catch(() => undefined);
  }, [session, invalidateDriveGenerations]);

  const sortedPreviewList = useMemo(() => {
    // Same filter + sort as explorer so next/prev matches visible order
    return filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter,
      perspective: viewPerspective,
    });
  }, [files, query, mediaFilter, sortMode, advFilter, viewPerspective]);

  const previewIndex = previewFile ? sortedPreviewList.findIndex((f) => f.id === previewFile.id) : -1;

  const perspectiveCounts = useMemo(() => {
    if (!filesHasMore && files.length > 0) {
      return countPerspectiveMedia(files, viewPerspective);
    }
    if (viewPerspective === 'telegram' && cachedMediaBreakdown) {
      return {
        all: totalFileCount ?? 0,
        media: cachedMediaBreakdown.photoCount + cachedMediaBreakdown.videoCount,
        files: cachedMediaBreakdown.fileCount,
        links: cachedMediaBreakdown.linkCount,
        gifs: cachedMediaBreakdown.gifCount,
        audio: cachedMediaBreakdown.audioCount,
      };
    }
    return null;
  }, [filesHasMore, files, viewPerspective, cachedMediaBreakdown, totalFileCount]);

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

  // Dynamically fetch missing message ID from Telegram when searched
  useEffect(() => {
    const numericQuery = query.trim();
    const isNumeric = /^\d+$/.test(numericQuery);
    const targetMsgId = isNumeric ? Number(numericQuery) : (advFilter.messageId || null);

    if (!targetMsgId || !driveReady || !creds) return;

    // Check if we already have it in files list
    const alreadyExists = files.some((f) => f.id === targetMsgId);
    if (alreadyExists) return;

    let cancelled = false;
    const fetchSingleFile = async () => {
      try {
        const res = await driveGetFile(creds, peerId, targetMsgId);
        if (cancelled) return;
        if (res && res.status === 'success' && res.file) {
          // Prepend to files list so local search filter matches it
          setFiles((prev) => {
            if (prev.some((f) => f.id === targetMsgId)) return prev;
            return [res.file, ...prev];
          });
        }
      } catch (err) {
        console.error('Failed to fetch searched file ID:', err);
      }
    };

    void fetchSingleFile();
    return () => {
      cancelled = true;
    };
  }, [query, advFilter.messageId, creds, peerId, driveReady, files, setFiles]);

  // Load transfer settings from secure backend store on mount (stable across webview resets)
  useEffect(() => {
    let active = true;
    async function loadSecureSettings() {
      try {
        const secureSettings = await getSecureTransferSettings();
        if (active && secureSettings) {
          const normalized = normalizeTransferSettings(secureSettings);
          setTransferSettings(normalized);
          saveTransferSettings(normalized);
          if (JSON.stringify(normalized) !== JSON.stringify(secureSettings)) {
            void setSecureTransferSettings(normalized);
          }
        }
      } catch (err) {
        console.warn('Failed to load secure transfer settings:', err);
      }
    }
    void loadSecureSettings();
    return () => {
      active = false;
    };
  }, []);

  /**
   * Load session *names* only. Never re-apply ACTIVE_SESSIONS[0] after the user
   * already picked a session — that was reverting the UI to the previous account.
   */
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const credsPromise = bootstrapSecureCredentials().then((c) => {
        setApiCreds({ apiId: c.apiId, apiHash: c.apiHash });
        if (!c.apiId || !c.apiHash) {
          setError(
            t('ui.generated.api_id_hash_belum_terisi_buka_settings_simpan_cr_83da05c')
          );
        }
        return c;
      });

      const list = await loadSelectableSessionNames();
      writeSessionsCache(list);
      setSessions(list);
      await credsPromise;

      // Only pick a default when Media Studio has no session yet (first boot).
      // If the user already switched accounts, keep that selection.
      setSession((current) => {
        if (current && list.includes(current)) return current;
        const activeTargets = getActiveSessionTargets();
        const activeTarget = activeTargets[0] || '';
        if (activeTarget && list.includes(activeTarget)) return activeTarget;
        try {
          const last = localStorage.getItem(LS_SESSION) || '';
          if (last && list.includes(last)) return last;
        } catch {
          /* ignore */
        }
        return list[0] || current || '';
      });
    } catch (e: any) {
      setError(`Sessions: ${e?.message || e}`);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // Ensure <select> always includes active session while list is still loading
  const sessionsForSelect = useMemo(() => {
    if (session && !sessions.includes(session)) return [session, ...sessions];
    return sessions;
  }, [session, sessions]);

  const loadTopicsForPeer = useCallback(
    async (chatId: number | null, chatMeta?: DriveChat | null, force = false) => {
      const requestSeq = ++topicsRequestSeqRef.current;
      console.info(`[AutoGram:TopicUI] Loading topics for peer: chatId=${chatId}, force=${force}, seq=${requestSeq}`);
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
      if (force) {
        topicsCacheRef.current.delete(chatId);
      }
      const meta = chatMeta ?? chats.find((c) => c.id === chatId) ?? null;
      const now = Date.now();
      let cached = force ? null : topicsCacheRef.current.get(chatId);
      if (!cached && !force) {
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
      // Only skip pure users / known non-forums. Groups & channels always probe
      // topics — hard-false is_forum previously left Group topics empty forever.
      const kind = String(meta?.type || '').toLowerCase();
      const looksGroupOrChannel =
        kind === 'group' || kind === 'channel' || kind === 'supergroup' || !!meta?.is_drive_folder;
      if (
        meta &&
        meta.is_forum === false &&
        !cached?.is_forum &&
        !looksGroupOrChannel &&
        kind === 'user'
      ) {
        setTopics([]);
        setIsForumChat(false);
        setTopicFilter(null);
        topicFilterRef.current = null;
        return;
      }
      // Render a recent memory/persistent snapshot immediately, then revalidate.
      if (cached && now - cached.ts < 5 * 60_000 && !force) {
        if (!isCurrent()) return;
        console.info(`[AutoGram:TopicUI] Using cached topics snapshot: chatId=${chatId}, count=${cached.topics.length}, is_forum=${cached.is_forum}`);
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
        console.info(`[AutoGram:TopicUI] RPC topics result received: chatId=${chatId}, count=${list.length}, is_forum=${forum}`);
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
      } catch (err) {
        console.warn(`[AutoGram:TopicUI] Failed to load topics for chatId=${chatId}:`, err);
        if (isCurrent() && !cached) {
          setTopics([]);
          setIsForumChat(meta?.is_forum === true);
        }
      } finally {
        setTopicsLoading(false);
      }
    },
    [creds, chats]
  );

  /**
   * Fetch the same lightweight category counters Telegram uses for its shared
   * media tabs. This is deliberately an estimate: overlapping MTProto filters
   * are replaced later by the unique metadata walk.
   */
  const refreshQuickMediaStats = useCallback(async () => {
    if (!creds) return;
    const tid = topicFilterRef.current;
    const cacheKey = getDriveCacheKey(creds.session, peerId, tid);
    const gen = peerGen.current;
    const statsGen = topicGenRef.current;
    try {
      const fastStats = await driveGetMediaStats(creds, peerId, tid, liveFilesRef.current.length);
      if (!fastStats || gen !== peerGen.current || statsGen !== topicGenRef.current) return;
      const activeTid =
        topicFilterRef.current != null && Number(topicFilterRef.current) > 0
          ? Number(topicFilterRef.current)
          : null;
      const responseTid =
        fastStats.topicId != null && Number(fastStats.topicId) > 0
          ? Number(fastStats.topicId)
          : null;
      if (activeTid !== responseTid) return;

      const loaded = loadedUniqueMediaCount(liveFilesRef.current);
      const estimate = Math.max(Number(fastStats.totalCount) || 0, loaded);
      setTotalFileCount(estimate);
      filesTotalCountRef.current.set(cacheKey, estimate);
      setCachedMediaBreakdown({
        photoCount: fastStats.photoCount || 0,
        videoCount: fastStats.videoCount || 0,
        fileCount: fastStats.fileCount || 0,
        gifCount: fastStats.gifCount || 0,
        linkCount: fastStats.linkCount || 0,
        audioCount: fastStats.audioCount || 0,
      });
      if (fastStats.totalBytes > 0) {
        setTotalBytes(fastStats.totalBytes);
        filesTotalBytesRef.current.set(cacheKey, fastStats.totalBytes);
      }
      setStatsAccurate(fastStats.isExact === true);
    } catch {
      // Loaded-card count remains the safe fallback while the full walk runs.
    }
  }, [creds, peerId, getDriveCacheKey]);

  /**
   * Accurate location totals (count + bytes) independent of pagination.
   * Starts right after first page (does not wait for scroll). Grid stays fast
   * because only metadata is walked; progressive peek polls update the pill.
   */
  const refreshMediaStats = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!creds) return;
      const tid = topicFilterRef.current;
      const cacheKey = getDriveCacheKey(creds.session, peerId, tid);
      // Never start a second concurrent walk for the same location
      if (mediaStatsLockRef.current.has(cacheKey)) return;
      mediaStatsLockRef.current.add(cacheKey);
      setStatsLoading(true);
      if (opts?.force !== false) setStatsAccurate(false);
      const gen = peerGen.current;
      const statsGen = topicGenRef.current;

      const applyRes = (res: any, _mode: 'progress' | 'final') => {
        if (gen !== peerGen.current || statsGen !== topicGenRef.current) return;
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
              // Final/accurate unique count is authoritative.
              const loaded = loadedUniqueMediaCount(liveFilesRef.current);
              let next = Math.max(n, loaded);
              if (!isFinal && !res?.accurate) {
                if (res?.estimate && res?.total_bytes == null) {
                  // Rough estimate without bytes — only use if prev is not set
                  next = prev != null ? prev : Math.max(n, loaded);
                } else if (prev != null && prev > n && loaded < n) {
                  // Allow exact count n to replace previous inflated estimate
                  next = Math.max(n, loaded);
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
            const snap: any = await driveMediaStats(creds, peerId, {
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
    [creds, peerId, getDriveCacheKey]
  );

  /** Defer the unique media walk so list_topics + first list_files win the MTProto pipe.
   *  Low-end: delayed full walk (still runs — storage accuracy needs it).
   *  urgent: Storage tab / user needs totals now. */
  const scheduleMediaStats = useCallback(
    (opts?: { force?: boolean; delayMs?: number; urgent?: boolean }) => {
      if (mediaStatsTimerRef.current != null) {
        window.clearTimeout(mediaStatsTimerRef.current);
        mediaStatsTimerRef.current = null;
      }
      // Paint Telegram-style estimated totals immediately. The expensive unique
      // scan below remains deferred so cards and thumbnails keep first priority.
      void refreshQuickMediaStats();
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
    [refreshMediaStats, refreshQuickMediaStats]
  );

  // Storage tab needs accurate location size — force unique walk immediately
  useEffect(() => {
    if (!toolsOpen || toolsTab !== 'space' || !creds) return;
    if (statsAccurate && totalBytes != null) return;
    scheduleMediaStats({ force: true, delayMs: 200, urgent: true });
  }, [toolsOpen, toolsTab, creds, peerId, scheduleMediaStats, statsAccurate, totalBytes]);

  const refreshLocations = useCallback(async () => {
    if (!creds) return;
    if (isTransferJobActive()) {
      setStatusText(t('ui.generated.transfer_aktif_refresh_ditunda_099d58a'));
      return;
    }
    // Staged load: paint chats/folders/files as each RPC finishes (never wait for all).
    // Warm session uses 3 parallel cmds; one-shot falls back to bootstrap.
    invalidateAvatarFailures();
    if (folders.length === 0) setLoadingFolders(true);
    if (chats.length === 0) setLoadingChats(true);
    if (files.length === 0) setLoadingFiles(true);
    setStatsAccurate(false);
    setStatsByType(null);
    setError(null);
    const gen = ++peerGen.current;
    const tid = topicFilterRef.current;
    const bootKey = getDriveCacheKey(creds.session, peerId, tid);
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
      setStatusText(t('ui.generated.memuat_drives_780fc8f'));

      // Prefer staged RPCs when warm session is ready (true progressive UI).
      // The first file page gets exclusive network priority; secondary panels
      // start only after it paints so a large dialog/topic list cannot starve it.
      if (isDriveSessionReady() || nativeDriveReadyRef.current) {
        if (peerId == null) {
          setTopics([]);
          setIsForumChat(false);
        }

        const applyFiles = (res: any) => {
          if (gen !== peerGen.current) return;
          const page: DriveFile[] = res.files || [];
          nFiles = page.length;
          filesHasMoreLocal = !!res.has_more;
          // Telegram parity: seed grid thumbs from list_media stripped data NOW,
          // then strip payloads so React state stays light (instant re-render).
          let filesForUi = page;
          if (creds && page.length) {
            primeThumbsFromFileList(creds, peerId, page, thumbLocationOptions);
            // Fill any missing thumbs immediately (one batch) — no wait for scroll.
            const missing = page
              .filter(
                (f) =>
                  canShowDriveThumb(f) && getCachedThumb(peerId, f.id, thumbLocationOptions) == null
              )
              .map((f) => f.id);
            if (missing.length) {
              requestVisibleThumbs(creds, peerId, missing.slice(0, 48), thumbLocationOptions);
            }
            filesForUi = stripInlineThumbsFromFiles(page);
          }
          filesCacheRef.current.set(bootKey, filesForUi);
          liveSyncLastAtRef.current.set(bootKey, Date.now());
          liveSyncFailuresRef.current = 0;
          liveSyncBackoffUntilRef.current = 0;
          sessionLockRetriesRef.current = 0;
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
            setFiles(filesForUi);
            setFilesHasMore(!!res.has_more);
            setNextOffsetId(res.next_offset_id ?? null);
          });
          try {
            saveDriveLocationSnapshot(localStorage, creds.session, peerId, tid, {
              files: filesForUi,
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
                ? t('ui.generated.folder_besar_grid_dimuat_bertahap_jumlah_ukuran__85d18bc')
                : null
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
                  ? t('ui.generated.mode_hemat_grid_kecil_thumb_ringan_scroll_untuk__2c3327a')
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
          .catch(async (e: any) => {
            if (gen !== peerGen.current) return;
            if (isSessionLockError(e) && sessionLockRetriesRef.current < 2) {
              sessionLockRetriesRef.current += 1;
              setStatusText(t('ui.generated.koneksi_terkunci_memulihkan_session_dfba1df'));
              try {
                await stopDriveSession();
                await new Promise((r) => setTimeout(r, 450));
              } catch { /* ignore */ }
              void refreshLocations();
              return;
            }
            sessionLockRetriesRef.current = 0;
            // Warm path must recover PeerChannel here — .catch swallows so the
            // outer try/catch never sees the error (poisoned location stick).
            if (peerId != null && recoverInvalidPeerLocation(e, { gen })) return;
            setError(friendlyDriveError(e));
          })
          .finally(() => {
            if (gen === peerGen.current) setLoadingFiles(false);
          });

        // Run dialog list and file list in parallel over warm daemon session
        const chatsP = driveListChats(creds, { limit: perf.chatPage })
          .then((cr: any) => {
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
              // Re-check gen inside transition — startTransition can flush AFTER
              // a session switch cleared UI, which re-painted the previous account.
              startTransition(() => {
                if (gen !== peerGen.current) return;
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
                if (gen !== peerGen.current) return;
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
          .catch((e: any) => {
            if (gen === peerGen.current) setError(friendlyDriveError(e));
          })
          .finally(() => {
            if (gen === peerGen.current) setLoadingChats(false);
          });

        // 3) Drives [TD] are derived incrementally from dialog pages. The old
        // automatic 500-dialog scan could hold the account lock for 30-60s and
        // make every click/reload wait behind invisible background work.
        const foldersP = chatsP.finally(() => {
          if (gen === peerGen.current) setLoadingFolders(false);
        });

        // "Ready" means the grid is usable; sidebar/folders continue progressively.
        await filesP;
        // The grid has already painted; finishing the bounded first dialog page
        // here prevents the warm health sample from including lock queue time.
        await chatsP;
        void foldersP;
        if (gen !== peerGen.current) return;
        bumpStatus();
        return;
      }

      // One-shot fallback: single bootstrap RPC (no warm worker)
      // driveBootstrap kini TIDAK memblokir pada folder scan.
      // Chats + files sudah tersedia langsung; folder scan berjalan via folderScanPromise.
      setStatusText(t('ui.generated.menyambungkan_mode_satu_kali_ca1d4a0'));
      const boot = await driveBootstrap(creds, peerId, {
        filePageSize: getDrivePerfProfile().filePage,
        chatPageSize: getDrivePerfProfile().chatPage,
        topicId: tid,
      });
      sessionLockRetriesRef.current = 0;
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
      // boot.folders kosong (non-blocking), folder scan proses di background via folderScanPromise
      startTransition(() => {
        if (gen !== peerGen.current) return;
        // Jangan overwrite folder cache yang sudah ada dari sidebar snapshot
        setFolders((prev) => (prev.length > 0 ? prev : withFolderOrphanFlags(boot.folders || [])));
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
            ? t('ui.generated.folder_besar_grid_dimuat_bertahap_jumlah_ukuran__c1251c0')
            : null
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
      const nFilesBoot = (boot.files || []).length;
      const known = clampMediaTotal(boot.total_count, boot.files || []);
      setStatusText(
        `${(boot.chats || []).length} chats · ${
          known != null
            ? boot.files_has_more
              ? `${nFilesBoot} / ${known}${boot.stats_accurate === true ? '' : '+'}`
              : String(known)
            : `${nFilesBoot}${boot.files_has_more ? '+' : ''}`
        } files · folder memuat…`
      );
      if (peerId != null) {
        const meta = (boot.chats || []).find((c: DriveChat) => c.id === peerId) ?? null;
        void loadTopicsForPeer(peerId, meta);
      } else {
        setTopics([]);
        setIsForumChat(false);
      }

      // Proses folderScanPromise di background setelah first paint
      // Folder list muncul setelah scan selesai tanpa memblokir grid display.
      if (boot.folderScanPromise) {
        void boot.folderScanPromise
          .then((fr: { folders?: DriveFolder[] } | DriveFolder[]) => {
            if (gen !== peerGen.current) return;
            const list = (Array.isArray(fr) ? fr : (fr as any)?.folders || []) as DriveFolder[];
            const normalized = withFolderOrphanFlags(Array.isArray(list) ? list : []);
            startTransition(() => {
              if (gen !== peerGen.current) return;
              setFolders(normalized);
            });
            try {
              saveDriveSidebarSnapshot(localStorage, creds.session, { folders: normalized });
            } catch {
              /* sidebar cache is best-effort */
            }
          })
          .catch(() => { /* ignore */ })
          .finally(() => {
            if (gen === peerGen.current) setLoadingFolders(false);
          });
      } else {
        // Defer full TD folder walk (expensive) after first paint
        void driveScanFolders(creds)
          .then((fr: { folders?: DriveFolder[] } | DriveFolder[]) => {
            if (gen !== peerGen.current) return;
            const list = (Array.isArray(fr) ? fr : fr?.folders || []) as DriveFolder[];
            const normalized = withFolderOrphanFlags(Array.isArray(list) ? list : []);
            startTransition(() => {
              if (gen !== peerGen.current) return;
              setFolders(normalized);
            });
            try {
              saveDriveSidebarSnapshot(localStorage, creds.session, { folders: normalized });
            } catch {
              /* sidebar cache is best-effort */
            }
          })
          .catch(() => { /* ignore */ })
          .finally(() => {
            if (gen === peerGen.current) setLoadingFolders(false);
          });
      }
    } catch (e: any) {
      if (gen !== peerGen.current) return;
      if (isSessionLockError(e) && sessionLockRetriesRef.current < 2) {
        sessionLockRetriesRef.current += 1;
        setStatusText(t('ui.generated.koneksi_terkunci_memulihkan_session_dfba1df'));
        try {
          await stopDriveSession();
          await new Promise((r) => setTimeout(r, 450));
        } catch { /* ignore */ }
        void refreshLocations();
        return;
      }
      sessionLockRetriesRef.current = 0;
      if (peerId != null && recoverInvalidPeerLocation(e, { gen })) return;
      setError(friendlyDriveError(e));
    } finally {
      if (gen === peerGen.current) {
        setLoadingFolders(false);
        setLoadingChats(false);
        setLoadingFiles(false);
      }
    }
  }, [
    creds,
    peerId,
    loadTopicsForPeer,
    scheduleMediaStats,
    recoverInvalidPeerLocation,
    getDriveCacheKey,
    thumbLocationOptions,
  ]);

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
    const gen = peerGen.current;
    const sessionAtStart = creds.session;
    // Pause avatar flood while paging dialogs (reduces force-close risk)
    try {
      const { setAvatarsPaused } = await import('../../lib/media/avatarBatcher');
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
      // Session switch / gen invalidate: never append previous account's dialogs.
      if (
        gen !== peerGen.current ||
        sessionAtStart !== creds.session ||
        activeChatFolderIdRef.current !== requestFolderId
      ) {
        return;
      }
      const incoming: DriveChat[] = cr.chats || [];
      setChats((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...incoming.filter((c) => !seen.has(c.id))];
      });
      setChatsOffset(cr.next_offset ?? chatsOffset + incoming.length);
      setChatsHasMore(!!cr.has_more);
      const incomingDrives = incoming
        .filter((chat) => chat.is_drive_folder)
        .map((chat): DriveFolder => ({
          id: chat.id,
          name: chat.name,
          title_raw: chat.title_raw || chat.name,
          username: chat.username ?? null,
          is_drive_folder: true,
          parent_id: null,
        }));
      if (incomingDrives.length) {
        setFolders((previous) => {
          const byId = new Map(previous.map((folder) => [folder.id, folder]));
          for (const folder of incomingDrives) byId.set(folder.id, folder);
          return withFolderOrphanFlags([...byId.values()]);
        });
      }
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
        const { setAvatarsPaused } = await import('../../lib/media/avatarBatcher');
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
    }, Math.max(CHAT_SOFT_PREFETCH_DELAY_MS, 600));
    return () => {
      cancelled = true;
      if (idleId != null) {
        const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        cic?.(idleId);
      }
      if (t != null) window.clearTimeout(t);
    };
  }, [creds, chatsHasMore, chatsLoadingMore, chats.length, loadMoreChats]);

  // After chats for THIS session arrive, restore last peer only if it was a Drive folder and known here.
  useEffect(() => {
    const pending = pendingRestorePeerRef.current;
    if (!pending || !creds) return;
    // Restoring a peer while the Saved Messages bootstrap is still running
    // leaves the new peer selected with the old root rows. Wait until boot has
    // completed, then the peer-change effect can clear and fetch atomically.
    if (!bootDone.current) return;
    if (pending.kind !== 'drive' || pending.id == null) {
      pendingRestorePeerRef.current = null;
      return;
    }
    // Wait until we have some dialog signal for this session
    if (chats.length === 0 && folders.length === 0 && loadingChats) return;
    const id = pending.id;
    const known = folders.some((f) => f.id === id);
    pendingRestorePeerRef.current = null;
    if (!known) {
      // Stale peer from another life of this session name — clear storage.
      saveDrivePeer(creds.session, { kind: 'saved', id: null });
      return;
    }
    setLocationKind('drive');
    setActivePeerId(id);
  }, [creds, chats, folders, loadingChats, bootRevision]);

  const refreshFiles = useCallback(async (retryCount = 0, opts?: { preserveError?: boolean }) => {
    if (!creds) return;
    if (isTransferJobActive()) {
      setStatusText(t('ui.generated.transfer_aktif_refresh_ditunda_099d58a'));
      return;
    }
    const gen = ++peerGen.current;
    // Allow thumb re-fetch after manual refresh (soft-fails cleared; success cache kept)
    invalidateThumbFailures();
    setThumbsPaused(false);
    setLoadingFiles(true);
    setStatsAccurate(false);
    setStatsByType(null);
    if (!opts?.preserveError) {
      setError(null);
    }
    setSelectedIds([]);
    selectionAnchorRef.current = null;
    let tid = topicFilterRef.current;
    let cacheKey = getDriveCacheKey(creds.session, peerId, tid);
    activeFilesCacheKeyRef.current = cacheKey;

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
    if (instantFiles && instantFiles.length > 0) {
      setFiles(dedupeByMsgId(instantFiles));
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
      }
      setLoadingFiles(false);
    } else {
      setFiles([]);
      setTotalFileCount(null);
      setTotalBytes(null);
      setFilesHasMore(false);
      setNextOffsetId(null);
      // Fast Stale-While-Revalidate: load IndexedDB records immediately for 0ms paint
      const mediaContext = buildDriveMediaContext(creds.session, peerId, tid);
      void getMediaPageByContext(mediaContext, 'newest', 0, 100)
        .then((dbRecords: MediaRecord[]) => {
          if (gen === peerGen.current && activeFilesCacheKeyRef.current === cacheKey && dbRecords && dbRecords.length > 0) {
            let filtered = dbRecords;
            if (tid != null && tid > 0) {
              filtered = dbRecords.filter((r: any) => Number(r.topic_id ?? r.topicId) === Number(tid));
            }
            if (filtered.length > 0) {
              const deduped = dedupeByMsgId(filtered);
              setFiles(deduped);
              filesCacheRef.current.set(cacheKey, deduped);
              setLoadingFiles(false);
            }
          }
        })
        .catch(() => undefined);
    }

    try {
      setStatusText(tid != null ? t('ui.generated.listing_files_topik_3ccdf69') : t('ui.generated.listing_files_8ddd84f'));
      const perf = getDrivePerfProfile();
      let res = await driveListFiles(creds, peerId, {
        pageSize: stagedInitialPageSize(perf.tier, perf.filePage),
        topicId: tid,
        quickStats: false,
        sortMode: 'newest',
        localOffset: 0,
        bypassCache: false,
      });
      if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return;
      if (res?.invalid_topic && tid != null) {
        // Recover stale/deleted/cross-peer topic selection without showing a
        // fatal location error. Reopen the active peer as "Semua media".
        tid = null;
        cacheKey = getDriveCacheKey(creds.session, peerId, null);
        activeFilesCacheKeyRef.current = cacheKey;
        setTopicFilter(null);
        topicFilterRef.current = null;
        topicsRequestSeqRef.current += 1;
        setTopics([]);
        setIsForumChat(false);
        res = await driveListFiles(creds, peerId, {
          pageSize: stagedInitialPageSize(perf.tier, perf.filePage),
          topicId: null,
          quickStats: false,
          sortMode: 'newest',
          localOffset: 0,
          bypassCache: false,
        });
        if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return;
        if (peerId != null) void loadTopicsForPeer(peerId);
      }
      let page: DriveFile[] = dedupeByMsgId(res.files || []);
      // Auto-paginate if topic scan returned 0 files but Telegram indicates has_more (supports deep topics up to 10k msgs)
      if (page.length === 0 && res.has_more && tid != null && res.next_offset_id && gen === peerGen.current) {
        let currentOffset = res.next_offset_id;
        let attempts = 0;
        while (page.length === 0 && currentOffset > 0 && attempts < 10 && gen === peerGen.current && activeFilesCacheKeyRef.current === cacheKey) {
          attempts++;
          const nextRes = await driveListFiles(creds, peerId, {
            pageSize: stagedInitialPageSize(perf.tier, perf.filePage),
            topicId: tid,
            offsetId: currentOffset,
            quickStats: false,
            sortMode: 'newest',
            localOffset: 0,
            bypassCache: true,
          });
          if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return;
          page = dedupeByMsgId(nextRes.files || []);
          if (page.length > 0) {
            setFiles(page);
            setLoadingFiles(false);
          }
          res.has_more = nextRes.has_more;
          res.next_offset_id = nextRes.next_offset_id;
          currentOffset = nextRes.next_offset_id || 0;
        }
      }
      if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return;
      // Instant grid thumbs from list response (no second thumbs_batch wait).
      if (page.length) {
        primeThumbsFromFileList(creds, peerId, page, thumbLocationOptions);
        const missing = page
          .filter((f) => canShowDriveThumb(f) && getCachedThumb(peerId, f.id, thumbLocationOptions) == null)
          .map((f) => f.id);
        if (missing.length) requestVisibleThumbs(creds, peerId, missing.slice(0, 48), thumbLocationOptions);
        page = stripInlineThumbsFromFiles(page);
      }
      if (res.status === 'success' && !res.cached && page.length > 0) {
        const mediaContext = buildDriveMediaContext(creds.session, peerId, tid);
        void saveMediaRecords(scopeMediaRecords(page, mediaContext, peerId || 0))
          .catch(err => console.warn('[Cache] Failed to warm cache:', err));
      }

      // Update cache — only apply totals that belong to this peer+topic key
      liveSyncLastAtRef.current.set(cacheKey, Date.now());
      liveSyncFailuresRef.current = 0;
      liveSyncBackoffUntilRef.current = 0;
      if (res.total_count != null) {
        const n = clampMediaTotal(res.total_count, page);
        if (n != null) {
          filesTotalCountRef.current.set(cacheKey, n);
          setTotalFileCount((prev) => {
            if (!filesHasMoreRef.current || res.accurate) return n;
            return prev != null ? n : n;
          });
        }
      } else if (tid != null) {
        const known = filesTotalCountRef.current.get(cacheKey);
        setTotalFileCount((prev) => (prev != null ? prev : known != null ? known : null));
      }
      if (res.total_bytes != null) {
        const b = clampMediaBytes(res.total_bytes, page);
        if (b != null) {
          filesTotalBytesRef.current.set(cacheKey, b);
          setTotalBytes((prev) => (prev != null ? Math.max(prev, b) : b));
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

      setFiles((prev) => {
        if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) {
          return prev;
        }
        if (activeFilesCacheKeyRef.current === cacheKey && prev.length > page.length && page.length > 0) {
          const merged = reconcileDriveLiveHead(prev, page, !!res.has_more, { isExplicitRefresh: true });
          filesCacheRef.current.set(cacheKey, merged);
          return merged;
        }
        activeFilesCacheKeyRef.current = cacheKey;
        filesCacheRef.current.set(cacheKey, page);
        return page;
      });
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
        setStatusText(i18n.t("speedtest.status_loaded_files", { count: page.length, more: hasMore ? "+" : "", topicNote }));
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
            ? t('ui.generated.folder_besar_grid_dimuat_bertahap_jumlah_ukuran__c1251c0')
            : null
        );
        // Topic history can still be large. Keep it in the same late stage so
        // switching topic never reintroduces a startup CPU/network spike.
        scheduleMediaStats({
          force: true,
          delayMs: INITIAL_STATS_DELAY_MS,
        });
      }

      if (res.cached && creds) {
        // Ultra-fast background sync of top 30 messages directly from Telegram server
        void (async () => {
          try {
            const syncRes = await driveListFiles(creds, peerId, {
              pageSize: 30,
              topicId: tid,
              sortMode: sortMode,
              quickStats: false,
              bypassCache: true,
            });
            if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return;
            if (syncRes?.status === 'success' && syncRes.files && syncRes.files.length > 0) {
              let freshPage = dedupeByMsgId(syncRes.files);
              primeThumbsFromFileList(creds, peerId, freshPage, thumbLocationOptions);
              const missing = freshPage
                .filter((f) => canShowDriveThumb(f) && getCachedThumb(peerId, f.id, thumbLocationOptions) == null)
                .map((f) => f.id);
              if (missing.length) requestVisibleThumbs(creds, peerId, missing.slice(0, 48), thumbLocationOptions);
              freshPage = stripInlineThumbsFromFiles(freshPage);

              setFiles((prev) => {
                if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return prev;
                const merged = reconcileDriveLiveHead(prev, freshPage, !!syncRes.has_more, { isExplicitRefresh: true });
                filesCacheRef.current.set(cacheKey, merged);
                return merged;
              });
              const mediaContext = buildDriveMediaContext(creds.session, peerId, tid);
              void saveMediaRecords(scopeMediaRecords(freshPage, mediaContext, peerId || 0)).catch(() => undefined);
            }
          } catch (err) {
            console.warn('[RealtimeSync] Background top-page sync failed:', err);
          }
        })();
      }
    } catch (e: any) {
      if (gen !== peerGen.current) return;
      if (peerId != null && recoverInvalidPeerLocation(e, { gen })) return;
      const isLock = isSessionLockError(e);
      if (isLock && retryCount < 3) {
        setStatusText(`Session sibuk, mencoba kembali (${retryCount + 1}/3)…`);
        window.setTimeout(() => {
          if (gen === peerGen.current) {
            void refreshFilesRef.current?.(retryCount + 1);
          }
        }, 1200);
        return;
      }
      setError(friendlyDriveError(e));
      setStatusText(t('ui.generated.list_failed_520195e'));
    } finally {
      setLoadingFiles(false);
      if (gen === peerGen.current) {
        // Resume thumbs after list settles
        window.setTimeout(() => {
          if (gen === peerGen.current) {
            invalidateThumbFailures();
            setThumbsPaused(false);
          }
        }, getDrivePerfProfile().thumbResumeMs);
      }
    }
  }, [
    creds,
    peerId,
    scheduleMediaStats,
    loadTopicsForPeer,
    recoverInvalidPeerLocation,
    getDriveCacheKey,
    thumbLocationOptions,
  ]);

  useEffect(() => {
    refreshFilesRef.current = refreshFiles;
  }, [refreshFiles]);

  // Real-time updates event listener
  useEffect(() => {
    if (!creds) return;
    const unsub = addDriveEventListener(async (evt: any) => {
      if (evt.type === 'index_progress') {
        const folderKey = evt.folderId || 0;
        if (Array.isArray(evt.items)) {
          const context = buildDriveMediaContext(creds.session, folderKey || null, null);
          await saveMediaRecords(scopeMediaRecords(evt.items, context, folderKey))
            .catch(err => console.error('[Index] Save failed:', err));
        }
        setIndexingJob({
          active: true,
          processed: evt.processedCount,
          total: evt.totalCount,
          text: `Mengindeks media: ${evt.processedCount} / ${evt.totalCount} file...`
        });
      } else if (evt.type === 'index_complete') {
        const folderKey = evt.folderId || 0;
        await saveCheckpoint({
          jobId: evt.jobId,
          folderId: folderKey,
          sortMode: '',
          lastOffsetId: 0,
          processedCount: evt.processedCount,
          totalCount: evt.totalCount,
          status: 'completed',
          timestamp: new Date().toISOString(),
          version: 1
        }).catch(err => console.error('[Index] Save checkpoint failed:', err));
        
        setIndexingJob({ active: false, processed: 0, total: 0, text: '' });
        void refreshFiles();
      } else if (evt.type === 'update') {
        const folderKey = evt.folder_id || 0;
        const currentActiveFolder = peerId || 0;
        const eventPeerId = folderKey || null;
        const eventTopicId = folderKey === currentActiveFolder ? topicFilterRef.current : null;
        const eventContext = buildDriveMediaContext(creds.session, eventPeerId, eventTopicId);
        
        if (evt.action === 'new' && evt.file) {
          await saveMediaRecords(scopeMediaRecords([evt.file], eventContext, folderKey)).catch(() => null);
          if (folderKey === currentActiveFolder) {
            setFiles(prev => {
              if (prev.some(f => f.id === evt.file.id)) return prev;
              const matchesTopic = topicFilterRef.current === undefined || topicFilterRef.current === null || evt.file.topic_id === topicFilterRef.current;
              if (!matchesTopic) return prev;
              return [evt.file, ...prev];
            });
          }
        } else if (evt.action === 'delete' && Array.isArray(evt.message_ids)) {
          await deleteMediaRecordsForPeer(
            creds.session,
            eventPeerId == null ? 'me' : String(eventPeerId),
            evt.message_ids
          ).catch(() => null);
          if (folderKey === currentActiveFolder) {
            const idsToDelete = new Set(evt.message_ids);
            setFiles(prev => prev.filter(f => !idsToDelete.has(f.id)));
          }
        } else if (evt.action === 'edit' && evt.file) {
          await saveMediaRecords(scopeMediaRecords([evt.file], eventContext, folderKey)).catch(() => null);
          if (folderKey === currentActiveFolder) {
            setFiles(prev => prev.map(f => f.id === evt.file.id ? evt.file : f));
          }
        }
      }
    });
    return () => {
      unsub();
    };
  }, [creds, peerId, refreshFiles]);

  const processPendingActions = useCallback(async () => {
    if (!creds || !navigator.onLine) return;
    try {
      const pending = await getPendingActions();
      if (pending.length === 0) return;
      
      setStatusText(`Memproses ${pending.length} tindakan tertunda...`);
      for (const action of pending) {
        try {
          await updateActionStatus(action.id, 'processing');
          if (action.type === 'rename') {
            await driveRename(creds, action.target.messageId, action.target.chatId, action.payload.newName || '');
          } else if (action.type === 'delete') {
            await driveDeleteBatch(creds, [action.target.messageId], action.target.chatId);
          }
          await deleteAction(action.id);
        } catch (err) {
          console.error('[ActionQueue] Failed to execute action:', action, err);
          await updateActionStatus(action.id, 'failed', String(err));
        }
      }
      setStatusText(t('ui.generated.tindakan_tertunda_selesai_diproses_8566b32'));
      void refreshFiles();
    } catch (e) {
      console.warn('[ActionQueue] processPendingActions failed:', e);
    }
  }, [creds, refreshFiles]);

  useEffect(() => {
    window.addEventListener('online', processPendingActions);
    const interval = window.setInterval(processPendingActions, 15000);
    return () => {
      window.removeEventListener('online', processPendingActions);
      window.clearInterval(interval);
    };
  }, [processPendingActions]);

  const loadMoreFiles = useCallback(async (opts?: { pageSize?: number }) => {
    const currentOffset = nextOffsetIdRef.current;
    if (!creds || !filesHasMoreRef.current || loadingMoreFiles || loadMoreLock.current) return;
    if (currentOffset == null) {
      filesHasMoreRef.current = false;
      setFilesHasMore(false);
      return;
    }
    loadMoreLock.current = true;
    setLoadingMoreFiles(true);
    // Metadata and media use independent worker lanes. Keep thumbnails moving
    // on mid/high devices; only constrained devices pause during pagination.
    const pauseThumbsForPaging = getDrivePerfProfile().tier === 'low';
    if (pauseThumbsForPaging) setThumbsPaused(true);
    setStatusText(t('ui.generated.memuat_lebih_banyak_4a5fdda'));
    const gen = peerGen.current;
    const tid = topicFilterRef.current;
    const cacheKey = getDriveCacheKey(creds?.session || session, peerId, tid);
    const offsetAtStart = currentOffset;
    const requestedPageSize =
      opts?.pageSize ||
      stagedLoadMorePageSize(
        getDrivePerfProfile().tier,
        getDrivePerfProfile().loadMorePage
      );
    try {
      const res = await driveListFiles(creds, peerId, {
        pageSize: requestedPageSize,
        offsetId: offsetAtStart,
        topicId: tid,
        quickStats: false,
        sortMode: 'newest',
        localOffset: files.length,
      });
      if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return;
      let page: DriveFile[] = res.files || [];
      if (page.length) {
        primeThumbsFromFileList(creds, peerId, page, thumbLocationOptions);
        page = stripInlineThumbsFromFiles(page);
      }
      if (res.status === 'success' && !res.cached && page.length > 0) {
        const mediaContext = buildDriveMediaContext(creds.session, peerId, tid);
        void saveMediaRecords(scopeMediaRecords(page, mediaContext, peerId || 0))
          .catch(err => console.warn('[Cache] Failed to warm cache:', err));
      }
      // Avoid stuck pagination if API returned empty but claimed has_more
      if (!page.length) {
        const exactFiles = liveFilesRef.current;
        const exactCount = loadedUniqueMediaCount(exactFiles);
        const exactBytes = loadedMediaBytes(exactFiles);
        const previousTarget = filesTotalCountRef.current.get(cacheKey) ?? exactCount;
        const excludedMessages = Math.max(0, previousTarget - exactCount);
        filesHasMoreRef.current = false;
        setFilesHasMore(false);
        nextOffsetIdRef.current = null;
        setNextOffsetId(null);
        setTotalFileCount(exactCount);
        setTotalBytes(exactBytes);
        filesTotalCountRef.current.set(cacheKey, exactCount);
        filesTotalBytesRef.current.set(cacheKey, exactBytes);
        setStatsAccurate(true);
        setStatsLoading(false);
        if (mediaStatsTimerRef.current != null) {
          window.clearTimeout(mediaStatsTimerRef.current);
          mediaStatsTimerRef.current = null;
        }
        setStatusText(
          excludedMessages > 0
            ? t('speedtest.media_index_reconciled', {
                media: exactCount.toLocaleString(),
                skipped: excludedMessages.toLocaleString(),
              })
            : t('ui.generated.semua_media_dimuat_2310a13')
        );
        return;
      }
      setFiles((prev) => {
        if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return prev;
        const seen = new Set(prev.map((f) => f.id));
        const merged = [...prev, ...page.filter((f) => !seen.has(f.id))];
        if (merged.length >= 10000) {
          setScaleHint(t('ui.generated.folder_sangat_besar_10k_gunakan_filter_search_mu_26d5d50'));
        } else if (merged.length >= 1000) {
          setScaleHint(t('ui.generated.1_000_item_dimuat_bertahap_hanya_baris_terlihat__2b683ad'));
        }
        const known = filesTotalCountRef.current.get(cacheKey);
        setStatusText(
          known != null
            ? `${merged.length} / ${known}${statsAccurate ? '' : '+'} files`
            : `${merged.length}${res.has_more ? '+' : ''} files`
        );

        // Update cache with merged data
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
      let next = res.next_offset_id ?? null;
      // Guard: if cursor did not advance, decrement by 1 to strictly step past scanned message IDs
      if (next != null && Number(next) === Number(offsetAtStart)) {
        next = Number(next) > 1 ? Number(next) - 1 : null;
      }
      const hasMoreNext = !!res.has_more && next != null;
      filesHasMoreRef.current = hasMoreNext;
      setFilesHasMore(hasMoreNext);
      nextOffsetIdRef.current = next;
      setNextOffsetId(next);
      if (next == null) {
        filesHasMoreRef.current = false;
        setFilesHasMore(false);
      }
      // Scrolled to end: loaded length is a lower bound; prefer media_stats if higher
      if (!res.has_more) {
        filesHasMoreRef.current = false;
        setFilesHasMore(false);
        setFiles((prev) => {
          const exactBytes = prev.reduce((s, f) => s + (f.size || 0), 0);
          const cacheKey = getDriveCacheKey(creds.session, peerId, tid);
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
        const errMsg = String(e?.message || e || '');
        const fwMatch = errMsg.match(/FLOOD_WAIT_?(\d+)/i) || errMsg.match(/wait\s*(\d+)\s*s/i);
        if (fwMatch) {
          const sec = parseInt(fwMatch[1], 10) || 10;
          throw new Error(`FLOOD_WAIT_${sec}`);
        }
        setError(friendlyDriveError(e));
        setStatusText(t('ui.generated.load_more_gagal_b4ced02'));
        throw e;
      }
    } finally {
      if (pauseThumbsForPaging) setThumbsPaused(false);
      // Immediate lock release so next pagination page loads seamlessly
      loadMoreLock.current = false;
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
    files,
    getDriveCacheKey,
    thumbLocationOptions,
  ]);

  const indexingActiveRef = useRef(false);
  const [indexingAllActive, setIndexingAllActive] = useState(false);

  const handleIndexAllMetadata = useCallback(async () => {
    if (indexingActiveRef.current || !filesHasMore || loadingMoreFiles) return;
    indexingActiveRef.current = true;
    setIndexingAllActive(true);
    setStatusText(t('speedtest.index_all_running'));

    const gen = peerGen.current;
    const tid = topicFilterRef.current;
    const cacheKey = getDriveCacheKey(creds?.session || session, peerId, tid);

    try {
      while (
        indexingActiveRef.current &&
        filesHasMoreRef.current &&
        nextOffsetIdRef.current &&
        gen === peerGen.current &&
        activeFilesCacheKeyRef.current === cacheKey
      ) {
        const offset = nextOffsetIdRef.current;
        const res = await driveListFiles(creds, peerId, {
          pageSize: 200,
          offsetId: offset,
          topicId: tid,
          quickStats: false,
          sortMode: 'newest',
          localOffset: liveFilesRef.current.length,
        });

        if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) break;

        let page: DriveFile[] = res?.files || [];
        if (page.length) {
          page = stripInlineThumbsFromFiles(page);
          const mediaContext = buildDriveMediaContext(creds.session, peerId, tid);
          void saveMediaRecords(scopeMediaRecords(page, mediaContext, peerId || 0)).catch(() => {});
        }

        if (!page.length || !res.has_more || !res.next_offset_id) {
          filesHasMoreRef.current = false;
          setFilesHasMore(false);
          nextOffsetIdRef.current = null;
          setNextOffsetId(null);
          break;
        }

        setFiles((prev) => {
          if (gen !== peerGen.current || activeFilesCacheKeyRef.current !== cacheKey) return prev;
          const seen = new Set(prev.map((f) => f.id));
          return [...prev, ...page.filter((f) => !seen.has(f.id))];
        });

        nextOffsetIdRef.current = res.next_offset_id;
        setNextOffsetId(res.next_offset_id);

        // Safe throttle 150ms to prevent floodwait
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (err: any) {
      console.warn('[Indexer] Background indexer caught error:', err);
    } finally {
      indexingActiveRef.current = false;
      setIndexingAllActive(false);
      setStatusText(t('ui.generated.semua_media_dimuat_2310a13'));
    }
  }, [filesHasMore, loadingMoreFiles, creds, peerId, session, getDriveCacheKey, t]);

  const syncActiveLocationLive = useCallback(
    async (reason: 'interval' | 'focus') => {
      if (!creds || loadingFiles || loadingMoreFiles || liveSyncLockRef.current) return;
      if (isTransferJobActive()) return;
      if (document.visibilityState === 'hidden') return;

      const plan = getDriveLiveSyncPlan(getDrivePerfProfile().tier);
      const now = Date.now();
      if (now < liveSyncBackoffUntilRef.current) return;
      const tid = topicFilterRef.current;
      const cacheKey = getDriveCacheKey(creds?.session || session, peerId, tid);
      const minAge = reason === 'focus' ? plan.focusMinAgeMs : plan.intervalMs;
      const lastAt = liveSyncLastAtRef.current.get(cacheKey) || 0;
      if (now - lastAt < minAge) return;

      liveSyncLockRef.current = true;
      const reqId = ++syncReqIdRef.current;  // snapshot sebelum await
      const gen = peerGen.current;
      const loadedBefore = liveFilesRef.current.length;
      const cursorBefore = nextOffsetId;
      const hasMoreBefore = filesHasMore;
      try {
        const res = await driveListFiles(creds, peerId, {
          pageSize: plan.pageSize,
          topicId: tid,
          quickStats: false,
          bypassCache: true,
        });
        if (gen !== peerGen.current || tid !== topicFilterRef.current || activeFilesCacheKeyRef.current !== cacheKey) return;
        if (reqId !== syncReqIdRef.current) return;  // request baru sudah dikirim, buang respons lama
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
        setStatusText(i18n.t("speedtest.status_live_sync", { count: merged.length, more: res.has_more ? "+" : "" }));
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
    void loadSessions();
    // Mount-only: re-running on session change used to re-pick ACTIVE_SESSIONS[0]
    // and snap the UI back to the previous account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unlock thumb pipeline quickly after files land (no multi-second idle).
  useEffect(() => {
    if (!creds) {
      setProgressiveReady(false);
      setThumbBootstrapMode(true);
      return;
    }
    if (loadingFiles) {
      setProgressiveReady(false);
      setThumbBootstrapMode(true);
      return;
    }
    const delay = progressiveSettleDelayMs(getDrivePerfProfile().tier);
    if (delay <= 0) {
      setProgressiveReady(true);
      setThumbBootstrapMode(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setProgressiveReady(true);
      setThumbBootstrapMode(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [creds?.session, peerId, topicFilter, loadingFiles]);

  useEffect(() => {
    return () => setThumbBootstrapMode(false);
  }, []);

  // Boot: warm session + bootstrap. Uses last session immediately (no wait for list-sessions).
  useEffect(() => {
    if (!creds) {
      setDriveReady(false);
      return;
    }
    let cancelled = false;
    bootDone.current = false;
    setDriveReady(false);
    nativeDriveReadyRef.current = false;
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
          const key = getDriveCacheKey(creds.session, null, null);
          const dedupedBootFiles = dedupeByMsgId(location.files);
          filesCacheRef.current.set(key, dedupedBootFiles);
          activeFilesCacheKeyRef.current = key;
          setFiles(dedupedBootFiles);
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
            setFiles(dedupeByMsgId(parsed.files || []));
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
        setStatusText(switched ? t('ui.generated.menyambungkan_drive_7c38d21') : t('ui.generated.memuat_drives_780fc8f'));
        if (folders.length === 0) setLoadingFolders(true);
        if (chats.length === 0) setLoadingChats(true);
        if (files.length === 0) setLoadingFiles(true);
        try {
          const { setAvatarsPaused } = await import('../../lib/media/avatarBatcher');
          setAvatarsPaused(true);
        } catch {
          /* ignore */
        }
        const { tgAuthStatus } = await import('../../lib/telegram');
        const authStartedAt = performance.now();
        const native = await tgAuthStatus({
          session: creds.session,
          apiId: Number(creds.apiId),
          apiHash: creds.apiHash,
        });
        if (cancelled) return;
        const nativeConnected = !!native?.ok && !!native.data?.authorized;
        reportNativeLatency(performance.now() - authStartedAt, nativeConnected);
        if (!nativeConnected) {
          throw new Error(native?.userMessage || 'Session belum terotorisasi di Telegram. Login ulang dari menu Account.');
        }
        setDriveReady(true);
        nativeDriveReadyRef.current = true;
        setThumbsPaused(false);
        invalidateThumbFailures();
        setStatusText(t('ui.generated.grammers_terhubung_memuat_drive_b87aa7c'));
        const ok = nativeConnected;
        if (cancelled) return;
        // Show "terhubung" as soon as worker is warm — don't wait for lists
        setDriveReady(ok || isDriveSessionReady());
        setStatusText(ok || isDriveSessionReady() ? t('ui.generated.drive_terhubung_memuat_6902ef1') : t('ui.generated.memuat_drives_780fc8f'));
        await refreshLocations();
        // The first measurement includes TCP/MTProto cold connect. Once the
        // visible grid is ready, sample the reused SenderPool once so the UI
        // reports real warm latency instead of mislabeling cold startup time.
        if (!cancelled) {
          try {
            const warmStartedAt = performance.now();
            const warm = await tgAuthStatus({
              session: creds.session,
              apiId: Number(creds.apiId),
              apiHash: creds.apiHash,
            });
            reportNativeLatency(
              performance.now() - warmStartedAt,
              !!warm?.ok && !!warm.data?.authorized
            );
          } catch {
            // The successful file page remains authoritative; the next useful
            // operation will evict/reconnect a stale cached SenderPool.
          }
        }
        if (!cancelled) {
          bootDone.current = true;
          setBootRevision((value) => value + 1);
          setDriveReady(isDriveSessionReady() || ok);
          const perfHint = perfStatusHint();
          setStatusText(
            isDriveSessionReady() || nativeDriveReadyRef.current
              ? perfHint
                ? `Drive siap · ${perfHint}`
                : t('ui.generated.drive_siap_6dadac7')
              : t('ui.generated.drive_mode_satu_kali_d2784d5')
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
            const { setAvatarsPaused } = await import('../../lib/media/avatarBatcher');
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
          setStatusText(t('nav.status_idle'));
          try {
            const { setAvatarsPaused } = await import('../../lib/media/avatarBatcher');
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

    // Instantly wipe files and reset thumb context to prevent bleeding from previous peer
    setFiles([]);
    setLoadingFiles(true);
    setThumbContext(creds, peerId, null);

    // Cancel deferred stats for previous peer
    if (mediaStatsTimerRef.current != null) {
      window.clearTimeout(mediaStatsTimerRef.current);
      mediaStatsTimerRef.current = null;
    }
    setStatsAccurate(false);
    setStatsByType(null);
    setCachedMediaBreakdown(null);
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
  }, [peerId, creds, chats.length, refreshFiles, loadTopicsForPeer]);

  const handleTopicFilter = useCallback(
    (t: DriveTopicFilter) => {
      if (activePeerRef.current !== peerId) return;
      if (t != null && topics.length > 0 && !topics.some((topic) => String(topic.id) === String(t))) return;
      if (t === topicFilterRef.current) return;

      const currentGen = ++topicGenRef.current;
      console.info(`[AutoGram:TopicUI] Filter switch initiated: targetTopicId=${t}, peerId=${peerId}, gen=${currentGen}`);

      // CRITICAL: bump peerGen FIRST (synchronously) so every concurrent async
      // operation (loadMoreFiles, liveSync, uploadSoftRefresh, stats walk) sees
      // the generation mismatch immediately and discards its in-flight result.
      // This must happen BEFORE any await/setTimeout so there is zero window
      // where stale data from the old topic can land after we clear state.
      peerGen.current += 1;

      // Release loadMore lock — any in-flight loadMore will see peerGen mismatch
      // and discard its result; releasing the lock here lets the new topic load start.
      loadMoreLock.current = false;
      setLoadingMoreFiles(false);

      setTopicFilter(t);
      topicFilterRef.current = t;
      setError(null);
      setSelectedIds([]);
      selectionAnchorRef.current = null;

      // Instantly wipe stale files state to prevent media bleeding from previous topic/peer
      setFiles([]);
      setLoadingFiles(true);

      // Instantly clear thumbnail queue for previous topic scope
      setThumbContext(creds, peerId, t);
      // Drop previous location totals and cache immediately so all-media count/grid
      // never sticks on previous topic while the new topic loads.
      const cacheKey = getDriveCacheKey(creds?.session || session, peerId, t);
      activeFilesCacheKeyRef.current = cacheKey;
      filesCacheRef.current.delete(cacheKey);

      setTotalFileCount(null);
      setTotalBytes(null);
      setStatsByType(null);
      setCachedMediaBreakdown(null);
      setStatsAccurate(false);
      setStatsLoading(true);

      // Cancel deferred stats and previous topic switch timers
      if (mediaStatsTimerRef.current != null) {
        window.clearTimeout(mediaStatsTimerRef.current);
        mediaStatsTimerRef.current = null;
      }
      if (topicDebounceTimerRef.current != null) {
        window.clearTimeout(topicDebounceTimerRef.current);
        topicDebounceTimerRef.current = null;
      }

      // Execute topic refresh with a micro-debounce to coalesce rapid topic clicks
      topicDebounceTimerRef.current = window.setTimeout(() => {
        if (currentGen === topicGenRef.current && activePeerRef.current === peerId) {
          console.info(`[AutoGram:TopicUI] Executing topic refresh: topicId=${t}, peerId=${peerId}, gen=${currentGen}`);
          void refreshFiles();
        } else {
          console.info(`[AutoGram:TopicUI] Ignored stale topic refresh: topicId=${t}, currentGen=${topicGenRef.current}, expectedGen=${currentGen}`);
        }
      }, 50);
    },
    [refreshFiles, creds, peerId, topics, session]
  );



  /**
   * Lightweight head-refresh triggered after each successful upload item.
   * Uses the same live-sync reconcile path (no loading spinner, no thumb-pause,
   * no selection reset). Throttled to one concurrent fetch at a time.
   */
  const uploadSoftRefresh = useCallback(async (force = false) => {
    if (!creds || uploadRefreshLockRef.current) return;
    if (!force && isTransferJobActive()) return;
    uploadRefreshLockRef.current = true;
    const gen = peerGen.current;
    const tid = topicFilterRef.current;
    const cacheKey = getDriveCacheKey(creds?.session || session, peerId, tid);
    const cursorBefore = nextOffsetId;
    const hasMoreBefore = filesHasMore;
    try {
      const perf = getDrivePerfProfile();
      const pageSize = perf.tier === 'low' ? 8 : perf.tier === 'mid' ? 12 : 16;
      const res = await driveListFiles(creds, peerId, {
        pageSize,
        topicId: tid,
        quickStats: false,
      });
      if (gen !== peerGen.current || tid !== topicFilterRef.current || activeFilesCacheKeyRef.current !== cacheKey) return;
      const liveHead: DriveFile[] = dedupeByMsgId(res.files || []);

      // Realtime thumbnail priming for newly uploaded/discovered files
      primeThumbsFromFileList(creds, peerId, liveHead, thumbLocationOptions);
      const missing = liveHead
        .filter((f) => canShowDriveThumb(f) && getCachedThumb(peerId, f.id, thumbLocationOptions) == null)
        .map((f) => f.id);
      if (missing.length) {
        requestVisibleThumbs(creds, peerId, missing.slice(0, 48), thumbLocationOptions);
      }

      const keptExtendedPages = !!res.has_more && liveFilesRef.current.length > liveHead.length;
      const merged = reconcileDriveLiveHead(liveFilesRef.current, liveHead, !!res.has_more);
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
      if (res.total_count != null && Number.isFinite(Number(res.total_count))) {
        const total = clampMediaTotal(res.total_count, merged) ?? merged.length;
        filesTotalCountRef.current.set(cacheKey, total);
        setTotalFileCount(total);
      }
      if (res.total_bytes != null && Number.isFinite(Number(res.total_bytes))) {
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
      } catch { /* cache is best-effort */ }
      // Stamp live-sync so the periodic timer skips a redundant fetch right after
      liveSyncLastAtRef.current.set(cacheKey, Date.now());
      liveSyncFailuresRef.current = 0;
      liveSyncBackoffUntilRef.current = 0;
    } catch {
      /* Soft-refresh failure is silent; live sync will pick up on next interval */
    } finally {
      uploadRefreshLockRef.current = false;
    }
  }, [creds, peerId, nextOffsetId, filesHasMore, thumbLocationOptions]);

  // Real-time transfer progress and thumbnail synchronization listener
  // Uses a debounced batch accumulator so rapid StudioItemDone events from
  // large transfers are coalesced into a single uploadSoftRefresh + thumb retry
  // instead of firing one API call per completed file (thundering herd prevention).
  const transferDoneIdsRef = useRef<number[]>([]);
  const transferDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbRetryTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const flushTransferDone = useCallback(() => {
    if (!creds) return;
    const ids = [...transferDoneIdsRef.current];
    transferDoneIdsRef.current = [];
    // 1. Refresh file list to include newly uploaded entries
    void uploadSoftRefresh(true);
    // 2. Notify broadcast so other subscribers (e.g. DriveFileCard) know
    if (ids.length > 0) {
      notifyTransferBatchDone(ids, peerId, thumbLocationOptions);
    }
    // 3. Smart retry: if thumbnail still missing after uploadSoftRefresh,
    //    retry with increasing backoff (1.5s / 3s / 6s) — handles the case
    //    where Telegram CDN hasn't indexed the file's thumbnail yet.
    if (ids.length > 0) {
      const retryDelays = [1500, 3000, 6000];
      for (const t of thumbRetryTimerRef.current) clearTimeout(t);
      thumbRetryTimerRef.current = [];
      let accumulatedDelay = 0;
      for (const delay of retryDelays) {
        accumulatedDelay += delay;
        const t = setTimeout(() => {
          if (!creds) return;
          const stillMissing = ids.filter(
            (mid) => mid > 0 && getCachedThumb(peerId, mid, thumbLocationOptions) == null
          );
          if (!stillMissing.length) return;
          requestNewlyUploadedThumbs(creds, peerId, stillMissing, thumbLocationOptions);
        }, accumulatedDelay);
        thumbRetryTimerRef.current.push(t);
      }
    }
  }, [creds, peerId, thumbLocationOptions, uploadSoftRefresh]);

  useEffect(() => {
    if (!detectTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<any>('transfer-event', (e) => {
        if (e.payload) {
          setTransfer((t) => applyTransferEvent(t, e.payload));

          if (e.payload.type === 'StudioItemDone') {
            // Accumulate completed message IDs for batch processing
            const mid = Number(e.payload.message_id || 0);
            if (mid > 0) transferDoneIdsRef.current.push(mid);

            // Debounce: wait 600ms of silence before flushing
            // (coalesces rapid-fire events from batch uploads)
            if (transferDoneTimerRef.current) clearTimeout(transferDoneTimerRef.current);
            transferDoneTimerRef.current = setTimeout(() => {
              transferDoneTimerRef.current = null;
              flushTransferDone();
            }, 600);
          } else if (e.payload.type === 'StudioFinished') {
            // Session finished: flush immediately (no more events coming)
            if (transferDoneTimerRef.current) {
              clearTimeout(transferDoneTimerRef.current);
              transferDoneTimerRef.current = null;
            }
            flushTransferDone();
          }
        }
      }).then((u) => {
        unlisten = u;
      });
    });
    return () => {
      if (unlisten) unlisten();
      if (transferDoneTimerRef.current) clearTimeout(transferDoneTimerRef.current);
      for (const t of thumbRetryTimerRef.current) clearTimeout(t);
      thumbRetryTimerRef.current = [];
    };
  }, [flushTransferDone]);

  /**
   * Lightweight sidebar refresh triggered after upload finishes.
   * Fetches the latest chat list and merges it into the existing sidebar state
   * without any loading spinners, peerGen increment, or state resets.
   * New chats are prepended; existing chats get their metadata updated.
   */
  const sidebarRefreshLockRef = useRef(false);
  const softRefreshSidebar = useCallback(async () => {
    if (!creds || sidebarRefreshLockRef.current) return;
    if (isTransferJobActive()) return;
    sidebarRefreshLockRef.current = true;
    try {
      const perf = getDrivePerfProfile();
      const cr = await driveListChats(creds, { limit: perf.chatPage });
      const incoming: DriveChat[] = cr.chats || [];
      if (!incoming.length) return;
      // Merge: update existing entries + prepend new ones
      setChats((prev) => {
        const byId = new Map(incoming.map((c) => [c.id, c]));
        const updated = prev.map((c) => byId.has(c.id) ? { ...c, ...byId.get(c.id)! } : c);
        const existingIds = new Set(prev.map((c) => c.id));
        const newOnes = incoming.filter((c) => !existingIds.has(c.id));
        return newOnes.length > 0 ? [...newOnes, ...updated] : updated;
      });
      // Also update the snapshot so next load shows correct data
      try {
        const cur: ChatListCursor = {
          offset_id: cr.next_offset_id ?? null,
          offset_date: cr.next_offset_date ?? null,
          offset_peer_id: cr.next_offset_peer_id ?? null,
        };
        const nextCursor = cur.offset_id || cur.offset_date || cur.offset_peer_id ? cur : null;
        saveDriveSidebarSnapshot(localStorage, creds.session, {
          chats: incoming,
          chatsHasMore: !!cr.has_more,
          chatsOffset: cr.next_offset ?? incoming.length,
          cursor: nextCursor,
        });
      } catch { /* snapshot is best-effort */ }
    } catch {
      /* sidebar soft-refresh failure is silent */
    } finally {
      sidebarRefreshLockRef.current = false;
    }
  }, [creds]);

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

  const processNextQueueTask = async () => {
    // Prevent overlapping execution
    if (taskRunningRef.current || transferQueueRef.current.length === 0) {
      return;
    }

    if (!creds) {
      const hasSessionName = !!localStorage.getItem('autogram_drive_session');
      if (hasSessionName) {
        setTimeout(() => {
          void processNextQueueTask();
        }, 1000);
      } else {
        taskRunningRef.current = false;
        setError(t('ui.generated.silakan_pilih_session_telegram_terlebih_dahulu_s_42aba91'));
      }
      return;
    }

    taskRunningRef.current = true;
    const task = transferQueueRef.current[0];
    const skipRestartWarm = transferQueueRef.current.length > 1;
    activeTaskStartIndexRef.current = task.startIndex;

    const label = `→ ${task.targetLabel}`;
    const namesLabel = task.names.length > 3
      ? `${task.names.slice(0, 3).join(', ')} (+ ${task.names.length - 3} file lainnya)`
      : task.names.join(', ');

    try {
      if (task.kind === 'upload') {
        const filesPayload = task.paths!.map((path, pathIdx) => {
          const isUrl = path.startsWith('http://') || path.startsWith('https://');
          const customName = task.names && task.names[pathIdx] ? task.names[pathIdx] : '';
          const albumSummary = !!task.options.group_as_album && !!task.options.global_caption;
          let cleanCaption = '';
          if (!albumSummary) {
            if (task.options.global_caption) {
              cleanCaption = task.options.global_caption;
            } else if (!isUrl) {
              const base = path.split(/[/\\]/).pop() || path;
              const stem = base.includes('.') ? base.replace(/\.[^.]+$/, '') : base;
              cleanCaption = stem || base;
            } else if (customName && !customName.startsWith('http') && !customName.startsWith('?')) {
              const stem = customName.includes('.') ? customName.replace(/\.[^.]+$/, '') : customName;
              cleanCaption = stem;
            }
          }
          return {
            path,
            caption: cleanCaption,
          };
        });

        let uploadError: string | null = null;
        let uploadedIds: number[] = [];

        // Grammers-only path (local + remote URL via Rust media_prep).
        if (!isStudioOrchEligible(task.paths || [], task.options)) {
          throw new Error('Upload membutuhkan file lokal atau URL http/https yang valid.');
        }

        setStatusText(`Upload (Grammers)${label}: ${namesLabel}`);
        setTransfer((t) => {
          const nextItems = t.items.map((it, idx) => {
            if (idx >= task.startIndex && idx < task.startIndex + task.names.length) {
              if (it.status === 'done' || it.status === 'skipped') return it;
              return { ...it, status: 'active' as const, phase: 'upload' as const };
            }
            return it;
          });
          return { ...t, items: nextItems, active: true };
        });

        const apiIdNum = Number(creds!.apiId) || 0;
        const topicFromOpts =
          task.topicId ??
          (task.options?.topic_id != null
            ? Number(task.options.topic_id)
            : task.options?.topicId != null
              ? Number(task.options.topicId)
              : null);

        const orchOutcome = await studioRunUploadDefault(
          creds!,
          {
            session: creds!.session,
            apiId: apiIdNum,
            apiHash: creds!.apiHash,
            chatId: studioChatIdFromFolder(task.targetFolderId ?? null),
            topicId: topicFromOpts != null && topicFromOpts > 0 ? topicFromOpts : null,
            files: filesPayload.map((f) => ({
              path: f.path,
              caption: f.caption,
            })),
            options: {
              ...task.options,
              transfer_id: task.id,
            },
            transferId: task.id,
          },
          { skipRestartWarm }
        );

        {
          const rec = orchOutcome.record;
          const items = rec?.items || [];
          let orchSkipped = 0;
          let orchDone = 0;
          let orchFailed = 0;
          for (const qi of items) {
            const mid = Number(qi.messageId || 0);
            if (mid > 0) uploadedIds.push(mid);
            const st = mapOrchItemStatus(qi.state);
            if (st === 'done') orchDone += 1;
            else if (st === 'skipped') orchSkipped += 1;
            else if (st === 'failed') orchFailed += 1;
            const uiIdx = task.startIndex + Number(qi.index || 0);
            setTransfer((t) =>
              applyTransferEvent(t, {
                type: 'StudioItemDone',
                index: uiIdx,
                status: st === 'uploading' ? 'failed' : st,
                message_id: mid > 0 ? mid : undefined,
                error: qi.error || undefined,
                path: qi.path,
              })
            );
            if (st === 'failed' && qi.error) {
              uploadError = qi.error;
            }
          }
          if (uploadedIds.length === 0 && orchSkipped > 0 && orchFailed === 0) {
            uploadedIds.push(-1);
          }
          if (!items.length && orchOutcome.result.message) {
            debugLog('drive', 'orch complete (no item detail)', {
              tid: orchOutcome.result.transferId,
            });
          }
          void flushTransferDebugLog(transferRef.current);
          debugLog('drive', 'upload via grammers orch', {
            tid: orchOutcome.result.transferId,
            mode: orchOutcome.result.mode,
            done: orchDone || rec?.doneCount,
            failed: orchFailed || rec?.failedCount,
            skipped: orchSkipped,
          });
        }

        // Post task finish checks (Grammers orch only)
        const isErrorExit = !!uploadError || uploadedIds.length === 0;
        if (uploadedIds.length > 0) {
          debugLog('drive', 'upload chunk ok', {
            count: uploadedIds.length,
            path: 'grammers_orch',
          });
          setStatusText(`Upload selesai${label}: ${namesLabel}`);
          if (uploadError) {
            setError(`Upload terkirim dengan peringatan: ${uploadError}`);
          }
        } else if (isErrorExit) {
          setStatusText(`Upload gagal${label}`);
          if (uploadError) setError(uploadError);
          setTransfer((t) => {
            const nextItems = t.items.map((it, idx) => {
              if (idx >= task.startIndex && idx < task.startIndex + task.names.length) {
                if (it.status === 'done' || it.status === 'skipped') return it;
                return { ...it, status: 'failed' as const, error: uploadError || 'Gagal' };
              }
              return it;
            });
            return { ...t, items: nextItems };
          });
        } else {
          setStatusText(`Upload selesai${label}: ${namesLabel}`);
        }
      } else if (task.kind === 'download') {
        let successCount = 0;
        const totalCount = task.selectedIds!.length;

        await runWithConcurrency(totalCount, Number(task.options?.concurrency), async (i) => {
          await waitWhileDriveTransferPaused();
          const msgId = task.selectedIds![i];
          const name = task.names[i] || `msg_${msgId}`;
          const destFile = `${task.saveDir!.replace(/[/\\]+$/, '')}/${name.replace(/[<>:"/\\|?*]/g, '_')}`;
          const itemIdx = task.startIndex + i;

          setTransfer((t) => ({
            ...t,
            items: t.items.map((it, idx) =>
              idx === itemIdx ? { ...it, status: 'active' as const, percent: 30 } : it
            ),
          }));

          try {
            const res = await tgDownloadFile({
              session: creds!.session,
              apiId: Number(creds!.apiId) || 0,
              apiHash: creds!.apiHash,
              chatId: String(task.targetFolderId ?? peerId ?? 'me'),
              messageId: msgId,
              destPath: destFile,
              conflictPolicy: transferSettings.downloadConflictPolicy,
              resumePartial: transferSettings.downloadResumePartial,
              integrity: transferSettings.downloadIntegrity,
              transferId: `download:${task.id}`,
              itemIndex: itemIdx,
            });

            if (res?.ok) {
              successCount++;
              setTransfer((t) => ({
                ...t,
                items: t.items.map((it, idx) =>
                  idx === itemIdx ? { ...it, status: 'done' as const, percent: 100 } : it
                ),
              }));
            } else {
              const errTxt = res?.userMessage || res?.error?.message || 'Gagal mengunduh';
              setTransfer((t) => ({
                ...t,
                items: t.items.map((it, idx) =>
                  idx === itemIdx ? { ...it, status: 'failed' as const, error: errTxt } : it
                ),
              }));
            }
          } catch (err: any) {
            const errTxt = String(err?.message || err);
            setTransfer((t) => ({
              ...t,
              items: t.items.map((it, idx) =>
                idx === itemIdx ? { ...it, status: 'failed' as const, error: errTxt } : it
              ),
            }));
          }
        });

        if (successCount > 0) {
          setStatusText(`Download selesai: ${successCount}/${totalCount} berkas`);
        } else {
          setStatusText(t('ui.generated.download_gagal_19e7bc6'));
          setError(t('speedtest.download_failed'));
        }
      } else if (task.kind === 'download_zip') {
        const completedEntries: Array<{ sourcePath: string; archiveName: string }> = [];
        const usedArchiveNames = new Map<string, number>();
        const totalCount = task.selectedIds!.length;
        try {
          const { exists, stat } = await import('@tauri-apps/plugin-fs');
          const { join } = await import('@tauri-apps/api/path');

          await runWithConcurrency(totalCount, Number(task.options?.concurrency), async (i) => {
            await waitWhileDriveTransferPaused();
            const messageId = task.selectedIds![i];
            const rawName = task.names[i] || `msg_${messageId}`;
            const safeName = rawName.replace(/[<>:"/\\|?*]/g, '_');
            const seenCount = usedArchiveNames.get(safeName.toLowerCase()) || 0;
            usedArchiveNames.set(safeName.toLowerCase(), seenCount + 1);
            const archiveName = seenCount === 0
              ? safeName
              : safeName.replace(/(\.[^.]+)?$/, ` (${seenCount + 1})$1`);
            const stagePath = await join(task.saveDir!, `${String(i + 1).padStart(8, '0')}_${safeName}`);
            const itemIdx = task.startIndex + i;

            // 1. Staging Checkpoint: Skip re-downloading if already present and valid
            let alreadyDone = false;
            try {
              if (await exists(stagePath)) {
                const info = await stat(stagePath);
                if (info && info.size > 0) {
                  alreadyDone = true;
                }
              }
            } catch {
              alreadyDone = false;
            }

            if (alreadyDone) {
              completedEntries.push({ sourcePath: stagePath, archiveName });
              setTransfer((state) => ({
                ...state,
                items: state.items.map((item, index) => index === itemIdx
                  ? { ...item, status: 'done' as const, percent: 100 }
                  : item),
              }));
              return;
            }

            setTransfer((state) => ({
              ...state,
              items: state.items.map((item, index) => index === itemIdx
                ? { ...item, status: 'active' as const, percent: 15 }
                : item),
            }));

            // 2. Fault-Tolerant Download Loop (3 Retries with Backoff & FloodWait safety)
            let success = false;
            let lastErr: string | null = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              await waitWhileDriveTransferPaused();
              try {
                const result = await tgDownloadFile({
                  session: creds!.session,
                  apiId: Number(creds!.apiId) || 0,
                  apiHash: creds!.apiHash,
                  chatId: String(task.targetFolderId ?? peerId ?? 'me'),
                  messageId,
                  destPath: stagePath,
                  conflictPolicy: 'overwrite',
                  resumePartial: true,
                  integrity: transferSettings.downloadIntegrity,
                  transferId: `zip:${task.id}`,
                  itemIndex: itemIdx,
                });

                if (result?.ok) {
                  completedEntries.push({ sourcePath: stagePath, archiveName });
                  setTransfer((state) => ({
                    ...state,
                    items: state.items.map((item, index) => index === itemIdx
                      ? { ...item, status: 'done' as const, percent: 100 }
                      : item),
                  }));
                  success = true;
                  break;
                } else {
                  lastErr = result?.userMessage || result?.error?.message || t('speedtest.download_failed');
                  const floodMatch = lastErr.match(/flood[_\s]wait[_\s](\d+)/i) || lastErr.match(/wait\s+(\d+)\s+seconds/i);
                  if (floodMatch) {
                    const waitSec = Math.min(60, parseInt(floodMatch[1], 10) || 5);
                    setStatusText(t('speedtest.zip_floodwait_pause_notice', { seconds: waitSec }));
                    await new Promise((r) => setTimeout(r, waitSec * 1000));
                  } else {
                    await new Promise((r) => setTimeout(r, attempt * 1500));
                  }
                }
              } catch (e: any) {
                lastErr = String(e?.message || e);
                await new Promise((r) => setTimeout(r, attempt * 1500));
              }
            }

            if (!success) {
              throw new Error(lastErr || t('speedtest.download_failed'));
            }
          });

          if (!completedEntries.length) throw new Error(t('speedtest.zip_no_completed_files'));
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('zip_create_from_files', {
            outputPath: task.savePath,
            entries: completedEntries,
          });
          setStatusText(t('speedtest.zip_saved_success', {
            count: completedEntries.length,
            path: task.savePath,
          }));
        } finally {
          try {
            const { remove } = await import('@tauri-apps/plugin-fs');
            await remove(task.saveDir!, { recursive: true });
          } catch {
            /* cleanup */
          }
          isDownloadingZipRef.current = false;
        }
      } else if (task.kind === 'download_one') {
        let errMessage: string | null = null;
        try {
          const res = await tgDownloadFile({
            session: creds!.session,
            apiId: Number(creds!.apiId) || 0,
            apiHash: creds!.apiHash,
            chatId: String(task.targetFolderId ?? peerId ?? 'me'),
            messageId: task.messageId!,
            destPath: task.savePath!,
          });

          if (!res?.ok) {
            errMessage = res?.userMessage || res?.error?.message || 'Download gagal';
          }
        } catch (err: any) {
          errMessage = String(err?.message || err);
        }

        if (!errMessage) {
          setStatusText(`Tersimpan: ${task.names[0]}`);
          setTransfer((t) => {
            const nextItems = t.items.map((it, idx) => {
              if (idx === task.startIndex) {
                return { ...it, status: 'done' as const, percent: 100 };
              }
              return it;
            });
            return { ...t, items: nextItems };
          });
        } else {
          setStatusText(t('ui.generated.download_gagal_19e7bc6'));
          setError(errMessage);
          setTransfer((t) => {
            const nextItems = t.items.map((it, idx) => {
              if (idx === task.startIndex) {
                return { ...it, status: 'failed' as const, error: errMessage || 'Gagal' };
              }
              return it;
            });
            return { ...t, items: nextItems };
          });
        }
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg);
      setStatusText(task.kind === 'upload' ? t('ui.generated.upload_gagal_bf53c87') : t('ui.generated.download_gagal_19e7bc6'));
      setTransfer((t) => {
        const nextItems = t.items.map((it, idx) => {
          if (idx >= task.startIndex && idx < task.startIndex + task.names.length) {
            return { ...it, status: 'failed' as const, error: msg };
          }
          return it;
        });
        return { ...t, items: nextItems };
      });
    } finally {
      // Remove completed task
      transferQueueRef.current.shift();
      savePersistedQueue(transferQueueRef.current);
      taskRunningRef.current = false;

      // If queue is empty, finish the overall transfer session
      if (transferQueueRef.current.length === 0) {
        void clearDriveTransferPause();
        setTransfer((t) =>
          t.active
            ? applyTransferEvent(t, {
                type: task.kind === 'upload' ? 'StudioFinished' : 'DriveDownloadDone',
              })
            : t
        );
        scheduleTransferHide();
        // A little delay then refresh files + sidebar (no full reset — lightweight paths)
        setTimeout(() => {
          void uploadSoftRefresh();
          void softRefreshSidebar();
        }, 800);
      } else {
        // Run next task in queue
        void processNextQueueTask();
      }
    }
  };

  const handleResumeQueue = useCallback(() => {
    try {
      const stored = localStorage.getItem('autogram_drive_upload_queue');
      if (stored) {
        const queue: QueueTask[] = JSON.parse(stored);
        if (queue.length > 0) {
          transferQueueRef.current = queue;
          const allNames = queue.flatMap((q) => q.names);
          
          const destinations = queue.flatMap((q) => {
            const dest = q.targetLabel || (q.kind.includes('download') ? q.saveDir || q.savePath || 'Folder' : 'Saved Messages');
            return q.names.map(() => dest);
          });
          setTransfer(
            seedTransferSession({
              direction: 'upload',
              names: allNames,
              label: queue[0].targetLabel || 'Melanjutkan unggahan',
              destinations,
            })
          );
          
          setTransferMinimized(false);
          localStorage.setItem(LS_TM_MIN, '0');
          setError(null);
          
          void processNextQueueTask();
        }
      }
    } catch (e) {
      /* ignore */
    } finally {
      setHasPersistedQueue(false);
    }
  }, []);

  const openTransferManager = useCallback(() => {
    if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
    setTransferMinimized(false);
    localStorage.setItem(LS_TM_MIN, '0');
  }, []);

  const toggleTransferManagerFromToolbar = useCallback(() => {
    if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
    toggleTransferMinimize();
  }, [toggleTransferMinimize]);

  const getDisplayedIds = useCallback(() => {
    if (displayedIdsRef.current.length) return displayedIdsRef.current;
    return filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter,
      perspective: viewPerspective,
    }).map((f) => f.id);
  }, [files, query, mediaFilter, sortMode, advFilter, viewPerspective]);

  const getDisplayedFiles = useCallback(() => {
    return filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter,
      perspective: viewPerspective,
    });
  }, [files, query, mediaFilter, sortMode, advFilter, viewPerspective]);

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
      perspective: viewPerspective,
    }).map((f) => f.id);
    displayedIdsRef.current = ids;
    setSelectedIds((prev) => pruneSelectionToDisplayed(prev, ids));
    if (selectionAnchorRef.current != null && !ids.includes(selectionAnchorRef.current)) {
      selectionAnchorRef.current = null;
    }
  }, [files, query, mediaFilter, sortMode, advFilter, viewPerspective]);

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
      setError(t('ui.generated.session_api_belum_siap_pilih_session_lavender_pa_5ba923f'));
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
      title: parentId != null ? String(t('speedtest.create_folder_title')) : String(t('speedtest.create_drive_title')),
      description:
        parentId != null
          ? String(t('speedtest.create_folder_desc', { parentName, defaultValue: `Di dalam “${parentName}”. Folder bisa berisi subfolder.` }))
          : String(t('speedtest.create_drive_desc')),
      label: parentId != null ? String(t('speedtest.folder_name_label')) : String(t('speedtest.drive_name_label')),
      placeholder: parentId != null ? String(t('speedtest.folder_name_ph')) : String(t('speedtest.drive_name_ph')),
      confirmLabel: parentId != null ? String(t('speedtest.create_folder_btn')) : String(t('speedtest.create_drive_btn')),
      onConfirm: (name: any) => {
        void (async () => {
          try {
            if (!creds) {
              setError(t('ui.generated.session_api_belum_siap_8049098'));
              return;
            }
            setStatusText(
              parentId != null ? `Membuat folder di ${parentName}…` : t('ui.generated.membuat_drive_td_16b22cc')
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
                  ? t('ui.generated.folder_dibuat_pilih_di_sidebar_drives_td_097c6fb')
                  : t('ui.generated.drive_dibuat_pilih_di_sidebar_drives_td_622df6b')
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
            setStatusText(t('nav.status_idle'));
          }
        })();
      },
    });
  };

  const handleCreateTopic = () => {
    if (!creds) {
      setError(t('ui.generated.session_api_belum_siap_8049098'));
      return;
    }
    if (activePeerId == null) {
      setError(t('ui.generated.pilih_grup_terlebih_dahulu_89491a7'));
      return;
    }
    setError(null);
    setInputDlg({
      kind: 'create-topic',
      title: 'Buat Topik Baru',
      description: 'Tambahkan topik baru pada grup forum ini.',
      label: 'Nama Topik',
      placeholder: 'mis. Dokumentasi',
      confirmLabel: 'Buat Topik',
      onConfirm: (name: any) => {
        void (async () => {
          try {
            if (!creds) {
              setError(t('ui.generated.session_api_belum_siap_8049098'));
              return;
            }
            setStatusText(`Membuat topik "${name}"…`);
            try {
              await ensureDriveSession(creds);
            } catch {
              /* ignore */
            }
            const res = await driveCreateTopic(creds, activePeerId, name);
            
            // Invalidate local topics cache
            topicsCacheRef.current.delete(activePeerId);
            
            // Reload topics list forcing refresh
            await loadTopicsForPeer(activePeerId, null, true);
            
            if (res?.topic_id != null) {
              setTopicFilter(res.topic_id);
              topicFilterRef.current = res.topic_id;
              setFiles([]);
              setLoadingFiles(true);
              setStatusText(`Topik siap: ${name}`);
              void refreshFiles();
            } else {
              setStatusText(`Topik "${name}" berhasil dibuat.`);
            }
          } catch (e: any) {
            setError(e?.message || t('ui.generated.gagal_membuat_topik_15ff0e8'));
            setStatusText(t('nav.status_idle'));
          }
        })();
      },
    });
  };

  const handleDeleteTopic = (topicId: number, topicTitle: string) => {
    if (!creds) {
      setError(t('ui.generated.session_api_belum_siap_8049098'));
      return;
    }
    if (activePeerId == null) {
      setError(t('ui.generated.pilih_grup_terlebih_dahulu_89491a7'));
      return;
    }
    setError(null);
    setConfirmDlg({
      kind: 'delete',
      entity: 'topic',
      names: [topicTitle],
      onConfirm: () => {
        void (async () => {
          try {
            setStatusText(`Menghapus topik "${topicTitle}"…`);
            try {
              await ensureDriveSession(creds);
            } catch {
              /* ignore */
            }
            await driveDeleteTopic(creds, activePeerId, topicId);
            
            // Force reload topics list
            await loadTopicsForPeer(activePeerId, null, true);
            
            // If deleted topic was selected, clear the filter and refresh files
            if (topicFilterRef.current === topicId || topicFilter === topicId) {
              setTopicFilter(null);
              topicFilterRef.current = null;
              setFiles([]);
              setLoadingFiles(true);
              void refreshFiles();
            }
            setStatusText(`Topik "${topicTitle}" berhasil dihapus.`);
          } catch (e: any) {
            setError(e?.message || t('ui.generated.gagal_menghapus_topik_b42a539'));
            setStatusText(t('nav.status_idle'));
          } finally {
            setLoadingFiles(false);
            setTopicsLoading(false);
          }
        })();
      },
    });
  };

  const handleRenameTopic = (topicId: number, currentTitle: string) => {
    if (!creds) {
      setError(t('ui.generated.session_api_belum_siap_8049098'));
      return;
    }
    if (activePeerId == null) {
      setError(t('ui.generated.pilih_grup_terlebih_dahulu_89491a7'));
      return;
    }
    setInputDlg({
      kind: 'rename',
      title: 'Ganti Nama Topik',
      description: 'Nama topik baru di Telegram forum.',
      label: 'Nama Topik',
      placeholder: currentTitle,
      defaultValue: currentTitle,
      confirmLabel: 'Simpan',
      onConfirm: (name: any) => {
        void (async () => {
          try {
            setStatusText(`Mengganti nama topik "${currentTitle}"…`);
            try {
              await ensureDriveSession(creds);
            } catch {
              /* ignore */
            }
            await driveRenameTopic(creds, activePeerId, topicId, name);
            
            // Force reload topics list
            await loadTopicsForPeer(activePeerId, null, true);
            
            // If renamed topic is active, trigger refresh to update breadcrumbs
            if (topicFilterRef.current === topicId || topicFilter === topicId) {
              await refreshFiles();
            }
            setStatusText(`Topik "${currentTitle}" berhasil diganti nama.`);
          } catch (e: any) {
            setError(e?.message || t('ui.generated.gagal_mengganti_nama_topik_94bac90'));
            setStatusText(t('nav.status_idle'));
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
    if (!creds) return setError(t('ui.generated.pilih_session_dan_isi_api_id_hash_dulu_2b90852'));
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
      onConfirm: (name: any) => {
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
            setStatusText(t('nav.status_idle'));
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
    if (!creds) return setError(t('ui.generated.pilih_session_dan_isi_api_id_hash_dulu_2b90852'));

    const runReparent = (parentId: number | null, parentLabel: string) => {
      if (parentId != null && wouldCreateFolderCycle(folders, folderId, parentId)) {
        setError(t('ui.generated.tidak_bisa_memindahkan_drive_folder_ke_dalam_tur_ff89afa'));
        return;
      }
      if (parentId === folderId) {
        setError(t('ui.generated.folder_tidak_bisa_menjadi_induk_dirinya_sendiri_04b40ea'));
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
          setStatusText(t('nav.status_idle'));
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
      onConfirm: (choice: any) => {
        runReparent(choice.id, choice.label);
      },
    });
  };

  const handleDeleteFolder = (folderId: number, folderName: string) => {
    if (!creds) return setError(t('ui.generated.pilih_session_dan_isi_api_id_hash_dulu_2b90852'));
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
            setStatusText(t('nav.status_idle'));
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
    if (!creds) return setError(t('ui.generated.pilih_session_dan_isi_api_id_hash_dulu_2b90852'));
    if (!folders.length) {
      setError(
        t('ui.generated.belum_ada_drive_td_buat_drive_root_dulu_drive_la_5ce5e28')
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
      onConfirm: (choice: any) => {
        if (choice.id == null) {
          setError(t('ui.generated.pilih_drive_atau_folder_sebagai_induk_8701eec'));
          return;
        }
        handleCreateFolder({ parentId: choice.id });
      },
    });
  };

  const runUploadPaths = async (
    paths: string[],
    opts?: {
      targetFolderId?: number | null;
      targetLabel?: string;
      topicId?: number | null;
      skipTopic?: boolean;
      presentationOverride?: 'document' | 'original' | 'standard' | 'compressed';
      qualityMode?: string;
      customFilename?: string;
    }
  ) => {
    if (!creds || !paths.length) return;
    
    // Normalize paths — allow both local file paths and remote URLs (http/https)
    let cleanPaths = paths
      .map((p) => String(p || '').trim().replace(/^["']|["']$/g, ''))
      .filter((p) => {
        if (!p) return false;
        if (p.startsWith('http://') || p.startsWith('https://')) return true;
        return p.includes('\\') || p.includes('/') || /^[a-zA-Z]:/.test(p);
      });
    if (!cleanPaths.length) {
      setError(t('ui.generated.path_file_atau_url_tidak_valid_coba_lagi_drop_da_63586d7'));
      return;
    }

    // Dedup guard: reject identical path sets enqueued within 2s (drop race protection)
    const pathsKey = cleanPaths.slice().sort().join('|');
    const nowMs = Date.now();
    const isDuplicateTask = transferQueueRef.current.some(
      (tsk) =>
        tsk.kind === 'upload' &&
        nowMs - parseInt(tsk.id.split('_')[1] || '0', 10) < 2000 &&
        tsk.paths?.slice().sort().join('|') === pathsKey
    );
    if (isDuplicateTask) {
      console.warn('[AutoGram] duplicate upload task rejected (drop race guard)');
      return;
    }
    const uploadPeer =
      opts && 'targetFolderId' in (opts || {}) ? (opts!.targetFolderId as number | null) : peerId;
    const destLabel =
      opts?.targetLabel ||
      (uploadPeer == null ? 'Saved Messages' : breadcrumb) ||
      'Drive';
    const label = `→ ${destLabel}`;
    let names = cleanPaths.map((p, idx) => {
      if (opts?.customFilename) {
        if (cleanPaths.length === 1) {
          return opts.customFilename;
        }
        const dotIdx = opts.customFilename.lastIndexOf('.');
        if (dotIdx > 0) {
          const base = opts.customFilename.substring(0, dotIdx);
          const ext = opts.customFilename.substring(dotIdx);
          return `${base}_${idx + 1}${ext}`;
        }
        return `${opts.customFilename}_${idx + 1}`;
      }
      if (p.startsWith('http://') || p.startsWith('https://')) {
        try {
          const u = new URL(p);
          const rawSegment = u.pathname.split('/').filter(Boolean).pop();
          if (rawSegment && !rawSegment.startsWith('?')) {
            const decoded = decodeURIComponent(rawSegment);
            if (decoded.includes('.')) return decoded;
            if (p.includes('photomode') || p.includes('image') || p.includes('avatar')) return `${decoded}.jpg`;
            if (p.includes('music') || p.includes('audio')) return `${decoded}.mp3`;
            return `${decoded}.mp4`;
          }
          return u.hostname || 'Remote_Stream.mp4';
        } catch {
          return 'Remote_Stream.mp4';
        }
      }
      return p.split(/[/\\]/).pop() || p;
    });

    const uploadTopicId = (() => {
      if (opts?.topicId !== undefined) {
        return opts.topicId != null && opts.topicId > 0 ? opts.topicId : null;
      }
      if (!opts?.skipTopic && sameDriveLocation(uploadPeer, peerId)) {
        const activeTopicId = topicFilterRef.current;
        return activeTopicId != null && activeTopicId > 0 ? activeTopicId : null;
      }
      return null;
    })();
    let duplicateForceUploadPaths: string[] = [];

    try {
      setStatusText(String(t('speedtest.preflight_running')));
      lastPreflightRequestRef.current = {
        creds,
        cleanPaths,
        destinationId: studioChatIdFromFolder(uploadPeer),
        topicId: uploadTopicId,
      };
      const report = await runQualityPreflight({
        session: creds.session,
        apiId: Number(creds.apiId) || 0,
        apiHash: creds.apiHash,
        paths: cleanPaths,
        qualityMode: transferSettings.qualityMode,
        presentationOverride: opts?.presentationOverride ?? transferSettings.presentationOverride,
        groupAsAlbum: transferSettings.groupAsAlbum,
        albumGroupSize: transferSettings.albumGroupSize,
        albumAvoidSingle: transferSettings.albumAvoidSingle,
        duplicatePolicy: transferSettings.duplicatePolicy,
        oversizeAction: transferSettings.oversizeAction,
        globalCaption: (transferSettings.globalCaption || '').trim() || undefined,
        captionOverflowPolicy: transferSettings.captionOverflowPolicy,
        destinationId: studioChatIdFromFolder(uploadPeer),
        topicId: uploadTopicId,
        preventStickerConversion: transferSettings.preventStickerConversion,
      });
      const decision = await reviewPreflight(report);
      if (!decision.approved) {
        setStatusText(String(t('speedtest.preflight_cancelled')));
        return;
      }
      const skippedPaths = new Set(decision.skippedPaths);
      cleanPaths = cleanPaths.filter((path) => !skippedPaths.has(path));
      duplicateForceUploadPaths = decision.forceUploadPaths.filter((path) => !skippedPaths.has(path));
      names = cleanPaths.map((path, idx) => {
        if (opts?.customFilename) {
          if (cleanPaths.length === 1) {
            return opts.customFilename;
          }
          const dotIdx = opts.customFilename.lastIndexOf('.');
          if (dotIdx > 0) {
            const base = opts.customFilename.substring(0, dotIdx);
            const ext = opts.customFilename.substring(dotIdx);
            return `${base}_${idx + 1}${ext}`;
          }
          return `${opts.customFilename}_${idx + 1}`;
        }
        return path.startsWith('http://') || path.startsWith('https://')
          ? (() => {
              try {
                const u = new URL(path);
                const rawSegment = u.pathname.split('/').filter(Boolean).pop();
                if (rawSegment && !rawSegment.startsWith('?')) {
                  const decoded = decodeURIComponent(rawSegment);
                  if (decoded.includes('.')) return decoded;
                  if (path.includes('photomode') || path.includes('image') || path.includes('avatar')) return `${decoded}.jpg`;
                  if (path.includes('music') || path.includes('audio')) return `${decoded}.mp3`;
                  return `${decoded}.mp4`;
                }
                return u.hostname || 'Remote_Stream.mp4';
              } catch {
                return 'Remote_Stream.mp4';
              }
            })()
          : path.split(/[/\\]/).pop() || path;
      });
      if (!cleanPaths.length) {
        setStatusText(String(t('speedtest.preflight_all_duplicates_skipped')));
        return;
      }
    } catch (preflightError) {
      setError(`${t('speedtest.preflight_failed')}: ${String((preflightError as Error)?.message || preflightError)}`);
      setStatusText(String(t('speedtest.preflight_cancelled')));
      return;
    }

    const scheduleAtSeconds = transferSettings.scheduleAt
      ? Math.floor(new Date(transferSettings.scheduleAt).getTime() / 1000)
      : undefined;
    const options: Record<string, unknown> = {
      quality_mode:
        opts?.qualityMode ||
        (opts?.presentationOverride === 'document'
          ? 'ORIGINAL'
          : opts?.presentationOverride === 'original'
            ? 'ORIGINAL'
            : transferSettings.qualityMode),
      concurrency: transferSettings.uploadConcurrency,
      group_as_album: transferSettings.groupAsAlbum,
      silent: transferSettings.silent,
      spoiler: transferSettings.spoiler,
      spoiler_item_indices: parseBatchPositions(transferSettings.spoilerItemPositions, cleanPaths.length),
      schedule_at: Number.isFinite(scheduleAtSeconds) && scheduleAtSeconds! > Date.now() / 1000
        ? scheduleAtSeconds
        : undefined,
      send_as:
        opts?.presentationOverride === 'document'
          ? 'document'
          : transferSettings.sendAs.trim() || undefined,
      global_caption: (transferSettings.globalCaption || '').trim() || undefined,
      caption_overflow_policy: transferSettings.captionOverflowPolicy,
      reencodeHardware: transferSettings.reencodeHardware,
      reencodePreset: transferSettings.reencodePreset,
      presentation_override: opts?.presentationOverride || transferSettings.presentationOverride,
      album_packing: transferSettings.albumPacking,
      album_group_size: transferSettings.albumGroupSize,
      album_avoid_single: transferSettings.albumAvoidSingle,
      album_failure_policy: transferSettings.albumFailurePolicy,
      group_documents: transferSettings.groupDocuments,
      group_audio: transferSettings.groupAudio,
      group_original_documents: transferSettings.groupOriginalDocuments,
      oversize_action: transferSettings.oversizeAction,
      alternate_account_pool: transferSettings.alternateAccountPool
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      alternate_identity_approved: transferSettings.alternateIdentityApproved,
      album_alternate_strategy: transferSettings.albumAlternateStrategy,
      encoder_strategy: transferSettings.encoderStrategy,
      encoder_resource_profile: transferSettings.encoderResourceProfile,
      encoder_max_parallel: transferSettings.encoderMaxParallel,
      encoder_allow_software_fallback: transferSettings.encoderAllowSoftwareFallback,
      download_conflict_policy: transferSettings.downloadConflictPolicy,
      download_resume_partial: transferSettings.downloadResumePartial,
      download_integrity: transferSettings.downloadIntegrity,
      duplicate_policy: transferSettings.duplicatePolicy || 'SKIP',
      duplicate_force_upload_paths: duplicateForceUploadPaths,
      scan_mode: transferSettings.scanMode || 'smart',
      guardrail_enabled: transferSettings.guardrailEnabled !== false,
      guardrail_threshold_days: transferSettings.guardrailThresholdDays ?? 7,
      topic_scope: transferSettings.topicScope || 'selected_plus_general',
      max_reupload_per_hour: transferSettings.maxReuploadPerHour ?? 10,
    };
    // Upload into selected forum topic: explicit topicId overrides, otherwise fall back to current active topic
    if (uploadTopicId != null) options.topic_id = uploadTopicId;

    // Determine startIndex
    const currentItemsCount = transferRef.current.items.length;
    const isActive = transferRef.current.active;
    const startIndex = isActive ? currentItemsCount : 0;

    const newTask: QueueTask = {
      id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      kind: 'upload',
      paths: cleanPaths,
      targetFolderId: uploadPeer,
      targetLabel: destLabel,
      skipTopic: opts?.skipTopic ?? (opts?.topicId === null ? true : undefined),
      topicId: (options.topic_id as number | null) ?? (opts?.topicId ?? null),
      names,
      options,
      startIndex,
    };

    // If no active transfer, seed the session
    if (!isActive) {
      if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
      void clearDriveTransferPause();
      setTransfer(
        seedTransferSession({
          direction: 'upload',
          names,
          label,
          destination: destLabel,
        })
      );
    } else {
      // Append new items to the existing transfer session
      setTransfer((prev) => {
        const newItems: TransferItem[] = names.map((name, index) => ({
          id: `${newTask.id}-${index}`,
          index: startIndex + index,
          name: name || `File ${index + 1}`,
          direction: 'upload',
          status: 'queued' as const,
          percent: 0,
          transferred: 0,
          total: 0,
          speed_mb_s: 0,
          destination: destLabel,
        }));
        return {
          ...prev,
          items: [...prev.items, ...newItems],
        };
      });
    }

    // Add to queue and trigger runner
    transferQueueRef.current.push(newTask);
    savePersistedQueue(transferQueueRef.current);
    setTransferMinimized(false);
    localStorage.setItem(LS_TM_MIN, '0');
    setError(null);

    // Trigger processing
    void processNextQueueTask();
  };

  const handleRemoteUpload = async (
    urls: string | string[],
    dest: DriveDestChoice,
    opts?: {
      customFilename?: string;
      asDocument?: boolean;
      qualityMode?: string;
      presentationOverride?: 'document' | 'original' | 'standard' | 'compressed';
    }
  ) => {
    const list = Array.isArray(urls) ? urls : [urls];
    // Route through the Transfer Manager queue (same pipeline as local file uploads)
    // so the upload appears in the Transfer Manager with live progress.
    await runUploadPaths(list, {
      targetFolderId: dest.id,
      targetLabel: dest.label,
      topicId: dest.topicId ?? null,
      presentationOverride: opts?.presentationOverride ?? (opts?.asDocument ? 'document' : undefined),
      qualityMode: opts?.qualityMode,
      customFilename: opts?.customFilename,
    });
  };

  const runZipFullIndex = async () => {
    if (!creds || zipPreflight.indexing) return;
    setZipPreflight((state) => ({
      ...state,
      indexing: true,
      ready: false,
      error: null,
      scannedCount: liveFilesRef.current.length,
      expectedCount: totalFileCount,
    }));
    let previousCount = -1;
    let stalled = 0;
    try {
      while (filesHasMoreRef.current) {
        await loadMoreFiles({ pageSize: 250 });
        await new Promise((resolve) => window.setTimeout(resolve, 80));
        const currentCount = loadedUniqueMediaCount(liveFilesRef.current);
        setZipPreflight((state) => ({ ...state, scannedCount: currentCount }));
        if (currentCount === previousCount) stalled += 1;
        else stalled = 0;
        previousCount = currentCount;
        if (stalled >= 4) throw new Error(t('speedtest.zip_index_stalled'));
      }
      const indexedFiles = dedupeByMsgId(liveFilesRef.current);
      const exactBreakdown = countExactMediaBreakdown(indexedFiles);
      const exactBytes = loadedMediaBytes(indexedFiles);
      setCachedMediaBreakdown(exactBreakdown);
      setStatsAccurate(true);
      setStatsByType([
        { type: 'photo', count: exactBreakdown.photoCount, bytes: 0 },
        { type: 'video', count: exactBreakdown.videoCount, bytes: 0 },
        { type: 'file', count: exactBreakdown.fileCount, bytes: 0 },
        { type: 'gif', count: exactBreakdown.gifCount, bytes: 0 },
        { type: 'link', count: exactBreakdown.linkCount, bytes: 0 },
        { type: 'audio', count: exactBreakdown.audioCount, bytes: 0 },
      ].filter((row) => row.count > 0));
      setTotalFileCount(indexedFiles.length);
      setTotalBytes(exactBytes);
      if (peerId != null) {
        const { invoke } = await import('@tauri-apps/api/core');
        void invoke('tg_save_exact_media_statistics', {
          request: {
            session: String(creds.session).trim(),
            chatId: String(peerId),
            topicId: topicFilterRef.current ?? null,
            exactTotal: indexedFiles.length,
            exactBytes,
            ...exactBreakdown,
          },
        }).catch(() => undefined);
      }
      setZipPreflight((state) => ({
        ...state,
        indexing: false,
        ready: true,
        scannedCount: indexedFiles.length,
        expectedCount: indexedFiles.length,
        indexedFiles,
      }));
    } catch (zipError) {
      setZipPreflight((state) => ({
        ...state,
        indexing: false,
        ready: false,
        error: String((zipError as Error)?.message || zipError),
      }));
    }
  };

  const handleDownloadAll = () => {
    if (!creds || isDownloadingZipRef.current) return;
    const isAlreadyFullyScanned = !filesHasMoreRef.current && liveFilesRef.current.length > 0;
    const currentCount = loadedUniqueMediaCount(liveFilesRef.current);
    const indexedFiles = isAlreadyFullyScanned ? dedupeByMsgId(liveFilesRef.current) : [];
    setZipPreflight({
      open: true,
      indexing: false,
      ready: isAlreadyFullyScanned,
      scannedCount: isAlreadyFullyScanned ? indexedFiles.length : currentCount,
      expectedCount: totalFileCount || currentCount,
      indexedFiles,
      error: null,
    });
  };

  const createIndexedZip = async (categories: ZipCategory[]) => {
    if (!creds || !zipPreflight.ready || isDownloadingZipRef.current) return;
    const isAll = categories.includes('all');
    const selectedFiles = isAll
      ? zipPreflight.indexedFiles
      : zipPreflight.indexedFiles.filter((file) =>
          categories.some((cat) => matchesMediaFilter(file, cat, 'drive'))
        );
    if (!selectedFiles.length) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const savePath = await save({
        defaultPath: `autogram_${peerId ?? 'saved'}_${topicFilterRef.current ?? 'all'}.zip`,
        title: t('speedtest.zip_save_title'),
        filters: [{ name: t('speedtest.zip_archive_filter'), extensions: ['zip'] }],
      });
      if (!savePath) return;
      const { tempDir, join } = await import('@tauri-apps/api/path');
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const stageDir = await join(await tempDir(), `autogram-zip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await mkdir(stageDir, { recursive: true });

      isDownloadingZipRef.current = true;
      setZipPreflight((state) => ({ ...state, open: false }));
      const names = selectedFiles.map((file) => driveFileDisplayName(file));
      const taskId = `download_zip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const newTask: QueueTask = {
        id: taskId,
        kind: 'download_zip',
        targetFolderId: peerId,
        targetLabel: savePath,
        selectedIds: selectedFiles.map((file) => file.id),
        saveDir: stageDir,
        savePath,
        names,
        options: { concurrency: transferSettings.downloadConcurrency },
        startIndex: 0,
      };
      if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
      void clearDriveTransferPause();
      setTransfer(seedTransferSession({
        direction: 'download',
        names,
        totals: selectedFiles.map((file) => file.size || 0),
        label: t('speedtest.zip_transfer_label', { count: names.length }),
        destination: savePath,
      }));
      transferQueueRef.current.push(newTask);
      setTransferMinimized(false);
      localStorage.setItem(LS_TM_MIN, '0');
      setError(null);
      void processNextQueueTask();
    } catch (zipError) {
      isDownloadingZipRef.current = false;
      setError(String((zipError as Error)?.message || zipError));
    }
  };

  const handleUpload = async () => {
    if (!creds) return setError(t('ui.generated.select_session_and_set_api_credentials_1eb97c1'));
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

  useEffect(() => {
    (window as any).triggerRemoteUpload = (paths: string[], targetPeerId: number, topicId: number | null) => {
      setLocationKind('chat');
      setActivePeerId(targetPeerId);
      setTopicFilter(topicId);
      topicFilterRef.current = topicId;
      setFiles([]);
      setError(null);
      setTimeout(() => {
        const dest = chats.find((c) => c.id === targetPeerId)?.name || 'Gudang';
        void runUploadPaths(paths, { targetFolderId: targetPeerId, targetLabel: dest, skipTopic: false });
      }, 200);
    };
    if (import.meta.env.DEV) {
      (window as any).triggerRemoteDeleteMessages = async (
        messageIds: number[],
        targetPeerId: number
      ) => {
        if (!creds) throw new Error('Session belum siap');
        const ids = [...new Set(messageIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
        if (!ids.length) return { deleted: 0 };
        await driveDeleteBatch(creds, ids, targetPeerId);
        setFiles((prev) => prev.filter((file) => !ids.includes(file.id)));
        liveFilesRef.current = liveFilesRef.current.filter((file) => !ids.includes(file.id));
        return { deleted: ids.length };
      };
    }
    return () => {
      delete (window as any).triggerRemoteUpload;
      delete (window as any).triggerRemoteDeleteMessages;
    };
  }, [runUploadPaths, chats, creds]);

  const runDownloadSelected = async () => {
    if (!creds || !selectedIds.length) return;
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

      const currentItemsCount = transferRef.current.items.length;
      const isActive = transferRef.current.active;
      const startIndex = isActive ? currentItemsCount : 0;

      const newTask: QueueTask = {
        id: `download_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        kind: 'download',
        selectedIds: [...selectedIds],
        saveDir,
        names,
        options: {
          concurrency: transferSettings.downloadConcurrency,
          notifyDownloadDone: transferSettings.notifyDownloadDone,
        },
        startIndex,
      };

      if (!isActive) {
        if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
        void clearDriveTransferPause();
        downloadArtifactsRef.current = new Set();
        setTransfer(
          seedTransferSession({
            direction: 'download',
            names,
            label: `${selectedIds.length} file → folder`,
            destination: saveDir || 'Folder',
          })
        );
      } else {
        setTransfer((prev) => {
          const newItems: TransferItem[] = names.map((name, index) => ({
            id: `${newTask.id}-${index}`,
            index: startIndex + index,
            name: name || `File ${index + 1}`,
            direction: 'download',
            status: 'queued' as const,
            percent: 0,
            transferred: 0,
            total: 0,
            speed_mb_s: 0,
            destination: saveDir || 'Folder',
          }));
          return {
            ...prev,
            items: [...prev.items, ...newItems],
          };
        });
      }

      // Add to queue and trigger runner
      transferQueueRef.current.push(newTask);
      savePersistedQueue(transferQueueRef.current);
      setTransferMinimized(false);
      localStorage.setItem(LS_TM_MIN, '0');
      setError(null);

      void processNextQueueTask();
    } catch (e: any) {
      setError(String(e?.message || e));
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
    try {
      const defaultName = file.name.replace(/[<>:"/\\|?*]/g, '_');
      const { save } = await import('@tauri-apps/plugin-dialog');
      const savePath = await save({ defaultPath: defaultName, title: 'Simpan file' });
      if (!savePath) return;

      const currentItemsCount = transferRef.current.items.length;
      const isActive = transferRef.current.active;
      const startIndex = isActive ? currentItemsCount : 0;

      const newTask: QueueTask = {
        id: `download_one_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        kind: 'download_one',
        targetFolderId: peerId,
        targetLabel: file.name,
        messageId: file.id,
        savePath,
        names: [file.name],
        options: {},
        startIndex,
      };

      if (!isActive) {
        if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
        void clearDriveTransferPause();
        downloadArtifactsRef.current = new Set([savePath]);
        setTransfer(
          seedTransferSession({
            direction: 'download',
            names: [file.name],
            label: file.name,
            totals: file.size > 0 ? [file.size] : undefined,
            destination: savePath,
          })
        );
      } else {
        setTransfer((prev) => {
          const newItems: TransferItem[] = [
            {
              id: `${newTask.id}-0`,
              index: startIndex,
              name: file.name,
              direction: 'download',
              status: 'queued' as const,
              percent: 0,
              transferred: 0,
              total: file.size > 0 ? file.size : 0,
              speed_mb_s: 0,
              destination: savePath,
            },
          ];
          return {
            ...prev,
            items: [...prev.items, ...newItems],
          };
        });
      }

      // Add to queue and trigger runner
      transferQueueRef.current.push(newTask);
      savePersistedQueue(transferQueueRef.current);
      setTransferMinimized(false);
      localStorage.setItem(LS_TM_MIN, '0');
      setError(null);

      void processNextQueueTask();
    } catch (e: any) {
      setError(String(e?.message || e));
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

  const handleEnqueueSingleDownload = useCallback(
    async (opts: { messageId: number; folderId: number | null; savePath: string; name: string }) => {
      if (!creds) return;
      openTransferManager();
      const currentItemsCount = transferRef.current.items.length;
      const isActive = transferRef.current.active;
      const startIndex = isActive ? currentItemsCount : 0;

      const newTask: QueueTask = {
        id: `download_one_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        kind: 'download_one',
        targetFolderId: opts.folderId,
        targetLabel: opts.name,
        messageId: opts.messageId,
        savePath: opts.savePath,
        names: [opts.name],
        options: {},
        startIndex,
      };

      if (!isActive) {
        if (transferHideTimer.current) clearTimeout(transferHideTimer.current);
        void clearDriveTransferPause();
        downloadArtifactsRef.current = new Set([opts.savePath]);
        setTransfer(
          seedTransferSession({
            direction: 'download',
            names: [opts.name],
            label: opts.name,
            destination: opts.savePath,
          })
        );
      } else {
        setTransfer((prev) => {
          const newItems: TransferItem[] = [
            {
              id: `${newTask.id}-0`,
              index: startIndex,
              name: opts.name,
              direction: 'download',
              status: 'queued' as const,
              percent: 0,
              transferred: 0,
              total: 0,
              speed_mb_s: 0,
              destination: opts.savePath,
            },
          ];
          return {
            ...prev,
            items: [...prev.items, ...newItems],
          };
        });
      }

      transferQueueRef.current.push(newTask);
      savePersistedQueue(transferQueueRef.current);
      setTransferMinimized(false);
      localStorage.setItem(LS_TM_MIN, '0');
      setError(null);
      void processNextQueueTask();
    },
    [creds, openTransferManager]
  );

  const openOneInSystem = async (file: DriveFile) => {
    if (!creds) return setError(t('ui.generated.pilih_session_dan_api_credentials_dulu_59128e4'));
    try {
      setStatusText(`Membuka ${file.name}…`);
      const { openDriveFileInSystem } = await import('../../lib/tauri/documentOpen');
      await openDriveFileInSystem(creds, file, peerId);
      setStatusText(`Dibuka: ${file.name}`);
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatusText(t('nav.status_idle'));
    }
  };

  const openOneWithApp = async (file: DriveFile) => {
    if (!creds) return setError(t('ui.generated.pilih_session_dan_api_credentials_dulu_59128e4'));
    try {
      setStatusText(`Buka dengan… ${file.name}`);
      const { openDriveFileWithApp } = await import('../../lib/tauri/documentOpen');
      await openDriveFileWithApp(creds, file, peerId, null, (p) => {
        setStatusText(p.message);
      });
      setStatusText(t('ui.generated.dialog_windows_dibuka_pilih_aplikasi_42d6df0'));
      window.setTimeout(() => setStatusText(t('nav.status_idle')), 4000);
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatusText(t('nav.status_idle'));
    }
  };

  const revealOne = async (file: DriveFile) => {
    if (!creds) return setError(t('ui.generated.pilih_session_dan_api_credentials_dulu_59128e4'));
    try {
      const { ensureLocalDocument, revealInFolder } = await import('../../lib/tauri/documentOpen');
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
        setStatusText(n === 1 ? t('ui.generated.menghapus_99906e1') : `Menghapus ${n} file…`);
        const items = ids.map((id) => {
          const f = files.find((x) => x.id === id) || liveFilesRef.current.find((x) => x.id === id);
          const targetFolder = (f as any)?.folder_id ?? (f as any)?.folderId ?? (f as any)?.chat_id ?? peerId;
          return { id, folderId: targetFolder };
        });
        const res = await driveDeleteBatch(creds, items, peerId);
        const failed = Array.isArray((res as any)?.failed) ? (res as any).failed : [];
        const deleted = Array.isArray((res as any)?.deleted) ? (res as any).deleted : [];
        const deletedIds = deleted.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0);

        if (deletedIds.length > 0) {
          const deletedSet = new Set(deletedIds);
          setFiles((prev) => prev.filter((f) => !deletedSet.has(f.id)));
          liveFilesRef.current = liveFilesRef.current.filter((f) => !deletedSet.has(f.id));

          // 1. Purge all cache keys associated with this peer/chat
          const prefix = `${creds.session}::${peerId == null ? 'saved' : peerId}::`;
          for (const key of Array.from(filesCacheRef.current.keys())) {
            if (key.startsWith(prefix)) {
              filesCacheRef.current.delete(key);
              filesTotalCountRef.current.delete(key);
              filesTotalBytesRef.current.delete(key);
            }
          }

          // 2. Synchronize local IndexedDB store in background
          void deleteMediaRecordsForPeer(
            creds.session,
            peerId == null ? 'me' : String(peerId),
            deletedIds
          ).catch((e: any) => console.warn('deleteMediaRecordsForPeer sync warning:', e));
        }

        setSelectedIds([]);
        selectionAnchorRef.current = null;
        const hasFailed = failed.length > 0;

        if (hasFailed) {
          setError(
            `Hapus sebagian gagal (${failed.length}): ${
              failed[0]?.error || failed[0]?.id || 'error'
            }`
          );
          setStatusText(
            `Terhapus ${deletedIds.length}/${n}${failed.length ? ` · ${failed.length} gagal` : ''}`
          );
        } else {
          setStatusText(n === 1 ? t('ui.generated.file_dihapus_b7abea5') : `${n} file dihapus`);
        }
      } catch (e: any) {
        if (!navigator.onLine) {
          for (const id of ids) {
            await enqueueAction({
              id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              type: 'delete',
              target: { messageId: id, chatId: peerId || 0 },
              payload: {}
            }).catch(() => null);
          }
          const idsSet = new Set(ids);
          setFiles(prev => prev.filter(f => !idsSet.has(f.id)));
          liveFilesRef.current = liveFilesRef.current.filter((f) => !idsSet.has(f.id));
          const prefix = `${creds.session}::${peerId == null ? 'saved' : peerId}::`;
          for (const key of Array.from(filesCacheRef.current.keys())) {
            if (key.startsWith(prefix)) {
              filesCacheRef.current.delete(key);
              filesTotalCountRef.current.delete(key);
              filesTotalBytesRef.current.delete(key);
            }
          }
          setSelectedIds([]);
          selectionAnchorRef.current = null;
          setStatusText(n === 1 ? t('ui.generated.hapus_diantre_offline_db0e363') : `${n} hapus diantre (offline)`);
        } else {
          setError(String(e?.message || e));
          setStatusText(t('ui.generated.hapus_gagal_9277ca2'));
        }
      } finally {
        setLoadingFiles(false);
      }
    },
    [creds, peerId, files]
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
      onConfirm: (name: any) => {
        if (name === file.name) return;
        void (async () => {
          try {
            await driveRename(creds, file.id, peerId, name);
            await refreshFiles();
            setStatusText(t('ui.generated.nama_diperbarui_e6bbb4d'));
          } catch (e: any) {
            if (!navigator.onLine) {
              await enqueueAction({
                id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                type: 'rename',
                target: { messageId: file.id, chatId: peerId || 0 },
                payload: { newName: name }
              }).catch(() => null);
              setFiles(prev => prev.map(f => f.id === file.id ? { ...f, name } : f));
              setStatusText(t('ui.generated.rename_diantre_offline_83c2138'));
            } else {
              setError(String(e?.message || e));
            }
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
          setStatusText(t('ui.generated.cek_duplikat_di_tujuan_d06082a'));
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
                : t('ui.generated.tidak_ada_file_untuk_disalin_06f8625')
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

  const isLocationPinned = useCallback(
    (kind: 'saved' | 'drive' | 'chat', id: number | null) => {
      if (kind === 'saved') return true;
      return pins.some((p) => p.kind === kind && (id == null ? p.id == null : p.id === id));
    },
    [pins]
  );

  const toggleLocationPin = useCallback(
    (kind: 'saved' | 'drive' | 'chat', id: number | null, label: string) => {
      if (!session) return;
      const res = toggleDrivePinResult(session, { kind, id: kind === 'saved' ? null : id, label });
      setPins(res.pins);
      if (res.replacedItem) {
        setStatusText(
          t('speedtest.pin_limit_replaced', {
            old: res.replacedItem.label,
            new: label,
          })
        );
      }
    },
    [session, t]
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
    const driveEntries: DriveDestChoice[] = folders.map((f) => {
      const match = chats.find((c) => c.id === f.id);
      return {
        id: f.id as number | null,
        label: f.name,
        isForum: !!match?.is_forum,
        kind: 'drive' as const,
        type: match?.type || 'drive',
      };
    });
    // Collect IDs of drive folders so we don't duplicate them in the chat list.
    const driveIds = new Set(driveEntries.map((e) => e.id));
    return [
      { id: null, label: 'Saved Messages', isForum: false, kind: 'saved' },
      // Drive folders: include the current folder (peerId) so user can move between topics
      // within the same group/drive. All drive entries shown regardless of peerId.
      ...driveEntries,
      // Regular chats: skip ones already represented as drive folders, and skip current peer.
      ...chats
        .filter((c) => !driveIds.has(c.id) && c.id !== peerId)
        .slice(0, 120)
        .map((c) => ({
          id: c.id as number | null,
          label: c.name,
          isForum: !!c.is_forum,
          kind: 'chat' as const,
          type: c.type,
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
    // Determine chatType and isForum from the current peer
    const activeChatMeta = locationKind === 'chat'
      ? chats.find((c) => c.id === activePeerId)
      : locationKind === 'drive'
        ? chats.find((c) => c.id === activePeerId)
        : null;
    const activeChatType = activeChatMeta?.type;
    const activeIsForum = !!(activeChatMeta?.is_forum);
    if (lastRecentKeyRef.current === k && generic) return;
    if (lastRecentKeyRef.current === k && !generic) {
      // upgrade label once
      setRecents(
        pushDriveRecent(session, {
          kind: locationKind,
          id: locationKind === 'saved' ? null : activePeerId,
          label,
          chatType: activeChatType,
          isForum: activeIsForum,
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
        chatType: activeChatType,
        isForum: activeIsForum,
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
            setStatusText(t('ui.generated.pilih_salin_di_dialog_konfirmasi_245908e'));
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

  // Desktop: drawer is unused in dual-pane mode (>= 900x600) — clear sticky open after resize
  useEffect(() => {
    const onResize = () => {
      if (typeof window === 'undefined') return;
      if (window.innerWidth >= 900 && window.innerHeight >= 600 && drawerOpen) {
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
    groupAsAlbum?: boolean;
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
      setStatusText(t('ui.generated.sudah_di_lokasi_ini_pilih_chat_folder_lain_d3c0ecf'));
      return;
    }
    if (isTransferJobActive() || transfer.active || moveActiveRef.current) {
      setError(t('ui.generated.transfer_pindah_masih_berjalan_stop_dulu_di_tran_8fd2468'));
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
    const shouldGroup =
      (opts?.groupAsAlbum !== undefined
        ? opts.groupAsAlbum
        : transferSettings.groupAsAlbum !== false) && messageIds.length > 1;
    const groupSize = Math.max(2, Math.min(10, Number(transferSettings.albumGroupSize) || 10));
    const BATCH_SIZE = shouldGroup ? groupSize : 1;
    try {
      for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
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

        const batchIds = messageIds.slice(i, i + BATCH_SIZE);
        // Mark all items in this batch as started
        setTransfer((t) => {
          let cur = t;
          for (let j = 0; j < batchIds.length; j++) {
            cur = applyTransferEvent(cur, {
              type: 'StudioItemStarted',
              index: i + j,
              path: moveNames[i + j],
            });
          }
          return cur;
        });

        // 1. Try batch / album forward (clean copy, drop_author: true, grouped)
        try {
          await driveMove(creds, batchIds, fromFolderId, toFolderId, {
            deleteSource,
            topicId,
            groupAsAlbum: shouldGroup,
          });
          done += batchIds.length;
          setTransfer((t) => {
            let cur = t;
            for (let j = 0; j < batchIds.length; j++) {
              cur = applyTransferEvent(cur, {
                type: 'StudioItemDone',
                index: i + j,
                status: 'done',
                messageId: batchIds[j],
                message_id: batchIds[j],
              });
            }
            return cur;
          });
        } catch (batchErr: any) {
          // 2. Graceful fallback: if batch fails (e.g. mixed media types), process individually
          for (let j = 0; j < batchIds.length; j++) {
            if (moveAbortRef.current?.cancelled) {
              cancelled = true;
              break;
            }
            const singleId = batchIds[j];
            const itemIdx = i + j;
            try {
              await driveMove(creds, singleId, fromFolderId, toFolderId, {
                deleteSource,
                topicId,
              });
              done += 1;
              setTransfer((t) =>
                applyTransferEvent(t, {
                  type: 'StudioItemDone',
                  index: itemIdx,
                  status: 'done',
                  messageId: singleId,
                  message_id: singleId,
                })
              );
            } catch (e: any) {
              failed.push(`${singleId}: ${e?.message || e}`);
              setTransfer((t) =>
                applyTransferEvent(t, {
                  type: 'StudioItemDone',
                  index: itemIdx,
                  status: 'failed',
                  error: String(e?.message || e),
                })
              );
            }
          }
        }

        setTransfer((t) => ({
          ...t,
          overallPercent: Math.round((100 * Math.min(messageIds.length, i + batchIds.length)) / messageIds.length),
          transferred: Math.min(messageIds.length, i + batchIds.length),
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
            t('ui.generated.pastikan_akun_boleh_kirim_media_di_chat_itu_buka_edc1b5e')
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
      meta?: { isForum?: boolean; topicId?: number | null }
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
        setError(!creds ? t('ui.generated.session_api_belum_siap_pilih_session_dulu_9d3c40d') : t('ui.generated.tidak_ada_file_untuk_dipindah_272547f'));
        return;
      }
      const hasDestTopic = meta?.topicId != null && Number(meta.topicId) > 0;
      if (sameDriveLocation(fromFolderId, toFolderId) && !hasDestTopic && !meta?.isForum) {
        setStatusText(t('ui.generated.sudah_di_lokasi_ini_pilih_chat_folder_lain_d3c0ecf'));
        setError(null);
        return;
      }
      // Only block if a MOVE is already running — exclusive upload/download should not
      // swallow the confirm dialog (user can still cancel / queue after confirm).
      if (moveActiveRef.current) {
        setError(t('ui.generated.pindah_masih_berjalan_tunggu_selesai_atau_stop_d_c037275'));
        openTransferManager();
        return;
      }
      const names = messageIds.map((id) => {
        const f = files.find((x) => x.id === id);
        return f?.name || `msg_${id}`;
      });
      const chatMeta = toFolderId != null ? chats.find((c) => c.id === toFolderId) : null;
      let isForum = !!(meta?.isForum || chatMeta?.is_forum || hasDestTopic);
      const maybeNeedsTopics =
        isForum ||
        !chatMeta ||
        chatMeta.type === 'group' ||
        chatMeta.type === 'supergroup' ||
        chatMeta.type === 'channel' ||
        toFolderId != null;

      const buildState = (topicsList: DriveTopic[], forum: boolean, topicLoading = false): DriveConfirmState => ({
        kind: 'move',
        names,
        detail: `→ ${targetLabel}`,
        isForum: forum,
        isTopicLoading: topicLoading,
        topics: topicsList,
        initialTopicId: meta?.topicId ?? null,
        initialGroupAsAlbum: transferSettings.groupAsAlbum !== false,
        albumGroupSize: Math.max(2, Math.min(10, Number(transferSettings.albumGroupSize) || 10)),
        onConfirm: (choice: any) => {
          if (isTransferJobActive() || transfer.active || moveActiveRef.current) {
            setError(t('ui.generated.transfer_pindah_masih_berjalan_stop_dulu_di_tran_8fd2468'));
            openTransferManager();
            return;
          }
          const moveChoice =
            choice && 'mode' in choice
              ? choice
              : {
                  mode: 'move' as const,
                  topicId: meta?.topicId ?? null as number | null,
                  groupAsAlbum: transferSettings.groupAsAlbum !== false,
                };
          const clip = getDriveClipboard();
          if (clip && clip.mode === 'cut') {
            const hasAnyCut = messageIds.some((id) => clip.messageIds.includes(id));
            if (hasAnyCut) setDriveClipboard(null);
          }
          void moveMessageIds(messageIds, fromFolderId, toFolderId, targetLabel, {
            deleteSource: moveChoice.mode !== 'copy',
            topicId: moveChoice.topicId ?? meta?.topicId ?? null,
            groupAsAlbum: moveChoice.groupAsAlbum,
          });
        },
      });

      // Dual path: React setState + external store (native DnD / useSyncExternalStore)
      const openMoveDlg = (s: DriveConfirmState) => {
        openDriveMoveConfirm(s);
        setConfirmDlg(s);
      };
      const initialTopicsList = toFolderId === peerId && topics.length > 0 ? topics : [];
      const initialForum = isForum || initialTopicsList.length > 0;
      const initialTopicLoading =
        toFolderId != null && maybeNeedsTopics && !initialForum && initialTopicsList.length === 0;
      openMoveDlg(buildState(initialTopicsList, initialForum, initialTopicLoading));
      setStatusText(t('nav.status_idle'));
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

      if (toFolderId != null && maybeNeedsTopics && initialTopicsList.length === 0) {
        try {
          const res = await driveListTopics(creds, toFolderId);
          const topicsList = (res?.topics || []) as DriveTopic[];
          const forum = !!(res?.is_forum || topicsList.length || isForum);
          openMoveDlg(buildState(topicsList, forum, false));
        } catch {
          openMoveDlg(buildState([], isForum, false));
        }
      }
    },
    [
      creds,
      files,
      chats,
      topics,
      peerId,
      transfer.active,
      transferSettings,
      moveMessageIds,
      openTransferManager,
      t,
    ]
  );

  const openMoveDestinationPicker = useCallback(
    (messageIds: number[], names: string[]) => {
      if (!creds || !messageIds.length) return;
      const choices = buildMoveDestinations();
      if (!choices.length) {
        setError(t('ui.generated.tidak_ada_tujuan_muat_ulang_daftar_chat_folder_f50a3d4'));
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
        creds,
        onConfirm: (dest: any) => {
          void requestMoveToTarget(messageIds, peerId, dest.id, dest.label, {
            isForum: !!dest.isForum,
            topicId: dest.topicId ?? null,
          });
        },
      });
    },
    [creds, peerId, buildMoveDestinations, requestMoveToTarget, t]
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
      if (parsed.kind === 'topic') {
        if (parsed.id == null) {
          return { kind: 'topic', id: null, label: t('speedtest.all_media_pill') };
        }
        const tp = topics.find((x) => x.id === parsed.id);
        return { kind: 'topic', id: parsed.id, label: tp?.title || `Topik #${parsed.id}` };
      }
      if (parsed.kind === 'drive') {
        const f = folders.find((x) => x.id === parsed.id);
        return { kind: 'drive', id: parsed.id, label: f?.name || `Folder ${parsed.id}` };
      }
      const c = chats.find((x) => x.id === parsed.id);
      return { kind: 'chat', id: parsed.id, label: c?.name || `Chat ${parsed.id}` };
    },
    [folders, chats, topics, t]
  );

  // Live refs so sync pointer handlers always see latest callbacks
  const resolveDropTargetLabelRef = useRef(resolveDropTargetLabel);
  resolveDropTargetLabelRef.current = resolveDropTargetLabel;
  const requestMoveToTargetRef = useRef(requestMoveToTarget);
  requestMoveToTargetRef.current = requestMoveToTarget;
  pasteMoveRef.current = (clip) => {
    const currentTopicId =
      topicFilterRef.current != null && Number(topicFilterRef.current) > 0
        ? Number(topicFilterRef.current)
        : null;
    const currentTopic = currentTopicId ? topics.find((tp) => tp.id === currentTopicId) : null;
    let baseLabel =
      locationKind === 'saved'
        ? 'Saved Messages'
        : folders.find((f) => f.id === activePeerId)?.name ||
          chats.find((c) => c.id === activePeerId)?.name ||
          'Lokasi ini';
    if (currentTopic?.title) {
      baseLabel = `${baseLabel} (#${currentTopic.title})`;
    }
    void requestMoveToTarget(clip.messageIds, clip.fromFolderId, peerId, baseLabel, {
      isForum: isForumChat || !!currentTopicId,
      topicId: currentTopicId,
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
          ? t('ui.generated.seret_ke_chat_folder_di_sidebar_esc_batal_c4c2364')
          : `Seret ${ids.length} item ke chat/folder · Esc batal`
      );
    },
    [collapsed, openDrawer]
  );

  /** Attach window pointer listeners IMMEDIATELY (not useEffect) — fixes stuck-on-drag race. */
  const attachPointerDragListeners = useCallback(() => {
    detachPointerDragListeners();
    pointerFinishedRef.current = false;
    let chatFolderHoverId: number | null = null;
    let chatFolderHoverTimer: number | null = null;

    const clearChatFolderHover = () => {
      if (chatFolderHoverTimer != null) window.clearTimeout(chatFolderHoverTimer);
      chatFolderHoverTimer = null;
      chatFolderHoverId = null;
    };

    const scheduleChatFolderHover = (folderId: number | null) => {
      if (folderId == null) {
        clearChatFolderHover();
        return;
      }
      if (chatFolderHoverId === folderId && chatFolderHoverTimer != null) return;
      clearChatFolderHover();
      chatFolderHoverId = folderId;
      chatFolderHoverTimer = window.setTimeout(() => {
        chatFolderHoverTimer = null;
        void selectChatFolder(folderId);
      }, 260);
    };

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
      const hoverKey = pickDropKeyAtPoint(ev.clientX, ev.clientY)
        || chatFolderDropKeyAtPoint(ev.clientX, ev.clientY);
      setLastHoverDropKey(hoverKey);
      scheduleChatFolderHover(parseChatFolderDropKey(hoverKey));
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
        let key = pickDropKeyAtPoint(cx, cy) || chatFolderDropKeyAtPoint(cx, cy);
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
          const chatFolderId = parseChatFolderDropKey(key);
          if (chatFolderId != null) {
            endDriveDrag();
            clearMediaDragUi();
            setStatusText(t('speedtest.drag_chat_folder_opened'));
            return;
          }
          if (isDropKeySameAsSource(key, payload.fromFolderId)) {
            endDriveDrag();
            clearMediaDragUi();
            setStatusText(t('ui.generated.sudah_di_lokasi_ini_pilih_chat_folder_lain_d3c0ecf'));
            return;
          }
          // Guard: scrolling past Drives — require stable hover (no accidental drop)
          if (shouldBlockDriveDrop(key)) {
            endDriveDrag();
            clearMediaDragUi();
            setStatusText(t('ui.generated.tahan_sebentar_di_drive_folder_untuk_melepaskan__f1416b5'));
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
            const isTopicDrop = target.kind === 'topic';
            const toId = target.kind === 'saved' ? null : isTopicDrop ? (peerId ?? null) : target.id;
            const chatMeta =
              toId != null ? chatsRef.current.find((c) => c.id === toId) : null;
            const dropDetail = {
              messageIds: moveIds,
              fromFolderId: moveFrom,
              toFolderId: toId,
              targetLabel: target.label,
              isForum: isTopicDrop || !!chatMeta?.is_forum,
              topicId: isTopicDrop ? target.id : null,
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
                  { isForum: dropDetail.isForum, topicId: dropDetail.topicId }
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
            setStatusText(t('ui.generated.tujuan_tidak_dikenali_coba_lagi_ef5197b'));
          }
          return;
        }
        endDriveDrag();
        clearMediaDragUi();
        setLastHoverDropKey(null);
        setStatusText(t('ui.generated.drop_dibatalkan_lepas_di_baris_chat_folder_biru_c0bb452'));
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
        setStatusText(t('ui.generated.drag_dibatalkan_455998d'));
      });
    };
    window.addEventListener('blur', onBlur);

    pointerListenCleanupRef.current = () => {
      clearChatFolderHover();
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [clearMediaDragUi, detachPointerDragListeners, selectChatFolder]);

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
      setStatusText(t('ui.generated.drag_dibatalkan_escape_104f12b'));
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
      if (document.body.classList.contains('td-marquee-active')) return;
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
        topicId?: number | null;
      } | null;
      if (!d?.messageIds?.length || !d.targetLabel) return;
      void requestMoveToTargetRef.current(
        d.messageIds,
        d.fromFolderId ?? null,
        d.toFolderId ?? null,
        d.targetLabel,
        { isForum: !!d.isForum, topicId: d.topicId ?? null }
      );
    };
    window.addEventListener('autogram-drive-drop-move', onDropMove as EventListener);
    return () => window.removeEventListener('autogram-drive-drop-move', onDropMove as EventListener);
  }, []);

  useEffect(() => {
    const onMediaDeleted = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { deletedIds?: number[]; peerId?: number | null } | undefined;
      if (!detail?.deletedIds || !detail.deletedIds.length) return;
      const ids = detail.deletedIds.map((id) => Number(id));

      // Purge from active files state
      setFiles((prev) => purgeDeletedMsgIds(prev, ids));
      liveFilesRef.current = purgeDeletedMsgIds(liveFilesRef.current, ids);

      // Purge from filesCacheRef
      for (const [key, cacheList] of Array.from(filesCacheRef.current.entries())) {
        filesCacheRef.current.set(key, purgeDeletedMsgIds(cacheList, ids));
      }

      // Purge from localStorage location snapshot & IndexedDB deep index
      if (creds?.session) {
        try {
          removeFilesFromDriveLocationSnapshot(localStorage, creds.session, peerId, topicFilterRef.current, ids);
          void removeFilesFromDeepIndex(creds.session, peerId, topicFilterRef.current, ids);
        } catch {
          /* ignore */
        }
      }
    };

    window.addEventListener('autogram-media-deleted', onMediaDeleted);
    return () => window.removeEventListener('autogram-media-deleted', onMediaDeleted);
  }, [creds, peerId]);


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
      // Ctrl/Cmd explicitly assigns this gesture to Explorer marquee. The
      // document-capture DnD fallback runs before React handlers, so it must
      // honor the modifier here as well as in DriveFileCard.
      if (e.ctrlKey || e.metaKey) return;
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
      if (document.body.classList.contains('td-marquee-active')) {
        down = null;
        return;
      }
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
      if (document.body.classList.contains('td-marquee-active')) {
        down = null;
        return;
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
      return setError(t('ui.generated.select_session_first_8e5fb74'));
    }
    const toId = target.kind === 'saved' ? null : target.id;

    // In-memory payload first (reliable); DataTransfer as fallback
    const internal = getActiveDriveDrag() || getDriveDragData(e.dataTransfer);

    if (internal?.messageIds?.length) {
      if (sameDriveLocation(internal.fromFolderId, toId)) {
        endDriveDrag();
        clearMediaDragUi();
        setStatusText(t('ui.generated.sudah_di_lokasi_ini_pilih_chat_folder_lain_d3c0ecf'));
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
    setError(t('ui.generated.drop_tidak_dikenali_seret_file_dari_file_explore_b4f412d'));
  };

  const handleDropOnTopic = async (targetTopicId: number | null, targetTopicTitle: string, e: React.DragEvent) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    if (dropLockRef.current) return;
    setDragActive(false);
    if (!creds) {
      endDriveDrag();
      clearMediaDragUi();
      clearLastOsPaths();
      return setError(t('ui.generated.select_session_first_8e5fb74'));
    }

    const internal = getActiveDriveDrag() || getDriveDragData(e.dataTransfer);
    if (internal?.messageIds?.length) {
      if (peerId != null && topicFilter != null && topicFilter === targetTopicId) {
        endDriveDrag();
        clearMediaDragUi();
        setStatusText(t('ui.generated.sudah_di_lokasi_ini_pilih_chat_folder_lain_d3c0ecf'));
        return;
      }
      dropLockRef.current = true;
      endDriveDrag();
      clearMediaDragUi();
      try {
        await requestMoveToTarget(
          internal.messageIds,
          internal.fromFolderId,
          peerId,
          targetTopicTitle,
          { isForum: true, topicId: targetTopicId }
        );
      } finally {
        dropLockRef.current = false;
      }
      return;
    }

    let paths = extractOsPaths(e.dataTransfer);
    if (!paths.length && e.dataTransfer && hasOsFiles(e.dataTransfer)) {
      paths = await waitForOsPaths(500);
    }
    if (paths.length) {
      dropLockRef.current = true;
      endDriveDrag();
      clearMediaDragUi();
      clearLastOsPaths();
      try {
        await runUploadPaths(paths, {
          targetFolderId: peerId,
          targetLabel: targetTopicTitle,
          topicId: targetTopicId,
          skipTopic: targetTopicId == null,
        });
      } finally {
        dropLockRef.current = false;
      }
      return;
    }

    endDriveDrag();
    clearMediaDragUi();
  };

  const cancelTransfer = async () => {
    debugLog('drive', 'transfer stop');
    transferQueueRef.current = [];
    savePersistedQueue([]);
    const wasDownload = transfer.direction === 'download';
    const wasMove = transfer.direction === 'move' || moveActiveRef.current;
    const tracked = Array.from(downloadArtifactsRef.current);
    // Abort sequential move/forward batch (not a worker job)
    cancelMoveBatch();
    await clearDriveTransferPause();
    await cancelDriveJob(transfer.jobKey);
    childRef.current?.dispose?.();
    childRef.current = null;
    if (wasMove && !wasDownload) {
      downloadArtifactsRef.current.clear();
      setTransfer((t) => markTransferFinished(t, 'cancelled'));
      setStatusText(t('ui.generated.pindah_salin_dihentikan_cc2f389'));
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
          setStatusText(t('ui.generated.transfer_dihentikan_832f41c'));
        }
      } catch {
        setStatusText(t('ui.generated.transfer_dihentikan_832f41c'));
      }
    } else {
      setStatusText(t('ui.generated.transfer_dihentikan_832f41c'));
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
    // Acquire lock BEFORE any async wait to prevent native handlers from racing
    dropLockRef.current = true;
    setMediaDragActive(false);
    endDriveDrag();
    if (!creds) {
      dropLockRef.current = false;
      return setError(t('ui.generated.select_session_first_8e5fb74'));
    }
    // Immediate paths from File.path / cache
    let paths = extractOsPaths(e.dataTransfer);
    if (!paths.length && hasOsFiles(e.dataTransfer)) {
      // Wait for Tauri native paths (WebView2 File.path is usually empty)
      paths = await waitForOsPaths(500);
    }
    if (!paths.length) {
      // Still empty — Tauri drop handler may still fire with paths; don't error here
      dropLockRef.current = false;
      return;
    }
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
  if (typeof window !== 'undefined') {
    (window as any).__autogram_runUpload = (paths: string[], opts?: any) => runUploadRef.current(paths, opts);
  }

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
                t('ui.generated.drop_file_gagal_path_tidak_terbaca_coba_tombol_u_f1f6347')
              );
              clearLastOsPaths();
              return;
            }

            const c = credsRef.current;
            if (!c) {
              clearLastOsPaths();
              pendingOsDropTargetRef.current = null;
              setError(t('ui.generated.select_session_first_8e5fb74'));
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
        // Note: getCurrentWindow().onDragDropEvent removed — on Tauri 2 (Windows)
        // it fires the identical event as getCurrentWebview(), causing double execution.
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
      onDragEnter={(e: any) => {
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
      onDragLeave={(e: any) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDragOver={(e: any) => {
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
        className={`td-shell ${isDesktopDualPane ? 'is-docked-mode' : 'is-drawer-mode'} ${
          effectiveCollapsed ? 'rail-collapsed' : ''
        }${mediaDragActive ? ' is-media-dnd' : ''}${dragActive ? ' is-os-dnd' : ''}`}
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
          onDelete={handleDeleteFolder}
          onRename={handleRenameFolder}
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
          pingState={pingState}
          collapsed={effectiveCollapsed}
          onToggleCollapse={() => {
            if (!isDesktopDualPane) return;
            setCollapsed((c) => !c);
          }}
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
          onOpenRelogModal={() => setRelogModalOpen(true)}
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
            onSortMode={handleSortModeChange}
            thumbQuality={thumbQuality}
            onThumbQuality={handleThumbQuality}
            gridZoom={gridZoom}
            onGridZoom={handleGridZoom}
            selectedCount={selectedIds.length}
            onClearSelection={clearSelection}
            onSelectAll={handleSelectAllDisplayed}
            onInvertSelection={handleInvertSelection}
            onUpload={handleUpload}
            onRemoteUploadClick={() => setRemoteUploadOpen(true)}
            onDownloadAllClick={handleDownloadAll}
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
            onOpenTransferSettings={() => {
              setToolsOpen(false);
              setTransferSettingsOpen(true);
            }}
            onSwitchMode={onSwitchMode}
            onBackToLauncher={onBackToLauncher}
            onOpenTransferManager={toggleTransferManagerFromToolbar}
            transferHasHistory={
              transfer.active || (transfer.items?.length ?? 0) > 0 || !!transfer.banner
            }
            transferBadgeCount={transferBadge(transfer).count}
            transferBadgeKind={transferBadge(transfer).kind}
            onOpenLocations={openDrawer}
            loading={loadingFiles}
            fileCount={files.length}
            totalCount={totalFileCount}
            viewPerspective={viewPerspective}
            onViewPerspective={(p) => {
              if (p === viewPerspective) return;
              perspectivePrefsRef.current[viewPerspective] = { filter: mediaFilter, sort: sortMode };
              const nextPrefs = perspectivePrefsRef.current[p];
              setViewPerspective(p);
              setMediaFilter(nextPrefs.filter);
              setSortMode(nextPrefs.sort);
              clearSelection();
            }}
            categoryCounts={perspectiveCounts}
            isForum={isForumChat}
            topics={topics}
            topicFilter={topicFilter}
            onTopicFilter={handleTopicFilter}
            onAddTopic={handleCreateTopic}
            onDeleteTopic={handleDeleteTopic}
            onRenameTopic={handleRenameTopic}
            onCopyTopicId={(_topicId, topicPath) => {
              setStatusText(`ID Topik disalin: ${topicPath}`);
            }}
            topicsLoading={topicsLoading}
            onDropOnTopic={handleDropOnTopic}
            onOpenTools={() => {
              setToolsTab(isAdvFilterActive(advFilter) ? 'filter' : 'dups');
              setToolsOpen(true);
            }}
            toolsActive={toolsOpen || isAdvFilterActive(advFilter)}
            canNavBack={navHist.index > 0}
            canNavForward={navHist.index < navHist.stack.length - 1}
            onNavBack={() => goNav('back')}
            onNavForward={() => goNav('forward')}
            isPinned={currentPinned}
            onTogglePin={locationKind !== 'saved' ? () => {
              if (!session) return;
              setPins(
                toggleDrivePin(session, {
                  kind: locationKind,
                  id: activePeerId,
                  label: locationLabel,
                })
              );
            } : undefined}
            spaceLabel={spaceHint}
            statsLoading={statsLoading}
            statsAccurate={statsAccurate}
            hasMore={filesHasMore}
            scaleHint={scaleHint}
            onIndexAll={handleIndexAllMetadata}
            indexingAllActive={indexingAllActive}
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
                          setError(t('ui.generated.buka_folder_hanya_di_desktop_app_dfd20c5'));
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
                if (transfer.active) {
                  setError(t('ui.generated.transfer_masih_berjalan_6258539'));
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

                  let successCount = 0;
                  await runWithConcurrency(
                    r.ids.length,
                    transferSettings.downloadConcurrency,
                    async (i) => {
                    const msgId = r.ids[i];
                    const name = r.names[i] || `msg_${msgId}`;
                    const destFile = `${r.saveDir.replace(/[/\\]+$/, '')}/${name.replace(/[<>:"/\\|?*]/g, '_')}`;
                    const itemIdx = i;

                    setTransfer((t) => ({
                      ...t,
                      items: t.items.map((it, idx) =>
                        idx === itemIdx ? { ...it, status: 'active' as const, percent: 30 } : it
                      ),
                    }));

                    const res = await tgDownloadFile({
                      session: creds.session,
                      apiId: Number(creds.apiId) || 0,
                      apiHash: creds.apiHash,
                      chatId: String(peerId ?? 'me'),
                      messageId: msgId,
                      destPath: destFile,
                      conflictPolicy: transferSettings.downloadConflictPolicy,
                      resumePartial: transferSettings.downloadResumePartial,
                      integrity: transferSettings.downloadIntegrity,
                      transferId: `download-retry:${msgId}`,
                      itemIndex: itemIdx,
                    });

                    if (res?.ok) {
                      successCount++;
                      setTransfer((t) => ({
                        ...t,
                        items: t.items.map((it, idx) =>
                          idx === itemIdx ? { ...it, status: 'done' as const, percent: 100 } : it
                        ),
                      }));
                    } else {
                      const errTxt = res?.userMessage || res?.error?.message || 'Gagal retry';
                      setTransfer((t) => ({
                        ...t,
                        items: t.items.map((it, idx) =>
                          idx === itemIdx ? { ...it, status: 'failed' as const, error: errTxt } : it
                        ),
                      }));
                    }
                    }
                  );

                  if (successCount > 0) {
                    setStatusText(`Retry selesai → ${r.saveDir}`);
                  }
                } catch (e: any) {
                  setError(String(e?.message || e));
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
            onLoadMoreFiles={loadMoreFiles}
            onRefreshFiles={() => refreshFiles(0, { preserveError: true })}
            topicFilter={topicFilter}
            isForum={isForumChat}
            transferSettings={transferSettings}
            transferActive={transfer.active}
            onTransferSettingsChange={(next: TransferSettingsState) => {
              const normalized = normalizeTransferSettings(next);
              setTransferSettings(normalized);
              saveTransferSettings(normalized);
              void setSecureTransferSettings(normalized);
              void reevaluatePreflight(normalized);
            }}
            onPreviewFile={(f, opts) => {
              // Keep tools open behind preview so user can resume dups after Esc
              setPreviewDuplicateContext(opts?.duplicateContext || null);
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

          <DriveTransferSettings
            open={transferSettingsOpen}
            settings={transferSettings}
            transferActive={transfer.active}
            onClose={() => setTransferSettingsOpen(false)}
            onChange={(next: TransferSettingsState) => {
              const normalized = normalizeTransferSettings(next);
              setTransferSettings(normalized);
              saveTransferSettings(normalized);
              void setSecureTransferSettings(normalized);
              void reevaluatePreflight(normalized);
            }}
          />

          <MediaStudioOverlays
            dragActive={dragActive}
            mediaDragActive={mediaDragActive}
            breadcrumb={breadcrumb}
            error={error}
            setError={setError}
            driveCircuitTripped={creds ? isDriveSessionCircuitTripped(creds) : false}
            retrySec={0}
            onResetCircuit={() => creds && resetDriveSessionCircuit(creds)}
            onOpenRelogModal={() => setRelogModalOpen(true)}
          />

          {hasPersistedQueue && (
            <div
              className="td-error-banner"
              style={{
                background: 'rgba(217, 119, 6, 0.15)',
                border: '1px solid rgba(217, 119, 6, 0.3)',
                color: '#d97706',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              role="status"
            >
              <Upload size={15} />
              <span>{t('ui.generated.terdapat_unggahan_yang_belum_selesai_sebelumnya_d062f9d')}{persistedQueueCount} {t('ui.generated.file_93ddda0')}</span>
              <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="td-chip-btn"
                  style={{ background: '#d97706', color: '#fff', border: 'none' }}
                  onClick={handleResumeQueue}
                >
                  {t('ui.generated.lanjutkan_5bcbc79')}
                </button>
                <button
                  type="button"
                  className="td-chip-btn"
                  style={{ color: '#d97706', border: '1px solid rgba(217, 119, 6, 0.3)', background: 'transparent' }}
                  onClick={handleDismissPersistedQueue}
                >
                  {t('ui.generated.abaikan_96222fb')}
                </button>
              </div>
            </div>
          )}

          <div className="td-explorer-wrapper" style={{ position: 'relative', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {indexingJob.active && (
              <div
                className="td-sort-index-status"
                role="status"
                style={{
                  zIndex: 20,
                  position: 'absolute',
                  top: '10px',
                  right: '12px',
                  background: 'rgba(15, 23, 42, 0.92)',
                  backdropFilter: 'blur(8px)',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '8px 10px',
                  border: '1px solid rgba(56, 189, 248, 0.28)',
                  borderRadius: '10px',
                  color: '#fff',
                  pointerEvents: 'none',
                }}
              >
                <HardDrive size={16} className="text-blue-500" />
                <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                  {indexingJob.text}
                </span>
                <div
                  style={{
                    width: '72px',
                    height: '4px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, indexingJob.total > 0 ? (indexingJob.processed / indexingJob.total) * 100 : 0))}%`,
                      height: '100%',
                      background: '#3b82f6',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {dragActive && !mediaDragActive && (
              <div className="td-drop-overlay" data-dnd="os-upload">
                <div className="td-drop-overlay-icon">
                  <Upload size={36} strokeWidth={1.75} />
                </div>
                <p className="td-drop-overlay-title">
                  {t('ui.generated.lepas_untuk_mengunggah_ke_7f9ddc4')} <strong>{breadcrumb}</strong>
                </p>
                <span className="td-drop-overlay-hint">{t('ui.generated.file_dari_komputer_file_explorer_a254fe8')}</span>
              </div>
            )}

            {mediaDragActive && (
              <div className="td-internal-dnd-tip" role="status">
                {t('ui.generated.lepas_di_4ee781a')} <strong>{t('ui.generated.chat_atau_folder_3196d63')}</strong> {t('ui.generated.di_sidebar_untuk_memindahkan_78818ed')}
              </div>
            )}
            <DriveExplorer
              key={`${session}::${explorerScrollKey}`}
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
              viewPerspective={viewPerspective}
              onViewPerspective={setViewPerspective}
              totalCount={totalFileCount}
              sortMode={sortMode}
              onSortMode={handleSortModeChange}
              advFilter={advFilter}
              gridZoom={gridZoom}
              onGridZoom={handleGridZoom}
              folderId={peerId}
              topicId={topicFilter}
              locationType={locationKind === 'saved' ? 'saved_messages' : locationKind}
              creds={creds}
              onSelect={handleSelect}
              onToggleSelection={handleToggleSelection}
              onMarqueeSelect={handleMarqueeSelect}
              onClearSelection={clearSelection}
              onDisplayedIdsChange={(ids) => {
                displayedIdsRef.current = ids;
              }}
              onVisibleIdsChange={rememberVisibleThumbIds}
              onOpen={(f) => {
                if (f.icon_type === 'link') {
                  const url = f.original_name || f.name || '';
                  if (url) {
                    void (async () => {
                      try {
                        const mod = await import('@tauri-apps/plugin-opener');
                        await mod.openUrl(url);
                      } catch {
                        window.open(url, '_blank');
                      }
                    })();
                  }
                } else {
                  setPreviewFile(f);
                }
              }}
              onPreview={(f) => {
                if (f.icon_type === 'link') {
                  const url = f.original_name || f.name || '';
                  if (url) {
                    void (async () => {
                      try {
                        const mod = await import('@tauri-apps/plugin-opener');
                        await mod.openUrl(url);
                      } catch {
                        window.open(url, '_blank');
                      }
                    })();
                  }
                } else {
                  setPreviewFile(f);
                }
              }}
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
              onCanvasContextMenu={(e: any) => {
                e.preventDefault();
                setContextMenu({ kind: 'canvas', x: e.clientX, y: e.clientY });
              }}
            />
          </div>
        </div>
      </div>

      <MediaStudioModalsContainer
        relogModalOpen={relogModalOpen}
        setRelogModalOpen={setRelogModalOpen}
        sessionName={session}
        onNavigateToAccounts={onNavigateToAccounts}
        previewFile={previewFile}
        setPreviewFile={(f) => {
          setPreviewFile(f);
          if (!f) setPreviewDuplicateContext(null);
        }}
        duplicateContext={previewDuplicateContext}
        peerId={typeof peerId === 'number' ? peerId : null}
        creds={creds}
        folders={folders}
        chats={chats}
        topics={topics}
        refreshFiles={refreshFiles}
        refreshLocations={refreshLocations}
        openTransferManager={openTransferManager}
        runUploadPaths={runUploadPaths}
        handleEnqueueSingleDownload={handleEnqueueSingleDownload}
        previewIndex={previewIndex}
        sortedPreviewList={sortedPreviewList}
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        downloadOne={downloadOne}
        openOneInSystem={openOneInSystem}
        openOneWithApp={openOneWithApp}
        revealOne={revealOne}
        handleRename={handleRename}
        handleDeleteIds={handleDeleteIds}
        handleMove={handleMove}
        handleUpload={handleUpload}
        locationKind={locationKind}
        activePeerId={activePeerId}
        handleCreateFolder={handleCreateFolder}
        handleCreateSubfolder={handleCreateSubfolder}
        setLocationKind={setLocationKind}
        setActivePeerId={setActivePeerId}
        setTopicFilter={setTopicFilter}
        topicFilterRef={topicFilterRef}
        handleDeleteFolder={handleDeleteFolder}
        handleRenameFolder={handleRenameFolder}
        handleReparentFolder={handleReparentFolder}
        labelDriveItem={labelDriveItem}
        breadcrumbSegs={breadcrumbSegs}
        setStatusText={setStatusText}
        handleSelectAllDisplayed={handleSelectAllDisplayed}
        clearSelection={clearSelection}
        selectedIds={selectedIds}
        isLocationPinned={isLocationPinned}
        onToggleLocationPin={toggleLocationPin}
        activeConfirm={activeConfirm}
        closeDriveMoveConfirm={closeDriveMoveConfirm}
        setConfirmDlg={setConfirmDlg}
        inputDlg={inputDlg}
        setInputDlg={setInputDlg}
        destPicker={destPicker}
        setDestPicker={setDestPicker}
        remoteUploadOpen={remoteUploadOpen}
        setRemoteUploadOpen={setRemoteUploadOpen}
        transferSettings={transferSettings}
        handleRemoteUpload={handleRemoteUpload}
      />
      <TransferPreflightDialog
        report={preflightReport}
        creds={creds}
        onConfirm={closePreflight}
        onCancel={() => closePreflight(cancelledPreflightDecision)}
        onOpenSettings={() => {
          setTransferSettingsOpen(true);
        }}
        hasStackedModal={transferSettingsOpen}
      />
      <DownloadAllZipModal
        open={zipPreflight.open}
        locationLabel={breadcrumb || locationLabel}
        indexing={zipPreflight.indexing}
        ready={zipPreflight.ready}
        scannedCount={zipPreflight.scannedCount}
        expectedCount={zipPreflight.expectedCount}
        indexedFiles={zipPreflight.indexedFiles}
        totalBytes={totalBytes}
        error={zipPreflight.error}
        onIndex={() => void runZipFullIndex()}
        onCreate={(categories) => void createIndexedZip(categories)}
        onClose={() => {
          if (zipPreflight.indexing) return;
          setZipPreflight((state) => ({ ...state, open: false }));
        }}
      />
      {clipboard && clipboard.messageIds.length > 0 && (
        <aside className="td-clipboard-floating-bar" aria-label={t('speedtest.clipboard_banner_label')}>
          <div className="td-clipboard-floating-info">
            <span className={`td-clipboard-floating-icon ${clipboard.mode}`}>
              {clipboard.mode === 'cut' ? <Scissors size={15} /> : <Copy size={15} />}
            </span>
            <div className="td-clipboard-floating-text">
              <span className="td-clipboard-floating-title">
                {clipboard.mode === 'cut'
                  ? t('speedtest.clipboard_cut_active', {
                      count: clipboard.messageIds.length,
                      defaultValue: `${clipboard.messageIds.length} berkas dipotong (Cut)`,
                    })
                  : t('speedtest.clipboard_copy_active', {
                      count: clipboard.messageIds.length,
                      defaultValue: `${clipboard.messageIds.length} berkas disalin (Copy)`,
                    })}
              </span>
              <span className="td-clipboard-floating-desc">
                {t('speedtest.clipboard_paste_hint')}
              </span>
            </div>
          </div>
          <div className="td-clipboard-floating-actions">
            <button
              type="button"
              className="td-clipboard-paste-btn"
              onClick={() => {
                if (clipboard && clipboard.messageIds.length) {
                  pasteMoveRef.current(clipboard);
                }
              }}
              title={t('drive_tools.shortcut_ctrl_v')}
            >
              <ClipboardPaste size={14} />
              <span>{t('speedtest.clipboard_paste_here')}</span>
            </button>
            <button
              type="button"
              className="td-clipboard-cancel-btn"
              onClick={() => setDriveClipboard(null)}
              title={t('drive_tools.shortcut_esc')}
              aria-label={t('speedtest.clipboard_cancel')}
            >
              <X size={14} />
            </button>
          </div>
        </aside>
      )}
      </main>
  );
}
