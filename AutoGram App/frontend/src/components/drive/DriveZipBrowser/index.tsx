import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { join, tempDir } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';
import type {
  Category,
  TargetDestination,
  ZipArchiveSource,
  ZipBrowserProps,
  ZipEntry,
  ZipPreviewResult,
} from './zipUtils';
import { basenamesAt, isZipArchiveName, safeZipEntryPath } from './zipUtils';
import { ZipHeaderToolbar } from './ZipHeaderToolbar';
import { ZipEntryTable } from './ZipEntryTable';
import { ZipCodePreviewModal } from './ZipCodePreviewModal';
import { ZipExtractModal } from './ZipExtractModal';
import { ZipPasswordModal } from './ZipPasswordModal';
import { driveZipExtractEntry, driveZipList, driveZipReadEntry } from '../../../lib/telegram/driveApi';
import { zipExtractEntry, zipListLocal, zipPreviewEntry } from '../../../lib/tauri/rustBackend';
import './DriveZipBrowser.css';

export { clearZipBrowserCache } from './zipUtils';

type PasswordAction =
  | { kind: 'preview'; entry: ZipEntry }
  | { kind: 'nested'; entry: ZipEntry }
  | { kind: 'extract'; target: TargetDestination }
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
    archiveName,
    onPrev,
    onNext,
    hasPrev,
    hasNext,
    onDownloadZip,
    folders = [],
    chats = [],
    onRefreshDrive,
    onOpenTransferManager,
    onEnqueueUploadPaths,
  } = props;
  const { t } = useTranslation();

  const [sources, setSources] = useState<ZipArchiveSource[]>([
    { kind: 'telegram', label: archiveName || t('speedtest.zip_archive_explorer') },
  ]);
  const source = sources[sources.length - 1];
  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
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
        const result = await driveZipList(creds, messageId, folderId);
        if (result.status === 'error') throw new Error(result.message || result.error);
        setEntries(Array.isArray(result.entries) ? result.entries : []);
      } else {
        const result = await zipListLocal(source.path);
        setEntries((result.entries || []).map((entry) => ({
          name: entry.name,
          size: Number(entry.size || 0),
          compressed_size: Number(entry.compressedSize || 0),
          is_dir: !!entry.isDir,
          method: entry.method,
          encrypted: !!entry.encrypted,
        })));
      }
    } catch (caught) {
      setEntries([]);
      setError(String((caught as Error)?.message || caught || t('speedtest.zip_list_failed')));
    } finally {
      setIsLoading(false);
    }
  }, [creds, folderId, messageId, source, t]);

  useEffect(() => {
    setCurrentPath('');
    setSearchQuery('');
    setSelectedEntries(new Set());
    setActivePassword(null);
    void loadZipEntries();
  }, [loadZipEntries]);

  const { dirs, files } = useMemo(
    () => basenamesAt(entries, currentPath, searchQuery, category),
    [entries, currentPath, searchQuery, category]
  );

  const materializeEntry = useCallback(async (entry: ZipEntry, password?: string | null) => {
    const root = await ensureTempRoot();
    const relative = safeZipEntryPath(entry.name) || `entry-${Date.now()}`;
    const destination = await join(root, ...relative.split('/'));
    if (source.kind === 'telegram') {
      await driveZipExtractEntry(creds, messageId, folderId, entry.name, destination, password || undefined);
    } else {
      await zipExtractEntry(source.path, entry.name, destination, password || undefined);
    }
    return destination;
  }, [creds, ensureTempRoot, folderId, messageId, source]);

  const readEntry = useCallback(async (entry: ZipEntry, password?: string | null) => {
    if (source.kind === 'telegram') {
      return await driveZipReadEntry(creds, messageId, folderId, entry.name, password || undefined) as ZipPreviewResult;
    }
    return mapLocalPreview(await zipPreviewEntry(source.path, entry.name, password || undefined));
  }, [creds, folderId, messageId, source]);

  const requestPassword = (action: Exclude<PasswordAction, null>, message?: string | null) => {
    setPasswordAction(action);
    setPasswordError(message || null);
  };

  const openNestedArchive = useCallback(async (entry: ZipEntry, password?: string | null) => {
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const path = await materializeEntry(entry, password ?? activePassword);
      await zipListLocal(path);
      setSources((current) => [...current, { kind: 'local', label: entry.name.split('/').pop() || entry.name, path, parentEntry: entry.name }]);
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
  }, [activePassword, materializeEntry, t]);

  const handlePreview = useCallback(async (entry: ZipEntry, password?: string | null) => {
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
  }, [activePassword, materializeEntry, openNestedArchive, readEntry, t]);

  const runExtraction = useCallback(async (target: TargetDestination, password?: string | null) => {
    if (!onEnqueueUploadPaths) {
      setError(t('speedtest.zip_upload_queue_unavailable'));
      return;
    }
    const selected = [...selectedEntries];
    const expanded = entries.filter((entry) => !entry.is_dir && !entry.isDir && selected.some((name) => entry.name === name || entry.name.startsWith(name.endsWith('/') ? name : `${name}/`)));
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
  }, [activePassword, entries, materializeEntry, onEnqueueUploadPaths, onOpenTransferManager, onRefreshDrive, selectedEntries, t]);

  const submitPassword = async (password: string) => {
    const action = passwordAction;
    if (!action) return;
    setActivePassword(password);
    setPasswordError(null);
    setPasswordAction(null);
    if (action.kind === 'preview') await handlePreview(action.entry, password);
    if (action.kind === 'nested') await openNestedArchive(action.entry, password);
    if (action.kind === 'extract') await runExtraction(action.target, password);
  };

  const toggleEntry = (name: string) => setSelectedEntries((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const selectAll = () => {
    const visibleNames = [...dirs, ...files.map((file) => file.name)];
    setSelectedEntries(selectedEntries.size === visibleNames.length ? new Set() : new Set(visibleNames));
  };

  return (
    <div className="dzb-container">
      <ZipHeaderToolbar
        archiveName={source.label}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        category={category}
        onCategoryChange={setCategory}
        isPasswordProtected={entries.some((entry) => entry.encrypted)}
        onExtractSelected={() => setShowExtractModal(true)}
        selectedCount={selectedEntries.size}
        onDownloadZip={onDownloadZip}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={onPrev}
        onNext={onNext}
        nestedDepth={sources.length - 1}
        onBackNested={sources.length > 1 ? () => setSources((current) => current.slice(0, -1)) : undefined}
      />

      {isLoading ? (
        <div className="dzb-loading-box"><div className="dzb-spinner" /><span>{t('speedtest.zip_reading_index')}</span></div>
      ) : error ? (
        <div className="dzb-error-box"><span>{error}</span><button type="button" onClick={() => void loadZipEntries()}>{t('speedtest.zip_retry')}</button></div>
      ) : (
        <ZipEntryTable
          dirs={dirs}
          files={files}
          currentPath={currentPath}
          onNavigateDir={setCurrentPath}
          selectedEntries={selectedEntries}
          onToggleSelectEntry={toggleEntry}
          onSelectAll={selectAll}
          isAllSelected={selectedEntries.size === dirs.length + files.length && dirs.length + files.length > 0}
          onPreviewCode={handlePreview}
          onExtractEntry={(entry) => { setSelectedEntries(new Set([entry.name])); setShowExtractModal(true); }}
          onExtractDirectory={(path) => { setSelectedEntries(new Set([path])); setShowExtractModal(true); }}
        />
      )}

      <ZipCodePreviewModal
        entry={previewEntry}
        preview={preview}
        localUrl={previewLocalUrl}
        isLoading={isPreviewLoading}
        error={previewError}
        onExtract={previewEntry ? () => { setSelectedEntries(new Set([previewEntry.name])); setShowExtractModal(true); } : undefined}
        onClose={() => { setPreviewEntry(null); setPreview(null); setPreviewLocalUrl(null); }}
      />

      <ZipExtractModal
        isOpen={showExtractModal}
        selectedCount={selectedEntries.size}
        folders={folders}
        chats={chats}
        busy={extractBusy}
        progressLabel={extractProgress}
        onClose={() => { if (!extractBusy) setShowExtractModal(false); }}
        onConfirmExtract={(target) => void runExtraction(target)}
      />

      <ZipPasswordModal
        open={passwordAction != null}
        archiveLabel={source.label}
        error={passwordError}
        busy={isPreviewLoading || extractBusy}
        onClose={() => setPasswordAction(null)}
        onSubmit={(password) => void submitPassword(password)}
      />
    </div>
  );
}
