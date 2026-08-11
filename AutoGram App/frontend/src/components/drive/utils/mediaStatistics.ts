import type { DriveFile, ViewPerspective } from '../../../lib/telegram/driveTypes';
import { matchesMediaFilter } from '../../../lib/telegram/driveTypes';

export type ExactMediaBreakdown = {
  photoCount: number;
  videoCount: number;
  fileCount: number;
  gifCount: number;
  linkCount: number;
  audioCount: number;
};

export type PerspectiveMediaCounts = Record<string, number>;

export function countExactMediaBreakdown(files: DriveFile[]): ExactMediaBreakdown {
  const counts: ExactMediaBreakdown = {
    photoCount: 0,
    videoCount: 0,
    fileCount: 0,
    gifCount: 0,
    linkCount: 0,
    audioCount: 0,
  };

  for (const file of files) {
    const category = String(file.telegram_category || file.telegramCategory || '').toLowerCase();
    const subtype = String(file.telegram_subtype || file.telegramSubtype || '').toLowerCase();
    if (category === 'gif' || matchesMediaFilter(file, 'gifs', 'telegram')) {
      counts.gifCount += 1;
    } else if (category === 'link' || matchesMediaFilter(file, 'links', 'telegram')) {
      counts.linkCount += 1;
    } else if (category === 'audio' || matchesMediaFilter(file, 'audio', 'telegram')) {
      counts.audioCount += 1;
    } else if (category === 'media' || matchesMediaFilter(file, 'media', 'telegram')) {
      if (subtype.includes('video') || matchesMediaFilter(file, 'video', 'drive')) {
        counts.videoCount += 1;
      } else {
        counts.photoCount += 1;
      }
    } else {
      counts.fileCount += 1;
    }
  }
  return counts;
}

export function countPerspectiveMedia(
  files: DriveFile[],
  perspective: ViewPerspective
): PerspectiveMediaCounts {
  const filters = perspective === 'telegram'
    ? ['all', 'media', 'files', 'links', 'gifs', 'audio']
    : ['all', 'images', 'videos', 'audio', 'documents', 'archives'];
  const result: PerspectiveMediaCounts = { all: files.length };
  for (const filter of filters.slice(1)) {
    result[filter] = files.reduce(
      (total, file) => total + (matchesMediaFilter(file, filter, perspective) ? 1 : 0),
      0
    );
  }
  return result;
}
