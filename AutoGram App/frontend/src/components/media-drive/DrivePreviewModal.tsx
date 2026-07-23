import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
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
  PictureInPicture2,
  RefreshCw,
  Info,
  ExternalLink,
  AppWindow,
  FolderOpen,
  FileText,
  Copy,
  Printer,
  Repeat,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../lib/platform';
import { registerPreviewOpen, registerPreviewClose } from '../../lib/driveSession';

import type { DriveCredentials } from '../../lib/driveApi';
import {
  cancelDriveOpenJob,
  cleanupPartialDownloads,
  driveDownload,
  driveStopStream,
  driveStreamSeek,
  driveStreamStatus,
} from '../../lib/driveApi';
import { cacheCapturedThumb, getCachedThumb, setThumbsPaused } from '../../lib/thumbBatcher';
import {
  getCachedPreview,
  invalidatePreview,
  loadPreviewCached,
  prefetchPreviews,
  type CachedPreview,
} from '../../lib/previewCache';
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
  type DriveFile,
} from '../../lib/driveTypes';
import { DriveZipBrowser } from './DriveZipBrowser';
import {
  ensureLocalDocument,
  openDriveFileInSystem,
  openDriveFileWithApp,
  openInSystem,
  revealInFolder,
} from '../../lib/documentOpen';
import { isDesktop } from '../../lib/platform';
import { DriveConfirmDialog, type DriveConfirmState } from './DriveConfirmDialog';

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

/** Fallback Telegram-style menu when backend returns a thin list */
const DEFAULT_VIDEO_QUALITIES: PlayQuality[] = [
  {
    id: 'auto',
    label: 'Otomatis',
    description: 'Stream progressive (default)',
    native: true,
    recommended: true,
  },
  {
    id: 'original',
    label: 'Asli',
    description: 'Resolusi penuh dari Telegram',
    native: true,
  },
  {
    id: 'p720',
    label: '720p',
    description: 'HD · konversi lokal',
    height: 720,
    transcode: true,
  },
  {
    id: 'p480',
    label: '480p',
    description: 'SD · hemat data',
    height: 480,
    transcode: true,
  },
  {
    id: 'p360',
    label: '360p',
    description: 'Data saver',
    height: 360,
    transcode: true,
  },
];

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
  return /\.stream\./i.test(path) || /\.stream$/i.test(path);
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
  if (/^auto/i.test(idS) || /^otomatis$/i.test(s)) return 'Otomatis';
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

function pointerIdMatches(a: number, b: number): boolean {
  return a === b;
}

let globalStreamTeardownGen = 0;
let activeMountGen = 0;

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
}: Props) {
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
                '../../lib/driveSession'
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [mediaWidth, setMediaWidth] = useState<number | null>(null);
  const [mediaHeight, setMediaHeight] = useState<number | null>(null);

  // Video tools
  const [playbackRate, setPlaybackRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loopVideo, setLoopVideo] = useState(() => {
    try {
      return localStorage.getItem('drive.preview.loop') === '1';
    } catch {
      return false;
    }
  });
  /** First decoded frame — avoid pure-black stage while stream/moov boots */
  const [hasVideoFrame, setHasVideoFrame] = useState(false);
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
  const isVideoCapturedRef = useRef(false);

  // Reset captured flag when file changes
  useEffect(() => {
    isVideoCapturedRef.current = false;
  }, [file?.id]);

  const captureVideoFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || !file || isAudioDriveFile(file) || isVideoCapturedRef.current) return;
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeAtRef = useRef<number>(0);
  const qualityMenuRef = useRef<HTMLDivElement | null>(null);
  const rateMenuRef = useRef<HTMLDivElement | null>(null);
  const qualityBtnRef = useRef<HTMLButtonElement | null>(null);
  const rateBtnRef = useRef<HTMLButtonElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Fixed-position popovers (avoid toolbar overflow clipping) */
  const [qualityMenuPos, setQualityMenuPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const [rateMenuPos, setRateMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
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
  const [prevFileId, setPrevFileId] = useState(file.id);

  if (file.id !== prevFileId) {
    setPrevFileId(file.id);
    setDataUrl(null);
    setPath(null);
    setStreamUrl(null);
    setStreamId(null);
    setMime(null);
    setPoster(null);
    setError(null);
    setSrcOverride(null);
    setLoading(true);
    setHasVideoFrame(false);
    setTextBody(null);
    setPreviewKind(null);
    setBufferPct(0);
    setStreamDone(false);
    setPlayerHint(null);
    setSeekWarn(null);
  }

  const durationLabel = formatDriveDuration(driveFileDurationSeconds(file));
  const kindLabel = formatDriveKindLabel(file);
  const displayName = driveFileDisplayName(file);
  const gridThumb = useMemo(() => {
    const t = getCachedThumb(folderId, file.id);
    return typeof t === 'string' ? t : null;
  }, [folderId, file.id]);

  const activeQuality = useMemo(() => {
    const list = qualities.length >= 2 ? qualities : DEFAULT_VIDEO_QUALITIES;
    const hit =
      list.find((q) => q.id === quality) || list.find((q) => q.recommended) || list[0] || null;
    if (!hit) return null;
    return {
      ...hit,
      label: sanitizeQualityLabel(hit.label, hit.id, hit.height),
    };
  }, [qualities, quality]);

  const resetViewTools = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPan({ x: 0, y: 0 });
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setIsDragging(false);
    dragRef.current = null;
    setShowInfo(false);
    setPlaybackRate(1);
    setMuted(false);
  }, []);

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
      setMediaWidth(res.video_width || null);
      setMediaHeight(res.video_height || null);
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
        setPlayerHint(res.message || 'Streaming…');
      }
      setLoading(false);
      setSwitchingQuality(false);
      if (!usable && !res.too_large) {
        setError(res.message || 'Pratinjau kosong — coba Muat ulang atau Download.');
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
        // Prefetch neighbors ASAP (next/prev feels instant) - skip if current file is a video to prioritize bandwidth
        const ids = neighborIds.filter((id) => id && id !== file.id).slice(0, 5);
        if (ids.length && !isVideoDriveFile(file)) prefetchPreviews(creds, folderId, ids, qNorm);

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
          isHttpStreamUrl(hit.stream_url)
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
        setPlayerHint(isVideoDriveFile(file) ? 'Menyiapkan stream…' : 'Memuat…');
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

      try {
        const res = await loadPreviewCached(creds, file.id, folderId, qNorm, {
          force,
        });
        if (mountGenRef.current !== activeMountGen) return;
        if (seq !== loadSeq.current) return;
        applyResult(res, qNorm, false);

        // Never prefetch neighbors for video — steals GetFile from the open player.
        const ids = neighborIds.filter((id) => id && id !== file.id).slice(0, 2);
        if (ids.length && !isVideoDriveFile(file)) prefetchPreviews(creds, folderId, ids, qNorm);
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
              ? 'Koneksi Telegram putus saat memuat pratinjau. Klik Coba lagi — Drive akan menyambung ulang.'
              : raw || 'Gagal memuat pratinjau'
          );
          setLoading(false);
        }
        setSwitchingQuality(false);
      }
    },
    [applyResult, creds, file.id, folderId, gridThumb, neighborIds]
  );

  // Load when file / folder changes
  useEffect(() => {
    resetViewTools();
    setMediaWidth(null);
    setMediaHeight(null);
    streamRecoverRef.current = false;
    streamMissingHitsRef.current = 0;
    mediaErrorCountRef.current = 0;
    mediaErrorRecoverAtRef.current = 0;
    nativeStreamReadyRef.current = false;
    liveStreamIdRef.current = null;
    lastSeekKickRef.current = 0;
    hasUserPlayRef.current = false;
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
  }, [file.id, folderId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const prevStreamForNav = useRef<string | null>(null);
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
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    if (!streamId || streamDone) return;
    let alive = true;
    let intervalMs = 600; // cold start
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
        // Prefer playable prefix % (what <video> can start with). Never artificially
        // cap at 35% — that hid multi-MB heads as "stuck low" in the UI.
        let displayPct = Math.max(pct, browserPct);
        if (!Number.isFinite(displayPct) || displayPct < 0) displayPct = 0;
        setBufferPct(Math.min(100, Math.round(displayPct)));

        // If pipeline was paused (autoplay→pause race), resume while user is on preview
        if (st.paused === true && streamUrl && streamId && hasUserPlayRef.current === false) {
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
        const wantMs = healthy ? 1500 : 400;
        if (wantMs !== intervalMs) schedule(wantMs);

        if (st.status === 'done' || (total > 0 && prefix >= total * 0.98)) {
          streamMissingHitsRef.current = 0;
          setStreamDone(true);
          setBufferPct(100);
          setPlayerHint(null);
          setSeekWarn(null);
        } else if (st.status === 'missing' || st.status === 'cancelled') {
          streamMissingHitsRef.current += 1;
          const playingOk =
            !!v &&
            !v.error &&
            (browserHasData || v.readyState >= 2 || (!v.paused && v.currentTime > 0.2));
          if (playingOk) {
            setPlayerHint((h) => h || 'Buffering…');
          } else if (streamMissingHitsRef.current >= 2) {
            // Automatic resume: force re-RPC so native stream re-establishes (reuses disk
            // partial + continues GetFile). Do not invalidate cache thrash.
            streamMissingHitsRef.current = 0;
            liveStreamIdRef.current = null;
            setPlayerHint('Melanjutkan unduhan stream…');
            window.setTimeout(() => {
              if (mountGenRef.current !== activeMountGen) return;
              loadPreviewRef.current(quality, { soft: true, force: true });
            }, 500);
          } else if (streamMissingHitsRef.current >= 1) {
            setPlayerHint('Melanjutkan stream…');
          }
        } else {
          streamMissingHitsRef.current = 0;
        }
        if (st.status === 'error') setHint(st.error || 'Stream error');

        // Aggressive first-play nudge (≤900ms). Screenshot case: frame+duration ready
        // but stuck on "Buffering… menunggu data stream" after MEDIA_ERR during fill.
        const now = Date.now();
        const streamReady =
          st.stream_ready === true ||
          browserHasData ||
          (!!v && v.readyState >= 2) ||
          (!!v && Number.isFinite(v.duration) && v.duration > 0 && browserHasData);
        nativeStreamReadyRef.current = st.stream_ready === true;
        if (
          v &&
          v.paused &&
          !v.ended &&
          !seekWarnRef.current &&
          streamReady &&
          now - playNudgeAtRef.current > 900
        ) {
          const nearEnd =
            Number.isFinite(v.duration) &&
            v.duration > 0 &&
            v.currentTime >= v.duration - 0.35;
          if (!nearEnd) {
            playNudgeAtRef.current = now;
            // Media error freezes the element — rebind same URL once to clear error
            if (v.error && streamUrl && isHttpStreamUrl(streamUrl)) {
              const t = v.currentTime || 0;
              try {
                const sticky = streamUrl;
                v.removeAttribute('src');
                v.load();
                v.src = sticky;
                if (t > 0.25) {
                  ignoreSeekEventsRef.current += 1;
                  v.currentTime = t;
                }
              } catch {
                /* ignore */
              }
            }
            void v.play().then(() => {
              hasUserPlayRef.current = true;
              setHasVideoFrame(true);
              setPlayerHint(null);
              setLoading(false);
            }).catch(() => undefined);
          }
        }

        if (
          st.seek_capable &&
          st.moov_ready === false &&
          prefix > 0 &&
          filled > prefix + 64 * 1024 &&
          !seekWarnRef.current
        ) {
          setPlayerHint('Menyiapkan metadata…');
        } else if (v && !v.paused && v.readyState >= 2) {
          setPlayerHint(null);
        } else if (
          streamReady &&
          v &&
          v.paused &&
          (browserHasData || v.readyState >= 2 || (Number.isFinite(v.duration) && v.duration > 0))
        ) {
          setPlayerHint((h) =>
            h && /menunggu data stream|Buffering/i.test(h) ? 'Memulai pemutaran…' : h || 'Memulai pemutaran…'
          );
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
    schedule(600);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable poll (refs for loadPreview/seekWarn)
  }, [streamId, streamDone, creds, file.size, file.id, folderId, quality]);

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
    const t = v.currentTime;
    if (!Number.isFinite(t) || t < 0.05) return;

    // Already buffered in the browser — nothing to do
    if (timeInBuffered(v, t, 1.25)) {
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
    const target = t;

    flashSeekWarn('Memuat titik seek…');
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

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (qualityOpen) {
          setQualityOpen(false);
          return;
        }
        if (rateOpen) {
          setRateOpen(false);
          return;
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
          return;
        }
        onClose();
        return;
      }

      // Debounce rapid nav so stream RPC doesn't pile up
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.ctrlKey && !e.metaKey) {
        if (navLock.current) return;
        navLock.current = true;
        window.setTimeout(() => {
          navLock.current = false;
        }, 180);
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
  }, [onClose, onNext, onPrev, hasNext, hasPrev, qualityOpen, rateOpen, file]);

  /** Place fixed menus near trigger — never clipped by toolbar; flip up if near bottom */
  const placeMenuNear = useCallback((btn: HTMLElement | null) => {
    if (!btn || typeof window === 'undefined') return null;
    const r = btn.getBoundingClientRect();
    const width = Math.min(300, Math.max(220, r.width + 80));
    const estH = 280; // typical quality menu height
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    let top: number;
    if (spaceBelow >= Math.min(estH, 160) || spaceBelow >= spaceAbove) {
      top = r.bottom + 6;
    } else {
      // Open upward
      top = Math.max(8, r.top - estH - 6);
    }
    // Keep fully on-screen
    top = Math.max(8, Math.min(top, window.innerHeight - 100));
    return { top, left, width };
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
    if (isImageDriveFile(file) && !isVideoDriveFile(file)) return 'image' as const;
    if (isVideoDriveFile(file) && !isImageDriveFile(file)) return 'video' as const;
    if (isAudioDriveFile(file)) return 'audio' as const;
    if (isPdfDriveFile(file)) return 'pdf' as const;
    if (isTextDriveFile(file)) return 'text' as const;
    if (isZipDriveFile(file)) return 'zip' as const;
    return resolvePreviewKind(file, mime, previewKind);
  }, [file, mime, previewKind]);
  const isVideo = mediaKind === 'video';
  const isImage = mediaKind === 'image';
  const isAudio = mediaKind === 'audio';
  const isPdf = mediaKind === 'pdf';
  const isText = mediaKind === 'text';
  const isZip = mediaKind === 'zip';
  const isDocOther = mediaKind === 'other';

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
    () => buildMediaSrc(streamUrl, dataUrl, path, isImage, { forVideo: isVideo || isAudio }),
    [streamUrl, dataUrl, path, isImage, isVideo, isAudio]
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

  // Load text body — hybrid: Rust local path first, then Python stream/HTTP fallback.
  useEffect(() => {
    if (!isText) {
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
            const { previewLocalDocument } = await import('../../lib/rustBackend');
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
        // 3) HTTP stream (Python media_stream) — fallback only
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
            'Gagal memuat teks. Klik Coba lagi untuk mengunduh ulang dari Telegram.'
          );
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          const msg = String(e?.message || e || 'Gagal membaca teks');
          setError(
            /failed to fetch/i.test(msg)
              ? 'Gagal memuat teks (stream putus). Klik Coba lagi.'
              : msg
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isText, textBody, streamUrl, path, dataUrl, file.name, mime, previewKind]);

  /** Always offer resolution menu for video (Telegram-style) */
  const resolutionOptions =
    qualities.length >= 2 ? qualities : isVideo ? DEFAULT_VIDEO_QUALITIES : qualities;
  const showThumbSkeleton =
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
      await driveDownload(creds, file.id, folderId, savePath);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
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
    setOpenProgressMsg('Menyiapkan…');
    try {
      await openDriveFileInSystem(creds, file, folderId, path, (p) => {
        if (openCancelledRef.current) return;
        setOpenProgressMsg(p.message);
      });
      if (openCancelledRef.current) return;
      setOpenProgressMsg('Dibuka di aplikasi default');
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
    setOpenProgressMsg('Menyiapkan Buka dengan…');
    try {
      await openDriveFileWithApp(creds, file, folderId, path, (p) => {
        if (openCancelledRef.current) return;
        setOpenProgressMsg(p.message);
      });
      if (openCancelledRef.current) return;
      setOpenProgressMsg('Dialog Windows dibuka — pilih aplikasi · tutup dialog untuk kembali');
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
        setOpenProgressMsg('Membuka dialog cetak… · Batal di dialog Windows untuk kembali');
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
      setError('Cetak PDF hanya di aplikasi desktop setelah pratinjau siap.');
      return;
    }
    if (openingSystem) return;
    setOpeningSystem(true);
    setOpenProgressMsg('Menyiapkan PDF untuk cetak…');
    try {
      const local = await ensureLocalDocument(creds, file, folderId, path, (p) => {
        if (openCancelledRef.current) return;
        setOpenProgressMsg(`${p.message} · klik Batal untuk kembali`);
      });
      if (openCancelledRef.current) return;
      setOpenProgressMsg('Membuka PDF — gunakan Cetak di aplikasi, lalu tutup untuk kembali');
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

  const handleReveal = async () => {
    if (!path) {
      setError('File belum diunduh ke cache. Klik Buka dulu.');
      return;
    }
    try {
      await revealInFolder(path);
    } catch (e: any) {
      setError(String(e?.message || e));
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
      const next = clamp(Math.round(nextZoom * 100) / 100, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(next - z) < 0.001) return;

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
    applyZoomAt(zoomRef.current + delta, focalClient ?? null);
  };

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setIsDragging(false);
    dragRef.current = null;
  }, []);

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

  const onWheelStage = (e: React.WheelEvent) => {
    if (!showImage && !showVideo) return;
    // Image + video: mouse wheel zoom (no Ctrl required)
    e.preventDefault();
    e.stopPropagation();
    // Smooth wheel: larger deltas = bigger steps (trackpad friendly)
    const steps = Math.max(1, Math.min(3, Math.round(Math.abs(e.deltaY) / 100)));
    const dir = e.deltaY > 0 ? -ZOOM_STEP * steps : ZOOM_STEP * steps;
    // Zoom toward cursor so pan+zoom-out stays on the point of interest
    zoomBy(dir, { x: e.clientX, y: e.clientY });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!showImage && !showVideo) return;
    // Primary button only (left mouse / touch / pen)
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // Video: never steal native controls (scrubber / volume / play / fullscreen).
    // Hit-test bottom control strip of the video element in screen space.
    if (showVideo) {
      const t = e.target as HTMLElement;
      if (t.closest('video') == null && !t.classList.contains('drive-preview-media-wrap')) {
        return;
      }
      const v = videoRef.current;
      if (v) {
        const rect = v.getBoundingClientRect();
        const controlH = Math.min(64, Math.max(40, rect.height * 0.14));
        if (e.clientY >= rect.bottom - controlH) {
          return; // let browser handle seek / volume
        }
      }
      // Don't pan at 1× — wheel / toolbar zoom only
      if (zoomRef.current <= 1) return;
    }

    // At 1×: no pan — cursor is zoom-in; use wheel / double-click to zoom
    if (zoomRef.current <= 1) return;

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
    // Cancel any half-started drag
    endPanDrag();
    // Not at 100% (zoomed in or out) → reset to default 100%
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
      : zoom > 1.01
        ? 'is-pannable'
        : showImage || showVideo
          ? 'is-zoomable'
          : '';

  /** Shared pan+zoom+rotate for image & video */
  const mediaTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom * (flipH ? -1 : 1)}, ${
    zoom * (flipV ? -1 : 1)
  }) rotate(${rotation}deg)`;

  /** Any non-identity transform — CSS transform on <video> breaks native seek in Chromium/WebView2 */
  const needsMediaTransform =
    Math.abs(zoom - 1) > 0.01 || rotation !== 0 || flipH || flipV || isDragging;

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) {
      flashSeekWarn('Video belum siap untuk Picture-in-Picture.');
      return;
    }
    if (v.readyState < 1) {
      flashSeekWarn('Metadata video belum dimuat. Tunggu sebentar…');
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture();
      } else {
        flashSeekWarn('Picture-in-Picture tidak didukung di lingkungan ini.');
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
        className="drive-preview-modal"
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label="Preview"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drive-preview-header">
          {/* Row A: title + close — title never shares width with icon cluster */}
          <div className="drive-preview-title">
            <strong title={displayName}>{displayName}</strong>
            <span className="drive-muted" title={[
              formatDriveBytes(file.size),
              durationLabel,
              kindLabel,
              isVideo && activeQuality ? activeQuality.label : '',
              fromCache && !loading ? 'cache' : '',
            ].filter(Boolean).join(' · ')}>
              {formatDriveBytes(file.size)}
              {durationLabel ? ` · ${durationLabel}` : ''}
              {kindLabel ? ` · ${kindLabel}` : ''}
              {isVideo && activeQuality ? ` · ${activeQuality.label}` : ''}
              {fromCache && !loading ? ' · cache' : ''}
            </span>
          </div>
          <button
            type="button"
            className="td-icon-btn drive-preview-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
            title="Tutup (Esc)"
          >
            <X size={18} />
          </button>

          {/* Row B: nav — always interactive, above stage */}
          <div
            className="drive-preview-nav"
            role="toolbar"
            aria-label="Navigasi preview"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="td-icon-btn"
              disabled={!hasPrev}
              onClick={(e) => {
                e.stopPropagation();
                onPrev?.();
              }}
              aria-label="Previous"
              title={hasPrev ? 'Sebelumnya (←)' : 'Tidak ada file sebelumnya'}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="td-icon-btn"
              disabled={!hasNext}
              onClick={(e) => {
                e.stopPropagation();
                onNext?.();
              }}
              aria-label="Next"
              title={hasNext ? 'Berikutnya (→)' : 'Tidak ada file berikutnya'}
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
              title="Unduh file ke komputer"
              aria-label="Download"
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
                  title="Buka dengan aplikasi default Windows"
                  aria-label="Buka"
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
                  title="Buka dengan… (pilih aplikasi)"
                  aria-label="Buka dengan"
                >
                  <AppWindow size={16} />
                </button>
                <button
                  type="button"
                  className="td-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleReveal();
                  }}
                  disabled={!path}
                  title={
                    path
                      ? 'Tampilkan di folder (File Explorer)'
                      : 'Folder tersedia setelah file di-cache / dibuka'
                  }
                  aria-label="Reveal"
                >
                  <FolderOpen size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="td-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                void toggleFullscreen();
              }}
              title={isFullscreen ? 'Keluar fullscreen (F)' : 'Fullscreen (F)'}
              aria-label="Fullscreen"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </header>

        {(openingSystem || openProgressMsg) && (
          <div className="drive-open-progress" role="status" aria-live="polite">
            <div className="drive-open-progress-main">
              {openingSystem ? <Loader2 size={14} className="spin" /> : null}
              <span>{openProgressMsg || 'Memproses…'}</span>
            </div>
            <div className="drive-open-progress-actions">
              <button
                type="button"
                className="drive-open-progress-cancel"
                title="Batalkan dan kembali ke pratinjau"
                onClick={dismissOpenProgress}
              >
                Batal
              </button>
              <button
                type="button"
                className="drive-open-progress-cancel is-quiet"
                title="Tutup strip status"
                aria-label="Tutup status"
                onClick={dismissOpenProgress}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Adaptive labeled toolbar — always above stage, never covered */}
        <div
          className={`drive-preview-toolbar is-${mediaKind}${qualityOpen || rateOpen ? ' has-menu' : ''}`}
          role="toolbar"
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
              <div className="drive-tool-group" role="group" aria-label="Zoom">
                <span className="drive-tool-group-label">Zoom</span>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={`Perkecil (min ${Math.round(MIN_ZOOM * 100)}%) — gulir ke bawah atau -`}
                  disabled={zoom <= MIN_ZOOM + 0.001}
                  onClick={() => zoomBy(-ZOOM_STEP)}
                >
                  <ZoomOut size={15} />
                  <span className="drive-tool-btn-label">Kecil</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn drive-tool-btn-value"
                  title="Kembalikan 100% (default) — tombol 0"
                  onClick={resetZoom}
                >
                  <Shrink size={14} />
                  <span className="drive-tool-btn-label strong">{Math.round(zoom * 100)}%</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={`Perbesar (maks ${Math.round(MAX_ZOOM * 100)}%) — gulir ke atas atau +`}
                  disabled={zoom >= MAX_ZOOM - 0.001}
                  onClick={() => zoomBy(ZOOM_STEP)}
                >
                  <ZoomIn size={15} />
                  <span className="drive-tool-btn-label">Besar</span>
                </button>
              </div>
            )}

            {(isImage || isVideo) && (
              <div className="drive-tool-group" role="group" aria-label="Putar">
                <span className="drive-tool-group-label">Putar</span>
                <button
                  type="button"
                  className={`drive-tool-btn${rotation ? ' is-on' : ''}`}
                  title="Putar kiri 90 derajat"
                  onClick={() => setRotation((r) => (r + 270) % 360)}
                >
                  <RotateCcw size={15} />
                  <span className="drive-tool-btn-label">Kiri</span>
                </button>
                <button
                  type="button"
                  className={`drive-tool-btn${rotation ? ' is-on' : ''}`}
                  title="Putar kanan 90 derajat (R)"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                >
                  <RotateCw size={15} />
                  <span className="drive-tool-btn-label">Kanan</span>
                </button>
                <button
                  type="button"
                  className={`drive-tool-btn${flipH ? ' is-on' : ''}`}
                  title="Cermin horizontal (kiri-kanan)"
                  onClick={() => setFlipH((v) => !v)}
                >
                  <FlipHorizontal size={15} />
                  <span className="drive-tool-btn-label">Cermin</span>
                </button>
                <button
                  type="button"
                  className={`drive-tool-btn${flipV ? ' is-on' : ''}`}
                  title="Balik vertikal (atas-bawah)"
                  onClick={() => setFlipV((v) => !v)}
                >
                  <FlipVertical size={15} />
                  <span className="drive-tool-btn-label">Balik</span>
                </button>
              </div>
            )}

            {(isVideo || isAudio) && (
              <div className="drive-tool-group" role="group" aria-label="Pemutaran media">
                <span className="drive-tool-group-label">{isVideo ? 'Video' : 'Audio'}</span>
                {isVideo && (
                  <div className="drive-quality-wrap">
                    <button
                      ref={qualityBtnRef}
                      type="button"
                      className="drive-tool-btn drive-tool-btn-accent"
                      title="Resolusi stream (Otomatis / Asli / 720p…)"
                      onClick={() => {
                        setRateOpen(false);
                        setRateMenuPos(null);
                        setQualityOpen((o) => {
                          const next = !o;
                          if (next) setQualityMenuPos(placeMenuNear(qualityBtnRef.current));
                          else setQualityMenuPos(null);
                          return next;
                        });
                      }}
                      disabled={switchingQuality}
                      aria-expanded={qualityOpen}
                      aria-haspopup="menu"
                      aria-label="Resolusi video"
                    >
                      {switchingQuality ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <Settings2 size={14} />
                      )}
                      <span className="drive-tool-btn-label">
                        {activeResolution?.label || activeQuality?.label || 'Otomatis'}
                      </span>
                    </button>
                  </div>
                )}
                <div className="drive-quality-wrap">
                  <button
                    ref={rateBtnRef}
                    type="button"
                    className="drive-tool-btn drive-tool-btn-value"
                    title="Kecepatan putar (0.5x – 2x)"
                    onClick={() => {
                      setQualityOpen(false);
                      setQualityMenuPos(null);
                      setRateOpen((o) => {
                        const next = !o;
                        if (next) setRateMenuPos(placeMenuNear(rateBtnRef.current));
                        else setRateMenuPos(null);
                        return next;
                      });
                    }}
                    aria-expanded={rateOpen}
                    aria-haspopup="menu"
                    aria-label={`Kecepatan putar: ${playbackRate}x`}
                  >
                    <Gauge size={15} />
                    <span className="drive-tool-btn-label strong">{playbackRate}x</span>
                  </button>
                </div>
                <button
                  type="button"
                  className={`drive-tool-btn${muted ? ' is-on' : ''}`}
                  title={muted ? 'Nyalakan suara (M)' : 'Bisukan suara (M)'}
                  onClick={() => setMuted((m) => !m)}
                >
                  {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  <span className="drive-tool-btn-label">{muted ? 'Mute' : 'Suara'}</span>
                </button>
                <button
                  type="button"
                  className={`drive-tool-btn${loopVideo ? ' is-on' : ''}`}
                  title={
                    loopVideo
                      ? 'Loop aktif — video diputar lagi setelah selesai (klik untuk matikan)'
                      : 'Loop: putar ulang otomatis setelah selesai'
                  }
                  aria-pressed={loopVideo}
                  aria-label={loopVideo ? 'Matikan loop video' : 'Aktifkan loop video'}
                  onClick={() => setLoopVideo((on) => !on)}
                >
                  <Repeat size={15} />
                  <span className="drive-tool-btn-label">Loop</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title="Jendela mini (Picture-in-Picture)"
                  onClick={() => void togglePip()}
                >
                  <PictureInPicture2 size={15} />
                  <span className="drive-tool-btn-label">PiP</span>
                </button>
              </div>
            )}

            {(isPdf || isText || isDocOther) && isDesktop() && (
              <div className="drive-tool-group" role="group" aria-label="Buka dokumen">
                <span className="drive-tool-group-label">Buka</span>
                <button
                  type="button"
                  className="drive-tool-btn drive-tool-btn-accent"
                  title="Buka di aplikasi default"
                  disabled={openingSystem || !creds}
                  onClick={() => void handleOpenSystem()}
                >
                  {openingSystem ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}
                  <span className="drive-tool-btn-label">Aplikasi</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title="Buka dengan aplikasi lain…"
                  disabled={openingSystem || !creds}
                  onClick={() => void handleOpenWith()}
                >
                  <AppWindow size={15} />
                  <span className="drive-tool-btn-label">Dengan…</span>
                </button>
                {isPdf && (
                  <button
                    type="button"
                    className="drive-tool-btn"
                    title="Cetak PDF (dialog Windows punya tombol Batal)"
                    disabled={openingSystem || !creds}
                    onClick={() => void handlePrintPdf()}
                  >
                    <Printer size={15} />
                    <span className="drive-tool-btn-label">Cetak</span>
                  </button>
                )}
                {isText && textBody && (
                  <button
                    type="button"
                    className="drive-tool-btn"
                    title="Salin teks"
                    onClick={() => void handleCopyText()}
                  >
                    <Copy size={15} />
                    <span className="drive-tool-btn-label">Salin</span>
                  </button>
                )}
              </div>
            )}

            <div className="drive-tool-group" role="group" aria-label="Lainnya">
              <span className="drive-tool-group-label">Lain</span>
              <button
                type="button"
                className={`drive-tool-btn${loading ? ' is-loading' : ''}`}
                title="Muat ulang preview dari Telegram"
                disabled={loading}
                onClick={() => {
                  resetViewTools();
                  invalidatePreview(folderId, file.id);
                  setSrcOverride(null);
                  setError(null);
                  setTextBody(null);
                  setHasVideoFrame(false);
                  loadPreview(isVideo ? quality : 'auto', { force: true });
                }}
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
                <span className="drive-tool-btn-label">{loading ? 'Memuat…' : 'Muat'}</span>
              </button>
              <button
                type="button"
                className={`drive-tool-btn${showInfo ? ' is-on' : ''}`}
                title="Tampilkan detail file (I)"
                onClick={() => setShowInfo((v) => !v)}
              >
                <Info size={15} />
                <span className="drive-tool-btn-label">Info</span>
              </button>
            </div>
          </div>
        </div>

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
                top: qualityMenuPos.top,
                left: qualityMenuPos.left,
                width: qualityMenuPos.width,
                zIndex: 10_000,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drive-quality-menu-title">Resolusi</div>
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
                          <span className="drive-quality-tag">disarankan</span>
                        ) : opt.native ? (
                          <span className="drive-quality-tag">Telegram</span>
                        ) : opt.transcode ? (
                          <span className="drive-quality-tag muted">lokal</span>
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
                Otomatis/Asli = stream Telegram. 720p–360p = konversi lokal bila sumber lebih tinggi.
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
                top: rateMenuPos.top,
                left: rateMenuPos.left,
                width: rateMenuPos.width,
                zIndex: 10_000,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drive-quality-menu-title">Kecepatan putar</div>
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
                    <strong>{r}x</strong>
                    <span className="drive-muted">
                      {r === 1 ? 'Normal' : r < 1 ? 'Lebih lambat' : 'Lebih cepat'}
                    </span>
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )}

        <div
          className="drive-preview-body"
          ref={stageRef}
          onWheel={onWheelStage}
        >
          {loading && !showThumbSkeleton && !mediaSrc && !textBody && !pdfSrc && !isZip && (
            <div className="drive-empty">
              <Loader2 className="spin" size={28} />
              <p>
                {switchingQuality
                  ? `Mengganti ke ${activeQuality?.label || quality}…`
                  : isPdf || isText
                    ? 'Mengunduh dokumen…'
                    : /^(p720|p480|p360)/i.test(quality)
                      ? `Menyiapkan ${quality.replace(/^p/i, '')}p…`
                      : 'Menyiapkan stream…'}
              </p>
              <p className="drive-muted" style={{ fontSize: 12 }}>
                {isPdf || isText
                  ? 'Pratinjau on-demand — file diunduh hanya saat dibuka'
                  : 'Next/prev memakai cache & prefetch agar lebih cepat'}
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="drive-empty drive-error">
              <p>{error}</p>
              {floodCountdown !== null && floodCountdown > 0 && (
                <p className="drive-muted" style={{ fontSize: '0.85rem', marginTop: 4, color: '#eab308' }}>
                  ⏳ Mencoba lagi otomatis dalam <strong>{floodCountdown}</strong> detik…
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
                        '../../lib/driveSession'
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
                {floodCountdown !== null ? 'Coba lagi sekarang' : 'Coba lagi'}
              </button>
              {isDesktop() && (
                <button
                  type="button"
                  className="td-btn-primary"
                  onClick={handleOpenSystem}
                  disabled={openingSystem || !creds}
                >
                  <ExternalLink size={14} /> Buka di aplikasi
                </button>
              )}
              <button type="button" className="td-btn-primary" onClick={handleDownload} disabled={saving}>
                <Download size={14} /> Download saja
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
                <Loader2 size={14} className="spin" /> Memuat…
              </div>
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
              <img
                key={`${file.id}-${srcOverride || 'primary'}`}
                src={activeSrc!}
                alt={displayName}
                className="drive-preview-media drive-preview-img"
                draggable={false}
                style={{
                  transform: mediaTransform,
                  transformOrigin: 'center center',
                  pointerEvents: 'none', // all gestures on wrap — avoids img eating events
                }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setMediaWidth(img.naturalWidth);
                  setMediaHeight(img.naturalHeight);
                  setLoading(false);
                  setError(null);
                }}
                onError={() => {
                  if (!tryNextSrc()) {
                    setError('Gagal menampilkan gambar. Coba Download atau buka ulang.');
                  }
                }}
              />
              {loading && (
                <div className="drive-preview-loading-chip">
                  <Loader2 size={14} className="spin" /> Memuat full…
                </div>
              )}
            </div>
          )}

          {!error && showVideo && (
            <div
              className={`drive-preview-media-wrap ${mediaCursorClass}${
                needsMediaTransform ? ' is-transformed' : ''
              }`}
              style={{
                overflow: 'hidden',
                // Transform the wrap, never the <video> node — otherwise WebView2
                // misaligns native control hit-testing and seek/scrub stops working.
                ...(needsMediaTransform
                  ? { transform: mediaTransform, transformOrigin: 'center center' }
                  : undefined),
              }}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUpLocal}
              onPointerCancel={onPointerUpLocal}
              onDoubleClick={(e) => {
                // Don't zoom when double-clicking control chrome
                const v = videoRef.current;
                if (v) {
                  const rect = v.getBoundingClientRect();
                  const controlH = Math.min(64, Math.max(40, rect.height * 0.14));
                  if (e.clientY >= rect.bottom - controlH) return;
                }
                if ((e.target as HTMLElement).closest('video')) {
                  onImageDoubleClick(e);
                }
              }}
              onWheel={(e) => {
                onWheelStage(e);
              }}
            >
              {/* Poster under video until first frame — avoids pure black stage */}
              {!hasVideoFrame && (poster || gridThumb) && (
                <img
                  src={poster || gridThumb || ''}
                  alt=""
                  className="drive-preview-video-poster-fallback"
                  draggable={false}
                />
              )}
              <video
                ref={videoRef}
                // Stable key: remount only on file/quality — never on stream URL
                // churn (that was restarting buffer load in a loop).
                key={`vid-${file.id}-${quality}`}
                src={activeSrc!}
                poster={poster || gridThumb || undefined}
                controls
                playsInline
                autoPlay
                loop={loopVideo}
                preload="auto"
                className={`drive-preview-media drive-preview-video${
                  hasVideoFrame ? ' is-ready' : ' is-booting'
                }`}
                style={{
                  // Identity only — transforms live on the wrap (see above)
                  transform: 'none',
                  transformOrigin: 'center center',
                }}
                onLoadedMetadata={() => {
                  const v = videoRef.current;
                  const t = resumeAtRef.current;
                  if (v) {
                    v.playbackRate = playbackRate;
                    v.muted = muted;
                    v.loop = loopVideo;
                    setMediaWidth(v.videoWidth);
                    setMediaHeight(v.videoHeight);
                  }
                  if (v && t > 0.5 && Number.isFinite(v.duration) && t < v.duration) {
                    try {
                      // Resume time — do not treat as user scrub
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
                }}
                onCanPlay={() => {
                  setHasVideoFrame(true);
                  setLoading(false);
                }}
                onSeeking={() => {
                  if (ignoreSeekEventsRef.current > 0) return;
                  // Mark + kick early: seeked may never fire until Range data exists
                  userSeekPendingRef.current = true;
                  handleSeekJump();
                }}
                onSeeked={() => {
                  if (ignoreSeekEventsRef.current > 0) {
                    ignoreSeekEventsRef.current -= 1;
                    userSeekPendingRef.current = false;
                    return;
                  }
                  // Confirm after scrub settles (debounced kick may already be in flight)
                  userSeekPendingRef.current = true;
                  handleSeekJump();
                }}
                onEnded={() => {
                  // Fallback if browser ignores loop attribute on some progressive streams
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
                    setPlayerHint('Buffering…');
                  }
                }}
                onPlay={() => {
                  handlePlay();
                }}
                onPause={() => {
                  handlePause();
                }}
                onPlaying={() => {
                  setHasVideoFrame(true);
                  setLoading(false);
                  handlePlay();
                  if (seekWarn && seekWarn.startsWith('Memuat')) {
                    setSeekWarn(null);
                  }
                  if (!seekWarn && streamUrl && !streamDone) setPlayerHint(null);
                  else if (!streamUrl || streamDone) setPlayerHint(null);
                }}
                onStalled={() => {
                  if (streamUrl && !streamDone && !seekWarn) {
                    setPlayerHint('Menunggu data…');
                    // Stalled with data available — re-kick playback
                    const v = videoRef.current;
                    if (v && v.paused && v.readyState >= 2) {
                      void v.play().catch(() => undefined);
                    }
                  }
                }}
                onError={(e) => {
                  const mediaErr = videoRef.current?.error || (e.target as HTMLVideoElement)?.error;
                  if (mediaErr && mediaErr.code === 1) {
                    return; // MEDIA_ERR_ABORTED is not a failure
                  }
                  // Progressive buffer hole / 503: do NOT tear down the stream.
                  // WebView2 often fires MEDIA_ERR_NETWORK while fill catches up;
                  // full reload restarts GetFile. Clear error by rebinding same URL.
                  const progressiveFilling = !!streamUrl && !streamDone;
                  if (progressiveFilling) {
                    mediaErrorCountRef.current += 1;
                    const v = videoRef.current;
                    const n = mediaErrorCountRef.current;
                    // First few errors: soft rebind same src (clears MEDIA_ERR sticky state)
                    if (v && streamUrl && nativeStreamReadyRef.current && n <= 2) {
                      setPlayerHint('Buffering… menyambung putar');
                      const t = v.currentTime || 0;
                      const sticky = streamUrl;
                      window.setTimeout(() => {
                        const vv = videoRef.current;
                        if (!vv || mountGenRef.current !== activeMountGen) return;
                        try {
                          if (vv.error) {
                            vv.removeAttribute('src');
                            vv.load();
                            vv.src = sticky;
                            if (t > 0.25) {
                              ignoreSeekEventsRef.current += 1;
                              vv.currentTime = t;
                            }
                          }
                          void vv.play().then(() => {
                            hasUserPlayRef.current = true;
                            setPlayerHint(null);
                          }).catch(() => undefined);
                        } catch {
                          /* ignore */
                        }
                      }, 350);
                      return;
                    }
                    setPlayerHint(
                      nativeStreamReadyRef.current
                        ? 'Buffering… menunggu data stream'
                        : 'Menyiapkan metadata dan buffer awal…'
                    );
                    // NEVER force-reload progressive fill from onError thrash.
                    // force loadPreview cancelled the live GetFile pipeline and
                    // left registry entries cancelled=true with frozen buffer %.
                    if (mediaErrorCountRef.current >= 12) {
                      setPlayerHint('Buffer lambat — coba tombol Play, atau Muat ulang');
                    }
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
                    setPlayerHint('Menyambung stream…');
                    window.setTimeout(() => {
                      loadPreview(quality, { soft: false, force: true });
                    }, 800);
                    return;
                  }
                  if (!loading) {
                    setError('Gagal memutar media. Coba kualitas lain atau Download.');
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
                            activeQuality ? ` · ${activeQuality.label}` : ''
                          }`}
                  </span>
                </div>
              )}
              {loading && (
                <div className="drive-preview-loading-chip">
                  <Loader2 size={14} className="spin" /> Stream…
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
                    Pratinjau 30 Detik (Hemat Kuota)
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
                      Transcode Penuh
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
                      Buka File Asli
                    </button>
                  </div>
                </div>
              )}
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
              <style>{`
                @keyframes spin {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }
                .drive-audio-disk-container.is-playing {
                  animation: spin 12s linear infinite;
                }
              `}</style>
              
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
                    setPlayerHint('Buffering…');
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
                    setPlayerHint('Menunggu data…');
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
                    setPlayerHint('Buffering… menunggu data stream');
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
                    setPlayerHint('Menyambung stream…');
                    window.setTimeout(() => {
                      loadPreview(quality, { soft: false, force: true });
                    }, 800);
                    return;
                  }
                  if (!loading) {
                    setError('Gagal memutar audio. Coba Download.');
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
              <p>Mengunduh PDF lengkap…</p>
              {bufferPct > 0 && (
                <p className="field-hint">Buffer {bufferPct}%</p>
              )}
            </div>
          )}
          {isPdf && !pdfSrc && !loading && (
            <div className="drive-empty">
              <FileText size={40} className="td-type-ico doc" />
              <p>
                {tooLarge
                  ? hint || 'PDF terlalu besar untuk pratinjau.'
                  : error ||
                    'PDF belum siap. Coba lagi atau buka di aplikasi sistem.'}
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
                  <RefreshCw size={14} /> Coba lagi
                </button>
                {isDesktop() && (
                  <button type="button" className="td-btn-primary" onClick={handleOpenSystem} disabled={openingSystem || !creds}>
                    <ExternalLink size={14} /> Buka
                  </button>
                )}
                <button type="button" className="td-btn-primary" onClick={handleDownload} disabled={saving}>
                  <Download size={14} /> Download
                </button>
              </div>
            </div>
          )}

          {/* Text / JSON viewer */}
          {isText && textBody != null && (
            <div className="drive-preview-doc drive-preview-text">
              <pre className="drive-preview-text-pre">{textBody}</pre>
            </div>
          )}
          {isText && textBody == null && !loading && !error && (
            <div className="drive-empty">
              <FileText size={40} className="td-type-ico doc" />
              <p>Teks belum termuat. Coba lagi.</p>
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
                <RefreshCw size={14} /> Coba lagi
              </button>
            </div>
          )}

          {/* Lightweight ZIP browser (list-only + single-entry extract) */}
          {isZip && creds && (
            <div className="drive-preview-doc drive-preview-zip">
              <DriveZipBrowser
                creds={creds}
                messageId={file.id}
                folderId={folderId}
                archiveName={displayName}
              />
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
                  ? 'Office document — buka dengan aplikasi Windows (Word/Excel/…).'
                  : hint ||
                    (tooLarge
                      ? 'File besar — gunakan Download atau Buka di aplikasi.'
                      : 'Pratinjau penuh tidak tersedia di app. Buka dengan aplikasi sistem.')}
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
                      <ExternalLink size={14} /> Buka
                    </button>
                    <button
                      type="button"
                      className="td-btn-primary"
                      onClick={handleOpenWith}
                      disabled={openingSystem || !creds}
                    >
                      <AppWindow size={14} /> Buka dengan…
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
                  <RefreshCw size={14} /> Coba lagi
                </button>
                <button type="button" className="td-btn-primary" onClick={handleDownload} disabled={saving}>
                  <Download size={14} /> Download file
                </button>
              </div>
            </div>
          )}

          {showInfo && (
            <div
              className="drive-preview-info"
              role="dialog"
              aria-label="Detail file"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drive-preview-info-head">
                <strong className="drive-preview-info-title">Detail file</strong>
                <button
                  type="button"
                  className="td-icon-btn drive-preview-info-close"
                  title="Tutup info"
                  aria-label="Tutup info"
                  onClick={() => setShowInfo(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <div>
                <strong>Nama</strong> {displayName}
              </div>
              {file.original_name && file.original_name !== displayName && (
                <div title={file.original_name}>
                  <strong>Nama asli</strong> {file.original_name}
                </div>
              )}
              {mediaWidth && mediaHeight && (
                <div>
                  <strong>Dimensi</strong> {mediaWidth} × {mediaHeight} px
                </div>
              )}
              <div>
                <strong>Ukuran</strong> {formatDriveBytes(file.size)}
              </div>
              {durationLabel && (
                <div>
                  <strong>Durasi</strong> {durationLabel}
                </div>
              )}
              <div>
                <strong>Tipe</strong> {kindLabel || file.icon_type}
              </div>
              {mime && (
                <div>
                  <strong>MIME</strong> {mime}
                </div>
              )}
              {file.created_at && (
                <div>
                  <strong>Tanggal</strong> {new Date(file.created_at).toLocaleString('id-ID', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
              )}
              <div>
                <strong>Pengiriman</strong> {file.as_document ? 'Dokumen/File (Asli)' : 'Media Native (Kompresi)'}
              </div>
              {isVideo && (
                <div>
                  <strong>Kualitas</strong> {activeQuality?.label || quality}
                </div>
              )}
              {(isImage || isVideo) && (
                <div>
                  <strong>Zoom</strong> {Math.round(zoom * 100)}%
                  {rotation ? ` · putar ${rotation}°` : ''}
                  {flipH ? ' · cermin' : ''}
                  {flipV ? ' · balik' : ''}
                </div>
              )}
              {streamUrl && (
                <div>
                  <strong>Mode</strong> progressive stream
                </div>
              )}
              {path && (
                <div title={path}>
                  <strong>Cache</strong> {path.split(/[/\\]/).pop()}
                </div>
              )}
              <div>
                <strong>ID</strong> {file.id}
              </div>
            </div>
          )}
        </div>
      </div>
      <DriveConfirmDialog state={confirmDlg} onClose={() => setConfirmDlg(null)} />
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
