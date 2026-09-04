import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Trash2,
  X,
  HardDrive,
  FileBox,
} from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import type { RemoteRecoveryItem } from '../../../lib/telegram/remoteTransferApi';
import {
  remoteTransferResume,
  remoteTransferCleanup,
} from '../../../lib/telegram/remoteTransferApi';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { useModalBackHandler } from '../../../lib/platform/modalBackStack';

interface RemoteRecoveryDialogProps {
  isOpen: boolean;
  items: RemoteRecoveryItem[];
  creds: DriveCredentials | null;
  onClose: () => void;
  onRefresh: () => void;
}

export function RemoteRecoveryDialog({
  isOpen,
  items,
  creds,
  onClose,
  onRefresh,
}: RemoteRecoveryDialogProps) {
  const { t } = useTranslation();
  useModalBackHandler(Boolean(isOpen && items.length), onClose, 'remote-recovery-dialog');

  if (!isOpen || !items.length) return null;

  const handleResume = async (item: RemoteRecoveryItem) => {
    if (!creds) return;
    try {
      await remoteTransferResume(
        item.jobId,
        creds.session,
        Number(creds.apiId) || 0,
        creds.apiHash
      );
      onRefresh();
    } catch (e) {
      console.error('Failed to resume transfer:', e);
    }
  };

  const handleCleanup = async (item: RemoteRecoveryItem) => {
    try {
      await remoteTransferCleanup(item.jobId);
      onRefresh();
    } catch (e) {
      console.error('Failed to cleanup spool:', e);
    }
  };

  const handleCleanupAll = async () => {
    for (const item of items) {
      try {
        await remoteTransferCleanup(item.jobId);
      } catch {
        /* ignore */
      }
    }
    onRefresh();
    onClose();
  };

  return createPortal(
    <div className="td-remote-modal-backdrop" role="dialog" aria-modal="true">
      <div className="td-remote-modal-container td-recovery-dialog-container">
        <div className="td-remote-modal-header">
          <div className="td-remote-modal-header-left">
            <HardDrive className="td-remote-modal-header-icon" size={20} />
            <div>
              <h3 className="td-remote-modal-title">
                {t('drive_tools.recovery_dialog_title')}
              </h3>
              <p className="td-remote-modal-subtitle">
                {t('drive_tools.recovery_dialog_subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="td-remote-modal-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="td-remote-modal-body">
          <div className="td-recovery-item-list">
            {items.map((item) => {
              const total = item.totalSizeBytes || 0;
              const downloaded = item.downloadedBytes;
              const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;

              return (
                <div key={item.jobId} className="td-recovery-item-card">
                  <div className="td-recovery-item-header">
                    <FileBox size={18} className="td-recovery-item-icon" />
                    <div className="td-recovery-item-info">
                      <span className="td-recovery-item-name" title={item.filename}>
                        {item.filename}
                      </span>
                      <span className="td-recovery-item-progress">
                        {`${formatDriveBytes(downloaded)} / ${
                          total > 0 ? formatDriveBytes(total) : '?'
                        } (${pct}%)`}
                      </span>
                    </div>
                  </div>

                  <div className="td-recovery-item-bar-wrap">
                    <div
                      className="td-recovery-item-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="td-recovery-item-actions">
                    <button
                      type="button"
                      className="td-recovery-btn td-recovery-btn-resume"
                      onClick={() => void handleResume(item)}
                      title={t('drive_tools.recovery_btn_resume')}
                    >
                      <Play size={13} />
                      <span>{t('drive_tools.recovery_btn_resume')}</span>
                    </button>
                    <button
                      type="button"
                      className="td-recovery-btn td-recovery-btn-delete"
                      onClick={() => void handleCleanup(item)}
                      title={t('drive_tools.recovery_btn_delete_spool')}
                    >
                      <Trash2 size={13} />
                      <span>{t('drive_tools.recovery_btn_delete_spool')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="td-remote-modal-footer">
          <button
            type="button"
            className="td-remote-modal-btn-secondary"
            onClick={onClose}
          >
            {t('drive_tools.recovery_btn_later')}
          </button>
          <button
            type="button"
            className="td-remote-modal-btn-danger"
            onClick={() => void handleCleanupAll()}
          >
            {t('drive_tools.recovery_btn_clean_all')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
