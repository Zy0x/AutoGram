import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { join, tempDir } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';
import {
  Archive,
  FileWarning,
  RefreshCw,
  Zap,
} from 'lucide-react';
import type {
  Category,
  SortOption,
  TargetDestination,
  ViewMode,
  ZipArchiveSource,
  ZipBrowserProps,
  ZipEntry,
  ZipPreviewResult,
} from './zipUtils';
import {
  basenamesAt,
  detectArchiveDominantType,
  extractZipPasswordCandidates,
  getCategoryCounts,
  isZipArchiveName,
  safeZipEntryPath,
  totalEntriesSize,
} from './zipUtils';
import { ZipHeaderToolbar } from './ZipHeaderToolbar';
import { ZipEntryTable } from './ZipEntryTable';
import { ZipEntryGrid } from './ZipEntryGrid';
import { ZipFloatingActionBar } from './ZipFloatingActionBar';
import { ZipContextMenu, type ZipContextMenuState, type ZipContextTarget } from './ZipContextMenu';
import { ZipCodePreviewModal } from './ZipCodePreviewModal';
import { ZipExtractModal } from './ZipExtractModal';
import { ZipPasswordModal } from './ZipPasswordModal';
import { fetchZipEntryThumbnail, isMediaThumbnailSupported } from './ZipThumbnailManager';
import { driveZipExtractEntry, driveZipList, driveZipReadEntry } from '../../../lib/telegram/driveApi';
import { zipExtractEntry, zipListLocal, zipPreviewEntry } from '../../../lib/tauri/rustBackend';
import { tgDebugGetMessage, tgSearchPasswordCandidates } from '../../../lib/telegram/core/telegramBackend';
import './DriveZipBrowser.css';

export { clearZipBrowserCache } from './zipUtils';

type PasswordAction =
  | { kind: 'preview'; entry: ZipEntry }
  | { kind: 'nested'; entry: ZipEntry }
  | { kind: 'extract'; target: TargetDestination }
  | { kind: 'thumbnail'; entry: ZipEntry }
  | { kind: 'all_thumbnails' }
  | null;

function mapLocalPreview(result: Awaited<ReturnType<typeof zipPreviewEntry>>): ZipPreviewResult {
  const mime = String(result.mimeType || '').toLowerCase();
  let kind: ZipPreviewResult['kind'] = 'meta';
  if (mime === 'application/pdf') kind = 'pdf';
  else if (mime.startsWith('image/')) kind = 'image';
  else if (mime.startsWith('video/')) kind = 'video';
  else if (mime.startsWith('audio/')) kind = 'audio';
  else if (result.textContent != null) kind = 'text';
  else if (result.isBinary) kind = 'binary';
  return {
    status: result.encrypted ? 'encrypted' : 'success',
    kind,
    text: result.textContent,
    data_url: result.dataUrl,
    mime: result.mimeType,
    size: result.size,
  };
}

function mediaKindFromName(name: string): ZipPreviewResult['kind'] | null {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov|mkv|avi|m4v)$/.test(lower)) return 'video';
  if (/\.(mp3|ogg|wav|m4a|aac|flac|opus)$/.test(lower)) return 'audio';
  if (/\.pdf$/.test(lower)) return 'pdf';
  return null;
}

export function DriveZipBrowser(props: ZipBrowserProps) {
  const {
    creds,
    messageId,
    folderId,
    peerId,
    topicId,
    locationType,
    accountId,
    archiveName,
    onClose,
    onDownloadZip,
    folders = [],
    chats = [],
    onRefreshDrive,
    onOpenTransferManager,
    onEnqueueUploadPaths,
  } = props;
  const { t } = useTranslation();

  const zipOpts = useMemo(
    () => ({
      peerId,
      topicId,
      locationType,
      accountId,
    }),
    [accountId, locationType, peerId, topicId]
  );

  const [sources, setSources] = useState<ZipArchiveSource[]>([
    { kind: 'telegram', label: archiveName || t('speedtest.zip_archive_explorer') },
  ]);
  const source = sources[sources.length - 1];

  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [lastSelectedName, setLastSelectedName] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewEntry, setPreviewEntry] = useState<ZipEntry | null>(null);
  const [preview, setPreview] = useState<ZipPreviewResult | null>(null);
  const [previewLocalUrl, setPreviewLocalUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractProgress, setExtractProgress] = useState<string | null>(null);
  const [activePassword, setActivePassword] = useState<string | null>(null);
  const [passwordAction, setPasswordAction] = useState<PasswordAction>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordCandidates, setPasswordCandidates] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ZipContextMenuState>(null);

  const tempRootPromise = useRef<Promise<string> | null>(null);

  const ensureTempRoot = useCallback(() => {
    if (!tempRootPromise.current) {
      tempRootPromise.current = (async () => {
        const root = await join(
          await tempDir(),
          'autogram-zip-workbench',
          creds.session.replace(/[^a-z0-9_-]/gi, '_'),
          `${messageId}-${Date.now()}`
        );
        await mkdir(root, { recursive: true });
        return root;
      })();
    }
    return tempRootPromise.current;
  }, [creds.session, messageId]);

  const loadZipEntries = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (source.kind === 'telegram') {
        const result = await driveZipList(creds, messageId, folderId, false, zipOpts);
        if (result.status === 'error') throw new Error(result.message || result.error);
        const parsed = Array.isArray(result.entries) ? result.entries : [];
        setEntries(parsed);
      } else {
        const result = await zipListLocal(source.path);
        const mapped = (result.entries || []).map((entry) => ({
          name: entry.name,
          size: Number(entry.size || 0),
          compressed_size: Number(entry.compressedSize || 0),
          is_dir: !!entry.isDir,
          method: entry.method,
          encrypted: !!entry.encrypted,
        }));
        setEntries(mapped);
      }
    } catch (caught) {
      setEntries([]);
      setError(String((caught as Error)?.message || caught || t('speedtest.zip_list_failed')));
    } finally {
      setIsLoading(false);
    }
  }, [creds, folderId, messageId, source, t, zipOpts]);

  // Reset selection on archive switch
  useEffect(() => {
    setCurrentPath('');
    setSearchQuery('');
    setSelectedEntries(new Set());
    setLastSelectedName(null);
    setActivePassword(null);
    void loadZipEntries();
  }, [loadZipEntries]);

  // Extract password suggestions from the archive caption first, then perform
  // a bounded server-side search across the same chat. This never downloads
  // chat history and remains behind the native FloodWait guard.
  useEffect(() => {
    let cancelled = false;
    if (!creds.session || !creds.apiId || !creds.apiHash) {
      setPasswordCandidates([]);
      return;
    }
    const resolvedPeer = (peerId || (folderId != null && folderId !== 0 ? String(folderId) : '') || 'me').trim();
    void Promise.all([
      tgDebugGetMessage({
      session: creds.session,
      apiId: Number(creds.apiId),
      apiHash: creds.apiHash,
      peerId: resolvedPeer,
      telegramMessageId: messageId,
      }),
      tgSearchPasswordCandidates({
        session: creds.session,
        apiId: Number(creds.apiId),
        apiHash: creds.apiHash,
        peerId: resolvedPeer,
        anchorMessageId: messageId,
      }),
    ]).then(([result, chatSearch]) => {
      if (cancelled) return;
      const text = result?.ok && result.data?.found ? result.data.text || '' : '';
      const relatedText = chatSearch?.ok && chatSearch.data
        ? chatSearch.data.messages.map((message) => message.text).join('\n')
        : '';
      setPasswordCandidates(
        extractZipPasswordCandidates(`${text}\n${relatedText}`, archiveName || source.label)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [archiveName, creds.apiHash, creds.apiId, creds.session, folderId, messageId, peerId, source.label]);

  // Compute filtered & sorted directories and files
  const { dirs, files } = useMemo(
    () => basenamesAt(entries, currentPath, searchQuery, category, sortOption),
    [entries, currentPath, searchQuery, category, sortOption]
  );

  // Compute live category item counts
  const categoryCounts = useMemo(
    () => getCategoryCounts(entries, currentPath, searchQuery),
    [entries, currentPath, searchQuery]
  );

  // Total stats for current archive
  const totalFilesCount = useMemo(() => entries.filter((e) => !e.is_dir && !e.isDir).length, [entries]);
  const totalArchiveBytes = useMemo(() => totalEntriesSize(entries), [entries]);
  const dominantArchiveType = useMemo(() => detectArchiveDominantType(entries), [entries]);

  // Total selected bytes calculation
  const selectedBytes = useMemo(() => {
    let sum = 0;
    for (const entry of entries) {
      if (selectedEntries.has(entry.name)) {
        sum += Number(entry.size || 0);
      }
    }
    return sum;
  }, [entries, selectedEntries]);

  const materializeEntry = useCallback(
    async (entry: ZipEntry, password?: string | null) => {
      const root = await ensureTempRoot();
      const relative = safeZipEntryPath(entry.name) || `entry-${Date.now()}`;
      const destination = await join(root, ...relative.split('/'));
      if (source.kind === 'telegram') {
        await driveZipExtractEntry(creds, messageId, folderId, entry.name, destination, password || undefined, zipOpts);
      } else {
        await zipExtractEntry(source.path, entry.name, destination, password || undefined);
      }
      return destination;
    },
    [creds, ensureTempRoot, folderId, messageId, source, zipOpts]
  );

  const readEntry = useCallback(
    async (entry: ZipEntry, password?: string | null) => {
      if (source.kind === 'telegram') {
        return (await driveZipReadEntry(
          creds,
          messageId,
          folderId,
          entry.name,
          password || undefined,
          false,
          zipOpts
        )) as ZipPreviewResult;
      }
      return mapLocalPreview(await zipPreviewEntry(source.path, entry.name, password || undefined));
    },
    [creds, folderId, messageId, source, zipOpts]
  );

  const requestPassword = (action: Exclude<PasswordAction, null>, message?: string | null) => {
    setPasswordAction(action);
    setPasswordError(message || null);
  };

  const openNestedArchive = useCallback(
    async (entry: ZipEntry, password?: string | null) => {
      setIsPreviewLoading(true);
      setPreviewError(null);
      try {
        const path = await materializeEntry(entry, password ?? activePassword);
        await zipListLocal(path);
        setSources((current) => [
          ...current,
          { kind: 'local', label: entry.name.split('/').pop() || entry.name, path, parentEntry: entry.name },
        ]);
        setPreviewEntry(null);
        setPreview(null);
      } catch (caught) {
        const message = String((caught as Error)?.message || caught);
        if (/password|decrypt|encrypted/i.test(message)) {
          requestPassword({ kind: 'nested', entry }, t('speedtest.zip_password_invalid'));
        } else {
          setPreviewError(message);
          setPreviewEntry(entry);
        }
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [activePassword, materializeEntry, t]
  );

  const handlePreview = useCallback(
    async (entry: ZipEntry, password?: string | null) => {
      if (isZipArchiveName(entry.name)) {
        await openNestedArchive(entry, password);
        return;
      }
      setPreviewEntry(entry);
      setPreview(null);
      setPreviewLocalUrl(null);
      setIsPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await readEntry(entry, password ?? activePassword);
        if (result.status === 'encrypted' || result.status === 'bad_password') {
          requestPassword({ kind: 'preview', entry }, result.message || t('speedtest.zip_password_invalid'));
          setPreviewEntry(null);
          return;
        }
        if (result.status === 'error') throw new Error(result.message || result.error || t('speedtest.zip_entry_failed'));
        const fallbackKind = mediaKindFromName(entry.name);
        const normalized = { ...result, kind: result.kind === 'binary' && fallbackKind ? fallbackKind : result.kind };
        if (fallbackKind && !normalized.data_url) {
          const path = await materializeEntry(entry, password ?? activePassword);
          setPreviewLocalUrl(convertFileSrc(path));
          normalized.kind = fallbackKind;
        }
        setPreview(normalized);
      } catch (caught) {
        const message = String((caught as Error)?.message || caught);
        if (/password|decrypt|encrypted/i.test(message)) {
          requestPassword({ kind: 'preview', entry }, t('speedtest.zip_password_invalid'));
          setPreviewEntry(null);
        } else {
          setPreviewError(message);
        }
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [activePassword, materializeEntry, openNestedArchive, readEntry, t]
  );

  const runExtraction = useCallback(
    async (target: TargetDestination, password?: string | null) => {
      if (!onEnqueueUploadPaths) {
        setError(t('speedtest.zip_upload_queue_unavailable'));
        return;
      }
      const selected = [...selectedEntries];
      const expanded = entries.filter(
        (entry) =>
          !entry.is_dir &&
          !entry.isDir &&
          selected.some((name) => entry.name === name || entry.name.startsWith(name.endsWith('/') ? name : `${name}/`))
      );
      if (!expanded.length) return;
      setExtractBusy(true);
      setExtractProgress(t('speedtest.zip_extract_progress', { current: 0, total: expanded.length }));
      try {
        const paths: string[] = [];
        for (let index = 0; index < expanded.length; index += 1) {
          setExtractProgress(t('speedtest.zip_extract_progress', { current: index + 1, total: expanded.length }));
          paths.push(await materializeEntry(expanded[index], password ?? activePassword));
        }
        await onEnqueueUploadPaths(paths, {
          targetFolderId: target.folderId ?? null,
          targetLabel: target.label,
          topicId: target.topicId ?? null,
          skipTopic: target.topicId == null,
        });
        setShowExtractModal(false);
        setSelectedEntries(new Set());
        onRefreshDrive?.();
        onOpenTransferManager?.();
      } catch (caught) {
        const message = String((caught as Error)?.message || caught);
        if (/password|decrypt|encrypted|bad_password/i.test(message)) {
          requestPassword({ kind: 'extract', target }, t('speedtest.zip_password_invalid'));
        } else {
          setExtractProgress(message);
        }
      } finally {
        setExtractBusy(false);
      }
    },
    [activePassword, entries, materializeEntry, onEnqueueUploadPaths, onOpenTransferManager, onRefreshDrive, selectedEntries, t]
  );

  const submitPassword = async (password: string) => {
    const action = passwordAction;
    if (!action) return;
    setActivePassword(password);
    setPasswordError(null);
    setPasswordAction(null);
    if (action.kind === 'preview') await handlePreview(action.entry, password);
    if (action.kind === 'nested') await openNestedArchive(action.entry, password);
    if (action.kind === 'extract') await runExtraction(action.target, password);
    if (action.kind === 'thumbnail') await handleLoadThumbnail(action.entry, password);
    if (action.kind === 'all_thumbnails') await handleLoadAllThumbnails(password);
  };

  const contentSurfaceRef = useRef<HTMLDivElement>(null);
  const [marqueeBox, setMarqueeBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());
  const [isBatchLoadingThumbs, setIsBatchLoadingThumbs] = useState(false);

  const marqueeStateRef = useRef<{
    startX: number;
    startY: number;
    initialSelected: Set<string>;
    isAdditive: boolean;
    active: boolean;
  } | null>(null);

  // Manual on-demand single thumbnail fetch with password protection support
  const handleLoadThumbnail = useCallback(
    async (entry: ZipEntry, explicitPassword?: string | null) => {
      if (thumbnails.has(entry.name) || loadingThumbnails.has(entry.name)) return;
      const pwd = explicitPassword !== undefined ? explicitPassword : activePassword;
      if (entry.encrypted && !pwd) {
        requestPassword({ kind: 'thumbnail', entry }, t('speedtest.zip_password_for_media_title'));
        return;
      }
      setLoadingThumbnails((prev) => new Set(prev).add(entry.name));
      try {
        const thumbUrl = await fetchZipEntryThumbnail(
          creds,
          messageId,
          folderId,
          entry.name,
          pwd,
          zipOpts
        );
        if (thumbUrl) {
          setThumbnails((prev) => new Map(prev).set(entry.name, thumbUrl));
        } else if (entry.encrypted) {
          requestPassword({ kind: 'thumbnail', entry }, t('speedtest.zip_password_invalid'));
        }
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        if (/bad_password|password|encrypted/i.test(errMsg)) {
          requestPassword({ kind: 'thumbnail', entry }, t('speedtest.zip_password_invalid'));
        }
      } finally {
        setLoadingThumbnails((prev) => {
          const next = new Set(prev);
          next.delete(entry.name);
          return next;
        });
      }
    },
    [activePassword, creds, folderId, messageId, requestPassword, t, thumbnails, loadingThumbnails, zipOpts]
  );

  // Total unloaded media files in current folder/view
  const totalUnloadedMediaCount = useMemo(() => {
    let count = 0;
    for (const f of files) {
      if (isMediaThumbnailSupported(f.name) && !thumbnails.has(f.name)) {
        count++;
      }
    }
    return count;
  }, [files, thumbnails]);

  // Load all media thumbnails in current folder/view with password protection support
  const handleLoadAllThumbnails = useCallback(
    async (explicitPassword?: string | null) => {
      const pwd = explicitPassword !== undefined ? explicitPassword : activePassword;
      const targets = files.filter(
        (f) => isMediaThumbnailSupported(f.name) && !thumbnails.has(f.name)
      );
      if (targets.length === 0 || isBatchLoadingThumbs) return;

      const hasEncrypted = targets.some((f) => f.encrypted) || entries.some((e) => e.encrypted);
      if (hasEncrypted && !pwd) {
        requestPassword({ kind: 'all_thumbnails' }, t('speedtest.zip_password_for_media_title'));
        return;
      }

      setIsBatchLoadingThumbs(true);
      try {
        for (const target of targets) {
          await handleLoadThumbnail(target, pwd);
        }
      } finally {
        setIsBatchLoadingThumbs(false);
      }
    },
    [activePassword, entries, files, handleLoadThumbnail, isBatchLoadingThumbs, requestPassword, t, thumbnails]
  );

  // Count selected media entries that have not loaded thumbnail yet
  const selectedMediaUnloadedCount = useMemo(() => {
    let count = 0;
    for (const name of selectedEntries) {
      if (isMediaThumbnailSupported(name) && !thumbnails.has(name)) {
        count++;
      }
    }
    return count;
  }, [selectedEntries, thumbnails]);

  // Batch load thumbnails for all selected media entries
  const handleLoadSelectedThumbnails = useCallback(async () => {
    const targets = files.filter(
      (f) => selectedEntries.has(f.name) && isMediaThumbnailSupported(f.name) && !thumbnails.has(f.name)
    );
    if (targets.length === 0 || isBatchLoadingThumbs) return;
    setIsBatchLoadingThumbs(true);
    try {
      for (const target of targets) {
        await handleLoadThumbnail(target);
      }
    } finally {
      setIsBatchLoadingThumbs(false);
    }
  }, [files, handleLoadThumbnail, isBatchLoadingThumbs, selectedEntries, thumbnails]);

  // OS File Explorer style item selection with Shift / Ctrl / Normal Click
  const handleSelectEntry = useCallback(
    (name: string, e: React.MouseEvent) => {
      const allVisible = [...dirs, ...files.map((f) => f.name)];

      if (e.shiftKey) {
        // Shift + Click: contiguous range selection from anchor
        const anchor = lastSelectedName && allVisible.includes(lastSelectedName) ? lastSelectedName : allVisible[0];
        const idxA = allVisible.indexOf(anchor);
        const idxB = allVisible.indexOf(name);
        if (idxA !== -1 && idxB !== -1) {
          const [start, end] = [Math.min(idxA, idxB), Math.max(idxA, idxB)];
          const range = new Set(allVisible.slice(start, end + 1));
          if (e.ctrlKey || e.metaKey) {
            setSelectedEntries((current) => new Set([...current, ...range]));
          } else {
            setSelectedEntries(range);
          }
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl + Click: toggle single item in/out of selection
        setSelectedEntries((current) => {
          const next = new Set(current);
          if (next.has(name)) {
            next.delete(name);
          } else {
            next.add(name);
          }
          return next;
        });
        setLastSelectedName(name);
      } else {
        // Normal Click: if already single-selected, unselect it; otherwise select ONLY this item
        setSelectedEntries((current) => {
          if (current.has(name) && current.size === 1) {
            setLastSelectedName(null);
            return new Set();
          }
          setLastSelectedName(name);
          return new Set([name]);
        });
      }
    },
    [dirs, files, lastSelectedName]
  );

  const handleSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, a, select, .dzb-action-icon-btn')) {
      return;
    }

    const clickedCardOrRow = target.closest('[data-entry-name]');
    const surface = contentSurfaceRef.current;
    if (!surface) return;

    const surfaceRect = surface.getBoundingClientRect();
    const startX = e.clientX - surfaceRect.left + surface.scrollLeft;
    const startY = e.clientY - surfaceRect.top + surface.scrollTop;

    const isAdditive = e.ctrlKey || e.metaKey;

    if (!clickedCardOrRow && !isAdditive && !e.shiftKey) {
      // Clicking empty surface clears selection
      setSelectedEntries(new Set());
      setLastSelectedName(null);
    }

    if (!clickedCardOrRow) {
      marqueeStateRef.current = {
        startX,
        startY,
        initialSelected: new Set(isAdditive ? selectedEntries : []),
        isAdditive,
        active: false,
      };

      const handlePointerMove = (ev: PointerEvent) => {
        const state = marqueeStateRef.current;
        if (!state) return;
        const currentSurf = contentSurfaceRef.current;
        if (!currentSurf) return;

        const currentSurfRect = currentSurf.getBoundingClientRect();
        const curX = ev.clientX - currentSurfRect.left + currentSurf.scrollLeft;
        const curY = ev.clientY - currentSurfRect.top + currentSurf.scrollTop;

        const deltaX = Math.abs(curX - state.startX);
        const deltaY = Math.abs(curY - state.startY);

        if (!state.active && (deltaX > 4 || deltaY > 4)) {
          state.active = true;
          document.body.classList.add('dzb-marquee-active');
        }

        if (state.active) {
          const x = Math.min(state.startX, curX);
          const y = Math.min(state.startY, curY);
          const w = Math.max(state.startX, curX) - x;
          const h = Math.max(state.startY, curY) - y;

          setMarqueeBox({ x, y, w, h });

          // Test intersection with all items [data-entry-name]
          const elements = currentSurf.querySelectorAll('[data-entry-name]');
          const hitNames = new Set<string>(state.initialSelected);

          const selRect = {
            left: x - currentSurf.scrollLeft,
            top: y - currentSurf.scrollTop,
            right: x - currentSurf.scrollLeft + w,
            bottom: y - currentSurf.scrollTop + h,
          };

          elements.forEach((el) => {
            const entryName = el.getAttribute('data-entry-name');
            if (!entryName) return;
            const r = el.getBoundingClientRect();
            const relRect = {
              left: r.left - currentSurfRect.left,
              top: r.top - currentSurfRect.top,
              right: r.right - currentSurfRect.left,
              bottom: r.bottom - currentSurfRect.top,
            };

            const intersects = !(
              relRect.left > selRect.right ||
              relRect.right < selRect.left ||
              relRect.top > selRect.bottom ||
              relRect.bottom < selRect.top
            );

            if (intersects) {
              hitNames.add(entryName);
            } else if (!state.isAdditive) {
              hitNames.delete(entryName);
            }
          });

          setSelectedEntries(hitNames);
        }
      };

      const handlePointerUp = () => {
        marqueeStateRef.current = null;
        setMarqueeBox(null);
        document.body.classList.remove('dzb-marquee-active');
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    }
  };

  const selectAll = () => {
    const visibleNames = [...dirs, ...files.map((file) => file.name)];
    setSelectedEntries(selectedEntries.size === visibleNames.length && visibleNames.length > 0 ? new Set() : new Set(visibleNames));
  };

  const invertSelection = () => {
    const visibleNames = [...dirs, ...files.map((file) => file.name)];
    setSelectedEntries((current) => {
      const next = new Set<string>();
      for (const name of visibleNames) {
        if (!current.has(name)) next.add(name);
      }
      return next;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, target: ZipContextTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target,
    });
  };

  const pathParts = useMemo(() => currentPath.split('/').filter(Boolean), [currentPath]);
  const canNavigateUp = pathParts.length > 0 || sources.length > 1;

  const handleNavigateBack = useCallback(() => {
    // 1. Close single entry code/image preview if active
    if (previewEntry) {
      setPreviewEntry(null);
      setPreview(null);
      setPreviewLocalUrl(null);
      setPreviewError(null);
      return true;
    }
    // 2. Close context menu if open
    if (contextMenu) {
      setContextMenu(null);
      return true;
    }
    // 3. Close extraction modal if open
    if (showExtractModal) {
      setShowExtractModal(false);
      return true;
    }
    // 4. Close password prompt if open
    if (passwordAction) {
      setPasswordAction(null);
      return true;
    }
    // 5. Deselect all items if items are selected
    if (selectedEntries.size > 0) {
      setSelectedEntries(new Set());
      setLastSelectedName(null);
      return true;
    }
    // 6. Navigate up to parent folder in current archive
    if (pathParts.length > 1) {
      const parentPath = `${pathParts.slice(0, -1).join('/')}/`;
      setCurrentPath(parentPath);
      setSelectedEntries(new Set());
      setLastSelectedName(null);
      return true;
    }
    if (pathParts.length === 1) {
      setCurrentPath('');
      setSelectedEntries(new Set());
      setLastSelectedName(null);
      return true;
    }
    // 7. Pop nested archive if currently inside a nested zip
    if (sources.length > 1) {
      setSources((current) => current.slice(0, -1));
      setCurrentPath('');
      setSelectedEntries(new Set());
      setLastSelectedName(null);
      return true;
    }
    return false;
  }, [contextMenu, passwordAction, pathParts, previewEntry, selectedEntries.size, showExtractModal, sources.length]);

  // Mouse Back button listener (Button 3 / XButton1)
  useEffect(() => {
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 3) {
          const handled = handleNavigateBack();
          if (!handled && onClose) {
            onClose();
          }
        }
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 3) {
          const handled = handleNavigateBack();
          if (!handled && onClose) {
            onClose();
          }
        }
      }
    };
    window.addEventListener('auxclick', onAuxClick, true);
    window.addEventListener('mouseup', onMouseUp, true);
    return () => {
      window.removeEventListener('auxclick', onAuxClick, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    };
  }, [handleNavigateBack, onClose]);

  // Touch & Trackpad Back Swipe Gesture
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastWheelNavRef = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    // Left-to-right swipe (Back gesture)
    if (dx > 55 && Math.abs(dy) < 45 && elapsed < 500) {
      const handled = handleNavigateBack();
      if (!handled && onClose) {
        onClose();
      }
    }
  };

  const handleWheelGesture = useCallback(
    (e: WheelEvent) => {
      // Two-finger horizontal back swipe on trackpad (swipe right: negative deltaX)
      if (Math.abs(e.deltaX) > 40 && Math.abs(e.deltaY) < 25) {
        const now = Date.now();
        if (e.deltaX < -40 && now - lastWheelNavRef.current > 450) {
          lastWheelNavRef.current = now;
          const handled = handleNavigateBack();
          if (!handled && onClose) {
            onClose();
          }
        }
      }
    },
    [handleNavigateBack, onClose]
  );

  useEffect(() => {
    const el = contentSurfaceRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheelGesture, { passive: true });
    return () => el.removeEventListener('wheel', handleWheelGesture);
  }, [handleWheelGesture]);

  // Keyboard Controller
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && ['INPUT', 'TEXTAREA'].includes(target.tagName);
      if (isInput) {
        if (e.key === 'Escape') {
          target.blur();
          return;
        }
        return;
      }

      // Backspace: navigate up to parent directory or close
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        const handled = handleNavigateBack();
        if (!handled && onClose && selectedEntries.size === 0) {
          onClose();
        }
        return;
      }

      // Alt+ArrowLeft or BrowserBack: standard Back navigation
      if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'BrowserBack') {
        e.preventDefault();
        e.stopPropagation();
        const handled = handleNavigateBack();
        if (!handled && onClose) {
          onClose();
        }
        return;
      }

      // Alt+ArrowUp: navigate up one level
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        handleNavigateBack();
        return;
      }

      // Escape: close sub-view / deselect / parent directory / close
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const handled = handleNavigateBack();
        if (!handled && onClose) {
          onClose();
        }
        return;
      }

      // Ctrl/Cmd + A: select all
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }

      // Space / Enter: preview selected file
      if (e.key === ' ' || e.key === 'Enter') {
        if (lastSelectedName) {
          const entry = files.find((f) => f.name === lastSelectedName);
          if (entry) {
            e.preventDefault();
            void handlePreview(entry);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canNavigateUp,
    files,
    handleNavigateBack,
    handlePreview,
    lastSelectedName,
    onClose,
    selectedEntries.size,
  ]);

  const visibleTotalCount = dirs.length + files.length;
  const isAllSelected = selectedEntries.size === visibleTotalCount && visibleTotalCount > 0;

  return (
    <div className="dzb-container" onContextMenu={(e) => handleContextMenu(e, { kind: 'background' })}>
      {/* Top Header & Double-Layer Navigation */}
      <ZipHeaderToolbar
        archiveName={source.label}
        totalFiles={totalFilesCount}
        totalBytes={totalArchiveBytes}
        dominantType={dominantArchiveType}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        category={category}
        onCategoryChange={setCategory}
        categoryCounts={categoryCounts}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sortOption={sortOption}
        onSortChange={setSortOption}
        isPasswordProtected={entries.some((entry) => entry.encrypted)}
        onDownloadZip={onDownloadZip}
        onExtractAll={() => {
          selectAll();
          setShowExtractModal(true);
        }}
        onClose={onClose}
        nestedDepth={sources.length - 1}
        onBackNested={sources.length > 1 ? () => setSources((current) => current.slice(0, -1)) : undefined}
        currentPath={currentPath}
        onNavigateDir={setCurrentPath}
        currentFolderItemCount={visibleTotalCount}
        unloadedMediaCount={totalUnloadedMediaCount}
        isLoadingAllMedia={isBatchLoadingThumbs}
        onLoadAllThumbnails={() => void handleLoadAllThumbnails()}
      />

      {/* Main Content Surface with Marquee Selection Support */}
      <main
        ref={contentSurfaceRef}
        className={`dzb-content-surface ${marqueeBox ? 'is-marquee' : ''}`}
        onPointerDown={handleSurfacePointerDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {marqueeBox && (
          <div
            className="dzb-marquee-rect"
            style={{
              left: marqueeBox.x,
              top: marqueeBox.y,
              width: marqueeBox.w,
              height: marqueeBox.h,
            }}
          />
        )}

        {isLoading ? (
          <div className="dzb-state-center">
            <div className="dzb-preview-loading-card">
              <div className="dzb-dual-ring-wrap">
                <div className="dzb-dual-ring-spinner" />
                <div className="dzb-loading-icon-center text-indigo-400">
                  <Archive size={24} />
                </div>
              </div>

              <div className="dzb-loading-title-box">
                <h4 className="dzb-loading-title">{t('speedtest.zip_reading_index')}</h4>
                <p className="dzb-loading-sub">{t('speedtest.zip_sparse_reading_dots')}</p>
              </div>

              <div className="dzb-loading-shimmer-bar">
                <div className="dzb-loading-shimmer-thumb" />
              </div>

              <div className="dzb-loading-badge">
                <Zap size={12} className="text-amber-400" />
                <span>{t('speedtest.zip_sparse_direct_decrypt')}</span>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="dzb-state-center error">
            <FileWarning size={36} className="dzb-error-icon" />
            <span className="dzb-error-msg">{error}</span>
            <button type="button" onClick={() => void loadZipEntries()} className="dzb-btn-retry">
              <RefreshCw size={14} />
              <span>{t('speedtest.zip_retry')}</span>
            </button>
          </div>
        ) : visibleTotalCount === 0 ? (
          <div className="dzb-state-center empty">
            <FileWarning size={36} className="dzb-empty-icon" />
            <span className="dzb-state-text">{t('speedtest.zip_empty_search')}</span>
          </div>
        ) : viewMode === 'grid' ? (
          <ZipEntryGrid
            dirs={dirs}
            files={files}
            currentPath={currentPath}
            onNavigateDir={setCurrentPath}
            selectedEntries={selectedEntries}
            onSelectEntry={handleSelectEntry}
            onPreviewCode={handlePreview}
            onExtractEntry={(entry) => {
              setSelectedEntries(new Set([entry.name]));
              setShowExtractModal(true);
            }}
            onExtractDirectory={(path) => {
              setSelectedEntries(new Set([path]));
              setShowExtractModal(true);
            }}
            onContextMenu={handleContextMenu}
            thumbnails={thumbnails}
            loadingThumbnails={loadingThumbnails}
            onLoadThumbnail={handleLoadThumbnail}
          />
        ) : (
          <ZipEntryTable
            dirs={dirs}
            files={files}
            currentPath={currentPath}
            onNavigateDir={setCurrentPath}
            selectedEntries={selectedEntries}
            onSelectEntry={handleSelectEntry}
            onSelectAll={selectAll}
            isAllSelected={isAllSelected}
            onPreviewCode={handlePreview}
            onExtractEntry={(entry) => {
              setSelectedEntries(new Set([entry.name]));
              setShowExtractModal(true);
            }}
            onExtractDirectory={(path) => {
              setSelectedEntries(new Set([path]));
              setShowExtractModal(true);
            }}
            onContextMenu={handleContextMenu}
            thumbnails={thumbnails}
            loadingThumbnails={loadingThumbnails}
            onLoadThumbnail={handleLoadThumbnail}
          />
        )}
      </main>

      {/* Sleek Floating Batch Action Bar */}
      <ZipFloatingActionBar
        selectedCount={selectedEntries.size}
        selectedBytes={selectedBytes}
        unloadedMediaCount={selectedMediaUnloadedCount}
        onLoadSelectedThumbnails={handleLoadSelectedThumbnails}
        isLoadingThumbnails={isBatchLoadingThumbs}
        onExtract={() => setShowExtractModal(true)}
        onSelectAll={selectAll}
        onClear={() => setSelectedEntries(new Set())}
        isAllSelected={isAllSelected}
      />

      {/* Desktop-Grade Context Menu */}
      <ZipContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onPreview={handlePreview}
        onNavigateDir={setCurrentPath}
        onExtractEntry={(entry) => {
          setSelectedEntries(new Set([entry.name]));
          setShowExtractModal(true);
        }}
        onExtractDirectory={(path) => {
          setSelectedEntries(new Set([path]));
          setShowExtractModal(true);
        }}
        onExtractSelected={() => setShowExtractModal(true)}
        onSelectAll={selectAll}
        onInvertSelection={invertSelection}
        selectedCount={selectedEntries.size}
      />

      {/* Sub-Modals: Preview, Extract, Password */}
      <ZipCodePreviewModal
        entry={previewEntry}
        entries={files}
        preview={preview}
        localUrl={previewLocalUrl}
        isLoading={isPreviewLoading}
        error={previewError}
        onNavigate={(nextEntry) => void handlePreview(nextEntry)}
        onExtract={
          previewEntry
            ? () => {
                setSelectedEntries(new Set([previewEntry.name]));
                setShowExtractModal(true);
              }
            : undefined
        }
        onClose={() => {
          setPreviewEntry(null);
          setPreview(null);
          setPreviewLocalUrl(null);
          setPreviewError(null);
        }}
        folders={folders}
        chats={chats}
        creds={creds}
        folderId={folderId}
      />

      <ZipExtractModal
        isOpen={showExtractModal}
        selectedCount={selectedEntries.size}
        folders={folders}
        chats={chats}
        creds={creds}
        busy={extractBusy}
        progressLabel={extractProgress}
        onClose={() => {
          if (!extractBusy) setShowExtractModal(false);
        }}
        onConfirmExtract={(target) => void runExtraction(target)}
      />

      <ZipPasswordModal
        open={passwordAction != null}
        archiveLabel={source.label}
        error={passwordError}
        busy={isPreviewLoading || extractBusy}
        suggestions={passwordCandidates}
        onClose={() => setPasswordAction(null)}
        onSubmit={(password) => void submitPassword(password)}
      />
    </div>
  );
}
