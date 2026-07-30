import React, { useEffect } from 'react';
import { AlertTriangle, Trash2, Info, X } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  description,
  confirmText,
  cancelText,
  variant = 'warning',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  const resolvedConfirmText = confirmText || (variant === 'danger' ? 'Hapus' : 'Ya, Lanjutkan');
  const resolvedCancelText = cancelText || 'Batal';

  const iconMap = {
    danger: <Trash2 size={22} color="#ef4444" />,
    warning: <AlertTriangle size={22} color="#f59e0b" />,
    info: <Info size={22} color="#3b82f6" />,
  };

  const badgeBgMap = {
    danger: 'rgba(239, 68, 68, 0.15)',
    warning: 'rgba(245, 158, 11, 0.15)',
    info: 'rgba(59, 130, 246, 0.15)',
  };

  const badgeBorderMap = {
    danger: 'rgba(239, 68, 68, 0.3)',
    warning: 'rgba(245, 158, 11, 0.3)',
    info: 'rgba(59, 130, 246, 0.3)',
  };

  const btnConfirmBgMap = {
    danger: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    warning: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    info: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onCancel();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className="modal-content confirm-modal-card"
        style={{
          maxWidth: '480px',
          width: '92vw',
          padding: '1.25rem',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
          background: 'var(--bg-panel, #1e293b)',
          backdropFilter: 'blur(16px)',
          animation: 'confirmModalScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: badgeBgMap[variant],
                border: `1px solid ${badgeBorderMap[variant]}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {iconMap[variant]}
            </div>
            <div>
              <h3
                id="confirm-modal-title"
                style={{
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  color: 'var(--text-bright, #ffffff)',
                  lineHeight: 1.3,
                }}
              >
                {title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--text-muted, #94a3b8)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            marginTop: '1rem',
            marginBottom: '1.5rem',
            fontSize: '0.9rem',
            lineHeight: 1.55,
            color: 'var(--text-secondary, #cbd5e1)',
          }}
        >
          {description}
        </div>

        <div
          className="confirm-modal-actions"
          style={{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isLoading}
            style={{
              minHeight: '44px',
              padding: '0 1.25rem',
              borderRadius: '10px',
              fontWeight: 500,
              fontSize: '0.9rem',
              flex: '1 1 50%',
            }}
          >
            {resolvedCancelText}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onConfirm}
            disabled={isLoading}
            style={{
              minHeight: '44px',
              padding: '0 1.25rem',
              borderRadius: '10px',
              background: btnConfirmBgMap[variant],
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: '0.9rem',
              flex: '1 1 50%',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
            }}
          >
            {isLoading ? '...' : resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
