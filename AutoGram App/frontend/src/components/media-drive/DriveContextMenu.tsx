import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Eye,
  Download,
  Trash2,
  Pencil,
  FolderInput,
  ExternalLink,
  AppWindow,
  FolderOpen,
  Upload,
  FolderPlus,
  FolderTree,
  RefreshCw,
  CheckSquare,
  Square,
  Folder,
  MessageSquare,
  Home,
  Copy,
} from 'lucide-react';
import type { DriveFile } from '../../lib/driveTypes';
import { driveFileDisplayName } from '../../lib/driveTypes';
import { isDesktop } from '../../lib/platform';

export type DriveLocationKind = 'saved' | 'drive' | 'chat';

export type DriveContextMenuTarget =
  | { kind: 'file'; file: DriveFile }
  | { kind: 'canvas' }
  | {
      kind: 'location';
      locationKind: DriveLocationKind;
      id: number | null;
      name: string;
    };

type Props = {
  x: number;
  y: number;
  target: DriveContextMenuTarget;
  onClose: () => void;
  onPreview?: () => void;
  onDownload?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onMove?: () => void;
  onOpenSystem?: () => void;
  onOpenWith?: () => void;
  onReveal?: () => void;
  onUpload?: () => void;
  onCreateFolder?: () => void;
  onCreateSubfolder?: () => void;
  onRefresh?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  selectedCount?: number;
  createFolderLabel?: string;
  createSubfolderLabel?: string;
  locationLabel?: string;
  /** Location menu */
  onOpenLocation?: () => void;
  onDeleteFolder?: () => void;
  onCopyId?: () => void;
  onRenameFolder?: () => void;
  onReparentFolder?: () => void;
  renameFolderLabel?: string;
  reparentFolderLabel?: string;
  deleteFolderLabel?: string;
};

/**
 * Drive tools menu — portaled to document.body.
 * Supports file, empty canvas, and sidebar location (drive/chat/saved).
 */
export function DriveContextMenu({
  x,
  y,
  target,
  onClose,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  onMove,
  onOpenSystem,
  onOpenWith,
  onReveal,
  onUpload,
  onCreateFolder,
  onCreateSubfolder,
  onRefresh,
  onSelectAll,
  onClearSelection,
  selectedCount = 0,
  createFolderLabel = 'Buat Drive [TD]',
  createSubfolderLabel = 'Buat folder di…',
  locationLabel,
  onOpenLocation,
  onDeleteFolder,
  onCopyId,
  onRenameFolder,
  onReparentFolder,
  renameFolderLabel = 'Ganti nama…',
  reparentFolderLabel = 'Pindah ke Drive/Folder…',
  deleteFolderLabel = 'Hapus [TD]…',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const isFile = target.kind === 'file';
  const isLocation = target.kind === 'location';
  const file = isFile ? target.file : null;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setPos({ left: x, top: y });
      return;
    }
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [x, y, isFile, isLocation, file?.id, target.kind === 'location' ? target.id : null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    let removeOutside: (() => void) | undefined;
    const t = window.setTimeout(() => {
      const onPointer = (e: PointerEvent) => {
        if (e.button !== 0 && e.pointerType !== 'touch') return;
        const el = ref.current;
        if (el && e.target instanceof Node && el.contains(e.target)) return;
        if ((e.target as HTMLElement | null)?.closest?.('.drive-context-menu')) return;
        onCloseRef.current();
      };
      window.addEventListener('pointerdown', onPointer, true);
      removeOutside = () => window.removeEventListener('pointerdown', onPointer, true);
    }, 80);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      removeOutside?.();
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const run = (fn?: () => void) => {
    try {
      fn?.();
    } finally {
      onClose();
    }
  };

  const aria =
    isFile ? 'Menu file' : isLocation ? 'Menu lokasi sidebar' : 'Menu lokasi Drive';

  const node = (
    <>
      <div
        className="drive-context-backdrop"
        onClick={() => onClose()}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="drive-context-menu"
        style={{ top: pos.top, left: pos.left }}
        role="menu"
        aria-label={aria}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isFile && file ? (
          <>
            <div className="drive-context-title" title={driveFileDisplayName(file)}>
              {driveFileDisplayName(file)}
            </div>
            {onPreview && (
              <button type="button" role="menuitem" onClick={() => run(onPreview)}>
                <Eye size={14} /> Pratinjau
              </button>
            )}
            {isDesktop() && onOpenSystem && (
              <button type="button" role="menuitem" onClick={() => run(onOpenSystem)}>
                <ExternalLink size={14} /> Buka
              </button>
            )}
            {isDesktop() && onOpenWith && (
              <button type="button" role="menuitem" onClick={() => run(onOpenWith)}>
                <AppWindow size={14} /> Buka dengan…
              </button>
            )}
            {isDesktop() && onReveal && (
              <button type="button" role="menuitem" onClick={() => run(onReveal)}>
                <FolderOpen size={14} /> Tampilkan di folder
              </button>
            )}
            {onDownload && (
              <button type="button" role="menuitem" onClick={() => run(onDownload)}>
                <Download size={14} /> Unduh
              </button>
            )}
            {onCopyId && (
              <button type="button" role="menuitem" onClick={() => run(onCopyId)}>
                <Copy size={14} /> Salin ID
              </button>
            )}
            {onRename && (
              <button type="button" role="menuitem" onClick={() => run(onRename)}>
                <Pencil size={14} /> Ganti nama
              </button>
            )}
            {onMove && (
              <button type="button" role="menuitem" onClick={() => run(onMove)}>
                <FolderInput size={14} /> Pindah ke…
              </button>
            )}
            {onDelete && (
              <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}>
                <Trash2 size={14} /> Hapus
              </button>
            )}
          </>
        ) : isLocation ? (
          <>
            <div className="drive-context-title" title={target.name}>
              {target.locationKind === 'drive' && <Folder size={12} style={{ marginRight: 6, verticalAlign: -1 }} />}
              {target.locationKind === 'chat' && (
                <MessageSquare size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
              )}
              {target.locationKind === 'saved' && <Home size={12} style={{ marginRight: 6, verticalAlign: -1 }} />}
              {target.name}
            </div>
            {onOpenLocation && (
              <button type="button" role="menuitem" onClick={() => run(onOpenLocation)}>
                <FolderOpen size={14} /> Buka
              </button>
            )}
            {target.locationKind === 'drive' && onCreateSubfolder && (
              <button type="button" role="menuitem" onClick={() => run(onCreateSubfolder)}>
                <FolderTree size={14} /> Buat folder di sini
              </button>
            )}
            {target.locationKind === 'drive' && onRenameFolder && (
              <button type="button" role="menuitem" onClick={() => run(onRenameFolder)}>
                <Pencil size={14} /> {renameFolderLabel}
              </button>
            )}
            {target.locationKind === 'drive' && onReparentFolder && (
              <button type="button" role="menuitem" onClick={() => run(onReparentFolder)}>
                <FolderInput size={14} /> {reparentFolderLabel}
              </button>
            )}
            {target.locationKind !== 'saved' && onCopyId && target.id != null && (
              <button type="button" role="menuitem" onClick={() => run(onCopyId)}>
                <Copy size={14} /> Salin ID
              </button>
            )}
            {target.locationKind === 'drive' && onDeleteFolder && (
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => run(onDeleteFolder)}
              >
                <Trash2 size={14} /> {deleteFolderLabel}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="drive-context-title" title={locationLabel || 'Lokasi ini'}>
              {locationLabel || 'Lokasi ini'}
            </div>
            {onRefresh && (
              <button type="button" role="menuitem" onClick={() => run(onRefresh)}>
                <RefreshCw size={14} /> Muat ulang
              </button>
            )}
            {onUpload && (
              <button type="button" role="menuitem" onClick={() => run(onUpload)}>
                <Upload size={14} /> Unggah file…
              </button>
            )}
            {onCreateFolder && (
              <button type="button" role="menuitem" onClick={() => run(onCreateFolder)}>
                <FolderPlus size={14} /> {createFolderLabel}
              </button>
            )}
            {onCreateSubfolder && (
              <button type="button" role="menuitem" onClick={() => run(onCreateSubfolder)}>
                <FolderTree size={14} /> {createSubfolderLabel}
              </button>
            )}
            {onSelectAll && (
              <button type="button" role="menuitem" onClick={() => run(onSelectAll)}>
                <CheckSquare size={14} /> Pilih semua
              </button>
            )}
            {selectedCount > 0 && onClearSelection && (
              <button type="button" role="menuitem" onClick={() => run(onClearSelection)}>
                <Square size={14} /> Hapus pilihan ({selectedCount})
              </button>
            )}
            {selectedCount > 0 && onDelete && (
              <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}>
                <Trash2 size={14} /> Hapus terpilih ({selectedCount})
              </button>
            )}
          </>
        )}
      </div>
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
