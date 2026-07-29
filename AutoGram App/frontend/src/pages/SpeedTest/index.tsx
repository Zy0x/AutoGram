import { useState, useEffect, useCallback } from 'react';
import { DriveFile, DriveFolder, DriveChat, DriveTopic, DriveMediaFilter, DriveViewMode, DriveSortMode } from '../../lib/driveTypes';
import { DriveCredentials, driveListFiles, driveCreateFolder, driveDeleteBatch, driveRename } from '../../lib/driveApi';
import { getApiIdSync, getApiHashSync } from '../../lib/secureCredentials';
import { SpeedTestSidebar } from './SpeedTestSidebar';
import { SpeedTestToolbar } from './SpeedTestToolbar';
import { SpeedTestGrid } from './SpeedTestGrid';
import { SpeedTestModals } from './SpeedTestModals';
import { DrivePreviewModal } from '../../components/media-drive/DrivePreviewModal';
import { SpeedTestProps, readSessionsCache, LS_SESSION } from './speedTestUtils';

export function MediaDriveDesktop(_props: SpeedTestProps) {
  const [sessions] = useState<string[]>(() => readSessionsCache());
  const [session, setSession] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_SESSION) || '';
    } catch {
      return '';
    }
  });

  const creds: DriveCredentials = {
    session: session,
    apiId: getApiIdSync(),
    apiHash: getApiHashSync(),
  };

  const [folders] = useState<DriveFolder[]>([]);
  const [chats] = useState<DriveChat[]>([]);
  const [topics] = useState<DriveTopic[]>([]);

  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [activePeerId, setActivePeerId] = useState<string | number | null>(null);
  const [activeTopicId, setActiveTopicId] = useState<number | null>(null);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [mediaFilter, setMediaFilter] = useState<DriveMediaFilter>('all');
  const [viewMode, setViewMode] = useState<DriveViewMode>('grid');
  const [sortMode, setSortMode] = useState<DriveSortMode>('newest');

  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);

  const [showNewFolderModal, setShowNewFolderModal] = useState<boolean>(false);
  const [renameTargetFile, setRenameTargetFile] = useState<DriveFile | null>(null);
  const [deleteTargetFiles, setDeleteTargetFiles] = useState<DriveFile[]>([]);
  const [moveTargetFiles, setMoveTargetFiles] = useState<DriveFile[]>([]);

  const [isRailCollapsed, setIsRailCollapsed] = useState<boolean>(false);

  const loadFiles = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const res = await driveListFiles(creds, activeFolderId, { pageSize: 100 });
      if (res && Array.isArray(res.files)) {
        setFiles(res.files);
      }
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, [session, activeFolderId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleSelectSession = (sess: string) => {
    setSession(sess);
    try {
      localStorage.setItem(LS_SESSION, sess);
    } catch {
      /* ignore */
    }
  };

  const handleToggleSelectFile = (id: number) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreateFolder = async (name: string) => {
    setShowNewFolderModal(false);
    try {
      await driveCreateFolder(creds, name, { parentId: activeFolderId });
      loadFiles();
    } catch {
      /* ignore */
    }
  };

  const handleConfirmRename = async (fileId: number, newName: string) => {
    setRenameTargetFile(null);
    try {
      await driveRename(creds, fileId, activeFolderId, newName);
      loadFiles();
    } catch {
      /* ignore */
    }
  };

  const handleConfirmDelete = async (targetFiles: DriveFile[]) => {
    setDeleteTargetFiles([]);
    try {
      const ids = targetFiles.map((f) => f.id);
      await driveDeleteBatch(creds, ids, activeFolderId);
      loadFiles();
    } catch {
      /* ignore */
    }
  };

  const handleConfirmMove = () => {
    setMoveTargetFiles([]);
  };

  const displayedFiles = files.filter((f) => {
    if (searchQuery && !f.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (mediaFilter !== 'all') {
      const mime = (f.mime_type || '').toLowerCase();
      if (mediaFilter === 'image' && !mime.startsWith('image/')) return false;
      if (mediaFilter === 'video' && !mime.startsWith('video/')) return false;
      if (mediaFilter === 'document' && !mime.startsWith('text/') && mime !== 'application/pdf') return false;
    }
    return true;
  });

  return (
    <div className="flex w-full h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      <SpeedTestSidebar
        sessions={sessions}
        currentSession={session}
        onSelectSession={handleSelectSession}
        folders={folders}
        activeFolderId={activeFolderId}
        onSelectFolder={(id) => {
          setActiveFolderId(id);
          setActivePeerId(null);
        }}
        chats={chats}
        activePeerId={activePeerId}
        onSelectPeer={(id) => {
          setActivePeerId(id);
          setActiveFolderId(null);
        }}
        topics={topics}
        activeTopicId={activeTopicId}
        onSelectTopic={setActiveTopicId}
        isRailCollapsed={isRailCollapsed}
        onToggleRail={() => setIsRailCollapsed(!isRailCollapsed)}
        onNewFolder={() => setShowNewFolderModal(true)}
        onRefreshSidebar={loadFiles}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        <SpeedTestToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          mediaFilter={mediaFilter}
          onMediaFilterChange={setMediaFilter}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          onUploadClick={() => {}}
        />

        <SpeedTestGrid
          folders={folders}
          files={displayedFiles}
          viewMode={viewMode}
          isLoading={isLoading}
          selectedFileIds={selectedFileIds}
          onToggleSelectFile={handleToggleSelectFile}
          onOpenFolder={setActiveFolderId}
          onOpenFilePreview={setPreviewFile}
          onRenameFile={setRenameTargetFile}
          onDeleteFile={(f) => setDeleteTargetFiles([f])}
          onDownloadFile={() => {}}
          isDragOver={false}
        />

        <SpeedTestModals
          showNewFolderModal={showNewFolderModal}
          onCloseNewFolderModal={() => setShowNewFolderModal(false)}
          onCreateFolder={handleCreateFolder}
          renameTargetFile={renameTargetFile}
          onCloseRenameModal={() => setRenameTargetFile(null)}
          onConfirmRename={handleConfirmRename}
          deleteTargetFiles={deleteTargetFiles}
          onCloseDeleteModal={() => setDeleteTargetFiles([])}
          onConfirmDelete={handleConfirmDelete}
          moveTargetFiles={moveTargetFiles}
          folders={folders}
          onCloseMoveModal={() => setMoveTargetFiles([])}
          onConfirmMove={handleConfirmMove}
        />

        {previewFile && (
          <DrivePreviewModal
            file={previewFile}
            folderId={activeFolderId}
            creds={creds}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </div>
    </div>
  );
}

export function SpeedTest({ onExitToApp }: SpeedTestProps = {}) {
  return <MediaDriveDesktop onExitToApp={onExitToApp} />;
}

export default SpeedTest;
