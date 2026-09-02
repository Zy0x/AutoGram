import { describe, it, expect } from 'vitest';
import { detectBrowserNativeMime } from './HeicTiffViewer';

describe('HeicTiffViewer detectBrowserNativeMime', () => {
  it('detects JPEG magic bytes in ArrayBuffer', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBe('image/jpeg');
  });

  it('detects PNG magic bytes in ArrayBuffer', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBe('image/png');
  });

  it('detects WebP magic bytes in ArrayBuffer', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBe('image/webp');
  });

  it('detects GIF magic bytes in ArrayBuffer', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBe('image/gif');
  });

  it('detects BMP magic bytes in ArrayBuffer', () => {
    const bytes = new Uint8Array([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBe('image/bmp');
  });

  it('detects AVIF magic bytes in ArrayBuffer', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
    ]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBe('image/avif');
  });

  it('detects SVG in ArrayBuffer', () => {
    const str = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50"/></svg>';
    const bytes = new TextEncoder().encode(str);
    expect(detectBrowserNativeMime(bytes.buffer)).toBe('image/svg+xml');
  });

  it('returns null for actual HEIC files to let heic2any handle it', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBeNull();
  });

  it('returns null for actual TIFF files to let utif handle it', () => {
    const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBeNull();
  });

  it('returns null for short buffer', () => {
    const bytes = new Uint8Array([0x00, 0x01]);
    expect(detectBrowserNativeMime(bytes.buffer)).toBeNull();
  });
});
