import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Upload, FolderOpen, FolderPlus, Loader2, AlertTriangle } from 'lucide-react';
import type { DriveCredentials } from '../../lib/driveApi';
import {
  DEFAULT_GRID_ZOOM,
  canShowDriveThumb,
  isVideoDriveFile,
  gridColumnsForWidth,
  type DriveFile,
  type DriveGridZoom,
  type DriveMediaFilter,
  type DriveSortMode,
  type DriveViewMode,
} from '../../lib/driveTypes';
import {
  filterAndSortDriveFilesPower,
  type DriveAdvFilter,
} from '../../lib/drivePower';
import { getDrivePerfProfile } from '../../lib/devicePerformance';
import { prefetchThumbs } from '../../lib/thumbBatcher';
import { warmPreviewHead, warmPreviewHeads } from '../../lib/previewCache';
import {
  applyLiveMarquee,
  clientPointToContent,
  contentRectToClient,
  hitTestDisplayedByMarquee,
  marqueeModeFromKeys,
  normalizeContentRect,
  type MarqueeMode,
} from '../../lib/driveSelection';
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
  folderName: string;
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
};

/** Card aspect width:height = 2:3 → height = width * 3/2 */
const CARD_ASPECT_H = 3 / 2;
const GRID_GAP = 10;
const GRID_PAD_X = 14;
/** Breathing room under topbar / above last row (virtual rows are absolute) */
const GRID_PAD_TOP = 16;
const GRID_PAD_BOTTOM = 20;
const LIST_ROW_H = 48;
const LIST_HEAD_H = 40;
const LIST_PAD_TOP = 8;
const LIST_PAD_BOTTOM = 16;
const MARQUEE_THRESHOLD = 5;

export function DriveExplorer({
  files,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  progressiveReady = true,
  scrollKey = 'default',
  initialScrollTop = 0,
  onScrollPositionChange,
  scaleHint,
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
  folderName,
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
  onDisplayedIdsChange,
}: Props) {
  const draggingSet = useMemo(() => new Set(draggingIds || []), [draggingIds]);
  const parentRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<{ key: string; top: number } | null>(null);
  const lastScrollKeyRef = useRef<string | null>(null);
  if (lastScrollKeyRef.current !== scrollKey) {
    lastScrollKeyRef.current = scrollKey;
    pendingScrollRestoreRef.current = {
      key: scrollKey,
      top: Math.max(0, initialScrollTop || 0),
    };
  }
  const [width, setWidth] = useState(800);

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
    return filterAndSortDriveFilesPower(files, {
      query,
      mediaFilter,
      sortMode,
      adv: advFilter ?? null,
    });
  }, [files, query, mediaFilter, sortMode, advFilter]);

  const displayedIds = useMemo(() => displayed.map((f) => f.id), [displayed]);

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
  const gridOverscan = progressiveReady
    ? perf.tier === 'high' ? 4 : perf.tier === 'mid' ? 3 : 2
    : 1;
  const listOverscan = progressiveReady
    ? perf.tier === 'high' ? 18 : perf.tier === 'mid' ? 12 : 8
    : 6;

  const gridVirtualizer = useVirtualizer({
    count: rowCount + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: gridOverscan,
  });

  const listVirtualizer = useVirtualizer({
    count: displayed.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => LIST_ROW_H,
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
      if (el) onScrollPositionChange?.(scrollKey, el.scrollTop);
    };
  }, [scrollKey, onScrollPositionChange]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el || !onScrollPositionChange) return;
    let saveTimer: number | undefined;
    const save = () => onScrollPositionChange(scrollKey, el.scrollTop);
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

  // Prefetch thumbs for visible + near-visible cards (high/mid) — fills grid faster
  useEffect(() => {
    if (!progressiveReady || !creds || loading || !displayed.length) return;
    const prefetchRows = perf.thumbPrefetchRows;
    if (prefetchRows <= 0 && perf.tier === 'low') return;
    let startIdx = 0;
    let endIdx = Math.min(displayed.length, cols * 4);
    if (viewMode === 'grid' && gridItems.length) {
      const first = gridItems[0].index;
      const last = gridItems[gridItems.length - 1].index;
      startIdx = Math.max(0, first * cols);
      endIdx = Math.min(displayed.length, (last + 1 + prefetchRows) * cols);
    } else if (viewMode === 'list' && listItems.length) {
      startIdx = Math.max(0, listItems[0].index);
      endIdx = Math.min(
        displayed.length,
        listItems[listItems.length - 1].index + 1 + prefetchRows * cols
      );
    }
    const ids: number[] = [];
    const videoIds: number[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const f = displayed[i];
      if (!f) continue;
      if (canShowDriveThumb(f)) ids.push(f.id);
      if (isVideoDriveFile(f)) videoIds.push(f.id);
    }
    if (ids.length) prefetchThumbs(creds, folderId, ids);
    // Warm first ~768KB of a few visible videos so open-after-scroll is fast
    if (videoIds.length && perf.tier !== 'low') {
      warmPreviewHeads(creds, folderId, videoIds, perf.tier === 'high' ? 4 : 2);
    }
  }, [
    creds,
    folderId,
    displayed,
    gridItems,
    listItems,
    viewMode,
    cols,
    loading,
    progressiveReady,
    perf.thumbPrefetchRows,
    perf.tier,
  ]);

  const warmFile = useCallback(
    (file: DriveFile) => {
      if (!creds || !isVideoDriveFile(file)) return;
      warmPreviewHead(creds, folderId, file.id);
    },
    [creds, folderId]
  );

  useEffect(() => {
    if (!progressiveReady || !hasMore || !onLoadMore || loadingMore || loading) return;
    const items = viewMode === 'grid' ? gridItems : listItems;
    if (!items.length) return;
    const last = items[items.length - 1];
    const total = viewMode === 'grid' ? rowCount : displayed.length;
    // High-end: prefetch next page earlier so scroll never waits on empty rows
    const threshold =
      viewMode === 'grid'
        ? Math.max(
            perf.prefetchNextPage ? 4 : 2,
            Math.min(perf.prefetchNextPage ? 10 : 5, Math.ceil(total * (perf.prefetchNextPage ? 0.28 : 0.15)))
          )
        : perf.prefetchNextPage
          ? 14
          : 8;
    if (last.index < Math.max(0, total - threshold)) return;
    const t = window.setTimeout(() => onLoadMore(), perf.tier === 'high' ? 40 : 80);
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
    perf.tier,
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
    // Start marquee on empty surface
    const el = parentRef.current;
    if (!el) return;
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
      <div className="td-explorer">
        <div className="td-empty">
          <Loader2 size={32} className="spin" />
          <p>Memuat file…</p>
        </div>
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
          <h3>Gagal Memuat Lokasi</h3>
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
      {/* OS files only — Google Drive blue upload zone */}
      {dragActive && !internalDragActive && (
        <div className="td-drop-overlay" data-dnd="os-upload">
          <div className="td-drop-overlay-icon">
            <Upload size={36} strokeWidth={1.75} />
          </div>
          <p className="td-drop-overlay-title">
            Lepas untuk mengunggah ke <strong>{folderName}</strong>
          </p>
          <span className="td-drop-overlay-hint">File dari komputer / File Explorer</span>
        </div>
      )}

      {/* Internal move tip (like GDrive “drop on a folder”) — not full-screen overlay */}
      {internalDragActive && (
        <div className="td-internal-dnd-tip" role="status">
          Lepas di <strong>chat atau folder</strong> di sidebar untuk memindahkan
        </div>
      )}

      {scaleHint && <div className="td-scale-hint">{scaleHint}</div>}

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
                  className="td-load-more-row"
                  style={{
                    position: 'absolute',
                    top: v.start + LIST_HEAD_H + LIST_PAD_TOP,
                    left: 0,
                    width: '100%',
                  }}
                >
                  {loadingMore ? 'Loading more…' : hasMore ? 'Scroll for more…' : ''}
                </div>
              );
            }
            const f = displayed[v.index];
            return (
              <div
                key={f.id}
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
                  className="td-load-more-row"
                  style={{
                    position: 'absolute',
                    top: vRow.start + GRID_PAD_TOP,
                    left: 0,
                    width: '100%',
                    padding: 16,
                  }}
                >
                  {loadingMore ? (
                    <span>
                      <Loader2 size={14} className="spin" /> Memuat lagi…
                    </span>
                  ) : (
                    'Gulir untuk memuat lebih banyak…'
                  )}
                </div>
              );
            }
            const start = vRow.index * cols;
            const rowFiles = displayed.slice(start, start + cols);
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
                {rowFiles.map((f) => (
                  <DriveFileCard
                    key={f.id}
                    file={f}
                    selected={selectedSet.has(f.id)}
                    isDragSource={draggingSet.has(f.id)}
                    visible
                    onClick={(e) => onSelect(e, f.id)}
                    onDoubleClick={() => onOpen(f)}
                    onContextMenu={(e) => onContextMenu(e, f)}
                    onToggleSelection={() => onToggleSelection(f.id)}
                    onPreview={() => onPreview(f)}
                    onDownload={() => onDownload(f)}
                    onDelete={() => onDelete(f)}
                    onDragStartFile={onDragStartFile}
                    onDragEndFile={onDragEndFile}
                    onWarmPreview={() => warmFile(f)}
                    onMediaDragPrime={onMediaDragPrime}
                    creds={creds}
                    folderId={folderId}
                    thumbQuality={thumbQuality}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
