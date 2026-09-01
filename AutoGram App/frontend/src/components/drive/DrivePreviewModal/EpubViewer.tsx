import React, { useEffect, useState, useRef } from 'react';
import JSZip from 'jszip';
import { BookOpen, ChevronLeft, ChevronRight, List, Loader2 } from 'lucide-react';

interface Chapter {
  id: string;
  title: string;
  href: string;
  contentHtml: string;
}

interface Props {
  data: ArrayBuffer | Uint8Array | Blob | string;
  fileName: string;
  onOpenSystem?: () => void;
}

export const EpubViewer: React.FC<Props> = ({ data, fileName, onOpenSystem: _onOpenSystem }) => {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState('');
  const [showToc, setShowToc] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const readerStageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function parseEpub() {
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

        // 1. Read META-INF/container.xml
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) throw new Error('Format EPUB tidak valid: META-INF/container.xml tidak ditemukan.');

        const containerXml = await containerFile.async('text');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'application/xml');
        const rootfile = containerDoc.querySelector('rootfile');
        const opfPath = rootfile?.getAttribute('full-path') || 'OEBPS/content.opf';
        const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

        // 2. Read OPF
        const opfFile = zip.file(opfPath);
        if (!opfFile) throw new Error(`Berkas OPF tidak ditemukan di ${opfPath}.`);

        const opfXml = await opfFile.async('text');
        const opfDoc = parser.parseFromString(opfXml, 'application/xml');

        const titleEl = opfDoc.querySelector('title, dc\\:title');
        if (titleEl?.textContent) setBookTitle(titleEl.textContent.trim());

        // Parse manifest
        const manifestMap: Record<string, { href: string; mediaType: string }> = {};
        opfDoc.querySelectorAll('item').forEach((item) => {
          const id = item.getAttribute('id');
          const href = item.getAttribute('href');
          const mediaType = item.getAttribute('media-type') || '';
          if (id && href) {
            manifestMap[id] = { href: opfDir + href, mediaType };
          }
        });

        // Parse spine
        const spineItems: string[] = [];
        opfDoc.querySelectorAll('itemref').forEach((ref) => {
          const idref = ref.getAttribute('idref');
          if (idref && manifestMap[idref]) {
            spineItems.push(manifestMap[idref].href);
          }
        });

        if (spineItems.length === 0) {
          throw new Error('Tidak ditemukan daftar bab dalam buku EPUB ini.');
        }

        // 3. Parse chapter HTMLs
        const parsedChapters: Chapter[] = [];
        for (let i = 0; i < spineItems.length; i++) {
          const chapterPath = spineItems[i];
          const chapterFile = zip.file(chapterPath);
          if (!chapterFile) continue;

          let rawHtml = await chapterFile.async('text');
          const chapterDoc = parser.parseFromString(rawHtml, 'text/html');
          const chapterTitle = chapterDoc.querySelector('h1, h2, h3, title')?.textContent?.trim() || `Bab ${i + 1}`;

          // Clean body HTML
          const bodyHtml = chapterDoc.body ? chapterDoc.body.innerHTML : rawHtml;

          parsedChapters.push({
            id: `ch-${i}`,
            title: chapterTitle,
            href: chapterPath,
            contentHtml: bodyHtml,
          });
        }

        if (!cancelled) {
          setChapters(parsedChapters);
          setCurrentChapterIdx(0);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[EpubViewer] Failed to parse EPUB:', err);
          setError(err?.message || 'Gagal membaca buku digital EPUB.');
          setLoading(false);
        }
      }
    }

    void parseEpub();

    return () => {
      cancelled = true;
    };
  }, [data]);

  const activeChapter = chapters[currentChapterIdx];

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', color: '#94a3b8' }}>
        <Loader2 size={36} className="spin text-cyan-400" />
        <span style={{ fontSize: '13.5px', fontWeight: 500 }}>Membuka buku digital EPUB...</span>
      </div>
    );
  }

  if (error || chapters.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', color: '#f87171', padding: '24px', textAlign: 'center', margin: 'auto', maxWidth: '420px' }}>
        <BookOpen size={40} className="text-cyan-400" />
        <strong style={{ fontSize: '15px', color: '#f8fafc' }}>Gagal Membuka EPUB</strong>
        <p style={{ fontSize: '12.5px', color: '#94a3b8', margin: 0 }}>{error || 'Berkas EPUB tidak valid.'}</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e17', color: '#f8fafc', overflow: 'hidden' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#0e1422', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={17} className="text-cyan-400" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
            {bookTitle || fileName}
          </span>
          <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee', fontWeight: 700 }}>
            {currentChapterIdx + 1} / {chapters.length}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setShowToc((p) => !p)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '6px', background: showToc ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.05)', color: showToc ? '#22d3ee' : '#cbd5e1', border: '1px solid rgba(255, 255, 255, 0.1)', fontSize: '11.5px', cursor: 'pointer', fontWeight: 500 }}
            title="Daftar Isi Bab"
          >
            <List size={13} />
            <span>Daftar Isi</span>
          </button>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px', padding: '2px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.max(12, s - 2))}
              style={{ padding: '2px 6px', background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}
              title="Perkecil Font"
            >
              A-
            </button>
            <span style={{ fontSize: '11px', color: '#94a3b8', padding: '0 4px' }}>{fontSize}px</span>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.min(28, s + 2))}
              style={{ padding: '2px 6px', background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}
              title="Perbesar Font"
            >
              A+
            </button>
          </div>
        </div>
      </div>

      {/* Main Reader Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* TOC Sidebar */}
        {showToc && (
          <div style={{ width: '220px', background: '#0b0f19', borderRight: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px 8px', overflowY: 'auto', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', padding: '0 6px 6px' }}>Daftar Bab:</span>
            {chapters.map((ch, idx) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  setCurrentChapterIdx(idx);
                  setShowToc(false);
                  if (readerStageRef.current) readerStageRef.current.scrollTop = 0;
                }}
                style={{ display: 'block', width: '100%', padding: '6px 10px', borderRadius: '6px', background: currentChapterIdx === idx ? 'rgba(6, 182, 212, 0.15)' : 'transparent', color: currentChapterIdx === idx ? '#22d3ee' : '#cbd5e1', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '12px', fontWeight: currentChapterIdx === idx ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {ch.title}
              </button>
            ))}
          </div>
        )}

        {/* Reader Stage */}
        <div ref={readerStageRef} style={{ flex: 1, overflowY: 'auto', padding: '32px 48px', maxWidth: '820px', margin: '0 auto', width: '100%', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text', fontSize: `${fontSize}px`, lineHeight: '1.7', color: '#e2e8f0' }}>
          <h2 style={{ fontSize: `${fontSize * 1.4}px`, fontWeight: 700, color: '#f8fafc', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '12px', marginBottom: '24px' }}>
            {activeChapter?.title}
          </h2>
          <div
            dangerouslySetInnerHTML={{ __html: activeChapter?.contentHtml || '' }}
            style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
          />
        </div>
      </div>

      {/* Bottom Chapter Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '8px 16px', background: '#0e1422', borderTop: '1px solid rgba(255, 255, 255, 0.08)', flexShrink: 0 }}>
        <button
          type="button"
          disabled={currentChapterIdx === 0}
          onClick={() => {
            setCurrentChapterIdx((p) => Math.max(0, p - 1));
            if (readerStageRef.current) readerStageRef.current.scrollTop = 0;
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 12px', borderRadius: '6px', background: currentChapterIdx === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.08)', color: currentChapterIdx === 0 ? '#475569' : '#f8fafc', border: '1px solid rgba(255, 255, 255, 0.1)', cursor: currentChapterIdx === 0 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}
        >
          <ChevronLeft size={15} />
          <span>Bab Sebelumnya</span>
        </button>

        <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>
          Bab <strong style={{ color: '#f8fafc' }}>{currentChapterIdx + 1}</strong> dari <strong style={{ color: '#f8fafc' }}>{chapters.length}</strong>
        </span>

        <button
          type="button"
          disabled={currentChapterIdx === chapters.length - 1}
          onClick={() => {
            setCurrentChapterIdx((p) => Math.min(chapters.length - 1, p + 1));
            if (readerStageRef.current) readerStageRef.current.scrollTop = 0;
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 12px', borderRadius: '6px', background: currentChapterIdx === chapters.length - 1 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.08)', color: currentChapterIdx === chapters.length - 1 ? '#475569' : '#f8fafc', border: '1px solid rgba(255, 255, 255, 0.1)', cursor: currentChapterIdx === chapters.length - 1 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}
        >
          <span>Bab Selanjutnya</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
};
