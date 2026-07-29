/**
 * Download-on-demand + open document with system apps (Media Studio).
 *
 * Always opens a path under worker/cache/open named after the Drive file
 * so Windows Open With shows the correct filename (e.g. detail.json).
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  driveDownloadOpenSpawn,
  parseJsonOutput,
  type DriveCredentials,
} from '../telegram/driveApi';
import type { DriveFile } from '../telegram/driveTypes';

/** Lazy plugin-opener — avoids pageerror when plugins map is briefly undefined. */
async function openerPlugin(): Promise<{
  openPath: (p: string) => Promise<void>;
  revealItemInDir: (p: string) => Promise<void>;
} | null> {
  if (!isTauri()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = (window as any).__TAURI_INTERNALS__;
    if (!internals || internals.plugins == null) return null;
    const mod = await import('@tauri-apps/plugin-opener');
    return {
      openPath: (p: string) => mod.openPath(p) as Promise<void>,
      revealItemInDir: (p: string) => mod.revealItemInDir(p) as Promise<void>,
    };
  } catch {
    return null;
  }
}

const DOWNLOAD_TIMEOUT_MS = 90_000;

export type OpenProgressPhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'copying'
  | 'opening'
  | 'done'
  | 'error';

export type OpenProgress = {
  phase: OpenProgressPhase;
  message: string;
};

export type OpenProgressCb = (p: OpenProgress) => void;

function safeFileName(name: string): string {
  return (
    (name || 'file')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'file'
  );
}

function normalizeInvokePath(path: string): string {
  return String(path || '')
    .trim()
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/i, '');
}

function isHttpUrl(p: string): boolean {
  const s = (p || '').toLowerCase();
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('asset://') ||
    s.startsWith('blob:') ||
    s.startsWith('data:')
  );
}

async function resolveOpenCacheDir(): Promise<string> {
  if (isTauri()) {
    try {
      const workerRoot = await invoke<string>('ensure_secure_dirs');
      if (workerRoot) {
        return `${workerRoot.replace(/[/\\]+$/, '')}\\cache\\open`;
      }
    } catch {
      /* fall through */
    }
  }
  throw new Error('Open di sistem hanya tersedia di aplikasi desktop');
}

/** Friendly path under cache/open — Windows dialog shows this basename. */
export function buildOpenCachePath(dir: string, file: DriveFile): string {
  const baseName = safeFileName(file.name);
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(baseName);
  const ext =
    (file.file_ext || '').replace(/^\./, '') ||
    (file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? '');
  // Prefer human name when unique enough; still prefix id to avoid collisions
  const fname = hasExt
    ? `${file.id}_${baseName}`
    : ext
      ? `${file.id}_${baseName}.${ext}`
      : `${file.id}_${baseName}`;
  return `${dir.replace(/[/\\]+$/, '')}\\${fname}`.replace(/\//g, '\\');
}

async function cacheFileReady(path: string): Promise<boolean> {
  if (!path || !isTauri() || isHttpUrl(path)) return false;
  try {
    return !!(await invoke<boolean>('cache_file_ready', { path: normalizeInvokePath(path) }));
  } catch {
    return false;
  }
}

/** Copy/link source → dest via Rust (same volume fast). */
async function copyLocalFile(from: string, to: string): Promise<void> {
  await invoke('copy_cache_file', {
    from: normalizeInvokePath(from),
    to: normalizeInvokePath(to),
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new Error(
          `${label} timeout (${Math.round(ms / 1000)}s). Coba Preview dulu agar file ter-cache, atau tutup job lain.`
        )
      );
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function progress(cb: OpenProgressCb | undefined, phase: OpenProgressPhase, message: string) {
  try {
    cb?.({ phase, message });
  } catch {
    /* ignore */
  }
}

function formatSize(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Ensure a file exists at cache/open with the Drive file's name.
 * Never opens random temp test paths — always the open-cache path.
 */
export async function ensureLocalDocument(
  creds: DriveCredentials,
  file: DriveFile,
  folderId: number | string | null,
  preferredPath?: string | null,
  onProgress?: OpenProgressCb
): Promise<string> {
  const effectiveFolderId =
    (file as any)?.folder_id ??
    (file as any)?.folderId ??
    (file as any)?.chat_id ??
    (file as any)?.chatId ??
    (file as any)?.peer_id ??
    folderId;

  progress(onProgress, 'checking', `Menyiapkan ${file.name || 'file'}…`);

  const dir = await resolveOpenCacheDir();
  const savePath = buildOpenCachePath(dir, file);
  const preferred =
    preferredPath && !isHttpUrl(preferredPath) ? normalizeInvokePath(preferredPath) : null;

  // Already have the correct open-cache file
  if (await cacheFileReady(savePath)) {
    progress(onProgress, 'checking', `Cache siap: ${file.name}`);
    return savePath;
  }

  // Copy from preview cache (different name like home_216.json) → open/id_detail.json
  if (preferred && (await cacheFileReady(preferred))) {
    if (preferred.toLowerCase() === savePath.toLowerCase()) {
      return savePath;
    }
    progress(onProgress, 'copying', `Menyalin ke ${file.name}…`);
    try {
      await copyLocalFile(preferred, savePath);
      if (await cacheFileReady(savePath)) {
        return savePath;
      }
    } catch (e) {
      console.warn('copy_cache_file failed, will re-download', e);
    }
  }

  progress(
    onProgress,
    'downloading',
    `Mengunduh ${file.name || 'file'}… (${formatSize(file.size)})`
  );

  try {
    // Dedicated OPEN job id — cancel open never kills Transfer Manager jobs
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        let errMsg: string | null = null;
        driveDownloadOpenSpawn(creds, file.id, effectiveFolderId, savePath, {
          onStdoutLine: (line) => {
            const text = String(line || '');
            if (text.includes('[JSON_OUTPUT]')) {
              const data = parseJsonOutput(text);
              if (data?.status === 'error') {
                errMsg = data.error || data.message || 'Download gagal';
              }
            }
          },
          onStderrLine: () => undefined,
          onClose: (code) => {
            if (errMsg) reject(new Error(errMsg));
            else if (code != null && code !== 0) {
              reject(new Error(`Download exit ${code}`));
            } else resolve();
          },
        }).catch(reject);
      }),
      DOWNLOAD_TIMEOUT_MS,
      'Download'
    );
  } catch (e) {
    // Last chance: open preferred path directly if copy failed but file exists
    if (preferred && (await cacheFileReady(preferred))) {
      progress(onProgress, 'checking', 'Memakai cache preview langsung…');
      return preferred;
    }
    throw e;
  }

  if (!(await cacheFileReady(savePath))) {
    throw new Error(
      'Download selesai tapi file cache kosong. Coba Preview dulu, lalu Open With lagi.'
    );
  }
  progress(onProgress, 'checking', `Siap: ${file.name}`);
  return savePath;
}

export async function openInSystem(path: string, onProgress?: OpenProgressCb): Promise<void> {
  if (!path) throw new Error('Path kosong');
  const p = normalizeInvokePath(path);
  if (!isTauri()) throw new Error('Hanya di desktop app');
  progress(onProgress, 'opening', 'Membuka dengan aplikasi default…');
  try {
    await withTimeout(invoke('open_path_safe', { path: p }), 8000, 'Open');
    progress(onProgress, 'done', 'Dibuka');
  } catch (e) {
    console.warn('open_path_safe failed, plugin-opener fallback', e);
    const opener = await openerPlugin();
    if (!opener) throw e;
    await opener.openPath(p);
    progress(onProgress, 'done', 'Dibuka');
  }
}

export async function openWithSystem(path: string, onProgress?: OpenProgressCb): Promise<void> {
  if (!path) throw new Error('Path kosong');
  const p = normalizeInvokePath(path);
  if (!isTauri()) throw new Error('Hanya di desktop app');
  const base = p.split(/[/\\]/).pop() || p;
  progress(onProgress, 'opening', `Dialog Buka dengan… (${base})`);
  try {
    await withTimeout(invoke('open_with_dialog', { path: p }), 8000, 'Open With');
    progress(onProgress, 'done', `Pilih aplikasi untuk ${base}`);
  } catch (e) {
    console.error('open_with_dialog failed', e);
    progress(onProgress, 'error', String((e as Error)?.message || e));
    throw new Error(String((e as Error)?.message || e || 'Gagal membuka dialog Buka dengan…'));
  }
}

export async function revealInFolder(path: string): Promise<void> {
  if (!path) throw new Error('Path kosong');
  const p = normalizeInvokePath(path);
  if (!isTauri()) throw new Error('Hanya di desktop app');
  try {
    await withTimeout(invoke('reveal_path_safe', { path: p }), 5000, 'Reveal');
  } catch (e) {
    try {
      const opener = await openerPlugin();
      if (!opener) throw e;
      await opener.revealItemInDir(p);
    } catch (e2) {
      throw new Error(String((e2 as Error)?.message || e || 'Gagal menampilkan di folder'));
    }
  }
}

export async function openDriveFileInSystem(
  creds: DriveCredentials,
  file: DriveFile,
  folderId: number | null,
  preferredPath?: string | null,
  onProgress?: OpenProgressCb
): Promise<string> {
  const path = await ensureLocalDocument(creds, file, folderId, preferredPath, onProgress);
  await openInSystem(path, onProgress);
  return path;
}

export async function openDriveFileWithApp(
  creds: DriveCredentials,
  file: DriveFile,
  folderId: number | null,
  preferredPath?: string | null,
  onProgress?: OpenProgressCb
): Promise<string> {
  const path = await ensureLocalDocument(creds, file, folderId, preferredPath, onProgress);
  await openWithSystem(path, onProgress);
  return path;
}
