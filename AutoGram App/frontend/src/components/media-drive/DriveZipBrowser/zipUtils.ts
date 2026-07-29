import { DriveCredentials } from '../../../lib/driveApi';
import { DriveFolder, DriveChat } from '../../../lib/driveTypes';

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
};

export function isZipEntryDir(e: ZipEntry | null | undefined): boolean {
  if (!e) return false;
  return !!(e.is_dir || e.isDir);
}

export type ZipBrowserProps = {
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
  folders?: DriveFolder[];
  chats?: DriveChat[];
  onRefreshDrive?: () => void;
};

export type Category = 'all' | 'image' | 'doc' | 'media';

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
    return /\.(pdf|doc|docx|txt|json|md|py|rs|ts|tsx|js|jsx|css|html|log|sh|zip)$/.test(lower);
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
