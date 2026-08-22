import { useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export interface StageProgress {
  status: 'idle' | 'running' | 'completed' | 'failed';
  percent: number;
  currentBytes: number;
  totalBytes: number;
  speed: number;
  fps?: number;
  eta?: number;
}

export interface TransferJob {
  id: string;
  filename: string;
  activeStage: 'encode' | 'upload' | 'download' | 'idle' | 'done';
  encode: StageProgress;
  upload: StageProgress;
  download: StageProgress;
}

export interface HardwareGpu {
  device_id: string;
  device_index: number;
  backend_id: string;
  name: string;
  gpu_type: 'dedicated' | 'integrated' | string;
  vendor: string;
  encoder_codec: string;
  supported: boolean;
  priority_rank: number;
  supports_explicit_selection: boolean;
  driver_version?: string | null;
}

export interface HardwareCpu {
  processor_name: string;
  cores: number;
  threads: number;
  x264_supported: boolean;
}

export interface SelectedEncoder {
  encoder_backend: string;
  ffmpeg_codec: string;
  device_name: string;
  priority_rank: number;
}

export interface HardwareCapabilities {
  cpu: HardwareCpu;
  gpu: HardwareGpu[];
  best_encoder: SelectedEncoder;
}

interface TransferProgressPayload {
  jobId: string;
  stage: 'encode' | 'upload' | 'download';
  currentBytes: number;
  totalBytes: number;
  speed: number;
  percentage: number;
  fps?: number;
  eta?: number;
  filename?: string;
}

const defaultStage: StageProgress = {
  status: 'idle',
  percent: 0,
  currentBytes: 0,
  totalBytes: 0,
  speed: 0,
};

export interface TransferProgressState {
  jobs: TransferJob[];
  hardwareCapabilities: HardwareCapabilities | null;
  selectedEncoder: SelectedEncoder | null;
  isDetectingHardware: boolean;
}

class TransferProgressStore {
  private jobs: Map<string, TransferJob> = new Map();
  private hardwareCapabilities: HardwareCapabilities | null = null;
  private selectedEncoder: SelectedEncoder | null = null;
  private isDetectingHardware = false;
  private speedHistories: Map<string, number[]> = new Map();
  private listeners: Set<() => void> = new Set();
  private isListening = false;
  private snapshot: TransferProgressState = {
    jobs: [],
    hardwareCapabilities: null,
    selectedEncoder: null,
    isDetectingHardware: false,
  };

  constructor() {
    this.updateSnapshot();
    this.initTauriListeners();
  }

  private updateSnapshot() {
    this.snapshot = {
      jobs: Array.from(this.jobs.values()),
      hardwareCapabilities: this.hardwareCapabilities,
      selectedEncoder: this.selectedEncoder,
      isDetectingHardware: this.isDetectingHardware,
    };
  }

  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = () => {
    return this.snapshot;
  };

  public getHardwareCapabilities = () => {
    return this.snapshot.hardwareCapabilities;
  };

  public getIsDetectingHardware = () => {
    return this.isDetectingHardware;
  };

  public fetchHardwareCapabilities = async () => {
    if (this.isDetectingHardware) return;
    this.isDetectingHardware = true;
    this.notify();
    try {
      const caps = await invoke<HardwareCapabilities>('get_hardware_capabilities');
      const best = await invoke<SelectedEncoder>('select_best_encoder');
      this.hardwareCapabilities = caps;
      this.selectedEncoder = best;
    } catch (err) {
      console.warn('Failed to fetch hardware capabilities from Tauri:', err);
    } finally {
      this.isDetectingHardware = false;
      this.notify();
    }
  };

  public clearAllJobs = () => {
    this.jobs.clear();
    this.speedHistories.clear();
    this.notify();
  };

  public clearJob = (jobId: string) => {
    this.jobs.delete(jobId);
    this.speedHistories.delete(`${jobId}_encode`);
    this.speedHistories.delete(`${jobId}_upload`);
    this.speedHistories.delete(`${jobId}_download`);
    this.notify();
  };

  private notify() {
    this.updateSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private initTauriListeners() {
    if (this.isListening) return;
    this.isListening = true;

    listen<TransferProgressPayload>('transfer-progress', (event) => {
      const payload = event.payload;
      if (!payload || !payload.jobId) return;

      const existingJob = this.jobs.get(payload.jobId);
      const job: TransferJob = existingJob
        ? { ...existingJob }
        : {
            id: payload.jobId,
            filename: payload.filename || 'Transfer File',
            activeStage: payload.stage,
            encode: { ...defaultStage },
            upload: { ...defaultStage },
            download: { ...defaultStage },
          };

      job.activeStage = payload.stage;

      // Moving average calculation for network speed smoothing (5 samples)
      const stageKey = `${payload.jobId}_${payload.stage}`;
      let history = this.speedHistories.get(stageKey) || [];
      history.push(payload.speed || 0);
      if (history.length > 5) history.shift();
      this.speedHistories.set(stageKey, history);

      const smoothedSpeed =
        history.length > 0
          ? history.reduce((a, b) => a + b, 0) / history.length
          : payload.speed || 0;

      const updatedStage: StageProgress = {
        status: payload.percentage >= 100 ? 'completed' : 'running',
        percent: payload.percentage || 0,
        currentBytes: payload.currentBytes || 0,
        totalBytes: payload.totalBytes || 0,
        speed: smoothedSpeed,
        fps: payload.fps,
        eta: payload.eta,
      };

      if (payload.stage === 'encode') {
        job.encode = updatedStage;
      } else if (payload.stage === 'upload') {
        job.upload = updatedStage;
      } else if (payload.stage === 'download') {
        job.download = updatedStage;
      }

      if (payload.percentage >= 100) {
        job.activeStage = 'done';
      }

      this.jobs.set(payload.jobId, job);
      this.notify();
    }).catch((err) => console.warn('Tauri event transfer-progress listen error:', err));
  }
}

export const transferProgressStore = new TransferProgressStore();

export function useTransferProgressStore() {
  const state = useSyncExternalStore(
    transferProgressStore.subscribe,
    transferProgressStore.getSnapshot
  );
  return {
    ...state,
    fetchHardwareCapabilities: transferProgressStore.fetchHardwareCapabilities,
    clearAllJobs: transferProgressStore.clearAllJobs,
    clearJob: transferProgressStore.clearJob,
  };
}

export function useTransferHardwareCapabilities() {
  const snapshot = useSyncExternalStore(
    transferProgressStore.subscribe,
    transferProgressStore.getSnapshot
  );
  return {
    hardwareCapabilities: snapshot.hardwareCapabilities,
    isDetectingHardware: snapshot.isDetectingHardware,
    fetchHardwareCapabilities: transferProgressStore.fetchHardwareCapabilities,
  };
}

export function formatSpeedBytes(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return `${(bytesPerSec / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatEtaSeconds(totalSec?: number): string {
  if (totalSec == null || totalSec < 0 || !isFinite(totalSec)) return '--';
  if (totalSec < 60) return `${Math.round(totalSec)}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.round(totalSec % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}
