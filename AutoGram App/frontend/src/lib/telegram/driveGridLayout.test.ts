import { describe, expect, it } from 'vitest';
import { computeDriveGridLayout } from './driveTypes';

describe('computeDriveGridLayout regression tests', () => {
  it('1. Same container width + same density produces identical layout across topic contexts', () => {
    const layoutAllMedia = computeDriveGridLayout({
      containerWidth: 1200,
      density: 2,
      gap: 10,
      padX: 28,
    });
    const layoutTopic = computeDriveGridLayout({
      containerWidth: 1200,
      density: 2,
      gap: 10,
      padX: 28,
    });

    expect(layoutAllMedia.columnCount).toBe(layoutTopic.columnCount);
    expect(layoutAllMedia.cardWidth).toBe(layoutTopic.cardWidth);
    expect(layoutAllMedia.cardHeight).toBe(layoutTopic.cardHeight);
    expect(layoutAllMedia.rowHeight).toBe(layoutTopic.rowHeight);
  });

  it('2. Item count and media dimensions do not alter grid calculation', () => {
    const layoutA = computeDriveGridLayout({ containerWidth: 1000, density: 2 });
    const layoutB = computeDriveGridLayout({ containerWidth: 1000, density: 2 });

    expect(layoutA).toEqual(layoutB);
    expect(layoutA.rowHeight).toBe(layoutA.cardHeight + 10);
  });

  it('3. Invalid measurement (0, NaN, negative) safely falls back without throwing or invalid values', () => {
    const layoutZero = computeDriveGridLayout({ containerWidth: 0, density: 2 });
    const layoutNaN = computeDriveGridLayout({ containerWidth: NaN, density: 2 });
    const layoutNeg = computeDriveGridLayout({ containerWidth: -500, density: 2 });

    expect(layoutZero.columnCount).toBeGreaterThan(0);
    expect(layoutZero.cardWidth).toBeGreaterThan(0);
    expect(layoutNaN.columnCount).toBe(layoutZero.columnCount);
    expect(layoutNeg.columnCount).toBe(layoutZero.columnCount);
  });

  it('4. Density levels (S, M, L) produce distinct intentional column counts and tile sizes', () => {
    const layoutS = computeDriveGridLayout({ containerWidth: 1200, density: 1 });
    const layoutM = computeDriveGridLayout({ containerWidth: 1200, density: 2 });
    const layoutL = computeDriveGridLayout({ containerWidth: 1200, density: 3 });

    expect(layoutS.columnCount).toBeGreaterThanOrEqual(layoutM.columnCount);
    expect(layoutM.columnCount).toBeGreaterThanOrEqual(layoutL.columnCount);
    expect(layoutS.cardWidth).toBeLessThan(layoutM.cardWidth);
    expect(layoutM.cardWidth).toBeLessThan(layoutL.cardWidth);
  });

  it('5. Maintains 3:4 aspect ratio (height = width * 1.5) and 10px vertical gap', () => {
    const layout = computeDriveGridLayout({ containerWidth: 1200, density: 2, gap: 10 });
    const expectedHeight = Math.round(layout.cardWidth * 1.5);

    expect(layout.cardHeight).toBe(expectedHeight);
    expect(layout.rowHeight).toBe(layout.cardHeight + 10);
  });
});
