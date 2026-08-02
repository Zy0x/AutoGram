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
  SlidersHorizontal,
  Pin,
  PinOff,
  Copy,
  Edit2,
  Globe,
  FolderArchive,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
  /** Open Drive power tools (dup/rename/copy/filter/space) */
  onOpenTools?: () => void;
  toolsActive?: boolean;
  /** Browser-style location history */
  canNavBack?: boolean;
  canNavForward?: boolean;
  onNavBack?: () => void;
  onNavForward?: () => void;
  /** Pin current location */
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
  /** Optional background calculation hint text */
  scaleHint?: string | null;
  /** Dual perspective mode: 'telegram' (Nekogram/Telegram style) vs 'drive' (MIME/file style) */
  viewPerspective?: 'telegram' | 'drive';
  onViewPerspective?: (perspective: 'telegram' | 'drive') => void;
  /** Total item count from Telegram query metadata */
  totalCount?: number | null;
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
  onOpenTransferSettings: _onOpenTransferSettings,
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
  onOpenTools,
  toolsActive,
  canNavBack: _canNavBack,
  canNavForward: _canNavForward,
  onNavBack: _onNavBack,
  onNavForward: _onNavForward,
  isPinned,
  onTogglePin,
  spaceLabel,
  statsLoading,
  statsAccurate,
  hasMore,
  scaleHint: _scaleHint,
  viewPerspective = 'telegram',
  onViewPerspective,
  totalCount,
}: Props) {
  const { t } = useTranslation();
  const isFinal = Boolean(statsAccurate || (!loading && hasMore === false));
  const effectiveTotalCount = useMemo(() => {
    if (hasMore === false && fileCount > 0) {
      return fileCount;
    }
    if (totalCount != null && totalCount > fileCount) {
      return totalCount;
    }
    return null;
  }, [hasMore, fileCount, totalCount]);
  const hasTopicSegment = breadcrumbSegs?.some((s) => s.kind === 'topic');
  const showTopics =
    !!isForum ||
    (topics && topics.length > 0) ||
    topicFilter != null ||
    !!topicsLoading ||
    !!hasTopicSegment;

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
    <div className="td-selection-strip is-beside-search" role="toolbar" aria-label="Aksi seleksi">
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
        <button
          type="button"
          className="td-chip-btn"
          onClick={onClearSelection}
          title={t("speedtest.topbar_deselect_all_tooltip")}
        >
          <SquareX size={15} strokeWidth={2} aria-hidden />
          <span className="td-chip-label">{t('speedtest.topbar_cancel', 'Batal')}</span>
        </button>
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
    <header className={`td-topbar${hasSelection ? ' has-selection' : ''}`}>
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
          {onTogglePin && (
            <button
              type="button"
              className={`td-icon-btn ${isPinned ? 'active' : ''}`}
              onClick={onTogglePin}
              title={isPinned ? t('speedtest.topbar_unpin_loc') : t('speedtest.topbar_pin_loc')}
              aria-label={isPinned ? t("speedtest.topbar_unpin_loc") : t("speedtest.topbar_pin_loc")}
            >
              {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
          )}
          <nav className="td-breadcrumbs" aria-label="Breadcrumb">
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
                              className={i === 0 ? 'td-crumb-muted' : 'td-crumb-current'}
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
                <span className="td-crumb-muted">Start</span>
                <span className="td-crumb-sep">/</span>
                <span className="td-crumb-current" title={folderName}>
                  {folderName}
                </span>
              </>
            )}
            {isForum && (
              <span className="td-forum-badge" title={t("speedtest.topbar_forum_group")}>
                <MessagesSquare size={12} />
                {t("speedtest.label_topic")}
              </span>
            )}
          </nav>
          <span
            className={`td-count-pill${statsLoading && !isFinal ? ' is-counting' : ''}${
              isFinal ? ' is-accurate is-final' : ''
            }`}
            title={
              statsLoading && !isFinal
                ? t('speedtest.count_pill_counting_title', {
                    count: fileCount,
                    space: spaceLabel ? ` · ${spaceLabel}` : '',
                    defaultValue: `Menghitung total media unik di lokasi… (${fileCount}${spaceLabel ? ` · ${spaceLabel}` : ''})`,
                  })
                : statsAccurate
                ? t('speedtest.count_pill_accurate_title', {
                    count: fileCount,
                    space: spaceLabel ? ` · ${spaceLabel}` : '',
                    defaultValue: `Total akurat (unik) di lokasi ini: ${fileCount} file${spaceLabel ? ` · ${spaceLabel}` : ''}`,
                  })
                : isFinal
                ? t('speedtest.count_pill_final_title', {
                    count: fileCount,
                    space: spaceLabel ? ` · ${spaceLabel}` : '',
                    defaultValue: `Total final (selesai dimuat): ${fileCount} media${spaceLabel ? ` · ${spaceLabel}` : ''}`,
                  })
                : spaceLabel
                ? t('speedtest.count_pill_estimate_title', {
                    count: fileCount,
                    space: spaceLabel,
                    defaultValue: `${fileCount} item · ${spaceLabel} (perkiraan / belum final)`,
                  })
                : t('speedtest.count_pill_simple_title', {
                    count: fileCount,
                    defaultValue: `${fileCount} item di lokasi ini`,
                  })
            }
          >
            {effectiveTotalCount && effectiveTotalCount > fileCount
              ? t('speedtest.items_loaded_total', {
                  loaded: fileCount.toLocaleString(),
                  total: effectiveTotalCount.toLocaleString(),
                  defaultValue: `${fileCount.toLocaleString()} / ${effectiveTotalCount.toLocaleString()} Item`,
                })
              : t('speedtest.items_total_simple', {
                  count: fileCount.toLocaleString(),
                  defaultValue: `${fileCount.toLocaleString()} Items`,
                })}
            {statsLoading && !isFinal ? (
              <span className="td-count-ellip" aria-hidden>
                …
              </span>
            ) : null}
            {spaceLabel ? <span className="td-count-space"> · {spaceLabel}</span> : null}
          </span>

          {onOpenTools && (
            <button
              type="button"
              className={`td-icon-btn ${toolsActive ? 'active' : ''}`}
              onClick={onOpenTools}
              title={t('speedtest.tools_panel_tooltip')}
              aria-label="Buka alat & pengaturan Drive"
            >
              <SlidersHorizontal size={16} />
            </button>
          )}
        </div>

        <div className="td-topbar-actions">

          <div className="td-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`td-icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => onViewMode('grid')}
              title="Grid"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className={`td-icon-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => onViewMode('list')}
              title="List"
            >
              <List size={16} />
            </button>
          </div>

          {viewMode === 'grid' && (
            <div className="td-zoom-controls" role="group" aria-label="Zoom grid">
              <button
                type="button"
                className="td-icon-btn"
                disabled={!canZoomOut}
                onClick={() => onGridZoom((gridZoom - 1) as DriveGridZoom)}
                title={t("speedtest.topbar_zoom_out")}
                aria-label="Zoom out"
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
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </div>
          )}

          <button
            type="button"
            className="td-icon-btn"
            onClick={onRefresh}
            disabled={loading}
            title={t("speedtest.topbar_refresh_all")}
            aria-label="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'spin' : undefined} />
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
                  ? `Transfer Manager — ${transferBadgeCount} file berjalan`
                  : transferBadgeKind === 'error'
                    ? `Transfer Manager — ${transferBadgeCount} gagal`
                    : transferBadgeKind === 'done'
                      ? `Transfer Manager — ${transferBadgeCount} selesai`
                      : t('speedtest.topbar_open_transfer_manager')
              }
              aria-label={
                transferBadgeCount > 0
                  ? `Transfer Manager, ${transferBadgeCount} item`
                  : 'Transfer Manager'
              }
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
              className="td-icon-btn text-[var(--primary,#e2a532)]"
              onClick={onDownloadAllClick}
              disabled={!!actionsDisabled}
              title={t("speedtest.topbar_download_zip")}
              aria-label={t("speedtest.topbar_download_zip")}
            >
              <FolderArchive size={16} />
            </button>
          )}
          {onRemoteUploadClick && (
            <button
              type="button"
              className="td-btn-secondary"
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
                ? 'Transfer masih berjalan — Stop dulu di Transfer Manager'
                : t('speedtest.upload_file_to_loc')
            }
            aria-label={
              actionsDisabled
                ? 'Unggah dinonaktifkan — transfer masih berjalan'
                : 'Unggah file ke lokasi ini'
            }
          >
            <Upload size={15} />
            <span className="td-btn-label">{t("speedtest.btn_upload")}</span>
          </button>
        </div>
      </div>

      {/* Forum topics — Semua media + per-topic filter */}
      {showTopics && (
        <div className="td-topbar-row td-topbar-row-topics" role="group" aria-label={t("speedtest.label_topic")}>
          <span className="td-topics-label">
            <MessagesSquare size={14} />
            {t('speedtest.label_topic', 'Topik')}
          </span>
          <div className="td-topic-pills">
            <button
              type="button"
              className={`td-topic-pill ${topicFilter == null ? 'active' : ''}`}
              onClick={() => onTopicFilter?.(null)}
              title={t('speedtest.show_group_media')}
            >
              {t('speedtest.all_media_pill', 'Semua media')}
            </button>
            {topicsLoading && topics.length === 0 && (
              <span className="td-topics-loading">{t("speedtest.loading_topics")}</span>
            )}
            {topics.map((tp) => (
              <button
                key={tp.id}
                type="button"
                data-topic-id={tp.id}
                className={`td-topic-pill ${topicFilter === tp.id ? 'active' : ''} ${tp.closed ? 'is-closed' : ''}`}
                onClick={() => onTopicFilter?.(tp.id)}
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
            ))}
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
        </div>
      )}

      {/*
        Row 2: search input AND selection tools side-by-side (strict 1-row height -> zero layout shift).
      */}
      <div
        className={`td-topbar-row td-topbar-row-2${hasSelection ? ' has-selection-tools' : ''}`}
      >
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          className="td-search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("speedtest.search_placeholder")}
          aria-label={t("speedtest.search_aria_label")}
          title={t('speedtest.filter_media_tooltip')}
        />
        {hasSelection && selectionToolbar}
      </div>

      {/* Row 3: filters/sort/thumb — labeled groups so controls stay self-explanatory */}
      <div className="td-topbar-row td-topbar-row-tools">
        <div className="td-topbar-tools" role="toolbar" aria-label={t("speedtest.topbar_tools_aria")}>
          {/* Perspective View Switcher */}
          {onViewPerspective && (
            <div className="td-tool-group" role="group" aria-label={t("speedtest.perspective_telegram")}>
              <div className="td-perspective-switcher">
                <button
                  type="button"
                  className={`td-perspective-btn ${viewPerspective === 'telegram' ? 'active' : ''}`}
                  onClick={() => onViewPerspective('telegram')}
                  title={t("speedtest.perspective_telegram")}
                >
                  {t("speedtest.perspective_telegram_short", "Telegram")}
                </button>
                <button
                  type="button"
                  className={`td-perspective-btn ${viewPerspective === 'drive' ? 'active' : ''}`}
                  onClick={() => onViewPerspective('drive')}
                  title={t("speedtest.perspective_drive")}
                >
                  {t("speedtest.perspective_drive_short", "Drive")}
                </button>
              </div>
            </div>
          )}

          <div className="td-tool-group" role="group" aria-labelledby="td-label-filter">
            <span id="td-label-filter" className="td-tool-label" title={t("speedtest.topbar_filter_media_type")}>
              {t("speedtest.topbar_label_filter", "Filter")}
            </span>
            <div className="td-filter-pills">
              {(
                viewPerspective === 'telegram'
                  ? [
                      ['all', t("speedtest.filter_all", "Semua"), t("speedtest.filter_all_tip", "Semua media")],
                      ['media', t("speedtest.tab_telegram_media", "Media"), t("speedtest.tab_telegram_media")],
                      ['files', t("speedtest.tab_telegram_files", "Berkas"), t("speedtest.tab_telegram_files")],
                      ['links', t("speedtest.tab_telegram_links", "Tautan"), t("speedtest.tab_telegram_links")],
                      ['gifs', t("speedtest.tab_telegram_gifs", "GIF"), t("speedtest.tab_telegram_gifs")],
                      ['audio', t("speedtest.tab_telegram_audio", "Audio"), t("speedtest.tab_telegram_audio")],
                    ]
                  : [
                      ['all', t("speedtest.filter_all", "Semua"), t("speedtest.filter_all_tip", "Semua media")],
                      ['images', t("speedtest.tab_drive_images", "Gambar"), t("speedtest.tab_drive_images")],
                      ['videos', t("speedtest.tab_drive_videos", "Video"), t("speedtest.tab_drive_videos")],
                      ['audio', t("speedtest.tab_drive_audio", "Audio"), t("speedtest.tab_drive_audio")],
                      ['documents', t("speedtest.tab_drive_documents", "Dokumen"), t("speedtest.tab_drive_documents")],
                      ['archives', t("speedtest.tab_drive_archives", "Arsip"), t("speedtest.tab_drive_archives")],
                    ]
              ).map(([id, label, tip]) => (
                <button
                  key={id}
                  type="button"
                  className={`td-pill ${mediaFilter === id ? 'active' : ''}`}
                  onClick={() => onMediaFilter(id as DriveMediaFilter)}
                  title={tip}
                  aria-label={`${t("speedtest.topbar_label_filter", "Filter")}: ${tip}`}
                  aria-pressed={mediaFilter === id}
                >
                  <span className="td-pill-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="td-tool-group" title={t("speedtest.topbar_sort_order")}>
            <span className="td-tool-label" id="td-label-sort" title={t("speedtest.topbar_sort_order")}>
              {t("speedtest.topbar_label_sort", "Urutkan")}
            </span>
            <div className="td-sort-group">
              <ArrowUpDown size={14} className="td-sort-ico" aria-hidden />
              <MediaSelect
                value={sortMode}
                onChange={(value) => onSortMode(value as DriveSortMode)}
                ariaLabel={t("speedtest.topbar_sort_media_aria", "Urutkan media")}
                compact
                className="td-sort"
                options={DRIVE_SORT_OPTIONS.map((opt: any) => ({
                  value: opt.id,
                  label: String(t(`speedtest.sort_${opt.id}_label`, opt.label)),
                  description: String(t(`speedtest.sort_${opt.id}_desc`, opt.description)),
                }))}
              />
            </div>
          </div>

          <div
            className="td-tool-group td-thumb-quality"
            role="group"
            aria-labelledby="td-label-thumb"
            title={t("speedtest.topbar_thumb_quality")}
          >
            <span id="td-label-thumb" className="td-tool-label" title={t("speedtest.topbar_preview_quality")}>
              {t("speedtest.topbar_label_thumb", "Thumb")}
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
                    title={`Thumb: ${description}`}
                    aria-label={`Thumb: ${label}`}
                    aria-pressed={thumbQuality === opt.id}
                  >
                    {short}
                  </button>
                );
              })}
            </div>
          </div>
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
                  <span>Ubah Nama</span>
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
      </div>
    </header>
  );
}
