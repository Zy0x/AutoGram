import { describe, it, expect } from 'vitest';
import { detectTauriRuntime, resolveRuntime, type PlatformDeps } from './platform';
import { hasCapability, isMediaStudioAvailable, capabilitiesFor } from './capabilities';

function deps(partial: Partial<PlatformDeps> & { isTauri: () => boolean }): PlatformDeps {
  return {
    viteRuntime: partial.viteRuntime,
    isTauri: partial.isTauri,
  };
}

describe('resolveRuntime / platform gates', () => {
  it('accepts the Tauri IPC marker when the global flag is unavailable', () => {
    const root = globalThis as typeof globalThis & {
      __TAURI_INTERNALS__?: { invoke?: () => void };
    };
    const previous = root.__TAURI_INTERNALS__;
    root.__TAURI_INTERNALS__ = { invoke: () => undefined };
    try {
      expect(detectTauriRuntime()).toBe(true);
    } finally {
      if (previous) root.__TAURI_INTERNALS__ = previous;
      else delete root.__TAURI_INTERNALS__;
    }
  });
  // A1: Env force web wins even if isTauri true
  it('A1: VITE_RUNTIME=web forces web even when isTauri=true', () => {
    const rt = resolveRuntime(deps({ viteRuntime: 'web', isTauri: () => true }));
    expect(rt).toBe('web');
    expect(hasCapability('media_studio.reencode', rt)).toBe(false);
    expect(isMediaStudioAvailable(rt)).toBe(false);
  });

  // A2: Env force desktop wins even if isTauri false
  it('A2: VITE_RUNTIME=desktop forces desktop even when isTauri=false', () => {
    const rt = resolveRuntime(deps({ viteRuntime: 'desktop', isTauri: () => false }));
    expect(rt).toBe('desktop');
    expect(hasCapability('media_studio.upload', rt)).toBe(true);
  });

  // A3: Tauri detection without env
  it('A3: no env + isTauri=true → desktop + Media Studio ON', () => {
    const rt = resolveRuntime(deps({ viteRuntime: undefined, isTauri: () => true }));
    expect(rt).toBe('desktop');
    expect(isMediaStudioAvailable(rt)).toBe(true);
    expect(hasCapability('jobs.migration', rt)).toBe(true);
  });

  // A4: Pure browser
  it('A4: no env + isTauri=false → web + media_studio OFF, view_status ON', () => {
    const rt = resolveRuntime(deps({ viteRuntime: '', isTauri: () => false }));
    expect(rt).toBe('web');
    expect(hasCapability('media_studio.upload', rt)).toBe(false);
    expect(hasCapability('media_studio.reencode', rt)).toBe(false);
    expect(hasCapability('media_studio.speed_lab', rt)).toBe(false);
    expect(hasCapability('jobs.view_status', rt)).toBe(true);
    expect(hasCapability('settings.api_local', rt)).toBe(false);
  });

  it('treats VITE_RUNTIME case-insensitively and trims', () => {
    expect(resolveRuntime(deps({ viteRuntime: ' Web ', isTauri: () => true }))).toBe('web');
    expect(resolveRuntime(deps({ viteRuntime: 'DESKTOP', isTauri: () => false }))).toBe('desktop');
  });
});

describe('capabilities matrix', () => {
  // A5
  it('A5: web matrix — reencode off', () => {
    expect(hasCapability('media_studio.reencode', 'web')).toBe(false);
    const caps = capabilitiesFor('web');
    expect(caps['media_studio.upload']).toBe(false);
    expect(caps['media_studio.speed_lab']).toBe(false);
    expect(caps['jobs.view_status']).toBe(true);
    expect(caps['auth.supabase']).toBe(true);
  });

  // A6
  it('A6: desktop matrix — reencode/upload/speed_lab on', () => {
    expect(hasCapability('media_studio.reencode', 'desktop')).toBe(true);
    expect(hasCapability('media_studio.upload', 'desktop')).toBe(true);
    expect(hasCapability('media_studio.speed_lab', 'desktop')).toBe(true);
    expect(hasCapability('jobs.migration', 'desktop')).toBe(true);
    expect(hasCapability('settings.api_local', 'desktop')).toBe(true);
  });
});
