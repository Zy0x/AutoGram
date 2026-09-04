import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  ShieldCheck,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Gauge,
  Info,
  X,
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

  // Smart Adaptive (Default & Recommended)
  if (strategy === 'smart_adaptive' || strategy === 'smart' || strategy === 'balanced') {
    if (mediaType === 'video') {
      const sizes = videoBalancedPartitionSizes(total, 8);
      return { sizes, isSafe: true };
    } else {
      const sizes = partitionSizes(total, 10, avoidSingle);
      return { sizes, isSafe: true };
    }
  }

  // Custom (or legacy maximum)
  const safeCustom = Math.max(2, Math.min(10, customSize));
  const sizes = partitionSizes(total, safeCustom, avoidSingle);
  const hasRisk = mediaType === 'video' && safeCustom >= 9;
  return {
    sizes,
    isSafe: !hasRisk,
    warningKey: hasRisk ? 'drive.album_strategy_custom_warning_title' : undefined,
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
  const [activeOverlay, setActiveOverlay] = useState<'smart' | 'custom' | 'warning' | null>(null);

  // Close overlay on Escape key
  useEffect(() => {
    if (!activeOverlay) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveOverlay(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeOverlay]);

  const rawStrategy = draft.albumPacking || 'smart_adaptive';
  const isSmart = rawStrategy === 'smart_adaptive' || (rawStrategy as string) === 'smart' || rawStrategy === 'balanced';
  const currentStrategy: 'smart_adaptive' | 'custom' = isSmart ? 'smart_adaptive' : 'custom';
  const customGridSize = draft.albumGroupSize || 10;

  return (
    <div className="td-conditional-box" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. STRATEGY SELECTION TILES — COMPACT 2-COLUMN TILES */}
      <div>
        <div style={{ marginBottom: '10px' }}>
          <label className="td-field-label" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} style={{ color: '#38bdf8' }} />
            {t('drive.album_strategy_title')}
          </label>
          <p className="td-xfer-hint" style={{ marginTop: '2px', fontSize: '0.76rem' }}>
            {t('drive.album_strategy_desc')}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
          {/* 1. SMART (AUTO-ADAPTIVE) */}
          <div
            className={`td-encoder-tile ${currentStrategy === 'smart_adaptive' ? 'is-selected' : ''}`}
            onClick={() => patch({ albumPacking: 'smart_adaptive', albumGroupSize: 10 })}
            style={{
              padding: '12px 14px',
              position: 'relative',
              cursor: 'pointer',
              borderRadius: '10px',
              border: currentStrategy === 'smart_adaptive' ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
              background: currentStrategy === 'smart_adaptive' ? 'rgba(56, 189, 248, 0.08)' : 'rgba(15, 23, 42, 0.4)',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {/* Title Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Sparkles size={16} className="td-tile-icon is-auto" style={{ color: '#38bdf8' }} />
              <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                {t('drive.album_strategy_smart')}
              </strong>
              <button
                type="button"
                className="td-preflight-info-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveOverlay('smart');
                }}
                title={t('drive.album_strategy_smart_desc')}
                aria-label={t('drive.album_strategy_smart')}
                style={{ width: '18px', height: '18px' }}
              >
                <Info size={11} />
              </button>
            </div>

            {/* Compact 1-Line Description */}
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', lineHeight: '1.35' }}>
              {t('drive.album_strategy_smart_short_desc')}
            </p>
          </div>

          {/* 2. CUSTOM GRID */}
          <div
            className={`td-encoder-tile ${currentStrategy === 'custom' ? 'is-selected' : ''}`}
            onClick={() => patch({ albumPacking: 'custom' })}
            style={{
              padding: '12px 14px',
              position: 'relative',
              cursor: 'pointer',
              borderRadius: '10px',
              border: currentStrategy === 'custom' ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.08)',
              background: currentStrategy === 'custom' ? 'rgba(168, 85, 247, 0.08)' : 'rgba(15, 23, 42, 0.4)',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {/* Title Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Sliders size={16} className="td-tile-icon is-disable" style={{ color: '#a855f7' }} />
              <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                {t('drive.album_strategy_custom')}
              </strong>
              <button
                type="button"
                className="td-preflight-info-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveOverlay('custom');
                }}
                title={t('drive.album_strategy_custom_desc')}
                aria-label={t('drive.album_strategy_custom')}
                style={{ width: '18px', height: '18px' }}
              >
                <Info size={11} />
              </button>
            </div>

            {/* Compact 1-Line Description */}
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', lineHeight: '1.35' }}>
              {t('drive.album_strategy_custom_short_desc')}
            </p>
          </div>
        </div>
      </div>

      {/* 2. CUSTOM GRID SLIDER & COMPACT WARNING BAR (Visible when Custom is active) */}
      {currentStrategy === 'custom' && (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid rgba(168, 85, 247, 0.3)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div>
            <label className="td-field-label" style={{ fontSize: '0.84rem' }}>{t('drive.album_grid_size')}</label>
            <div className="td-slider-row-box" style={{ marginTop: '6px' }}>
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
                <span className={`td-concurrency-badge tier-${customGridSize >= 9 ? 'high-speed' : customGridSize >= 5 ? 'balanced' : 'stable'}`}>
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
            <p className="td-xfer-hint" style={{ marginTop: '4px' }}>
              {t('drive.album_grid_size_desc', { size: customGridSize })}
            </p>
          </div>

          {/* COMPACT TIMEOUT WARNING BAR WITH INTERACTIVE "(i)" INFO ICON */}
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '10px',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertTriangle size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', flex: '1 1 auto' }}>
              <strong style={{ color: '#fbbf24', fontSize: '0.78rem' }}>
                {t('drive.album_strategy_custom_warning_title')}
              </strong>
              <span style={{ fontSize: '0.73rem', color: '#cbd5e1' }}>
                — {t('drive.album_strategy_custom_warning_short')}
              </span>
              <button
                type="button"
                className="td-preflight-info-btn"
                onClick={() => setActiveOverlay('warning')}
                title={t('drive.album_strategy_custom_warning_examples_title')}
                aria-label={t('drive.album_strategy_custom_warning_title')}
                style={{ width: '18px', height: '18px' }}
              >
                <Info size={11} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. BEHAVIOR SWITCHES */}
      <div className="td-switches-list" style={{ marginTop: '2px' }}>
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

        <div className="td-field-group" style={{ marginTop: '14px' }}>
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

      {/* 4. UNIFIED MODAL OVERLAY (Rendered above page via portal, zero layout duplication) */}
      {activeOverlay && typeof document !== 'undefined' && createPortal(
        <div
          className="td-mismatch-modal-backdrop"
          style={{ zIndex: 100000 }}
          onClick={() => setActiveOverlay(null)}
        >
          <div
            className="td-mismatch-modal-card"
            style={{ maxWidth: '520px', width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="td-mismatch-modal-header">
              <div className="td-mismatch-modal-header-info">
                <div
                  className="td-mismatch-modal-icon-badge"
                  style={{
                    background:
                      activeOverlay === 'smart'
                        ? 'rgba(56, 189, 248, 0.15)'
                        : activeOverlay === 'custom'
                        ? 'rgba(168, 85, 247, 0.15)'
                        : 'rgba(245, 158, 11, 0.15)',
                    borderColor:
                      activeOverlay === 'smart'
                        ? 'rgba(56, 189, 248, 0.35)'
                        : activeOverlay === 'custom'
                        ? 'rgba(168, 85, 247, 0.35)'
                        : 'rgba(245, 158, 11, 0.35)',
                  }}
                >
                  {activeOverlay === 'smart' && <Sparkles size={18} style={{ color: '#38bdf8' }} />}
                  {activeOverlay === 'custom' && <Sliders size={18} style={{ color: '#c084fc' }} />}
                  {activeOverlay === 'warning' && <AlertTriangle size={18} style={{ color: '#fbbf24' }} />}
                </div>
                <div>
                  <div className="td-mismatch-modal-title">
                    {activeOverlay === 'smart' && t('drive.album_strategy_smart')}
                    {activeOverlay === 'custom' && t('drive.album_strategy_custom')}
                    {activeOverlay === 'warning' && t('drive.album_strategy_custom_warning_title')}
                  </div>
                  <div className="td-mismatch-modal-subtitle">
                    {activeOverlay === 'smart' && t('drive.album_strategy_smart_badge')}
                    {activeOverlay === 'custom' && t('drive.album_strategy_custom_badge', { size: customGridSize })}
                    {activeOverlay === 'warning' && t('drive.album_strategy_custom_warning_short')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="td-mismatch-modal-close-btn"
                onClick={() => setActiveOverlay(null)}
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="td-mismatch-modal-body">
              {/* SMART MODE OVERLAY CONTENT */}
              {activeOverlay === 'smart' && (
                <>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                    {t('drive.album_strategy_smart_desc')}
                  </p>
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      color: '#38bdf8',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={16} style={{ color: '#34d399', flexShrink: 0 }} />
                    <span>{t('drive.album_simulator_anti_split')}</span>
                  </div>
                </>
              )}

              {/* CUSTOM GRID OVERLAY CONTENT */}
              {activeOverlay === 'custom' && (
                <>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                    {t('drive.album_strategy_custom_desc')}
                  </p>
                  <div
                    style={{
                      background: 'rgba(168, 85, 247, 0.08)',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      fontSize: '0.78rem',
                      color: '#e2e8f0',
                      lineHeight: '1.45',
                    }}
                  >
                    {t('drive.album_grid_size_desc', { size: customGridSize })}
                  </div>
                </>
              )}

              {/* TIMEOUT WARNING OVERLAY CONTENT */}
              {activeOverlay === 'warning' && (
                <>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                    {t('drive.album_strategy_custom_warning_desc')}
                  </p>

                  {/* Concrete Real Examples (10 -> 9+1, 13 -> 9+1+3 / 7+1+2) */}
                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.35)',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fcd34d' }}>
                      {t('drive.album_strategy_custom_warning_examples_title')}
                    </span>
                    <div style={{ fontSize: '0.76rem', color: '#e2e8f0', lineHeight: '1.4' }}>
                      {t('drive.album_strategy_custom_warning_example_10')}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#e2e8f0', lineHeight: '1.4' }}>
                      {t('drive.album_strategy_custom_warning_example_13')}
                    </div>
                  </div>

                  {/* Quota Saving Guidance */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.78rem',
                      color: '#34d399',
                      fontWeight: 600,
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      borderRadius: '10px',
                      padding: '10px 14px',
                    }}
                  >
                    <ShieldCheck size={16} style={{ flexShrink: 0 }} />
                    <span>{t('drive.album_strategy_custom_warning_quota_notice')}</span>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="td-mismatch-modal-footer">
              <button
                type="button"
                className="td-mismatch-modal-close-action"
                onClick={() => setActiveOverlay(null)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
