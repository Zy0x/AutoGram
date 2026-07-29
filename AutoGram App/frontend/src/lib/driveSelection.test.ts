import { describe, it, expect } from 'vitest';
import {
  applyLiveMarquee,
  applyMarqueeSelection,
  clientPointToContent,
  contentRectToClient,
  hitTestDisplayedByMarquee,
  normalizeContentRect,
} from './driveSelection';

describe('content-space marquee coords', () => {
  it('clientPointToContent pins origin when scroll changes (scroll-stable start)', () => {
    const container = { left: 100, top: 50 };
    // Point at client (150, 100) with scrollTop=0
    const p0 = clientPointToContent(150, 100, container, 0, 0);
    expect(p0).toEqual({ x: 50, y: 50 });
    // Same client point after scrollTop=200 would map to different content —
    // but a *stored* content origin must stay fixed:
    const startContent = p0;
    // After scrolling, convert *current* pointer only:
    const p1 = clientPointToContent(150, 200, container, 0, 200);
    // Marquee from fixed startContent to p1 still includes y=50..350 area
    const rect = normalizeContentRect(startContent.x, startContent.y, p1.x, p1.y);
    expect(rect.y).toBe(50);
    expect(rect.h).toBe(300); // 350-50
  });

  it('wrong pattern (re-converting fixed client start with new scroll) drifts', () => {
    const container = { left: 0, top: 0 };
    const startClientY = 100;
    // BUG: re-apply scroll to start each frame
    const badAt0 = clientPointToContent(0, startClientY, container, 0, 0).y;
    const badAt200 = clientPointToContent(0, startClientY, container, 0, 200).y;
    expect(badAt200 - badAt0).toBe(200); // drifts — this is what we fixed
  });

  it('contentRectToClient round-trips with clientPointToContent', () => {
    const container = { left: 20, top: 40 };
    const content = { x: 10, y: 80, w: 100, h: 50 };
    const client = contentRectToClient(content, container, 0, 30);
    expect(client).toEqual({ x: 30, y: 90, w: 100, h: 50 });
    const back = clientPointToContent(client.x, client.y, container, 0, 30);
    expect(back).toEqual({ x: 10, y: 80 });
  });
});

describe('marquee selection modes with prior selection', () => {
  it('replace ignores prior selection', () => {
    expect(applyMarqueeSelection([1, 2], [3, 4], 'replace')).toEqual([3, 4]);
  });

  it('add unions prior selection with hits', () => {
    expect(applyLiveMarquee([1, 2], [3, 4], 'add')).toEqual([1, 2, 3, 4]);
  });

  it('subtract removes hits from prior', () => {
    expect(applyLiveMarquee([1, 2, 3], [2], 'subtract')).toEqual([1, 3]);
  });
});

describe('hitTestDisplayedByMarquee scroll-stable content rect', () => {
  const ids = [10, 11, 12, 13, 14, 15];
  const layout = {
    mode: 'grid' as const,
    cols: 3,
    cardWidth: 100,
    rowHeight: 160,
    gap: 10,
    padX: 14,
  };

  it('hits all items under a tall content marquee (including off-screen rows)', () => {
    // Cover rows 0 and 1 fully in content space
    const marquee = { x: 0, y: 0, w: 400, h: 300 };
    const hits = hitTestDisplayedByMarquee(ids, marquee, layout);
    // 3 cols * 2 rows = 6 items
    expect(hits).toEqual(ids);
  });

  it('keeps early-row hits when marquee start is fixed in content space', () => {
    // Simulate: user started at content y=10, dragged to y=200 while scrolling
    // Wide enough to cover first row cards (padX=14, 3×100 + gaps)
    const marquee = normalizeContentRect(14, 10, 360, 200);
    const hits = hitTestDisplayedByMarquee(ids, marquee, layout);
    // First row (indices 0..2 → ids 10,11,12) should still be hit
    expect(hits).toContain(10);
    expect(hits).toContain(11);
    expect(hits).toContain(12);
    // Second row partial (y≈160) also included
    expect(hits).toContain(13);
  });
});
