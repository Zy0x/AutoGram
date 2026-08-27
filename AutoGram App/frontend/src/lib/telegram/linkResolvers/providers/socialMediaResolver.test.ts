import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatsFromCobalt, socialMediaResolver } from './socialMediaResolver';

describe('socialMediaResolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Cobalt picker photos and videos without treating the page URL as media', () => {
    const formats = formatsFromCobalt(
      {
        picker: [
          { type: 'photo', url: 'https://cdn.example.com/photo.jpg' },
          { type: 'video', url: 'https://cdn.example.com/clip.mp4' },
        ],
      },
      'facebook',
      'Facebook',
    );

    expect(formats).toHaveLength(2);
    expect(formats[0]).toMatchObject({ ext: 'jpg', isImage: true, isVideo: false });
    expect(formats[1]).toMatchObject({ ext: 'mp4', isImage: false, isVideo: true });
    expect(formats.every((format) => format.directUrl !== 'https://facebook.com/watch/123')).toBe(true);
  });

  it('drops provider candidates that resolve to private network addresses', () => {
    const formats = formatsFromCobalt(
      {
        picker: [
          { type: 'video', url: 'http://127.0.0.1/private.mp4' },
          { type: 'photo', url: 'https://cdn.example.com/public.webp' },
        ],
      },
      'instagram',
      'Instagram',
    );

    expect(formats).toHaveLength(1);
    expect(formats[0].directUrl).toBe('https://cdn.example.com/public.webp');
  });

  it('returns null when extraction fails so the resolver registry can fall through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    const result = await socialMediaResolver.resolve('https://www.facebook.com/share/v/example');

    expect(result).toBeNull();
  });
});
