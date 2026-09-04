import { describe, it, expect } from 'vitest';
import { sniffMagicBytes } from '../../../lib/media/magicBytesSniffer';

describe('SecurityMismatchBanner logic and data contracts', () => {
  it('detects JPEG format disguised under .heic filename', () => {
    // JPEG magic bytes: FF D8 FF E0
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const result = sniffMagicBytes(jpegBytes, 'genshinimpact.hd-13-08-2023-0001.heic');

    expect(result.detectedExt).toBe('jpg');
    expect(result.category).toBe('image');
    expect(result.formatLabel).toBe('JPEG Image');
    expect(result.isExtensionMatch).toBe(false);
    expect(result.isSuspiciousExecutable).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.suggestedFilename).toBe('genshinimpact.hd-13-08-2023-0001.jpg');
  });

  it('marks legitimate HEIC file as safe extension match', () => {
    // HEIC ftyp box: 00 00 00 18 66 74 79 70 68 65 69 63
    const heicBytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    const result = sniffMagicBytes(heicBytes, 'genshinimpact.hd-13-08-2023-0001.heic');

    expect(result.detectedExt).toBe('heic');
    expect(result.category).toBe('image');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });

  it('identifies dangerous PE Windows executable disguised as image', () => {
    // MZ header: 4D 5A
    const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const result = sniffMagicBytes(exeBytes, 'cute_anime_girl.jpg');

    expect(result.detectedExt).toBe('exe');
    expect(result.category).toBe('executable');
    expect(result.isSuspiciousExecutable).toBe(true);
    expect(result.severity).toBe('danger');
  });

  it('allows matching JPEG with .jpeg extension without mismatch warning', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const result = sniffMagicBytes(jpegBytes, 'photo.jpeg');

    expect(result.detectedExt).toBe('jpg');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });
});
