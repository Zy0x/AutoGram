import React from 'react';
import { Cpu, Film, Activity, HardDrive, ShieldCheck, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface PlaybackTelemetryData {
  activeBackend: string;
  gpuAdapterName: string;
  zeroCopyActive: boolean;
  sourceFps: number;
  renderedFps: number;
  droppedFrames: number;
  avDriftMs: number;
  vramUsedMb: number;
  vramCapMb: number;
  seekCacheHitPct: number;
  decoderProfile: string;
}

interface PlaybackDiagnosticsPanelProps {
  telemetry?: PlaybackTelemetryData;
  onClose?: () => void;
}

export const PlaybackDiagnosticsPanel: React.FC<PlaybackDiagnosticsPanelProps> = ({
  telemetry = {
    activeBackend: 'D3D11VA (Direct3D11 Video Acceleration)',
    gpuAdapterName: 'NVIDIA GeForce GPU',
    zeroCopyActive: true,
    sourceFps: 60,
    renderedFps: 60,
    droppedFrames: 0,
    avDriftMs: 0.4,
    vramUsedMb: 312,
    vramCapMb: 1024,
    seekCacheHitPct: 98.4,
    decoderProfile: 'HEVC Main10 @ Level 5.1 (4K 60FPS)',
  },
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <div
      style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        zIndex: 99,
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '10px',
        padding: '14px 16px',
        color: '#f8fafc',
        fontFamily: 'monospace',
        fontSize: '12px',
        width: '320px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: '#38bdf8' }}>
          <Activity size={14} />
          <span>{t('speedtest.diag_title')}</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Zap size={13} style={{ color: '#10b981' }} />
          <span style={{ color: '#94a3b8' }}>{t('ui.generated.backend_07b02e6')}</span>
          <span style={{ color: '#34d399', fontWeight: 'bold' }}>{telemetry.activeBackend}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Film size={13} style={{ color: '#38bdf8' }} />
          <span style={{ color: '#94a3b8' }}>{t('ui.generated.gpu_021a8fa')}</span>
          <span style={{ color: '#f1f5f9' }}>{telemetry.gpuAdapterName}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ShieldCheck size={13} style={{ color: telemetry.zeroCopyActive ? '#10b981' : '#f59e0b' }} />
          <span style={{ color: '#94a3b8' }}>{t('ui.generated.zero_copy_dxgi_799e548')}</span>
          <span style={{ color: telemetry.zeroCopyActive ? '#34d399' : '#f59e0b', fontWeight: 'bold' }}>
            {telemetry.zeroCopyActive ? t('ui.generated.active_direct_texture_f52b40a') : t('ui.generated.disabled_cpu_copy_672dacf')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Cpu size={13} style={{ color: '#a78bfa' }} />
          <span style={{ color: '#94a3b8' }}>{t('ui.generated.profile_17d487b')}</span>
          <span style={{ color: '#cbd5e1' }}>{telemetry.decoderProfile}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <HardDrive size={13} style={{ color: '#f472b6' }} />
          <span style={{ color: '#94a3b8' }}>{t('ui.generated.vram_cache_a7b7bf6')}</span>
          <span style={{ color: '#cbd5e1' }}>
            {telemetry.vramUsedMb}{t('ui.generated.mb_b5f91dc')} {telemetry.vramCapMb}{t('ui.generated.mb_ce3ebe6')}{telemetry.seekCacheHitPct}{t('ui.generated.hit_5a2336e')}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            marginTop: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            padding: '8px',
            borderRadius: '6px',
          }}
        >
          <div>
            <div style={{ color: '#64748b', fontSize: '10px' }}>{t('ui.generated.render_fps_61ba33b')}</div>
            <div style={{ color: '#38bdf8', fontSize: '15px', fontWeight: 'bold' }}>
              {telemetry.renderedFps} <span style={{ fontSize: '10px', color: '#94a3b8' }}>/ {telemetry.sourceFps}</span>
            </div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: '10px' }}>{t('ui.generated.dropped_drift_f6c3111')}</div>
            <div style={{ color: telemetry.droppedFrames > 0 ? '#ef4444' : '#10b981', fontSize: '15px', fontWeight: 'bold' }}>
              {telemetry.droppedFrames} <span style={{ fontSize: '10px', color: '#94a3b8' }}>({telemetry.avDriftMs}{t('ui.generated.ms_bd868a4')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
