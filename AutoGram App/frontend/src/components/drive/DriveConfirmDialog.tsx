/**
 * Confirm dialog for destructive / significant Drive actions
 * (delete, download, move/forward with optional forum topic + keep-source).
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Download,
  FolderInput,
  Trash2,
  X,
  Copy,
} from 'lucide-react';
import type { DriveTopic } from '../../lib/driveTypes';
import { MediaSelect } from './MediaSelect';

export type DriveConfirmKind = 'delete' | 'download' | 'move';

export type DriveMoveChoice = {
  mode: 'move' | 'copy';
  topicId: number | null;
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
  const confirmRef = useRef<HTMLButtonElement>(null);
  const open = !!state;
  const [moveMode, setMoveMode] = useState<'move' | 'copy'>('move');
  const [topicId, setTopicId] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !state) return;
    setMoveMode('move');
    setTopicId(null);
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
        fn({ mode: moveMode, topicId: topicId && topicId > 0 ? topicId : null });
      } else if (isDelete && isFolder) {
        // Always cascade: hapus item + semua folder/file di dalamnya (tanpa opsi rumit)
        fn({ cascade: true, detachChildren: false });
      } else {
        fn();
      }
    }, 0);
  };

  const node = (
    <div
      className="td-confirm-overlay"
      role="presentation"
      data-dialog-kind={state.kind}
      onClick={onClose}
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
      >
        <header className="td-confirm-head">
          <span className={`td-confirm-icon ${panelClass}`} aria-hidden>
            <Icon size={20} />
          </span>
          <div className="td-confirm-head-text">
            <h2 id="td-confirm-title">{title}</h2>
            <p>{lead}</p>
          </div>
          <button type="button" className="td-confirm-close" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </header>

        {showList.length > 0 && (
          <ul className="td-confirm-list" aria-label="Daftar file">
            {showList.map((name, i) => (
              <li key={`${name}-${i}`} title={name}>
                {name}
              </li>
            ))}
            {more > 0 && <li className="td-confirm-more">+{more} file lainnya</li>}
          </ul>
        )}

        {hasChildFolders && (
          <div className="td-confirm-children-info">
            <p className="td-confirm-children-lead">
              {isDriveItem ? 'Isi Drive yang ikut terhapus:' : 'Isi folder yang ikut terhapus:'}
            </p>
            <ul className="td-confirm-list" aria-label="Folder di dalam">
              {childNames.map((name, i) => (
                <li key={`child-${name}-${i}`} title={name}>
                  {name}
                </li>
              ))}
              {childMore > 0 && (
                <li className="td-confirm-more">+{childMore} folder lainnya</li>
              )}
            </ul>
          </div>
        )}

        {isMove && !isFolderReparent && (
          <div className="td-confirm-move-opts">
            <div className="td-confirm-mode" role="group" aria-label="Mode kirim">
              <button
                type="button"
                className={`td-confirm-mode-btn ${moveMode === 'move' ? 'active' : ''}`}
                onClick={() => setMoveMode('move')}
              >
                <FolderInput size={14} /> Pindah
                <span className="td-confirm-mode-hint">hapus sumber</span>
              </button>
              <button
                type="button"
                className={`td-confirm-mode-btn ${moveMode === 'copy' ? 'active' : ''}`}
                onClick={() => setMoveMode('copy')}
              >
                <Copy size={14} /> Salin
                <span className="td-confirm-mode-hint">sumber tetap</span>
              </button>
            </div>

            {state.isForum && (
              <label className="td-confirm-topic">
                <span>Topik forum (opsional)</span>
                <MediaSelect
                  className="td-confirm-topic-select"
                  value={topicId == null ? '' : String(topicId)}
                  onChange={(value) => setTopicId(value ? Number(value) : null)}
                  ariaLabel="Topik forum tujuan"
                  options={[
                    { value: '', label: 'General / tanpa topik khusus' },
                    ...topics.map((topic) => ({
                      value: String(topic.id),
                      label: topic.title || `Topik ${topic.id}`,
                      description: topic.closed ? 'Topik ditutup' : undefined,
                      disabled: !!topic.closed,
                    })),
                  ]}
                />
                {!topics.length && (
                  <span className="td-confirm-topic-empty">
                    Daftar topik kosong — kirim ke general chat.
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
            Batal
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`td-confirm-btn ${isDelete ? 'danger' : 'primary'}`}
            onClick={confirm}
          >
            {isDelete ? (
              <>
                <Trash2 size={15} /> Hapus
              </>
            ) : isFolderReparent ? (
              <>
                <FolderInput size={15} /> Pindahkan
              </>
            ) : isMove ? (
              moveMode === 'copy' ? (
                <>
                  <Copy size={15} /> Salin ke chat
                </>
              ) : (
                <>
                  <FolderInput size={15} /> Pindahkan
                </>
              )
            ) : (
              <>
                <Download size={15} /> Lanjut unduh
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
