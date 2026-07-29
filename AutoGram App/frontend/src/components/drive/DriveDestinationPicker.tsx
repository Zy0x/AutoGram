/**
 * Destination picker for Media Studio (move / send).
 * Replaces native window.prompt with numbered list.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FolderInput, Home, MessageSquare, Search, X } from 'lucide-react';

export type DriveDestChoice = {
  id: number | null;
  label: string;
  isForum?: boolean;
  kind?: 'saved' | 'drive' | 'chat';
};

export type DriveDestPickerState = {
  title: string;
  detail?: string;
  choices: DriveDestChoice[];
  onConfirm: (choice: DriveDestChoice) => void;
};

type Props = {
  state: DriveDestPickerState | null;
  onClose: () => void;
};

function kindIcon(kind?: DriveDestChoice['kind']) {
  if (kind === 'saved') return <Home size={15} />;
  if (kind === 'drive') return <Folder size={15} />;
  return <MessageSquare size={15} />;
}

export function DriveDestinationPicker({ state, onClose }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const open = !!state;
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (!open || !state) return;
    setQuery('');
    setSelectedIdx(0);
    const t = window.setTimeout(() => searchRef.current?.focus(), 40);
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

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.choices;
    return state.choices.filter((c) => c.label.toLowerCase().includes(q));
  }, [state, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!state) return null;

  const pick = (choice: DriveDestChoice) => {
    const fn = state.onConfirm;
    onClose();
    window.setTimeout(() => fn(choice), 0);
  };

  const confirmSelected = () => {
    const c = filtered[selectedIdx];
    if (c) pick(c);
  };

  const node = (
    <div className="td-confirm-overlay" role="presentation" data-dialog-kind="dest" onClick={onClose}>
      <div
        className="td-confirm-panel dest-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="td-dest-title"
        data-testid="drive-dest-picker"
        data-dialog-layout="card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="td-confirm-head">
          <span className="td-confirm-icon move" aria-hidden>
            <FolderInput size={20} />
          </span>
          <div className="td-confirm-head-text">
            <h2 id="td-dest-title">{state.title}</h2>
            {state.detail && <p>{state.detail}</p>}
          </div>
          <button type="button" className="td-confirm-close" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </header>

        <div className="td-dest-search">
          <Search size={14} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="td-dest-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari chat / folder…"
            aria-label="Cari tujuan"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i: any) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i: any) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                confirmSelected();
              }
            }}
          />
        </div>

        <ul className="td-dest-list" role="listbox" aria-label="Daftar tujuan">
          {filtered.length === 0 && (
            <li className="td-dest-empty">Tidak ada yang cocok</li>
          )}
          {filtered.map((c, i) => {
            const active = i === selectedIdx;
            return (
              <li key={`${c.kind ?? 'x'}-${c.id ?? 'me'}-${c.label}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`td-dest-item${active ? ' is-active' : ''}`}
                  onClick={() => pick(c)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className="td-dest-ico" aria-hidden>
                    {kindIcon(c.kind)}
                  </span>
                  <span className="td-dest-label" title={c.label}>
                    {c.label}
                  </span>
                  {c.isForum && <span className="td-dest-badge">Forum</span>}
                  {c.kind === 'drive' && <span className="td-dest-badge td">TD</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <footer className="td-confirm-foot">
          <button type="button" className="td-confirm-btn ghost" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="td-confirm-btn primary"
            onClick={confirmSelected}
            disabled={!filtered.length}
          >
            <FolderInput size={15} />
            Pilih tujuan
          </button>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
