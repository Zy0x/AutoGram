import { describe, it, expect } from 'vitest';
import {
  isMediaThumbnailSupported,
  isImageEntry,
  isVideoEntry,
  getZipThumbnailCacheKey,
} from './ZipThumbnailManager';

describe('ZipThumbnailManager', () => {
  it('identifies supported media entries correctly', () => {
    expect(isMediaThumbnailSupported('photo.jpg')).toBe(true);
    expect(isMediaThumbnailSupported('image.PNG')).toBe(true);
    expect(isMediaThumbnailSupported('video.mp4')).toBe(true);
    expect(isMediaThumbnailSupported('clip.mkv')).toBe(true);
    expect(isMediaThumbnailSupported('document.pdf')).toBe(false);
    expect(isMediaThumbnailSupported('archive.zip')).toBe(false);
    expect(isMediaThumbnailSupported('script.py')).toBe(false);
  });

  it('distinguishes image and video formats', () => {
    expect(isImageEntry('sample.webp')).toBe(true);
    expect(isImageEntry('sample.mp4')).toBe(false);

    expect(isVideoEntry('sample.mp4')).toBe(true);
    expect(isVideoEntry('sample.png')).toBe(false);
  });

  it('generates consistent cache keys for indexedDB lookup', () => {
    const key1 = getZipThumbnailCacheKey('sess1', '12345', 99, 'photos/img1.jpg');
    const key2 = getZipThumbnailCacheKey('sess1', '12345', 99, 'photos/img1.jpg');
    const key3 = getZipThumbnailCacheKey('sess1', '12345', 100, 'photos/img1.jpg');

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toContain('v2:zip_thumb:sess1_12345_99_photos/img1.jpg');
  });
});
