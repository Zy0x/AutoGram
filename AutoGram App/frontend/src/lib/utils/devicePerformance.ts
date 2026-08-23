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
  // Default to 'mid' (Mode Standar) as requested by user
  return 'mid';
}

function buildProfile(tier: PerfTier): DrivePerfProfile {
  const { fastNet } = readHw();
  if (tier === 'low') {
    return {
      tier: 'low',
      filePage: 24,
      loadMorePage: 48,
      chatPage: 32,
      chatSoftPrefetchMax: 96,
      defaultThumbQuality: 'saver', // stripped inline — like Telegram grid
      defaultGridZoom: 1,
      statsDelayMs: 4000,
      fullMediaStats: false,
      thumbBatch: 20,
      thumbFlushMs: 8,
      thumbQueueMax: 100,
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
      label: 'Mode Hemat',
    };
  }
  if (tier === 'mid') {
    return {
      tier: 'mid',
      // filePage dikurangi 48 → 28: first-paint lebih sedikit data dari MTProto
      // load-more page tetap besar (80) agar scroll tidak sering request
      filePage: 28,
      loadMorePage: 80,
      chatPage: 40,
      chatSoftPrefetchMax: 120,
      defaultThumbQuality: 'saver',
      defaultGridZoom: 2,
      // statsDelayMs dikurangi 1000 → 400ms (stats badge muncul lebih cepat)
      statsDelayMs: 400,
      fullMediaStats: true,
      // thumbBatch dikurangi 48 → 32: RPC lebih ringan, selesai lebih cepat
      thumbBatch: 32,
      thumbFlushMs: 1,
      thumbQueueMax: 280,
      thumbConcurrent: 4,
      // thumbResumeMs dikurangi 20 → 8ms: thumbnail mulai hampir seketika
      thumbResumeMs: 8,
      thumbPrefetchRows: 5,
      prefetchNextPage: true,
      avatarBatch: 8,
      avatarQueueMax: 32,
      // avatarBootPauseMs dikurangi 300 → 100ms: sidebar avatar muncul cepat
      avatarBootPauseMs: 100,
      folderScanDelayMs: 300,
      thumbSoftFailMs: 1_000,
      fastNet,
      label: 'Mode Standar (Default)',
    };
  }
  // HIGH — maximize throughput for fast devices / networks
  const turbo = fastNet;
  return {
    tier: 'high',
    filePage: turbo ? 120 : 96,
    loadMorePage: turbo ? 240 : 160,
    chatPage: turbo ? 120 : 80,
    chatSoftPrefetchMax: turbo ? 600 : 400,
    defaultThumbQuality: 'saver',
    defaultGridZoom: 2,
    statsDelayMs: 250,
    fullMediaStats: true,
    thumbBatch: turbo ? 144 : 96,
    thumbFlushMs: 0,
    thumbQueueMax: turbo ? 1200 : 800,
    thumbConcurrent: turbo ? 8 : 6,
    thumbResumeMs: 0,
    thumbPrefetchRows: turbo ? 16 : 10,
    prefetchNextPage: true,
    avatarBatch: turbo ? 24 : 16,
    avatarQueueMax: turbo ? 96 : 64,
    avatarBootPauseMs: turbo ? 0 : 30,
    folderScanDelayMs: 0,
    thumbSoftFailMs: 600,
    fastNet: turbo,
    label: turbo ? 'Mode Turbo (Maksimal Extreme)' : 'Mode Performa Tinggi',
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
