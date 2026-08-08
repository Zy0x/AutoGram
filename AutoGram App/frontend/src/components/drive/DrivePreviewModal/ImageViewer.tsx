import { useTranslation } from 'react-i18next';
import React from 'react';
import { ZoomIn, ZoomOut, RotateCw, RotateCcw, FlipHorizontal, FlipVertical } from 'lucide-react';

export interface ImageViewerProps {
  src: string;
  zoom: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  pan: { x: number; y: number };
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onReset: () => void;
  onLoadImage?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  src,
  zoom,
  rotation,
  flipH,
  flipV,
  pan,
  onZoomIn,
  onZoomOut,
  onRotateCw,
  onRotateCcw,
  onFlipH,
  onFlipV,
  onReset,
  onLoadImage,
}) => {
  const { t } = useTranslation();
  const transformStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    transition: 'transform 0.15s ease-out',
    maxHeight: '100%',
    maxWidth: '100%',
    objectFit: 'contain' as const,
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden select-none bg-black/60">
      <div className="flex-1 w-full h-full flex items-center justify-center p-4">
        <img
          src={src}
          alt=""
          onLoad={onLoadImage}
          style={transformStyle}
          className="cursor-grab active:cursor-grabbing max-w-full max-h-full rounded-md shadow-2xl"
        />
      </div>

      {/* Image Floating Toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl px-3 py-1.5 flex items-center gap-2 shadow-2xl z-20">
        <button
          type="button"
          onClick={onZoomOut}
          className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
          title={t("speedtest.zoom_out_tooltip")}
        >
          <ZoomOut size={16} />
        </button>
        <span className="text-xs font-mono text-slate-200 min-w-[40px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
          title={t("speedtest.zoom_in_tooltip")}
        >
          <ZoomIn size={16} />
        </button>

        <div className="w-px h-4 bg-slate-800 mx-1" />

        <button
          type="button"
          onClick={onRotateCcw}
          className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
          title={t("speedtest.rotate_left_tooltip")}
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          onClick={onRotateCw}
          className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
          title={t("speedtest.rotate_right_tooltip")}
        >
          <RotateCw size={16} />
        </button>

        <div className="w-px h-4 bg-slate-800 mx-1" />

        <button
          type="button"
          onClick={onFlipH}
          className={`p-1.5 rounded-lg ${flipH ? 'text-indigo-400 bg-indigo-950/60' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
          title={t("speedtest.flip_h_tooltip")}
        >
          <FlipHorizontal size={16} />
        </button>
        <button
          type="button"
          onClick={onFlipV}
          className={`p-1.5 rounded-lg ${flipV ? 'text-indigo-400 bg-indigo-950/60' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
          title={t("speedtest.flip_v_tooltip")}
        >
          <FlipVertical size={16} />
        </button>

        <button
          type="button"
          onClick={onReset}
          className="text-[11px] font-semibold text-slate-400 hover:text-slate-100 ml-1 px-2 py-1 hover:bg-slate-800 rounded-md"
        >
          {t('speedtest.label_rotate_reset')}
        </button>
      </div>
    </div>
  );
};
