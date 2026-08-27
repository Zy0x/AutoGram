import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTransferSettings } from './driveTypes';

describe('transfer settings conflict normalization', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it('preserves explicit raw image and video policies after reload', () => {
    localStorage.setItem('autogram_drive_transfer_settings', JSON.stringify({
      imageTranscodeScope: 'none',
      imageTranscodeFormats: [],
      albumIncompatImageMode: 'document',
      videoTranscodeScope: 'none',
      videoTranscodeFormats: [],
      albumIncompatAnimMode: 'document',
    }));

    const settings = loadTransferSettings();
    expect(settings.imageTranscodeScope).toBe('none');
    expect(settings.imageTranscodeFormats).toEqual([]);
    expect(settings.albumIncompatImageMode).toBe('document');
    expect(settings.videoTranscodeScope).toBe('none');
    expect(settings.videoTranscodeFormats).toEqual([]);
  });

  it('preserves a deliberately empty custom image selection', () => {
    localStorage.setItem('autogram_drive_transfer_settings', JSON.stringify({
      imageTranscodeScope: 'custom',
      imageTranscodeFormats: [],
      albumIncompatImageMode: 'document',
    }));

    const settings = loadTransferSettings();
    expect(settings.imageTranscodeScope).toBe('custom');
    expect(settings.imageTranscodeFormats).toEqual([]);
  });
});
