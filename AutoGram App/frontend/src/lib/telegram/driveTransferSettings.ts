/** Transfer settings contracts and persistence helpers for Cloud Drives. */
export type QualityMode = 'HIGH_QUALITY' | 'SMART' | 'ORIGINAL';
export type ReencodeHardware =
  | 'auto'
  | 'nvidia'
  | 'amd'
  | 'intel'
  | 'cpu'
  | `device:${'nvenc' | 'amf' | 'qsv'}:${number}:${string}`;
export type ReencodePreset = 'speed' | 'balanced' | 'quality';
export type PresentationOverride = 'automatic' | 'force_document' | 'force_native_media';
export type AlbumPacking = 'smart_adaptive' | 'maximum' | 'balanced' | 'custom' | 'follow_selection' | 'never';
export type AlbumFailurePolicy = 'atomic_strict' | 'retry_prepare' | 'replan_group' | 'send_remaining' | 'send_failed_separately' | 'cancel_group' | 'best_effort_advanced';
export type OversizeAction = 'auto_adaptive' | 'fit_to_limit' | 'split' | 'alternate_account' | 'skip';
export type AlbumAlternateStrategy = 'separate_item' | 'move_whole_group' | 'cancel_group';
/** How to handle unsupported image formats (WebP, HEIC, BMP, TIFF, etc.) when Album mode is active.
 *  'document' = send as document with auto-thumbnail (quality preserved).
 *  'transcode' = transcode to JPEG Q92 to include in the album. */
export type AlbumIncompatImageMode = 'document' | 'transcode';
/** How to handle animated/sticker formats (GIF, TGS, WebM sticker) when Album mode is active.
 *  'document' = send as document with auto-thumbnail (quality preserved).
 *  'transcode' = transcode to MP4 loop animation to include in the album. */
export type AlbumIncompatAnimMode = 'document' | 'transcode';

export type VideoTranscodeScope = 'all_non_mp4' | 'common_containers' | 'legacy_broadcast' | 'custom' | 'none';

export type ImageTranscodeScope = 'all_incompatible' | 'common_web' | 'graphics_raw' | 'custom' | 'none';
export type ImageTranscodeTarget = 'png' | 'jpeg';

export const ALL_IMAGE_TRANSCODE_FORMATS = [
  'png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'
] as const;

export const ALL_VIDEO_TRANSCODE_FORMATS = [
  'mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'
] as const;
export type EncoderStrategy = 'auto_adaptive' | 'hardware_preferred' | 'software_preferred' | 'hardware_only' | 'software_only' | 'specific_device' | 'disable_reencode';
export type EncoderResourceProfile = 'eco' | 'balanced' | 'performance' | 'custom';
export type DownloadConflictPolicy = 'ask' | 'rename' | 'overwrite' | 'skip';
export type DownloadIntegrity = 'size' | 'sha256';
export type CaptionOverflowPolicy = 'truncate_with_warning' | 'fail' | 'split';
export type CaptionPosition = 'on_media' | 'on_media_above' | 'before_media' | 'after_media' | 'none';
export type PlaybackBackendChoice = 'auto' | 'd3d11va' | 'd3d12va' | 'nvdec' | 'vulkan' | 'software';
export type PlaybackFpsMode = 'adaptive' | 'follow_source' | 'follow_display' | 'manual_cap';

export type ScanMode = 'normal' | 'smart' | 'forensic';
export type TopicScope = 'selected_only' | 'selected_plus_general' | 'all_topics';
/** Remote URL transport preference (Cloud Direct vs Local Spool). */
export type RemoteEngineMode = 'auto' | 'cloud_fetch' | 'storage_local';

/** Storage local sub-policy for remote transmission. */
export type StorageLocalPolicy = 'telegram' | 'custom_disk' | 'disk_and_telegram';

/** Upload + download preferences for Media Studio (persisted in localStorage). */
export type DriveTransferSettings = {
  /** Validate local inputs, Telegram session/peer, and item visibility without mutating either side. */
  dryRun: boolean;
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
  /** One-based batch positions that override spoiler for selected items, for example 1,3-5 */
  spoilerItemPositions: string;
  /** Optional local datetime for Telegram scheduled delivery */
  scheduleAt: string;
  /** Optional Telegram peer identifier used as send-as identity */
  sendAs: string;
  /** Preferred original document send (no photo compression) — alias of ORIGINAL for clarity */
  forceDocumentDefault: boolean;
  /** Prevent Telegram sticker conversion by transcoding .webp/.tgs/.webm to standard media before upload */
  preventStickerConversion?: boolean;
  /** Duplicate resolution policy: 'SKIP' (default) or 'FORCE_UPLOAD' (always upload) */
  duplicatePolicy: 'SKIP' | 'FORCE_UPLOAD';
  /** Destination scan depth mode */
  scanMode: ScanMode;
  /** Whether to ask user before re-uploading recently deleted files */
  guardrailEnabled: boolean;
  /** Re-upload confirmation threshold in days (3-30) */
  guardrailThresholdDays: number;
  /** Which messages to include in the destination pre-scan for forum topics */
  topicScope: TopicScope;
  /** Max re-uploads per hour rate limit */
  maxReuploadPerHour: number;
  /** Whether global caption feature is active */
  enableGlobalCaption?: boolean;
  /** Batch caption; album mode assigns it to exactly one surviving item. */
  globalCaption: string;
  /** Explicit behavior when Telegram's live UTF-16 caption limit is exceeded. */
  captionOverflowPolicy: CaptionOverflowPolicy;
  /** Telegram parse mode for global caption: MarkdownV2 | HTML | Plain */
  captionParseMode?: 'MarkdownV2' | 'HTML' | 'Plain';
  /** Show caption above media in message bubble */
  captionAbove?: boolean;
  /** Caption placement strategy: on_media | on_media_above | before_media | after_media | none */
  captionPosition?: CaptionPosition;
  /** After upload finishes, refresh file list (recommended) */
  refreshAfterUpload: boolean;
  /** Automatically retry transfers on connection timeout or network drops */
  autoRetryOnNetworkError?: boolean;
  /** Smart Rate Controller auto-pause & resume on FloodWaitError */
  smartRateControlEnabled?: boolean;
  /** Enable verbose debugging log outputs for system diagnostics */
  debugLoggingEnabled?: boolean;
  /** After download finishes, show status with folder path */
  notifyDownloadDone: boolean;
  reencodeHardware: ReencodeHardware;
  /** Quality/speed tradeoff for video re-encoding */
  reencodePreset: ReencodePreset;
  presentationOverride: PresentationOverride;
  albumPacking: AlbumPacking;
  albumGroupSize: number;
  albumAvoidSingle: boolean;
  albumFailurePolicy: AlbumFailurePolicy;
  groupDocuments: boolean;
  groupAudio: boolean;
  groupOriginalDocuments: boolean;
  oversizeAction: OversizeAction;
  alternateAccountPool: string;
  alternateIdentityApproved: boolean;
  albumAlternateStrategy: AlbumAlternateStrategy;
  /** How incompatible image formats (WebP, HEIC, BMP, TIFF, etc.) are handled when Album is active.
   *  'document' = send as document with auto-thumbnail (default, quality preserved).
   *  'transcode' = transcode to JPEG Q92 to include in the album. */
  albumIncompatImageMode: AlbumIncompatImageMode;
  /** How animated/sticker formats (GIF, TGS, WebM sticker) are handled when Album is active.
   *  'document' = send as document with auto-thumbnail (default, quality preserved).
   *  'transcode' = transcode to MP4 loop animation to include in the album. */
  albumIncompatAnimMode: AlbumIncompatAnimMode;
  /** Scope of video containers to automatically remux/re-encode to MP4 in Smart/HighQuality modes:
   *  'all_non_mp4' = all video containers (MKV, MOV, WebM, AVI, WMV, TS, FLV, M2TS, VOB, OGV, 3GP, etc.)
   *  'common_containers' = popular containers only (MKV, MOV, WebM, AVI, 3GP)
   *  'legacy_broadcast' = legacy/broadcast formats only (WMV, TS, FLV, M2TS, VOB, OGV, F4V, ASF)
   *  'none' = do not transcode any non-MP4 videos (send as raw documents) */
  videoTranscodeScope: VideoTranscodeScope;
  /** Explicit list of video file extensions to remux/re-encode to MP4 (e.g. ['mkv', 'mov', 'webm']) */
  videoTranscodeFormats: string[];
  /** Scope of incompatible image formats to transcode: 'all_incompatible' | 'common_web' | 'graphics_raw' | 'custom' | 'none' */
  imageTranscodeScope: ImageTranscodeScope;
  /** Target format for transcoded images: 'png' (100% lossless bit-exact) or 'jpeg' (100% maximum quality Q100) */
  imageTranscodeTarget: ImageTranscodeTarget;
  /** Explicit list of image extensions to transcode to target format */
  imageTranscodeFormats: string[];
  encoderStrategy: EncoderStrategy;
  encoderResourceProfile: EncoderResourceProfile;
  encoderMaxParallel: number;
  encoderAllowSoftwareFallback: boolean;
  downloadConflictPolicy: DownloadConflictPolicy;
  downloadResumePartial: boolean;
  downloadIntegrity: DownloadIntegrity;
  /** Local playback / preview GPU acceleration hardware mode */
  playbackHwDecoding?: 'auto' | 'gpu_hardware' | 'software' | 'disabled';
  /** Preferred playback hardware decoder backend */
  playbackBackendChoice?: PlaybackBackendChoice;
  /** Specific DXGI GPU adapter LUID or identifier */
  playbackAdapterId?: string;
  /** Direct GPU texture sharing to prevent CPU memory copies */
  playbackZeroCopy?: boolean;
  /** Frame scheduling policy for high-refresh rate displays & VFR sources */
  playbackFpsMode?: PlaybackFpsMode;
  /** Max FPS target for local video preview (0 = Unlimited / Native display refresh rate) */
  playbackTargetFps?: number;
  /** Maximum VRAM cap for seek frame buffers in MB */
  playbackMaxVramMb?: number;
  /** RAM seek cache size in MB */
  playbackSeekCacheMb?: number;
  /** Show real-time telemetry overlay on video player */
  playbackShowDiagnostics?: boolean;
  /** Remember the last local audio/video position for this account and file. */
  rememberPlaybackPosition?: boolean;
  /** Adaptive Data Saver: limits video preview buffer to ~40s ahead of playback position to save data quota. */
  playbackDataSaver?: boolean;
  /** Automatically filter out and hide restricted/inaccessible messages and media (e.g. "This channel can't be displayed...") */
  hideRestrictedMedia?: boolean;
  /** Remote URL transport preference. Auto uses cloud fetch for known <=20 MiB direct files. */
  remoteEngineMode?: RemoteEngineMode;
  /** Hide HLS/DASH manifests from normal Remote URL transfer choices. */
  remoteHideManifests?: boolean;
  /** Enable the bundled yt-dlp resolver for Remote URL inspections. */
  ytdlpEnabled?: boolean;
  /** Allow the resolver plugin to refresh itself from the latest yt-dlp release. */
  ytdlpAutoUpdate?: boolean;
  /** How often the plugin checks GitHub for a newer release. */
  ytdlpCheckIntervalHours?: number;
  /** Custom path to yt-dlp executable */
  ytdlpCustomPath?: string;
  /** Cookies mode for yt-dlp */
  ytdlpCookiesMode?: 'none' | 'browser' | 'file';
  /** Browser name to extract cookies from */
  ytdlpCookiesBrowser?: string;
  /** File path for cookies.txt */
  ytdlpCookiesPath?: string;
  /** Proof of Origin token for YouTube */
  ytdlpPoToken?: string;
  /** Custom extractor args for yt-dlp */
  ytdlpExtractorArgs?: string;
  /** Additional custom command line arguments for yt-dlp */
  ytdlpCustomArgs?: string;
  /** Custom path to ffmpeg executable */
  ffmpegCustomPath?: string;
  /** Automatically mux video and audio streams using FFmpeg */
  ytdlpAutoMuxFfmpeg?: boolean;
};

export type DriveTransferSettingsProfile = {
  id: string;
  name: string;
  updatedAt: number;
  settings: DriveTransferSettings;
};

export function isScanMode(v: unknown): v is ScanMode {
  return v === 'normal' || v === 'smart' || v === 'forensic';
}

export function isTopicScope(v: unknown): v is TopicScope {
  return v === 'selected_only' || v === 'selected_plus_general' || v === 'all_topics';
}

export const DEFAULT_TRANSFER_SETTINGS: DriveTransferSettings = {
  dryRun: false,
  qualityMode: 'SMART',
  uploadConcurrency: 4,
  downloadConcurrency: 4,
  groupAsAlbum: false,

  silent: false,
  spoiler: false,
  spoilerItemPositions: '',
  scheduleAt: '',
  sendAs: '',
  forceDocumentDefault: false,
  preventStickerConversion: false,
  duplicatePolicy: 'SKIP',
  scanMode: 'smart',
  guardrailEnabled: true,
  guardrailThresholdDays: 7,
  topicScope: 'selected_plus_general',
  maxReuploadPerHour: 10,
  enableGlobalCaption: false,
  globalCaption: '',
  captionOverflowPolicy: 'truncate_with_warning',
  captionParseMode: 'MarkdownV2',
  captionAbove: false,
  captionPosition: 'on_media',
  refreshAfterUpload: true,
  notifyDownloadDone: true,
  reencodeHardware: 'auto',
  reencodePreset: 'balanced',
  presentationOverride: 'automatic',
  albumPacking: 'smart_adaptive',
  albumGroupSize: 10,
  albumAvoidSingle: true,
  albumFailurePolicy: 'send_failed_separately',
  groupDocuments: true,
  groupAudio: true,
  groupOriginalDocuments: true,
  oversizeAction: 'auto_adaptive',
  alternateAccountPool: '',
  alternateIdentityApproved: false,
  albumAlternateStrategy: 'cancel_group',
  albumIncompatImageMode: 'document',
  albumIncompatAnimMode: 'document',
  videoTranscodeScope: 'all_non_mp4',
  videoTranscodeFormats: [
    'mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'
  ],
  imageTranscodeScope: 'none',
  imageTranscodeTarget: 'jpeg',
  imageTranscodeFormats: [],
  encoderStrategy: 'auto_adaptive',
  encoderResourceProfile: 'balanced',
  encoderMaxParallel: 1,
  encoderAllowSoftwareFallback: true,
  downloadConflictPolicy: 'ask',
  downloadResumePartial: true,
  downloadIntegrity: 'size',
  playbackHwDecoding: 'auto',
  playbackBackendChoice: 'auto',
  playbackAdapterId: '',
  playbackZeroCopy: true,
  playbackFpsMode: 'adaptive',
  playbackTargetFps: 0,
  playbackMaxVramMb: 1024,
  playbackSeekCacheMb: 256,
  playbackShowDiagnostics: false,
  rememberPlaybackPosition: true,
  playbackDataSaver: true,
  hideRestrictedMedia: true,
  remoteEngineMode: 'auto',
  remoteHideManifests: true,
  ytdlpEnabled: true,
  ytdlpAutoUpdate: true,
  ytdlpCheckIntervalHours: 6,
  ytdlpCustomPath: '',
  ytdlpCookiesMode: 'none',
  ytdlpCookiesBrowser: 'chrome',
  ytdlpCookiesPath: '',
  ytdlpPoToken: '',
  ytdlpExtractorArgs: '',
  ytdlpCustomArgs: '',
  ffmpegCustomPath: '',
  ytdlpAutoMuxFfmpeg: true,
};

export const QUALITY_MODE_OPTIONS: {
  id: QualityMode;
}[] = [
  { id: 'HIGH_QUALITY' },
  { id: 'SMART' },
  { id: 'ORIGINAL' },
];

export function clampConcurrency(n: unknown, fallback = 4): number {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return fallback;
  return Math.max(1, Math.min(10, x));
}

export function isQualityMode(v: unknown): v is QualityMode {
  return v === 'HIGH_QUALITY' || v === 'SMART' || v === 'ORIGINAL';
}

export function isReencodeHardware(v: unknown): v is ReencodeHardware {
  return v === 'auto'
    || v === 'nvidia'
    || v === 'amd'
    || v === 'intel'
    || v === 'cpu'
    || (typeof v === 'string' && /^device:(nvenc|amf|qsv):\d+:[a-f0-9]{16}$/i.test(v));
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
      dryRun: p.dryRun === true,
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
      spoilerItemPositions: typeof p.spoilerItemPositions === 'string'
        ? p.spoilerItemPositions.replace(/[^0-9,\-\s]/g, '').slice(0, 128)
        : '',
      scheduleAt: typeof p.scheduleAt === 'string' ? p.scheduleAt.slice(0, 32) : '',
      sendAs: typeof p.sendAs === 'string' ? p.sendAs.trim().slice(0, 128) : '',
      forceDocumentDefault: !!p.forceDocumentDefault,
      preventStickerConversion: Boolean(p.preventStickerConversion),
      duplicatePolicy: p.duplicatePolicy === 'FORCE_UPLOAD' ? 'FORCE_UPLOAD' : 'SKIP',
      scanMode: isScanMode(p.scanMode) ? p.scanMode : DEFAULT_TRANSFER_SETTINGS.scanMode,
      guardrailEnabled: p.guardrailEnabled !== false,
      guardrailThresholdDays: (
        typeof p.guardrailThresholdDays === 'number'
        && p.guardrailThresholdDays >= 3
        && p.guardrailThresholdDays <= 30
      ) ? p.guardrailThresholdDays : DEFAULT_TRANSFER_SETTINGS.guardrailThresholdDays,
      topicScope: isTopicScope(p.topicScope) ? p.topicScope : DEFAULT_TRANSFER_SETTINGS.topicScope,
      maxReuploadPerHour: (
        typeof p.maxReuploadPerHour === 'number' && p.maxReuploadPerHour >= 1
      ) ? Math.min(p.maxReuploadPerHour, 100) : DEFAULT_TRANSFER_SETTINGS.maxReuploadPerHour,
      globalCaption: typeof p.globalCaption === 'string' ? p.globalCaption.slice(0, 65_536) : '',
      captionOverflowPolicy: p.captionOverflowPolicy === 'fail' ? 'fail' : 'truncate_with_warning',
      refreshAfterUpload: p.refreshAfterUpload !== false,
      notifyDownloadDone: p.notifyDownloadDone !== false,
      reencodeHardware: isReencodeHardware(p.reencodeHardware) ? p.reencodeHardware : DEFAULT_TRANSFER_SETTINGS.reencodeHardware,
      reencodePreset: isReencodePreset(p.reencodePreset) ? p.reencodePreset : DEFAULT_TRANSFER_SETTINGS.reencodePreset,
      presentationOverride: ['automatic', 'force_document', 'force_native_media'].includes(String(p.presentationOverride))
        ? p.presentationOverride!
        : p.forceDocumentDefault
          ? 'force_document'
          : DEFAULT_TRANSFER_SETTINGS.presentationOverride,
      albumPacking: ['smart_adaptive', 'maximum', 'balanced', 'custom', 'follow_selection', 'never'].includes(String(p.albumPacking)) ? p.albumPacking! : DEFAULT_TRANSFER_SETTINGS.albumPacking,
      albumGroupSize: Math.max(2, Math.min(10, Number(p.albumGroupSize) || DEFAULT_TRANSFER_SETTINGS.albumGroupSize)),
      albumAvoidSingle: p.albumAvoidSingle !== false,
      albumFailurePolicy: ['atomic_strict', 'retry_prepare', 'replan_group', 'send_remaining', 'send_failed_separately', 'cancel_group', 'best_effort_advanced'].includes(String(p.albumFailurePolicy))
        ? p.albumFailurePolicy!
        : String(p.albumFailurePolicy) === 'retry_group'
          ? 'retry_prepare'
          : String(p.albumFailurePolicy) === 'keep_delivered'
            ? 'send_remaining'
            : String(p.albumFailurePolicy) === 'stop_group'
              ? 'cancel_group'
              : 'atomic_strict',
      groupDocuments: p.groupDocuments !== false,
      groupAudio: p.groupAudio !== false,
      groupOriginalDocuments: p.groupOriginalDocuments !== false,
      oversizeAction: ['auto_adaptive', 'fit_to_limit', 'split', 'alternate_account', 'skip'].includes(String(p.oversizeAction)) ? p.oversizeAction! : DEFAULT_TRANSFER_SETTINGS.oversizeAction,
      alternateAccountPool: typeof p.alternateAccountPool === 'string'
        ? p.alternateAccountPool.replace(/[^a-zA-Z0-9_.\-,\s]/g, '').slice(0, 512)
        : '',
      alternateIdentityApproved: p.alternateIdentityApproved === true,
      albumAlternateStrategy: ['separate_item', 'move_whole_group', 'cancel_group'].includes(String(p.albumAlternateStrategy))
        ? p.albumAlternateStrategy!
        : 'cancel_group',
      albumIncompatImageMode: p.albumIncompatImageMode === 'transcode' ? 'transcode' : 'document',
      albumIncompatAnimMode: p.albumIncompatAnimMode === 'transcode' ? 'transcode' : 'document',
      videoTranscodeScope: (typeof p.videoTranscodeScope === 'string' && ['all_non_mp4', 'common_containers', 'legacy_broadcast', 'custom', 'none'].includes(p.videoTranscodeScope)
        ? p.videoTranscodeScope
        : 'all_non_mp4') as VideoTranscodeScope,
      // An explicitly empty custom/none list means "convert nothing".  Do not
      // resurrect the default list on reload; doing so made a user-selected
      // raw-document policy silently turn back into transcoding.
      videoTranscodeFormats: Array.isArray(p.videoTranscodeFormats)
        ? p.videoTranscodeFormats.map((ext: any) => String(ext).toLowerCase().trim()).filter(Boolean)
        : [
            'mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'
          ],
      imageTranscodeScope: (typeof p.imageTranscodeScope === 'string' && ['all_incompatible', 'common_web', 'graphics_raw', 'custom', 'none'].includes(p.imageTranscodeScope)
        ? p.imageTranscodeScope
        : 'all_incompatible') as ImageTranscodeScope,
      imageTranscodeTarget: (typeof p.imageTranscodeTarget === 'string' && ['png', 'jpeg'].includes(p.imageTranscodeTarget)
        ? p.imageTranscodeTarget
        : 'jpeg') as ImageTranscodeTarget,
      imageTranscodeFormats: Array.isArray(p.imageTranscodeFormats)
        ? p.imageTranscodeFormats.map((ext: any) => String(ext).toLowerCase().trim()).filter(Boolean)
        : [
            'png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'
          ],
      encoderStrategy: ['auto_adaptive', 'hardware_preferred', 'software_preferred', 'hardware_only', 'software_only', 'specific_device', 'disable_reencode'].includes(String(p.encoderStrategy)) ? p.encoderStrategy! : DEFAULT_TRANSFER_SETTINGS.encoderStrategy,
      encoderResourceProfile: ['eco', 'balanced', 'performance', 'custom'].includes(String(p.encoderResourceProfile)) ? p.encoderResourceProfile! : DEFAULT_TRANSFER_SETTINGS.encoderResourceProfile,
      encoderMaxParallel: Math.max(1, Math.min(4, Number(p.encoderMaxParallel) || DEFAULT_TRANSFER_SETTINGS.encoderMaxParallel)),
      encoderAllowSoftwareFallback: p.encoderAllowSoftwareFallback !== false,
      downloadConflictPolicy: ['ask', 'rename', 'overwrite', 'skip'].includes(String(p.downloadConflictPolicy)) ? p.downloadConflictPolicy! : DEFAULT_TRANSFER_SETTINGS.downloadConflictPolicy,
      downloadResumePartial: p.downloadResumePartial !== false,
      downloadIntegrity: p.downloadIntegrity === 'sha256' ? 'sha256' : 'size',
      hideRestrictedMedia: p.hideRestrictedMedia !== false,
      remoteEngineMode: p.remoteEngineMode === 'cloud_fetch' || p.remoteEngineMode === 'storage_local'
        ? p.remoteEngineMode
        : DEFAULT_TRANSFER_SETTINGS.remoteEngineMode,
      ytdlpEnabled: p.ytdlpEnabled !== false,
      ytdlpAutoUpdate: p.ytdlpAutoUpdate !== false,
      ytdlpCheckIntervalHours: Math.max(1, Math.min(168, Number(p.ytdlpCheckIntervalHours) || 6)),
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

const TRANSFER_PROFILE_STORAGE_KEY = 'autogram_drive_transfer_profiles_v1';

export function loadTransferSettingsProfiles(): DriveTransferSettingsProfile[] {
  try {
    const raw = localStorage.getItem(TRANSFER_PROFILE_STORAGE_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row): row is DriveTransferSettingsProfile => (
        !!row
        && typeof row.id === 'string'
        && typeof row.name === 'string'
        && row.settings
        && typeof row.settings === 'object'
      ))
      .map((row) => ({
        id: row.id,
        name: row.name.slice(0, 80),
        updatedAt: Number(row.updatedAt) || 0,
        settings: { ...DEFAULT_TRANSFER_SETTINGS, ...row.settings },
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveTransferSettingsProfiles(profiles: DriveTransferSettingsProfile[]): void {
  try {
    localStorage.setItem(TRANSFER_PROFILE_STORAGE_KEY, JSON.stringify(profiles.slice(0, 50)));
  } catch {
    /* ignore */
  }
}

/**
 * Grid thumbnail quality vs data usage.
 * - saver: default (fast blur loading for cards — clear enough for docs, fast initial paint)
 * - balanced: video stills sharper, data usage moderate
 * - sharp: clearest from Telegram's largest static layer only (lean)
 */
