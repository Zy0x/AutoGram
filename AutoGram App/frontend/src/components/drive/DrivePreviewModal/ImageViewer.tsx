import React, { useRef, useState, useCallback, useEffect } from 'react';
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, clamp } from './previewUtils';

type ImageViewerProps = {
  src: string;
  alt: string;
  zoom: number;
  rotation: number;
  onZoomChange: (newZoom: number) => void;
  thumbSrc?: string | null;
};

export const ImageViewer: React.FC<ImageViewerProps> = ({
  src,
  alt,
  zoom,
  rotation,
  onZoomChange,
  thumbSrc,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => {
    if (zoom === 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      const nextZoom = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
      onZoomChange(nextZoom);
    },
    [zoom, onZoomChange]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className={`w-full h-full flex items-center justify-center p-4 overflow-hidden select-none ${
        zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
      }`}
    >
      <div className="relative max-w-full max-h-full flex items-center justify-center m-auto transition-transform duration-75">
        {thumbSrc && (
          <img
            src={thumbSrc}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-contain filter blur-md opacity-40 pointer-events-none"
          />
        )}
        <img
          src={src}
          alt={alt}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0, 0, 1)',
          }}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl pointer-events-auto"
          draggable={false}
        />
      </div>
    </div>
  );
};
