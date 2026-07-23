/**
 * Hybrid Rust backend helpers — prefer these for local work (no Python).
 * Telegram network work still goes through driveApi / Python worker.
 */
import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from './platform';

export type BackendOwner = 'rust' | 'python' | 'hybrid';

export type CapabilityEntry = {
  id: string;
  owner: BackendOwner;
  description: string;
};

export type StreamingConfig = {
  layer: string;
  firstPlay: number;
  initialHead: number;
  windowSize: number;
  throttleAhead: number;
  workers: number;
  chunkSize: number;
};

export type LocalDocPreview = {
  path: string;
  mimeType: string;
  size: number;
  previewKind: string;
  textContent?: string | null;
  backend: string;
};

export async function fetchBackendCapabilities(): Promise<CapabilityEntry[]> {
  if (!detectTauriRuntime()) return [];
  try {
    return await invoke<CapabilityEntry[]>('backend_capabilities');
  } catch {
    return [];
  }
}

export async function fetchStreamingConfig(totalSize: number): Promise<StreamingConfig | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke<StreamingConfig>('streaming_config_for_size', {
      totalSize: Math.max(0, Math.floor(totalSize)),
    });
  } catch {
    return null;
  }
}

/**
 * Read text/code/office body from a local cache path via Rust (no Telethon).
 * Returns null if not desktop, path missing, or Rust rejects type.
 */
export async function previewLocalDocument(path: string): Promise<LocalDocPreview | null> {
  if (!detectTauriRuntime() || !path) return null;
  try {
    return await invoke<LocalDocPreview>('preview_local_document', { path });
  } catch {
    return null;
  }
}

export async function pathPolicyCheck(path: string): Promise<boolean> {
  if (!detectTauriRuntime() || !path) return false;
  try {
    return await invoke<boolean>('path_policy_check', { path });
  } catch {
    return false;
  }
}

export async function streamServerPort(): Promise<number> {
  if (!detectTauriRuntime()) return 0;
  try {
    return await invoke<number>('stream_server_port');
  } catch {
    return 0;
  }
}

export async function streamStatusLocal(streamId: string) {
  if (!detectTauriRuntime() || !streamId) return null;
  try {
    return await invoke('stream_status_local', { streamId });
  } catch {
    return null;
  }
}

export async function streamRegisterLocal(
  path: string,
  opts?: { totalSize?: number; mime?: string; label?: string }
) {
  if (!detectTauriRuntime() || !path) return null;
  try {
    return await invoke<{ streamId: string; streamUrl: string; port: number; backend: string }>(
      'stream_register_local',
      {
        path,
        totalSize: opts?.totalSize ?? null,
        mime: opts?.mime ?? null,
        label: opts?.label ?? null,
      }
    );
  } catch {
    return null;
  }
}

export type ZipEntry = {
  name: string;
  size: number;
  compressedSize: number;
  isDir: boolean;
  method: number;
};

export type ZipListResult = {
  entries: ZipEntry[];
  count: number;
  truncated: boolean;
  totalEntries: number;
  totalUncompressed: number;
  archiveSize: number;
  source: string;
  backend: string;
};

export type ZipEntryPreview = {
  name: string;
  size: number;
  textContent?: string | null;
  dataUrl?: string | null;
  mimeType?: string | null;
  isBinary: boolean;
  encrypted: boolean;
  backend: string;
};

export async function zipListLocal(path: string): Promise<ZipListResult | null> {
  if (!detectTauriRuntime() || !path) return null;
  try {
    return await invoke<ZipListResult>('zip_list_local', { path });
  } catch {
    return null;
  }
}

export async function zipPreviewEntry(
  path: string,
  entryName: string,
  password?: string
): Promise<ZipEntryPreview | null> {
  if (!detectTauriRuntime() || !path) return null;
  try {
    return await invoke<ZipEntryPreview>('zip_preview_entry', {
      path,
      entryName,
      password: password || null,
    });
  } catch {
    return null;
  }
}

export async function zipExtractEntry(
  archivePath: string,
  entryName: string,
  destPath: string,
  password?: string
): Promise<number> {
  if (!detectTauriRuntime() || !archivePath || !destPath) return 0;
  return await invoke<number>('zip_extract_entry', {
    archivePath,
    entryName,
    destPath,
    password: password || null,
  });
}

export async function fileSha256(path: string) {
  if (!detectTauriRuntime() || !path) return null;
  try {
    return await invoke('file_sha256', { path });
  } catch {
    return null;
  }
}

export async function fileQuickFingerprint(path: string) {
  if (!detectTauriRuntime() || !path) return null;
  try {
    return await invoke('file_quick_fingerprint', { path });
  } catch {
    return null;
  }
}

export async function computeProgressRate(
  doneBytes: number,
  totalBytes: number,
  elapsedSecs: number
) {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke('compute_progress_rate', {
      doneBytes,
      totalBytes,
      elapsedSecs,
    });
  } catch {
    return null;
  }
}

export async function normalizeJobConfig(raw: Record<string, unknown>) {
  if (!detectTauriRuntime()) return raw;
  try {
    return await invoke('normalize_job_config', { raw });
  } catch {
    return raw;
  }
}

export type ProxyConfig = {
  enabled: boolean;
  proxyType: string;
  host: string;
  port: number;
  username: string;
  password: string;
  secret?: string;
};

export type VpnConfig = {
  enabled: boolean;
  timeoutMultiplier: number;
  retryAttempts: number;
  retryBaseBackoffMs: number;
  retryMaxBackoffMs: number;
  floodWaitRespect: boolean;
  bandwidthLimitUpKbs: number;
  bandwidthLimitDownKbs: number;
  chunkSizeKb: number;
  keepAliveIntervalSec: number;
  autoDetectVpn: boolean;
  connectionRetries: number;
  requestRetries: number;
};

export type NetworkConfigSnapshot = {
  proxy: ProxyConfig;
  vpn: VpnConfig;
};

export type ProxyStatus = {
  reachable: boolean;
  latencyMs: number;
  detail: string;
};

export async function networkGetConfig(): Promise<NetworkConfigSnapshot | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke<NetworkConfigSnapshot>('network_get_config');
  } catch {
    return null;
  }
}

export async function networkApplyAll(config: NetworkConfigSnapshot): Promise<boolean> {
  if (!detectTauriRuntime()) return false;
  try {
    await invoke('network_apply_all', { config });
    return true;
  } catch {
    return false;
  }
}

export async function networkTestProxy(): Promise<ProxyStatus | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke<ProxyStatus>('network_test_proxy');
  } catch {
    return null;
  }
}

export async function networkIsAvailable(): Promise<boolean> {
  if (!detectTauriRuntime()) return true;
  try {
    return await invoke<boolean>('network_is_available');
  } catch {
    return true;
  }
}

export async function networkDetectVpn(): Promise<boolean> {
  if (!detectTauriRuntime()) return false;
  try {
    return await invoke<boolean>('network_detect_vpn');
  } catch {
    return false;
  }
}

