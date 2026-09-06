/** AutoGram Drive entity types (Telegram-Drive model). */
import { formatLocalizedBytes } from '../utils/i18nHelpers';

export type DriveIconType = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'file' | 'folder';

export type MediaScopeKind = 'all' | 'general' | 'topic';

export interface DriveMediaContext {
  accountId: string;
  peerId: string;
  scopeKind: MediaScopeKind;
  topicId: number | null;
}

export interface ThumbBatchV2ItemRequest {
  messageId: number;
  documentId?: string;
  dcId?: number;
  mimeType?: string;
  fileName?: string;
  visibleRank: number;
}

export interface ThumbBatchV2Request {
  windowLabel: string;
  generation: number;
  context: DriveMediaContext;
  quality: DriveThumbQuality;
  items: ThumbBatchV2ItemRequest[];
}

export interface ThumbCacheHit {
  messageId: number;
  localPath: string;
  quality: string;
}

export interface ThumbBatchV2Accepted {
  cacheHits: ThumbCacheHit[];
  queuedMessageIds: number[];
  rejectedMessageIds: number[];
}

export interface ThumbCompletedItemV2 {
  messageId: number;
  quality: DriveThumbQuality;
  localPath: string;
  width: number;
  height: number;
  source:
    | 'disk'
    | 'telegram-photo'
    | 'telegram-document'
    | 'telegram-video-thumb'
    | 'partial-image'
    | 'partial-video';
}

export interface ThumbReadyBatchEvent {
  accountId: string;
  peerId: string;
  scopeKind: MediaScopeKind;
  topicId: number | null;
  generation: number;
  completed: ThumbCompletedItemV2[];
  failed: Array<{
    messageId: number;
    code: string;
    retryable: boolean;
  }>;
}

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
  /**
   * Inline stripped mini-thumb from list_media (data:image/…).
   * Lets the grid paint like Telegram without waiting for thumbs_batch.
   */
  /** Explicit canonical Telegram peer ID (e.g. "-1004468191168" or "me") */
  peer_id?: string | null;
  /** Explicit account ID (session name or account identifier) */
  account_id?: string | null;
  peer_kind?: 'channel' | 'supergroup' | 'basic_group' | 'user' | 'saved_messages' | 'unknown' | string | null;
  peer_username?: string | null;
  grouped_id?: number | string | null;
  is_saved_messages?: boolean | null;
  thumb_data_url?: string | null;
  thumbDataUrl?: string | null;
  telegram_category?: string | null;
  telegram_subtype?: string | null;
  telegramCategory?: string | null;
  telegramSubtype?: string | null;
  drive_category?: string | null;
  drive_format?: string | null;
  driveCategory?: string | null;
  driveFormat?: string | null;
  /** Every URL contained in a Telegram message returned by the URL lane. */
  link_urls?: string[];
  /** Optional caption on media */
  caption?: string | null;
  /** Restricted / inaccessible media flags */
  is_restricted?: boolean | null;
  restriction_reason?: string | null;
  /** Short restriction error code or status code */
  restriction_code?: string | null;
};

export type ViewPerspective = 'telegram' | 'drive';

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
  /** Filesystem engine identity. Legacy verified [TD] Drives omit these fields. */
  engine_drive_id?: string | null;
  engine_folder_id?: string | null;
  /** Telegram peer used only as the storage backend for an engine Drive. */
  storage_peer_id?: number | null;
  /** Forum topic backing this logical folder; roots use the forum's General topic. */
  storage_topic_id?: number | null;
  source?: 'legacy' | 'engine';
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
  /** Telegram-authoritative access/content restriction for the active account. */
  is_restricted?: boolean;
  restriction_reason?: string | null;
  restriction_code?: string | null;
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

export type DriveGridLayoutOptions = {
  containerWidth: number;
  density: DriveGridZoom;
  gap?: number;
  padX?: number;
};

export type DriveGridLayoutResult = {
  columnCount: number;
  cardWidth: number;
  cardHeight: number;
  rowHeight: number;
};

/**
 * Pure calculation for grid card dimensions, row height, and column count.
 * Single source of truth for grid layout regardless of location or topic context.
 */
export function computeDriveGridLayout(opts: DriveGridLayoutOptions): DriveGridLayoutResult {
  const gap = opts.gap ?? 10;
  const padX = opts.padX ?? 28;
  const safeWidth = Number.isFinite(opts.containerWidth) && opts.containerWidth > 0 ? opts.containerWidth : 800;
  const columnCount = gridColumnsForWidth(safeWidth, opts.density, { gap, pad: padX });
  const innerW = Math.max(0, safeWidth - padX);
  const cardWidth = Math.max(
    48,
    columnCount > 0 ? (innerW - gap * (columnCount - 1)) / columnCount : innerW
  );
  const cardHeight = Math.round(cardWidth * (3 / 2));
  const rowHeight = cardHeight + gap;

  return {
    columnCount,
    cardWidth,
    cardHeight,
    rowHeight,
  };
}

/** Single-select sort presets for Drive media grid/list */
export type DriveSortMode =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'type_asc'
  | 'type_desc'
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
    id: 'type_asc',
    label: 'Tipe (A → Z)',
    short: 'Tipe A–Z',
    description: 'Urut berdasarkan tipe/format berkas',
  },
  {
    id: 'type_desc',
    label: 'Tipe (Z → A)',
    short: 'Tipe Z–A',
    description: 'Urut berdasarkan tipe/format berkas terbalik',
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
    v === 'type_asc' ||
    v === 'type_desc' ||
    v === 'size_desc' ||
    v === 'size_asc'
  );
}

export function fileTimeMs(f: DriveFile): number {
  const raw = f.created_at || (f as any).createdAt || (f as any).date;
  if (raw != null) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw > 1e11 ? raw : raw * 1000;
    }
    if (typeof raw === 'string') {
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) {
        return num > 1e11 ? num : num * 1000;
      }
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return (f.id || 0) * 1000;
}

export function getFileSortType(f: DriveFile): string {
  if (f.icon_type === 'folder') return ' 00_folder';
  if (f.icon_type === 'link') return ' 01_link';
  const ext = (f.file_ext || f.name?.split('.').pop() || '').toLowerCase();
  const icon = (f.icon_type || '').toLowerCase();
  const mime = (f.mime_type || '').toLowerCase();

  if (icon === 'video' || mime.startsWith('video/')) return `video_${ext || 'mp4'}`;
  if (icon === 'image' || icon === 'photo' || mime.startsWith('image/')) return `image_${ext || 'jpg'}`;
  if (icon === 'audio' || icon === 'voice' || mime.startsWith('audio/')) return `audio_${ext || 'mp3'}`;
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) return `archive_${ext}`;
  if (ext === 'pdf' || mime === 'application/pdf') return 'doc_pdf';
  if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return `doc_${ext}`;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return `sheet_${ext}`;
  if (['ppt', 'pptx'].includes(ext)) return `presentation_${ext}`;
  if (['exe', 'msi', 'apk', 'dmg'].includes(ext)) return `app_${ext}`;
  return ext ? `ext_${ext}` : 'zzz_unknown';
}

/**
 * Text patterns indicating restricted / inaccessible messages or channels
 * returned by Telegram MTProto or local indexers.
 */
export const RESTRICTED_MEDIA_PATTERNS: RegExp[] = [
  /this\s+(?:channel|message|group|media|content)\s+(?:can['’‘`´ʻʼʽˈˊˋ]?t|cannot|can\s+not)\s+be\s+displayed/i,
  /this\s+(?:channel|message|group|media|content)\s+(?:is|was)\s+(?:not\s+available|unavailable|blocked|banned|restricted)/i,
  /(?:can['’‘`´ʻʼʽˈˊˋ]?t|cannot|can\s+not)\s+be\s+displayed/i,
  /because\s+it\s+was\s+used\s+to\s+spread/i,
  /because\s+of\s+copyright\s+infringement/i,
  /due\s+to\s+(?:local\s+legal\s+regulations|terms\s+of\s+service|copyright)/i,
  /violated\s+local\s+laws/i,
  /saluran\s+ini\s+tidak\s+dapat\s+ditampilkan/i,
  /pesan\s+ini\s+tidak\s+dapat\s+ditampilkan/i,
  /grup\s+ini\s+tidak\s+dapat\s+ditampilkan/i,
  /media\s+ini\s+tidak\s+tersedia/i,
  /konten\s+ini\s+tidak\s+tersedia/i,
  /tidak\s+dapat\s+ditampilkan\s+karena/i,
  /karena\s+(?:melanggar\s+hak\s+cipta|digunakan\s+untuk\s+menyebarkan)/i,
  /saluran\s+(?:ini\s+)?diblokir/i,
  /banned\s+channel/i,
  /channel\s+blocked/i,
];

/**
 * Checks whether a drive file is an inaccessible or restricted Telegram item
 * (e.g. copyright blocks, porn/sensitive restrictions, banned channels).
 */
export function isRestrictedOrInaccessibleFile(f: DriveFile): boolean {
  if (!f) return false;
  if (f.is_restricted === true) return true;
  if (f.restriction_reason || f.restriction_code) return true;
  if (f.telegram_category === 'restricted' || f.drive_category === 'restricted') return true;

  const anyF = f as any;
  const name = String(f.name || '');
  const orig = String(f.original_name || '');
  const caption = String(f.caption || '');
  const mime = String(f.mime_type || '');
  const driveFormat = String(f.drive_format || anyF.driveFormat || '');
  const text = String(anyF.text || '');
  const message = String(anyF.message || '');
  const fileExt = String(f.file_ext || anyF.fileExt || '');

  const textToScan = `${name}\n${orig}\n${caption}\n${mime}\n${driveFormat}\n${text}\n${message}\n${fileExt}`;
  return RESTRICTED_MEDIA_PATTERNS.some((pattern) => pattern.test(textToScan));
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
    perspective?: ViewPerspective;
    hideRestrictedMedia?: boolean;
  } = {}
): DriveFile[] {
  const q = (opts.query || '').trim().toLowerCase();
  const mediaFilter = opts.mediaFilter ?? 'all';
  const sortMode = opts.sortMode ?? DEFAULT_DRIVE_SORT;
  const perspective = opts.perspective ?? 'telegram';
  const hideRestricted = opts.hideRestrictedMedia !== false;

  let list = files;
  if (hideRestricted) {
    list = list.filter((f) => !isRestrictedOrInaccessibleFile(f));
  }
  list = list.filter((f) => matchesMediaFilter(f, mediaFilter, perspective));
  if (q) {
    // Multi-token AND over name + type/mime/ext (current-location file search)
    const tokens = q.split(/\s+/).filter(Boolean);
    list = list.filter((f) => {
      const hay = [
        f.id.toString(),
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

/**
 * Constructing a numeric collator inside the sort comparator is very costly
 * for large Telegram histories (tens of thousands of comparisons per click).
 * Keep one immutable collator for every Drive name sort instead.
 */
const DRIVE_NAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** Compare two files for the given sort preset (stable ties via message id). */
export function compareDriveFiles(a: DriveFile, b: DriveFile, mode: DriveSortMode): number {
  let c = 0;
  const nameA = driveFileDisplayName(a);
  const nameB = driveFileDisplayName(b);
  const sizeA = Number(a.size) || 0;
  const sizeB = Number(b.size) || 0;

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
      c = DRIVE_NAME_COLLATOR.compare(nameA, nameB);
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'name_desc':
      c = DRIVE_NAME_COLLATOR.compare(nameB, nameA);
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'type_asc':
      c = DRIVE_NAME_COLLATOR.compare(getFileSortType(a), getFileSortType(b));
      if (c === 0) c = DRIVE_NAME_COLLATOR.compare(nameA, nameB);
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'type_desc':
      c = DRIVE_NAME_COLLATOR.compare(getFileSortType(b), getFileSortType(a));
      if (c === 0) c = DRIVE_NAME_COLLATOR.compare(nameA, nameB);
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'size_desc':
      c = sizeB - sizeA;
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    case 'size_asc':
      c = sizeA - sizeB;
      if (c === 0) c = (b.id || 0) - (a.id || 0);
      return c;
    default:
      return (b.id || 0) - (a.id || 0);
  }
}

/** Strip transient, bloated properties to keep RAM memory under 100MB for 50k+ datasets */
export function toLeanDriveFile(f: any): DriveFile {
  const id = typeof f.id === 'number' ? f.id : parseInt(String(f.id), 10);
  const mimeType = String(f.mime_type ?? f.mimeType ?? '').trim().toLowerCase() || null;
  const iconType = String(f.icon_type || f.iconType || 'file');
  const telegramCategory = String(f.telegram_category ?? f.telegramCategory ?? '').trim().toLowerCase();
  const telegramSubtype = String(f.telegram_subtype ?? f.telegramSubtype ?? '').trim().toLowerCase();
  const isWebPagePreview = telegramCategory === 'link' || telegramSubtype === 'webpage';
  const asDocument = Boolean(f.as_document ?? f.asDocument ?? false);
  const isNativeTelegramPhoto =
    Number.isFinite(id) &&
    id > 0 &&
    !asDocument &&
    !isWebPagePreview &&
    (
      telegramSubtype === 'photo' ||
      iconType.toLowerCase() === 'photo' ||
      (mimeType?.startsWith('image/') && iconType.toLowerCase() === 'image')
    );
  const canonicalPhotoName = isNativeTelegramPhoto ? `photo_${id}.jpg` : null;

  return {
    id,
    folder_id: f.folder_id ?? f.folderId ?? null,
    // Telegram photos do not have a server filename. Captions must never be
    // interpreted as filenames/extensions, including records restored from an
    // older persistent index.
    name: canonicalPhotoName || f.name || f.original_name || f.originalName || '',
    size: typeof f.size === 'number' ? f.size : parseInt(String(f.size || 0), 10) || 0,
    mime_type: canonicalPhotoName ? 'image/jpeg' : mimeType,
    file_ext: canonicalPhotoName ? 'jpg' : f.file_ext ?? f.fileExt ?? undefined,
    icon_type: isWebPagePreview ? 'link' : iconType,
    created_at: f.created_at ?? f.createdAt ?? undefined,
    has_thumb: !!f.has_thumb || !!f.hasThumb,
    as_document: asDocument,
    original_name: canonicalPhotoName ? null : f.original_name ?? f.originalName ?? null,
    topic_id: f.topic_id ?? f.topicId ?? null,
    peer_id: f.peer_id ?? f.peerId ?? '',
    account_id: f.account_id ?? f.accountId ?? null,
    peer_kind: f.peer_kind ?? f.peerKind ?? null,
    peer_username: f.peer_username ?? f.peerUsername ?? null,
    grouped_id: f.grouped_id ?? f.groupedId ?? null,
    is_saved_messages: !!f.is_saved_messages,
    duration: f.duration ?? f.duration_s ?? undefined,
    telegram_category: f.telegram_category ?? f.telegramCategory ?? null,
    telegram_subtype: f.telegram_subtype ?? f.telegramSubtype ?? null,
    drive_category: f.drive_category ?? f.driveCategory ?? null,
    drive_format: f.drive_format ?? f.driveFormat ?? null,
    link_urls: Array.isArray(f.link_urls ?? f.linkUrls) ? [...(f.link_urls ?? f.linkUrls)] : undefined,
    caption: f.caption ?? null,
    is_restricted: f.is_restricted ?? f.isRestricted ?? null,
    restriction_reason: f.restriction_reason ?? f.restrictionReason ?? null,
    restriction_code: f.restriction_code ?? f.restrictionCode ?? null,
  };
}

export type DriveMediaFilter =
  | 'all'
  | 'media'
  | 'files'
  | 'links'
  | 'gifs'
  | 'audio'
  | 'stickers'
  | 'image'
  | 'video'
  | 'document'
  | 'link'
  | 'images'
  | 'videos'
  | 'documents'
  | 'archives';

export function matchesMediaFilter(
  f: DriveFile,
  filter: DriveMediaFilter | string,
  perspective: ViewPerspective = 'telegram'
): boolean {
  const mime = (f.mime_type || '').toLowerCase();
  const name = (f.name || '').toLowerCase();
  const ext = (f.file_ext || name.split('.').pop() || '').toLowerCase();
  const icon = (f.icon_type || '').toLowerCase();
  const tgCat = (f.telegram_category || f.telegramCategory || '').toLowerCase();
  const drCat = (f.drive_category || f.driveCategory || '').toLowerCase();

  if (perspective === 'telegram') {
    if (tgCat === 'text' && (!f.link_urls || f.link_urls.length === 0) && !name.startsWith('http') && !name.startsWith('t.me') && icon === 'text') {
      return false;
    }
  }

  if (!filter || filter === 'all') {
    // Real Telegram stickers live exclusively in the Stickers lane. Keeping
    // them out of All prevents sticker inventory from inflating the normal
    // media/file catalog while ordinary WebP documents remain visible.
    return perspective !== 'telegram' || tgCat !== 'sticker';
  }

  if (perspective === 'telegram') {
    switch (filter) {
      case 'media':
        if (tgCat === 'sticker' || f.as_document === true || tgCat === 'file' || tgCat === 'link' || icon === 'link' || f.telegram_subtype === 'webpage') return false;
        return (
          tgCat === 'media' ||
          icon === 'photo' ||
          icon === 'video' ||
          icon === 'image' ||
          mime.startsWith('image/') ||
          mime.startsWith('video/')
        );
      case 'files':
        if (tgCat === 'sticker' || tgCat === 'text' || tgCat === 'link' || tgCat === 'restricted' || icon === 'text' || icon === 'link') return false;
        return (
          tgCat === 'file' ||
          f.as_document === true ||
          icon === 'file' ||
          icon === 'document' ||
          icon === 'archive' ||
          icon === 'apk' ||
          icon === 'code' ||
          icon === 'pdf' ||
          drCat === 'document' ||
          drCat === 'archive'
        );
      case 'links':
        if (tgCat === 'text' && !name.startsWith('http') && !name.startsWith('t.me')) return false;
        return (
          tgCat === 'link' ||
          mime === 'text/x-url' ||
          mime === 'text/html' ||
          name.startsWith('http') ||
          name.startsWith('t.me') ||
          icon === 'link' ||
          (Array.isArray(f.link_urls) && f.link_urls.length > 0)
        );
      case 'gifs':
        if (tgCat === 'sticker') return false;
        return tgCat === 'gif' || mime === 'image/gif' || ext === 'gif' || icon === 'gif' || (f.telegram_subtype && f.telegram_subtype.includes('gif')) === true;
      case 'audio':
        return tgCat === 'audio' || icon === 'audio' || icon === 'voice' || mime.startsWith('audio/');
      case 'stickers':
        return tgCat === 'sticker';
      default:
        if (filter === 'image') return icon === 'image' || icon === 'photo';
        if (filter === 'video') return icon === 'video';
        if (filter === 'document') return icon === 'document' || icon === 'file';
        if (filter === 'link') return mime === 'text/x-url';
        return true;
    }
  } else {
    switch (filter) {
      case 'images':
      case 'image':
        return (
          drCat === 'image' ||
          mime.startsWith('image/') ||
          ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'heic'].includes(ext)
        );
      case 'videos':
      case 'video':
        return (
          drCat === 'video' ||
          mime.startsWith('video/') ||
          ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', '3gp', 'flv', 'wmv', 'ts'].includes(ext)
        );
      case 'audio':
        return (
          drCat === 'audio' ||
          mime.startsWith('audio/') ||
          ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'].includes(ext)
        );
      case 'documents':
      case 'document':
        return (
          drCat === 'document' ||
          ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'csv'].includes(ext)
        );
      case 'archives':
        return (
          drCat === 'archive' ||
          ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'].includes(ext) ||
          mime.includes('zip') ||
          mime.includes('compressed')
        );
      case 'web':
        return drCat === 'web' || mime === 'text/x-url' || name.startsWith('http');
      default:
        return true;
    }
  }
}

export * from './driveTransferSettings';
export type DriveThumbQuality = 'saver' | 'balanced' | 'sharp';

export const DEFAULT_THUMB_QUALITY: DriveThumbQuality = 'saver';

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
  | 'skipped'
  /** File was deleted from destination and has been re-uploaded */
  | 'reuploaded';

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
  /** True when this file was re-uploaded (deleted from destination then re-sent) */
  reuploaded?: boolean;
  /** Why the file was re-uploaded */
  reuploadReason?: string;
  /** The original message_id that was deleted */
  originalMessageId?: number;
  /** Timestamp when deletion was detected */
  deletedAt?: number;
};

export type ScanStats = {
  recentScanned: number;
  sampledScanned: number;
  dbCachedLoaded: number;
  newFromTg: number;
  duplicateHits: number;
  skippedNoMedia: number;
  circuitOpen: boolean;
  totalScanned: number;
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
  /** Pre-scan phase: 'idle' | 'cache_warmup' | 'recent' | 'sampling' | 'forensic' | 'done' */
  scanPhase?: string;
  /** Current scan progress (messages scanned so far) */
  scanScanned?: number;
  /** Estimated total messages for scan */
  scanTotal?: number | null;
  /** Full scan stats after pre-scan completes */
  scanStats?: ScanStats;
  /** Count of items re-uploaded (were deleted from destination) */
  reuploadedCount?: number;
  /** Count of items pending guardrail confirmation */
  guardrailPendingCount?: number;
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
  return formatLocalizedBytes(n);
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

const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'heic',
  'heif',
  'tif',
  'tiff',
  'jfif',
  'avif',
  'ico',
  'cur',
  'svg',
  'svgz',
  'dng',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'orf',
  'rw2',
  'raf',
  'pef',
  'x3f',
  'psd',
  'psb',
  'ai',
  'eps',
  'hdr',
  'exr',
  'tga',
]);

const VIDEO_EXTS = new Set([
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  '3gp',
  '3g2',
  'mpeg',
  'mpg',
  'mpe',
  'mpv',
  'ts',
  'm2ts',
  'vob',
  'wmv',
  'flv',
  'ogv',
  'asf',
  'rm',
  'rmvb',
  'divx',
  'f4v',
  'mxf',
  'prores',
  'r3d',
  'braw',
]);

const PDF_EXTS = new Set(['pdf']);

const TEXT_EXTS = new Set([
  // plain / data
  'txt',
  'text',
  'json',
  'jsonc',
  'json5',
  'jsonl',
  'ndjson',
  'geojson',
  'topojson',
  'ipynb',
  'md',
  'markdown',
  'mdx',
  'rst',
  'adoc',
  'tex',
  'bib',
  'csv',
  'tsv',
  'tab',
  'log',
  'trace',
  'err',
  'out',
  'audit',
  'xml',
  'plist',
  'kml',
  'gpx',
  'yaml',
  'yml',
  'ini',
  'cfg',
  'conf',
  'config',
  'properties',
  'env',
  'toml',
  'lock',
  // web
  'html',
  'htm',
  'xhtml',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'astro',
  // scripting / backend
  'py',
  'pyi',
  'pyw',
  'rb',
  'php',
  'pl',
  'pm',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'psm1',
  'bat',
  'cmd',
  'lua',
  'r',
  'jl',
  'ex',
  'exs',
  'erl',
  'clj',
  'cljs',
  'scala',
  'kt',
  'kts',
  'swift',
  'dart',
  'groovy',
  'gradle',
  // systems languages
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'hxx',
  'm',
  'mm',
  'cs',
  'fs',
  'fsx',
  'go',
  'rs',
  'java',
  'sql',
  'prisma',
  'graphql',
  'gql',
  'proto',
  // devops
  'dockerfile',
  'makefile',
  'cmake',
  'tf',
  'hcl',
  'nix',
  'vim',
  'diff',
  'patch',
  'http',
  'rest',
  // subtitles & communication
  'srt',
  'vtt',
  'ass',
  'ssa',
  'lrc',
  'vcf',
  'vcard',
  'ics',
  'ical',
  'mmd',
  'mermaid',
  'dot',
  'gv',
  'crt',
  'cer',
  'pem',
  // office (plain-text extract in worker / Rust)
  'doc',
  'docx',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odp',
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

const AUDIO_EXTS = new Set([
  'mp3',
  'm4a',
  'm4b',
  'ogg',
  'flac',
  'wav',
  'opus',
  'aac',
  'wma',
  'alac',
  'aiff',
  'aif',
  'ape',
  'mid',
  'midi',
  'ac3',
  'eac3',
  'dts',
  'amr',
  'mka',
  'dsd',
  'dsf',
  'dff',
  'ra',
]);

export function isAudioDriveFile(file: DriveFile): boolean {
  if (file.icon_type === 'audio' || file.icon_type === 'voice') return true;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('audio/')) return true;
  return AUDIO_EXTS.has(driveFileExt(file));
}

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

export function isTgsDriveFile(file: DriveFile): boolean {
  const ext = driveFileExt(file);
  if (ext === 'tgs') return true;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime === 'application/x-tgsticker' || mime.includes('tgsticker')) return true;
  const name = (file.original_name || file.name || '').toLowerCase();
  return name.endsWith('.tgs');
}

export function isTextDriveFile(file: DriveFile): boolean {
  if (file.icon_type === 'link') return false;
  if (isPdfDriveFile(file) || isImageDriveFile(file) || isVideoDriveFile(file) || isAudioDriveFile(file)) return false;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('yaml') ||
    mime.includes('javascript') ||
    mime.includes('ecmascript') ||
    mime.includes('typescript') ||
    mime.includes('csv') ||
    mime.includes('toml') ||
    mime.includes('graphql') ||
    mime === 'application/x-sh' ||
    mime === 'application/sql'
  ) {
    return true;
  }
  // Office OOXML / ODF / RTF — worker extracts plain text for in-app body
  const ext = driveFileExt(file);
  if (['docx', 'odt', 'rtf', 'xlsx', 'ods', 'pptx', 'odp'].includes(ext)) return true;
  return TEXT_EXTS.has(ext);
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
    isAudioDriveFile(file) ||
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
  // If Telegram or backend explicitly provides a thumbnail payload for this file, display it
  if (file.has_thumb === true || !!file.thumb_data_url || !!file.thumbDataUrl) return true;
  if (file.icon_type === 'link') return false;
  if (isTextDriveFile(file) || isZipDriveFile(file) || isOfficeDriveFile(file)) return false;
  if (isImageDriveFile(file) || isVideoDriveFile(file) || isPdfDriveFile(file) || isAudioDriveFile(file)) return true;
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime === 'application/pdf') return true;
  const ext = driveFileExt(file);
  if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || PDF_EXTS.has(ext)) return true;
  // Document/file items (e.g. photos/videos sent as files, PDFs, custom media, or msg 73 without static thumbs):
  // allow backend sample chunk extraction unless text/zip
  return !!(file.as_document || file.icon_type === 'document' || file.icon_type === 'file');
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
