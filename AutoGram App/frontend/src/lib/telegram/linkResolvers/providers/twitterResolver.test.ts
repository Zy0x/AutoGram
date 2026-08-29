import { afterEach, describe, expect, it, vi } from 'vitest';
import { twitterResolver } from './twitterResolver';

describe('twitterResolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('correctly matches Twitter and X URLs with status IDs', () => {
    expect(twitterResolver.canHandle('https://x.com/kanuk22/status/2092881299304296958')).toBe(true);
    expect(twitterResolver.canHandle('https://twitter.com/user/status/123456789')).toBe(true);
    expect(twitterResolver.canHandle('https://x.com/i/status/123456789')).toBe(true);
    expect(twitterResolver.canHandle('https://fxtwitter.com/user/status/123456789')).toBe(true);
    expect(twitterResolver.canHandle('https://vxtwitter.com/user/status/123456789')).toBe(true);
    expect(twitterResolver.canHandle('https://x.com/home')).toBe(false);
    expect(twitterResolver.canHandle('https://youtube.com/watch?v=123')).toBe(false);
  });

  it('resolves video tweet with multiple quality variants and metadata', async () => {
    const mockFxResponse = {
      code: 200,
      message: 'OK',
      tweet: {
        id: '2092881299304296958',
        url: 'https://x.com/kanuk22/status/2092881299304296958',
        text: '极品双马尾04年的，和小奶狗啪啪啪，还自拍 https://t.co/abc',
        author: {
          name: '七天探花眼镜妹',
          screen_name: 'kanuk22',
          avatar_url: 'https://pbs.twimg.com/profile_images/2056398915487027200/irZcOby6_200x200.jpg',
        },
        media: {
          videos: [
            {
              id: '2056648295632805888',
              url: 'https://video.twimg.com/amplify_video/2056648295632805888/vid/avc1/720x1280/FN8YWkWeQugzkULS.mp4?tag=27',
              thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/2056648295632805888/img/kW6qw6V3oPm7n2O5.jpg',
              duration: 1200.517,
              width: 720,
              height: 1280,
              variants: [
                {
                  url: 'https://video.twimg.com/amplify_video/2056648295632805888/vid/avc1/480x852/YzZDz35xD7H6avnF.mp4?tag=27',
                  bitrate: 950000,
                  content_type: 'video/mp4',
                },
                {
                  url: 'https://video.twimg.com/amplify_video/2056648295632805888/vid/avc1/720x1280/FN8YWkWeQugzkULS.mp4?tag=27',
                  bitrate: 2176000,
                  content_type: 'video/mp4',
                },
                {
                  url: 'https://video.twimg.com/amplify_video/2056648295632805888/vid/avc1/320x568/WZkz2EbXi4PusBzF.mp4?tag=27',
                  bitrate: 632000,
                  content_type: 'video/mp4',
                },
              ],
            },
          ],
        },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFxResponse,
      })
    );

    const result = await twitterResolver.resolve('https://x.com/kanuk22/status/2092881299304296958');

    expect(result).not.toBeNull();
    expect(result?.platform).toBe('twitter');
    expect(result?.platformName).toBe('Twitter / X');
    expect(result?.title).toBe('极品双马尾04年的，和小奶狗啪啪啪，还自拍');
    expect(result?.author).toBe('七天探花眼镜妹 (@kanuk22)');
    expect(result?.durationSec).toBe(1201);
    expect(result?.formats.length).toBe(3);
    expect(result?.formats[0]).toMatchObject({
      qualityTier: '720p',
      badge: '720 × 1280',
      label: '720p HD (720 × 1280)',
      ext: 'mp4',
      isVideo: true,
      directUrl: 'https://video.twimg.com/amplify_video/2056648295632805888/vid/avc1/720x1280/FN8YWkWeQugzkULS.mp4?tag=27',
    });
    expect(result?.formats[1]).toMatchObject({
      qualityTier: '480p',
      badge: '480 × 852',
      label: '480p SD (480 × 852)',
      ext: 'mp4',
    });
    expect(result?.formats[2]).toMatchObject({
      qualityTier: '360p',
      badge: '320 × 568',
      label: '320p (320 × 568)',
      ext: 'mp4',
    });
  });

  it('drops private IP candidates and validates URL safety', async () => {
    const mockFxResponse = {
      code: 200,
      tweet: {
        id: '123',
        text: 'Test private IP',
        author: { name: 'Tester', screen_name: 'test' },
        media: {
          videos: [
            {
              url: 'http://127.0.0.1/malicious.mp4',
              variants: [
                { url: 'http://192.168.1.1/internal.mp4', content_type: 'video/mp4' },
                { url: 'https://video.twimg.com/safe.mp4', content_type: 'video/mp4', bitrate: 1000 },
              ],
            },
          ],
        },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFxResponse,
      })
    );

    const result = await twitterResolver.resolve('https://x.com/test/status/123');
    expect(result).not.toBeNull();
    expect(result?.formats.length).toBe(1);
    expect(result?.formats[0].directUrl).toBe('https://video.twimg.com/safe.mp4');
  });
});
