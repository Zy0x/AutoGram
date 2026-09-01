import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../tauri/platform';

export const JOB_CONFIG_SCHEMA_VERSION = 2 as const;

export interface ForwarderFeatureFlags {
  forwarder_v2: boolean;
  mirror_v1: boolean;
  android_forwarder: boolean;
  cloud_relay: boolean;
  public_api: boolean;
}

export type ForwardMode = 'auto' | 'fast_forward' | 'clean_copy' | 'mirror';
export type JobStateV2 = 'READY' | 'VALIDATING' | 'SCANNING' | 'FILTERING' | 'DEDUPLICATING' | 'DOWNLOADING' | 'PREPARING' | 'UPLOADING' | 'COMMITTING' | 'COMPLETED' | 'PAUSED' | 'WAITING_USER' | 'WAITING_COOLDOWN' | 'UNKNOWN' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED' | 'RECONCILING';
export type TaskStateV2 = 'QUEUED' | 'DOWNLOADING' | 'PREPARING' | 'UPLOADING' | 'COMMITTING' | 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'UNKNOWN' | 'WAITING_USER' | 'CANCELLED';

export interface ForwardEventV2 {
  schema_version: number;
  sequence: number;
  job_id: string;
  execution_id?: string | null;
  task_id?: string | null;
  state: JobStateV2 | string;
  reason_code?: string | null;
  redacted_metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface MirrorMutationV2 {
  schema_version: number;
  source_peer_id: string;
  source_message_id: number;
  kind: string;
  destination_message_id?: number | null;
  payload: Record<string, unknown>;
}

export interface DeviceRelayCommandV1 {
  schema_version: number;
  command_id: string;
  device_id: string;
  job_id: string;
  command: string;
  nonce: string;
  signature: string;
  payload_ciphertext: string;
}

export interface PeerRef {
  account_id: string;
  peer_id: string;
  topic_id?: number | null;
}

export interface MessageTypes {
  text: boolean;
  photo: boolean;
  video: boolean;
  document: boolean;
  audio: boolean;
  voice: boolean;
  sticker: boolean;
  gif: boolean;
  poll: boolean;
  link: boolean;
  service: boolean;
}

export interface JobConfigV2 {
  schema_version: typeof JOB_CONFIG_SCHEMA_VERSION;
  job_id?: string | null;
  revision: number;
  source: PeerRef;
  destination: PeerRef;
  mode: ForwardMode;
  message_types: MessageTypes;
  date_range: { start?: string | null; end?: string | null };
  message_id_start?: number | null;
  message_id_end?: number | null;
  size_range: { min_bytes: number; max_bytes: number };
  keyword?: string | null;
  caption_policy: string;
  attribution_policy: string;
  duplicate_policy: string;
  album_policy: string;
  reply_policy: string;
  restriction_policy: string;
  scan_order: 'oldest_first' | 'newest_first';
  limit: number;
  throttle: Record<string, unknown> | null;
  schedule: Record<string, unknown> | null;
  notification: Record<string, unknown> | null;
}

export async function normalizeJobConfigV2(raw: unknown): Promise<JobConfigV2> {
  if (!detectTauriRuntime()) {
    throw new Error('JobConfigV2 normalization requires the desktop runtime');
  }
  return JSON.parse(await invoke<string>('normalize_job_config_v2', { raw }));
}

export async function getForwarderFeatureFlags(): Promise<ForwarderFeatureFlags> {
  if (!detectTauriRuntime()) {
    return { forwarder_v2: true, mirror_v1: false, android_forwarder: false, cloud_relay: false, public_api: false };
  }
  return invoke<ForwarderFeatureFlags>('forwarder_feature_flags');
}
