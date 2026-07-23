import { describe, expect, it } from 'vitest';
import {
  buildChatSearchIndex,
  filterChatsFast,
  filterFoldersFast,
  matchesSavedMessagesQuery,
  buildFolderTreeRows,
  folderAncestorIds,
  folderDirectChildIds,
  wouldCreateFolderCycle,
  buildDriveBreadcrumbSegments,
  withFolderOrphanFlags,
} from './chatSearch';
import type { DriveChat, DriveFolder } from './driveTypes';

function chat(partial: Partial<DriveChat> & { id: number; name: string }): DriveChat {
  return {
    type: 'user',
    ...partial,
  };
}

describe('chatSearch', () => {
  const list = [
    chat({ id: 1, name: 'Alice', username: 'alice_id' }),
    chat({ id: 2, name: 'Bob Group', type: 'group' }),
    chat({ id: 3, name: 'Channel X', type: 'channel', username: 'chanx' }),
    chat({ id: 4, name: 'TD Photos', is_drive_folder: true }),
    chat({ id: -100123, name: 'Mega Supergroup', type: 'group' }),
  ];

  it('excludes drive folders from index', () => {
    const idx = buildChatSearchIndex(list);
    expect(idx.every((e) => !e.chat.is_drive_folder)).toBe(true);
    expect(idx).toHaveLength(4);
  });

  it('returns all on empty query', () => {
    const idx = buildChatSearchIndex(list);
    expect(filterChatsFast(idx, '')).toHaveLength(4);
    expect(filterChatsFast(idx, '   ')).toHaveLength(4);
  });

  it('matches name case-insensitively', () => {
    const idx = buildChatSearchIndex(list);
    const r = filterChatsFast(idx, 'alice');
    expect(r.map((c) => c.id)).toEqual([1]);
  });

  it('matches username and id', () => {
    const idx = buildChatSearchIndex(list);
    expect(filterChatsFast(idx, 'chanx').map((c) => c.id)).toEqual([3]);
    expect(filterChatsFast(idx, '100123').map((c) => c.id)).toEqual([-100123]);
  });

  it('multi-token AND', () => {
    const idx = buildChatSearchIndex(list);
    expect(filterChatsFast(idx, 'bob group').map((c) => c.id)).toEqual([2]);
    expect(filterChatsFast(idx, 'bob channel')).toHaveLength(0);
  });
});

describe('universal location search', () => {
  const folders: DriveFolder[] = [
    { id: 10, name: 'Gudang Donghua', title_raw: 'Gudang Donghua [TD]' },
    { id: 11, name: 'NSFW Archive', title_raw: 'NSFW [TD]' },
  ];

  it('filters folders by name / title / id', () => {
    expect(filterFoldersFast(folders, 'donghua').map((f) => f.id)).toEqual([10]);
    expect(filterFoldersFast(folders, '11').map((f) => f.id)).toEqual([11]);
    expect(filterFoldersFast(folders, '')).toHaveLength(2);
  });

  it('matches Saved Messages aliases', () => {
    expect(matchesSavedMessagesQuery('')).toBe(true);
    expect(matchesSavedMessagesQuery('saved')).toBe(true);
    expect(matchesSavedMessagesQuery('pesan')).toBe(true);
    expect(matchesSavedMessagesQuery('donghua')).toBe(false);
  });
});

describe('folder tree (folder-in-folder)', () => {
  const nested: DriveFolder[] = [
    { id: 1, name: 'Root A', parent_id: null },
    { id: 2, name: 'Root B', parent_id: null },
    { id: 3, name: 'Child A1', parent_id: 1 },
    { id: 4, name: 'Grand A1a', parent_id: 3 },
    { id: 5, name: 'Orphan', parent_id: 999 },
  ];

  it('builds DFS tree with depths', () => {
    const rows = buildFolderTreeRows(nested, { expandedIds: null });
    // Roots sorted by name: Orphan, Root A (+ kids), Root B
    expect(rows.map((r) => [r.folder.id, r.depth, r.hasChildren])).toEqual([
      [5, 0, false], // orphan → root
      [1, 0, true],
      [3, 1, true],
      [4, 2, false],
      [2, 0, false],
    ]);
  });

  it('respects collapsed parents', () => {
    const rows = buildFolderTreeRows(nested, { expandedIds: new Set([1]) });
    // 1 expanded → shows 3, but 3 not expanded → no 4
    expect(rows.map((r) => r.folder.id)).toEqual([5, 1, 3, 2]);
  });

  it('forceFlat ignores hierarchy', () => {
    const rows = buildFolderTreeRows(nested, { forceFlat: true });
    expect(rows.every((r) => r.depth === 0)).toBe(true);
    expect(rows).toHaveLength(5);
  });

  it('folderAncestorIds walks up', () => {
    expect(folderAncestorIds(nested, 4)).toEqual([3, 1]);
    expect(folderAncestorIds(nested, 1)).toEqual([]);
  });

  it('folderDirectChildIds', () => {
    expect(folderDirectChildIds(nested, 1).sort()).toEqual([3]);
    expect(folderDirectChildIds(nested, 3)).toEqual([4]);
  });

  it('wouldCreateFolderCycle', () => {
    expect(wouldCreateFolderCycle(nested, 1, 4)).toBe(true); // root under grand
    expect(wouldCreateFolderCycle(nested, 4, 2)).toBe(false);
    expect(wouldCreateFolderCycle(nested, 3, 3)).toBe(true);
    expect(wouldCreateFolderCycle(nested, 3, null)).toBe(false);
  });

  it('buildDriveBreadcrumbSegments multi-level', () => {
    const segs = buildDriveBreadcrumbSegments(nested, {
      locationKind: 'drive',
      activePeerId: 4,
    });
    expect(segs.map((s) => s.label)).toEqual(['Start', 'Root A', 'Child A1', 'Grand A1a']);
  });

  it('buildDriveBreadcrumbSegments includes topic segment with topicId', () => {
    const segs = buildDriveBreadcrumbSegments(nested, {
      locationKind: 'chat',
      activePeerId: -100123,
      chats: [{ id: -100123, name: 'Supergroup' }],
      topicTitle: 'General',
      topicId: 1,
    });
    expect(segs).toEqual([
      { id: null, label: 'Start', kind: 'start' },
      { id: -100123, label: 'Supergroup', kind: 'chat' },
      { id: 1, label: 'General', kind: 'topic' },
    ]);
  });

  it('withFolderOrphanFlags', () => {
    const flagged = withFolderOrphanFlags(nested);
    expect(flagged.find((f) => f.id === 5)?.is_orphan).toBe(true);
    expect(flagged.find((f) => f.id === 3)?.is_orphan).toBe(false);
  });
});
