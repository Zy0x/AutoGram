import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';
import {
  getColorSchemeMode,
  getResolvedColorScheme,
  toggleColorSchemeMode,
  subscribeColorScheme,
  type ColorSchemeMode,
  type ResolvedColorScheme,
} from '../../stores/themePaletteStore';

interface QuickColorSchemeToggleProps {
  className?: string;
  style?: React.CSSProperties;
}

export const QuickColorSchemeToggle: React.FC<QuickColorSchemeToggleProps> = ({
  className,
  style,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ColorSchemeMode>(getColorSchemeMode);
  const [resolved, setResolved] = useState<ResolvedColorScheme>(getResolvedColorScheme);

  useEffect(() => {
    return subscribeColorScheme((newMode, newResolved) => {
      setMode(newMode);
      setResolved(newResolved);
    });
  }, []);

  const handleClick = () => {
    const nextMode = toggleColorSchemeMode();
    setMode(nextMode);
    setResolved(getResolvedColorScheme());
  };

  const isLight = resolved === 'light' || mode === 'light';
  const modeLabel = isLight ? t('settings.mode_light') : t('settings.mode_dark');
  const title = `${t('nav.color_scheme_toggle')} (${modeLabel})`;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '0 10px',
        height: '36px',
        minHeight: '44px',
        minWidth: '44px',
        borderRadius: '10px',
        background: 'color-mix(in srgb, var(--bg-card, #141a26) 60%, transparent)',
        border: '1px solid var(--border-default, rgba(255, 255, 255, 0.1))',
        color: 'var(--text-primary, #f8fafc)',
        fontSize: '0.82rem',
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor =
          'color-mix(in srgb, var(--accent-primary, #38bdf8) 45%, transparent)';
        e.currentTarget.style.color = 'var(--accent-primary, #38bdf8)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor =
          'var(--border-default, rgba(255, 255, 255, 0.1))';
        e.currentTarget.style.color = 'var(--text-primary, #f8fafc)';
      }}
      title={title}
      aria-label={title}
    >
      {isLight ? <Sun size={15} /> : <Moon size={15} />}
      <span style={{ fontSize: '0.75rem', textTransform: 'capitalize' }}>
        {modeLabel}
      </span>
    </button>
  );
};
