import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FolderTree, Fingerprint, Check, Copy } from 'lucide-react';
import type { DriveFile, DriveFolder, DriveChat } from '../../../lib/telegram/driveTypes';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { buildMediaPathId, type MediaPathLocationKind } from '../utils/mediaPathId';
import { getSessionMetadata } from '../../../lib/telegram/core/sessionPicker';
import { nativeWriteClipboardText } from '../../../lib/tauri/desktopClipboard';

export interface PreviewCopyIdentityActionsProps {
  file: DriveFile;
  folderId: number | null;
  creds: DriveCredentials | null;
  folders?: DriveFolder[];
  chats?: DriveChat[];
  disabled?: boolean;
  onNotify?: (message: string) => void;
}

export const PreviewCopyIdentityActions: React.FC<PreviewCopyIdentityActionsProps> = ({
  file,
  folderId,
  creds,
  folders,
  chats,
  disabled,
  onNotify,
}) => {
  const { t } = useTranslation();
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  const triggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const accountUserId = useMemo(() => {
    if (creds?.session) {
      const meta = getSessionMetadata(creds.session);
      if (meta?.telegramUserId) return meta.telegramUserId;
      const cleaned = String(creds.session).replace(/^session_/, '');
      if (cleaned) return cleaned;
    }
    if (file.account_id) {
      const meta = getSessionMetadata(file.account_id);
      if (meta?.telegramUserId) return meta.telegramUserId;
      const cleaned = String(file.account_id).replace(/^session_/, '');
      if (cleaned) return cleaned;
    }
    return '0';
  }, [creds?.session, file.account_id]);

  const peerId = useMemo(() => {
    if (file.is_saved_messages || file.peer_kind === 'saved_messages') return 'me';
    if (file.peer_id) return String(file.peer_id);
    if (folderId != null && folderId !== 0) return String(folderId);
    return 'me';
  }, [file.is_saved_messages, file.peer_kind, file.peer_id, folderId]);

  const locationKind = useMemo((): MediaPathLocationKind => {
    if (file.is_saved_messages || file.peer_kind === 'saved_messages' || peerId === 'me') {
      return 'saved';
    }
    if (folderId != null && folders?.some((f) => f.id === folderId)) {
      return 'drive';
    }
    return 'chat';
  }, [file.is_saved_messages, file.peer_kind, peerId, folderId, folders]);

  const activeChat = useMemo(() => {
    if (!chats?.length || !peerId || peerId === 'me') return null;
    return chats.find((c) => String(c.id) === String(peerId)) || null;
  }, [chats, peerId]);

  const pathId = useMemo(() => {
    return buildMediaPathId({
      accountUserId,
      locationKind,
      peerId,
      topicId: file.topic_id ?? null,
      mediaId: file.id,
      chat: activeChat,
      file,
    });
  }, [accountUserId, locationKind, peerId, file, activeChat]);

  const messageId = useMemo(() => String(file.id), [file.id]);

  const handleCopyPathId = useCallback(async () => {
    if (disabled || !pathId) return;
    const ok = await nativeWriteClipboardText(pathId);
    if (ok) {
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1800);
      onNotify?.(t('drive.copy_path_id_success', { value: pathId }));
    }
  }, [disabled, pathId, onNotify, t]);

  const handleCopyId = useCallback(async () => {
    if (disabled || !messageId) return;
    const ok = await nativeWriteClipboardText(messageId);
    if (ok) {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
      onNotify?.(t('drive.copy_id_success', { value: messageId }));
    }
  }, [disabled, messageId, onNotify, t]);

  const placeMenu = useCallback(() => {
    if (!triggerBtnRef.current || typeof window === 'undefined') return null;
    const r = triggerBtnRef.current.getBoundingClientRect();
    const width = 290;
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    if (spaceBelow >= 180 || spaceBelow >= spaceAbove) {
      const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 100));
      return { top, left, width };
    } else {
      const bottom = Math.max(8, window.innerHeight - r.top + 8);
      return { bottom, left, width };
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const update = () => setMenuPos(placeMenu());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [menuOpen, placeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [menuOpen]);

  return (
    <>
      <div
        className="td-identity-actions-wrap"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
        }}
      >
        {/* Button 1: Salin Path ID (1-click direct copy) */}
        <button
          type="button"
          className={`td-icon-btn is-compact ${copiedPath ? 'is-active text-emerald-400' : ''}`}
          title={t('drive.preview_copy_path_id_tooltip', { path: pathId })}
          aria-label={t('drive.ctx_menu_copy_path_id')}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            void handleCopyPathId();
          }}
        >
          {copiedPath ? <Check size={13} className="text-emerald-400" /> : <FolderTree size={13} />}
        </button>

        {/* Button 2: Telegram Identity Modal Trigger (Opens overlay on click) */}
        <button
          ref={triggerBtnRef}
          type="button"
          className={`td-icon-btn is-compact ${menuOpen ? 'is-active text-emerald-400 bg-slate-800/80 shadow-sm' : ''}`}
          title={t('drive.preview_identity_menu_title')}
          aria-label={t('drive.preview_identity_menu_title')}
          aria-expanded={menuOpen}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
        >
          <Fingerprint size={13} className={menuOpen ? 'text-emerald-400' : ''} />
        </button>
      </div>

      {/* Floating Identity Card Portal */}
      {typeof document !== 'undefined' &&
        menuOpen &&
        createPortal(
          <>
            {/* Transparent backdrop overlay: intercepts clicks outside to close overlay WITHOUT interrupting video playback */}
            <div
              className="td-identity-popover-backdrop"
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100vh',
                zIndex: 20_190,
                background: 'transparent',
                cursor: 'default',
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
              }}
            />

            {/* Popover Card */}
            {menuPos && (
              <div
                ref={menuRef}
                className="td-dropdown-menu td-identity-popover font-sans"
                style={{
                  position: 'fixed',
                  top: menuPos.top !== undefined ? menuPos.top : 'auto',
                  bottom: menuPos.bottom !== undefined ? menuPos.bottom : 'auto',
                  left: menuPos.left,
                  width: menuPos.width,
                  background: 'rgba(15, 23, 42, 0.98)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  padding: '10px',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.75)',
                  zIndex: 20_200,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
            {/* Popover Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: '6px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#94a3b8',
                }}
              >
                <FolderTree size={13} className="text-sky-400" />
                <span>{t('drive.preview_identity_menu_title')}</span>
              </div>
              {(copiedPath || copiedId) && (
                <span style={{ fontSize: '10px', color: '#34d399', fontWeight: 600 }}>
                  {t('drive.preview_identity_copied')}
                </span>
              )}
            </div>

            {/* Path ID Row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: '#cbd5e1',
                }}
              >
                <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <FolderTree size={11} className="text-sky-400" />
                  {t('drive.ctx_menu_copy_path_id')}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyPathId()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: copiedPath ? '#34d399' : '#38bdf8',
                    cursor: 'pointer',
                    fontSize: '11px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '2px 4px',
                    borderRadius: '4px',
                  }}
                  title={t('drive.ctx_menu_copy_path_id')}
                >
                  {copiedPath ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedPath ? t('drive.copied') : t('drive.copy')}</span>
                </button>
              </div>
              <div
                onClick={() => void handleCopyPathId()}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  background: 'rgba(2, 6, 23, 0.75)',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  color: '#7dd3fc',
                  wordBreak: 'break-all',
                  cursor: 'pointer',
                  userSelect: 'all',
                }}
                title={t('drive.preview_copy_path_id_tooltip', { path: pathId })}
              >
                {pathId}
              </div>
            </div>

            {/* Message ID Row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: '#cbd5e1',
                }}
              >
                <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Fingerprint size={11} className="text-emerald-400" />
                  {t('drive.ctx_menu_copy_id')}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyId()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: copiedId ? '#34d399' : '#34d399',
                    cursor: 'pointer',
                    fontSize: '11px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '2px 4px',
                    borderRadius: '4px',
                  }}
                  title={t('drive.ctx_menu_copy_id')}
                >
                  {copiedId ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedId ? t('drive.copied') : t('drive.copy')}</span>
                </button>
              </div>
              <div
                onClick={() => void handleCopyId()}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  background: 'rgba(2, 6, 23, 0.75)',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(52, 211, 153, 0.2)',
                  color: '#6ee7b7',
                  wordBreak: 'break-all',
                  cursor: 'pointer',
                  userSelect: 'all',
                }}
                title={t('drive.preview_copy_id_tooltip', { id: messageId })}
              >
                {messageId}
              </div>
            </div>
          </div>
        )}
      </>,
      document.body
    )}
    </>
  );
};
