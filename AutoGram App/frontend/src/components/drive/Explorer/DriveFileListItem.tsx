import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Copy } from 'lucide-react';
import { driveFileDisplayName, formatDriveBytes, type DriveFile } from '../../../lib/telegram/driveTypes';
import { usePointerDragPrime, useDriveClipboard } from '../../../lib/telegram';
import { FileTypeIcon } from './FileTypeIcon';

type Props = {
  file: DriveFile;
  selected: boolean;
  isDragSource?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStartFile?: (e: React.DragEvent, file: DriveFile) => void;
  onDragEndFile?: (e: React.DragEvent) => void;
  /** Pointer-drag prime (WebView-safe path) — called once past move threshold */
  onMediaDragPrime?: (file: DriveFile, e: React.PointerEvent) => void;
  /** Prefetch first ~MB so open after scroll/hover is faster */
  onWarmPreview?: () => void;
};

function DriveFileListItemInner({
  file,
  selected,
  isDragSource,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStartFile,
  onDragEndFile,
  onMediaDragPrime,
  onWarmPreview,
}: Props) {
  const { t } = useTranslation();
  const clipboard = useDriveClipboard();
  const isCut = clipboard?.mode === 'cut' && clipboard.messageIds.includes(file.id);
  const isCopy = clipboard?.mode === 'copy' && clipboard.messageIds.includes(file.id);
  const date = file.created_at ? new Date(file.created_at).toLocaleString() : '—';
  const displayName = driveFileDisplayName(file);
  const {
    suppressClick,
    movedPastThreshold,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    resetAfterDrag,
  } = usePointerDragPrime(file, onMediaDragPrime);

  useEffect(() => {
    if (!isDragSource) resetAfterDrag();
  }, [isDragSource, resetAfterDrag]);

  return (
    <div
      data-msg-id={file.id}
      data-drive-file="1"
      className={`td-list-row ${selected ? 'selected' : ''}${isDragSource ? ' is-dragging' : ''}${
        isCut ? ' is-clipboard-cut' : ''
      }${isCopy ? ' is-clipboard-copy' : ''}`}
      onMouseEnter={() => onWarmPreview?.()}
      onPointerEnter={() => onWarmPreview?.()}
      onMouseDown={(e) => {
        // Shift/Ctrl range select: kill browser text-highlight before it starts
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            /* ignore */
          }
        }
      }}
      onSelect={(e) => {
        e.preventDefault();
      }}
      onClick={(e) => {
        if (suppressClick.current || movedPastThreshold.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
          movedPastThreshold.current = false;
          return;
        }
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            /* ignore */
          }
        }
        onClick(e);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      draggable={!onMediaDragPrime}
      onPointerDown={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey) {
          e.preventDefault();
        }
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDragStart={(e) => {
        if (onMediaDragPrime) {
          e.preventDefault();
          return;
        }
        movedPastThreshold.current = true;
        suppressClick.current = true;
        onDragStartFile?.(e, file);
      }}
      onDragEnd={(e) => {
        suppressClick.current = true;
        movedPastThreshold.current = false;
        resetAfterDrag();
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 120);
        onDragEndFile?.(e);
      }}
      role="row"
      title={displayName}
    >
      <div className="td-list-ico">
        <FileTypeIcon file={file} size="sm" />
      </div>
      <div className="td-list-name" title={displayName}>
        {isCut && (
          <span className="td-clipboard-badge is-cut" title={t('speedtest.clipboard_cut_badge')}>
            <Scissors size={10} />
            <span>{t('speedtest.clipboard_cut_tag')}</span>
          </span>
        )}
        {isCopy && (
          <span className="td-clipboard-badge is-copy" title={t('speedtest.clipboard_copy_badge')}>
            <Copy size={10} />
            <span>{t('speedtest.clipboard_copy_tag')}</span>
          </span>
        )}
        <span>{displayName}</span>
      </div>
      <div className="td-list-size">{formatDriveBytes(file.size)}</div>
      <div className="td-list-date">{date}</div>
    </div>
  );
}

export const DriveFileListItem = memo(DriveFileListItemInner, (prev, next) => {
  return (
    prev.file.id === next.file.id &&
    prev.file.size === next.file.size &&
    prev.file.name === next.file.name &&
    prev.file.icon_type === next.file.icon_type &&
    prev.selected === next.selected &&
    prev.isDragSource === next.isDragSource
  );
});
