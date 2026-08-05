import type {
  DriveTransferSettings,
  EncoderStrategy,
  ReencodeHardware,
} from '../../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  clampConcurrency,
} from '../../../lib/telegram/driveTypes';
import type { HardwareCapabilities } from '../../../stores/transferProgressStore';
import { isExplicitEncoderDevice } from './encoderHardwareOptions';

export type UnifiedEncodingMode = 'automatic' | 'hardware' | 'software' | 'disabled';

export type AlbumFailurePreset = 'strict' | 'best_effort' | 'retry_separate';

export type DeliveryFormatMode = 'auto' | 'telegram' | 'document';

export type DuplicateCheckPreset = 'fast' | 'balanced' | 'strict' | 'custom';

export function getDeliveryFormatMode(settings: Partial<DriveTransferSettings>): DeliveryFormatMode {
  if (settings.presentationOverride === 'force_document' || settings.forceDocumentDefault) {
    return 'document';
  }
  if (settings.presentationOverride === 'force_native_media') {
    return 'telegram';
  }
  return 'auto';
}

export function applyDeliveryFormatMode(
  current: DriveTransferSettings,
  mode: DeliveryFormatMode
): Partial<DriveTransferSettings> {
  switch (mode) {
    case 'auto':
      return {
        presentationOverride: 'automatic',
        forceDocumentDefault: false,
        qualityMode: current.qualityMode === 'ORIGINAL' ? 'SMART' : current.qualityMode,
      };
    case 'telegram':
      return {
        presentationOverride: 'force_native_media',
        forceDocumentDefault: false,
        qualityMode: 'HIGH_QUALITY',
      };
    case 'document':
      return {
        presentationOverride: 'force_document',
        forceDocumentDefault: true,
        qualityMode: 'ORIGINAL',
      };
  }
}

export function getDuplicateCheckPreset(settings: Partial<DriveTransferSettings>): DuplicateCheckPreset {
  if (settings.duplicatePolicy === 'FORCE_UPLOAD') return 'custom';
  // Check default skip level
  return 'balanced';
}

export interface ValidationIssue {
  field: keyof DriveTransferSettings | 'global';
  message: string;
  level: 'error' | 'warning';
}

export interface TransferSettingsValidation {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  normalized: DriveTransferSettings;
}

/**
 * Resolves legacy encoderStrategy + reencodeHardware into one of 4 unified UI modes.
 */
export function resolveUnifiedEncodingMode(settings: Partial<DriveTransferSettings>): UnifiedEncodingMode {
  const strategy = settings.encoderStrategy || 'auto_adaptive';
  const hw = settings.reencodeHardware || 'auto';

  if (strategy === 'disable_reencode') return 'disabled';
  if (strategy === 'software_only' || (hw as string) === 'cpu') return 'software';
  if (
    strategy === 'hardware_preferred' ||
    strategy === 'hardware_only' ||
    isExplicitEncoderDevice(hw) ||
    (hw !== 'auto' && (hw as string) !== 'cpu')
  ) {
    return 'hardware';
  }
  return 'automatic';
}

/**
 * Maps unified UI encoding mode selections cleanly back to backend settings fields.
 */
export function applyUnifiedEncodingMode(
  current: DriveTransferSettings,
  mode: UnifiedEncodingMode,
  opts?: { targetHw?: ReencodeHardware }
): Partial<DriveTransferSettings> {
  switch (mode) {
    case 'automatic':
      return {
        encoderStrategy: 'auto_adaptive',
        reencodeHardware: 'auto',
        encoderAllowSoftwareFallback: true,
      };
    case 'hardware': {
      const selectedHw = opts?.targetHw || current.reencodeHardware;
      const hwToUse = selectedHw === 'cpu' ? 'auto' : selectedHw;
      const strategy: EncoderStrategy = isExplicitEncoderDevice(hwToUse) ? 'specific_device' : 'hardware_preferred';
      return {
        encoderStrategy: strategy,
        reencodeHardware: hwToUse,
        encoderAllowSoftwareFallback: true,
      };
    }
    case 'software':
      return {
        encoderStrategy: 'software_only',
        reencodeHardware: 'cpu',
        encoderAllowSoftwareFallback: true,
      };
    case 'disabled':
      return {
        encoderStrategy: 'disable_reencode',
      };
  }
}

/**
 * Normalizes input settings with defaults, bounds checking, and consistency mapping.
 */
export function normalizeTransferSettings(raw?: Partial<DriveTransferSettings>): DriveTransferSettings {
  const base = { ...DEFAULT_TRANSFER_SETTINGS, ...raw };
  const uploadConcurrency = clampConcurrency(base.uploadConcurrency);
  const downloadConcurrency = clampConcurrency(base.downloadConcurrency);
  const albumGroupSize = Math.max(2, Math.min(10, Number(base.albumGroupSize) || 10));
  const encoderMaxParallel = Math.max(1, Math.min(4, Number(base.encoderMaxParallel) || 1));
  const globalCaption = (base.globalCaption || '').slice(0, 65536);

  // Sync forceDocumentDefault with presentationOverride
  const presentationOverride = base.forceDocumentDefault ? 'force_document' : base.presentationOverride || 'automatic';

  return {
    ...base,
    uploadConcurrency,
    downloadConcurrency,
    albumGroupSize,
    encoderMaxParallel,
    globalCaption,
    presentationOverride,
  };
}

/**
 * Performs validation checks against settings draft & hardware capabilities.
 */
export function validateTransferSettings(
  draft: DriveTransferSettings,
  hardwareCapabilities: HardwareCapabilities | null
): TransferSettingsValidation {
  const normalized = normalizeTransferSettings(draft);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const mode = resolveUnifiedEncodingMode(normalized);

  // Hardware mode validation
  if (mode === 'hardware') {
    if (normalized.reencodeHardware === 'cpu') {
      errors.push({
        field: 'reencodeHardware',
        message: 'Mode GPU Hardware tidak boleh memilih CPU sebagai perangkat utama.',
        level: 'error',
      });
    }
    if (hardwareCapabilities?.gpu && !hardwareCapabilities.gpu.some((g) => g.supported)) {
      warnings.push({
        field: 'reencodeHardware',
        message: 'Tidak ada GPU akselerasi fisik yang terdeteksi. Sistem akan otomatis fallback ke CPU jika GPU tidak tersedia.',
        level: 'warning',
      });
    }
  }

  // Disabled re-encode warning
  if (mode === 'disabled') {
    warnings.push({
      field: 'encoderStrategy',
      message: 'Re-encode dinonaktifkan. Video dengan format non-native (MKV, AVI, MOV) akan otomatis dikirim sebagai berkas dokumen.',
      level: 'warning',
    });
  }

  // Schedule date validation
  if (normalized.scheduleAt) {
    const schedDate = Date.parse(normalized.scheduleAt);
    if (!Number.isNaN(schedDate) && schedDate < Date.now() - 60_000) {
      errors.push({
        field: 'scheduleAt',
        message: 'Waktu penjadwalan tidak boleh di masa lalu.',
        level: 'error',
      });
    }
  }

  // Caption UTF-16 length check (Telegram runtime limit warning)
  const captionLength = [...normalized.globalCaption].reduce((tot, char) => tot + char.length, 0);
  if (captionLength > 1024) {
    if (normalized.captionOverflowPolicy === 'fail') {
      errors.push({
        field: 'globalCaption',
        message: `Panjang caption (${captionLength}) melebihi batas Telegram (1024) dan kebijakan terset ke Gagalkan.`,
        level: 'error',
      });
    } else {
      warnings.push({
        field: 'globalCaption',
        message: `Panjang caption (${captionLength}) melebihi batas 1024 karakter dan akan dipotong otomatis saat pengiriman.`,
        level: 'warning',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized,
  };
}

/**
 * System Presets (Read-only templates)
 */
export const SYSTEM_TRANSFER_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  settings: Partial<DriveTransferSettings>;
}> = [
  {
    id: 'preset-balanced',
    name: 'Rekomendasi Standar (Seimbang)',
    description: 'Format otomatis, pengodean GPU adaptif, 4 paralel unggah, lewati duplikat.',
    settings: {
      qualityMode: 'HIGH_QUALITY',
      presentationOverride: 'automatic',
      encoderStrategy: 'auto_adaptive',
      reencodeHardware: 'auto',
      uploadConcurrency: 4,
      downloadConcurrency: 4,
      duplicatePolicy: 'SKIP',
      downloadConflictPolicy: 'ask',
      downloadIntegrity: 'size',
    },
  },
  {
    id: 'preset-archival',
    name: 'Arsip & Kualitas Asli (Uncompressed)',
    description: 'Format dokumen asli, matikan re-encode, verifikasi SHA-256 ketat.',
    settings: {
      qualityMode: 'ORIGINAL',
      presentationOverride: 'force_document',
      encoderStrategy: 'disable_reencode',
      uploadConcurrency: 3,
      downloadConcurrency: 3,
      duplicatePolicy: 'SKIP',
      downloadConflictPolicy: 'rename',
      downloadIntegrity: 'sha256',
    },
  },
  {
    id: 'preset-fast-publish',
    name: 'Publikasi Cepat (Speed Preset)',
    description: 'Akselerasi GPU paksa, preset kecepatan tinggi, 6 paralel unggah.',
    settings: {
      qualityMode: 'SMART',
      presentationOverride: 'automatic',
      encoderStrategy: 'hardware_preferred',
      reencodeHardware: 'auto',
      reencodePreset: 'speed',
      uploadConcurrency: 6,
      downloadConcurrency: 6,
      duplicatePolicy: 'SKIP',
      downloadConflictPolicy: 'overwrite',
      downloadIntegrity: 'size',
    },
  },
];
