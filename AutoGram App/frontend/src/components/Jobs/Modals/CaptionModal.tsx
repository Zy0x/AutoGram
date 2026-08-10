import i18n from 'i18next';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface CaptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTemplate: string;
  onSave: (template: string) => void;
}

function parseTelegramMarkdown(text: string) {
  if (!text) return '<span style="color: rgba(255,255,255,0.4); font-style: italic;">No caption provided</span>';
  let html = text
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/__(.*?)__/g, '<u>$1</u>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/~(.*?)~/g, '<s>$1</s>')
    .replace(/\|\|(.*?)\|\|/g, '<span style="background: rgba(255,255,255,0.1); color: transparent; border-radius: 4px; cursor: pointer; padding: 0 4px;" title="' + i18n.t('speedtest.spoiler_title') + '">$1</span>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #58a6ff; text-decoration: none;">$1</a>')
    .replace(/`(.*?)`/g, '<code style="color: #f0f6fc; font-family: monospace; background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 4px;">$1</code>')
    .replace(/\n/g, '<br/>');
  return html;
}

export const CaptionModal: React.FC<CaptionModalProps> = ({ isOpen, onClose, initialTemplate, onSave }) => {
  const { t } = useTranslation();
  const [template, setTemplate] = useState(initialTemplate);
  const [viewMode, setViewMode] = useState<'split'|'edit'|'preview'>('split');

  useEffect(() => {
    if (isOpen) {
      setTemplate(initialTemplate);
    }
  }, [isOpen, initialTemplate]);

  if (!isOpen) return null;

  const node = (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px', width: '95%' }}>
        
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-main)' }}>{t('ui.generated.custom_caption_editor_e13e908')}</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('ui.generated.use_telegram_markdownv2_to_format_your_caption_t_5246e51')}</p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px' }}>
               <button onClick={() => setViewMode('edit')} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: viewMode === 'edit' ? 'var(--primary)' : 'transparent', color: viewMode === 'edit' ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}>{t('ui.generated.edit_5301648')}</button>
               <button onClick={() => setViewMode('split')} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: viewMode === 'split' ? 'var(--primary)' : 'transparent', color: viewMode === 'split' ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}>{t('ui.generated.split_fc8230b')}</button>
               <button onClick={() => setViewMode('preview')} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: viewMode === 'preview' ? 'var(--primary)' : 'transparent', color: viewMode === 'preview' ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}>{t('speedtest.tooltip_preview')}</button>
            </div>
            <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: '4px' }}>✕</button>
          </div>
        </div>

        <div className="modal-body" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
            <div><strong style={{color: 'var(--text-main)'}}>{t('ui.generated.bold_70d683b')}</strong></div>
            <div><em style={{color: 'var(--text-main)'}}>{t('ui.generated.italic_c9cce85')}</em></div>
            <div><span style={{textDecoration: 'line-through', color: 'var(--text-main)'}}>{t('ui.generated.strikethrough_45f8c3e')}</span></div>
            <div><span style={{textDecoration: 'underline', color: 'var(--text-main)'}}>{t('ui.generated.underline_d11d897')}</span></div>
            <div><span style={{background: 'rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '2px 4px', borderRadius: '4px'}}>{t('ui.generated.spoiler_eaa54f7')}</span></div>
            <div><code style={{color: 'var(--primary)', fontFamily: 'monospace'}}>{t('ui.generated.inline_code_f3e9996')}</code></div>
            <div><span style={{color: '#58a6ff'}}>{t('ui.generated.link_https_url_com_f40a78d')}</span></div>
            <div style={{ width: '1px', background: 'var(--border)', height: '16px', margin: '0 4px' }} />
            <div title={i18n.t("jobs.original_caption_title")}><code style={{color: '#a78bfa', fontFamily: 'monospace'}}>{t('ui.generated.caption_bf059c0')}</code> {i18n.t("jobs.original_caption_label")}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'split' ? '1fr 1fr' : '1fr', gap: '20px', height: '320px' }}>
            
            {(viewMode === 'split' || viewMode === 'edit') && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{t('ui.generated.editor_c7e9fb2')}</div>
                <textarea
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="input-field"
                  style={{ flex: 1, resize: 'none', fontFamily: 'monospace', padding: '16px', lineHeight: '1.5', fontSize: '0.9rem', border: '1px solid rgba(255,255,255,0.1)' }}
                  placeholder={t('ui.generated.type_your_custom_caption_template_here_example_i_4a1db2f')}
                  spellCheck={false}
                />
              </div>
            )}

            {(viewMode === 'split' || viewMode === 'preview') && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{t('ui.generated.live_preview_a62da90')}</div>
                <div style={{ 
                  flex: 1, 
                  background: 'rgba(0,0,0,0.15)', 
                  border: '1px solid var(--border)', 
                  borderRadius: '12px', 
                  padding: '16px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  {/* Mock Telegram Bubble */}
                  <div style={{ 
                    background: '#2b2d31',
                    borderRadius: '12px 12px 12px 4px', 
                    padding: '8px 12px', 
                    maxWidth: '90%',
                    color: '#e3e5e8',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                    fontSize: '15px',
                    lineHeight: '1.4',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                  }}>
                    <div dangerouslySetInnerHTML={{ __html: parseTelegramMarkdown(template.replace('{caption}', 'This is a sample of the original media caption.')) }} />
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: 'var(--bg-panel-dark)' }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '10px 24px' }}>{t('accounts.cancel')}</button>
          <button onClick={() => { onSave(template); onClose(); }} className="btn-primary" style={{ padding: '10px 24px' }}>{t('ui.generated.save_custom_caption_e677592')}</button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
};
