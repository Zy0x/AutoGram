import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Check, Sparkles, Sun, Moon } from 'lucide-react';
import {
  PALETTES_LIST,
  getColorPalette,
  setColorPalette,
  subscribeColorPalette,
  getColorSchemeMode,
  getResolvedColorScheme,
  setColorSchemeMode,
  subscribeColorScheme,
  type ColorPaletteId,
  type ColorPaletteDef,
  type ColorSchemeMode,
  type ResolvedColorScheme,
} from '../../stores/themePaletteStore';

type CategoryFilter = 'all' | 'curated' | 'classic';

export const ColorPaletteSection: React.FC = () => {
  const { t } = useTranslation();
  const [activePalette, setActivePalette] = useState<ColorPaletteId>(getColorPalette);
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  const [colorScheme, setColorSchemeState] = useState<ColorSchemeMode>(getColorSchemeMode);
  const [resolvedScheme, setResolvedSchemeState] = useState<ResolvedColorScheme>(getResolvedColorScheme);

  useEffect(() => {
    const unsubPalette = subscribeColorPalette((newPalette) => {
      setActivePalette(newPalette);
    });
    const unsubScheme = subscribeColorScheme((newMode, newResolved) => {
      setColorSchemeState(newMode);
      setResolvedSchemeState(newResolved);
    });
    return () => {
      unsubPalette();
      unsubScheme();
    };
  }, []);

  const handleSelect = (id: ColorPaletteId) => {
    setColorPalette(id);
  };

  const categories: { id: CategoryFilter; labelKey: string; count: number }[] = useMemo(
    () => [
      { id: 'all', labelKey: 'settings.palette_category_all', count: PALETTES_LIST.length },
      {
        id: 'curated',
        labelKey: 'settings.palette_category_curated',
        count: PALETTES_LIST.filter((p) => p.isCurated).length,
      },
      {
        id: 'classic',
        labelKey: 'settings.palette_category_classic',
        count: PALETTES_LIST.filter((p) => !p.isCurated).length,
      },
    ],
    []
  );

  const filteredPalettes: ColorPaletteDef[] = useMemo(() => {
    if (selectedCategory === 'curated') {
      return PALETTES_LIST.filter((p) => p.isCurated);
    }
    if (selectedCategory === 'classic') {
      return PALETTES_LIST.filter((p) => !p.isCurated);
    }
    return PALETTES_LIST;
  }, [selectedCategory]);

  return (
    <div className="glass-panel card settings-section-palette" style={{ marginTop: '16px' }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Palette size={20} color="var(--color-accent, var(--primary))" />
        <h3 style={{ margin: 0 }}>{t('settings.color_palette_title')}</h3>
      </div>
      <p className="field-hint" style={{ marginTop: '4px', marginBottom: '16px', lineHeight: 1.5 }}>
        {t('settings.color_palette_desc')}
      </p>

      {/* COLOR SCHEME MODE SELECTOR (Tri-State: Dark, Light, System) */}
      <div
        style={{
          marginBottom: '20px',
          padding: '14px 16px',
          borderRadius: '12px',
          background: 'var(--bg-card, rgba(15, 23, 42, 0.4))',
          border: '1px solid var(--border-default, rgba(255, 255, 255, 0.08))',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary, #f8fafc)' }}>
              {t('settings.color_scheme_title')}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #94a3b8)', marginTop: '2px' }}>
              {t('settings.color_scheme_desc')}
            </div>
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label={t('settings.color_scheme_title')}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: '8px',
          }}
        >
          {[
            { id: 'dark' as const, labelKey: 'settings.color_scheme_dark', icon: Moon },
            { id: 'light' as const, labelKey: 'settings.color_scheme_light', icon: Sun },
          ].map((mode) => {
            const isCurrent = colorScheme === mode.id;
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={isCurrent}
                onClick={() => setColorSchemeMode(mode.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  minHeight: '44px',
                  padding: '8px 14px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  fontWeight: isCurrent ? 600 : 500,
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'all 0.16s ease',
                  background: isCurrent
                    ? 'color-mix(in srgb, var(--accent-primary, var(--color-accent, #38bdf8)) 18%, var(--bg-card, rgba(15, 23, 42, 0.6)))'
                    : 'rgba(255, 255, 255, 0.04)',
                  color: isCurrent ? 'var(--accent-primary, var(--color-accent, #38bdf8))' : 'var(--text-secondary, #94a3b8)',
                  border: isCurrent
                    ? '1.5px solid var(--accent-primary, var(--color-accent, #38bdf8))'
                    : '1px solid var(--border-default, rgba(255, 255, 255, 0.08))',
                  boxShadow: isCurrent
                    ? '0 2px 8px color-mix(in srgb, var(--accent-primary, var(--color-accent, #38bdf8)) 25%, transparent)'
                    : 'none',
                }}
              >
                <Icon size={16} />
                <span>{t(mode.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* CATEGORY FILTER TABS */}
      <div
        role="tablist"
        aria-label={t('settings.color_palette_title')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
          flexWrap: 'wrap',
        }}
      >
        {categories.map((cat) => {
          const isCatActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isCatActive}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                minHeight: '44px',
                minWidth: '44px',
                padding: '8px 16px',
                borderRadius: '999px',
                fontSize: '0.82rem',
                fontWeight: isCatActive ? 600 : 500,
                cursor: 'pointer',
                outline: 'none',
                transition: 'all 0.16s ease',
                background: isCatActive
                  ? 'var(--accent-primary, var(--color-accent, var(--primary, #38bdf8)))'
                  : 'var(--bg-card, rgba(255, 255, 255, 0.05))',
                color: isCatActive ? '#ffffff' : 'var(--text-secondary, #94a3b8)',
                border: isCatActive
                  ? '1px solid transparent'
                  : '1px solid var(--border-default, rgba(255, 255, 255, 0.1))',
                boxShadow: isCatActive
                  ? '0 2px 8px color-mix(in srgb, var(--accent-primary, var(--color-accent, #38bdf8)) 35%, transparent)'
                  : 'none',
              }}
            >
              <span>{t(cat.labelKey)}</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  background: isCatActive
                    ? 'rgba(255, 255, 255, 0.25)'
                    : 'var(--border-default, rgba(255, 255, 255, 0.08))',
                  color: isCatActive ? '#ffffff' : 'var(--text-muted, #64748b)',
                }}
              >
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* RESPONSIVE PALETTES GRID */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '14px',
        }}
      >
        {filteredPalettes.map((palette) => {
          const isSelected = activePalette === palette.id;
          const preview = (resolvedScheme === 'light' && palette.previewColorsLight)
            ? palette.previewColorsLight
            : palette.previewColors;
          const { bg, card, accent, secondary, border } = preview;

          return (
            <button
              key={palette.id}
              type="button"
              onClick={() => handleSelect(palette.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '16px',
                borderRadius: '14px',
                minHeight: '130px',
                minWidth: '44px',
                background: isSelected
                  ? 'color-mix(in srgb, var(--accent-primary, var(--color-accent, #38bdf8)) 12%, var(--bg-card, rgba(15, 23, 42, 0.75)))'
                  : 'var(--bg-card, rgba(15, 23, 42, 0.6))',
                border: isSelected
                  ? `2px solid ${accent}`
                  : '1px solid var(--border-default, rgba(255, 255, 255, 0.08))',
                boxShadow: isSelected
                  ? `0 0 18px ${accent}40, 0 4px 12px rgba(0, 0, 0, 0.4)`
                  : '0 2px 6px rgba(0, 0, 0, 0.2)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'var(--border-strong, rgba(255, 255, 255, 0.2))';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.08))';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
            >
              {/* TOP: NAME, CURATED BADGE & ACTIVE INDICATOR */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    minWidth: 0,
                    flexWrap: 'wrap',
                  }}
                >
                  <strong
                    style={{
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      color: isSelected && resolvedScheme !== 'light' ? '#ffffff' : 'var(--text-primary, #f8fafc)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t(palette.nameKey)}
                  </strong>
                  {palette.isCurated && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 7px',
                        borderRadius: '999px',
                        fontSize: '0.66rem',
                        fontWeight: 600,
                        background: `color-mix(in srgb, ${accent} 20%, transparent)`,
                        color: accent,
                        border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
                        letterSpacing: '0.02em',
                      }}
                    >
                      <Sparkles size={11} />
                      {t('settings.palette_curated_badge')}
                    </span>
                  )}
                </div>

                {isSelected ? (
                  <div
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: accent,
                      boxShadow: `0 0 10px ${accent}, inset 0 0 4px rgba(255, 255, 255, 0.4)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                    title={t('settings.palette_active_badge')}
                  >
                    <Check size={14} color="#ffffff" strokeWidth={2.5} />
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary, #94a3b8)',
                      fontWeight: 500,
                    }}
                  >
                    {t(palette.tagKey)}
                  </span>
                )}
              </div>

              {/* DESCRIPTION SNIPPET */}
              {palette.descKey && (
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.74rem',
                    lineHeight: 1.4,
                    color: isSelected && resolvedScheme !== 'light'
                      ? 'rgba(255, 255, 255, 0.88)'
                      : 'var(--text-secondary, #94a3b8)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minHeight: '2.8em',
                  }}
                >
                  {t(palette.descKey)}
                </p>
              )}

              {/* INTERACTIVE MINI-UI CANVAS PREVIEW FRAME */}
              <div
                aria-hidden="true"
                style={{
                  height: '36px',
                  width: '100%',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  border: `1px solid ${border || 'rgba(255, 255, 255, 0.12)'}`,
                  background: bg,
                  display: 'flex',
                  position: 'relative',
                  boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.3)',
                }}
              >
                {/* Mini Sidebar Column */}
                <div
                  style={{
                    width: '26px',
                    height: '100%',
                    background: card,
                    borderRight: `1px solid ${border || 'rgba(255, 255, 255, 0.1)'}`,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '4px 3px',
                    gap: '3px',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '10px',
                      height: '4px',
                      borderRadius: '2px',
                      background: accent,
                      marginBottom: '1px',
                    }}
                  />
                  <div
                    style={{
                      width: '14px',
                      height: '2px',
                      borderRadius: '1px',
                      background: secondary,
                      opacity: 0.7,
                    }}
                  />
                  <div
                    style={{
                      width: '14px',
                      height: '2px',
                      borderRadius: '1px',
                      background: secondary,
                      opacity: 0.4,
                    }}
                  />
                </div>

                {/* Mini Content Area */}
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                  }}
                >
                  {/* Mini Topbar Strip */}
                  <div
                    style={{
                      height: '10px',
                      width: '100%',
                      background: card,
                      borderBottom: `1px solid ${border || 'rgba(255, 255, 255, 0.1)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 5px',
                    }}
                  >
                    <div
                      style={{
                        width: '16px',
                        height: '2px',
                        borderRadius: '1px',
                        background: resolvedScheme === 'light' ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.4)',
                      }}
                    />
                    <div
                      style={{
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        background: accent,
                      }}
                    />
                  </div>

                  {/* Mini Canvas Body */}
                  <div
                    style={{
                      flex: 1,
                      padding: '3px 5px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '4px',
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: '12px',
                        borderRadius: '3px',
                        background: card,
                        border: `1px solid ${border || 'rgba(255, 255, 255, 0.08)'}`,
                        opacity: 0.9,
                      }}
                    />
                    {/* Mini Primary Button Dot/Pill */}
                    <div
                      style={{
                        width: '20px',
                        height: '10px',
                        borderRadius: '999px',
                        background: accent,
                        boxShadow: `0 0 6px ${accent}66`,
                        flexShrink: 0,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* 5-PART COLOR SWATCH STRIP */}
              <div
                style={{
                  display: 'flex',
                  height: '14px',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  border: `1px solid ${border || 'rgba(255, 255, 255, 0.14)'}`,
                  width: '100%',
                  marginTop: '2px',
                }}
              >
                <span
                  title={t('settings.palette_swatch_bg')}
                  style={{
                    flex: 1.4,
                    background: bg,
                  }}
                />
                <span
                  title={t('settings.palette_swatch_card')}
                  style={{
                    flex: 1.2,
                    background: card,
                  }}
                />
                <span
                  title={t('settings.palette_swatch_accent')}
                  style={{
                    flex: 1,
                    background: accent,
                  }}
                />
                <span
                  title={t('settings.palette_swatch_secondary')}
                  style={{
                    flex: 1,
                    background: secondary,
                  }}
                />
                <span
                  title={t('settings.palette_swatch_border')}
                  style={{
                    flex: 0.9,
                    background: border || (resolvedScheme === 'light' ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.15)'),
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
