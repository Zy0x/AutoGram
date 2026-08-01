import { useTranslation } from 'react-i18next';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Upload, FolderOpen, FolderPlus, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { DriveGridSkeleton, DriveListSkeleton, CenteredGlassmorphicProgress } from './DriveSkeleton';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import {
  DEFAULT_GRID_ZOOM,
  canShowDriveThumb,
  gridColumnsForWidth,
  type DriveFile,
  type DriveGridZoom,
  type DriveMediaFilter,
  type DriveSortMode,
  type DriveViewMode,
  formatDriveBytes,
} from '../../../lib/telegram/driveTypes';
import {
  filterAndSortDriveFilesPower,
  type DriveAdvFilter,
} from '../../../lib/telegram';
import { formatMediaScanHeaderInfo, type MediaScanState } from '../../../lib/telegram/mediaScanStateMachine';
import { getDrivePerfProfile } from '../../../lib/utils/devicePerformance';
import { isThumbsPaused, primeThumbsFromFileList, requestVisibleThumbs, switchThumbContext, getLastCacheClearTimestamp } from '../../../lib/media/thumbBatcher';
import {
  applyLiveMarquee,
  clientPointToContent,
  contentRectToClient,
  hitTestDisplayedByMarquee,
  marqueeModeFromKeys,
  normalizeContentRect,
  type MarqueeMode,
} from '../../../lib/telegram';
import { DriveFileCard } from './DriveFileCard';
import { DriveFileListItem } from './DriveFileListItem';

type Props = {
  files: DriveFile[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Unlock proactive thumb prefetch and scroll pagination after first paint settles. */
  progressiveReady?: boolean;
  /** Stable per-session/location/topic/view key used for scroll restoration. */
  scrollKey?: string;
  initialScrollTop?: number;
  onScrollPositionChange?: (key: string, scrollTop: number) => void;
  scaleHint?: string | null;
  error: string | null;
  viewMode: DriveViewMode;
  selectedIds: number[];
  query: string;
  mediaFilter: DriveMediaFilter;
  sortMode: DriveSortMode;
  /** Optional advanced filters (size/date/ext) */
  advFilter?: DriveAdvFilter | null;
  gridZoom?: DriveGridZoom;
  onGridZoom?: (z: DriveGridZoom) => void;
  folderId: number | null;
  topicId?: number | null;
  locationType?: string;
  creds: DriveCredentials | null;
  /** Click selection — parent applies filter/sort-aware logic */
  onSelect: (e: React.MouseEvent, id: number) => void;
  onToggleSelection: (id: number) => void;
  /**
   * Marquee commit — receives **final** selected ids (already merged with
   * base selection for add/subtract modes). Parent should set, not re-apply.
   */
  onMarqueeSelect?: (finalSelectedIds: number[], mode: MarqueeMode) => void;
  /** Live marquee preview (optional) */
  onMarqueePreview?: (ids: number[] | null) => void;
  /** Click empty area (no drag) — usually clear selection */
  onClearSelection?: () => void;
  onOpen: (file: DriveFile) => void;
  onContextMenu: (e: React.MouseEvent, file: DriveFile) => void;
  onPreview: (file: DriveFile) => void;
  onDownload: (file: DriveFile) => void;
  onDelete: (file: DriveFile) => void;
  onUpload: () => void;
  /** Optional: create Drive (root) or Folder (nested) from empty state */
  onCreateFolder?: () => void;
  /** Right-click empty canvas (not a file card) — open location tools menu */
  onCanvasContextMenu?: (e: React.MouseEvent) => void;
  /** OS / Explorer file drag → show upload overlay */
  dragActive?: boolean;
  /** Internal media drag (move to sidebar) — GDrive-style dim + tip, no upload overlay */
  internalDragActive?: boolean;
  /** Message ids currently being dragged (dim source cards) */
  draggingIds?: number[];
  onDragStartFile?: (e: React.DragEvent, file: DriveFile) => void;
  onDragEndFile?: (e: React.DragEvent) => void;
  onMediaDragPrime?: (file: DriveFile, e: React.PointerEvent) => void;
  thumbQuality?: string;
  /** Notify parent of displayed id order (for shift/Ctrl+A) */
  onDisplayedIdsChange?: (ids: number[]) => void;
  /** Notify parent of the current virtual viewport for priority thumbnail work. */
  onVisibleIdsChange?: (ids: number[]) => void;
  scanState?: MediaScanState | null;
  onResumeSync?: () => void;
};

/** Card aspect width:height = 2:3 → height = width * 3/2 */
const CARD_ASPECT_H = 3 / 2;
const GRID_GAP = 10;
const GRID_PAD_X = 14;
/** Breathing room under topbar / above last row (virtual rows are absolute) */
const GRID_PAD_TOP = 22;
const GRID_PAD_BOTTOM = 8;
const LIST_ROW_H = 48;
const LIST_HEAD_H = 40;
const LIST_PAD_TOP = 12;
const LIST_PAD_BOTTOM = 8;
const MARQUEE_THRESHOLD = 5;

export function DriveExplorer({
  files,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  progressiveReady = true,
  initialScrollTop = 0,
  onScrollPositionChange,
  scaleHint: _scaleHint,
  error,
  viewMode,
  selectedIds,
  query,
  mediaFilter,
  sortMode,
  advFilter = null,
  gridZoom = DEFAULT_GRID_ZOOM,
  onGridZoom,
  folderId,
  topicId = null,
  locationType = folderId == null ? 'saved_messages' : 'group',
  creds,
  onSelect,
  onToggleSelection,
  onMarqueeSelect,
  onMarqueePreview,
  onClearSelection,
  onOpen,
  onContextMenu,
  onPreview,
  onDownload,
  onDelete,
  onUpload,
  onCreateFolder,
  onCanvasContextMenu,
  dragActive,
  internalDragActive,
  draggingIds,
  onDragStartFile,
  onDragEndFile,
  onMediaDragPrime,
  thumbQuality,
  scrollKey,
  onDisplayedIdsChange,
  onVisibleIdsChange,
  scanState,
  onResumeSync,
}: Props) {
  const { t } = useTranslation();
  const draggingSet = useMemo(() => new Set(draggingIds || []), [draggingIds]);
  const parentRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<{ key: string; top: number } | null>(null);
  const lastScrollKeyRef = useRef<string | null>(null);
  const activeScrollKey = scrollKey ?? 'default';
  if (lastScrollKeyRef.current !== activeScrollKey) {
    lastScrollKeyRef.current = activeScrollKey;
    pendingScrollRestoreRef.current = {
      key: activeScrollKey,
      top: Math.max(0, initialScrollTop || 0),
    };
  }
  const [width, setWidth] = useState(800);
  const thumbPeerId = folderId == null ? 'me' : String(folderId);
  const thumbContextOptions = useMemo(
    () => ({ peerId: thumbPeerId, topicId, locationType }),
    [thumbPeerId, topicId, locationType]
  );
  const contextFiles = useMemo(() => {
    const accountId = creds?.session;
    return files.filter((file: any) => {
      const fileAccount = file.account_id ?? file.accountId;
      if (accountId && fileAccount && String(fileAccount) !== accountId) return false;
      const filePeer = file.peer_id ?? file.peerId ?? (
        file.folder_id == null && file.folderId == null
          ? undefined
          : String(file.folder_id ?? file.folderId)
      );
      if (filePeer != null && String(filePeer) !== thumbPeerId) return false;
      if (topicId != null && topicId > 0) {
        const fileTopic = file.topic_id ?? file.topicId;
        if (Number(fileTopic) !== Number(topicId)) return false;
      }
      return true;
    });
  }, [files, creds?.session, thumbPeerId, topicId]);

  /**
   * Marquee state — start is fixed in **content** space so scroll mid-drag
   * does not slide the selection origin (which dropped earlier hits).
   */
  const marqueeRef = useRef<{
    active: boolean;
    pointerId: number;
    /** Content-space origin (fixed at pointerdown) */
    startContentX: number;
    startContentY: number;
    /** Last pointer in client space (for scroll recompute) */
    lastClientX: number;
    lastClientY: number;
    mode: MarqueeMode;
    baseSelected: number[];
    moved: boolean;
  } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  /** Live selection during marquee (visual only until commit) */
  const [liveSelected, setLiveSelected] = useState<number[] | null>(null);
  /** Last computed final selection for commit (same as live) */
  const liveSelectedRef = useRef<number[] | null>(null);

  useEffect(() => {
    if (creds) {
      switchThumbContext(creds, folderId, topicId);
    }
    if (creds && contextFiles.length) {
      primeThumbsFromFileList(creds, folderId, contextFiles, thumbContextOptions);
    }
  }, [creds, folderId, contextFiles, thumbQuality, thumbPeerId, topicId, thumbContextOptions]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      // clientWidth excludes scrollbar — correct for fitting columns
      const w = el.clientWidth || el.getBoundingClientRect().width || 800;
      setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    ro.observe(el);
    apply();
    window.addEventListener('resize', apply);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  // Ctrl/Cmd + wheel zooms grid tiles (does not steal normal scroll)
  useEffect(() => {
    const el = parentRef.current;
    if (!el || !onGridZoom || viewMode !== 'grid') return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? -1 : 1;
      onGridZoom(Math.max(0, Math.min(5, gridZoom + dir)) as DriveGridZoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onGridZoom, gridZoom, viewMode]);

  // Must use filterAndSortDriveFilesPower (includes adv filters) — never bare filterAndSortDriveFiles
  const displayed = useMemo(() => {
    return filterAndSortDriveFilesPower(contextFiles, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter ?? null,
    });
  }, [contextFiles, query, mediaFilter, sortMode, advFilter]);

  const displayedIds = useMemo(() => displayed.map((f: any) => f.id), [displayed]);
  const thumbableDisplayedIds = useMemo(
    () => new Set(displayed.filter(canShowDriveThumb).map((file) => String(file.id))),
    [displayed]
  );

  useEffect(() => {
    onDisplayedIdsChange?.(displayedIds);
  }, [displayedIds, onDisplayedIdsChange]);

  // Match JS pad to GRID_PAD_X so column math === laid-out width
  const cols = gridColumnsForWidth(width || 800, gridZoom, {
    gap: GRID_GAP,
    pad: GRID_PAD_X * 2,
  });
  const rowCount = Math.ceil(displayed.length / cols) || 0;
  const innerW = Math.max(0, (width || 800) - GRID_PAD_X * 2);
  const cardWidth = Math.max(
    48,
    cols > 0 ? (innerW - GRID_GAP * (cols - 1)) / cols : innerW
  );
  const rowHeight = Math.round(cardWidth * CARD_ASPECT_H + GRID_GAP);

  const perf = getDrivePerfProfile();
  // Slightly higher overscan reduces blank flash while scrolling without
  // mounting the whole grid (main source of "patah"/jank on WebView2).
  const gridOverscan = progressiveReady
    ? perf.tier === 'high' ? 8 : perf.tier === 'mid' ? 5 : 3
    : 2;
  const listOverscan = progressiveReady
    ? perf.tier === 'high' ? 20 : perf.tier === 'mid' ? 12 : 8
    : 4;

  const gridVirtualizer = useVirtualizer({
    count: rowCount + (displayed.length > 0 ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (index >= rowCount ? 48 : rowHeight),
    overscan: gridOverscan,
  });

  const listVirtualizer = useVirtualizer({
    count: displayed.length + (displayed.length > 0 ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (index >= displayed.length ? 48 : LIST_ROW_H),
    overscan: listOverscan,
  });

  useEffect(() => {
    gridVirtualizer.measure();
  }, [rowHeight, cols, rowCount, width, gridVirtualizer]);

  const gridItems = gridVirtualizer.getVirtualItems();
  const listItems = listVirtualizer.getVirtualItems();

  // Apply once when a location becomes renderable. New locations have top=0;
  // revisited locations restore their own saved offset.
  useLayoutEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    const el = parentRef.current;
    if (!pending || pending.key !== scrollKey || !el) return;
    el.scrollTop = pending.top;
    if (!loading) pendingScrollRestoreRef.current = null;
  }, [scrollKey, initialScrollTop, loading, displayed.length]);

  useLayoutEffect(() => {
    return () => {
      const el = parentRef.current;
      if (el && scrollKey) onScrollPositionChange?.(scrollKey, el.scrollTop);
    };
  }, [scrollKey, onScrollPositionChange]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el || !onScrollPositionChange || !scrollKey) return;
    const targetKey = scrollKey;
    let saveTimer: number | undefined;
    const save = () => onScrollPositionChange(targetKey, el.scrollTop);
    const onScroll = () => {
      if (saveTimer != null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(save, 180);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (saveTimer != null) window.clearTimeout(saveTimer);
      el.removeEventListener('scroll', onScroll);
    };
  }, [scrollKey, onScrollPositionChange, loading]);

  const isFastScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastScrollTimeRef = useRef(0);
  const scrollFlingTimerRef = useRef<number | null>(null);
  const scrollDirectionRef = useRef<'down' | 'up'>('down');
  const prefetchedOffsetsRef = useRef<Set<string>>(new Set());
  const lastRequestedViewportRef = useRef('');

  // Reset prefetched offsets when folder/location changes
  useEffect(() => {
    prefetchedOffsetsRef.current.clear();
  }, [scrollKey, folderId, query]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      const now = performance.now();
      const dt = now - (lastScrollTimeRef.current || now);
      const dy = Math.abs(el.scrollTop - (lastScrollTopRef.current || 0));

      if (el.scrollTop > (lastScrollTopRef.current || 0)) {
        scrollDirectionRef.current = 'down';
      } else if (el.scrollTop < (lastScrollTopRef.current || 0)) {
        scrollDirectionRef.current = 'up';
      }

      lastScrollTopRef.current = el.scrollTop;
      lastScrollTimeRef.current = now;

      if (dt > 0 && dy / dt > 2.8) {
        isFastScrollingRef.current = true;
      }

      // Proactive prefetch at 60% scroll height
      if (
        progressiveReady &&
        hasMore &&
        onLoadMore &&
        !loadingMore &&
        !loading
      ) {
        const viewportHeight = el.clientHeight;
        const scrollHeight = el.scrollHeight;
        if (scrollHeight > 0 && el.scrollTop + viewportHeight >= scrollHeight * 0.6) {
          onLoadMore();
        }
      }

      if (scrollFlingTimerRef.current != null) {
        window.clearTimeout(scrollFlingTimerRef.current);
      }
      scrollFlingTimerRef.current = window.setTimeout(() => {
        isFastScrollingRef.current = false;
      }, 80);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (scrollFlingTimerRef.current != null) window.clearTimeout(scrollFlingTimerRef.current);
      el.removeEventListener('scroll', onScroll);
    };
  }, [progressiveReady, hasMore, onLoadMore, loadingMore, loading, scrollKey, displayed.length]);

  // Proactive auto-fill effect: if loaded items do not fill the viewport and hasMore is true, load next page automatically
  useEffect(() => {
    if (!progressiveReady || !hasMore || !onLoadMore || loadingMore || loading) return;
    const el = parentRef.current;
    if (!el) return;
    const viewportHeight = el.clientHeight;
    const scrollHeight = el.scrollHeight;
    // Only fill an actually short viewport. Near-bottom pagination is owned by
    // the scroll event above; including it here cascaded one user scroll into
    // dozens of pages and re-rendered the grid continuously.
    if (scrollHeight === 0 || scrollHeight <= viewportHeight + 400) {
      onLoadMore();
    }
  }, [progressiveReady, hasMore, onLoadMore, loadingMore, loading, displayed.length]);

  // Prefetch thumbs for visible + overscan — rAF-coalesced so fast scroll does
  // not enqueue dozens of batch RPCs per frame (main scroll jank source).
  useEffect(() => {
    if (!progressiveReady || !creds || loading || !displayed.length || isThumbsPaused()) return;
    let raf = 0;
    let cancelled = false;
    let lastRun = 0;
    const throttleMs = perf.tier === 'high' ? 16 : perf.tier === 'mid' ? 30 : 50;
    const run = () => {
      const now = Date.now();
      if (now - lastRun < throttleMs) return;
      lastRun = now;
      if (cancelled) return;

      const scroller = parentRef.current;
      if (!scroller || viewMode !== 'grid') return;
      const viewportRect = scroller.getBoundingClientRect();
      const visibleIds = [...scroller.querySelectorAll<HTMLElement>('[data-drive-file="1"][data-msg-id]')]
        .filter((card) => {
          const id = card.dataset.msgId;
          if (!id || !thumbableDisplayedIds.has(id)) return false;
          const rect = card.getBoundingClientRect();
          return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
        })
        .map((card) => Number(card.dataset.msgId))
        .filter(Number.isFinite);
      const viewportSignature = `${creds.session}:${thumbPeerId}:${topicId ?? 'all'}:${thumbQuality ?? ''}:${visibleIds.join(',')}`;
      const viewportChanged = viewportSignature !== lastRequestedViewportRef.current;
      if (visibleIds.length && viewportChanged) {
        lastRequestedViewportRef.current = viewportSignature;
        requestVisibleThumbs(creds, folderId, visibleIds, {
          ...thumbContextOptions,
          replaceViewport: true,
        });
      }
      onVisibleIdsChange?.(visibleIds);
    };
    raf = requestAnimationFrame(run);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [
    creds,
    folderId,
    gridItems,
    listItems,
    viewMode,
    loading,
    progressiveReady,
    perf.tier,
    thumbQuality,
    thumbableDisplayedIds,
    thumbContextOptions,
    onVisibleIdsChange,
  ]);

  useEffect(() => {
    const handleCacheCleared = () => {
      if (!creds || !displayed.length) return;
      lastRequestedViewportRef.current = '';
      const scroller = parentRef.current;
      if (!scroller || viewMode !== 'grid') return;
      const viewportRect = scroller.getBoundingClientRect();
      const visibleIds = [...scroller.querySelectorAll<HTMLElement>('[data-drive-file="1"][data-msg-id]')]
        .filter((card) => {
          const id = card.dataset.msgId;
          if (!id || !thumbableDisplayedIds.has(id)) return false;
          const rect = card.getBoundingClientRect();
          return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
        })
        .map((card) => Number(card.dataset.msgId))
        .filter(Number.isFinite);
      if (visibleIds.length) {
        requestVisibleThumbs(creds, folderId, visibleIds, {
          ...thumbContextOptions,
          bypassCache: true,
          replaceViewport: true,
        });
      }
    };
    const lastWipe = getLastCacheClearTimestamp();
    if (lastWipe > 0 && Date.now() - lastWipe < 60000) {
      handleCacheCleared();
    }
    window.addEventListener('autogram-cache-cleared', handleCacheCleared);
    return () => window.removeEventListener('autogram-cache-cleared', handleCacheCleared);
  }, [creds, folderId, displayed.length, viewMode, thumbContextOptions, thumbableDisplayedIds]);

  const warmFile = useCallback(
    (_file: DriveFile) => {
      // Disable automatic video stream pre-fetching on card hover to prevent Telegram FLOOD_WAIT_27.
      // Video streaming will ONLY fire when the user explicitly clicks a video to open/play it.
    },
    []
  );

  useEffect(() => {
    if (!progressiveReady || !hasMore || !onLoadMore || loadingMore || loading) return;
    const items = viewMode === 'grid' ? gridItems : listItems;
    if (!items.length) return;
    const last = items[items.length - 1];
    const total = viewMode === 'grid' ? rowCount : displayed.length;
    // Aggressive proactive prefetch: trigger when 40% near bottom (8-25 rows remaining)
    const threshold =
      viewMode === 'grid'
        ? Math.max(8, Math.min(25, Math.ceil(total * 0.4)))
        : 25;
    if (last.index < Math.max(0, total - threshold)) return;
    const t = window.setTimeout(() => onLoadMore(), 10);
    return () => window.clearTimeout(t);
  }, [
    hasMore,
    progressiveReady,
    onLoadMore,
    loadingMore,
    loading,
    viewMode,
    rowCount,
    displayed.length,
    gridItems,
    listItems,
    perf.prefetchNextPage,
  ]);

  const effectiveSelected = liveSelected ?? selectedIds;
  const selectedSet = useMemo(() => new Set(effectiveSelected), [effectiveSelected]);

  const computeMarqueeHitsFromContent = useCallback(
    (contentRect: { x: number; y: number; w: number; h: number }) => {
      if (viewMode === 'grid') {
        // Layout rows start after GRID_PAD_TOP
        const adjusted = { ...contentRect, y: contentRect.y - GRID_PAD_TOP };
        return hitTestDisplayedByMarquee(displayedIds, adjusted, {
          mode: 'grid',
          cols,
          cardWidth,
          rowHeight,
          gap: GRID_GAP,
          padX: GRID_PAD_X,
        });
      }
      return hitTestDisplayedByMarquee(displayedIds, contentRect, {
        mode: 'list',
        rowHeight: LIST_ROW_H,
        headerOffset: LIST_HEAD_H + LIST_PAD_TOP,
      });
    },
    [viewMode, displayedIds, cols, cardWidth, rowHeight]
  );

  /** Recompute marquee hits + rubber-band from content-stable start + last pointer */
  const updateMarqueeFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const m = marqueeRef.current;
      const el = parentRef.current;
      if (!m?.active || !el) return;
      m.lastClientX = clientX;
      m.lastClientY = clientY;

      const cbox = el.getBoundingClientRect();
      const cur = clientPointToContent(
        clientX,
        clientY,
        cbox,
        el.scrollLeft,
        el.scrollTop
      );

      // Client-space delta only for threshold (prevent accidental select)
      const startClientX = m.startContentX - el.scrollLeft + cbox.left;
      const startClientY = m.startContentY - el.scrollTop + cbox.top;
      const dx = clientX - startClientX;
      const dy = clientY - startClientY;
      if (!m.moved && Math.hypot(dx, dy) < MARQUEE_THRESHOLD) return;
      m.moved = true;

      const contentRect = normalizeContentRect(
        m.startContentX,
        m.startContentY,
        cur.x,
        cur.y
      );
      const clientBox = contentRectToClient(
        contentRect,
        cbox,
        el.scrollLeft,
        el.scrollTop
      );
      setMarqueeBox(clientBox);

      const hits = computeMarqueeHitsFromContent(contentRect);
      const next = applyLiveMarquee(m.baseSelected, hits, m.mode);
      liveSelectedRef.current = next;
      setLiveSelected(next);
      onMarqueePreview?.(next);
    },
    [computeMarqueeHitsFromContent, onMarqueePreview]
  );

  const detachMarqueeScroll = useCallback(() => {
    const el = parentRef.current;
    const handler = (el as HTMLElement & { __marqueeScroll?: (ev: Event) => void })
      ?.__marqueeScroll;
    if (el && handler) {
      el.removeEventListener('scroll', handler);
      delete (el as HTMLElement & { __marqueeScroll?: (ev: Event) => void }).__marqueeScroll;
    }
  }, []);

  const isInteractiveTarget = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el?.closest) return false;
    return !!el.closest(
      '.td-file-card, .td-list-row, button, a, input, textarea, select, [role="button"]'
    );
  };

  const onExplorerPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    const el = parentRef.current;
    if (!el) return;

    // Ignore clicks on scrollbars
    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    if (localX >= el.clientWidth || localY >= el.clientHeight) {
      return;
    }

    // Start marquee on empty surface
    el.setPointerCapture(e.pointerId);
    const mode = marqueeModeFromKeys(e);
    const cbox = el.getBoundingClientRect();
    const start = clientPointToContent(
      e.clientX,
      e.clientY,
      cbox,
      el.scrollLeft,
      el.scrollTop
    );
    marqueeRef.current = {
      active: true,
      pointerId: e.pointerId,
      startContentX: start.x,
      startContentY: start.y,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      mode,
      // Snapshot prior selection for add/subtract (replace ignores this)
      baseSelected: [...selectedIds],
      moved: false,
    };
    liveSelectedRef.current = null;
    setMarqueeBox(null);
    setLiveSelected(null);

    // Recompute when user scrolls mid-drag (wheel / trackpad)
    detachMarqueeScroll();
    const onScroll = () => {
      const m = marqueeRef.current;
      if (!m?.active) return;
      updateMarqueeFromPointer(m.lastClientX, m.lastClientY);
    };
    (el as HTMLElement & { __marqueeScroll?: (ev: Event) => void }).__marqueeScroll = onScroll;
    el.addEventListener('scroll', onScroll, { passive: true });
  };

  const onExplorerPointerMove = (e: React.PointerEvent) => {
    const m = marqueeRef.current;
    if (!m?.active || m.pointerId !== e.pointerId) return;
    if (m.moved) e.preventDefault();
    updateMarqueeFromPointer(e.clientX, e.clientY);
  };

  const endMarquee = (e: React.PointerEvent) => {
    const m = marqueeRef.current;
    if (!m?.active || m.pointerId !== e.pointerId) return;

    // Final recompute while ref still active
    updateMarqueeFromPointer(e.clientX, e.clientY);
    const moved = m.moved;
    const mode = m.mode;
    const baseSelected = m.baseSelected;
    const startContentX = m.startContentX;
    const startContentY = m.startContentY;
    const finalIds = liveSelectedRef.current;

    marqueeRef.current = null;
    detachMarqueeScroll();
    try {
      parentRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setMarqueeBox(null);
    setLiveSelected(null);
    liveSelectedRef.current = null;
    onMarqueePreview?.(null);

    if (!moved) {
      // Click empty — clear unless additive key held without drag
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        onClearSelection?.();
      }
      return;
    }

    // Commit the same list shown live (content-stable hits + baseSelected)
    if (finalIds) {
      onMarqueeSelect?.(finalIds, mode);
      return;
    }
    // Fallback if move never painted live state
    const el = parentRef.current;
    if (!el) return;
    const cbox = el.getBoundingClientRect();
    const cur = clientPointToContent(
      e.clientX,
      e.clientY,
      cbox,
      el.scrollLeft,
      el.scrollTop
    );
    const contentRect = normalizeContentRect(
      startContentX,
      startContentY,
      cur.x,
      cur.y
    );
    const hits = computeMarqueeHitsFromContent(contentRect);
    onMarqueeSelect?.(applyLiveMarquee(baseSelected, hits, mode), mode);
  };

  if (loading && files.length === 0) {
    return (
      <div className="td-explorer" style={{ padding: '16px', position: 'relative' }}>
        <div className="ag-loading-overlay">
          <CenteredGlassmorphicProgress isLoading={true} />
        </div>
        {viewMode === 'grid' ? <DriveGridSkeleton count={16} /> : <DriveListSkeleton count={10} />}
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div className="td-explorer">
        <div className="td-empty td-empty-error">
          <div className="td-empty-icon" style={{ opacity: 0.8, color: 'inherit' }}>
            <AlertTriangle size={48} />
          </div>
          <h3>{t('speedtest.load_location_failed')}</h3>
          <p style={{ maxWidth: '600px', margin: '0 auto', opacity: 0.9 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`td-explorer ${dragActive ? 'drag-over is-os-dnd' : ''}${
        internalDragActive ? ' is-internal-dnd' : ''
      } td-zoom-${gridZoom}${marqueeBox ? ' is-marquee' : ''}${
        thumbQuality ? ` td-thumb-q-${thumbQuality}` : ''
      }`}
      ref={parentRef}
      data-grid-zoom={gridZoom}
      data-grid-cols={cols}
      data-thumb-q={thumbQuality || 'balanced'}
      onPointerDown={onExplorerPointerDown}
      onPointerMove={onExplorerPointerMove}
      onPointerUp={endMarquee}
      onPointerCancel={endMarquee}
      onContextMenu={(e) => {
        // Fallback if document capture is absent — block native menu always
        e.preventDefault();
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('[data-drive-file], .td-file-card, .td-list-row')) return;
        if (t?.closest?.('button, a, input, textarea, select')) return;
        onCanvasContextMenu?.(e);
      }}
    >

      {marqueeBox && (
        <div
          className="td-marquee-rect"
          style={{
            position: 'fixed',
            left: marqueeBox.x,
            top: marqueeBox.y,
            width: marqueeBox.w,
            height: marqueeBox.h,
            pointerEvents: 'none',
            zIndex: 50,
          }}
        />
      )}

      {!loading && !error && displayed.length === 0 && (
        <div className="td-empty">
          <div className="td-empty-icon">
            <FolderOpen size={48} />
          </div>
          <h3>
            {query || mediaFilter !== 'all' ? 'Tidak ada yang cocok' : 'Folder ini kosong'}
          </h3>
          <p>
            {query || mediaFilter !== 'all'
              ? 'Coba filter lain, hapus kata pencarian, atau ganti lokasi di sidebar.'
              : 'Unggah foto, video, atau dokumen — disimpan di Telegram seperti drive sungguhan. Atau buat Drive [TD] di sidebar, lalu Folder di dalamnya.'}
          </p>
          {!query && mediaFilter === 'all' && (
            <div className="td-empty-actions">
              <button type="button" className="td-btn-primary" onClick={onUpload}>
                <Upload size={16} /> Unggah file
              </button>
              {onCreateFolder && (
                <button type="button" className="td-btn-secondary" onClick={onCreateFolder}>
                  <FolderPlus size={16} />{' '}
                  {folderId != null ? 'Buat folder di sini' : 'Buat Drive [TD]'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {displayed.length > 0 && viewMode === 'list' && (
        <div
          className="td-list td-list-virtual"
          style={{
            height: listVirtualizer.getTotalSize() + LIST_HEAD_H + LIST_PAD_TOP + LIST_PAD_BOTTOM,
            position: 'relative',
          }}
        >
          <div
            className="td-list-head"
            role="row"
            style={{ top: LIST_PAD_TOP }}
          >
            <div className="td-list-ico" />
            <div className="td-list-name">Name</div>
            <div className="td-list-size">Size</div>
            <div className="td-list-date">Date</div>
          </div>
          {listItems.map((v) => {
            if (v.index >= displayed.length) {
              return (
                <div
                  key="more"
                  className={`td-load-more-row ${loadingMore ? 'is-loading' : ''}`}
                  onClick={() => {
                    if (!loadingMore && onLoadMore) {
                      onLoadMore();
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: v.start + LIST_HEAD_H + LIST_PAD_TOP,
                    left: 0,
                    width: '100%',
                    padding: '6px 16px',
                    textAlign: 'center',
                  }}
                >
                  {(() => {
                    if (loadingMore) {
                      return (
                        <div
                          className="td-loading-more-badge"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 20px',
                            borderRadius: 20,
                            background: 'rgba(59, 130, 246, 0.15)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            color: '#60a5fa',
                            fontSize: '13px',
                            fontWeight: 500,
                            backdropFilter: 'blur(8px)',
                          }}
                        >
                          <Loader2 size={16} className="spin text-blue-400" />
                          <span>{t('speedtest.loading_more', 'Memuat media lagi…')}</span>
                        </div>
                      );
                    }
                    if (hasMore) {
                      return (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 20px',
                            borderRadius: 20,
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            color: 'rgba(255, 255, 255, 0.8)',
                            fontSize: '13px',
                            cursor: 'pointer',
                          }}
                        >
                          <span>{t('speedtest.scroll_to_load_more', 'Gulir atau klik untuk memuat lebih banyak…')}</span>
                        </div>
                      );
                    }
                    // Section B8 rule: ONLY show verified badge if status === 'complete_verified' or scanState absent
                    if (!scanState || scanState.status === 'complete_verified') {
                      return (
                        <div
                          className="td-end-of-list-badge"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 20px',
                            borderRadius: 20,
                            background: 'rgba(16, 185, 129, 0.12)',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                            color: '#34d399',
                            fontSize: '13px',
                            fontWeight: 500,
                            backdropFilter: 'blur(8px)',
                          }}
                        >
                          <CheckCircle2 size={16} className="text-emerald-400" />
                          <span>Semua {displayed.length} media terverifikasi</span>
                        </div>
                      );
                    }
                    const info = formatMediaScanHeaderInfo(scanState, formatDriveBytes);
                    return (
                      <div
                        className="td-sync-status-badge"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 20px',
                          borderRadius: 20,
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                          color: '#fbbf24',
                          fontSize: '13px',
                          fontWeight: 500,
                          backdropFilter: 'blur(8px)',
                        }}
                      >
                        <AlertTriangle size={16} className="text-amber-400" />
                        <span>{info.statusText}</span>
                        {info.canResume && onResumeSync && (
                          <button
                            type="button"
                            className="px-2.5 py-1 text-xs font-semibold text-amber-950 bg-amber-400 rounded-md hover:bg-amber-300 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onResumeSync();
                            }}
                          >
                            Lanjutkan
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            }
            const f = displayed[v.index];
            return (
              <div
                key={`${activeScrollKey}:${f.peer_id || thumbPeerId}:${f.topic_id ?? topicId ?? 'none'}:${f.id}`}
                data-file-id={f.id}
                data-display-index={v.index}
                style={{
                  position: 'absolute',
                  top: v.start + LIST_HEAD_H + LIST_PAD_TOP,
                  left: 0,
                  width: '100%',
                  height: v.size,
                }}
              >
                <DriveFileListItem
                  file={f}
                  selected={selectedSet.has(f.id)}
                  isDragSource={draggingSet.has(f.id)}
                  onClick={(e) => onSelect(e, f.id)}
                  onDoubleClick={() => onOpen(f)}
                  onContextMenu={(e) => onContextMenu(e, f)}
                  onDragStartFile={onDragStartFile}
                  onDragEndFile={onDragEndFile}
                  onMediaDragPrime={onMediaDragPrime}
                  onWarmPreview={() => warmFile(f)}
                />
              </div>
            );
          })}
        </div>
      )}

      {displayed.length > 0 && viewMode === 'grid' && (
        <div
          className="td-grid-virtual"
          style={{
            height: gridVirtualizer.getTotalSize() + GRID_PAD_TOP + GRID_PAD_BOTTOM,
            position: 'relative',
            width: '100%',
          }}
        >
          {gridItems.map((vRow) => {
            if (vRow.index >= rowCount) {
              return (
                <div
                  key="more"
                  className={`td-load-more-row ${loadingMore ? 'is-loading' : ''}`}
                  onClick={() => {
                    if (!loadingMore && onLoadMore) {
                      onLoadMore();
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: vRow.start + GRID_PAD_TOP,
                    left: GRID_PAD_X,
                    right: GRID_PAD_X,
                    width: 'auto',
                    padding: '6px 0',
                    textAlign: 'center',
                  }}
                >
                  {(() => {
                    if (loadingMore) {
                      return (
                        <div
                          className="td-loading-more-badge"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 22px',
                            borderRadius: 20,
                            background: 'rgba(59, 130, 246, 0.15)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            color: '#60a5fa',
                            fontSize: '13px',
                            fontWeight: 500,
                            backdropFilter: 'blur(8px)',
                          }}
                        >
                          <Loader2 size={16} className="spin text-blue-400" />
                          <span>{t('speedtest.loading_more', 'Memuat media lagi…')}</span>
                        </div>
                      );
                    }
                    if (hasMore) {
                      return (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 22px',
                            borderRadius: 20,
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            color: 'rgba(255, 255, 255, 0.8)',
                            fontSize: '13px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <span>{t('speedtest.scroll_to_load_more', 'Gulir atau klik untuk memuat lebih banyak…')}</span>
                        </div>
                      );
                    }
                    if (!scanState || scanState.status === 'complete_verified') {
                      return (
                        <div
                          className="td-end-of-list-badge"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 20px',
                            borderRadius: 20,
                            background: 'rgba(16, 185, 129, 0.12)',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                            color: '#34d399',
                            fontSize: '13px',
                            fontWeight: 500,
                            backdropFilter: 'blur(8px)',
                          }}
                        >
                          <CheckCircle2 size={16} className="text-emerald-400" />
                          <span>Semua {displayed.length} media terverifikasi</span>
                        </div>
                      );
                    }
                    const info = formatMediaScanHeaderInfo(scanState, formatDriveBytes);
                    return (
                      <div
                        className="td-sync-status-badge"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 20px',
                          borderRadius: 20,
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                          color: '#fbbf24',
                          fontSize: '13px',
                          fontWeight: 500,
                          backdropFilter: 'blur(8px)',
                        }}
                      >
                        <AlertTriangle size={16} className="text-amber-400" />
                        <span>{info.statusText}</span>
                        {info.canResume && onResumeSync && (
                          <button
                            type="button"
                            className="px-2.5 py-1 text-xs font-semibold text-amber-950 bg-amber-400 rounded-md hover:bg-amber-300 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onResumeSync();
                            }}
                          >
                            Lanjutkan
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            }
            const start = vRow.index * cols;
            const rowFiles = displayed.slice(start, start + cols);
            const viewportTop = gridVirtualizer.scrollOffset ?? parentRef.current?.scrollTop ?? 0;
            const viewportBottom = viewportTop + (
              gridVirtualizer.scrollRect?.height ?? parentRef.current?.clientHeight ?? 0
            );
            const rowVisible =
              vRow.start + vRow.size + GRID_PAD_TOP > viewportTop
              && vRow.start + GRID_PAD_TOP < viewportBottom;
            return (
              <div
                key={vRow.key}
                className="td-grid-row"
                style={{
                  position: 'absolute',
                  top: vRow.start + GRID_PAD_TOP,
                  /* left+right (not fixed px width) — always tracks container on resize */
                  left: GRID_PAD_X,
                  right: GRID_PAD_X,
                  width: 'auto',
                  height: vRow.size,
                  display: 'grid',
                  /* minmax(0,1fr) — allow shrink below content min-size (no overflow) */
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: GRID_GAP,
                  alignItems: 'stretch',
                  boxSizing: 'border-box',
                  maxWidth: '100%',
                }}
              >
                <DriveGridRow
                  rowFiles={rowFiles}
                  selectedSet={selectedSet}
                  draggingSet={draggingSet}
                  creds={creds}
                  folderId={folderId}
                  renderContextKey={`${activeScrollKey}:${thumbPeerId}:${topicId ?? 'none'}`}
                  topicId={topicId}
                  thumbQuality={thumbQuality}
                  visible={rowVisible}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  onContextMenu={onContextMenu}
                  onToggleSelection={onToggleSelection}
                  onPreview={onPreview}
                  onDownload={onDownload}
                  onDelete={onDelete}
                  onDragStartFile={onDragStartFile}
                  onDragEndFile={onDragEndFile}
                  onWarmPreview={warmFile}
                  onMediaDragPrime={onMediaDragPrime}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DriveGridRowProps = {
  rowFiles: DriveFile[];
  selectedSet: Set<number>;
  draggingSet: Set<number>;
  creds: DriveCredentials | null;
  folderId: number | null;
  renderContextKey: string;
  topicId: number | null;
  thumbQuality?: string;
  visible: boolean;
  onSelect: (e: React.MouseEvent, id: number) => void;
  onOpen: (file: DriveFile) => void;
  onContextMenu: (e: React.MouseEvent, file: DriveFile) => void;
  onToggleSelection: (id: number) => void;
  onPreview: (file: DriveFile) => void;
  onDownload: (file: DriveFile) => void;
  onDelete: (file: DriveFile) => void;
  onDragStartFile?: (e: React.DragEvent, file: DriveFile) => void;
  onDragEndFile?: (e: React.DragEvent) => void;
  onWarmPreview: (file: DriveFile) => void;
  onMediaDragPrime?: (file: DriveFile, e: React.PointerEvent) => void;
};

const DriveGridRow = memo(function DriveGridRow({
  rowFiles,
  selectedSet,
  draggingSet,
  creds,
  folderId,
  renderContextKey,
  topicId,
  thumbQuality,
  visible,
  onSelect,
  onOpen,
  onContextMenu,
  onToggleSelection,
  onPreview,
  onDownload,
  onDelete,
  onDragStartFile,
  onDragEndFile,
  onWarmPreview,
  onMediaDragPrime,
}: DriveGridRowProps) {
  return (
    <>
      {rowFiles.map((f: any) => (
        <DriveFileCard
          key={`${renderContextKey}:${f.peer_id || 'peer'}:${f.topic_id ?? 'none'}:${f.id}`}
          file={f}
          selected={selectedSet.has(f.id)}
          isDragSource={draggingSet.has(f.id)}
          visible={visible}
          onClick={(e) => onSelect(e, f.id)}
          onDoubleClick={() => onOpen(f)}
          onContextMenu={(e) => onContextMenu(e, f)}
          onToggleSelection={() => onToggleSelection(f.id)}
          onPreview={() => onPreview(f)}
          onDownload={() => onDownload(f)}
          onDelete={() => onDelete(f)}
          onDragStartFile={onDragStartFile}
          onDragEndFile={onDragEndFile}
          onWarmPreview={() => onWarmPreview(f)}
          onMediaDragPrime={onMediaDragPrime}
          creds={creds}
          folderId={folderId}
          contextTopicId={topicId}
          thumbQuality={thumbQuality}
        />
      ))}
    </>
  );
}, (prev: DriveGridRowProps, next: DriveGridRowProps) => {
  if (prev.rowFiles.length !== next.rowFiles.length) return false;
  if (prev.folderId !== next.folderId || prev.thumbQuality !== next.thumbQuality) return false;
  if (prev.renderContextKey !== next.renderContextKey) return false;
  if (prev.topicId !== next.topicId) return false;
  if (prev.visible !== next.visible) return false;
  if (prev.creds?.session !== next.creds?.session) return false;
  for (let i = 0; i < prev.rowFiles.length; i++) {
    const pf = prev.rowFiles[i];
    const nf = next.rowFiles[i];
    if (pf.id !== nf.id) return false;
    if (prev.selectedSet.has(pf.id) !== next.selectedSet.has(nf.id)) return false;
    if (prev.draggingSet.has(pf.id) !== next.draggingSet.has(nf.id)) return false;
  }
  return true;
});
