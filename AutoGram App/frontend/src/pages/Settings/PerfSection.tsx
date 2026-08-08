import { memo, useMemo, useState, type ComponentType } from 'react';
import { Battery, Cpu, Gauge, SlidersHorizontal, Sparkles, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setPerfTierOverride, type PerfTier } from '../../lib/utils/devicePerformance';

type TierOption = {
  id: PerfTier;
  title: string;
  desc: string;
  metric: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

export const PerfSection = memo(function PerfSection() {
  const { t } = useTranslation();
  const [tier, setTier] = useState<PerfTier>(() => {
    try {
      const saved = localStorage.getItem('autogram_perf_tier');
      if (saved === 'low' || saved === 'mid' || saved === 'high') return saved;
    } catch {
      /* ignore */
    }
    return 'mid';
  });

  const recommendedTier = useMemo<PerfTier>(() => {
    try {
      const cores = navigator.hardwareConcurrency || 4;
      if (cores >= 8) return 'high';
      if (cores >= 4) return 'mid';
      return 'low';
    } catch {
      return 'mid';
    }
  }, []);

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
  };

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

      <div className="settings-perf-status" role="status">
        <Cpu size={16} strokeWidth={2} aria-hidden />
        <span>{t('settings.perf_status_active')}</span>
        <strong>
          {tier === 'low'
            ? t('settings.perf_tier_low_title')
            : tier === 'high'
              ? t('settings.perf_tier_high_title')
              : t('settings.perf_tier_mid_title')}
        </strong>
        <span className="settings-perf-engine">{t('settings.perf_engine_rust')}</span>
      </div>
    </section>
  );
});
