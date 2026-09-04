import { invoke } from '@tauri-apps/api/core';
import i18n from 'i18next';
import { detectTauriRuntime } from '../../../tauri/platform';
import type {
  LinkResolverProvider,
  MediaVerification,
  ResolvedMediaInfo,
  ResolveOptions,
  StreamQualityFormat,
} from '../types';

type NativeCandidate = {
  url: string;
  sourceUrl?: string;
  parentUrl?: string | null;
  redirectChain?: string[];
  title?: string;
  kind: string;
  mimeType?: string | null;
  contentLength?: number | null;
  verified: boolean;
  validation?: string;
  isDownloadable?: boolean;
  isStreamable?: boolean;
  downloadOnly?: boolean;
};

type NativeResolution = {
  sourceUrl: string;
  finalUrl: string;
  platformName: string;
  title: string;
  candidates: NativeCandidate[];
  requiresInteraction: boolean;
  inspectedPages: number;
  discoveryCursor?: unknown;
  discoveryComplete?: boolean;
  pendingCount?: number;
  warnings?: string[];
  blockerReason?: string | null;
};

function normalizeExt(kind: string, url: string): string {
  const clean = String(kind || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean && clean !== 'file') return clean;
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return String(ext || 'bin').toLowerCase();
  } catch {
    return 'bin';
  }
}

function verificationFor(candidate: NativeCandidate): MediaVerification {
  return {
    status: candidate.verified ? 'verified' : 'unverified',
    sourceUrl: candidate.sourceUrl,
    parentUrl: candidate.parentUrl || undefined,
    redirectChain: candidate.redirectChain,
    mimeType: candidate.mimeType || undefined,
    contentLength: candidate.contentLength ?? undefined,
    validation: candidate.validation,
    rangeSupported: candidate.validation?.includes('range') || undefined,
  };
}

function toFormat(candidate: NativeCandidate, index: number): StreamQualityFormat | null {
  // This guard prevents a future backend regression from recreating fake cards.
  if (!candidate.verified || !candidate.url) return null;
  const ext = normalizeExt(candidate.kind, candidate.url);
  const mime = String(candidate.mimeType || '').toLowerCase();
  const isVideo = mime.startsWith('video/') || ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'm3u8', 'mpd'].includes(ext);
  const isAudio = mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac'].includes(ext);
  const isImage = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext);
  const isSubtitle = ['srt', 'vtt', 'ass', 'ssa'].includes(ext) || /(?:text\/vtt|application\/x-subrip)/.test(mime);
  return {
    id: `native_deep_${index}_${encodeURIComponent(candidate.url).slice(-24)}`,
    label: candidate.title?.trim() || String(i18n.t('drive.remote_native_candidate', { index: index + 1 })),
    customTitle: candidate.title?.trim(),
    qualityTier: isSubtitle ? 'subtitle' : isAudio ? 'audio' : 'original',
    ext,
    directUrl: candidate.url,
    headers: candidate.parentUrl ? { Referer: candidate.parentUrl } : undefined,
    filesizeBytes: candidate.contentLength ?? undefined,
    isVideo,
    isAudio,
    isImage,
    isSubtitle,
    isDownloadable: candidate.isDownloadable !== false,
    isStreamable: candidate.isStreamable === true,
    downloadOnly: candidate.downloadOnly === true,
    badge: String(i18n.t('drive.remote_native_badge')),
    verification: verificationFor(candidate),
  };
}

/**
 * Desktop-native public crawler. The Rust command follows only public URLs
 * and emits media after range/content fingerprint validation. A cursor is
 * safe-to-round-trip state and never contains browser session material.
 */
export const nativeDeepResolver: LinkResolverProvider = {
  name: 'NativeDeepResolver',
  platform: 'direct',
  canHandle(url: string): boolean {
    return detectTauriRuntime() && /^https?:\/\//i.test(url.trim());
  },
  async resolve(url: string, signal?: AbortSignal, options?: ResolveOptions): Promise<ResolvedMediaInfo | null> {
    if (!this.canHandle(url) || signal?.aborted) return null;
    const result = await invoke<NativeResolution>('resolve_remote_link_deep', {
      url: url.trim(),
      cursor: options?.discoveryCursor,
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const formats = (result.candidates || [])
      .map(toFormat)
      .filter((format): format is StreamQualityFormat => format !== null);

    return {
      url: result.sourceUrl,
      platform: 'direct',
      platformName: result.platformName,
      title: result.title || result.platformName,
      description: result.requiresInteraction
        ? String(i18n.t('drive.remote_native_interaction_required'))
      : String(i18n.t('drive.remote_native_inspected', { count: result.inspectedPages })),
      formats,
      selectedFormatId: formats[0]?.id || '',
      totalItems: formats.length,
      isDirectFile: formats.length > 0,
      discovery: {
        cursor: result.discoveryCursor,
        complete: result.discoveryComplete !== false,
        pendingCount: result.pendingCount || 0,
        inspectedPages: result.inspectedPages,
        warnings: result.warnings || [],
        blockerReason: result.blockerReason || undefined,
      },
      resolutionTrace: {
        resolverName: this.name,
        sourceUrl: result.sourceUrl,
        finalUrl: result.finalUrl,
        inspectedPages: result.inspectedPages,
        candidateCount: formats.length,
        securityStatus: 'validated',
        stages: ['analyze', 'resolve', 'discover', 'validate', 'ready'],
      },
      resolvedAt: Date.now(),
    };
  },
};
