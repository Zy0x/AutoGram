/** AutoGram Drive entity types (Telegram-Drive model). */

export type DriveIconType = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'file' | 'folder';

export type DriveFile = {
  id: number;
  folder_id: number | null;
  name: string;
  size: number;
  mime_type?: string | null;
  file_ext?: string | null;
  created_at?: string;
  icon_type: DriveIconType | string;
  /** Local-only timestamp used for the one-shot post-upload card feedback. */
  recently_uploaded_at?: number;
  /** Forum topic id when media belongs to a topic */
  topic_id?: number | null;
  /** Video/audio duration in seconds (from Telegram attributes) */
  duration?: number | null;
  /** Alias used by some worker payloads */
  duration_s?: number | null;
  /** Backend hint: can show grid thumbnail (incl. document-as-photo/video) */
  has_thumb?: boolean;
  /** True when photo/video was sent as Telegram document/file */
  as_document?: boolean;
  /** Original filename attribute (when display name is caption) */
  original_name?: string | null;
};

export type DriveFolder = {
  id: number;
  name: string;
  title_raw?: string;
  username?: string | null;
  is_public?: boolean;
  parent_id?: number | null;
  is_drive_folder?: boolean;
  /** parent_id set but parent peer missing from scan */
  is_orphan?: boolean;
};

/** Soft warn before Telegram ~500 channel ceiling */
export const DRIVE_FOLDER_SOFT_LIMIT = 450;

/**
 * Product terminology (UI):
 * - Root [TD] channel (no parent) → **Drive**
 * - Nested under a Drive or Folder → **Folder** (folder-in-folder allowed)
 * Section label: **Drives [TD]**
 */
export type DriveItemKind = 'drive' | 'folder';

/** Root-level item (no valid parent) is a Drive; anything nested is a Folder. */
export function driveItemKind(
  folder: Pick<DriveFolder, 'parent_id' | 'is_orphan'> | null | undefined
): DriveItemKind {
  if (!folder) return 'drive';
  if (folder.is_orphan) return 'drive';
  if (folder.parent_id == null) return 'drive';
  return 'folder';
}

export function driveItemKindLabel(kind: DriveItemKind, opts?: { plural?: boolean }): string {
  if (kind === 'drive') return opts?.plural ? 'Drives' : 'Drive';
  return opts?.plural ? 'Folder' : 'Folder';
}

/** Human label for a known folder row (Drive vs Folder). */
export function labelDriveItem(
  folder: Pick<DriveFolder, 'parent_id' | 'is_orphan' | 'name'> | null | undefined
): string {
  const kind = driveItemKind(folder);
  return kind === 'drive' ? 'Drive' : 'Folder';
}

export type DriveChat = {
  id: number;
  name: string;
  title_raw?: string;
  type: 'user' | 'group' | 'channel' | 'bot' | 'unknown' | string;
  is_drive_folder?: boolean;
  /** Telegram forum (topics) group */
  is_forum?: boolean;
  username?: string | null;
};

export type DriveChatFolder = {
  id: number;
  title: string;
  emoticon?: string | null;
  color?: number | null;
  kind: 'all' | 'custom' | 'shared';
  pinned_peer_ids?: number[];
  include_peer_ids?: number[];
  exclude_peer_ids?: number[];
  contacts?: boolean;
  non_contacts?: boolean;
  groups?: boolean;
  broadcasts?: boolean;
  bots?: boolean;
  exclude_muted?: boolean;
  exclude_read?: boolean;
  exclude_archived?: boolean;
};

export type DriveTopic = {
  id: number;
  title: string;
  top_message?: number | null;
  closed?: boolean;
};

/** null = all media in the chat (including all topics) */
export type DriveTopicFilter = number | null;

export type DriveViewMode = 'grid' | 'list';
/** @deprecated Prefer DriveSortMode presets */
export type DriveSortField = 'name' | 'size' | 'date';
export type DriveSortDir = 'asc' | 'desc';

/**
 * Grid zoom: higher = larger tiles (fewer columns).
 * Target widths are used to compute columns from container size.
 */
export type DriveGridZoom = 0 | 1 | 2 | 3 | 4 | 5;

export type DriveGridZoomLevel = {
  id: DriveGridZoom;
  label: string;
  short: string;
  /** Preferred card width (px) for column calculation */
  targetW: number;
  /** Soft max columns at this zoom (wide screens) */
  maxCols: number;
};

export const DRIVE_GRID_ZOOM_LEVELS: DriveGridZoomLevel[] = [
  { id: 0, label: 'Sangat kecil', short: 'XS', targetW: 92, maxCols: 12 },
  { id: 1, label: 'Kecil', short: 'S', targetW: 118, maxCols: 10 },
  { id: 2, label: 'Sedang', short: 'M', targetW: 148, maxCols: 8 },
  { id: 3, label: 'Besar', short: 'L', targetW: 184, maxCols: 6 },
  { id: 4, label: 'Lebih besar', short: 'XL', targetW: 228, maxCols: 5 },
  { id: 5, label: 'Maksimal', short: 'XXL', targetW: 288, maxCols: 4 },
];

export const DEFAULT_GRID_ZOOM: DriveGridZoom = 2;
export const MIN_GRID_ZOOM = 0 as DriveGridZoom;
export const MAX_GRID_ZOOM = 5 as DriveGridZoom;

export function isDriveGridZoom(v: unknown): v is DriveGridZoom {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

export function clampGridZoom(n: number): DriveGridZoom {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return DEFAULT_GRID_ZOOM;
  return Math.max(MIN_GRID_ZOOM, Math.min(MAX_GRID_ZOOM, x)) as DriveGridZoom;
}

/**
 * Smart column count for portrait 2:3 tiles at a zoom level.
 * Guarantees columns fit inside `width` (pad + gaps) so cards never overflow
 * the explorer when the window or sidebar resizes.
 */
export function gridColumnsForWidth(
  width: number,
  zoom: DriveGridZoom,
  opts?: { gap?: number; pad?: number; minCardW?: number }
): number {
  const level = DRIVE_GRID_ZOOM_LEVELS[zoom] || DRIVE_GRID_ZOOM_LEVELS[DEFAULT_GRID_ZOOM];
  const gap = opts?.gap ?? 10;
  const pad = opts?.pad ?? 28;
  const minCardW = opts?.minCardW ?? Math.max(64, Math.round(level.targetW * 0.55));
  const inner = Math.max(120, (width || 400) - pad);
  let cols = Math.floor((inner + gap) / (level.targetW + gap));
  cols = Math.max(1, Math.min(cols, level.maxCols));
  // Shrink until every card is at least minCardW (prevents horizontal overflow)
  while (cols > 1) {
    const cw = (inner - gap * (cols - 1)) / cols;
    if (cw >= minCardW - 0.5) break;
    cols -= 1;
  }
  // Very narrow phones: prefer 2 cols when zoomed out, but never force overflow
  if (inner < 360 && zoom <= 2 && cols < 2) {
    const cw2 = (inner - gap) / 2;
    if (cw2 >= 56) cols = 2;
  }
  if (inner < 220) cols = 1;
  return Math.max(1, cols);
}

/** Single-select sort presets for Drive media grid/list */
export type DriveSortMode =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'size_desc'
  | 'size_asc';

export type DriveSortOption = {
  id: DriveSortMode;
  label: string;
  short: string;
  description: string;
};

export const DRIVE_SORT_OPTIONS: DriveSortOption[] = [
  {
    id: 'newest',
    label: 'Terbaru dulu',
    short: 'Terbaru',
    description: 'Media paling baru di atas',
  },
  {
    id: 'oldest',
    label: 'Terlama dulu',
    short: 'Terlama',
    description: 'Media paling lama di atas',
  },
  {
    id: 'name_asc',
    label: 'Nama A → Z',
    short: 'A–Z',
    description: 'Urut nama naik',
  },
  {
    id: 'name_desc',
    label: 'Nama Z → A',
    short: 'Z–A',
    description: 'Urut nama turun',
  },
  {
    id: 'size_desc',
    label: 'Ukuran terbesar',
    short: 'Terbesar',
    description: 'File besar di atas',
  },
  {
    id: 'size_asc',
    label: 'Ukuran terkecil',
    short: 'Terkecil',
    description: 'File kecil di atas',
  },
];

export const DEFAULT_DRIVE_SORT: DriveSortMode = 'newest';

export function isDriveSortMode(v: unknown): v is DriveSortMode {
  return (
    v === 'newest' ||
    v === 'oldest' ||
    v === 'name_asc' ||
    v === 'name_desc' ||
    v === 'size_desc' ||
    v === 'size_asc'
  );
}

function fileTimeMs(f: DriveFile): number {
  if (!f.created_at) return 0;
  const t = Date.parse(f.created_at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Apply media filter + search query + sort — single source of truth for grid/list
 * and for selection (shift-range / marquee / select-all must use this order).
 */
export function filterAndSortDriveFiles(
  files: DriveFile[],
  opts: {
    query?: string;
    mediaFilter?: DriveMediaFilter;
    sortMode?: DriveSortMode;
  }
): DriveFile[] {
  const q = (opts.query || '').trim().toLowerCase();
  const mediaFilter = opts.mediaFilter ?? 'all';
  const sortMode = opts.sortMode ?? DEFAULT_DRIVE_SORT;
  let list = files.filter((f) => matchesMediaFilter(f, mediaFilter));
  if (q) {
    // Multi-token AND over name + type/mime/ext (current-location file search)
    const tokens = q.split(/\s+/).filter(Boolean);
    list = list.filter((f) => {
      const hay = [
        f.name,
        f.original_name,
        f.icon_type,
        f.mime_type,
        f.file_ext,
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }
  return [...list].sort((a, b) => compareDriveFiles(a, b, sortMode));
}

/** Compare two files for the given sort preset (stable ties via message id). */
export function compareDriveFiles(a: DriveFile, b: DriveFile, mode: DriveSortMode): number {
  let c = 0;
  switch (mode) {
    case 'newest':
      c = fileTimeMs(b) - fileTimeMs(a);
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'oldest':
      c = fileTimeMs(a) - fileTimeMs(b);
      if (c === 0) c = (a.id || 0) - (b.id || 0);
      return c;
    case 'name_asc':
      c = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'name_desc':
      c = b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'size_desc':
      c = (b.size || 0) - (a.size || 0);
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'size_asc':
      c = (a.size || 0) - (b.size || 0);
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    default:
      return (b.id || 0) - (a.id || 0);
  }
}

export type DriveMediaFilter = 'all' | 'image' | 'video' | 'document' | 'link';
export type QualityMode = 'HIGH_QUALITY' | 'SMART' | 'ORIGINAL';
export type ReencodeHardware = 'auto' | 'nvidia' | 'amd' | 'intel' | 'cpu';
export type ReencodePreset = 'speed' | 'balanced' | 'quality';

/** Upload + download preferences for Media Studio (persisted in localStorage). */
export type DriveTransferSettings = {
  /** Upload quality mapping to Telethon send kwargs */
  qualityMode: QualityMode;
  /** Concurrent file slots for multi-file upload pipeline (1–8) */
  uploadConcurrency: number;
  /** Concurrent files when batch-downloading (1–8) */
  downloadConcurrency: number;
  /** Send multiple photos/videos as Telegram album batches */
  groupAsAlbum: boolean;
  /** Silent send (no notification sound on recipients when supported) */
  silent: boolean;
  /** Spoiler media flag when supported */
  spoiler: boolean;
  /** Preferred original document send (no photo compression) — alias of ORIGINAL for clarity */
  forceDocumentDefault: boolean;
  /** Duplicate resolution policy: 'SKIP' (default) or 'FORCE_UPLOAD' (always upload) */
  duplicatePolicy: 'SKIP' | 'FORCE_UPLOAD';
  /** Caption applied to every uploaded file when empty caption */
  globalCaption: string;
  /** After upload finishes, refresh file list (recommended) */
  refreshAfterUpload: boolean;
  /** After download finishes, show status with folder path */
  notifyDownloadDone: boolean;
  /** Hardware to use for video re-encoding */
  reencodeHardware: ReencodeHardware;
  /** Quality/speed tradeoff for video re-encoding */
  reencodePreset: ReencodePreset;
};

export const DEFAULT_TRANSFER_SETTINGS: DriveTransferSettings = {
  qualityMode: 'HIGH_QUALITY',
  uploadConcurrency: 4,
  downloadConcurrency: 4,
  groupAsAlbum: false,
  silent: false,
  spoiler: false,
  forceDocumentDefault: false,
  duplicatePolicy: 'SKIP',
  globalCaption: '',
  refreshAfterUpload: true,
  notifyDownloadDone: true,
  reencodeHardware: 'auto',
  reencodePreset: 'balanced',
};

export const QUALITY_MODE_OPTIONS: {
  id: QualityMode;
  label: string;
  description: string;
}[] = [
  {
    id: 'HIGH_QUALITY',
    label: 'HQ — Telegram native',
    description: 'Foto/video sebagai media Telegram (streaming video). File lain sebagai dokumen.',
  },
  {
    id: 'SMART',
    label: 'SMART — otomatis',
    description: 'Pilih mode per ekstensi (re-encode video problematik bila perlu).',
  },
  {
    id: 'ORIGINAL',
    label: 'ORIGINAL — dokumen utuh',
    description: 'Semua sebagai dokumen (force_document). Paling cepat, tanpa kompresi foto Telegram.',
  },
];

export function clampConcurrency(n: unknown, fallback = 4): number {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return fallback;
  return Math.max(1, Math.min(8, x));
}

export function isQualityMode(v: unknown): v is QualityMode {
  return v === 'HIGH_QUALITY' || v === 'SMART' || v === 'ORIGINAL';
}

export function isReencodeHardware(v: unknown): v is ReencodeHardware {
  return v === 'auto' || v === 'nvidia' || v === 'amd' || v === 'intel' || v === 'cpu';
}

export function isReencodePreset(v: unknown): v is ReencodePreset {
  return v === 'speed' || v === 'balanced' || v === 'quality';
}

export function loadTransferSettings(): DriveTransferSettings {
  try {
    const raw = localStorage.getItem('autogram_drive_transfer_settings');
    if (!raw) return { ...DEFAULT_TRANSFER_SETTINGS };
    const p = JSON.parse(raw) as Partial<DriveTransferSettings>;
    return {
      qualityMode: isQualityMode(p.qualityMode) ? p.qualityMode : DEFAULT_TRANSFER_SETTINGS.qualityMode,
      uploadConcurrency: clampConcurrency(
        p.uploadConcurrency,
        DEFAULT_TRANSFER_SETTINGS.uploadConcurrency
      ),
      downloadConcurrency: clampConcurrency(
        p.downloadConcurrency,
        DEFAULT_TRANSFER_SETTINGS.downloadConcurrency
      ),
      groupAsAlbum: !!p.groupAsAlbum,
      silent: !!p.silent,
      spoiler: !!p.spoiler,
      forceDocumentDefault: !!p.forceDocumentDefault,
      duplicatePolicy: p.duplicatePolicy === 'FORCE_UPLOAD' ? 'FORCE_UPLOAD' : 'SKIP',
      globalCaption: typeof p.globalCaption === 'string' ? p.globalCaption.slice(0, 1024) : '',
      refreshAfterUpload: p.refreshAfterUpload !== false,
      notifyDownloadDone: p.notifyDownloadDone !== false,
      reencodeHardware: isReencodeHardware(p.reencodeHardware) ? p.reencodeHardware : DEFAULT_TRANSFER_SETTINGS.reencodeHardware,
      reencodePreset: isReencodePreset(p.reencodePreset) ? p.reencodePreset : DEFAULT_TRANSFER_SETTINGS.reencodePreset,
    };
  } catch {
    return { ...DEFAULT_TRANSFER_SETTINGS };
  }
}

export function saveTransferSettings(s: DriveTransferSettings): void {
  try {
    localStorage.setItem('autogram_drive_transfer_settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/**
 * Grid thumbnail quality vs data usage.
 * - saver: slow/metered networks
 * - balanced: default (clearer video stills, still light)
 * - sharp: clear tiles from largest TG static layer only (lean, no multi‑MB pulls)
 */
export type DriveThumbQuality = 'saver' | 'balanced' | 'sharp';

export const DEFAULT_THUMB_QUALITY: DriveThumbQuality = 'balanced';

export type DriveThumbQualityOption = {
  id: DriveThumbQuality;
  label: string;
  short: string;
  description: string;
};

export const DRIVE_THUMB_QUALITY_OPTIONS: DriveThumbQualityOption[] = [
  {
    id: 'saver',
    label: 'Hemat data',
    short: 'Hemat',
    description: 'Thumb kecil — cocok internet lambat / kuota ketat',
  },
  {
    id: 'balanced',
    label: 'Seimbang',
    short: 'Seimbang',
    description: 'Default — video lebih tajam, data tetap wajar',
  },
  {
    id: 'sharp',
    label: 'Jelas',
    short: 'Jelas',
    description: 'Tajam dari layer Telegram terbesar (~70–130 KB) — tanpa unduh full file',
  },
];

export function isDriveThumbQuality(v: unknown): v is DriveThumbQuality {
  return v === 'saver' || v === 'balanced' || v === 'sharp';
}

/** @deprecated Prefer TransferSession — kept for legacy call sites */
export type TransferStats = {
  active: boolean;
  phase: 'idle' | 'upload' | 'download';
  percent: number;
  speed_mb_s: number;
  peak_mb_s: number;
  item_index: number;
  items_total: number;
  label?: string;
};

export type TransferItemStatus =
  | 'queued'
  | 'preparing'
  | 'active'
  | 'uploaded'
  | 'waiting_commit'
  | 'committing'
  | 'needs_verification'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'
  /** Duplicate detected — file existed in destination, upload was intentionally skipped */
  | 'skipped';

export type TransferDirection = 'upload' | 'download' | 'move';

export type TransferItem = {
  id: string;
  index: number;
  name: string;
  direction: TransferDirection;
  status: TransferItemStatus;
  percent: number;
  transferred: number;
  total: number;
  speed_mb_s: number;
  phase?: 'queued' | 'probe' | 'reencode' | 'upload' | 'download' | 'commit' | string;
  encoderBackend?: string;
  encoderName?: string;
  decoderName?: string;
  fps?: number;
  encodeSpeed?: number;
  estimatedOutputBytes?: number;
  encodeEtaSeconds?: number | null;
  fallbackReason?: string;
  error?: string;
  /** Short human-readable note (e.g. "Duplikat dilewati") */
  note?: string;
  /** Telegram message id after successful commit — locks status as done */
  messageId?: number;
  /** Destination name (e.g. Chat/Folder Title or Local save path) */
  destination?: string;
};

export type TransferSession = {
  jobKey: string;
  direction: TransferDirection;
  active: boolean;
  paused: boolean;
  overallPercent: number;
  speed_mb_s: number;
  peak_mb_s: number;
  transferred: number;
  total: number;
  /** Upload byte metrics stay separate from ordered commit/terminal progress. */
  uploadedBytes?: number;
  committedCount?: number;
  needsVerificationCount?: number;
  etaSeconds: number | null;
  label: string;
  banner?: string;
  items: TransferItem[];
  startedAt: number;
  /** Last N debug lines from worker [TRANSFER] / TransferLog */
  debugLogs?: string[];
};

export const EMPTY_TRANSFER_SESSION: TransferSession = {
  jobKey: '',
  direction: 'upload',
  active: false,
  paused: false,
  overallPercent: 0,
  speed_mb_s: 0,
  peak_mb_s: 0,
  transferred: 0,
  total: 0,
  etaSeconds: null,
  label: '',
  items: [],
  startedAt: 0,
  debugLogs: [],
};

export function formatDriveBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** ETA for transfer UI: "45s", "1m 12s", "—" */
export function formatTransferEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function formatTransferSpeed(mb_s: number): string {
  if (!Number.isFinite(mb_s) || mb_s <= 0) return '0 MB/s';
  if (mb_s < 0.01) return `${(mb_s * 1024).toFixed(0)} KB/s`;
  return `${mb_s.toFixed(2)} MB/s`;
}

/** Format media duration for thumbnail badge: 0:42, 12:05, 1:02:03 */
export function formatDriveDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds === undefined) return '';
  const n = typeof seconds === 'string' ? Number(seconds) : Number(seconds);
  // Hide 0:00 — almost always means “unknown”, not a zero-length clip
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = Math.floor(n);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Resolve duration seconds from file payload (supports duration / duration_s). */
export function driveFileDurationSeconds(file: DriveFile): number | null {
  const raw = file.duration ?? file.duration_s;
  if (raw == null) return null;
  const n = typeof raw === 'string' ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const MEDIA_EXT_HINTS = new Set([
  ...['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'jfif', 'avif'],
  ...['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', '3gp', 'mpeg', 'mpg', 'ts', 'wmv', 'flv'],
  ...['mp3', 'm4a', 'ogg', 'flac', 'wav', 'opus', 'aac', 'wma'],
  'pdf',
]);

function _extFromString(s: string | null | undefined): string {
  if (!s) return '';
  const base = String(s).split(/[/\\]/).pop() || String(s);
  const i = base.lastIndexOf('.');
  if (i <= 0 || i >= base.length - 1) return '';
  const e = base.slice(i + 1).toLowerCase();
  // Reject multi-word / garbage
  if (!/^[a-z0-9]{1,8}$/i.test(e)) return '';
  return e;
}

function _mimeToExt(mime: string | null | undefined): string {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  if (!m || !m.includes('/')) return '';
  if (m === 'image/jpeg' || m === 'image/pjpeg') return 'jpg';
  if (m === 'image/svg+xml') return 'svg';
  if (m === 'video/x-matroska') return 'mkv';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  if (m === 'video/mp4') return 'mp4';
  if (m === 'audio/mpeg') return 'mp3';
  if (m === 'audio/mp4' || m === 'audio/x-m4a') return 'm4a';
  const sub = m.split('/')[1] || '';
  if (sub === 'octet-stream' || sub === 'unknown') return '';
  if (/^[a-z0-9]{1,8}$/i.test(sub) && !sub.startsWith('x-')) return sub;
  if (sub.startsWith('x-') && /^[a-z0-9-]{1,12}$/i.test(sub)) {
    const bare = sub.slice(2);
    if (bare === 'matroska') return 'mkv';
    if (/^[a-z0-9]{1,8}$/i.test(bare)) return bare;
  }
  return '';
}

/**
 * Authoritative file extension for UI kind badges / filters.
 * Prefer Telegram document filename + mime over caption display name
 * (caption may still say .webm after HQ re-encode to .mp4).
 */
export function driveFileExt(file: DriveFile): string {
  const fromOrig = _extFromString(file.original_name);
  if (fromOrig && MEDIA_EXT_HINTS.has(fromOrig)) return fromOrig === 'jpeg' ? 'jpg' : fromOrig;

  const fromField = (file.file_ext || '').toLowerCase().replace(/^\./, '');
  if (fromField && MEDIA_EXT_HINTS.has(fromField)) {
    return fromField === 'jpeg' ? 'jpg' : fromField;
  }

  const fromMime = _mimeToExt(file.mime_type);
  if (fromMime) return fromMime === 'jpeg' ? 'jpg' : fromMime;

  // Non-media or unknown: field / original / display name
  if (fromField) return fromField === 'jpeg' ? 'jpg' : fromField;
  if (fromOrig) return fromOrig === 'jpeg' ? 'jpg' : fromOrig;
  const fromName = _extFromString(file.name);
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  return '';
}

/**
 * Display name for cards / lists / preview.
 * Fixes stale caption extensions (webm caption + mp4 document → show .mp4).
 */
export function driveFileDisplayName(file: DriveFile): string {
  const raw = (file.name || file.original_name || '').trim() || 'file';
  const trueExt = driveFileExt(file);
  if (!trueExt) return raw;
  const nameExt = _extFromString(raw);
  if (!nameExt) {
    // Caption without extension — append real one for clarity
    if (MEDIA_EXT_HINTS.has(trueExt)) return `${raw}.${trueExt}`;
    return raw;
  }
  if (nameExt === trueExt || nameExt === 'jpeg' && trueExt === 'jpg') return raw;
  // Both media-ish and disagree → replace trailing extension
  if (MEDIA_EXT_HINTS.has(nameExt) && MEDIA_EXT_HINTS.has(trueExt)) {
    const i = raw.lastIndexOf('.');
    if (i > 0) return `${raw.slice(0, i)}.${trueExt}`;
  }
  return raw;
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'jfif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', '3gp', 'mpeg', 'mpg', 'ts', 'wmv', 'flv']);
const PDF_EXTS = new Set(['pdf']);
const TEXT_EXTS = new Set([
  'txt',
  'json',
  'md',
  'markdown',
  'csv',
  'tsv',
  'log',
  'xml',
  'yaml',
  'yml',
  'ini',
  'cfg',
  'conf',
  'html',
  'htm',
  'css',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'cpp',
  'h',
  'sql',
  'toml',
  'env',
]);
const OFFICE_EXTS = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
]);

export function isImageDriveFile(file: DriveFile): boolean {
  if (file.icon_type === 'image') return true;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return IMAGE_EXTS.has(driveFileExt(file));
}

export function isVideoDriveFile(file: DriveFile): boolean {
  if (file.icon_type === 'video') return true;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  return VIDEO_EXTS.has(driveFileExt(file));
}

export function isPdfDriveFile(file: DriveFile): boolean {
  const mime = (file.mime_type || '').toLowerCase();
  if (mime === 'application/pdf' || mime.includes('pdf')) return true;
  return PDF_EXTS.has(driveFileExt(file));
}

export function isZipDriveFile(file: DriveFile): boolean {
  const mime = (file.mime_type || '').toLowerCase();
  if (
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'multipart/x-zip' ||
    mime.includes('zip')
  ) {
    return true;
  }
  const ext = driveFileExt(file);
  if (ext === 'zip') return true;
  const name = (file.original_name || file.name || '').toLowerCase();
  return name.endsWith('.zip');
}

export function isTextDriveFile(file: DriveFile): boolean {
  if (isPdfDriveFile(file) || isImageDriveFile(file) || isVideoDriveFile(file)) return false;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('yaml') ||
    mime.includes('javascript') ||
    mime.includes('csv')
  ) {
    return true;
  }
  return TEXT_EXTS.has(driveFileExt(file));
}

export function isOfficeDriveFile(file: DriveFile): boolean {
  const mime = (file.mime_type || '').toLowerCase();
  if (
    mime.includes('officedocument') ||
    mime.includes('msword') ||
    mime.includes('ms-excel') ||
    mime.includes('ms-powerpoint') ||
    mime.includes('opendocument')
  ) {
    return true;
  }
  return OFFICE_EXTS.has(driveFileExt(file));
}

/** Can show a meaningful in-app body (not just meta + download). */
export function canPreviewInApp(file: DriveFile): boolean {
  return (
    isImageDriveFile(file) ||
    isVideoDriveFile(file) ||
    isPdfDriveFile(file) ||
    isTextDriveFile(file) ||
    isZipDriveFile(file)
  );
}

/**
 * Whether the grid should load a visual thumbnail (photo / video frame / PDF page).
 * Text, JSON, code, etc. use FileTypeIcon only — content dumps look broken on cards
 * (and waste bandwidth). Backend may still set has_thumb for misclassified docs.
 */
export function canShowDriveThumb(file: DriveFile): boolean {
  // Never paint raw text/JSON as a full-bleed card image
  if (isTextDriveFile(file)) return false;
  if (file.has_thumb === true) return true;
  if (isImageDriveFile(file) || isVideoDriveFile(file)) return true;
  if (isPdfDriveFile(file)) return true;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
  if (mime === 'application/pdf') return true;
  const ext = driveFileExt(file);
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || PDF_EXTS.has(ext);
}

export function matchesMediaFilter(file: DriveFile, filter: DriveMediaFilter): boolean {
  // Links should only match the 'link' filter, never show up under 'all' or others
  if (file.icon_type === 'link') {
    return filter === 'link';
  }
  if (filter === 'link') {
    return false;
  }

  if (filter === 'all') return true;
  if (filter === 'image') return isImageDriveFile(file);
  if (filter === 'video') return isVideoDriveFile(file);
  // document = non image/video/link
  return !isImageDriveFile(file) && !isVideoDriveFile(file);
}

/**
 * Short type label for card meta (mp4 / jpg / foto / video / pdf / …).
 * Only returns "file" when type truly cannot be determined.
 */
export function formatDriveKindLabel(file: DriveFile): string {
  let ext = driveFileExt(file);
  // Normalize common aliases
  if (ext === 'jpeg' || ext === 'jfif') ext = 'jpg';
  if (ext === 'mpeg' || ext === 'mpg') ext = 'mpg';
  if (ext === '3gpp') ext = '3gp';

  // Prefer real extension when known
  if (ext && ext.length <= 8 && /^[a-z0-9]+$/i.test(ext)) {
    // Skip garbage "extensions" from caption names (e.g. whole words)
    if (!['file', 'bin', 'dat', 'tmp', 'unknown'].includes(ext)) {
      return ext.toLowerCase();
    }
  }

  // Fall back to mime subtype
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.includes('/')) {
    const sub = mime.split('/')[1]?.split(';')[0]?.trim() || '';
    if (sub && sub !== 'octet-stream' && sub !== 'unknown') {
      // image/jpeg → jpg, video/mp4 → mp4
      if (sub === 'jpeg' || sub === 'pjpeg') return 'jpg';
      if (sub === 'svg+xml') return 'svg';
      if (sub === 'x-matroska') return 'mkv';
      if (sub === 'quicktime') return 'mov';
      if (sub.length <= 10 && /^[a-z0-9.+-]+$/i.test(sub)) {
        return sub.replace(/^x-/, '').toLowerCase();
      }
    }
    if (mime.startsWith('image/')) return 'foto';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
  }

  // Fall back to icon_type
  const t = (file.icon_type || '').toLowerCase();
  if (t === 'image') return 'foto';
  if (t === 'video') return 'video';
  if (t === 'audio' || t === 'voice') return t === 'voice' ? 'voice' : 'audio';
  if (t === 'document') return 'dokumen';
  if (t === 'folder') return 'folder';

  return 'file';
}
