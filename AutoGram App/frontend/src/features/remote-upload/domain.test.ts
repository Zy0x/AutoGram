import { describe, expect, it } from 'vitest';
import {
  canTransferResolvedFormat,
  inferFilenameFromUrl,
  inferKindFromExt,
  isInspectableRemoteUrl,
  isManifestFormat,
  sanitizeAndNormalizeFilename,
} from './domain';

describe('remote-upload domain policies', () => {
  it('validates inspectable URLs and infers stable filenames/kinds', () => {
    expect(isInspectableRemoteUrl('https://example.com/video.mp4')).toBe(true);
    expect(isInspectableRemoteUrl('file:///tmp/video.mp4')).toBe(false);
    expect(inferFilenameFromUrl('https://example.com/path/video.mp4?token=1')).toBe('video.mp4');
    expect(inferKindFromExt('.mp4')).toBe('video');
    expect(inferKindFromExt('.zip')).toBe('zip');
  });

  it('rejects manifests and unsafe resolver formats from transfer', () => {
    expect(isManifestFormat({ ext: 'm3u8', protocol: 'hls', directUrl: 'https://example.com/live' })).toBe(true);
    expect(canTransferResolvedFormat({ id: 'manifest', ext: 'mp4', protocol: 'https', directUrl: 'https://example.com/live.m3u8', verification: { status: 'verified' } } as any)).toBe(false);
    expect(canTransferResolvedFormat({ id: 'video', ext: 'mp4', protocol: 'https', directUrl: 'https://example.com/video.mp4', verification: { status: 'verified' } } as any)).toBe(true);
  });

  it('normalizes user filenames without duplicating extensions', () => {
    expect(sanitizeAndNormalizeFilename('report.mp4.mp4', 'mp4')).toBe('report.mp4');
    expect(sanitizeAndNormalizeFilename('draft:final', 'zip')).toBe('draft_final.zip');
  });
});
