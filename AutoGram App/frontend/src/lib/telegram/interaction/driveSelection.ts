/**
 * Precise multi-select for Drive Media Studio.
 *
 * All range / marquee / select-all operations use the **displayed** order
 * (filtered + sorted), never the raw loaded array — so custom filter/sort
 * never selects the wrong items.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type ClickSelectInput = {
  displayedIds: number[];
  selectedIds: number[];
  /** Anchor for shift-range (Windows/Telegram-style) */
  anchorId: number | null;
  clickedId: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export type ClickSelectResult = {
  selectedIds: number[];
  anchorId: number | null;
};

/** Inclusive range of displayed ids from a → b (order-independent). */
export function rangeIdsOnDisplayed(
  displayedIds: number[],
  fromId: number,
  toId: number
): number[] {
  const a = displayedIds.indexOf(fromId);
  const b = displayedIds.indexOf(toId);
  if (a < 0 && b < 0) return [];
  if (a < 0) return b >= 0 ? [toId] : [];
  if (b < 0) return [fromId];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return displayedIds.slice(lo, hi + 1);
}

export function uniqueIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function unionIds(a: number[], b: number[]): number[] {
  return uniqueIds([...a, ...b]);
}

export function subtractIds(base: number[], remove: number[]): number[] {
  const drop = new Set(remove);
  return base.filter((id) => !drop.has(id));
}

export function toggleId(selectedIds: number[], id: number): number[] {
  return selectedIds.includes(id)
    ? selectedIds.filter((x) => x !== id)
    : [...selectedIds, id];
}

/**
 * Click selection:
 * - plain: select only clicked, set anchor
 * - plain on the sole selected item again: unselect all
 * - Ctrl/Cmd: toggle clicked (select / unselect one), set anchor to clicked
 * - Shift: range from anchor → clicked (on displayed order); replace selection
 * - Ctrl/Cmd+Shift: add range to existing selection
 */
export function applyClickSelection(input: ClickSelectInput): ClickSelectResult {
  const {
    displayedIds,
    selectedIds,
    anchorId,
    clickedId,
    ctrlKey,
    metaKey,
    shiftKey,
  } = input;
  const multi = ctrlKey || metaKey;

  if (shiftKey) {
    const anchor =
      anchorId != null && displayedIds.includes(anchorId)
        ? anchorId
        : selectedIds.find((id) => displayedIds.includes(id)) ?? clickedId;
    const range = rangeIdsOnDisplayed(displayedIds, anchor, clickedId);
    if (multi) {
      return {
        selectedIds: unionIds(selectedIds, range),
        anchorId: anchor,
      };
    }
    return {
      selectedIds: range.length ? range : [clickedId],
      anchorId: anchor,
    };
  }

  if (multi) {
    const next = toggleId(selectedIds, clickedId);
    return {
      selectedIds: next,
      // Keep anchor on last touched; clear if nothing left selected
      anchorId: next.length ? clickedId : null,
    };
  }

  // Second plain click on the only selected item → unselect
  if (selectedIds.length === 1 && selectedIds[0] === clickedId) {
    return { selectedIds: [], anchorId: null };
  }

  return {
    selectedIds: [clickedId],
    anchorId: clickedId,
  };
}

/** Marquee modes: replace (default), add (Ctrl), subtract (Alt). */
export type MarqueeMode = 'replace' | 'add' | 'subtract';

export function marqueeModeFromKeys(e: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): MarqueeMode {
  if (e.altKey) return 'subtract';
  if (e.ctrlKey || e.metaKey || e.shiftKey) return 'add';
  return 'replace';
}

/**
 * Resolve the gesture owner before either card DnD or explorer marquee primes.
 * Empty canvas always supports marquee; a card only yields to marquee while
 * Ctrl/Cmd is held. Nested controls always retain their own interaction.
 */
export function shouldStartExplorerMarquee(input: {
  button: number;
  overCard: boolean;
  overControl: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  if (input.button !== 0 || input.overControl || input.overCard) return false;
  return true;
}

export function applyMarqueeSelection(
  selectedIds: number[],
  hitIds: number[],
  mode: MarqueeMode
): number[] {
  if (mode === 'add') return unionIds(selectedIds, hitIds);
  if (mode === 'subtract') return subtractIds(selectedIds, hitIds);
  return uniqueIds(hitIds);
}

/** Keep only ids that still exist in the current displayed set (after filter/sort). */
export function pruneSelectionToDisplayed(
  selectedIds: number[],
  displayedIds: number[]
): number[] {
  if (!selectedIds.length) return selectedIds;
  const ok = new Set(displayedIds);
  const next = selectedIds.filter((id) => ok.has(id));
  return next.length === selectedIds.length ? selectedIds : next;
}

export function invertSelectionOnDisplayed(
  displayedIds: number[],
  selectedIds: number[]
): number[] {
  const sel = new Set(selectedIds);
  return displayedIds.filter((id) => !sel.has(id));
}

export function selectAllDisplayed(displayedIds: number[]): number[] {
  return [...displayedIds];
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

export function normalizeClientRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Rect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return {
    x,
    y,
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

/** Convert viewport client rect → content coordinates inside scroll container. */
export function clientRectToContent(
  client: Rect,
  container: DOMRect,
  scrollLeft: number,
  scrollTop: number
): Rect {
  return {
    x: client.x - container.left + scrollLeft,
    y: client.y - container.top + scrollTop,
    w: client.w,
    h: client.h,
  };
}

/** Single client point → content coords (scroll-stable marquee origin). */
export function clientPointToContent(
  clientX: number,
  clientY: number,
  container: { left: number; top: number },
  scrollLeft: number,
  scrollTop: number
): { x: number; y: number } {
  return {
    x: clientX - container.left + scrollLeft,
    y: clientY - container.top + scrollTop,
  };
}

/** Content rect → viewport client rect for drawing the rubber-band. */
export function contentRectToClient(
  content: Rect,
  container: { left: number; top: number },
  scrollLeft: number,
  scrollTop: number
): Rect {
  return {
    x: content.x - scrollLeft + container.left,
    y: content.y - scrollTop + container.top,
    w: content.w,
    h: content.h,
  };
}

/** Normalize two content-space points into a content rect. */
export function normalizeContentRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Rect {
  return normalizeClientRect(x0, y0, x1, y1);
}

/**
 * Grid cell rect in content space (matches DriveExplorer virtual grid layout).
 * padX = left padding; row height includes gap; card height ≈ rowH - gap.
 */
export function gridItemContentRect(
  index: number,
  opts: {
    cols: number;
    cardWidth: number;
    rowHeight: number;
    gap: number;
    padX: number;
  }
): Rect {
  const col = index % opts.cols;
  const row = Math.floor(index / opts.cols);
  const cardH = Math.max(8, opts.rowHeight - opts.gap);
  return {
    x: opts.padX + col * (opts.cardWidth + opts.gap),
    y: row * opts.rowHeight,
    w: opts.cardWidth,
    h: cardH,
  };
}

/** List row rect in content space (includes optional header offset). */
export function listItemContentRect(
  index: number,
  opts: { rowHeight: number; headerOffset: number }
): Rect {
  return {
    x: 0,
    y: opts.headerOffset + index * opts.rowHeight,
    w: 1e6, // full width — marquee only needs Y for list
    h: opts.rowHeight,
  };
}

export function hitTestDisplayedByMarquee(
  displayedIds: number[],
  marqueeContent: Rect,
  layout:
    | {
        mode: 'grid';
        cols: number;
        cardWidth: number;
        rowHeight: number;
        gap: number;
        padX: number;
      }
    | {
        mode: 'list';
        rowHeight: number;
        headerOffset: number;
      }
): number[] {
  // Ignore tiny accidental drags
  if (marqueeContent.w < 4 && marqueeContent.h < 4) return [];

  const hits: number[] = [];
  for (let i = 0; i < displayedIds.length; i++) {
    const cell =
      layout.mode === 'grid'
        ? gridItemContentRect(i, layout)
        : listItemContentRect(i, layout);
    // List: marquee is full-width hit on Y; clamp cell width to marquee for safety
    const testCell =
      layout.mode === 'list'
        ? { ...cell, x: marqueeContent.x, w: Math.max(marqueeContent.w, 1) }
        : cell;
    if (rectsIntersect(marqueeContent, testCell)) {
      hits.push(displayedIds[i]);
    }
  }
  return hits;
}

/** Snapshot selection before marquee drag (for add/subtract relative to start). */
export function applyLiveMarquee(
  baseSelectedIds: number[],
  hitIds: number[],
  mode: MarqueeMode
): number[] {
  return applyMarqueeSelection(baseSelectedIds, hitIds, mode);
}
