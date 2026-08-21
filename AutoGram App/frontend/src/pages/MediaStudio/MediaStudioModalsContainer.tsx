import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DrivePreviewModal } from '../../components/drive/DrivePreviewModal';
import { DriveContextMenu } from '../../components/drive/Modals/DriveContextMenu';
import { DriveConfirmDialog } from '../../components/drive/Modals/DriveConfirmDialog';
import { DriveInputDialog } from '../../components/drive/Modals/DriveInputDialog';
import { DriveDestinationPicker, type DriveDestChoice } from '../../components/drive/Modals/DriveDestinationPicker';
import { RemoteUploadModal } from '../../components/drive/Modals/RemoteUploadModal';
import { DriveFileInfoModal } from '../../components/drive/Modals/DriveFileInfoModal';
import { SessionRelogModal } from '../../components/drive/Modals/SessionRelogModal';
import type { DriveCredentials } from '../../lib/telegram/driveApi';
import type { DriveChat, DriveFile, DriveFolder, DriveTopic } from '../../lib/telegram/driveTypes';
import type { DuplicateContextInfo } from '../../components/drive/DrivePreviewModal';
import type { DriveTransferSettings } from '../../components/drive/Transfers/transferSettingsModel';
import { getSessionMetadata } from '../../lib/telegram/core/sessionPicker';
import { buildMediaPathId } from '../../components/drive/utils/mediaPathId';
import { nativeWriteClipboardText } from '../../lib/tauri/desktopClipboard';

export interface MediaStudioModalsContainerProps {
  relogModalOpen?: boolean;
  setRelogModalOpen?: (open: boolean) => void;
  sessionName?: string;
  onNavigateToAccounts?: () => void;
  previewFile: DriveFile | null;
  setPreviewFile: (file: DriveFile | null) => void;
  duplicateContext: DuplicateContextInfo | null;
  peerId: number | null;
  creds: DriveCredentials | null;
  folders: DriveFolder[];
  chats: DriveChat[];
  topics?: DriveTopic[];
  refreshFiles: () => Promise<void>;
  refreshLocations: () => Promise<void>;
  openTransferManager: (tab?: 'downloads' | 'uploads') => void;
  runUploadPaths: (paths: string[], opts?: { targetFolderId?: number | null; targetLabel?: string; topicId?: number | null; skipTopic?: boolean }) => Promise<void>;
  handleEnqueueSingleDownload: (opts: { messageId: number; folderId: number | null; savePath: string; name: string }) => Promise<void>;
  previewIndex: number;
  sortedPreviewList: DriveFile[];
  
  contextMenu: any;
  setContextMenu: (menu: any) => void;
  downloadOne: (file: DriveFile) => void;
  openOneInSystem: (file: DriveFile) => void;
  openOneWithApp: (file: DriveFile) => void;
  revealOne: (file: DriveFile) => void;
  handleRename: (file: DriveFile) => void;
  handleDeleteIds: (ids: number[]) => void;
  handleMove: (file: DriveFile) => void;
  handleUpload: () => void;
  locationKind: 'saved' | 'drive' | 'chat';
  activePeerId: number | null;
  handleCreateFolder: (opts?: { parentId?: number | null }) => void;
  handleCreateSubfolder: () => void;
  setLocationKind: (kind: 'saved' | 'drive' | 'chat') => void;
  setActivePeerId: (id: number | null) => void;
  setTopicFilter: (topicId: number | null) => void;
  topicFilterRef: React.MutableRefObject<number | null>;
  handleDeleteFolder: (folderId: number, folderName: string) => void;
  handleRenameFolder: (folderId: number, folderName: string) => void;
  handleReparentFolder: (folderId: number, folderName: string) => void;
  labelDriveItem: (folder?: DriveFolder) => string;
  breadcrumbSegs: any[];
  setStatusText: (text: string) => void;
  handleSelectAllDisplayed: () => void;
  clearSelection: () => void;
  selectedIds: number[];
  isLocationPinned: (kind: 'saved' | 'drive' | 'chat', id: number | null) => boolean;
  onToggleLocationPin: (kind: 'saved' | 'drive' | 'chat', id: number | null, name: string) => void;

  activeConfirm: any;
  closeDriveMoveConfirm: () => void;
  setConfirmDlg: (dlg: any) => void;

  inputDlg: any;
  setInputDlg: (dlg: any) => void;

  destPicker: any;
  setDestPicker: (picker: any) => void;

  remoteUploadOpen: boolean;
  remoteUploadInitialUrl?: string;
  setRemoteUploadOpen: (open: boolean) => void;
  transferSettings?: DriveTransferSettings | null;
  handleRemoteUpload: (
    urls: string | string[],
    destination: DriveDestChoice,
    opts?: { customFilename?: string; asDocument?: boolean }
  ) => Promise<void>;
  onOpenTelegramLink?: (url: string) => void;
  onBrowseTelegramDrive?: (url: string) => void;
  onJoinTelegramChat?: (url: string) => void;
  onSendToRemoteLink?: (url: string) => void;
}

export const MediaStudioModalsContainer: React.FC<MediaStudioModalsContainerProps> = ({
  relogModalOpen,
  setRelogModalOpen,
  sessionName,
  onNavigateToAccounts,
  previewFile,
  setPreviewFile,
  duplicateContext,
  peerId,
  creds,
  transferSettings,
  folders,
  chats,
  topics,
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
  breadcrumbSegs: _breadcrumbSegs,
  setStatusText,
  handleSelectAllDisplayed,
  clearSelection,
  selectedIds,
  isLocationPinned,
  onToggleLocationPin,

  activeConfirm,
  closeDriveMoveConfirm,
  setConfirmDlg,

  inputDlg,
  setInputDlg,

  destPicker,
  setDestPicker,

  remoteUploadOpen,
  remoteUploadInitialUrl,
  setRemoteUploadOpen,
  handleRemoteUpload,
  onOpenTelegramLink,
  onBrowseTelegramDrive,
  onJoinTelegramChat,
  onSendToRemoteLink,
}) => {
  const { t } = useTranslation();
  const [infoFile, setInfoFile] = useState<DriveFile | null>(null);
  const closeRemoteUpload = useCallback(() => setRemoteUploadOpen(false), [setRemoteUploadOpen]);
  const accountUserId = getSessionMetadata(sessionName || '')?.telegramUserId ||
    String(sessionName || '').replace(/^session_/, '') || '0';
  const activeChat = chats.find((chat) => Number(chat.id) === Number(activePeerId)) || null;
  const copyWithStatus = async (value: string, kind: 'id' | 'path') => {
    const success = await nativeWriteClipboardText(value);
    if (success) {
      setStatusText(t(kind === 'path' ? 'speedtest.copy_path_id_success' : 'speedtest.copy_id_success', { value }));
    } else {
      setStatusText(value);
    }
  };
  return (
    <>
      {previewFile && creds && (
        <DrivePreviewModal
          file={previewFile}
          folderId={peerId}
          creds={creds}
          folders={folders}
          chats={chats}
          duplicateContext={duplicateContext}
          onRefreshDrive={() => {
            void refreshFiles();
            void refreshLocations();
          }}
          onOpenTransferManager={openTransferManager}
          onEnqueueUploadPaths={runUploadPaths}
          onEnqueueDownloadSingle={handleEnqueueSingleDownload}
          onClose={() => {
            setPreviewFile(null);
          }}
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
          chatName={folders.find((f) => f.id === peerId)?.name || chats.find((c) => c.id === peerId)?.name || (locationKind === 'saved' ? 'Saved Messages' : undefined)}
          topicName={topicFilterRef?.current != null ? `Topik #${topicFilterRef.current}` : undefined}
          creds={creds}
          folderId={peerId}
          onPreview={
            contextMenu.kind === 'file'
              ? () => {
                  setPreviewFile(contextMenu.file);
                }
              : undefined
          }
          onInfo={
            contextMenu.kind === 'file'
              ? () => {
                  setInfoFile(contextMenu.file);
                }
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
          isPinned={
            contextMenu.kind === 'location'
              ? isLocationPinned(contextMenu.locationKind, contextMenu.id)
              : false
          }
          onTogglePin={
            contextMenu.kind === 'location' && contextMenu.locationKind !== 'saved'
              ? () => onToggleLocationPin(
                  contextMenu.locationKind,
                  contextMenu.id,
                  contextMenu.name
                )
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
            contextMenu.kind === 'location'
              ? () => {
                  const id = contextMenu.locationKind === 'saved' ? 'me' : String(contextMenu.id ?? 'me');
                  copyWithStatus(id, 'id');
                }
              : contextMenu.kind === 'file'
                ? () => {
                    copyWithStatus(String(contextMenu.file.id), 'id');
                  }
                : undefined
          }
          onCopyPathId={
            contextMenu.kind === 'location' || contextMenu.kind === 'file'
              ? () => {
                  const file = contextMenu.kind === 'file' ? contextMenu.file : null;
                  const path = buildMediaPathId({
                    accountUserId,
                    locationKind: contextMenu.kind === 'location' ? contextMenu.locationKind : locationKind,
                    peerId: contextMenu.kind === 'location' ? contextMenu.id : activePeerId,
                    topicId: file?.topic_id ?? topicFilterRef.current,
                    mediaId: file?.id ?? null,
                    chat: activeChat,
                    file,
                  });
                  copyWithStatus(path, 'path');
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
          onOpenTelegramLink={onOpenTelegramLink}
          onBrowseTelegramDrive={onBrowseTelegramDrive}
          onJoinTelegramChat={onJoinTelegramChat}
          onSendToRemoteLink={onSendToRemoteLink}
        />
      )}

      <DriveFileInfoModal
        file={infoFile}
        locationName={
          folders.find((f) => f.id === peerId)?.name ||
          chats.find((c) => c.id === peerId)?.name ||
          (locationKind === 'saved' ? String(t('speedtest.saved_messages')) : undefined)
        }
        pathId={infoFile ? buildMediaPathId({
          accountUserId,
          locationKind,
          peerId: activePeerId,
          topicId: infoFile.topic_id ?? topicFilterRef.current,
          mediaId: infoFile.id,
          chat: activeChat,
          file: infoFile,
        }) : null}
        onClose={() => setInfoFile(null)}
      />

      <DriveConfirmDialog
        state={activeConfirm}
        onClose={() => {
          closeDriveMoveConfirm();
          setConfirmDlg(null);
        }}
      />
      <DriveInputDialog state={inputDlg} onClose={() => setInputDlg(null)} />
      <DriveDestinationPicker state={destPicker} onClose={() => setDestPicker(null)} />
      {(() => {
        if (!remoteUploadOpen) return null;
        const driveEntries: DriveDestChoice[] = folders.map((f) => {
          const match = chats.find((c) => c.id === f.id);
          return {
            id: f.id as number | null,
            label: f.name,
            isForum: !!match?.is_forum,
            kind: 'drive' as const,
            type: match?.type || 'drive',
          };
        });
        const driveIds = new Set(driveEntries.map((e) => e.id));
        const allDestinations: DriveDestChoice[] = [
          { id: null, label: 'Saved Messages', isForum: false, kind: 'saved' },
          ...driveEntries,
          ...chats
            .filter((c) => !driveIds.has(c.id))
            .slice(0, 150)
            .map((c) => ({
              id: c.id as number | null,
              label: c.name,
              isForum: !!c.is_forum,
              kind: 'chat' as const,
              type: c.type,
            })),
        ];

        const activeTid = topicFilterRef?.current ?? null;
        const matchTopic = (activeTid != null && topics) ? topics.find((x) => x.id === activeTid) : null;
        const currentTopicName = matchTopic
          ? (matchTopic.title || `Topik #${matchTopic.id}`)
          : (activeTid != null ? `Topik #${activeTid}` : null);

        let currentDestChoice: DriveDestChoice = { id: null, label: 'Saved Messages', kind: 'saved' };
        if (locationKind === 'drive' && activePeerId != null) {
          const f = folders.find((x) => x.id === activePeerId);
          const match = chats.find((c) => c.id === activePeerId);
          currentDestChoice = {
            id: activePeerId,
            label: f?.name || 'Drive',
            kind: 'drive',
            isForum: !!match?.is_forum,
            topicId: activeTid,
            topicName: currentTopicName,
          };
        } else if (locationKind === 'chat' && activePeerId != null) {
          const c = chats.find((x) => x.id === activePeerId);
          currentDestChoice = {
            id: activePeerId,
            label: c?.name || 'Chat',
            kind: 'chat',
            type: c?.type,
            isForum: !!c?.is_forum,
            topicId: activeTid,
            topicName: currentTopicName,
          };
        }

        return (
          <RemoteUploadModal
            isOpen={remoteUploadOpen}
            initialUrl={remoteUploadInitialUrl}
            onClose={closeRemoteUpload}
            destinations={allDestinations}
            currentDestination={currentDestChoice}
            creds={creds}
            transferSettings={transferSettings}
            onUpload={handleRemoteUpload}
          />
        );
      })()}
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
