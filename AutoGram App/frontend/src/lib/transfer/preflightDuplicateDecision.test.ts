import { describe, expect, it } from 'vitest';
import type { QualityPreflightReport } from './qualityPreflight';
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
