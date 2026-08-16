/**
 * Modern text-input dialog for Media Studio (create folder, rename, etc.).
 * Replaces native window.prompt().
 * Portaled to document.body so layout never collapses inside .td-page (vertical-strip bug).
 */
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus, MessagesSquare, Pencil, X } from 'lucide-react';

export type DriveInputKind = 'create-folder' | 'rename' | 'text' | 'create-topic';

export type DriveInputState = {
  kind: DriveInputKind;
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Called with trimmed non-empty value */
  onConfirm: (value: string) => void;
};

type Props = {
  state: DriveInputState | null;
  onClose: () => void;
};

export function DriveInputDialog({ state, onClose }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const open = !!state;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const overlayMouseDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (!open || !state) return;
    setValue(state.defaultValue || '');
    setError(null);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, state, onClose]);

  if (!state) return null;

  const Icon =
    state.kind === 'create-folder'
      ? FolderPlus
      : state.kind === 'create-topic'
        ? MessagesSquare
        : Pencil;
  const canSubmit = value.trim().length > 0;

  const submit = () => {
    const v = value.trim();
    if (!v) {
      setError(String(t('speedtest.err_name_empty')));
      return;
    }
    if (state.defaultValue != null && v === state.defaultValue.trim()) {
      onClose();
      return;
    }
    const fn = state.onConfirm;
    onClose();
    window.setTimeout(() => fn(v), 0);
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
    >
      <div
        className={`td-confirm-panel input-dialog td-dialog-kind-${state.kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="td-input-title"
        data-testid="drive-input-dialog"
        data-dialog-layout="card"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <header className="td-confirm-head">
          <span className="td-confirm-icon input" aria-hidden>
            <Icon size={20} strokeWidth={2} />
          </span>
          <div className="td-confirm-head-text">
            <h2 id="td-input-title">{state.title}</h2>
            {state.description ? (
              <p className="td-confirm-desc">{state.description}</p>
            ) : null}
          </div>
          <button type="button" className="td-confirm-close" onClick={onClose} aria-label={t("speedtest.close_esc")}>
            <X size={18} />
          </button>
        </header>

        <div className="td-input-body">
          {state.label ? (
            <label className="td-input-label" htmlFor="td-drive-input">
              {state.label}
            </label>
          ) : null}
          <input
            ref={inputRef}
            id="td-drive-input"
            className="td-input-field"
            type="text"
            value={value}
            placeholder={state.placeholder || ''}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {error ? (
            <p className="td-input-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="td-confirm-foot">
          <button type="button" className="td-confirm-btn ghost" onClick={onClose}>
            {t("speedtest.topbar_cancel")}
          </button>
          <button
            type="button"
            className="td-confirm-btn primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            <Icon size={15} strokeWidth={2.25} />
            <span>{state.confirmLabel || t("speedtest.btn_save")}</span>
          </button>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
