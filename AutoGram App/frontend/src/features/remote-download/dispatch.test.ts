import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchRemoteDestination } from './dispatch';
import { startLocalDownloads } from './service';
import { open } from '@tauri-apps/plugin-dialog';
vi.mock('./service', () => ({ startLocalDownloads: vi.fn().mockResolvedValue(true) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../../lib/telegram/driveTransferSettings', () => ({ loadTransferSettings: () => ({ downloadConcurrency: 6 }) }));
describe('remote destination routing', () => {
  beforeEach(() => vi.clearAllMocks());
  it('sends Local to the native downloader, never the Telegram callback', async () => {
    const upload = vi.fn();
    await dispatchRemoteDestination(['https://example.com/video'], { id: 'me' }, {
      storagePolicy: 'custom_disk', customDiskPath: 'F:\\Downloads', customFilenames: ['4k.mp4'],
      remoteMuxes: [{ videoUrl: 'https://example.com/video', audioUrl: 'https://example.com/audio', outputExt: 'mp4' }],
    }, upload);
    expect(upload).not.toHaveBeenCalled();
    expect(startLocalDownloads).toHaveBeenCalledWith([expect.objectContaining({ filename: '4k.mp4', directory: 'F:\\Downloads', connections: 6, mux: expect.objectContaining({ outputExt: 'mp4' }) })]);
  });
  it('does not start anything when the directory picker is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null);
    const upload = vi.fn();
    expect(await dispatchRemoteDestination(['https://example.com/video'], {}, { storagePolicy: 'custom_disk' }, upload)).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(startLocalDownloads).not.toHaveBeenCalled();
  });
  it('preserves the existing Telegram route for Telegram destination', async () => {
    const upload = vi.fn().mockResolvedValue(true);
    await dispatchRemoteDestination(['https://example.com/video'], {}, { storagePolicy: 'telegram' }, upload);
    expect(upload).toHaveBeenCalledOnce();
    expect(startLocalDownloads).not.toHaveBeenCalled();
  });
});
