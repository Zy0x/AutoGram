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
  Send,
  Info,
} from 'lucide-react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { driveFileDisplayName } from '../../../lib/telegram/driveTypes';
import { isDesktop } from '../../../lib/tauri/platform';
import { buildTelegramMessageUrl } from '../../../lib/telegram/utils/telegramMessageUrl';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TelegramMessagePreviewModal } from './TelegramMessagePreviewModal';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { nativeWriteClipboardText } from '../../../lib/tauri/desktopClipboard';

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
  onInfo?: () => void;
  onPreviewMessage?: (file: DriveFile) => void;
  chatName?: string;
  topicName?: string;
  creds?: DriveCredentials | null;
  folderId?: number | null;
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
  onOpenTelegramLink?: (url: string) => void;
  onBrowseTelegramDrive?: (url: string) => void;
  onJoinTelegramChat?: (url: string) => void;
  onSendToRemoteLink?: (url: string) => void;
};

interface SubmenuProps {
  icon: React.ReactNode;
  label: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onStay: () => void;
  children: React.ReactNode;
}

function DriveContextSubmenuItem({
  icon,
  label,
  isOpen,
  onOpen,
  onClose,
  onStay,
  children,
}: SubmenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<'right' | 'left'>('right');

  const checkSide = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const estWidth = 200;
    const pad = 12;
    const vw = window.innerWidth;
    if (rect.right + estWidth + pad > vw && rect.left - estWidth - pad >= 0) {
      setSide('left');
    } else {
      setSide('right');
    }
  };

  const handleMouseEnter = () => {
    checkSide();
    onOpen();
  };

  return (
    <div
      ref={containerRef}
      className={`drive-context-submenu ${side === 'left' ? 'flyout-left' : 'flyout-right'}${isOpen ? ' is-open' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          checkSide();
          if (isOpen) onClose();
          else onOpen();
        }}
      >
        {icon}
        <span>{label}</span>
        <ChevronRight size={13} className="drive-context-submenu-arrow" />
      </button>
      {isOpen && (
        <div
          className="drive-context-submenu-flyout"
          role="menu"
          onMouseEnter={onStay}
          onMouseLeave={onClose}
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
  onInfo,
  onPreviewMessage,
  chatName,
  topicName,
  creds,
  folderId,
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
  onOpenTelegramLink,
  onBrowseTelegramDrive,
  onJoinTelegramChat,
  onSendToRemoteLink,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [activeSubmenu, setActiveSubmenu] = useState<'telegram' | 'system' | 'copyIdentity' | null>(null);
  const [previewMsgFile, setPreviewMsgFile] = useState<DriveFile | null>(null);
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
        if ((e.target as HTMLElement | null)?.closest?.('.tg-msg-preview-dialog')) return;
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

  const submenuTimerRef = useRef<number | null>(null);

  const scheduleCloseSubmenu = (delay = 80) => {
    if (submenuTimerRef.current) window.clearTimeout(submenuTimerRef.current);
    submenuTimerRef.current = window.setTimeout(() => {
      setActiveSubmenu(null);
    }, delay);
  };

  const cancelCloseSubmenu = () => {
    if (submenuTimerRef.current) {
      window.clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
  };

  const handleSubmenuOpen = (menuKey: 'telegram' | 'system' | 'copyIdentity') => {
    cancelCloseSubmenu();
    setActiveSubmenu(menuKey);
  };

  const handleSubmenuClose = () => {
    scheduleCloseSubmenu(80);
  };

  const aria =
    isFile
      ? t('speedtest.ctx_menu_aria_file')
      : isLocation
      ? t('speedtest.ctx_menu_aria_location')
      : t('speedtest.ctx_menu_aria_canvas');

  const tgUrl = file ? buildTelegramMessageUrl(file) : null;

  const telegramMenu = file ? (
    <DriveContextSubmenuItem
      icon={<MessageSquare size={14} />}
      label={t('speedtest.ctx_menu_telegram')}
      isOpen={activeSubmenu === 'telegram'}
      onOpen={() => handleSubmenuOpen('telegram')}
      onClose={handleSubmenuClose}
      onStay={cancelCloseSubmenu}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (onPreviewMessage) {
            run(() => onPreviewMessage(file));
          } else {
            setPreviewMsgFile(file);
          }
        }}
      >
        <MessageSquare size={14} />
        <span>{t('speedtest.ctx_menu_preview_message')}</span>
      </button>
      {tgUrl ? (
        <>
          <button
            type="button"
            role="menuitem"
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
            <Send size={14} />
            <span>{t('speedtest.ctx_menu_open_tg')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              run(async () => {
                await nativeWriteClipboardText(tgUrl);
              })
            }
          >
            <Copy size={14} />
            <span>{t('speedtest.ctx_menu_copy_tg')}</span>
          </button>
        </>
      ) : (
        <button
          type="button"
          role="menuitem"
          disabled
          className="drive-context-disabled"
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
          title={t('speedtest.ctx_menu_tg_link_unavailable')}
        >
          <Send size={14} />
          <span>{t('speedtest.ctx_menu_tg_link_unavailable')}</span>
        </button>
      )}
    </DriveContextSubmenuItem>
  ) : null;

  const systemMenu =
    isDesktop() && (onOpenSystem || onOpenWith || onReveal) ? (
      <DriveContextSubmenuItem
        icon={<AppWindow size={14} />}
        label={t('speedtest.ctx_menu_open_in_system')}
        isOpen={activeSubmenu === 'system'}
        onOpen={() => handleSubmenuOpen('system')}
        onClose={handleSubmenuClose}
        onStay={cancelCloseSubmenu}
      >
        {onOpenSystem && (
          <button type="button" role="menuitem" onClick={() => run(onOpenSystem)}>
            <ExternalLink size={14} />
            <span>{t('speedtest.ctx_menu_open_default')}</span>
          </button>
        )}
        {onOpenWith && (
          <button type="button" role="menuitem" onClick={() => run(onOpenWith)}>
            <AppWindow size={14} />
            <span>{t('speedtest.ctx_menu_open_with')}</span>
          </button>
        )}
        {onReveal && (
          <button type="button" role="menuitem" onClick={() => run(onReveal)}>
            <FolderOpen size={14} />
            <span>{t('speedtest.ctx_menu_reveal')}</span>
          </button>
        )}
      </DriveContextSubmenuItem>
    ) : null;

  const copyIdentityMenu = onCopyId ? (
    <DriveContextSubmenuItem
      icon={<Copy size={14} />}
      label={t('speedtest.ctx_menu_copy_identity')}
      isOpen={activeSubmenu === 'copyIdentity'}
      onOpen={() => handleSubmenuOpen('copyIdentity')}
      onClose={handleSubmenuClose}
      onStay={cancelCloseSubmenu}
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
        className={`drive-context-menu${activeSubmenu ? ' has-active-submenu' : ''}`}
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

            {/* Group 1: Preview & Telegram Hub */}
            {onPreview && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onPreview)}
              >
                <Eye size={14} /> {t('speedtest.ctx_menu_preview')}
              </button>
            )}
            {onInfo && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onInfo)}
              >
                <Info size={14} /> {t('speedtest.ctx_menu_info')}
              </button>
            )}
            {telegramMenu}

            <div className="drive-context-divider" role="separator" />

            {/* Group 2: Transfer & System Access */}
            {onDownload && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onDownload)}
              >
                <Download size={14} /> {t('speedtest.ctx_menu_download')}
              </button>
            )}
            {systemMenu}

            <div className="drive-context-divider" role="separator" />

            {/* Group 3: Identity & Management */}
            {copyIdentityMenu}
            {onRename && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onRename)}
              >
                <Pencil size={14} /> {t('speedtest.ctx_menu_rename')}
              </button>
            )}
            {onMove && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onMove)}
              >
                <FolderInput size={14} /> {t('speedtest.ctx_menu_move')}
              </button>
            )}

            {onDelete && (
              <>
                <div className="drive-context-divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onMouseEnter={() => scheduleCloseSubmenu(80)}
                  onClick={() => run(onDelete)}
                >
                  <Trash2 size={14} /> {t('speedtest.ctx_menu_delete')}
                </button>
              </>
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
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onOpenLocation)}
              >
                <FolderOpen size={14} /> {t('speedtest.ctx_menu_open')}
              </button>
            )}
            {onTogglePin && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
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
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onCreateSubfolder)}
              >
                <FolderTree size={14} /> {t('speedtest.ctx_menu_create_subfolder')}
              </button>
            )}
            {target.locationKind === 'drive' && onRenameFolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onRenameFolder)}
              >
                <Pencil size={14} /> {resolvedRenameFolderLabel}
              </button>
            )}
            {target.locationKind === 'drive' && onReparentFolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onReparentFolder)}
              >
                <FolderInput size={14} /> {resolvedReparentFolderLabel}
              </button>
            )}
            {copyIdentityMenu}
            {target.locationKind === 'drive' && onDeleteFolder && (
              <>
                <div className="drive-context-divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onMouseEnter={() => scheduleCloseSubmenu(80)}
                  onClick={() => run(onDeleteFolder)}
                >
                  <Trash2 size={14} /> {resolvedDeleteFolderLabel}
                </button>
              </>
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
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onRefresh)}
              >
                <RefreshCw size={14} /> {t('speedtest.ctx_menu_refresh')}
              </button>
            )}
            {onUpload && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onUpload)}
              >
                <Upload size={14} /> {t('speedtest.ctx_menu_upload')}
              </button>
            )}
            {onCreateFolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onCreateFolder)}
              >
                <FolderPlus size={14} /> {resolvedCreateFolderLabel}
              </button>
            )}
            {onCreateSubfolder && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onCreateSubfolder)}
              >
                <FolderTree size={14} /> {resolvedCreateSubfolderLabel}
              </button>
            )}
            {onSelectAll && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onSelectAll)}
              >
                <CheckSquare size={14} /> {t('speedtest.ctx_menu_select_all')}
              </button>
            )}
            {selectedCount > 0 && onClearSelection && (
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => scheduleCloseSubmenu(80)}
                onClick={() => run(onClearSelection)}
              >
                <Square size={14} /> {t('speedtest.ctx_menu_clear_selection', { count: selectedCount, defaultValue: `Hapus pilihan (${selectedCount})` })}
              </button>
            )}
            {selectedCount > 0 && onDelete && (
              <>
                <div className="drive-context-divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onMouseEnter={() => scheduleCloseSubmenu(80)}
                  onClick={() => run(onDelete)}
                >
                  <Trash2 size={14} /> {t('speedtest.ctx_menu_delete_selected', { count: selectedCount, defaultValue: `Hapus terpilih (${selectedCount})` })}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );

  if (typeof document === 'undefined') return null;
  return (
    <>
      {createPortal(node, document.body)}
      <TelegramMessagePreviewModal
        isOpen={Boolean(previewMsgFile)}
        file={previewMsgFile}
        onClose={() => setPreviewMsgFile(null)}
        chatName={chatName || (isLocation ? target.name : undefined)}
        topicName={topicName}
        creds={creds}
        folderId={folderId}
        onSendToRemoteLink={onSendToRemoteLink}
        onOpenTelegramLink={onOpenTelegramLink}
        onBrowseTelegramDrive={onBrowseTelegramDrive}
        onJoinTelegramChat={onJoinTelegramChat}
      />
    </>
  );
}
