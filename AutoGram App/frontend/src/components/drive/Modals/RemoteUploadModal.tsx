import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link2, X, Loader2, Home, Folder, Megaphone, Users, Bot, MessageSquare, Hash, ChevronRight } from 'lucide-react';
import type { DriveDestChoice } from './DriveDestinationPicker';
import { DriveDestinationPicker } from './DriveDestinationPicker';
import type { DriveCredentials } from '../../../lib/telegram/driveApi/driveApiUtils';
import { PeerAvatar } from '../Navigation/sidebarUtils';

interface RemoteUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  destinations: DriveDestChoice[];
  currentDestination?: DriveDestChoice;
  creds?: DriveCredentials | null;
  onUpload: (url: string, destination: DriveDestChoice) => Promise<void>;
}

function kindIcon(c: DriveDestChoice) {
  if (c.kind === 'saved') return <Home size={16} />;
  if (c.kind === 'drive') return <Folder size={16} />;
  if (c.isForum) return <Hash size={16} />;
  if (c.type === 'group' || c.type === 'supergroup') return <Users size={16} />;
  if (c.type === 'channel') return <Megaphone size={16} />;
  if (c.type === 'bot') return <Bot size={16} />;
  return <MessageSquare size={16} />;
}

function renderBadge(c: DriveDestChoice, t: any) {
  if (c.kind === 'saved') {
    return <span className="td-dest-badge saved">{t('speedtest.dest_badge_saved')}</span>;
  }
  if (c.isForum) {
    return <span className="td-dest-badge forum">{t('speedtest.dest_badge_forum')}</span>;
  }
  if (c.kind === 'drive') {
    return <span className="td-dest-badge td">{t('speedtest.dest_badge_drive')}</span>;
  }
  if (c.type === 'group' || c.type === 'supergroup') {
    return <span className="td-dest-badge group">{t('speedtest.dest_badge_group')}</span>;
  }
  if (c.type === 'channel') {
    return <span className="td-dest-badge channel">{t('speedtest.dest_badge_channel')}</span>;
  }
  if (c.type === 'bot') {
    return <span className="td-dest-badge bot">{t('speedtest.dest_badge_bot')}</span>;
  }
  return <span className="td-dest-badge user">{t('speedtest.dest_badge_user')}</span>;
}

export function RemoteUploadModal({
  isOpen,
  onClose,
  destinations,
  currentDestination,
  creds,
  onUpload,
}: RemoteUploadModalProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [selectedDest, setSelectedDest] = useState<DriveDestChoice>(
    currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' }
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Reset fields only when modal is opened
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setSelectedDest(currentDestination || { id: null, label: 'Saved Messages', kind: 'saved' });
      setErrorMsg('');
      setPickerOpen(false);
    }
  }, [isOpen, currentDestination]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen || pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, pickerOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    
    const targetUrl = url.trim();
    if (!targetUrl) {
      setErrorMsg(t('ui.generated.silakan_masukkan_url_file_f3f01c9'));
      return;
    }
    
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      setErrorMsg(t('ui.generated.url_harus_diawali_dengan_http_atau_https_8ffbae0'));
      return;
    }
    
    setSubmitting(true);
    try {
      // Verifikasi URL via FastAPI lokal
      const verifyRes = await fetch(`http://127.0.0.1:8550/api/v1/verify-url?url=${encodeURIComponent(targetUrl)}`);
      if (!verifyRes.ok) {
        throw new Error(`Gagal menghubungi server verifikasi (HTTP ${verifyRes.status})`);
      }
      const data = await verifyRes.json() as { valid: boolean; error?: string; filename?: string; size?: number };
      if (!data.valid) {
        throw new Error(data.error || 'URL tidak valid atau tidak merujuk ke file media langsung.');
      }

      await onUpload(targetUrl, selectedDest);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
    } finally {
      setSubmitting(false);
    }
  };

  const node = (
    <div className="td-confirm-overlay" role="presentation" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="td-confirm-panel input-dialog td-dialog-kind-rename"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="td-confirm-head">
          <span className="td-confirm-icon input" aria-hidden>
            <Link2 size={20} strokeWidth={2} />
          </span>
          <div className="td-confirm-head-text">
            <h2>{t("speedtest.remote_upload_url_title")}</h2>
            <p className="td-confirm-desc">{t("speedtest.remote_upload_url_subtitle")}</p>
          </div>
          <button 
            type="button" 
            className="td-confirm-close" 
            onClick={onClose} 
            disabled={submitting}
            aria-label={t('speedtest.preview_close_btn')}
          >
            <X size={18} />
          </button>
        </header>

        <div className="td-input-body">
          {errorMsg && (
            <p className="td-input-error" role="alert" style={{ marginBottom: '4px' }}>
              {errorMsg}
            </p>
          )}

          <label className="td-input-label" htmlFor="td-remote-url">
            {t("speedtest.source_url_label")}
          </label>
          <input
            id="td-remote-url"
            className="td-input-field"
            type="text"
            placeholder="https://example.com/file.zip"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (errorMsg) setErrorMsg('');
            }}
            disabled={submitting}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />

          <label className="td-input-label" htmlFor="td-remote-target" style={{ marginTop: '10px' }}>
            {t("speedtest.destination_folder_label")}
          </label>

          <div className="td-remote-dest-wrap">
            <button
              id="td-remote-target"
              type="button"
              className="td-remote-dest-card"
              onClick={() => setPickerOpen(true)}
              disabled={submitting}
              title={t('speedtest.btn_change_dest')}
            >
              <div className="td-remote-dest-main">
                <span className="td-dest-ico" aria-hidden>
                  {selectedDest.kind === 'saved' ? (
                    <Home size={16} />
                  ) : (
                    <PeerAvatar
                      peerId={selectedDest.id ?? 0}
                      creds={creds}
                      title={selectedDest.label}
                      fallback={kindIcon(selectedDest)}
                    />
                  )}
                </span>
                <div className="td-remote-dest-text">
                  <span className="td-remote-dest-name" title={selectedDest.label}>
                    {selectedDest.label}
                  </span>
                  {selectedDest.topicId ? (
                    <span className="td-remote-dest-topic">
                      <Hash size={11} style={{ display: 'inline', verticalAlign: '-1px' }} />
                      {` ${t('speedtest.topic_label', { defaultValue: 'Topik' })} #${selectedDest.topicId}`}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="td-remote-dest-actions">
                {renderBadge(selectedDest, t)}
                <span className="td-remote-dest-change-tag">
                  {t('speedtest.btn_change_dest')}
                  <ChevronRight size={13} style={{ marginLeft: 3 }} />
                </span>
              </div>
            </button>
          </div>
        </div>

        <footer className="td-confirm-foot">
          <button 
            type="button" 
            className="td-confirm-btn ghost" 
            onClick={onClose} 
            disabled={submitting}
          >
            {t('accounts.cancel')}
          </button>
          <button
            type="submit"
            className="td-confirm-btn primary"
            disabled={submitting || !url.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t("speedtest.uploading_status")}</span>
              </>
            ) : (
              <>
                <Link2 size={15} strokeWidth={2.25} />
                <span>{t("speedtest.btn_start_upload")}</span>
              </>
            )}
          </button>
        </footer>
      </form>

      {pickerOpen && (
        <DriveDestinationPicker
          state={{
            title: t('speedtest.remote_upload_select_target'),
            detail: t('speedtest.remote_upload_select_target_desc'),
            choices: destinations,
            creds,
            onConfirm: (choice) => {
              setSelectedDest(choice);
              setPickerOpen(false);
            },
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
