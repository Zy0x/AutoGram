import { describe, expect, it } from 'vitest';
import {
  filterAndSortDriveFiles,
  isRestrictedOrInaccessibleFile,
  RESTRICTED_MEDIA_PATTERNS,
  type DriveFile,
} from './driveTypes';
import { filterAndSortDriveFilesPower } from './interaction/drivePower';

describe('Restricted & Inaccessible Media Detection & Filtering', () => {
  const normalFile1: DriveFile = {
    id: 1,
    folder_id: null,
    icon_type: 'image',
    name: 'photo_trip.jpg',
    caption: 'My holiday trip photos',
    size: 1024 * 500,
    created_at: '2026-08-01T00:00:00Z',
  };

  const normalFile2: DriveFile = {
    id: 2,
    folder_id: null,
    icon_type: 'document',
    name: 'document.pdf',
    caption: 'Important presentation slide notes',
    size: 1024 * 1024 * 2,
    created_at: '2026-08-02T00:00:00Z',
  };

  const restrictedByFlag: DriveFile = {
    id: 3,
    folder_id: null,
    icon_type: 'file',
    name: 'restricted_item.bin',
    is_restricted: true,
    restriction_reason: 'This message was blocked due to local legal regulations',
    size: 0,
    created_at: '2026-08-03T00:00:00Z',
  };

  const restrictedByEnglishNoticeInName: DriveFile = {
    id: 4,
    folder_id: null,
    icon_type: 'file',
    name: "This channel can't be displayed because it was used to spread...",
    size: 0,
    created_at: '2026-08-04T00:00:00Z',
  };

  const restrictedByEnglishNoticeInCaption: DriveFile = {
    id: 5,
    folder_id: null,
    icon_type: 'image',
    name: 'photo.jpg',
    caption: "This message can't be displayed because of copyright infringement",
    size: 1024 * 10,
    created_at: '2026-08-05T00:00:00Z',
  };

  const restrictedByIndonesianNotice: DriveFile = {
    id: 6,
    folder_id: null,
    icon_type: 'file',
    name: 'Saluran ini tidak dapat ditampilkan karena melanggar hak cipta',
    size: 0,
    created_at: '2026-08-06T00:00:00Z',
  };

  const restrictedByCategory: DriveFile = {
    id: 7,
    folder_id: null,
    icon_type: 'file',
    name: 'media_unknown.dat',
    telegram_category: 'restricted',
    size: 0,
    created_at: '2026-08-07T00:00:00Z',
  };

  const restrictedByCurlyApostrophe: DriveFile = {
    id: 8,
    folder_id: null,
    icon_type: 'file',
    name: "This channel can’t be displayed because it was used to spread pornographic content.",
    size: 85,
    created_at: '2026-08-08T00:00:00Z',
  };

  const restrictedByDriveFormatText: DriveFile = {
    id: 9,
    folder_id: null,
    icon_type: 'file',
    name: "This channel can't b...",
    drive_format: "This channel can’t be displayed because it was used to spread...",
    size: 85,
    created_at: '2026-08-09T00:00:00Z',
  };

  const allFiles: DriveFile[] = [
    normalFile1,
    normalFile2,
    restrictedByFlag,
    restrictedByEnglishNoticeInName,
    restrictedByEnglishNoticeInCaption,
    restrictedByIndonesianNotice,
    restrictedByCategory,
    restrictedByCurlyApostrophe,
    restrictedByDriveFormatText,
  ];

  it('correctly identifies normal media vs restricted media', () => {
    expect(isRestrictedOrInaccessibleFile(normalFile1)).toBe(false);
    expect(isRestrictedOrInaccessibleFile(normalFile2)).toBe(false);

    expect(isRestrictedOrInaccessibleFile(restrictedByFlag)).toBe(true);
    expect(isRestrictedOrInaccessibleFile(restrictedByEnglishNoticeInName)).toBe(true);
    expect(isRestrictedOrInaccessibleFile(restrictedByEnglishNoticeInCaption)).toBe(true);
    expect(isRestrictedOrInaccessibleFile(restrictedByIndonesianNotice)).toBe(true);
    expect(isRestrictedOrInaccessibleFile(restrictedByCategory)).toBe(true);
    expect(isRestrictedOrInaccessibleFile(restrictedByCurlyApostrophe)).toBe(true);
    expect(isRestrictedOrInaccessibleFile(restrictedByDriveFormatText)).toBe(true);
  });

  it('matches all declared RESTRICTED_MEDIA_PATTERNS correctly', () => {
    const testCases = [
      "This channel can't be displayed",
      "This channel can’t be displayed",
      "This channel can‘t be displayed",
      "This channel can`t be displayed",
      "This channel cannot be displayed",
      "This message can't be displayed",
      "This message can’t be displayed",
      "This message cannot be displayed",
      "This group can't be displayed",
      "This group can’t be displayed",
      "This media is not available in your country",
      "This content is unavailable",
      "Saluran ini tidak dapat ditampilkan",
      "Pesan ini tidak dapat ditampilkan",
      "Grup ini tidak dapat ditampilkan",
      "Media ini tidak tersedia",
      "Konten ini tidak tersedia",
      "Tidak dapat ditampilkan karena melanggar hak cipta",
      "Saluran diblokir",
      "Channel blocked",
      "Banned channel",
    ];

    for (const text of testCases) {
      const matches = RESTRICTED_MEDIA_PATTERNS.some((pattern) => pattern.test(text));
      expect(matches, `Expected text '${text}' to match at least one pattern`).toBe(true);
    }
  });

  it('filters out restricted files by default in filterAndSortDriveFiles', () => {
    const result = filterAndSortDriveFiles(allFiles, { sortMode: 'oldest' });
    expect(result.map((f) => f.id)).toEqual([1, 2]);
  });

  it('filters out restricted files when hideRestrictedMedia: true', () => {
    const result = filterAndSortDriveFiles(allFiles, { sortMode: 'oldest', hideRestrictedMedia: true });
    expect(result.map((f) => f.id)).toEqual([1, 2]);
  });

  it('includes restricted files when hideRestrictedMedia: false', () => {
    const result = filterAndSortDriveFiles(allFiles, { sortMode: 'oldest', hideRestrictedMedia: false });
    expect(result.map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('works seamlessly through filterAndSortDriveFilesPower', () => {
    const hidden = filterAndSortDriveFilesPower(allFiles, { sortMode: 'oldest', hideRestrictedMedia: true });
    expect(hidden.map((f) => f.id)).toEqual([1, 2]);

    const visible = filterAndSortDriveFilesPower(allFiles, { sortMode: 'oldest', hideRestrictedMedia: false });
    expect(visible.map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
