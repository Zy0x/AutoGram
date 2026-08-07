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
      title: t('settings.perf_tier_low_title', 'Mode Hemat'),
      desc: t('settings.perf_tier_low_desc', 'Menghemat penggunaan RAM & CPU. Batch thumbnail kecil (20 item per request).'),
    },
    {
      id: 'mid',
      icon: '⚡',
      title: t('settings.perf_tier_mid_title', 'Mode Standar'),
      badge: 'DEFAULT',
      desc: t('settings.perf_tier_mid_desc', 'Keseimbangan ideal kecepatan transfer MTProto & kelancaran visual (48 batch).'),
    },
    {
      id: 'high',
      icon: '🚀',
      title: t('settings.perf_tier_high_title', 'Mode Turbo'),
      desc: t('settings.perf_tier_high_desc', 'Throughput maksimal untuk perangkat & jaringan cepat (96 batch, 6 stream paralel).'),
    },
  ];

  return (
    <div
      style={{
        background: 'linear-gradient(150deg, rgba(20, 26, 38, 0.7) 0%, rgba(11, 16, 26, 0.85) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '20px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* SECTION HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sliders size={18} style={{ color: '#38bdf8' }} />
        </div>
        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
          {t('settings.perf_section_1_title', '1. Optimasi Performa Perangkat')}
        </h3>
      </div>
      <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5 }}>
        {t('settings.perf_subtitle', 'Atur tingkat akselerasi pengunduhan, pemuatan thumbnail, dan kelancaran render list card.')}
      </p>

      {/* OPTIONS GRID */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                gap: '12px',
                padding: '14px 16px',
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                border: isSelected
                  ? '1.5px solid rgba(56, 189, 248, 0.6)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                background: isSelected
                  ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(3, 105, 161, 0.18) 100%)'
                  : 'rgba(255, 255, 255, 0.02)',
                boxShadow: isSelected ? '0 0 16px rgba(56, 189, 248, 0.15)' : 'none',
              }}
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: isSelected ? '5px solid #38bdf8' : '2px solid #64748b',
                  boxSizing: 'border-box',
                  marginTop: '2px',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 700,
                    fontSize: '0.92rem',
                    color: isSelected ? '#38bdf8' : '#f8fafc',
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
                        fontSize: '0.62rem',
                        padding: '2px 7px',
                        borderRadius: '6px',
                        background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
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
                    fontSize: '0.8rem',
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

      {/* FOOTER STATUS */}
      <div
        style={{
          marginTop: '14px',
          padding: '10px 14px',
          background: 'rgba(0, 0, 0, 0.25)',
          borderRadius: '10px',
          fontSize: '0.78rem',
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <Cpu size={14} style={{ color: '#38bdf8' }} />
        <span>{t('settings.perf_status_active', 'Status Aktif:')}</span>
        <strong style={{ color: '#38bdf8' }}>
          {tier === 'low'
            ? t('settings.perf_tier_low_title', 'Mode Hemat')
            : tier === 'high'
            ? t('settings.perf_tier_high_title', 'Mode Turbo')
            : t('settings.perf_tier_mid_title', 'Mode Standar')}
        </strong>
        <span>· {t('settings.perf_engine_rust', 'Engine MTProto Rust')}</span>
      </div>
    </div>
  );
});
