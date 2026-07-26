/**
 * Auto device performance profile for Media Studio / Drive.
 * Low-end: protect against force-close / Not Responding.
 * High-end / fast network: maximize card + thumbnail throughput.
 */

export type PerfTier = 'low' | 'mid' | 'high';

export type DrivePerfProfile = {
  tier: PerfTier;
  /** First file page size */
  filePage: number;
  /** Load-more page size */
  loadMorePage: number;
  /** First chat sidebar page */
  chatPage: number;
  /** Soft auto-prefetch max chats (0 = off) */
  chatSoftPrefetchMax: number;
  /** Default thumb quality when user has no preference */
  defaultThumbQuality: 'saver' | 'balanced' | 'sharp';
  /** Default grid zoom index */
  defaultGridZoom: number;
  /** Delay before media_stats full walk (ms) */
  statsDelayMs: number;
  /** Run full unique media_stats walk */
  fullMediaStats: boolean;
  /** Thumb batch size per RPC */
  thumbBatch: number;
  /** Thumb flush interval (ms) — lower = snappier grid fill */
  thumbFlushMs: number;
  /** Max thumb queue depth */
  thumbQueueMax: number;
  /** Parallel in-flight thumb batches (frontend) */
  thumbConcurrent: number;
  /** Resume thumbs after list paint (ms) */
  thumbResumeMs: number;
  /** Prefetch thumbs for N rows beyond viewport */
  thumbPrefetchRows: number;
  /** Prefetch next file page when near scroll end (high only) */
  prefetchNextPage: boolean;
  /** Avatar batch */
  avatarBatch: number;
  /** Avatar max queue */
  avatarQueueMax: number;
  /** Pause avatars during boot longer (ms) */
  avatarBootPauseMs: number;
  /** Defer full folder scan after files (ms) */
  folderScanDelayMs: number;
  /** Soft-fail window for thumbs (ms) */
  thumbSoftFailMs: number;
  /** Fast network boost applied */
  fastNet: boolean;
  label: string;
};

let cached: DrivePerfProfile | null = null;
let overrideTier: PerfTier | null = null;

/** WebView2 often omits deviceMemory; an unknown desktop is not a 4 GB device. */
export function normalizedDeviceMemoryGb(
  reported: number | undefined,
  mobile: boolean
): number {
  const value = Number(reported || 0);
  return Number.isFinite(value) && value > 0 ? value : mobile ? 4 : 8;
}

function readHw(): {
  cores: number;
  memGb: number;
  saveData: boolean;
  reducedMotion: boolean;
  mobile: boolean;
  fastNet: boolean;
} {
  if (typeof navigator === 'undefined') {
    return { cores: 8, memGb: 8, saveData: false, reducedMotion: false, mobile: false, fastNet: true };
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
  };
  const cores = Number(nav.hardwareConcurrency || 4) || 4;
  const saveData = !!nav.connection?.saveData;
  const et = nav.connection?.effectiveType || '';
  const slowNet = et === '2g' || et === 'slow-2g' || et === '3g';
  const downlink = Number(nav.connection?.downlink || 0) || 0;
  // 4g / unknown / downlink >= 5 Mbps → treat as fast enough to maximize
  const fastNet = !saveData && !slowNet && (et === '4g' || et === '' || downlink >= 5);
  let reducedMotion = false;
  try {
    reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    /* ignore */
  }
  let mobile = false;
  try {
    mobile =
      /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') ||
      !!window.matchMedia?.('(pointer: coarse)')?.matches;
  } catch {
    /* ignore */
  }
  const memGb = normalizedDeviceMemoryGb(nav.deviceMemory, mobile);
  return {
    cores,
    memGb,
    saveData: saveData || slowNet,
    reducedMotion,
    mobile,
    fastNet,
  };
}

function detectTier(): PerfTier {
  if (overrideTier) return overrideTier;
  try {
    const forced = localStorage.getItem('autogram_perf_tier');
    if (forced === 'low' || forced === 'mid' || forced === 'high') return forced;
  } catch {
    /* ignore */
  }
  const { cores, memGb, saveData, mobile, fastNet } = readHw();
  if (saveData || cores <= 4 || memGb <= 4 || (mobile && cores <= 6)) {
    return 'low';
  }
  // Desktop / strong laptop + fast net → full turbo
  if (!mobile && cores >= 6 && memGb >= 6 && fastNet) {
    return 'high';
  }
  if (cores <= 6 || memGb <= 6 || mobile) {
    return 'mid';
  }
  return 'high';
}

function buildProfile(tier: PerfTier): DrivePerfProfile {
  const { fastNet } = readHw();
  if (tier === 'low') {
    return {
      tier: 'low',
      filePage: 20,
      loadMorePage: 40,
      chatPage: 32,
      chatSoftPrefetchMax: 96,
      defaultThumbQuality: 'saver', // stripped inline — like Telegram grid
      defaultGridZoom: 1,
      statsDelayMs: 4000,
      fullMediaStats: false,
      thumbBatch: 16,
      thumbFlushMs: 8,
      thumbQueueMax: 80,
      thumbConcurrent: 2,
      thumbResumeMs: 80,
      thumbPrefetchRows: 2,
      prefetchNextPage: false,
      avatarBatch: 4,
      avatarQueueMax: 16,
      avatarBootPauseMs: 800,
      folderScanDelayMs: 2500,
      thumbSoftFailMs: 1_800,
      fastNet: false,
      label: 'Mode Hemat (otomatis — perangkat terbatas)',
    };
  }
  if (tier === 'mid') {
    return {
      tier: 'mid',
      filePage: 40,
      loadMorePage: 80,
      chatPage: 48,
      chatSoftPrefetchMax: 200,
      defaultThumbQuality: 'saver',
      defaultGridZoom: 2,
      statsDelayMs: 1000,
      fullMediaStats: true,
      thumbBatch: 40,
      thumbFlushMs: 2,
      thumbQueueMax: 240,
      thumbConcurrent: 2,
      thumbResumeMs: 20,
      thumbPrefetchRows: 5,
      prefetchNextPage: true,
      avatarBatch: 8,
      avatarQueueMax: 32,
      avatarBootPauseMs: 300,
      folderScanDelayMs: 500,
      thumbSoftFailMs: 1_200,
      fastNet,
      label: 'Mode Seimbang',
    };
  }
  // HIGH — maximize throughput for fast devices / networks
  const turbo = fastNet;
  return {
    tier: 'high',
    filePage: turbo ? 64 : 48,
    loadMorePage: turbo ? 120 : 100,
    chatPage: turbo ? 80 : 56,
    chatSoftPrefetchMax: turbo ? 400 : 250,
    // Saver = stripped thumbs from message metadata (Telegram-app feel).
    // Balanced/jelas download larger layers and stall the grid.
    defaultThumbQuality: 'saver',
    defaultGridZoom: 2,
    statsDelayMs: 350,
    fullMediaStats: true,
    thumbBatch: turbo ? 96 : 72,
    thumbFlushMs: turbo ? 0 : 0,
    thumbQueueMax: turbo ? 600 : 400,
    thumbConcurrent: 2,
    thumbResumeMs: 0,
    thumbPrefetchRows: turbo ? 10 : 6,
    prefetchNextPage: true,
    avatarBatch: turbo ? 14 : 10,
    avatarQueueMax: turbo ? 56 : 40,
    avatarBootPauseMs: turbo ? 40 : 80,
    folderScanDelayMs: 0,
    thumbSoftFailMs: 800,
    fastNet: turbo,
    label: turbo ? 'Mode Turbo (koneksi cepat)' : 'Mode Penuh',
  };
}

/** Current Drive performance profile (cached until invalidate). */
export function getDrivePerfProfile(): DrivePerfProfile {
  if (!cached) {
    cached = buildProfile(detectTier());
  }
  return cached;
}

export function isLowEndDevice(): boolean {
  return getDrivePerfProfile().tier === 'low';
}

export function isHighPerfDevice(): boolean {
  return getDrivePerfProfile().tier === 'high';
}

/** Force tier for QA: 'low' | 'mid' | 'high' | null (auto). Persists. */
export function setPerfTierOverride(tier: PerfTier | null): void {
  overrideTier = tier;
  cached = null;
  try {
    if (tier) localStorage.setItem('autogram_perf_tier', tier);
    else localStorage.removeItem('autogram_perf_tier');
  } catch {
    /* ignore */
  }
}

export function invalidatePerfProfileCache(): void {
  cached = null;
}

/** Human status snippet for UI */
export function perfStatusHint(): string | null {
  const p = getDrivePerfProfile();
  if (p.tier === 'low') return p.label;
  if (p.tier === 'high' && p.fastNet) return p.label;
  return null;
}
