/**
 * Unified, Full-Bleed & Spacious ZIP Workbench (Google Drive style).
 * Interactive search, category filters, multi-select batch extraction, session password cache, and code viewer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  Download,
  ExternalLink,
  File,
  FileText,
  Film,
  Folder,
  Gauge,
  Home,
  Image as ImageIcon,
  Loader2,
  Lock,
  Music,
  RefreshCw,
  Repeat,
  RotateCw,
  Search,
  SquareCheck,
  SquareMinus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { DriveCredentials } from '../../lib/driveApi';
import { driveZipList, driveZipReadEntry, driveZipExtractEntry } from '../../lib/driveApi';
import { formatDriveBytes } from '../../lib/driveTypes';

export type ZipEntry = {
  name: string;
  size: number;
  compressed_size?: number;
  is_dir: boolean;
  method?: number;
};

type Props = {
  creds: DriveCredentials;
  messageId: number;
  folderId: number | null;
  archiveName?: string;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onDownloadZip?: () => void;
  onOpenSystem?: () => void;
};

type Category = 'all' | 'image' | 'doc' | 'media';

function parentPath(path: string): string {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function matchesCategory(name: string, cat: Category): boolean {
  if (cat === 'all') return true;
  const n = name.toLowerCase();
  if (cat === 'image') return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(n);
  if (cat === 'doc') return /\.(txt|md|json|csv|log|xml|ya?ml|html?|css|js|ts|tsx|jsx|py|rs|sql|ini|toml|sh|bat|c|cpp|h|hpp|java|kt|go|php|pdf)$/i.test(n);
  if (cat === 'media') return /\.(mp4|webm|mp3|ogg|wav|mkv|avi|flac|aac)$/i.test(n);
  return true;
}

function basenamesAt(entries: ZipEntry[], cwd: string, query: string, category: Category): {
  folders: { name: string; path: string }[];
  files: ZipEntry[];
} {
  const cleanQ = query.trim().toLowerCase();

  // Flatten search when query is active
  if (cleanQ) {
    const files: ZipEntry[] = [];
    for (const e of entries) {
      if (e.is_dir) continue;
      const full = (e.name || '').replace(/\\/g, '/');
      if (matchesCategory(full, category) && full.toLowerCase().includes(cleanQ)) {
        files.push({ ...e, name: full });
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { folders: [], files };
  }

  const prefix = cwd ? `${cwd.replace(/\/+$/, '')}/` : '';
  const folderSet = new Map<string, string>();
  const files: ZipEntry[] = [];

  for (const e of entries) {
    const full = (e.name || '').replace(/\\/g, '/');
    if (prefix && !full.startsWith(prefix)) continue;
    const rest = prefix ? full.slice(prefix.length) : full;
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const seg = rest.slice(0, slash);
      if (seg) folderSet.set(seg, joinPath(cwd, seg));
    } else if (e.is_dir) {
      const seg = rest.replace(/\/+$/, '');
      if (seg) folderSet.set(seg, joinPath(cwd, seg));
    } else if (matchesCategory(full, category)) {
      files.push({ ...e, name: full });
    }
  }

  const folders = [...folderSet.entries()]
    .map(([name, path]) => ({ name, path }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  files.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  return { folders, files };
}

function entryLabel(full: string, cwd: string): string {
  const prefix = cwd ? `${cwd.replace(/\/+$/, '')}/` : '';
  const rest = prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full;
  return rest.replace(/\/+$/, '') || full;
}

function iconForFile(name: string) {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return ImageIcon;
  if (/\.(mp4|webm|mkv|avi)$/i.test(n)) return Film;
  if (/\.(mp3|ogg|wav|flac)$/i.test(n)) return Music;
  if (/\.(txt|md|json|csv|log|xml|ya?ml|html?|css|js|ts|tsx|jsx|py|rs|sql)$/i.test(n)) return FileText;
  return File;
}

function DriveZipCodeViewer({ text, name }: { text: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => text.split('\n'), [text]);
  const ext = useMemo(() => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toUpperCase() : 'TXT';
  }, [name]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="drive-zip-code-box">
      <div className="drive-zip-code-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="drive-zip-code-tag">{ext}</span>
          <span>{lines.length} baris · {formatDriveBytes(text.length)}</span>
        </div>
        <button
          type="button"
          className="drive-zip-code-copy-btn"
          onClick={() => void handleCopyCode()}
          title="Salin isi teks ke clipboard"
        >
          {copied ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
          <span>{copied ? 'Tersalin!' : 'Salin Kode'}</span>
        </button>
      </div>
      <div className="drive-zip-code-body">
        <div className="drive-zip-line-nums" aria-hidden="true">
          {lines.map((_, i) => (
            <span key={i + 1}>{i + 1}</span>
          ))}
        </div>
        <pre className="drive-zip-code-pre">{text || '(Berkas teks kosong)'}</pre>
      </div>
    </div>
  );
}

// Password memory cache across component instances
const rememberedPasswordsMap = new Map<string, string>();

export function DriveZipBrowser({
  creds,
  messageId,
  folderId,
  archiveName,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onDownloadZip,
  onOpenSystem,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [meta, setMeta] = useState<{
    archive_size?: number;
    total_uncompressed?: number;
    source?: string;
    truncated?: boolean;
    needs_full_for_extract?: boolean;
  }>({});
  const [cwd, setCwd] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [opening, setOpening] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{
    entry: string;
    kind: string;
    text?: string;
    dataUrl?: string;
    mime?: string;
    size?: number;
    message?: string;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [rememberPass, setRememberPass] = useState(true);

  // Video playback & transform state
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rotate, setRotate] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const toggleRate = () => {
    const RATES = [1, 1.25, 1.5, 2, 0.5];
    const idx = RATES.indexOf(rate);
    const nextRate = RATES[(idx + 1) % RATES.length];
    setRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  }, [rate, preview]);

  const archiveKey = useMemo(() => `${messageId}:${archiveName || 'zip'}`, [messageId, archiveName]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setToastMsg(null);
    setSelectedEntries(new Set());
    try {
      const res = await driveZipList(creds, messageId, folderId);
      if (res?.status && res.status !== 'success') {
        throw new Error(res.message || res.error || 'Gagal membuka ZIP');
      }
      const list = (res?.entries || []) as ZipEntry[];
      setEntries(list);
      setMeta({
        archive_size: res?.archive_size,
        total_uncompressed: res?.total_uncompressed,
        source: res?.source,
        truncated: res?.truncated,
        needs_full_for_extract: res?.needs_full_for_extract,
      });
      setCwd('');
    } catch (e: any) {
      setError(String(e?.message || e || 'Gagal membaca arsip ZIP'));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [creds, messageId, folderId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const { folders, files } = useMemo(
    () => basenamesAt(entries, cwd, searchQuery, category),
    [entries, cwd, searchQuery, category]
  );

  const categoryCounts = useMemo(() => {
    let images = 0, docs = 0, media = 0;
    for (const e of entries) {
      if (e.is_dir) continue;
      if (matchesCategory(e.name, 'image')) images++;
      if (matchesCategory(e.name, 'doc')) docs++;
      if (matchesCategory(e.name, 'media')) media++;
    }
    return { all: entries.filter((e) => !e.is_dir).length, images, docs, media };
  }, [entries]);

  const compRatio = useMemo(() => {
    if (meta.archive_size && meta.total_uncompressed && meta.total_uncompressed > meta.archive_size) {
      return Math.round((1 - meta.archive_size / meta.total_uncompressed) * 100);
    }
    return null;
  }, [meta]);

  const crumbs = useMemo(() => {
    if (!cwd) return [] as string[];
    return cwd.split('/').filter(Boolean);
  }, [cwd]);

  const openEntry = async (fullPath: string, passInput?: string) => {
    setOpening(fullPath);
    setError(null);
    setPreview(null);
    setToastMsg(null);

    // Check remembered password cache if no explicit input given
    const effectivePass = passInput || rememberedPasswordsMap.get(archiveKey) || password;

    try {
      const res = await driveZipReadEntry(creds, messageId, folderId, fullPath, effectivePass);
      if (res?.status === 'encrypted' || res?.status === 'bad_password') {
        // Clear invalid remembered password
        if (res?.status === 'bad_password') {
          rememberedPasswordsMap.delete(archiveKey);
        }
        setPreview({
          entry: fullPath,
          kind: 'encrypted',
          message: res.message || 'File ZIP dienkripsi. Masukkan password.',
        });
        return;
      }
      if (res?.status === 'too_large') {
        setPreview({
          entry: fullPath,
          kind: 'meta',
          size: res.size,
          message:
            res.message ||
            `File terlalu besar (${formatDriveBytes(res.size || 0)}) untuk pratinjau.`,
        });
        return;
      }
      if (res?.status && res.status !== 'success') {
        throw new Error(res.message || res.error || 'Gagal membuka isi ZIP');
      }

      // Save password to session cache if rememberPass enabled
      if (effectivePass && rememberPass) {
        rememberedPasswordsMap.set(archiveKey, effectivePass);
      }

      setPreview({
        entry: fullPath,
        kind: res.kind || 'meta',
        text: res.text,
        dataUrl: res.data_url,
        mime: res.mime,
        size: res.size,
        message: res.message,
      });
    } catch (e: any) {
      setError(String(e?.message || e || 'Gagal membuka entri'));
    } finally {
      setOpening(null);
    }
  };

  const handleExtractSingle = async (entryName: string) => {
    setExtracting(entryName);
    setToastMsg(null);
    const passToUse = password || rememberedPasswordsMap.get(archiveKey);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const basename = entryName.split('/').pop() || entryName;
      const targetPath = await save({ defaultPath: basename });
      if (!targetPath) return;

      const res = await driveZipExtractEntry(
        creds,
        messageId,
        folderId,
        entryName,
        targetPath,
        passToUse
      );
      if (res?.status === 'success') {
        setToastMsg(`Berhasil mengestrak ${basename} (${formatDriveBytes(res.bytesWritten)})`);
      }
    } catch (e: any) {
      setError(`Gagal mengestrak file: ${String(e?.message || e)}`);
    } finally {
      setExtracting(null);
    }
  };



  const handleBatchExtract = async () => {
    if (selectedEntries.size === 0) return;
    const selectedList = [...selectedEntries];
    setExtracting('batch');
    setToastMsg(null);
    const passToUse = password || rememberedPasswordsMap.get(archiveKey);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const targetDir = await open({ directory: true, multiple: false });
      if (!targetDir || typeof targetDir !== 'string') return;

      let extractedCount = 0;
      let totalBytes = 0;

      for (let i = 0; i < selectedList.length; i++) {
        const entryName = selectedList[i];
        const basename = entryName.split('/').pop() || entryName;
        const destPath = `${targetDir.replace(/[/\\]+$/, '')}/${basename}`;
        setToastMsg(`Mengekstrak berkas ${i + 1}/${selectedList.length}: ${basename}…`);

        const res = await driveZipExtractEntry(
          creds,
          messageId,
          folderId,
          entryName,
          destPath,
          passToUse
        );
        if (res?.status === 'success') {
          extractedCount++;
          totalBytes += res.bytesWritten;
        }
      }

      setToastMsg(`Berhasil mengekstrak ${extractedCount} berkas (${formatDriveBytes(totalBytes)}) ke ${targetDir}`);
      setSelectedEntries(new Set());
    } catch (e: any) {
      setError(`Gagal mengekstrak massal: ${String(e?.message || e)}`);
    } finally {
      setExtracting(null);
    }
  };

  const toggleSelectEntry = (entryName: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryName)) next.delete(entryName);
      else next.add(entryName);
      return next;
    });
  };

  const selectAllFiles = () => {
    const allFileNames = files.map((f) => f.name);
    setSelectedEntries(new Set(allFileNames));
  };

  const clearSelection = () => {
    setSelectedEntries(new Set());
  };

  if (loading) {
    return (
      <div className="drive-zip-browser is-loading">
        <Loader2 size={32} className="spin" style={{ color: '#ffae00' }} />
        <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Memuat & membaca indeks ZIP via Grammers…</p>
        <span className="drive-zip-hint">
          Indeks arsip dibaca secara native oleh Rust Engine — aman untuk file besar.
        </span>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="drive-zip-browser is-error">
        <Archive size={40} style={{ color: '#ef4444' }} />
        <p style={{ fontWeight: 600 }}>{error}</p>
        <button type="button" className="td-btn-primary" onClick={() => void loadList()}>
          <RefreshCw size={14} /> Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div className="drive-zip-browser">
      <header className="drive-zip-head">
        <div className="drive-zip-title">
          <div className="drive-zip-title-icon">
            <Archive size={20} />
          </div>
          <div>
            <strong title={archiveName}>{archiveName || 'Arsip ZIP'}</strong>
            <span>
              {entries.length} item
              {meta.archive_size != null ? ` · ${formatDriveBytes(meta.archive_size)}` : ''}
              {compRatio != null ? ` · hemat ${compRatio}%` : ''}
              {meta.source === 'central_dir' ? ' · indeks ringan' : ''}
              {meta.truncated ? ' · dipotong' : ''}
            </span>
          </div>
        </div>

        <div className="drive-zip-head-actions">
          {(onPrev || onNext) && (
            <div className="drive-zip-head-group">
              <button
                type="button"
                className="td-icon-btn"
                disabled={!hasPrev}
                onClick={onPrev}
                title="File sebelumnya (Panah Kiri)"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                className="td-icon-btn"
                disabled={!hasNext}
                onClick={onNext}
                title="File selanjutnya (Panah Kanan)"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <button
            type="button"
            className="td-icon-btn"
            title="Muat ulang daftar"
            onClick={() => void loadList()}
          >
            <RefreshCw size={16} />
          </button>
          {onOpenSystem && (
            <button
              type="button"
              className="td-icon-btn"
              title="Buka di aplikasi sistem Windows"
              onClick={onOpenSystem}
            >
              <ExternalLink size={16} />
            </button>
          )}
          {onDownloadZip && (
            <button
              type="button"
              className="td-icon-btn"
              title="Download seluruh arsip ZIP"
              onClick={onDownloadZip}
            >
              <Download size={16} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="td-icon-btn drive-zip-close-btn"
              title="Tutup (Esc)"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="drive-zip-toolbar">
        <div className="drive-zip-search-box">
          <Search size={15} style={{ color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Cari berkas dalam ZIP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="drive-zip-search-clear"
              title="Hapus pencarian"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="drive-zip-cat-tabs">
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'all' ? ' active' : ''}`}
            onClick={() => setCategory('all')}
          >
            <Archive size={13} /> Semua <span className="drive-zip-cat-badge">{categoryCounts.all}</span>
          </button>
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'image' ? ' active' : ''}`}
            onClick={() => setCategory('image')}
          >
            <ImageIcon size={13} /> Gambar{' '}
            <span className="drive-zip-cat-badge">{categoryCounts.images}</span>
          </button>
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'doc' ? ' active' : ''}`}
            onClick={() => setCategory('doc')}
          >
            <Code size={13} /> Dokumen & Kode{' '}
            <span className="drive-zip-cat-badge">{categoryCounts.docs}</span>
          </button>
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'media' ? ' active' : ''}`}
            onClick={() => setCategory('media')}
          >
            <Film size={13} /> Video{' '}
            <span className="drive-zip-cat-badge">{categoryCounts.media}</span>
          </button>
        </div>
      </div>

      {!searchQuery && (
        <nav className="drive-zip-crumbs" aria-label="Path dalam ZIP">
          <button
            type="button"
            className={!cwd ? 'active' : ''}
            onClick={() => {
              setCwd('');
              setPreview(null);
            }}
          >
            <Home size={13} /> Root
          </button>
          {crumbs.map((seg, i) => {
            const path = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={path} className="drive-zip-crumb-seg">
                <ChevronRight size={12} aria-hidden />
                <button
                  type="button"
                  className={path === cwd ? 'active' : ''}
                  onClick={() => {
                    setCwd(path);
                    setPreview(null);
                  }}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>
      )}

      {(files.length > 0 || preview?.kind === 'video') && (
        <div className="drive-zip-batch-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {files.length > 0 && (
              <>
                <button
                  type="button"
                  className="drive-zip-batch-btn"
                  onClick={selectedEntries.size === files.length ? clearSelection : selectAllFiles}
                >
                  {selectedEntries.size === files.length ? <SquareMinus size={13} /> : <SquareCheck size={13} />}
                  {selectedEntries.size === files.length ? 'Batal Pilih' : 'Pilih Semua'}
                </button>
                {selectedEntries.size > 0 && (
                  <span style={{ fontSize: '0.75rem', color: '#ffae00', fontWeight: 600 }}>
                    {selectedEntries.size} terpilih
                  </span>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {preview?.kind === 'video' && (
              <div className="drive-zip-media-tools">
                <button
                  type="button"
                  className={`drive-zip-tool-btn${rate !== 1 ? ' active' : ''}`}
                  title={`Kecepatan Putar: ${rate}x (klik untuk ubah)`}
                  onClick={toggleRate}
                >
                  <Gauge size={13} /> {rate}x
                </button>
                <button
                  type="button"
                  className={`drive-zip-tool-btn${muted ? ' active' : ''}`}
                  title={muted ? 'Nyalakan Suara' : 'Bisukan Suara'}
                  onClick={() => setMuted((v) => !v)}
                >
                  {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <button
                  type="button"
                  className={`drive-zip-tool-btn${loop ? ' active' : ''}`}
                  title={loop ? 'Loop Aktif (klik untuk matikan)' : 'Matikan Loop'}
                  onClick={() => setLoop((v) => !v)}
                >
                  <Repeat size={13} />
                </button>
                <button
                  type="button"
                  className={`drive-zip-tool-btn${rotate ? ' active' : ''}`}
                  title="Putar Video 90° Kanan"
                  onClick={() => setRotate((r) => (r + 90) % 360)}
                >
                  <RotateCw size={13} />
                </button>
              </div>
            )}

            {selectedEntries.size > 0 ? (
              <button
                type="button"
                className="drive-zip-btn-extract"
                disabled={extracting === 'batch'}
                onClick={() => void handleBatchExtract()}
              >
                {extracting === 'batch' ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                Ekstrak ({selectedEntries.size}) Terpilih
              </button>
            ) : preview && preview.kind !== 'encrypted' ? (
              <button
                type="button"
                className="drive-zip-btn-extract"
                disabled={extracting === preview.entry}
                onClick={() => void handleExtractSingle(preview.entry)}
              >
                {extracting === preview.entry ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Download size={13} />
                )}
                Ekstrak File Ini
              </button>
            ) : null}
          </div>
        </div>
      )}

      {error && <p className="drive-zip-inline-err">{error}</p>}
      {toastMsg && (
        <div className="drive-zip-toast">
          <Check size={16} /> <span>{toastMsg}</span>
        </div>
      )}

      <div className="drive-zip-split">
        <ul className="drive-zip-list" role="list">
          {cwd && !searchQuery ? (
            <li>
              <button
                type="button"
                className="drive-zip-row is-folder"
                onClick={() => {
                  setCwd(parentPath(cwd));
                  setPreview(null);
                }}
              >
                <Folder size={16} />
                <span className="drive-zip-name">..</span>
                <span className="drive-zip-size muted">folder</span>
              </button>
            </li>
          ) : null}
          {folders.map((f) => (
            <li key={`d:${f.path}`}>
              <button
                type="button"
                className="drive-zip-row is-folder"
                onClick={() => {
                  setCwd(f.path);
                  setPreview(null);
                }}
              >
                <Folder size={16} />
                <span className="drive-zip-name" title={f.name}>
                  {f.name}
                </span>
                <span className="drive-zip-size muted">folder</span>
              </button>
            </li>
          ))}
          {files.map((f) => {
            const Icon = iconForFile(f.name);
            const label = searchQuery ? f.name : entryLabel(f.name, cwd);
            const busy = opening === f.name;
            const isSelected = selectedEntries.has(f.name);
            return (
              <li key={`f:${f.name}`}>
                <div className={`drive-zip-row-wrapper${preview?.entry === f.name ? ' is-active' : ''}`}>
                  <input
                    type="checkbox"
                    className="drive-zip-check"
                    checked={isSelected}
                    onChange={(e) => toggleSelectEntry(f.name, e)}
                  />
                  <button
                    type="button"
                    className="drive-zip-row is-file"
                    disabled={!!opening}
                    onClick={() => void openEntry(f.name)}
                  >
                    {busy ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
                    <span className="drive-zip-name" title={f.name}>
                      {label}
                    </span>
                    <span className="drive-zip-size">{formatDriveBytes(f.size || 0)}</span>
                  </button>
                </div>
              </li>
            );
          })}
          {folders.length === 0 && files.length === 0 && (
            <li className="drive-zip-empty">
              {searchQuery ? 'Tidak ada berkas yang cocok dengan pencarian' : 'Folder kosong dalam arsip'}
            </li>
          )}
        </ul>

        <div className="drive-zip-preview-pane">
          {!preview && (
            <div className="drive-zip-preview-empty">
              <Archive size={40} style={{ color: '#475569', marginBottom: 8 }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#94a3b8' }}>Pilih file di dalam ZIP untuk pratinjau.</p>
              <span className="drive-zip-hint">
                Hanya file yang dipilih yang di-extract (bukan seluruh arsip).
                {meta.needs_full_for_extract
                  ? ' Entri besar mungkin mengunduh arsip sekali ke cache.'
                  : ''}
              </span>
            </div>
          )}

          {preview?.kind === 'text' && preview.text != null && (
            <DriveZipCodeViewer text={preview.text} name={preview.entry} />
          )}
          {preview?.kind === 'image' && preview.dataUrl && (
            <div className="drive-zip-media-container">
              <img src={preview.dataUrl} alt={preview.entry} className="drive-zip-img" />
            </div>
          )}
          {preview?.kind === 'video' && preview.dataUrl && (
            <div className="drive-zip-media-container">
              <video
                ref={videoRef}
                src={preview.dataUrl}
                controls
                loop={loop}
                muted={muted}
                className="drive-zip-img"
                style={{
                  transform: rotate ? `rotate(${rotate}deg)` : undefined,
                }}
              />
            </div>
          )}
          {preview?.kind === 'audio' && preview.dataUrl && (
            <div className="drive-zip-preview-empty">
              <audio src={preview.dataUrl} controls style={{ width: '100%', maxWidth: 400 }} />
              <p title={preview.entry} style={{ marginTop: 12 }}>{entryLabel(preview.entry, cwd)}</p>
            </div>
          )}
          {(preview?.kind === 'binary' || preview?.kind === 'meta') && (
            <div className="drive-zip-preview-empty">
              <File size={36} style={{ color: '#94a3b8' }} />
              <p title={preview.entry} style={{ fontWeight: 600, color: '#f8fafc' }}>{entryLabel(preview.entry, cwd)}</p>
              {preview.size != null && <span style={{ color: '#ffae00', fontWeight: 600 }}>{formatDriveBytes(preview.size)}</span>}
              <span className="drive-zip-hint">{preview.message || preview.mime || 'Binary'}</span>
            </div>
          )}
          {preview?.kind === 'encrypted' && (
            <div className="drive-zip-preview-empty">
              <Lock size={36} style={{ color: '#ef4444' }} />
              <p title={preview.entry} style={{ fontWeight: 600 }}>{entryLabel(preview.entry, cwd)}</p>
              <span className="drive-zip-hint" style={{ color: '#fca5a5' }}>{preview.message}</span>
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="password"
                    className="td-input"
                    placeholder="Password ZIP..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && password) {
                        void openEntry(preview.entry, password);
                      }
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="td-btn-primary"
                    disabled={!password || !!opening}
                    onClick={() => void openEntry(preview.entry, password)}
                  >
                    Buka
                  </button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#94a3b8', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={rememberPass}
                    onChange={(e) => setRememberPass(e.target.checked)}
                  />
                  <span>Ingat password untuk sesi ini</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
