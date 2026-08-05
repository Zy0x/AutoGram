import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type MediaSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: MediaSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  onOpen?: () => void;
};

export function MediaSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  className = '',
  compact,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  const [, setMetaTick] = useState(0);
  useEffect(() => {
    const handleUpdate = () => setMetaTick((t) => t + 1);
    window.addEventListener('autogram_session_metadata_updated', handleUpdate);
    return () => window.removeEventListener('autogram_session_metadata_updated', handleUpdate);
  }, []);
  const [activeIndex, setActiveIndex] = useState(0);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] || options[0];

  const enabledIndices = useMemo(
    () => options.map((option, index) => (!option.disabled ? index : -1)).filter((index) => index >= 0),
    [options]
  );

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const wanted = Math.min(320, Math.max(80, options.length * 48 + 12));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < Math.min(220, wanted) && above > below;
    const maxHeight = Math.max(96, Math.min(wanted, upward ? above - gap : below - gap));
    setStyle({
      position: 'fixed',
      left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8)),
      top: upward ? Math.max(8, rect.top - maxHeight - gap) : rect.bottom + gap,
      width: Math.min(Math.max(rect.width, 220), window.innerWidth - 16),
      maxHeight,
      zIndex: 16000,
    });
  };

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      onOpen?.();
    }
    prevOpenRef.current = open;
  }, [open, onOpen]);

  useLayoutEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    place();
    requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(`[data-option-index="${selectedIndex}"]`)
        ?.focus();
    });
  }, [open, selectedIndex, options.length]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (triggerRef.current?.contains(node) || menuRef.current?.contains(node)) return;
      setOpen(false);
    };
    const reposition = () => place();
    document.addEventListener('pointerdown', closeOnOutside, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, options.length]);

  const move = (delta: number) => {
    if (!enabledIndices.length) return;
    const at = enabledIndices.indexOf(activeIndex);
    const next = enabledIndices[(Math.max(0, at) + delta + enabledIndices.length) % enabledIndices.length];
    setActiveIndex(next);
    menuRef.current?.querySelector<HTMLButtonElement>(`[data-option-index="${next}"]`)?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`td-modern-select${compact ? ' compact' : ''}${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="td-modern-select-value">{selected?.label || value}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            className="td-modern-select-menu"
            style={style}
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              } else if (event.key === 'Home' && enabledIndices.length) {
                event.preventDefault();
                const next = enabledIndices[0];
                setActiveIndex(next);
                menuRef.current?.querySelector<HTMLButtonElement>(`[data-option-index="${next}"]`)?.focus();
              } else if (event.key === 'End' && enabledIndices.length) {
                event.preventDefault();
                const next = enabledIndices[enabledIndices.length - 1];
                setActiveIndex(next);
                menuRef.current?.querySelector<HTMLButtonElement>(`[data-option-index="${next}"]`)?.focus();
              }
            }}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                data-option-index={index}
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={`td-modern-select-option${option.value === value ? ' selected' : ''}`}
                onFocus={() => setActiveIndex(index)}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span className="td-modern-select-copy">
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === value && <Check size={15} aria-hidden />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
