/**
 * Power tools panel: duplicates, space usage, bulk rename, smart copy, advanced filters.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Trash2,
  Check,
  AlertTriangle,
  Loader2,
  Play,
  SlidersHorizontal,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Search,
  Layers,
  HardDrive,
} from 'lucide-react';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import type { DriveChat, DriveFile, DriveFolder, DriveTransferSettings } from '../../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  clampConcurrency,
  canShowDriveThumb,
  driveFileDisplayName,
  formatDriveBytes,
  isVideoDriveFile,
} from '../../../lib/telegram/driveTypes';
import { getCachedThumb, requestThumb } from '../../../lib/media/thumbBatcher';
import {
  applyBulkRenamePattern,
  computeSpaceUsage,
  findDuplicateGroups,
  type DriveAdvFilter,
  type DupGroup,
  EMPTY_ADV_FILTER,
  isAdvFilterActive,
} from '../../../lib/telegram';
import { FileTypeIcon } from '../Explorer/FileTypeIcon';
import { TOOL_GROUPS, type DriveToolsTab } from './toolsUtils';
import { TransferSettingsWorkspace } from '../Transfers/TransferSettingsWorkspace';
import {
  buildSearchRegistry,
  searchSettingsRegistry,
  type SearchableSettingItem,
} from '../Transfers/transferSettingsSearchRegistry';
export type { DriveToolsTab };

/** Prefer keep one file per group (newest or oldest by message id). Rest → delete set. */
function smartDeleteIds(groups: DupGroup[], keepNewest: boolean): Set<number> {
  const out = new Set<number>();
  for (const g of groups) {
    if (g.files.length < 2) continue;
    const ordered = [...g.files].sort((a, b) =>
      keepNewest ? (b.id || 0) - (a.id || 0) : (a.id || 0) - (b.id || 0)
    );
    // Keep first; mark the rest for deletion
    for (let i = 1; i < ordered.length; i++) out.add(ordered[i].id);
  }
  return out;
}

function preferredKeepId(g: DupGroup, keepNewest: boolean): number | null {
  if (!g.files.length) return null;
  const ordered = [...g.files].sort((a, b) =>
    keepNewest ? (b.id || 0) - (a.id || 0) : (a.id || 0) - (b.id || 0)
  );
  return ordered[0]?.id ?? null;
}

function ToolTabIntro({
  tab,
  locationLabel,
  fileCount,
  selectedCount,
}: {
  tab: DriveToolsTab;
  locationLabel: string;
  fileCount: number;
  selectedCount: number;
}) {
  const { t } = useTranslation();
  const item = TOOL_GROUPS.flatMap((group) => group.tabs).find((candidate) => candidate.id === tab);
  const Icon = item?.icon || SlidersHorizontal;
  const key = tab === 'transfer' ? 'settings' : tab;
  return (
    <section className="td-tools-tab-intro">
      <div className="td-tools-tab-intro-icon"><Icon size={20} /></div>
      <div className="td-tools-tab-intro-copy">
        <h3>{t(`speedtest.tools_tab_${key}`)}</h3>
        <p>{t(`speedtest.tools_tab_${key}_desc`)}</p>
      </div>
      <div className="td-tools-tab-intro-meta">
        <span title={locationLabel}>{locationLabel}</span>
        <span>{t('speedtest.tools_file_count', { count: fileCount })}</span>
        {selectedCount > 0 && <span className="accent">{t('speedtest.tools_selected_count', { count: selectedCount })}</span>}
      </div>
    </section>
  );
}

type Props = {
  open: boolean;
  tab: DriveToolsTab;
  onTab: (t: DriveToolsTab) => void;
  onClose: () => void;
  files: DriveFile[];
  /** Currently selected files (for rename/copy scope) */
  selectedFiles: DriveFile[];
  advFilter: DriveAdvFilter;
  onAdvFilter: (f: DriveAdvFilter) => void;
  folders: DriveFolder[];
  chats: DriveChat[];
  locationKind: 'saved' | 'drive' | 'chat';
  locationLabel: string;
  busy?: boolean;
  /** For duplicate thumbnails (same peer as current location) */
  creds?: DriveCredentials | null;
  folderId?: number | null;
  /** Accurate location totals (media_stats) — not just loaded page */
  locationTotalCount?: number | null;
  locationTotalBytes?: number | null;
  locationStatsLoading?: boolean;
  locationStatsAccurate?: boolean;
  /** Location-wide type breakdown from unique media_stats */
  locationByType?: { type: string; count: number; bytes: number }[] | null;
  filesHasMore?: boolean;
  topicFilter?: number | null;
  isForum?: boolean;
  /** Optional Transfer Settings */
  transferSettings?: DriveTransferSettings;
  onTransferSettingsChange?: (next: DriveTransferSettings) => void;
  transferActive?: boolean;
  /** Open full preview (e.g. from duplicate row click) */
  onPreviewFile?: (file: DriveFile) => void;
  onDeleteIds: (ids: number[]) => void;
  onBulkRename: (pairs: { id: number; newName: string }[]) => void;
  onLoadMoreFiles?: (opts?: { pageSize?: number }) => Promise<void>;
  onSmartCopy?: (opts: {
    messageIds: number[];
    toFolderId: number | null;
    targetLabel: string;
    skipDuplicates: boolean;
  }) => void;
};

export function DriveToolsPanel({
  open,
  tab,
  onTab,
  onClose,
  files,
  selectedFiles,
  advFilter,
  onAdvFilter,
  folders: _folders,
  chats: _chats,
  locationKind: _locationKind,
  locationLabel,
  busy,
  creds = null,
  folderId = null,
  locationTotalCount = null,
  locationTotalBytes = null,
  locationStatsLoading = false,
  locationStatsAccurate = false,
  locationByType = null,
  filesHasMore = false,
  onLoadMoreFiles,
  topicFilter = null,
  isForum = false,
  transferSettings,
  onTransferSettingsChange,
  transferActive,
  onPreviewFile,
  onDeleteIds,
  onBulkRename,
  onSmartCopy: _onSmartCopy,
}: Props) {
  const { t } = useTranslation();
  const [dupMode, setDupMode] = useState<
    'all_levels' | 'hash_unique' | 'name_size' | 'size_only' | 'message_clone'
  >('all_levels');
  const [pattern, setPattern] = useState('{name}_{n:2}.{ext}');
  const [startAt, setStartAt] = useState(1);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [toolsSearchQuery, setToolsSearchQuery] = useState('');

  const [xferSubTab, setXferSubTab] = useState<'upload' | 'download'>('upload');
  const [xferDraft, setXferDraft] = useState<DriveTransferSettings>(() => ({
    ...DEFAULT_TRANSFER_SETTINGS,
    ...(transferSettings || {}),
  }));

  useEffect(() => {
    if (open && transferSettings) {
      setXferDraft({
        ...DEFAULT_TRANSFER_SETTINGS,
        ...transferSettings,
      });
      setXferSubTab('upload');
    }
  }, [open, transferSettings]);

  const patchXfer = (partial: Partial<DriveTransferSettings>) => {
    setXferDraft((d: any) => ({ ...d, ...partial }));
  };

  const applyXferSettings = () => {
    if (!onTransferSettingsChange) return;
    const next: DriveTransferSettings = {
      ...xferDraft,
      uploadConcurrency: clampConcurrency(xferDraft.uploadConcurrency),
      downloadConcurrency: clampConcurrency(xferDraft.downloadConcurrency),
      globalCaption: (xferDraft.globalCaption || '').slice(0, 1024),
      albumGroupSize: Math.max(2, Math.min(10, xferDraft.albumGroupSize)),
      encoderMaxParallel: Math.max(1, Math.min(4, xferDraft.encoderMaxParallel)),
    };
    onTransferSettingsChange(next);
  };

  const groups = useMemo(
    () => findDuplicateGroups(files, dupMode as any),
    [files, dupMode]
  );
  const space = useMemo(() => computeSpaceUsage(files), [files]);
  // Prefer accurate location totals for header; by_type from stats when accurate
  const displayCount =
    locationStatsAccurate && locationTotalCount != null && locationTotalCount >= 0
      ? locationTotalCount
      : space.fileCount;
  const displayBytes =
    locationStatsAccurate && locationTotalBytes != null && locationTotalBytes >= 0
      ? locationTotalBytes
      : space.totalBytes;
  const scopeLabel =
    isForum && topicFilter != null
      ? t('speedtest.tools_scope_topic')
      : isForum
        ? t('speedtest.tools_scope_forum')
        : t('speedtest.tools_scope_location');
  const typeRows =
    locationStatsAccurate && locationByType && locationByType.length > 0
      ? locationByType
      : space.byType;
  const typeFromStats = !!(locationStatsAccurate && locationByType && locationByType.length);
  const incomplete =
    !locationStatsAccurate ||
    locationStatsLoading ||
    filesHasMore ||
    (locationTotalCount != null && space.fileCount < locationTotalCount);
  const renameScope = selectedFiles.length ? selectedFiles : files.slice(0, 50);
  const renamePreview = useMemo(
    () => applyBulkRenamePattern(renameScope, pattern, startAt).slice(0, 12),
    [renameScope, pattern, startAt]
  );

  const searchRegistry = useMemo(() => buildSearchRegistry(t), [t]);
  const searchResults = useMemo(
    () => searchSettingsRegistry(searchRegistry, toolsSearchQuery),
    [searchRegistry, toolsSearchQuery]
  );

  if (!open) return null;

  const wasteTotal = groups.reduce((s: any, g: any) => s + g.wasteBytes, 0);

  const handleSearchResultClick = (item: SearchableSettingItem) => {
    setToolsSearchQuery('');
    if (item.isDriveTool) {
      onTab(item.tab as DriveToolsTab);
    } else {
      if (tab !== 'transfer') {
        onTab('transfer');
      }
      window.setTimeout(() => {
        const el = document.getElementById(item.sectionId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('td-search-highlight');
          window.setTimeout(() => el.classList.remove('td-search-highlight'), 1800);
        }
      }, 100);
    }
  };

  const node = (
    <div
      className="td-tools-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('speedtest.tools_modal_title')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="td-tools-panel is-unified"
        data-dialog-layout="card"
        data-testid="drive-tools-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="td-tools-head">
          <div className="td-tools-title">
            <button
              type="button"
              className={`td-header-sidebar-toggle ${isSidebarCollapsed ? 'is-collapsed' : ''}`}
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              title={isSidebarCollapsed ? 'Klik untuk Perluas Sidebar Navigasi' : 'Klik untuk Ciutkan Sidebar Navigasi'}
              aria-label={isSidebarCollapsed ? 'Klik untuk Perluas Sidebar Navigasi' : 'Klik untuk Ciutkan Sidebar Navigasi'}
            >
              <div className="td-header-toggle-icon">
                <SlidersHorizontal size={18} />
                <span className="td-toggle-arrow-badge">
                  {isSidebarCollapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
                </span>
              </div>
              <div className="td-tools-title-text">
                <h2>{t('speedtest.tools_title')}</h2>
                <div className="td-tools-sub" title={locationLabel}>
                  <span className="td-tools-loc-dot"></span>
                  <span>{locationLabel}</span>
                </div>
              </div>
            </button>
          </div>
          <div className="td-tools-head-actions">
            {/* UNIVERSAL HEADER SEARCH INPUT */}
            <div className="td-header-search-box">
              <Search size={14} className="td-header-search-icon" />
              <input
                type="text"
                value={toolsSearchQuery}
                onChange={(e) => {
                  setToolsSearchQuery(e.target.value);
                }}
                placeholder={t('speedtest.search_placeholder_short', 'Cari pengaturan…')}
                className="td-header-search-input"
              />
              {toolsSearchQuery.trim() !== '' && (
                <button
                  type="button"
                  className="td-header-search-clear"
                  onClick={() => setToolsSearchQuery('')}
                  title="Bersihkan Pencarian"
                >
                  <X size={12} />
                </button>
              )}

              {/* FLOATING COMMAND PALETTE DROPDOWN ANCHORED RIGHT UNDER HEADER SEARCH INPUT */}
              {toolsSearchQuery.trim() !== '' && (
                <div className="td-search-popover-dropdown">
                  <div className="td-popover-head">
                    <span>Hasil Pencarian ({searchResults.length})</span>
                    <button
                      type="button"
                      className="td-popover-close-btn"
                      onClick={() => setToolsSearchQuery('')}
                      title="Tutup Hasil"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="td-popover-list">
                    {searchResults.length ? (
                      searchResults.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="td-search-result-row"
                          onClick={() => handleSearchResultClick(item)}
                        >
                          <span className="td-result-tab-badge">
                            {item.tab.toUpperCase()}
                          </span>
                          <div className="td-result-info">
                            <strong className="td-result-title">{item.label}</strong>
                            <span className="td-result-snippet">
                              {item.description || `Pengaturan ${item.label}`}
                            </span>
                          </div>
                          <ChevronRight size={14} className="td-result-arrow" />
                        </button>
                      ))
                    ) : (
                      <div className="td-popover-empty">
                        <Search size={18} style={{ color: '#64748b' }} />
                        <span>Tidak ada pengaturan yang cocok dengan "{toolsSearchQuery}"</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button type="button" className="td-icon-btn td-tools-close" onClick={onClose} aria-label={t("speedtest.close_esc")}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="td-tools-layout">
          <aside
            className={`td-tools-sidebar ${isSidebarCollapsed ? 'is-collapsed' : ''}`}
            aria-label={t("speedtest.categories_aria")}
          >
            {/* SIDEBAR NAV GROUPS & ITEMS */}
            {TOOL_GROUPS.map((group, groupIdx) => (
              <div key={group.titleKey} className="td-tools-sidebar-group">
                {groupIdx > 0 && <div className="td-tools-sidebar-divider" />}
                {!isSidebarCollapsed && <span className="td-tools-sidebar-header">{t(group.titleKey)}</span>}
                {group.tabs.map((tItem) => {
                  const Icon = tItem.icon;
                  const isActive = tab === tItem.id;
                  const tabLabel = tItem.labelDefault || t(`speedtest.tools_tab_${tItem.id === 'transfer' ? 'settings' : tItem.id}`);
                  return (
                    <button
                      key={tItem.id}
                      type="button"
                      className={`td-tools-sidebar-tab ${isActive ? 'active' : ''}`}
                      onClick={() => onTab(tItem.id)}
                      title={isSidebarCollapsed ? tabLabel : undefined}
                    >
                      <Icon size={18} />
                      {!isSidebarCollapsed && <span>{tabLabel}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

          <main className={`td-tools-main ${tab === 'transfer' ? 'is-transfer-tab' : ''}`}>
          {!['transfer', 'upload', 'download', 'encoding', 'album', 'duplicate', 'oversize', 'network', 'advanced'].includes(tab) && (
            <ToolTabIntro
              tab={tab}
              locationLabel={locationLabel}
              fileCount={displayCount}
              selectedCount={selectedFiles.length}
            />
          )}
          {tab === 'dups' && (
            <DupTab
              groups={groups}
              wasteTotal={wasteTotal}
              dupMode={dupMode}
              onDupMode={setDupMode}
              busy={busy}
              creds={creds}
              folderId={folderId}
              onPreviewFile={onPreviewFile}
              onDeleteIds={onDeleteIds}
              totalFileCount={locationTotalCount || files.length}
              filesHasMore={filesHasMore}
              onLoadMoreFiles={onLoadMoreFiles}
              loadedCount={files.length}
            />
          )}

          {tab === 'space' && (
            <div className="td-tools-section">
              <div className="td-tools-stats-hero">
                <div className="td-tools-stats-main">
                  <span className="td-tools-stats-count">{displayCount.toLocaleString('id-ID')}</span>
                  <span className="td-tools-stats-label">{t("speedtest.files_in_scope", { scope: scopeLabel })}</span>
                  <span className="td-tools-stats-bytes">({formatDriveBytes(displayBytes)})</span>
                </div>
                <div className="td-tools-stats-status">
                  {locationStatsAccurate ? (
                    <span className="td-tools-badge-ok">{t('speedtest.accurate_metadata')}</span>
                  ) : locationStatsLoading ? (
                    <span className="td-tools-badge-busy">{t('speedtest.tools_counting')}</span>
                  ) : (
                    <span className="td-tools-badge-est">{t('speedtest.approx_loaded')}</span>
                  )}
                </div>
              </div>

              <p className="td-tools-hint">
                {locationStatsAccurate ? (
                  <>{t("speedtest.accurate_total_hint", { scope: scopeLabel })}</>
                ) : locationStatsLoading ? (
                  <>{t('speedtest.walk_media_notice')}</>
                ) : (
                  <>{t('speedtest.walk_grid_notice')}</>
                )}
              </p>

              {space.fileCount > 0 && (
                <p className="td-tools-muted">
                  {t('speedtest.tools_grid_loaded', {
                    count: space.fileCount.toLocaleString(),
                    size: formatDriveBytes(space.totalBytes),
                    more: filesHasMore ? t('speedtest.tools_scroll_more') : '',
                  })}
                </p>
              )}

              <h4 className="td-tools-h">
                {typeFromStats ? t("speedtest.by_type_all_loc") : t("speedtest.by_type_grid_loaded")}
              </h4>
              <div className="td-tools-bars">
                {typeRows.length === 0 && (
                  <p className="td-tools-muted">
                    {locationStatsLoading
                      ? t('speedtest.tools_waiting_count')
                      : t('speedtest.tools_no_usage_data')}
                  </p>
                )}
                {typeRows.map((row: any) => {
                  const denom = displayBytes > 0 ? displayBytes : space.totalBytes;
                  const pct = denom > 0 ? Math.max(2, (row.bytes / denom) * 100) : 0;
                  return (
                    <div key={row.type} className="td-tools-bar-row">
                      <span className="td-tools-bar-label">
                        {row.type} ({row.count.toLocaleString('id-ID')}
                        {!typeFromStats && incomplete ? '+' : ''})
                      </span>
                      <div className="td-tools-bar-track">
                        <div
                          className="td-tools-bar-fill"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <span className="td-tools-bar-bytes">
                        {formatDriveBytes(row.bytes)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {space.largest.length > 0 && (
                <>
                  <h4 className="td-tools-h">{t('speedtest.top_largest_files')}</h4>
                  <ul className="td-tools-largest-list">
                    {space.largest.map((f: any) => (
                      <li key={f.id} className="td-tools-largest-item">
                        <FileTypeIcon file={f} size="sm" />
                        {onPreviewFile ? (
                          <button
                            type="button"
                            className="td-tools-linkrow"
                            onClick={() => onPreviewFile(f)}
                            title={t('speedtest.tools_preview_file', { name: f.name })}
                          >
                            <span className="td-tools-fname" title={f.name}>
                              {f.name}
                            </span>
                            <span className="td-tools-size-badge">{formatDriveBytes(f.size || 0)}</span>
                          </button>
                        ) : (
                          <div className="td-tools-linkrow static">
                            <span className="td-tools-fname" title={f.name}>
                              {f.name}
                            </span>
                            <span className="td-tools-size-badge">{formatDriveBytes(f.size || 0)}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {tab === 'rename' && (
            <div className="td-tools-section">
              <div className="td-tools-lead-box">
                <p className="td-tools-lead">
                  <strong>{selectedFiles.length ? t('speedtest.rename_scope_selected', { count: selectedFiles.length }) : t('speedtest.rename_scope_view', { count: 50 })}</strong>.
                </p>
                <div className="td-tools-tokens">
                  <span className="td-tools-token-label">{t('speedtest.token_label')}</span>
                  <code className="td-token-badge">{'{n}'}</code>
                  <code className="td-token-badge">{'{n:3}'}</code>
                  <code className="td-token-badge">{'{name}'}</code>
                  <code className="td-token-badge">{'{ext}'}</code>
                  <code className="td-token-badge">{'{full}'}</code>
                </div>
              </div>

              <div className="td-tools-rename-grid">
                <label className="td-tools-field td-flex-grow">
                  {t('speedtest.rename_pattern_label')}
                  <input
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    className="td-tools-input"
                    spellCheck={false}
                  />
                </label>
                <label className="td-tools-field td-w-sm">
                  {t('speedtest.start_from_label')}
                  <input
                    type="number"
                    min={0}
                    value={startAt}
                    onChange={(e) => setStartAt(Number(e.target.value) || 1)}
                    className="td-tools-input td-tools-input-sm"
                  />
                </label>
              </div>

              <h4 className="td-tools-h">{t('speedtest.rename_preview_title')}</h4>
              <div className="td-tools-preview-container">
                {renamePreview.length === 0 ? (
                  <p className="td-tools-empty">{t('speedtest.rename_no_change')}</p>
                ) : (
                  <ul className="td-tools-preview-list mono">
                    {renamePreview.map((r: any) => (
                      <li key={r.id} className="td-tools-preview-row">
                        <span className="td-tools-oldname" title={r.oldName}>{r.oldName}</span>
                        <span className="td-tools-arrow" aria-hidden>→</span>
                        <strong className="td-tools-newname" title={r.newName}>{r.newName}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="td-tools-action-footer">
                <button
                  type="button"
                  className="btn btn-primary td-tools-btn-submit"
                  disabled={busy || renamePreview.length === 0}
                  onClick={() =>
                    onBulkRename(
                      applyBulkRenamePattern(renameScope, pattern, startAt).map((r: any) => ({
                        id: r.id,
                        newName: r.newName,
                      }))
                    )
                  }
                >
                  <Check size={15} /> {t('speedtest.btn_apply_rename')}
                </button>
              </div>
            </div>
          )}

          {tab === 'filter' && (
            <div className="td-tools-section">
              <p className="td-tools-lead">
                {t('speedtest.adv_filter_desc')}
                {isAdvFilterActive(advFilter) && (
                  <span className="td-tools-active"> · {t("speedtest.filter_active_badge")}</span>
                )}
              </p>
              <div className="td-tools-grid2">
                <label className="td-tools-field">
                  {t('speedtest.filter_min_bytes')}
                  <input
                    type="number"
                    min={0}
                    className="td-tools-input"
                    value={advFilter.sizeMin ?? ''}
                    onChange={(e) =>
                      onAdvFilter({
                        ...advFilter,
                        sizeMin: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder="0"
                  />
                </label>
                <label className="td-tools-field">
                  {t('speedtest.filter_max_bytes')}
                  <input
                    type="number"
                    min={0}
                    className="td-tools-input"
                    value={advFilter.sizeMax ?? ''}
                    onChange={(e) =>
                      onAdvFilter({
                        ...advFilter,
                        sizeMax: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder="∞"
                  />
                </label>
                <label className="td-tools-field">
                  {t('speedtest.filter_from_date')}
                  <input
                    type="date"
                    className="td-tools-input td-tools-date"
                    value={advFilter.dateFrom ?? ''}
                    onChange={(e) =>
                      onAdvFilter({ ...advFilter, dateFrom: e.target.value || null })
                    }
                  />
                </label>
                <label className="td-tools-field">
                  {t('speedtest.filter_to_date')}
                  <input
                    type="date"
                    className="td-tools-input td-tools-date"
                    value={advFilter.dateTo ?? ''}
                    onChange={(e) =>
                      onAdvFilter({ ...advFilter, dateTo: e.target.value || null })
                    }
                  />
                </label>
                <label className="td-tools-field">
                  {t('speedtest.filter_extension')}
                  <input
                    className="td-tools-input"
                    value={advFilter.ext ?? ''}
                    onChange={(e) =>
                      onAdvFilter({
                        ...advFilter,
                        ext: e.target.value.replace(/^\./, '') || null,
                      })
                    }
                    placeholder={t('speedtest.filter_extension_ph')}
                    spellCheck={false}
                  />
                </label>
                <label className="td-tools-field">
                  {t('speedtest.filter_message_id')}
                  <input
                    type="number"
                    min={0}
                    className="td-tools-input"
                    value={advFilter.messageId ?? ''}
                    onChange={(e) =>
                      onAdvFilter({
                        ...advFilter,
                        messageId: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder={t("speedtest.msg_id_ph")}
                  />
                </label>
              </div>

              <div className="td-tools-card-hint">
                <p className="td-tools-hint-text">
                  {t("speedtest.adv_filter_shortcut_hint")}
                </p>
              </div>

              <div className="td-tools-action-footer flex-between">
                <button
                  type="button"
                  className="btn btn-ghost td-tools-btn-reset"
                  onClick={() => onAdvFilter({ ...EMPTY_ADV_FILTER })}
                >
                  <RotateCcw size={14} /> {t('speedtest.btn_reset_filter')}
                </button>
                <button type="button" className="btn btn-primary td-tools-btn-submit" onClick={onClose}>
                  <Check size={15} /> {t('speedtest.btn_apply_filter')}
                </button>
              </div>
            </div>
          )}

          {['transfer', 'upload', 'download', 'encoding', 'album', 'duplicate', 'oversize', 'network', 'advanced'].includes(tab) && (
            <TransferTabContent
              draft={xferDraft}
              onChange={patchXfer}
              onSave={applyXferSettings}
              onReset={() => setXferDraft({ ...DEFAULT_TRANSFER_SETTINGS })}
              transferActive={transferActive}
              subTab={xferSubTab}
              onSubTab={setXferSubTab}
              searchQuery={toolsSearchQuery}
              onSearchQueryChange={setToolsSearchQuery}
              onSelectTool={(toolId) => onTab(toolId as any)}
              activeCategory={
                tab === 'album'
                  ? 'albums'
                  : tab === 'duplicate'
                  ? 'duplicates'
                  : tab === 'oversize'
                  ? 'limits_recovery'
                  : tab === 'transfer'
                  ? 'upload'
                  : (tab as any)
              }
            />
          )}
          </main>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}

function TransferTabContent({
  draft,
  onChange,
  transferActive,
  searchQuery,
  onSearchQueryChange,
  onSelectTool,
  activeCategory,
}: {
  draft: DriveTransferSettings;
  onChange: (partial: Partial<DriveTransferSettings>) => void;
  onSave: () => void;
  onReset: () => void;
  transferActive?: boolean;
  subTab: 'upload' | 'download';
  onSubTab: (t: 'upload' | 'download') => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onSelectTool?: (toolTab: DriveToolsTab) => void;
  activeCategory?: any;
}) {
  return (
    <TransferSettingsWorkspace
      settings={draft}
      onChange={(next) => onChange(next)}
      transferActive={transferActive}
      embedded={true}
      searchQuery={searchQuery}
      onSearchQueryChange={onSearchQueryChange}
      onSelectTool={(tool) => onSelectTool?.(tool as DriveToolsTab)}
      activeCategory={activeCategory}
    />
  );
}

/** Compact thumbnail for duplicate list rows (reuses grid thumb cache/batcher). */
function DupFileThumb({
  file,
  creds,
  folderId,
}: {
  file: DriveFile;
  creds: DriveCredentials | null;
  folderId: number | null;
}) {
  const canThumb = canShowDriveThumb(file);
  const isVideo = isVideoDriveFile(file);
  const cached = canThumb ? getCachedThumb(folderId, file.id) : undefined;
  const [thumb, setThumb] = useState<string | null>(() =>
    cached === undefined ? null : cached
  );
  const [loading, setLoading] = useState(false);
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    setImgErr(false);
    if (!canThumb) {
      setThumb(null);
      setLoading(false);
      return;
    }
    const hit = getCachedThumb(folderId, file.id);
    if (hit !== undefined) {
      setThumb(hit);
      setLoading(false);
      return;
    }
    if (!creds) {
      setThumb(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setThumb(null);
    setLoading(true);
    requestThumb(creds, folderId, file.id, { priority: 'visible' })
      .then((url: any) => {
        if (!cancelled) {
          setThumb(url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThumb(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canThumb, creds, folderId, file.id]);

  useEffect(() => {
    if (!canThumb) return;
    const onReady = () => {
      const hit = getCachedThumb(folderId, file.id);
      if (hit) {
        setThumb(hit);
        setLoading(false);
        setImgErr(false);
      }
    };
    window.addEventListener('autogram-thumb-ready', onReady);
    return () => window.removeEventListener('autogram-thumb-ready', onReady);
  }, [canThumb, folderId, file.id]);

  return (
    <span className="td-tools-dup-thumb" aria-hidden>
      {thumb && !imgErr ? (
        <>
          <img src={thumb} alt="" loading="lazy" decoding="async" onError={() => setImgErr(true)} />
          {isVideo && (
            <span className="td-tools-dup-thumb-play">
              <Play size={10} fill="currentColor" />
            </span>
          )}
        </>
      ) : loading && canThumb ? (
        <Loader2 size={16} className="spin" />
      ) : (
        <FileTypeIcon file={file} size="sm" />
      )}
    </span>
  );
}

function DupTab({
  groups,
  wasteTotal,
  dupMode,
  onDupMode,
  busy,
  creds,
  folderId,
  onPreviewFile,
  onDeleteIds,
  totalFileCount,
  filesHasMore,
  onLoadMoreFiles,
  loadedCount = 0,
}: {
  groups: DupGroup[];
  wasteTotal: number;
  dupMode: 'all_levels' | 'hash_unique' | 'name_size' | 'size_only' | 'message_clone';
  onDupMode: (m: 'all_levels' | 'hash_unique' | 'name_size' | 'size_only' | 'message_clone') => void;
  busy?: boolean;
  creds: DriveCredentials | null;
  folderId: number | null;
  onPreviewFile?: (file: DriveFile) => void;
  onDeleteIds: (ids: number[]) => void;
  totalFileCount?: number;
  filesHasMore?: boolean;
  onLoadMoreFiles?: (opts?: { pageSize?: number }) => Promise<void>;
  loadedCount?: number;
}) {
  const { t } = useTranslation();
  const [keepNewest, setKeepNewest] = useState(true);
  const [markedDelete, setMarkedDelete] = useState<Set<number>>(() => new Set());
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video' | 'document' | 'audio'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // DEEP SCAN & FLOODWAIT STATE
  const [isScanning, setIsScanning] = useState(false);
  const [floodWaitSeconds, setFloodWaitSeconds] = useState<number | null>(null);
  const scanStopRef = useState({ stop: false })[0];

  const startDeepScan = async () => {
    if (!onLoadMoreFiles || !filesHasMore || isScanning) return;
    setIsScanning(true);
    scanStopRef.stop = false;
    setFloodWaitSeconds(null);

    let lastCount = -1;
    let sameCountStuck = 0;

    try {
      while (!scanStopRef.stop && filesHasMore) {
        try {
          // Request Turbo Page Size (250 items per page for 5x-10x faster scan!)
          await onLoadMoreFiles({ pageSize: 250 });
          setFloodWaitSeconds(null);
          // Wait briefly for React state batching to propagate loadedCount
          await new Promise((r) => setTimeout(r, 80));

          if (loadedCount === lastCount) {
            sameCountStuck++;
            if (sameCountStuck >= 5) {
              break;
            }
          } else {
            sameCountStuck = 0;
            lastCount = loadedCount;
          }
        } catch (err: any) {
          const errMsg = String(err?.message || err || '');
          const match = errMsg.match(/FLOOD_WAIT_?(\d+)/i) || errMsg.match(/wait\s*(\d+)\s*s/i);
          if (match) {
            const sec = parseInt(match[1], 10) || 10;
            // FLOODWAIT BADGE & COUNTDOWN
            for (let s = sec; s > 0; s--) {
              if (scanStopRef.stop) break;
              setFloodWaitSeconds(s);
              await new Promise((r) => setTimeout(r, 1000));
            }
            setFloodWaitSeconds(null);
          } else {
            // Brief pause on standard error before retrying next batch
            await new Promise((r) => setTimeout(r, 800));
          }
        }
      }
    } catch {
      /* ignore scan errors */
    } finally {
      setIsScanning(false);
      setFloodWaitSeconds(null);
    }
  };

  const stopDeepScan = () => {
    scanStopRef.stop = true;
    setIsScanning(false);
    setFloodWaitSeconds(null);
  };

  const smartKey = useMemo(() => {
    const parts = groups.map((g) => `${g.key}:${g.files.map((f: any) => f.id).join(',')}`);
    return `${dupMode}|${keepNewest ? 'n' : 'o'}|${parts.join(';')}`;
  }, [groups, dupMode, keepNewest]);

  useEffect(() => {
    setMarkedDelete(smartDeleteIds(groups, keepNewest));
  }, [smartKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // FILTERED GROUPS BY MEDIA TYPE & SEARCH QUERY
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      // 1. Media Type Filter
      if (filterType !== 'all') {
        const matchesType = g.files.some((f) => {
          const type = ((f as any).file_type || f.mime_type || '').toLowerCase();
          const name = f.name.toLowerCase();
          if (filterType === 'image') return type.includes('image') || /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
          if (filterType === 'video') return type.includes('video') || /\.(mp4|mkv|webm|avi|mov)$/i.test(name);
          if (filterType === 'audio') return type.includes('audio') || /\.(mp3|flac|wav|ogg|m4a)$/i.test(name);
          if (filterType === 'document') return type.includes('pdf') || type.includes('zip') || /\.(pdf|zip|rar|7z|doc|docx|txt)$/i.test(name);
          return true;
        });
        if (!matchesType) return false;
      }
      // 2. Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = g.files.some((f) => f.name.toLowerCase().includes(q) || (f.original_name || '').toLowerCase().includes(q));
        if (!matchesName) return false;
      }
      return true;
    });
  }, [groups, filterType, searchQuery]);

  const idsToDelete = useMemo(() => {
    const valid = new Set<number>();
    for (const g of groups) for (const f of g.files) valid.add(f.id);
    return [...markedDelete].filter((id) => valid.has(id));
  }, [markedDelete, groups]);

  const keepCount = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      for (const f of g.files) {
        if (!markedDelete.has(f.id)) n++;
      }
    }
    return n;
  }, [groups, markedDelete]);

  const selectedWaste = useMemo(() => {
    let bytes = 0;
    for (const g of groups) {
      for (const f of g.files) {
        if (markedDelete.has(f.id)) bytes += f.size || 0;
      }
    }
    return bytes;
  }, [groups, markedDelete]);

  const groupsWithAllMarked = useMemo(() => {
    return groups.filter(
      (g) => g.files.length > 0 && g.files.every((f: any) => markedDelete.has(f.id))
    ).length;
  }, [groups, markedDelete]);

  const toggleMark = (id: number) => {
    setMarkedDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markGroupExtras = (g: DupGroup) => {
    const keepId = preferredKeepId(g, keepNewest);
    setMarkedDelete((prev) => {
      const next = new Set(prev);
      for (const f of g.files) {
        if (f.id === keepId) next.delete(f.id);
        else next.add(f.id);
      }
      return next;
    });
  };

  const clearGroupMarks = (g: DupGroup) => {
    setMarkedDelete((prev) => {
      const next = new Set(prev);
      for (const f of g.files) next.delete(f.id);
      return next;
    });
  };

  const applySmartAll = () => setMarkedDelete(smartDeleteIds(groups, keepNewest));
  const clearAllMarks = () => setMarkedDelete(new Set());

  const targetTotal = totalFileCount || loadedCount;
  const scanProgressPct = targetTotal > 0 ? Math.min(100, Math.round((loadedCount / targetTotal) * 100)) : 0;

  return (
    <div className="td-tools-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* 🔍 FULL CHANNEL DEEP SCAN CARD */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12) 0%, rgba(15, 23, 42, 0.6) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '14px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Search size={16} style={{ color: '#38bdf8' }} />
              <span>Pemindaian Berkas Chat ({loadedCount.toLocaleString('id-ID')} / {targetTotal.toLocaleString('id-ID')} items)</span>
            </h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
              {filesHasMore
                ? `Baru ${loadedCount.toLocaleString('id-ID')} berkas ter-fetch di memori. Klik tombol di kanan untuk memindai seluruh ${targetTotal.toLocaleString('id-ID')} berkas secara otomatis!`
                : `✓ Seluruh ${loadedCount.toLocaleString('id-ID')} berkas di lokasi ini sudah selesai dipindai.`}
            </p>
          </div>

          {filesHasMore && (
            <div>
              {!isScanning ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startDeepScan()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)',
                  }}
                >
                  <Search size={14} />
                  <span>Pindai Seluruh Chat ({targetTotal.toLocaleString('id-ID')} Items)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopDeepScan}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    color: '#fca5a5',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  <Loader2 size={14} className="spin" />
                  <span>Hentikan Pemindaian ({scanProgressPct}%)</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* PROGRESS BAR */}
        {isScanning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600 }}>
              <span>Memindai index Telegram...</span>
              <span>{loadedCount.toLocaleString('id-ID')} / {targetTotal.toLocaleString('id-ID')} ({scanProgressPct}%)</span>
            </div>
            <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'rgba(15, 23, 42, 0.8)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${scanProgressPct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #38bdf8 0%, #0284c7 100%)',
                  borderRadius: '3px',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* ⚠️ FLOODWAIT BADGE INDICATOR */}
        {floodWaitSeconds !== null && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.4) 100%)',
              border: '1px solid #ef4444',
              borderRadius: '10px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#fca5a5',
              fontWeight: 700,
              fontSize: '0.82rem',
              boxShadow: '0 4px 14px rgba(239, 68, 68, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} style={{ color: '#ef4444' }} />
              <span>
                <strong>⚠️ Telegram FloodWait Detected:</strong> Pemindaian otomatis dijeda sementara &amp; akan dilanjutkan secara otomatis saat limit berakhir...
              </span>
            </div>
            <div style={{ background: '#ef4444', color: '#ffffff', padding: '3px 10px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.5px' }}>
              {floodWaitSeconds}s
            </div>
          </div>
        )}
      </div>

      {/* 📊 SUMMARY HERO STATS CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(56, 189, 248, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={18} style={{ color: '#38bdf8' }} />
          </div>
          <div>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', fontWeight: 600 }}>Grup Duplikat</span>
            <strong style={{ fontSize: '1.1rem', color: '#f8fafc', fontWeight: 800 }}>{filteredGroups.length}</strong>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={18} style={{ color: '#f87171' }} />
          </div>
          <div>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', fontWeight: 600 }}>Salinan Akan Dihapus</span>
            <strong style={{ fontSize: '1.1rem', color: '#f87171', fontWeight: 800 }}>{idsToDelete.length} Berkas</strong>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(74, 222, 128, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HardDrive size={18} style={{ color: '#4ade80' }} />
          </div>
          <div>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', fontWeight: 600 }}>Potensi Hemat Ruang</span>
            <strong style={{ fontSize: '1.1rem', color: '#4ade80', fontWeight: 800 }}>~{formatDriveBytes(selectedWaste || wasteTotal)}</strong>
          </div>
        </div>
      </div>

      {/* ⚙️ 4-LEVEL DETECTION MODE SELECTOR & PREFERENCE */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(15, 23, 42, 0.4)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>Modus Deteksi 4-Level (AutoGram Rule #5):</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {[
            { id: 'all_levels', label: '✨ Semua Level (1-4)' },
            { id: 'hash_unique', label: 'L1: Hash & Unique ID' },
            { id: 'name_size', label: 'L2: Nama + Ukuran' },
            { id: 'size_only', label: 'L3: Ukuran Byte Sama' },
            { id: 'message_clone', label: 'L4: Forward Clone' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onDupMode(m.id as any)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: dupMode === m.id ? 700 : 500,
                background: dupMode === m.id ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                border: dupMode === m.id ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                color: dupMode === m.id ? '#38bdf8' : '#cbd5e1',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
          <label className="td-tools-check-inline" title={t("speedtest.smart_pref_tooltip")}>
            <input
              type="checkbox"
              checked={keepNewest}
              onChange={(e) => setKeepNewest(e.target.checked)}
            />
            <span>{t('speedtest.default_keep_newest')}</span>
          </label>
        </div>
      </div>

      {/* 📁 MEDIA CATEGORY FILTER TABS & SEARCH INPUT */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { id: 'all', label: 'Semua' },
            { id: 'image', label: '📷 Foto' },
            { id: 'video', label: '🎥 Video' },
            { id: 'document', label: '📄 Dokumen' },
            { id: 'audio', label: '🎵 Audio' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterType(tab.id as any)}
              style={{
                padding: '5px 10px',
                borderRadius: '7px',
                fontSize: '0.75rem',
                fontWeight: filterType === tab.id ? 700 : 500,
                background: filterType === tab.id ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                border: 'none',
                color: filterType === tab.id ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: '200px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Cari file duplikat..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '5px 8px 5px 28px',
              borderRadius: '8px',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#f8fafc',
              fontSize: '0.78rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* DUP TOOLBAR ACTIONS */}
      {filteredGroups.length > 0 && (
        <div className="td-tools-dup-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={applySmartAll}
              title={t('speedtest.per_group_keep_one')}
            >
              <Check size={14} /> {t('speedtest.smart_selection_btn')}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={clearAllMarks}
              title={t('speedtest.keep_all_groups')}
            >
              {t('speedtest.keep_all_groups')}
            </button>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8', alignSelf: 'center', fontWeight: 600 }}>
              Dipertahankan: <strong style={{ color: '#4ade80' }}>{keepCount}</strong> berkas
            </span>
          </div>

          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || !idsToDelete.length}
            onClick={() => onDeleteIds(idsToDelete)}
            style={{
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              border: 'none',
              fontWeight: 700,
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.35)',
            }}
          >
            <Trash2 size={14} /> Hapus {idsToDelete.length} Berkas Duplikat Terpilih (~{formatDriveBytes(selectedWaste)})
          </button>
        </div>
      )}

      {groupsWithAllMarked > 0 && (
        <p className="td-tools-dup-warn" role="status">
          <AlertTriangle size={13} /> {t('speedtest.dup_all_marked_warning', { count: groupsWithAllMarked })}
        </p>
      )}

      {filteredGroups.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Tidak ada berkas duplikat yang terdeteksi pada filter saat ini.</p>
        </div>
      )}

      {/* DUP GROUPS LIST */}
      <ul className="td-tools-dup-groups">
        {filteredGroups.slice(0, 50).map((g) => {
          const keepId = preferredKeepId(g, keepNewest);
          const markedInGroup = g.files.filter((f: any) => markedDelete.has(f.id)).length;
          const keepInGroup = g.files.length - markedInGroup;
          return (
            <li key={g.key} className="td-tools-dup-group">
              <div className="td-tools-dup-head">
                <AlertTriangle size={12} />
                <span className="td-tools-dup-head-main">
                  {g.reasonLabel || g.reason}
                  {' · '}{t('speedtest.dup_group_counts', { files: g.files.length, keep: keepInGroup, delete: markedInGroup })}
                </span>
                <span className="td-tools-dup-head-actions">
                  <button
                    type="button"
                    className="td-tools-dup-mini"
                    disabled={busy}
                    onClick={() => markGroupExtras(g)}
                    title={t('speedtest.keep_one_check_rest')}
                  >
                    {t('speedtest.smart_selection_btn')}
                  </button>
                  <button
                    type="button"
                    className="td-tools-dup-mini"
                    disabled={busy}
                    onClick={() => clearGroupMarks(g)}
                    title={t('speedtest.keep_all_in_group')}
                  >
                    {t('speedtest.keep_all_in_group')}
                  </button>
                </span>
              </div>
              <ul className="td-tools-dup-files">
                {g.files.map((f: any) => {
                  const canPreview = Boolean(onPreviewFile);
                  const marked = markedDelete.has(f.id);
                  const isPreferredKeep = f.id === keepId;
                  const label = driveFileDisplayName(f);
                  return (
                    <li
                      key={f.id}
                      className={`td-tools-dup-file${marked ? ' is-marked-delete' : ' is-keep'}${
                        isPreferredKeep ? ' is-preferred-keep' : ''
                      }`}
                    >
                      <label className="td-tools-dup-check" title={t("speedtest.check_delete_tooltip")}>
                        <input
                          type="checkbox"
                          checked={marked}
                          disabled={busy}
                          onChange={() => toggleMark(f.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="td-tools-dup-check-ui" aria-hidden>
                          {marked ? <Check size={11} strokeWidth={3} /> : null}
                        </span>
                      </label>
                      <button
                        type="button"
                        className={`td-tools-dup-row${canPreview ? ' is-clickable' : ''}`}
                        onClick={() => onPreviewFile?.(f)}
                        disabled={!canPreview}
                        title={canPreview ? t('speedtest.tools_preview_file', { name: label }) : label}
                        aria-label={canPreview ? `Pratinjau ${label}` : label}
                      >
                        <DupFileThumb file={f} creds={creds} folderId={folderId} />
                        <div className="td-tools-dup-meta">
                          <span className="td-tools-fname" title={label}>
                            {label}
                          </span>
                          <span className="td-tools-dup-sub">
                            <span className="muted">#{f.id}</span>
                            <span>{formatDriveBytes(f.size || 0)}</span>
                            <span
                              className={`td-tools-dup-badge${marked ? ' is-del' : ' is-keep'}`}
                            >
                              {marked ? t('speedtest.badge_tag_delete') : isPreferredKeep ? t('speedtest.badge_tag_keep_default') : t('speedtest.badge_tag_keep')}
                            </span>
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
