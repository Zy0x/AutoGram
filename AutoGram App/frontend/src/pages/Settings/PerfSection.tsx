import { useState, memo } from 'react';
import { Sliders } from 'lucide-react';
import { getDrivePerfProfile, setPerfTierOverride, type PerfTier } from '../../lib/devicePerformance';

export const PerfSection = memo(function PerfSection() {
  const [tier, setTier] = useState<PerfTier>(() => {
    try {
      const saved = localStorage.getItem('autogram_perf_tier');
      if (saved === 'low' || saved === 'mid' || saved === 'high') return saved;
    } catch {
      /* ignore */
    }
    return 'mid'; // Mode Standar Default
  });

  const handleSelectTier = (newTier: PerfTier) => {
    setTier(newTier);
    setPerfTierOverride(newTier);
  };

  const profile = getDrivePerfProfile();

  const options: { id: PerfTier; title: string; desc: string; badge?: string; icon: string }[] = [
    {
      id: 'low',
      icon: '🍃',
      title: 'Mode Hemat',
      desc: 'Menghemat penggunaan RAM & CPU. Batch thumbnail kecil (20 item per request).',
    },
    {
      id: 'mid',
      icon: '⚡',
      title: 'Mode Standar',
      badge: 'DEFAULT',
      desc: 'Keseimbangan ideal kecepatan transfer MTProto & kelancaran visual (48 batch).',
    },
    {
      id: 'high',
      icon: '🚀',
      title: 'Mode Turbo',
      desc: 'Throughput maksimal untuk perangkat & jaringan cepat (96 batch, 6 stream paralel).',
    },
  ];

  return (
    <div className="glass-panel card">
      <div className="card-header">
        <Sliders size={20} color="var(--primary)" />
        <h3>Mode Optimasi Performa Perangkat</h3>
      </div>
      <p className="field-hint" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
        Atur tingkat akselerasi pengunduhan, pemuatan thumbnail, dan kelancaran render list card.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
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
                gap: '0.75rem',
                padding: '0.875rem 1rem',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                border: isSelected
                  ? '1.5px solid var(--primary)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                background: isSelected
                  ? 'rgba(var(--primary-rgb, 59, 130, 246), 0.12)'
                  : 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: isSelected ? '5px solid var(--primary)' : '2px solid var(--text-muted)',
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
                    gap: '0.5rem',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    color: isSelected ? 'var(--text-main, #ffffff)' : 'var(--text-secondary, #e2e8f0)',
                    marginBottom: '0.2rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    {opt.icon} {opt.title}
                  </span>
                  {opt.badge && (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '1.5px 6px',
                        borderRadius: '4px',
                        background: 'var(--primary)',
                        color: '#ffffff',
                        fontWeight: 700,
                        letterSpacing: '0.5px',
                        lineHeight: 1.2,
                      }}
                    >
                      {opt.badge}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-muted, #94a3b8)',
                    lineHeight: 1.4,
                  }}
                >
                  {opt.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: '1rem',
          padding: '0.625rem 0.875rem',
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: '8px',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
        }}
      >
        Status Aktif: <strong style={{ color: 'var(--primary)' }}>{profile.label}</strong> · Engine MTProto Rust
      </div>
    </div>
  );
});
