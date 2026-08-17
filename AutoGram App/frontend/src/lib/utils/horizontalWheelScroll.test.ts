import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isHorizontallyScrollable,
  findHorizontalScrollContainer,
  handleHorizontalWheel,
} from './horizontalWheelScroll';

describe('horizontalWheelScroll utility (node env compatible)', () => {
  let mockContainer: any;
  let mockButton: any;
  let mockSvg: any;
  let mockPath: any;

  beforeEach(() => {
    mockContainer = {
      parentElement: null,
      scrollWidth: 600,
      clientWidth: 300,
      scrollHeight: 40,
      clientHeight: 40,
      scrollLeft: 50,
      dataset: {},
    };

    mockButton = {
      parentElement: mockContainer,
      scrollWidth: 80,
      clientWidth: 80,
      scrollHeight: 36,
      clientHeight: 36,
      scrollLeft: 0,
      dataset: {},
    };

    mockSvg = {
      parentElement: mockButton,
      dataset: {},
    };

    mockPath = {
      parentElement: mockSvg,
      dataset: {},
    };

    // Mock window and getComputedStyle
    (globalThis as any).window = {
      getComputedStyle: (el: any) => {
        if (el === mockContainer) {
          return {
            overflowX: 'auto',
            overflowY: 'hidden',
          };
        }
        return {
          overflowX: 'visible',
          overflowY: 'visible',
        };
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects horizontally scrollable element correctly', () => {
    expect(isHorizontallyScrollable(mockContainer as any, 100)).toBe(true);
    expect(isHorizontallyScrollable(mockContainer as any, -100)).toBe(true);
  });

  it('finds closest horizontal scroll container from button child target', () => {
    const found = findHorizontalScrollContainer(mockButton as any, 50);
    expect(found).toBe(mockContainer);
  });

  it('finds closest horizontal scroll container when hovering directly over an SVG icon (<svg>)', () => {
    const found = findHorizontalScrollContainer(mockSvg as any, 50);
    expect(found).toBe(mockContainer);
  });

  it('finds closest horizontal scroll container when hovering directly over an SVG path (<path>)', () => {
    const found = findHorizontalScrollContainer(mockPath as any, 50);
    expect(found).toBe(mockContainer);
  });

  it('handles mouse wheel deltaY when hovering over an SVG icon', () => {
    const initialScroll = mockContainer.scrollLeft;
    const preventDefault = vi.fn();

    const event = {
      target: mockPath,
      deltaY: 60,
      deltaX: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      cancelable: true,
      preventDefault,
    } as unknown as WheelEvent;

    const handled = handleHorizontalWheel(event);
    expect(handled).toBe(true);
    expect(mockContainer.scrollLeft).toBe(initialScroll + 60);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('bypasses when shiftKey or ctrlKey is pressed', () => {
    const eventShift = {
      target: mockPath,
      deltaY: 40,
      deltaX: 0,
      deltaMode: 0,
      shiftKey: true,
      cancelable: true,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    expect(handleHorizontalWheel(eventShift)).toBe(false);

    const eventCtrl = {
      target: mockPath,
      deltaY: 40,
      deltaX: 0,
      deltaMode: 0,
      ctrlKey: true,
      cancelable: true,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    expect(handleHorizontalWheel(eventCtrl)).toBe(false);
  });

  it('bypasses when already at edge boundary in that direction', () => {
    mockContainer.scrollLeft = 0;
    // Trying to scroll up (left) when already at 0
    expect(isHorizontallyScrollable(mockContainer as any, -50)).toBe(false);

    // Can still scroll down (right)
    expect(isHorizontallyScrollable(mockContainer as any, 50)).toBe(true);

    // Set to rightmost edge
    mockContainer.scrollLeft = 300; // scrollWidth (600) - clientWidth (300) = 300
    expect(isHorizontallyScrollable(mockContainer as any, 50)).toBe(false);
    expect(isHorizontallyScrollable(mockContainer as any, -50)).toBe(true);
  });
});
