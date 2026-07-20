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
  Settings2,
  ListChecks,
  SquareX,
  ArrowLeftRight,
  SendHorizontal,
  MousePointerClick,
  Wrench,
  ChevronLeft,
  ChevronRight,
  Pin,
  PinOff,
  Copy,
  Edit2,
  Globe,
  FolderArchive,
  Maximize,
  Minimize,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type {
  DriveGridZoom,
  DriveMediaFilter,
  DriveSortMode,
  DriveThumbQuality,
  DriveTopic,
  DriveTopicFilter,
  DriveViewMode,
} from '../../lib/driveTypes';
import { MediaSelect } from './MediaSelect';
import {
  DRIVE_GRID_ZOOM_LEVELS,
  DRIVE_SORT_OPTIONS,
  DRIVE_THUMB_QUALITY_OPTIONS,
  MAX_GRID_ZOOM,
  MIN_GRID_ZOOM,
} from '../../lib/driveTypes';

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
  zenMode?: boolean;
  onToggleZenMode?: () => void;
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
  zenMode,
  onToggleZenMode,
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
  topicsLoading,
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
}: Props) {
  // Always show filter bar for forum groups (at least "Semua media")
  const showTopics = !!isForum;

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

  /** Selection tools sit beside the search bar (search shrinks) — no extra topbar row. */
  const selectionToolbar = (
    <div className="td-selection-strip is-beside-search" role="toolbar" aria-label="Aksi seleksi">
      <div className="td-selection-strip-left">
        <span className="td-selection-count" title={`${selectedCount} file terpilih`}>
          <MousePointerClick size={14} strokeWidth={2} aria-hidden />
          <strong>{selectedCount}</strong>
          <span className="td-selection-count-label">dipilih</span>
        </span>
        {onSelectAll && (
          <button
            type="button"
            className="td-chip-btn"
            onClick={onSelectAll}
            title="Pilih semua yang terlihat (Ctrl+A)"
          >
            <ListChecks size={15} strokeWidth={2} aria-hidden />
            <span className="td-chip-label">Semua</span>
          </button>
        )}
        <button
          type="button"
          className="td-chip-btn"
          onClick={onClearSelection}
          title="Batalkan semua pilihan (Esc)"
        >
          <SquareX size={15} strokeWidth={2} aria-hidden />
          <span className="td-chip-label">Batal</span>
        </button>
        {onInvertSelection && (
          <button
            type="button"
            className="td-chip-btn"
            onClick={onInvertSelection}
            title="Balik seleksi (hanya item terlihat)"
          >
            <ArrowLeftRight size={15} strokeWidth={2} aria-hidden />
            <span className="td-chip-label">Balik</span>
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
            <span className="td-chip-label">Pindah</span>
          </button>
        )}
        <button
          type="button"
          className="td-chip-btn"
          onClick={onDownload}
          disabled={!!actionsDisabled}
          title={actionsDisabled ? 'Tunggu transfer selesai' : 'Unduh terpilih'}
        >
          <Download size={15} strokeWidth={2} aria-hidden />
          <span className="td-chip-label">Unduh</span>
        </button>
        <button
          type="button"
          className="td-chip-btn danger"
          onClick={onDelete}
          disabled={!!actionsDisabled}
          title={actionsDisabled ? 'Tunggu transfer selesai' : 'Hapus terpilih'}
        >
          <Trash2 size={15} strokeWidth={2} aria-hidden />
          <span className="td-chip-label">Hapus</span>
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
              title="Buka daftar lokasi / chat"
              aria-label="Buka sidebar lokasi"
            >
              <Menu size={18} />
            </button>
          )}
          {(onNavBack || onNavForward) && (
            <div className="td-nav-hist" role="group" aria-label="Riwayat lokasi">
              <button
                type="button"
                className="td-icon-btn"
                onClick={onNavBack}
                disabled={!canNavBack}
                title="Kembali (Alt+←)"
                aria-label="Lokasi sebelumnya"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="td-icon-btn"
                onClick={onNavForward}
                disabled={!canNavForward}
                title="Maju (Alt+→)"
                aria-label="Lokasi berikutnya"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          {onTogglePin && (
            <button
              type="button"
              className={`td-icon-btn ${isPinned ? 'active' : ''}`}
              onClick={onTogglePin}
              title={isPinned ? 'Lepas pin lokasi' : 'Pin lokasi ini'}
              aria-label={isPinned ? 'Lepas pin' : 'Pin lokasi'}
            >
              {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
          )}
          <nav className="td-breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbSegs && breadcrumbSegs.length > 0 ? (
              breadcrumbSegs.map((seg, i) => {
                const isLast = i === breadcrumbSegs.length - 1;
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
                  </span>
                );
              })
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
              <span className="td-forum-badge" title="Grup dengan topik (forum)">
                <MessagesSquare size={12} />
                Topik
              </span>
            )}
          </nav>
          <span
            className={`td-count-pill${statsLoading && !statsAccurate ? ' is-counting' : ''}${
              statsAccurate ? ' is-accurate' : ''
            }`}
            title={
              statsLoading && !statsAccurate
                ? `Menghitung total media unik di lokasi… (${fileCount}${spaceLabel ? ` · ${spaceLabel}` : ''})`
                : statsAccurate
                  ? `Total akurat (unik) di lokasi ini: ${fileCount} file${spaceLabel ? ` · ${spaceLabel}` : ''}`
                  : spaceLabel
                    ? `${fileCount} item · ${spaceLabel} (perkiraan / belum final)`
                    : `${fileCount} item di lokasi ini`
            }
          >
            {fileCount}
            {statsLoading && !statsAccurate ? (
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
              title="Alat Drive: salin batch, duplikat, rename, filter, storage (Ctrl+Shift+T)"
              aria-label="Buka alat Drive"
            >
              <Wrench size={16} />
            </button>
          )}
        </div>

        <div className="td-topbar-actions">
          {!hasSelection && onSelectAll && (
            <button
              type="button"
              className="td-chip-btn td-chip-quiet td-chip-select-all"
              onClick={onSelectAll}
              title="Pilih semua yang terlihat (Ctrl+A)"
              aria-label="Pilih semua yang terlihat (Ctrl+A)"
            >
              <ListChecks size={14} strokeWidth={2} aria-hidden />
              <span className="td-chip-label">Pilih semua</span>
            </button>
          )}

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
                title="Perkecil thumbnail (Ctrl + scroll turun)"
                aria-label="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className="td-zoom-label"
                onClick={() => onGridZoom(2 as DriveGridZoom)}
                title={`${zoomLevel.label} — klik untuk reset ke Sedang. Ctrl+scroll di grid juga mengatur zoom.`}
              >
                {zoomLevel.short}
              </button>
              <button
                type="button"
                className="td-icon-btn"
                disabled={!canZoomIn}
                onClick={() => onGridZoom((gridZoom + 1) as DriveGridZoom)}
                title="Perbesar thumbnail (Ctrl + scroll naik)"
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
            title="Muat ulang folder & chat"
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
                      : 'Buka Transfer Manager (progress unduh/unggah)'
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
          {onOpenTransferSettings && (
            <button
              type="button"
              className="td-icon-btn"
              onClick={onOpenTransferSettings}
              title="Pengaturan Upload & Download"
              aria-label="Pengaturan transfer"
            >
              <Settings2 size={16} />
            </button>
          )}
          {onToggleZenMode && (
            <button
              type="button"
              className="td-icon-btn text-slate-300"
              onClick={onToggleZenMode}
              title={zenMode ? "Keluar Zen Mode (ESC)" : "Zen Mode Layar Penuh (F11)"}
              aria-label="Toggle Zen Mode"
            >
              {zenMode ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          )}
          {onDownloadAllClick && (
            <button
              type="button"
              className="td-icon-btn text-[var(--primary,#e2a532)]"
              onClick={onDownloadAllClick}
              disabled={!!actionsDisabled}
              title="Download Semua (ZIP)"
              aria-label="Download semua file sebagai ZIP"
            >
              <FolderArchive size={16} />
            </button>
          )}
          {onRemoteUploadClick && (
            <button
              type="button"
              className="td-btn-primary bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/50"
              onClick={onRemoteUploadClick}
              disabled={!!actionsDisabled}
              title="Remote Upload (URL)"
              aria-label="Remote upload file dari URL"
            >
              <Globe size={15} />
              <span className="td-btn-label">Remote URL</span>
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
                : 'Unggah file ke lokasi ini'
            }
            aria-label={
              actionsDisabled
                ? 'Unggah dinonaktifkan — transfer masih berjalan'
                : 'Unggah file ke lokasi ini'
            }
          >
            <Upload size={15} />
            <span className="td-btn-label">Unggah</span>
          </button>
        </div>
      </div>

      {/* Forum topics — Semua media + per-topic filter */}
      {showTopics && (
        <div className="td-topbar-row td-topbar-row-topics" role="group" aria-label="Filter topik">
          <span className="td-topics-label">
            <MessagesSquare size={14} />
            Topik
          </span>
          <div className="td-topic-pills">
            <button
              type="button"
              className={`td-topic-pill ${topicFilter == null ? 'active' : ''}`}
              onClick={() => onTopicFilter?.(null)}
              title="Tampilkan semua media di grup (semua topik)"
            >
              Semua media
            </button>
            {topicsLoading && topics.length === 0 && (
              <span className="td-topics-loading">Memuat topik…</span>
            )}
            {topics.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`td-topic-pill ${topicFilter === t.id ? 'active' : ''} ${t.closed ? 'is-closed' : ''}`}
                onClick={() => onTopicFilter?.(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTopicContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    topicId: t.id,
                    title: t.title,
                  });
                }}
                title={t.closed ? `${t.title} (ditutup)` : t.title}
              >
                {t.title}
              </button>
            ))}
            {onAddTopic && (
              <button
                type="button"
                className="td-topic-pill td-topic-pill-add"
                onClick={onAddTopic}
                title="Tambah topik baru ke grup ini"
              >
                + Tambah Topik
              </button>
            )}
          </div>
        </div>
      )}

      {/*
        Row 2: search + selection tools on one row.
        With selection: tools take space on the right, search shrinks (no new row → no list jump).
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
          placeholder="Cari file di lokasi ini… (Ctrl+F)"
          aria-label="Cari file di lokasi saat ini. Pintasan Ctrl+F"
          title="Filter media di folder/chat yang dibuka. Ctrl+F fokusus. Lokasi: Ctrl+K di sidebar."
        />
        {hasSelection && selectionToolbar}
      </div>

      {/* Row 3: filters/sort/thumb — labeled groups so controls stay self-explanatory */}
      <div className="td-topbar-row td-topbar-row-tools">
        <div className="td-topbar-tools" role="toolbar" aria-label="Filter, urutan, dan thumbnail">
          <div className="td-tool-group" role="group" aria-labelledby="td-label-filter">
            <span id="td-label-filter" className="td-tool-label" title="Filter tipe media">
              Filter
            </span>
            <div className="td-filter-pills">
              {(
                [
                  ['all', 'Semua', 'Semua tipe media'],
                  ['image', 'Gambar', 'Hanya gambar'],
                  ['video', 'Video', 'Hanya video'],
                  ['document', 'Dokumen', 'Hanya dokumen'],
                  ['link', 'Link', 'Hanya link / URL'],
                ] as const
              ).map(([id, label, tip]) => (
                <button
                  key={id}
                  type="button"
                  className={`td-pill ${mediaFilter === id ? 'active' : ''}`}
                  onClick={() => onMediaFilter(id)}
                  title={tip}
                  aria-label={`Filter: ${tip}`}
                  aria-pressed={mediaFilter === id}
                >
                  <span className="td-pill-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="td-tool-group" title="Urutan tampilan media">
            <span className="td-tool-label" id="td-label-sort" title="Urutkan daftar media">
              Urutkan
            </span>
            <div className="td-sort-group">
              <ArrowUpDown size={14} className="td-sort-ico" aria-hidden />
              <MediaSelect
                value={sortMode}
                onChange={(value) => onSortMode(value as DriveSortMode)}
                ariaLabel="Urutkan media"
                compact
                className="td-sort"
                options={DRIVE_SORT_OPTIONS.map((opt) => ({
                  value: opt.id,
                  label: opt.label,
                  description: opt.description,
                }))}
              />
            </div>
          </div>

          <div
            className="td-tool-group td-thumb-quality"
            role="group"
            aria-labelledby="td-label-thumb"
            title="Kualitas thumbnail di grid"
          >
            <span id="td-label-thumb" className="td-tool-label" title="Kualitas gambar pratinjau">
              Thumb
            </span>
            <div className="td-thumb-quality-pills">
              {DRIVE_THUMB_QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`td-pill td-thumb-pill ${thumbQuality === opt.id ? 'active' : ''}`}
                  onClick={() => onThumbQuality(opt.id)}
                  title={`Thumb: ${opt.description}`}
                  aria-label={`Thumb: ${opt.label}`}
                  aria-pressed={thumbQuality === opt.id}
                >
                  {opt.short}
                </button>
              ))}
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
                  setTopicContextMenu(null);
                  void navigator.clipboard.writeText(String(topicContextMenu.topicId));
                }}
              >
                <Copy size={14} />
                <span>Salin ID Topik</span>
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
                  <span>Hapus Topik</span>
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
