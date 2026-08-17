import { describe, expect, it } from 'vitest';
import {
  normalizeTransferSettings,
  validateTransferSettings,
} from '../../components/drive/Transfers/transferSettingsModel';
import { DEFAULT_TRANSFER_SETTINGS, type DriveTransferSettings } from './driveTypes';
import {
  compareDriveFiles,
  filterAndSortDriveFiles,
  type DriveFile,
  type DriveSortMode,
} from './driveTypes';

const files: DriveFile[] = [
  { id: 30, name: 'beta10.jpg', size: 400, created_at: '2026-08-03T00:00:00Z' },
  { id: 10, name: 'Alpha2.jpg', size: 100, created_at: '2026-08-01T00:00:00Z' },
  { id: 20, name: 'alpha10.jpg', size: 250, created_at: '2026-08-02T00:00:00Z' },
] as DriveFile[];

describe('Drive global sort contracts', () => {
  const expected: Record<DriveSortMode, number[]> = {
    newest: [30, 20, 10],
    oldest: [10, 20, 30],
    name_asc: [10, 20, 30],
    name_desc: [30, 20, 10],
    type_asc: [10, 20, 30],
    type_desc: [10, 20, 30],
    size_desc: [30, 20, 10],
    size_asc: [10, 20, 30],
  };

  for (const mode of Object.keys(expected) as DriveSortMode[]) {
    it(`sorts the complete set using ${mode}`, () => {
      expect([...files].sort((a, b) => compareDriveFiles(a, b, mode)).map((file) => file.id))
        .toEqual(expected[mode]);
      expect(filterAndSortDriveFiles(files, { sortMode: mode }).map((file) => file.id))
        .toEqual(expected[mode]);
    });
  }

  it('correctly sorts different file types like Windows 11 File Explorer', () => {
    const mixedFiles: DriveFile[] = [
      { id: 1, name: 'Report.pdf', file_ext: 'pdf', icon_type: 'document' },
      { id: 2, name: 'Backup.zip', file_ext: 'zip', icon_type: 'archive' },
      { id: 3, name: 'Photo.png', file_ext: 'png', icon_type: 'image' },
      { id: 4, name: 'Folder A', icon_type: 'folder' },
      { id: 5, name: 'Music.mp3', file_ext: 'mp3', icon_type: 'audio' },
      { id: 6, name: 'Video.mp4', file_ext: 'mp4', icon_type: 'video' },
    ] as DriveFile[];

    const sortedAsc = filterAndSortDriveFiles(mixedFiles, { sortMode: 'type_asc' });
    // Folders come first ( 00_folder), then archives, audio, doc_pdf, image, video
    expect(sortedAsc.map((f) => f.id)).toEqual([4, 2, 5, 1, 3, 6]);

    const sortedDesc = filterAndSortDriveFiles(mixedFiles, { sortMode: 'type_desc' });
    expect(sortedDesc.map((f) => f.id)).toEqual([6, 3, 1, 5, 2, 4]);
  });
});

describe('album and Telegram grid settings', () => {
  it('normalizes legacy packing to the selected grid size', () => {
    const seven = normalizeTransferSettings({ albumGroupSize: 7, albumPacking: 'balanced' });
    expect(seven.albumGroupSize).toBe(7);
    expect(seven.albumPacking).toBe('custom');

    const ten = normalizeTransferSettings({ albumGroupSize: 10, albumPacking: 'follow_selection' });
    expect(ten.albumGroupSize).toBe(10);
    expect(ten.albumPacking).toBe('maximum');
  });

  it('clamps custom album grids to Telegram limits', () => {
    expect(normalizeTransferSettings({ albumGroupSize: 1 }).albumGroupSize).toBe(2);
    expect(normalizeTransferSettings({ albumGroupSize: 99 }).albumGroupSize).toBe(10);
  });
});

describe('Transfer Manager settings matrix', () => {
  const variants: Partial<Record<keyof DriveTransferSettings, unknown[]>> = {
    qualityMode: ['HIGH_QUALITY', 'SMART', 'ORIGINAL'],
    uploadConcurrency: [1, 4, 8, 99],
    downloadConcurrency: [1, 4, 8, 99],
    groupAsAlbum: [false, true],
    albumGroupSize: [2, 3, 7, 9, 10],
    albumPacking: ['maximum', 'balanced', 'custom', 'follow_selection', 'never'],
    albumAvoidSingle: [false, true],
    albumFailurePolicy: ['atomic_strict', 'retry_prepare', 'replan_group', 'send_remaining', 'send_failed_separately', 'cancel_group', 'best_effort_advanced'],
    duplicatePolicy: ['SKIP', 'FORCE_UPLOAD'],
    scanMode: ['normal', 'smart', 'forensic'],
    topicScope: ['selected_only', 'selected_plus_general', 'all_topics'],
    presentationOverride: ['automatic', 'force_document', 'force_native_media'],
    oversizeAction: ['auto_adaptive', 'fit_to_limit', 'split', 'alternate_account', 'skip'],
    albumAlternateStrategy: ['separate_item', 'move_whole_group', 'cancel_group'],
    encoderStrategy: ['auto_adaptive', 'hardware_preferred', 'software_preferred', 'hardware_only', 'software_only', 'specific_device', 'disable_reencode'],
    encoderResourceProfile: ['eco', 'balanced', 'performance', 'custom'],
    encoderMaxParallel: [1, 2, 4, 9],
    reencodeHardware: ['auto', 'nvidia', 'amd', 'intel', 'cpu'],
    reencodePreset: ['speed', 'balanced', 'quality'],
    downloadConflictPolicy: ['ask', 'rename', 'overwrite', 'skip'],
    downloadIntegrity: ['size', 'sha256'],
    captionOverflowPolicy: ['truncate_with_warning', 'fail', 'split'],
  };

  for (const [field, values] of Object.entries(variants) as Array<[keyof DriveTransferSettings, unknown[]]>) {
    for (const value of values) {
      it(`normalizes isolated ${field}=${String(value)}`, () => {
        const normalized = normalizeTransferSettings({ [field]: value } as Partial<DriveTransferSettings>);
        expect(normalized.albumGroupSize).toBeGreaterThanOrEqual(2);
        expect(normalized.albumGroupSize).toBeLessThanOrEqual(10);
        expect(normalized.albumPacking).toBe(normalized.albumGroupSize === 10 ? 'maximum' : 'custom');
        expect(normalized.uploadConcurrency).toBeGreaterThanOrEqual(1);
        expect(normalized.downloadConcurrency).toBeGreaterThanOrEqual(1);
      });
    }
  }

  const qualityModes = ['HIGH_QUALITY', 'SMART', 'ORIGINAL'] as const;
  const presentationModes = ['automatic', 'force_document', 'force_native_media'] as const;
  const duplicateModes = ['SKIP', 'FORCE_UPLOAD'] as const;
  const albumSizes = [2, 7, 10] as const;
  const encoderModes = ['auto_adaptive', 'hardware_preferred', 'software_only', 'disable_reencode'] as const;
  const oversizeModes = ['auto_adaptive', 'fit_to_limit', 'split', 'alternate_account', 'skip'] as const;

  it('normalizes and validates the high-risk Cartesian configuration matrix', () => {
    let checked = 0;
    for (const qualityMode of qualityModes) {
      for (const presentationOverride of presentationModes) {
        for (const duplicatePolicy of duplicateModes) {
          for (const albumGroupSize of albumSizes) {
            for (const encoderStrategy of encoderModes) {
              for (const oversizeAction of oversizeModes) {
                const settings = normalizeTransferSettings({
                  ...DEFAULT_TRANSFER_SETTINGS,
                  qualityMode,
                  presentationOverride,
                  duplicatePolicy,
                  groupAsAlbum: true,
                  albumGroupSize,
                  encoderStrategy,
                  oversizeAction,
                });
                const result = validateTransferSettings(settings, null);
                expect(result.normalized.albumGroupSize).toBe(albumGroupSize);
                expect(result.normalized.albumPacking).toBe(albumGroupSize === 10 ? 'maximum' : 'custom');
                expect(result.errors.every((issue) => issue.level === 'error')).toBe(true);
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(1_080);
  });
});
