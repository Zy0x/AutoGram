import React, { useState, useEffect, useRef } from 'react';
import {
  DrivePreviewModalProps,
  readQualityPref,
  writeQualityPref,
  resolvePreviewKind,
  buildMediaSrc,
} from './previewUtils';
import { MediaHeaderToolbar } from './MediaHeaderToolbar';
import { MediaVideoPlayer } from './MediaVideoPlayer';
import { MediaAudioPlayer } from './MediaAudioPlayer';
import { ImageViewer } from './ImageViewer';
import { DocumentViewer } from './DocumentViewer';
import { openInSystem } from '../../../lib/documentOpen';

export const DrivePreviewModal: React.FC<DrivePreviewModalProps> = (props) => {
  const {
    file,
    folderId,
    creds,
    onClose,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
    onEnqueueDownloadSingle,
  } = props;

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const [selectedQuality, setSelectedQuality] = useState<string>(readQualityPref());
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const qualityBtnRef = useRef<HTMLButtonElement | null>(null);
  const [qualityMenuPosition, setQualityMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const [isDownloading, setIsDownloading] = useState(false);
  const [isOpenSystem, setIsOpenSystem] = useState(false);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [file.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && onPrev && hasPrev) {
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext && hasNext) {
        onNext();
      } else if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(z + 0.25, 6));
      } else if (e.key === '-') {
        setZoom((z) => Math.max(z - 0.25, 0.25));
      } else if (e.key === '0') {
        setZoom(1);
        setRotation(0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  useEffect(() => {
    if (showQualityMenu && qualityBtnRef.current) {
      const r = qualityBtnRef.current.getBoundingClientRect();
      setQualityMenuPosition({
        top: r.bottom + 6,
        left: Math.max(12, r.right - 200),
        width: 200,
      });
    }
  }, [showQualityMenu]);

  const kind = resolvePreviewKind(file, null);
  const mediaSrc = buildMediaSrc(file.name);

  const handleSelectQuality = (q: string) => {
    setSelectedQuality(q);
    writeQualityPref(q);
  };

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      if (onEnqueueDownloadSingle) {
        await onEnqueueDownloadSingle({
          messageId: file.id,
          folderId: folderId,
          savePath: file.name,
          name: file.name,
        });
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenSystem = async () => {
    if (isOpenSystem) return;
    setIsOpenSystem(true);
    try {
      await openInSystem(file.name);
    } finally {
      setIsOpenSystem(false);
    }
  };

  const handlePrintPdf = () => {
    if (kind === 'pdf' && mediaSrc) {
      window.print();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-xl text-slate-100 select-none overflow-hidden animate-fadeIn">
      <MediaHeaderToolbar
        file={file}
        kind={kind}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={onPrev}
        onNext={onNext}
        onClose={onClose}
        qualities={[]}
        selectedQuality={selectedQuality}
        onSelectQuality={handleSelectQuality}
        showQualityMenu={showQualityMenu}
        setShowQualityMenu={setShowQualityMenu}
        qualityBtnRef={qualityBtnRef}
        qualityMenuPosition={qualityMenuPosition}
        qualityMetaNote={null}
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(z + 0.25, 6))}
        onZoomOut={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
        onResetZoom={() => setZoom(1)}
        onRotate={() => setRotation((r) => (r + 90) % 360)}
        onDownload={handleDownload}
        onOpenSystem={handleOpenSystem}
        onPrintPdf={kind === 'pdf' ? handlePrintPdf : undefined}
        isDownloading={isDownloading}
        isOpenSystem={isOpenSystem}
      />

      <main className="flex-1 relative w-full h-full flex items-center justify-center p-2 sm:p-6 overflow-hidden">
        {kind === 'video' && (
          <MediaVideoPlayer
            src={mediaSrc}
            posterSrc={null}
            qualityLabel={selectedQuality.toUpperCase()}
            onQualityMenuToggle={() => setShowQualityMenu(!showQualityMenu)}
          />
        )}

        {kind === 'audio' && (
          <MediaAudioPlayer
            src={mediaSrc}
            title={file.name}
            posterSrc={null}
          />
        )}

        {kind === 'image' && (
          <ImageViewer
            src={mediaSrc}
            alt={file.name}
            zoom={zoom}
            rotation={rotation}
            onZoomChange={setZoom}
            thumbSrc={null}
          />
        )}

        {(kind === 'text' || kind === 'pdf' || kind === 'zip' || kind === 'other') && (
          <DocumentViewer
            file={file}
            kind={kind}
            src={mediaSrc}
            creds={creds}
            folderId={folderId}
            onDownload={handleDownload}
            onOpenSystem={handleOpenSystem}
          />
        )}
      </main>
    </div>
  );
};
