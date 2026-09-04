import { invoke } from '@tauri-apps/api/core';
import type { RemoteEngineMode } from '../telegram/driveTypes';

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
