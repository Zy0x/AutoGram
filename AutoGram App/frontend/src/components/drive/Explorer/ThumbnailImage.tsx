import React, { useState, useEffect } from 'react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { FileTypeIcon } from './FileTypeIcon';

export interface ThumbnailImageProps {
  file: DriveFile;
  thumbUrl?: string | null;
  strippedThumbUrl?: string | null;
  className?: string;
}

export const ThumbnailImage: React.FC<ThumbnailImageProps> = ({
  file,
  thumbUrl,
  strippedThumbUrl,
  className = '',
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const displaySrc = thumbUrl || strippedThumbUrl;

  useEffect(() => {
    return () => {
      // Release image references on unmount to allow Blink to collect bitmap
      setLoaded(false);
    };
  }, []);

  if (!displaySrc || error) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-slate-900/60 ${className}`}>
        <FileTypeIcon file={file} size="lg" />
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-slate-950 flex items-center justify-center ${className}`}>
      {/* Stripped Blur-hash placeholder background */}
      {strippedThumbUrl && !loaded && (
        <img
          src={strippedThumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover filter blur-md scale-110 opacity-70"
        />
      )}

      {/* High-res / loaded thumbnail */}
      <img
        src={displaySrc}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
};
