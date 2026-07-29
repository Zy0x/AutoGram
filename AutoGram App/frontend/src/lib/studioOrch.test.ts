import { describe, expect, it } from 'vitest';
import {
  isLocalUploadPath,
  isStudioUploadPath,
  isStudioOrchEligible,
  studioChatIdFromFolder,
  mapOrchItemStatus,
} from './studioOrch';

describe('studioOrch helpers', () => {
  it('detects local vs remote paths', () => {
    expect(isLocalUploadPath('C:\\Users\\me\\a.mp4')).toBe(true);
    expect(isLocalUploadPath('/home/me/a.mp4')).toBe(true);
    expect(isLocalUploadPath('https://cdn.example/a.mp4')).toBe(false);
    expect(isLocalUploadPath('http://x/y')).toBe(false);
    expect(isLocalUploadPath('')).toBe(false);
    expect(isStudioUploadPath('https://cdn.example/a.mp4')).toBe(true);
    expect(isStudioUploadPath('C:\\a.mp4')).toBe(true);
  });

  it('maps saved messages and folder chat ids', () => {
    expect(studioChatIdFromFolder(null)).toBe('me');
    expect(studioChatIdFromFolder(undefined)).toBe('me');
    expect(studioChatIdFromFolder(-100123)).toBe('-100123');
  });

  it('maps orch item states', () => {
    expect(mapOrchItemStatus('done')).toBe('done');
    expect(mapOrchItemStatus('skipped')).toBe('skipped');
    expect(mapOrchItemStatus('failed')).toBe('failed');
    expect(mapOrchItemStatus('uploading')).toBe('uploading');
  });

  it('rejects remote URLs; non-Tauri is always ineligible', () => {
    // Outside Tauri runtime detectTauriRuntime is false → ineligible
    expect(
      isStudioOrchEligible(['C:\\a.mp4', 'C:\\b.mp4'], { group_as_album: true })
    ).toBe(false);
    expect(isStudioOrchEligible(['https://x/a.mp4'], {})).toBe(false);
  });
});
