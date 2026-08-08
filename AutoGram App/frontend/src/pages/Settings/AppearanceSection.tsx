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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
        <Sliders size={18} className="text-indigo-400" />
        {t('ui.generated.tampilan_bahasa_appearance_language_fa07bf0')}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Globe size={14} className="text-emerald-400" /> {t('ui.generated.bahasa_aplikasi_6062e37')}
          </label>
          <select
            value={language}
            onChange={(e) => onChangeLanguage(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="id">{t('ui.generated.bahasa_indonesia_default_f99968f')}</option>
            <option value="en">{t('settings.language_english')}</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300">{t('settings.density_label')}</label>
          <div className="grid grid-cols-3 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => onChangeUiDensity('compact')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'compact' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('settings.density_compact')}
            </button>
            <button
              type="button"
              onClick={() => onChangeUiDensity('comfortable')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'comfortable' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('settings.density_comfortable')}
            </button>
            <button
              type="button"
              onClick={() => onChangeUiDensity('spacious')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'spacious' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('settings.density_spacious')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
