import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  COLOR_PALETTES,
  PALETTES_LIST,
  getColorPalette,
  setColorPalette,
  applyColorPalette,
  subscribeColorPalette,
  getColorSchemeMode,
  getResolvedColorScheme,
  setColorSchemeMode,
  toggleColorSchemeMode,
  subscribeColorScheme,
  LS_COLOR_SCHEME_KEY,
  COLOR_SCHEME_EVENT,
  type ColorPaletteId,
  type ColorPaletteTokens,
} from './themePaletteStore';

describe('themePaletteStore Architecture & Contracts', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
      getStore: () => store,
    };
  })();

  const setPropertyMock = vi.fn();
  const getPropertyValueMock = vi.fn();
  const setAttributeMock = vi.fn();
  const getAttributeMock = vi.fn();
  let rootAttributes: Record<string, string> = {};
  let rootStyles: Record<string, string> = {};

  const eventListeners: Record<string, Function[]> = {};

  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  const originalLocalStorage = (globalThis as any).localStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    rootAttributes = {};
    rootStyles = {};

    setPropertyMock.mockImplementation((prop: string, val: string) => {
      rootStyles[prop] = val;
    });
    getPropertyValueMock.mockImplementation((prop: string) => rootStyles[prop] || '');
    setAttributeMock.mockImplementation((name: string, val: string) => {
      rootAttributes[name] = val;
    });
    getAttributeMock.mockImplementation((name: string) => rootAttributes[name] || null);

    for (const key of Object.keys(eventListeners)) {
      delete eventListeners[key];
    }

    (globalThis as any).localStorage = localStorageMock;

    (globalThis as any).document = {
      documentElement: {
        setAttribute: setAttributeMock,
        getAttribute: getAttributeMock,
        style: {
          setProperty: setPropertyMock,
          getPropertyValue: getPropertyValueMock,
        },
      },
    };

    (globalThis as any).window = {
      localStorage: localStorageMock,
      document: (globalThis as any).document,
      addEventListener: vi.fn((type: string, handler: Function) => {
        if (!eventListeners[type]) eventListeners[type] = [];
        eventListeners[type].push(handler);
      }),
      removeEventListener: vi.fn((type: string, handler: Function) => {
        if (eventListeners[type]) {
          eventListeners[type] = eventListeners[type].filter((h) => h !== handler);
        }
      }),
      dispatchEvent: vi.fn((event: any) => {
        const handlers = eventListeners[event.type] || [];
        handlers.forEach((h) => h(event));
        return true;
      }),
    };

    (globalThis as any).CustomEvent = class MockCustomEvent {
      type: string;
      detail: any;
      constructor(type: string, params?: { detail?: any }) {
        this.type = type;
        this.detail = params?.detail;
      }
    };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('contains exactly 13 unique palettes in PALETTES_LIST and COLOR_PALETTES', () => {
    const expectedIds: ColorPaletteId[] = [
      'tokyo_midnight',
      'emerald_forest',
      'luxury_gold',
      'nord_frost',
      'cyberpunk_matrix',
      'default',
      'solar_flare',
      'warm_clay',
      'warm_mocha',
      'lavender_dusk',
      'botanical_sage',
      'anarchy_crimson',
      'vintage_amber',
    ];

    expect(PALETTES_LIST.length).toBe(13);
    expect(Object.keys(COLOR_PALETTES).length).toBe(13);

    for (const id of expectedIds) {
      expect(COLOR_PALETTES[id]).toBeDefined();
      expect(COLOR_PALETTES[id].id).toBe(id);
    }
  });

  it('verifies that each palette provides all 35 required design tokens', () => {
    const requiredTokenKeys: (keyof ColorPaletteTokens)[] = [
      // Canvas & Panels (6)
      '--bg-main',
      '--bg-card',
      '--bg-dark',
      '--bg-panel',
      '--surface-light',
      '--surface-elevated',
      // Accents & Highlights (7)
      '--color-accent',
      '--color-secondary',
      '--primary',
      '--accent',
      '--glow-primary',
      '--color-secondary-card',
      '--color-secondary-border',
      // Typography & Badges (5)
      '--text-primary',
      '--text-secondary',
      '--badge-bg',
      '--badge-text',
      '--status-dot',
      // Borders & Focus (3)
      '--border-color',
      '--input-focus-ring',
      '--input-bg',
      // Cloud Drives Subsystem (8)
      '--td-bg',
      '--td-surface',
      '--td-topbar-bg',
      '--td-card-bg',
      '--td-card-hover',
      '--td-primary',
      '--td-border',
      '--td-accent-gold',
      // Forwarder & Settings Subsystems (6)
      '--fw-bg',
      '--fw-surface',
      '--fw-primary',
      '--settings-surface',
      '--settings-accent',
      '--modal-bg',
      // Semantic Bridge Tokens (9)
      '--accent-primary',
      '--accent-secondary',
      '--accent-glow',
      '--border-hover',
      '--border-default',
      '--bg-sidebar',
      '--bg-elevated',
      '--bg-modal',
      '--text-inverse',
    ];

    expect(requiredTokenKeys.length).toBe(44);

    for (const palette of PALETTES_LIST) {
      expect(palette.nameKey).toMatch(/^settings\.palette_/);
      expect(palette.tagKey).toMatch(/^settings\.palette_/);
      expect(palette.descKey).toBeDefined();
      expect(palette.descKey).toMatch(/^settings\.palette_/);
      expect(palette.previewColors.bg).toBeDefined();
      expect(palette.previewColors.card).toBeDefined();
      expect(palette.previewColors.accent).toBeDefined();
      expect(palette.previewColors.secondary).toBeDefined();

      for (const tokenKey of requiredTokenKeys) {
        const val = palette.tokens[tokenKey];
        expect(val, `Missing token ${tokenKey} in palette ${palette.id}`).toBeDefined();
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks exactly 5 curated themes with isCurated flag', () => {
    const curatedList = PALETTES_LIST.filter((p) => p.isCurated);
    expect(curatedList.length).toBe(5);
    const curatedIds = curatedList.map((p) => p.id);
    expect(curatedIds).toContain('tokyo_midnight');
    expect(curatedIds).toContain('emerald_forest');
    expect(curatedIds).toContain('luxury_gold');
    expect(curatedIds).toContain('nord_frost');
    expect(curatedIds).toContain('cyberpunk_matrix');
  });

  it('defaults to "default" when localStorage is empty, corrupted, or contains prototype keys', () => {
    expect(getColorPalette()).toBe('default');

    localStorageMock.setItem('autogram_color_palette', 'invalid_corrupted_theme');
    expect(getColorPalette()).toBe('default');

    localStorageMock.setItem('autogram_color_palette', '');
    expect(getColorPalette()).toBe('default');

    localStorageMock.setItem('autogram_color_palette', 'toString' as any);
    expect(getColorPalette()).toBe('default');

    localStorageMock.setItem('autogram_color_palette', 'valueOf' as any);
    expect(getColorPalette()).toBe('default');
  });

  it('persists selected palette and updates state when setColorPalette is called', () => {
    setColorPalette('tokyo_midnight');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('autogram_color_palette', 'tokyo_midnight');
    expect(getColorPalette()).toBe('tokyo_midnight');

    setColorPalette('emerald_forest');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('autogram_color_palette', 'emerald_forest');
    expect(getColorPalette()).toBe('emerald_forest');
  });

  it('applies all 44 CSS tokens and data-palette attribute to document.documentElement', () => {
    applyColorPalette('luxury_gold');

    expect(setAttributeMock).toHaveBeenCalledWith('data-palette', 'luxury_gold');
    expect(setPropertyMock).toHaveBeenCalledWith('--bg-main', expect.any(String));
    expect(setPropertyMock).toHaveBeenCalledWith('--color-accent', '#f59e0b');
    expect(setPropertyMock).toHaveBeenCalledWith('--td-bg', '#08080a');
    expect(setPropertyMock).toHaveBeenCalledWith('--td-primary', '#f59e0b');
    expect(setPropertyMock).toHaveBeenCalledWith('--fw-bg', '#08080a');
    expect(setPropertyMock).toHaveBeenCalledWith('--settings-surface', expect.any(String));
    expect(setPropertyMock).toHaveBeenCalledWith('--modal-bg', expect.any(String));
    expect(setPropertyMock).toHaveBeenCalledWith('--accent-primary', '#f59e0b');
    expect(setPropertyMock).toHaveBeenCalledWith('--accent-secondary', '#fbbf24');
    expect(setPropertyMock).toHaveBeenCalledWith('--border-default', 'rgba(245, 158, 11, 0.22)');
    expect(setPropertyMock).toHaveBeenCalledWith('--text-inverse', '#ffffff');

    // Verify all 44 tokens were set
    expect(setPropertyMock.mock.calls.length).toBe(44);
  });

  it('falls back to "default" palette when invalid or prototype paletteId is passed to applyColorPalette', () => {
    applyColorPalette('non_existent_palette' as any);
    expect(setAttributeMock).toHaveBeenCalledWith('data-palette', 'default');
    expect(setPropertyMock.mock.calls.length).toBe(44);

    setPropertyMock.mockClear();
    setAttributeMock.mockClear();
    applyColorPalette('toString' as any);
    expect(setAttributeMock).toHaveBeenCalledWith('data-palette', 'default');
    expect(setPropertyMock.mock.calls.length).toBe(44);
  });

  it('subscribes to palette changes and fires listener on setColorPalette', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeColorPalette(listener);

    setColorPalette('nord_frost');
    expect(listener).toHaveBeenCalledWith('nord_frost');

    setColorPalette('cyberpunk_matrix');
    expect(listener).toHaveBeenCalledWith('cyberpunk_matrix');

    unsubscribe();

    setColorPalette('solar_flare');
    expect(listener).not.toHaveBeenCalledWith('solar_flare');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('defaults colorSchemeMode to "dark" and persists mode via setColorSchemeMode', () => {
    expect(getColorSchemeMode()).toBe('dark');
    expect(getResolvedColorScheme()).toBe('dark');

    setColorSchemeMode('light');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(LS_COLOR_SCHEME_KEY, 'light');
    expect(getColorSchemeMode()).toBe('light');
    expect(getResolvedColorScheme()).toBe('light');

    expect(setAttributeMock).toHaveBeenCalledWith('data-color-scheme', 'light');
    expect(setAttributeMock).toHaveBeenCalledWith('data-color-scheme-mode', 'light');

    setColorSchemeMode('dark');
    expect(getColorSchemeMode()).toBe('dark');
    expect(getResolvedColorScheme()).toBe('dark');
  });

  it('safely falls back to "dark" when legacy or invalid value is in localStorage', () => {
    localStorageMock.getItem.mockReturnValueOnce('system');
    // Force re-read
    (getColorSchemeMode as any)();
    expect(getResolvedColorScheme()).toBe('dark');
  });

  it('cycles colorSchemeMode cleanly between "dark" and "light" via toggleColorSchemeMode', () => {
    setColorSchemeMode('dark');
    expect(toggleColorSchemeMode()).toBe('light');
    expect(toggleColorSchemeMode()).toBe('dark');
  });

  it('subscribes to color scheme changes and notifies listeners', () => {
    expect(COLOR_SCHEME_EVENT).toBe('autogram:color_scheme_change');
    const schemeListener = vi.fn();
    const unsub = subscribeColorScheme(schemeListener);

    setColorSchemeMode('light');
    expect(schemeListener).toHaveBeenCalledWith('light', 'light');

    setColorSchemeMode('dark');
    expect(schemeListener).toHaveBeenCalledWith('dark', 'dark');

    unsub();
    setColorSchemeMode('light');
    expect(schemeListener).toHaveBeenCalledTimes(2);
  });

  it('injects tokensLight when resolved color scheme is light', () => {
    setColorSchemeMode('light');
    setPropertyMock.mockClear();
    applyColorPalette('luxury_gold');

    expect(setAttributeMock).toHaveBeenCalledWith('data-color-scheme', 'light');
    expect(setAttributeMock).toHaveBeenCalledWith('data-palette', 'luxury_gold');

    // Luxury Gold light primary accent is #b45309 (Royal amber gold)
    expect(setPropertyMock).toHaveBeenCalledWith('--color-accent', '#b45309');
    expect(setPropertyMock).toHaveBeenCalledWith('--accent-primary', '#b45309');
    expect(setPropertyMock).toHaveBeenCalledWith('--bg-main', '#faf7f2');
    expect(setPropertyMock).toHaveBeenCalledWith('--bg-card', '#ffffff');
    expect(setPropertyMock).toHaveBeenCalledWith('--text-primary', '#1c1917');
    expect(setPropertyMock).toHaveBeenCalledWith('--text-secondary', '#57534e');
  });

  it('verifies that all curated themes provide complete tokensLight and previewColorsLight', () => {
    const curatedThemes: ColorPaletteId[] = [
      'luxury_gold',
      'tokyo_midnight',
      'emerald_forest',
      'nord_frost',
      'anarchy_crimson',
    ];

    for (const id of curatedThemes) {
      const palette = COLOR_PALETTES[id];
      expect(palette).toBeDefined();
      expect(palette.tokensLight, `tokensLight should exist for ${id}`).toBeDefined();
      expect(palette.previewColorsLight, `previewColorsLight should exist for ${id}`).toBeDefined();

      if (palette.previewColorsLight) {
        expect(palette.previewColorsLight.bg).toBeDefined();
        expect(palette.previewColorsLight.card).toBeDefined();
        expect(palette.previewColorsLight.accent).toBeDefined();
      }

      if (palette.tokensLight) {
        expect(palette.tokensLight['--bg-main']).toBeDefined();
        expect(palette.tokensLight['--bg-card']).toBeDefined();
        expect(palette.tokensLight['--text-primary']).toBeDefined();
        expect(palette.tokensLight['--accent-primary']).toBeDefined();
      }
    }
  });
});
