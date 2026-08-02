import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, LogIn, RefreshCw, X, CheckCircle, ExternalLink } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export interface SessionRelogModalProps {
  open: boolean;
  sessionName: string;
  onClose: () => void;
  onNavigateToAccounts?: () => void;
  onSuccess?: () => void;
}

export const SessionRelogModal: React.FC<SessionRelogModalProps> = ({
  open,
  sessionName,
  onClose,
  onNavigateToAccounts,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  if (!open) return null;

  const handleAutoImport = async () => {
    setLoading(true);
    setStatusMsg(t('accounts.relog_in_progress', 'Memproses impor sesi...'));
    setIsError(false);

    try {
      const res: any = await invoke('tg_import_telethon_session', { session: sessionName });
      if (res?.ok) {
        setStatusMsg(t('accounts.relog_import_success', { session: sessionName, defaultValue: `Sesi "${sessionName}" berhasil diimpor & dihubungkan!` }));
        setIsError(false);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      } else {
        throw new Error(res?.userMessage || res?.message || 'Import failed');
      }
    } catch (e: any) {
      console.warn('Session auto-import failed:', e);
      setIsError(true);
      setStatusMsg(t('accounts.relog_import_failed', 'Gagal mengimpor sesi. Silakan login ulang via menu Akun.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoToAccounts = () => {
    onClose();
    onNavigateToAccounts?.();
  };

  return createPortal(
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel card"
        style={{
          width: '100%',
          maxWidth: '460px',
          padding: '1.75rem',
          borderRadius: '16px',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          background: 'var(--bg-secondary, #181920)',
          color: 'var(--text-main, #ffffff)',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted, #94a3b8)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '50%',
          }}
          aria-label="Tutup"
        >
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <AlertCircle size={22} color="var(--danger, #ef4444)" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>
              {t('accounts.relog_modal_title', 'Login Ulang Sesi Telegram')}
            </h3>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '4px',
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#ef4444',
                }}
              />
              {sessionName || 'Lavender'} · {t('accounts.status_disconnected', 'Terputus')}
            </div>
          </div>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          {t('accounts.relog_modal_subtitle', {
            session: sessionName || 'Lavender',
            defaultValue: `Sesi "${sessionName || 'Lavender'}" belum terotentikasi atau telah terputus. Silakan lakukan impor otomatis atau login ulang akun.`,
          })}
        </p>

        {statusMsg && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.25rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: isError ? '#f87171' : '#34d399',
              border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
            }}
          >
            {isError ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
            <span>{statusMsg}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAutoImport}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1rem',
              fontWeight: 600,
            }}
          >
            {loading ? (
              <RefreshCw size={16} className="spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {t('accounts.relog_auto_import', 'Coba Impor Otomatis dari Telethon')}
          </button>

          {onNavigateToAccounts && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleGoToAccounts}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1rem',
                fontWeight: 500,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
              }}
            >
              <LogIn size={16} />
              {t('accounts.relog_go_to_accounts', 'Buka Menu Akun (Login QR / HP)')}
              <ExternalLink size={14} style={{ marginLeft: 'auto', opacity: 0.6 }} />
            </button>
          )}

          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '0.5rem',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #94a3b8)',
              fontSize: '0.85rem',
            }}
          >
            {t('jobs.cancel_btn', 'Batal')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
