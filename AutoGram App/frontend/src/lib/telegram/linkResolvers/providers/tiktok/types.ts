import type { QualityTier } from '../../types';

export interface TikTokAuthor {
  id?: string;
  unique_id?: string;
  nickname?: string;
  avatar?: string;
  avatar_medium?: string;
  avatar_larger?: string;
  signature?: string;
}

export interface TikTokMusicInfo {
  id?: string;
  title?: string;
  play?: string;
  author?: string;
  original?: boolean;
  duration?: number;
  album?: string;
  bitrate?: number;
  bit_rate?: number;
  sample_rate?: number;
  channels?: number;
  status?: number;
}

export interface TikTokMetadata {
  id?: string;
  region?: string;
  title?: string;
  content_desc?: string;
  cover?: string;
  origin_cover?: string;
  ai_dynamic_cover?: string;
  duration?: number;
  play?: string;
  wmplay?: string;
  hdplay?: string;
  size?: number;
  wm_size?: number;
  hd_size?: number;
  music?: string;
  music_info?: TikTokMusicInfo;
  music_bitrate?: number;
  images?: string[];
  width?: number;
  height?: number;
  fps?: number;
  author?: TikTokAuthor;
  is_ad?: boolean;
  create_time?: number;
}

export interface TikTokProfile {
  uniqueId: string;
  nickname?: string;
  avatarLarger?: string;
  avatarMedium?: string;
  signature?: string;
}

export type TikTokMuteReason = 'copyright' | 'geo_restricted' | 'empty' | 'disabled';

export interface TikTokAudioStatus {
  /** True if video has native sound or audio track is playable */
  hasAudio: boolean;
  /** True if the sound is creator's original audio track */
  isOriginalSound: boolean;
  /** True if sound was muted or taken down by TikTok */
  isMuted: boolean;
  /** Explanatory mute reason if detected */
  muteReason?: TikTokMuteReason;
  /** Direct audio stream URL if available */
  audioUrl?: string;
  /** Audio bitrate in bps */
  audioBitrate?: number;
  /** Clean audio track title */
  audioTitle?: string;
  /** Audio creator or artist */
  audioAuthor?: string;
  sampleRate?: number;
  audioChannels?: number;
  /** True if video is silent/video-only and can be paired with audio track */
  canMux: boolean;
}

export function qualityTierForMeasuredHeight(height?: number): QualityTier {
  if (!height) return 'original';
  if (height >= 4320) return '8k';
  if (height >= 2160) return '4k';
  if (height >= 1440) return '2k';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  if (height >= 240) return '240p';
  if (height >= 144) return '144p';
  return 'original';
}

export function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
