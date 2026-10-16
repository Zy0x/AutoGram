import { invoke } from '@tauri-apps/api/core';
import type { RemoteEngineMode } from '../telegram/driveTypes';
import type { StorageLocalPolicy } from '../telegram/driveTransferSettings';

export type PreflightTransform = 'pass_through' | 'lossless_remux' | 'reencode' | 'convert_webp_png';
export type PreflightPayload = 'native_visual' | 'document_group' | 'audio_group' | 'original_document_batch' | 'split_part_batch';

export interface QualityPreflightDuplicateMatch {
  matchLevel: 'exact_sha256' | 'probable_filename_size';
  telegramMessageId: number | null;
  telegramUniqueId: string | null;
  existingName: string;
  existingSize: number;
  existingPayloadClass: string;
  destinationId: string;
  topicId: number | null;
}

export interface QualityPreflightItem {
  index: number;
  sourcePath: string;
  sourceName: string;
  sourceSize: number;
  category: string;
  transform: PreflightTransform;
  payloadClass: PreflightPayload;
  asDocument: boolean;
  albumEligible: boolean;
  reasonCode: string;
  warnings: string[];
  rejectedAlternatives: string[];
  requiresConfirmation: boolean;
  duplicateMatch: QualityPreflightDuplicateMatch | null;
  thumbnailUrl?: string | null;
}

export interface QualityPreflightReport {
  schemaVersion: number;
  capabilitySource: 'live' | 'cached' | 'fallback';
  engineMode: 'v4' | 'safe_rollback';
  effectiveMaxBytes: number;
  captionLimit: number;
  captionLengthUtf16: number;
  captionSummaryIndex: number | null;
  captionWarnings: string[];
  hasBlockingIssues: boolean;
  items: QualityPreflightItem[];
  requiresConfirmation: boolean;
  albumIsProvisional: boolean;
  transformConvertCount?: number;
  transformReencodeCount?: number;
  albumGridSize: number;
  plannedAlbumSizes: number[];
  remoteEngineMode?: RemoteEngineMode;
  storagePolicy?: StorageLocalPolicy;
  batchChunks?: import('./transferBatchChunker').BatchChunk[];
  activeChunkIndex?: number;
  totalMassiveCount?: number;
}

export interface QualityPreflightRequest {
  session: string;
  apiId: number;
  apiHash: string;
  paths: string[];
  customFilenames?: string[];
  sourceSizes?: number[];
  thumbnailUrls?: string[];
  qualityMode: string;
  presentationOverride: string;
  groupAsAlbum: boolean;
  albumGroupSize: number;
  albumAvoidSingle: boolean;
  duplicatePolicy: 'SKIP' | 'FORCE_UPLOAD';
  oversizeAction: string;
  globalCaption?: string;
  captionOverflowPolicy: 'truncate_with_warning' | 'fail' | 'split';
  destinationId: string;
  topicId?: number | null;
  preventStickerConversion?: boolean;
  albumIncompatImageMode?: string;
  albumIncompatAnimMode?: string;
  videoTranscodeScope?: string;
  imageTranscodeScope?: string;
  albumPacking?: string;
}

export type TransferDuplicateChoice = 'skip' | 'upload';

export interface PreflightReviewDecision {
  approved: boolean;
  skippedPaths: string[];
  forceUploadPaths: string[];
}

export function runQualityPreflight(request: QualityPreflightRequest): Promise<QualityPreflightReport> {
  return invoke<QualityPreflightReport>('quality_preflight', { request });
}

export function isPreflightItemOversize(
  item: QualityPreflightItem,
  report: QualityPreflightReport
): boolean {
  const isCloud = (report.storagePolicy || 'telegram') !== 'custom_disk';
  return isCloud && (report.effectiveMaxBytes || 0) > 0 && item.sourceSize > report.effectiveMaxBytes;
}

export function getPreflightOversizeCount(report: QualityPreflightReport): number {
  const isCloud = (report.storagePolicy || 'telegram') !== 'custom_disk';
  if (!isCloud || !report.effectiveMaxBytes) return 0;
  return report.items.filter((it) => it.sourceSize > report.effectiveMaxBytes).length;
}

const OPTIMISTIC_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp', 'flv', 'ts']);
const OPTIMISTIC_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'avif']);
const OPTIMISTIC_AUDIO_EXTS = new Set(['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac']);

export function createOptimisticPreflightReport(
  paths: string[],
  names: string[],
  sourceSizes?: number[],
  thumbnailUrls?: string[],
  remoteEngineMode?: RemoteEngineMode,
  storagePolicy?: StorageLocalPolicy,
  batchChunks?: import('./transferBatchChunker').BatchChunk[],
  totalMassiveCount?: number
): QualityPreflightReport {
  // Ultra-fast path: For massive batches (e.g. 17k items), only map the first chunk (1,500 items)
  // to achieve instant dialog mounting (< 5ms) instead of blocking the main thread mapping all 17k.
  const hasMultipleChunks = Boolean(batchChunks && batchChunks.length > 1);
  const targetPaths = hasMultipleChunks && batchChunks![0]?.paths ? batchChunks![0].paths : paths;
  const targetNames = hasMultipleChunks && batchChunks![0]?.names ? batchChunks![0].names : names;
  const targetSizes = hasMultipleChunks && batchChunks![0]?.sourceSizes ? batchChunks![0].sourceSizes : sourceSizes;
  const targetThumbs = hasMultipleChunks && batchChunks![0]?.thumbnailUrls ? batchChunks![0].thumbnailUrls : thumbnailUrls;

  const items: QualityPreflightItem[] = targetPaths.map((p, idx) => {
    const name = (targetNames && targetNames[idx]) ? targetNames[idx] : p.split(/[/\\]/).pop() || p;
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const isVid = OPTIMISTIC_VIDEO_EXTS.has(ext);
    const isImg = OPTIMISTIC_IMAGE_EXTS.has(ext);
    const isAud = OPTIMISTIC_AUDIO_EXTS.has(ext);
    const category = isVid ? 'mp4_video' : isImg ? (ext === 'png' ? 'png_image' : 'jpeg_image') : isAud ? 'audio' : 'unknown_binary';
    const payloadClass: PreflightPayload = isVid || (isImg && ext !== 'png') ? 'native_visual' : isAud ? 'audio_group' : 'document_group';
    return {
      index: idx,
      sourcePath: p,
      sourceName: name,
      sourceSize: (targetSizes && targetSizes[idx]) ? targetSizes[idx] : 0,
      category,
      transform: 'pass_through',
      payloadClass,
      asDocument: payloadClass === 'document_group',
      albumEligible: payloadClass === 'native_visual' || payloadClass === 'audio_group',
      reasonCode: 'optimistic_preflight_loading',
      warnings: [],
      rejectedAlternatives: [],
      requiresConfirmation: false,
      duplicateMatch: null,
      thumbnailUrl: (targetThumbs && targetThumbs[idx]) || null,
    };
  });

  return {
    schemaVersion: 4,
    capabilitySource: 'cached',
    engineMode: 'v4',
    effectiveMaxBytes: 2147483648,
    captionLimit: 1024,
    captionLengthUtf16: 0,
    captionSummaryIndex: null,
    captionWarnings: [],
    hasBlockingIssues: false,
    items,
    requiresConfirmation: false,
    albumIsProvisional: false,
    albumGridSize: 10,
    plannedAlbumSizes: [],
    remoteEngineMode: remoteEngineMode || 'auto',
    storagePolicy: storagePolicy || 'telegram',
    batchChunks,
    activeChunkIndex: hasMultipleChunks ? 0 : undefined,
    totalMassiveCount: totalMassiveCount || paths.length,
  };
}
