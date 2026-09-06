import { describe, expect, it } from 'vitest';
import { attachYouTubeMuxCandidates } from './muxCandidates';
import { processYtDlpData } from '../youtubeResolver';
import { isManifestTransport } from '../../transportPolicy';
import { canTransferResolvedFormat } from '../../../../../features/remote-upload/domain';
import type { StreamQualityFormat, RawStreamItem } from '../../types';

describe('manifest and assembled output contracts', () => {
  it.each(['m3u8', 'm3u8_native', 'http_dash_segments', 'dash', 'hls'])('blocks %s even with extensionless URL', protocol => {
    expect(isManifestTransport({ protocol, directUrl: 'https://example.com/videoplayback?x=dash', ext: 'mp4' })).toBe(true);
  });
  it('does not classify signed query strings as a transport', () => {
    expect(isManifestTransport({ protocol: 'https', directUrl: 'https://example.com/video?signature=hls-dash' })).toBe(false);
  });
  it('offers explicit 2160p MP4 conversion only from a concrete video/audio pair', () => {
    const formats: StreamQualityFormat[] = [
      { id: 'v', label: '2160p', ext: 'webm', codec: 'vp9', height: 2160, qualityTier: '4k', isVideo: true, isStreamable: false, directUrl: 'https://example.com/video', filesizeBytes: 9000000 },
      { id: 'a', label: 'audio', ext: 'm4a', qualityTier: 'audio', isAudio: true, directUrl: 'https://example.com/audio' },
    ];
    attachYouTubeMuxCandidates(formats);
    attachYouTubeMuxCandidates(formats);
    const assembled = formats.filter(f => f.mux?.transcodeVideo);
    expect(assembled).toHaveLength(1);
    expect(assembled[0]).toMatchObject({ ext: 'mp4', height: 2160, directUrl: 'https://example.com/video', isStreamable: false });
    expect(assembled[0].filesizeBytes).toBeUndefined();
    expect(formats[0].mux?.estimatedSizeBytes).toBeUndefined();
  });
  it('does not expose native HLS as a 32 MB direct MP4 candidate', () => {
    const formats: StreamQualityFormat[] = [];
    const raw: RawStreamItem[] = [];
    processYtDlpData({ formats: [{ format_id: 'hls', ext: 'mp4', vcodec: 'avc1', acodec: 'aac', height: 2160, filesize: 32000000, protocol: 'm3u8_native', url: 'https://example.com/manifest' }] }, formats, [], raw);
    expect(formats).toHaveLength(0);
    expect(raw[0].isDownloadable).toBe(false);
    expect(canTransferResolvedFormat({ id: 'raw', label: '', ext: 'mp4', qualityTier: '4k', protocol: 'm3u8_native', directUrl: raw[0].directUrl })).toBe(false);
  });
});
