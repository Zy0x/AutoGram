import { describe, expect, it } from 'vitest';
import {
  dedupeSessionOptionsByIdentity,
  hasStableSessionIdentity,
  verifySessionOptions,
  sessionInventoryStatus,
  preserveVerifiedSessionStatus,
  type SessionMetadata,
  type SessionOption,
} from './sessionPicker';

describe('session identity de-duplication', () => {
  it('collapses aliases of the same Telegram account and prefers the native connected session', () => {
    const sessions: SessionOption[] = [
      { name: 'Lavender', status: 'checking' },
      { name: 'session_1785668521', status: 'connected' },
      { name: 'Thea', status: 'connected' },
    ];
    const metadata: Record<string, SessionMetadata> = {
      Lavender: { telegramUserId: '8542241823', userFullName: 'Lavender' },
      session_1785668521: { telegramUserId: '8542241823', userFullName: 'Lavender', username: 'lv_drr' },
      Thea: { telegramUserId: '862678085', userFullName: 'Thea' },
    };
    const result = dedupeSessionOptionsByIdentity(sessions, (name) => metadata[name] || null);
    expect(result.map((item) => item.name)).toEqual(['session_1785668521', 'Thea']);
  });

  it('keeps unverified session files separate until a stable Telegram user id exists', () => {
    const sessions: SessionOption[] = [
      { name: 'one', status: 'checking' },
      { name: 'two', status: 'checking' },
    ];
    expect(dedupeSessionOptionsByIdentity(sessions, () => null)).toHaveLength(2);
  });

  it('does not paint an unverified legacy alias as a launcher account', () => {
    const metadata: Record<string, SessionMetadata> = {
      session_1785668521: { telegramUserId: '8542241823' },
    };
    expect(hasStableSessionIdentity(
      { name: 'Lavender', status: 'checking' },
      (name) => metadata[name] || null
    )).toBe(false);
    expect(hasStableSessionIdentity(
      { name: 'session_1785668521', status: 'checking' },
      (name) => metadata[name] || null
    )).toBe(true);
  });
});

describe('bounded session health verification', () => {
  it('keeps checking other sessions when one health probe fails', async () => {
    const sessions: SessionOption[] = [
      { name: 'one', status: 'checking' },
      { name: 'two', status: 'checking' },
      { name: 'three', status: 'checking' },
    ];
    const result = await verifySessionOptions(
      sessions,
      123,
      'hash',
      async ({ session }) => {
        if (session === 'two') throw new Error('temporary network error');
        return { ok: true, data: { authorized: true } } as any;
      },
      { concurrency: 2, timeoutMs: 1_000 }
    );
    expect(result.map((item) => item.status)).toEqual(['connected', 'offline', 'connected']);
  });

  it('does not run more health probes than the configured concurrency', async () => {
    let active = 0;
    let maximum = 0;
    const sessions = Array.from({ length: 7 }, (_, index) => ({
      name: `session-${index}`,
      status: 'checking',
    }));
    await verifySessionOptions(
      sessions,
      123,
      'hash',
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: true, data: { authorized: true } } as any;
      },
      { concurrency: 2, timeoutMs: 1_000 }
    );
    expect(maximum).toBe(2);
  });
});

describe('instant session inventory status', () => {
  it('shows a stale healthy session as last-known while live verification runs', () => {
    expect(sessionInventoryStatus(
      'checking',
      { status: 'connected', checkedAt: 1_000 },
      1_000 + 16 * 60 * 1_000
    )).toBe('connected_stale');
  });

  it('keeps a fresh verified status and does not invent health without evidence', () => {
    expect(sessionInventoryStatus(
      'checking',
      { status: 'connected', checkedAt: 1_000 },
      1_500
    )).toBe('connected');
    expect(sessionInventoryStatus('checking', null, 1_500)).toBe('checking');
  });

  it('does not let an offline inventory refresh overwrite a verified live result', () => {
    expect(preserveVerifiedSessionStatus(
      [{ name: 'one', status: 'checking' }],
      [{ name: 'one', status: 'connected', latencyMs: 42 }]
    )).toEqual([{ name: 'one', status: 'connected', latencyMs: 42 }]);
  });
});
