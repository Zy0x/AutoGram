import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ZipBrowserProps,
  ZipEntry,
  Category,
  basenamesAt,
} from './zipUtils';
import { ZipHeaderToolbar } from './ZipHeaderToolbar';
import { ZipEntryTable } from './ZipEntryTable';
import { ZipCodePreviewModal } from './ZipCodePreviewModal';
import { ZipExtractModal } from './ZipExtractModal';
import { driveZipList, driveZipReadEntry } from '../../../lib/driveApi';

export const DriveZipBrowser: React.FC<ZipBrowserProps> = (props) => {
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
  } = props;

  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [category, setCategory] = useState<Category>('all');
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [previewEntry, setPreviewEntry] = useState<ZipEntry | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [showExtractModal, setShowExtractModal] = useState<boolean>(false);

  const loadZipEntries = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await driveZipList(creds, messageId, folderId);
      if (res && Array.isArray(res.entries)) {
        setEntries(res.entries);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to list zip entries');
    } finally {
      setIsLoading(false);
    }
  }, [creds, messageId, folderId]);

  useEffect(() => {
    loadZipEntries();
  }, [loadZipEntries]);

  const { dirs, files } = useMemo(() => {
    return basenamesAt(entries, currentPath, searchQuery, category);
  }, [entries, currentPath, searchQuery, category]);

  const handleToggleSelectEntry = (name: string) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedEntries.size === files.length && files.length > 0) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(files.map((f) => f.name)));
    }
  };

  const handlePreviewCode = async (entry: ZipEntry) => {
    setPreviewEntry(entry);
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await driveZipReadEntry(creds, messageId, folderId, entry.name);
      if (typeof res === 'string') {
        setPreviewCode(res);
      } else if (res && typeof (res as any).text === 'string') {
        setPreviewCode((res as any).text);
      }
    } catch (err: any) {
      setPreviewError(err.message || 'Failed to read zip file entry');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleConfirmExtract = (_targetFolderId: number | null) => {
    setShowExtractModal(false);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      <ZipHeaderToolbar
        archiveName={archiveName}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        category={category}
        onCategoryChange={setCategory}
        isPasswordProtected={false}
        onExtractSelected={() => setShowExtractModal(true)}
        selectedCount={selectedEntries.size}
        onDownloadZip={onDownloadZip}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={onPrev}
        onNext={onNext}
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 gap-2 font-mono text-xs">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span>Reading archive index...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-red-400 gap-2 p-6 text-center text-xs">
          <span>{error}</span>
        </div>
      ) : (
        <ZipEntryTable
          dirs={dirs}
          files={files}
          currentPath={currentPath}
          onNavigateDir={setCurrentPath}
          selectedEntries={selectedEntries}
          onToggleSelectEntry={handleToggleSelectEntry}
          onSelectAll={handleSelectAll}
          isAllSelected={selectedEntries.size === files.length && files.length > 0}
          onPreviewCode={handlePreviewCode}
          onExtractEntry={(entry) => {
            setSelectedEntries(new Set([entry.name]));
            setShowExtractModal(true);
          }}
        />
      )}

      <ZipCodePreviewModal
        entry={previewEntry}
        content={previewCode}
        isLoading={isPreviewLoading}
        error={previewError}
        onClose={() => setPreviewEntry(null)}
      />

      <ZipExtractModal
        isOpen={showExtractModal}
        selectedCount={selectedEntries.size}
        folders={folders}
        onClose={() => setShowExtractModal(false)}
        onConfirmExtract={handleConfirmExtract}
      />
    </div>
  );
};
