import { memo, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Battery, Cpu, Gauge, HardDrive, ShieldCheck, SlidersHorizontal, Sparkles, Wifi, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getDrivePerfProfile, setPerfTierOverride, type PerfTier } from '../../lib/utils/devicePerformance';
import { garbageCollector } from '../../lib/utils/garbageCollector';
import { useTransferHardwareCapabilities } from '../../stores/transferProgressStore';
import './Settings.css';

type TierOption = {
  id: PerfTier;
  title: string;
  desc: string;
  metric: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

export const PerfSection = memo(function PerfSection() {
  const { t } = useTranslation();
  const { hardwareCapabilities, fetchHardwareCapabilities } = useTransferHardwareCapabilities();

  useEffect(() => {
    fetchHardwareCapabilities().catch(() => {});
  }, [fetchHardwareCapabilities]);

  const [tier, setTier] = useState<PerfTier>(() => {
    try {
      const saved = localStorage.getItem('autogram_perf_tier');
      if (saved === 'low' || saved === 'mid' || saved === 'high') return saved;
    } catch {
      /* ignore */
    }
    return 'mid';
  });

  const profile = useMemo(() => getDrivePerfProfile(), [tier]);

  const recommendedTier = useMemo<PerfTier>(() => {
    try {
      const threads = hardwareCapabilities?.cpu?.threads || navigator.hardwareConcurrency || 4;
      const hasGpuAccel =
        hardwareCapabilities?.best_encoder &&
        hardwareCapabilities.best_encoder.encoder_backend !== 'x264';

      if (threads >= 8 || (threads >= 4 && hasGpuAccel)) return 'high';
      if (threads >= 4) return 'mid';
      return 'low';
    } catch {
      return 'mid';
    }
  }, [hardwareCapabilities]);

  const options: TierOption[] = [
    {
      id: 'low',
      icon: Battery,
      title: t('settings.perf_tier_low_title'),
      desc: t('settings.perf_tier_low_desc'),
      metric: t('settings.perf_metric_low'),
    },
    {
      id: 'mid',
      icon: Gauge,
      title: t('settings.perf_tier_mid_title'),
      desc: t('settings.perf_tier_mid_desc'),
      metric: t('settings.perf_metric_mid'),
    },
    {
      id: 'high',
      icon: Zap,
      title: t('settings.perf_tier_high_title'),
      desc: t('settings.perf_tier_high_desc'),
      metric: t('settings.perf_metric_high'),
    },
  ];

  const selectTier = (nextTier: PerfTier) => {
    setTier(nextTier);
    setPerfTierOverride(nextTier);
    window.dispatchEvent(new CustomEvent('autogram-perf-tier-changed', { detail: nextTier }));
    window.dispatchEvent(new CustomEvent('autogram-emergency-memory-reclaim'));
    void garbageCollector.runGarbageCollection();
  };

  const cpuName = hardwareCapabilities?.cpu?.processor_name
    ? `${hardwareCapabilities.cpu.processor_name} (${hardwareCapabilities.cpu.threads || hardwareCapabilities.cpu.cores} Threads)`
    : `${navigator.hardwareConcurrency || 4} Logical Threads`;

  const gpuName = hardwareCapabilities?.best_encoder?.device_name
    ? `${hardwareCapabilities.best_encoder.encoder_backend} · ${hardwareCapabilities.best_encoder.device_name}`
    : hardwareCapabilities?.gpu?.[0]?.name
      ? hardwareCapabilities.gpu[0].name
      : null;

  return (
    <section className="settings-card settings-perf-card" aria-labelledby="settings-performance-title">
      <header className="settings-card-heading">
        <span className="settings-card-icon" aria-hidden>
          <SlidersHorizontal size={19} strokeWidth={2} />
        </span>
        <div>
          <h3 id="settings-performance-title">{t('settings.perf_section_1_title')}</h3>
          <p>{t('settings.perf_subtitle')}</p>
        </div>
      </header>

      <div className="settings-tier-list" role="radiogroup" aria-labelledby="settings-performance-title">
        {options.map((option) => {
          const selected = tier === option.id;
          const recommended = recommendedTier === option.id;
          const TierIcon = option.icon;

          return (
            <button
              key={option.id}
              type="button"
              className={`settings-tier-option ${selected ? 'is-selected' : ''}`}
              role="radio"
              aria-checked={selected}
              onClick={() => selectTier(option.id)}
            >
              <span className="settings-tier-radio" aria-hidden />
              <span className="settings-tier-content">
                <span className="settings-tier-topline">
                  <span className="settings-tier-name">
                    <TierIcon size={17} strokeWidth={2} />
                    {option.title}
                  </span>
                  <span className="settings-tier-badges">
                    {option.id === 'mid' && (
                      <span className="settings-badge settings-badge-default">
                        {t('settings.perf_default_badge')}
                      </span>
                    )}
                    {recommended && (
                      <span className="settings-badge settings-badge-recommended">
                        <Sparkles size={12} strokeWidth={2} />
                        {t('settings.perf_recommended_badge')}
                      </span>
                    )}
                  </span>
                </span>
                <span className="settings-tier-desc">{option.desc}</span>
              </span>
              <span className="settings-tier-metric">{option.metric}</span>
            </button>
          );
        })}
      </div>

      {/* REAL ACCURATE PHYSICAL HARDWARE TELEMETRY BADGES */}
      <div className="settings-perf-status" role="status">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Cpu size={15} strokeWidth={2} style={{ color: '#38bdf8' }} aria-hidden />
          <span>{t('settings.perf_status_active')}</span>
          <strong style={{ color: '#ffffff' }}>
            {tier === 'low'
              ? t('settings.perf_tier_low_title')
              : tier === 'high'
                ? t('settings.perf_tier_high_title')
                : t('settings.perf_tier_mid_title')}
          </strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <span
            title={cpuName}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              color: '#bae6fd',
              fontSize: '0.72rem',
              fontWeight: 600,
              maxWidth: '280px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <Cpu size={12} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cpuName}</span>
          </span>

          {gpuName && (
            <span
              title={gpuName}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                borderRadius: '6px',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                color: '#a7f3d0',
                fontSize: '0.72rem',
                fontWeight: 600,
                maxWidth: '260px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <HardDrive size={12} style={{ color: '#10b981', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gpuName}</span>
            </span>
          )}

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: profile.fastNet ? 'rgba(56, 189, 248, 0.08)' : 'rgba(245, 158, 11, 0.08)',
              border: profile.fastNet ? '1px solid rgba(56, 189, 248, 0.2)' : '1px solid rgba(245, 158, 11, 0.25)',
              color: profile.fastNet ? '#9bdcfb' : '#fde68a',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            <Wifi size={12} style={{ color: profile.fastNet ? '#38bdf8' : '#f59e0b', flexShrink: 0 }} />
            <span>{profile.fastNet ? t('settings.perf_fast_net') : t('settings.perf_saver_net')}</span>
          </span>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              color: '#c7d2fe',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            <ShieldCheck size={12} style={{ color: '#818cf8', flexShrink: 0 }} />
            <span>{t('settings.perf_engine_rust')}</span>
          </span>
        </div>
      </div>
    </section>
  );
});
