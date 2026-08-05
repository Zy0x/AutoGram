/**
 * Power tools panel: duplicates, space usage, bulk rename, smart copy, advanced filters.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Copy,
  Trash2,
  Check,
  AlertTriangle,
  Loader2,
  Play,
  SlidersHorizontal,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import type { DriveChat, DriveFile, DriveFolder, DriveTransferSettings } from '../../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  clampConcurrency,
  canShowDriveThumb,
  driveFileDisplayName,
  formatDriveBytes,
  driveItemKind,
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
import { MediaSelect } from '../Navigation/MediaSelect';
import { TOOL_GROUPS, type DriveToolsTab } from './toolsUtils';
import { TransferSettingsWorkspace } from '../Transfers/TransferSettingsWorkspace';
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
  onSmartCopy: (opts: {
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
  folders,
  chats,
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
  topicFilter = null,
  isForum = false,
  transferSettings,
  onTransferSettingsChange,
  transferActive,
  onPreviewFile,
  onDeleteIds,
  onBulkRename,
  onSmartCopy,
}: Props) {
  const { t } = useTranslation();
  const [dupMode, setDupMode] = useState<'name_size' | 'both'>('name_size');
  const [pattern, setPattern] = useState('{name}_{n:2}.{ext}');
  const [startAt, setStartAt] = useState(1);
  const [copyDest, setCopyDest] = useState<string>('me');
  const [skipDup, setSkipDup] = useState(true);
  const [copyScope, setCopyScope] = useState<'selected' | 'all'>('selected');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
    () => findDuplicateGroups(files, dupMode),
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

  const destOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: 'me', label: t('speedtest.saved_messages') },
    ];
    for (const f of folders) {
      const kind = driveItemKind(f);
      opts.push({
        value: String(f.id),
        label: `${kind === 'drive' ? t('speedtest.zip_dest_drive') : t('speedtest.folder_label')}: ${f.name}`,
      });
    }
    for (const c of chats.slice(0, 80)) {
      opts.push({ value: `c:${c.id}`, label: `${t('speedtest.zip_dest_chat')}: ${c.name}` });
    }
    return opts;
  }, [folders, chats]);

  if (!open) return null;

  const wasteTotal = groups.reduce((s: any, g: any) => s + g.wasteBytes, 0);

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
            <div className="td-tools-icon-wrap" aria-hidden="true">
              <SlidersHorizontal size={20} />
            </div>
            <div className="td-tools-title-text">
              <h2>{t('speedtest.tools_title')}</h2>
              <div className="td-tools-sub" title={locationLabel}>
                <span className="td-tools-loc-dot"></span>
                <span>{locationLabel}</span>
              </div>
            </div>
          </div>
          <button type="button" className="td-icon-btn td-tools-close" onClick={onClose} aria-label={t("speedtest.close_esc")}>
            <X size={18} />
          </button>
        </header>

        <div className="td-tools-layout">
          <aside className={`td-tools-sidebar ${isSidebarCollapsed ? 'is-collapsed' : ''}`} aria-label={t("speedtest.categories_aria")}>
            <div className="td-sidebar-toggle-row">
              <button
                type="button"
                className="td-sidebar-collapse-btn"
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                title={isSidebarCollapsed ? 'Perluas Sidebar' : 'Ciutkan Sidebar'}
                aria-label={isSidebarCollapsed ? 'Perluas Sidebar' : 'Ciutkan Sidebar'}
              >
                {isSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                {!isSidebarCollapsed && <span>{t('speedtest.collapse_sidebar', 'Ciutkan')}</span>}
              </button>
            </div>

            {TOOL_GROUPS.map((group) => (
              <div key={group.titleKey} className="td-tools-sidebar-group">
                {!isSidebarCollapsed && <span className="td-tools-sidebar-header">{t(group.titleKey)}</span>}
                {group.tabs.map((tItem) => {
                  const Icon = tItem.icon;
                  const isActive = tab === tItem.id;
                  const tabLabel = t(`speedtest.tools_tab_${tItem.id === 'transfer' ? 'settings' : tItem.id}`);
                  return (
                    <button
                      key={tItem.id}
                      type="button"
                      className={`td-tools-sidebar-tab ${isActive ? 'active' : ''}`}
                      onClick={() => onTab(tItem.id)}
                      title={isSidebarCollapsed ? tabLabel : undefined}
                    >
                      <Icon size={16} />
                      {!isSidebarCollapsed && <span>{tabLabel}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

          <main className={`td-tools-main ${tab === 'transfer' ? 'is-transfer-tab' : ''}`}>
          {tab !== 'transfer' && (
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

          {tab === 'copy' && (
            <div className="td-tools-section">
              <p className="td-tools-lead">
                {t('speedtest.smart_copy_desc')}
              </p>
              <div className="td-tools-form-stack">
                <label className="td-tools-field">
                  {t('speedtest.tools_scope_label')}
                  <MediaSelect
                    value={copyScope}
                    onChange={(value: any) => setCopyScope(value as 'selected' | 'all')}
                    ariaLabel={t('speedtest.tools_copy_scope_aria')}
                    options={[
                      { value: 'selected', label: t('speedtest.selected_count', { count: selectedFiles.length || 0 }) },
                      { value: 'all', label: t('speedtest.all_in_view_count', { count: files.length }) },
                    ]}
                  />
                </label>
                <label className="td-tools-field">
                  {t('speedtest.tools_destination_label')}
                  <MediaSelect
                    value={copyDest}
                    onChange={setCopyDest}
                    ariaLabel={t('speedtest.tools_copy_destination_aria')}
                    options={destOptions.map((option) => ({ value: option.value, label: option.label }))}
                  />
                </label>
                <div className="td-tools-card-check">
                  <label className="td-tools-check">
                    <input
                      type="checkbox"
                      checked={skipDup}
                      onChange={(e) => setSkipDup(e.target.checked)}
                    />
                    <span>{t('speedtest.skip_dup_name_size')}</span>
                  </label>
                </div>
              </div>

              <div className="td-tools-action-footer">
                <button
                  type="button"
                  className="btn btn-primary td-tools-btn-submit"
                  disabled={
                    busy ||
                    (copyScope === 'selected' ? selectedFiles.length === 0 : files.length === 0)
                  }
                  onClick={() => {
                    const pool = copyScope === 'selected' ? selectedFiles : files;
                    const ids = pool.map((f: any) => f.id);
                    let toFolderId: number | null = null;
                    let targetLabel = t('speedtest.saved_messages');
                    if (copyDest === 'me') {
                      toFolderId = null;
                    } else if (copyDest.startsWith('c:')) {
                      toFolderId = Number(copyDest.slice(2));
                      targetLabel =
                        chats.find((c) => c.id === toFolderId)?.name || t('speedtest.tools_chat_fallback', { id: toFolderId });
                    } else {
                      toFolderId = Number(copyDest);
                      targetLabel =
                        folders.find((f: any) => f.id === toFolderId)?.name || t('speedtest.tools_folder_fallback', { id: toFolderId });
                    }
                    onSmartCopy({
                      messageIds: ids,
                      toFolderId,
                      targetLabel,
                      skipDuplicates: skipDup,
                    });
                  }}
                >
                  <Copy size={15} /> {t('speedtest.btn_start_copy')}
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

          {tab === 'transfer' && (
            <TransferTabContent
              draft={xferDraft}
              onChange={patchXfer}
              onSave={applyXferSettings}
              onReset={() => setXferDraft({ ...DEFAULT_TRANSFER_SETTINGS })}
              transferActive={transferActive}
              subTab={xferSubTab}
              onSubTab={setXferSubTab}
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
}: {
  draft: DriveTransferSettings;
  onChange: (partial: Partial<DriveTransferSettings>) => void;
  onSave: () => void;
  onReset: () => void;
  transferActive?: boolean;
  subTab: 'upload' | 'download';
  onSubTab: (t: 'upload' | 'download') => void;
}) {
  return (
    <TransferSettingsWorkspace
      settings={draft}
      onChange={(next) => onChange(next)}
      transferActive={transferActive}
      embedded={true}
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
}: {
  groups: DupGroup[];
  wasteTotal: number;
  dupMode: 'name_size' | 'both';
  onDupMode: (m: 'name_size' | 'both') => void;
  busy?: boolean;
  creds: DriveCredentials | null;
  folderId: number | null;
  onPreviewFile?: (file: DriveFile) => void;
  onDeleteIds: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  const [keepNewest, setKeepNewest] = useState(true);
  /** Message ids marked for deletion (checked = salinan yang akan dihapus). */
  const [markedDelete, setMarkedDelete] = useState<Set<number>>(() => new Set());
  /** Fingerprint of last smart-apply so we re-seed when groups/mode change. */
  const smartKey = useMemo(() => {
    const parts = groups.map((g) => `${g.key}:${g.files.map((f: any) => f.id).join(',')}`);
    return `${dupMode}|${keepNewest ? 'n' : 'o'}|${parts.join(';')}`;
  }, [groups, dupMode, keepNewest]);

  // Smart defaults: keep 1 per group (newest/oldest), mark the rest.
  // Re-applies when detection mode / keep preference / group membership changes.
  useEffect(() => {
    setMarkedDelete(smartDeleteIds(groups, keepNewest));
  }, [smartKey]); // eslint-disable-line react-hooks/exhaustive-deps -- smartKey encodes groups+keepNewest

  const idsToDelete = useMemo(() => {
    // Only delete ids that still exist in current groups (stale safety)
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
    // Approximate freed bytes = sum of sizes of marked files
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

  return (
    <div className="td-tools-section">
      <p className="td-tools-lead">
        {groups.length === 0 ? (
          t('speedtest.dup_none_detected')
        ) : (
          <>
          {t('speedtest.dup_lead_summary', { groups: groups.length, size: formatDriveBytes(wasteTotal) })}
          <br />
            <span className="td-tools-dup-lead-hint">
              {t('speedtest.dup_lead_hint')}
            </span>
          </>
        )}
      </p>
      <div className="td-tools-actions-bar">
        <div className="td-tools-segmented" role="radiogroup" aria-label={t("speedtest.dup_detection_mode")}>
          <button
            type="button"
            className={`td-segmented-item ${dupMode === 'name_size' ? 'active' : ''}`}
            onClick={() => onDupMode('name_size')}
          >
            {t('speedtest.dup_mode_name_size_label')}
          </button>
          <button
            type="button"
            className={`td-segmented-item ${dupMode === 'both' ? 'active' : ''}`}
            onClick={() => onDupMode('both')}
          >
            {t('speedtest.dup_mode_both_label')}
          </button>
        </div>
        <label className="td-tools-check-inline" title={t("speedtest.smart_pref_tooltip")}>
          <input
            type="checkbox"
            checked={keepNewest}
            onChange={(e) => setKeepNewest(e.target.checked)}
          />
          <span>{t('speedtest.default_keep_newest')}</span>
        </label>
      </div>

      {groups.length > 0 && (
        <div className="td-tools-dup-toolbar">
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
          <span className="td-tools-dup-summary">
            {t('speedtest.dup_stats_summary', { keep: keepCount, delete: idsToDelete.length })}
            {selectedWaste > 0 ? (
              <>
                {' '}
                · ~{formatDriveBytes(selectedWaste)}
              </>
            ) : null}
          </span>
        </div>
      )}

      {groupsWithAllMarked > 0 && (
        <p className="td-tools-dup-warn" role="status">
          <AlertTriangle size={13} /> {t('speedtest.dup_all_marked_warning', { count: groupsWithAllMarked })}
        </p>
      )}

      {groups.length > 0 && (
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || !idsToDelete.length}
          onClick={() => onDeleteIds(idsToDelete)}
        >
          <Trash2 size={14} /> {t('speedtest.delete_checked_btn', { count: idsToDelete.length })}
        </button>
      )}

      <ul className="td-tools-dup-groups">
        {groups.slice(0, 40).map((g) => {
          const keepId = preferredKeepId(g, keepNewest);
          const markedInGroup = g.files.filter((f: any) => markedDelete.has(f.id)).length;
          const keepInGroup = g.files.length - markedInGroup;
          return (
            <li key={g.key} className="td-tools-dup-group">
              <div className="td-tools-dup-head">
                <AlertTriangle size={12} />
                <span className="td-tools-dup-head-main">
                  {t(g.reason === 'name_size' ? 'speedtest.dup_reason_name_size' : 'speedtest.dup_reason_size_only')}
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
