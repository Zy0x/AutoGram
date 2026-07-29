import { useEffect } from 'react';
import { driveFileDisplayName, formatDriveBytes, type DriveFile } from '../../lib/telegram/driveTypes';
import { usePointerDragPrime } from '../../lib/telegram/pointerDragPrime';
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

export function DriveFileListItem({
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
      className={`td-list-row ${selected ? 'selected' : ''}${isDragSource ? ' is-dragging' : ''}`}
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
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
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
        {displayName}
      </div>
      <div className="td-list-size">{formatDriveBytes(file.size)}</div>
      <div className="td-list-date">{date}</div>
    </div>
  );
}
