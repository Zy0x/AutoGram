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
      ? 'Hapus Topik?'
      : isFolder
        ? isDriveItem
          ? n === 1
            ? 'Hapus Drive?'
            : `Hapus ${n} Drive?`
          : n === 1
            ? 'Hapus Folder?'
            : `Hapus ${n} Folder?`
        : n === 1
          ? 'Hapus file?'
          : `Hapus ${n} file?`
    : isFolderReparent
      ? 'Pindah Drive/Folder?'
      : isMove
        ? n === 1
          ? 'Kirim media ke chat?'
          : `Kirim ${n} file ke chat?`
        : n === 1
          ? 'Unduh file?'
          : `Unduh ${n} file?`;

  const lead = isDelete
    ? isTopic
      ? `Topik "${state.names[0] || ''}" beserta seluruh riwayat pesan dan media di dalamnya akan dihapus secara permanen.`
      : isFolder
        ? isDriveItem
          ? n === 1
            ? 'Drive ini beserta seluruh isinya (folder dan file di dalamnya) akan dihapus permanen dari Telegram.'
            : `${n} Drive beserta seluruh isinya akan dihapus permanen dari Telegram.`
          : n === 1
            ? 'Folder ini akan dihapus dari Drive, termasuk semua file dan subfolder di dalamnya.'
            : `${n} folder akan dihapus dari Drive beserta isinya.`
        : n === 1
          ? 'File akan dihapus dari Telegram (lokasi ini).'
          : `${n} file akan dihapus dari Telegram.`
    : isFolderReparent
      ? `Item akan dipindah dalam tree Drives${state.detail ? ` ${state.detail}` : ''}. File di dalam channel tidak disalin.`
      : isMove
        ? n === 1
          ? `File akan dikirim${state.detail ? ` ${state.detail}` : ''}.`
          : `${n} file akan dikirim${state.detail ? ` ${state.detail}` : ''}.`
        : n === 1
          ? 'File akan diunduh ke perangkat Anda.'
          : `${n} file akan diunduh ke folder yang Anda pilih.`;

  const childCount = state.childFolderCount ?? state.childFolderNames?.length ?? 0;
  const hasChildFolders = isDelete && isFolder && childCount > 0;

  const warning = isDelete
    ? isTopic
      ? 'Tindakan ini tidak dapat dibatalkan.'
      : isFolder
        ? isDriveItem
          ? hasChildFolders
          ? `Termasuk ${childCount} folder di dalamnya dan semua media. Tidak bisa dibatalkan.`
          : 'Semua media di Drive ini ikut terhapus. Tidak bisa dibatalkan.'
        : hasChildFolders
          ? `Termasuk ${childCount} subfolder dan semua media di dalamnya. Tidak bisa dibatalkan.`
          : 'Semua media di folder ini ikut terhapus. Tidak bisa dibatalkan.'
      : 'Tindakan ini tidak bisa dibatalkan. Pastikan Anda tidak membutuhkan file ini lagi di Telegram.'
    : isFolderReparent
      ? 'Hanya metadata parent= di about channel yang diubah. Root tanpa induk = Drive; bersarang = Folder.'
      : isMove
        ? moveMode === 'move'
          ? 'Mode Pindah: sumber dihapus setelah berhasil terkirim. Pilih Salin untuk mempertahankan file di sumber.'
          : 'Mode Salin: file sumber tetap ada. Forward diblokir → salin media otomatis.'
        : 'Pastikan ruang penyimpanan cukup dan folder tujuan benar.';

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
                <FolderInput size={14} /> {t('speedtest.topbar_move')}
                <span className="td-confirm-mode-hint">{t('speedtest.action_delete_source')}</span>
              </button>
              <button
                type="button"
                className={`td-confirm-mode-btn ${moveMode === 'copy' ? 'active' : ''}`}
                onClick={() => setMoveMode('copy')}
              >
                <Copy size={14} /> {t('settings.debug_copy_logs')}
                <span className="td-confirm-mode-hint">{t('speedtest.action_keep_source')}</span>
              </button>
            </div>

            {n > 1 && (
              <div className="td-confirm-group-section">
                <div className="td-confirm-section-label">
                  <span>{t('speedtest.confirm_format_title', { defaultValue: 'Format Pengiriman' })}</span>
                  <span className="td-confirm-section-badge">{t('speedtest.confirm_sync_drive_settings', { defaultValue: 'Tersinkron Drive Settings' })}</span>
                </div>
                <div className="td-confirm-mode group-mode" role="group" aria-label={t('speedtest.confirm_format_title', { defaultValue: 'Format Pengiriman' })}>
                  <button
                    type="button"
                    className={`td-confirm-mode-btn ${groupAsAlbum ? 'active' : ''}`}
                    onClick={() => setGroupAsAlbum(true)}
                  >
                    <LayoutGrid size={14} /> {t('speedtest.confirm_group_album', { size: state.albumGroupSize || 10, defaultValue: `Gabung Album (Maks ${state.albumGroupSize || 10})` })}
                    <span className="td-confirm-mode-hint">{t('speedtest.confirm_group_album_hint', { defaultValue: 'Kolase media rapi & 1 notifikasi' })}</span>
                  </button>
                  <button
                    type="button"
                    className={`td-confirm-mode-btn ${!groupAsAlbum ? 'active' : ''}`}
                    onClick={() => setGroupAsAlbum(false)}
                  >
                    <Layers size={14} /> {t('speedtest.confirm_send_individual', { defaultValue: 'Kirim Satuan (Terpisah)' })}
                    <span className="td-confirm-mode-hint">{t('speedtest.confirm_send_individual_hint', { defaultValue: 'Pesan individual per berkas' })}</span>
                  </button>
                </div>
              </div>
            )}

            {(state.isForum || state.isTopicLoading) && (
              <label className="td-confirm-topic">
                <span>{t('speedtest.forum_topic_optional')}</span>
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
                    ariaLabel="Topik tujuan"
                    options={[
                      { value: '', label: t('speedtest.forum_topic_general_all', { defaultValue: 'General / Semua media (Chat Utama)' }) },
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
                    {t('ui.generated.daftar_topik_kosong_kirim_ke_general_chat_5e58443')}
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
                <Trash2 size={15} /> {t('speedtest.preview_delete_btn')}
              </>
            ) : isFolderReparent ? (
              <>
                <FolderInput size={15} /> {t('ui.generated.pindahkan_34ea0c0')}
              </>
            ) : isMove ? (
              moveMode === 'copy' ? (
                <>
                  <Copy size={15} /> {t('ui.generated.salin_ke_chat_f92194a')}
                </>
              ) : (
                <>
                  <FolderInput size={15} /> {t('ui.generated.pindahkan_34ea0c0')}
                </>
              )
            ) : (
              <>
                <Download size={15} /> {t('ui.generated.lanjut_unduh_a8ff5db')}
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
