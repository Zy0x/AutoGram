import { memo, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Battery, CheckCircle2, Cpu, Gauge, HardDrive, Loader2, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Wifi, Zap } from 'lucide-react';
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

  const [clearingRam, setClearingRam] = useState(false);
  const [clearedSuccess, setClearedSuccess] = useState(false);

  const selectTier = (nextTier: PerfTier) => {
    setTier(nextTier);
    setPerfTierOverride(nextTier);
    window.dispatchEvent(new CustomEvent('autogram-perf-tier-changed', { detail: nextTier }));
    window.dispatchEvent(new CustomEvent('autogram-emergency-memory-reclaim'));
    void garbageCollector.runGarbageCollection();
  };

  const handleClearRam = async () => {
    if (clearingRam) return;
    setClearingRam(true);
    setClearedSuccess(false);
    try {
      window.dispatchEvent(new CustomEvent('autogram-emergency-memory-reclaim'));
      await garbageCollector.runGarbageCollection();
      garbageCollector.forcePurgeAll();
      setClearedSuccess(true);
      setTimeout(() => setClearedSuccess(false), 3000);
    } catch {
      /* ignore */
    } finally {
      setClearingRam(false);
    }
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
                  <span className="settings-tier-title-group">
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
        <div className="settings-perf-status-header">
          <div className="settings-perf-status-label">
            <Cpu size={15} strokeWidth={2} className="settings-perf-status-icon" aria-hidden />
            <span>{t('settings.perf_status_active')}</span>
            <strong className="settings-perf-status-tier">
              {tier === 'low'
                ? t('settings.perf_tier_low_title')
                : tier === 'high'
                  ? t('settings.perf_tier_high_title')
                  : t('settings.perf_tier_mid_title')}
            </strong>
          </div>
          <span className="settings-perf-live-pill">
            <span className="settings-perf-pulse-dot" aria-hidden />
            <ShieldCheck size={12} className="settings-perf-chip-icon" aria-hidden />
            <span>{t('settings.perf_engine_rust')}</span>
          </span>
        </div>

        <div className="settings-perf-chips-row">
          <span title={cpuName} className="settings-perf-chip settings-perf-chip-cpu">
            <Cpu size={12} className="settings-perf-chip-icon" />
            <span className="settings-perf-chip-text">{cpuName}</span>
          </span>

          {gpuName && (
            <span title={gpuName} className="settings-perf-chip settings-perf-chip-gpu">
              <HardDrive size={12} className="settings-perf-chip-icon" />
              <span className="settings-perf-chip-text">{gpuName}</span>
            </span>
          )}

          <span className={`settings-perf-chip settings-perf-chip-net ${profile.fastNet ? 'is-fast' : 'is-saver'}`}>
            <Wifi size={12} className="settings-perf-chip-icon" />
            <span>{profile.fastNet ? t('settings.perf_fast_net') : t('settings.perf_saver_net')}</span>
          </span>
        </div>
      </div>

      {/* CLEAR RAM & FLUSH MEMORY BAR */}
      <div className="settings-perf-ram-bar">
        <div className="settings-perf-ram-text">
          <span className="settings-perf-ram-title">
            {t('settings.perf_clear_ram_btn')}
          </span>
          <span className="settings-perf-ram-desc">
            {t('settings.perf_clear_ram_desc')}
          </span>
        </div>

        <div className="settings-perf-ram-actions">
          {clearedSuccess && (
            <span className="settings-perf-ram-success-badge">
              <CheckCircle2 size={13} />
              <span>{t('settings.perf_clear_ram_success')}</span>
            </span>
          )}

          <button
            type="button"
            disabled={clearingRam}
            onClick={handleClearRam}
            className="settings-perf-ram-btn"
          >
            {clearingRam ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>{t('settings.perf_clear_ram_clearing')}</span>
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                <span>{t('settings.perf_clear_ram_btn')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
});
