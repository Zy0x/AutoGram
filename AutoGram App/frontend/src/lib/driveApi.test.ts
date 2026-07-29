import { describe, it, expect } from 'vitest';
import {
  isSessionLockError,
  isPeerEntityError,
  friendlyDriveError,
} from './driveApi';

describe('session lock helpers', () => {
  it('T1.2: detects database is locked', () => {
    expect(isSessionLockError(new Error('database is locked'))).toBe(true);
    expect(isSessionLockError('sqlite OperationalError: database is locked')).toBe(true);
    expect(isSessionLockError(new Error('FloodWait 30'))).toBe(false);
  });

  it('friendly message for lock', () => {
    const msg = friendlyDriveError(new Error('database is locked'));
    expect(msg.toLowerCase()).toContain('session');
    expect(msg.toLowerCase()).not.toContain('database is locked');
  });

  it('silences expected stale media-stat cancellation', () => {
    expect(
      friendlyDriveError(new Error('Media stats superseded by newer location'))
    ).toBe('');
  });

  it('maps PeerChannel cross-session errors to clear Indonesian guidance', () => {
    const raw =
      'Could not find the input entity for PeerChannel(channel_id=2687813181) (PeerChannel)';
    expect(isPeerEntityError(new Error(raw))).toBe(true);
    const msg = friendlyDriveError(new Error(raw));
    expect(msg.toLowerCase()).toContain('session');
    expect(msg).not.toContain('telethon.dev');
  });

  it('still detects peer errors after friendlyDriveError wrap (runDrive path)', () => {
    const raw =
      'Could not find the input entity for PeerChannel(channel_id=2687813181) (PeerChannel)';
    const friendly = friendlyDriveError(new Error(raw));
    const wrapped = new Error(friendly);
    (wrapped as any).raw = raw;
    (wrapped as any).cause = new Error(raw);
    expect(isPeerEntityError(wrapped)).toBe(true);
    // Even message-only friendly string must match
    expect(isPeerEntityError(new Error(friendly))).toBe(true);
  });

  it('warm-path recovery condition: PeerChannel always classifies for gen-guarded reset', () => {
    // Mirrors SpeedTest warm .catch: isPeerEntityError → recoverInvalidPeerLocation
    const warmCaught = new Error(
      'Could not find the input entity for PeerChannel(channel_id=2687813181)'
    );
    expect(isPeerEntityError(warmCaught)).toBe(true);
    const afterFriendly = new Error(friendlyDriveError(warmCaught));
    expect(isPeerEntityError(afterFriendly)).toBe(true);
  });
});
