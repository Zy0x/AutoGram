import { describe, expect, it } from 'vitest';
import { detectRemoteProvider, getProviderReferer, hasKnownRemoteProvider } from './providerCatalog';

describe('remote provider catalog', () => {
  it.each([
    ['https://youtu.be/abc', 'youtube'],
    ['https://r4---sn.googlevideo.com/videoplayback', 'youtube'],
    ['https://www.tiktok.com/@demo/video/1', 'tiktok'],
    ['https://pbs.twimg.com/media/demo.jpg', 'twitter'],
    ['https://pinimg.com/image.jpg', 'pinterest'],
    ['https://i.pximg.net/img-original/demo.jpg', 'pixiv'],
    ['https://cdn.streamrizz.com/file.mp4', 'streamrizz'],
    ['https://videy.co/v?id=1', 'videe'],
    ['https://vqso.de/file.mp4', 'vqso'],
  ])('classifies %s as %s', (url, provider) => {
    expect(detectRemoteProvider(url)).toBe(provider);
  });

  it('returns provider-specific referers only where required', () => {
    expect(getProviderReferer('https://www.youtube.com/watch?v=1')).toBe('https://www.youtube.com/');
    expect(getProviderReferer('https://x.com/demo/status/1')).toBe('https://x.com/');
    expect(getProviderReferer('https://example.com/file.mp4')).toBeUndefined();
  });

  it('distinguishes known providers from generic direct URLs', () => {
    expect(hasKnownRemoteProvider('https://www.pinterest.com/pin/1')).toBe(true);
    expect(hasKnownRemoteProvider('https://example.com/file.mp4')).toBe(false);
  });
});
