import {
  LayoutGrid,
  List,
  Upload,
  Download,
  ListTodo,
  Trash2,
  RefreshCw,
  Menu,
  MessagesSquare,
  ArrowUpDown,
  ZoomIn,
  ZoomOut,
  ListChecks,
  SquareX,
  ArrowLeftRight,
  SendHorizontal,
  MousePointerClick,
  Settings,
  Pin,
  PinOff,
  Copy,
  Edit2,
  Globe,
  FolderArchive,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Sparkles,
  X,
  Search,
  Pause,
  Play,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTopicDrop, useHoldToScroll } from './useTopicDrop';
import type {
  DriveGridZoom,
  DriveMediaFilter,
  DriveSortMode,
  DriveThumbQuality,
  DriveTopic,
  DriveTopicFilter,
  DriveViewMode,
} from '../../../lib/telegram/driveTypes';
import { MediaSelect } from './MediaSelect';
import { DriveStorageInfoBadge } from './DriveStorageInfoBadge';
import { copyTextWithFallback } from '../../../lib/utils/debugMode';
import {
  DRIVE_GRID_ZOOM_LEVELS,
  DRIVE_SORT_OPTIONS,
  DRIVE_THUMB_QUALITY_OPTIONS,
  MAX_GRID_ZOOM,
  MIN_GRID_ZOOM,
} from '../../../lib/telegram/driveTypes';

export type DriveCrumbSeg = {
  id: number | null;
  label: string;
  kind: 'start' | 'drive' | 'chat' | 'saved' | 'topic';
};

type Props = {
  folderName: string;
  /** Multi-level path; when set, replaces single folderName crumb */
  breadcrumbSegs?: DriveCrumbSeg[];
  onBreadcrumbNavigate?: (seg: DriveCrumbSeg) => void;
  viewMode: DriveViewMode;
  onViewMode: (m: DriveViewMode) => void;
  query: string;
  onQuery: (q: string) => void;
  mediaFilter: DriveMediaFilter;
  onMediaFilter: (f: DriveMediaFilter) => void;
  sortMode: DriveSortMode;
  onSortMode: (m: DriveSortMode) => void;
  thumbQuality: DriveThumbQuality;
  onThumbQuality: (q: DriveThumbQuality) => void;
  gridZoom: DriveGridZoom;
  onGridZoom: (z: DriveGridZoom) => void;
  selectedCount: number;
  onClearSelection: () => void;
  /** Select all items in current filter/sort view */
  onSelectAll?: () => void;
  /** Invert selection within current filter/sort view */
  onInvertSelection?: () => void;
  onUpload: () => void;
  onRemoteUploadClick?: () => void;
  onDownloadAllClick?: () => void;
  onDownload: () => void;

  onDelete: () => void;
  onMoveSelected?: () => void;
  onRefresh: () => void;
  /** Open Upload/Download transfer settings panel */
  onOpenTransferSettings?: () => void;
  /** Open floating Transfer Manager panel */
  onOpenTransferManager?: () => void;
  transferBusy?: boolean;
  /** Disable upload/download/delete/move while exclusive transfer runs */
  actionsDisabled?: boolean;
  transferHasHistory?: boolean;
  /** Numeric badge on Transfer Manager button (in-progress / errors / done). */
  transferBadgeCount?: number;
  transferBadgeKind?: 'busy' | 'error' | 'done' | 'none';
  onOpenLocations?: () => void;
  loading?: boolean;
  fileCount: number;
  /** Forum topics — shown only when isForum and topics available */
  isForum?: boolean;
  topics?: DriveTopic[];
  topicFilter?: DriveTopicFilter;
  onTopicFilter?: (t: DriveTopicFilter) => void;
  onAddTopic?: () => void;
  onDeleteTopic?: (topicId: number, title: string) => void;
  onRenameTopic?: (topicId: number, title: string) => void;
  onCopyTopicId?: (topicId: number, topicPath: string) => void;
  topicsLoading?: boolean;
  onDropOnTopic?: (topicId: number | null, topicTitle: string, e: React.DragEvent) => void;
  /** Open Drive power tools (dup/rename/copy/filter/space) */
  onOpenTools?: () => void;
  toolsActive?: boolean;
  /** Browser-style location history */
  canNavBack?: boolean;
  canNavForward?: boolean;
  onNavBack?: () => void;
  onNavForward?: () => void;  /** Pin current location */
  isPinned?: boolean;
  onTogglePin?: () => void;
  /** Optional space usage hint under count */
  spaceLabel?: string | null;
  /** True while background media_stats walk is refining count/size */
  statsLoading?: boolean;
  /** True when unique media_stats finished (location-wide accurate) */
  statsAccurate?: boolean;
  /** True when pagination has more pages remaining to fetch from Telegram */
  hasMore?: boolean;
  /** True only when the durable historical index checkpoint is complete. */
  indexComplete?: boolean;
  /** Optional background calculation hint text */
  scaleHint?: string | null;
  /** Dual perspective mode: 'telegram' (Nekogram/Telegram style) vs 'drive' (MIME/file style) */
  viewPerspective?: 'telegram' | 'drive';
  onIndexAll?: () => void;
  onStopIndex?: () => void;
  onTogglePauseIndex?: () => void;
  indexingAllActive?: boolean;
  indexingProgress?: {
    processed: number;
    total: number | null;
    percent?: number;
    speed?: number;
    eta?: string | null;
    tier?: string;
    isPaused?: boolean;
  } | null;
  onViewPerspective?: (perspective: 'telegram' | 'drive') => void;
  /** Total item count from Telegram query metadata */
  totalCount?: number | null;
  /** Exact counts for the filter pills in the active perspective. */
  categoryCounts?: Record<string, number> | null;
  /** Dual-Bar Quick Switcher callback */
  onSwitchMode?: (mode: 'drives' | 'forwarder') => void;
  onBackToLauncher?: () => void;
};

export function DriveTopBar({
  folderName,
  breadcrumbSegs,
  onBreadcrumbNavigate,
  viewMode,
  onViewMode,
  query,
  onQuery,
  mediaFilter,
  onMediaFilter,
  sortMode,
  onSortMode,
  thumbQuality,
  onThumbQuality,
  gridZoom,
  onGridZoom,
  selectedCount,
  onClearSelection,
  onSelectAll,
  onInvertSelection,
  onUpload,
  onRemoteUploadClick,
  onDownloadAllClick,
  onDownload,

  onDelete,
  onMoveSelected,
  onRefresh,
  onOpenTransferSettings,
  onOpenTransferManager,
  transferBusy,
  actionsDisabled,
  transferHasHistory,
  transferBadgeCount = 0,
  transferBadgeKind = 'none',
  onOpenLocations,
  loading,
  fileCount,
  isForum,
  topics = [],
  topicFilter = null,
  onTopicFilter,
  onAddTopic,
  onDeleteTopic,
  onRenameTopic,
  onCopyTopicId,
  topicsLoading,
  onDropOnTopic,
  onOpenTools,
  toolsActive,
  canNavBack,
  canNavForward,
  onNavBack,
  onNavForward,
  isPinned,
  onTogglePin,
  spaceLabel,
  statsLoading,
  statsAccurate,
  hasMore,
  indexComplete = false,
  scaleHint: _scaleHint,
  viewPerspective = 'telegram',
  onViewPerspective,
  totalCount,
  categoryCounts,
  onIndexAll,
  onStopIndex,
  onTogglePauseIndex,
  indexingAllActive,
  indexingProgress,
  onSwitchMode: _onSwitchMode,
  onBackToLauncher: _onBackToLauncher,
}: Props) {
  const { t } = useTranslation();
  const [manualSpin, setManualSpin] = useState(false);
  const [isToolsCollapsed, setIsToolsCollapsed] = useState<boolean>(false);
  const collapseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasAutoCollapsedForDriveRef = useRef<boolean>(false);

  const isToolsCollapsedRef = useRef<boolean>(false);
  useEffect(() => {
    isToolsCollapsedRef.current = isToolsCollapsed;
  }, [isToolsCollapsed]);

  // Auto-collapse condition: only applies for compact window height (400px - 550px)
  const checkShouldAutoCollapse = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const isTargetHeight = window.innerHeight >= 400 && window.innerHeight <= 550;
    const isShortHeight = window.innerHeight <= 550;
    return (isTargetHeight || isShortHeight) && !isPinned;
  }, [isPinned]);

  const startAutoCollapseTimer = useCallback((durationMs = 5000) => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    if (!checkShouldAutoCollapse() || hasAutoCollapsedForDriveRef.current) return;

    collapseTimerRef.current = setTimeout(() => {
      const isHovered = Boolean(headerRef.current && headerRef.current.matches(':hover'));
      const isInputFocused = Boolean(searchInputRef.current && document.activeElement === searchInputRef.current);
      if (!isHovered && !isInputFocused && checkShouldAutoCollapse() && !hasAutoCollapsedForDriveRef.current) {
        setIsToolsCollapsed(true);
        hasAutoCollapsedForDriveRef.current = true;
      }
    }, durationMs);
  }, [checkShouldAutoCollapse]);

  // Auto-collapse runs ONCE after 5 seconds on initial drive/folder load (400px-550px height)
  useEffect(() => {
    hasAutoCollapsedForDriveRef.current = false;

    if (typeof window === 'undefined') return;
    const shouldCollapse = checkShouldAutoCollapse();

    if (shouldCollapse) {
      setIsToolsCollapsed(false);
      startAutoCollapseTimer(5000);
    } else {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      setIsToolsCollapsed(false);
    }

    const handleResize = () => {
      if (typeof window === 'undefined') return;
      const should = checkShouldAutoCollapse();
      if (!should) {
        if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
        setIsToolsCollapsed(false);
      } else if (!isToolsCollapsedRef.current && !hasAutoCollapsedForDriveRef.current) {
        startAutoCollapseTimer(5000);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [folderName, isPinned, checkShouldAutoCollapse, startAutoCollapseTimer]);

  const handleMouseEnter = useCallback(() => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
  }, []);

  const handleMouseLeave = useCallback(() => {
    // Only resume timer during initial entry countdown (never if user manually expanded)
    if (!isToolsCollapsedRef.current && !hasAutoCollapsedForDriveRef.current && checkShouldAutoCollapse()) {
      startAutoCollapseTimer(3000);
    }
  }, [checkShouldAutoCollapse, startAutoCollapseTimer]);

  const handleSearchFocus = useCallback(() => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
  }, []);

  const handleSearchBlur = useCallback(() => {
    // Only resume timer during initial entry countdown (never if user manually expanded)
    if (!isToolsCollapsedRef.current && !hasAutoCollapsedForDriveRef.current && checkShouldAutoCollapse()) {
      startAutoCollapseTimer(3000);
    }
  }, [checkShouldAutoCollapse, startAutoCollapseTimer]);

  const handleToggleCollapse = useCallback(() => {
    // When user manually toggles/expands, cancel any auto-collapse permanently for this drive session
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    hasAutoCollapsedForDriveRef.current = true;
    setIsToolsCollapsed((prev) => !prev);
  }, []);

  const handleRefreshClick = () => {
    setManualSpin(true);
    setTimeout(() => setManualSpin(false), 800);
    onRefresh();
  };
  const isFinal = Boolean(statsAccurate || (!loading && hasMore === false));
  const hasTopicSegment = breadcrumbSegs?.some((s) => s.kind === 'topic');
  const showTopics =
    !!isForum ||
    (topics && topics.length > 0) ||
    topicFilter != null ||
    !!topicsLoading ||
    !!hasTopicSegment;

  const topicPillsRef = useRef<HTMLDivElement>(null);
  const {
    activeDragTopicId,
    pointerHoverKey,
    canScrollLeft,
    canScrollRight,
    scrollTopicsBy,
    createTopicHoldProps,
    handlePillsWheel,
    handlePillsDragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useTopicDrop({
    onDropOnTopic,
    topicPillsRef,
    topicsCount: topics?.length ?? 0,
  });

  // Auto-scroll active topic pill into view (e.g. from Quick Jump, Quick Action, or topic click)
  useEffect(() => {
    if (topicFilter == null || !topicPillsRef.current) return;
    const scrollToActiveTopic = () => {
      const container = topicPillsRef.current;
      if (!container) return;
      const activePill =
        container.querySelector<HTMLElement>(`[data-topic-id="${topicFilter}"]`) ||
        container.querySelector<HTMLElement>(`[data-topic-id="${String(topicFilter)}"]`) ||
        container.querySelector<HTMLElement>(`[data-topic-id="${Number(topicFilter)}"]`) ||
        container.querySelector<HTMLElement>('.td-topic-pill.active');
      if (activePill) {
        const containerRect = container.getBoundingClientRect();
        const pillRect = activePill.getBoundingClientRect();
        const pillCenter = pillRect.left + pillRect.width / 2;
        const containerCenter = containerRect.left + containerRect.width / 2;
        const delta = pillCenter - containerCenter;
        const targetScrollLeft = Math.max(0, container.scrollLeft + delta);
        container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
      }
    };

    // Staggered triggers to reliably catch async MTProto topic loading and DOM layout paint
    scrollToActiveTopic();
    const t1 = setTimeout(scrollToActiveTopic, 50);
    const t2 = setTimeout(scrollToActiveTopic, 150);
    const t3 = setTimeout(scrollToActiveTopic, 300);
    const t4 = setTimeout(scrollToActiveTopic, 600);
    const t5 = setTimeout(scrollToActiveTopic, 1200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [topicFilter, topics, showTopics]);

  const topbarActionsRef = useRef<HTMLDivElement>(null);
  const [canScrollActionsLeft, setCanScrollActionsLeft] = useState(false);
  const [canScrollActionsRight, setCanScrollActionsRight] = useState(false);
  const { createHoldProps: createActionsHoldProps } = useHoldToScroll(topbarActionsRef);

  const updateActionsScrollState = useCallback(() => {
    const el = topbarActionsRef.current;
    if (!el) {
      setCanScrollActionsLeft(false);
      setCanScrollActionsRight(false);
      return;
    }
    setCanScrollActionsLeft(el.scrollLeft > 2);
    setCanScrollActionsRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = topbarActionsRef.current;
    if (!el) return;
    updateActionsScrollState();
    el.addEventListener('scroll', updateActionsScrollState, { passive: true });
    window.addEventListener('resize', updateActionsScrollState, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateActionsScrollState());
      ro.observe(el);
    }

    const t = setTimeout(updateActionsScrollState, 80);
    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', updateActionsScrollState);
      window.removeEventListener('resize', updateActionsScrollState);
      if (ro) ro.disconnect();
    };
  }, [updateActionsScrollState, viewMode, gridZoom]);

  const handleActionsWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!topbarActionsRef.current) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      topbarActionsRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  const [topicContextMenu, setTopicContextMenu] = useState<{
    x: number;
    y: number;
    topicId: number;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (!topicContextMenu) return;
    const handleClose = () => setTopicContextMenu(null);
    let removeListeners: (() => void) | undefined;
    const t = window.setTimeout(() => {
      window.addEventListener('click', handleClose);
      window.addEventListener('contextmenu', handleClose);
      removeListeners = () => {
        window.removeEventListener('click', handleClose);
        window.removeEventListener('contextmenu', handleClose);
      };
    }, 50);
    return () => {
      window.clearTimeout(t);
      removeListeners?.();
    };
  }, [topicContextMenu]);

  const zoomLevel = DRIVE_GRID_ZOOM_LEVELS[gridZoom] || DRIVE_GRID_ZOOM_LEVELS[2];
  const canZoomOut = gridZoom > MIN_GRID_ZOOM;
  const canZoomIn = gridZoom < MAX_GRID_ZOOM;

  const hasSelection = selectedCount > 0;

  /** Selection tools sit beside search bar on row 2 — zero layout shift. */
  const selectionToolbar = (
    <div className="td-selection-strip is-beside-search" role="toolbar" aria-label={t('ui.generated.aksi_seleksi_e8c5093')}>
      <div className="td-selection-strip-left">
        <span className="td-selection-count" title={t("speedtest.topbar_selected_count_tooltip", { count: selectedCount })}>
          <MousePointerClick size={14} strokeWidth={2} aria-hidden />
          <strong>{selectedCount}</strong>
          <span className="td-selection-count-label">{t('speedtest.topbar_selected')}</span>
        </span>
        {onSelectAll && (
          <button
            type="button"
            className="td-chip-btn"
            onClick={onSelectAll}
            title={t('speedtest.select_visible_all')}
          >
            <ListChecks size={15} strokeWidth={2} aria-hidden />
            <span className="td-chip-label">{t('speedtest.topbar_select_all')}</span>
          </button>
        )}
        {onInvertSelection && (
          <button
            type="button"
            className="td-chip-btn"
            onClick={onInvertSelection}
            title={t("speedtest.topbar_invert_tooltip")}
          >
            <ArrowLeftRight size={15} strokeWidth={2} aria-hidden />
            <span className="td-chip-label">{t('speedtest.topbar_invert')}</span>
          </button>
        )}
        <button
          type="button"
          className="td-chip-btn"
          onClick={onClearSelection}
          title={t("speedtest.topbar_deselect_all_tooltip")}
        >
          <SquareX size={15} strokeWidth={2} aria-hidden />
          <span className="td-chip-label">{t('speedtest.topbar_cancel')}</span>
        </button>
        <div className="td-selection-divider" aria-hidden="true" />
      </div>
      <div className="td-selection-strip-right">
        {onMoveSelected && (
          <button
            type="button"
            className="td-chip-btn primary"
            onClick={onMoveSelected}
            disabled={!!actionsDisabled}
            title={
              actionsDisabled
                ? 'Tunggu transfer selesai'
                : 'Kirim / pindahkan ke chat atau folder'
            }
          >
            <SendHorizontal size={15} strokeWidth={2} aria-hidden />
            <span className="td-chip-label">{t('speedtest.topbar_move')}</span>
          </button>
        )}
        <button
          type="button"
          className="td-chip-btn"
          onClick={onDownload}
          disabled={!!actionsDisabled}
          title={actionsDisabled ? t('speedtest.topbar_wait_transfer') : t('speedtest.topbar_download_sel')}
        >
          <Download size={15} strokeWidth={2} aria-hidden />
          <span className="td-chip-label">{t('speedtest.topbar_download')}</span>
        </button>
        <button
          type="button"
          className="td-chip-btn danger"
          onClick={onDelete}
          disabled={!!actionsDisabled}
          title={actionsDisabled ? t('speedtest.topbar_wait_transfer') : t('speedtest.topbar_delete_sel')}
        >
          <Trash2 size={15} strokeWidth={2} aria-hidden />
          <span className="td-chip-label">{t('speedtest.topbar_delete')}</span>
        </button>
      </div>
    </div>
  );

  return (
    <header
      ref={headerRef}
      className={`td-topbar${hasSelection ? ' has-selection' : ''}${isToolsCollapsed ? ' is-tools-collapsed' : ''}`}
      data-perspective={viewPerspective}
      data-stats-exact={isFinal ? 'true' : 'false'}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Row 1: nav + breadcrumbs + primary actions (always stable) */}
      <div className="td-topbar-row td-topbar-row-1">
        <div className="td-topbar-left">
          {onOpenLocations && (
            <button
              type="button"
              className="td-icon-btn td-menu-btn"
              onClick={onOpenLocations}
              title={t('speedtest.open_location_list')}
              aria-label={t("speedtest.open_location_list")}
            >
              <Menu size={18} />
            </button>
          )}
          {(onNavBack || onNavForward || onTogglePin) && (
            <div className="td-nav-history-group" role="group" aria-label="Drive history and pin navigation">
              {onNavBack && (
                <button
                  type="button"
                  className={`td-nav-history-btn td-nav-history-prev ${!canNavBack ? 'is-disabled' : ''}`}
                  disabled={!canNavBack}
                  onClick={onNavBack}
                  title={`${t('speedtest.nav_back_drive', { defaultValue: 'Kembali ke Drive sebelumnya' })} (Alt+←)`}
                  aria-label={t('speedtest.nav_back_drive', { defaultValue: 'Kembali ke Drive sebelumnya' })}
                >
                  <ChevronLeft size={14} strokeWidth={2.2} />
                </button>
              )}
              {onNavForward && (
                <button
                  type="button"
                  className={`td-nav-history-btn td-nav-history-next ${!canNavForward ? 'is-disabled' : ''}`}
                  disabled={!canNavForward}
                  onClick={onNavForward}
                  title={`${t('speedtest.nav_forward_drive', { defaultValue: 'Maju ke Drive berikutnya' })} (Alt+→)`}
                  aria-label={t('speedtest.nav_forward_drive', { defaultValue: 'Maju ke Drive berikutnya' })}
                >
                  <ChevronRight size={14} strokeWidth={2.2} />
                </button>
              )}
              {onTogglePin && (
                <button
                  type="button"
                  className={`td-nav-history-btn td-nav-history-pin ${isPinned ? 'active is-pinned' : ''}`}
                  onClick={onTogglePin}
                  title={isPinned ? t('speedtest.topbar_unpin_loc') : t('speedtest.topbar_pin_loc')}
                  aria-label={isPinned ? t("speedtest.topbar_unpin_loc") : t("speedtest.topbar_pin_loc")}
                >
                  {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
              )}
            </div>
          )}
          <nav className="td-breadcrumbs" aria-label={t('ui.generated.breadcrumb_c766e66')}>
            {breadcrumbSegs && breadcrumbSegs.length > 0 ? (
              (() => {
                let displaySegs = breadcrumbSegs;
                let hasEllipsis = false;
                if (breadcrumbSegs.length > 3) {
                  hasEllipsis = true;
                  displaySegs = [
                    breadcrumbSegs[0],
                    breadcrumbSegs[breadcrumbSegs.length - 2],
                    breadcrumbSegs[breadcrumbSegs.length - 1],
                  ];
                }
                const fullPathString = breadcrumbSegs.map((s) => s.label).join(' / ');
                return (
                  <>
                    {displaySegs.map((seg, i) => {
                      const isLast = i === displaySegs.length - 1;
                      const isEllipsisAfterFirst = hasEllipsis && i === 0;
                      const clickable =
                        !isLast &&
                        !!onBreadcrumbNavigate &&
                        (seg.kind === 'start' ||
                          seg.kind === 'saved' ||
                          (seg.kind === 'drive' && seg.id != null) ||
                          (seg.kind === 'chat' && seg.id != null));
                      return (
                        <span key={`${seg.kind}-${seg.id ?? seg.label}-${i}`} className="td-crumb-wrap">
                          {i > 0 && <span className="td-crumb-sep">/</span>}
                          {clickable ? (
                            <button
                              type="button"
                              className="td-crumb-link"
                              title={seg.label}
                              onClick={() => onBreadcrumbNavigate?.(seg)}
                            >
                              {seg.label}
                            </button>
                          ) : (
                            <span
                              className={isLast ? 'td-crumb-current' : 'td-crumb-muted'}
                              title={seg.label}
                            >
                              {seg.label}
                            </span>
                          )}
                          {isEllipsisAfterFirst && (
                            <>
                              <span className="td-crumb-sep">/</span>
                              <span
                                className="td-crumb-muted td-crumb-ellipsis"
                                title={t("speedtest.topbar_full_path", { path: fullPathString })}
                              >
                                …
                              </span>
                            </>
                          )}
                        </span>
                      );
                    })}
                  </>
                );
              })()
            ) : (
              <>
                <span className="td-crumb-muted">{t('ui.generated.start_952f375')}</span>
                <span className="td-crumb-sep">/</span>
                <span className="td-crumb-current" title={folderName}>
                  {folderName}
                </span>
              </>
            )}
          </nav>
          <DriveStorageInfoBadge
            fileCount={fileCount}
            totalCount={totalCount}
            spaceLabel={spaceLabel}
            statsLoading={statsLoading}
            statsAccurate={statsAccurate}
            isFinal={isFinal}
            transferBusy={transferBusy}
            hasMore={hasMore}
            categoryCounts={categoryCounts}
            locationKey={folderName || 'root'}
          />
        </div>

        <div className="td-topbar-actions-wrapper">
            {canScrollActionsLeft && (
              <button
                type="button"
                className="td-action-nav-btn left"
                {...createActionsHoldProps(-1, 140, 12)}
                title={t('speedtest.scroll_tools_left')}
                aria-label={t('speedtest.scroll_tools_left')}
              >
                <ChevronLeft size={13} strokeWidth={2.5} />
              </button>
            )}

            <div
              ref={topbarActionsRef}
              onWheel={handleActionsWheel}
              className="td-topbar-actions"
            >
              {viewMode === 'grid' && (
                <div className="td-zoom-controls" role="group" aria-label={t('speedtest.topbar_zoom_grid_aria')}>
                  <button
                    type="button"
                    className="td-icon-btn"
                    disabled={!canZoomOut}
                    onClick={() => onGridZoom((gridZoom - 1) as DriveGridZoom)}
                    title={t("speedtest.topbar_zoom_out")}
                    aria-label={t('speedtest.topbar_zoom_out_aria')}
                  >
                    <ZoomOut size={16} />
                  </button>
                  <button
                    type="button"
                    className="td-zoom-label"
                    onClick={() => onGridZoom(2 as DriveGridZoom)}
                    title={t("speedtest.topbar_zoom_reset_hint", { label: zoomLevel.label })}
                  >
                    {zoomLevel.short}
                  </button>
                  <button
                    type="button"
                    className="td-icon-btn"
                    disabled={!canZoomIn}
                    onClick={() => onGridZoom((gridZoom + 1) as DriveGridZoom)}
                    title={t("speedtest.topbar_zoom_in")}
                    aria-label={t('speedtest.topbar_zoom_in_aria')}
                  >
                    <ZoomIn size={16} />
                  </button>
                </div>
              )}

              <div className="td-view-toggle" role="group" aria-label={t('speedtest.topbar_view_mode_aria')}>
                <button
                  type="button"
                  className={`td-icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => onViewMode('grid')}
                  title={t('speedtest.topbar_view_grid_title')}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  className={`td-icon-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={() => onViewMode('list')}
                  title={t('speedtest.topbar_view_list_title')}
                >
                  <List size={16} />
                </button>
              </div>

              <button
                type="button"
                className={`td-icon-btn td-topbar-btn-refresh${loading || manualSpin ? ' is-refreshing' : ''}`}
                onClick={handleRefreshClick}
                disabled={loading}
                title={t("speedtest.topbar_refresh_all")}
                aria-label={t('speedtest.sidebar_btn_refresh')}
              >
                <RefreshCw size={16} className={loading || manualSpin ? 'spin' : undefined} />
              </button>

              {onOpenTransferManager && (
                <button
                  type="button"
                  className={`td-icon-btn td-transfer-open-btn ${transferBusy ? 'is-busy' : ''} ${
                    transferHasHistory ? 'has-history' : ''
                  } badge-${transferBadgeKind}`}
                  onClick={onOpenTransferManager}
                  title={
                    transferBusy
                      ? t('speedtest.topbar_tm_running', { count: transferBadgeCount })
                      : transferBadgeKind === 'error'
                        ? t('speedtest.topbar_tm_failed', { count: transferBadgeCount })
                        : transferBadgeKind === 'done'
                          ? t('speedtest.topbar_tm_done', { count: transferBadgeCount })
                          : t('speedtest.topbar_open_transfer_manager')
                  }
                  aria-label={t('speedtest.topbar_tm_aria')}
                >
                  <ListTodo size={16} />
                  {transferBadgeCount > 0 && transferBadgeKind !== 'none' && (
                    <span
                      className={`td-transfer-badge kind-${transferBadgeKind}`}
                      aria-hidden
                    >
                      {transferBadgeCount > 99 ? '99+' : transferBadgeCount}
                    </span>
                  )}
                </button>
              )}

              {onDownloadAllClick && (
                <button
                  type="button"
                  className="td-btn-secondary td-topbar-btn-zip"
                  onClick={onDownloadAllClick}
                  disabled={!!actionsDisabled}
                  title={t("speedtest.topbar_download_zip")}
                  aria-label={t("speedtest.topbar_download_zip")}
                >
                  <FolderArchive size={15} />
                  <span className="td-btn-label">{t("speedtest.topbar_download_zip_short")}</span>
                </button>
              )}

              {(onOpenTools || onOpenTransferSettings) && (
                <button
                  type="button"
                  className={`td-btn-secondary td-topbar-btn-tools ${toolsActive ? 'active' : ''}`}
                  onClick={onOpenTools || onOpenTransferSettings}
                  disabled={!!actionsDisabled}
                  title={t('speedtest.tools_title')}
                  aria-label={t('speedtest.tools_title')}
                >
                  <Settings size={15} />
                  <span className="td-btn-label">{t('speedtest.topbar_settings_btn')}</span>
                </button>
              )}

              {onRemoteUploadClick && (
                <button
                  type="button"
                  className="td-btn-secondary td-topbar-btn-remote"
                  onClick={onRemoteUploadClick}
                  disabled={!!actionsDisabled}
                  title={t("speedtest.remote_upload_url_title")}
                  aria-label={t("speedtest.remote_upload_url_title")}
                >
                  <Globe size={15} />
                  <span className="td-btn-label">{t("speedtest.remote_url_btn")}</span>
                </button>
              )}

              <button
                type="button"
                className="td-btn-primary"
                onClick={onUpload}
                disabled={!!actionsDisabled}
                title={
                  actionsDisabled
                    ? t('speedtest.topbar_upload_wait_title')
                    : t('speedtest.upload_file_to_loc')
                }
                aria-label={
                  actionsDisabled
                    ? t('speedtest.topbar_upload_wait_title')
                    : t('speedtest.upload_file_to_loc')
                }
              >
                <Upload size={16} />
                <span className="td-btn-label">{t('speedtest.btn_upload')}</span>
              </button>
            </div>

            {canScrollActionsRight && (
              <button
                type="button"
                className="td-action-nav-btn right"
                {...createActionsHoldProps(1, 140, 12)}
                title={t('speedtest.scroll_tools_right')}
                aria-label={t('speedtest.scroll_tools_right')}
              >
                <ChevronRight size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

      {/* Forum topics — Semua media + per-topic filter (Always visible if topics exist) */}
      {showTopics && (
            <div className="td-topbar-row td-topbar-row-topics" role="group" aria-label={t("speedtest.label_topic")}>
          <span className="td-topics-label">
            <MessagesSquare size={14} />
            {t('speedtest.label_topic')}
          </span>
          <div className="td-topics-scroll-container">
            {canScrollLeft && (
              <button
                type="button"
                className="td-topic-nav-btn left"
                {...createTopicHoldProps(-1, 150, 14)}
                onDragOver={(e) => {
                  e.preventDefault();
                  scrollTopicsBy(-18);
                }}
                title={t('speedtest.scroll_topics_left')}
                aria-label={t('speedtest.scroll_topics_left')}
              >
                <ChevronLeft size={13} strokeWidth={2.5} />
              </button>
            )}
            <div
              ref={topicPillsRef}
              className="td-topic-pills"
              onWheel={handlePillsWheel}
              onDragOver={handlePillsDragOver}
            >
              <button
                type="button"
                data-drop-key="topic:all"
                data-location-kind="topic"
                data-topic-id="all"
                className={`td-topic-pill ${topicFilter == null ? 'active' : ''} ${
                  activeDragTopicId === 'all' || pointerHoverKey === 'topic:all' ? 'is-drag-over is-drop-over' : ''
                }`}
                onClick={() => onTopicFilter?.(null)}
                onDragOver={(e) => handleDragOver(null, e)}
                onDragLeave={(e) => handleDragLeave(null, e)}
                onDrop={(e) => handleDrop(null, t('speedtest.all_media_pill'), e)}
                title={t('speedtest.show_group_media')}
              >
                {t('speedtest.all_media_pill')}
              </button>
              {topicsLoading && topics.length === 0 && (
                <span className="td-topics-loading">{t("speedtest.loading_topics")}</span>
              )}
              {topics.map((tp) => {
                const isOver =
                  activeDragTopicId === tp.id ||
                  activeDragTopicId === String(tp.id) ||
                  pointerHoverKey === `topic:${tp.id}` ||
                  pointerHoverKey === `topic:${String(tp.id)}`;
                const classes = ['td-topic-pill'];
                if (topicFilter === tp.id) classes.push('active');
                if (tp.closed) classes.push('is-closed');
                if (isOver) classes.push('is-drag-over', 'is-drop-over');
                return (
                  <button
                    key={tp.id}
                    type="button"
                    data-drop-key={`topic:${tp.id}`}
                    data-location-kind="topic"
                    data-topic-id={tp.id}
                    className={classes.join(' ')}
                    onClick={() => onTopicFilter?.(tp.id)}
                    onDragOver={(e) => handleDragOver(tp.id, e)}
                    onDragLeave={(e) => handleDragLeave(tp.id, e)}
                    onDrop={(e) => handleDrop(tp.id, tp.title, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setTopicContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        topicId: tp.id,
                        title: tp.title,
                      });
                    }}
                    title={tp.closed ? `${tp.title} (${t("speedtest.topic_closed_suffix")})` : tp.title}
                  >
                    {tp.title}
                  </button>
                );
              })}
              {onAddTopic && (
                <button
                  type="button"
                  className="td-topic-pill td-topic-pill-add"
                  onClick={onAddTopic}
                  title={t('speedtest.add_new_topic')}
                >
                  {t("speedtest.btn_add_topic")}
                </button>
              )}
            </div>
            {canScrollRight && (
              <button
                type="button"
                className="td-topic-nav-btn right"
                {...createTopicHoldProps(1, 150, 14)}
                onDragOver={(e) => {
                  e.preventDefault();
                  scrollTopicsBy(18);
                }}
                title={t('speedtest.scroll_topics_right')}
                aria-label={t('speedtest.scroll_topics_right')}
              >
                <ChevronRight size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      )}

      {!isToolsCollapsed && (
        <>
          {/*
            Row 2: search input AND selection tools side-by-side (strict 1-row height -> zero layout shift).
          */}
      <div
        className={`td-topbar-row td-topbar-row-2${hasSelection ? ' has-selection-tools' : ''}`}
      >
        <div className="td-topbar-search-box">
          <Search size={14} className="td-topbar-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            className="td-search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onQuery('');
              }
            }}
            placeholder={t("speedtest.search_placeholder")}
            aria-label={t("speedtest.search_aria_label")}
            title={t('speedtest.filter_media_tooltip')}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
          />
          {query.trim().length > 0 && (
            <button
              type="button"
              className="td-topbar-search-clear-btn"
              onClick={() => {
                onQuery('');
                searchInputRef.current?.focus();
              }}
              title={t('speedtest.clear_search')}
              aria-label={t('speedtest.clear_search')}
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>
        {hasSelection && selectionToolbar}
      </div>

      {/* Row 3: filters/sort/thumb — labeled groups so controls stay self-explanatory */}
      <div className="td-topbar-row td-topbar-row-tools">
        <div className="td-topbar-tools" role="toolbar" aria-label={t("speedtest.topbar_tools_aria")}>
          <div className="td-tools-left-cluster">
            {/* Perspective View Switcher */}
            {onViewPerspective && (
              <div className="td-tool-group td-group-perspective" role="group" aria-label={t("speedtest.perspective_telegram")}>
                <div className="td-perspective-switcher">
                  <button
                    type="button"
                    className={`td-perspective-btn ${viewPerspective === 'telegram' ? 'active' : ''}`}
                    onClick={() => onViewPerspective('telegram')}
                    title={t("speedtest.perspective_telegram")}
                  >
                    {t("speedtest.perspective_telegram_short")}
                  </button>
                  <button
                    type="button"
                    className={`td-perspective-btn ${viewPerspective === 'drive' ? 'active' : ''}`}
                    onClick={() => onViewPerspective('drive')}
                    title={t("speedtest.perspective_drive")}
                  >
                    {t("speedtest.perspective_drive_short")}
                  </button>
                </div>
              </div>
            )}

            <div className="td-tool-group td-group-filters" role="group" aria-labelledby="td-label-filter">
              <span id="td-label-filter" className="td-tool-label" title={t("speedtest.topbar_filter_media_type")}>
                {t("speedtest.topbar_label_filter")}
              </span>
              <div className="td-filter-pills">
                {(
                  viewPerspective === 'telegram'
                    ? [
                        ['all', t("speedtest.filter_all"), t("speedtest.filter_all_tip")],
                        ['media', t("speedtest.tab_telegram_media"), t("speedtest.tab_telegram_media")],
                        ['files', t("speedtest.tab_telegram_files"), t("speedtest.tab_telegram_files")],
                        ['links', t("speedtest.tab_telegram_links"), t("speedtest.tab_telegram_links")],
                        ['gifs', t("speedtest.tab_telegram_gifs"), t("speedtest.tab_telegram_gifs")],
                        ['audio', t("speedtest.tab_telegram_audio"), t("speedtest.tab_telegram_audio")],
                      ]
                    : [
                        ['all', t("speedtest.filter_all"), t("speedtest.filter_all_tip")],
                        ['images', t("speedtest.tab_drive_images"), t("speedtest.tab_drive_images")],
                        ['videos', t("speedtest.tab_drive_videos"), t("speedtest.tab_drive_videos")],
                        ['audio', t("speedtest.tab_drive_audio"), t("speedtest.tab_drive_audio")],
                        ['documents', t("speedtest.tab_drive_documents"), t("speedtest.tab_drive_documents")],
                        ['archives', t("speedtest.tab_drive_archives"), t("speedtest.tab_drive_archives")],
                      ]
                ).map(([id, label, tip]) => (
                  <button
                    key={id}
                    type="button"
                    className={`td-pill ${mediaFilter === id ? 'active' : ''}`}
                    onClick={() => onMediaFilter(id as DriveMediaFilter)}
                    title={tip}
                    aria-label={`${t("speedtest.topbar_label_filter")}: ${tip}`}
                    aria-pressed={mediaFilter === id}
                  >
                    <span className="td-pill-label">{label}</span>
                    {categoryCounts && categoryCounts[id] != null && (
                      <span className="td-filter-count" aria-hidden>
                        {categoryCounts[id].toLocaleString()}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="td-tools-right-cluster">
            <div className="td-tool-group td-group-sort" title={t("speedtest.topbar_sort_order")}>
              <span className="td-tool-label" id="td-label-sort" title={t("speedtest.topbar_sort_order")}>
                {t("speedtest.topbar_label_sort")}
              </span>
              <div className="td-sort-group">
                <ArrowUpDown size={14} className="td-sort-ico" aria-hidden />
                <MediaSelect
                  value={sortMode}
                  onChange={(value) => onSortMode(value as DriveSortMode)}
                  ariaLabel={t("speedtest.topbar_sort_media_aria")}
                  compact
                  className="td-sort"
                  options={DRIVE_SORT_OPTIONS.map((opt: any) => ({
                    value: opt.id,
                    label: String(t(`speedtest.sort_${opt.id}_label`, opt.label)),
                    description: String(t(`speedtest.sort_${opt.id}_desc`, opt.description)),
                  }))}
                />
                {indexingAllActive ? (
                  <div
                    className={`td-sort-scope-chip is-loading ${indexingProgress?.isPaused ? 'is-paused' : ''}`}
                    title={
                      indexingProgress?.isPaused
                        ? t('speedtest.index_progress_paused')
                        : indexingProgress?.eta
                        ? `${t('speedtest.index_progress_eta', { eta: indexingProgress.eta })} • ${indexingProgress.speed ? t('speedtest.index_progress_speed', { speed: indexingProgress.speed.toLocaleString() }) : ''} • ${t('speedtest.index_progress_safe_hint')}`
                        : t('speedtest.index_progress_safe_hint')
                    }
                    role="status"
                    aria-live="polite"
                  >
                    <div
                      className="td-sort-scope-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            indexingProgress?.total && indexingProgress.total > 0
                              ? ((indexingProgress.processed || fileCount) / indexingProgress.total) * 100
                              : indexingProgress?.processed && indexingProgress.processed > 0
                              ? 35
                              : 8
                          )
                        )}%`,
                      }}
                    />

                    <div className="td-sort-scope-content">
                      {indexingProgress?.isPaused ? (
                        <Pause size={11} className="td-sort-scope-status-icon is-paused" />
                      ) : (
                        <RefreshCw size={11} className="td-spin td-sort-scope-status-icon" />
                      )}
                      <span className="td-sort-scope-text">
                        {indexingProgress?.total && indexingProgress.total > 0
                          ? t('speedtest.index_all_progress', {
                              processed: (indexingProgress.processed || fileCount).toLocaleString(),
                              total: indexingProgress.total.toLocaleString(),
                              percent: Math.min(
                                100,
                                Math.round(
                                  ((indexingProgress.processed || fileCount) / indexingProgress.total) * 100
                                )
                              ),
                            })
                          : t('speedtest.index_all_progress_count', {
                              processed: (indexingProgress?.processed || fileCount).toLocaleString(),
                            })}
                      </span>
                      {indexingProgress?.speed && indexingProgress.speed > 0 && !indexingProgress.isPaused && (
                        <span className="td-sort-scope-speed">
                          ⚡{indexingProgress.speed >= 1000 ? `${(indexingProgress.speed / 1000).toFixed(1)}k` : indexingProgress.speed}/s
                        </span>
                      )}
                    </div>

                    <div className="td-sort-scope-actions">
                      {onTogglePauseIndex && (
                        <button
                          type="button"
                          className="td-sort-scope-btn td-sort-scope-pause-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePauseIndex();
                          }}
                          title={indexingProgress?.isPaused ? t('speedtest.index_btn_resume') : t('speedtest.index_btn_pause')}
                          aria-label={indexingProgress?.isPaused ? t('speedtest.index_btn_resume') : t('speedtest.index_btn_pause')}
                        >
                          {indexingProgress?.isPaused ? <Play size={10} /> : <Pause size={10} />}
                        </button>
                      )}
                      {onStopIndex && (
                        <button
                          type="button"
                          className="td-sort-scope-btn td-sort-scope-stop-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onStopIndex();
                          }}
                          title={t('speedtest.index_all_stop')}
                          aria-label={t('speedtest.index_all_stop')}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                ) : !indexComplete && onIndexAll ? (
                  <button
                    type="button"
                    className="td-sort-scope-chip is-partial"
                    onClick={onIndexAll}
                    title={t('speedtest.index_scope_partial_hint')}
                  >
                    <Sparkles size={11} className="td-sort-scope-icon" />
                    <span className="td-sort-scope-text">
                      {totalCount != null && totalCount > fileCount
                        ? t('speedtest.sort_partial_badge', {
                            loaded: fileCount.toLocaleString(),
                            total: totalCount.toLocaleString(),
                          })
                        : t('speedtest.sort_partial_badge_single', {
                            count: fileCount.toLocaleString(),
                          })}
                    </span>
                    <span className="td-sort-scope-btn-label">
                      {t('speedtest.index_all_action')}
                    </span>
                  </button>
                ) : fileCount > 0 && indexComplete ? (
                  <button
                    type="button"
                    className="td-sort-scope-chip is-complete cursor-pointer"
                    onClick={onIndexAll}
                    title={t('speedtest.index_scope_complete_hint', { count: fileCount.toLocaleString() })}
                  >
                    <Sparkles size={11} className="td-sort-scope-icon" />
                    <span>{t('speedtest.sort_complete_badge', { count: fileCount.toLocaleString() })}</span>
                    <span className="td-sort-scope-btn-label">
                      {t('speedtest.index_all_action')}
                    </span>
                  </button>
                ) : onIndexAll ? (
                  <button
                    type="button"
                    className="td-sort-scope-chip is-partial"
                    onClick={onIndexAll}
                    title={t('speedtest.index_all_action')}
                  >
                    <Sparkles size={11} className="td-sort-scope-icon" />
                    <span className="td-sort-scope-btn-label">
                      {t('speedtest.index_all_action')}
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            <div
              className="td-tool-group td-thumb-quality td-group-thumb"
              role="group"
              aria-labelledby="td-label-thumb"
              title={t("speedtest.topbar_thumb_quality")}
            >
              <span id="td-label-thumb" className="td-tool-label" title={t("speedtest.topbar_preview_quality")}>
                {t("speedtest.topbar_label_thumb")}
              </span>
              <div className="td-thumb-quality-pills">
                {DRIVE_THUMB_QUALITY_OPTIONS.map((opt: any) => {
                  const label = String(t(`speedtest.thumb_${opt.id}_label`, opt.label));
                  const short = String(t(`speedtest.thumb_${opt.id}_short`, opt.short));
                  const description = String(t(`speedtest.thumb_${opt.id}_desc`, opt.description));
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`td-pill td-thumb-pill ${thumbQuality === opt.id ? 'active' : ''}`}
                      onClick={() => onThumbQuality(opt.id)}
                      title={`${t('speedtest.thumb_prefix')}: ${description}`}
                      aria-label={`${t('speedtest.thumb_prefix')}: ${label}`}
                      aria-pressed={thumbQuality === opt.id}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Collapse / Expand Handle at the bottom boundary between Header Tools & Media Grid */}
      <div className="td-topbar-collapse-handle">
        <button
          type="button"
          className={`td-topbar-toggle-btn ${isToolsCollapsed ? 'is-collapsed' : ''}`}
          onClick={handleToggleCollapse}
          title={isToolsCollapsed ? t('speedtest.expand_toolbar') : t('speedtest.collapse_toolbar')}
          aria-label={isToolsCollapsed ? t('speedtest.expand_toolbar') : t('speedtest.collapse_toolbar')}
        >
          {isToolsCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {topicContextMenu &&
        createPortal(
          <div
            className="context-menu-overlay"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 99999,
              background: 'transparent',
            }}
            onClick={() => setTopicContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTopicContextMenu(null);
            }}
          >
            <div
              className="drive-context-menu"
              style={{
                position: 'fixed',
                top: topicContextMenu.y,
                left: topicContextMenu.x,
                zIndex: 100000,
                background: 'var(--td-bg-card, #1e293b)',
                border: '1px solid var(--td-border, #334155)',
                borderRadius: '8px',
                padding: '4px',
                minWidth: '160px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.5)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const { topicId } = topicContextMenu;
                  setTopicContextMenu(null);
                  const parentSegments = (breadcrumbSegs || [])
                    .filter((s) => s.kind !== 'topic')
                    .map((s) => (s.id != null ? String(s.id) : null))
                    .filter((s): s is string => Boolean(s));
                  const topicPath =
                    parentSegments.length > 0
                      ? '/' + [...parentSegments, String(topicId)].join('/')
                      : `/${topicId}`;

                  void copyTextWithFallback(topicPath).then((ok: any) => {
                    if (ok) {
                      onCopyTopicId?.(topicId, topicPath);
                    }
                  });
                }}
              >
                <Copy size={14} />
                <span>{t('speedtest.copy_topic_id')}</span>
              </button>
              {onRenameTopic && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const { topicId, title } = topicContextMenu;
                    setTopicContextMenu(null);
                    onRenameTopic(topicId, title);
                  }}
                >
                  <Edit2 size={14} />
                  <span>{t('ui.generated.ubah_nama_8657409')}</span>
                </button>
              )}
              {onDeleteTopic && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    const { topicId, title } = topicContextMenu;
                    setTopicContextMenu(null);
                    onDeleteTopic(topicId, title);
                  }}
                >
                  <Trash2 size={14} />
                  <span>{t('speedtest.delete_topic')}</span>
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
