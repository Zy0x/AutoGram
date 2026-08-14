import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
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
  Pin,
  PinOff,
  ChevronRight,
} from 'lucide-react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { driveFileDisplayName } from '../../../lib/telegram/driveTypes';
import { isDesktop } from '../../../lib/tauri/platform';
import { buildTelegramMessageUrl } from '../../../lib/telegram/utils/telegramMessageUrl';
import { openUrl } from '@tauri-apps/plugin-opener';

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
  onCopyPathId?: () => void;
  onRenameFolder?: () => void;
  onReparentFolder?: () => void;
  renameFolderLabel?: string;
  reparentFolderLabel?: string;
  deleteFolderLabel?: string;
  onTogglePin?: () => void;
  isPinned?: boolean;
};

interface SubmenuProps {
  icon: React.ReactNode;
  label: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function DriveContextSubmenuItem({
  icon,
  label,
  isOpen,
  onOpenChange,
  children,
}: SubmenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ side: 'right' | 'left'; topOffset: number }>({
    side: 'right',
    topOffset: 0,
  });
  const timerRef = useRef<number | null>(null);

  const calculatePlacement = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const estWidth = 190;
    const estHeight = 86;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal placement: check if right side fits, otherwise flip to left side
    let side: 'right' | 'left' = 'right';
    if (rect.right + estWidth + pad > vw) {
      if (rect.left - estWidth - pad >= 0) {
        side = 'left';
      } else {
        const spaceRight = vw - rect.right;
        const spaceLeft = rect.left;
        side = spaceRight >= spaceLeft ? 'right' : 'left';
      }
    }

    // Vertical placement adjustment to stay within viewport
    let topOffset = 0;
    if (rect.top + estHeight > vh - pad) {
      topOffset = Math.max(-(rect.top - pad), (vh - pad) - (rect.top + estHeight));
    }

    setPlacement({ side, topOffset });
  };

  const handleMouseEnter = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    calculatePlacement();
    onOpenChange(true);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onOpenChange(false);
    }, 160);
  };

  useLayoutEffect(() => {
    if (isOpen) {
      calculatePlacement();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`drive-context-submenu ${placement.side === 'left' ? 'flyout-left' : 'flyout-right'}${isOpen ? ' is-open' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          calculatePlacement();
          onOpenChange(!isOpen);
        }}
      >
        {icon}
        <span>{label}</span>
        <ChevronRight size={13} className="drive-context-submenu-arrow" />
      </button>
      {isOpen && (
        <div
          className="drive-context-submenu-flyout"
          style={{ top: `${placement.topOffset}px` }}
          role="menu"
        >
          {children}
        </div>
      )}
    </div>
  );
}

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
  createFolderLabel,
  createSubfolderLabel,
  locationLabel,
  onOpenLocation,
  onDeleteFolder,
  onCopyId,
  onCopyPathId,
  onRenameFolder,
  onReparentFolder,
  renameFolderLabel,
  reparentFolderLabel,
  deleteFolderLabel,
  onTogglePin,
  isPinned = false,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const isFile = target.kind === 'file';
  const isLocation = target.kind === 'location';
  const file = isFile ? target.file : null;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resolvedCreateFolderLabel = createFolderLabel || t('speedtest.ctx_menu_default_create_drive');
  const resolvedCreateSubfolderLabel = createSubfolderLabel || t('speedtest.ctx_menu_default_create_subfolder');
  const resolvedRenameFolderLabel = renameFolderLabel || t('speedtest.ctx_menu_default_rename');
  const resolvedReparentFolderLabel = reparentFolderLabel || t('speedtest.ctx_menu_default_reparent');
  const resolvedDeleteFolderLabel = deleteFolderLabel || t('speedtest.ctx_menu_default_delete');

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

  const closeSubmenu = () => {
    if (copyMenuOpen) setCopyMenuOpen(false);
  };

  const aria =
    isFile
      ? t('speedtest.ctx_menu_aria_file')
      : isLocation
      ? t('speedtest.ctx_menu_aria_location')
      : t('speedtest.ctx_menu_aria_canvas');

  const copyIdentityMenu = onCopyId ? (
    <DriveContextSubmenuItem
      icon={<Copy size={14} />}
      label={t('speedtest.ctx_menu_copy_identity')}
      isOpen={copyMenuOpen}
      onOpenChange={setCopyMenuOpen}
    >
      <button type="button" role="menuitem" onClick={() => run(onCopyId)}>
        <Copy size={14} />
        <span>{t('speedtest.ctx_menu_copy_id')}</span>
      </button>
      {onCopyPathId && (
        <button type="button" role="menuitem" onClick={() => run(onCopyPathId)}>
          <FolderTree size={14} />
          <span>{t('speedtest.ctx_menu_copy_path_id')}</span>
        </button>
      )}
    </DriveContextSubmenuItem>
  ) : null;

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
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onPreview)}
              >
                <Eye size={14} /> {t('speedtest.ctx_menu_preview')}
              </button>
            )}
            {/* Telegram Message Link Options */}
            {(() => {
              const tgUrl = buildTelegramMessageUrl(file);
              if (tgUrl) {
                return (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onMouseEnter={closeSubmenu}
                      onClick={() =>
                        run(async () => {
                          try {
                            await openUrl(tgUrl);
                          } catch (err) {
                            console.error('[DriveContextMenu] Open Telegram link failed:', err);
                          }
                        })
                      }
                    >
                      <ExternalLink size={14} /> {t('speedtest.ctx_menu_open_tg')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onMouseEnter={closeSubmenu}
                      onClick={() =>
                        run(async () => {
                          try {
                            await navigator.clipboard.writeText(tgUrl);
                          } catch (err) {
                            console.error('[DriveContextMenu] Copy Telegram link failed:', err);
                          }
                        })
                      }
                    >
                      <Copy size={14} /> {t('speedtest.ctx_menu_copy_tg')}
                    </button>
                  </>
                );
              }
              return (
                <button
                  type="button"
                  role="menuitem"
                  disabled
                  className="drive-context-disabled"
                  style={{ opacity: 0.5, cursor: 'not-allowed' }}
                  title={t('speedtest.ctx_menu_tg_link_unavailable')}
                >
                  <MessageSquare size={14} /> {t('speedtest.ctx_menu_tg_link_unavailable')}
                </button>
              );
            })()}
            {isDesktop() && onOpenSystem && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onOpenSystem)}
              >
                <ExternalLink size={14} /> {t('speedtest.ctx_menu_open')}
              </button>
            )}
            {isDesktop() && onOpenWith && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onOpenWith)}
              >
                <AppWindow size={14} /> {t('speedtest.ctx_menu_open_with')}
              </button>
            )}
            {isDesktop() && onReveal && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onReveal)}
              >
                <FolderOpen size={14} /> {t('speedtest.ctx_menu_reveal')}
              </button>
            )}
            {onDownload && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onDownload)}
              >
                <Download size={14} /> {t('speedtest.ctx_menu_download')}
              </button>
            )}
            {copyIdentityMenu}
            {onRename && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onRename)}
              >
                <Pencil size={14} /> {t('speedtest.ctx_menu_rename')}
              </button>
            )}
            {onMove && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onMove)}
              >
                <FolderInput size={14} /> {t('speedtest.ctx_menu_move')}
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                role="menuitem"
                className="danger"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onDelete)}
              >
                <Trash2 size={14} /> {t('speedtest.ctx_menu_delete')}
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
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onOpenLocation)}
              >
                <FolderOpen size={14} /> {t('speedtest.ctx_menu_open')}
              </button>
            )}
            {onTogglePin && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onTogglePin)}
              >
                {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                {isPinned ? t('speedtest.topbar_unpin_loc') : t('speedtest.topbar_pin_loc')}
              </button>
            )}
            {target.locationKind === 'drive' && onCreateSubfolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onCreateSubfolder)}
              >
                <FolderTree size={14} /> {t('speedtest.ctx_menu_create_subfolder')}
              </button>
            )}
            {target.locationKind === 'drive' && onRenameFolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onRenameFolder)}
              >
                <Pencil size={14} /> {resolvedRenameFolderLabel}
              </button>
            )}
            {target.locationKind === 'drive' && onReparentFolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onReparentFolder)}
              >
                <FolderInput size={14} /> {resolvedReparentFolderLabel}
              </button>
            )}
            {copyIdentityMenu}
            {target.locationKind === 'drive' && onDeleteFolder && (
              <button
                type="button"
                role="menuitem"
                className="danger"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onDeleteFolder)}
              >
                <Trash2 size={14} /> {resolvedDeleteFolderLabel}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="drive-context-title" title={locationLabel || t('speedtest.ctx_menu_this_location')}>
              {locationLabel || t('speedtest.ctx_menu_this_location')}
            </div>
            {onRefresh && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onRefresh)}
              >
                <RefreshCw size={14} /> {t('speedtest.ctx_menu_refresh')}
              </button>
            )}
            {onUpload && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onUpload)}
              >
                <Upload size={14} /> {t('speedtest.ctx_menu_upload')}
              </button>
            )}
            {onCreateFolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onCreateFolder)}
              >
                <FolderPlus size={14} /> {resolvedCreateFolderLabel}
              </button>
            )}
            {onCreateSubfolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onCreateSubfolder)}
              >
                <FolderTree size={14} /> {resolvedCreateSubfolderLabel}
              </button>
            )}
            {onSelectAll && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onSelectAll)}
              >
                <CheckSquare size={14} /> {t('speedtest.ctx_menu_select_all')}
              </button>
            )}
            {selectedCount > 0 && onClearSelection && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onClearSelection)}
              >
                <Square size={14} /> {t('speedtest.ctx_menu_clear_selection', { count: selectedCount, defaultValue: `Hapus pilihan (${selectedCount})` })}
              </button>
            )}
            {selectedCount > 0 && onDelete && (
              <button
                type="button"
                role="menuitem"
                className="danger"
                onMouseEnter={closeSubmenu}
                onClick={() => run(onDelete)}
              >
                <Trash2 size={14} /> {t('speedtest.ctx_menu_delete_selected', { count: selectedCount, defaultValue: `Hapus terpilih (${selectedCount})` })}
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
