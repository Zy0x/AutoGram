/**
 * TikTok Link Resolver Façade
 * Decomposed into modular domain-first architecture: ./tiktok
 * - types.ts: TikTok metadata & audio status interfaces
 * - audioInspector.ts: Audio stream verification, copyright detection, and auto-remuxing
 * - profileResolver.ts: Creator profile handler & 1080x1080 avatar extraction
 * - videoResolver.ts: HD no-watermark video & photo slideshow extraction
 */

export * from './tiktok';
export { tiktokResolver } from './tiktok';
