import i18n from 'i18next';
import React, { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  Film,
  Image as ImageIcon,
  Settings2,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Shrink,
  Gauge,
  Volume2,
  VolumeX,
  Play,
  Pause,
  FastForward,
  PictureInPicture2,
  RefreshCw,
  Info,
  ExternalLink,
  AppWindow,
  FileText,
  FileCode,
  Music,
  Zap,
  Copy,
  Printer,
  Repeat,
  Search,
} from 'lucide-react';
import { DeadCenterProgress } from '../Explorer/DriveSkeleton';
import { convertFileSrc } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../lib/tauri/platform';
import { registerPreviewOpen, registerPreviewClose } from '../../../lib/telegram';

function middleTruncateFilename(filename: string, maxLength: number = 32): string {
  if (!filename || filename.length <= maxLength) return filename;
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex !== -1 ? filename.slice(extIndex) : '';
  const nameWithoutExt = extIndex !== -1 ? filename.slice(0, extIndex) : filename;

  const targetNameLength = maxLength - ext.length - 3;
  if (targetNameLength <= 4) {
    return `${filename.slice(0, 8)}...${ext}`;
  }

  const frontLen = Math.ceil(targetNameLength / 2);
  const backLen = Math.floor(targetNameLength / 2);

  return `${nameWithoutExt.slice(0, frontLen)}...${nameWithoutExt.slice(-backLen)}${ext}`;
}

import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { VSCodeCodeViewer } from '../../common/VSCodeCodeViewer';
import {
  cancelDriveOpenJob,
  cleanupPartialDownloads,
  driveStopStream,
  driveStreamSeek,
  driveStreamStatus,
} from '../../../lib/telegram/driveApi';
import { tgDownloadFile } from '../../../lib/telegram';
import { cacheCapturedThumb, getCachedThumb, setThumbsPaused } from '../../../lib/media/thumbBatcher';
import {
  getCachedPreview,
  invalidatePreview,
  loadPreviewCached,
  prefetchPreviews,
  type CachedPreview,
} from '../../../lib/media/previewCache';
import {
  formatDriveBytes,
  formatDriveDuration,
  driveFileDurationSeconds,
  driveFileDisplayName,
  formatDriveKindLabel,
  isImageDriveFile,
  isVideoDriveFile,
  isAudioDriveFile,
  isPdfDriveFile,
  isTextDriveFile,
  isOfficeDriveFile,
  isZipDriveFile,
  isTgsDriveFile,
  type DriveFile,
  type DriveFolder,
  type DriveChat,
} from '../../../lib/telegram/driveTypes';
import { TgsLottiePlayer } from './TgsLottiePlayer';
import { DriveZipBrowser } from '../DriveZipBrowser';
import {
  ensureLocalDocument,
  openDriveFileInSystem,
  openDriveFileWithApp,
  openInSystem,
} from '../../../lib/tauri/documentOpen';
import { isDesktop } from '../../../lib/tauri/platform';
import { DriveConfirmDialog, type DriveConfirmState } from '../Modals/DriveConfirmDialog';
import {
  chooseInitialDuplicateSlots,
  nextDistinctDuplicateIndex,
  shouldLoadSplitPreview,
  type DuplicateSplitSlot,
} from './duplicateCompareState';
import { SplitVideoPlayer } from './SplitVideoPlayer';
import { SplitSidepanelThumb } from './SplitSidepanelThumb';

export type DuplicateContextInfo = {
  activeFilteredGroups: {
    key: string;
    reason: string;
    reasonLabel?: string;
    files: DriveFile[];
    wasteBytes: number;
  }[];
  currentGroupIndex: number;
  markedDelete: Set<number>;
  onToggleMark: (fileId: number) => void;
  onKeepOnly: (group: any, keepFileId: number) => void;
  onNavigateGroup?: (nextGroupIndex: number, fileToPreview?: DriveFile) => void;
};

export type CustomPreviewSource = {
  src?: string | null;
  text?: string | null;
  kind?: 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'other' | 'binary';
  loading?: boolean;
  error?: string | null;
  encrypted?: boolean;
  compressedSize?: number | null;
  indexCounter?: { current: number; total: number };
  onExtract?: () => void;
  onReload?: () => void;
};

type Props = {
  file: DriveFile;
  folderId: number | null;
  creds: DriveCredentials;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  /** Neighbor message ids for prefetch (prev, next, next+1…) */
  neighborIds?: number[];
  folders?: DriveFolder[];
  chats?: DriveChat[];
  duplicateContext?: DuplicateContextInfo | null;
  onRefreshDrive?: () => void;
  onOpenTransferManager?: () => void;
  onEnqueueUploadPaths?: (
    paths: string[],
    opts?: { targetFolderId?: number | null; targetLabel?: string; topicId?: number | null; skipTopic?: boolean }
  ) => Promise<void>;
  onEnqueueDownloadSingle?: (opts: {
    messageId: number;
    folderId: number | null;
    savePath: string;
    name: string;
  }) => Promise<void>;
  initialFullscreen?: boolean;
  /** Open the detailed metadata panel immediately (context-menu Info). */
  initialInfoOpen?: boolean;
  customSource?: CustomPreviewSource;
};

type PlayQuality = {
  id: string;
  label: string;
  description?: string;
  height?: number | null;
  size?: number | null;
  native?: boolean;
  transcode?: boolean;
  recommended?: boolean;
};

const QUALITY_PREF_KEY = 'ag-drive-play-quality';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.25;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Telegram exposes the uploaded video source, not YouTube-style renditions.
 * Never advertise synthetic resolutions unless the backend returns a real
 * Telegram-provided variant. This avoids hidden local transcodes and storage
 * amplification merely for preview playback. */
function fallbackVideoQualities(t: (key: string) => string): PlayQuality[] {
  return [
    {
      id: 'auto',
      label: t('speedtest.quality_telegram_auto'),
      description: t('speedtest.quality_telegram_auto_desc'),
      native: true,
      recommended: true,
    },
    {
      id: 'original',
      label: t('speedtest.quality_telegram_original'),
      description: t('speedtest.quality_telegram_original_desc'),
      native: true,
    },
  ];
}

function readQualityPref(): string {
  try {
    const v = localStorage.getItem(QUALITY_PREF_KEY);
    if (v && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return 'auto';
}

function writeQualityPref(q: string) {
  try {
    localStorage.setItem(QUALITY_PREF_KEY, q);
  } catch {
    /* ignore */
  }
}

/** Progressive partial files are not playable via convertFileSrc (no Range / hollow middle). */
function isProgressiveStreamPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return /\.stream\./i.test(path) || /\.stream$/i.test(path) || /\.partial$/i.test(path) || /\.partial\./i.test(path) || /\.tmp$/i.test(path);
}

function isHttpStreamUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/stream\//i.test(url);
}

function isPlayableHttpUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * Build <video>/<img> src.
 * Video MUST prefer local progressive HTTP stream (Range + seek). Never feed
 * incomplete .stream.* paths or image data_urls into <video>.
 */
function buildMediaSrc(
  streamUrl: string | null,
  dataUrl: string | null,
  path: string | null,
  preferLocal = false,
  opts?: { forVideo?: boolean }
): string | null {
  const forVideo = !!opts?.forVideo || !preferLocal;
  // Always prefer live progressive stream for video
  if (forVideo && isPlayableHttpUrl(streamUrl)) return streamUrl;

  if (preferLocal && !forVideo) {
    // Images only
    if (dataUrl && dataUrl.startsWith('data:image/') && dataUrl.length < 8_000_000) return dataUrl;
    if (path && detectTauriRuntime() && !isProgressiveStreamPath(path)) {
      try {
        return convertFileSrc(path);
      } catch {
        /* fall through */
      }
    }
    if (isPlayableHttpUrl(streamUrl)) return streamUrl;
    return null;
  }

  // Video / non-preferLocal
  if (isPlayableHttpUrl(streamUrl)) return streamUrl;
  // Do NOT use image data: URLs as video sources
  if (
    dataUrl &&
    dataUrl.startsWith('data:') &&
    !dataUrl.startsWith('data:image/') &&
    dataUrl.length < 8_000_000
  ) {
    return dataUrl;
  }
  // Complete local files only (faststart / full download) — never hollow .stream.
  if (path && detectTauriRuntime() && !isProgressiveStreamPath(path)) {
    try {
      return convertFileSrc(path);
    } catch {
      return null;
    }
  }
  return null;
}

/** Resolve media kind without treating every progressive "stream" as video. */
function resolvePreviewKind(
  file: DriveFile,
  mime: string | null,
  previewKind: string | null
): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'zip' | 'other' {
  const m = (mime || file.mime_type || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/') || previewKind === 'audio' || isAudioDriveFile(file)) return 'audio';
  if (m === 'application/pdf' || previewKind === 'pdf' || isPdfDriveFile(file)) return 'pdf';
  if (m.startsWith('text/') || previewKind === 'text' || isTextDriveFile(file)) return 'text';
  if (isZipDriveFile(file) || m.includes('zip') || previewKind === 'zip') return 'zip';
  // Explicit backend kinds
  if (previewKind === 'image' || previewKind === 'file' || previewKind === 'inline') {
    if (isImageDriveFile(file)) return 'image';
    if (isVideoDriveFile(file)) return 'video';
    if (isAudioDriveFile(file)) return 'audio';
  }
  if (previewKind === 'video') return 'video';
  if (previewKind === 'audio') return 'audio';
  // File metadata (extension / icon) — never use previewKind==="stream" alone
  if (isImageDriveFile(file) && !isVideoDriveFile(file)) return 'image';
  if (isVideoDriveFile(file)) return 'video';
  if (isAudioDriveFile(file)) return 'audio';
  // Stream of unknown type: guess from filename
  const name = (file.name || file.original_name || '').toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|heic|avif|svg|ico)$/i.test(name)) return 'image';
  if (/\.(mp4|mov|mkv|webm|avi|m4v|3gp|ogv)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(name)) return 'audio';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.zip$/i.test(name)) return 'zip';
  if (
    /\.(json|jsonc|json5|jsonl|txt|text|md|markdown|mdx|rst|csv|tsv|log|xml|ya?ml|ini|cfg|conf|config|properties|env|toml|plist|html?|xhtml|css|scss|sass|less|jsx?|mjs|cjs|tsx?|vue|svelte|astro|py|pyi|rb|php|pl|sh|bash|zsh|ps1|bat|cmd|lua|r|jl|exs?|java|kt|kts|swift|dart|go|rs|c|cc|cpp|cxx|h|hh|hpp|cs|fsx?|sql|prisma|graphql|gql|proto|tf|hcl|nix|diff|patch|dockerfile|makefile|cmake|docx|odt|rtf|xlsx|ods|pptx|odp)$/i.test(
      name
    )
  )
    return 'text';
  return 'other';
}

function formatQualitySize(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '';
  return formatDriveBytes(n);
}

/** Normalize backend quality labels (avoid "1p" / empty garbage in UI) */
function sanitizeQualityLabel(raw: unknown, id?: string, height?: number | null): string {
  const s = String(raw || '').trim();
  const idS = String(id || '').toLowerCase();
  if (/^auto/i.test(idS) || /^otomatis$/i.test(s)) return i18n.t('speedtest.auto_mode_label');
  if (/^original/i.test(idS) || /^asli$/i.test(s)) return 'Asli';
  // Prefer explicit height
  if (height != null && Number.isFinite(height) && height >= 144) {
    return `${Math.round(height)}p`;
  }
  // Valid pattern like 2160p / 720p
  const m = s.match(/^(\d{3,4})\s*p$/i);
  if (m) return `${m[1]}p`;
  // id like p720 / 720
  const mid = idS.match(/^p?(\d{3,4})$/);
  if (mid && Number(mid[1]) >= 144) return `${mid[1]}p`;
  // Reject broken short labels ("1p", "p", etc.)
  if (!s || /^(\d{1,2})\s*p$/i.test(s) || s.length < 2) {
    if (idS === 'auto') return 'Otomatis';
    if (idS === 'original') return 'Asli';
    return s || 'Otomatis';
  }
  return s;
}

function normalizePlayQualities(list: PlayQuality[]): PlayQuality[] {
  return (list || []).map((q) => ({
    ...q,
    label: sanitizeQualityLabel(q.label, q.id, q.height),
  }));
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

type SplitPreviewMediaProps = {
  file: DriveFile;
  folderId: number | null;
  creds: DriveCredentials;
  slot: DuplicateSplitSlot;
  active: boolean;
  playbackRequested: boolean;
  onRequestPlayback: () => void;
  reloadToken: number;
  fallbackThumb: string;
  transform: string;
  dragging: boolean;
  cursor: string;
};

function SplitPreviewMedia({
  file,
  folderId,
  creds,
  slot,
  active,
  playbackRequested,
  onRequestPlayback,
  reloadToken,
  fallbackThumb,
  transform,
  dragging,
  cursor,
}: SplitPreviewMediaProps) {
  const { t } = useTranslation();
  const scopedFolderId = file.folder_id ?? folderId;
  const cachedThumb =
    getCachedThumb(scopedFolderId, file.id) ||
    file.thumb_data_url ||
    file.thumbDataUrl ||
    fallbackThumb;
  const [preview, setPreview] = useState<CachedPreview | null>(() =>
    getCachedPreview(
      scopedFolderId,
      file.id,
      'auto',
      creds.session,
      file.peer_id,
      file.topic_id
    )
  );
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [backendBufferedPct, setBackendBufferedPct] = useState(0);
  const ownedStreamIdRef = useRef<string | null>(null);

  const initialKind = resolvePreviewKind(file, preview?.mime_type || null, preview?.preview_kind || null);
  const shouldLoad = shouldLoadSplitPreview(
    initialKind,
    slot,
    active ? slot : null,
    playbackRequested ? slot : null
  );

  useEffect(() => {
    if (!shouldLoad) return;
    let live = true;
    if (reloadToken > 0 && ownedStreamIdRef.current) {
      const previousStreamId = ownedStreamIdRef.current;
      ownedStreamIdRef.current = null;
      void driveStopStream(creds, previousStreamId, { deletePartial: false });
      invalidatePreview(
        scopedFolderId,
        file.id,
        creds.session,
        file.peer_id,
        file.topic_id
      );
      setBackendBufferedPct(0);
    }
    setLoadingPreview(true);
    void loadPreviewCached(creds, file.id, scopedFolderId, 'auto', {
      force: reloadToken > 0,
      peerId: file.peer_id,
      topicId: file.topic_id,
      accountId: file.account_id || creds.session,
      })
      .then((result) => {
        if (!live) {
          if (initialKind === 'video' && result.stream_id) {
            void driveStopStream(creds, result.stream_id, { deletePartial: false });
          }
          return;
        }
        setPreview(result);
        if (initialKind === 'video') {
          ownedStreamIdRef.current = result.stream_id || null;
          const total = Number(result.size || file.size || 0);
          const buffered = Number(result.buffered || 0);
          setBackendBufferedPct(total > 0 ? Math.min(100, (buffered / total) * 100) : 0);
        }
      })
      .catch(() => {
        if (live) setPreview(null);
      })
      .finally(() => {
        if (live) setLoadingPreview(false);
      });
    return () => {
      live = false;
    };
  }, [creds, file.id, file.account_id, file.peer_id, file.size, file.topic_id, initialKind, reloadToken, scopedFolderId, shouldLoad]);

  useEffect(() => {
    if (playbackRequested) return;
    if (initialKind === 'video') setLoadingPreview(false);
    const streamId = ownedStreamIdRef.current;
    if (!streamId) return;
    ownedStreamIdRef.current = null;
    void driveStopStream(creds, streamId, { deletePartial: false });
    invalidatePreview(
      scopedFolderId,
      file.id,
      creds.session,
      file.peer_id,
      file.topic_id
    );
    setPreview((current) => current?.stream_id === streamId ? null : current);
    setBackendBufferedPct(0);
  }, [creds, file.id, file.peer_id, file.topic_id, initialKind, playbackRequested, scopedFolderId]);

  useEffect(() => {
    if (!playbackRequested || !preview?.stream_id) return;
    let live = true;
    let polling = false;
    const poll = async () => {
      if (!live || polling || !preview.stream_id) return;
      polling = true;
      try {
        const status = await driveStreamStatus(creds, preview.stream_id);
        if (!live) return;
        const total = Number(status.total || file.size || preview.size || 0);
        const buffered = Number(
          status.downloaded_filled != null
            ? status.downloaded_filled
            : status.downloaded != null
              ? status.downloaded
              : status.prefix_bytes || 0
        );
        const percent = Number(status.percent);
        const nextPercent = Number.isFinite(percent) && percent >= 0
          ? percent
          : total > 0
            ? (buffered / total) * 100
            : 0;
        setBackendBufferedPct(status.done ? 100 : Math.min(100, Math.max(0, nextPercent)));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 700);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [creds, file.size, playbackRequested, preview?.size, preview?.stream_id]);

  useEffect(() => () => {
    const streamId = ownedStreamIdRef.current;
    if (!streamId) return;
    ownedStreamIdRef.current = null;
    void driveStopStream(creds, streamId, { deletePartial: false });
  }, [creds]);

  const kind = resolvePreviewKind(file, preview?.mime_type || null, preview?.preview_kind || null);
  const mediaSource = preview
    ? buildMediaSrc(
        preview.stream_url || null,
        preview.data_url || null,
        preview.path || null,
        kind === 'image',
        { forVideo: kind === 'video' }
      )
    : null;
  const visualSource = mediaSource || cachedThumb || '';

  return (
    <div
      className="drive-preview-split-media drive-preview-split-media-content"
      style={{
        transform,
        transition: dragging ? 'none' : 'transform 0.15s cubic-bezier(0.2,0,0,1)',
        willChange: dragging ? 'transform' : 'auto',
        cursor,
      }}
    >
      {kind === 'image' && visualSource ? (
        <img src={visualSource} alt={file.name} draggable={false} />
      ) : kind === 'video' ? (
        <SplitVideoPlayer
          src={playbackRequested ? mediaSource : null}
          poster={cachedThumb || null}
          loading={playbackRequested && loadingPreview}
          playbackRequested={playbackRequested}
          backendBufferedPct={backendBufferedPct}
          onRequestPlay={onRequestPlayback}
          onSeek={(seconds, duration) => {
            const streamId = ownedStreamIdRef.current || preview?.stream_id;
            if (!streamId || duration <= 0) return;
            void driveStreamSeek(creds, streamId, { time_s: seconds, duration_s: duration });
          }}
        />
      ) : kind === 'audio' && active && mediaSource ? (
        <div className="drive-preview-split-document">
          <Film size={28} />
          <audio src={mediaSource} controls preload="metadata" />
        </div>
      ) : kind === 'pdf' && active && mediaSource ? (
        <iframe src={mediaSource} title={file.name} />
      ) : kind === 'text' && active && preview?.text_content ? (
        <pre>{preview.text_content}</pre>
      ) : (
        <div className="drive-preview-split-document">
          {loadingPreview ? <Loader2 size={28} className="spin" /> : <FileText size={30} />}
          <strong>{file.file_ext || file.name.split('.').pop() || t('speedtest.tab_telegram_files')}</strong>
          <span>{active ? t('speedtest.duplicate_preview_unavailable') : t('speedtest.duplicate_preview_activate')}</span>
        </div>
      )}
      {loadingPreview && (kind !== 'video' || playbackRequested) && (
        <span className="drive-preview-split-loading">{t('speedtest.label_loading')}</span>
      )}
    </div>
  );
}

function pointerIdMatches(a: number, b: number): boolean {
  return a === b;
}

let globalStreamTeardownGen = 0;
let activeMountGen = 0;

type ZipErrorBoundaryProps = {
  onClose?: () => void;
  children: ReactNode;
};

type ZipErrorBoundaryState = {
  hasError: boolean;
  error: string | null;
};

class ZipErrorBoundaryInner extends Component<ZipErrorBoundaryProps & { translate: (key: string) => string }, ZipErrorBoundaryState> {
  constructor(props: ZipErrorBoundaryProps & { translate: (key: string) => string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): ZipErrorBoundaryState {
    return {
      hasError: true,
      error: String((error as any)?.message || error || ''),
    };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    console.error('[ZipErrorBoundary] Component render error:', error, errorInfo);
  }

  render() {
    const t = this.props.translate;
    if (this.state.hasError) {
      return (
        <div className="drive-zip-browser is-error" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
          <p style={{ fontWeight: 600, fontSize: '1rem', color: '#f87171', marginBottom: 12 }}>
            {t('ui.generated.terjadi_kesalahan_visual_saat_memuat_zip_workben_e6692ae')}
          </p>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: 16, maxWidth: 420 }}>
            {this.state.error || t('ui.generated.terjadi_kesalahan_visual_saat_memuat_zip_workben_e6692ae')}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="td-btn-primary"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              {t('ui.generated.coba_ulang_8ac3ad2')}
            </button>
            {this.props.onClose && (
              <button
                type="button"
                className="td-btn-secondary"
                onClick={this.props.onClose}
              >
                {t('ui.generated.tutup_modal_0c4ecfa')}
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ZipErrorBoundary(props: ZipErrorBoundaryProps) {
  const { t } = useTranslation();
  return <ZipErrorBoundaryInner {...props} translate={t} />;
}

export function DrivePreviewModal({
  file,
  folderId,
  creds,
  onClose,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  neighborIds = [],
  folders,
  chats,
  duplicateContext,
  onRefreshDrive,
  onOpenTransferManager,
  onEnqueueUploadPaths,
  onEnqueueDownloadSingle,
  initialFullscreen = false,
  initialInfoOpen = false,
  customSource,
}: Props) {
  const { t } = useTranslation();
  const defaultVideoQualities = useMemo(() => fallbackVideoQualities(t), [t]);
  const isSplitCompareMode = Boolean(duplicateContext);

  const currentDupGroup = useMemo(() => {
    if (!duplicateContext || !duplicateContext.activeFilteredGroups.length) return null;
    return (
      duplicateContext.activeFilteredGroups[duplicateContext.currentGroupIndex] ||
      duplicateContext.activeFilteredGroups[0]
    );
  }, [duplicateContext]);

  const [selectedAIndex, setSelectedAIndex] = useState<number>(0);
  const [selectedBIndex, setSelectedBIndex] = useState<number>(1);
  const [isSlotAEmpty, setIsSlotAEmpty] = useState<boolean>(false);
  const [isSlotBEmpty, setIsSlotBEmpty] = useState<boolean>(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [splitReloadToken, setSplitReloadToken] = useState(0);
  const [splitNotice, setSplitNotice] = useState<string | null>(null);
  const [singlePreviewFile, setSinglePreviewFile] = useState<DriveFile | null>(null);
  const [activeSplitSlot, setActiveSplitSlot] = useState<DuplicateSplitSlot | null>(null);
  const [splitPlaybackSlot, setSplitPlaybackSlot] = useState<DuplicateSplitSlot | null>(null);
  const [splitMarkedDelete, setSplitMarkedDelete] = useState<Set<number>>(
    () => new Set(duplicateContext?.markedDelete || [])
  );

  useEffect(() => {
    if (currentDupGroup) {
      setSplitMarkedDelete(new Set(duplicateContext?.markedDelete || []));
      const initial = chooseInitialDuplicateSlots(
        currentDupGroup.files,
        file.id,
        duplicateContext?.markedDelete || new Set<number>()
      );
      setSelectedAIndex(initial.aIndex);
      setSelectedBIndex(initial.bIndex);
      setIsSlotAEmpty(false);
      setIsSlotBEmpty(initial.bEmpty);
      setActiveSplitSlot(null);
      setSplitPlaybackSlot(null);
      setSplitNotice(null);
    }
  }, [currentDupGroup, duplicateContext?.markedDelete, file.id]);

  const isHeaderFrozen = isSplitCompareMode && activeSplitSlot === null;

  const activeSlotFile = useMemo(() => {
    if (isSplitCompareMode && currentDupGroup) {
      if (activeSplitSlot === 'A') {
        return currentDupGroup.files[selectedAIndex] || currentDupGroup.files[0] || file;
      } else if (activeSplitSlot === 'B') {
        return currentDupGroup.files[selectedBIndex] || currentDupGroup.files[1] || currentDupGroup.files[0] || file;
      } else {
        return null;
      }
    }
    return file;
  }, [isSplitCompareMode, currentDupGroup, activeSplitSlot, selectedAIndex, selectedBIndex, file]);

  const handleAssignSlotIndex = useCallback((slot: 'A' | 'B', idx: number) => {
    if (!currentDupGroup?.files[idx]) return false;
    const otherIndex = slot === 'A' ? selectedBIndex : selectedAIndex;
    const otherEmpty = slot === 'A' ? isSlotBEmpty : isSlotAEmpty;
    if (!otherEmpty && idx === otherIndex) {
      setSplitNotice(t('speedtest.duplicate_same_slot'));
      window.setTimeout(() => setSplitNotice(null), 1800);
      return false;
    }
    if (slot === 'A') {
      setSelectedAIndex(idx);
      setIsSlotAEmpty(false);
    } else {
      setSelectedBIndex(idx);
      setIsSlotBEmpty(false);
    }
    if (splitPlaybackSlot === slot) setSplitPlaybackSlot(null);
    setActiveSplitSlot(slot);
    setSplitNotice(null);
    return true;
  }, [currentDupGroup, isSlotAEmpty, isSlotBEmpty, selectedAIndex, selectedBIndex, splitPlaybackSlot, t]);

  const handleSelectSidepanelItem = useCallback((idx: number) => {
    if (!isSlotAEmpty && idx === selectedAIndex) {
      setActiveSplitSlot('A');
      return;
    }
    if (!isSlotBEmpty && idx === selectedBIndex) {
      setActiveSplitSlot('B');
      return;
    }
    handleAssignSlotIndex(activeSplitSlot || 'B', idx);
  }, [activeSplitSlot, handleAssignSlotIndex, isSlotAEmpty, isSlotBEmpty, selectedAIndex, selectedBIndex]);

  const handleKeepFile = useCallback((fileToKeepId: number) => {
    if (!duplicateContext || !currentDupGroup) return;
    setSplitMarkedDelete((previous) => {
      const next = new Set(previous);
      for (const groupFile of currentDupGroup.files) {
        if (groupFile.id === fileToKeepId) next.delete(groupFile.id);
        else next.add(groupFile.id);
      }
      return next;
    });
    duplicateContext.onKeepOnly(currentDupGroup, fileToKeepId);
  }, [duplicateContext, currentDupGroup]);

  const handleToggleDelete = useCallback((fileId: number) => {
    if (!duplicateContext) return;
    setSplitMarkedDelete((previous) => {
      const next = new Set(previous);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
    duplicateContext.onToggleMark(fileId);
  }, [duplicateContext]);

  const stepSplitFile = useCallback((direction: -1 | 1, slot: 'A' | 'B' = activeSplitSlot || 'B') => {
    if (!currentDupGroup) return;
    const current = slot === 'A' ? selectedAIndex : selectedBIndex;
    const other = slot === 'A' ? selectedBIndex : selectedAIndex;
    const nextIndex = nextDistinctDuplicateIndex(
      currentDupGroup.files.length,
      current,
      other,
      direction,
      slot === 'A' ? isSlotBEmpty : isSlotAEmpty
    );
    if (nextIndex != null) {
      handleAssignSlotIndex(slot, nextIndex);
      return;
    }
    if (!duplicateContext?.onNavigateGroup) return;
    const groupIndex = duplicateContext.currentGroupIndex + direction;
    const targetGroup = duplicateContext.activeFilteredGroups[groupIndex];
    if (!targetGroup) return;
    const targetFile = direction > 0
      ? targetGroup.files[1] || targetGroup.files[0]
      : targetGroup.files[targetGroup.files.length - 1];
    duplicateContext.onNavigateGroup(groupIndex, targetFile);
  }, [activeSplitSlot, currentDupGroup, duplicateContext, handleAssignSlotIndex, isSlotAEmpty, isSlotBEmpty, selectedAIndex, selectedBIndex]);

  const handleSequentialNext = useCallback(() => stepSplitFile(1), [stepSplitFile]);
  const handleSequentialPrev = useCallback(() => stepSplitFile(-1), [stepSplitFile]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [floodCountdown, setFloodCountdown] = useState<number | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<string | null>(null);
  const [textBody, setTextBody] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'full' | 'degraded' | 'failed'>('loading');
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [previewIsFallback, setPreviewIsFallback] = useState<boolean>(false);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const [previewByteSize, setPreviewByteSize] = useState<number | null>(null);
  const [previewErrorDetail, setPreviewErrorDetail] = useState<string | null>(null);
  const [openingSystem, setOpeningSystem] = useState(false);
  const [openProgressMsg, setOpenProgressMsg] = useState<string | null>(null);
  /** User cancelled open/print progress strip */
  const openCancelledRef = useRef(false);
  const pdfFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState<DriveConfirmState | null>(null);
  const [bufferPct, setBufferPct] = useState(0);
  const [streamDone, setStreamDone] = useState(false);
  const [playerHint, setPlayerHint] = useState<string | null>(null);
  /** Brief toast when user seeks past progressive buffer (quota protection) */
  const [seekWarn, setSeekWarn] = useState<string | null>(null);
  const seekWarnTimer = useRef<number | null>(null);
  const streamDoneRef = useRef(false);
  const bufferPctRef = useRef(0);
  /** Live stream id for cancel-on-close (avoids stale closure leaks) */
  const streamIdRef = useRef<string | null>(null);
  const credsRef = useRef(creds);
  credsRef.current = creds;

  // Pause background card/thumbnail RPCs while preview modal is open
  useEffect(() => {
    setThumbsPaused(true);
    return () => {
      setThumbsPaused(false);
    };
  }, []);

  // Auto-detect Telegram FloodWait duration and set countdown timer
  useEffect(() => {
    if (!error) {
      setFloodCountdown(null);
      return;
    }
    const match =
      error.match(/(?:Tunggu|tunggu|wait)\s+(\d+)\s*(?:detik|s|sec)?/i) ||
      error.match(/(\d+)\s*detik/i);
    if (match) {
      const secs = parseInt(match[1], 10);
      if (secs > 0 && secs <= 600) {
        setFloodCountdown(secs);
      } else {
        setFloodCountdown(null);
      }
    } else {
      setFloodCountdown(null);
    }
  }, [error]);

  // Countdown timer effect for automatic retry on Telegram FloodWait
  useEffect(() => {
    if (floodCountdown === null || floodCountdown <= 0) return;
    const timer = setInterval(() => {
      setFloodCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          // Auto-trigger retry when countdown reaches zero
          invalidatePreview(folderId, file.id);
          setError(null);
          setTextBody(null);
          setLoading(true);
          void (async () => {
            try {
              const { stopDriveSession, ensureDriveSession } = await import(
                '../../../lib/telegram'
              );
              await stopDriveSession();
              if (credsRef.current) await ensureDriveSession(credsRef.current, true);
            } catch {
              /* ignore */
            }
            loadPreviewRef.current('auto', { force: true });
          })();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [floodCountdown, folderId, file.id]);

  useEffect(() => {
    if (creds) {
      registerPreviewOpen(creds);
      return () => {
        registerPreviewClose(creds);
      };
    }
  }, [creds.session]);

  const [quality, setQuality] = useState<string>(() => readQualityPref());
  const [qualities, setQualities] = useState<PlayQuality[]>([]);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [switchingQuality, setSwitchingQuality] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  // Image tools
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Split Compare per-slot transform state
  const [slotATransform, setSlotATransform] = useState<{
    zoom: number;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    pan: { x: number; y: number };
    isMagnifierMode: boolean;
  }>({
    zoom: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
    pan: { x: 0, y: 0 },
    isMagnifierMode: false,
  });

  const [slotBTransform, setSlotBTransform] = useState<{
    zoom: number;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    pan: { x: number; y: number };
    isMagnifierMode: boolean;
  }>({
    zoom: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
    pan: { x: 0, y: 0 },
    isMagnifierMode: false,
  });

  const [hasVideoFrame, setHasVideoFrame] = useState(false);
  const [isMagnifierMode, setIsMagnifierMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen);
  const [showInfo, setShowInfo] = useState(initialInfoOpen);
  const [mediaWidth, setMediaWidth] = useState<number | null>(null);
  const [mediaHeight, setMediaHeight] = useState<number | null>(null);

  // Video & View tools
  const [playbackRate, setPlaybackRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);
  const [videoVolume, setVideoVolume] = useState(1);
  const [loopVideo, setLoopVideo] = useState(() => {
    try {
      return localStorage.getItem('drive.preview.loop') === '1';
    } catch {
      return false;
    }
  });

  const curTransform = isSplitCompareMode
    ? activeSplitSlot === 'A'
      ? slotATransform
      : activeSplitSlot === 'B'
      ? slotBTransform
      : { zoom: 1, rotation: 0, flipH: false, flipV: false, pan: { x: 0, y: 0 }, isMagnifierMode: false }
    : { zoom, rotation, flipH, flipV, pan, isMagnifierMode };

  const updateActiveTransform = (
    updater: (prev: typeof slotATransform) => typeof slotATransform
  ) => {
    if (!isSplitCompareMode) return;
    if (activeSplitSlot === 'A') {
      setSlotATransform(updater);
    } else if (activeSplitSlot === 'B') {
      setSlotBTransform(updater);
    }
  };

  const [isDraggingSlotA, setIsDraggingSlotA] = useState(false);
  const [isDraggingSlotB, setIsDraggingSlotB] = useState(false);

  const handleCardPointerDown = (
    e: React.PointerEvent,
    slot: 'A' | 'B',
    currentTransform: typeof slotATransform,
    setTransform: React.Dispatch<React.SetStateAction<typeof slotATransform>>
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    if ((e.target as HTMLElement | null)?.closest?.('video, audio, iframe, button')) {
      setActiveSplitSlot(slot);
      return;
    }

    if (activeSplitSlot !== slot) {
      setActiveSplitSlot(slot);
      return;
    }

    const isZoomed = currentTransform.zoom > 1.01;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = currentTransform.pan.x;
    const startPanY = currentTransform.pan.y;
    let hasMoved = false;

    const containerEl = (e.currentTarget as HTMLElement).querySelector('.drive-preview-split-media-wrap');
    const mediaEl = (e.currentTarget as HTMLElement).querySelector('.drive-preview-split-media') as HTMLElement | null;

    const containerWidth = containerEl ? containerEl.clientWidth : 300;
    const containerHeight = containerEl ? containerEl.clientHeight : 300;
    const maxPanX = Math.max(0, (containerWidth * (currentTransform.zoom - 1)) / 2);
    const maxPanY = Math.max(0, (containerHeight * (currentTransform.zoom - 1)) / 2);

    const setIsDragging = slot === 'A' ? setIsDraggingSlotA : setIsDraggingSlotB;
    let pendingPan = { x: startPanX, y: startPanY };

    if (isZoomed && mediaEl) {
      mediaEl.style.transition = 'none';
    }

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      if (!hasMoved && Math.hypot(dx, dy) > 3) {
        hasMoved = true;
        if (isZoomed) setIsDragging(true);
      }
      if (hasMoved && isZoomed) {
        const nextX = clamp(startPanX + dx, -maxPanX, maxPanX);
        const nextY = clamp(startPanY + dy, -maxPanY, maxPanY);
        pendingPan = { x: nextX, y: nextY };

        if (mediaEl) {
          const transformStr = `translate3d(${nextX}px, ${nextY}px, 0px) rotate(${currentTransform.rotation}deg) scale(${(currentTransform.flipH ? -1 : 1) * currentTransform.zoom}, ${(currentTransform.flipV ? -1 : 1) * currentTransform.zoom})`;
          mediaEl.style.transform = transformStr;
        }
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      setIsDragging(false);

      if (mediaEl) {
        mediaEl.style.transition = 'transform 0.15s cubic-bezier(0.2,0,0,1)';
      }

      if (hasMoved && isZoomed) {
        setTransform((prev) => ({
          ...prev,
          pan: pendingPan,
        }));
      } else if (!hasMoved) {
        setActiveSplitSlot(null);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerUp, { once: true });
  };

  const handleSplitDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const panes = e.currentTarget.parentElement;
    if (!panes) return;
    const update = (event: PointerEvent) => {
      const rect = panes.getBoundingClientRect();
      const vertical = window.matchMedia('(max-width: 900px)').matches;
      const raw = vertical
        ? ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100
        : ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
      setSplitRatio(clamp(raw, 24, 76));
    };
    const finish = () => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', update, { passive: true });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };
  const [videoBufferedPercent, setVideoBufferedPercent] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [rippleOverlay, setRippleOverlay] = useState<{ type: 'play' | 'pause'; key: number } | null>(null);
  const [jumpOverlay, setJumpOverlay] = useState<{ side: 'left' | 'right'; seconds: number; key: number } | null>(null);
  const [isSpeedingUp, setIsSpeedingUp] = useState(false);

  const controlsTimeoutRef = useRef<number | null>(null);
  const lastClickTimeRef = useRef(0);
  const pointerDownPosRef = useRef({ x: 0, y: 0 });
  const clickTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const speedupActiveRef = useRef(false);
  const originalSpeedRef = useRef(1);
  const jumpChainRef = useRef<{ side: 'left' | 'right'; count: number; time: number }>({ side: 'left', count: 0, time: 0 });
  /** True after user scrub (seeking); cleared after handleSeekJump */
  const userSeekPendingRef = useRef(false);
  /** Skip N seeked events from resume/load (not user scrub) */
  const ignoreSeekEventsRef = useRef(0);
  /** Debounce Telegram seek kicks while the scrub bar is dragged */
  const lastSeekKickRef = useRef(0);
  /** One-shot auto-recover when stream_status reports missing/cancelled */
  const streamRecoverRef = useRef(false);
  /** Consecutive missing/cancelled poll hits before recover (avoid thrash) */
  const streamMissingHitsRef = useRef(0);
  /** Guard media onError → loadPreview loop during progressive buffer holes */
  const mediaErrorRecoverAtRef = useRef(0);
  const mediaErrorCountRef = useRef(0);
  /** Backend-confirmed playable prefix (including MP4 metadata availability). */
  const nativeStreamReadyRef = useRef(false);
  /** Sticky stream id for current file — avoid soft reload replacing live URL */
  const liveStreamIdRef = useRef<string | null>(null);
  /**
   * Only forward pause → worker after real playback has started.
   * Failed autoplay / load still fire pause and would freeze Telegram fill
   * (moov tail + pipeline), leaving "buffer tinggi tapi video tak start".
   */
  const hasUserPlayRef = useRef(false);
  const userExplicitlyPausedRef = useRef(false);
  const isVideoCapturedRef = useRef(false);
  /**
   * Guard: prevents both poll (missing≥5 ticks) and onError rebind from
   * calling loadPreview / rebind simultaneously — the main cause of
   * "reload pemutar terus-menerus".
   */
  const softReloadInFlightRef = useRef(false);
  const softReloadTimerRef = useRef<number | null>(null);
  /** BUG-3 FIX: Count soft retry escalations to prevent infinite loop */
  const softRetryCountRef = useRef(0);
  /** BUG-4 FIX: Timeout guard — if video hasn’t started after 30s, show error UI */
  const streamTimeoutRef = useRef<number | null>(null);
  // A completed tiny progressive file can leave WebView2's first Range
  // request pending before metadata is parsed; this guards a one-shot rebind.
  const completedStreamRebindRef = useRef<string | null>(null);
  const completedBlobUrlRef = useRef<string | null>(null);
  const completedBlobAttemptRef = useRef<string | null>(null);
  const STREAM_TIMEOUT_MS = 30_000;

  // Reset captured flag + reload guards when file changes
  useEffect(() => {
    isVideoCapturedRef.current = false;
    userExplicitlyPausedRef.current = false;
    softReloadInFlightRef.current = false;
    softRetryCountRef.current = 0; // BUG-3 FIX: reset retry counter on file change
    if (softReloadTimerRef.current != null) {
      window.clearTimeout(softReloadTimerRef.current);
      softReloadTimerRef.current = null;
    }
    // BUG-4 FIX: clear timeout on file change
    if (streamTimeoutRef.current != null) {
      window.clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
  }, [file?.id]);

  const captureVideoFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || !file || isAudioDriveFile(file)) return;
    if (v.videoWidth <= 0 || v.videoHeight <= 0 || v.readyState < 2) return;
    try {
      const canvas = document.createElement('canvas');
      const maxDim = 640;
      let w = v.videoWidth;
      let h = v.videoHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        isVideoCapturedRef.current = true;
        cacheCapturedThumb(folderId, file.id, dataUrl, creds?.session);
      }
    } catch {
      // Ignore cross-origin canvas errors if any
    }
  }, [file, folderId, creds?.session]);

  const captureImageFrame = useCallback((imgEl: HTMLImageElement) => {
    if (!file || !imgEl || imgEl.naturalWidth <= 0 || imgEl.naturalHeight <= 0) return;
    try {
      const canvas = document.createElement('canvas');
      const maxDim = 640;
      let w = imgEl.naturalWidth;
      let h = imgEl.naturalHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(imgEl, 0, 0, w, h);
      const capturedUrl = canvas.toDataURL('image/jpeg', 0.82);
      if (capturedUrl && capturedUrl.startsWith('data:image/')) {
        cacheCapturedThumb(folderId, file.id, capturedUrl, creds?.session);
      }
    } catch {
      // Ignore cross-origin canvas errors if any
    }
  }, [file, folderId, creds?.session]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeAtRef = useRef<number>(0);
  const qualityMenuRef = useRef<HTMLDivElement | null>(null);
  const rateMenuRef = useRef<HTMLDivElement | null>(null);
  const qualityBtnRef = useRef<HTMLButtonElement | null>(null);
  const rateBtnRef = useRef<HTMLButtonElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Fixed-position popovers (avoid toolbar overflow clipping) */
  const [qualityMenuPos, setQualityMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(
    null
  );
  const [rateMenuPos, setRateMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const mountGenRef = useRef(0);
  const loadSeq = useRef(0);
  const dragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);
  const panRaf = useRef<number | null>(null);
  const panPending = useRef<{ x: number; y: number } | null>(null);
  const navLock = useRef(false);
  /** Keep latest zoom/pan for cursor-centered zoom math (avoid stale closures) */
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  /** Live drag flag for cursor (grabbing) without waiting for zoom class */
  const [isDragging, setIsDragging] = useState(false);

  const [srcOverride, setSrcOverride] = useState<string | null>(null);
  const navDebounceTimerRef = useRef<number | null>(null);
  const prevStreamForNav = useRef<string | null>(null);
  const previewScopeKey = `${creds?.session || ''}:${folderId ?? 'me'}:${file.id}`;
  const previewScopeRef = useRef(previewScopeKey);
  // A parent navigation renders before effects run. Do not let the new card
  // briefly inherit the previous file's URL while deterministic teardown is
  // being scheduled below.
  const previewStateMatchesScope = previewScopeRef.current === previewScopeKey;

  const durationLabel = formatDriveDuration(driveFileDurationSeconds(file));
  const kindLabel = formatDriveKindLabel(file);
  const displayName = driveFileDisplayName(file);
  const gridThumb = useMemo(() => {
    const t = getCachedThumb(folderId, file.id);
    return typeof t === 'string' ? t : null;
  }, [folderId, file.id]);

  const activeQuality = useMemo(() => {
    const list = qualities.length >= 2 ? qualities : defaultVideoQualities;
    const hit =
      list.find((q) => q.id === quality) || list.find((q) => q.recommended) || list[0] || null;
    if (!hit) return null;
    return {
      ...hit,
      label: sanitizeQualityLabel(hit.label, hit.id, hit.height),
    };
  }, [defaultVideoQualities, qualities, quality]);

  const resetViewTools = useCallback(() => {
    if (isSplitCompareMode) {
      updateActiveTransform(() => ({
        zoom: 1,
        rotation: 0,
        flipH: false,
        flipV: false,
        pan: { x: 0, y: 0 },
        isMagnifierMode: false,
      }));
    } else {
      setZoom(1);
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setPan({ x: 0, y: 0 });
      zoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      setIsDragging(false);
      dragRef.current = null;
      setIsMagnifierMode(false);
      setShowInfo(false);
      setPlaybackRate(1);
      setMuted(false);
    }
  }, [isSplitCompareMode, activeSplitSlot]);

  // Sync refs whenever zoom/pan state changes
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const applyResult = useCallback(
    (res: CachedPreview, q: string, cachedHit: boolean) => {
      const nextData = res.data_url || null;
      const nextPath = res.path || null;
      // Prefer live stream only when no inline text — text previews use text_content
      let nextStream = res.stream_url || null;
      const nextSid = res.stream_id || null;
      // Keep an already-live progressive URL when soft revalidate returns a
      // different stream_id (would remount <video> and restart buffer forever).
      if (
        liveStreamIdRef.current &&
        nextSid &&
        liveStreamIdRef.current !== nextSid &&
        streamUrl &&
        isHttpStreamUrl(streamUrl) &&
        !streamDone
      ) {
        nextStream = streamUrl;
      } else if (nextSid) {
        if (liveStreamIdRef.current !== nextSid) nativeStreamReadyRef.current = false;
        liveStreamIdRef.current = nextSid;
      } else if (nextStream) {
        liveStreamIdRef.current = liveStreamIdRef.current || nextSid;
      }
      const usable = !!(
        nextData ||
        nextPath ||
        nextStream ||
        (res.text_content != null && res.text_content !== '')
      );
      setDataUrl(nextData);
      setPath(nextPath);
      if (nextData && nextData.startsWith('data:image/')) {
        cacheCapturedThumb(folderId, file.id, nextData, creds?.session);
      } else if (res.poster_url && res.poster_url.startsWith('data:image/')) {
        cacheCapturedThumb(folderId, file.id, res.poster_url, creds?.session);
      }
      // Only update stream URL when it actually changes (string) — prevents
      // React key/effect churn when poll/soft revalidate repaints same stream.
      setStreamUrl((prev) => {
        if (prev && nextStream && prev === nextStream) return prev;
        if (!nextStream && prev && !streamDone && liveStreamIdRef.current) return prev;
        return nextStream;
      });
      setStreamId((prev) => {
        if (liveStreamIdRef.current && !streamDone) return liveStreamIdRef.current;
        return nextSid || prev;
      });
      setMime(res.mime_type || null);
      setPoster(res.poster_url || gridThumb);
      setTooLarge(!!res.too_large);
      setHint(res.message || null);
      setPreviewKind(res.preview_kind || null);
      // Inline text from worker — skip fragile HTTP stream fetch
      if (res.text_content != null && res.text_content !== '') {
        setTextBody(res.text_content);
      } else {
        setTextBody(null);
      }
      setFromCache(cachedHit);
      setHasVideoFrame(false);
      setMediaWidth(res.width || res.video_width || null);
      setMediaHeight(res.height || res.video_height || null);

      const src = res.source || (res.is_fallback ? 'stripped_thumb' : 'full_photo');
      const isFb = !!res.is_fallback;
      const w = res.width ?? res.video_width ?? null;
      const h = res.height ?? res.video_height ?? null;
      const bSize = res.byte_size ?? res.size ?? 0;
      const fullErr = res.full_download_error ?? null;

      setPreviewSource(src);
      setPreviewIsFallback(isFb);
      setPreviewWidth(w);
      setPreviewHeight(h);
      setPreviewByteSize(bSize);
      setPreviewErrorDetail(fullErr);

      if (isFb) {
        setPreviewState('degraded');
      } else if (usable) {
        setPreviewState('full');
      }

      console.log('[DrivePreviewModal] mount_preview:', {
        message_id: file.id,
        filename: file.name,
        preview_source: src,
        source_width: w,
        source_height: h,
        byte_size: bSize,
        is_fallback: isFb,
        full_download_error: fullErr,
      });

      if (res.qualities && res.qualities.length) {
        setQualities(normalizePlayQualities(res.qualities as PlayQuality[]));
      }
      if (res.quality) {
        setQuality(res.quality);
        writeQualityPref(res.quality);
      } else {
        setQuality(q);
      }
      // Complete PDF/text docs: mark stream done so iframe can open immediately
      const isCompleteDoc =
        res.preview_kind === 'pdf' ||
        res.preview_kind === 'text' ||
        (!res.streaming &&
          !!res.path &&
          !/\.stream\./i.test(res.path || '') &&
          (!!res.buffered && !!res.size ? res.buffered >= res.size * 0.98 : true));
      if (res.buffered && res.size) {
        setBufferPct(Math.min(100, Math.round((100 * res.buffered) / res.size)));
      } else if (isCompleteDoc || (cachedHit && res.stream_url && !res.streaming)) {
        setBufferPct(100);
        setStreamDone(true);
      } else if (cachedHit && res.stream_url && res.streaming) {
        // Progressive cache: keep buffer honest so UI re-polls stream status
        setStreamDone(false);
        if (res.buffered && res.size) {
          setBufferPct(Math.min(99, Math.round((100 * res.buffered) / res.size)));
        }
      }
      if (isCompleteDoc) {
        setStreamDone(true);
        setBufferPct(100);
      }
      if (res.streaming && !cachedHit && !isCompleteDoc) {
        setPlayerHint(res.message || t('ui.generated.streaming_a37cc13'));
      }
      setLoading(false);
      setSwitchingQuality(false);
      if (!usable && !res.too_large) {
        setError(res.message || t('ui.generated.pratinjau_kosong_coba_muat_ulang_atau_download_2c042d6'));
      } else {
        setError(null);
      }
    },
    [gridThumb, streamUrl, streamDone]
  );

  const loadPreview = useCallback(
    async (
      q: string,
      opts?: { resumeAt?: number; soft?: boolean; deferredRetryCount?: number; force?: boolean }
    ) => {
      if (mountGenRef.current !== activeMountGen) return;
      const seq = ++loadSeq.current;
      const soft = !!opts?.soft;
      const force = !!opts?.force;
      const qNorm = q || 'auto';

      if (opts?.resumeAt != null && opts.resumeAt > 0) {
        resumeAtRef.current = opts.resumeAt;
      }

      // Soft revalidate while progressive is already live: do not open a second
      // stream (new stream_id remounts video → endless buffer restart).
      if (
        soft &&
        !force &&
        liveStreamIdRef.current &&
        !streamDoneRef.current &&
        streamUrl &&
        isHttpStreamUrl(streamUrl)
      ) {
        return;
      }

      // Instant paint from cache (skip when force-retry after Failed to fetch)
      const hit = force ? null : getCachedPreview(folderId, file.id, qNorm);
      const hasUsable =
        !!hit &&
        !!(hit.stream_url || hit.path || hit.data_url || hit.text_content);
      if (hasUsable && hit) {
        applyResult(hit, qNorm, true);
        // Prefetch neighbors for regular images only (next/prev photo feels instant)
        // NEVER prefetch for ZIP archives, videos, or documents to prevent background 40-60 MB bandwidth consumption
        const isOnlyImage = isImageDriveFile(file) && !isVideoDriveFile(file) && !isZipDriveFile(file) && !isPdfDriveFile(file) && !isTextDriveFile(file);
        const ids = neighborIds.filter((id) => id && id !== file.id).slice(0, 5);
        if (ids.length && isOnlyImage) prefetchPreviews(creds, folderId, ids, qNorm);

        // Complete local only — hollow `.stream.` paths need a live stream re-RPC
        const solidLocal =
          !!(hit.text_content != null && hit.text_content !== '') ||
          !!hit.data_url ||
          (!!hit.path && !/\.stream\./i.test(hit.path) && !hit.streaming) ||
          (hit.preview_kind === 'text' && !!hit.path && !/\.stream\./i.test(hit.path || ''));
        if (solidLocal) return;
        // Fresh stream only — shorter TTL for progressive to avoid dead ports
        // after multi-video handoff (was 90s → thrash reload).
        const streamTtl = hit.streaming ? 25_000 : 90_000;
        if (
          hit.preview_kind !== 'text' &&
          hit.preview_kind !== 'pdf' &&
          hit.stream_url &&
          Date.now() - hit.cachedAt < streamTtl &&
          isHttpStreamUrl(hit.stream_url) &&
          !isVideoDriveFile(file)
        )
          return;
        // Stale / partial stream: revalidate in background (soft keeps frame)
      } else if (!soft) {
        // Instant shell: poster from grid thumb so UI never sits on a blank spinner.
        setError(null);
        setDataUrl(null);
        setPath(null);
        setStreamUrl(null);
        setStreamId(null);
        setBufferPct(0);
        setStreamDone(false);
        setPlayerHint(isVideoDriveFile(file) ? t('ui.generated.menyiapkan_stream_7c5244e') : t('ui.generated.memuat_4f4aea6'));
        setSeekWarn(null);
        setPoster(gridThumb);
        // Keep spinner only when we have no poster at all
        setLoading(!gridThumb);
        setQualityOpen(false);
        setRateOpen(false);
        setMediaWidth(null);
        setMediaHeight(null);
        if (force) setTextBody(null);
      } else {
        // Soft switch: keep current frame, show poster skeleton if nothing
        setPoster((p) => p || gridThumb);
      }

      if (navDebounceTimerRef.current != null) {
        window.clearTimeout(navDebounceTimerRef.current);
        navDebounceTimerRef.current = null;
      }

      const executeRemoteLoad = async () => {
        try {
          const itemPeerId = file.peer_id || (folderId != null && folderId !== 0 ? String(folderId) : null);
          const itemTopicId = file.topic_id ?? null;
          const itemAccountId = file.account_id || creds.session;
          const locationType = itemPeerId === 'me' ? 'saved_messages' : 'group';
          const res = await loadPreviewCached(creds, file.id, folderId, qNorm, {
            force,
            peerId: itemPeerId,
            topicId: itemTopicId,
            locationType,
            accountId: itemAccountId,
            consumerId: 'drive-preview-primary',
            requestId: `${previewScopeKey}:${seq}`,
          });
          if (mountGenRef.current !== activeMountGen) return;
          if (seq !== loadSeq.current) return;
          applyResult(res, qNorm, false);

          // Prefetch neighbors for regular images only — never for ZIP, video, or doc
          const isOnlyImagePost = isImageDriveFile(file) && !isVideoDriveFile(file) && !isZipDriveFile(file) && !isPdfDriveFile(file) && !isTextDriveFile(file);
          const idsPost = neighborIds.filter((id) => id && id !== file.id).slice(0, 2);
          if (idsPost.length && isOnlyImagePost) prefetchPreviews(creds, folderId, idsPost, qNorm);
        } catch (e: any) {
          if (mountGenRef.current !== activeMountGen) return;
          if (seq !== loadSeq.current) return;

          const raw = String(e?.message || e || '');
          const isDeferred = /drive read deferred/i.test(raw);
          const retryCount = opts?.deferredRetryCount ?? 0;

          if (isDeferred && retryCount < 6) {
            setPlayerHint(`Drive sedang sibuk transfer file... Mencoba kembali otomatis (percobaan ${retryCount + 1}/6)...`);
            setLoading(true);
            setError(null);
            setTimeout(() => {
              if (mountGenRef.current !== activeMountGen) return;
              if (seq !== loadSeq.current) return;
              void loadPreview(q, { ...opts, deferredRetryCount: retryCount + 1, soft: true });
            }, 1500);
            return;
          }

          // Keep cached playback if we already painted a hit
          if (!hasUsable) {
            const disconnected = /while disconnected|cannot send requests|koneksi telegram terputus|not connected|drive session ended|drive session stopped|drive session not ready/i.test(
              raw
            );
            setError(
              disconnected
                ? t('ui.generated.koneksi_telegram_putus_saat_memuat_pratinjau_kli_caf3236')
                : raw || t('ui.generated.gagal_memuat_pratinjau_a59ec1e')
            );
            setLoading(false);
          }
        } finally {
          setSwitchingQuality(false);
        }
      };

      if (force || soft) {
        void executeRemoteLoad();
      } else {
        navDebounceTimerRef.current = window.setTimeout(() => {
          navDebounceTimerRef.current = null;
          void executeRemoteLoad();
        }, 110);
      }
    },
    [applyResult, creds, file.id, folderId, gridThumb, neighborIds, previewScopeKey]
  );

  // Load when file / folder changes
  useEffect(() => {
    // Invalidate every async result belonging to the previous identity before
    // resetting state. This also covers navigation to ZIP/custom previews,
    // which do not call loadPreview and previously allowed a late response to
    // repaint the wrong media.
    ++loadSeq.current;
    previewScopeRef.current = previewScopeKey;
    if (navDebounceTimerRef.current != null) {
      window.clearTimeout(navDebounceTimerRef.current);
      navDebounceTimerRef.current = null;
    }
    if (softReloadTimerRef.current != null) {
      window.clearTimeout(softReloadTimerRef.current);
      softReloadTimerRef.current = null;
    }
    try {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    } catch {
      /* best-effort native media teardown */
    }
    const staleStreamIds = new Set(
      [liveStreamIdRef.current, streamIdRef.current, prevStreamForNav.current].filter(
        (sid): sid is string => Boolean(sid)
      )
    );
    staleStreamIds.forEach((sid) => {
      void driveStopStream(creds, sid, { deletePartial: false });
    });
    liveStreamIdRef.current = null;
    streamIdRef.current = null;
    prevStreamForNav.current = null;

    resetViewTools();
    setShowInfo(initialInfoOpen);
    setDataUrl(null);
    setPath(null);
    setStreamUrl(null);
    setStreamId(null);
    setMime(null);
    setPoster(null);
    setError(null);
    setSrcOverride(null);
    setLoading(!isSplitCompareMode);
    setHasVideoFrame(false);
    setTextBody(null);
    setPreviewKind(null);
    setBufferPct(0);
    setStreamDone(false);
    setPlayerHint(null);
    setSeekWarn(null);
    setPreviewState('loading');
    setPreviewSource(null);
    setPreviewIsFallback(false);
    setPreviewWidth(null);
    setPreviewHeight(null);
    setPreviewByteSize(null);
    setPreviewErrorDetail(null);
    setMediaWidth(null);
    setMediaHeight(null);
    if (isSplitCompareMode) {
      setLoading(false);
      return;
    }
    streamRecoverRef.current = false;
    streamMissingHitsRef.current = 0;
    completedStreamRebindRef.current = null;
    completedBlobAttemptRef.current = null;
    if (completedBlobUrlRef.current) {
      URL.revokeObjectURL(completedBlobUrlRef.current);
      completedBlobUrlRef.current = null;
    }
    mediaErrorCountRef.current = 0;
    mediaErrorRecoverAtRef.current = 0;
    nativeStreamReadyRef.current = false;
    liveStreamIdRef.current = null;
    lastSeekKickRef.current = 0;
    hasUserPlayRef.current = false;
    if (customSource) {
      setLoading(!!customSource.loading);
      setError(customSource.error ?? null);
      setDataUrl(customSource.src ?? null);
      setPath(null);
      setStreamUrl(null);
      setStreamId(null);
      setTextBody(customSource.text ?? null);
      if (customSource.kind) setPreviewKind(customSource.kind);
      return;
    }
    // ZIP: browser lists central dir — skip heavy media stream/download path
    if (isZipDriveFile(file)) {
      setLoading(false);
      setError(null);
      setDataUrl(null);
      setPath(null);
      setStreamUrl(null);
      setStreamId(null);
      setTextBody(null);
      setPreviewKind('zip');
      return;
    }
    const q = readQualityPref();
    setQuality(q);
    loadPreview(q);
  }, [previewScopeKey, isSplitCompareMode, initialInfoOpen, customSource?.src, customSource?.loading, customSource?.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronize dynamic updates to customSource
  useEffect(() => {
    if (!customSource) return;
    setLoading(!!customSource.loading);
    setError(customSource.error ?? null);
    setDataUrl(customSource.src ?? null);
    setTextBody(customSource.text ?? null);
    if (customSource.kind) setPreviewKind(customSource.kind);
  }, [customSource?.loading, customSource?.error, customSource?.src, customSource?.text, customSource?.kind]);

  useEffect(() => {
    streamDoneRef.current = streamDone;
  }, [streamDone]);
  useEffect(() => {
    bufferPctRef.current = bufferPct;
  }, [bufferPct]);
  useEffect(() => {
    streamIdRef.current = streamId;
  }, [streamId]);

  /**
   * Abort progressive Telegram download for a stream id.
   * Keep partial on disk (deletePartial=false) so buffer can resume.
   */
  const stopPreviewStream = useCallback(
    (sid: string | null | undefined, opts?: { stopAllIncomplete?: boolean }) => {
      if (!sid && !opts?.stopAllIncomplete) return;
      const c = credsRef.current;
      if (!c) return;
      // Never stopAll by default — that cancelled every live fill and froze the
      // buffer bar at ~0.5–1.5MB (see worker/cache/stream_registry cancelled=true).
      if (opts?.stopAllIncomplete) {
        void driveStopStream(c, null, {
          stopAll: true,
          incompleteOnly: true,
          deletePartial: false,
        });
        return;
      }
      if (sid) {
        void driveStopStream(c, sid, { deletePartial: false });
      }
    },
    []
  );

  /**
   * Unmount / close: stop only THIS stream id.
   * StrictMode remounts once on open — stopAll was killing live fills and
   * leaving cancelled registry entries (buffer never rises).
   */
  useEffect(() => {
    const gen = ++globalStreamTeardownGen;
    mountGenRef.current = gen;
    activeMountGen = gen;
    const mid = file.id;
    const fid = folderId;
    return () => {
      const sid = streamIdRef.current;
      const c = credsRef.current;
      window.setTimeout(() => {
        // Remounted (StrictMode or fast re-open) — do not kill the new session
        if (globalStreamTeardownGen !== gen) return;
        if (!c) return;
        if (sid) void driveStopStream(c, sid, { deletePartial: false });
        // Do NOT stopAll incomplete — thrash-cancel of multi-video fills
        try {
          invalidatePreview(fid, mid);
        } catch {
          /* ignore */
        }
        try {
          const v = videoRef.current;
          if (v) {
            v.pause();
            v.removeAttribute('src');
            v.load();
          }
        } catch {
          /* ignore */
        }
      }, 0);
    };
    // Only on true unmount (modal close) — not every file change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigating to another file / quality: stop previous stream only
  useEffect(() => {
    const prev = prevStreamForNav.current;
    if (prev && prev !== streamId) {
      stopPreviewStream(prev);
    }
    prevStreamForNav.current = streamId;
  }, [streamId, stopPreviewStream]);

  // Stream progress poll — stable deps only (avoid re-create interval → overhead loop).
  // seekWarn / loadPreview / setState must not be effect deps.
  const loadPreviewRef = useRef(loadPreview);
  loadPreviewRef.current = loadPreview;
  const seekWarnRef = useRef(seekWarn);
  seekWarnRef.current = seekWarn;
  const playNudgeAtRef = useRef(0);
  const lastPlayTimeRef = useRef(0);
  const lastTimeAdvanceAtRef = useRef(Date.now());
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    if (!streamId || streamDone) return;
    let alive = true;
    let intervalMs = 300;
    let timer: any = null;

    const schedule = (ms: number) => {
      if (timer) clearInterval(timer);
      intervalMs = ms;
      timer = window.setInterval(() => {
        void tick();
      }, intervalMs);
    };

    const tick = async () => {
      if (!alive || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const st = await driveStreamStatus(creds, streamId);
        if (!alive) return;
        const total = Number(st.total || file.size || 0);
        const prefix = Number(
          st.prefix_bytes != null ? st.prefix_bytes : st.downloaded != null ? st.downloaded : 0
        );
        const filled = Number(
          st.downloaded_filled != null
            ? st.downloaded_filled
            : st.downloaded != null
              ? st.downloaded
              : 0
        );
        let pct = Number(st.percent);
        if (!Number.isFinite(pct) || pct < 0) {
          pct = total > 0 ? (100 * prefix) / total : 0;
        }
        const v = videoRef.current;
        let browserPct = 0;
        let browserHasData = false;
        if (v && Number.isFinite(v.duration) && v.duration > 0) {
          try {
            const b = v.buffered;
            if (b && b.length > 0) {
              let end = 0;
              for (let i = 0; i < b.length; i++) {
                end = Math.max(end, b.end(i));
              }
              browserPct = (100 * end) / v.duration;
              browserHasData = end > 0.05;
            }
          } catch {
            /* ignore */
          }
        }
        // Player buffer bar reflects browser TimeRanges when video has loaded metadata,
        // so when slow internet occurs, slider dot reaches the buffer bar end before pausing.
        let displayPct = browserHasData ? browserPct : pct;
        if (st.done || (total > 0 && prefix >= total * 0.99)) {
          displayPct = 100;
        }
        if (!Number.isFinite(displayPct) || displayPct < 0) displayPct = 0;
        setBufferPct(Math.min(100, Math.round(displayPct)));

        // If pipeline was paused (autoplay→pause race), resume while user is on preview
        if (
          st.paused === true &&
          !userExplicitlyPausedRef.current &&
          streamUrl &&
          streamId
        ) {
          try {
            const idx = streamUrl.indexOf('/stream/');
            if (idx >= 0) {
              const base = streamUrl.slice(0, idx) + `/stream/${streamId}`;
              void fetch(`${base}/resume`, { method: 'POST' }).catch(() => undefined);
            }
          } catch {
            /* ignore */
          }
        }

        // Poll faster while not playing; back off only after real playback
        const healthy =
          (!!v && !v.paused && browserHasData) ||
          st.stream_ready === true ||
          prefix >= 1024 * 1024;
        // Avoid saturating the Tauri command loop while Drive thumbnails and
        // list RPCs are active. This still reacts within one third of a second.
        const wantMs = healthy ? 1000 : 300;
        if (wantMs !== intervalMs) schedule(wantMs);

        if (st.status === 'done' || (total > 0 && prefix >= total * 0.98)) {
          streamMissingHitsRef.current = 0;
          setStreamDone(true);
          setBufferPct(100);
          setPlayerHint(null);
          setSeekWarn(null);
          if (
            v &&
            v.readyState < 1 &&
            streamUrl &&
            completedStreamRebindRef.current !== streamId
          ) {
            completedStreamRebindRef.current = streamId;
            const stickyUrl = streamUrl;
            try {
              v.pause();
              v.removeAttribute('src');
              v.load();
              v.src = stickyUrl;
              v.load();
              window.setTimeout(() => {
                const current = videoRef.current;
                if (!current || current.src !== stickyUrl) return;
                void current.play().catch(() => undefined);
              }, 80);
            } catch {
              /* the normal media error recovery remains available */
            }
          }
        } else if (st.status === 'missing' || st.status === 'cancelled') {
          streamMissingHitsRef.current += 1;
          const playingOk =
            !!v &&
            !v.error &&
            (browserHasData || v.readyState >= 2 || (!v.paused && v.currentTime > 0.2));
          if (playingOk) {
            setPlayerHint((h) => h || 'Buffering…');
          } else {
            // BUG-3 FIX: Call /resume but CHECK the response status before acting.
            // 410 Gone = session expired on server side — force immediate re-RPC.
            if (streamUrl && streamId) {
              const idx = streamUrl.indexOf('/stream/');
              if (idx >= 0) {
                const base = streamUrl.slice(0, idx) + `/stream/${streamId}`;
                fetch(`${base}/resume`, { method: 'POST' }).then((r) => {
                  if (r.status === 410) {
                    // Server confirmed session is gone — force fresh tg_preview_stream
                    softRetryCountRef.current = 999; // skip further soft retries
                    softReloadInFlightRef.current = false;
                    if (mountGenRef.current !== activeMountGen) return;
                    invalidatePreview(folderId, file.id);
                    liveStreamIdRef.current = null;
                    setStreamUrl(null);
                    setStreamId(null);
                    setHasVideoFrame(false);
                    setPlayerHint(t('ui.generated.memuat_ulang_stream_a5f379e'));
                    window.setTimeout(() => {
                      if (mountGenRef.current !== activeMountGen) return;
                      loadPreviewRef.current(quality, { soft: false, force: true });
                    }, 400);
                  }
                }).catch(() => undefined);
              }
            }
            if (streamMissingHitsRef.current >= 5) {
              // Re-RPC only after 5 consecutive missing ticks AND video is truly stuck.
              // Guard: don't overlap with onError rebind — that's the reload-loop root cause.
              streamMissingHitsRef.current = 0;
              softRetryCountRef.current += 1;

              // BUG-3 FIX: After MAX_SOFT_RETRIES failed escalations, show error UI and stop.
              const MAX_SOFT_RETRIES = 3;
              if (softRetryCountRef.current > MAX_SOFT_RETRIES) {
                setPlayerHint(null);
                setError(t('ui.generated.stream_tidak_dapat_dilanjutkan_klik_muat_ulang_u_8af0b55'));
                return; // stop retrying in this poll tick
              }

              if (!softReloadInFlightRef.current) {
                softReloadInFlightRef.current = true;
                setPlayerHint(t('ui.generated.melanjutkan_unduhan_stream_4da4182'));
                softReloadTimerRef.current = window.setTimeout(() => {
                  softReloadInFlightRef.current = false;
                  softReloadTimerRef.current = null;
                  if (mountGenRef.current !== activeMountGen) return;
                  // BUG-3 FIX: force=true so soft guard doesn’t short-circuit the re-RPC
                  loadPreviewRef.current(quality, { soft: false, force: true });
                }, 600);
              } else {
                setPlayerHint(t('ui.generated.melanjutkan_stream_f68fabd'));
              }
            } else {
              setPlayerHint(t('ui.generated.melanjutkan_stream_f68fabd'));
            }
          }
        } else {
          streamMissingHitsRef.current = 0;
        }
        if (st.status === 'error') setHint(st.error || t('ui.generated.stream_error_c5437ba'));

        // Instant Playback Start: Start video as soon as stream server and moov metadata are ready
        const now = Date.now();
        const isMp4 = file.name.toLowerCase().endsWith('.mp4') || (file.mime_type && file.mime_type.toLowerCase() === 'video/mp4');
        const moovOk = !isMp4 || st.moov_ready === true || st.stream_ready === true;
        const streamReady =
          (st.stream_ready === true && moovOk) ||
          browserHasData ||
          (!!v && v.readyState >= 2) ||
          (!!v && Number.isFinite(v.duration) && v.duration > 0 && browserHasData);
        nativeStreamReadyRef.current = st.stream_ready === true;
        if (
          v &&
          (v.paused || v.error) &&
          !v.ended &&
          !seekWarnRef.current &&
          streamReady &&
          now - playNudgeAtRef.current > 120  // 120ms for instant play response
        ) {
          const nearEnd =
            Number.isFinite(v.duration) &&
            v.duration > 0 &&
            v.currentTime >= v.duration - 0.35;
          if (!nearEnd) {
            playNudgeAtRef.current = now;
            if (!v.error && !userExplicitlyPausedRef.current) {
              void v.play().then(() => {
                hasUserPlayRef.current = true;
                userExplicitlyPausedRef.current = false;
                setHasVideoFrame(true);
                setPlayerHint(null);
                setLoading(false);
              }).catch(() => {
                v.muted = true;
                setMuted(true);
                void v.play().then(() => {
                  hasUserPlayRef.current = true;
                  userExplicitlyPausedRef.current = false;
                  setHasVideoFrame(true);
                  setPlayerHint(null);
                  setLoading(false);
                }).catch(() => undefined);
              });
            }
          }
        }

        // Stall Watchdog: Detect Chromium demuxer freeze (video.paused === false but currentTime is stuck)
        if (v && !v.paused && !v.ended && !v.error) {
          const cur = v.currentTime || 0;
          if (Math.abs(cur - lastPlayTimeRef.current) > 0.05) {
            lastPlayTimeRef.current = cur;
            lastTimeAdvanceAtRef.current = now;
          } else if (now - lastTimeAdvanceAtRef.current > 1600 && now - playNudgeAtRef.current > 1000) {
            playNudgeAtRef.current = now;
            try {
              ignoreSeekEventsRef.current += 1;
              v.currentTime = cur;
            } catch {
              ignoreSeekEventsRef.current = Math.max(0, ignoreSeekEventsRef.current - 1);
            }
          }
        }

        if (v && (!v.paused || v.readyState >= 2 || (v.videoWidth && v.videoWidth > 0))) {
          if (!v.paused) {
            setPlayerHint(null);
          } else if (streamReady || v.readyState >= 2) {
            setPlayerHint((h) => (h && h.startsWith('Menyiapkan') ? null : h));
          }
        } else if (
          st.seek_capable &&
          st.moov_ready === false &&
          prefix > 0 &&
          filled > prefix + 64 * 1024 &&
          !seekWarnRef.current
        ) {
          setPlayerHint(t('ui.generated.menyiapkan_metadata_62ab71e'));
        } else if (st.moov_ready === false && prefix > 0 && !browserHasData) {
          setPlayerHint((h) => h || 'Menyiapkan metadata…');
        } else if (st.moov_ready) {
          setPlayerHint((h) =>
            h === 'Menyiapkan metadata…' || h === 'Menyiapkan metadata (moov)…' ? null : h
          );
        }
      } catch {
        /* ignore */
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void tick();
    schedule(intervalMs); // use the cold-start interval (250ms), not a hardcoded value
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable poll (refs for loadPreview/seekWarn)
  }, [streamId, streamDone, creds, file.size, file.id, folderId, quality]);

  // Cached/completed streams bypass the progress poll above. If WebView2 kept
  // its bootstrap Range request pending, reconnect the media element to the
  // same completed local URL once so metadata is parsed immediately.
  useEffect(() => {
    if (!streamDone || !streamUrl || !isVideoDriveFile(file)) return;
    const aborter = new AbortController();
    const rebindTimer = window.setTimeout(() => {
      const v = videoRef.current;
      if (
        !v ||
        v.readyState >= 1 ||
        v.error ||
        completedStreamRebindRef.current === streamId
      ) return;
      completedStreamRebindRef.current = streamId || streamUrl;
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
        v.src = streamUrl;
        v.load();
        void v.play().catch(() => undefined);
      } catch {
        /* normal media error recovery remains available */
      }
    }, 120);
    // Small completed videos are cheap to copy from localhost. This is a
    // WebView2 demuxer fallback only (zero extra Telegram traffic) for the
    // rare case where its original progressive Range connection remains
    // wedged after completion.
    const blobTimer = window.setTimeout(async () => {
      const v = videoRef.current;
      const size = Number(file.size || 0);
      const attemptKey = streamId || streamUrl;
      if (
        !v ||
        v.readyState >= 1 ||
        v.error ||
        size <= 0 ||
        size > 32 * 1024 * 1024 ||
        completedBlobAttemptRef.current === attemptKey
      ) return;
      completedBlobAttemptRef.current = attemptKey;
      try {
        const response = await fetch(streamUrl, {
          cache: 'no-store',
          signal: aborter.signal,
        });
        if (!response.ok) return;
        const blob = await response.blob();
        if (aborter.signal.aborted || blob.size <= 0) return;
        if (completedBlobUrlRef.current) URL.revokeObjectURL(completedBlobUrlRef.current);
        const objectUrl = URL.createObjectURL(blob);
        completedBlobUrlRef.current = objectUrl;
        setSrcOverride(objectUrl);
      } catch {
        /* progressive endpoint remains the primary path */
      }
    }, 650);
    return () => {
      window.clearTimeout(rebindTimer);
      window.clearTimeout(blobTimer);
      aborter.abort();
    };
  }, [file.id, file.size, streamDone, streamId, streamUrl]);

  // BUG-4 FIX: Stream timeout guard — refreshes automatically as long as buffer progress advances.
  // Only triggers error UI if download is completely stuck (0 B/s) without any progress.
  useEffect(() => {
    if (!streamId || streamDone) return;
    // Clear any previous timeout
    if (streamTimeoutRef.current != null) {
      window.clearTimeout(streamTimeoutRef.current);
    }
    const timeoutMs = (file?.size || 0) > 500 * 1024 * 1024 ? 60000 : STREAM_TIMEOUT_MS;
    streamTimeoutRef.current = window.setTimeout(() => {
      streamTimeoutRef.current = null;
      const v = videoRef.current;
      const notStarted = (!v || (v.readyState < 2 && v.currentTime < 0.1)) && !hasVideoFrame;
      if (notStarted) {
        setError(
          t('ui.generated.video_tidak_dapat_diputar_stream_gagal_memuat_se_3698c2d')
        );
        setPlayerHint(null);
      }
    }, timeoutMs);
    return () => {
      if (streamTimeoutRef.current != null) {
        window.clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, streamDone, bufferPct, file?.size]);

  /** True if `t` sits inside any browser buffered range (with slack). */
  const timeInBuffered = useCallback((v: HTMLVideoElement, t: number, slack = 0.75) => {
    try {
      const b = v.buffered;
      if (!b || b.length === 0) return false;
      for (let i = 0; i < b.length; i++) {
        if (t >= b.start(i) - slack && t <= b.end(i) + slack) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  const flashSeekWarn = useCallback((msg: string) => {
    setSeekWarn(msg);
    if (seekWarnTimer.current != null) window.clearTimeout(seekWarnTimer.current);
    seekWarnTimer.current = window.setTimeout(() => {
      setSeekWarn(null);
      seekWarnTimer.current = null;
    }, 2800);
  }, []);

  /**
   * YouTube-like seek: ask worker to pull Telegram bytes at the jump target
   * (concurrent GetFile at offset), then nudge <video> to re-request HTTP Range.
   * Fired from onSeeking (early) and onSeeked (confirm) — unbuffered seeks may
   * never emit seeked until data arrives, so waiting only on seeked deadlocks.
   */
  const handleSeekJump = useCallback(() => {
    if (streamDoneRef.current) return;
    if (!userSeekPendingRef.current) return;
    const v = videoRef.current;
    const sid = streamIdRef.current;
    if (!v || !streamUrl || !sid) return;
    const seekTime = v.currentTime;
    if (!Number.isFinite(seekTime) || seekTime < 0.05) return;

    // Already buffered in the browser — nothing to do
    if (timeInBuffered(v, seekTime, 1.25)) {
      userSeekPendingRef.current = false;
      return;
    }

    // Debounce rapid scrub events (seeking fires continuously while dragging)
    const now = Date.now();
    if (now - lastSeekKickRef.current < 280) return;
    lastSeekKickRef.current = now;
    userSeekPendingRef.current = false;

    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const c = credsRef.current;
    if (!c) return;
    const target = seekTime;

    flashSeekWarn(t('ui.generated.memuat_titik_seek_1717090'));
    void (async () => {
      try {
        await driveStreamSeek(c, sid, {
          time_s: target,
          duration_s: dur > 0 ? dur : undefined,
        });
      } catch {
        /* worker may be restarting */
      }
      // Retry nudge a few times while offset download lands (player re-ranges)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => window.setTimeout(r, 260 + i * 110));
        const vv = videoRef.current;
        if (!vv || streamIdRef.current !== sid) return;
        if (timeInBuffered(vv, target, 1.5)) {
          try {
            // Avoid treating this resume scrub as a new user seek
            ignoreSeekEventsRef.current += 1;
            vv.currentTime = target;
            void vv.play().catch(() => undefined);
          } catch {
            ignoreSeekEventsRef.current = Math.max(0, ignoreSeekEventsRef.current - 1);
          }
          setSeekWarn(null);
          return;
        }
        try {
          ignoreSeekEventsRef.current += 1;
          vv.currentTime = target;
        } catch {
          ignoreSeekEventsRef.current = Math.max(0, ignoreSeekEventsRef.current - 1);
        }
      }
      setSeekWarn(null);
    })();
  }, [streamUrl, timeInBuffered, flashSeekWarn]);

  const lastLookaheadTimeRef = useRef(0);

  /**
   * Proactive contiguous buffering. A lookahead request must start inside the
   * currently playable island. Jumping several seconds beyond bufferedEnd made
   * the Rust sparse filler prioritise a later byte island and could leave a
   * small hole exactly where playback was about to continue.
   */
  const checkAndRequestLookaheadBuffer = useCallback((v: HTMLVideoElement) => {
    if (streamDoneRef.current) return;
    const sid = streamIdRef.current;
    const c = credsRef.current;
    if (!v || !sid || !c || v.paused || v.ended) return;

    const curTime = v.currentTime;
    const dur = v.duration;
    if (!Number.isFinite(curTime) || !Number.isFinite(dur) || dur <= 0) return;
    if (curTime >= dur - 0.5) return;

    let currentBufferedEnd = 0;
    try {
      const b = v.buffered;
      if (b && b.length > 0) {
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= curTime + 0.3 && curTime <= b.end(i) + 0.3) {
            currentBufferedEnd = Math.max(currentBufferedEnd, b.end(i));
          }
        }
      }
    } catch {
      /* ignore */
    }

    const bufferAhead = Math.max(0, currentBufferedEnd - curTime);

    // Ask early enough for the next MTProto batch, but keep the demand target
    // inside the current island so find_missing_offset_from advances to the
    // first contiguous gap rather than creating a disjoint future island.
    const now = Date.now();
    if (bufferAhead < 10.0 && now - lastLookaheadTimeRef.current > 700) {
      lastLookaheadTimeRef.current = now;
      const targetTime = Math.min(dur - 0.1, curTime + Math.min(0.5, Math.max(0.1, bufferAhead * 0.25)));
      void driveStreamSeek(c, sid, {
        time_s: targetTime,
        duration_s: dur,
      }).catch(() => {});
    }
  }, []);

  const recoverStalledVideo = useCallback((reason: string) => {
    const v = videoRef.current;
    if (!v || v.paused || v.ended) return;
    const cur = v.currentTime;
    if (timeInBuffered(v, cur, 0.5)) {
      console.debug(`[STREAM_RECOVERY] Nudging video on ${reason} at ${cur}s`);
      try {
        void v.play().catch(() => {});
      } catch {
        /* ignore */
      }
    } else if (!streamDoneRef.current) {
      const sid = streamIdRef.current;
      const c = credsRef.current;
      if (sid && c) {
        void driveStreamSeek(c, sid, {
          time_s: cur,
          duration_s: v.duration > 0 ? v.duration : undefined,
        }).catch(() => {});
      }
    }
  }, [timeInBuffered]);

  const getStreamBaseUrl = useCallback((url: string, sid: string) => {
    const idx = url.indexOf('/stream/');
    if (idx < 0) return null;
    return url.slice(0, idx) + `/stream/${sid}`;
  }, []);

  const handlePause = useCallback(() => {
    // Never suspend Telegram fill before the user/autoplay has actually played.
    if (!hasUserPlayRef.current) return;
    if (!streamUrl || !streamId) return;
    const baseUrl = getStreamBaseUrl(streamUrl, streamId);
    if (baseUrl) {
      fetch(`${baseUrl}/pause`, { method: 'POST' }).catch(() => undefined);
    }
  }, [streamUrl, streamId, getStreamBaseUrl]);

  const handlePlay = useCallback(() => {
    hasUserPlayRef.current = true;
    if (!streamUrl || !streamId) return;
    const baseUrl = getStreamBaseUrl(streamUrl, streamId);
    if (baseUrl) {
      fetch(`${baseUrl}/resume`, { method: 'POST' }).catch(() => undefined);
    }
  }, [streamUrl, streamId, getStreamBaseUrl]);

  useEffect(() => {
    return () => {
      if (seekWarnTimer.current != null) window.clearTimeout(seekWarnTimer.current);
    };
  }, []);

  // Fullscreen state sync
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Playback rate — only react to rate changes.
  // onLoadedMetadata already applies the rate when a new video element mounts,
  // so we must NOT include streamUrl/path here (videoRef is null at that point).
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.readyState >= 1) v.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted, streamUrl]);

  // Loop / repeat after end
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.loop = loopVideo;
    try {
      localStorage.setItem('drive.preview.loop', loopVideo ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [loopVideo, streamUrl, path]);

  /** Place fixed menus near trigger — never clipped by toolbar; flip up if near bottom */
  const placeMenuNear = useCallback((btn: HTMLElement | null, estH = 240) => {
    if (!btn || typeof window === 'undefined') return null;
    const r = btn.getBoundingClientRect();
    const width = Math.min(300, Math.max(220, r.width + 80));
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    if (spaceBelow >= Math.min(estH, 160) || spaceBelow >= spaceAbove) {
      const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 100));
      return { top, left, width };
    } else {
      // Open upward — pin bottom edge 8px above button top
      const bottom = Math.max(8, window.innerHeight - r.top + 8);
      return { bottom, left, width };
    }
  }, []);

  useEffect(() => {
    if (!qualityOpen) {
      setQualityMenuPos(null);
      return;
    }
    const update = () => setQualityMenuPos(placeMenuNear(qualityBtnRef.current));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [qualityOpen, placeMenuNear]);

  useEffect(() => {
    if (!rateOpen) {
      setRateMenuPos(null);
      return;
    }
    const update = () => setRateMenuPos(placeMenuNear(rateBtnRef.current));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [rateOpen, placeMenuNear]);

  // Outside click menus (include fixed popover nodes)
  useEffect(() => {
    if (!qualityOpen && !rateOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (qualityOpen) {
        const inBtn = qualityBtnRef.current?.contains(t);
        const inMenu = qualityMenuRef.current?.contains(t);
        if (!inBtn && !inMenu) setQualityOpen(false);
      }
      if (rateOpen) {
        const inBtn = rateBtnRef.current?.contains(t);
        const inMenu = rateMenuRef.current?.contains(t);
        if (!inBtn && !inMenu) setRateOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [qualityOpen, rateOpen]);

  // Prefer file metadata immediately (before RPC) so toolbar doesn't flash video tools on photos
  const mediaKind = useMemo(() => {
    if (customSource?.kind) return customSource.kind === 'binary' ? ('other' as const) : customSource.kind;
    if (isImageDriveFile(file) && !isVideoDriveFile(file)) return 'image' as const;
    if (isVideoDriveFile(file) && !isImageDriveFile(file)) return 'video' as const;
    if (isAudioDriveFile(file)) return 'audio' as const;
    if (isPdfDriveFile(file)) return 'pdf' as const;
    if (isTextDriveFile(file)) return 'text' as const;
    if (isZipDriveFile(file)) return 'zip' as const;
    return resolvePreviewKind(file, mime, previewKind);
  }, [customSource?.kind, file, mime, previewKind]);
  const isVideo = mediaKind === 'video';
  const isImage = mediaKind === 'image';
  const isAudio = mediaKind === 'audio';
  const isPdf = mediaKind === 'pdf';
  const isText = mediaKind === 'text';
  const isZip = mediaKind === 'zip';
  const isDocOther = mediaKind === 'other';

  const handleCloseOrDismiss = useCallback(() => {
    if (qualityOpen) {
      setQualityOpen(false);
      return true;
    }
    if (rateOpen) {
      setRateOpen(false);
      return true;
    }
    if (showInfo) {
      setShowInfo(false);
      return true;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return true;
    }
    onClose();
    return true;
  }, [onClose, qualityOpen, rateOpen, showInfo]);

  // Mouse Back / Forward button navigation (Button 3 = Back, Button 4 = Forward)
  useEffect(() => {
    if (isZip) return; // Yield to DriveZipBrowser

    const handleMouseBackForward = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();

        if (e.button === 3) {
          // Back Button: dismiss menu/info/fullscreen or close preview modal
          handleCloseOrDismiss();
        } else if (e.button === 4) {
          // Forward Button: next media in sequence
          if (hasNext && onNext) {
            onNext();
          }
        }
      }
    };

    window.addEventListener('auxclick', handleMouseBackForward, true);
    window.addEventListener('mouseup', handleMouseBackForward, true);
    return () => {
      window.removeEventListener('auxclick', handleMouseBackForward, true);
      window.removeEventListener('mouseup', handleMouseBackForward, true);
    };
  }, [handleCloseOrDismiss, hasNext, isZip, onNext]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (isZip) return;

      if (
        e.key === 'Escape' ||
        e.key === 'Backspace' ||
        (e.altKey && e.key === 'ArrowLeft') ||
        e.key === 'BrowserBack'
      ) {
        e.preventDefault();
        e.stopPropagation();
        handleCloseOrDismiss();
        return;
      }

      // Debounce rapid nav so stream RPC doesn't pile up
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (navLock.current) return;
        navLock.current = true;
        window.setTimeout(() => {
          navLock.current = false;
        }, 180);
        if (duplicateContext && duplicateContext.activeFilteredGroups.length > 0) {
          if (e.shiftKey) {
            // Shift + Arrow = Direct Group Jump
            if (e.key === 'ArrowRight') {
              const nextIdx = duplicateContext.currentGroupIndex + 1;
              const nextGroup = duplicateContext.activeFilteredGroups[nextIdx];
              if (nextGroup && duplicateContext.onNavigateGroup) {
                duplicateContext.onNavigateGroup(nextIdx, nextGroup.files[0]);
              }
            } else if (e.key === 'ArrowLeft') {
              const prevIdx = duplicateContext.currentGroupIndex - 1;
              const prevGroup = duplicateContext.activeFilteredGroups[prevIdx];
              if (prevGroup && duplicateContext.onNavigateGroup) {
                duplicateContext.onNavigateGroup(prevIdx, prevGroup.files[0]);
              }
            }
          } else {
            // Normal Arrow = Intelligent Sequential Intra-Group First
            if (e.key === 'ArrowRight') {
              handleSequentialNext();
            } else if (e.key === 'ArrowLeft') {
              handleSequentialPrev();
            }
          }
          return;
        }

        if (e.key === 'ArrowRight' && hasNext && onNext) onNext();
        if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev();
        return;
      }

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        // Center-focused zoom (no cursor)
        applyZoomAt(zoomRef.current + ZOOM_STEP, null);
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        applyZoomAt(zoomRef.current - ZOOM_STEP, null);
      }
      if (e.key === '0' && !e.ctrlKey) {
        resetZoom();
      }
      if (e.key === 'r' || e.key === 'R') setRotation((r) => (r + 90) % 360);
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'i' || e.key === 'I') setShowInfo((v) => !v);
      // Mute only applies to video (use file meta — available before stream resolves)
      const fileIsVideo = isVideoDriveFile(file) && !isImageDriveFile(file);
      if ((e.key === 'm' || e.key === 'M') && fileIsVideo) setMuted((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // applyZoomAt / resetZoom read latest via refs / setState — stable enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handleCloseOrDismiss,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
    isZip,
    file,
    duplicateContext,
    handleSequentialNext,
    handleSequentialPrev,
  ]);

  // Close video/audio-only menus when media kind changes (e.g. next to a photo)
  useEffect(() => {
    if (!isVideo && !isAudio) {
      setRateOpen(false);
      setQualityOpen(false);
      setPlaybackRate(1);
      setMuted(false);
    }
  }, [isVideo, isAudio, file.id]);

  const mediaSrc = useMemo(
    () =>
      previewStateMatchesScope
        ? customSource?.src || buildMediaSrc(streamUrl, dataUrl, path, isImage, { forVideo: isVideo || isAudio })
        : null,
    [previewStateMatchesScope, customSource?.src, streamUrl, dataUrl, path, isImage, isVideo, isAudio]
  );

  // Fallback sources if primary fails — never inject poster/thumb into <video>
  const fallbackSrcs = useMemo(() => {
    const list: string[] = [];
    const primary = mediaSrc;
    const candidates = isVideo
      ? [
          // Prefer fresh HTTP stream only; incomplete .stream paths are not playable
          buildMediaSrc(streamUrl, null, null, false, { forVideo: true }),
          // Complete local file (faststart remux / full cache) only
          buildMediaSrc(null, null, path, false, { forVideo: true }),
        ]
      : [
          buildMediaSrc(streamUrl, dataUrl, path, true, { forVideo: false }),
          buildMediaSrc(streamUrl, dataUrl, path, false, { forVideo: false }),
          buildMediaSrc(null, dataUrl, path, true, { forVideo: false }),
          poster || gridThumb,
        ];
    for (const c of candidates) {
      if (c && c !== primary && !list.includes(c)) list.push(c);
    }
    return list;
  }, [mediaSrc, streamUrl, dataUrl, path, isVideo, poster, gridThumb]);


  const activeSrc = srcOverride || mediaSrc;

  // Reset override only on file change — not every mediaSrc string refresh
  // (progressive soft revalidate used to flip mediaSrc and remount <video>).
  useEffect(() => {
    setSrcOverride(null);
  }, [file.id]);

  const showVideo = !!activeSrc && isVideo;
  const showImage = !!activeSrc && isImage;
  const showAudio = !!activeSrc && isAudio;
  const pdfSrc = useMemo(() => {
    if (!isPdf) return null;
    // Never feed incomplete progressive streams into the PDF iframe —
    // Chromium/WebView2 shows "We can't open this file" for partial PDFs.
    const completeEnough =
      streamDone ||
      bufferPct >= 98 ||
      (!!path && !/\.stream\./i.test(path));
    // Prefer local file path (asset protocol) when we have a complete cache file
    if (completeEnough && path && detectTauriRuntime() && !/\.stream\./i.test(path)) {
      try {
        return convertFileSrc(path);
      } catch {
        /* fall through */
      }
    }
    // HTTP only when stream is done / fully buffered
    if (completeEnough && streamUrl && /^https?:\/\//i.test(streamUrl)) {
      // Hint PDF viewer; some engines need explicit type via fragment
      return streamUrl.includes('#') ? streamUrl : `${streamUrl}#toolbar=1`;
    }
    if (dataUrl && dataUrl.startsWith('data:application/pdf')) return dataUrl;
    return null;
  }, [isPdf, streamUrl, path, dataUrl, streamDone, bufferPct]);

  // Load text body from the bounded Rust result, local cache, or Rust HTTP stream.
  useEffect(() => {
    if (!isText) {
      return;
    }
    // The cached card can paint before the cold native preview command returns.
    // Do not manufacture an error while there is no source result to evaluate;
    // loadPreview owns terminal command errors and clears this state on success.
    if (
      previewState === 'loading' &&
      textBody == null &&
      !streamUrl &&
      !path &&
      !dataUrl
    ) {
      return;
    }
    // Already set from applyResult(text_content)
    if (textBody != null && textBody !== '') {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const formatText = (raw: string) => {
      let text = raw;
      const name = (file.name || '').toLowerCase();
      const isJson =
        name.endsWith('.json') ||
        (mime || '').includes('json') ||
        text.trim().startsWith('{') ||
        text.trim().startsWith('[');
      if (isJson) {
        try {
          text = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          /* keep raw */
        }
      }
      return text.length > 800_000 ? text.slice(0, 800_000) + '\n\n… (dipotong)' : text;
    };

    const tryFetch = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return formatText(await res.text());
    };

    (async () => {
      try {
        setLoading(true);
        // 0) RUST-first: local cache path (no Python / no HTTP stream)
        if (path && detectTauriRuntime()) {
          try {
            const { previewLocalDocument } = await import('../../../lib/tauri/rustBackend');
            const rustPrev = await previewLocalDocument(path);
            if (rustPrev?.textContent != null && rustPrev.textContent !== '') {
              if (!cancelled) {
                setTextBody(
                  formatText(
                    rustPrev.textContent.length > 800_000
                      ? rustPrev.textContent.slice(0, 800_000) + '\n\n… (dipotong)'
                      : rustPrev.textContent
                  )
                );
                setLoading(false);
                setError(null);
              }
              return;
            }
          } catch {
            /* fall through */
          }
        }
        // 1) data: URL
        if (dataUrl && dataUrl.startsWith('data:')) {
          const comma = dataUrl.indexOf(',');
          const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
          const isB64 = /;base64/i.test(dataUrl.slice(0, Math.max(0, comma)));
          const raw = isB64 ? atob(payload) : decodeURIComponent(payload);
          if (!cancelled) {
            setTextBody(formatText(raw));
            setLoading(false);
            setError(null);
          }
          return;
        }
        // 2) Local path via Tauri asset protocol
        if (path && detectTauriRuntime()) {
          try {
            const localUrl = convertFileSrc(path);
            const text = await tryFetch(localUrl);
            if (!cancelled) {
              setTextBody(text);
              setLoading(false);
              setError(null);
            }
            return;
          } catch {
            /* fall through to stream */
          }
        }
        // 3) Rust progressive HTTP stream — fallback only
        if (streamUrl && /^https?:\/\//i.test(streamUrl)) {
          try {
            const text = await tryFetch(streamUrl);
            if (!cancelled) {
              setTextBody(text);
              setLoading(false);
              setError(null);
            }
            return;
          } catch {
            /* fall through */
          }
        }
        if (!cancelled) {
          setError(
            t('ui.generated.gagal_memuat_teks_klik_coba_lagi_untuk_mengunduh_be0e11f')
          );
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          const msg = String(e?.message || e || 'Gagal membaca teks');
          setError(
            /failed to fetch/i.test(msg)
              ? t('ui.generated.gagal_memuat_teks_stream_putus_klik_coba_lagi_9973c53')
              : msg
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isText, textBody, streamUrl, path, dataUrl, file.name, mime, previewKind, previewState]);

  /** Always offer resolution menu for video (Telegram-style) */
  const resolutionOptions =
    qualities.length >= 2 ? qualities : isVideo ? defaultVideoQualities : qualities;
  const showThumbSkeleton =
    !customSource &&
    (!isTgsDriveFile(file) || !activeSrc) &&
    (loading || ((isVideo || isImage) && !activeSrc)) &&
    !error &&
    !tooLarge &&
    !!(poster || gridThumb);

  const activeResolution =
    resolutionOptions.find((q) => q.id === quality) ||
    resolutionOptions.find((q) => q.recommended) ||
    resolutionOptions[0] ||
    null;

  const tryNextSrc = useCallback(() => {
    const cur = activeSrc;
    const pool = [mediaSrc, ...fallbackSrcs].filter(Boolean) as string[];
    const idx = cur ? pool.indexOf(cur) : -1;
    const next = pool[idx + 1] || pool.find((s) => s !== cur);
    if (next && next !== cur) {
      setSrcOverride(next);
      setError(null);
      return true;
    }
    return false;
  }, [activeSrc, mediaSrc, fallbackSrcs]);

  const handleQualityChange = (next: string) => {
    if (!next || next === quality || switchingQuality) return;
    const v = videoRef.current;
    const t = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    setSwitchingQuality(true);
    setQuality(next);
    writeQualityPref(next);
    loadPreview(next, { resumeAt: t, soft: true });
  };

  const runDownload = async () => {
    if (!creds || saving) return;
    try {
      setSaving(true);
      const defaultName = file.name.replace(/[<>:"/\\|?*]/g, '_');
      // Dynamic import — static plugin-dialog can throw "plugins undefined" on early load
      const { save } = await import('@tauri-apps/plugin-dialog');
      const savePath = await save({ defaultPath: defaultName, title: 'Simpan file' });
      if (!savePath) return;

      // Fast Copy from local cache if file is already pre-downloaded in preview cache (path != null)
      if (path) {
        try {
          const { copyFile } = await import('@tauri-apps/plugin-fs');
          await copyFile(path, savePath);
          return;
        } catch (copyErr) {
          console.warn('[DrivePreviewModal] Fast local copy failed, falling back to Grammers download:', copyErr);
        }
      }

      if (onEnqueueDownloadSingle) {
        await onEnqueueDownloadSingle({
          messageId: file.id,
          folderId,
          savePath,
          name: file.name,
        });
      } else {
        onOpenTransferManager?.();
        const res = await tgDownloadFile({
          session: creds.session,
          apiId: Number(creds.apiId) || 0,
          apiHash: creds.apiHash,
          chatId: String(folderId ?? 'me'),
          messageId: file.id,
          destPath: savePath,
        });
        if (!res?.ok) {
          throw new Error(res?.userMessage || res?.error?.message || 'Gagal mengunduh berkas');
        }
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    if (customSource?.onExtract) {
      customSource.onExtract();
      return;
    }
    if (!creds || saving) return;
    setConfirmDlg({
      kind: 'download',
      names: [file.name],
      onConfirm: () => {
        void runDownload();
      },
    });
  };

  const dismissOpenProgress = useCallback(() => {
    openCancelledRef.current = true;
    setOpeningSystem(false);
    setOpenProgressMsg(null);
    // Kill OPEN job only — never cancelDriveJob (that is Transfer Manager)
    void (async () => {
      try {
        await cancelDriveOpenJob();
      } catch {
        /* ignore */
      }
      try {
        // Only wipe open-cache partials when path known; avoid wiping transfer downloads
        if (path) {
          await cleanupPartialDownloads([path]);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [path]);

  const handleOpenSystem = async () => {
    if (!creds || openingSystem) return;
    openCancelledRef.current = false;
    setOpeningSystem(true);
    setError(null);
    setOpenProgressMsg(t('ui.generated.menyiapkan_36dd6d6'));
    try {
      await openDriveFileInSystem(creds, file, folderId, path, (p) => {
        if (openCancelledRef.current) return;
        setOpenProgressMsg(p.message);
      });
      if (openCancelledRef.current) return;
      setOpenProgressMsg(t('ui.generated.dibuka_di_aplikasi_default_e6ccddb'));
      window.setTimeout(() => {
        if (!openCancelledRef.current) setOpenProgressMsg(null);
      }, 2500);
    } catch (e: any) {
      if (openCancelledRef.current) return;
      setError(String(e?.message || e));
      setOpenProgressMsg(null);
    } finally {
      if (!openCancelledRef.current) setOpeningSystem(false);
      else setOpeningSystem(false);
    }
  };

  const handleOpenWith = async () => {
    if (!creds || openingSystem) return;
    openCancelledRef.current = false;
    setOpeningSystem(true);
    setError(null);
    setOpenProgressMsg(t('ui.generated.menyiapkan_buka_dengan_4ae1927'));
    try {
      await openDriveFileWithApp(creds, file, folderId, path, (p) => {
        if (openCancelledRef.current) return;
        setOpenProgressMsg(p.message);
      });
      if (openCancelledRef.current) return;
      setOpenProgressMsg(t('ui.generated.dialog_windows_dibuka_pilih_aplikasi_tutup_dialo_bcf0ba6'));
      window.setTimeout(() => {
        if (!openCancelledRef.current) setOpenProgressMsg(null);
      }, 5000);
    } catch (e: any) {
      if (openCancelledRef.current) return;
      setError(String(e?.message || e));
      setOpenProgressMsg(null);
    } finally {
      setOpeningSystem(false);
    }
  };

  /** Print PDF: iframe print dialog, or open system print after ensuring local file */
  const handlePrintPdf = async () => {
    if (!isPdf) return;
    openCancelledRef.current = false;
    setError(null);

    // 1) Prefer in-app iframe print (Windows print UI has its own Cancel)
    const frame = pdfFrameRef.current;
    if (frame?.contentWindow && pdfSrc) {
      try {
        setOpenProgressMsg(t('ui.generated.membuka_dialog_cetak_batal_di_dialog_windows_unt_26ba2df'));
        frame.contentWindow.focus();
        frame.contentWindow.print();
        window.setTimeout(() => {
          if (!openCancelledRef.current) setOpenProgressMsg(null);
        }, 4000);
        return;
      } catch {
        /* fall through to system path */
      }
    }

    // 2) Ensure file on disk then open with default app (user prints from there)
    if (!creds || !isDesktop()) {
      setError(t('ui.generated.cetak_pdf_hanya_di_aplikasi_desktop_setelah_prat_4e7de43'));
      return;
    }
    if (openingSystem) return;
    setOpeningSystem(true);
    setOpenProgressMsg(t('ui.generated.menyiapkan_pdf_untuk_cetak_389c982'));
    try {
      const local = await ensureLocalDocument(creds, file, folderId, path, (p) => {
        if (openCancelledRef.current) return;
        setOpenProgressMsg(`${p.message} · klik Batal untuk kembali`);
      });
      if (openCancelledRef.current) return;
      setOpenProgressMsg(t('ui.generated.membuka_pdf_gunakan_cetak_di_aplikasi_lalu_tutup_3bd85ab'));
      await openInSystem(local, (p) => {
        if (openCancelledRef.current) return;
        setOpenProgressMsg(p.message);
      });
      if (openCancelledRef.current) return;
      window.setTimeout(() => {
        if (!openCancelledRef.current) setOpenProgressMsg(null);
      }, 5000);
    } catch (e: any) {
      if (openCancelledRef.current) return;
      setError(String(e?.message || e));
      setOpenProgressMsg(null);
    } finally {
      setOpeningSystem(false);
    }
  };


  const handleCopyText = async () => {
    if (!textBody) return;
    try {
      await navigator.clipboard.writeText(textBody);
    } catch {
      /* ignore */
    }
  };

  const toggleFullscreen = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
  };

  /**
   * Zoom with stable focal point. Range: MIN_ZOOM (25%) … MAX_ZOOM (600%).
   * Default open is always 100%. Below 100% pan is centered (overview);
   * above 100% pan tracks the focal so zoom-in stays under the cursor.
   */
  const applyZoomAt = useCallback(
    (nextZoom: number, focalClient: { x: number; y: number } | null) => {
      const z = zoomRef.current || 1;
      const p = panRef.current || { x: 0, y: 0 };
      const next = clamp(Math.round(nextZoom * 1000) / 1000, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(next - z) < 0.0005) return;

      // At or below 100%: allow zoom-out (down to 25%), always re-center pan
      if (next <= 1) {
        setZoom(next);
        setPan({ x: 0, y: 0 });
        zoomRef.current = next;
        panRef.current = { x: 0, y: 0 };
        return;
      }

      // Focal point relative to stage center (transform origin)
      let mx = 0;
      let my = 0;
      const stage = stageRef.current;
      if (stage && focalClient) {
        const rect = stage.getBoundingClientRect();
        mx = focalClient.x - (rect.left + rect.width / 2);
        my = focalClient.y - (rect.top + rect.height / 2);
      }

      // Keep the same world point under the focal after scale change:
      // screen = pan + zoom * local  →  pan' = F - (z'/z) * (F - pan)
      // If coming from ≤100% (pan was 0), z may be <1 — still valid.
      const ratio = next / Math.max(z, 0.01);
      let nx = mx - ratio * (mx - p.x);
      let ny = my - ratio * (my - p.y);

      // Soft clamp so image can't be panned infinitely off-screen
      const maxPan = Math.max(400, 1200 * next);
      nx = clamp(nx, -maxPan, maxPan);
      ny = clamp(ny, -maxPan, maxPan);

      setZoom(next);
      setPan({ x: nx, y: ny });
      zoomRef.current = next;
      panRef.current = { x: nx, y: ny };
    },
    []
  );

  const zoomBy = (delta: number, focalClient?: { x: number; y: number } | null) => {
    if (isSplitCompareMode) {
      updateActiveTransform((prev) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom + delta));
        return {
          ...prev,
          zoom: next,
          pan: next <= 1 ? { x: 0, y: 0 } : prev.pan,
        };
      });
    } else {
      applyZoomAt(zoomRef.current + delta, focalClient ?? null);
    }
  };

  const resetZoom = useCallback(() => {
    if (isSplitCompareMode) {
      updateActiveTransform((prev) => ({
        ...prev,
        zoom: 1,
        pan: { x: 0, y: 0 },
      }));
    } else {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      zoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      setIsDragging(false);
      dragRef.current = null;
    }
  }, [isSplitCompareMode, activeSplitSlot]);

  const flushPan = useCallback(() => {
    panRaf.current = null;
    const next = panPending.current;
    if (!next) return;
    panPending.current = null;
    panRef.current = next;
    setPan(next);
  }, []);

  const schedulePan = useCallback(
    (next: { x: number; y: number }) => {
      panPending.current = next;
      panRef.current = next; // immediate for subsequent move math
      if (panRaf.current == null) {
        panRaf.current = requestAnimationFrame(flushPan);
      }
    },
    [flushPan]
  );

  const endPanDrag = useCallback((pointerId?: number) => {
    const d = dragRef.current;
    if (!d?.active) return;
    d.active = false;
    dragRef.current = null;
    setIsDragging(false);
    if (panRaf.current != null) {
      cancelAnimationFrame(panRaf.current);
      panRaf.current = null;
    }
    if (panPending.current) {
      setPan(panPending.current);
      panPending.current = null;
    }
    // Window listeners cleaned in effect return / next start
    void pointerId;
  }, []);

  // Window-level move/up — WebView often loses pointer events outside the element
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d?.active) return;
      if (pointerIdMatches(d.pointerId, e.pointerId) === false) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        d.moved = true;
      }
      schedulePan({
        x: d.panX + dx,
        y: d.panY + dy,
      });
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d?.active) return;
      if (pointerIdMatches(d.pointerId, e.pointerId) === false) return;
      endPanDrag(e.pointerId);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      if (panRaf.current != null) cancelAnimationFrame(panRaf.current);
    };
  }, [schedulePan, endPanDrag]);

  // Native non-passive wheel listener attached to window for smooth mouse wheel + trackpad pinch zoom & pan
  useEffect(() => {
    const handleNativeWheel = (e: WheelEvent) => {
      if (!showImage && !showVideo) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Ensure gesture is over preview modal backdrop or media stage
      const backdrop = target.closest('.drive-preview-backdrop');
      if (!backdrop) return;

      // In Split Compare mode, only zoom if target is directly hovering over media container
      if (isSplitCompareMode) {
        const isOverMedia = target.closest('.drive-preview-split-media-wrap, .drive-preview-split-media');
        if (!isOverMedia) {
          return;
        }
      }

      // Skip controls bar, text box, or toolbar
      if (target.closest('.drive-preview-video-controls-bar, .drive-preview-text-box, .drive-preview-toolbar')) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Normalize deltas across pixel/line/page modes
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaMode === 2 ? e.deltaX * 400 : e.deltaX;

      if (e.ctrlKey || e.metaKey) {
        // Trackpad 2-finger PINCH-TO-ZOOM: dy > 0 (pinch in -> zoom out), dy < 0 (pinch out -> zoom in)
        const zoomFactor = Math.pow(0.99, dy);
        const targetZoom = clamp(zoomRef.current * zoomFactor, MIN_ZOOM, MAX_ZOOM);
        applyZoomAt(targetZoom, { x: e.clientX, y: e.clientY });
      } else if (zoomRef.current > 1.01) {
        // Zoomed in: 2-finger trackpad movement PANS the image/video
        const p = panRef.current;
        const maxPan = Math.max(400, 1200 * zoomRef.current);
        const nx = clamp(p.x - dx, -maxPan, maxPan);
        const ny = clamp(p.y - dy, -maxPan, maxPan);
        setPan({ x: nx, y: ny });
        panRef.current = { x: nx, y: ny };
      } else {
        // Standard Mouse Scroll Wheel (discrete step zoom)
        const steps = Math.max(1, Math.min(4, Math.round(Math.abs(dy) / 80)));
        const dir = dy > 0 ? -ZOOM_STEP * steps : ZOOM_STEP * steps;
        zoomBy(dir, { x: e.clientX, y: e.clientY });
      }
    };

    window.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleNativeWheel);
    };
  }, [showImage, showVideo, applyZoomAt, zoomBy]);

  const onWheelStage = (e: React.WheelEvent) => {
    if (isSplitCompareMode) return;
    if (!showImage && !showVideo) return;
    e.preventDefault();
    e.stopPropagation();

    // Normalize deltaY based on deltaMode (0: pixels, 1: lines, 2: pages)
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;

    if (e.ctrlKey) {
      // 2-finger trackpad pinch-to-zoom or Ctrl+Wheel continuous smooth zoom
      const zoomFactor = Math.exp(-dy * 0.004);
      const targetZoom = clamp(zoomRef.current * zoomFactor, MIN_ZOOM, MAX_ZOOM);
      applyZoomAt(targetZoom, { x: e.clientX, y: e.clientY });
    } else {
      // Standard Mouse Scroll Wheel
      const steps = Math.max(1, Math.min(4, Math.round(Math.abs(dy) / 80)));
      const dir = dy > 0 ? -ZOOM_STEP * steps : ZOOM_STEP * steps;
      zoomBy(dir, { x: e.clientX, y: e.clientY });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!showImage && !showVideo) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    if (showVideo) {
      const t = e.target as HTMLElement;
      if (t.closest('.drive-preview-video-controls-bar') != null) {
        return;
      }
      if (zoomRef.current <= 1 && !isMagnifierMode) return;
    }

    if (zoomRef.current <= 1 && !isMagnifierMode && !showImage) return;

    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* WebView may ignore; window listeners still handle drag */
    }
    const p = panRef.current;
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: p.x,
      panY: p.y,
      moved: false,
    };
    setIsDragging(true);
  };

  const onPointerUpLocal = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    endPanDrag(e.pointerId);
  };

  const onImageDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
    endPanDrag();
    if (Math.abs(zoomRef.current - 1) > 0.05) {
      resetZoom();
    } else {
      applyZoomAt(2, { x: e.clientX, y: e.clientY });
    }
  };

  /** Cursor: grab when zoomed-in · zoom-in cursor at ≤100% · grabbing while drag */
  const mediaCursorClass =
    isDragging
      ? 'is-dragging'
      : isMagnifierMode || showImage
        ? zoom > 1.01
          ? 'is-pannable'
          : 'is-zoomable'
        : zoom > 1.01
          ? 'is-pannable'
          : '';

  /** Shared pan+zoom+rotate for image & video */
  const mediaTransform = `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${
    zoom * (flipH ? -1 : 1)
  }, ${zoom * (flipV ? -1 : 1)})`;

  const updateVideoBuffered = () => {
    const v = videoRef.current;
    if (!v || !v.duration || !Number.isFinite(v.duration) || v.duration <= 0) return;
    let end = 0;
    try {
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
          end = v.buffered.end(i);
          break;
        }
      }
      if (end === 0 && v.buffered.length > 0) {
        end = v.buffered.end(v.buffered.length - 1);
      }
    } catch {
      /* ignore */
    }
    const pct = Math.min(100, Math.max(0, (end / v.duration) * 100));
    setVideoBufferedPercent(pct);
  };

  const resetControlsTimeout = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 1800);
  };

  const handleVideoPointerDown = (e: React.PointerEvent) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    resetControlsTimeout();
    if (isMagnifierMode) {
      onPointerDown(e);
      return;
    }

    // Start Hold Speed Up timer (250ms hold -> 2x speed)
    holdTimerRef.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) {
        speedupActiveRef.current = true;
        originalSpeedRef.current = v.playbackRate;
        v.playbackRate = 2.0;
        setIsSpeedingUp(true);
      }
    }, 250);
  };

  const handleVideoPointerLeave = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (speedupActiveRef.current) {
      speedupActiveRef.current = false;
      setIsSpeedingUp(false);
      const v = videoRef.current;
      if (v) {
        v.playbackRate = playbackRate;
      }
    }
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    setControlsVisible(false);
  };

  const handleVideoPointerUp = (e: React.PointerEvent) => {
    resetControlsTimeout();
    if (isMagnifierMode) {
      onPointerUpLocal(e);
      // In magnifier mode, allow double click to zoom in/out or drag to pan
      const now = Date.now();
      const timeSinceLast = now - lastClickTimeRef.current;
      if (timeSinceLast < 300) {
        lastClickTimeRef.current = 0;
        onImageDoubleClick(e as unknown as React.MouseEvent);
      } else {
        lastClickTimeRef.current = now;
      }
      return;
    }
    // Cancel hold timer
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    // If hold speedup was active, restore original speed
    if (speedupActiveRef.current) {
      speedupActiveRef.current = false;
      setIsSpeedingUp(false);
      const v = videoRef.current;
      if (v) {
        v.playbackRate = playbackRate;
      }
      return;
    }

    // Ignore if drag movement > 6px
    const dist = Math.hypot(
      e.clientX - pointerDownPosRef.current.x,
      e.clientY - pointerDownPosRef.current.y
    );
    if (dist > 6) return;

    // Single vs Double Click Logic
    const now = Date.now();
    const timeSinceLast = now - lastClickTimeRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickX = e.clientX - rect.left;

    if (timeSinceLast < 300) {
      // DOUBLE CLICK DETECTED!
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      lastClickTimeRef.current = 0;

      // If video is zoomed in (> 100%), double click resets zoom to 100%
      if (zoomRef.current > 1.01) {
        resetZoom();
        return;
      }

      const v = videoRef.current;
      if (!v) return;

      if (clickX < rect.width * 0.42) {
        // Double Click LEFT -> 3s Progressive Seek Back (-3s, -6s, -9s...)
        const chainCount =
          jumpChainRef.current.side === 'left' && now - jumpChainRef.current.time < 1200
            ? jumpChainRef.current.count + 1
            : 1;
        jumpChainRef.current = { side: 'left', count: chainCount, time: now };
        const jumpSeconds = chainCount * 3;
        v.currentTime = Math.max(0, v.currentTime - 3);
        userSeekPendingRef.current = true;
        handleSeekJump();
        setJumpOverlay({ side: 'left', seconds: jumpSeconds, key: now });
      } else if (clickX > rect.width * 0.58) {
        // Double Click RIGHT -> 3s Progressive Seek Forward (+3s, +6s, +9s...)
        const chainCount =
          jumpChainRef.current.side === 'right' && now - jumpChainRef.current.time < 1200
            ? jumpChainRef.current.count + 1
            : 1;
        jumpChainRef.current = { side: 'right', count: chainCount, time: now };
        const jumpSeconds = chainCount * 3;
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 3);
        userSeekPendingRef.current = true;
        handleSeekJump();
        setJumpOverlay({ side: 'right', seconds: jumpSeconds, key: now });
      } else {
        // Center double click -> toggle fullscreen
        void toggleFullscreen();
      }
    } else {
      // SINGLE CLICK DETECTED (delay 200ms to distinguish from double click)
      lastClickTimeRef.current = now;
      clickTimerRef.current = window.setTimeout(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
          void v.play();
          setRippleOverlay({ type: 'play', key: Date.now() });
        } else {
          v.pause();
          setRippleOverlay({ type: 'pause', key: Date.now() });
        }
      }, 200);
    }
  };

  /** Any non-identity transform — CSS transform on <video> breaks native seek in Chromium/WebView2 */
  const needsMediaTransform =
    Math.abs(zoom - 1) > 0.01 || rotation !== 0 || flipH || flipV || isDragging;

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) {
      flashSeekWarn(t('ui.generated.video_belum_siap_untuk_picture_in_picture_a748269'));
      return;
    }
    if (v.readyState < 1) {
      flashSeekWarn(t('ui.generated.metadata_video_belum_dimuat_tunggu_sebentar_acdc83e'));
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture();
      } else {
        flashSeekWarn(t('ui.generated.picture_in_picture_tidak_didukung_di_lingkungan__6535e3d'));
      }
    } catch (e: any) {
      flashSeekWarn(String(e?.message || e || 'Gagal membuka PiP'));
    }
  };

  /** Click dimmed backdrop (outside the modal panel) → close */
  const onBackdropPointerDown = (e: React.MouseEvent | React.PointerEvent) => {
    // Only the overlay itself — not children (modal panel)
    if (e.target !== e.currentTarget) return;
    // Don't dismiss while a system open is in progress
    if (openingSystem) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  const node = (
    <div
      className={`drive-preview-overlay${isFullscreen ? ' is-fs' : ''}`}
      role="presentation"
      onMouseDown={onBackdropPointerDown}
      onClick={onBackdropPointerDown}
    >
      <div
        className={`drive-preview-modal${isFullscreen ? ' is-fullscreen' : ''}${isSplitCompareMode ? ' is-split-compare' : ''}${isZip ? ' is-zip-modal' : ''}`}
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('speedtest.tooltip_preview')}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {!isZip && (
          <>
            <header className="drive-preview-header font-sans">
              {/* Row A: title + close */}
              <div className="drive-preview-title">
                <strong title={isSplitCompareMode ? (activeSlotFile ? activeSlotFile.name : `Duplicate Group #${duplicateContext ? duplicateContext.currentGroupIndex + 1 : 1}`) : displayName}>
                  {isSplitCompareMode
                    ? activeSlotFile
                      ? `${activeSlotFile.name} (Slot ${activeSplitSlot})`
                      : `Duplicate Group #${duplicateContext ? duplicateContext.currentGroupIndex + 1 : 1} (${currentDupGroup?.files.length || 0} files)`
                    : displayName}
                </strong>
                <span className="drive-muted" title={[
                  formatDriveBytes(isSplitCompareMode && activeSlotFile ? activeSlotFile.size : (previewByteSize || file.size)),
                  previewWidth && previewHeight ? `${previewWidth}×${previewHeight}px` : '',
                  previewState === 'degraded' ? 'degraded fallback' : '',
                  durationLabel,
                  kindLabel,
                  isVideo && activeQuality ? activeQuality.label : '',
                  fromCache && !loading ? 'cache' : '',
                  previewErrorDetail ? `err: ${previewErrorDetail}` : '',
                ].filter(Boolean).join(' · ')}>
                  {isHeaderFrozen ? (
                    <span className="text-amber-400/90 font-medium">{t('ui.generated.klik_card_a_atau_card_b_untuk_mengaktifkan_toolb_63e2364')}</span>
                  ) : (
                    <>
                      {formatDriveBytes(isSplitCompareMode && activeSlotFile ? activeSlotFile.size : (previewByteSize || file.size))}
                      {previewWidth && previewHeight ? ` · ${previewWidth}×${previewHeight}px` : ''}
                      {durationLabel ? ` · ${durationLabel}` : ''}
                      {isVideo ? (file.as_document ? ` · ${t('speedtest.doc_file_badge')}` : ` · ${t('speedtest.video_media_badge')}`) : kindLabel ? ` · ${kindLabel}` : ''}
                      {isVideo && activeQuality ? ` · ${activeQuality.label}` : ''}
                      {fromCache && !loading ? t('ui.generated.cache_00cdf64') : ''}
                      {previewState === 'degraded' ? t('ui.generated.degraded_e96e6b7') : ''}
                      {customSource?.indexCounter ? ` · [${customSource.indexCounter.current} / ${customSource.indexCounter.total}]` : ''}
                      {customSource?.encrypted ? ` · 🔒 ${t('speedtest.zip_tag_encrypted')}` : ''}
                    </>
                  )}
                </span>
              </div>

              {!isSplitCompareMode && (
                <div
                  className="drive-preview-nav"
                  role="toolbar"
                  aria-label={t('speedtest.nav_aria')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="td-icon-btn"
                    disabled={
                      duplicateContext
                        ? duplicateContext.currentGroupIndex <= 0
                        : !hasPrev
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (duplicateContext) {
                        const prevIdx = duplicateContext.currentGroupIndex - 1;
                        const prevGroup = duplicateContext.activeFilteredGroups[prevIdx];
                        if (prevGroup && duplicateContext.onNavigateGroup) {
                          duplicateContext.onNavigateGroup(prevIdx, prevGroup.files[0]);
                        }
                      } else {
                        onPrev?.();
                      }
                    }}
                    aria-label={t('speedtest.prev_aria')}
                    title={
                      duplicateContext
                        ? t('speedtest.preview_prev_group')
                        : hasPrev
                        ? t('speedtest.preview_prev_file')
                        : t('speedtest.preview_no_prev')
                    }
                  >
                    <ChevronLeft size={18} />
                  </button>

                  <button
                    type="button"
                    className="td-icon-btn"
                    disabled={
                      duplicateContext
                        ? duplicateContext.currentGroupIndex >= duplicateContext.activeFilteredGroups.length - 1
                        : !hasNext
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (duplicateContext) {
                        const nextIdx = duplicateContext.currentGroupIndex + 1;
                        const nextGroup = duplicateContext.activeFilteredGroups[nextIdx];
                        if (nextGroup && duplicateContext.onNavigateGroup) {
                          duplicateContext.onNavigateGroup(nextIdx, nextGroup.files[0]);
                        }
                      } else {
                        onNext?.();
                      }
                    }}
                    aria-label={t('speedtest.next_aria')}
                    title={
                      duplicateContext
                        ? t('speedtest.preview_next_group')
                        : hasNext
                        ? t('speedtest.preview_next_file')
                        : t('speedtest.preview_no_next')
                    }
                  >
                    <ChevronRight size={18} />
                  </button>

                  <button
                    type="button"
                    className="td-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDownload();
                    }}
                    disabled={saving}
                    title={t('speedtest.download_tooltip')}
                    aria-label={t('speedtest.label_download')}
                  >
                    {saving ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                  </button>

                  {isDesktop() && (
                    <>
                      <button
                        type="button"
                        className="td-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleOpenSystem();
                        }}
                        disabled={openingSystem || !creds}
                        title={t('speedtest.open_default_tooltip')}
                        aria-label={t('speedtest.label_open')}
                      >
                        {openingSystem ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
                      </button>
                      <button
                        type="button"
                        className="td-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleOpenWith();
                        }}
                        disabled={openingSystem || !creds}
                        title={t('speedtest.open_with_tooltip')}
                        aria-label={t('ui.generated.buka_dengan_bd8b04b')}
                      >
                        <AppWindow size={16} />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className="td-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSplitCompareMode && activeSlotFile) {
                        setSinglePreviewFile(activeSlotFile);
                      } else {
                        void toggleFullscreen();
                      }
                    }}
                    title={isFullscreen ? t('speedtest.preview_fullscreen_exit') : t('speedtest.preview_fullscreen_enter')}
                    aria-label={t('speedtest.fullscreen')}
                  >
                    {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
              )}

              <button
                type="button"
                className="td-icon-btn drive-preview-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                aria-label={t('speedtest.preview_close_btn')}
                title={t("speedtest.close_esc_tooltip")}
              >
                <X size={18} />
              </button>
            </header>

        {(openingSystem || openProgressMsg) && (
          <div className="drive-open-progress" role="status" aria-live="polite">
            <div className="drive-open-progress-main">
              {openingSystem ? <Loader2 size={14} className="spin" /> : null}
              <span>{openProgressMsg || t('speedtest.processing')}</span>
            </div>
            <div className="drive-open-progress-actions">
              <button
                type="button"
                className="drive-open-progress-cancel"
                title={t('speedtest.cancel_preview_tooltip')}
                onClick={dismissOpenProgress}
              >
                {t('speedtest.cancel')}
              </button>
              <button
                type="button"
                className="drive-open-progress-cancel is-quiet"
                title={t('speedtest.close_status_strip')}
                aria-label={t('ui.generated.tutup_status_de404c7')}
                onClick={dismissOpenProgress}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Adaptive labeled toolbar — always rendered for full media tools */}
        <div
          className={`drive-preview-toolbar is-${mediaKind}${qualityOpen || rateOpen ? ' has-menu' : ''}`}
          role="toolbar"
          style={isHeaderFrozen ? { opacity: 0.35, pointerEvents: 'none', filter: 'grayscale(0.6)', cursor: 'not-allowed', transition: 'all 0.2s ease' } : { transition: 'all 0.2s ease' }}
          aria-label={
            isImage ? 'Alat preview gambar' : isVideo ? 'Alat preview video' : 'Alat preview'
          }
          data-media-kind={mediaKind}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="drive-preview-tools">
            {(isImage || isVideo) && (
              <div className="drive-tool-group" role="group" aria-label={t('speedtest.zoom_label')}>
                <span className="drive-tool-group-label">{t("speedtest.label_zoom")}</span>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t("speedtest.zoom_out_detail_tooltip", { percent: Math.round(MIN_ZOOM * 100) })}
                  disabled={isHeaderFrozen || curTransform.zoom <= MIN_ZOOM + 0.001}
                  onClick={() => zoomBy(-ZOOM_STEP)}
                >
                  <ZoomOut size={15} />
                  <span className="drive-tool-btn-label">{t("speedtest.label_zoom_out")}</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn drive-tool-btn-value"
                  title={t("speedtest.tooltip_zoom_reset")}
                  disabled={isHeaderFrozen}
                  onClick={resetZoom}
                >
                  <Shrink size={14} />
                  <span className="drive-tool-btn-label strong">{Math.round(curTransform.zoom * 100)}%</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t("speedtest.zoom_in_detail_tooltip", { percent: Math.round(MAX_ZOOM * 100) })}
                  disabled={isHeaderFrozen || curTransform.zoom >= MAX_ZOOM - 0.001}
                  onClick={() => zoomBy(ZOOM_STEP)}
                >
                  <ZoomIn size={15} />
                  <span className="drive-tool-btn-label">{t("speedtest.label_zoom_in")}</span>
                </button>
                {!isSplitCompareMode && (
                  <button
                    type="button"
                    className={`drive-tool-btn${isMagnifierMode ? ' is-on' : ''}`}
                    title={t("speedtest.tooltip_magnifier")}
                    disabled={isHeaderFrozen}
                    onClick={() => setIsMagnifierMode((v) => !v)}
                    aria-pressed={isMagnifierMode}
                  >
                    <Search size={15} />
                    <span className="drive-tool-btn-label">{t("speedtest.label_magnifier")}</span>
                  </button>
                )}
              </div>
            )}

            {(isImage || isVideo) && (
              <div className="drive-tool-group" role="group" aria-label={t('speedtest.label_rotate')}>
                <span className="drive-tool-group-label">{t("speedtest.label_rotate")}</span>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t("speedtest.tooltip_rotate_left")}
                  disabled={isHeaderFrozen}
                  onClick={() => {
                    if (isSplitCompareMode) {
                      updateActiveTransform((p) => ({ ...p, rotation: (p.rotation + 270) % 360 }));
                    } else {
                      setRotation((r) => (r + 270) % 360);
                    }
                  }}
                >
                  <RotateCcw size={15} />
                  <span className="drive-tool-btn-label">{t("speedtest.label_left")}</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t("speedtest.tooltip_rotate_right")}
                  disabled={isHeaderFrozen}
                  onClick={() => {
                    if (isSplitCompareMode) {
                      updateActiveTransform((p) => ({ ...p, rotation: (p.rotation + 90) % 360 }));
                    } else {
                      setRotation((r) => (r + 90) % 360);
                    }
                  }}
                >
                  <RotateCw size={15} />
                  <span className="drive-tool-btn-label">{t("speedtest.label_right")}</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t("speedtest.tooltip_flip_h")}
                  disabled={isHeaderFrozen}
                  onClick={() => {
                    if (isSplitCompareMode) {
                      updateActiveTransform((p) => ({ ...p, flipH: !p.flipH }));
                    } else {
                      setFlipH((v) => !v);
                    }
                  }}
                >
                  <FlipHorizontal size={15} />
                  <span className="drive-tool-btn-label">{t("speedtest.label_flip")}</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t("speedtest.tooltip_flip_v")}
                  disabled={isHeaderFrozen}
                  onClick={() => {
                    if (isSplitCompareMode) {
                      updateActiveTransform((p) => ({ ...p, flipV: !p.flipV }));
                    } else {
                      setFlipV((v) => !v);
                    }
                  }}
                >
                  <FlipVertical size={15} />
                  <span className="drive-tool-btn-label">{t("speedtest.label_flip_v")}</span>
                </button>
                {(curTransform.rotation !== 0 || curTransform.flipH || curTransform.flipV) && (
                  <button
                    type="button"
                    className="drive-tool-btn"
                    title={t("speedtest.tooltip_rotate_reset")}
                    disabled={isHeaderFrozen}
                    onClick={() => {
                      if (isSplitCompareMode) {
                        updateActiveTransform((p) => ({ ...p, rotation: 0, flipH: false, flipV: false }));
                      } else {
                        setRotation(0);
                        setFlipH(false);
                        setFlipV(false);
                      }
                    }}
                  >
                    <RefreshCw size={15} />
                    <span className="drive-tool-btn-label">{t("speedtest.label_rotate_reset")}</span>
                  </button>
                )}
              </div>
            )}

            {(isVideo || isAudio) && (
              <div className="drive-tool-group" role="group" aria-label={t('ui.generated.pemutaran_media_a5ffb68')}>
                <span className="drive-tool-group-label">{isVideo ? t('speedtest.label_video') : t('speedtest.label_audio')}</span>
                {isVideo && (
                  <div className="drive-quality-wrap">
                    <button
                      ref={qualityBtnRef}
                      type="button"
                      className="drive-tool-btn drive-tool-btn-accent"
                      title={t("speedtest.tooltip_res")}
                      onClick={() => {
                        setRateOpen(false);
                        setRateMenuPos(null);
                        setQualityOpen((o) => {
                          const next = !o;
                          if (next) setQualityMenuPos(placeMenuNear(qualityBtnRef.current, 280));
                          else setQualityMenuPos(null);
                          return next;
                        });
                      }}
                      disabled={isHeaderFrozen || switchingQuality}
                      aria-expanded={qualityOpen}
                      aria-haspopup="menu"
                      aria-label={t('ui.generated.resolusi_video_c723455')}
                    >
                      {switchingQuality ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <Settings2 size={14} />
                      )}
                      <span className="drive-tool-btn-label">
                        {activeResolution?.label || activeQuality?.label || t('ui.generated.otomatis_33a0b23')}
                      </span>
                    </button>
                  </div>
                )}
                {isVideo && (
                  <button
                    type="button"
                    className="drive-tool-btn"
                    title={t('speedtest.preview_pip_hint')}
                    disabled={isHeaderFrozen}
                    onClick={() => void togglePip()}
                  >
                    <PictureInPicture2 size={15} />
                    <span className="drive-tool-btn-label">{t("speedtest.label_pip")}</span>
                  </button>
                )}
              </div>
            )}

            {(isPdf || isText || isDocOther) && isDesktop() && (
              <div className="drive-tool-group" role="group" aria-label={t('speedtest.label_open_doc')}>
                <span className="drive-tool-group-label">{t("speedtest.label_open")}</span>
                <button
                  type="button"
                  className="drive-tool-btn drive-tool-btn-accent"
                  title={t('speedtest.open_default_app')}
                  disabled={isHeaderFrozen || openingSystem || !creds}
                  onClick={() => void handleOpenSystem()}
                >
                  {openingSystem ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}
                  <span className="drive-tool-btn-label">{t("speedtest.label_app")}</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t('speedtest.open_with_other')}
                  disabled={isHeaderFrozen || openingSystem || !creds}
                  onClick={() => void handleOpenWith()}
                >
                  <AppWindow size={15} />
                  <span className="drive-tool-btn-label">{t("speedtest.label_with")}</span>
                </button>
                {isPdf && (
                  <button
                    type="button"
                    className="drive-tool-btn"
                    title={t('speedtest.print_pdf_tooltip')}
                    disabled={isHeaderFrozen || openingSystem || !creds}
                    onClick={() => void handlePrintPdf()}
                  >
                    <Printer size={15} />
                    <span className="drive-tool-btn-label">{t("speedtest.label_print")}</span>
                  </button>
                )}
                {isText && textBody && (
                  <button
                    type="button"
                    className="drive-tool-btn"
                    title={t('speedtest.copy_text')}
                    disabled={isHeaderFrozen}
                    onClick={() => void handleCopyText()}
                  >
                    <Copy size={15} />
                    <span className="drive-tool-btn-label">{t("speedtest.label_copy")}</span>
                  </button>
                )}
              </div>
            )}

            <div className="drive-tool-group" role="group" aria-label={t('speedtest.cat_other')}>
              <span className="drive-tool-group-label">{t("speedtest.label_other")}</span>
              {isSplitCompareMode && (
                <>
                  <button
                    type="button"
                    className="drive-tool-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDownload();
                    }}
                    disabled={isHeaderFrozen || saving}
                    title={t('speedtest.download_tooltip')}
                    aria-label={t('speedtest.label_download')}
                  >
                    {saving ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                    <span className="drive-tool-btn-label">{t("speedtest.label_download")}</span>
                  </button>
                  <button
                    type="button"
                    className="drive-tool-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFullscreen();
                    }}
                    disabled={isHeaderFrozen}
                    title={isFullscreen ? t('speedtest.preview_fullscreen_exit') : t('speedtest.preview_fullscreen_enter')}
                    aria-label={t('speedtest.fullscreen')}
                  >
                    {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    <span className="drive-tool-btn-label">{t("speedtest.label_fullscreen")}</span>
                  </button>
                </>
              )}
              <button
                type="button"
                className={`drive-tool-btn${!isSplitCompareMode && loading ? ' is-loading' : ''}`}
                title={t('speedtest.reload_preview')}
                disabled={isHeaderFrozen || (!isSplitCompareMode && loading)}
                onClick={() => {
                  resetViewTools();
                  if (customSource?.onReload) {
                    customSource.onReload();
                    return;
                  }
                  if (isSplitCompareMode && activeSlotFile) {
                    invalidatePreview(
                      activeSlotFile.folder_id ?? folderId,
                      activeSlotFile.id,
                      creds.session,
                      activeSlotFile.peer_id,
                      activeSlotFile.topic_id
                    );
                    setSplitReloadToken((token) => token + 1);
                    return;
                  }
                  invalidatePreview(folderId, file.id);
                  setSrcOverride(null);
                  setError(null);
                  setTextBody(null);
                  setHasVideoFrame(false);
                  loadPreview(isVideo ? quality : 'auto', { force: true });
                }}
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
                <span className="drive-tool-btn-label">{loading ? t('speedtest.label_loading') : t('speedtest.label_load')}</span>
              </button>
              <button
                type="button"
                className={`drive-tool-btn${showInfo ? ' is-on' : ''}`}
                title={t('speedtest.file_detail_tooltip')}
                disabled={isHeaderFrozen}
                onClick={() => setShowInfo((v) => !v)}
              >
                <Info size={15} />
                <span className="drive-tool-btn-label">{t("speedtest.label_info")}</span>
              </button>
            </div>
          </div>
        </div>
          </>
        )}

        {/* Fixed menus portaled to body — escape overlay stacking; never clipped */}
        {typeof document !== 'undefined' &&
          qualityOpen &&
          qualityMenuPos &&
          createPortal(
            <div
              ref={qualityMenuRef}
              className="drive-quality-menu drive-resolution-menu is-fixed-popover"
              role="menu"
              style={{
                position: 'fixed',
                top: qualityMenuPos.top !== undefined ? qualityMenuPos.top : 'auto',
                bottom: qualityMenuPos.bottom !== undefined ? qualityMenuPos.bottom : 'auto',
                left: qualityMenuPos.left,
                width: qualityMenuPos.width,
                zIndex: 10_000,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drive-quality-menu-title">{t('ui.generated.resolusi_19165bf')}</div>
              {resolutionOptions.map((opt) => {
                const selected = opt.id === quality || (!quality && !!opt.recommended);
                const sizeHint = formatQualitySize(opt.size);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`drive-quality-item${selected ? ' selected' : ''}`}
                    onClick={() => {
                      handleQualityChange(opt.id);
                      setQualityOpen(false);
                    }}
                  >
                    <span className="drive-quality-item-check">
                      {selected ? <Check size={14} /> : null}
                    </span>
                    <span className="drive-quality-item-body">
                      <strong>
                        {opt.label}
                        {opt.recommended ? (
                          <span className="drive-quality-tag">{t('ui.generated.disarankan_7ed48a4')}</span>
                        ) : opt.native ? (
                          <span className="drive-quality-tag">{t('speedtest.perspective_telegram_short')}</span>
                        ) : opt.transcode ? (
                          <span className="drive-quality-tag muted">{t('ui.generated.lokal_5a1f6ac')}</span>
                        ) : null}
                      </strong>
                      <span className="drive-muted">
                        {opt.description || ''}
                        {sizeHint ? ` · ~${sizeHint}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
              <p className="drive-quality-note">
                {t('speedtest.quality_telegram_source_note')}
              </p>
            </div>,
            document.body
          )}
        {typeof document !== 'undefined' &&
          rateOpen &&
          rateMenuPos &&
          createPortal(
            <div
              ref={rateMenuRef}
              className="drive-quality-menu drive-rate-menu is-fixed-popover"
              role="menu"
              style={{
                position: 'fixed',
                top: rateMenuPos.top !== undefined ? rateMenuPos.top : 'auto',
                bottom: rateMenuPos.bottom !== undefined ? rateMenuPos.bottom : 'auto',
                left: rateMenuPos.left,
                width: rateMenuPos.width,
                zIndex: 10_000,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drive-quality-menu-title">{t('ui.generated.kecepatan_putar_9d70f8f')}</div>
              {RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`drive-quality-item${playbackRate === r ? ' selected' : ''}`}
                  onClick={() => {
                    setPlaybackRate(r);
                    setRateOpen(false);
                  }}
                >
                  <span className="drive-quality-item-check">
                    {playbackRate === r ? <Check size={14} /> : null}
                  </span>
                  <span className="drive-quality-item-body">
                    <strong>{r}{t('ui.generated.x_11f6ad8')}</strong>
                    <span className="drive-muted">
                      {r === 1 ? t('speedtest.scan_normal') : r < 1 ? t('ui.generated.lebih_lambat_6f64282') : t('ui.generated.lebih_cepat_b1bce0d')}
                    </span>
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )}

        <div
          className={`drive-preview-body${isZip ? ' is-zip-body' : ''}`}
          ref={stageRef}
          onWheel={isZip ? undefined : onWheelStage}
          style={
            isSplitCompareMode
              ? { width: '100%', height: '100%', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'stretch', flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }
              : isZip
              ? { width: '100%', height: '100%', padding: 0, alignItems: 'stretch', justifyContent: 'stretch' }
              : undefined
          }
        >
          {duplicateContext && currentDupGroup && isSplitCompareMode ? (
            <div style={{ width: '100%', height: '100%', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'stretch', overflow: 'hidden', background: '#0d1117', color: '#f8fafc' }} className="font-sans">
              {splitNotice && <div className="drive-preview-split-notice" role="status">{splitNotice}</div>}
              {/* MAIN CONTENT AREA: PREVIEW STAGE + SIDEBAR */}
              <div
                className="drive-preview-split-layout"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    setActiveSplitSlot(null);
                  }
                }}
              >
                {/* STAGE SPLIT PREVIEW (CARDS A & B SIDE-BY-SIDE HORIZONTAL) */}
                <div
                  className="drive-preview-split-panes"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      setActiveSplitSlot(null);
                    }
                  }}
                  style={{ '--split-a': `${splitRatio}%` } as React.CSSProperties}
                >
                  {/* CARD A (LEFT) */}
                  {(() => {
                    const fileA = currentDupGroup.files[selectedAIndex] || currentDupGroup.files[0];
                    const isMarkedA = fileA ? splitMarkedDelete.has(fileA.id) : false;
                    const thumbA = fileA
                      ? getCachedThumb(fileA.folder_id ?? folderId, fileA.id) || fileA.thumb_data_url || fileA.thumbDataUrl || (fileA.id === file.id ? activeSrc || gridThumb || poster || '' : '')
                      : '';
                    const nameA = fileA ? middleTruncateFilename(fileA.name, 24) : t('speedtest.preview_card_title_a');
                    const isActiveA = activeSplitSlot === 'A';
                    return (
                      <div
                        className={`drive-preview-split-col is-slot-a ${isSlotAEmpty ? '' : isMarkedA ? 'is-marked-delete' : 'is-keep'} ${isActiveA ? 'is-active-card-a' : ''}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const idx = Number(e.dataTransfer.getData('application/x-autogram-duplicate-index'));
                          if (Number.isInteger(idx)) handleAssignSlotIndex('A', idx);
                        }}
                        onMouseDown={(e) => {
                          if (e.detail > 1) {
                            e.preventDefault();
                            try {
                              window.getSelection()?.removeAllRanges();
                            } catch {}
                          }
                        }}
                        onPointerDown={(e) => {
                          handleCardPointerDown(e, 'A', slotATransform, setSlotATransform);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        style={{
                          height: '100%',
                          minHeight: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          overflow: 'hidden',
                          cursor: 'pointer',
                        }}
                      >
                        <div className="drive-preview-split-badge" style={{ flexShrink: 0 }}>
                          <div className="drive-preview-badge-left">
                            <span className="drive-dup-badge-a">{t('ui.generated.a_6dcd4ce')}</span>
                            <span className="drive-preview-card-title" title={fileA?.name}>{nameA}</span>
                          </div>
                          <div className="drive-preview-badge-right">
                            {!isSlotAEmpty && (
                              <button
                                type="button"
                                className="drive-preview-card-clear-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsSlotAEmpty(true);
                                  if (splitPlaybackSlot === 'A') setSplitPlaybackSlot(null);
                                }}
                                title={t('speedtest.preview_clear_slot')}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        {isSlotAEmpty || !fileA ? (
                          <div className="drive-preview-split-empty-wrap">
                            <div className="drive-preview-split-empty-icon">
                              <FileText size={24} />
                            </div>
                            <span className="text-sm font-bold text-slate-300">{t('speedtest.preview_slot_empty')}</span>
                            <span className="text-xs text-slate-400 max-w-[200px] text-center">{t('speedtest.preview_click_to_load')}</span>
                          </div>
                        ) : (
                          <>
                            <div
                              className="drive-preview-split-media-wrap"
                              onWheel={(e) => {
                                e.stopPropagation();
                                const dir = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
                                setSlotATransform((prev) => {
                                  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom + dir));
                                  return {
                                    ...prev,
                                    zoom: next,
                                    pan: next <= 1 ? { x: 0, y: 0 } : prev.pan,
                                  };
                                });
                                if (activeSplitSlot !== 'A') setActiveSplitSlot('A');
                              }}
                              style={{ flex: '1 1 0%', minHeight: 0, height: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#0d1117', borderRadius: '8px', margin: '8px 0' }}
                            >
                              {(() => {
                                const transformStrA = `translate3d(${slotATransform.pan.x}px, ${slotATransform.pan.y}px, 0px) rotate(${slotATransform.rotation}deg) scale(${(slotATransform.flipH ? -1 : 1) * slotATransform.zoom}, ${(slotATransform.flipV ? -1 : 1) * slotATransform.zoom})`;
                                const cursorA = isActiveA
                                  ? slotATransform.zoom > 1.01
                                    ? isDraggingSlotA
                                      ? 'grabbing'
                                      : 'grab'
                                    : 'pointer'
                                  : 'pointer';
                                return (
                                  <SplitPreviewMedia
                                    key={`split-a-${fileA.id}`}
                                    file={fileA}
                                    folderId={folderId}
                                    creds={creds}
                                    slot="A"
                                    active={isActiveA}
                                    playbackRequested={splitPlaybackSlot === 'A'}
                                    onRequestPlayback={() => {
                                      setActiveSplitSlot('A');
                                      setSplitPlaybackSlot('A');
                                    }}
                                    reloadToken={splitReloadToken}
                                    fallbackThumb={thumbA}
                                    transform={transformStrA}
                                    dragging={isDraggingSlotA}
                                    cursor={cursorA}
                                  />
                                );
                              })()}
                            </div>

                            <div className="drive-preview-split-meta" style={{ flexShrink: 0 }}>
                              <span className="text-slate-300 text-xs font-semibold">
                                {formatDriveBytes(fileA.size)}
                              </span>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className={`drive-dup-btn-keep${!isMarkedA ? ' is-selected' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleKeepFile(fileA.id);
                                  }}
                                  title={t('speedtest.preview_keep_only_active_short')}
                                >
                                  <Check size={14} />
                                  <span>{t('speedtest.preview_radio_save')}</span>
                                </button>
                                <button
                                  type="button"
                                  className={`drive-dup-btn-delete${isMarkedA ? ' is-selected' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDelete(fileA.id);
                                  }}
                                  title={t('speedtest.preview_mark_delete')}
                                >
                                  <Trash2 size={14} />
                                  <span>{t('speedtest.preview_delete_btn')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="drive-dup-btn-next"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    stepSplitFile(1, 'A');
                                  }}
                                  title={t('speedtest.duplicate_next_file')}
                                >
                                  <ChevronRight size={14} />
                                </button>
                              </div>
                            </div>
                            {showInfo && isActiveA && (
                              <div className="drive-preview-split-inline-info">
                                <span>{fileA.mime_type || fileA.file_ext || formatDriveKindLabel(fileA)}</span>
                                <span>#{fileA.id}</span>
                                <span>{formatDriveBytes(fileA.size)}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  <div
                    className="drive-preview-split-divider"
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={24}
                    aria-valuemax={76}
                    aria-valuenow={Math.round(splitRatio)}
                    tabIndex={0}
                    onPointerDown={handleSplitDividerPointerDown}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                      e.preventDefault();
                      setSplitRatio((ratio) => clamp(ratio + (e.key === 'ArrowRight' ? 4 : -4), 24, 76));
                    }}
                  >
                    <span />
                  </div>

                  {/* CARD B (RIGHT) */}
                  {(() => {
                    const fileB = currentDupGroup.files[selectedBIndex] || currentDupGroup.files[1] || currentDupGroup.files[0];
                    const isMarkedB = fileB ? splitMarkedDelete.has(fileB.id) : false;
                    const thumbB = fileB
                      ? getCachedThumb(fileB.folder_id ?? folderId, fileB.id) || fileB.thumb_data_url || fileB.thumbDataUrl || (fileB.id === file.id ? activeSrc || gridThumb || poster || '' : '')
                      : '';
                    const nameB = fileB ? middleTruncateFilename(fileB.name, 24) : t('speedtest.preview_card_title_b');
                    const isActiveB = activeSplitSlot === 'B';
                    return (
                      <div
                        className={`drive-preview-split-col is-slot-b ${isSlotBEmpty ? '' : isMarkedB ? 'is-marked-delete' : 'is-keep'} ${isActiveB ? 'is-active-card-b' : ''}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const idx = Number(e.dataTransfer.getData('application/x-autogram-duplicate-index'));
                          if (Number.isInteger(idx)) handleAssignSlotIndex('B', idx);
                        }}
                        onMouseDown={(e) => {
                          if (e.detail > 1) {
                            e.preventDefault();
                            try {
                              window.getSelection()?.removeAllRanges();
                            } catch {}
                          }
                        }}
                        onPointerDown={(e) => {
                          handleCardPointerDown(e, 'B', slotBTransform, setSlotBTransform);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        style={{
                          height: '100%',
                          minHeight: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          overflow: 'hidden',
                          cursor: 'pointer',
                        }}
                      >
                        <div className="drive-preview-split-badge" style={{ flexShrink: 0 }}>
                          <div className="drive-preview-badge-left">
                            <span className="drive-dup-badge-b">{t('ui.generated.b_ae4f281')}</span>
                            <span className="drive-preview-card-title" title={fileB?.name}>{nameB}</span>
                          </div>
                          <div className="drive-preview-badge-right">
                            {!isSlotBEmpty && (
                              <button
                                type="button"
                                className="drive-preview-card-clear-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsSlotBEmpty(true);
                                  if (splitPlaybackSlot === 'B') setSplitPlaybackSlot(null);
                                }}
                                title={t('speedtest.preview_clear_slot')}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        {isSlotBEmpty || !fileB ? (
                          <div className="drive-preview-split-empty-wrap">
                            <div className="drive-preview-split-empty-icon">
                              <FileText size={24} />
                            </div>
                            <span className="text-sm font-bold text-slate-300">{t('speedtest.preview_slot_empty')}</span>
                            <span className="text-xs text-slate-400 max-w-[200px] text-center">{t('speedtest.preview_click_to_load')}</span>
                          </div>
                        ) : (
                          <>
                            <div
                              className="drive-preview-split-media-wrap"
                              onWheel={(e) => {
                                e.stopPropagation();
                                const dir = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
                                setSlotBTransform((prev) => {
                                  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom + dir));
                                  return {
                                    ...prev,
                                    zoom: next,
                                    pan: next <= 1 ? { x: 0, y: 0 } : prev.pan,
                                  };
                                });
                                if (activeSplitSlot !== 'B') setActiveSplitSlot('B');
                              }}
                              style={{ flex: '1 1 0%', minHeight: 0, height: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#0d1117', borderRadius: '8px', margin: '8px 0' }}
                            >
                              {(() => {
                                const transformStrB = `translate3d(${slotBTransform.pan.x}px, ${slotBTransform.pan.y}px, 0px) rotate(${slotBTransform.rotation}deg) scale(${(slotBTransform.flipH ? -1 : 1) * slotBTransform.zoom}, ${(slotBTransform.flipV ? -1 : 1) * slotBTransform.zoom})`;
                                const cursorB = isActiveB
                                  ? slotBTransform.zoom > 1.01
                                    ? isDraggingSlotB
                                      ? 'grabbing'
                                      : 'grab'
                                    : 'pointer'
                                  : 'pointer';
                                return (
                                  <SplitPreviewMedia
                                    key={`split-b-${fileB.id}`}
                                    file={fileB}
                                    folderId={folderId}
                                    creds={creds}
                                    slot="B"
                                    active={isActiveB}
                                    playbackRequested={splitPlaybackSlot === 'B'}
                                    onRequestPlayback={() => {
                                      setActiveSplitSlot('B');
                                      setSplitPlaybackSlot('B');
                                    }}
                                    reloadToken={splitReloadToken}
                                    fallbackThumb={thumbB}
                                    transform={transformStrB}
                                    dragging={isDraggingSlotB}
                                    cursor={cursorB}
                                  />
                                );
                              })()}
                            </div>

                            <div className="drive-preview-split-meta" style={{ flexShrink: 0 }}>
                              <span className="text-slate-300 text-xs font-semibold">
                                {formatDriveBytes(fileB.size)}
                              </span>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className={`drive-dup-btn-keep${!isMarkedB ? ' is-selected' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleKeepFile(fileB.id);
                                  }}
                                  title={t('speedtest.preview_keep_only_active_short')}
                                >
                                  <Check size={14} />
                                  <span>{t('speedtest.preview_radio_save')}</span>
                                </button>
                                <button
                                  type="button"
                                  className={`drive-dup-btn-delete${isMarkedB ? ' is-selected' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDelete(fileB.id);
                                  }}
                                  title={t('speedtest.preview_mark_delete')}
                                >
                                  <Trash2 size={14} />
                                  <span>{t('speedtest.preview_delete_btn')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="drive-dup-btn-next"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    stepSplitFile(1, 'B');
                                  }}
                                  title={t('speedtest.duplicate_next_file')}
                                >
                                  <ChevronRight size={14} />
                                </button>
                              </div>
                            </div>
                            {showInfo && isActiveB && (
                              <div className="drive-preview-split-inline-info">
                                <span>{fileB.mime_type || fileB.file_ext || formatDriveKindLabel(fileB)}</span>
                                <span>#{fileB.id}</span>
                                <span>{formatDriveBytes(fileB.size)}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* RIGHT SIDEPANEL (FILES IN THIS GROUP + FOOTER GROUP NAV) */}
                <aside
                  className="drive-preview-dup-sidebar"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) setActiveSplitSlot(null);
                  }}
                >
                  <div className="drive-preview-dup-sidebar-head" style={{ flexShrink: 0, paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="text-xs font-bold text-slate-200">
                      {t('ui.generated.files_in_this_group_305989c')}{currentDupGroup.files.length})
                    </span>
                  </div>

                  <div
                    className="drive-preview-dup-sidebar-list"
                    onPointerDown={(e) => {
                      if (e.target === e.currentTarget) setActiveSplitSlot(null);
                    }}
                  >
                    {currentDupGroup.files.map((f, idx) => {
                      const isA = !isSlotAEmpty && idx === selectedAIndex;
                      const isB = !isSlotBEmpty && idx === selectedBIndex;
                      const isDel = splitMarkedDelete.has(f.id);
                      const sizeStr = formatDriveBytes(f.size || 0);
                      const cardThumbFallback = (f.id === file.id ? activeSrc || gridThumb || poster || '' : '');
                      const truncatedName = middleTruncateFilename(f.name, 18);

                      return (
                        <div
                          key={f.id}
                          onClick={() => handleSelectSidepanelItem(idx)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('application/x-autogram-duplicate-index', String(idx));
                            e.dataTransfer.setData('text/plain', f.name);
                          }}
                          className={`drive-dup-sidebar-card ${isDel ? 'is-discarded' : 'is-kept'} ${isA ? 'is-selected-a' : isB ? 'is-selected-b' : ''}`}
                        >
                          <SplitSidepanelThumb
                            file={f}
                            folderId={folderId}
                            creds={creds}
                            fallbackSrc={cardThumbFallback}
                            isA={isA}
                            isB={isB}
                          />

                          <div className="drive-dup-sidebar-info">
                            <span className="drive-dup-sidebar-name" title={f.name}>{truncatedName}</span>
                            <span className="drive-dup-sidebar-size">{sizeStr}</span>
                          </div>

                          <div className="drive-dup-sidebar-actions">
                            <button
                              className={`drive-dup-icon-check ${!isDel ? '' : 'is-off'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleKeepFile(f.id);
                              }}
                              title={t('ui.generated.simpan_keep_341be1a')}
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              className={`drive-dup-icon-del ${isDel ? '' : 'is-off'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleDelete(f.id);
                              }}
                              title={t('ui.generated.hapus_delete_f8c0d08')}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* SIDEPANEL FOOTER: GROUP NAV + HINT */}
                  <div className="drive-preview-dup-sidebar-footer" style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px', marginTop: 'auto' }}>
                    <div className="drive-dup-bottom-nav" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', padding: '6px 8px', background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', boxSizing: 'border-box' }}>
                      <button
                        type="button"
                        className="drive-dup-nav-btn"
                        style={{ padding: '6px 8px', fontSize: '0.7rem', flexShrink: 0 }}
                        disabled={duplicateContext.currentGroupIndex <= 0}
                        onClick={() => {
                          const prevIdx = duplicateContext.currentGroupIndex - 1;
                          const prevGroup = duplicateContext.activeFilteredGroups[prevIdx];
                          if (prevGroup && duplicateContext.onNavigateGroup) {
                            duplicateContext.onNavigateGroup(prevIdx, prevGroup.files[0]);
                          }
                        }}
                      >
                        <ChevronLeft size={13} />
                        <span>{t('ui.generated.prev_e96fea5')}</span>
                      </button>

                      <span className="drive-dup-nav-counter" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {duplicateContext.currentGroupIndex + 1} {t('ui.generated.of_de04fa0')} {duplicateContext.activeFilteredGroups.length}
                      </span>

                      <button
                        type="button"
                        className="drive-dup-nav-btn"
                        style={{ padding: '6px 8px', fontSize: '0.7rem', flexShrink: 0 }}
                        disabled={duplicateContext.currentGroupIndex >= duplicateContext.activeFilteredGroups.length - 1}
                        onClick={() => {
                          const nextIdx = duplicateContext.currentGroupIndex + 1;
                          const nextGroup = duplicateContext.activeFilteredGroups[nextIdx];
                          if (nextGroup && duplicateContext.onNavigateGroup) {
                            duplicateContext.onNavigateGroup(nextIdx, nextGroup.files[0]);
                          }
                        }}
                      >
                        <span>{t('speedtest.next_aria')}</span>
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <>
              {/* DEDICATED ZIP PREVIEW IN-MEMORY LOADING CARD */}
              {customSource && (loading || (!activeSrc && !textBody && !pdfSrc)) && !error && (
                <div className="w-full flex flex-col items-center justify-center min-h-[360px] p-6 select-none">
                  <div className="dzb-preview-loading-card">
                    <div className="dzb-dual-ring-wrap">
                      <div className="dzb-dual-ring-spinner" />
                      <div
                        className="dzb-loading-icon-center"
                        style={{
                          color:
                            customSource.kind === 'video'
                              ? '#38bdf8'
                              : customSource.kind === 'audio'
                              ? '#34d399'
                              : customSource.kind === 'image'
                              ? '#818cf8'
                              : customSource.kind === 'text'
                              ? '#fbbf24'
                              : '#a78bfa',
                        }}
                      >
                        {customSource.kind === 'video' ? (
                          <Film size={24} />
                        ) : customSource.kind === 'audio' ? (
                          <Music size={24} />
                        ) : customSource.kind === 'image' ? (
                          <ImageIcon size={24} />
                        ) : customSource.kind === 'text' ? (
                          <FileCode size={24} />
                        ) : customSource.kind === 'pdf' ? (
                          <FileText size={24} />
                        ) : (
                          <Zap size={24} />
                        )}
                      </div>
                    </div>

                    <div className="dzb-loading-title-box">
                      <h4 className="dzb-loading-title">{t('speedtest.zip_reading_entry')}</h4>
                      <p className="dzb-loading-sub">{t('speedtest.zip_sparse_reading_dots')}</p>
                    </div>

                    <div className="dzb-loading-shimmer-bar">
                      <div className="dzb-loading-shimmer-thumb" />
                    </div>

                    <div className="dzb-loading-badge">
                      <Zap size={12} className="text-amber-400" />
                      <span>{t('speedtest.zip_sparse_direct_decrypt')}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* NORMAL DRIVE PREVIEW LOADING PROGRESS */}
              {!customSource && loading && !showThumbSkeleton && !activeSrc && !textBody && !pdfSrc && !isZip && !error && (
                <div className="w-full flex flex-col items-center justify-center min-h-[350px] p-6">
                  <DeadCenterProgress
                    isLoading={loading}
                    label={
                      switchingQuality
                        ? `Mengganti ke ${activeQuality?.label || quality}…`
                        : isPdf || isText
                          ? 'Mengunduh dokumen via Grammers MTProto…'
                          : /^(p720|p480|p360)/i.test(quality)
                            ? `Menyiapkan ${quality.replace(/^p/i, '')}p…`
                            : 'Menyiapkan stream media…'
                    }
                  />
                </div>
              )}

          {!loading && error && (
            <div className="drive-empty drive-error">
              <p>{error}</p>
              {floodCountdown !== null && floodCountdown > 0 && (
                <p className="drive-muted" style={{ fontSize: '0.85rem', marginTop: 4, color: '#eab308' }}>
                  {t('ui.generated.mencoba_lagi_otomatis_dalam_b15179d')} <strong>{floodCountdown}</strong> {t('ui.generated.detik_6219b0e')}
                </p>
              )}
              <button
                type="button"
                className="td-btn-primary"
                onClick={() => {
                  invalidatePreview(folderId, file.id);
                  setError(null);
                  setFloodCountdown(null);
                  setTextBody(null);
                  setLoading(true);
                  // Hard bounce session then reconnect warm before reload
                  void (async () => {
                    try {
                      const { stopDriveSession, ensureDriveSession } = await import(
                        '../../../lib/telegram'
                      );
                      await stopDriveSession();
                      if (creds) await ensureDriveSession(creds, true);
                    } catch {
                      /* ignore */
                    }
                    loadPreview(isVideo ? quality : 'auto', { force: true });
                  })();
                }}
              >
                <RefreshCw size={14} className={floodCountdown !== null ? 'spin' : ''} />
                {floodCountdown !== null ? t('ui.generated.coba_lagi_sekarang_8b1f257') : t('speedtest.zip_retry')}
              </button>
              {isDesktop() && (
                <button
                  type="button"
                  className="td-btn-primary"
                  onClick={handleOpenSystem}
                  disabled={openingSystem || !creds}
                >
                  <ExternalLink size={14} /> {t('ui.generated.buka_di_aplikasi_b2ac39b')}
                </button>
              )}
              <button type="button" className="td-btn-primary" onClick={handleDownload} disabled={saving}>
                <Download size={14} /> {t('ui.generated.download_saja_d76a915')}
              </button>
            </div>
          )}

          {/* Instant skeleton from grid thumb while loading */}
          {showThumbSkeleton && (
            <div className="drive-preview-media-wrap is-skeleton">
              {poster || gridThumb ? (
                <img
                  src={poster || gridThumb || undefined}
                  alt=""
                  className="drive-preview-media drive-preview-skeleton-img"
                  draggable={false}
                />
              ) : (
                <div className="drive-preview-media drive-preview-skeleton-img is-blank" />
              )}
              <div className="drive-preview-loading-chip">
                <Loader2 size={14} className="spin" /> {t('speedtest.label_loading')}
              </div>
            </div>
          )}

          {previewIsFallback && !error && (
            <div
              className="drive-preview-degraded-banner"
              style={{
                position: 'absolute',
                top: '68px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 50,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 16px',
                background: 'rgba(234, 179, 8, 0.94)',
                backdropFilter: 'blur(8px)',
                color: '#000',
                borderRadius: '24px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
                fontSize: '13px',
                fontWeight: 600,
                pointerEvents: 'auto',
                maxWidth: '90%',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: '#000',
                  color: '#eab308',
                  padding: '3px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('ui.generated.pratinjau_kualitas_rendah_67bd0d9')}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('ui.generated.file_asli_belum_berhasil_diunduh_menampilkan_603eabe')} {previewSource ? previewSource.replace(/_/g, ' ') : t('ui.generated.thumbnail_fallback_2d60b41')}.
              </span>
              <button
                type="button"
                className="td-btn-secondary"
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  borderRadius: '16px',
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => {
                  invalidatePreview(folderId, file.id);
                  setSrcOverride(null);
                  setError(null);
                  setLoading(true);
                  loadPreview('auto', { force: true });
                }}
              >
                <RefreshCw size={13} /> {t('ui.generated.muat_ulang_file_asli_6a1c26d')}
              </button>
            </div>
          )}

          {!error && showImage && (
            <div
              className={`drive-preview-media-wrap ${mediaCursorClass}${
                zoom !== 1 || rotation || flipH || flipV || isDragging ? ' is-transformed' : ''
              }`}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUpLocal}
              onPointerCancel={onPointerUpLocal}
              onDoubleClick={onImageDoubleClick}
              onWheel={onWheelStage}
              onContextMenu={(e) => e.preventDefault()}
              title={
                zoom > 1.01
                  ? 'Tahan & seret untuk geser · gulir untuk zoom (25%–600%) · double-klik untuk 100%'
                  : 'Gulir untuk zoom (25%–600%, default 100%) · double-klik untuk perbesar'
              }
            >
              {isTgsDriveFile(file) ? (
                <TgsLottiePlayer
                  key={`${file.id}-${srcOverride || 'tgs'}`}
                  src={activeSrc!}
                  poster={poster || gridThumb}
                  zoom={zoom}
                  rotation={rotation}
                  flipH={flipH}
                  flipV={flipV}
                  pan={pan}
                  onLoad={() => {
                    setLoading(false);
                    setError(null);
                  }}
                  onError={() => {
                    if (!tryNextSrc()) {
                      setError(t('ui.generated.gagal_menampilkan_gambar_coba_download_atau_buka_824c3ec'));
                    }
                  }}
                />
              ) : (
                <img
                  key={`${file.id}-${srcOverride || 'primary'}`}
                  src={activeSrc!}
                  alt={displayName}
                  className="drive-preview-media drive-preview-img"
                  draggable={false}
                  style={{
                    transform: mediaTransform,
                    transformOrigin: 'center center',
                    pointerEvents: 'none',
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setMediaWidth(img.naturalWidth);
                    setMediaHeight(img.naturalHeight);
                    setLoading(false);
                    setError(null);
                    captureImageFrame(img);
                  }}
                  onError={() => {
                    if (!tryNextSrc()) {
                      setError(t('ui.generated.gagal_menampilkan_gambar_coba_download_atau_buka_824c3ec'));
                    }
                  }}
                />
              )}
              {loading && !isTgsDriveFile(file) && (
                <div className="drive-preview-loading-chip">
                  <Loader2 size={14} className="spin" /> {t('ui.generated.memuat_full_651e1dd')}
                </div>
              )}
            </div>
          )}

          {!error && showVideo && (
            <div
              className={`drive-preview-media-wrap ${mediaCursorClass}${
                needsMediaTransform ? ' is-transformed' : ''
              }${!controlsVisible ? ' is-hide-cursor' : ''}`}
              style={{
                overflow: 'hidden',
              }}
              onPointerMove={resetControlsTimeout}
              onPointerDown={handleVideoPointerDown}
              onPointerUp={handleVideoPointerUp}
              onPointerCancel={handleVideoPointerLeave}
              onPointerLeave={handleVideoPointerLeave}
              onWheel={(e) => {
                onWheelStage(e);
              }}
            >
              {!hasVideoFrame && (poster || gridThumb) && (
                <img
                  src={poster || gridThumb || ''}
                  alt=""
                  className="drive-preview-video-poster-fallback"
                  draggable={false}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    zIndex: 0,
                    pointerEvents: 'none',
                    transform: needsMediaTransform ? mediaTransform : 'none',
                    transformOrigin: 'center center',
                  }}
                />
              )}
              <video
                ref={videoRef}
                key={`vid-${file.id}-${quality}`}
                src={activeSrc!}
                poster={poster || gridThumb || undefined}
                controls={false}
                playsInline
                autoPlay
                muted={muted}
                loop={loopVideo}
                preload="auto"
                className={`drive-preview-media drive-preview-video${
                  hasVideoFrame ? ' is-ready' : ' is-booting'
                }`}
                style={{
                  transform: needsMediaTransform ? mediaTransform : 'none',
                  transformOrigin: 'center center',
                }}
                onProgress={() => {
                  updateVideoBuffered();
                }}
                onLoadedMetadata={() => {
                  const v = videoRef.current;
                  const t = resumeAtRef.current;
                  if (v) {
                    console.debug('[STREAM_DIAG][MODAL]', {
                      event: 'loadedmetadata',
                      fileId: file.id,
                      fileName: file.name,
                      duration: v.duration,
                      readyState: v.readyState,
                      networkState: v.networkState,
                    });
                    v.playbackRate = playbackRate;
                    v.muted = muted;
                    v.loop = loopVideo;
                    setMediaWidth(v.videoWidth);
                    setMediaHeight(v.videoHeight);
                    if (v.duration && Number.isFinite(v.duration)) {
                      setVideoDuration(v.duration);
                    }
                  }
                  updateVideoBuffered();
                  if (v && t > 0.5 && Number.isFinite(v.duration) && t < v.duration) {
                    try {
                      ignoreSeekEventsRef.current += 1;
                      userSeekPendingRef.current = false;
                      v.currentTime = t;
                    } catch {
                      ignoreSeekEventsRef.current = Math.max(0, ignoreSeekEventsRef.current - 1);
                    }
                  }
                  resumeAtRef.current = 0;
                  setLoading(false);
                  if (v && (v.paused || !hasUserPlayRef.current) && !v.ended) {
                    void v.play().then(() => {
                      hasUserPlayRef.current = true;
                      userExplicitlyPausedRef.current = false;
                      setHasVideoFrame(true);
                      setPlayerHint(null);
                      setLoading(false);
                    }).catch(() => {
                      v.muted = true;
                      setMuted(true);
                      void v.play().then(() => {
                        hasUserPlayRef.current = true;
                        userExplicitlyPausedRef.current = false;
                        setHasVideoFrame(true);
                        setPlayerHint(null);
                        setLoading(false);
                      }).catch(() => undefined);
                    });
                  }
                }}
                onLoadedData={() => {
                  const v = videoRef.current;
                  if (v) {
                    console.debug('[STREAM_DIAG][MODAL]', {
                      event: 'loadeddata',
                      fileId: file.id,
                      readyState: v.readyState,
                      currentTime: v.currentTime,
                    });
                    if (v.duration && Number.isFinite(v.duration)) {
                      setVideoDuration(v.duration);
                    }
                  }
                  updateVideoBuffered();
                  if (streamTimeoutRef.current != null) {
                    window.clearTimeout(streamTimeoutRef.current);
                    streamTimeoutRef.current = null;
                  }
                  setHasVideoFrame(true);
                  setLoading(false);
                  setPlayerHint(null);
                  captureVideoFrame();
                  if (v && v.paused && !v.ended) {
                    void v.play().then(() => {
                      hasUserPlayRef.current = true;
                    }).catch(() => {
                      v.muted = true;
                      setMuted(true);
                      void v.play().then(() => {
                        hasUserPlayRef.current = true;
                      }).catch(() => undefined);
                    });
                  }
                }}
                onCanPlay={() => {
                  const v = videoRef.current;
                  if (v) {
                    console.debug('[STREAM_DIAG][MODAL]', {
                      event: 'canplay',
                      fileId: file.id,
                      readyState: v.readyState,
                      currentTime: v.currentTime,
                    });
                    if (v.duration && Number.isFinite(v.duration)) {
                      setVideoDuration(v.duration);
                    }
                  }
                  updateVideoBuffered();
                  if (streamTimeoutRef.current != null) {
                    window.clearTimeout(streamTimeoutRef.current);
                    streamTimeoutRef.current = null;
                  }
                  setHasVideoFrame(true);
                  setLoading(false);
                  setPlayerHint(null);
                  captureVideoFrame();
                  if (v && v.paused && !v.ended) {
                    void v.play().then(() => {
                      hasUserPlayRef.current = true;
                    }).catch(() => {
                      v.muted = true;
                      setMuted(true);
                      void v.play().then(() => {
                        hasUserPlayRef.current = true;
                        userExplicitlyPausedRef.current = false;
                        setHasVideoFrame(true);
                        setPlayerHint(null);
                        setLoading(false);
                      }).catch(() => undefined);
                    });
                  }
                }}
                onTimeUpdate={() => {
                  const v = videoRef.current;
                  if (v) {
                    setVideoCurrentTime(v.currentTime);
                    if (v.duration && Number.isFinite(v.duration)) {
                      setVideoDuration(v.duration);
                    }
                    checkAndRequestLookaheadBuffer(v);
                  }
                  updateVideoBuffered();
                  captureVideoFrame();
                }}
                onSeeking={() => {
                  if (ignoreSeekEventsRef.current > 0) return;
                  userSeekPendingRef.current = true;
                  handleSeekJump();
                }}
                onSeeked={() => {
                  captureVideoFrame();
                  if (ignoreSeekEventsRef.current > 0) {
                    ignoreSeekEventsRef.current -= 1;
                    userSeekPendingRef.current = false;
                    return;
                  }
                  userSeekPendingRef.current = true;
                  handleSeekJump();
                }}
                onEnded={() => {
                  setVideoIsPlaying(false);
                  if (!loopVideo) return;
                  const v = videoRef.current;
                  if (!v) return;
                  try {
                    ignoreSeekEventsRef.current += 1;
                    userSeekPendingRef.current = false;
                    v.currentTime = 0;
                    void v.play().catch(() => undefined);
                  } catch {
                    ignoreSeekEventsRef.current = Math.max(0, ignoreSeekEventsRef.current - 1);
                  }
                }}
                onWaiting={() => {
                  if (streamUrl && !streamDone && !seekWarn) {
                    setPlayerHint(t('ui.generated.buffering_014b2d2'));
                  }
                  recoverStalledVideo('waiting');
                }}
                onPlay={() => {
                  setVideoIsPlaying(true);
                  userExplicitlyPausedRef.current = false;
                  captureVideoFrame();
                  handlePlay();
                }}
                onPause={() => {
                  setVideoIsPlaying(false);
                  const v = videoRef.current;
                  if (v && !v.error && !v.ended) {
                    userExplicitlyPausedRef.current = true;
                  }
                  captureVideoFrame();
                  handlePause();
                }}
                onPlaying={() => {
                  setVideoIsPlaying(true);
                  userExplicitlyPausedRef.current = false;
                  setHasVideoFrame(true);
                  setLoading(false);
                  captureVideoFrame();
                  handlePlay();
                  // Video is actually playing — reset error counters so transient
                  // buffer holes start fresh (no "Buffer lambat" stuck after recovery).
                  mediaErrorCountRef.current = 0;
                  if (softReloadInFlightRef.current) {
                    softReloadInFlightRef.current = false;
                    if (softReloadTimerRef.current != null) {
                      window.clearTimeout(softReloadTimerRef.current);
                      softReloadTimerRef.current = null;
                    }
                  }
                  if (seekWarn && seekWarn.startsWith('Memuat')) {
                    setSeekWarn(null);
                  }
                  if (!seekWarn && streamUrl && !streamDone) setPlayerHint(null);
                  else if (!streamUrl || streamDone) setPlayerHint(null);
                }}
                onStalled={() => {
                  if (streamUrl && !streamDone && !seekWarn) {
                    setPlayerHint(t('ui.generated.menunggu_data_a54699d'));
                  }
                  recoverStalledVideo('stalled');
                }}
                onError={(e) => {
                  const v = videoRef.current;
                  const mediaErr = v?.error || (e.target as HTMLVideoElement)?.error;
                  // MEDIA_ERR_ABORTED (1): user navigation — harmless
                  if (!mediaErr || mediaErr.code === 1) return;

                  const progressiveFilling = !!streamUrl && !streamDoneRef.current;
                  if (progressiveFilling) {
                    mediaErrorCountRef.current += 1;

                    // MEDIA_ERR_NETWORK (2): browser ran out of buffered data.
                    // Save playback position. The poll loop (tick) will auto-rebind & play
                    // as soon as the stream server has data for currentTime.
                    if (mediaErr.code === 2) {
                      if (v) {
                        const playbackTime = v.currentTime || 0;
                        if (playbackTime > 0.25) resumeAtRef.current = playbackTime;
                      }
                      setPlayerHint(t('ui.generated.buffering_menunggu_data_stream_ad15ce8'));
                      return;
                    }

                    // MEDIA_ERR_DECODE (3) or SRC_NOT_SUPPORTED (4): the element itself is
                    // broken. A src rebind can clear it without restarting Telegram download.
                    const n = mediaErrorCountRef.current;
                    if (
                      v &&
                      streamUrl &&
                      nativeStreamReadyRef.current &&
                      n === 1 &&
                      !softReloadInFlightRef.current
                    ) {
                      softReloadInFlightRef.current = true;
                      setPlayerHint(t('ui.generated.buffering_menyambung_putar_67ddccf'));
                      const playbackTime = v.currentTime || 0;
                      const sticky = streamUrl;
                      if (softReloadTimerRef.current != null) {
                        window.clearTimeout(softReloadTimerRef.current);
                      }
                      softReloadTimerRef.current = window.setTimeout(() => {
                        softReloadInFlightRef.current = false;
                        softReloadTimerRef.current = null;
                        const vv = videoRef.current;
                        if (!vv || mountGenRef.current !== activeMountGen) return;
                        try {
                          if (vv.error) {
                            vv.removeAttribute('src');
                            vv.load();
                            vv.src = sticky;
                            if (playbackTime > 0.25) {
                              ignoreSeekEventsRef.current += 1;
                              // Defer currentTime until element has loaded enough
                              window.setTimeout(() => { try { vv.currentTime = playbackTime; } catch { /**/ } }, 200);
                            }
                          }
                          void vv.play().then(() => {
                            hasUserPlayRef.current = true;
                            setPlayerHint(null);
                          }).catch(() => undefined);
                        } catch {
                          /* ignore */
                        }
                      }, 400);
                      return;
                    }
                    // Exhausted retries — just hint, never hard-reload
                    setPlayerHint(t('ui.generated.mengisi_buffer_tekan_play_jika_ingin_mulai_lebih_639deaa'));
                    return;
                  }

                  if (tryNextSrc()) return;
                  // Stale stream URL after worker restart / StrictMode teardown
                  if (streamUrl) {
                    const now = Date.now();
                    if (now - mediaErrorRecoverAtRef.current < 5000) return;
                    mediaErrorRecoverAtRef.current = now;
                    invalidatePreview(folderId, file.id);
                    setHasVideoFrame(false);
                    liveStreamIdRef.current = null;
                    setStreamUrl(null);
                    setStreamId(null);
                    setPlayerHint(t('ui.generated.menyambung_stream_f32ac6d'));
                    window.setTimeout(() => {
                      loadPreview(quality, { soft: false, force: true });
                    }, 800);
                    return;
                  }
                  if (!loading) {
                    setError(t('ui.generated.gagal_memutar_media_coba_kualitas_lain_atau_down_58accbf'));
                  }
                }}
              />
              {streamUrl && !streamDone && bufferPct < 100 && (
                <div
                  className={`drive-stream-bar${seekWarn ? ' is-seek-warn' : ''}`}
                  title={
                    seekWarn ||
                    'Buffer unduhan. Seek ke titik mana pun memuat data di titik itu (seperti YouTube).'
                  }
                >
                  <div className="drive-stream-fill" style={{ width: `${bufferPct}%` }} />
                  <span className="drive-stream-label">
                    {seekWarn
                      ? seekWarn
                      : playerHint
                        ? `${playerHint} · ${bufferPct}%`
                        : `Buffer ${bufferPct}%${
                            file.as_document ? ' · Dokumen File' : ' · Media Video'
                          }${activeQuality ? ` · ${activeQuality.label}` : ''}`}
                  </span>
                </div>
              )}
              {loading && (
                <div className="drive-preview-loading-chip">
                  <Loader2 size={14} className="spin" /> {t('ui.generated.stream_55796d7')}
                </div>
              )}
              {quality === 'preview' && (
                <div className="drive-preview-banner-overlay" style={{
                  position: 'absolute',
                  bottom: '50px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(15, 23, 42, 0.9)',
                  backdropFilter: 'blur(8px)',
                  padding: '8px 16px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  color: 'white',
                  zIndex: 20,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>
                    {t('ui.generated.pratinjau_30_detik_hemat_kuota_174009f')}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const fullQ = qualities.find(q => q.id !== 'preview' && q.id !== 'auto')?.id || 'original';
                        void handleQualityChange(fullQ);
                      }}
                      style={{
                        background: '#2563eb',
                        color: 'white',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = '#1d4ed8')}
                      onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
                    >
                      {t('ui.generated.transcode_penuh_4571d15')}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleOpenSystem();
                      }}
                      style={{
                        background: 'rgba(255,255,255,0.15)',
                        color: 'white',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
                      onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                    >
                      {t('ui.generated.buka_file_asli_56891f0')}
                    </button>
                  </div>
                </div>
              )}
              {/* Overlays inside media wrapper: ripple, jump, 2x hold speedup */}
              {rippleOverlay && (
                <div key={`ripple-${rippleOverlay.key}`} className="drive-preview-ripple-overlay">
                  {rippleOverlay.type === 'play' ? (
                    <Play size={32} className="fill-current ml-1" />
                  ) : (
                    <Pause size={32} />
                  )}
                </div>
              )}
              {jumpOverlay && (
                <div
                  key={`jump-${jumpOverlay.key}`}
                  className={`drive-preview-jump-overlay is-${jumpOverlay.side}`}
                >
                  {jumpOverlay.side === 'left' ? <RotateCcw size={28} /> : <RotateCw size={28} />}
                  <span className="drive-preview-jump-text">
                    {jumpOverlay.side === 'left' ? `-${jumpOverlay.seconds}s` : `+${jumpOverlay.seconds}s`}
                  </span>
                </div>
              )}
              {isSpeedingUp && (
                <div className="drive-preview-speedup-pill">
                  <FastForward size={15} />
                  <span>{t('speedtest.speed_up_hint')}</span>
                </div>
              )}

              {/* Custom video controls bar (untransformed, pinned to bottom of media wrapper, auto-hiding) */}
              <div
                className={`drive-preview-video-controls-bar${
                  !controlsVisible ? ' is-hidden' : ''
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {/* Progress seek bar track with buffered line */}
                <div className="drive-preview-seek-container">
                  <div className="drive-preview-seek-track">
                    <div
                      className="drive-preview-seek-buffer"
                      style={{ width: `${videoBufferedPercent}%` }}
                    />
                    <div
                      className="drive-preview-seek-fill"
                      style={{
                        width: `${
                          videoDuration > 0
                            ? Math.min(100, Math.max(0, (videoCurrentTime / videoDuration) * 100))
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={videoDuration || 100}
                    step={0.1}
                    value={videoCurrentTime}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVideoCurrentTime(val);
                      const v = videoRef.current;
                      if (v) {
                        userSeekPendingRef.current = true;
                        v.currentTime = val;
                        handleSeekJump();
                      }
                    }}
                    className="drive-preview-seek-input"
                  />
                </div>

                {/* Bottom control row */}
                <div className="drive-preview-controls-row">
                  <div className="drive-preview-controls-left">
                    <button
                      type="button"
                      onClick={() => {
                        const v = videoRef.current;
                        if (!v) return;
                        if (v.paused) {
                          void v.play();
                        } else {
                          v.pause();
                        }
                      }}
                      className="drive-preview-control-btn"
                      title={videoIsPlaying ? t('speedtest.preview_pause_hint') : t('speedtest.preview_play_hint')}
                    >
                      {videoIsPlaying ? <Pause size={18} /> : <Play size={18} className="fill-current" />}
                    </button>

                    <div className="drive-preview-volume-group">
                      <button
                        type="button"
                        onClick={() => {
                          const v = videoRef.current;
                          if (!v) return;
                          v.muted = !muted;
                          setMuted(!muted);
                        }}
                        className="drive-preview-control-btn"
                        title={muted || videoVolume === 0 ? t('speedtest.preview_unmute_hint') : t('speedtest.preview_mute_hint')}
                      >
                        {muted || videoVolume === 0 ? (
                          <VolumeX size={16} className="text-red-400" />
                        ) : (
                          <Volume2 size={16} />
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={muted ? 0 : videoVolume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setVideoVolume(val);
                          const v = videoRef.current;
                          if (v) {
                            v.volume = val;
                            if (val > 0 && muted) {
                              v.muted = false;
                              setMuted(false);
                            }
                          }
                        }}
                        className="drive-preview-volume-slider"
                      />
                    </div>

                    <div className="drive-preview-time-label">
                      <span className="active">{formatDriveDuration(videoCurrentTime)}</span>
                      <span> / </span>
                      <span>{videoDuration > 0 ? formatDriveDuration(videoDuration) : '--:--'}</span>
                    </div>
                  </div>

                  <div className="drive-preview-controls-right">
                    {/* Speed menu button */}
                    <div className="drive-quality-wrap">
                      <button
                        ref={rateBtnRef}
                        type="button"
                        className="drive-preview-control-btn"
                        title={t("speedtest.tooltip_speed")}
                        onClick={() => {
                          setQualityOpen(false);
                          setQualityMenuPos(null);
                          setRateOpen((o) => {
                            const next = !o;
                            if (next) setRateMenuPos(placeMenuNear(rateBtnRef.current, 230));
                            else setRateMenuPos(null);
                            return next;
                          });
                        }}
                        aria-expanded={rateOpen}
                        aria-haspopup="menu"
                        aria-label={`Kecepatan putar: ${playbackRate}x`}
                      >
                        <Gauge size={16} />
                        <span style={{ fontSize: '12px', fontWeight: 600, marginLeft: '3px' }}>{playbackRate}{t('ui.generated.x_11f6ad8')}</span>
                      </button>
                    </div>

                    {/* Loop video toggle */}
                    <button
                      type="button"
                      className={`drive-preview-control-btn${loopVideo ? ' is-active' : ''}`}
                      title={
                        loopVideo
                          ? 'Loop aktif — video diputar lagi setelah selesai (klik untuk matikan)'
                          : 'Loop: putar ulang otomatis setelah selesai'
                      }
                      aria-pressed={loopVideo}
                      aria-label={loopVideo ? 'Matikan loop video' : 'Aktifkan loop video'}
                      onClick={() => setLoopVideo((on) => !on)}
                    >
                      <Repeat size={16} className={loopVideo ? 'text-emerald-400' : ''} />
                    </button>

                    {/* Fullscreen toggle */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="drive-preview-control-btn"
                      title={isFullscreen ? t('speedtest.preview_fullscreen_exit') : t('speedtest.preview_fullscreen_enter')}
                    >
                      {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!error && showAudio && (
            <div
              className="drive-preview-media-wrap drive-preview-audio-wrap"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '24px',
                padding: '40px',
                width: '100%',
                maxWidth: '500px',
                margin: '0 auto',
                background: 'rgba(15, 23, 42, 0.45)',
                backdropFilter: 'blur(16px)',
                borderRadius: '24px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
              }}
            >
              <style>{t('ui.generated.keyframes_spin_from_transform_rotate_0deg_to_tra_51d586c')}</style>
              
              {/* Rotating Cover / Vinyl disk */}
              <div
                className={`drive-audio-disk-container ${!loading && hasVideoFrame ? 'is-playing' : ''}`}
                style={{
                  width: '180px',
                  height: '180px',
                  borderRadius: '50%',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #1e1b4b, #311042)',
                  border: '8px solid rgba(255, 255, 255, 0.05)',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(255,255,255,0.05)',
                  overflow: 'hidden',
                }}
              >
                {poster || gridThumb ? (
                  <img
                    src={poster || gridThumb || ''}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '50%',
                    }}
                    draggable={false}
                  />
                ) : (
                  <div style={{ color: '#818cf8', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Volume2 size={48} />
                  </div>
                )}
                {/* Center hole */}
                <div
                  style={{
                    position: 'absolute',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#0b0f19',
                    border: '4px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: 'inset 0 0 8px rgba(0,0,0,0.8)',
                  }}
                />
              </div>

              {/* Title & Metadata */}
              <div style={{ textAlign: 'center', width: '100%' }}>
                <h3 style={{
                  color: '#f8fafc',
                  fontSize: '16px',
                  fontWeight: 600,
                  marginBottom: '6px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {displayName}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '13px' }}>
                  {durationLabel ? `${durationLabel} · ` : ''}{formatDriveBytes(file.size)}
                </p>
              </div>

              {/* Audio player element */}
              <audio
                ref={videoRef}
                key={`aud-${file.id}-${quality}`}
                src={activeSrc!}
                controls
                playsInline
                autoPlay
                loop={loopVideo}
                preload="auto"
                style={{
                  width: '100%',
                  borderRadius: '12px',
                  outline: 'none',
                }}
                onLoadedMetadata={() => {
                  const v = videoRef.current;
                  const t = resumeAtRef.current;
                  if (v) {
                    v.playbackRate = playbackRate;
                    v.muted = muted;
                    v.loop = loopVideo;
                  }
                  if (v && t > 0.5 && Number.isFinite(v.duration) && t < v.duration) {
                    try {
                      ignoreSeekEventsRef.current += 1;
                      userSeekPendingRef.current = false;
                      v.currentTime = t;
                    } catch {
                      ignoreSeekEventsRef.current = Math.max(0, ignoreSeekEventsRef.current - 1);
                    }
                  }
                  resumeAtRef.current = 0;
                  setLoading(false);
                }}
                onLoadedData={() => {
                  setHasVideoFrame(true);
                  setLoading(false);
                  captureVideoFrame();
                }}
                onCanPlay={() => {
                  setHasVideoFrame(true);
                  setLoading(false);
                  captureVideoFrame();
                }}
                onSeeking={() => {
                  if (ignoreSeekEventsRef.current > 0) return;
                  userSeekPendingRef.current = true;
                  handleSeekJump();
                }}
                onSeeked={() => {
                  if (ignoreSeekEventsRef.current > 0) {
                    ignoreSeekEventsRef.current -= 1;
                    userSeekPendingRef.current = false;
                    return;
                  }
                  userSeekPendingRef.current = true;
                  handleSeekJump();
                }}
                onEnded={() => {
                  if (!loopVideo) return;
                  const v = videoRef.current;
                  if (!v) return;
                  try {
                    ignoreSeekEventsRef.current += 1;
                    userSeekPendingRef.current = false;
                    v.currentTime = 0;
                    void v.play().catch(() => undefined);
                  } catch {
                    ignoreSeekEventsRef.current = Math.max(0, ignoreSeekEventsRef.current - 1);
                  }
                }}
                onWaiting={() => {
                  if (streamUrl && !streamDone && !seekWarn) {
                    setPlayerHint(t('ui.generated.buffering_014b2d2'));
                  }
                }}
                onPlay={() => {
                  handlePlay();
                  setHasVideoFrame(true);
                }}
                onPause={() => {
                  handlePause();
                  setHasVideoFrame(false);
                }}
                onPlaying={() => {
                  setHasVideoFrame(true);
                  setLoading(false);
                  handlePlay();
                  captureVideoFrame();
                  if (seekWarn && seekWarn.startsWith('Memuat')) {
                    setSeekWarn(null);
                  }
                  if (!seekWarn && streamUrl && !streamDone) setPlayerHint(null);
                  else if (!streamUrl || streamDone) setPlayerHint(null);
                }}
                onStalled={() => {
                  if (streamUrl && !streamDone && !seekWarn) {
                    setPlayerHint(t('ui.generated.menunggu_data_a54699d'));
                    const v = videoRef.current;
                    if (v && v.paused && v.readyState >= 2) {
                      void v.play().catch(() => undefined);
                    }
                  }
                }}
                onError={(e) => {
                  const mediaErr = videoRef.current?.error || (e.target as HTMLAudioElement)?.error;
                  if (mediaErr && mediaErr.code === 1) {
                    return; // MEDIA_ERR_ABORTED is not a failure
                  }
                  if (streamUrl && !streamDone) {
                    setPlayerHint(t('ui.generated.buffering_menunggu_data_stream_ad15ce8'));
                    return;
                  }
                  if (tryNextSrc()) return;
                  if (streamUrl) {
                    const now = Date.now();
                    if (now - mediaErrorRecoverAtRef.current < 5000) return;
                    mediaErrorRecoverAtRef.current = now;
                    invalidatePreview(folderId, file.id);
                    liveStreamIdRef.current = null;
                    setStreamUrl(null);
                    setStreamId(null);
                    setPlayerHint(t('ui.generated.menyambung_stream_f32ac6d'));
                    window.setTimeout(() => {
                      loadPreview(quality, { soft: false, force: true });
                    }, 800);
                    return;
                  }
                  if (!loading) {
                    setError(t('ui.generated.gagal_memutar_audio_coba_download_441f95e'));
                  }
                }}
              />

              {/* Progressive buffer status for audio */}
              {streamUrl && !streamDone && bufferPct < 100 && (
                <div
                  className={`drive-stream-bar${seekWarn ? ' is-seek-warn' : ''}`}
                  style={{ width: '100%', marginTop: '-12px' }}
                >
                  <div className="drive-stream-fill" style={{ width: `${bufferPct}%` }} />
                  <span className="drive-stream-label">
                    {seekWarn
                      ? seekWarn
                      : playerHint
                        ? `${playerHint} · ${bufferPct}%`
                        : `Buffer ${bufferPct}%`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* PDF in-app viewer (iframe / native embed) */}
          {isPdf && pdfSrc && (
            <div className="drive-preview-doc drive-preview-pdf">
              <iframe
                ref={pdfFrameRef}
                title={displayName}
                src={pdfSrc}
                className="drive-preview-pdf-frame"
                onLoad={() => {
                  setLoading(false);
                  setError(null);
                }}
              />
            </div>
          )}
          {isPdf && !pdfSrc && loading && (
            <div className="drive-empty">
              <Loader2 size={32} className="spin" />
              <p>{t('ui.generated.mengunduh_pdf_lengkap_27e7842')}</p>
              {bufferPct > 0 && (
                <p className="field-hint">{t('ui.generated.buffer_2be5f64')} {bufferPct}%</p>
              )}
            </div>
          )}
          {isPdf && !pdfSrc && !loading && (
            <div className="drive-empty">
              <FileText size={40} className="td-type-ico doc" />
              <p>
                {tooLarge
                  ? hint || t('ui.generated.pdf_terlalu_besar_untuk_pratinjau_0949b5e')
                  : error ||
                    t('ui.generated.pdf_belum_siap_coba_lagi_atau_buka_di_aplikasi_s_c0f25ca')}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="td-btn-primary"
                  onClick={() => {
                    invalidatePreview(folderId, file.id);
                    setError(null);
                    setStreamDone(false);
                    setBufferPct(0);
                    loadPreview(quality, { force: true });
                  }}
                >
                  <RefreshCw size={14} /> {t('speedtest.zip_retry')}
                </button>
                {isDesktop() && (
                  <button type="button" className="td-btn-primary" onClick={handleOpenSystem} disabled={openingSystem || !creds}>
                    <ExternalLink size={14} /> {t('speedtest.label_open')}
                  </button>
                )}
                <button type="button" className="td-btn-primary" onClick={handleDownload} disabled={saving}>
                  <Download size={14} /> {t('speedtest.label_download')}
                </button>
              </div>
            </div>
          )}

          {/* Text / JSON / Code viewer */}
          {isText && textBody != null && (
            <div className="drive-preview-doc drive-preview-text" style={{ padding: 0, height: '100%' }}>
              <VSCodeCodeViewer text={textBody} name={file.name} />
            </div>
          )}
          {isText && textBody == null && !loading && !error && (
            <div className="drive-empty">
              <FileText size={40} className="td-type-ico doc" />
              <p>{t('ui.generated.teks_belum_termuat_coba_lagi_0e11184')}</p>
              <button
                type="button"
                className="td-btn-primary"
                onClick={() => {
                  invalidatePreview(folderId, file.id);
                  setError(null);
                  setTextBody(null);
                  loadPreview(quality, { force: true });
                }}
              >
                <RefreshCw size={14} /> {t('speedtest.zip_retry')}
              </button>
            </div>
          )}

          {/* Unified, Full-Bleed ZIP Workbench */}
          {isZip && (
            <div className="drive-preview-doc drive-preview-zip" style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0, padding: 0 }}>
              {creds ? (
                <ZipErrorBoundary onClose={onClose}>
                  <DriveZipBrowser
                    creds={creds}
                    messageId={file.id}
                    folderId={folderId}
                    peerId={file.peer_id || (folderId != null && folderId !== 0 ? String(folderId) : null)}
                    topicId={file.topic_id ?? null}
                    locationType={(file.peer_id || (folderId != null && folderId !== 0 ? String(folderId) : null)) === 'me' ? 'saved_messages' : 'group'}
                    accountId={file.account_id || creds?.session}
                    archiveName={displayName}
                    onClose={onClose}
                    onPrev={hasPrev ? () => onPrev?.() : undefined}
                    onNext={hasNext ? () => onNext?.() : undefined}
                    hasPrev={hasPrev}
                    hasNext={hasNext}
                    onDownloadZip={handleDownload}
                    onOpenSystem={isDesktop() ? handleOpenSystem : undefined}
                    folders={folders}
                    chats={chats}
                    onRefreshDrive={onRefreshDrive}
                    onOpenTransferManager={onOpenTransferManager}
                    onEnqueueUploadPaths={onEnqueueUploadPaths}
                  />
                </ZipErrorBoundary>
              ) : (
                <div className="drive-zip-browser is-loading" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
                  <Loader2 size={36} className="spin" style={{ color: '#ffae00', marginBottom: 12 }} />
                  <p style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f8fafc' }}>
                    {t('ui.generated.menyiapkan_sesi_telegram_membaca_indeks_zip_3acae63')}
                  </p>
                  <span className="drive-zip-hint" style={{ marginTop: 8, color: '#94a3b8' }}>
                    {t('ui.generated.kredensial_sesi_telegram_sedang_dimuat_c59430a')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Office / binary — open with system apps */}
          {!loading &&
            !error &&
            !showImage &&
            !showVideo &&
            !showAudio &&
            !isVideo &&
            !isImage &&
            !isAudio &&
            !showThumbSkeleton &&
            !isPdf &&
            !isText &&
            !isZip &&
            !(isText && textBody != null) && (
            <div className="drive-empty">
              {isOfficeDriveFile(file) || isDocOther ? (
                <FileText size={40} className="td-type-ico doc" />
              ) : isVideo ? (
                <Film size={40} className="td-type-ico video" />
              ) : (
                <ImageIcon size={40} />
              )}
              <p>
                {isOfficeDriveFile(file)
                  ? t('ui.generated.office_document_buka_dengan_aplikasi_windows_wor_4752289')
                  : hint ||
                    (tooLarge
                      ? t('ui.generated.file_besar_gunakan_download_atau_buka_di_aplikas_a379897')
                      : t('ui.generated.pratinjau_penuh_tidak_tersedia_di_app_buka_denga_c9dd2b5'))}
              </p>
              {(poster || gridThumb) && (
                <img
                  src={poster || gridThumb || ''}
                  alt=""
                  style={{ maxWidth: 240, borderRadius: 10, marginTop: 8 }}
                />
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {isDesktop() && (
                  <>
                    <button
                      type="button"
                      className="td-btn-primary"
                      onClick={handleOpenSystem}
                      disabled={openingSystem || !creds}
                    >
                      <ExternalLink size={14} /> {t('speedtest.label_open')}
                    </button>
                    <button
                      type="button"
                      className="td-btn-primary"
                      onClick={handleOpenWith}
                      disabled={openingSystem || !creds}
                    >
                      <AppWindow size={14} /> {t('speedtest.ctx_menu_open_with')}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="td-btn-primary"
                  onClick={() => {
                    invalidatePreview(folderId, file.id);
                    setError(null);
                    loadPreview(quality, { force: true });
                  }}
                >
                  <RefreshCw size={14} /> {t('speedtest.zip_retry')}
                </button>
                <button type="button" className="td-btn-primary" onClick={handleDownload} disabled={saving}>
                  <Download size={14} /> {t('ui.generated.download_file_774025d')}
                </button>
              </div>
            </div>
          )}

          {showInfo && !isSplitCompareMode && (
            <div
              className="drive-preview-info"
              role="dialog"
              aria-label={t("speedtest.detail_aria")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drive-preview-info-head">
                <strong className="drive-preview-info-title">{t("speedtest.file_detail_title")}</strong>
                <button
                  type="button"
                  className="td-icon-btn drive-preview-info-close"
                  title={t("speedtest.close_info")}
                  aria-label={t("speedtest.close_info")}
                  onClick={() => setShowInfo(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <div>
                <strong>{t('speedtest.col_name')}</strong> {displayName}
              </div>
              {file.original_name && file.original_name !== displayName && (
                <div title={file.original_name}>
                  <strong>{t("speedtest.original_name_label")}</strong> {file.original_name}
                </div>
              )}
              {mediaWidth && mediaHeight && (
                <div>
                  <strong>{t("speedtest.dimensions_label")}</strong> {mediaWidth} {t('ui.generated.text_67fba2f')} {mediaHeight} {t('ui.generated.px_07a65dd')}
                </div>
              )}
              <div>
                <strong>{t("speedtest.size_label")}</strong> {formatDriveBytes(file.size)}
              </div>
              {customSource?.compressedSize != null && (
                <div>
                  <strong>{t("speedtest.zip_col_compressed")}</strong> {formatDriveBytes(customSource.compressedSize)}
                </div>
              )}
              {customSource?.encrypted && (
                <div>
                  <strong>{t("speedtest.zip_tag_encrypted")}</strong> 🔒 {t('speedtest.zip_tag_encrypted')}
                </div>
              )}
              {durationLabel && (
                <div>
                  <strong>{t("speedtest.duration_label")}</strong> {durationLabel}
                </div>
              )}
              <div>
                <strong>{t("speedtest.type_label")}</strong> {kindLabel || file.icon_type}
              </div>
              {mime && (
                <div>
                  <strong>{t("speedtest.mime_label")}</strong> {mime}
                </div>
              )}
              {file.created_at && (
                <div>
                  <strong>{t("speedtest.date_label")}</strong> {new Date(file.created_at).toLocaleString('id-ID', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
              )}
              <div>
                <strong>{t('speedtest.delivery_label')}</strong>{' '}
                {file.as_document
                  ? t('speedtest.deliv_doc_orig')
                  : isVideo
                  ? t('speedtest.deliv_video_comp')
                  : isImage
                  ? t('speedtest.deliv_photo_comp')
                  : t('speedtest.deliv_video_comp')}
              </div>
              {isVideo && (
                <div>
                  <strong>{t("speedtest.quality_label")}</strong> {activeQuality?.label || quality}
                </div>
              )}
              {(isImage || isVideo) && (
                <div>
                  <strong>{t("speedtest.zoom_label")}</strong> {Math.round(zoom * 100)}%
                  {rotation ? ` · putar ${rotation}°` : ''}
                  {flipH ? t('ui.generated.cermin_9f43e5b') : ''}
                  {flipV ? t('ui.generated.balik_3fa8ae7') : ''}
                </div>
              )}
              {streamUrl && (
                <div>
                  <strong>{t("speedtest.mode_label")}</strong> {t('ui.generated.progressive_stream_427e9c1')}
                </div>
              )}
              {path && (
                <div title={path}>
                  <strong>{t("speedtest.cache_label")}</strong> {path.split(/[/\\]/).pop()}
                </div>
              )}
              <div>
                <strong>{t("speedtest.id_label")}</strong> {file.id}
              </div>
            </div>
          )}
        </>
      )}
        </div>
      </div>
      <DriveConfirmDialog state={confirmDlg} onClose={() => setConfirmDlg(null)} />
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {node}
      {singlePreviewFile && (
        <DrivePreviewModal
          file={singlePreviewFile}
          folderId={singlePreviewFile.folder_id ?? folderId}
          creds={creds}
          folders={folders}
          chats={chats}
          onClose={() => setSinglePreviewFile(null)}
          initialFullscreen
        />
      )}
    </>,
    document.body
  );
}
