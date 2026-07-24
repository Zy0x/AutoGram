/**
 * Unified, Full-Bleed & Spacious ZIP Workbench (Google Drive style).
 * Interactive search, category filters, multi-select batch extraction, session password cache, and code viewer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Code,
  Download,
  ExternalLink,
  File,
  FileText,
  Film,
  Folder,
  FolderInput,
  Gauge,
  HardDrive,
  Hash,
  Home,
  Image as ImageIcon,
  Loader2,
  Lock,
  Megaphone,
  MessageSquare,
  Music,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Shrink,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  KeyRound,
  ShieldAlert,
  SquareCheck,
  SquareMinus,
  Unlock,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ZipCatalogSkeleton, ModernProgressBar } from './DriveSkeleton';
import type { DriveCredentials } from '../../lib/driveApi';
import { driveZipList, driveZipReadEntry, driveZipExtractEntry, clearZipEntryCache, driveStopStream } from '../../lib/driveApi';
import { VSCodeCodeViewer } from '../common/VSCodeCodeViewer';
import { formatDriveBytes, type DriveFolder, type DriveChat } from '../../lib/driveTypes';
import {
  tgScanFolders,
  tgListDialogs,
  tgListTopics,
  type TgTopicRow,
} from '../../lib/telegramBackend';

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
  folders?: DriveFolder[];
  chats?: DriveChat[];
  onRefreshDrive?: () => void;
  onOpenTransferManager?: () => void;
  onEnqueueUploadPaths?: (
    paths: string[],
    opts?: { targetFolderId?: number | null; targetLabel?: string; topicId?: number | null; skipTopic?: boolean }
  ) => Promise<void>;
};

type Category = 'all' | 'image' | 'doc' | 'media';

function parentPath(path: string): string {
  const p = (path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name || '';
  return `${dir.replace(/\/+$/, '')}/${name || ''}`;
}

function matchesCategory(name: string | null | undefined, cat: Category): boolean {
  if (cat === 'all') return true;
  const n = String(name || '').toLowerCase();
  if (cat === 'image') return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(n);
  if (cat === 'doc') return /\.(txt|md|json|csv|log|xml|ya?ml|html?|css|js|ts|tsx|jsx|py|rs|sql|ini|toml|sh|bat|c|cpp|h|hpp|java|kt|go|php|pdf)$/i.test(n);
  if (cat === 'media') return /\.(mp4|webm|mp3|ogg|wav|mkv|avi|flac|aac)$/i.test(n);
  return true;
}

function basenamesAt(entries: ZipEntry[], cwd: string, query: string, category: Category): {
  folders: { name: string; path: string }[];
  files: ZipEntry[];
} {
  const cleanQ = (query || '').trim().toLowerCase();
  const safeEntries = Array.isArray(entries) ? entries : [];

  // Flatten search when query is active
  if (cleanQ) {
    const files: ZipEntry[] = [];
    for (const e of safeEntries) {
      if (!e) continue;
      if (isZipEntryDir(e)) continue;
      const full = (e.name || '').replace(/\\/g, '/');
      if (matchesCategory(full, category) && full.toLowerCase().includes(cleanQ)) {
        files.push({ ...e, name: full });
      }
    }
    files.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    return { folders: [], files };
  }

  const prefix = cwd ? `${cwd.replace(/\/+$/, '')}/` : '';
  const folderSet = new Map<string, string>();
  const files: ZipEntry[] = [];

  for (const e of safeEntries) {
    if (!e) continue;
    const full = (e.name || '').replace(/\\/g, '/');
    if (prefix && !full.startsWith(prefix)) continue;
    const rest = prefix ? full.slice(prefix.length) : full;
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const seg = rest.slice(0, slash);
      if (seg) folderSet.set(seg, joinPath(cwd, seg));
    } else if (isZipEntryDir(e)) {
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
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  );
  return { folders, files };
}

function entryLabel(full: string, cwd: string): string {
  const safeFull = full || '';
  const prefix = cwd ? `${cwd.replace(/\/+$/, '')}/` : '';
  const rest = prefix && safeFull.startsWith(prefix) ? safeFull.slice(prefix.length) : safeFull;
  return rest.replace(/\/+$/, '') || safeFull;
}

function iconForFile(name: string | null | undefined) {
  const n = String(name || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return ImageIcon;
  if (/\.(mp4|webm|mkv|avi)$/i.test(n)) return Film;
  if (/\.(mp3|ogg|wav|flac)$/i.test(n)) return Music;
  if (/\.(txt|md|json|csv|log|xml|ya?ml|html?|css|js|ts|tsx|jsx|py|rs|sql)$/i.test(n)) return FileText;
  return File;
}



// Instant 0-ms ZIP Session Index Cache with Telegram Auto-Sync Verification
const zipIndexCacheMap = new Map<
  string,
  {
    entries: ZipEntry[];
    meta: {
      archive_size?: number;
      total_uncompressed?: number;
      source?: string;
      truncated?: boolean;
      needs_full_for_extract?: boolean;
    };
    timestamp: number;
  }
>();

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
  folders: driveFolders,
  chats: driveChats,
  onRefreshDrive,
  onOpenTransferManager,
  onEnqueueUploadPaths,
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
  const extractAbortedRef = useRef(false);
  const openRequestIdRef = useRef(0);

  const handleCancelExtraction = () => {
    extractAbortedRef.current = true;
    setExtracting(null);
    setToastMsg('Proses ekstraksi dibatalkan oleh pengguna.');
  };

  useEffect(() => {
    return () => {
      extractAbortedRef.current = true;
      openRequestIdRef.current++;
      void driveStopStream(creds, null, { stopAll: true, incompleteOnly: true }).catch(() => undefined);
    };
  }, [creds]);
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
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPass, setRememberPass] = useState(true);
  const [destPickerModal, setDestPickerModal] = useState<{
    action: 'single' | 'batch';
    entryName?: string;
  } | null>(null);
  const [destQuery, setDestQuery] = useState('');
  const [customPeerId, setCustomPeerId] = useState('');

  // Fallback destination state (auto-fetched if props are empty)
  const [fetchedFolders, setFetchedFolders] = useState<DriveFolder[]>([]);
  const [fetchedChats, setFetchedChats] = useState<DriveChat[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [forumTopicsMap, setForumTopicsMap] = useState<Record<number, TgTopicRow[]>>({});
  const [loadingTopicsForChat, setLoadingTopicsForChat] = useState<number | null>(null);
  const [expandedForumChatId, setExpandedForumChatId] = useState<number | null>(null);

  const effectiveFolders = useMemo(
    () => (driveFolders && driveFolders.length > 0 ? driveFolders : fetchedFolders),
    [driveFolders, fetchedFolders]
  );

  const effectiveChats = useMemo(
    () => (driveChats && driveChats.length > 0 ? driveChats : fetchedChats),
    [driveChats, fetchedChats]
  );



  const unifiedDestinations = useMemo(() => {
    type DestItem = {
      key: string;
      id: string;
      numericId: number | null;
      name: string;
      folderId?: number | null;
      parentId?: number | null;
      isSavedMessages: boolean;
      isDriveFolder: boolean;
      isChannel: boolean;
      isGroup: boolean;
      isForum: boolean;
      isBot: boolean;
      isUser: boolean;
      badges: Array<{ label: string; bg: string; color: string }>;
      IconComp: any;
    };

    const map = new Map<string, DestItem>();

    // 1. Pesan Tersimpan (Saved Messages)
    map.set('me', {
      key: 'me',
      id: 'me',
      numericId: null,
      name: 'Pesan Tersimpan (Saved Messages)',
      isSavedMessages: true,
      isDriveFolder: false,
      isChannel: false,
      isGroup: false,
      isForum: false,
      isBot: false,
      isUser: false,
      badges: [{ label: 'Pesan Tersimpan', bg: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }],
      IconComp: MessageSquare,
    });

    // 2. Drive Folders (effectiveFolders)
    for (const f of effectiveFolders) {
      const key = String(f.id);
      const isDrive = !f.parent_id || f.is_orphan;
      const folderBadgeLabel = isDrive ? 'Drive' : 'Folder';
      const folderBadgeBg = isDrive ? 'rgba(59, 130, 246, 0.2)' : 'rgba(168, 85, 247, 0.2)';
      const folderBadgeColor = isDrive ? '#60a5fa' : '#c084fc';

      map.set(key, {
        key,
        id: key,
        numericId: f.id,
        name: f.name || `Folder #${f.id}`,
        folderId: f.id,
        parentId: f.parent_id,
        isSavedMessages: false,
        isDriveFolder: true,
        isChannel: false,
        isGroup: false,
        isForum: false,
        isBot: false,
        isUser: false,
        badges: [{ label: folderBadgeLabel, bg: folderBadgeBg, color: folderBadgeColor }],
        IconComp: Folder,
      });
    }

    // 3. Telegram Dialogs (effectiveChats)
    for (const c of effectiveChats as any[]) {
      if (!c || c.id == null) continue;
      const key = String(c.id);
      if (key === 'me' || key === '777000' || c.username === 'telegram') continue;

      const cName = c.name || c.title || `Chat #${c.id}`;
      const isChan = c.type === 'channel' || !!c.isChannel;
      const isGrp = c.type === 'group' || !!c.isGroup;
      const isBt = c.type === 'bot' || !!c.isBot;
      const isFrm = !!(c.is_forum || c.isForum);
      const isUsr = c.type === 'user' || !!c.isUser;

      let chatBadgeLabel = 'Chat';
      let chatBadgeBg = 'rgba(59, 130, 246, 0.2)';
      let chatBadgeColor = '#60a5fa';
      let ItemIcon = MessageSquare;

      if (isChan) {
        chatBadgeLabel = 'Channel';
        chatBadgeBg = 'rgba(168, 85, 247, 0.2)';
        chatBadgeColor = '#c084fc';
        ItemIcon = Megaphone;
      } else if (isGrp) {
        chatBadgeLabel = isFrm ? 'Grup (Forum)' : 'Grup';
        chatBadgeBg = 'rgba(34, 197, 94, 0.2)';
        chatBadgeColor = '#4ade80';
        ItemIcon = isFrm ? Hash : Users;
      } else if (isBt) {
        chatBadgeLabel = 'Bot';
        chatBadgeBg = 'rgba(239, 68, 68, 0.2)';
        chatBadgeColor = '#f87171';
        ItemIcon = Bot;
      } else if (isUsr) {
        chatBadgeLabel = 'Chat';
        chatBadgeBg = 'rgba(59, 130, 246, 0.2)';
        chatBadgeColor = '#60a5fa';
        ItemIcon = Users;
      }

      const existing = map.get(key);
      if (existing) {
        // MERGE: Update flags and add combined badge!
        existing.isChannel = isChan;
        existing.isGroup = isGrp;
        existing.isForum = isFrm;
        existing.isBot = isBt;
        existing.isUser = isUsr;
        if (!existing.badges.some((b) => b.label === chatBadgeLabel)) {
          existing.badges.push({ label: chatBadgeLabel, bg: chatBadgeBg, color: chatBadgeColor });
        }
        if (isFrm) {
          existing.IconComp = Hash;
        }
      } else {
        map.set(key, {
          key,
          id: key,
          numericId: typeof c.id === 'number' ? c.id : Number(c.id) || null,
          name: cName,
          isSavedMessages: false,
          isDriveFolder: false,
          isChannel: isChan,
          isGroup: isGrp,
          isForum: isFrm,
          isBot: isBt,
          isUser: isUsr,
          badges: [{ label: chatBadgeLabel, bg: chatBadgeBg, color: chatBadgeColor }],
          IconComp: ItemIcon,
        });
      }
    }

    return Array.from(map.values());
  }, [effectiveFolders, effectiveChats]);

  useEffect(() => {
    if (!destPickerModal) return;
    let cancelled = false;
    const loadDests = async () => {
      if (effectiveFolders.length === 0 || effectiveChats.length === 0) {
        setLoadingDestinations(true);
        try {
          if (effectiveFolders.length === 0) {
            const fRes = await tgScanFolders({
              session: creds.session,
              apiId: Number(creds.apiId) || 0,
              apiHash: creds.apiHash,
            });
            if (!cancelled && fRes?.ok && fRes.data?.folders) {
              setFetchedFolders(fRes.data.folders as any);
            }
          }
          if (effectiveChats.length === 0) {
            const cRes = await tgListDialogs({
              session: creds.session,
              apiId: Number(creds.apiId) || 0,
              apiHash: creds.apiHash,
              limit: 100,
            });
            if (!cancelled && cRes?.ok && Array.isArray(cRes.data)) {
              setFetchedChats(cRes.data as any);
            }
          }
        } catch {
          /* ignore fetch error */
        } finally {
          if (!cancelled) setLoadingDestinations(false);
        }
      }
    };
    void loadDests();
    return () => {
      cancelled = true;
    };
  }, [destPickerModal, effectiveFolders.length, effectiveChats.length, creds]);

  const loadTopicsForChat = async (chatId: number) => {
    if (forumTopicsMap[chatId] || loadingTopicsForChat === chatId) {
      setExpandedForumChatId((prev) => (prev === chatId ? null : chatId));
      return;
    }
    setLoadingTopicsForChat(chatId);
    try {
      const res = await tgListTopics({
        session: creds.session,
        apiId: Number(creds.apiId) || 0,
        apiHash: creds.apiHash,
        chatId,
      });
      if (res?.ok && res.data?.topics) {
        setForumTopicsMap((prev) => ({ ...prev, [chatId]: res.data!.topics }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingTopicsForChat(null);
      setExpandedForumChatId(chatId);
    }
  };

  // Media view transform & drag state
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rotate, setRotate] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Reset transform when opening new preview
  useEffect(() => {
    setZoom(1);
    setRotate(0);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
  }, [preview?.entry]);

  // Non-passive wheel listener for smooth hovering mouse wheel zoom
  useEffect(() => {
    const el = imageContainerRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      setZoom((prev) => {
        const next = Math.max(0.5, Math.min(5, Math.round((prev + delta) * 100) / 100));
        if (next <= 1) {
          setPan({ x: 0, y: 0 });
        }
        return next;
      });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [preview?.entry, preview?.kind]);

  const handleResetTransform = () => {
    setZoom(1);
    setRotate(0);
    setPan({ x: 0, y: 0 });
  };

  const handleDoubleClickZoom = () => {
    if (zoom > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setZoom(2.5);
    }
  };

  const handleImagePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleImagePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleImagePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      dragStartRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

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

  const loadList = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setToastMsg(null);
    setSelectedEntries(new Set());

    if (forceRefresh) {
      clearZipEntryCache(creds, messageId, folderId);
    }

    // 0-ms Fast Path: Serve from Session Cache if available
    const cached = !forceRefresh ? zipIndexCacheMap.get(archiveKey) : null;
    if (cached) {
      setEntries(cached.entries);
      setMeta(cached.meta);
      setLoading(false);
      setCwd('');

      // Silent background sync verification with Telegram
      setTimeout(async () => {
        try {
          const res = await driveZipList(creds, messageId, folderId);
          if (res?.status === 'success' && Array.isArray(res.entries)) {
            if (
              res.archive_size !== cached.meta.archive_size ||
              res.entries.length !== cached.entries.length
            ) {
              const list = res.entries as ZipEntry[];
              const newMeta = {
                archive_size: res?.archive_size,
                total_uncompressed: res?.total_uncompressed,
                source: res?.source,
                truncated: res?.truncated,
                needs_full_for_extract: res?.needs_full_for_extract,
              };
              setEntries(list);
              setMeta(newMeta);
              zipIndexCacheMap.set(archiveKey, {
                entries: list,
                meta: newMeta,
                timestamp: Date.now(),
              });
            }
          }
        } catch {
          /* ignore background sync error */
        }
      }, 300);
      return;
    }

    try {
      const res = await driveZipList(creds, messageId, folderId);
      if (res?.status && res.status !== 'success') {
        throw new Error(res.message || res.error || 'Gagal membuka ZIP');
      }
      const list = (res?.entries || []) as ZipEntry[];
      const newMeta = {
        archive_size: res?.archive_size,
        total_uncompressed: res?.total_uncompressed,
        source: res?.source,
        truncated: res?.truncated,
        needs_full_for_extract: res?.needs_full_for_extract,
      };
      setEntries(list);
      setMeta(newMeta);
      zipIndexCacheMap.set(archiveKey, {
        entries: list,
        meta: newMeta,
        timestamp: Date.now(),
      });
      setCwd('');
    } catch (e: any) {
      setError(String(e?.message || e || 'Gagal membaca arsip ZIP'));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [archiveKey, creds, messageId, folderId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const { folders: zipSubfolders, files } = useMemo(
    () => basenamesAt(entries, cwd, searchQuery, category),
    [entries, cwd, searchQuery, category]
  );

  const categoryCounts = useMemo(() => {
    let images = 0, docs = 0, media = 0;
    const safeEntries = Array.isArray(entries) ? entries : [];
    for (const e of safeEntries) {
      if (!e || isZipEntryDir(e)) continue;
      if (matchesCategory(e.name, 'image')) images++;
      if (matchesCategory(e.name, 'doc')) docs++;
      if (matchesCategory(e.name, 'media')) media++;
    }
    return { all: safeEntries.filter((e) => e && !isZipEntryDir(e)).length, images, docs, media };
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
    const reqId = ++openRequestIdRef.current;

    // Hentikan stream video/audio latar belakang sebelumnya untuk menghemat bandwidth & menghindari FloodWait
    void driveStopStream(creds, null, { stopAll: true, incompleteOnly: true }).catch(() => undefined);

    setOpening(fullPath);
    setError(null);
    setPreview(null);
    setToastMsg(null);
    setZoom(1);
    setRotate(0);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);

    // Check remembered password cache if no explicit input given
    const effectivePass = passInput || rememberedPasswordsMap.get(archiveKey) || password;

    try {
      const res = await driveZipReadEntry(creds, messageId, folderId, fullPath, effectivePass);

      // Discard stale request jika pengguna mengeklik berkas lain atau menutup modal saat menunggu
      if (openRequestIdRef.current !== reqId) return;

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
      if (openRequestIdRef.current === reqId) {
        setError(String(e?.message || e || 'Gagal membuka entri'));
      }
    } finally {
      if (openRequestIdRef.current === reqId) {
        setOpening(null);
      }
    }
  };

  const handleExtractSingle = async (entryName: string, targetMode: 'local' | 'drive' = 'local') => {
    if (targetMode === 'drive') {
      setDestPickerModal({ action: 'single', entryName });
      return;
    }
    setExtracting(entryName);
    setToastMsg(null);
    const passToUse = password || rememberedPasswordsMap.get(archiveKey);
    try {
      const basename = entryName.split('/').pop() || entryName;
      const { save } = await import('@tauri-apps/plugin-dialog');
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
        setToastMsg(`Berhasil mengekstrak ${basename} ke Lokal (${formatDriveBytes(res.bytesWritten)})`);
      }
    } catch (e: any) {
      setError(`Gagal mengekstrak berkas: ${String(e?.message || e)}`);
    } finally {
      setExtracting(null);
    }
  };

  const executeExtractAndUpload = async (
    entryNames: string[],
    target: TargetDestination
  ) => {
    if (entryNames.length === 0) return;
    setExtracting(entryNames.length === 1 ? entryNames[0] : 'batch');
    setToastMsg(null);
    const passToUse = password || rememberedPasswordsMap.get(archiveKey);

    try {
      const { tempDir } = await import('@tauri-apps/api/path');
      const dir = await tempDir().catch(() => '');

      const tempPaths: string[] = [];

      extractAbortedRef.current = false;
      for (let i = 0; i < entryNames.length; i++) {
        if (extractAbortedRef.current) {
          console.log('[DriveZipBrowser] Batch extraction aborted by user');
          setToastMsg('Ekstraksi dibatalkan oleh pengguna.');
          break;
        }
        const entryName = entryNames[i];
        const basename = entryName.split('/').pop() || entryName;
        const cleanBase = basename.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const tempPath = dir
          ? `${dir.replace(/[/\\]+$/, '')}/ag_zip_upload_${Date.now()}_${i}_${cleanBase}`
          : `ag_zip_upload_${Date.now()}_${i}_${cleanBase}`;

        setToastMsg(`Mengekstrak ${i + 1}/${entryNames.length}: ${basename}…`);

        const res = await driveZipExtractEntry(
          creds,
          messageId,
          folderId,
          entryName,
          tempPath,
          passToUse
        );

        if (res?.status === 'success') {
          tempPaths.push(tempPath);
        } else {
          console.warn(`[DriveZipBrowser] Extract entry ${basename} fail`);
        }
      }

      if (tempPaths.length > 0) {
        setToastMsg(`Melimpahkan ${tempPaths.length} berkas ke Transfer Manager pusat…`);

        const targetFolder =
          target.kind === 'saved'
            ? null
            : (target.folderId ?? (target.kind === 'drive' ? null : Number(target.chatId) || null));

        if (onEnqueueUploadPaths) {
          const isExplicitTopic = target.topicId !== undefined;
          await onEnqueueUploadPaths(tempPaths, {
            targetFolderId: targetFolder,
            targetLabel: target.label,
            topicId: target.topicId !== undefined ? target.topicId : null,
            skipTopic: isExplicitTopic ? (target.topicId === null) : undefined,
          });
          onOpenTransferManager?.();
          setToastMsg(`Berhasil menambahkan ${tempPaths.length} berkas ke antrean Transfer Manager!`);
          onRefreshDrive?.();
        } else {
          setError('Callback Transfer Manager pusat tidak tersedia');
        }
        setSelectedEntries(new Set());
      } else {
        setError('Gagal mengekstrak berkas dari ZIP');
      }
    } catch (e: any) {
      setError(`Gagal mengekstrak & mengunggah: ${String(e?.message || e)}`);
    } finally {
      setExtracting(null);
    }
  };

  const handleBatchExtract = async (targetMode: 'local' | 'drive' = 'local') => {
    if (selectedEntries.size === 0) return;
    if (targetMode === 'drive') {
      setDestPickerModal({ action: 'batch' });
      return;
    }
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

      extractAbortedRef.current = false;
      for (let i = 0; i < selectedList.length; i++) {
        if (extractAbortedRef.current) {
          setToastMsg('Ekstraksi massal dibatalkan oleh pengguna.');
          break;
        }
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

      setToastMsg(`Berhasil mengekstrak ${extractedCount} berkas (${formatDriveBytes(totalBytes)}) ke Lokal (${targetDir})`);
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
    const fileNamesOnly = entries.filter((e) => !e.is_dir).map((f) => f.name);
    setSelectedEntries(new Set(fileNamesOnly));
  };

  const clearSelection = () => {
    setSelectedEntries(new Set());
  };

  if (loading) {
    return (
      <div className="drive-zip-browser is-loading p-5">
        <ModernProgressBar
          isLoading={loading}
          label="Membaca katalog & indeks ZIP via MTProto Range Request..."
        />
        <ZipCatalogSkeleton count={10} />
      </div>
    );
  }

  if (error && entries.length === 0) {
    const errStr = String(error || '');
    const isEncryptedErr = errStr.toLowerCase().includes('password') || errStr.toLowerCase().includes('dienkripsi');
    return (
      <div className="drive-zip-browser is-error" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
        <Archive size={44} style={{ color: isEncryptedErr ? '#f59e0b' : '#ef4444', marginBottom: '1rem' }} />
        <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.75rem', maxWidth: '480px', margin: '0 auto 1rem' }}>
          {error}
        </p>

        {isEncryptedErr && (
          <div style={{ display: 'flex', gap: '8px', maxWidth: '360px', margin: '1rem auto 1.5rem' }}>
            <input
              type="password"
              placeholder="Masukkan Password ZIP..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="td-input"
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) {
                  rememberedPasswordsMap.set(archiveKey, password);
                  void loadList();
                }
              }}
            />
            <button
              type="button"
              className="td-btn-primary"
              disabled={!password}
              onClick={() => {
                rememberedPasswordsMap.set(archiveKey, password);
                void loadList();
              }}
            >
              Buka
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="button" className="td-btn-primary" onClick={() => void loadList()}>
            <RefreshCw size={14} /> Coba Muat Ulang
          </button>
          {onDownloadZip && (
            <button type="button" className="td-btn-secondary" onClick={onDownloadZip}>
              <Download size={14} /> Unduh Berkas Penuh
            </button>
          )}
        </div>
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
            title="Refresh / Muat Ulang Indeks ZIP dari Telegram"
            onClick={() => void loadList(true)}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
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
            {extracting && (
              <button
                type="button"
                className="td-btn-secondary"
                style={{ fontSize: '0.72rem', padding: '2px 8px', borderColor: '#ef4444', color: '#f87171' }}
                onClick={handleCancelExtraction}
              >
                <X size={12} /> Batalkan Ekstraksi
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {preview?.kind === 'image' && preview.dataUrl && (
              <div className="drive-zip-media-tools">
                <button
                  type="button"
                  className={`drive-zip-tool-btn${zoom < 1 ? ' active' : ''}`}
                  title="Perkecil Gambar (-25%)"
                  disabled={zoom <= 0.5}
                  onClick={() =>
                    setZoom((z) => {
                      const next = Math.max(0.5, Math.round((z - 0.25) * 100) / 100);
                      if (next <= 1) setPan({ x: 0, y: 0 });
                      return next;
                    })
                  }
                >
                  <ZoomOut size={13} />
                </button>
                <button
                  type="button"
                  className={`drive-zip-tool-btn${zoom !== 1 || rotate !== 0 || pan.x !== 0 || pan.y !== 0 ? ' active' : ''}`}
                  title="Reset Skala 100%, Posisi & Rotasi"
                  onClick={handleResetTransform}
                >
                  <Shrink size={13} /> {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className={`drive-zip-tool-btn${zoom > 1 ? ' active' : ''}`}
                  title="Perbesar Gambar (+25%)"
                  disabled={zoom >= 5}
                  onClick={() => setZoom((z) => Math.min(5, Math.round((z + 0.25) * 100) / 100))}
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  type="button"
                  className="drive-zip-tool-btn"
                  title="Putar 90° Kiri"
                  onClick={() => setRotate((r) => (r + 270) % 360)}
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  type="button"
                  className="drive-zip-tool-btn"
                  title="Putar 90° Kanan"
                  onClick={() => setRotate((r) => (r + 90) % 360)}
                >
                  <RotateCw size={13} />
                </button>
              </div>
            )}
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
              <div className="drive-zip-extract-group">
                <button
                  type="button"
                  className="drive-zip-btn-extract"
                  disabled={!!extracting}
                  onClick={() => void handleBatchExtract('local')}
                  title="Ekstrak berkas terpilih ke komputer lokal"
                >
                  {extracting === 'batch' ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                  Ekstrak ({selectedEntries.size}) ke Lokal
                </button>
                <button
                  type="button"
                  className="drive-zip-btn-extract is-secondary"
                  disabled={!!extracting}
                  onClick={() => void handleBatchExtract('drive')}
                  title="Ekstrak berkas terpilih lalu disiapkan/diunggah ke AutoGram Drive"
                >
                  {extracting === 'batch' ? <Loader2 size={13} className="spin" /> : <HardDrive size={13} />}
                  Ekstrak ({selectedEntries.size}) ke Drive
                </button>
              </div>
            ) : preview && preview.kind !== 'encrypted' ? (
              <div className="drive-zip-extract-group">
                <button
                  type="button"
                  className="drive-zip-btn-extract"
                  disabled={!!extracting}
                  onClick={() => void handleExtractSingle(preview.entry, 'local')}
                  title="Ekstrak berkas pratinjau ini ke komputer lokal"
                >
                  {extracting === preview.entry ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                  Ekstrak ke Lokal
                </button>
                <button
                  type="button"
                  className="drive-zip-btn-extract is-secondary"
                  disabled={!!extracting}
                  onClick={() => void handleExtractSingle(preview.entry, 'drive')}
                  title="Ekstrak berkas pratinjau ini lalu disiapkan/diunggah ke AutoGram Drive"
                >
                  {extracting === preview.entry ? <Loader2 size={13} className="spin" /> : <HardDrive size={13} />}
                  Ekstrak ke Drive
                </button>
              </div>
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
          {zipSubfolders.map((f) => (
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
          {zipSubfolders.length === 0 && files.length === 0 && (
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
            <VSCodeCodeViewer text={preview.text} name={preview.entry} />
          )}
          {preview?.kind === 'image' && preview.dataUrl && (
            <div
              ref={imageContainerRef}
              className="drive-zip-media-container"
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                userSelect: 'none',
                touchAction: 'none',
                cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'zoom-in',
              }}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={handleImagePointerUp}
              onPointerCancel={handleImagePointerUp}
              onDoubleClick={handleDoubleClickZoom}
            >
              <img
                src={preview.dataUrl}
                alt={preview.entry}
                className="drive-zip-img"
                draggable={false}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotate}deg)`,
                  transformOrigin: 'center center',
                  transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                }}
              />
            </div>
          )}
          {preview?.kind === 'image' && !preview.dataUrl && (
            <div className="drive-zip-preview-empty">
              <ImageIcon size={40} style={{ color: '#38bdf8' }} />
              <p title={preview.entry} style={{ fontWeight: 600, color: '#f8fafc', fontSize: '1rem' }}>
                {entryLabel(preview.entry, cwd)}
              </p>
              <span className="drive-chip" style={{ background: 'rgba(56, 189, 248, 0.18)', color: '#38bdf8', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
                Gambar Berkas Besar ({formatDriveBytes(preview.size || 0)})
              </span>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', maxWidth: 360, textAlign: 'center', marginTop: 8 }}>
                Ukuran berkas gambar melebihi 15 MB. Gunakan tombol Ekstrak ke Lokal untuk melihat berkas ini.
              </p>
              <button
                type="button"
                className="td-btn primary-btn"
                style={{ marginTop: 12 }}
                onClick={() => void handleExtractSingle(preview.entry)}
              >
                <Download size={14} style={{ marginRight: 6 }} /> Ekstrak Berkas
              </button>
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
          {preview?.kind === 'video' && !preview.dataUrl && (
            <div className="drive-zip-preview-empty">
              <Film size={40} style={{ color: '#a855f7' }} />
              <p title={preview.entry} style={{ fontWeight: 600, color: '#f8fafc', fontSize: '1rem' }}>
                {entryLabel(preview.entry, cwd)}
              </p>
              <span className="drive-chip" style={{ background: 'rgba(168, 85, 247, 0.18)', color: '#c084fc', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
                Video Berkas ({formatDriveBytes(preview.size || 0)})
              </span>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', maxWidth: 360, textAlign: 'center', marginTop: 8 }}>
                Gunakan tombol Ekstrak ke Lokal untuk mengunduh dan memutar berkas video ini.
              </p>
              <button
                type="button"
                className="td-btn primary-btn"
                style={{ marginTop: 12 }}
                onClick={() => void handleExtractSingle(preview.entry)}
              >
                <Download size={14} style={{ marginRight: 6 }} /> Ekstrak Berkas
              </button>
            </div>
          )}
          {preview?.kind === 'audio' && preview.dataUrl && (
            <div className="drive-zip-preview-empty">
              <audio src={preview.dataUrl} controls style={{ width: '100%', maxWidth: 400 }} />
              <p title={preview.entry} style={{ marginTop: 12 }}>{entryLabel(preview.entry, cwd)}</p>
            </div>
          )}
          {preview && /\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(preview.entry) ? (
            <div className="drive-zip-preview-empty">
              <Archive size={40} style={{ color: '#ffae00' }} />
              <p title={preview.entry} style={{ fontWeight: 600, color: '#f8fafc', fontSize: '1rem' }}>
                {entryLabel(preview.entry, cwd)}
              </p>
              <span className="drive-chip" style={{ background: 'rgba(255, 174, 0, 0.18)', color: '#ffae00', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
                Arsip Terkompresi Bertingkat (ZIP dalam ZIP)
              </span>
              {preview.size != null && (
                <span style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: 4 }}>
                  Ukuran: {formatDriveBytes(preview.size)}
                </span>
              )}
              <p style={{ fontSize: '0.78rem', color: '#64748b', maxWidth: 360, textAlign: 'center', marginTop: 8 }}>
                Arsip terkompresi ini berada di dalam file ZIP utama. Anda dapat mengekstraksinya langsung ke Lokal / Drive.
              </p>
              <button
                type="button"
                className="td-btn-primary"
                style={{ marginTop: 12, gap: 6 }}
                disabled={!!extracting}
                onClick={() => void handleExtractSingle(preview.entry, 'local')}
              >
                {extracting === preview.entry ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Download size={14} />
                )}
                <span>Ekstrak Arsip Ini ke Lokal</span>
              </button>
            </div>
          ) : (preview?.kind === 'binary' || preview?.kind === 'meta') ? (
            <div className="drive-zip-preview-empty">
              <File size={36} style={{ color: '#94a3b8' }} />
              <p title={preview.entry} style={{ fontWeight: 600, color: '#f8fafc' }}>{entryLabel(preview.entry, cwd)}</p>
              {preview.size != null && <span style={{ color: '#ffae00', fontWeight: 600 }}>{formatDriveBytes(preview.size)}</span>}
              <span className="drive-zip-hint">{preview.message || preview.mime || 'Binary'}</span>
            </div>
          ) : null}
          {preview?.kind === 'encrypted' && (
            <div className="zip-encrypted-card-wrapper">
              <div className="zip-encrypted-card">
                <div className="zip-encrypted-icon-badge">
                  <Lock size={30} className="zip-encrypted-lock-icon" />
                </div>

                <h4 className="zip-encrypted-title" title={preview.entry}>
                  {entryLabel(preview.entry, cwd)}
                </h4>

                <div className="zip-encrypted-badge">
                  <ShieldAlert size={13} />
                  <span>File Terenkripsi (Password Required)</span>
                </div>

                <p className="zip-encrypted-desc">
                  {preview.message || 'Entri ini dilindungi password. Masukkan password ZIP untuk membuka pratinjau.'}
                </p>

                <form
                  className="zip-encrypted-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (password && !opening) {
                      void openEntry(preview.entry, password);
                    }
                  }}
                >
                  <div className="zip-encrypted-input-group">
                    <KeyRound size={16} className="zip-encrypted-input-icon" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="zip-encrypted-input"
                      placeholder="Masukkan Password ZIP..."
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="zip-encrypted-eye-btn"
                      title={showPassword ? 'Sembunyikan Password' : 'Tampilkan Password'}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="zip-encrypted-submit-btn"
                    disabled={!password || !!opening}
                  >
                    {opening === preview.entry ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Unlock size={16} />
                    )}
                    <span>Buka Berkas</span>
                  </button>

                  <label className="zip-encrypted-remember">
                    <input
                      type="checkbox"
                      className="zip-encrypted-checkbox"
                      checked={rememberPass}
                      onChange={(e) => setRememberPass(e.target.checked)}
                    />
                    <span>Ingat password untuk sesi ini</span>
                  </label>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {destPickerModal && (
        <div className="td-confirm-overlay" role="presentation" onClick={() => setDestPickerModal(null)}>
          <div
            className="td-confirm-panel dest-picker"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: '540px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="td-confirm-head">
              <span className="td-confirm-icon move" aria-hidden>
                <FolderInput size={20} />
              </span>
              <div className="td-confirm-head-text">
                <h2>Pilih Destinasi Ekstraksi Drive / Telegram</h2>
                <p>
                  {destPickerModal.action === 'batch'
                    ? `Pilih lokasi tujuan ekstraksi untuk ${selectedEntries.size} berkas terpilih.`
                    : `Pilih lokasi tujuan ekstraksi untuk berkas ${destPickerModal.entryName?.split('/').pop() || ''}.`}
                </p>
              </div>
              <button
                type="button"
                className="td-confirm-close"
                onClick={() => setDestPickerModal(null)}
                aria-label="Tutup"
              >
                <X size={18} />
              </button>
            </header>

            <div className="td-dest-search" style={{ margin: '12px 16px 4px' }}>
              <Search size={14} aria-hidden />
              <input
                type="search"
                className="td-dest-search-input"
                value={destQuery}
                onChange={(e) => setDestQuery(e.target.value)}
                placeholder="Cari Drive, Folder, Chat, Bot, Grup, Topik, Channel…"
                autoFocus
              />
            </div>

            <div
              className="drive-zip-dest-options"
              style={{
                padding: '12px 16px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                overflowY: 'auto',
                maxHeight: '420px',
              }}
            >
              {loadingDestinations && (
                <div style={{ padding: '12px 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Loader2 size={16} className="spin" /> Memuat daftar folder & dialog akun…
                </div>
              )}

              {/* Unified Destination List (Merged Items with Combined Badges & No Duplicates) */}
              {unifiedDestinations.map((item) => {
                const matches = !destQuery || item.name.toLowerCase().includes(destQuery.toLowerCase());
                if (!matches) return null;

                const topics = item.numericId != null ? forumTopicsMap[item.numericId] || [] : [];
                const isExpanded = item.numericId != null && expandedForumChatId === item.numericId;
                const IconComp = item.IconComp;

                return (
                  <div key={`dest-${item.key}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <button
                      type="button"
                      className="td-dest-item"
                      style={{ paddingLeft: item.parentId ? '24px' : '12px' }}
                      onClick={() => {
                        if (item.isForum && item.numericId != null) {
                          void loadTopicsForChat(item.numericId);
                          return;
                        }
                        const action = destPickerModal;
                        const entryList = action.action === 'single' && action.entryName ? [action.entryName] : [...selectedEntries];
                        setDestPickerModal(null);

                        const primaryBadgeLabel = item.badges.map((b) => b.label).join(' · ');
                        void executeExtractAndUpload(entryList, {
                          kind: item.isSavedMessages ? 'saved' : item.isDriveFolder ? 'drive' : 'chat',
                          chatId: item.isSavedMessages ? 'me' : String(item.numericId || item.id),
                          folderId: item.folderId ?? null,
                          topicId: null,
                          label: `${item.name} (${primaryBadgeLabel})`,
                        });
                      }}
                    >
                      <span className="td-dest-ico">
                        <IconComp size={16} style={item.isDriveFolder ? { color: '#a855f7' } : undefined} />
                      </span>
                      <div style={{ textAlign: 'left', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <strong>{item.name}</strong>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {item.badges.map((b, idx) => (
                              <span
                                key={`b-${idx}`}
                                className="drive-chip"
                                style={{ fontSize: '0.68rem', padding: '1px 6px', background: b.bg, color: b.color }}
                              >
                                {b.label}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block' }}>
                          {item.isSavedMessages
                            ? 'Pesan Tersimpan Telegram Anda'
                            : item.isDriveFolder
                            ? `Folder Drive #${item.numericId} ${item.parentId ? `(Induk: #${item.parentId})` : ''}`
                            : `Telegram Peer ID: ${item.id}`}
                          {item.isForum ? ' · Klik untuk memilih Topik Forum' : ''}
                        </span>
                      </div>
                    </button>

                    {/* Forum Topics Sub-List */}
                    {item.isForum && isExpanded && item.numericId != null && (
                      <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {loadingTopicsForChat === item.numericId && (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '4px 8px' }}>
                            <Loader2 size={12} className="spin" style={{ display: 'inline', marginRight: 6 }} /> Memuat topik forum…
                          </div>
                        )}
                        <button
                          type="button"
                          className="td-dest-item"
                          style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px dashed rgba(255, 255, 255, 0.1)' }}
                          onClick={() => {
                            const action = destPickerModal;
                            const entryList = action.action === 'single' && action.entryName ? [action.entryName] : [...selectedEntries];
                            setDestPickerModal(null);
                            void executeExtractAndUpload(entryList, {
                              kind: 'chat',
                              chatId: String(item.numericId),
                              folderId: item.folderId ?? null,
                              topicId: null,
                              label: `${item.name} (Grup Utama Forum)`,
                            });
                          }}
                        >
                          <span className="td-dest-ico"><Hash size={14} /></span>
                          <span style={{ fontSize: '0.8rem' }}>Grup Utama Forum (Tanpa Topik)</span>
                        </button>
                        {topics.map((t) => (
                          <button
                            key={`topic-${item.numericId}-${t.id}`}
                            type="button"
                            className="td-dest-item"
                            style={{ background: 'rgba(234, 179, 8, 0.08)' }}
                            onClick={() => {
                              const action = destPickerModal;
                              const entryList = action.action === 'single' && action.entryName ? [action.entryName] : [...selectedEntries];
                              setDestPickerModal(null);
                              void executeExtractAndUpload(entryList, {
                                kind: 'chat',
                                chatId: String(item.numericId),
                                folderId: item.folderId ?? null,
                                topicId: t.id,
                                label: `${item.name} → Topik ${t.title}`,
                              });
                            }}
                          >
                            <span className="td-dest-ico"><Hash size={14} style={{ color: '#facc15' }} /></span>
                            <div style={{ textAlign: 'left', flex: 1 }}>
                              <strong style={{ fontSize: '0.82rem', color: '#fef08a' }}>{t.title}</strong>
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block' }}>Topik ID #{t.id}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 5. Custom Peer / ID Direct Input */}
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                  Destinasi Spesifik (Username / Peer ID / Topik ID):
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="td-dest-search-input"
                    value={customPeerId}
                    onChange={(e) => setCustomPeerId(e.target.value)}
                    placeholder="misal: @mychannel atau -10012345678"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="td-btn-primary"
                    disabled={!customPeerId.trim()}
                    onClick={() => {
                      const action = destPickerModal;
                      const targetName = customPeerId.trim();
                      const entryList = action.action === 'single' && action.entryName ? [action.entryName] : [...selectedEntries];
                      setDestPickerModal(null);
                      setCustomPeerId('');

                      let chatId = targetName;
                      let topicId: number | null = null;

                      if (targetName.includes(':')) {
                        const parts = targetName.split(':');
                        chatId = parts[0];
                        topicId = Number(parts[1]) || null;
                      }

                      void executeExtractAndUpload(entryList, {
                        kind: 'chat',
                        chatId,
                        topicId,
                        label: `Destinasi (${targetName})`,
                      });
                    }}
                  >
                    <Send size={13} /> Kirim
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
