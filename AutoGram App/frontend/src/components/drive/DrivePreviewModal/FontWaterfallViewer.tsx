import React, { useState, useEffect } from 'react';
import { Type, Sliders, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  fontSrc: string;
  fileName: string;
}

const WATERFALL_SIZES = [12, 16, 20, 28, 36, 48, 72];
const DEFAULT_TEXT = 'The quick brown fox jumps over the lazy dog. 1234567890 (Aa Bb Cc Dd Ee Ff Gg)';

export const FontWaterfallViewer: React.FC<Props> = ({ fontSrc, fileName }) => {
  const { t } = useTranslation();
  const [sampleText, setSampleText] = useState(DEFAULT_TEXT);
  const [customSize, setCustomSize] = useState(32);
  const [fontFamilyName, setFontFamilyName] = useState('CustomPreviewFont');
  const [activeTab, setActiveTab] = useState<'waterfall' | 'glyphs' | 'tester'>('waterfall');

  useEffect(() => {
    const fontUniqueName = `Font_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setFontFamilyName(fontUniqueName);

    const fontFace = new FontFace(fontUniqueName, `url(${fontSrc})`);
    fontFace
      .load()
      .then((loadedFace) => {
        (document.fonts as any).add(loadedFace);
      })
      .catch((err) => {
        console.warn('FontFace load warning:', err);
      });

    return () => {
      // Cleanup loaded font face if needed
    };
  }, [fontSrc]);

  // Generate ASCII printable glyphs
  const glyphs = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32));

  return (
    <div className="td-font-viewer-wrap">
      <div className="td-font-toolbar">
        <div className="td-font-toolbar-left">
          <Type size={16} className="text-sky-400" />
          <span className="td-font-title font-semibold">
            {t('drive.font_viewer_title', 'Inspektor Tipografi & Font')}
          </span>
          <span className="td-font-filename">({fileName})</span>
        </div>

        <div className="td-font-toolbar-right">
          <div className="td-font-tab-group">
            <button
              type="button"
              className={`td-btn-secondary td-btn-xs ${activeTab === 'waterfall' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('waterfall')}
            >
              Waterfall
            </button>
            <button
              type="button"
              className={`td-btn-secondary td-btn-xs ${activeTab === 'tester' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('tester')}
            >
              Uji Bebas
            </button>
            <button
              type="button"
              className={`td-btn-secondary td-btn-xs ${activeTab === 'glyphs' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('glyphs')}
            >
              Peta Glyph ({glyphs.length})
            </button>
          </div>
        </div>
      </div>

      <div className="td-font-input-bar">
        <input
          type="text"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder={t('drive.font_input_placeholder', 'Ketik teks sampel untuk diuji...')}
          className="td-font-sample-input"
        />
        <button
          type="button"
          className="td-btn-secondary td-btn-xs"
          onClick={() => setSampleText(DEFAULT_TEXT)}
          title="Reset Teks"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="td-font-body">
        {activeTab === 'waterfall' && (
          <div className="td-font-waterfall-list">
            {WATERFALL_SIZES.map((sz) => (
              <div key={sz} className="td-font-waterfall-row">
                <span className="td-font-size-label">{sz}px</span>
                <p
                  className="td-font-waterfall-text"
                  style={{ fontFamily: fontFamilyName, fontSize: `${sz}px`, lineHeight: 1.3 }}
                >
                  {sampleText || DEFAULT_TEXT}
                </p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'tester' && (
          <div className="td-font-tester-view">
            <div className="td-font-size-slider-row">
              <Sliders size={14} className="text-slate-400" />
              <span>Ukuran: {customSize}px</span>
              <input
                type="range"
                min="12"
                max="128"
                value={customSize}
                onChange={(e) => setCustomSize(Number(e.target.value))}
                className="td-font-slider"
              />
            </div>
            <div
              className="td-font-tester-canvas"
              contentEditable
              suppressContentEditableWarning
              style={{ fontFamily: fontFamilyName, fontSize: `${customSize}px` }}
            >
              {sampleText || DEFAULT_TEXT}
            </div>
          </div>
        )}

        {activeTab === 'glyphs' && (
          <div className="td-font-glyphs-grid" style={{ fontFamily: fontFamilyName }}>
            {glyphs.map((g, idx) => (
              <div key={idx} className="td-font-glyph-card" title={`Unicode: U+${g.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`}>
                <span className="td-font-glyph-char">{g}</span>
                <span className="td-font-glyph-code">U+{g.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
