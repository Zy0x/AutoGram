import { useState, useRef } from 'react';
import { Info } from 'lucide-react';
import { createPortal } from 'react-dom';

export function InfoTooltip({ content }: { content: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, isBelow: false });
  const iconRef = useRef<HTMLDivElement>(null);

  const calculatePosition = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      // If there is less than 200px space above the icon, render tooltip below it
      const isBelow = rect.top < 250;
      
      setPos({ 
        top: isBelow ? rect.bottom + 8 : rect.top - 8, 
        left: rect.left + rect.width / 2,
        isBelow
      });
    }
  };

  return (
    <div 
      ref={iconRef}
      style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '6px', cursor: 'help', color: 'var(--text-muted)' }}
      onMouseEnter={() => { calculatePosition(); setShow(true); }}
      onMouseLeave={() => setShow(false)}
      onClick={() => { calculatePosition(); setShow(!show); }}
    >
      <Info size={14} />
      {show && createPortal(
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          transform: pos.isBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          background: 'rgba(15, 17, 26, 0.95)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid var(--primary)',
          boxShadow: '0 8px 32px rgba(255, 174, 0, 0.2)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '0.8rem',
          fontWeight: 'normal',
          width: 'max-content',
          maxWidth: '350px',
          zIndex: 999999,
          pointerEvents: 'none',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap'
        }}>
          {content.split('\n').map((line, i) => {
            const isListItem = /^\d+\./.test(line.trim());
            return (
              <div 
                key={i} 
                style={{ 
                  paddingLeft: isListItem ? '1.4em' : '0', 
                  textIndent: isListItem ? '-1.4em' : '0',
                  minHeight: line.trim() === '' ? '0.8em' : 'auto'
                }}
              >
                {line}
              </div>
            );
          })}
          <div style={{
            position: 'absolute',
            ...(pos.isBelow ? { top: '-5px' } : { bottom: '-5px' }),
            left: '50%',
            transform: 'translateX(-50%)',
            borderWidth: pos.isBelow ? '0 5px 5px' : '5px 5px 0',
            borderStyle: 'solid',
            borderColor: pos.isBelow 
              ? 'transparent transparent var(--primary) transparent' 
              : 'var(--primary) transparent transparent transparent'
          }}></div>
        </div>,
        document.body
      )}
    </div>
  );
}
