/**
 * ReUploadBatchModal
 * ──────────────────
 * Guardrail confirmation modal: shown when SmartScanner detects files that
 * were recently deleted from the destination and need user confirmation
 * before re-uploading.
 *
 * Usage:
 *   <ReUploadBatchModal
 *     open={guardrailPending.length > 0}
 *     items={guardrailPending}
 *     thresholdDays={settings.guardrailThresholdDays}
 *     onConfirm={(selected) => handleReupload(selected)}
 *     onSkipAll={() => handleSkipAll()}
 *     onClose={() => setGuardrailPending([])}
 *   />
 */
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, AlertTriangle, Check, X, ChevronDown, ChevronUp } from 'lucide-react';

export type GuardrailItem = {
  index: number;
  name: string;
  size?: number;
  deletedAt?: number;
  originalMessageId?: number;
  reuploadReason?: string;
};

type Props = {
  open: boolean;
  items: GuardrailItem[];
  thresholdDays?: number;
  onConfirm: (selectedIndexes: number[]) => void;
  onSkipAll: () => void;
  onClose: () => void;
};

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTimestamp(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts * 1000).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function ReUploadBatchModal({
  open,
  items,
  thresholdDays = 7,
  onConfirm,
  onSkipAll,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [selected, setSelected] = useState<Set<number>>(() => new Set(items.map((i: any) => i.index)));
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(new Set(items.map((i: any) => i.index)));
    }
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const overlayMouseDownTargetRef = useRef<EventTarget | null>(null);

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    overlayMouseDownTargetRef.current = e.target;
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (overlayMouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
      onClose();
    }
    overlayMouseDownTargetRef.current = null;
  };

  if (!open || items.length === 0) return null;

  const allSelected = selected.size === items.length;
  const noneSelected = selected.size === 0;

  const toggleOne = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.index)));
  };

  const handleConfirm = () => {
    if (selected.size > 0) onConfirm(Array.from(selected));
  };

  const displayItems = expanded ? items : items.slice(0, 5);

  const node = (
    <div
      className="rub-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
    >
      <div
        className="rub-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="rub-head">
          <span className="rub-head-icon">
            <AlertTriangle size={18} />
          </span>
          <div>
            <h2 id={titleId} className="rub-title">{t('drive.reupload_confirm_title')}</h2>
            <p className="rub-subtitle">
              {items.length} {t('ui.generated.file_dihapus_dari_tujuan_dalam_f62460f')} {thresholdDays} {t('ui.generated.hari_terakhir_pilih_file_yang_ingin_diunggah_ula_33dd55f')}
            </p>
          </div>
          <button type="button" className="rub-close" onClick={onClose} aria-label={t('drive.preview_close_btn')}>
            <X size={16} />
          </button>
        </header>

        {/* Context note */}
        <div className="rub-info">
          <RotateCcw size={13} />
          <span>
            {t('ui.generated.file_file_ini_sebelumnya_sudah_ada_di_destinatio_a19d7d7')}
          </span>
        </div>

        {/* Item list */}
        <div className="rub-list-wrap">
          <label className="rub-select-all">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = !allSelected && !noneSelected; }}
              onChange={toggleAll}
            />
            <span>{t('ui.generated.pilih_semua_ea9d584')}{items.length} {t('ui.generated.file_a91fd63')}</span>
          </label>

          <ul className="rub-list">
            {displayItems.map((item: any) => {
              const deletedStr = formatTimestamp(item.deletedAt);
              const sizeStr = formatBytes(item.size);
              return (
                <li key={item.index} className="rub-item">
                  <label className="rub-item-label">
                    <input
                      type="checkbox"
                      checked={selected.has(item.index)}
                      onChange={() => toggleOne(item.index)}
                    />
                    <span className="rub-item-info">
                      <span className="rub-item-name" title={item.name}>{item.name}</span>
                      <span className="rub-item-meta">
                        {sizeStr && <span>{sizeStr}</span>}
                        {deletedStr && <span>{t('ui.generated.dihapus_5ba2f89')} {deletedStr}</span>}
                        {item.originalMessageId && (
                          <span className="rub-item-mid">{t('ui.generated.msg_34e2770')}{item.originalMessageId}</span>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {items.length > 5 && (
            <button
              type="button"
              className="rub-expand-btn"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <><ChevronUp size={13} /> {t('drive.show_less')}</>
              ) : (
                <><ChevronDown size={13} /> {t('ui.generated.tampilkan_8b412db')} {items.length - 5} {t('ui.generated.file_lainnya_f9b61e0')}</>
              )}
            </button>
          )}
        </div>

        {/* Footer */}
        <footer className="rub-foot">
          <button
            type="button"
            className="rub-btn-skip"
            onClick={onSkipAll}
            title={t("drive.batch_reupload_skip")}
          >
            {t('ui.generated.lewati_semua_3c90ee4')}
          </button>
          <div className="rub-foot-right">
            <button type="button" className="rub-btn-cancel" onClick={onClose}>
              {t('accounts.cancel')}
            </button>
            <button
              type="button"
              className="rub-btn-confirm"
              onClick={handleConfirm}
              disabled={noneSelected}
            >
              <Check size={14} />
              {t('ui.generated.upload_ulang_344a049')} {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
