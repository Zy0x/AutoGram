import { describe, it, expect } from 'vitest';
import {
  videoBalancedPartitionSizes,
  partitionSizes,
  calculateAlbumPartition,
} from './AlbumStrategyControl';

describe('AlbumStrategyControl - 2-Mode Partition Mathematics & Simulator', () => {
  describe('videoBalancedPartitionSizes', () => {
    it('returns empty for 0 items', () => {
      expect(videoBalancedPartitionSizes(0, 8)).toEqual([]);
    });

    it('returns single group for <= maxSafe', () => {
      expect(videoBalancedPartitionSizes(5, 8)).toEqual([5]);
      expect(videoBalancedPartitionSizes(8, 8)).toEqual([8]);
    });

    it('partitions 10 videos into safe [5, 5]', () => {
      expect(videoBalancedPartitionSizes(10, 8)).toEqual([5, 5]);
    });

    it('partitions 13 videos into safe [7, 6] (100% anti-split)', () => {
      expect(videoBalancedPartitionSizes(13, 8)).toEqual([7, 6]);
    });

    it('partitions 15 videos into safe [8, 7]', () => {
      expect(videoBalancedPartitionSizes(15, 8)).toEqual([8, 7]);
    });

    it('partitions 17 videos into safe [6, 6, 5]', () => {
      expect(videoBalancedPartitionSizes(17, 8)).toEqual([6, 6, 5]);
    });

    it('partitions 27 videos into safe [7, 7, 7, 6]', () => {
      expect(videoBalancedPartitionSizes(27, 8)).toEqual([7, 7, 7, 6]);
    });

    it('guarantees all video cluster sizes are <= 8 and >= 2 for all N from 2 to 50', () => {
      for (let n = 2; n <= 50; n++) {
        const sizes = videoBalancedPartitionSizes(n, 8);
        const sum = sizes.reduce((a, b) => a + b, 0);
        expect(sum).toBe(n);
        for (const s of sizes) {
          expect(s).toBeLessThanOrEqual(8);
          expect(s).toBeGreaterThanOrEqual(2);
        }
      }
    });
  });

  describe('partitionSizes (Photos & Custom)', () => {
    it('returns empty for 0 items', () => {
      expect(partitionSizes(0, 10, true)).toEqual([]);
    });

    it('partitions pure photos with maximum 10 in front', () => {
      expect(partitionSizes(10, 10, true)).toEqual([10]);
      expect(partitionSizes(13, 10, true)).toEqual([10, 3]);
      expect(partitionSizes(15, 10, true)).toEqual([10, 5]);
      expect(partitionSizes(17, 10, true)).toEqual([10, 7]);
      expect(partitionSizes(27, 10, true)).toEqual([10, 10, 7]);
    });

    it('avoids single remainder by rebalancing 10+1 to 9+2', () => {
      expect(partitionSizes(11, 10, true)).toEqual([9, 2]);
    });
  });

  describe('calculateAlbumPartition (2-Mode Strategy Resolver)', () => {
    it('resolves Smart Mode for video as Safe Balanced (isSafe=true, 0 timeout risk)', () => {
      const result = calculateAlbumPartition(13, 'smart_adaptive', 'video');
      expect(result.sizes).toEqual([7, 6]);
      expect(result.isSafe).toBe(true);
      expect(result.warningKey).toBeUndefined();
    });

    it('resolves Smart Mode for photo as Maximum 10 (isSafe=true)', () => {
      const result = calculateAlbumPartition(13, 'smart_adaptive', 'photo');
      expect(result.sizes).toEqual([10, 3]);
      expect(result.isSafe).toBe(true);
      expect(result.warningKey).toBeUndefined();
    });

    it('flags Custom Grid for video with size 10 as timeout risk (isSafe=false)', () => {
      const result = calculateAlbumPartition(13, 'custom', 'video', 10);
      expect(result.sizes).toEqual([10, 3]);
      expect(result.isSafe).toBe(false);
      expect(result.warningKey).toBe('drive.album_strategy_custom_warning_title');
    });

    it('flags Custom Grid for video with size 9 as timeout risk (isSafe=false)', () => {
      const result = calculateAlbumPartition(13, 'custom', 'video', 9);
      expect(result.sizes).toEqual([9, 4]);
      expect(result.isSafe).toBe(false);
      expect(result.warningKey).toBe('drive.album_strategy_custom_warning_title');
    });

    it('considers Custom Grid for video with safe size <= 8 as safe (isSafe=true)', () => {
      const result = calculateAlbumPartition(13, 'custom', 'video', 7);
      expect(result.sizes).toEqual([7, 6]);
      expect(result.isSafe).toBe(true);
      expect(result.warningKey).toBeUndefined();
    });

    it('considers Custom Grid for photo with size 10 as safe (isSafe=true, photos never timeout)', () => {
      const result = calculateAlbumPartition(13, 'custom', 'photo', 10);
      expect(result.sizes).toEqual([10, 3]);
      expect(result.isSafe).toBe(true);
      expect(result.warningKey).toBeUndefined();
    });

    it('seamlessly maps legacy "balanced" strategy to Smart Mode', () => {
      const resultVid = calculateAlbumPartition(17, 'balanced', 'video');
      expect(resultVid.sizes).toEqual([6, 6, 5]);
      expect(resultVid.isSafe).toBe(true);
    });
  });
});
