import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { driveTogglePinMedia } from '../../../lib/telegram/driveApi';

interface UseDriveFavoriteToggleParams {
  creds: DriveCredentials | null;
  peerId: number | null;
  locationKind: 'saved' | 'drive' | 'chat';
  setFiles: React.Dispatch<React.SetStateAction<DriveFile[]>>;
  setFilteredFilesMap: React.Dispatch<React.SetStateAction<Record<string, DriveFile[]>>>;
  setPreviewFile?: React.Dispatch<React.SetStateAction<DriveFile | null>>;
  liveFilesRef?: React.MutableRefObject<DriveFile[]>;
  showToast: (message: string, tone?: 'info' | 'warn' | 'error') => void;
}

export function useDriveFavoriteToggle({
  creds,
  peerId,
  locationKind,
  setFiles,
  setFilteredFilesMap,
  setPreviewFile,
  liveFilesRef,
  showToast,
}: UseDriveFavoriteToggleParams) {
  const { t } = useTranslation();

  const handleToggleFavorite = useCallback(
    async (file: DriveFile) => {
      if (!creds) return;
      const targetId = file.id;
      const nextPinned = !Boolean(file.is_pinned);

      // Optimistic update
      const updateList = (arr: DriveFile[]) =>
        arr.map((f) => (f.id === targetId ? { ...f, is_pinned: nextPinned } : f));

      setFiles((prev) => updateList(prev));
      setFilteredFilesMap((prev) => {
        const nextMap: Record<string, DriveFile[]> = {};
        for (const [key, val] of Object.entries(prev)) {
          nextMap[key] = updateList(val);
        }
        return nextMap;
      });
      if (liveFilesRef?.current) {
        liveFilesRef.current = updateList(liveFilesRef.current);
      }
      setPreviewFile?.((prev) =>
        prev && prev.id === targetId ? { ...prev, is_pinned: nextPinned } : prev
      );

      try {
        const chatId =
          locationKind === 'saved' || file.is_saved_messages || !file.peer_id
            ? peerId == null
              ? 'me'
              : String(peerId)
            : String(file.peer_id);

        const res = await driveTogglePinMedia(creds, chatId, targetId, !nextPinned);
        if (res?.ok) {
          showToast(
            nextPinned ? t('drive.toast_favorite_added') : t('drive.toast_favorite_removed'),
            'info'
          );
        } else {
          // Revert optimistic update
          const revertList = (arr: DriveFile[]) =>
            arr.map((f) => (f.id === targetId ? { ...f, is_pinned: !nextPinned } : f));
          setFiles((prev) => revertList(prev));
          setFilteredFilesMap((prev) => {
            const nextMap: Record<string, DriveFile[]> = {};
            for (const [key, val] of Object.entries(prev)) {
              nextMap[key] = revertList(val);
            }
            return nextMap;
          });
          if (liveFilesRef?.current) {
            liveFilesRef.current = revertList(liveFilesRef.current);
          }
          setPreviewFile?.((prev) =>
            prev && prev.id === targetId ? { ...prev, is_pinned: !nextPinned } : prev
          );
          showToast(res?.error?.message || t('drive.toast_favorite_error'), 'error');
        }
      } catch (err: any) {
        // Revert optimistic update on exception
        const revertList = (arr: DriveFile[]) =>
          arr.map((f) => (f.id === targetId ? { ...f, is_pinned: !nextPinned } : f));
        setFiles((prev) => revertList(prev));
        setFilteredFilesMap((prev) => {
          const nextMap: Record<string, DriveFile[]> = {};
          for (const [key, val] of Object.entries(prev)) {
            nextMap[key] = revertList(val);
          }
          return nextMap;
        });
        if (liveFilesRef?.current) {
          liveFilesRef.current = revertList(liveFilesRef.current);
        }
        setPreviewFile?.((prev) =>
          prev && prev.id === targetId ? { ...prev, is_pinned: !nextPinned } : prev
        );
        showToast(err?.message || t('drive.toast_favorite_error'), 'error');
      }
    },
    [creds, peerId, locationKind, setFiles, setFilteredFilesMap, setPreviewFile, liveFilesRef, showToast, t]
  );

  return { handleToggleFavorite };
}
