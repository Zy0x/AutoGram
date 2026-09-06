import { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSessionDisplayName, getSessionMetadata, type SessionOption } from '../../lib/telegram';

export interface CustomAccountSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SessionOption[];
  placeholder?: string;
  onOpenChange?: (open: boolean) => void;
}

export function CustomAccountSelect({ value, onChange, options, placeholder, onOpenChange }: CustomAccountSelectProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        toggleOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [onOpenChange]);

  const selectedOption = options.find((opt) => opt.name === value);
  const selectedLabel = selectedOption
    ? selectedOption.label || getSessionDisplayName(selectedOption.name)
    : placeholder || 'Pilih Akun...';

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%', zIndex: isOpen ? 1000 : 1 }}>
      {/* TRIGGER BUTTON */}
      <button
        type="button"
        className={`custom-account-select-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={() => toggleOpen(!isOpen)}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selectedLabel}
        </span>
        <ChevronDown
          size={16}
          color="#38bdf8"
          className="chevron-icon"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            flexShrink: 0,
            marginLeft: '8px',
          }}
        />
      </button>

      {/* DROPDOWN MENU */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#0b1520',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '12px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7), 0 0 16px rgba(56, 189, 248, 0.15)',
            maxHeight: '240px',
            overflowY: 'auto',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {options.map((sess) => {
            const displayName = sess.label || getSessionDisplayName(sess.name);
            const isSelected = sess.name === value;
            const meta = getSessionMetadata(sess.name);
            const hasValidUser = Boolean(meta?.telegramUserId || (meta?.userFullName && !sess.name.startsWith('Lavender')));
            const isInactive = !hasValidUser || sess.status === 'expired' || sess.status === 'error';
            const displayId = meta?.telegramUserId
              ? String(meta.telegramUserId)
              : hasValidUser
              ? sess.name.replace(/^session_/, '')
              : null;
            const subtitleText = displayId
              ? `ID Telegram: ${displayId}`
              : `ID Telegram: ${t('settings.session_unauthenticated')}`;

            return (
              <div
                key={sess.name}
                className={`custom-account-select-option ${isSelected ? 'is-selected' : ''}`}
                onClick={() => {
                  onChange(sess.name);
                  toggleOpen(false);
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.84rem', fontWeight: 600, color: isSelected ? '#38bdf8' : '#f8fafc' }}>
                      {displayName}
                    </span>
                    {isInactive && (
                      <span
                        style={{
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: '5px',
                          background: 'rgba(245, 158, 11, 0.14)',
                          border: '1px solid rgba(245, 158, 11, 0.35)',
                          color: '#f59e0b',
                          whiteSpace: 'nowrap',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {t('settings.badge_session_inactive')}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: isInactive ? '#78889b' : '#94a3b8' }}>
                    {subtitleText}
                  </span>
                </div>
                {isSelected && <Check size={16} color="#38bdf8" style={{ flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

