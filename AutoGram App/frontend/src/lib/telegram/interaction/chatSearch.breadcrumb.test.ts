import { describe, expect, it } from 'vitest';
import { buildDriveBreadcrumbSegments } from './chatSearch';

describe('drive breadcrumb authoritative names', () => {
  it('prefers the live Telegram dialog title over a stale folder cache title', () => {
    const result = buildDriveBreadcrumbSegments(
      [{ id: -1001, name: 'Old cached title', parent_id: null } as any],
      {
        locationKind: 'drive',
        activePeerId: -1001,
        chats: [{ id: -1001, name: 'Current Telegram title' }],
      }
    );
    expect(result[result.length - 1]?.label).toBe('Current Telegram title');
  });

  it('uses the known Drive title when a peer is opened through the chat view', () => {
    const result = buildDriveBreadcrumbSegments(
      [{ id: -1002447029067, name: 'Telegram Drive Title', parent_id: null } as any],
      {
        locationKind: 'chat',
        activePeerId: -1002447029067,
        chats: [],
      }
    );
    expect(result[result.length - 1]?.label).toBe('Telegram Drive Title');
  });

  it('still prefers the latest live dialog title over the cached Drive title', () => {
    const result = buildDriveBreadcrumbSegments(
      [{ id: -1002447029067, name: 'Cached Drive Title', parent_id: null } as any],
      {
        locationKind: 'chat',
        activePeerId: -1002447029067,
        chats: [{ id: -1002447029067, name: 'Current Telegram Title' }],
      }
    );
    expect(result[result.length - 1]?.label).toBe('Current Telegram Title');
  });

  it('keeps the Telegram title when a persisted dialog id is string-shaped', () => {
    const result = buildDriveBreadcrumbSegments(
      [],
      {
        locationKind: 'chat',
        activePeerId: -1002447029067,
        chats: [{ id: '-1002447029067' as unknown as number, name: 'Telegram title' }],
      }
    );
    expect(result[result.length - 1]?.label).toBe('Telegram title');
  });
});
