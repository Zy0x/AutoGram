/**
 * Smart Link Resolver Subsystem
 * Unified facade for resolving streaming media (YouTube, TikTok, Terabox, Pinterest, etc.)
 * and cloud direct files (Google Drive, Dropbox, Mediafire) with ultra-high quality tiers.
 */

export * from './types';
export * from './registry';
export * from './shareInput';
export * from './urlSafety';
import { linkResolverRegistry } from './registry';
import type { ResolvedMediaInfo, ResolveOptions } from './types';

/**
 * Resolves any remote media or cloud file URL into structured metadata and stream quality formats.
 */
export async function resolveRemoteMediaUrl(
  url: string,
  signal?: AbortSignal,
  options?: ResolveOptions
): Promise<ResolvedMediaInfo> {
  return linkResolverRegistry.resolve(url, signal, options);
}
