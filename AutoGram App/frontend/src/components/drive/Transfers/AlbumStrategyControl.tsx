import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  ShieldCheck,
  Zap,
  Sliders,
  Film,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Layers,
  Gauge,
} from 'lucide-react';
import type { AlbumPacking, DriveTransferSettings } from '../../../lib/telegram/driveTypes';

export function videoBalancedPartitionSizes(total: number, maxSafe: number = 8): number[] {
  if (total <= 0) return [];
  if (total <= maxSafe) return [total];
  const k = Math.ceil(total / maxSafe);
  const base = Math.floor(total / k);
  const rem = total % k;
  const result: number[] = [];
  for (let i = 0; i < k; i++) {
    result.push(i < rem ? base + 1 : base);
  }
  return result;
}

export function partitionSizes(total: number, target: number, avoidSingle: boolean = true): number[] {
  if (total <= 0) return [];
  if (target < 2) return Array(total).fill(1);
  const sizes: number[] = [];
  let remaining = total;
  while (remaining > target) {
    sizes.push(target);
    remaining -= target;
  }
  if (remaining > 0) {
    sizes.push(remaining);
  }
  if (avoidSingle && sizes.length >= 2 && sizes[sizes.length - 1] === 1) {
    const lastFull = sizes.length - 2;
    if (sizes[lastFull] > 2) {
      sizes[lastFull] -= 1;
      sizes[sizes.length - 1] = 2;
    }
  }
  return sizes;
}

export function calculateAlbumPartition(
  total: number,
  strategy: AlbumPacking | string,
  mediaType: 'video' | 'photo',
  customSize: number = 10,
  avoidSingle: boolean = true
): { sizes: number[]; isSafe: boolean; warningKey?: string } {
  if (total <= 0) return { sizes: [], isSafe: true };
  if (total === 1) return { sizes: [1], isSafe: true };

  if (strategy === 'smart_adaptive') {
    if (mediaType === 'video') {
      const sizes = videoBalancedPartitionSizes(total, 8);
      return { sizes, isSafe: true };
    } else {
      const sizes = partitionSizes(total, 10, avoidSingle);
      return { sizes, isSafe: true };
    }
  }

  if (strategy === 'balanced') {
    const sizes = videoBalancedPartitionSizes(total, 8);
    return { sizes, isSafe: true };
  }

  if (strategy === 'maximum') {
    const sizes = partitionSizes(total, 10, avoidSingle);
    const hasRisk = mediaType === 'video' && sizes.some((s) => s >= 9);
    return {
      sizes,
      isSafe: !hasRisk,
      warningKey: hasRisk ? 'drive.album_strategy_maximum_warning' : undefined,
    };
  }

  // Custom
  const safeCustom = Math.max(2, Math.min(10, customSize));
  const sizes = partitionSizes(total, safeCustom, avoidSingle);
  const hasRisk = mediaType === 'video' && safeCustom >= 9;
  return {
    sizes,
    isSafe: !hasRisk,
    warningKey: hasRisk ? 'drive.album_strategy_maximum_warning' : undefined,
  };
}

interface AlbumStrategyControlProps {
  draft: DriveTransferSettings;
  patch: (partial: Partial<DriveTransferSettings>) => void;
  transferActive?: boolean;
}

export const AlbumStrategyControl: React.FC<AlbumStrategyControlProps> = ({
  draft,
  patch,
  transferActive = false,
}) => {
  const { t } = useTranslation();

  // Simulator local state
  const [simCount, setSimCount] = useState<number>(13);
  const [simType, setSimType] = useState<'video' | 'photo'>('video');

  const currentStrategy: AlbumPacking = draft.albumPacking || 'smart_adaptive';
  const customGridSize = draft.albumGroupSize || 10;
  const avoidSingle = draft.albumAvoidSingle ?? true;

  // Calculate simulation result
  const simResult = calculateAlbumPartition(
    simCount,
    currentStrategy,
    simType,
    customGridSize,
    avoidSingle
  );

  const fullCollageCount = simResult.sizes.filter((s) => s > 1).length;
  const singleFileCount = simResult.sizes.filter((s) => s === 1).length;

  const quickPresets = [10, 13, 15, 17, 27, 50, 100];

  return (
    <div className="td-conditional-box" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. STRATEGY SELECTION TILES */}
      <div>
        <div style={{ marginBottom: '12px' }}>
          <label className="td-field-label" style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={17} style={{ color: '#38bdf8' }} />
            {t('drive.album_strategy_title')}
          </label>
          <p className="td-xfer-hint" style={{ marginTop: '2px', fontSize: '0.78rem' }}>
            {t('drive.album_strategy_desc')}
          </p>
        </div>

        <div className="td-encoder-4x-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
          {/* SMART ADAPTIVE (RECOMMENDED) */}
          <label
            className={`td-encoder-tile ${currentStrategy === 'smart_adaptive' ? 'is-selected' : ''}`}
            style={{ minHeight: '105px', position: 'relative' }}
          >
            <input
              type="radio"
              name="albumPacking"
              value="smart_adaptive"
              checked={currentStrategy === 'smart_adaptive'}
              disabled={transferActive}
              onChange={() => patch({ albumPacking: 'smart_adaptive', albumGroupSize: 10 })}
            />
            <div>
              <div className="td-tile-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} className="td-tile-icon is-auto" style={{ color: '#38bdf8' }} />
                  <strong>{t('drive.album_strategy_smart_adaptive')}</strong>
                </div>
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(56, 189, 248, 0.2)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                  }}
                >
                  {t('drive.album_strategy_smart_badge')}
                </span>
              </div>
              <p style={{ marginTop: '6px' }}>{t('drive.album_strategy_smart_adaptive_desc')}</p>
            </div>
          </label>

          {/* SAFE BALANCED */}
          <label
            className={`td-encoder-tile ${currentStrategy === 'balanced' ? 'is-selected' : ''}`}
            style={{ minHeight: '105px' }}
          >
            <input
              type="radio"
              name="albumPacking"
              value="balanced"
              checked={currentStrategy === 'balanced'}
              disabled={transferActive}
              onChange={() => patch({ albumPacking: 'balanced', albumGroupSize: 8 })}
            />
            <div>
              <div className="td-tile-head">
                <ShieldCheck size={16} className="td-tile-icon" style={{ color: '#10b981' }} />
                <strong>{t('drive.album_strategy_safe_balanced')}</strong>
              </div>
              <p style={{ marginTop: '6px' }}>{t('drive.album_strategy_safe_balanced_desc')}</p>
            </div>
          </label>

          {/* MAXIMUM 10 */}
          <label
            className={`td-encoder-tile ${currentStrategy === 'maximum' ? 'is-selected' : ''}`}
            style={{ minHeight: '105px' }}
          >
            <input
              type="radio"
              name="albumPacking"
              value="maximum"
              checked={currentStrategy === 'maximum'}
              disabled={transferActive}
              onChange={() => patch({ albumPacking: 'maximum', albumGroupSize: 10 })}
            />
            <div>
              <div className="td-tile-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Zap size={16} className="td-tile-icon is-hardware" style={{ color: '#f59e0b' }} />
                  <strong>{t('drive.album_strategy_maximum')}</strong>
                </div>
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                  }}
                >
                  Max 10
                </span>
              </div>
              <p style={{ marginTop: '6px' }}>{t('drive.album_strategy_maximum_desc')}</p>
            </div>
          </label>

          {/* CUSTOM GRID */}
          <label
            className={`td-encoder-tile ${currentStrategy === 'custom' ? 'is-selected' : ''}`}
            style={{ minHeight: '105px' }}
          >
            <input
              type="radio"
              name="albumPacking"
              value="custom"
              checked={currentStrategy === 'custom'}
              disabled={transferActive}
              onChange={() => patch({ albumPacking: 'custom' })}
            />
            <div>
              <div className="td-tile-head">
                <Sliders size={16} className="td-tile-icon is-disable" style={{ color: '#a855f7' }} />
                <strong>{t('drive.album_strategy_custom')}</strong>
              </div>
              <p style={{ marginTop: '6px' }}>{t('drive.album_strategy_custom_desc')}</p>
            </div>
          </label>
        </div>
      </div>

      {/* 2. CUSTOM GRID SLIDER (Visible when Custom is active) */}
      {currentStrategy === 'custom' && (
        <div style={{ background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '10px', padding: '14px' }}>
          <label className="td-field-label" style={{ fontSize: '0.84rem' }}>{t('drive.album_grid_size')}</label>
          <div className="td-slider-row-box" style={{ marginTop: '8px' }}>
            <input
              type="range"
              min={2}
              max={10}
              value={customGridSize}
              disabled={transferActive}
              onChange={(e) => {
                const size = Number(e.target.value);
                patch({ albumGroupSize: size, albumPacking: 'custom' });
              }}
            />
            <div className="td-slider-value-bar">
              <span className="td-slider-val">{t('drive.album_grid_size_value', { size: customGridSize })}</span>
              <span className={`td-concurrency-badge tier-${customGridSize === 10 ? 'high-speed' : customGridSize >= 5 ? 'balanced' : 'stable'}`}>
                {customGridSize === 10 && (
                  <>
                    <Sparkles size={11} strokeWidth={2.2} />
                    <span>{t('drive.album_grid_size_max')}</span>
                  </>
                )}
                {customGridSize >= 5 && customGridSize <= 9 && (
                  <>
                    <Gauge size={11} strokeWidth={2.2} />
                    <span>{t('drive.album_grid_size_medium')}</span>
                  </>
                )}
                {customGridSize >= 2 && customGridSize <= 4 && (
                  <>
                    <ShieldCheck size={11} strokeWidth={2.2} />
                    <span>{t('drive.album_grid_size_compact')}</span>
                  </>
                )}
              </span>
            </div>
          </div>
          <p className="td-xfer-hint" style={{ marginTop: '6px' }}>
            {t('drive.album_grid_size_desc', { size: customGridSize })}
          </p>
        </div>
      )}

      {/* 3. INTERACTIVE BATCH PARTITION SIMULATOR */}
      <div
        style={{
          background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.75) 0%, rgba(20, 30, 50, 0.6) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '12px',
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cpu size={18} style={{ color: '#38bdf8' }} />
            <div>
              <strong style={{ fontSize: '0.9rem', color: '#f8fafc' }}>
                {t('drive.album_simulator_title')}
              </strong>
              <p style={{ margin: 0, fontSize: '0.76rem', color: '#94a3b8' }}>
                {t('drive.album_simulator_desc')}
              </p>
            </div>
          </div>

          {/* MEDIA TYPE SWITCH */}
          <div style={{ display: 'flex', gap: '4px', background: 'rgba(15, 23, 42, 0.8)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <button
              type="button"
              onClick={() => setSimType('video')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                minHeight: '36px',
                borderRadius: '6px',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: simType === 'video' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: simType === 'video' ? '#38bdf8' : '#94a3b8',
                transition: 'all 0.15s ease',
              }}
            >
              <Film size={14} />
              {t('drive.album_simulator_type_video')}
            </button>
            <button
              type="button"
              onClick={() => setSimType('photo')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                minHeight: '36px',
                borderRadius: '6px',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: simType === 'photo' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: simType === 'photo' ? '#38bdf8' : '#94a3b8',
                transition: 'all 0.15s ease',
              }}
            >
              <ImageIcon size={14} />
              {t('drive.album_simulator_type_photo')}
            </button>
          </div>
        </div>

        {/* INPUT COUNT CONTROLLER & PRESETS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(0, 0, 0, 0.2)', padding: '12px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
              {t('drive.album_simulator_count')}:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setSimCount((prev) => Math.max(2, prev - 1))}
                style={{
                  minWidth: '32px',
                  minHeight: '32px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                -
              </button>
              <input
                type="number"
                min={2}
                max={200}
                value={simCount}
                onChange={(e) => setSimCount(Math.max(2, Math.min(200, Number(e.target.value) || 2)))}
                style={{
                  width: '64px',
                  textAlign: 'center',
                  padding: '4px 6px',
                  borderRadius: '6px',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  background: 'rgba(15, 23, 42, 0.9)',
                  color: '#38bdf8',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                }}
              />
              <button
                type="button"
                onClick={() => setSimCount((prev) => Math.min(200, prev + 1))}
                style={{
                  minWidth: '32px',
                  minHeight: '32px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* PRESET CHIPS */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.74rem', color: '#94a3b8', marginRight: '4px' }}>Preset Cepat:</span>
            {quickPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setSimCount(preset)}
                style={{
                  padding: '4px 10px',
                  minHeight: '32px',
                  borderRadius: '6px',
                  border: simCount === preset ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                  background: simCount === preset ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                  color: simCount === preset ? '#38bdf8' : '#cbd5e1',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* REAL-TIME COLLAGE CHIP DISPLAY */}
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('drive.album_simulator_result')}:
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#38bdf8', letterSpacing: '0.05em' }}>
              [{simResult.sizes.join(' + ')}]
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {simResult.sizes.map((size, idx) => {
              const isSingle = size === 1;
              const typeLabel = simType === 'video' ? 'Video' : 'Foto';
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: isSingle
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(56, 189, 248, 0.15)',
                    border: isSingle
                      ? '1px solid rgba(239, 68, 68, 0.35)'
                      : '1px solid rgba(56, 189, 248, 0.35)',
                    color: isSingle ? '#fca5a5' : '#7dd3fc',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                  }}
                >
                  <span>
                    {isSingle
                      ? t('drive.album_simulator_single_label', { count: 1, type: typeLabel })
                      : t('drive.album_simulator_collage_label', { index: idx + 1, count: size, type: typeLabel })}
                  </span>
                </div>
              );
            })}
          </div>

          {/* SAFETY / SPLIT STATUS BANNER */}
          <div
            style={{
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: '8px',
              background: simResult.isSafe ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.15)',
              border: simResult.isSafe ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.4)',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {simResult.isSafe ? (
                <CheckCircle2 size={15} style={{ color: '#10b981', flexShrink: 0 }} />
              ) : (
                <AlertTriangle size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
              )}
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: simResult.isSafe ? '#34d399' : '#fbbf24' }}>
                {simResult.isSafe
                  ? t('drive.album_simulator_anti_split')
                  : t('drive.album_simulator_timeout_warning')}
              </span>
            </div>

            <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
              {t('drive.album_simulator_summary', { groups: fullCollageCount, singles: singleFileCount })}
            </span>
          </div>
        </div>
      </div>

      {/* 4. BEHAVIOR SWITCHES */}
      <div className="td-switches-list" style={{ marginTop: '4px' }}>
        <label className="td-switch-row">
          <div>
            <strong>{t('ui.generated.pisahkan_dokumen_dari_album_1bd3539')}</strong>
            <p>{t('ui.generated.kirim_berkas_dokumen_secara_terpisah_di_luar_gru_92cbf17')}</p>
          </div>
          <input
            type="checkbox"
            checked={draft.groupDocuments ?? true}
            disabled={transferActive}
            onChange={(e) => patch({ groupDocuments: e.target.checked })}
          />
        </label>

        <label className="td-switch-row">
          <div>
            <strong>{t('ui.generated.kelompokkan_berkas_audio_musik_audio_playlist_8adcc13')}</strong>
            <p>{t('ui.generated.gabungkan_beberapa_berkas_mp3_flac_menjadi_satu__a219840')}</p>
          </div>
          <input
            type="checkbox"
            checked={draft.groupAudio ?? true}
            disabled={transferActive}
            onChange={(e) => patch({ groupAudio: e.target.checked })}
          />
        </label>

        <label className="td-switch-row">
          <div>
            <strong>{t('ui.generated.kelompokkan_berkas_dokumen_mentah_document_album_0c09d9d')}</strong>
            <p>{t('ui.generated.gabungkan_berkas_dokumen_mentah_non_media_zip_pd_5cf68c3')}</p>
          </div>
          <input
            type="checkbox"
            checked={draft.groupOriginalDocuments ?? true}
            disabled={transferActive}
            onChange={(e) => patch({ groupOriginalDocuments: e.target.checked })}
          />
        </label>

        <label className="td-switch-row">
          <div>
            <strong>{t('ui.generated.hindari_album_satu_item_1d27987')}</strong>
            <p>{t('ui.generated.jika_tersisa_1_item_kirim_sebagai_pesan_tunggal__1ed9e2d')}</p>
          </div>
          <input
            type="checkbox"
            checked={draft.albumAvoidSingle ?? true}
            disabled={transferActive}
            onChange={(e) => patch({ albumAvoidSingle: e.target.checked })}
          />
        </label>

        <div className="td-field-group" style={{ marginTop: '16px' }}>
          <label className="td-field-label">{t('ui.generated.strategi_penanganan_gagal_item_album_c19fb1f')}</label>
          <select
            value={draft.albumFailurePolicy || 'send_failed_separately'}
            disabled={transferActive}
            onChange={(e) => patch({ albumFailurePolicy: e.target.value as any })}
          >
            <option value="send_failed_separately">{t('ui.generated.best_effort_kirim_item_berhasil_sebagai_album_ul_c6a176a')}</option>
            <option value="atomic_strict">{t('ui.generated.strict_atomik_batal_kirim_album_ulangi_paket_1beec2e')}</option>
            <option value="send_remaining">{t('ui.generated.fallback_individual_konversi_item_tersisa_menjad_e4ccb1a')}</option>
          </select>
        </div>
      </div>
    </div>
  );
};
