/**
 * Power tools panel: duplicates, space usage, bulk rename, smart copy, advanced filters.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Copy,
  HardDrive,
  Layers,
  Type,
  Filter,
  Trash2,
  Check,
  AlertTriangle,
  Loader2,
  Play,
  Settings2,
  SlidersHorizontal,
  Upload,
  Download,
  RotateCcw,
} from 'lucide-react';
import type { DriveCredentials } from '../../lib/driveApi';
import type { DriveChat, DriveFile, DriveFolder, DriveTransferSettings, QualityMode } from '../../lib/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  QUALITY_MODE_OPTIONS,
  clampConcurrency,
  canShowDriveThumb,
  driveFileDisplayName,
  formatDriveBytes,
  driveItemKind,
  isVideoDriveFile,
} from '../../lib/driveTypes';
import { getCachedThumb, requestThumb } from '../../lib/thumbBatcher';
import {
  applyBulkRenamePattern,
  computeSpaceUsage,
  findDuplicateGroups,
  type DriveAdvFilter,
  type DupGroup,
  EMPTY_ADV_FILTER,
  isAdvFilterActive,
} from '../../lib/drivePower';
import { FileTypeIcon } from './FileTypeIcon';
import { MediaSelect } from './MediaSelect';

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

export type DriveToolsTab = 'dups' | 'space' | 'rename' | 'copy' | 'filter' | 'transfer';

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

export const TOOL_GROUPS: {
  title: string;
  tabs: { id: DriveToolsTab; label: string; icon: any }[];
}[] = [
  {
    title: 'ALAT DRIVE',
    tabs: [
      { id: 'copy', label: 'Salin batch', icon: Copy },
      { id: 'dups', label: 'Duplikat', icon: Layers },
      { id: 'rename', label: 'Bulk rename', icon: Type },
      { id: 'space', label: 'Storage', icon: HardDrive },
      { id: 'filter', label: 'Filter+', icon: Filter },
    ],
  },
  {
    title: 'KONFIGURASI',
    tabs: [
      { id: 'transfer', label: 'Pengaturan Transfer', icon: Settings2 },
    ],
  },
];

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
  const [dupMode, setDupMode] = useState<'name_size' | 'both'>('name_size');
  const [pattern, setPattern] = useState('{name}_{n:2}.{ext}');
  const [startAt, setStartAt] = useState(1);
  const [copyDest, setCopyDest] = useState<string>('me');
  const [skipDup, setSkipDup] = useState(true);
  const [copyScope, setCopyScope] = useState<'selected' | 'all'>('selected');

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
    setXferDraft((d) => ({ ...d, ...partial }));
  };

  const applyXferSettings = () => {
    if (!onTransferSettingsChange) return;
    const next: DriveTransferSettings = {
      ...xferDraft,
      uploadConcurrency: clampConcurrency(xferDraft.uploadConcurrency),
      downloadConcurrency: clampConcurrency(xferDraft.downloadConcurrency),
      globalCaption: (xferDraft.globalCaption || '').slice(0, 1024),
      qualityMode:
        xferDraft.forceDocumentDefault && xferDraft.qualityMode !== 'ORIGINAL'
          ? 'ORIGINAL'
          : xferDraft.qualityMode,
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
      ? 'topik ini'
      : isForum
        ? 'semua topik di grup'
        : 'lokasi ini';
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
      { value: 'me', label: 'Saved Messages' },
    ];
    for (const f of folders) {
      const kind = driveItemKind(f);
      opts.push({
        value: String(f.id),
        label: `${kind === 'drive' ? 'Drive' : 'Folder'}: ${f.name}`,
      });
    }
    for (const c of chats.slice(0, 80)) {
      opts.push({ value: `c:${c.id}`, label: `Chat: ${c.name}` });
    }
    return opts;
  }, [folders, chats]);

  if (!open) return null;

  const wasteTotal = groups.reduce((s, g) => s + g.wasteBytes, 0);

  const node = (
    <div
      className="td-tools-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Alat & Pengaturan Drive"
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
              <h2>Alat &amp; Pengaturan Drive</h2>
              <div className="td-tools-sub" title={locationLabel}>
                <span className="td-tools-loc-dot"></span>
                <span>{locationLabel}</span>
              </div>
            </div>
          </div>
          <button type="button" className="td-icon-btn td-tools-close" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </header>

        <div className="td-tools-layout">
          <aside className="td-tools-sidebar" aria-label="Kategori Alat dan Pengaturan">
            {TOOL_GROUPS.map((group) => (
              <div key={group.title} className="td-tools-sidebar-group">
                <span className="td-tools-sidebar-header">{group.title}</span>
                {group.tabs.map((t) => {
                  const Icon = t.icon;
                  const isActive = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`td-tools-sidebar-tab ${isActive ? 'active' : ''}`}
                      onClick={() => onTab(t.id)}
                    >
                      <Icon size={16} />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

          <main className="td-tools-main">
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
                  <span className="td-tools-stats-label">file di {scopeLabel}</span>
                  <span className="td-tools-stats-bytes">({formatDriveBytes(displayBytes)})</span>
                </div>
                <div className="td-tools-stats-status">
                  {locationStatsAccurate ? (
                    <span className="td-tools-badge-ok">Akurat (Metadata Telegram)</span>
                  ) : locationStatsLoading ? (
                    <span className="td-tools-badge-busy">Menghitung…</span>
                  ) : (
                    <span className="td-tools-badge-est">Perkiraan (Grid Loaded)</span>
                  )}
                </div>
              </div>

              <p className="td-tools-hint">
                {locationStatsAccurate ? (
                  <>Total unik seluruh {scopeLabel} (metadata Telegram, tanpa unduh file). Tidak double-count antar filter.</>
                ) : locationStatsLoading ? (
                  <>Walk media di latar — angka akan final saat selesai. Grid tetap bisa dipakai.</>
                ) : (
                  <>Dari halaman grid / lower-bound. Buka tab ini memicu hitung akurat otomatis.</>
                )}
              </p>

              {space.fileCount > 0 && (
                <p className="td-tools-muted">
                  Grid dimuat: {space.fileCount.toLocaleString('id-ID')} file ·{' '}
                  {formatDriveBytes(space.totalBytes)}
                  {filesHasMore ? ' (+ scroll untuk lebih banyak)' : ''}
                </p>
              )}

              <h4 className="td-tools-h">
                Per tipe {typeFromStats ? '(seluruh lokasi)' : '(yang dimuat di grid)'}
              </h4>
              <div className="td-tools-bars">
                {typeRows.length === 0 && (
                  <p className="td-tools-muted">
                    {locationStatsLoading
                      ? 'Menunggu hasil penghitungan…'
                      : 'Belum ada data. Tunggu hitung selesai atau muat grid.'}
                  </p>
                )}
                {typeRows.map((row) => {
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
                  <h4 className="td-tools-h">File Terbesar</h4>
                  <ul className="td-tools-largest-list">
                    {space.largest.map((f) => (
                      <li key={f.id} className="td-tools-largest-item">
                        <FileTypeIcon file={f} size="sm" />
                        {onPreviewFile ? (
                          <button
                            type="button"
                            className="td-tools-linkrow"
                            onClick={() => onPreviewFile(f)}
                            title={`Pratinjau: ${f.name}`}
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
                  Scope: <strong>{selectedFiles.length ? `${selectedFiles.length} terpilih` : `hingga 50 file di view`}</strong>.
                </p>
                <div className="td-tools-tokens">
                  <span className="td-tools-token-label">Token:</span>
                  <code className="td-token-badge">{'{n}'}</code>
                  <code className="td-token-badge">{'{n:3}'}</code>
                  <code className="td-token-badge">{'{name}'}</code>
                  <code className="td-token-badge">{'{ext}'}</code>
                  <code className="td-token-badge">{'{full}'}</code>
                </div>
              </div>

              <div className="td-tools-rename-grid">
                <label className="td-tools-field td-flex-grow">
                  Pola Rename
                  <input
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    className="td-tools-input"
                    spellCheck={false}
                  />
                </label>
                <label className="td-tools-field td-w-sm">
                  Mulai Dari
                  <input
                    type="number"
                    min={0}
                    value={startAt}
                    onChange={(e) => setStartAt(Number(e.target.value) || 1)}
                    className="td-tools-input td-tools-input-sm"
                  />
                </label>
              </div>

              <h4 className="td-tools-h">Pratinjau Hasil Rename</h4>
              <div className="td-tools-preview-container">
                {renamePreview.length === 0 ? (
                  <p className="td-tools-empty">Tidak ada perubahan / file kosong</p>
                ) : (
                  <ul className="td-tools-preview-list mono">
                    {renamePreview.map((r) => (
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
                      applyBulkRenamePattern(renameScope, pattern, startAt).map((r) => ({
                        id: r.id,
                        newName: r.newName,
                      }))
                    )
                  }
                >
                  <Check size={15} /> Terapkan Rename
                </button>
              </div>
            </div>
          )}

          {tab === 'copy' && (
            <div className="td-tools-section">
              <p className="td-tools-lead">
                Salin batch ke Drive/Chat (sumber tetap). Cocok untuk arsip chat → Drive.
              </p>
              <div className="td-tools-form-stack">
                <label className="td-tools-field">
                  Scope
                  <MediaSelect
                    value={copyScope}
                    onChange={(value) => setCopyScope(value as 'selected' | 'all')}
                    ariaLabel="Scope salin"
                    options={[
                      { value: 'selected', label: `Terpilih (${selectedFiles.length || 0})` },
                      { value: 'all', label: `Semua di view (${files.length})` },
                    ]}
                  />
                </label>
                <label className="td-tools-field">
                  Tujuan
                  <MediaSelect
                    value={copyDest}
                    onChange={setCopyDest}
                    ariaLabel="Tujuan salin"
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
                    <span>Skip duplikat (nama + ukuran di tujuan)</span>
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
                    const ids = pool.map((f) => f.id);
                    let toFolderId: number | null = null;
                    let targetLabel = 'Saved Messages';
                    if (copyDest === 'me') {
                      toFolderId = null;
                    } else if (copyDest.startsWith('c:')) {
                      toFolderId = Number(copyDest.slice(2));
                      targetLabel =
                        chats.find((c) => c.id === toFolderId)?.name || `Chat ${toFolderId}`;
                    } else {
                      toFolderId = Number(copyDest);
                      targetLabel =
                        folders.find((f) => f.id === toFolderId)?.name || `Folder ${toFolderId}`;
                    }
                    onSmartCopy({
                      messageIds: ids,
                      toFolderId,
                      targetLabel,
                      skipDuplicates: skipDup,
                    });
                  }}
                >
                  <Copy size={15} /> Mulai Salin Batch
                </button>
              </div>
            </div>
          )}

          {tab === 'filter' && (
            <div className="td-tools-section">
              <p className="td-tools-lead">
                Filter lanjutan di lokasi ini (di atas filter tipe media &amp; search).
                {isAdvFilterActive(advFilter) && (
                  <span className="td-tools-active"> · Aktif</span>
                )}
              </p>
              <div className="td-tools-grid2">
                <label className="td-tools-field">
                  Ukuran min (byte)
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
                  Ukuran max (byte)
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
                  Dari tanggal
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
                  Sampai tanggal
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
                  Ekstensi
                  <input
                    className="td-tools-input"
                    value={advFilter.ext ?? ''}
                    onChange={(e) =>
                      onAdvFilter({
                        ...advFilter,
                        ext: e.target.value.replace(/^\./, '') || null,
                      })
                    }
                    placeholder="pdf, mp4, …"
                    spellCheck={false}
                  />
                </label>
                <label className="td-tools-field">
                  Message ID
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
                    placeholder="Contoh: 42712"
                  />
                </label>
              </div>

              <div className="td-tools-card-hint">
                <p className="td-tools-hint-text">
                  ⚡ <strong>Shortcut:</strong> <kbd className="td-tools-kbd">1 MB</kbd> ≈ 1.048.576 · contoh min video besar: <kbd className="td-tools-kbd">5000000</kbd>
                </p>
              </div>

              <div className="td-tools-action-footer flex-between">
                <button
                  type="button"
                  className="btn btn-ghost td-tools-btn-reset"
                  onClick={() => onAdvFilter({ ...EMPTY_ADV_FILTER })}
                >
                  <RotateCcw size={14} /> Reset Filter
                </button>
                <button type="button" className="btn btn-primary td-tools-btn-submit" onClick={onClose}>
                  <Check size={15} /> Terapkan Filter
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
  onSave,
  onReset,
  transferActive,
  subTab,
  onSubTab,
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
    <div className="td-tools-xfer-container">
      <div className="td-xfer-settings-tabs" role="tablist" aria-label="Bagian pengaturan">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'upload'}
          className={`td-xfer-tab ${subTab === 'upload' ? 'active' : ''}`}
          onClick={() => onSubTab('upload')}
        >
          <Upload size={15} />
          Upload
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'download'}
          className={`td-xfer-tab ${subTab === 'download' ? 'active' : ''}`}
          onClick={() => onSubTab('download')}
        >
          <Download size={15} />
          Download
        </button>
      </div>

      <div className="td-xfer-settings-body">
        {subTab === 'upload' && (
          <section className="td-xfer-section" aria-label="Pengaturan upload">
            <h3>Kualitas unggah</h3>
            <p className="td-xfer-hint">
              Menentukan bagaimana file dikirim ke Telegram (media native vs dokumen).
            </p>
            <div className="td-xfer-radio-list" role="radiogroup" aria-label="Mode kualitas">
              {QUALITY_MODE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className={`td-xfer-radio ${draft.qualityMode === opt.id ? 'is-on' : ''}`}
                >
                  <input
                    type="radio"
                    name="qualityMode"
                    value={opt.id}
                    checked={draft.qualityMode === opt.id}
                    disabled={!!transferActive}
                    onChange={() => {
                      onChange({
                        qualityMode: opt.id as QualityMode,
                        forceDocumentDefault: opt.id === 'ORIGINAL',
                      });
                    }}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <small>{opt.description}</small>
                  </span>
                </label>
              ))}
            </div>

            <h3>Hardware Re-encode (GPU)</h3>
            <p className="td-xfer-hint">
              Akselerasi GPU untuk konversi video sebelum diunggah.
            </p>
            <label className="td-xfer-range-row">
              <MediaSelect
                value={draft.reencodeHardware}
                disabled={!!transferActive}
                onChange={(value) => onChange({ reencodeHardware: value as any })}
                ariaLabel="Hardware re-encode"
                options={[
                  { value: 'auto', label: 'Auto · Prioritas GPU', description: 'Pilih backend yang lolos capability test' },
                  { value: 'nvidia', label: 'NVIDIA NVENC', description: 'CUDA/NVDEC dengan fallback aman' },
                  { value: 'amd', label: 'AMD AMF', description: 'AMF hardware encoder' },
                  { value: 'intel', label: 'Intel Quick Sync', description: 'QSV hardware encoder' },
                  { value: 'cpu', label: 'CPU x264', description: 'Fallback kompatibilitas' },
                ]}
              />
            </label>

            <h3>Mode Re-encode</h3>
            <p className="td-xfer-hint">
              Keseimbangan antara kecepatan proses dan kualitas akhir.
            </p>
            <label className="td-xfer-range-row">
              <MediaSelect
                value={draft.reencodePreset}
                disabled={!!transferActive}
                onChange={(value) => onChange({ reencodePreset: value as any })}
                ariaLabel="Mode re-encode"
                options={[
                  { value: 'speed', label: 'Kecepatan', description: 'Adaptif maksimum, menjaga cadangan memori' },
                  { value: 'balanced', label: 'Seimbang', description: 'Default kualitas dan kecepatan' },
                  { value: 'quality', label: 'Kualitas', description: 'Kompresi lebih teliti dan lebih lama' },
                ]}
              />
            </label>

            <h3>Paralel unggah</h3>
            <p className="td-xfer-hint">
              Berapa file di-pipeline ke data center Telegram bersamaan (1–8).
            </p>
            <label className="td-xfer-range-row">
              <input
                type="range"
                min={1}
                max={8}
                value={draft.uploadConcurrency}
                disabled={!!transferActive}
                onChange={(e) => onChange({ uploadConcurrency: Number(e.target.value) })}
                aria-label="Paralel upload"
              />
              <span className="td-xfer-range-val">{draft.uploadConcurrency}</span>
            </label>

            <h3>Opsi pengiriman</h3>
            <div className="td-xfer-checks">
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.groupAsAlbum}
                  disabled={!!transferActive}
                  onChange={(e) => onChange({ groupAsAlbum: e.target.checked })}
                />
                <span>
                  <strong>Kirim sebagai album</strong>
                  <small>Kelompokkan foto/video sejenis (maks 10 per batch Telegram).</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.silent}
                  disabled={!!transferActive}
                  onChange={(e) => onChange({ silent: e.target.checked })}
                />
                <span>
                  <strong>Silent (tanpa notifikasi)</strong>
                  <small>Kirim tanpa bunyi notifikasi di sisi penerima.</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.spoiler}
                  disabled={!!transferActive}
                  onChange={(e) => onChange({ spoiler: e.target.checked })}
                />
                <span>
                  <strong>Spoiler media</strong>
                  <small>Tandai media sebagai spoiler (blur sampai diklik).</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.forceDocumentDefault || draft.qualityMode === 'ORIGINAL'}
                  disabled={!!transferActive}
                  onChange={(e) => {
                    const on = e.target.checked;
                    onChange({
                      forceDocumentDefault: on,
                      qualityMode: on ? 'ORIGINAL' : draft.qualityMode === 'ORIGINAL' ? 'HIGH_QUALITY' : draft.qualityMode,
                    });
                  }}
                />
                <span>
                  <strong>Paksa dokumen (ORIGINAL)</strong>
                  <small>File utuh tanpa kompresi foto Telegram.</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.duplicatePolicy === 'SKIP'}
                  disabled={!!transferActive}
                  onChange={(e) => onChange({ duplicatePolicy: e.target.checked ? 'SKIP' : 'FORCE_UPLOAD' })}
                />
                <span>
                  <strong>Lewati berkas terunggah (De-duplikasi)</strong>
                  <small>Deteksi riwayat Telegram dan database lokal otomatis.</small>
                </span>
              </label>
            </div>

            <h3>Caption default</h3>
            <textarea
              className="td-xfer-textarea"
              rows={3}
              maxLength={1024}
              placeholder="Caption opsional…"
              value={draft.globalCaption}
              disabled={!!transferActive}
              onChange={(e) => onChange({ globalCaption: e.target.value })}
            />
            <div className="td-xfer-charcount">{draft.globalCaption.length}/1024</div>
          </section>
        )}

        {subTab === 'download' && (
          <section className="td-xfer-section" aria-label="Pengaturan download">
            <h3>Paralel unduh</h3>
            <p className="td-xfer-hint">
              Jumlah file yang diunduh bersamaan saat Unduh terpilih (batch).
            </p>
            <label className="td-xfer-range-row">
              <input
                type="range"
                min={1}
                max={8}
                value={draft.downloadConcurrency}
                disabled={!!transferActive}
                onChange={(e) => onChange({ downloadConcurrency: Number(e.target.value) })}
                aria-label="Paralel download"
              />
              <span className="td-xfer-range-val">{draft.downloadConcurrency}</span>
            </label>

            <h3>Perilaku unduh</h3>
            <div className="td-xfer-checks">
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.notifyDownloadDone}
                  onChange={(e) => onChange({ notifyDownloadDone: e.target.checked })}
                />
                <span>
                  <strong>Notifikasi saat unduhan selesai</strong>
                  <small>Tampilkan pemberitahuan banner ketika batch download rampung.</small>
                </span>
              </label>
            </div>
          </section>
        )}
      </div>

      <footer className="td-xfer-settings-foot">
        <button
          type="button"
          className="td-btn-secondary"
          disabled={!!transferActive}
          onClick={onReset}
          title="Kembalikan semua ke setelan awal"
        >
          <RotateCcw size={14} />
          Reset Default
        </button>
        <button
          type="button"
          className="td-btn-primary"
          onClick={onSave}
          title="Simpan perubahan pengaturan transfer"
        >
          <Check size={14} />
          Simpan Pengaturan
        </button>
      </footer>
    </div>
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
      .then((url) => {
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
  const [keepNewest, setKeepNewest] = useState(true);
  /** Message ids marked for deletion (checked = salinan yang akan dihapus). */
  const [markedDelete, setMarkedDelete] = useState<Set<number>>(() => new Set());
  /** Fingerprint of last smart-apply so we re-seed when groups/mode change. */
  const smartKey = useMemo(() => {
    const parts = groups.map((g) => `${g.key}:${g.files.map((f) => f.id).join(',')}`);
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
      (g) => g.files.length > 0 && g.files.every((f) => markedDelete.has(f.id))
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
          'Tidak ada duplikat terdeteksi di file yang dimuat.'
        ) : (
          <>
            <strong>{groups.length}</strong> grup · hemat potensial max{' '}
            <strong>{formatDriveBytes(wasteTotal)}</strong>
            <br />
            <span className="td-tools-dup-lead-hint">
              Centang = salinan yang dihapus. Biarkan kosong = disimpan. Boleh simpan 2 dari 3.
            </span>
          </>
        )}
      </p>
      <div className="td-tools-actions-bar">
        <div className="td-tools-segmented" role="radiogroup" aria-label="Mode deteksi duplikat">
          <button
            type="button"
            className={`td-segmented-item ${dupMode === 'name_size' ? 'active' : ''}`}
            onClick={() => onDupMode('name_size')}
          >
            Nama + ukuran
          </button>
          <button
            type="button"
            className={`td-segmented-item ${dupMode === 'both' ? 'active' : ''}`}
            onClick={() => onDupMode('both')}
          >
            + ukuran sama (soft)
          </button>
        </div>
        <label className="td-tools-check-inline" title="Preferensi default cerdas (bisa diubah per-item)">
          <input
            type="checkbox"
            checked={keepNewest}
            onChange={(e) => setKeepNewest(e.target.checked)}
          />
          <span>Default: simpan terbaru</span>
        </label>
      </div>

      {groups.length > 0 && (
        <div className="td-tools-dup-toolbar">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={applySmartAll}
            title="Per grup: simpan 1 (terbaru/terlama), centang sisanya untuk dihapus"
          >
            <Check size={14} /> Pilihan cerdas
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={clearAllMarks}
            title="Simpan semua file di semua grup (tidak ada yang dihapus)"
          >
            Simpan semua
          </button>
          <span className="td-tools-dup-summary">
            Simpan <strong>{keepCount}</strong> · hapus <strong>{idsToDelete.length}</strong>
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
          <AlertTriangle size={13} /> {groupsWithAllMarked} grup mencentang semua item — tidak ada
          yang disimpan di grup itu.
        </p>
      )}

      {groups.length > 0 && (
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || !idsToDelete.length}
          onClick={() => onDeleteIds(idsToDelete)}
        >
          <Trash2 size={14} /> Hapus {idsToDelete.length} tercentang
        </button>
      )}

      <ul className="td-tools-dup-groups">
        {groups.slice(0, 40).map((g) => {
          const keepId = preferredKeepId(g, keepNewest);
          const markedInGroup = g.files.filter((f) => markedDelete.has(f.id)).length;
          const keepInGroup = g.files.length - markedInGroup;
          return (
            <li key={g.key} className="td-tools-dup-group">
              <div className="td-tools-dup-head">
                <AlertTriangle size={12} />
                <span className="td-tools-dup-head-main">
                  {g.reason === 'name_size' ? 'Nama+size' : 'Size only'} · {g.files.length} file ·
                  simpan {keepInGroup} / hapus {markedInGroup}
                </span>
                <span className="td-tools-dup-head-actions">
                  <button
                    type="button"
                    className="td-tools-dup-mini"
                    disabled={busy}
                    onClick={() => markGroupExtras(g)}
                    title="Simpan 1 (default), centang sisanya"
                  >
                    Cerdas
                  </button>
                  <button
                    type="button"
                    className="td-tools-dup-mini"
                    disabled={busy}
                    onClick={() => clearGroupMarks(g)}
                    title="Simpan semua di grup ini"
                  >
                    Simpan semua
                  </button>
                </span>
              </div>
              <ul className="td-tools-dup-files">
                {g.files.map((f) => {
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
                      <label className="td-tools-dup-check" title="Centang untuk menghapus salinan ini">
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
                        title={canPreview ? `Pratinjau: ${label}` : label}
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
                              {marked ? 'Hapus' : isPreferredKeep ? 'Simpan (default)' : 'Simpan'}
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
