import { useTranslation } from 'react-i18next';
/**
 * Confirm dialog for destructive / significant Drive actions
 * (delete, download, move/forward with optional forum topic + keep-source).
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalBackHandler } from '../../../lib/platform/modalBackStack';
import {
  AlertTriangle,
  Download,
  FolderInput,
  Trash2,
  X,
  Copy,
  LayoutGrid,
  Layers,
} from 'lucide-react';
import type { DriveTopic } from '../../../lib/telegram/driveTypes';
import { MediaSelect } from '../Navigation/MediaSelect';

export type DriveConfirmKind = 'delete' | 'download' | 'move';

export type DriveMoveChoice = {
  mode: 'move' | 'copy';
  topicId: number | null;
  groupAsAlbum?: boolean;
};

/**
 * Folder delete opts (internal). UI always cascades — no detach/cascade picker.
 * Kept for API compatibility with onConfirm handlers.
 */
export type DriveFolderDeleteChoice = {
  cascade?: boolean;
  detachChildren?: boolean;
};

export type DriveConfirmState = {
  kind: DriveConfirmKind;
  /** One or more file display names */
  names: string[];
  /** Extra line e.g. destination for move */
  detail?: string;
  /** Forum topics when dropping onto a forum chat */
  topics?: DriveTopic[];
  /** true when destination is a forum (even if topics list empty) */
  isForum?: boolean;
  /** true while topics are loading asynchronously */
  isTopicLoading?: boolean;
  /** Optional pre-selected forum topic ID */
  initialTopicId?: number | null;
  /** Initial group as album mode synced from Drive Settings */
  initialGroupAsAlbum?: boolean;
  /** Configured album group size from Drive Settings */
  albumGroupSize?: number;
  /** delete: file (default) vs folder channel [TD] vs forum topic */
  entity?: 'file' | 'folder' | 'topic';
  /**
   * Drive = root [TD] channel; Folder = nested under a Drive.
   * Used for plain-language delete copy.
   */
  folderKind?: 'drive' | 'folder';
  /** Optional: nested folder names (info only, not a mode picker) */
  childFolderNames?: string[];
  childFolderCount?: number;
  /** Called when user confirms */
  onConfirm: (choice?: DriveMoveChoice | DriveFolderDeleteChoice) => void;
};

type Props = {
  state: DriveConfirmState | null;
  onClose: () => void;
};

export function DriveConfirmDialog({ state, onClose }: Props) {
  const { t } = useTranslation();
  const open = !!state;
  useModalBackHandler(open, onClose, 'drive-confirm-dialog');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [moveMode, setMoveMode] = useState<'move' | 'copy'>('move');
  const [topicId, setTopicId] = useState<number | null>(state?.initialTopicId ?? null);
  const [groupAsAlbum, setGroupAsAlbum] = useState<boolean>(state?.initialGroupAsAlbum ?? true);
  const overlayMouseDownTargetRef = useRef<EventTarget | null>(null);
  const isFirstOpen = useRef(true);

  useEffect(() => {
    if (!open || !state) {
      isFirstOpen.current = true;
      return;
    }
    if (isFirstOpen.current) {
      isFirstOpen.current = false;
      setMoveMode('move');
      setTopicId(state.initialTopicId ?? null);
      setGroupAsAlbum(state.initialGroupAsAlbum ?? true);
    } else {
      if (state.initialTopicId != null) {
        setTopicId((prev) => (prev == null ? state.initialTopicId ?? null : prev));
      }
    }
    const t = window.setTimeout(() => confirmRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, state, onClose]);

  if (!state) return null;

  const n = state.names.length;
  const isDelete = state.kind === 'delete';
  const isMove = state.kind === 'move';
  const isFolder = state.entity === 'folder';
  const isTopic = state.entity === 'topic';
  const isDriveItem = state.folderKind === 'drive';
  /** Folder reparent confirm reuses kind=move + entity=folder (no file copy/move modes). */
  const isFolderReparent = isMove && isFolder;
  const title = isDelete
    ? isTopic
      ? t('drive_tools.confirm_delete_topic_title')
      : isFolder
        ? isDriveItem
          ? n === 1
            ? t('drive_tools.confirm_delete_drive_title_single')
            : t('drive_tools.confirm_delete_drive_title', { count: n })
          : n === 1
            ? t('drive_tools.confirm_delete_folder_title_single')
            : t('drive_tools.confirm_delete_folder_title', { count: n })
        : n === 1
          ? t('drive_tools.confirm_delete_file_title_single')
          : t('drive_tools.confirm_delete_file_title', { count: n })
    : isFolderReparent
      ? t('drive_tools.confirm_move_folder_title')
      : isMove
        ? n === 1
          ? t('drive_tools.confirm_send_to_chat_title_single')
          : t('drive_tools.confirm_send_to_chat_title', { count: n })
        : n === 1
          ? t('drive_tools.confirm_download_file_title_single')
          : t('drive_tools.confirm_download_file_title', { count: n });

  const lead = isDelete
    ? isTopic
      ? t('drive_tools.confirm_delete_topic_lead', { name: state.names[0] || '' })
      : isFolder
        ? isDriveItem
          ? n === 1
            ? t('drive_tools.confirm_delete_drive_lead_single')
            : t('drive_tools.confirm_delete_drive_lead', { count: n })
          : n === 1
            ? t('drive_tools.confirm_delete_folder_lead_single')
            : t('drive_tools.confirm_delete_folder_lead', { count: n })
        : n === 1
          ? t('drive_tools.confirm_delete_file_lead_single')
          : t('drive_tools.confirm_delete_file_lead', { count: n })
    : isFolderReparent
      ? t('drive_tools.confirm_reparent_lead', { detail: state.detail ? ` ${state.detail}` : '' })
      : isMove
        ? n === 1
          ? t('drive_tools.confirm_send_lead_single', { detail: state.detail ? ` ${state.detail}` : '' })
          : t('drive_tools.confirm_send_lead', { count: n, detail: state.detail ? ` ${state.detail}` : '' })
        : n === 1
          ? t('drive_tools.confirm_download_lead_single')
          : t('drive_tools.confirm_download_lead', { count: n });

  const childCount = state.childFolderCount ?? state.childFolderNames?.length ?? 0;
  const hasChildFolders = isDelete && isFolder && childCount > 0;

  const warning = isDelete
    ? isTopic
      ? t('drive_tools.confirm_warn_irreversible')
      : isFolder
        ? isDriveItem
          ? hasChildFolders
            ? t('drive_tools.confirm_warn_children_drive', { count: childCount })
            : t('drive_tools.confirm_warn_all_media_drive')
          : hasChildFolders
            ? t('drive_tools.confirm_warn_children_folder', { count: childCount })
            : t('drive_tools.confirm_warn_all_media_folder')
        : t('drive_tools.confirm_warn_delete_files')
    : isFolderReparent
      ? t('drive_tools.confirm_warn_reparent')
      : isMove
        ? moveMode === 'move'
          ? t('drive_tools.confirm_warn_move_mode')
          : t('drive_tools.confirm_warn_copy_mode')
        : t('drive_tools.confirm_warn_download');

  const panelClass = isDelete ? 'danger' : isMove || isFolderReparent ? 'move' : 'download';
  const Icon = isDelete ? Trash2 : isMove || isFolderReparent ? FolderInput : Download;

  const showList = state.names.slice(0, 6);
  const more = n - showList.length;
  const topics = state.topics || [];
  const childNames = (state.childFolderNames || []).slice(0, 8);
  const childMore = childCount - childNames.length;

  const confirm = () => {
    const fn = state.onConfirm;
    onClose();
    window.setTimeout(() => {
      if (isFolderReparent) {
        fn();
      } else if (isMove) {
        fn({
          mode: moveMode,
          topicId: topicId && topicId > 0 ? topicId : null,
          groupAsAlbum,
        });
      } else if (isDelete && isFolder) {
        // Always cascade: hapus item + semua folder/file di dalamnya (tanpa opsi rumit)
        fn({ cascade: true, detachChildren: false });
      } else {
        fn();
      }
    }, 0);
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    overlayMouseDownTargetRef.current = e.target;
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (overlayMouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
      onClose();
    }
    overlayMouseDownTargetRef.current = null;
  };

  const node = (
    <div
      className="td-confirm-overlay"
      role="presentation"
      data-dialog-kind={state.kind}
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className={`td-confirm-panel ${panelClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="td-confirm-title"
        data-testid="drive-confirm-dialog"
        data-dialog-layout="card"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <header className="td-confirm-head">
          <span className={`td-confirm-icon ${panelClass}`} aria-hidden>
            <Icon size={20} />
          </span>
          <div className="td-confirm-head-text">
            <h2 id="td-confirm-title">{title}</h2>
            <p>{lead}</p>
          </div>
          <button type="button" className="td-confirm-close" onClick={onClose} aria-label={t('speedtest.preview_close_btn')}>
            <X size={18} />
          </button>
        </header>

        {showList.length > 0 && (
          <ul className="td-confirm-list" aria-label={t('ui.generated.daftar_file_11edb0f')}>
            {showList.map((name, i) => (
              <li key={`${name}-${i}`} title={name}>
                {name}
              </li>
            ))}
            {more > 0 && <li className="td-confirm-more">+{more} {t('ui.generated.file_lainnya_f9b61e0')}</li>}
          </ul>
        )}

        {hasChildFolders && (
          <div className="td-confirm-children-info">
            <p className="td-confirm-children-lead">
              {isDriveItem ? t('ui.generated.isi_drive_yang_ikut_terhapus_ed43fcc') : t('ui.generated.isi_folder_yang_ikut_terhapus_3dfc205')}
            </p>
            <ul className="td-confirm-list" aria-label={t('ui.generated.folder_di_dalam_4bb56dc')}>
              {childNames.map((name, i) => (
                <li key={`child-${name}-${i}`} title={name}>
                  {name}
                </li>
              ))}
              {childMore > 0 && (
                <li className="td-confirm-more">+{childMore} {t('ui.generated.folder_lainnya_564acbb')}</li>
              )}
            </ul>
          </div>
        )}

        {isMove && !isFolderReparent && (
          <div className="td-confirm-move-opts">
            <div className="td-confirm-mode" role="group" aria-label={t('ui.generated.mode_kirim_6d02800')}>
              <button
                type="button"
                className={`td-confirm-mode-btn ${moveMode === 'move' ? 'active' : ''}`}
                onClick={() => setMoveMode('move')}
              >
                <FolderInput size={14} /> {t('drive_tools.confirm_btn_move')}
                <span className="td-confirm-mode-hint">{t('drive_tools.confirm_hint_delete_source')}</span>
              </button>
              <button
                type="button"
                className={`td-confirm-mode-btn ${moveMode === 'copy' ? 'active' : ''}`}
                onClick={() => setMoveMode('copy')}
              >
                <Copy size={14} /> {t('drive_tools.confirm_btn_copy')}
                <span className="td-confirm-mode-hint">{t('drive_tools.confirm_hint_keep_source')}</span>
              </button>
            </div>

            {n > 1 && (
              <div className="td-confirm-group-section">
                <div className="td-confirm-section-label">
                  <span>{t('drive_tools.confirm_format_title')}</span>
                  <span className="td-confirm-section-badge">{t('drive_tools.confirm_sync_drive_settings')}</span>
                </div>
                <div className="td-confirm-mode group-mode" role="group" aria-label={t('drive_tools.confirm_format_title')}>
                  <button
                    type="button"
                    className={`td-confirm-mode-btn ${groupAsAlbum ? 'active' : ''}`}
                    onClick={() => setGroupAsAlbum(true)}
                  >
                    <LayoutGrid size={14} /> {t('drive_tools.confirm_group_album', { size: state.albumGroupSize || 10 })}
                    <span className="td-confirm-mode-hint">{t('drive_tools.confirm_group_album_hint')}</span>
                  </button>
                  <button
                    type="button"
                    className={`td-confirm-mode-btn ${!groupAsAlbum ? 'active' : ''}`}
                    onClick={() => setGroupAsAlbum(false)}
                  >
                    <Layers size={14} /> {t('drive_tools.confirm_send_individual')}
                    <span className="td-confirm-mode-hint">{t('drive_tools.confirm_send_individual_hint')}</span>
                  </button>
                </div>
              </div>
            )}

            {(state.isForum || state.isTopicLoading) && (
              <label className="td-confirm-topic">
                <span>{t('drive_tools.confirm_topic_label')}</span>
                {state.isTopicLoading ? (
                  <div className="td-confirm-topic-loading" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '13px', color: 'var(--td-text-muted, #94a3b8)' }}>
                    <span className="td-spinner-sm" />
                    <span>{t('speedtest.loading_forum_topics')}</span>
                  </div>
                ) : (
                  <MediaSelect
                    className="td-confirm-topic-select"
                    value={topicId == null ? '' : String(topicId)}
                    onChange={(value) => setTopicId(value ? Number(value) : null)}
                    ariaLabel={t('drive_tools.confirm_topic_label')}
                    options={[
                      { value: '', label: t('drive_tools.confirm_topic_general') },
                      ...topics.map((topic) => ({
                        value: String(topic.id),
                        label: topic.title || `Topik ${topic.id}`,
                        description: topic.closed ? t('speedtest.topic_closed', { defaultValue: 'Topik ditutup' }) : undefined,
                        disabled: !!topic.closed,
                      })),
                    ]}
                  />
                )}
                {!state.isTopicLoading && !topics.length && (
                  <span className="td-confirm-topic-empty">
                    {t('drive_tools.confirm_topic_empty')}
                  </span>
                )}
              </label>
            )}
          </div>
        )}

        <div className={`td-confirm-warn ${isDelete ? 'danger' : ''}`}>
          <AlertTriangle size={15} />
          <p>{warning}</p>
        </div>

        <footer className="td-confirm-foot">
          <button type="button" className="td-confirm-btn ghost" onClick={onClose}>
            {t('accounts.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`td-confirm-btn ${isDelete ? 'danger' : 'primary'}`}
            onClick={confirm}
          >
            {isDelete ? (
              <>
                <Trash2 size={15} /> {t('drive_tools.confirm_action_delete')}
              </>
            ) : isFolderReparent ? (
              <>
                <FolderInput size={15} /> {t('drive_tools.confirm_action_move')}
              </>
            ) : isMove ? (
              moveMode === 'copy' ? (
                <>
                  <Copy size={15} /> {t('drive_tools.confirm_action_copy')}
                </>
              ) : (
                <>
                  <FolderInput size={15} /> {t('drive_tools.confirm_action_move')}
                </>
              )
            ) : (
              <>
                <Download size={15} /> {t('drive_tools.confirm_action_download')}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
