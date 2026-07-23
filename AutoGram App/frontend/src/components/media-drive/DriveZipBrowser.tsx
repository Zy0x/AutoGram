/**
 * Advanced ZIP browser (Google Drive style).
 * Interactive search, category filters, code viewer with line numbers, and single-file native extraction.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  ChevronRight,
  Code,
  Download,
  File,
  FileText,
  Film,
  Folder,
  Home,
  Image as ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  Search,
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
  const lines = useMemo(() => text.split('\n'), [text]);
  const ext = useMemo(() => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toUpperCase() : 'TXT';
  }, [name]);

  return (
    <div className="drive-zip-code-box">
      <div className="drive-zip-code-head">
        <span className="drive-zip-code-tag">{ext}</span>
        <span>{lines.length} baris · {formatDriveBytes(text.length)}</span>
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

export function DriveZipBrowser({ creds, messageId, folderId, archiveName }: Props) {
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

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setToastMsg(null);
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

  const crumbs = useMemo(() => {
    if (!cwd) return [] as string[];
    return cwd.split('/').filter(Boolean);
  }, [cwd]);

  const openEntry = async (fullPath: string, pass?: string) => {
    setOpening(fullPath);
    setError(null);
    setPreview(null);
    setToastMsg(null);
    try {
      const res = await driveZipReadEntry(creds, messageId, folderId, fullPath, pass);
      if (res?.status === 'encrypted' || res?.status === 'bad_password') {
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
        password
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

  if (loading) {
    return (
      <div className="drive-zip-browser is-loading">
        <Loader2 size={28} className="spin" />
        <p>Memuat & membaca indeks ZIP via Grammers…</p>
        <span className="drive-zip-hint">
          Indeks arsip dibaca secara native oleh Rust Engine — aman untuk file besar.
        </span>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="drive-zip-browser is-error">
        <Archive size={36} className="td-type-ico archive" />
        <p>{error}</p>
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
          <Archive size={18} />
          <div>
            <strong title={archiveName}>{archiveName || 'Arsip ZIP'}</strong>
            <span>
              {entries.length} item
              {meta.archive_size != null ? ` · ${formatDriveBytes(meta.archive_size)}` : ''}
              {meta.source === 'central_dir' ? ' · indeks ringan' : ''}
              {meta.truncated ? ' · dipotong' : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="td-icon-btn"
          title="Muat ulang daftar"
          onClick={() => void loadList()}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="drive-zip-toolbar">
        <div className="drive-zip-search-box">
          <Search size={14} />
          <input
            type="text"
            placeholder="Cari berkas dalam ZIP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="drive-zip-cat-tabs">
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'all' ? ' active' : ''}`}
            onClick={() => setCategory('all')}
          >
            Semua <span className="drive-zip-cat-badge">{categoryCounts.all}</span>
          </button>
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'image' ? ' active' : ''}`}
            onClick={() => setCategory('image')}
          >
            <ImageIcon size={12} /> Gambar{' '}
            <span className="drive-zip-cat-badge">{categoryCounts.images}</span>
          </button>
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'doc' ? ' active' : ''}`}
            onClick={() => setCategory('doc')}
          >
            <Code size={12} /> Dokumen & Kode{' '}
            <span className="drive-zip-cat-badge">{categoryCounts.docs}</span>
          </button>
          <button
            type="button"
            className={`drive-zip-cat-tab${category === 'media' ? ' active' : ''}`}
            onClick={() => setCategory('media')}
          >
            <Film size={12} /> Media{' '}
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
            return (
              <li key={`f:${f.name}`}>
                <button
                  type="button"
                  className={`drive-zip-row is-file${preview?.entry === f.name ? ' is-active' : ''}`}
                  disabled={!!opening}
                  onClick={() => void openEntry(f.name)}
                >
                  {busy ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
                  <span className="drive-zip-name" title={f.name}>
                    {label}
                  </span>
                  <span className="drive-zip-size">{formatDriveBytes(f.size || 0)}</span>
                </button>
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
              <p>Pilih file di dalam ZIP untuk pratinjau.</p>
              <span className="drive-zip-hint">
                Hanya file yang dipilih yang di-extract (bukan seluruh arsip).
                {meta.needs_full_for_extract
                  ? ' Entri besar mungkin mengunduh arsip sekali ke cache.'
                  : ''}
              </span>
            </div>
          )}
          {preview && preview.kind !== 'encrypted' && (
            <div className="drive-zip-extract-bar">
              <div className="drive-zip-extract-info">
                <File size={16} />
                <span title={preview.entry}>{entryLabel(preview.entry, cwd)}</span>
                {preview.size != null && <span style={{ opacity: 0.7 }}>({formatDriveBytes(preview.size)})</span>}
              </div>
              <button
                type="button"
                className="td-btn-primary"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                disabled={extracting === preview.entry}
                onClick={() => void handleExtractSingle(preview.entry)}
              >
                {extracting === preview.entry ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Download size={14} />
                )}
                Ekstrak File Ini
              </button>
            </div>
          )}
          {preview?.kind === 'text' && preview.text != null && (
            <DriveZipCodeViewer text={preview.text} name={preview.entry} />
          )}
          {preview?.kind === 'image' && preview.dataUrl && (
            <img src={preview.dataUrl} alt={preview.entry} className="drive-zip-img" />
          )}
          {preview?.kind === 'video' && preview.dataUrl && (
            <video src={preview.dataUrl} controls autoPlay className="drive-zip-img" />
          )}
          {preview?.kind === 'audio' && preview.dataUrl && (
            <div className="drive-zip-preview-empty">
              <audio src={preview.dataUrl} controls autoPlay style={{ width: '100%', maxWidth: 400 }} />
              <p title={preview.entry} style={{ marginTop: 12 }}>{entryLabel(preview.entry, cwd)}</p>
            </div>
          )}
          {(preview?.kind === 'binary' || preview?.kind === 'meta') && (
            <div className="drive-zip-preview-empty">
              <File size={32} />
              <p title={preview.entry}>{entryLabel(preview.entry, cwd)}</p>
              {preview.size != null && <span>{formatDriveBytes(preview.size)}</span>}
              <span className="drive-zip-hint">{preview.message || preview.mime || 'Binary'}</span>
            </div>
          )}
          {preview?.kind === 'encrypted' && (
            <div className="drive-zip-preview-empty">
              <Archive size={32} />
              <p title={preview.entry}>{entryLabel(preview.entry, cwd)}</p>
              <span className="drive-zip-hint" style={{ color: 'var(--red-4)' }}>{preview.message}</span>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
