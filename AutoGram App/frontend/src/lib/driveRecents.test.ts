import { describe, expect, it } from 'vitest';
import {
  clearDriveRecents,
  drivePeerStorageKey,
  drivePinsStorageKey,
  driveRecentsStorageKey,
  loadDrivePeer,
  loadDrivePins,
  loadDriveRecents,
  pushDriveRecent,
  saveDrivePeer,
  shouldRecordDriveRecent,
  toggleDrivePin,
} from './driveRecents';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    _raw: values,
  };
}

describe('driveRecents session isolation', () => {
  it('keys always include session identity', () => {
    expect(driveRecentsStorageKey('Lavender')).toContain('Lavender');
    expect(driveRecentsStorageKey('Mantan Gadis')).toContain(encodeURIComponent('Mantan Gadis'));
    expect(drivePinsStorageKey('A')).not.toBe(drivePinsStorageKey('B'));
    expect(drivePeerStorageKey('A')).not.toBe(drivePeerStorageKey('B'));
  });

  it('load under session A does not return B entries', () => {
    const store = memoryStorage();
    pushDriveRecent(
      'Lavender',
      { kind: 'chat', id: -1002687813181, label: 'Only Lavender' },
      store
    );
    pushDriveRecent(
      'Mantan Gadis',
      { kind: 'chat', id: -1001111111111, label: 'Only Mantan' },
      store
    );
    const a = loadDriveRecents('Lavender', store);
    const b = loadDriveRecents('Mantan Gadis', store);
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe(-1002687813181);
    expect(b).toHaveLength(1);
    expect(b[0].id).toBe(-1001111111111);
    expect(a[0].label).not.toBe(b[0].label);
  });

  it('switch A→B never reads A recents or peer', () => {
    const store = memoryStorage();
    pushDriveRecent('A', { kind: 'chat', id: 42, label: 'A-chat' }, store);
    saveDrivePeer('A', { kind: 'chat', id: 42 }, store);
    // Simulate UI switch: load only B
    expect(loadDriveRecents('B', store)).toEqual([]);
    expect(loadDrivePeer('B', store)).toEqual({ kind: 'saved', id: null });
    // A still intact for when user switches back
    expect(loadDriveRecents('A', store)[0]?.id).toBe(42);
    expect(loadDrivePeer('A', store).id).toBe(42);
  });

  it('never migrates legacy unscoped recents into a session', () => {
    const store = memoryStorage();
    store.setItem(
      'autogram_drive_recents',
      JSON.stringify([{ kind: 'chat', id: 999, label: 'Poison', at: 1 }])
    );
    expect(loadDriveRecents('NewSession', store)).toEqual([]);
    // Legacy wiped so it cannot be re-read by old code paths
    expect(store.getItem('autogram_drive_recents')).toBeNull();
  });

  it('pins are isolated per session', () => {
    const store = memoryStorage();
    toggleDrivePin('S1', { kind: 'drive', id: 1, label: 'F1' }, store);
    expect(loadDrivePins('S1', store)).toHaveLength(1);
    expect(loadDrivePins('S2', store)).toHaveLength(0);
  });

  it('clearDriveRecents only touches one session', () => {
    const store = memoryStorage();
    pushDriveRecent('X', { kind: 'saved', id: null, label: 'Saved' }, store);
    pushDriveRecent('Y', { kind: 'saved', id: null, label: 'Saved Y' }, store);
    clearDriveRecents('X', store);
    expect(loadDriveRecents('X', store)).toEqual([]);
    expect(loadDriveRecents('Y', store)).toHaveLength(1);
  });

  it('saving peer for B never receives A peer id via isolated keys', () => {
    const store = memoryStorage();
    saveDrivePeer('A', { kind: 'chat', id: -1002687813181 }, store);
    // Simulate correct switch: only load B (handler clears UI; storage stays isolated)
    expect(loadDrivePeer('B', store)).toEqual({ kind: 'saved', id: null });
    saveDrivePeer('B', { kind: 'saved', id: null }, store);
    expect(loadDrivePeer('A', store).id).toBe(-1002687813181);
    expect(loadDrivePeer('B', store)).toEqual({ kind: 'saved', id: null });
  });

  it('shouldRecordDriveRecent blocks foreign PeerChannel for Terbaru', () => {
    const foreign = -1002687813181;
    // Session B only knows its own chats — foreign A peer must not record
    expect(
      shouldRecordDriveRecent({
        session: 'Mantan Gadis',
        locationKind: 'chat',
        peerId: foreign,
        knownPeerIds: [-1001111111111, 0],
      })
    ).toBe(false);
    expect(
      shouldRecordDriveRecent({
        session: 'Mantan Gadis',
        locationKind: 'chat',
        peerId: -1001111111111,
        knownPeerIds: [-1001111111111],
      })
    ).toBe(true);
    expect(
      shouldRecordDriveRecent({
        session: 'Lavender',
        locationKind: 'saved',
        peerId: null,
        knownPeerIds: [],
      })
    ).toBe(true);
    // Empty lists → do not invent foreign labels
    expect(
      shouldRecordDriveRecent({
        session: 'B',
        locationKind: 'chat',
        peerId: foreign,
        knownPeerIds: [],
      })
    ).toBe(false);
  });

  it('A→B switch path: recents for B stay empty when only A peer is known', () => {
    const store = memoryStorage();
    pushDriveRecent(
      'Lavender',
      { kind: 'chat', id: -1002687813181, label: 'A only' },
      store
    );
    // After switch, UI must not call push for foreign id — B list remains empty
    expect(loadDriveRecents('Mantan Gadis', store)).toEqual([]);
    if (
      shouldRecordDriveRecent({
        session: 'Mantan Gadis',
        locationKind: 'chat',
        peerId: -1002687813181,
        knownPeerIds: [], // B chats not loaded / peer not in B
      })
    ) {
      pushDriveRecent(
        'Mantan Gadis',
        { kind: 'chat', id: -1002687813181, label: 'poison' },
        store
      );
    }
    expect(loadDriveRecents('Mantan Gadis', store)).toEqual([]);
    expect(loadDriveRecents('Lavender', store)[0]?.id).toBe(-1002687813181);
  });
});
