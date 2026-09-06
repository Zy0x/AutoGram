import { open } from '@tauri-apps/plugin-dialog';
import { loadTransferSettings } from '../../lib/telegram/driveTransferSettings';
import type { RemoteMuxSpec } from '../../lib/telegram/linkResolvers';
import { startLocalDownloads } from './service';

interface DestinationOptions {
  storagePolicy?: string; customDiskPath?: string; customFilename?: string;
  customFilenames?: string[]; remoteMuxes?: Array<RemoteMuxSpec | null>;
}

/** Destination policy wins over transport preference. Never pass Local to Telegram. */
export async function dispatchRemoteDestination<TDest, TOptions extends DestinationOptions>(
  urls: string[], destination: TDest, options: TOptions,
  upload: (urls: string[], dest: TDest, options: TOptions) => Promise<boolean | void>,
) {
  if (options.storagePolicy !== 'custom_disk') {
    if (options.remoteMuxes?.some(m => m?.transcodeVideo)) throw new Error('remote_download_local_required');
    return upload(urls, destination, options);
  }
  let directory = options.customDiskPath?.trim();
  if (!directory) {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== 'string') return false;
    directory = selected;
  }
  return startLocalDownloads(urls.map((url, index) => ({
    url, directory,
    filename: options.customFilenames?.[index] || (urls.length === 1 ? options.customFilename : undefined) || 'media.bin',
    connections: loadTransferSettings().downloadConcurrency,
    mux: options.remoteMuxes?.[index],
  })));
}
