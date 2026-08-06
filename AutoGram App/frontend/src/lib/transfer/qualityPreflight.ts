import { invoke } from '@tauri-apps/api/core';

export type PreflightTransform = 'pass_through' | 'lossless_remux' | 'reencode';
export type PreflightPayload = 'native_visual' | 'document_group' | 'audio_group' | 'original_document_batch' | 'split_part_batch';

export interface QualityPreflightItem {
  index: number;
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
}

export interface QualityPreflightRequest {
  session: string;
  apiId: number;
  apiHash: string;
  paths: string[];
  qualityMode: string;
  presentationOverride: string;
  groupAsAlbum: boolean;
  oversizeAction: string;
  globalCaption?: string;
  captionOverflowPolicy: 'truncate_with_warning' | 'fail' | 'split';
}

export function runQualityPreflight(request: QualityPreflightRequest): Promise<QualityPreflightReport> {
  return invoke<QualityPreflightReport>('quality_preflight', { request });
}
