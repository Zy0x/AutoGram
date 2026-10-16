/**
 * AutoGram Transfer Batch Chunker
 * 
 * Provides deterministic partitioning of ultra-heavy uploads (10k, 17k, 20k+ files)
 * into safe, sequential chunks (standard 1,500 items per chunk) to prevent:
 *  1) Browser main-thread freezing and React memory saturation.
 *  2) Telegram API FloodWait escalation and spam score penalties.
 *  3) Rust backend IPC buffer overflow.
 */

import type { QueueTask } from '../../pages/MediaStudio/mediaStudioDomain';

export const DEFAULT_BATCH_CHUNK_SIZE = 1500;
export const MIN_CHUNK_THRESHOLD = 1500;

export interface BatchChunk {
  chunkIndex: number;
  totalChunks: number;
  startIndex: number;
  paths: string[];
  names: string[];
  sourceSizes?: number[];
  thumbnailUrls?: string[];
  label: string;
  itemCount: number;
}

/**
 * Partitions a massive list of file paths into balanced, sequential chunks.
 * If total paths <= chunkSize, returns a single chunk containing all items.
 */
export function partitionUploadItems(
  paths: string[],
  names?: string[],
  sourceSizes?: number[],
  thumbnailUrls?: string[],
  chunkSize = DEFAULT_BATCH_CHUNK_SIZE
): BatchChunk[] {
  if (!paths || paths.length === 0) return [];

  const safeChunkSize = Math.max(100, chunkSize);
  const totalItems = paths.length;
  const totalChunks = Math.ceil(totalItems / safeChunkSize);

  const chunks: BatchChunk[] = [];

  for (let c = 0; c < totalChunks; c++) {
    const start = c * safeChunkSize;
    const end = Math.min(start + safeChunkSize, totalItems);

    const chunkPaths = paths.slice(start, end);
    const chunkNames = names ? names.slice(start, end) : chunkPaths.map((p) => p.split(/[/\\]/).pop() || p);
    const chunkSizes = sourceSizes ? sourceSizes.slice(start, end) : undefined;
    const chunkThumbs = thumbnailUrls ? thumbnailUrls.slice(start, end) : undefined;

    chunks.push({
      chunkIndex: c,
      totalChunks,
      startIndex: start,
      paths: chunkPaths,
      names: chunkNames,
      sourceSizes: chunkSizes,
      thumbnailUrls: chunkThumbs,
      label: `Kloter ${c + 1}/${totalChunks}`,
      itemCount: chunkPaths.length,
    });
  }

  return chunks;
}

/**
 * Creates chained QueueTask objects for subsequent chunks (from chunkIndex onwards)
 * inheriting identical target destination, topic, album settings, and duplicate policies.
 */
export function createChainedUploadTasks(
  chunks: BatchChunk[],
  baseTaskConfig: {
    targetFolderId?: number | null;
    targetLabel?: string;
    topicId?: number | null;
    skipTopic?: boolean;
    options: any;
    baseTaskIdPrefix?: string;
  },
  startFromChunkIndex = 1
): QueueTask[] {
  const tasks: QueueTask[] = [];
  const prefix = baseTaskConfig.baseTaskIdPrefix || `upload_chain_${Date.now()}`;

  for (let i = startFromChunkIndex; i < chunks.length; i++) {
    const chunk = chunks[i];
    const taskId = `${prefix}_chunk_${chunk.chunkIndex + 1}`;

    tasks.push({
      id: taskId,
      kind: 'upload',
      paths: chunk.paths,
      names: chunk.names,
      targetFolderId: baseTaskConfig.targetFolderId ?? null,
      targetLabel: `${baseTaskConfig.targetLabel || 'Drive'} (${chunk.label})`,
      topicId: baseTaskConfig.topicId ?? null,
      skipTopic: baseTaskConfig.skipTopic ?? false,
      options: {
        ...baseTaskConfig.options,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        chunkLabel: chunk.label,
        interChunkCooldownMs: calculateAdaptiveCooldown(chunk.chunkIndex, chunks.length),
      },
      startIndex: chunk.startIndex,
    });
  }

  return tasks;
}

/**
 * Computes safe adaptive cooldown delay (in milliseconds) before starting the next chunk.
 * Standard delay: 10 seconds.
 * Progressive decay ensures Telegram DC rate limiter buckets recharge smoothly.
 */
export function calculateAdaptiveCooldown(chunkIndex: number, totalChunks: number): number {
  if (chunkIndex <= 0 || totalChunks <= 1) return 0;
  // If approaching large batches (> 5 chunks), provide 15 seconds to ensure DC bucket reset
  if (chunkIndex >= 5) {
    return 15000;
  }
  return 10000;
}

/**
 * Formats human-readable summary of batch chunking partition.
 */
export function formatBatchChunkSummary(
  totalCount: number,
  chunkSize = DEFAULT_BATCH_CHUNK_SIZE
): string {
  if (totalCount <= chunkSize) {
    return `${totalCount} media (1 kloter)`;
  }
  const chunks = Math.ceil(totalCount / chunkSize);
  const remainder = totalCount % chunkSize;
  if (remainder === 0) {
    return `${totalCount} media (${chunks} kloter @ ${chunkSize.toLocaleString()})`;
  }
  const fullChunks = chunks - 1;
  return `${totalCount} media (${chunks} kloter: ${fullChunks} × ${chunkSize.toLocaleString()} + 1 × ${remainder.toLocaleString()})`;
}
