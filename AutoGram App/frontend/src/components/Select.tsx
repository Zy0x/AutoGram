import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function Select({ options, value, onChange, placeholder, disabled }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    // On scroll, reposition or close to prevent floating
    const handleScroll = (e: Event) => {
      const target = e.target as Node;
      if (dropdownRef.current && dropdownRef.current.contains(target)) {
        return; // Don't close if scrolling inside the dropdown itself
      }
      setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  const selectedOption = options.find(o => o.value === value);

  return (
    <div 
      className={`select-container ${disabled ? 'disabled' : ''} ${isOpen ? 'is-open' : ''}`}
      ref={containerRef}
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <div 
        className="input-field" 
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none'
        }}
        onClick={(e) => {
          if (disabled) return;
          e.preventDefault();
          setIsOpen(!isOpen);
        }}
      >
        <span
          style={{
            color: selectedOption ? 'inherit' : 'rgba(255,255,255,0.2)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={selectedOption ? selectedOption.label : (placeholder || 'Select...')}
        >
          {selectedOption ? selectedOption.label : (placeholder || 'Select...')}
        </span>
        <ChevronDown size={18} style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }} />
      </div>
      
      {isOpen && createPortal(
        <div 
          ref={dropdownRef}
          style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: pos.width,
          background: 'rgba(15, 17, 26, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          zIndex: 99999,
          maxHeight: '250px',
          overflowY: 'auto',
          boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
        }}>
          {options.length === 0 ? (
            <div style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>
              {placeholder || 'No options'}
            </div>
          ) : (
            options.map(opt => (
              <div 
                key={opt.value}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  padding: '12px 14px',
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  color: opt.disabled ? 'var(--text-muted)' : (value === opt.value ? 'var(--primary)' : 'var(--text-main)'),
                  background: value === opt.value ? 'rgba(255, 174, 0, 0.1)' : 'transparent',
                  opacity: opt.disabled ? 0.5 : 1,
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => {
                  if (!opt.disabled && value !== opt.value) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={e => {
                  if (!opt.disabled && value !== opt.value) e.currentTarget.style.background = 'transparent';
                }}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
