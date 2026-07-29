/**
 * Pure helpers for Drive power features:
 * advanced filters, duplicates, bulk rename, space usage, clipboard, nav history.
 */
import type { DriveFile, DriveMediaFilter, DriveSortMode } from './driveTypes';
import { filterAndSortDriveFiles } from './driveTypes';

// ─── Advanced filters ───────────────────────────────────────────────────────

export type DriveAdvFilter = {
  sizeMin?: number | null;
  sizeMax?: number | null;
  /** ISO date or yyyy-mm-dd inclusive start */
  dateFrom?: string | null;
  /** ISO date or yyyy-mm-dd inclusive end */
  dateTo?: string | null;
  /** Extension without dot, lowercase (e.g. "pdf", "mp4") */
  ext?: string | null;
  /** Message ID to find (Telegram message ID) */
  messageId?: number | null;
};

export const EMPTY_ADV_FILTER: DriveAdvFilter = {
  sizeMin: null,
  sizeMax: null,
  dateFrom: null,
  dateTo: null,
  ext: null,
  messageId: null,
};

export function isAdvFilterActive(f: DriveAdvFilter | null | undefined): boolean {
  if (!f) return false;
  return !!(
    (f.sizeMin != null && f.sizeMin > 0) ||
    (f.sizeMax != null && f.sizeMax > 0) ||
    (f.dateFrom && f.dateFrom.trim()) ||
    (f.dateTo && f.dateTo.trim()) ||
    (f.ext && f.ext.trim()) ||
    (f.messageId != null && f.messageId > 0)
  );
}

function parseDayStart(s: string): number | null {
  const t = Date.parse(s.length <= 10 ? `${s}T00:00:00` : s);
  return Number.isFinite(t) ? t : null;
}

function parseDayEnd(s: string): number | null {
  const t = Date.parse(s.length <= 10 ? `${s}T23:59:59.999` : s);
  return Number.isFinite(t) ? t : null;
}

export function matchesAdvFilter(f: DriveFile, adv: DriveAdvFilter): boolean {
  if (adv.messageId != null && adv.messageId > 0 && f.id !== adv.messageId) return false;
  if (adv.sizeMin != null && adv.sizeMin > 0 && (f.size || 0) < adv.sizeMin) return false;
  if (adv.sizeMax != null && adv.sizeMax > 0 && (f.size || 0) > adv.sizeMax) return false;
  if (adv.ext && adv.ext.trim()) {
    const want = adv.ext.replace(/^\./, '').trim().toLowerCase();
    const got = (f.file_ext || f.name.split('.').pop() || '').replace(/^\./, '').toLowerCase();
    if (got !== want) return false;
  }
  if (adv.dateFrom && adv.dateFrom.trim()) {
    const from = parseDayStart(adv.dateFrom.trim());
    const ft = f.created_at ? Date.parse(f.created_at) : NaN;
    if (from != null && Number.isFinite(ft) && ft < from) return false;
  }
  if (adv.dateTo && adv.dateTo.trim()) {
    const to = parseDayEnd(adv.dateTo.trim());
    const ft = f.created_at ? Date.parse(f.created_at) : NaN;
    if (to != null && Number.isFinite(ft) && ft > to) return false;
  }
  return true;
}

export function filterAndSortDriveFilesPower(
  files: DriveFile[],
  opts: {
    query?: string;
    mediaFilter?: DriveMediaFilter;
    sortMode?: DriveSortMode;
    adv?: DriveAdvFilter | null;
  }
): DriveFile[] {
  let list = filterAndSortDriveFiles(files, {
    query: opts.query,
    mediaFilter: opts.mediaFilter,
    sortMode: opts.sortMode,
  });
  if (opts.adv && isAdvFilterActive(opts.adv)) {
    list = list.filter((f) => matchesAdvFilter(f, opts.adv!));
  }
  return list;
}

// ─── Duplicates ─────────────────────────────────────────────────────────────

export type DupGroup = {
  key: string;
  reason: 'name_size' | 'size_only';
  files: DriveFile[];
  /** Total wasted bytes if keep one (sum - max) */
  wasteBytes: number;
};

/** Group files that share name+size (primary) or identical size only (soft). */
export function findDuplicateGroups(
  files: DriveFile[],
  mode: 'name_size' | 'size_only' | 'both' = 'name_size'
): DupGroup[] {
  const byNameSize = new Map<string, DriveFile[]>();
  const bySize = new Map<number, DriveFile[]>();

  for (const f of files) {
    const name = (f.original_name || f.name || '').trim().toLowerCase();
    const size = f.size || 0;
    const nsKey = `${name}|${size}`;
    if (!byNameSize.has(nsKey)) byNameSize.set(nsKey, []);
    byNameSize.get(nsKey)!.push(f);
    if (size > 0) {
      if (!bySize.has(size)) bySize.set(size, []);
      bySize.get(size)!.push(f);
    }
  }

  const groups: DupGroup[] = [];
  const claimed = new Set<number>();

  if (mode === 'name_size' || mode === 'both') {
    for (const [key, list] of byNameSize) {
      if (list.length < 2) continue;
      for (const f of list) claimed.add(f.id);
      const total = list.reduce((s, f) => s + (f.size || 0), 0);
      const keep = Math.max(...list.map((f) => f.size || 0));
      groups.push({
        key: `ns:${key}`,
        reason: 'name_size',
        files: [...list].sort((a, b) => (b.id || 0) - (a.id || 0)),
        wasteBytes: Math.max(0, total - keep),
      });
    }
  }

  if (mode === 'size_only' || mode === 'both') {
    for (const [size, list] of bySize) {
      const unclaimed = list.filter((f) => !claimed.has(f.id));
      if (unclaimed.length < 2) continue;
      const total = unclaimed.reduce((s, f) => s + (f.size || 0), 0);
      groups.push({
        key: `sz:${size}`,
        reason: 'size_only',
        files: [...unclaimed].sort((a, b) => (b.id || 0) - (a.id || 0)),
        wasteBytes: Math.max(0, total - size),
      });
    }
  }

  groups.sort((a, b) => b.wasteBytes - a.wasteBytes || b.files.length - a.files.length);
  return groups;
}

/** Ids to delete when keeping the first (newest) in each group. */
export function dupIdsToDeleteKeepNewest(groups: DupGroup[]): number[] {
  const out: number[] = [];
  for (const g of groups) {
    // files already sorted newest-first by id
    for (let i = 1; i < g.files.length; i++) out.push(g.files[i].id);
  }
  return out;
}

// ─── Bulk rename ────────────────────────────────────────────────────────────

/**
 * Pattern tokens:
 *  {n}     — 1-based index
 *  {n:3}   — zero-padded index
 *  {name}  — basename without extension
 *  {ext}   — extension without dot
 *  {full}  — original full name
 */
export function applyBulkRenamePattern(
  files: DriveFile[],
  pattern: string,
  startAt = 1
): { id: number; oldName: string; newName: string }[] {
  const out: { id: number; oldName: string; newName: string }[] = [];
  const seen = new Set<string>();
  files.forEach((f, i) => {
    const n = startAt + i;
    const full = f.name || `file_${f.id}`;
    const dot = full.lastIndexOf('.');
    const base = dot > 0 ? full.slice(0, dot) : full;
    const ext = (f.file_ext || (dot > 0 ? full.slice(dot + 1) : '')).replace(/^\./, '');
    let name = pattern
      .replace(/\{n:(\d+)\}/g, (_, w) => String(n).padStart(Number(w) || 1, '0'))
      .replace(/\{n\}/g, String(n))
      .replace(/\{name\}/g, base)
      .replace(/\{ext\}/g, ext)
      .replace(/\{full\}/g, full)
      .trim();
    if (!name) name = full;
    // Collision: append _2, _3…
    let unique = name;
    let c = 2;
    while (seen.has(unique.toLowerCase())) {
      const d = unique.lastIndexOf('.');
      if (d > 0) unique = `${unique.slice(0, d)}_${c}${unique.slice(d)}`;
      else unique = `${name}_${c}`;
      c++;
    }
    seen.add(unique.toLowerCase());
    if (unique !== full) {
      out.push({ id: f.id, oldName: full, newName: unique });
    }
  });
  return out;
}

// ─── Space usage ────────────────────────────────────────────────────────────

export type SpaceUsage = {
  fileCount: number;
  totalBytes: number;
  byType: { type: string; count: number; bytes: number }[];
  largest: DriveFile[];
};

export function computeSpaceUsage(files: DriveFile[], topN = 10): SpaceUsage {
  const byTypeMap = new Map<string, { count: number; bytes: number }>();
  let totalBytes = 0;
  for (const f of files) {
    const t = String(f.icon_type || 'file').toLowerCase();
    const b = f.size || 0;
    totalBytes += b;
    const cur = byTypeMap.get(t) || { count: 0, bytes: 0 };
    cur.count += 1;
    cur.bytes += b;
    byTypeMap.set(t, cur);
  }
  const byType = [...byTypeMap.entries()]
    .map(([type, v]) => ({ type, count: v.count, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  const largest = [...files].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, topN);
  return { fileCount: files.length, totalBytes, byType, largest };
}

// ─── Skip-dup for chat → drive copy ─────────────────────────────────────────

export function nameSizeKey(f: Pick<DriveFile, 'name' | 'original_name' | 'size'>): string {
  const name = (f.original_name || f.name || '').trim().toLowerCase();
  return `${name}|${f.size || 0}`;
}

/** Filter source files that already exist in dest (by name+size). */
export function filterSkipDuplicates(
  sources: DriveFile[],
  destFiles: DriveFile[]
): { toCopy: DriveFile[]; skipped: DriveFile[] } {
  const destKeys = new Set(destFiles.map(nameSizeKey));
  const toCopy: DriveFile[] = [];
  const skipped: DriveFile[] = [];
  for (const s of sources) {
    if (destKeys.has(nameSizeKey(s))) skipped.push(s);
    else toCopy.push(s);
  }
  return { toCopy, skipped };
}

// ─── Internal clipboard (copy/cut for move/copy queue) ───────────────────────

export type DriveClipboard = {
  mode: 'copy' | 'cut';
  messageIds: number[];
  fromFolderId: number | null;
  names: string[];
  at: number;
};

let clipboard: DriveClipboard | null = null;

export function setDriveClipboard(c: DriveClipboard | null) {
  clipboard = c;
}

export function getDriveClipboard(): DriveClipboard | null {
  return clipboard;
}

// ─── Nav history (browser-style back/forward) ───────────────────────────────

export type DriveNavLoc = {
  kind: 'saved' | 'drive' | 'chat';
  id: number | null;
};

export type DriveNavHistory = {
  stack: DriveNavLoc[];
  index: number;
};

export function createNavHistory(initial: DriveNavLoc): DriveNavHistory {
  return { stack: [initial], index: 0 };
}

export function navPush(h: DriveNavHistory, loc: DriveNavLoc): DriveNavHistory {
  const cur = h.stack[h.index];
  if (cur && cur.kind === loc.kind && cur.id === loc.id) return h;
  const stack = h.stack.slice(0, h.index + 1);
  stack.push(loc);
  // Cap history
  const max = 40;
  if (stack.length > max) {
    const drop = stack.length - max;
    return { stack: stack.slice(drop), index: stack.length - 1 - drop };
  }
  return { stack, index: stack.length - 1 };
}

export function navBack(h: DriveNavHistory): DriveNavHistory | null {
  if (h.index <= 0) return null;
  return { ...h, index: h.index - 1 };
}

export function navForward(h: DriveNavHistory): DriveNavHistory | null {
  if (h.index >= h.stack.length - 1) return null;
  return { ...h, index: h.index + 1 };
}

export function navCurrent(h: DriveNavHistory): DriveNavLoc {
  return h.stack[h.index] || { kind: 'saved', id: null };
}

// ─── Display label truncate ─────────────────────────────────────────────────

/** Middle-ellipsis truncate for long history labels (e.g. "History Morphe…"). */
export function truncateMiddle(label: string, max = 22): string {
  const s = (label || '').trim();
  if (s.length <= max) return s;
  if (max < 8) return s.slice(0, Math.max(1, max - 1)) + '…';
  const head = Math.ceil((max - 1) * 0.55);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
