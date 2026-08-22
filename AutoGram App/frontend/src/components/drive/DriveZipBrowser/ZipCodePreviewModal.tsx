import React from 'react';
import { DrivePreviewModal } from '../DrivePreviewModal';
import type { ZipEntry, ZipPreviewResult } from './zipUtils';
import type { DriveFolder, DriveChat, DriveFile } from '../../../lib/telegram/driveTypes';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';

export type ZipCodePreviewModalProps = {
  entry: ZipEntry | null;
  entries?: ZipEntry[];
  preview: ZipPreviewResult | null;
  localUrl?: string | null;
  isLoading: boolean;
  error: string | null;
  onNavigate?: (entry: ZipEntry) => void;
  onExtract?: () => void;
  onClose: () => void;
  folders?: DriveFolder[];
  chats?: DriveChat[];
  creds?: DriveCredentials;
  folderId?: number | null;
};

export const ZipCodePreviewModal: React.FC<ZipCodePreviewModalProps> = ({
  entry,
  entries = [],
  preview,
  localUrl,
  isLoading,
  error,
  onNavigate,
  onExtract,
  onClose,
  folders,
  chats,
  creds,
  folderId = null,
}) => {
  if (!entry) return null;

  const currentIndex = entries.findIndex((e) => e.name === entry.name);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < entries.length - 1;

  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  const kind = preview?.kind || (
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)
      ? 'image'
      : ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)
      ? 'video'
      : ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)
      ? 'audio'
      : ['txt', 'json', 'js', 'ts', 'jsx', 'tsx', 'rs', 'py', 'html', 'css', 'md', 'xml', 'yaml', 'yml', 'toml'].includes(ext)
      ? 'text'
      : ext === 'pdf'
      ? 'pdf'
      : 'other'
  );

  const virtualFile: DriveFile = {
    id: 999000000 + Math.abs(entry.name.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0) % 1000000),
    folder_id: folderId,
    name: entry.name.split('/').pop() || entry.name,
    size: entry.size,
    mime_type: preview?.mime || null,
    file_ext: ext,
    icon_type: kind,
    original_name: entry.name,
  };

  return (
    <DrivePreviewModal
      file={virtualFile}
      folderId={folderId}
      creds={creds || { session: '', apiId: '0', apiHash: '' }}
      folders={folders}
      chats={chats}
      onClose={onClose}
      hasPrev={hasPrev}
      hasNext={hasNext}
      onPrev={hasPrev && onNavigate ? () => onNavigate(entries[currentIndex - 1]) : undefined}
      onNext={hasNext && onNavigate ? () => onNavigate(entries[currentIndex + 1]) : undefined}
      customSource={{
        src: preview?.data_url || localUrl || null,
        text: preview?.text || null,
        kind: kind === 'binary' ? 'other' : (kind as any),
        loading: isLoading,
        error: error,
        encrypted: entry.encrypted,
        compressedSize: entry.compressed_size,
        indexCounter:
          entries.length > 1 && currentIndex >= 0
            ? { current: currentIndex + 1, total: entries.length }
            : undefined,
        onExtract: onExtract,
        onReload: onNavigate ? () => onNavigate(entry) : undefined,
      }}
    />
  );
};
