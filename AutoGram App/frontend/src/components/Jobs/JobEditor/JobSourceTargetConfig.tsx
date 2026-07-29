import React from 'react';


export interface JobSourceTargetConfigProps {
  sourceId: string;
  setSourceId: (s: string) => void;
  targetId: string;
  setTargetId: (t: string) => void;
  chats: { id: string; name: string; type?: string }[];
  disabled?: boolean;
}

export const JobSourceTargetConfig: React.FC<JobSourceTargetConfigProps> = ({
  sourceId,
  setSourceId,
  targetId,
  setTargetId,
  chats,
  disabled,
}) => {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-4">
      <h4 className="font-semibold text-xs text-slate-200 uppercase tracking-wider">
        Konfigurasi Sumber &amp; Tujuan Transfer
      </h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        {/* Source Picker */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300">
            Channel / Group Sumber
          </label>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            disabled={disabled}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:ring-1 focus:ring-indigo-500 font-mono"
          >
            <option value="">-- Pilih Sumber Telegram --</option>
            {chats.map((c) => (
              <option key={`src-${c.id}`} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
        </div>

        {/* Destination Picker */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300">
            Tujuan Transfer (Drive / Channel)
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={disabled}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:ring-1 focus:ring-indigo-500 font-mono"
          >
            <option value="">-- Pilih Tujuan Telegram --</option>
            {chats.map((c) => (
              <option key={`target-${c.id}`} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
