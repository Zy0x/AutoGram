import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractYouTubeVideoId, processYtDlpData, youtubeResolver } from './youtubeResolver';
import type { RawStreamItem, StreamQualityFormat, SubtitleTrackItem } from '../types';

describe('youtubeResolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('identifies valid YouTube URLs', () => {
    expect(youtubeResolver.canHandle('https://www.youtube.com/watch?v=DLfZ9YbpBN0')).toBe(true);
    expect(youtubeResolver.canHandle('https://youtu.be/tYARyQLq8RU')).toBe(true);
    expect(youtubeResolver.canHandle('https://youtube.com/shorts/abcdef12345')).toBe(true);
    expect(youtubeResolver.canHandle('https://vimeo.com/123456')).toBe(false);
  });

  it('correctly extracts video IDs from various URL formats', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=DLfZ9YbpBN0')).toBe('DLfZ9YbpBN0');
    expect(extractYouTubeVideoId('https://youtu.be/tYARyQLq8RU?si=test1234')).toBe('tYARyQLq8RU');
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/DLfZ9YbpBN0')).toBe('DLfZ9YbpBN0');
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/DLfZ9YbpBN0')).toBe('DLfZ9YbpBN0');
  });

  it('resolves formats dynamically based on video capability', async () => {
    const playerResponse = {
      videoDetails: {
        title: 'Fixture video',
        author: 'Fixture channel',
        lengthSeconds: '120',
        thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/tYARyQLq8RU/hqdefault.jpg' }] },
      },
      streamingData: {
        formats: [
          {
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            qualityLabel: '360p',
            width: 640,
            height: 360,
            fps: 30,
            bitrate: 800000,
            contentLength: '1000',
            url: 'https://video.googlevideo.com/videoplayback?itag=18',
          },
        ],
        adaptiveFormats: [
          {
            itag: 140,
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            audioQuality: 'AUDIO_QUALITY_MEDIUM',
            audioSampleRate: '44100',
            audioChannels: 2,
            bitrate: 128000,
            contentLength: '2000',
            url: 'https://audio.googlevideo.com/videoplayback?itag=140',
          },
        ],
      },
    };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = String(input);
      if (requestUrl.includes('/youtubei/v1/player')) {
        return { ok: true, json: async () => playerResponse } as Response;
      }
      return { ok: true, text: async () => '<html><title>Fixture video - YouTube</title></html>' } as Response;
    }));

    const result = await youtubeResolver.resolve('https://www.youtube.com/watch?v=tYARyQLq8RU');
    expect(result).toBeDefined();
    expect(result?.platform).toBe('youtube');
    expect(result?.formats.length).toBeGreaterThanOrEqual(2);
    const formatIds = result?.formats.map((f) => f.id) || [];
    // Never manufacture 1080p/720p cards from the title when YouTube blocks
    // the player request. Every returned card must point at a concrete stream.
    expect(formatIds.some((id) => id === 'yt_1080p' || id === 'yt_720p')).toBe(false);
    expect(result?.formats.every((f) => /^https?:\/\//.test(f.directUrl))).toBe(true);
    expect(result?.formats.every((f) => !f.directUrl.includes('/watch?v=') && !f.directUrl.includes('youtu.be/'))).toBe(true);
    expect(result?.formats.some((f) => f.isAudio || f.isVideo)).toBe(true);
  });

  it('maps yt-dlp direct formats without exposing manifests as downloadable files', () => {
    const formats: StreamQualityFormat[] = [];
    const rawStreams: RawStreamItem[] = [];
    const subtitles: SubtitleTrackItem[] = [];
    const metadata = processYtDlpData({
      title: 'Fixture 4K',
      duration: 90,
      formats: [
        {
          format_id: '337',
          format_note: '2160p60 HDR',
          ext: 'webm',
          width: 3840,
          height: 2160,
          fps: 60,
          vcodec: 'vp9.2',
          acodec: 'none',
          tbr: 28885,
          filesize_approx: 1000000,
          protocol: 'https',
          url: 'https://video.googlevideo.com/videoplayback?itag=337',
        },
        {
          format_id: '642',
          format_note: '2160p60 HDR',
          ext: 'mp4',
          height: 2160,
          vcodec: 'vp09.02.51.10',
          acodec: 'none',
          protocol: 'm3u8_native',
          url: 'https://manifest.googlevideo.com/api/manifest/hls_playlist/example.m3u8',
        },
      ],
    }, formats, subtitles, rawStreams);

    expect(metadata.title).toBe('Fixture 4K');
    expect(formats).toHaveLength(1);
    expect(formats[0]).toMatchObject({
      id: 'yt_ytdlp_337',
      qualityTier: '4k',
      isDownloadable: true,
      isStreamable: true,
    });
    expect(rawStreams).toHaveLength(2);
    expect(rawStreams.find((stream) => stream.itag === 642)).toMatchObject({
      isDownloadable: false,
      isStreamable: false,
    });
  });
});
