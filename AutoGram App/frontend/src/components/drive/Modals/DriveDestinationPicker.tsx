import { useTranslation } from 'react-i18next';
/**
 * Destination picker for Media Studio (move / send).
 * Replaces native window.prompt with numbered list.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Folder, FolderInput, Hash, Home, Megaphone, MessageSquare, Search, Users, X } from 'lucide-react';

export type DriveDestChoice = {
  id: number | null;
  label: string;
  isForum?: boolean;
  kind?: 'saved' | 'drive' | 'chat';
  type?: 'user' | 'group' | 'channel' | 'bot' | 'unknown' | string;
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

function kindIcon(c: DriveDestChoice) {
  if (c.kind === 'saved') return <Home size={15} />;
  if (c.kind === 'drive') return <Folder size={15} />;
  if (c.isForum) return <Hash size={15} />;
  if (c.type === 'group') return <Users size={15} />;
  if (c.type === 'channel') return <Megaphone size={15} />;
  if (c.type === 'bot') return <Bot size={15} />;
  return <MessageSquare size={15} />;
}

export function DriveDestinationPicker({ state, onClose }: Props) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const open = !!state;
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (!open || !state) return;
    setQuery('');
    setSelectedIdx(0);
    const timeoutId = window.setTimeout(() => searchRef.current?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timeoutId);
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

  const renderBadge = (c: DriveDestChoice) => {
    if (c.kind === 'saved') {
      return <span className="td-dest-badge saved">{t('speedtest.dest_badge_saved')}</span>;
    }
    if (c.kind === 'drive') {
      return <span className="td-dest-badge td">{t('speedtest.dest_badge_drive')}</span>;
    }
    if (c.isForum) {
      return <span className="td-dest-badge forum">{t('speedtest.dest_badge_forum')}</span>;
    }
    if (c.type === 'group') {
      return <span className="td-dest-badge group">{t('speedtest.dest_badge_group')}</span>;
    }
    if (c.type === 'channel') {
      return <span className="td-dest-badge channel">{t('speedtest.dest_badge_channel')}</span>;
    }
    if (c.type === 'bot') {
      return <span className="td-dest-badge bot">{t('speedtest.dest_badge_bot')}</span>;
    }
    return <span className="td-dest-badge user">{t('speedtest.dest_badge_user')}</span>;
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
            placeholder={t('speedtest.ph_search_chat_folder')}
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
                    {kindIcon(c)}
                  </span>
                  <span className="td-dest-label" title={c.label}>
                    {c.label}
                  </span>
                  {renderBadge(c)}
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
