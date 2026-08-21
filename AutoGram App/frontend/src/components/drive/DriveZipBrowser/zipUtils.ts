import { DriveCredentials } from '../../../lib/telegram/driveApi';
import { DriveFolder, DriveChat } from '../../../lib/telegram/driveTypes';

export type TargetDestination = {
  kind: 'drive' | 'saved' | 'chat';
  chatId: string;
  folderId?: number | null;
  topicId?: number | null;
  label: string;
};

export type ZipEntry = {
  name: string;
  size: number;
  compressed_size?: number;
  compressedSize?: number;
  is_dir?: boolean;
  isDir?: boolean;
  method?: number;
  encrypted?: boolean;
};

export type ZipPreviewResult = {
  status: 'success' | 'encrypted' | 'bad_password' | 'error';
  kind?: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'binary' | 'meta';
  text?: string | null;
  data_url?: string | null;
  mime?: string | null;
  size?: number;
  message?: string;
  error?: string;
  cached?: boolean;
};

export type ZipArchiveSource =
  | { kind: 'telegram'; label: string }
  | { kind: 'local'; label: string; path: string; parentEntry: string };

export function isZipEntryDir(e: ZipEntry | null | undefined): boolean {
  if (!e) return false;
  return !!(e.is_dir || e.isDir);
}

export type ZipBrowserProps = {
  creds: DriveCredentials;
  messageId: number;
  folderId: number | null;
  peerId?: string | null;
  topicId?: number | null;
  locationType?: string;
  accountId?: string;
  archiveName?: string;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onDownloadZip?: () => void;
  onOpenSystem?: () => void;
  folders?: DriveFolder[];
  chats?: DriveChat[];
  onRefreshDrive?: () => void;
  onOpenTransferManager?: () => void;
  onEnqueueUploadPaths?: (paths: string[], opts?: any) => Promise<void>;
};

export type Category = 'all' | 'image' | 'doc' | 'media' | 'archive';

export function isZipArchiveName(name: string): boolean {
  return /\.(zip|zipx)$/i.test(name);
}

/**
 * Extract explicitly labelled password candidates from the authoritative
 * Telegram caption. This deliberately does not brute-force archives.
 */
export function extractZipPasswordCandidates(messageText: string, archiveName = ''): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const value = String(raw || '')
      .trim()
      .replace(/^[`'"\[({<]+|[`'"\])}>.,;:]+$/gu, '');
    if (value.length < 2 || value.length > 128 || /\s{3,}/u.test(value)) return;
    const key = value.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(value);
    }
  };
  const labels = '(?:password|passwd|pass|pwd|kata\\s+sandi|sandi|mật\\s+khẩu|mat\\s+khau|密码|密碼|解压码|解壓碼)';
  const labelled = new RegExp(`${labels}\\s*(?:is|adalah|[:=：-])\\s*[\\x60'\"]?([^\\r\\n\\x60'\"]{2,128})`, 'giu');
  for (const match of messageText.matchAll(labelled)) add(match[1]);
  const codeAfterLabel = new RegExp(`${labels}[^\\r\\n]{0,24}[\\x60'\"]([^\\x60'\"]{2,128})[\\x60'\"]`, 'giu');
  for (const match of messageText.matchAll(codeAfterLabel)) add(match[1]);

  // Common archive convention: the explicit archive stem is repeated after a
  // password label; never infer arbitrary caption words as passwords.
  const stem = archiveName.replace(/\.(zip|zipx)$/iu, '').trim();
  if (stem && messageText.toLocaleLowerCase().includes(`password: ${stem}`.toLocaleLowerCase())) add(stem);
  return candidates.slice(0, 12);
}

export function safeZipEntryPath(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

export function parentPath(pathStr: string): string {
  const s = pathStr.replace(/\/+$/, '');
  const idx = s.lastIndexOf('/');
  if (idx <= 0) return '';
  return s.slice(0, idx + 1);
}

export function joinPath(dirStr: string, name: string): string {
  const d = dirStr.endsWith('/') || !dirStr ? dirStr : dirStr + '/';
  return (d + name).replace(/\/+/g, '/');
}

export function matchesCategory(name: string | null | undefined, cat: Category): boolean {
  if (cat === 'all') return true;
  if (!name) return false;
  const lower = name.toLowerCase();

  if (cat === 'image') {
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff)$/.test(lower);
  }
  if (cat === 'media') {
    return /\.(mp4|mkv|avi|mov|webm|mp3|m4a|aac|flac|ogg|wav|opus)$/.test(lower);
  }
  if (cat === 'doc') {
    return /\.(pdf|doc|docx|txt|json|md|mdx|py|rs|ts|tsx|js|jsx|css|html|log|sh|csv|xml|yaml|yml|toml|ini|sql)$/.test(lower);
  }
  if (cat === 'archive') {
    return /\.(zip|zipx)$/.test(lower);
  }
  return true;
}

export function basenamesAt(
  entries: ZipEntry[],
  cwd: string,
  query: string,
  category: Category
): {
  dirs: string[];
  files: ZipEntry[];
} {
  const dirs = new Set<string>();
  const files: ZipEntry[] = [];
  const normalizedCwd = cwd ? (cwd.endsWith('/') ? cwd : cwd + '/') : '';
  const q = query.trim().toLowerCase();

  for (const e of entries) {
    if (!e.name) continue;
    const isDir = isZipEntryDir(e);
    const name = e.name;

    if (query) {
      if (name.toLowerCase().includes(q) && matchesCategory(name, category)) {
        if (isDir) {
          dirs.add(name);
        } else {
          files.push(e);
        }
      }
      continue;
    }

    if (normalizedCwd) {
      if (!name.startsWith(normalizedCwd)) continue;
      const sub = name.slice(normalizedCwd.length);
      if (!sub) continue;
      const firstSlash = sub.indexOf('/');
      if (firstSlash >= 0) {
        dirs.add(normalizedCwd + sub.slice(0, firstSlash + 1));
      } else {
        if (isDir) {
          dirs.add(name);
        } else if (matchesCategory(name, category)) {
          files.push(e);
        }
      }
    } else {
      const firstSlash = name.indexOf('/');
      if (firstSlash >= 0) {
        dirs.add(name.slice(0, firstSlash + 1));
      } else {
        if (isDir) {
          dirs.add(name);
        } else if (matchesCategory(name, category)) {
          files.push(e);
        }
      }
    }
  }

  return {
    dirs: Array.from(dirs).sort((a, b) => a.localeCompare(b)),
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function entryLabel(full: string, cwd: string): string {
  const s = full.replace(/\/+$/, '');
  const c = cwd.replace(/\/+$/, '');
  if (c && s.startsWith(c + '/')) {
    return s.slice(c.length + 1);
  }
  const idx = s.lastIndexOf('/');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

export function clearZipBrowserCache(): void {
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}
