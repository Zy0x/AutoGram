import React from 'react';
import { Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface MediaAudioPlayerProps {
  src: string;
  name: string;
  poster?: string | null;
}

export const MediaAudioPlayer: React.FC<MediaAudioPlayerProps> = ({ src, name, poster }) => {
  const { t } = useTranslation();
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full flex flex-col items-center shadow-2xl text-center space-y-6">
        <div className="w-32 h-32 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 overflow-hidden">
          {poster ? (
            <img src={poster} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music size={56} className="text-white" />
          )}
        </div>

        <div>
          <h3 className="font-bold text-base text-slate-100 line-clamp-2">{name}</h3>
          <p className="text-xs text-slate-400 mt-1">{t('ui.generated.audio_telegram_stream_95461e5')}</p>
        </div>

        <audio controls src={src} autoPlay className="w-full rounded-xl" />
      </div>
    </div>
  );
};
