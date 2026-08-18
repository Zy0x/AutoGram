import { describe, it, expect } from 'vitest';
import {
  determineIndexingTier,
  getAdaptiveDelay,
  formatEta,
  calculateIndexingMetrics,
} from './adaptiveIndexer';

describe('adaptiveIndexer', () => {
  describe('determineIndexingTier', () => {
    it('correctly classifies micro tier (<= 1500)', () => {
      expect(determineIndexingTier(500, 100)).toBe('micro');
      expect(determineIndexingTier(1500, 0)).toBe('micro');
    });

    it('correctly classifies medium tier (1501 - 15000)', () => {
      expect(determineIndexingTier(3000, 500)).toBe('medium');
      expect(determineIndexingTier(15000, 1000)).toBe('medium');
    });

    it('correctly classifies massive tier (15001 - 100000)', () => {
      expect(determineIndexingTier(43060, 200)).toBe('massive');
      expect(determineIndexingTier(100000, 5000)).toBe('massive');
    });

    it('correctly classifies colossal tier (100001 - 500000)', () => {
      expect(determineIndexingTier(250000, 10000)).toBe('colossal');
      expect(determineIndexingTier(500000, 50000)).toBe('colossal');
    });

    it('correctly classifies galactic tier (> 500000)', () => {
      expect(determineIndexingTier(1000000, 100000)).toBe('galactic');
    });

    it('falls back to loadedCount if totalCount is undefined or 0', () => {
      expect(determineIndexingTier(null, 800)).toBe('micro');
      expect(determineIndexingTier(0, 25000)).toBe('massive');
    });
  });

  describe('getAdaptiveDelay', () => {
    it('returns fast delay for micro tier', () => {
      const res = getAdaptiveDelay('micro', 200, 50);
      expect(res.delayMs).toBe(2);
      expect(res.isMicroBreath).toBe(false);
    });

    it('handles massive tier 2-phase transition (fast phase 1 vs sustained phase 2)', () => {
      const phase1 = getAdaptiveDelay('massive', 500, 50);
      expect(phase1.delayMs).toBe(3);

      const phase2 = getAdaptiveDelay('massive', 4500, 50);
      expect(phase2.delayMs).toBe(6);
    });

    it('triggers micro-breath pause at 10,000 items boundary in colossal tier', () => {
      const normal = getAdaptiveDelay('colossal', 3000, 50);
      expect(normal.isMicroBreath).toBe(false);
      expect(normal.delayMs).toBe(8);

      const pause = getAdaptiveDelay('colossal', 10050, 50);
      expect(pause.isMicroBreath).toBe(true);
      expect(pause.delayMs).toBe(60);
    });

    it('applies latency compensation when network ping > 400ms', () => {
      const laggy = getAdaptiveDelay('medium', 2000, 450);
      expect(laggy.delayMs).toBe(Math.round(4 * 2.0));
    });
  });

  describe('formatEta', () => {
    it('formats seconds', () => {
      expect(formatEta(15)).toBe('15s');
      expect(formatEta(59)).toBe('59s');
    });

    it('formats minutes and seconds', () => {
      expect(formatEta(60)).toBe('1m');
      expect(formatEta(75)).toBe('1m 15s');
      expect(formatEta(190)).toBe('3m 10s');
    });

    it('handles null and invalid values safely', () => {
      expect(formatEta(null)).toBeNull();
      expect(formatEta(-5)).toBeNull();
      expect(formatEta(0)).toBeNull();
    });
  });

  describe('calculateIndexingMetrics', () => {
    it('calculates accurate percent, speed, and formatted ETA', () => {
      const start = 100000;
      const now = 102000; // 2 seconds elapsed
      const metrics = calculateIndexingMetrics(1000, 5000, start, now);

      expect(metrics.percent).toBe(20);
      expect(metrics.speedMsgPerSec).toBe(500); // 1000 msgs / 2 sec = 500
      expect(metrics.etaSeconds).toBe(8); // (5000 - 1000) / 500 = 8s
      expect(metrics.etaFormatted).toBe('8s');
    });
  });
});
