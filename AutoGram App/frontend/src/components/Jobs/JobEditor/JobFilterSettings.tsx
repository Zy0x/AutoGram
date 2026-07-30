import { useTranslation } from 'react-i18next';
import React from 'react';
import { Filter } from 'lucide-react';

export interface JobFilterSettingsProps {
  includeVideos: boolean;
  setIncludeVideos: (v: boolean) => void;
  includeImages: boolean;
  setIncludeImages: (i: boolean) => void;
  includeDocuments: boolean;
  setIncludeDocuments: (d: boolean) => void;
  includeArchives: boolean;
  setIncludeArchives: (a: boolean) => void;
  keywordFilter: string;
  setKeywordFilter: (k: string) => void;
  minSizeMb: number;
  setMinSizeMb: (m: number) => void;
  maxSizeMb: number;
  setMaxSizeMb: (m: number) => void;
  disabled?: boolean;
}

export const JobFilterSettings: React.FC<JobFilterSettingsProps> = ({
  includeVideos,
  setIncludeVideos,
  includeImages,
  setIncludeImages,
  includeDocuments,
  setIncludeDocuments,
  includeArchives,
  setIncludeArchives,
  keywordFilter,
  setKeywordFilter,
  minSizeMb,
  setMinSizeMb,
  maxSizeMb,
  setMaxSizeMb,
  disabled,
}) => {
  const { t } = useTranslation();
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-4">
      <h4 className="font-semibold text-xs text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
        <Filter size={14} className="text-indigo-400" /> Filter &amp; Jenis Media
      </h4>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="flex items-center gap-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800/80 cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={includeVideos}
            onChange={(e) => setIncludeVideos(e.target.checked)}
            disabled={disabled}
            className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-slate-200">Video</span>
        </label>
        <label className="flex items-center gap-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800/80 cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
            disabled={disabled}
            className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-slate-200">Gambar</span>
        </label>
        <label className="flex items-center gap-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800/80 cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={includeDocuments}
            onChange={(e) => setIncludeDocuments(e.target.checked)}
            disabled={disabled}
            className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-slate-200">Dokumen</span>
        </label>
        <label className="flex items-center gap-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800/80 cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={includeArchives}
            onChange={(e) => setIncludeArchives(e.target.checked)}
            disabled={disabled}
            className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-slate-200">Arsip (ZIP)</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        <div className="space-y-1">
          <label className="block text-[11px] text-slate-400">Kata Kunci (Opsional)</label>
          <input
            type="text"
            value={keywordFilter}
            onChange={(e) => setKeywordFilter(e.target.value)}
            placeholder={t("jobs.ph_filter_example")}
            disabled={disabled}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] text-slate-400">Ukuran Min (MB)</label>
          <input
            type="number"
            value={minSizeMb || ''}
            onChange={(e) => setMinSizeMb(Number(e.target.value) || 0)}
            placeholder="0"
            disabled={disabled}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:ring-1 focus:ring-indigo-500 font-mono"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] text-slate-400">Ukuran Maks (MB)</label>
          <input
            type="number"
            value={maxSizeMb || ''}
            onChange={(e) => setMaxSizeMb(Number(e.target.value) || 0)}
            placeholder={t('jobs.no_limit')}
            disabled={disabled}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:ring-1 focus:ring-indigo-500 font-mono"
          />
        </div>
      </div>
    </div>
  );
};
