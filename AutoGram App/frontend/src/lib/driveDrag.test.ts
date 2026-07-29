import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  beginDriveDrag,
  endDriveDrag,
  getActiveDriveDrag,
  isInternalMediaDragActive,
  canAcceptDriveDrop,
  pickDropKeyAtPoint,
  parseDropKey,
  sameDriveLocation,
  isDropKeySameAsSource,
  isExternalOsFileDrag,
  subscribeDriveDragUi,
  setLastOsPaths,
  clearLastOsPaths,
  extractOsPaths,
  getLastOsPaths,
  hasOsFiles,
  normalizeOsPath,
} from './driveDrag';

describe('driveDrag payload', () => {
  beforeEach(() => {
    endDriveDrag();
    clearLastOsPaths();
  });
  afterEach(() => {
    endDriveDrag();
    clearLastOsPaths();
  });

  it('begin/end tracks active payload', () => {
    expect(isInternalMediaDragActive()).toBe(false);
    beginDriveDrag({ messageIds: [1, 2], fromFolderId: null });
    expect(isInternalMediaDragActive()).toBe(true);
    expect(getActiveDriveDrag()?.messageIds).toEqual([1, 2]);
    endDriveDrag();
    expect(isInternalMediaDragActive()).toBe(false);
  });

  it('notifies UI subscribers', () => {
    let n = 0;
    const unsub = subscribeDriveDragUi(() => {
      n += 1;
    });
    beginDriveDrag({ messageIds: [9], fromFolderId: 1 });
    endDriveDrag();
    unsub();
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('canAcceptDriveDrop true when payload active even without DataTransfer types', () => {
    beginDriveDrag({ messageIds: [3], fromFolderId: null });
    const dt = { types: [] } as unknown as DataTransfer;
    expect(canAcceptDriveDrop(dt, false)).toBe(true);
  });

  it('parseDropKey', () => {
    expect(parseDropKey('saved:me')).toEqual({ kind: 'saved', id: null });
    expect(parseDropKey('chat:-1001')).toEqual({ kind: 'chat', id: -1001 });
    expect(parseDropKey('drive:42')).toEqual({ kind: 'drive', id: 42 });
    expect(parseDropKey('nope')).toBeNull();
  });

  it('sameDriveLocation', () => {
    expect(sameDriveLocation(null, null)).toBe(true);
    expect(sameDriveLocation(1, 1)).toBe(true);
    expect(sameDriveLocation(1, 2)).toBe(false);
    expect(sameDriveLocation(null, 1)).toBe(false);
  });

  it('isDropKeySameAsSource', () => {
    expect(isDropKeySameAsSource('saved:me', null)).toBe(true);
    expect(isDropKeySameAsSource('saved:me', 1)).toBe(false);
    expect(isDropKeySameAsSource('chat:-1001', -1001)).toBe(true);
    expect(isDropKeySameAsSource('drive:42', 42)).toBe(true);
    expect(isDropKeySameAsSource('chat:99', 1)).toBe(false);
    expect(isDropKeySameAsSource(null, 1)).toBe(false);
  });

  it('isExternalOsFileDrag false during internal media drag', () => {
    beginDriveDrag({ messageIds: [1], fromFolderId: null });
    const dt = { types: ['Files', 'text/plain'] } as unknown as DataTransfer;
    expect(isExternalOsFileDrag(dt)).toBe(false);
    endDriveDrag();
    expect(isExternalOsFileDrag(dt)).toBe(true);
  });
});

describe('OS paths cache', () => {
  beforeEach(() => clearLastOsPaths());
  afterEach(() => clearLastOsPaths());

  it('setLastOsPaths filters and dedupes', () => {
    setLastOsPaths(['C:\\a\\b.jpg', 'C:\\a\\b.jpg', 'not-a-path', '/home/u/x.png', '']);
    expect(getLastOsPaths()).toEqual(['C:\\a\\b.jpg', '/home/u/x.png']);
  });

  it('extractOsPaths prefers cached Tauri paths over empty File list', () => {
    setLastOsPaths(['D:\\media\\clip.mp4']);
    const dt = { types: ['Files'], files: [] } as unknown as DataTransfer;
    expect(extractOsPaths(dt)).toEqual(['D:\\media\\clip.mp4']);
    expect(hasOsFiles(dt)).toBe(true);
  });

  it('extractOsPaths reads File.path when present', () => {
    clearLastOsPaths();
    const file = { name: 'a.jpg', path: 'C:\\Users\\x\\a.jpg' } as File & { path: string };
    const dt = { types: ['Files'], files: [file] } as unknown as DataTransfer;
    expect(extractOsPaths(dt)).toEqual(['C:\\Users\\x\\a.jpg']);
  });

  it('normalizeOsPath handles file:// and long-path prefixes', () => {
    expect(normalizeOsPath('file:///C:/Users/me/a.mp4').toLowerCase()).toContain('users');
    expect(normalizeOsPath('\\\\?\\C:\\Temp\\x.bin')).toBe('C:\\Temp\\x.bin');
    expect(normalizeOsPath('"D:\\clip.mp4"')).toBe('D:\\clip.mp4');
  });

  it('setLastOsPaths merges successive enter/over batches', () => {
    clearLastOsPaths();
    setLastOsPaths(['C:\\a\\1.jpg']);
    setLastOsPaths(['C:\\a\\2.jpg']);
    expect(getLastOsPaths()).toEqual(['C:\\a\\1.jpg', 'C:\\a\\2.jpg']);
  });
});

describe('pickDropKeyAtPoint geometry', () => {
  it('hits the correct row by Y (stubbed nodes)', () => {
    // Lightweight stub without requiring jsdom document global
    const mk = (key: string, left: number, top: number, w: number, h: number) => {
      const el = {
        getAttribute: (n: string) => (n === 'data-drop-key' ? key : null),
        getBoundingClientRect: () => ({
          left,
          top,
          right: left + w,
          bottom: top + h,
          width: w,
          height: h,
          x: left,
          y: top,
        }),
      };
      return el as unknown as HTMLElement;
    };
    const nodes = [mk('saved:me', 0, 0, 200, 40), mk('chat:11', 0, 50, 200, 40), mk('chat:22', 0, 100, 200, 40)];
    const root = {
      querySelectorAll: () => nodes as unknown as NodeListOf<Element>,
    } as unknown as Element;

    expect(pickDropKeyAtPoint(20, 20, root)).toBe('saved:me');
    expect(pickDropKeyAtPoint(20, 70, root)).toBe('chat:11');
    expect(pickDropKeyAtPoint(20, 120, root)).toBe('chat:22');
    expect(pickDropKeyAtPoint(20, 400, root)).toBeNull();
    // pad=14 → just above chat:11 (top=50)
    expect(pickDropKeyAtPoint(20, 46, root)).toBe('chat:11');
  });
});
