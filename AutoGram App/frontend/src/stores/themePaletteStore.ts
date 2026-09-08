export type ColorPaletteId =
  | 'tokyo_midnight'
  | 'emerald_forest'
  | 'luxury_gold'
  | 'nord_frost'
  | 'cyberpunk_matrix'
  | 'default'
  | 'solar_flare'
  | 'warm_clay'
  | 'warm_mocha'
  | 'lavender_dusk'
  | 'botanical_sage'
  | 'anarchy_crimson'
  | 'vintage_amber';

export type ThemeAliasId =
  | 'crimson_velvet'
  | 'emerald_glow'
  | 'cyberpunk_violet'
  | 'obsidian_slate';

export type ColorSchemeMode = 'dark' | 'light' | 'system';
export type ResolvedColorScheme = 'dark' | 'light';

export const LS_COLOR_SCHEME_KEY = 'autogram_color_scheme';
export const COLOR_SCHEME_EVENT = 'autogram:color_scheme_change';

export interface ColorPaletteTokens {
  // Canvas & Panels
  '--bg-main': string;
  '--bg-card': string;
  '--bg-dark': string;
  '--bg-panel': string;
  '--surface-light': string;
  '--surface-elevated': string;

  // Accents & Highlights
  '--color-accent': string;
  '--color-secondary': string;
  '--primary': string;
  '--accent': string;
  '--glow-primary': string;
  '--color-secondary-card': string;
  '--color-secondary-border': string;

  // Typography & Badges
  '--text-primary': string;
  '--text-secondary': string;
  '--badge-bg': string;
  '--badge-text': string;
  '--status-dot': string;

  // Borders & Focus
  '--border-color': string;
  '--input-focus-ring': string;
  '--input-bg': string;

  // Cloud Drives Subsystem
  '--td-bg': string;
  '--td-surface': string;
  '--td-topbar-bg': string;
  '--td-card-bg': string;
  '--td-card-hover': string;
  '--td-primary': string;
  '--td-border': string;
  '--td-accent-gold': string;

  // Forwarder & Settings Subsystems
  '--fw-bg': string;
  '--fw-surface': string;
  '--fw-primary': string;
  '--settings-surface': string;
  '--settings-accent': string;
  '--modal-bg': string;

  // Semantic Bridge Tokens (Central Theme Contract)
  '--accent-primary': string;
  '--accent-secondary': string;
  '--accent-glow': string;
  '--border-hover': string;
  '--border-default': string;
  '--bg-sidebar': string;
  '--bg-elevated': string;
  '--bg-modal': string;
  '--text-inverse': string;
}

export interface ColorPaletteDef {
  id: ColorPaletteId;
  nameKey: string;
  tagKey: string;
  descKey?: string;
  isCurated?: boolean;
  tokens: ColorPaletteTokens;
  tokensLight?: ColorPaletteTokens;
  previewColors: {
    bg: string;
    card: string;
    accent: string;
    secondary: string;
    border?: string;
  };
  previewColorsLight?: {
    bg: string;
    card: string;
    accent: string;
    secondary: string;
    border?: string;
  };
}

interface PaletteTokenParams {
  bgMain: string;
  bgCard: string;
  bgDark: string;
  bgPanel: string;
  surfaceLight: string;
  surfaceElevated: string;
  colorAccent: string;
  colorSecondary: string;
  primary?: string;
  accent?: string;
  glowPrimary?: string;
  colorSecondaryCard?: string;
  colorSecondaryBorder?: string;
  textPrimary?: string;
  textSecondary?: string;
  badgeBg?: string;
  badgeText?: string;
  statusDot?: string;
  borderColor: string;
  inputFocusRing?: string;
  inputBg?: string;
  tdBg?: string;
  tdSurface?: string;
  tdTopbarBg?: string;
  tdCardBg?: string;
  tdCardHover?: string;
  tdPrimary?: string;
  tdBorder?: string;
  tdAccentGold?: string;
  fwBg?: string;
  fwSurface?: string;
  fwPrimary?: string;
  settingsSurface?: string;
  settingsAccent?: string;
  modalBg?: string;
}

function buildTokens(p: PaletteTokenParams): ColorPaletteTokens {
  const primary = p.primary ?? p.colorAccent;
  const accent = p.accent ?? p.colorSecondary;
  const tdBg = p.tdBg ?? p.bgDark;
  const tdSurface = p.tdSurface ?? p.surfaceLight;

  return {
    '--bg-main': p.bgMain,
    '--bg-card': p.bgCard,
    '--bg-dark': p.bgDark,
    '--bg-panel': p.bgPanel,
    '--surface-light': p.surfaceLight,
    '--surface-elevated': p.surfaceElevated,

    '--color-accent': p.colorAccent,
    '--color-secondary': p.colorSecondary,
    '--primary': primary,
    '--accent': accent,
    '--glow-primary': p.glowPrimary ?? `color-mix(in srgb, ${primary} 35%, transparent)`,
    '--color-secondary-card': p.colorSecondaryCard ?? `color-mix(in srgb, ${accent} 14%, transparent)`,
    '--color-secondary-border': p.colorSecondaryBorder ?? `color-mix(in srgb, ${accent} 35%, transparent)`,

    '--text-primary': p.textPrimary ?? '#f8fafc',
    '--text-secondary': p.textSecondary ?? '#94a3b8',
    '--badge-bg': p.badgeBg ?? `color-mix(in srgb, ${primary} 15%, transparent)`,
    '--badge-text': p.badgeText ?? primary,
    '--status-dot': p.statusDot ?? primary,

    '--border-color': p.borderColor,
    '--input-focus-ring': p.inputFocusRing ?? primary,
    '--input-bg': p.inputBg ?? `color-mix(in srgb, ${p.bgDark} 85%, #000)`,

    '--td-bg': tdBg,
    '--td-surface': tdSurface,
    '--td-topbar-bg': p.tdTopbarBg ?? `color-mix(in srgb, ${tdSurface} 90%, transparent)`,
    '--td-card-bg': p.tdCardBg ?? p.bgPanel,
    '--td-card-hover': p.tdCardHover ?? `color-mix(in srgb, ${p.surfaceElevated} 90%, transparent)`,
    '--td-primary': p.tdPrimary ?? primary,
    '--td-border': p.tdBorder ?? p.borderColor,
    '--td-accent-gold': p.tdAccentGold ?? accent,

    '--fw-bg': p.fwBg ?? p.bgDark,
    '--fw-surface': p.fwSurface ?? tdSurface,
    '--fw-primary': p.fwPrimary ?? primary,
    '--settings-surface': p.settingsSurface ?? p.bgCard,
    '--settings-accent': p.settingsAccent ?? primary,
    '--modal-bg': p.modalBg ?? `color-mix(in srgb, ${tdSurface} 95%, #000)`,

    // Semantic Bridge Tokens (Central Theme Contract)
    '--accent-primary': primary,
    '--accent-secondary': accent,
    '--accent-glow': p.glowPrimary ?? `color-mix(in srgb, ${primary} 35%, transparent)`,
    '--border-hover': p.colorSecondaryBorder ?? p.borderColor,
    '--border-default': p.borderColor,
    '--bg-sidebar': tdSurface,
    '--bg-elevated': p.surfaceElevated,
    '--bg-modal': p.modalBg ?? `color-mix(in srgb, ${tdSurface} 95%, #000)`,
    '--text-inverse': '#ffffff',
  };
}

export const COLOR_PALETTES: Record<ColorPaletteId, ColorPaletteDef> = {
  // ─── 5 CURATED MODERN THEMES ───────────────────────────────────────────────
  tokyo_midnight: {
    id: 'tokyo_midnight',
    nameKey: 'settings.palette_tokyo_midnight_name',
    tagKey: 'settings.palette_tokyo_midnight_tag',
    descKey: 'settings.palette_tokyo_midnight_desc',
    isCurated: true,
    previewColors: {
      bg: '#070b14',
      card: '#10192e',
      accent: '#a855f7',
      secondary: '#06b6d4',
      border: 'rgba(168, 85, 247, 0.25)',
    },
    previewColorsLight: {
      bg: '#f8f6ff',
      card: '#ffffff',
      accent: '#7e22ce',
      secondary: '#0284c7',
      border: '#dfd7fb',
    },
    tokens: buildTokens({
      bgMain: '#070b14',
      bgCard: '#10192e',
      bgDark: '#070b14',
      bgPanel: 'rgba(16, 25, 46, 0.75)',
      surfaceLight: '#16223d',
      surfaceElevated: '#1c2b4d',
      colorAccent: '#a855f7',
      colorSecondary: '#06b6d4',
      primary: '#a855f7',
      accent: '#06b6d4',
      glowPrimary: 'rgba(168, 85, 247, 0.45)',
      colorSecondaryCard: 'rgba(6, 182, 212, 0.15)',
      colorSecondaryBorder: 'rgba(6, 182, 212, 0.4)',
      textPrimary: '#f8fafc',
      textSecondary: '#a5b4fc',
      badgeBg: 'rgba(168, 85, 247, 0.18)',
      badgeText: '#c084fc',
      statusDot: '#06b6d4',
      borderColor: 'rgba(168, 85, 247, 0.22)',
      inputFocusRing: '#a855f7',
      inputBg: 'rgba(8, 13, 24, 0.85)',
      tdBg: '#070b14',
      tdSurface: '#0a101d',
      tdTopbarBg: 'rgba(10, 16, 29, 0.88)',
      tdCardBg: 'rgba(16, 25, 46, 0.72)',
      tdCardHover: 'rgba(23, 36, 66, 0.9)',
      tdPrimary: '#a855f7',
      tdBorder: 'rgba(168, 85, 247, 0.22)',
      tdAccentGold: '#06b6d4',
      fwBg: '#070b14',
      fwSurface: '#0a101d',
      fwPrimary: '#a855f7',
      settingsSurface: 'rgba(16, 25, 46, 0.88)',
      settingsAccent: '#a855f7',
      modalBg: 'rgba(10, 16, 30, 0.96)',
    }),
    tokensLight: buildTokens({
      bgMain: '#f8f6ff',
      bgCard: '#ffffff',
      bgDark: '#f8f6ff',
      bgPanel: '#ffffff',
      surfaceLight: '#f0ecff',
      surfaceElevated: '#fcfaff',
      colorAccent: '#7e22ce',
      colorSecondary: '#0284c7',
      primary: '#7e22ce',
      accent: '#0284c7',
      glowPrimary: 'rgba(126, 34, 206, 0.25)',
      colorSecondaryCard: 'rgba(2, 132, 199, 0.10)',
      colorSecondaryBorder: 'rgba(2, 132, 199, 0.35)',
      textPrimary: '#180b2d',
      textSecondary: '#4e3575',
      badgeBg: 'rgba(126, 34, 206, 0.12)',
      badgeText: '#7e22ce',
      statusDot: '#7e22ce',
      borderColor: '#dfd7fb',
      inputFocusRing: '#7e22ce',
      inputBg: '#ffffff',
      tdBg: '#f8f6ff',
      tdSurface: '#f0ecff',
      tdTopbarBg: 'rgba(240, 236, 255, 0.92)',
      tdCardBg: '#ffffff',
      tdCardHover: '#fcfaff',
      tdPrimary: '#7e22ce',
      tdBorder: '#dfd7fb',
      tdAccentGold: '#0284c7',
      fwBg: '#f8f6ff',
      fwSurface: '#f0ecff',
      fwPrimary: '#7e22ce',
      settingsSurface: '#ffffff',
      settingsAccent: '#7e22ce',
      modalBg: '#ffffff',
    }),
  },

  emerald_forest: {
    id: 'emerald_forest',
    nameKey: 'settings.palette_emerald_forest_name',
    tagKey: 'settings.palette_emerald_forest_tag',
    descKey: 'settings.palette_emerald_forest_desc',
    isCurated: true,
    previewColors: {
      bg: '#040d09',
      card: '#0c2118',
      accent: '#10b981',
      secondary: '#6ee7b7',
      border: 'rgba(16, 185, 129, 0.25)',
    },
    previewColorsLight: {
      bg: '#f1fbf5',
      card: '#ffffff',
      accent: '#047857',
      secondary: '#10b981',
      border: '#cfead9',
    },
    tokens: buildTokens({
      bgMain: '#040d09',
      bgCard: '#0c2118',
      bgDark: '#040d09',
      bgPanel: 'rgba(12, 33, 24, 0.75)',
      surfaceLight: '#123023',
      surfaceElevated: '#173d2d',
      colorAccent: '#10b981',
      colorSecondary: '#6ee7b7',
      primary: '#10b981',
      accent: '#6ee7b7',
      glowPrimary: 'rgba(168, 85, 247, 0.45)',
      colorSecondaryCard: 'rgba(110, 231, 183, 0.15)',
      colorSecondaryBorder: 'rgba(110, 231, 183, 0.35)',
      textPrimary: '#ecfdf5',
      textSecondary: '#a7f3d0',
      badgeBg: 'rgba(16, 185, 129, 0.18)',
      badgeText: '#34d399',
      statusDot: '#10b981',
      borderColor: 'rgba(16, 185, 129, 0.2)',
      inputFocusRing: '#10b981',
      inputBg: 'rgba(5, 17, 12, 0.85)',
      tdBg: '#040d09',
      tdSurface: '#071710',
      tdTopbarBg: 'rgba(7, 23, 16, 0.88)',
      tdCardBg: 'rgba(12, 33, 24, 0.7)',
      tdCardHover: 'rgba(18, 48, 35, 0.88)',
      tdPrimary: '#10b981',
      tdBorder: 'rgba(16, 185, 129, 0.2)',
      tdAccentGold: '#6ee7b7',
      fwBg: '#040d09',
      fwSurface: '#071710',
      fwPrimary: '#10b981',
      settingsSurface: 'rgba(12, 33, 24, 0.88)',
      settingsAccent: '#10b981',
      modalBg: 'rgba(7, 24, 17, 0.96)',
    }),
    tokensLight: buildTokens({
      bgMain: '#f1fbf5',
      bgCard: '#ffffff',
      bgDark: '#f1fbf5',
      bgPanel: '#ffffff',
      surfaceLight: '#e7f7ed',
      surfaceElevated: '#f7fdf9',
      colorAccent: '#047857',
      colorSecondary: '#10b981',
      primary: '#047857',
      accent: '#10b981',
      glowPrimary: 'rgba(4, 120, 87, 0.25)',
      colorSecondaryCard: 'rgba(16, 185, 129, 0.10)',
      colorSecondaryBorder: 'rgba(16, 185, 129, 0.35)',
      textPrimary: '#052417',
      textSecondary: '#24583f',
      badgeBg: 'rgba(4, 120, 87, 0.12)',
      badgeText: '#047857',
      statusDot: '#047857',
      borderColor: '#cfead9',
      inputFocusRing: '#047857',
      inputBg: '#ffffff',
      tdBg: '#f1fbf5',
      tdSurface: '#e7f7ed',
      tdTopbarBg: 'rgba(231, 247, 237, 0.92)',
      tdCardBg: '#ffffff',
      tdCardHover: '#f7fdf9',
      tdPrimary: '#047857',
      tdBorder: '#cfead9',
      tdAccentGold: '#10b981',
      fwBg: '#f1fbf5',
      fwSurface: '#e7f7ed',
      fwPrimary: '#047857',
      settingsSurface: '#ffffff',
      settingsAccent: '#047857',
      modalBg: '#ffffff',
    }),
  },

  luxury_gold: {
    id: 'luxury_gold',
    nameKey: 'settings.palette_luxury_gold_name',
    tagKey: 'settings.palette_luxury_gold_tag',
    descKey: 'settings.palette_luxury_gold_desc',
    isCurated: true,
    previewColors: {
      bg: '#08080a',
      card: '#16161e',
      accent: '#f59e0b',
      secondary: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.25)',
    },
    previewColorsLight: {
      bg: '#faf7f2',
      card: '#ffffff',
      accent: '#b45309',
      secondary: '#d97706',
      border: '#e7dfd5',
    },
    tokens: buildTokens({
      bgMain: '#08080a',
      bgCard: '#16161e',
      bgDark: '#08080a',
      bgPanel: 'rgba(22, 22, 30, 0.75)',
      surfaceLight: '#1c1c27',
      surfaceElevated: '#242433',
      colorAccent: '#f59e0b',
      colorSecondary: '#fbbf24',
      primary: '#f59e0b',
      accent: '#fbbf24',
      glowPrimary: 'rgba(245, 158, 11, 0.45)',
      colorSecondaryCard: 'rgba(251, 191, 36, 0.15)',
      colorSecondaryBorder: 'rgba(251, 191, 36, 0.35)',
      textPrimary: '#fffbeb',
      textSecondary: '#d4a373',
      badgeBg: 'rgba(245, 158, 11, 0.18)',
      badgeText: '#fbbf24',
      statusDot: '#f59e0b',
      borderColor: 'rgba(245, 158, 11, 0.22)',
      inputFocusRing: '#f59e0b',
      inputBg: 'rgba(12, 12, 16, 0.9)',
      tdBg: '#08080a',
      tdSurface: '#0d0d12',
      tdTopbarBg: 'rgba(13, 13, 18, 0.9)',
      tdCardBg: 'rgba(22, 22, 30, 0.75)',
      tdCardHover: 'rgba(32, 32, 44, 0.9)',
      tdPrimary: '#f59e0b',
      tdBorder: 'rgba(245, 158, 11, 0.2)',
      tdAccentGold: '#fbbf24',
      fwBg: '#08080a',
      fwSurface: '#0d0d12',
      fwPrimary: '#f59e0b',
      settingsSurface: 'rgba(22, 22, 30, 0.88)',
      settingsAccent: '#f59e0b',
      modalBg: 'rgba(14, 14, 19, 0.97)',
    }),
    tokensLight: buildTokens({
      bgMain: '#faf7f2',
      bgCard: '#ffffff',
      bgDark: '#faf7f2',
      bgPanel: '#ffffff',
      surfaceLight: '#f4efe6',
      surfaceElevated: '#fdfbf7',
      colorAccent: '#b45309',
      colorSecondary: '#d97706',
      primary: '#b45309',
      accent: '#d97706',
      glowPrimary: 'rgba(180, 83, 9, 0.25)',
      colorSecondaryCard: 'rgba(217, 119, 6, 0.12)',
      colorSecondaryBorder: 'rgba(217, 119, 6, 0.35)',
      textPrimary: '#1c1917',
      textSecondary: '#57534e',
      badgeBg: 'rgba(180, 83, 9, 0.12)',
      badgeText: '#b45309',
      statusDot: '#b45309',
      borderColor: '#e7dfd5',
      inputFocusRing: '#b45309',
      inputBg: '#ffffff',
      tdBg: '#faf7f2',
      tdSurface: '#f4efe6',
      tdTopbarBg: 'rgba(244, 239, 230, 0.92)',
      tdCardBg: '#ffffff',
      tdCardHover: '#fdfbf7',
      tdPrimary: '#b45309',
      tdBorder: '#e7dfd5',
      tdAccentGold: '#d97706',
      fwBg: '#faf7f2',
      fwSurface: '#f4efe6',
      fwPrimary: '#b45309',
      settingsSurface: '#ffffff',
      settingsAccent: '#b45309',
      modalBg: '#ffffff',
    }),
  },

  nord_frost: {
    id: 'nord_frost',
    nameKey: 'settings.palette_nord_frost_name',
    tagKey: 'settings.palette_nord_frost_tag',
    descKey: 'settings.palette_nord_frost_desc',
    isCurated: true,
    previewColors: {
      bg: '#0d131d',
      card: '#182438',
      accent: '#38bdf8',
      secondary: '#2dd4bf',
      border: 'rgba(56, 189, 248, 0.25)',
    },
    previewColorsLight: {
      bg: '#f5f7fb',
      card: '#ffffff',
      accent: '#0284c7',
      secondary: '#0f766e',
      border: '#cbd5e1',
    },
    tokens: buildTokens({
      bgMain: '#0d131d',
      bgCard: '#182438',
      bgDark: '#0d131d',
      bgPanel: 'rgba(24, 36, 56, 0.75)',
      surfaceLight: '#1e2f49',
      surfaceElevated: '#243958',
      colorAccent: '#38bdf8',
      colorSecondary: '#2dd4bf',
      primary: '#38bdf8',
      accent: '#2dd4bf',
      glowPrimary: 'rgba(56, 189, 248, 0.45)',
      colorSecondaryCard: 'rgba(45, 212, 191, 0.15)',
      colorSecondaryBorder: 'rgba(45, 212, 191, 0.35)',
      textPrimary: '#f8fafc',
      textSecondary: '#94a3b8',
      badgeBg: 'rgba(56, 189, 248, 0.18)',
      badgeText: '#38bdf8',
      statusDot: '#38bdf8',
      borderColor: 'rgba(56, 189, 248, 0.2)',
      inputFocusRing: '#38bdf8',
      inputBg: 'rgba(12, 18, 28, 0.85)',
      tdBg: '#0d131d',
      tdSurface: '#111927',
      tdTopbarBg: 'rgba(17, 25, 39, 0.88)',
      tdCardBg: 'rgba(24, 36, 56, 0.7)',
      tdCardHover: 'rgba(33, 50, 78, 0.88)',
      tdPrimary: '#38bdf8',
      tdBorder: 'rgba(56, 189, 248, 0.2)',
      tdAccentGold: '#2dd4bf',
      fwBg: '#0d131d',
      fwSurface: '#111927',
      fwPrimary: '#38bdf8',
      settingsSurface: 'rgba(24, 36, 56, 0.88)',
      settingsAccent: '#38bdf8',
      modalBg: 'rgba(16, 24, 38, 0.96)',
    }),
    tokensLight: buildTokens({
      bgMain: '#f5f7fb',
      bgCard: '#ffffff',
      bgDark: '#f5f7fb',
      bgPanel: '#ffffff',
      surfaceLight: '#eaf0f8',
      surfaceElevated: '#f9fbfe',
      colorAccent: '#0284c7',
      colorSecondary: '#0f766e',
      primary: '#0284c7',
      accent: '#0f766e',
      glowPrimary: 'rgba(2, 132, 199, 0.25)',
      colorSecondaryCard: 'rgba(15, 118, 110, 0.10)',
      colorSecondaryBorder: 'rgba(15, 118, 110, 0.35)',
      textPrimary: '#0f172a',
      textSecondary: '#334155',
      badgeBg: 'rgba(2, 132, 199, 0.12)',
      badgeText: '#0284c7',
      statusDot: '#0284c7',
      borderColor: '#cbd5e1',
      inputFocusRing: '#0284c7',
      inputBg: '#ffffff',
      tdBg: '#f5f7fb',
      tdSurface: '#eaf0f8',
      tdTopbarBg: 'rgba(234, 240, 248, 0.92)',
      tdCardBg: '#ffffff',
      tdCardHover: '#f9fbfe',
      tdPrimary: '#0284c7',
      tdBorder: '#cbd5e1',
      tdAccentGold: '#0f766e',
      fwBg: '#f5f7fb',
      fwSurface: '#eaf0f8',
      fwPrimary: '#0284c7',
      settingsSurface: '#ffffff',
      settingsAccent: '#0284c7',
      modalBg: '#ffffff',
    }),
  },

  cyberpunk_matrix: {
    id: 'cyberpunk_matrix',
    nameKey: 'settings.palette_cyberpunk_matrix_name',
    tagKey: 'settings.palette_cyberpunk_matrix_tag',
    descKey: 'settings.palette_cyberpunk_matrix_desc',
    isCurated: true,
    previewColors: {
      bg: '#050807',
      card: '#0e1812',
      accent: '#10e575',
      secondary: '#00f0ff',
      border: 'rgba(16, 229, 117, 0.25)',
    },
    previewColorsLight: {
      bg: '#f0fdf4',
      card: '#ffffff',
      accent: '#15803d',
      secondary: '#0891b2',
      border: '#bbf7d0',
    },
    tokens: buildTokens({
      bgMain: '#050807',
      bgCard: '#0e1812',
      bgDark: '#050807',
      bgPanel: 'rgba(14, 24, 18, 0.75)',
      surfaceLight: '#14241b',
      surfaceElevated: '#1b3326',
      colorAccent: '#10e575',
      colorSecondary: '#00f0ff',
      primary: '#10e575',
      accent: '#00f0ff',
      glowPrimary: 'rgba(16, 229, 117, 0.45)',
      colorSecondaryCard: 'rgba(0, 240, 255, 0.15)',
      colorSecondaryBorder: 'rgba(0, 240, 255, 0.35)',
      textPrimary: '#f0fdf4',
      textSecondary: '#86efac',
      badgeBg: 'rgba(16, 229, 117, 0.18)',
      badgeText: '#10e575',
      statusDot: '#10e575',
      borderColor: 'rgba(16, 229, 117, 0.22)',
      inputFocusRing: '#10e575',
      inputBg: 'rgba(6, 11, 8, 0.9)',
      tdBg: '#050807',
      tdSurface: '#090e0b',
      tdTopbarBg: 'rgba(9, 14, 11, 0.9)',
      tdCardBg: 'rgba(14, 24, 18, 0.75)',
      tdCardHover: 'rgba(20, 36, 27, 0.9)',
      tdPrimary: '#10e575',
      tdBorder: 'rgba(16, 229, 117, 0.22)',
      tdAccentGold: '#00f0ff',
      fwBg: '#050807',
      fwSurface: '#090e0b',
      fwPrimary: '#10e575',
      settingsSurface: 'rgba(14, 24, 18, 0.88)',
      settingsAccent: '#10e575',
      modalBg: 'rgba(9, 16, 12, 0.97)',
    }),
    tokensLight: buildTokens({
      bgMain: '#f0fdf4',
      bgCard: '#ffffff',
      bgDark: '#f0fdf4',
      bgPanel: '#ffffff',
      surfaceLight: '#dcfce7',
      surfaceElevated: '#f0fdf4',
      colorAccent: '#15803d',
      colorSecondary: '#0891b2',
      primary: '#15803d',
      accent: '#0891b2',
      glowPrimary: 'rgba(21, 128, 61, 0.25)',
      colorSecondaryCard: 'rgba(8, 145, 178, 0.10)',
      colorSecondaryBorder: 'rgba(8, 145, 178, 0.35)',
      textPrimary: '#052e16',
      textSecondary: '#166534',
      badgeBg: 'rgba(21, 128, 61, 0.12)',
      badgeText: '#15803d',
      statusDot: '#15803d',
      borderColor: '#bbf7d0',
      inputFocusRing: '#15803d',
      inputBg: '#ffffff',
      tdBg: '#f0fdf4',
      tdSurface: '#dcfce7',
      tdTopbarBg: 'rgba(220, 252, 231, 0.92)',
      tdCardBg: '#ffffff',
      tdCardHover: '#f0fdf4',
      tdPrimary: '#15803d',
      tdBorder: '#bbf7d0',
      tdAccentGold: '#0891b2',
      fwBg: '#f0fdf4',
      fwSurface: '#dcfce7',
      fwPrimary: '#15803d',
      settingsSurface: '#ffffff',
      settingsAccent: '#15803d',
      modalBg: '#ffffff',
    }),
  },

  // ─── 8 REFINED CLASSIC THEMES ─────────────────────────────────────────────
  default: {
    id: 'default',
    nameKey: 'settings.palette_default_name',
    tagKey: 'settings.palette_default_tag',
    descKey: 'settings.palette_default_desc',
    isCurated: false,
    previewColors: {
      bg: '#060911',
      card: '#141a26',
      accent: '#38bdf8',
      secondary: '#fbbf24',
      border: 'rgba(255, 255, 255, 0.1)',
    },
    tokens: buildTokens({
      bgMain: 'radial-gradient(ellipse at top, #111827 0%, #060911 100%)',
      bgCard: 'linear-gradient(150deg, rgba(20, 26, 38, 0.85) 0%, rgba(11, 16, 26, 0.95) 100%)',
      bgDark: '#0e1621',
      bgPanel: 'rgba(23, 33, 43, 0.65)',
      surfaceLight: '#1c2733',
      surfaceElevated: '#243242',
      colorAccent: '#38bdf8',
      colorSecondary: '#fbbf24',
      primary: '#38bdf8',
      accent: '#fbbf24',
      glowPrimary: 'rgba(56, 189, 248, 0.35)',
      colorSecondaryCard: 'linear-gradient(135deg, rgba(245, 158, 11, 0.14) 0%, rgba(180, 83, 9, 0.22) 100%)',
      colorSecondaryBorder: 'rgba(245, 158, 11, 0.35)',
      textPrimary: '#f8fafc',
      textSecondary: '#94a3b8',
      badgeBg: 'rgba(56, 189, 248, 0.12)',
      badgeText: '#38bdf8',
      statusDot: '#10b981',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      tdBg: '#090d16',
      tdSurface: '#0d1527',
      tdCardBg: 'rgba(22, 32, 54, 0.65)',
      tdCardHover: 'rgba(30, 41, 59, 0.9)',
      tdPrimary: '#38bdf8',
      tdBorder: 'rgba(255, 255, 255, 0.08)',
      tdAccentGold: '#fbbf24',
    }),
  },

  solar_flare: {
    id: 'solar_flare',
    nameKey: 'settings.palette_solar_flare_name',
    tagKey: 'settings.palette_solar_flare_tag',
    descKey: 'settings.palette_solar_flare_desc',
    isCurated: false,
    previewColors: {
      bg: '#0e1117',
      card: '#161b26',
      accent: '#f97316',
      secondary: '#eab308',
      border: '#2a344a',
    },
    tokens: buildTokens({
      bgMain: '#0e1117',
      bgCard: '#161b26',
      bgDark: '#0e1117',
      bgPanel: '#161b26',
      surfaceLight: '#1f2636',
      surfaceElevated: '#283145',
      colorAccent: '#f97316',
      colorSecondary: '#eab308',
      primary: '#f97316',
      accent: '#eab308',
      glowPrimary: 'rgba(249, 115, 22, 0.4)',
      colorSecondaryCard: '#272010',
      colorSecondaryBorder: '#854d0e',
      textPrimary: '#f8fafc',
      textSecondary: '#cbd5e1',
      badgeBg: '#431407',
      badgeText: '#fdba74',
      statusDot: '#f97316',
      borderColor: '#2a344a',
      tdBg: '#0e1117',
      tdSurface: '#141822',
      tdPrimary: '#f97316',
    }),
  },

  warm_clay: {
    id: 'warm_clay',
    nameKey: 'settings.palette_warm_clay_name',
    tagKey: 'settings.palette_warm_clay_tag',
    descKey: 'settings.palette_warm_clay_desc',
    isCurated: false,
    previewColors: {
      bg: '#141210',
      card: '#1d1916',
      accent: '#e7d8c9',
      secondary: '#bfa085',
      border: '#3b342e',
    },
    tokens: buildTokens({
      bgMain: '#141210',
      bgCard: '#1d1916',
      bgDark: '#141210',
      bgPanel: '#1d1916',
      surfaceLight: '#26211d',
      surfaceElevated: '#302a25',
      colorAccent: '#e7d8c9',
      colorSecondary: '#bfa085',
      primary: '#e7d8c9',
      accent: '#bfa085',
      glowPrimary: 'rgba(231, 216, 201, 0.35)',
      colorSecondaryCard: '#241f1b',
      colorSecondaryBorder: '#52453c',
      textPrimary: '#f7f4ef',
      textSecondary: '#c8bfb6',
      badgeBg: '#2c2520',
      badgeText: '#e7d8c9',
      statusDot: '#eab308',
      borderColor: '#3b342e',
      tdBg: '#141210',
      tdSurface: '#1c1815',
      tdPrimary: '#e7d8c9',
    }),
  },

  warm_mocha: {
    id: 'warm_mocha',
    nameKey: 'settings.palette_warm_mocha_name',
    tagKey: 'settings.palette_warm_mocha_tag',
    descKey: 'settings.palette_warm_mocha_desc',
    isCurated: false,
    previewColors: {
      bg: '#171311',
      card: '#231d1a',
      accent: '#d4a373',
      secondary: '#faedcd',
      border: '#433732',
    },
    tokens: buildTokens({
      bgMain: '#171311',
      bgCard: '#231d1a',
      bgDark: '#171311',
      bgPanel: '#231d1a',
      surfaceLight: '#2c2420',
      surfaceElevated: '#362d28',
      colorAccent: '#d4a373',
      colorSecondary: '#faedcd',
      primary: '#d4a373',
      accent: '#faedcd',
      glowPrimary: 'rgba(212, 163, 115, 0.35)',
      colorSecondaryCard: '#2d221c',
      colorSecondaryBorder: '#634839',
      textPrimary: '#fefae0',
      textSecondary: '#d4a373',
      badgeBg: '#382a22',
      badgeText: '#faedcd',
      statusDot: '#d4a373',
      borderColor: '#433732',
      tdBg: '#171311',
      tdSurface: '#201a17',
      tdPrimary: '#d4a373',
    }),
  },

  lavender_dusk: {
    id: 'lavender_dusk',
    nameKey: 'settings.palette_lavender_dusk_name',
    tagKey: 'settings.palette_lavender_dusk_tag',
    descKey: 'settings.palette_lavender_dusk_desc',
    isCurated: false,
    previewColors: {
      bg: '#100e1b',
      card: '#1a172c',
      accent: '#c084fc',
      secondary: '#f472b6',
      border: '#332d56',
    },
    tokens: buildTokens({
      bgMain: '#100e1b',
      bgCard: '#1a172c',
      bgDark: '#100e1b',
      bgPanel: '#1a172c',
      surfaceLight: '#24203d',
      surfaceElevated: '#2e294d',
      colorAccent: '#c084fc',
      colorSecondary: '#f472b6',
      primary: '#c084fc',
      accent: '#f472b6',
      glowPrimary: 'rgba(192, 132, 252, 0.4)',
      colorSecondaryCard: '#2d1830',
      colorSecondaryBorder: '#701a75',
      textPrimary: '#faf5ff',
      textSecondary: '#d8b4fe',
      badgeBg: '#3b0764',
      badgeText: '#e9d5ff',
      statusDot: '#c084fc',
      borderColor: '#332d56',
      tdBg: '#100e1b',
      tdSurface: '#171326',
      tdPrimary: '#c084fc',
    }),
  },

  botanical_sage: {
    id: 'botanical_sage',
    nameKey: 'settings.palette_botanical_sage_name',
    tagKey: 'settings.palette_botanical_sage_tag',
    descKey: 'settings.palette_botanical_sage_desc',
    isCurated: false,
    previewColors: {
      bg: '#0c1512',
      card: '#14221d',
      accent: '#34d399',
      secondary: '#a7f3d0',
      border: '#243e35',
    },
    tokens: buildTokens({
      bgMain: '#0c1512',
      bgCard: '#14221d',
      bgDark: '#0c1512',
      bgPanel: '#14221d',
      surfaceLight: '#1b2f28',
      surfaceElevated: '#223c33',
      colorAccent: '#34d399',
      colorSecondary: '#a7f3d0',
      primary: '#34d399',
      accent: '#a7f3d0',
      glowPrimary: 'rgba(52, 211, 153, 0.4)',
      colorSecondaryCard: '#152b22',
      colorSecondaryBorder: '#2d6a52',
      textPrimary: '#ecfdf5',
      textSecondary: '#a7f3d0',
      badgeBg: '#064e3b',
      badgeText: '#a7f3d0',
      statusDot: '#34d399',
      borderColor: '#243e35',
      tdBg: '#0c1512',
      tdSurface: '#121e19',
      tdPrimary: '#34d399',
    }),
  },

  anarchy_crimson: {
    id: 'anarchy_crimson',
    nameKey: 'settings.palette_anarchy_crimson_name',
    tagKey: 'settings.palette_anarchy_crimson_tag',
    descKey: 'settings.palette_anarchy_crimson_desc',
    isCurated: false,
    previewColors: {
      bg: '#0d0707',
      card: '#1b0f0f',
      accent: '#ef4444',
      secondary: '#ea580c',
      border: '#3d2020',
    },
    previewColorsLight: {
      bg: '#fff5f6',
      card: '#ffffff',
      accent: '#be123c',
      secondary: '#e11d48',
      border: '#f3d5da',
    },
    tokens: buildTokens({
      bgMain: '#0d0707',
      bgCard: '#1b0f0f',
      bgDark: '#0d0707',
      bgPanel: '#1b0f0f',
      surfaceLight: '#271515',
      surfaceElevated: '#341c1c',
      colorAccent: '#ef4444',
      colorSecondary: '#ea580c',
      primary: '#ef4444',
      accent: '#ea580c',
      glowPrimary: 'rgba(239, 68, 68, 0.45)',
      colorSecondaryCard: '#2b1409',
      colorSecondaryBorder: '#7c2d12',
      textPrimary: '#fef2f2',
      textSecondary: '#fca5a5',
      badgeBg: '#450a0a',
      badgeText: '#fca5a5',
      statusDot: '#ef4444',
      borderColor: '#3d2020',
      tdBg: '#0d0707',
      tdSurface: '#160b0b',
      tdPrimary: '#ef4444',
    }),
    tokensLight: buildTokens({
      bgMain: '#fff5f6',
      bgCard: '#ffffff',
      bgDark: '#fff5f6',
      bgPanel: '#ffffff',
      surfaceLight: '#fdeef0',
      surfaceElevated: '#fff8f9',
      colorAccent: '#be123c',
      colorSecondary: '#e11d48',
      primary: '#be123c',
      accent: '#e11d48',
      glowPrimary: 'rgba(190, 18, 60, 0.25)',
      colorSecondaryCard: 'rgba(225, 29, 72, 0.10)',
      colorSecondaryBorder: 'rgba(225, 29, 72, 0.35)',
      textPrimary: '#1f090e',
      textSecondary: '#5c2834',
      badgeBg: 'rgba(190, 18, 60, 0.12)',
      badgeText: '#be123c',
      statusDot: '#be123c',
      borderColor: '#f3d5da',
      inputFocusRing: '#be123c',
      inputBg: '#ffffff',
      tdBg: '#fff5f6',
      tdSurface: '#fdeef0',
      tdTopbarBg: 'rgba(253, 238, 240, 0.92)',
      tdCardBg: '#ffffff',
      tdCardHover: '#fff8f9',
      tdPrimary: '#be123c',
      tdBorder: '#f3d5da',
      tdAccentGold: '#e11d48',
      fwBg: '#fff5f6',
      fwSurface: '#fdeef0',
      fwPrimary: '#be123c',
      settingsSurface: '#ffffff',
      settingsAccent: '#be123c',
      modalBg: '#ffffff',
    }),
  },

  vintage_amber: {
    id: 'vintage_amber',
    nameKey: 'settings.palette_vintage_amber_name',
    tagKey: 'settings.palette_vintage_amber_tag',
    descKey: 'settings.palette_vintage_amber_desc',
    isCurated: false,
    previewColors: {
      bg: '#0f0a04',
      card: '#1d1408',
      accent: '#f59e0b',
      secondary: '#fbbf24',
      border: '#3e2a14',
    },
    tokens: buildTokens({
      bgMain: '#0f0a04',
      bgCard: '#1d1408',
      bgDark: '#0f0a04',
      bgPanel: '#1d1408',
      surfaceLight: '#2a1d0c',
      surfaceElevated: '#362610',
      colorAccent: '#f59e0b',
      colorSecondary: '#fbbf24',
      primary: '#f59e0b',
      accent: '#fbbf24',
      glowPrimary: 'rgba(245, 158, 11, 0.45)',
      colorSecondaryCard: '#2c1e0b',
      colorSecondaryBorder: '#78350f',
      textPrimary: '#fffbeb',
      textSecondary: '#fcd34d',
      badgeBg: '#451a03',
      badgeText: '#fef08a',
      statusDot: '#f59e0b',
      borderColor: '#3e2a14',
      tdBg: '#0f0a04',
      tdSurface: '#191107',
      tdPrimary: '#f59e0b',
    }),
  },
};

// Backward-compatibility and curated aliases mapping (without mutating COLOR_PALETTES keys)
export const THEME_ALIASES: Record<string, ColorPaletteId> = {
  crimson_velvet: 'anarchy_crimson',
  emerald_glow: 'emerald_forest',
  cyberpunk_violet: 'tokyo_midnight',
  obsidian_slate: 'nord_frost',
};

export const PALETTES_LIST: ColorPaletteDef[] = Object.values(COLOR_PALETTES);

const LS_KEY = 'autogram_color_palette';
const EVENT_NAME = 'autogram:color_palette_change';

export function getColorPalette(): ColorPaletteId {
  try {
    const val = localStorage.getItem(LS_KEY);
    if (val && typeof val === 'string') {
      if (Object.prototype.hasOwnProperty.call(THEME_ALIASES, val)) {
        return THEME_ALIASES[val];
      }
      if (Object.prototype.hasOwnProperty.call(COLOR_PALETTES, val)) {
        return val as ColorPaletteId;
      }
    }
  } catch {
    /* ignore */
  }
  return 'default';
}

let currentColorSchemeMode: ColorSchemeMode | null = null;
let mediaQueryList: MediaQueryList | null = null;
let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;

export function getColorSchemeMode(): ColorSchemeMode {
  if (currentColorSchemeMode) return currentColorSchemeMode;
  try {
    const stored = localStorage.getItem(LS_COLOR_SCHEME_KEY) as ColorSchemeMode;
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      currentColorSchemeMode = stored;
      return stored;
    }
  } catch {
    /* ignore */
  }
  currentColorSchemeMode = 'dark';
  return 'dark';
}

export const getColorScheme = getColorSchemeMode;

export function getResolvedColorScheme(): ResolvedColorScheme {
  const mode = getColorSchemeMode();
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        /* ignore */
      }
    }
    return 'dark';
  }
  return mode;
}

function ensureSystemListener(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  if (!mediaQueryList) {
    try {
      mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQueryListener = (e: MediaQueryListEvent) => {
        if (getColorSchemeMode() === 'system') {
          const resolved: ResolvedColorScheme = e.matches ? 'dark' : 'light';
          applyColorPalette(getColorPalette());
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent(COLOR_SCHEME_EVENT, {
                detail: { mode: 'system', resolved },
              })
            );
          }
        }
      };
      if (mediaQueryList.addEventListener) {
        mediaQueryList.addEventListener('change', mediaQueryListener);
      } else if ((mediaQueryList as any).addListener) {
        (mediaQueryList as any).addListener(mediaQueryListener);
      }
    } catch {
      /* ignore */
    }
  }
}

export function setColorSchemeMode(mode: ColorSchemeMode): void {
  try {
    localStorage.setItem(LS_COLOR_SCHEME_KEY, mode);
  } catch {
    /* ignore */
  }
  currentColorSchemeMode = mode;
  ensureSystemListener();
  applyColorPalette(getColorPalette());
  const resolved = getResolvedColorScheme();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(COLOR_SCHEME_EVENT, { detail: { mode, resolved } })
    );
  }
}

export const setColorScheme = setColorSchemeMode;

export function toggleColorSchemeMode(): ColorSchemeMode {
  const current = getColorSchemeMode();
  const next: ColorSchemeMode = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
  setColorSchemeMode(next);
  return next;
}

export function subscribeColorScheme(
  callback: (mode: ColorSchemeMode, resolved: ResolvedColorScheme) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ mode: ColorSchemeMode; resolved: ResolvedColorScheme }>;
    if (custom?.detail) {
      callback(custom.detail.mode, custom.detail.resolved);
    } else {
      callback(getColorSchemeMode(), getResolvedColorScheme());
    }
  };
  window.addEventListener(COLOR_SCHEME_EVENT, handler);
  return () => {
    window.removeEventListener(COLOR_SCHEME_EVENT, handler);
  };
}

export function applyColorPalette(paletteId?: ColorPaletteId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const rawId = paletteId || getColorPalette();
  const currentId = (rawId && Object.prototype.hasOwnProperty.call(THEME_ALIASES, rawId)
    ? THEME_ALIASES[rawId]
    : rawId) as ColorPaletteId;
  const def =
    currentId && Object.prototype.hasOwnProperty.call(COLOR_PALETTES, currentId) && COLOR_PALETTES[currentId]?.tokens
      ? COLOR_PALETTES[currentId]
      : COLOR_PALETTES.default;

  const mode = getColorSchemeMode();
  const resolved = getResolvedColorScheme();

  root.setAttribute('data-palette', def.id);
  root.setAttribute('data-color-scheme', resolved);
  root.setAttribute('data-color-scheme-mode', mode);
  root.style.colorScheme = resolved;

  // Active token set selection
  const activeTokens = resolved === 'light' && def.tokensLight ? def.tokensLight : def.tokens;

  // Set all 44 defined theme tokens on root
  Object.entries(activeTokens).forEach(([token, val]) => {
    root.style.setProperty(token, val);
  });

  // Ensure semantic bridge tokens are explicitly guaranteed on root
  if (!activeTokens['--accent-primary']) {
    root.style.setProperty('--accent-primary', activeTokens['--color-accent'] || activeTokens['--primary']);
  }
  if (!activeTokens['--accent-secondary']) {
    root.style.setProperty('--accent-secondary', activeTokens['--color-secondary'] || activeTokens['--accent']);
  }
  if (!activeTokens['--accent-glow']) {
    root.style.setProperty('--accent-glow', activeTokens['--glow-primary']);
  }
  if (!activeTokens['--border-hover']) {
    root.style.setProperty('--border-hover', activeTokens['--color-secondary-border'] || activeTokens['--border-color']);
  }
  if (!activeTokens['--border-default']) {
    root.style.setProperty('--border-default', activeTokens['--border-color']);
  }
  if (!activeTokens['--bg-sidebar']) {
    root.style.setProperty('--bg-sidebar', activeTokens['--td-surface'] || activeTokens['--bg-panel']);
  }
  if (!activeTokens['--bg-elevated']) {
    root.style.setProperty('--bg-elevated', activeTokens['--surface-elevated']);
  }
  if (!activeTokens['--bg-modal']) {
    root.style.setProperty('--bg-modal', activeTokens['--modal-bg']);
  }
  if (!activeTokens['--text-inverse']) {
    root.style.setProperty('--text-inverse', '#ffffff');
  }
}

export function setColorPalette(paletteId: ColorPaletteId | ThemeAliasId | string): void {
  const canonicalId = (paletteId && Object.prototype.hasOwnProperty.call(THEME_ALIASES, paletteId)
    ? THEME_ALIASES[paletteId as ThemeAliasId]
    : paletteId) as ColorPaletteId;
  try {
    localStorage.setItem(LS_KEY, canonicalId);
    applyColorPalette(canonicalId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: canonicalId }));
    }
  } catch {
    /* ignore */
  }
}

export function subscribeColorPalette(callback: (paletteId: ColorPaletteId) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<ColorPaletteId>;
    if (custom.detail) {
      callback(custom.detail);
    } else {
      callback(getColorPalette());
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
  };
}

// Auto-apply on module import in browser environment
if (typeof window !== 'undefined') {
  try {
    ensureSystemListener();
    applyColorPalette(getColorPalette());
    (window as any).setColorPalette = setColorPalette;
    (window as any).applyColorPalette = applyColorPalette;
    (window as any).setColorSchemeMode = setColorSchemeMode;
    (window as any).getColorSchemeMode = getColorSchemeMode;
    (window as any).getResolvedColorScheme = getResolvedColorScheme;
    window.addEventListener(EVENT_NAME, (e: Event) => {
      const custom = e as CustomEvent<ColorPaletteId>;
      if (custom?.detail) {
        applyColorPalette(custom.detail);
      }
    });
  } catch {
    /* ignore */
  }
}
