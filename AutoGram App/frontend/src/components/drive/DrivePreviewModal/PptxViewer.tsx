import React, { useEffect, useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Presentation,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
}

interface SlideParagraph {
  align?: 'left' | 'center' | 'right' | 'justify';
  level?: number;
  isBullet?: boolean;
  runs: TextRun[];
}

interface SlideShape {
  id: string;
  type: 'text' | 'image' | 'table' | 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  paragraphs?: SlideParagraph[];
  imageUrl?: string;
}

interface SlideData {
  index: number;
  slideNumber: number;
  title: string;
  shapes: SlideShape[];
  notes?: string;
  rawText: string;
}

interface Props {
  data: ArrayBuffer | Uint8Array | Blob | string;
  fileName: string;
  onOpenSystem?: () => void;
  zoom?: number;
}

export const PptxViewer: React.FC<Props> = ({ data, fileName: _fileName, onOpenSystem, zoom = 1 }) => {
  const { t } = useTranslation();
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3'>('16:9');
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function parsePptx() {
      setLoading(true);
      setError(null);

      try {
        let buffer: ArrayBuffer;
        if (typeof data === 'string') {
          if (data.startsWith('data:') || data.startsWith('http')) {
            const res = await fetch(data);
            buffer = await res.arrayBuffer();
          } else {
            try {
              const { readFile } = await import('@tauri-apps/plugin-fs');
              const bytes = await readFile(data);
              buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            } catch {
              const res = await fetch(data);
              buffer = await res.arrayBuffer();
            }
          }
        } else if (data instanceof Blob) {
          buffer = await data.arrayBuffer();
        } else if (data instanceof Uint8Array) {
          buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        } else {
          buffer = data;
        }

        if (cancelled) return;

        const zip = await JSZip.loadAsync(buffer);

        let sldWidthEmu = 12192000;
        let sldHeightEmu = 6858000;

        const presXmlFile = zip.file('ppt/presentation.xml');
        if (presXmlFile) {
          const presText = await presXmlFile.async('text');
          const parser = new DOMParser();
          const doc = parser.parseFromString(presText, 'application/xml');
          const sldSz = doc.querySelector('sldSz');
          if (sldSz) {
            const cx = parseInt(sldSz.getAttribute('cx') || '0', 10);
            const cy = parseInt(sldSz.getAttribute('cy') || '0', 10);
            if (cx > 0 && cy > 0) {
              sldWidthEmu = cx;
              sldHeightEmu = cy;
              const ratio = cx / cy;
              setAspectRatio(ratio < 1.5 ? '4:3' : '16:9');
            }
          }
        }

        const slideFiles: string[] = [];
        const presRelsFile = zip.file('ppt/_rels/presentation.xml.rels');
        if (presRelsFile) {
          const relsText = await presRelsFile.async('text');
          const parser = new DOMParser();
          const doc = parser.parseFromString(relsText, 'application/xml');
          const rels = Array.from(doc.querySelectorAll('Relationship'));
          const slideRels = rels
            .filter((r) => r.getAttribute('Type')?.includes('/slide') && !r.getAttribute('Type')?.includes('/slideMaster') && !r.getAttribute('Type')?.includes('/slideLayout'))
            .map((r) => {
              const target = r.getAttribute('Target') || '';
              return target.startsWith('slides/') ? `ppt/${target}` : target.startsWith('ppt/') ? target : `ppt/slides/${target.replace(/^(\.\.\/)+/, '')}`;
            });

          if (slideRels.length > 0) {
            slideFiles.push(...slideRels);
          }
        }

        if (slideFiles.length === 0) {
          const matched = Object.keys(zip.files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k));
          matched.sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
            const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
            return numA - numB;
          });
          slideFiles.push(...matched);
        }

        if (slideFiles.length === 0) {
          throw new Error('Tidak ditemukan slide dalam berkas PowerPoint ini.');
        }

        const parsedSlides: SlideData[] = [];
        const parser = new DOMParser();

        for (let i = 0; i < slideFiles.length; i++) {
          const slidePath = slideFiles[i];
          const slideFile = zip.file(slidePath);
          if (!slideFile) continue;

          const slideXmlStr = await slideFile.async('text');
          const slideDoc = parser.parseFromString(slideXmlStr, 'application/xml');

          const relsPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
          const relsMap: Record<string, string> = {};
          const relsFile = zip.file(relsPath);
          if (relsFile) {
            const relsXmlStr = await relsFile.async('text');
            const relsDoc = parser.parseFromString(relsXmlStr, 'application/xml');
            relsDoc.querySelectorAll('Relationship').forEach((r) => {
              const id = r.getAttribute('Id');
              const target = r.getAttribute('Target');
              if (id && target) {
                relsMap[id] = target.replace(/^(\.\.\/)+/, 'ppt/');
              }
            });
          }

          const shapes: SlideShape[] = [];
          const textChunks: string[] = [];
          let slideTitle = `Slide ${i + 1}`;

          const spElements = Array.from(slideDoc.querySelectorAll('sp, p\\:sp'));
          for (let spIdx = 0; spIdx < spElements.length; spIdx++) {
            const sp = spElements[spIdx];
            const xfrm = sp.querySelector('xfrm, a\\:xfrm');
            let xPct = 5, yPct = 5, wPct = 90, hPct = 20;

            if (xfrm) {
              const off = xfrm.querySelector('off, a\\:off');
              const ext = xfrm.querySelector('ext, a\\:ext');
              if (off && ext) {
                const offX = parseInt(off.getAttribute('x') || '0', 10);
                const offY = parseInt(off.getAttribute('y') || '0', 10);
                const extCx = parseInt(ext.getAttribute('cx') || '0', 10);
                const extCy = parseInt(ext.getAttribute('cy') || '0', 10);

                if (sldWidthEmu > 0 && sldHeightEmu > 0) {
                  xPct = Math.max(0, Math.min(100, (offX / sldWidthEmu) * 100));
                  yPct = Math.max(0, Math.min(100, (offY / sldHeightEmu) * 100));
                  wPct = Math.max(2, Math.min(100, (extCx / sldWidthEmu) * 100));
                  hPct = Math.max(2, Math.min(100, (extCy / sldHeightEmu) * 100));
                }
              }
            }

            const paragraphs: SlideParagraph[] = [];
            const pEls = Array.from(sp.querySelectorAll('p, a\\:p'));
            pEls.forEach((pEl) => {
              const pPr = pEl.querySelector('pPr, a\\:pPr');
              const algn = pPr?.getAttribute('algn');
              const lvl = parseInt(pPr?.getAttribute('lvl') || '0', 10);
              const alignVal = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';

              const runs: TextRun[] = [];
              const rEls = Array.from(pEl.querySelectorAll('r, a\\:r, fld, a\\:fld'));
              rEls.forEach((rEl) => {
                const tEl = rEl.querySelector('t, a\\:t');
                const text = tEl?.textContent || '';
                if (!text) return;

                const rPr = rEl.querySelector('rPr, a\\:rPr');
                const bold = rPr?.getAttribute('b') === '1';
                const italic = rPr?.getAttribute('i') === '1';
                const underline = rPr?.getAttribute('u') === 'sng';
                const szVal = parseInt(rPr?.getAttribute('sz') || '0', 10);
                const fontSize = szVal > 0 ? szVal / 100 : undefined;

                let color: string | undefined;
                const srgbClr = rPr?.querySelector('srgbClr, a\\:srgbClr');
                if (srgbClr) {
                  const val = srgbClr.getAttribute('val');
                  if (val) color = `#${val}`;
                }

                runs.push({
                  text,
                  bold,
                  italic,
                  underline,
                  fontSize,
                  color,
                });
                textChunks.push(text);
              });

              if (runs.length > 0) {
                paragraphs.push({
                  align: alignVal,
                  level: lvl,
                  isBullet: lvl > 0 || !!pPr?.querySelector('buChar, a\\:buChar, buAutoNum, a\\:buAutoNum'),
                  runs,
                });
              }
            });

            if (paragraphs.length > 0) {
              const fullParaText = paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim();
              if (spIdx === 0 && fullParaText && fullParaText.length < 80) {
                slideTitle = fullParaText;
              }

              shapes.push({
                id: `sp-${spIdx}`,
                type: 'text',
                x: xPct,
                y: yPct,
                width: wPct,
                height: hPct,
                paragraphs,
              });
            }
          }

          const picElements = Array.from(slideDoc.querySelectorAll('pic, p\\:pic'));
          for (let picIdx = 0; picIdx < picElements.length; picIdx++) {
            const pic = picElements[picIdx];
            const blip = pic.querySelector('blip, a\\:blip');
            const embedId = blip?.getAttribute('r:embed') || blip?.getAttribute('embed');
            if (!embedId || !relsMap[embedId]) continue;

            const mediaPath = relsMap[embedId];
            const mediaFile = zip.file(mediaPath);
            if (!mediaFile) continue;

            const imgBytes = await mediaFile.async('uint8array');
            const ext = mediaPath.split('.').pop()?.toLowerCase() || 'png';
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : ext === 'gif' ? 'image/gif' : 'image/png';
            const blob = new Blob([imgBytes], { type: mimeType });
            const imageUrl = URL.createObjectURL(blob);

            const xfrm = pic.querySelector('xfrm, a\\:xfrm');
            let xPct = 10, yPct = 10, wPct = 40, hPct = 40;
            if (xfrm) {
              const off = xfrm.querySelector('off, a\\:off');
              const extEl = xfrm.querySelector('ext, a\\:ext');
              if (off && extEl) {
                const offX = parseInt(off.getAttribute('x') || '0', 10);
                const offY = parseInt(off.getAttribute('y') || '0', 10);
                const extCx = parseInt(extEl.getAttribute('cx') || '0', 10);
                const extCy = parseInt(extEl.getAttribute('cy') || '0', 10);
                if (sldWidthEmu > 0 && sldHeightEmu > 0) {
                  xPct = Math.max(0, Math.min(100, (offX / sldWidthEmu) * 100));
                  yPct = Math.max(0, Math.min(100, (offY / sldHeightEmu) * 100));
                  wPct = Math.max(2, Math.min(100, (extCx / sldWidthEmu) * 100));
                  hPct = Math.max(2, Math.min(100, (extCy / sldHeightEmu) * 100));
                }
              }
            }

            shapes.push({
              id: `pic-${picIdx}`,
              type: 'image',
              x: xPct,
              y: yPct,
              width: wPct,
              height: hPct,
              imageUrl,
            });
          }

          let notes: string | undefined;
          const notesPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, 'notesSlides/notesSlide$1');
          const notesFile = zip.file(notesPath);
          if (notesFile) {
            const notesXmlStr = await notesFile.async('text');
            const notesDoc = parser.parseFromString(notesXmlStr, 'application/xml');
            const noteTexts = Array.from(notesDoc.querySelectorAll('t, a\\:t')).map((n) => n.textContent || '');
            if (noteTexts.length > 0) {
              notes = noteTexts.join(' ').trim();
            }
          }

          parsedSlides.push({
            index: i,
            slideNumber: i + 1,
            title: slideTitle,
            shapes,
            notes,
            rawText: textChunks.join('\n'),
          });
        }

        if (!cancelled) {
          setSlides(parsedSlides);
          setCurrentSlideIdx(0);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[PptxViewer] Failed to parse PPTX:', err);
          setError(err?.message || 'Gagal memproses berkas presentasi PowerPoint.');
          setLoading(false);
        }
      }
    }

    void parsePptx();

    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    return () => {
      slides.forEach((s) => {
        s.shapes.forEach((sh) => {
          if (sh.imageUrl) URL.revokeObjectURL(sh.imageUrl);
        });
      });
    };
  }, [slides]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => Math.min(slides.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCurrentSlideIdx(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setCurrentSlideIdx(slides.length - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides.length]);

  const activeSlide = slides[currentSlideIdx];

  const handleCopySlideText = useCallback(() => {
    if (!activeSlide) return;
    void navigator.clipboard.writeText(activeSlide.rawText || activeSlide.title);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  }, [activeSlide]);

  const toggleFullscreen = () => {
    if (!viewerRef.current) return;
    if (!document.fullscreenElement) {
      viewerRef.current.requestFullscreen().catch(() => undefined);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => undefined);
      setIsFullscreen(false);
    }
  };

  if (loading) {
    return (
      <div className="td-pptx-loading" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', color: '#94a3b8' }}>
        <Loader2 size={36} className="spin text-orange-400" />
        <span style={{ fontSize: '13.5px', fontWeight: 500 }}>{t('ui.generated.membaca_slide_presentasi_powerpoint_39b62ef')}</span>
      </div>
    );
  }

  if (error || slides.length === 0) {
    return (
      <div className="td-pptx-error" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', color: '#f87171', padding: '24px', textAlign: 'center', margin: 'auto', maxWidth: '420px' }}>
        <Presentation size={40} className="text-orange-400" />
        <strong style={{ fontSize: '15px', color: '#f8fafc' }}>Gagal Membuka Presentasi PPTX</strong>
        <p style={{ fontSize: '12.5px', color: '#94a3b8', margin: 0 }}>{error || 'Format berkas PPTX tidak valid atau slide kosong.'}</p>
        {onOpenSystem && (
          <button
            type="button"
            onClick={onOpenSystem}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              borderRadius: '8px',
              background: '#ea580c',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12.5px',
            }}
          >
            Buka di Microsoft PowerPoint
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={viewerRef}
      className={`td-pptx-viewer-container ${isFullscreen ? 'is-fullscreen' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#090d16',
        color: '#f8fafc',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#0e1422',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Presentation size={17} className="text-orange-400" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
            {activeSlide?.title || `Slide ${currentSlideIdx + 1}`}
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'rgba(249, 115, 22, 0.15)',
              color: '#fb923c',
              fontWeight: 700,
            }}
          >
            {currentSlideIdx + 1} / {slides.length}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {activeSlide?.notes && (
            <button
              type="button"
              onClick={() => setShowNotes((p) => !p)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                background: showNotes ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                color: showNotes ? '#fb923c' : '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: '11.5px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              title="Catatan Pembicara"
            >
              <MessageSquare size={13} />
              <span>Notes</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopySlideText}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#cbd5e1',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '11.5px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="Salin Teks Slide"
          >
            {copiedText ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copiedText ? 'Tersalin' : 'Salin Teks'}</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '5px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#cbd5e1',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              cursor: 'pointer',
            }}
            title="Layar Penuh (F11)"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            width: '160px',
            background: '#0b0f19',
            borderRight: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '12px 8px',
            overflowY: 'auto',
            flexShrink: 0,
          }}
        >
          {slides.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentSlideIdx(idx)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '6px',
                borderRadius: '6px',
                background: currentSlideIdx === idx ? 'rgba(249, 115, 22, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: `1.5px solid ${currentSlideIdx === idx ? '#f97316' : 'rgba(255, 255, 255, 0.06)'}`,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: aspectRatio === '16:9' ? '16/9' : '4/3',
                  background: '#ffffff',
                  borderRadius: '3px',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div style={{ fontSize: '7px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.title}
                </div>
                <div style={{ fontSize: '5.5px', color: '#64748b', overflow: 'hidden', lineHeight: '1.2' }}>
                  {s.rawText?.slice(0, 70)}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: currentSlideIdx === idx ? '#fb923c' : '#94a3b8' }}>
                  Slide {idx + 1}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            overflow: 'auto',
            background: '#070a12',
            position: 'relative',
          }}
        >
          {activeSlide && (
            <div
              className="td-pptx-slide-canvas"
              style={{
                width: '100%',
                maxWidth: '980px',
                aspectRatio: aspectRatio === '16:9' ? '16/9' : '4/3',
                background: '#ffffff',
                color: '#0f172a',
                borderRadius: '6px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.65)',
                position: 'relative',
                overflow: 'hidden',
                padding: '36px 44px',
                transform: `scale(${zoom})`,
                transformOrigin: 'center center',
                transition: 'transform 0.15s ease',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                cursor: 'text',
              }}
            >
              {activeSlide.shapes.length > 0 ? (
                activeSlide.shapes.map((shape) => {
                  if (shape.type === 'image' && shape.imageUrl) {
                    return (
                      <div
                        key={shape.id}
                        style={{
                          position: 'absolute',
                          left: `${shape.x}%`,
                          top: `${shape.y}%`,
                          width: `${shape.width}%`,
                          height: `${shape.height}%`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          pointerEvents: 'auto',
                        }}
                      >
                        <img
                          src={shape.imageUrl}
                          alt="Slide graphic"
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain',
                            borderRadius: '2px',
                          }}
                        />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={shape.id}
                      style={{
                        position: 'absolute',
                        left: `${shape.x}%`,
                        top: `${shape.y}%`,
                        width: `${shape.width}%`,
                        minHeight: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        pointerEvents: 'auto',
                      }}
                    >
                      {shape.paragraphs?.map((p, pIdx) => (
                        <div
                          key={pIdx}
                          style={{
                            textAlign: p.align || 'left',
                            paddingLeft: p.level ? `${p.level * 16}px` : undefined,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '6px',
                            lineHeight: '1.4',
                          }}
                        >
                          {p.isBullet && (
                            <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: '14px', lineHeight: '1.2' }}>
                              •
                            </span>
                          )}
                          <div style={{ flex: 1 }}>
                            {p.runs.map((r, rIdx) => (
                              <span
                                key={rIdx}
                                style={{
                                  fontWeight: r.bold ? 700 : 400,
                                  fontStyle: r.italic ? 'italic' : 'normal',
                                  textDecoration: r.underline ? 'underline' : 'none',
                                  fontSize: r.fontSize ? `${Math.max(12, r.fontSize * 0.85)}px` : '15px',
                                  color: r.color || '#0f172a',
                                }}
                              >
                                {r.text}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>{activeSlide.title}</h1>
                  <p style={{ fontSize: '15px', color: '#334155', whiteSpace: 'pre-wrap' }}>{activeSlide.rawText}</p>
                </div>
              )}
            </div>
          )}

          {showNotes && activeSlide?.notes && (
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                left: '24px',
                right: '24px',
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(249, 115, 22, 0.3)',
                borderRadius: '8px',
                padding: '12px 16px',
                color: '#f8fafc',
                fontSize: '12.5px',
                lineHeight: '1.5',
                maxHeight: '120px',
                overflowY: 'auto',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
              }}
            >
              <strong style={{ color: '#fb923c', display: 'block', marginBottom: '4px', fontSize: '11.5px', textTransform: 'uppercase' }}>
                Catatan Pembicara:
              </strong>
              {activeSlide.notes}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '8px 16px',
          background: '#0e1422',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          disabled={currentSlideIdx === 0}
          onClick={() => setCurrentSlideIdx((p) => Math.max(0, p - 1))}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '5px 12px',
            borderRadius: '6px',
            background: currentSlideIdx === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.08)',
            color: currentSlideIdx === 0 ? '#475569' : '#f8fafc',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            cursor: currentSlideIdx === 0 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <ChevronLeft size={15} />
          <span>Sebelumnya</span>
        </button>

        <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', minWidth: '100px', textAlign: 'center' }}>
          Slide <strong style={{ color: '#f8fafc' }}>{currentSlideIdx + 1}</strong> dari <strong style={{ color: '#f8fafc' }}>{slides.length}</strong>
        </span>

        <button
          type="button"
          disabled={currentSlideIdx === slides.length - 1}
          onClick={() => setCurrentSlideIdx((p) => Math.min(slides.length - 1, p + 1))}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '5px 12px',
            borderRadius: '6px',
            background: currentSlideIdx === slides.length - 1 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.08)',
            color: currentSlideIdx === slides.length - 1 ? '#475569' : '#f8fafc',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            cursor: currentSlideIdx === slides.length - 1 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <span>Selanjutnya</span>
          <ChevronRight size={15} />
        </button>
      </div>

      <style>{`
        .td-pptx-slide-canvas,
        .td-pptx-slide-canvas * {
          user-select: text !important;
          -webkit-user-select: text !important;
        }
      `}</style>
    </div>
  );
};
