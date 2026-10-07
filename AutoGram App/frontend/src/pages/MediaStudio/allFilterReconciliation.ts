import {
  matchesMediaFilter,
  type DriveFile,
  type ViewPerspective,
} from '../../lib/telegram/driveTypes';

const ALL_MERGE_FILTER_KEYS = [
  'files',
  'gifs',
  'media',
  'audio',
  'links',
  'images',
  'videos',
  'documents',
  'archives',
  'web',
] as const;

const TRACKED_MUTATION_FILTER_KEYS: Array<{
  key: string;
  perspective: ViewPerspective;
}> = [
  { key: 'gifs', perspective: 'telegram' },
  { key: 'files', perspective: 'telegram' },
  { key: 'media', perspective: 'telegram' },
  { key: 'audio', perspective: 'telegram' },
  { key: 'links', perspective: 'telegram' },
  { key: 'stickers', perspective: 'telegram' },
  { key: 'images', perspective: 'drive' },
  { key: 'videos', perspective: 'drive' },
  { key: 'documents', perspective: 'drive' },
  { key: 'archives', perspective: 'drive' },
  { key: 'web', perspective: 'drive' },
];

export type ReconcilableMutation =
  | { action: 'upsert'; row: DriveFile }
  | { action: 'delete'; message_ids: number[] };

export type AuxiliaryMediaLane = 'gifs' | 'files' | 'audio' | 'links';

/**
 * Merges the base `All` file stream with any category lanes already loaded in `filteredFilesMap`
 * (excluding `stickers`, which live exclusively in the Stickers tab), deduplicating by message ID
 * and maintaining descending chronological (`id`) order.
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
      if (
        (item.telegram_category || item.telegramCategory || '').toLowerCase() === 'sticker'
      ) {
        continue;
      }
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
 * Resolves the active file list for the selected `mediaFilter` and `perspective`.
 * Guarantees bidirectional parity:
 * - For `all`: merges `baseFiles` with all loaded non-sticker category lanes.
 * - For any specific category (`media`, `files`, `gifs`, `audio`, `links`, `images`, `videos`,
 *   `documents`, `archives`, `web`): combines the dedicated category lane `filteredFilesMap[mediaFilter]`
 *   with any matching items already present in the unified `All` pool so items never vanish when
 *   switching tabs or perspectives.
 */
export function resolveActiveFilterContentFiles(
  mediaFilter: string,
  perspective: ViewPerspective,
  baseFiles: DriveFile[],
  filteredFilesMap: Record<string, DriveFile[] | undefined>
): DriveFile[] {
  if (!mediaFilter || mediaFilter === 'all') {
    return mergeAllFilterContentFiles(baseFiles, filteredFilesMap);
  }
  const dedicatedLane = filteredFilesMap[mediaFilter] || [];
  if (mediaFilter === 'stickers') {
    return dedicatedLane;
  }

  const unifiedPool = mergeAllFilterContentFiles(baseFiles, filteredFilesMap);
  if (unifiedPool.length === 0) {
    return dedicatedLane;
  }

  const knownIds = new Set<number>();
  for (let i = 0; i < dedicatedLane.length; i++) {
    knownIds.add(dedicatedLane[i].id);
  }

  let merged: DriveFile[] | null = null;
  for (let i = 0; i < unifiedPool.length; i++) {
    const candidate = unifiedPool[i];
    if (!candidate || knownIds.has(candidate.id)) continue;
    if (matchesMediaFilter(candidate, mediaFilter, perspective)) {
      if (!merged) {
        merged = [...dedicatedLane];
      }
      knownIds.add(candidate.id);
      merged.push(candidate);
    }
  }

  if (!merged) return dedicatedLane;
  return merged.sort((a, b) => b.id - a.id);
}

/**
 * Merges incoming category rows (e.g. top `files`, `gifs`, `audio`, or `links` lane items)
 * into `prevFiles` in descending `id` order without duplicates. Returns `prevFiles` reference if unchanged.
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

/**
 * Determines which auxiliary MTProto lanes (`gifs`, `files`, `audio`, `links`) should be
 * prefetched in the background so that items isolated by Telegram server filters are
 * chronologically interleaved into `All` (or `gifs` into `Media`).
 */
export function getAuxiliaryLanesToPrefetchForAllFilter(
  mediaFilter: string,
  files: DriveFile[],
  filteredFilesMap: Record<string, DriveFile[] | undefined>,
  breakdown?: {
    fileCount?: number | null;
    gifCount?: number | null;
    audioCount?: number | null;
    linkCount?: number | null;
  } | null
): AuxiliaryMediaLane[] {
  if (mediaFilter !== 'all' && mediaFilter !== 'media') {
    return [];
  }

  const lanes: AuxiliaryMediaLane[] = [];

  if (
    (filteredFilesMap['gifs']?.length ?? 0) === 0 &&
    (breakdown?.gifCount ?? 0) > 0
  ) {
    lanes.push('gifs');
  }

  if (mediaFilter === 'all') {
    if (shouldPrefetchFilesLaneForAllFilter(files, filteredFilesMap, breakdown?.fileCount)) {
      lanes.push('files');
    }
    if (
      (filteredFilesMap['audio']?.length ?? 0) === 0 &&
      (breakdown?.audioCount ?? 0) > 0
    ) {
      lanes.push('audio');
    }
    if (
      (filteredFilesMap['links']?.length ?? 0) === 0 &&
      (breakdown?.linkCount ?? 0) > 0
    ) {
      lanes.push('links');
    }
  }

  return lanes;
}

/**
 * Removes deleted message IDs from every populated category in `filteredFilesMap` so deleted
 * items never reappear as ghost cards in `All` or category tabs.
 */
export function removeDeletedIdsFromFilteredFilesMap(
  filteredFilesMap: Record<string, DriveFile[]>,
  deletedIds: Iterable<number>
): Record<string, DriveFile[]> {
  const deletedSet = new Set<number>();
  for (const rawId of deletedIds) {
    const id = Number(rawId);
    if (Number.isFinite(id) && id > 0) {
      deletedSet.add(id);
    }
  }
  if (deletedSet.size === 0) return filteredFilesMap;

  let nextMap: Record<string, DriveFile[]> | null = null;
  for (const [key, list] of Object.entries(filteredFilesMap)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const filtered = list.filter((item) => !deletedSet.has(item.id));
    if (filtered.length !== list.length) {
      if (!nextMap) {
        nextMap = { ...filteredFilesMap };
      }
      nextMap[key] = filtered;
    }
  }

  return nextMap ?? filteredFilesMap;
}

/**
 * Applies live `upsert` and `delete` mutations to `filteredFilesMap` across all active
 * category tabs so every filter stays 100% synchronized in real time.
 */
export function applyMutationsToFilteredFilesMap(
  filteredFilesMap: Record<string, DriveFile[]>,
  mutations: ReconcilableMutation[],
  activeTopicFilter?: number | null
): Record<string, DriveFile[]> {
  if (!mutations || mutations.length === 0) return filteredFilesMap;

  const deletedIds: number[] = [];
  for (const mut of mutations) {
    if (mut.action === 'delete') {
      deletedIds.push(...mut.message_ids);
    }
  }

  let workingMap = removeDeletedIdsFromFilteredFilesMap(filteredFilesMap, deletedIds);
  let hasUpsertChange = false;

  for (const mut of mutations) {
    if (mut.action !== 'upsert' || !mut.row) continue;
    const matchesTopic =
      activeTopicFilter === undefined ||
      activeTopicFilter === null ||
      mut.row.topic_id === activeTopicFilter;

    for (const { key, perspective } of TRACKED_MUTATION_FILTER_KEYS) {
      const existingLane = workingMap[key];
      // Always keep 'gifs' live, and keep any other lane that has already been loaded in memory
      if (key !== 'gifs' && existingLane === undefined) continue;
      const lane = existingLane ? [...existingLane] : [];
      const idx = lane.findIndex((f) => f.id === mut.row.id);
      const matchesCategory = matchesTopic && matchesMediaFilter(mut.row, key, perspective);

      if (matchesCategory) {
        if (idx >= 0) {
          lane[idx] = mut.row;
        } else {
          lane.unshift(mut.row);
        }
        lane.sort((a, b) => b.id - a.id);
        if (!hasUpsertChange && workingMap === filteredFilesMap) {
          workingMap = { ...filteredFilesMap };
        }
        hasUpsertChange = true;
        workingMap[key] = lane;
      } else if (idx >= 0) {
        lane.splice(idx, 1);
        if (!hasUpsertChange && workingMap === filteredFilesMap) {
          workingMap = { ...filteredFilesMap };
        }
        hasUpsertChange = true;
        workingMap[key] = lane;
      }
    }
  }

  return workingMap;
}
