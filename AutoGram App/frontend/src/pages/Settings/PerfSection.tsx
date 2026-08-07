import { useState, memo } from 'react';
import { Sliders, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setPerfTierOverride, type PerfTier } from '../../lib/utils/devicePerformance';

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

  const handleSelectTier = (newTier: PerfTier) => {
    setTier(newTier);
    setPerfTierOverride(newTier);
  };

  const options: { id: PerfTier; title: string; desc: string; badge?: string; icon: string }[] = [
    {
      id: 'low',
      icon: '🍃',
      title: t('settings.perf_tier_low_title', 'Saver Mode'),
      desc: t('settings.perf_tier_low_desc', 'Saves RAM & CPU usage. Small thumbnail batching (20 items per request).'),
    },
    {
      id: 'mid',
      icon: '⚡',
      title: t('settings.perf_tier_mid_title', 'Standard Mode'),
      badge: 'DEFAULT',
      desc: t('settings.perf_tier_mid_desc', 'Ideal balance of MTProto transfer speed & visual smoothness (48 batch).'),
    },
    {
      id: 'high',
      icon: '🚀',
      title: t('settings.perf_tier_high_title', 'Turbo Mode'),
      desc: t('settings.perf_tier_high_desc', 'Maximum throughput for fast devices & networks (96 batch, 6 parallel streams).'),
    },
  ];

  return (
    <div
      style={{
        position: 'relative',
        background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* STICKY SECTION HEADER */}
      <div
        style={{
          position: 'sticky',
          top: '0px',
          zIndex: 20,
          background: 'rgba(11, 16, 26, 0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          padding: '14px 18px',
          margin: '-24px -24px 18px -24px',
          borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '10px',
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Sliders size={18} style={{ color: '#38bdf8' }} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
            {t('settings.perf_section_1_title', '1. Device Performance Optimization')}
          </h3>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.3 }}>
            {t('settings.perf_subtitle', 'Configure acceleration levels for downloading, thumbnail loading, and card list rendering smoothness.')}
          </p>
        </div>
      </div>

      {/* OPTIONS LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {options.map((opt) => {
          const isSelected = tier === opt.id;
          return (
            <div
              key={opt.id}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectTier(opt.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectTier(opt.id);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '14px',
                padding: '16px 18px',
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                border: isSelected
                  ? '1.5px solid #00aeef'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                background: isSelected
                  ? 'rgba(56, 189, 248, 0.07)'
                  : 'rgba(15, 23, 42, 0.4)',
                boxShadow: isSelected ? '0 0 16px rgba(56, 189, 248, 0.15)' : 'none',
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: isSelected ? '5px solid #00aeef' : '2px solid #475569',
                  boxSizing: 'border-box',
                  marginTop: '2px',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                  background: isSelected ? '#00aeef' : 'transparent',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: isSelected ? '#00aeef' : '#f8fafc',
                    marginBottom: '4px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    {opt.icon} {opt.title}
                  </span>
                  {opt.badge && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: '#0284c7',
                        color: '#ffffff',
                        fontWeight: 700,
                        letterSpacing: '0.5px',
                      }}
                    >
                      {opt.badge}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.82rem',
                    color: '#94a3b8',
                    lineHeight: 1.45,
                  }}
                >
                  {opt.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* FOOTER ACTIVE STATUS */}
      <div
        style={{
          marginTop: '16px',
          padding: '10px 14px',
          background: 'rgba(0, 0, 0, 0.35)',
          borderRadius: '10px',
          fontSize: '0.8rem',
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <Cpu size={15} style={{ color: '#00aeef' }} />
        <span>{t('settings.perf_status_active', 'Active Status:')}</span>
        <strong style={{ color: '#00aeef' }}>
          {tier === 'low'
            ? t('settings.perf_tier_low_title', 'Saver Mode')
            : tier === 'high'
            ? t('settings.perf_tier_high_title', 'Turbo Mode')
            : t('settings.perf_tier_mid_title', 'Standard Mode')}
        </strong>
        <span>· {t('settings.perf_engine_rust', 'Rust MTProto Engine')}</span>
      </div>
    </div>
  );
});
