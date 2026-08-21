import { describe, expect, it } from 'vitest';
import {
  dedupeSessionOptionsByIdentity,
  hasStableSessionIdentity,
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
