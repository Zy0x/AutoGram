import type { StreamQualityFormat } from '../../types';
import type { TikTokMetadata, TikTokAudioStatus, TikTokMuteReason } from './types';
import { positiveNumber } from './types';

const COPYRIGHT_MUTED_PATTERN = /(?:sound removed|copyright|audio removed|audio unavailable|sound unavailable|music removed|suara dihapus|hak cipta)/i;
const GEO_RESTRICTED_PATTERN = /(?:not available in your region|geo-restricted|country restriction|wilayah)/i;

/**
 * Inspects TikTok media audio metadata to determine whether:
 * 1. The video contains an active audio track.
 * 2. The audio track is the creator's original sound or external catalog music.
 * 3. The audio has been muted/removed by TikTok (copyright violation, region restriction, or silent track).
 */
export function inspectTikTokAudio(data: Partial<TikTokMetadata>): TikTokAudioStatus {
  const musicInfo = data.music_info;
  const musicUrl = data.music?.trim() || musicInfo?.play?.trim();
  const rawTitle = musicInfo?.title?.trim() || '';

  // 1. Detect copyright muting or audio removal
  let isMuted = false;
  let muteReason: TikTokMuteReason | undefined;

  if (musicInfo?.status === 0) {
    isMuted = true;
    muteReason = 'disabled';
  } else if (COPYRIGHT_MUTED_PATTERN.test(rawTitle)) {
    isMuted = true;
    muteReason = 'copyright';
  } else if (GEO_RESTRICTED_PATTERN.test(rawTitle)) {
    isMuted = true;
    muteReason = 'geo_restricted';
  } else if (!musicUrl && !data.music) {
    // When TikTok provides zero music fields, the post was uploaded completely silent or audio was purged
    isMuted = true;
    muteReason = 'empty';
  }

  // 2. Resolve clean audio URL
  let resolvedAudioUrl: string | undefined;
  if (musicUrl && !isMuted) {
    resolvedAudioUrl = musicUrl.startsWith('http') ? musicUrl : `https://www.tikwm.com${musicUrl}`;
  }

  // 3. Determine if this is an original sound
  const isExplicitOriginal = musicInfo?.original === true;
  const isOriginalTitle = /^original sound/i.test(rawTitle) || /^suara asli/i.test(rawTitle);
  const authorMatch = data.author?.nickname && musicInfo?.author
    ? data.author.nickname.toLowerCase() === musicInfo.author.toLowerCase()
    : false;
  const isOriginalSound = isExplicitOriginal || isOriginalTitle || authorMatch;

  // 4. Extract measured audio parameters
  const audioBitrate = positiveNumber(musicInfo?.bitrate || musicInfo?.bit_rate || data.music_bitrate);
  const sampleRate = positiveNumber(musicInfo?.sample_rate);
  const audioChannels = positiveNumber(musicInfo?.channels);

  const audioAuthor = musicInfo?.author?.trim() || data.author?.nickname;
  const audioTitle = rawTitle || (data.title ? `${data.title} (Audio Track)` : 'Original Audio');

  return {
    hasAudio: !isMuted && !!resolvedAudioUrl,
    isOriginalSound,
    isMuted,
    muteReason,
    audioUrl: resolvedAudioUrl,
    audioBitrate,
    audioTitle,
    audioAuthor,
    sampleRate,
    audioChannels,
    canMux: !isMuted && Boolean(resolvedAudioUrl),
  };
}

/**
 * Handles pairing and remuxing when a TikTok video stream is video-only (acodec none)
 * or when audio restoration is required from the companion TikTok sound track.
 */
export function attachTikTokMuxIfSilent(
  videoFormat: StreamQualityFormat,
  audioFormat: StreamQualityFormat | undefined,
  audioStatus: TikTokAudioStatus
): void {
  // A. If audio was completely removed by TikTok (copyright/region block)
  if (audioStatus.isMuted) {
    const badgeReason = audioStatus.muteReason === 'copyright'
      ? 'MUTED (COPYRIGHT)'
      : audioStatus.muteReason === 'geo_restricted'
        ? 'MUTED (GEO-BLOCKED)'
        : 'MUTED';
    videoFormat.badge = badgeReason;
    videoFormat.verification = {
      status: 'wrapper',
      sourceUrl: videoFormat.directUrl,
      reason: audioStatus.muteReason === 'copyright'
        ? 'Audio was removed by TikTok due to copyright restrictions'
        : audioStatus.muteReason === 'geo_restricted'
          ? 'Audio is unavailable in this region due to licensing restrictions'
          : 'Video has no audio stream',
    };
    return;
  }

  // B. If video format is flagged as video-only or needs companion audio muxing
  if (audioFormat && audioFormat.directUrl && videoFormat.directUrl && videoFormat.downloadOnly) {
    videoFormat.mux = {
      videoUrl: videoFormat.directUrl,
      audioUrl: audioFormat.directUrl,
      outputExt: 'mp4',
      videoFormatId: videoFormat.id,
      audioFormatId: audioFormat.id,
      videoSizeBytes: videoFormat.filesizeBytes,
      audioSizeBytes: audioFormat.filesizeBytes,
      estimatedSizeBytes: videoFormat.filesizeBytes && audioFormat.filesizeBytes
        ? videoFormat.filesizeBytes + audioFormat.filesizeBytes
        : videoFormat.filesizeBytes,
      expectedHeight: videoFormat.height,
      expectedDurationSec: videoFormat.durationSec,
    };
    videoFormat.badge = 'AUDIO RESTORED';
  }
}
