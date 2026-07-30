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
import { useState, useEffect, useId } from 'react';
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
    <div className="rub-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="rub-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Header */}
        <header className="rub-head">
          <span className="rub-head-icon">
            <AlertTriangle size={18} />
          </span>
          <div>
            <h2 id={titleId} className="rub-title">Konfirmasi Re-upload</h2>
            <p className="rub-subtitle">
              {items.length} file dihapus dari tujuan dalam {thresholdDays} hari terakhir.
              Pilih file yang ingin diunggah ulang.
            </p>
          </div>
          <button type="button" className="rub-close" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </header>

        {/* Context note */}
        <div className="rub-info">
          <RotateCcw size={13} />
          <span>
            File-file ini sebelumnya sudah ada di destination namun kemudian dihapus.
            Re-upload akan mengunggah ulang file asli dari drive lokal ke tujuan yang sama.
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
            <span>Pilih semua ({items.length} file)</span>
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
                        {deletedStr && <span>Dihapus: {deletedStr}</span>}
                        {item.originalMessageId && (
                          <span className="rub-item-mid">msg #{item.originalMessageId}</span>
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
                <><ChevronUp size={13} /> {t('speedtest.show_less')}</>
              ) : (
                <><ChevronDown size={13} /> Tampilkan {items.length - 5} file lainnya</>
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
            title={t("speedtest.batch_reupload_skip")}
          >
            Lewati Semua
          </button>
          <div className="rub-foot-right">
            <button type="button" className="rub-btn-cancel" onClick={onClose}>
              Batal
            </button>
            <button
              type="button"
              className="rub-btn-confirm"
              onClick={handleConfirm}
              disabled={noneSelected}
            >
              <Check size={14} />
              Upload Ulang {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
