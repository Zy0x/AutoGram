import { Bot, CheckCircle2, LogIn, MessageSquareText, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { tgChatAction, type TgChatAction } from '../../../lib/telegram/core/telegramBackend';
import { useModalBackHandler } from '../../../lib/platform/modalBackStack';

type Props = {
  open: boolean;
  creds: DriveCredentials | null;
  initialTarget?: string;
  allowedActions?: TgChatAction[];
  initialAction?: TgChatAction;
  contextual?: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

export function TelegramChatActionModal({
  open,
  creds,
  initialTarget = '',
  allowedActions,
  initialAction = 'join',
  contextual = false,
  onClose,
  onChanged,
}: Props) {
  const { t } = useTranslation();
  const [action, setAction] = useState<TgChatAction>(initialAction);
  const [target, setTarget] = useState(initialTarget);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useModalBackHandler(open && !busy, onClose, 'telegram-chat-action-modal');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!open) return;
    setAction(initialAction);
    setTarget(initialTarget);
    setMessage('');
    setError('');
    setSuccess('');
  }, [initialAction, initialTarget, open]);

  const visibleActions = useMemo<TgChatAction[]>(() => {
    const defaults: TgChatAction[] = ['join', 'start_bot', 'stop_bot', 'send_message', 'leave'];
    return allowedActions?.length ? allowedActions : defaults;
  }, [allowedActions]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open]);

  const needsMessage = action === 'send_message' || action === 'start_bot';
  const actionLabel = useMemo(
    () => t(`telegram_actions.action_${action}`),
    [action, t]
  );

  if (!open) return null;

  const submit = async () => {
    if (!creds || !target.trim()) return;
    if (action === 'send_message' && !message.trim()) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await tgChatAction({
        session: creds.session,
        apiId: Number(creds.apiId) || 0,
        apiHash: creds.apiHash,
        action,
        target: target.trim(),
        message: message.trim() || null,
      });
      if (!result?.ok) {
        throw new Error(result?.userMessage || result?.error?.message || t('telegram_actions.failed'));
      }
      setSuccess(t('telegram_actions.success', { action: actionLabel }));
      await onChanged();
    } catch (cause) {
      setError(String((cause as Error)?.message || cause));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="tg-action-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="tg-action-modal" role="dialog" aria-modal="true" aria-labelledby="tg-action-title">
        <header className="tg-action-header">
          <div className="tg-action-title-wrap">
            <span className="tg-action-icon"><MessageSquareText size={20} /></span>
            <div>
              <h2 id="tg-action-title">
                {t(contextual ? 'telegram_actions.context_title' : 'telegram_actions.title')}
              </h2>
              <p>
                {t(contextual ? 'telegram_actions.context_subtitle' : 'telegram_actions.subtitle')}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('telegram_actions.close_aria')}>
            <X size={19} />
          </button>
        </header>

        <div className="tg-action-body">
          <div className="tg-action-grid" role="radiogroup" aria-label={t('telegram_actions.action_label')}>
            {visibleActions.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={action === value}
                className={action === value ? 'is-active' : ''}
                onClick={() => {
                  setAction(value);
                  setError('');
                  setSuccess('');
                }}
              >
                {value === 'join' || value === 'leave' ? <LogIn size={15} /> : <Bot size={15} />}
                <span>{t(`telegram_actions.action_${value}`)}</span>
              </button>
            ))}
          </div>

          {contextual ? (
            <div className="tg-action-context-target">
              <span>{t('telegram_actions.context_target')}</span>
              <strong title={target}>{target}</strong>
            </div>
          ) : (
            <label className="tg-action-field">
              <span>{t('telegram_actions.target_label')}</span>
              <input
                autoFocus
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={t('telegram_actions.target_placeholder')}
                autoComplete="off"
                spellCheck={false}
              />
              <small>{t('telegram_actions.target_hint')}</small>
            </label>
          )}

          {needsMessage && (
            <label className="tg-action-field">
              <span>
                {action === 'start_bot'
                  ? t('telegram_actions.start_parameter_label')
                  : t('telegram_actions.message_label')}
              </span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  action === 'start_bot'
                    ? t('telegram_actions.start_parameter_placeholder')
                    : t('telegram_actions.message_placeholder')
                }
                rows={3}
              />
            </label>
          )}

          {action === 'stop_bot' && (
            <p className="tg-action-note">{t('telegram_actions.stop_note')}</p>
          )}
          {action === 'leave' && (
            <p className="tg-action-note is-danger">{t('telegram_actions.leave_note')}</p>
          )}
          {error && <p className="tg-action-feedback is-error" role="alert">{error}</p>}
          {success && (
            <p className="tg-action-feedback is-success" role="status">
              <CheckCircle2 size={15} /> {success}
            </p>
          )}
        </div>

        <footer className="tg-action-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !creds || !target.trim() || (action === 'send_message' && !message.trim())}
          >
            <Send size={16} />
            {busy ? t('telegram_actions.working') : actionLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
