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
  setFilteredTotalCountMap?: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
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
  setFilteredTotalCountMap,
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
          if (key === 'favorites') {
            if (nextPinned) {
              const alreadyHas = val.some((f) => f.id === targetId);
              nextMap[key] = alreadyHas
                ? val.map((f) => (f.id === targetId ? { ...f, is_pinned: true } : f))
                : [{ ...file, is_pinned: true }, ...val];
            } else {
              nextMap[key] = val.filter((f) => f.id !== targetId);
            }
          } else {
            nextMap[key] = updateList(val);
          }
        }
        if (nextPinned && !nextMap['favorites']) {
          nextMap['favorites'] = [{ ...file, is_pinned: true }];
        }
        return nextMap;
      });
      if (setFilteredTotalCountMap) {
        setFilteredTotalCountMap((prev) => {
          const cur = prev['favorites'] ?? 0;
          return {
            ...prev,
            favorites: nextPinned ? cur + 1 : Math.max(0, cur - 1),
          };
        });
      }
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
          if (setFilteredTotalCountMap) {
            setFilteredTotalCountMap((prev) => {
              const cur = prev['favorites'] ?? 0;
              return {
                ...prev,
                favorites: nextPinned ? Math.max(0, cur - 1) : cur + 1,
              };
            });
          }
          const revertList = (arr: DriveFile[]) =>
            arr.map((f) => (f.id === targetId ? { ...f, is_pinned: !nextPinned } : f));
          setFiles((prev) => revertList(prev));
          setFilteredFilesMap((prev) => {
            const nextMap: Record<string, DriveFile[]> = {};
            for (const [key, val] of Object.entries(prev)) {
              if (key === 'favorites') {
                if (nextPinned) {
                  // Failed to add: revert by removing
                  nextMap[key] = val.filter((f) => f.id !== targetId);
                } else {
                  // Failed to remove: revert by restoring
                  const alreadyHas = val.some((f) => f.id === targetId);
                  nextMap[key] = alreadyHas
                    ? val.map((f) => (f.id === targetId ? { ...f, is_pinned: true } : f))
                    : [{ ...file, is_pinned: true }, ...val];
                }
              } else {
                nextMap[key] = revertList(val);
              }
            }
            return nextMap;
          });
          if (liveFilesRef?.current) {
            liveFilesRef.current = revertList(liveFilesRef.current);
          }
          const errCode = String(res?.error?.code || '').toUpperCase();
          const errMsg = String(res?.error?.message || '').toUpperCase();
          const isPermissionErr =
            errCode.includes('ADMIN') ||
            errCode.includes('FORBIDDEN') ||
            errCode.includes('RIGHT') ||
            errMsg.includes('CHAT_ADMIN_REQUIRED') ||
            errMsg.includes('RIGHT_FORBIDDEN') ||
            errMsg.includes('PIN_RESTRICTED');

          showToast(
            isPermissionErr
              ? t('drive.toast_favorite_permission_error')
              : res?.error?.message || t('drive.toast_favorite_error'),
            'error'
          );
        }
      } catch (err: any) {
        // Revert optimistic update on exception
        if (setFilteredTotalCountMap) {
          setFilteredTotalCountMap((prev) => {
            const cur = prev['favorites'] ?? 0;
            return {
              ...prev,
              favorites: nextPinned ? Math.max(0, cur - 1) : cur + 1,
            };
          });
        }
        const revertList = (arr: DriveFile[]) =>
          arr.map((f) => (f.id === targetId ? { ...f, is_pinned: !nextPinned } : f));
        setFiles((prev) => revertList(prev));
        setFilteredFilesMap((prev) => {
          const nextMap: Record<string, DriveFile[]> = {};
          for (const [key, val] of Object.entries(prev)) {
            if (key === 'favorites') {
              if (nextPinned) {
                // Failed to add: revert by removing
                nextMap[key] = val.filter((f) => f.id !== targetId);
              } else {
                // Failed to remove: revert by restoring
                const alreadyHas = val.some((f) => f.id === targetId);
                nextMap[key] = alreadyHas
                  ? val.map((f) => (f.id === targetId ? { ...f, is_pinned: true } : f))
                  : [{ ...file, is_pinned: true }, ...val];
              }
            } else {
              nextMap[key] = revertList(val);
            }
          }
          return nextMap;
        });
        if (liveFilesRef?.current) {
          liveFilesRef.current = revertList(liveFilesRef.current);
        }
        setPreviewFile?.((prev) =>
          prev && prev.id === targetId ? { ...prev, is_pinned: !nextPinned } : prev
        );
        const errStr = String(err?.message || err || '').toUpperCase();
        const isPermissionErr =
          errStr.includes('ADMIN') ||
          errStr.includes('FORBIDDEN') ||
          errStr.includes('RIGHT') ||
          errStr.includes('PIN');

        showToast(
          isPermissionErr
            ? t('drive.toast_favorite_permission_error')
            : err?.message || t('drive.toast_favorite_error'),
          'error'
        );
      }
    },
    [creds, peerId, locationKind, setFiles, setFilteredFilesMap, setFilteredTotalCountMap, setPreviewFile, liveFilesRef, showToast, t]
  );

  return { handleToggleFavorite };
}
