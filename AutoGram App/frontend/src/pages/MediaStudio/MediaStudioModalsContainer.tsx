import React from 'react';
import { DrivePreviewModal } from '../../components/drive/DrivePreviewModal';
import { DriveContextMenu } from '../../components/drive/Modals/DriveContextMenu';
import { DriveConfirmDialog } from '../../components/drive/Modals/DriveConfirmDialog';
import { DriveInputDialog } from '../../components/drive/Modals/DriveInputDialog';
import { DriveDestinationPicker } from '../../components/drive/Modals/DriveDestinationPicker';
import { RemoteUploadModal } from '../../components/drive/Modals/RemoteUploadModal';
import { SessionRelogModal } from '../../components/drive/Modals/SessionRelogModal';
import type { DriveCredentials } from '../../lib/telegram/driveApi';
import type { DriveChat, DriveFile, DriveFolder } from '../../lib/telegram/driveTypes';

export interface MediaStudioModalsContainerProps {
  relogModalOpen?: boolean;
  setRelogModalOpen?: (open: boolean) => void;
  sessionName?: string;
  onNavigateToAccounts?: () => void;
  previewFile: DriveFile | null;
  setPreviewFile: (f: DriveFile | null) => void;
  peerId: number | null;
  creds: DriveCredentials | null;
  folders: DriveFolder[];
  chats: DriveChat[];
  refreshFiles: () => Promise<void>;
  refreshLocations: () => Promise<void>;
  openTransferManager: () => void;
  runUploadPaths: (paths: string[], opts?: any) => Promise<void>;
  handleEnqueueSingleDownload: (opts: { messageId: number; folderId: number | null; savePath: string; name: string }) => Promise<void>;
  previewIndex: number;
  sortedPreviewList: DriveFile[];
  
  contextMenu: any;
  setContextMenu: (menu: any) => void;
  downloadOne: (f: DriveFile) => void;
  openOneInSystem: (f: DriveFile) => void;
  openOneWithApp: (f: DriveFile) => void;
  revealOne: (f: DriveFile) => void;
  handleRename: (f: DriveFile) => void;
  handleDeleteIds: (ids: number[]) => void;
  handleMove: (f: DriveFile) => void;
  handleUpload: () => void;
  locationKind: 'saved' | 'drive' | 'chat';
  activePeerId: string | number | null;
  handleCreateFolder: (opts?: any) => void;
  handleCreateSubfolder: () => void;
  setLocationKind: (kind: 'saved' | 'drive' | 'chat') => void;
  setActivePeerId: (id: any) => void;
  setTopicFilter: (tf: any) => void;
  topicFilterRef: React.MutableRefObject<any>;
  handleDeleteFolder: (id: number, name: string) => void;
  handleRenameFolder: (id: number, name: string) => void;
  handleReparentFolder: (id: number, name: string) => void;
  labelDriveItem: (f: DriveFolder | undefined) => string;
  breadcrumbSegs: any[];
  setStatusText: (txt: string) => void;
  handleSelectAllDisplayed: () => void;
  clearSelection: () => void;
  selectedIds: number[];

  activeConfirm: any;
  closeDriveMoveConfirm: () => void;
  setConfirmDlg: (dlg: any) => void;

  inputDlg: any;
  setInputDlg: (dlg: any) => void;

  destPicker: any;
  setDestPicker: (picker: any) => void;

  remoteUploadOpen: boolean;
  setRemoteUploadOpen: (open: boolean) => void;
  handleRemoteUpload: (url: string, targetFolderId: number | null) => Promise<void>;
}

export const MediaStudioModalsContainer: React.FC<MediaStudioModalsContainerProps> = ({
  relogModalOpen,
  setRelogModalOpen,
  sessionName,
  onNavigateToAccounts,
  previewFile,
  setPreviewFile,
  peerId,
  creds,
  folders,
  chats,
  refreshFiles,
  refreshLocations,
  openTransferManager,
  runUploadPaths,
  handleEnqueueSingleDownload,
  previewIndex,
  sortedPreviewList,

  contextMenu,
  setContextMenu,
  downloadOne,
  openOneInSystem,
  openOneWithApp,
  revealOne,
  handleRename,
  handleDeleteIds,
  handleMove,
  handleUpload,
  locationKind,
  activePeerId,
  handleCreateFolder,
  handleCreateSubfolder,
  setLocationKind,
  setActivePeerId,
  setTopicFilter,
  topicFilterRef,
  handleDeleteFolder,
  handleRenameFolder,
  handleReparentFolder,
  labelDriveItem,
  breadcrumbSegs,
  setStatusText,
  handleSelectAllDisplayed,
  clearSelection,
  selectedIds,

  activeConfirm,
  closeDriveMoveConfirm,
  setConfirmDlg,

  inputDlg,
  setInputDlg,

  destPicker,
  setDestPicker,

  remoteUploadOpen,
  setRemoteUploadOpen,
  handleRemoteUpload,
}) => {
  return (
    <>
      {previewFile && creds && (
        <DrivePreviewModal
          file={previewFile}
          folderId={peerId}
          creds={creds}
          folders={folders}
          chats={chats}
          onRefreshDrive={() => {
            void refreshFiles();
            void refreshLocations();
          }}
          onOpenTransferManager={openTransferManager}
          onEnqueueUploadPaths={runUploadPaths}
          onEnqueueDownloadSingle={handleEnqueueSingleDownload}
          onClose={() => setPreviewFile(null)}
          hasPrev={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < sortedPreviewList.length - 1}
          neighborIds={
            previewIndex >= 0
              ? [
                  sortedPreviewList[previewIndex - 1]?.id,
                  sortedPreviewList[previewIndex + 1]?.id,
                  sortedPreviewList[previewIndex + 2]?.id,
                  sortedPreviewList[previewIndex + 3]?.id,
                  sortedPreviewList[previewIndex - 2]?.id,
                ].filter((id): id is number => typeof id === 'number' && id > 0)
              : []
          }
          onPrev={() => {
            if (previewIndex > 0) setPreviewFile(sortedPreviewList[previewIndex - 1]);
          }}
          onNext={() => {
            if (previewIndex >= 0 && previewIndex < sortedPreviewList.length - 1) {
              setPreviewFile(sortedPreviewList[previewIndex + 1]);
            }
          }}
        />
      )}

      {contextMenu && (
        <DriveContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={
            contextMenu.kind === 'file'
              ? { kind: 'file', file: contextMenu.file }
              : contextMenu.kind === 'location'
                ? {
                    kind: 'location',
                    locationKind: contextMenu.locationKind,
                    id: contextMenu.id,
                    name: contextMenu.name,
                  }
                : { kind: 'canvas' }
          }
          onClose={() => setContextMenu(null)}
          onPreview={
            contextMenu.kind === 'file'
              ? () => setPreviewFile(contextMenu.file)
              : undefined
          }
          onDownload={
            contextMenu.kind === 'file'
              ? () => downloadOne(contextMenu.file)
              : undefined
          }
          onOpenSystem={
            contextMenu.kind === 'file'
              ? () => openOneInSystem(contextMenu.file)
              : undefined
          }
          onOpenWith={
            contextMenu.kind === 'file'
              ? () => openOneWithApp(contextMenu.file)
              : undefined
          }
          onReveal={
            contextMenu.kind === 'file' ? () => revealOne(contextMenu.file) : undefined
          }
          onRename={
            contextMenu.kind === 'file' ? () => handleRename(contextMenu.file) : undefined
          }
          onDelete={
            contextMenu.kind === 'file'
              ? () => handleDeleteIds([contextMenu.file.id])
              : contextMenu.kind === 'canvas' && selectedIds.length > 0
                ? () => handleDeleteIds(selectedIds)
                : undefined
          }
          onMove={
            contextMenu.kind === 'file' ? () => handleMove(contextMenu.file) : undefined
          }
          onUpload={contextMenu.kind === 'canvas' ? handleUpload : undefined}
          onCreateFolder={
            contextMenu.kind === 'canvas'
              ? locationKind === 'drive' && activePeerId != null
                ? () => handleCreateFolder({ parentId: activePeerId })
                : () => handleCreateFolder({ parentId: null })
              : undefined
          }
          onCreateSubfolder={
            contextMenu.kind === 'location' && contextMenu.locationKind === 'drive' && contextMenu.id != null
              ? () => handleCreateFolder({ parentId: contextMenu.id })
              : contextMenu.kind === 'canvas' &&
                  (folders.length > 0 || (locationKind === 'drive' && activePeerId != null))
                ? handleCreateSubfolder
                : undefined
          }
          onOpenLocation={
            contextMenu.kind === 'location'
              ? () => {
                  if (contextMenu.locationKind === 'saved') {
                    setLocationKind('saved');
                    setActivePeerId(null);
                  } else if (contextMenu.locationKind === 'drive' && contextMenu.id != null) {
                    setLocationKind('drive');
                    setActivePeerId(contextMenu.id);
                  } else if (contextMenu.locationKind === 'chat' && contextMenu.id != null) {
                    setLocationKind('chat');
                    setActivePeerId(contextMenu.id);
                  }
                  setTopicFilter(null);
                  topicFilterRef.current = null;
                }
              : undefined
          }
          onDeleteFolder={
            contextMenu.kind === 'location' &&
            contextMenu.locationKind === 'drive' &&
            contextMenu.id != null
              ? () => handleDeleteFolder(contextMenu.id as number, contextMenu.name)
              : undefined
          }
          onRenameFolder={
            contextMenu.kind === 'location' &&
            contextMenu.locationKind === 'drive' &&
            contextMenu.id != null
              ? () => handleRenameFolder(contextMenu.id as number, contextMenu.name)
              : undefined
          }
          onReparentFolder={
            contextMenu.kind === 'location' &&
            contextMenu.locationKind === 'drive' &&
            contextMenu.id != null
              ? () => handleReparentFolder(contextMenu.id as number, contextMenu.name)
              : undefined
          }
          renameFolderLabel={
            contextMenu.kind === 'location' && contextMenu.locationKind === 'drive'
              ? `Ganti nama ${labelDriveItem(folders.find((f) => f.id === contextMenu.id))}…`
              : undefined
          }
          reparentFolderLabel="Pindah ke Drive/Folder…"
          deleteFolderLabel={
            contextMenu.kind === 'location' && contextMenu.locationKind === 'drive'
              ? `Hapus ${labelDriveItem(folders.find((f) => f.id === contextMenu.id))}…`
              : undefined
          }
          onCopyId={
            contextMenu.kind === 'location' && contextMenu.id != null
              ? () => {
                  const id = String(contextMenu.id);
                  void navigator.clipboard?.writeText(id).then(
                    () => setStatusText(`ID disalin: ${id}`),
                    () => setStatusText(`ID: ${id}`)
                  );
                }
              : contextMenu.kind === 'file'
                ? () => {
                    const file = contextMenu.file;
                    const segments = breadcrumbSegs
                      .map((s) => (s.id != null ? String(s.id) : null))
                      .filter(Boolean);
                    const fullPath = '/' + [...segments, String(file.id)].join('/');
                    void navigator.clipboard?.writeText(fullPath).then(
                      () => setStatusText(`ID disalin: ${fullPath}`),
                      () => setStatusText(`ID: ${fullPath}`)
                    );
                  }
                : undefined
          }
          onRefresh={contextMenu.kind === 'canvas' ? () => void refreshFiles() : undefined}
          onSelectAll={
            contextMenu.kind === 'canvas' ? handleSelectAllDisplayed : undefined
          }
          onClearSelection={
            contextMenu.kind === 'canvas' ? clearSelection : undefined
          }
          selectedCount={selectedIds.length}
          createFolderLabel={
            locationKind === 'drive' && activePeerId != null
              ? 'Buat folder di sini'
              : 'Buat Drive [TD] (root)'
          }
          createSubfolderLabel={
            locationKind === 'drive' && activePeerId != null
              ? 'Buat folder di Drive/Folder lain…'
              : 'Buat folder di…'
          }
          locationLabel={
            locationKind === 'saved'
              ? 'Saved Messages'
              : locationKind === 'drive'
                ? (() => {
                    const f = folders.find((x) => x.id === activePeerId);
                    const k = labelDriveItem(f);
                    return f ? `${f.name} (${k})` : 'Drive';
                  })()
                : chats.find((c) => c.id === activePeerId)?.name || 'Chat'
          }
        />
      )}

      <DriveConfirmDialog
        state={activeConfirm}
        onClose={() => {
          closeDriveMoveConfirm();
          setConfirmDlg(null);
        }}
      />
      <DriveInputDialog state={inputDlg} onClose={() => setInputDlg(null)} />
      <DriveDestinationPicker state={destPicker} onClose={() => setDestPicker(null)} />
      <RemoteUploadModal
        isOpen={remoteUploadOpen}
        onClose={() => setRemoteUploadOpen(false)}
        folders={chats
          .filter((c) => c.is_drive_folder || c.title_raw?.includes('[TD]') || c.name?.includes('[TD]'))
          .map((c) => ({ id: c.id, name: c.title_raw || c.name }))}
        onUpload={handleRemoteUpload}
      />
      <SessionRelogModal
        open={!!relogModalOpen}
        sessionName={sessionName || creds?.session || 'Lavender'}
        onClose={() => setRelogModalOpen?.(false)}
        onNavigateToAccounts={onNavigateToAccounts}
        onSuccess={() => void refreshFiles()}
      />
    </>
  );
};
