import { describe, expect, it } from 'vitest';
import {
  partitionUploadItems,
  createChainedUploadTasks,
  calculateAdaptiveCooldown,
  formatBatchChunkSummary,
  DEFAULT_BATCH_CHUNK_SIZE,
} from './transferBatchChunker';

describe('transferBatchChunker', () => {
  it('returns empty array when input paths are empty', () => {
    expect(partitionUploadItems([])).toEqual([]);
  });

  it('partitions 17,000 items into 12 chunks (11 x 1500 + 1 x 500)', () => {
    expect(DEFAULT_BATCH_CHUNK_SIZE).toBe(1500);
    const paths = Array.from({ length: 17000 }, (_, i) => `D:/Upload/photo_${i + 1}.jpg`);
    const chunks = partitionUploadItems(paths, undefined, undefined, undefined, DEFAULT_BATCH_CHUNK_SIZE);

    expect(chunks.length).toBe(12);

    // First chunk
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].totalChunks).toBe(12);
    expect(chunks[0].startIndex).toBe(0);
    expect(chunks[0].paths.length).toBe(1500);
    expect(chunks[0].paths[0]).toBe('D:/Upload/photo_1.jpg');
    expect(chunks[0].paths[1499]).toBe('D:/Upload/photo_1500.jpg');
    expect(chunks[0].label).toBe('Kloter 1/12');

    // 11th chunk
    expect(chunks[10].chunkIndex).toBe(10);
    expect(chunks[10].startIndex).toBe(15000);
    expect(chunks[10].paths.length).toBe(1500);

    // Final 12th chunk (remainder)
    expect(chunks[11].chunkIndex).toBe(11);
    expect(chunks[11].startIndex).toBe(16500);
    expect(chunks[11].paths.length).toBe(500);
    expect(chunks[11].paths[499]).toBe('D:/Upload/photo_17000.jpg');
    expect(chunks[11].label).toBe('Kloter 12/12');
  });

  it('keeps single chunk for items <= chunkSize', () => {
    const paths = Array.from({ length: 800 }, (_, i) => `D:/Upload/item_${i + 1}.png`);
    const chunks = partitionUploadItems(paths, undefined, undefined, undefined, 1500);

    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].startIndex).toBe(0);
    expect(chunks[0].paths.length).toBe(800);
    expect(chunks[0].label).toBe('Kloter 1/1');
  });

  it('creates chained tasks for chunks 2..N with identical settings', () => {
    const paths = Array.from({ length: 4000 }, (_, i) => `D:/Upload/file_${i}.mp4`);
    const chunks = partitionUploadItems(paths, undefined, undefined, undefined, 1500);
    expect(chunks.length).toBe(3); // 1500, 1500, 1000

    const tasks = createChainedUploadTasks(
      chunks,
      {
        targetFolderId: 100,
        targetLabel: 'DestTopic',
        topicId: 8,
        skipTopic: false,
        options: { groupAsAlbum: true, duplicatePolicy: 'SKIP' },
        baseTaskIdPrefix: 'test_run',
      },
      1 // from chunk 1 onwards
    );

    expect(tasks.length).toBe(2); // Chunks 1 and 2

    // Task for Chunk 1
    expect(tasks[0].id).toBe('test_run_chunk_2');
    expect(tasks[0].targetFolderId).toBe(100);
    expect(tasks[0].topicId).toBe(8);
    expect(tasks[0].startIndex).toBe(1500);
    expect(tasks[0].paths?.length).toBe(1500);
    expect(tasks[0].options.groupAsAlbum).toBe(true);
    expect(tasks[0].options.duplicatePolicy).toBe('SKIP');
    expect(tasks[0].options.chunkIndex).toBe(1);

    // Task for Chunk 2
    expect(tasks[1].id).toBe('test_run_chunk_3');
    expect(tasks[1].startIndex).toBe(3000);
    expect(tasks[1].paths?.length).toBe(1000);
    expect(tasks[1].options.chunkIndex).toBe(2);
  });

  it('calculates adaptive cooldowns safely', () => {
    expect(calculateAdaptiveCooldown(0, 10)).toBe(0);
    expect(calculateAdaptiveCooldown(1, 10)).toBe(10000);
    expect(calculateAdaptiveCooldown(5, 10)).toBe(15000);
  });

  it('formats batch chunk summaries nicely', () => {
    expect(formatBatchChunkSummary(800, 1500)).toBe('800 media (1 kloter)');
    expect(formatBatchChunkSummary(3000, 1500)).toContain('2 kloter');
    expect(formatBatchChunkSummary(17000, 1500)).toContain('12 kloter');
  });
});
