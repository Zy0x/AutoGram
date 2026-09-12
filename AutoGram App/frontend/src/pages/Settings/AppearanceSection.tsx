import { useTranslation } from 'react-i18next';
import React from 'react';
import { Globe, Sliders } from 'lucide-react';

export interface AppearanceSectionProps {
  language: string;
  onChangeLanguage: (lang: string) => void;
  uiDensity: 'compact' | 'comfortable' | 'spacious';
  onChangeUiDensity: (d: 'compact' | 'comfortable' | 'spacious') => void;
}

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  language,
  onChangeLanguage,
  uiDensity,
  onChangeUiDensity,
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-2xl p-5 space-y-4 shadow-xl border"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-default)',
        color: 'var(--text-primary)',
      }}
    >
      <h3
        className="text-sm font-bold flex items-center gap-2 pb-3 border-b"
        style={{
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
        }}
      >
        <Sliders size={18} className="text-indigo-400" />
        {t('ui.generated.tampilan_bahasa_appearance_language_fa07bf0')}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label
            className="block text-xs font-medium flex items-center gap-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Globe size={14} className="text-emerald-400" /> {t('ui.generated.bahasa_aplikasi_6062e37')}
          </label>
          <select
            value={language}
            onChange={(e) => onChangeLanguage(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 border"
            style={{
              background: 'var(--input-bg)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="id">{t('ui.generated.bahasa_indonesia_default_f99968f')}</option>
            <option value="en">{t('settings.language_english')}</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.density_label')}
          </label>
          <div
            className="grid grid-cols-3 gap-2 p-1 rounded-xl border"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-default)',
            }}
          >
            <button
              type="button"
              onClick={() => onChangeUiDensity('compact')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'compact'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'hover:bg-slate-200/50 dark:hover:bg-slate-800'
              }`}
              style={{
                color: uiDensity === 'compact' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              {t('settings.density_compact')}
            </button>
            <button
              type="button"
              onClick={() => onChangeUiDensity('comfortable')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'comfortable'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'hover:bg-slate-200/50 dark:hover:bg-slate-800'
              }`}
              style={{
                color: uiDensity === 'comfortable' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              {t('settings.density_comfortable')}
            </button>
            <button
              type="button"
              onClick={() => onChangeUiDensity('spacious')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'spacious'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'hover:bg-slate-200/50 dark:hover:bg-slate-800'
              }`}
              style={{
                color: uiDensity === 'spacious' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              {t('settings.density_spacious')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
