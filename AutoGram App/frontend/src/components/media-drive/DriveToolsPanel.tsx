/**
 * Power tools panel: duplicates, space usage, bulk rename, smart copy, advanced filters.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Copy,
  Scissors,
  HardDrive,
  Layers,
  Type,
  Filter,
  Trash2,
  Check,
  AlertTriangle,
  Loader2,
  Play,
} from 'lucide-react';
import type { DriveCredentials } from '../../lib/driveApi';
import type { DriveChat, DriveFile, DriveFolder } from '../../lib/driveTypes';
import {
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

export type DriveToolsTab = 'dups' | 'space' | 'rename' | 'copy' | 'filter';

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

const TABS: { id: DriveToolsTab; label: string; icon: typeof Copy }[] = [
  { id: 'copy', label: 'Salin batch', icon: Copy },
  { id: 'dups', label: 'Duplikat', icon: Layers },
  { id: 'rename', label: 'Bulk rename', icon: Type },
  { id: 'space', label: 'Storage', icon: HardDrive },
  { id: 'filter', label: 'Filter+', icon: Filter },
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
      aria-label="Alat Drive"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="td-tools-panel"
        data-dialog-layout="card"
        data-testid="drive-tools-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="td-tools-head">
          <div className="td-tools-title">
            <Scissors size={18} />
            <div>
              <strong>Alat Drive</strong>
              <span className="td-tools-sub">{locationLabel}</span>
            </div>
          </div>
          <button type="button" className="td-icon-btn" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </header>

        <nav className="td-tools-tabs" aria-label="Tab alat">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                className={`td-tools-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => onTab(t.id)}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="td-tools-body">
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
              <p className="td-tools-lead">
                <strong>{displayCount.toLocaleString('id-ID')}</strong> file di{' '}
                {scopeLabel}
                {locationStatsLoading && !locationStatsAccurate ? '…' : ''} ·{' '}
                <strong>
                  {formatDriveBytes(displayBytes)}
                  {locationStatsLoading && !locationStatsAccurate ? '…' : ''}
                </strong>
              </p>
              <p className="td-tools-hint">
                {locationStatsAccurate ? (
                  <>
                    <span className="td-tools-badge-ok">Akurat</span> Total unik seluruh{' '}
                    {scopeLabel} (metadata Telegram, tanpa unduh file). Tidak double-count
                    antar filter.
                  </>
                ) : locationStatsLoading ? (
                  <>
                    <span className="td-tools-badge-busy">Menghitung…</span> Walk media di
                    latar — angka akan final saat selesai. Grid tetap bisa dipakai.
                  </>
                ) : (
                  <>
                    <span className="td-tools-badge-est">Perkiraan</span> Dari halaman
                    grid / lower-bound. Buka tab ini memicu hitung akurat otomatis.
                  </>
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
                  const denom =
                    displayBytes > 0 ? displayBytes : space.totalBytes;
                  const pct =
                    denom > 0 ? Math.max(2, (row.bytes / denom) * 100) : 0;
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
                  <h4 className="td-tools-h">File terbesar</h4>
                  <ul className="td-tools-list">
                    {space.largest.map((f) => (
                      <li key={f.id}>
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
                            <span>{formatDriveBytes(f.size || 0)}</span>
                          </button>
                        ) : (
                          <>
                            <span className="td-tools-fname" title={f.name}>
                              {f.name}
                            </span>
                            <span>{formatDriveBytes(f.size || 0)}</span>
                          </>
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
              <p className="td-tools-lead">
                Scope: {selectedFiles.length ? `${selectedFiles.length} terpilih` : `hingga 50 file di view`}.
                Token: <code>{'{n}'}</code> <code>{'{n:3}'}</code> <code>{'{name}'}</code>{' '}
                <code>{'{ext}'}</code> <code>{'{full}'}</code>
              </p>
              <label className="td-tools-field">
                Pola
                <input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="td-tools-input"
                  spellCheck={false}
                />
              </label>
              <label className="td-tools-field">
                Mulai dari
                <input
                  type="number"
                  min={0}
                  value={startAt}
                  onChange={(e) => setStartAt(Number(e.target.value) || 1)}
                  className="td-tools-input td-tools-input-sm"
                />
              </label>
              <h4 className="td-tools-h">Preview</h4>
              <ul className="td-tools-list mono">
                {renamePreview.length === 0 && <li>Tidak ada perubahan / file kosong</li>}
                {renamePreview.map((r) => (
                  <li key={r.id}>
                    <span className="muted">{r.oldName}</span>
                    <span aria-hidden> → </span>
                    <strong>{r.newName}</strong>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-primary"
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
                <Check size={14} /> Terapkan rename
              </button>
            </div>
          )}

          {tab === 'copy' && (
            <div className="td-tools-section">
              <p className="td-tools-lead">
                Salin batch ke Drive/Chat (sumber tetap). Cocok untuk arsip chat → Drive.
              </p>
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
              <label className="td-tools-check">
                <input
                  type="checkbox"
                  checked={skipDup}
                  onChange={(e) => setSkipDup(e.target.checked)}
                />
                Skip duplikat (nama + ukuran di tujuan)
              </label>
              <button
                type="button"
                className="btn btn-primary"
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
                <Copy size={14} /> Mulai salin
              </button>
            </div>
          )}

          {tab === 'filter' && (
            <div className="td-tools-section">
              <p className="td-tools-lead">
                Filter lanjutan di lokasi ini (di atas filter tipe media & search).
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
                    className="td-tools-input"
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
                    className="td-tools-input"
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
              </div>
              <div className="td-tools-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onAdvFilter({ ...EMPTY_ADV_FILTER })}
                >
                  Reset filter
                </button>
                <button type="button" className="btn btn-primary" onClick={onClose}>
                  Terapkan
                </button>
              </div>
              <p className="td-tools-hint">
                Shortcut: <kbd>1 MB</kbd> ≈ 1048576 · contoh min video besar: 5000000
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
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

  useEffect(() => {
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
    requestThumb(creds, folderId, file.id)
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

  return (
    <span className="td-tools-dup-thumb" aria-hidden>
      {thumb ? (
        <>
          <img src={thumb} alt="" loading="lazy" decoding="async" />
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
      <div className="td-tools-actions">
        <label className="td-tools-check">
          <input
            type="radio"
            checked={dupMode === 'name_size'}
            onChange={() => onDupMode('name_size')}
          />
          Nama + ukuran
        </label>
        <label className="td-tools-check">
          <input
            type="radio"
            checked={dupMode === 'both'}
            onChange={() => onDupMode('both')}
          />
          + ukuran sama (soft)
        </label>
        <label className="td-tools-check" title="Preferensi default cerdas (bisa diubah per-item)">
          <input
            type="checkbox"
            checked={keepNewest}
            onChange={(e) => setKeepNewest(e.target.checked)}
          />
          Default: simpan terbaru
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
