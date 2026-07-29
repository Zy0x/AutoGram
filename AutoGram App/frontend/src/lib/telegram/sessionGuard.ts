/**
 * Session activity guard — keeps Media Studio / Jobs / preview / transfer
 * from dual-opening exclusive workers on the same Telegram session.
 *
 * Shared purposes coexist on the Grammers pool. Exclusive (Telethon worker,
 * force-login) waits until shared work releases.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

export type SessionPurpose =
  | 'studio'
  | 'migration'
  | 'preview'
  | 'transfer'
  | 'exclusive';

export type SessionActivity = {
  session: string;
  ownerId: string;
  purpose: string;
  acquiredAtMs: number;
};

export type SessionGuardSnapshot = {
  session: string;
  activities: SessionActivity[];
  exclusive: boolean;
};

export async function sessionGuardAcquire(
  session: string,
  ownerId: string,
  purpose: SessionPurpose
): Promise<SessionActivity | null> {
  if (!isTauri() || !session.trim() || !ownerId.trim()) return null;
  return invoke<SessionActivity>('session_guard_acquire', {
    session: session.trim(),
    ownerId: ownerId.trim(),
    purpose,
  });
}

export async function sessionGuardRelease(
  session: string,
  ownerId: string
): Promise<boolean> {
  if (!isTauri() || !session.trim() || !ownerId.trim()) return false;
  try {
    return await invoke<boolean>('session_guard_release', {
      session: session.trim(),
      ownerId: ownerId.trim(),
    });
  } catch {
    return false;
  }
}

export async function sessionGuardSnapshot(
  session: string
): Promise<SessionGuardSnapshot | null> {
  if (!isTauri() || !session.trim()) return null;
  try {
    return await invoke<SessionGuardSnapshot>('session_guard_snapshot', {
      session: session.trim(),
    });
  } catch {
    return null;
  }
}

/** RAII-style helper for async scopes. */
export async function withSessionGuard<T>(
  session: string,
  ownerId: string,
  purpose: SessionPurpose,
  fn: () => Promise<T>
): Promise<T> {
  await sessionGuardAcquire(session, ownerId, purpose);
  try {
    return await fn();
  } finally {
    await sessionGuardRelease(session, ownerId);
  }
}
