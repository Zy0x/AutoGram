import type { DriveFile } from '../../lib/telegram/driveTypes';

const ALL_MERGE_FILTER_KEYS = ['files', 'gifs', 'media', 'audio', 'links'] as const;

/**
 * Merges the base `All` file stream with any category lanes already loaded in `filteredFilesMap`
 * (`files`, `gifs`, `media`, `audio`, `links`), deduplicating by message ID and maintaining
 * descending chronological (`id`) order.
 */
export function mergeAllFilterContentFiles(
  baseFiles: DriveFile[],
  filteredFilesMap: Record<string, DriveFile[] | undefined>
): DriveFile[] {
  const base = baseFiles || [];
  const knownIds = new Set<number>();
  for (let i = 0; i < base.length; i++) {
    knownIds.add(base[i].id);
  }

  let merged: DriveFile[] | null = null;
  for (const key of ALL_MERGE_FILTER_KEYS) {
    const lane = filteredFilesMap[key];
    if (!lane || lane.length === 0) continue;
    for (let i = 0; i < lane.length; i++) {
      const item = lane[i];
      if (!item || !Number.isFinite(item.id) || knownIds.has(item.id)) continue;
      if (!merged) {
        merged = [...base];
      }
      knownIds.add(item.id);
      merged.push(item);
    }
  }

  if (!merged) return base;
  return merged.sort((a, b) => b.id - a.id);
}

/**
 * Merges incoming category rows (e.g. top `files` or `gifs` lane items) into `prevFiles`
 * in descending `id` order without duplicates. Returns `prevFiles` reference if unchanged.
 */
export function mergeReconciledFilesIntoAllState(
  prevFiles: DriveFile[],
  incomingFiles: DriveFile[]
): DriveFile[] {
  if (!incomingFiles || incomingFiles.length === 0) return prevFiles;
  const knownIds = new Set<number>();
  for (let i = 0; i < prevFiles.length; i++) {
    knownIds.add(prevFiles[i].id);
  }

  let merged: DriveFile[] | null = null;
  for (let i = 0; i < incomingFiles.length; i++) {
    const item = incomingFiles[i];
    if (!item || !Number.isFinite(item.id) || knownIds.has(item.id)) continue;
    if (!merged) {
      merged = [...prevFiles];
    }
    knownIds.add(item.id);
    merged.push(item);
  }

  if (!merged) return prevFiles;
  return merged.sort((a, b) => b.id - a.id);
}

/**
 * Determines whether the `All` filter should proactively fetch the top `files` (Document) lane
 * to guarantee document items (such as photos/archives uploaded as files) are never omitted
 * from the `All` view head.
 */
export function shouldPrefetchFilesLaneForAllFilter(
  files: DriveFile[],
  filteredFilesMap: Record<string, DriveFile[] | undefined>,
  cachedFileCount?: number | null
): boolean {
  if ((filteredFilesMap['files']?.length ?? 0) > 0) {
    return false;
  }
  if (cachedFileCount != null && cachedFileCount <= 0) {
    return false;
  }
  const hasDocInBase = files.some(
    (f) => f.as_document === true || f.telegram_category === 'file'
  );
  return !hasDocInBase || (cachedFileCount ?? 0) > 0;
}
