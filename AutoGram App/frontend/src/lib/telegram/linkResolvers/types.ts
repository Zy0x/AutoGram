/**
 * Smart Link Resolver Core Types
 * Defines interfaces for modular platform resolvers, stream formats, and extracted media metadata.
 */

export type PlatformKind =
  | 'youtube'
  | 'tiktok'
  | 'gdrive'
  | 'dropbox'
  | 'mediafire'
  | 'terabox'
  | 'pinterest'
  | 'pixiv'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'direct';

export type QualityTier = '8k' | '4k' | '2k' | '1080p' | '720p' | '480p' | '360p' | 'audio' | 'original';

export interface StreamQualityFormat {
  id: string;
  label: string;
  qualityTier: QualityTier;
  resolution?: string; // e.g. "4320p", "2160p", "1080p", "720p", "320 kbps"
  fps?: number;
  filesizeBytes?: number;
  ext: string; // e.g. "mp4", "webm", "mp3", "m4a", "jpg", "png", "zip"
  directUrl: string;
  headers?: Record<string, string>;
  isCleanNoWatermark?: boolean;
  isVideo?: boolean;
  isAudio?: boolean;
  isImage?: boolean;
  badge?: string; // e.g. "8K ULTRA", "4K UHD", "NO WATERMARK", "320 KBPS"
}

export interface ResolvedMediaInfo {
  url: string;
  platform: PlatformKind;
  platformName: string;
  title: string;
  author?: string;
  authorAvatar?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  description?: string;
  formats: StreamQualityFormat[];
  selectedFormatId: string;
  isDirectFile?: boolean;
  requiresHeaders?: boolean;
  customHeaders?: Record<string, string>;
  resolvedAt: number;
}

export interface LinkResolverProvider {
  readonly name: string;
  readonly platform: PlatformKind;
  canHandle(url: string): boolean;
  resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null>;
}
