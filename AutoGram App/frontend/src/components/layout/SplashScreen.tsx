import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Sparkles } from 'lucide-react';

interface SplashScreenProps {
  onFinish: () => void;
  durationMs?: number;
}

export function SplashScreen({ onFinish, durationMs = 1600 }: SplashScreenProps) {
  const { t } = useTranslation();
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFadingOut(true);
    }, durationMs - 350);

    const finishTimer = setTimeout(() => {
      onFinish();
    }, durationMs);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [durationMs, onFinish]);

  return (
    <div
      className={`ag-splash-container ${fadingOut ? 'ag-splash-fade-out' : ''}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, #111827 0%, #060911 100%)',
        color: '#f8fafc',
        userSelect: 'none',
        transition: 'opacity 0.35s ease, filter 0.35s ease',
        opacity: fadingOut ? 0 : 1,
        filter: fadingOut ? 'blur(8px)' : 'none',
      }}
    >
      {/* GLOWING LOGO ICON */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(56, 189, 248, 0.4) 0%, rgba(99, 102, 241, 0) 70%)',
            filter: 'blur(20px)',
            animation: 'agPulseGlow 2s infinite ease-in-out',
          }}
        />
        <div
          style={{
            width: '84px',
            height: '84px',
            borderRadius: '24px',
            background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 20px 40px -10px rgba(56, 189, 248, 0.5), inset 0 1px rgba(255,255,255,0.3)',
            position: 'relative',
            zIndex: 2,
          }}
        >
          <Zap size={44} style={{ color: '#ffffff', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }} />
        </div>
      </div>

      {/* APP TITLE & BADGE */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h1
          style={{
            fontSize: '2.4rem',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            margin: '0 0 8px 0',
            background: 'linear-gradient(135deg, #ffffff 0%, #bae6fd 60%, #818cf8 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {t('nav.title')}
        </h1>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 14px',
            borderRadius: '20px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            fontSize: '0.78rem',
            color: '#94a3b8',
            fontWeight: 600,
          }}
        >
          <Sparkles size={13} style={{ color: '#38bdf8' }} />
          <span>{t('ui.generated.telegram_migration_cloud_storage_engine_1675ccb')}</span>
        </div>
      </div>

      {/* PROGRESS BAR */}
      <div
        style={{
          width: '200px',
          height: '4px',
          borderRadius: '2px',
          background: 'rgba(255, 255, 255, 0.1)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'linear-gradient(90deg, #38bdf8 0%, #6366f1 100%)',
            borderRadius: '2px',
            animation: 'agSplashProgress 1.4s ease-out forwards',
          }}
        />
      </div>

      <p style={{ marginTop: '16px', fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>
        {t('nav.splash_loading')}
      </p>

      {/* CSS KEYFRAMES */}
      <style>{t('ui.generated.keyframes_agpulseglow_0_100_transform_scale_0_95_24a1414')}</style>
    </div>
  );
}
