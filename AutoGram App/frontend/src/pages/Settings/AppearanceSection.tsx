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
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
        <Sliders size={18} className="text-indigo-400" />
        Tampilan &amp; Bahasa (Appearance &amp; Language)
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Globe size={14} className="text-emerald-400" /> Bahasa Aplikasi
          </label>
          <select
            value={language}
            onChange={(e) => onChangeLanguage(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="id">Bahasa Indonesia (Default)</option>
            <option value="en">English (US)</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300">Densitas Layout (Grid Spacing)</label>
          <div className="grid grid-cols-3 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => onChangeUiDensity('compact')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'compact' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Rapat
            </button>
            <button
              type="button"
              onClick={() => onChangeUiDensity('comfortable')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'comfortable' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sedang
            </button>
            <button
              type="button"
              onClick={() => onChangeUiDensity('spacious')}
              className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                uiDensity === 'spacious' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Longgar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
