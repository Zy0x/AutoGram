import { useTranslation } from 'react-i18next';
/**
 * Destination picker for Media Studio (move / send / upload).
 * Replaces native window.prompt with numbered list.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bot, Folder, FolderInput, Hash, Home, Megaphone, MessageSquare, Search, Users, X } from 'lucide-react';

import type { DriveCredentials } from '../../../lib/telegram/driveApi/driveApiUtils';
import type { DriveTopic } from '../../../lib/telegram/driveTypes';
import { driveListTopics } from '../../../lib/telegram/driveApi/driveFoldersApi';
import { PeerAvatar } from '../Navigation/sidebarUtils';

export type DriveDestChoice = {
  id: number | null;
  label: string;
  isForum?: boolean;
  kind?: 'saved' | 'drive' | 'chat';
  type?: 'user' | 'group' | 'channel' | 'bot' | 'unknown' | string;
  topicId?: number | null;
};

export type DriveDestPickerState = {
  title: string;
  detail?: string;
  choices: DriveDestChoice[];
  creds?: DriveCredentials | null;
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
  if (c.type === 'group' || c.type === 'supergroup') return <Users size={15} />;
  if (c.type === 'channel') return <Megaphone size={15} />;
  if (c.type === 'bot') return <Bot size={15} />;
  return <MessageSquare size={15} />;
}

export function DriveDestinationPicker({ state, onClose }: Props) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const topicSearchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [topicSubView, setTopicSubView] = useState<{ choice: DriveDestChoice; topics: DriveTopic[] } | null>(null);

  // Keep refs for unstable values/callbacks to prevent useEffect re-runs on every parent render.
  const topicSubViewRef = useRef(topicSubView);
  topicSubViewRef.current = topicSubView;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const isPickerOpen = Boolean(state);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (isPickerOpen && !prevOpenRef.current) {
      // Reset internal state only when the picker transitions from closed to open
      setQuery('');
      setTopicQuery('');
      setSelectedIdx(0);
      setLoadingId(null);
      setTopicSubView(null);
      const timeoutId = window.setTimeout(() => searchRef.current?.focus(), 40);
      return () => window.clearTimeout(timeoutId);
    }
    prevOpenRef.current = isPickerOpen;
  }, [isPickerOpen]);

  useEffect(() => {
    if (topicSubView) {
      setTopicQuery('');
      const timeoutId = window.setTimeout(() => topicSearchRef.current?.focus(), 40);
      return () => window.clearTimeout(timeoutId);
    }
  }, [topicSubView]);

  useEffect(() => {
    if (!isPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (topicSubViewRef.current) {
          setTopicSubView(null);
        } else {
          onCloseRef.current();
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [isPickerOpen]);

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.choices;
    return state.choices.filter((c) => c.label.toLowerCase().includes(q));
  }, [state, query]);

  const filteredTopics = useMemo(() => {
    if (!topicSubView) return [];
    const q = topicQuery.trim().toLowerCase();
    if (!q) return topicSubView.topics;
    return topicSubView.topics.filter((top) => (top.title || `Topik ${top.id}`).toLowerCase().includes(q));
  }, [topicSubView, topicQuery]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!state) return null;

  const pick = (choice: DriveDestChoice) => {
    const fn = state.onConfirm;
    onClose();
    window.setTimeout(() => fn(choice), 0);
  };

  const handleChoiceClick = async (c: DriveDestChoice) => {
    if (loadingId !== null) return;
    if (c.id === null || !state.creds) {
      pick(c);
      return;
    }

    // Check if target is a candidate for topics (forum or group/supergroup/drive)
    const candidate = c.isForum || c.type === 'group' || c.type === 'supergroup' || c.kind === 'drive';
    if (!candidate) {
      pick(c);
      return;
    }

    setLoadingId(c.id);
    try {
      const res = await driveListTopics(state.creds, c.id);
      const topicsList = (res?.topics || []) as DriveTopic[];
      // Smart detection: only show topic sub-view when destination truly has topics.
      const isForum = !!(res?.is_forum || topicsList.length > 0);
      if (isForum) {
        setTopicSubView({ choice: { ...c, isForum: true }, topics: topicsList });
      } else {
        pick({ ...c, isForum: false, topicId: null });
      }
    } catch {
      // On API error: can't determine forum status → go directly to confirm.
      pick(c);
    } finally {
      setLoadingId(null);
    }
  };

  const confirmSelected = () => {
    if (topicSubView) {
      pick({ ...topicSubView.choice, topicId: null });
      return;
    }
    const c = filtered[selectedIdx];
    if (c) void handleChoiceClick(c);
  };

  const renderBadge = (c: DriveDestChoice) => {
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
          {topicSubView ? (
            <button
              type="button"
              className="td-confirm-icon move is-back-btn"
              onClick={() => setTopicSubView(null)}
              title={t('speedtest.back_to_chats')}
              aria-label={t('speedtest.back_to_chats')}
            >
              <ArrowLeft size={18} strokeWidth={2.2} />
            </button>
          ) : (
            <span className="td-confirm-icon move" aria-hidden>
              <FolderInput size={20} />
            </span>
          )}
          <div className="td-confirm-head-text">
            <h2 id="td-dest-title">
              {topicSubView
                ? t('speedtest.select_topic_in_chat', { chat: topicSubView.choice.label })
                : state.title}
            </h2>
            <p className="td-confirm-desc">
              {topicSubView
                ? t('speedtest.select_topic_desc')
                : (state.detail || '')}
            </p>
          </div>
          <button type="button" className="td-confirm-close" onClick={onClose} aria-label={t('speedtest.preview_close_btn')}>
            <X size={18} />
          </button>
        </header>

        {topicSubView ? (
          <>
            {topicSubView.topics.length > 4 && (
              <div className="td-dest-search">
                <Search size={14} aria-hidden />
                <input
                  ref={topicSearchRef}
                  type="search"
                  className="td-dest-search-input"
                  value={topicQuery}
                  onChange={(e) => setTopicQuery(e.target.value)}
                  placeholder={t('speedtest.ph_search_topic')}
                  aria-label={t('speedtest.ph_search_topic')}
                />
              </div>
            )}
            <ul className="td-dest-list" role="listbox" aria-label={t('ui.generated.daftar_topik_forum_18bc840')}>
              {!topicQuery && (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected="true"
                    className="td-dest-item is-active"
                    onClick={() => pick({ ...topicSubView.choice, topicId: null })}
                  >
                    <span className="td-dest-ico" aria-hidden>
                      <Hash size={15} />
                    </span>
                    <span className="td-dest-label">
                      {t('speedtest.forum_topic_general_all')}
                    </span>
                    <span className="td-dest-badge forum">{t('speedtest.dest_badge_forum')}</span>
                  </button>
                </li>
              )}
              {filteredTopics.length === 0 && topicQuery && (
                <li className="td-dest-empty">{t('speedtest.no_match_found')}</li>
              )}
              {filteredTopics.map((topic) => (
                <li key={`topic-${topic.id}`}>
                  <button
                    type="button"
                    role="option"
                    disabled={!!topic.closed}
                    className="td-dest-item"
                    onClick={() => pick({ ...topicSubView.choice, topicId: topic.id })}
                  >
                    <span className="td-dest-ico" aria-hidden>
                      <Hash size={15} />
                    </span>
                    <span className="td-dest-label">
                      {topic.title || `Topik ${topic.id}`}
                    </span>
                    {topic.closed && <span className="td-dest-badge">{t('speedtest.topic_closed')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="td-dest-search">
              <Search size={14} aria-hidden />
              <input
                ref={searchRef}
                type="search"
                className="td-dest-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('speedtest.ph_search_chat_folder')}
                aria-label={t('ui.generated.cari_tujuan_7e335b8')}
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

            <ul className="td-dest-list" role="listbox" aria-label={t('ui.generated.daftar_tujuan_2d87835')}>
              {filtered.length === 0 && (
                <li className="td-dest-empty">{t('speedtest.no_match_found')}</li>
              )}
              {filtered.map((c, i) => {
                const active = i === selectedIdx;
                const isLoading = loadingId !== null && loadingId === c.id;
                return (
                  <li key={`${c.kind ?? 'x'}-${c.id ?? 'me'}-${c.label}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={loadingId !== null && !isLoading}
                      className={`td-dest-item${active ? ' is-active' : ''}`}
                      onClick={() => void handleChoiceClick(c)}
                      onMouseEnter={() => setSelectedIdx(i)}
                    >
                      <span className="td-dest-ico" aria-hidden>
                        {isLoading ? (
                          <span className="td-spinner-sm" />
                        ) : c.kind === 'saved' ? (
                          kindIcon(c)
                        ) : (
                          <PeerAvatar
                            peerId={c.id ?? 0}
                            creds={state?.creds}
                            title={c.label}
                            fallback={kindIcon(c)}
                          />
                        )}
                      </span>
                      <span className="td-dest-label" title={c.label}>
                        {c.label}
                      </span>
                      {isLoading ? (
                        <span className="td-dest-badge" style={{ opacity: 0.8 }}>
                          {t('speedtest.loading_topics_for_chat')}
                        </span>
                      ) : (
                        renderBadge(c)
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <footer className="td-confirm-foot">
          <button type="button" className="td-confirm-btn ghost" onClick={onClose}>
            {t('accounts.cancel')}
          </button>
          <button
            type="button"
            className="td-confirm-btn primary"
            onClick={confirmSelected}
            disabled={!filtered.length && !topicSubView}
          >
            <FolderInput size={15} />
            {t('ui.generated.pilih_tujuan_d019ea0')}
          </button>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
