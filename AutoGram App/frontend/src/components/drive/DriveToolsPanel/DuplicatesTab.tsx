import { useTranslation } from 'react-i18next';
import React from 'react';
import { Trash2, Copy, AlertTriangle } from 'lucide-react';

import type { DupGroup } from '../../../lib/telegram';
import { formatDriveBytes, driveFileDisplayName } from '../../../lib/telegram/driveTypes';

export interface DuplicatesTabProps {
  groups: DupGroup[];
  dupMode: 'hash' | 'name_size';
  setDupMode: (mode: 'hash' | 'name_size') => void;
  selectedDupIds: Set<number>;
  onToggleDupId: (id: number) => void;
  onAutoSelectKeepNewest: () => void;
  onAutoSelectKeepOldest: () => void;
  onDeleteSelectedDups: () => void;
  busy?: boolean;
}

export const DuplicatesTab: React.FC<DuplicatesTabProps> = ({
  groups,
  dupMode,
  setDupMode,
  selectedDupIds,
  onToggleDupId,
    onAutoSelectKeepNewest,
  onAutoSelectKeepOldest,
  onDeleteSelectedDups,
  busy,
}) => {
  const { t } = useTranslation();
  const totalDupFiles = groups.reduce((acc, g) => acc + g.files.length, 0);
  const wastedBytes = groups.reduce((acc, g) => { const total = g.files.reduce((sum, f) => sum + f.size, 0); return acc + total - (g.files[0]?.size || 0); }, 0);

  return (
    <div className="space-y-4 text-slate-100">
      <div className="flex items-center justify-between bg-slate-900/80 p-3 rounded-xl border border-slate-800">
        <div>
          <h4 className="font-semibold text-xs text-slate-200">{t('speedtest.dup_mode_title')}</h4>
          <p className="text-[11px] text-slate-400">{t('speedtest.dup_mode_sub')}</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setDupMode('hash')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              dupMode === 'hash' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('ui.generated.sha256_hash_310d0e3')}
          </button>
          <button
            type="button"
            onClick={() => setDupMode('name_size')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              dupMode === 'name_size' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('speedtest.dup_name_size')}
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800/60">
          <Copy className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-xs font-medium">{t('speedtest.dup_none')}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-slate-400">
              {t('speedtest.dup_found_summary')} <strong className="text-indigo-400">{groups.length}</strong> {t('speedtest.dup_groups')} ({totalDupFiles} {t('speedtest.dup_files')}), {t('speedtest.dup_est_save')} <strong className="text-emerald-400">{formatDriveBytes(wastedBytes)}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onAutoSelectKeepNewest} className="text-indigo-400 hover:underline text-[11px]">
                {t('speedtest.dup_keep_newest')}
              </button>
              <button type="button" onClick={onAutoSelectKeepOldest} className="text-indigo-400 hover:underline text-[11px]">
                {t('speedtest.dup_keep_oldest')}
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
            {groups.map((group, gIdx) => (
              <div key={`group-${gIdx}`} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2 text-xs font-mono text-slate-400 border-b border-slate-800/80 pb-1.5">
                  <span>{t('speedtest.dup_group_hdr')} #{gIdx + 1} ({group.files.length} {t('speedtest.dup_files')})</span>
                  <span>{formatDriveBytes(group.files[0]?.size || 0)}</span>
                </div>
                <div className="space-y-1">
                  {group.files.map((file) => (
                    <label
                      key={file.id}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-800/60 cursor-pointer text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedDupIds.has(file.id)}
                          onChange={() => onToggleDupId(file.id)}
                          className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="truncate text-slate-200" title={driveFileDisplayName(file)}>
                          {driveFileDisplayName(file)}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 ml-2">{t('ui.generated.id_8cbdfad')}{file.id}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {selectedDupIds.size > 0 && (
            <div className="flex items-center justify-between bg-red-950/40 border border-red-900/60 p-3 rounded-xl">
              <span className="text-xs text-red-300 flex items-center gap-1.5">
                <AlertTriangle size={14} /> {t('speedtest.dup_selected_count')} {selectedDupIds.size} {t('speedtest.dup_for_deletion')}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={onDeleteSelectedDups}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white shadow-lg shadow-red-600/30 transition-all flex items-center gap-1.5"
              >
                <Trash2 size={13} /> {t('speedtest.dup_delete_btn')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
