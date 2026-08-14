/**
 * Smart Link Resolver Subsystem
 * Unified facade for resolving streaming media (YouTube, TikTok, Terabox, Pinterest, etc.)
 * and cloud direct files (Google Drive, Dropbox, Mediafire) with ultra-high quality tiers.
 */

export * from './types';
export * from './registry';
import { linkResolverRegistry } from './registry';
import type { ResolvedMediaInfo } from './types';

/**
 * Resolves any remote media or cloud file URL into structured metadata and stream quality formats.
 */
export async function resolveRemoteMediaUrl(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo> {
  return linkResolverRegistry.resolve(url, signal);
}
