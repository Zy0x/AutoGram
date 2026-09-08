import { describe, expect, it } from 'vitest';
import {
  type QualityPreflightReport,
  isPreflightItemOversize,
  getPreflightOversizeCount,
} from './qualityPreflight';
import {
  buildPreflightReviewDecision,
  defaultDuplicateChoices,
} from './preflightDuplicateDecision';

function report(): QualityPreflightReport {
  const duplicate = (matchLevel: 'exact_sha256' | 'probable_filename_size') => ({
    matchLevel,
    telegramMessageId: 81,
    telegramUniqueId: null,
    existingName: 'existing.jpg',
    existingSize: 123,
    existingPayloadClass: 'native_visual',
    destinationId: 'me',
    topicId: null,
  });
  return {
    schemaVersion: 2,
    capabilitySource: 'cached',
    engineMode: 'v4',
    effectiveMaxBytes: 2_000_000_000,
    captionLimit: 1024,
    captionLengthUtf16: 0,
    captionSummaryIndex: null,
    captionWarnings: [],
    hasBlockingIssues: false,
    requiresConfirmation: true,
    albumIsProvisional: false,
    albumGridSize: 10,
    plannedAlbumSizes: [],
    items: [
      {
        index: 0, sourcePath: 'exact.jpg', sourceName: 'exact.jpg', sourceSize: 123,
        category: 'jpeg_image', transform: 'pass_through', payloadClass: 'native_visual',
        asDocument: false, albumEligible: true, reasonCode: 'native', warnings: [],
        rejectedAlternatives: [], requiresConfirmation: true, duplicateMatch: duplicate('exact_sha256'),
      },
      {
        index: 1, sourcePath: 'probable.jpg', sourceName: 'probable.jpg', sourceSize: 123,
        category: 'jpeg_image', transform: 'pass_through', payloadClass: 'native_visual',
        asDocument: false, albumEligible: true, reasonCode: 'native', warnings: [],
        rejectedAlternatives: [], requiresConfirmation: true, duplicateMatch: duplicate('probable_filename_size'),
      },
      {
        index: 2, sourcePath: 'new.jpg', sourceName: 'new.jpg', sourceSize: 124,
        category: 'jpeg_image', transform: 'pass_through', payloadClass: 'native_visual',
        asDocument: false, albumEligible: true, reasonCode: 'native', warnings: [],
        rejectedAlternatives: [], requiresConfirmation: false, duplicateMatch: null,
      },
    ],
  };
}

describe('transfer preflight duplicate decisions', () => {
  it('defaults exact hashes to skip and probable matches to upload', () => {
    expect(defaultDuplicateChoices(report())).toEqual({
      'exact.jpg': 'skip',
      'probable.jpg': 'upload',
      'new.jpg': 'upload',
    });
  });

  it('returns only duplicate paths and preserves explicit choices', () => {
    expect(buildPreflightReviewDecision(report(), {
      'exact.jpg': 'upload',
      'probable.jpg': 'skip',
    })).toEqual({
      approved: true,
      skippedPaths: ['probable.jpg'],
      forceUploadPaths: ['exact.jpg'],
    });
  });
});

describe('transfer preflight oversize detection', () => {
  it('identifies oversize items when transferring to Telegram cloud', () => {
    const rep = report();
    rep.effectiveMaxBytes = 2_097_152_000; // ~2 GB
    rep.storagePolicy = 'telegram';
    const bigItem = {
      ...rep.items[0],
      sourcePath: 'movie_4k.mkv',
      sourceName: 'movie_4k.mkv',
      sourceSize: 3_000_000_000, // 3 GB > 2 GB
    };
    rep.items.push(bigItem);

    expect(isPreflightItemOversize(bigItem, rep)).toBe(true);
    expect(isPreflightItemOversize(rep.items[0], rep)).toBe(false);
    expect(getPreflightOversizeCount(rep)).toBe(1);
  });

  it('bypasses oversize limits when destination is local custom_disk', () => {
    const rep = report();
    rep.effectiveMaxBytes = 2_097_152_000;
    rep.storagePolicy = 'custom_disk'; // Local disk only
    const bigItem = {
      ...rep.items[0],
      sourcePath: 'movie_4k.mkv',
      sourceName: 'movie_4k.mkv',
      sourceSize: 3_000_000_000,
    };
    rep.items.push(bigItem);

    expect(isPreflightItemOversize(bigItem, rep)).toBe(false);
    expect(getPreflightOversizeCount(rep)).toBe(0);
  });

  it('enforces oversize limits when destination is disk_and_telegram', () => {
    const rep = report();
    rep.effectiveMaxBytes = 2_097_152_000;
    rep.storagePolicy = 'disk_and_telegram';
    const bigItem = {
      ...rep.items[0],
      sourcePath: 'huge_archive.zip',
      sourceName: 'huge_archive.zip',
      sourceSize: 5_000_000_000,
    };
    rep.items.push(bigItem);

    expect(isPreflightItemOversize(bigItem, rep)).toBe(true);
    expect(getPreflightOversizeCount(rep)).toBe(1);
  });
});
