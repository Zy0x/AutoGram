import { describe, expect, it } from 'vitest';
import { reconcileFilteredTotal } from './filterCountPolicy';

describe('reconcileFilteredTotal', () => {
  it('uses loaded authoritative sticker rows when Telegram cannot report a total', () => {
    expect(reconcileFilteredTotal('stickers', 0, 4)).toBe(4);
    expect(reconcileFilteredTotal('stickers', null, 4)).toBe(4);
  });

  it('preserves a larger reported count and normal filter totals', () => {
    expect(reconcileFilteredTotal('stickers', 12, 4)).toBe(12);
    expect(reconcileFilteredTotal('media', 120, 80)).toBe(120);
  });
});
