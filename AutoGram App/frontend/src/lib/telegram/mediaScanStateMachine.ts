/**
 * Media Scan State Machine & Terminal Verification Engine (AutoGram v2.7.0).
 * Manages exact state transitions, composite scope keys, terminal pagination verification,
 * and accurate server vs local index counter formatting.
 */

export type MediaScanStatus =
  | 'idle'
  | 'loading'
  | 'partial'
  | 'retrying'
  | 'rate_limited'
  | 'offline'
  | 'interrupted'
  | 'complete_verified'
  | 'stale'
  | 'error';

export interface MediaScanScope {
  accountId: string;
  peerId: string;
  topicId: number;
  mediaFilter: string;
  searchQuery: string;
}

export interface MediaScanMetrics {
  serverTotalCount: number | null;
  serverCountExact: boolean;
  serverCountInexact: boolean;
  offsetIdOffset: number | null;

  indexedUniqueCount: number;
  rawFetchedCount: number;
  duplicateCount: number;

  indexedBytes: bigint;
  knownSizeCount: number;
  unknownSizeCount: number;

  failedPageCount: number;
  pendingPageCount: number;

  nextOffsetId: number | null;
  lastSuccessfulOffsetId: number | null;

  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  retryAfterAt: number | null;

  scanGeneration: number;
  completionVerifiedAt: number | null;

  lastErrorClass: string | null;
  lastErrorMessage: string | null;
}

export interface MediaScanState extends MediaScanScope, MediaScanMetrics {
  status: MediaScanStatus;
}

/** Composite scope key string: account_id:peer_id:topic_id:filter:query */
export function buildMediaScanScopeKey(scope: MediaScanScope): string {
  const account = scope.accountId || 'unscoped';
  const peer = scope.peerId || 'me';
  const topic = scope.topicId ?? 0;
  const filter = scope.mediaFilter || 'all';
  const query = (scope.searchQuery || '').trim().toLowerCase();
  return `${account}:${peer}:${topic}:${filter}:${query}`;
}

export function createInitialScanState(scope: MediaScanScope): MediaScanState {
  return {
    ...scope,
    status: 'idle',
    serverTotalCount: null,
    serverCountExact: false,
    serverCountInexact: false,
    offsetIdOffset: null,

    indexedUniqueCount: 0,
    rawFetchedCount: 0,
    duplicateCount: 0,

    indexedBytes: 0n,
    knownSizeCount: 0,
    unknownSizeCount: 0,

    failedPageCount: 0,
    pendingPageCount: 0,

    nextOffsetId: null,
    lastSuccessfulOffsetId: null,

    lastSuccessAt: null,
    lastAttemptAt: null,
    retryAfterAt: null,

    scanGeneration: 1,
    completionVerifiedAt: null,

    lastErrorClass: null,
    lastErrorMessage: null,
  };
}

/**
 * Validates whether a scan page result meets strict terminal completion rules.
 * Rule: complete_verified MUST ONLY be set if:
 * 1. Request succeeded matching active scanGeneration.
 * 2. No FloodWait, no network error, no timeout.
 * 3. No failed pages, no pending requests, no cursor gap.
 * 4. Terminal condition:
 *    a) Raw server fetch returned messages.length === 0
 *    OR
 *    b) serverTotalCount is exact AND indexedUniqueCount >= serverTotalCount with no gaps.
 */
export function verifyTerminalCompletion(opts: {
  isSuccess: boolean;
  requestGeneration: number;
  activeGeneration: number;
  hasFloodWait: boolean;
  hasTimeoutOrNetworkError: boolean;
  failedPageCount: number;
  pendingPageCount: number;
  hasCursorGap: boolean;
  rawFetchedPageLength: number;
  serverTotalCount: number | null;
  serverCountExact: boolean;
  indexedUniqueCount: number;
  isCancelled?: boolean;
}): { isCompleteVerified: boolean; terminalReason: string | null } {
  if (!opts.isSuccess) {
    return { isCompleteVerified: false, terminalReason: 'request_failed' };
  }
  if (opts.requestGeneration !== opts.activeGeneration) {
    return { isCompleteVerified: false, terminalReason: 'generation_changed' };
  }
  if (opts.isCancelled) {
    return { isCompleteVerified: false, terminalReason: 'cancelled' };
  }
  if (opts.hasFloodWait) {
    return { isCompleteVerified: false, terminalReason: 'flood_wait' };
  }
  if (opts.hasTimeoutOrNetworkError) {
    return { isCompleteVerified: false, terminalReason: 'network_timeout' };
  }
  if (opts.failedPageCount > 0) {
    return { isCompleteVerified: false, terminalReason: 'failed_pages_exist' };
  }
  if (opts.pendingPageCount > 0) {
    return { isCompleteVerified: false, terminalReason: 'pending_pages_exist' };
  }
  if (opts.hasCursorGap) {
    return { isCompleteVerified: false, terminalReason: 'cursor_gap_detected' };
  }

  // Strong Terminal Condition A: Raw MTProto response is empty (0 items)
  if (opts.rawFetchedPageLength === 0) {
    return { isCompleteVerified: true, terminalReason: 'empty_server_page' };
  }

  // Strong Terminal Condition B: Exact total count reached
  if (
    opts.serverCountExact &&
    opts.serverTotalCount != null &&
    opts.serverTotalCount > 0 &&
    opts.indexedUniqueCount >= opts.serverTotalCount
  ) {
    return { isCompleteVerified: true, terminalReason: 'exact_total_reached_without_gap' };
  }

  return { isCompleteVerified: false, terminalReason: null };
}

/**
 * Format indexed byte size according to Section B7 rules:
 * - While scanning/incomplete: "90,13 GB terindeks" or "90,13 GB+"
 * - Complete verified + unknownSizeCount > 0: "Setidaknya 298,85 GB"
 * - Complete verified + unknownSizeCount === 0: "298,85 GB"
 */
export function formatMediaTotalSize(state: MediaScanState, formatBytesFn: (b: number) => string): string {
  const bytesNum = Number(state.indexedBytes);
  const formatted = formatBytesFn(bytesNum);

  if (state.status === 'complete_verified') {
    if (state.unknownSizeCount > 0) {
      return `Setidaknya ${formatted}`;
    }
    return formatted;
  }

  return `${formatted} terindeks`;
}

/**
 * Format UI status display according to Section B8 rules.
 */
export function formatMediaScanHeaderInfo(
  state: MediaScanState,
  formatBytesFn: (b: number) => string,
  now = Date.now()
): {
  countText: string;
  sizeText: string;
  statusText: string;
  canResume: boolean;
  isComplete: boolean;
} {
  const isComplete = state.status === 'complete_verified';
  const sizeText = formatMediaTotalSize(state, formatBytesFn);

  // Count text formatting
  let countText = `${state.indexedUniqueCount.toLocaleString('id-ID')} media`;
  if (state.serverTotalCount != null && state.serverTotalCount > 0) {
    if (state.serverCountExact) {
      countText = `${state.indexedUniqueCount.toLocaleString('id-ID')} / ${state.serverTotalCount.toLocaleString('id-ID')} media`;
    } else {
      countText = `${state.indexedUniqueCount.toLocaleString('id-ID')} / sekitar ${state.serverTotalCount.toLocaleString('id-ID')} media`;
    }
  }

  let statusText = '';
  let canResume = false;

  switch (state.status) {
    case 'loading':
      statusText = 'Memuat halaman berikutnya…';
      break;
    case 'partial':
      statusText = 'Sinkronisasi berjalan…';
      break;
    case 'retrying':
      statusText = 'Mencoba ulang koneksi…';
      break;
    case 'rate_limited': {
      const waitSecs = state.retryAfterAt
        ? Math.max(0, Math.ceil((state.retryAfterAt - now) / 1000))
        : 0;
      statusText = waitSecs > 0 ? `Dijeda Telegram selama ${waitSecs} detik` : 'Dijeda Telegram';
      break;
    }
    case 'offline':
      statusText = 'Koneksi terputus. Progres tersimpan.';
      canResume = true;
      break;
    case 'interrupted':
      statusText = 'Sinkronisasi belum selesai';
      canResume = true;
      break;
    case 'complete_verified':
      statusText = 'Semua media terverifikasi';
      break;
    case 'stale':
      statusText = 'Pembaruan tersedia (perlu rekonsiliasi)';
      canResume = true;
      break;
    case 'error':
      statusText = state.lastErrorMessage || 'Gagal menyinkronkan media';
      canResume = true;
      break;
    case 'idle':
    default:
      statusText = 'Siap menyinkronkan';
      break;
  }

  return {
    countText,
    sizeText,
    statusText,
    canResume,
    isComplete,
  };
}
