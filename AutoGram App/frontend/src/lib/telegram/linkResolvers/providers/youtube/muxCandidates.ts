import type { StreamQualityFormat } from '../../types';
import { isManifestTransport } from '../../transportPolicy';

const direct = (format: StreamQualityFormat) => /^https?:\/\//i.test(format.directUrl)
  && !isManifestTransport(format) && format.isDownloadable !== false;

/** Pair only real direct objects. Assembled MP4 is a distinct output, not a fake URL. */
export function attachYouTubeMuxCandidates(formats: StreamQualityFormat[]): void {
  const audio = formats.filter(f => f.isAudio && !f.isSubtitle && direct(f));
  for (const video of [...formats]) {
    if (!video.isVideo || video.isAudio || video.mux || video.isStreamable !== false || !direct(video)) continue;
    if (!['mp4', 'webm'].includes(video.ext)) continue;
    const companion = [...audio].sort((a, b) => {
      const preferred = video.ext === 'mp4' ? ['m4a', 'mp4', 'aac'] : ['webm', 'opus'];
      return Number(preferred.includes(b.ext)) - Number(preferred.includes(a.ext))
        || (b.audioBitrate || b.bitrate || 0) - (a.audioBitrate || a.bitrate || 0);
    })[0];
    if (!companion) continue;
    video.mux = {
      videoUrl: video.directUrl, audioUrl: companion.directUrl,
      outputExt: video.ext as 'mp4' | 'webm',
      videoFormatId: video.id, audioFormatId: companion.id,
      videoSizeBytes: video.filesizeBytes, audioSizeBytes: companion.filesizeBytes,
      estimatedSizeBytes: video.filesizeBytes && companion.filesizeBytes
        ? video.filesizeBytes + companion.filesizeBytes : undefined,
      expectedHeight: video.height, expectedDurationSec: video.durationSec,
    };
    video.downloadOnly = true;
    // MP4 is a container, not a guarantee of H.264 compatibility. This explicit
    // local conversion retains resolution and creates H.264/AAC with FFmpeg.
    const nativeH264 = video.ext === 'mp4' && /^(avc|h\.?264)/i.test(video.codec || '');
    // Do not silently relabel HDR as SDR: that requires a separate tone-map
    // policy. Native HDR downloads stay intact; compatibility MP4 uses SDR.
    if (!nativeH264 && !video.isHdr && !formats.some(f => f.id === `${video.id}_mp4_assembled`)) {
      formats.push({ ...video, id: `${video.id}_mp4_assembled`, ext: 'mp4', container: 'mp4',
        label: `${video.height ? `${video.height}p` : video.resolution || ''} (MP4 · FFmpeg)`,
        codec: 'h264', filesizeBytes: undefined, protocol: 'ffmpeg',
        mux: { ...video.mux, outputExt: 'mp4', transcodeVideo: true, estimatedSizeBytes: undefined },
      });
    }
  }
}
