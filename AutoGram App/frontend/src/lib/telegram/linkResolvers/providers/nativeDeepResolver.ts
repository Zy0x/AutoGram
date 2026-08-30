import { invoke } from '@tauri-apps/api/core';
import i18n from 'i18next';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

type NativeCandidate = {
  url: string;
  kind: string;
  mimeType?: string | null;
  contentLength?: number | null;
};

type NativeResolution = {
  sourceUrl: string;
  finalUrl: string;
  platformName: string;
  title: string;
  mimeType?: string | null;
  contentLength?: number | null;
  candidates: NativeCandidate[];
  requiresInteraction: boolean;
  inspectedPages: number;
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

function toFormat(candidate: NativeCandidate, index: number): StreamQualityFormat {
  const ext = normalizeExt(candidate.kind, candidate.url);
  const mime = String(candidate.mimeType || '').toLowerCase();
  const isVideo = mime.startsWith('video/') || ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'm3u8', 'mpd'].includes(ext);
  const isAudio = mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac'].includes(ext);
  const isImage = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext);
  return {
    id: `native_deep_${index}`,
    label: String(i18n.t('drive.remote_native_candidate', { index: index + 1 })),
    qualityTier: 'original',
    ext,
    directUrl: candidate.url,
    filesizeBytes: candidate.contentLength ?? undefined,
    isVideo,
    isAudio,
    isImage,
    badge: String(i18n.t('drive.remote_native_badge')),
  };
}

/**
 * Desktop-native resolver: avoids WebView CORS, follows ordinary redirects,
 * and performs a bounded HTML/metadata traversal in Rust. It intentionally
 * does not automate CAPTCHAs, ads, logins, DRM, or membership gates.
 */
export const nativeDeepResolver: LinkResolverProvider = {
  name: 'NativeDeepResolver',
  platform: 'direct',
  canHandle(url: string): boolean {
    return detectTauriRuntime() && /^https?:\/\//i.test(url.trim());
  },
  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    if (!this.canHandle(url) || signal?.aborted) return null;
    const result = await invoke<NativeResolution>('resolve_remote_link_deep', { url: url.trim() });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const formats = (result.candidates || []).map(toFormat);
    if (formats.length === 0) return null;
    return {
      url: result.sourceUrl,
      platform: 'direct',
      platformName: result.platformName,
      title: result.title || result.platformName,
      description: String(i18n.t('drive.remote_native_inspected', { count: result.inspectedPages })),
      formats,
      selectedFormatId: formats[0].id,
      isDirectFile: true,
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
