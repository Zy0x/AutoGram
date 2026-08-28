import { describe, expect, it } from 'vitest';
import {
  applyClickSelection,
  rangeIdsOnDisplayed,
  shouldStartExplorerMarquee,
  toggleId,
  unionIds,
  subtractIds,
  uniqueIds,
} from './driveSelection';

describe('shouldStartExplorerMarquee', () => {
  it('starts on empty canvas with the primary pointer', () => {
    expect(shouldStartExplorerMarquee({ button: 0, overCard: false, overControl: false })).toBe(true);
  });

  it('never starts marquee over a card so card click, shift-range, ctrl-toggle, and DnD own the gesture', () => {
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: false })).toBe(false);
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: false, ctrlKey: true })).toBe(false);
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: false, metaKey: true })).toBe(false);
  });

  it('never steals nested controls or non-primary pointers', () => {
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: true, ctrlKey: true })).toBe(false);
    expect(shouldStartExplorerMarquee({ button: 2, overCard: false, overControl: false })).toBe(false);
  });
});

describe('applyClickSelection - Multi-select workflow', () => {
  const displayed = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('selects single item on plain click and establishes anchor', () => {
    const res = applyClickSelection({
      displayedIds: displayed,
      selectedIds: [],
      anchorId: null,
      clickedId: 20,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(res.selectedIds).toEqual([20]);
    expect(res.anchorId).toBe(20);
  });

  it('unselects when plain clicking the only selected item', () => {
    const res = applyClickSelection({
      displayedIds: displayed,
      selectedIds: [20],
      anchorId: 20,
      clickedId: 20,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(res.selectedIds).toEqual([]);
    expect(res.anchorId).toBeNull();
  });

  it('performs Shift-click range selection from anchor', () => {
    const step1 = applyClickSelection({
      displayedIds: displayed,
      selectedIds: [],
      anchorId: null,
      clickedId: 20,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(step1.selectedIds).toEqual([20]);
    expect(step1.anchorId).toBe(20);

    const step2 = applyClickSelection({
      displayedIds: displayed,
      selectedIds: step1.selectedIds,
      anchorId: step1.anchorId,
      clickedId: 50,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    });
    expect(step2.selectedIds).toEqual([20, 30, 40, 50]);
    expect(step2.anchorId).toBe(20);
  });

  it('adds additional card using Ctrl after selecting a range with Shift (user problem statement)', () => {
    const step1 = applyClickSelection({
      displayedIds: displayed,
      selectedIds: [],
      anchorId: null,
      clickedId: 20,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    const step2 = applyClickSelection({
      displayedIds: displayed,
      selectedIds: step1.selectedIds,
      anchorId: step1.anchorId,
      clickedId: 50,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    });
    expect(step2.selectedIds).toEqual([20, 30, 40, 50]);

    // User holds Ctrl and clicks on 80 -> [20, 30, 40, 50, 80]
    const step3 = applyClickSelection({
      displayedIds: displayed,
      selectedIds: step2.selectedIds,
      anchorId: step2.anchorId,
      clickedId: 80,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    });
    expect(step3.selectedIds).toEqual([20, 30, 40, 50, 80]);
    expect(step3.anchorId).toBe(80);

    // User holds Ctrl and clicks on 100 -> [20, 30, 40, 50, 80, 100]
    const step4 = applyClickSelection({
      displayedIds: displayed,
      selectedIds: step3.selectedIds,
      anchorId: step3.anchorId,
      clickedId: 100,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    });
    expect(step4.selectedIds).toEqual([20, 30, 40, 50, 80, 100]);
    expect(step4.anchorId).toBe(100);

    // User holds Ctrl and clicks on 30 (unselecting 30 from range) -> [20, 40, 50, 80, 100]
    const step5 = applyClickSelection({
      displayedIds: displayed,
      selectedIds: step4.selectedIds,
      anchorId: step4.anchorId,
      clickedId: 30,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    });
    expect(step5.selectedIds).toEqual([20, 40, 50, 80, 100]);
    expect(step5.anchorId).toBe(30);
  });

  it('unions range with existing selection when Ctrl+Shift is pressed', () => {
    const res = applyClickSelection({
      displayedIds: displayed,
      selectedIds: [10, 20],
      anchorId: 50,
      clickedId: 70,
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    });
    expect(res.selectedIds).toEqual([10, 20, 50, 60, 70]);
    expect(res.anchorId).toBe(50);
  });
});

describe('helper id functions', () => {
  it('rangeIdsOnDisplayed handles forward and backward ranges', () => {
    const list = [1, 2, 3, 4, 5];
    expect(rangeIdsOnDisplayed(list, 2, 4)).toEqual([2, 3, 4]);
    expect(rangeIdsOnDisplayed(list, 4, 2)).toEqual([2, 3, 4]);
    expect(rangeIdsOnDisplayed(list, 2, 2)).toEqual([2]);
    expect(rangeIdsOnDisplayed(list, 99, 100)).toEqual([]);
  });

  it('toggleId adds when absent and removes when present', () => {
    expect(toggleId([1, 2, 3], 4)).toEqual([1, 2, 3, 4]);
    expect(toggleId([1, 2, 3, 4], 3)).toEqual([1, 2, 4]);
  });

  it('unionIds deduplicates ids', () => {
    expect(unionIds([1, 2], [2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('subtractIds removes ids', () => {
    expect(subtractIds([1, 2, 3, 4], [2, 4])).toEqual([1, 3]);
  });

  it('uniqueIds keeps first occurrences', () => {
    expect(uniqueIds([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4]);
  });
});
