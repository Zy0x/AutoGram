// @ts-nocheck
import { useCallback, useMemo, useEffect } from 'react';
import { resolveRemoteMediaUrl } from '../../../lib/telegram/linkResolvers';
import { detectTauriRuntime } from '../../../lib/tauri/platform';
import { invoke } from '@tauri-apps/api/core';
import { getProviderReferer } from '../../../features/remote-upload/providerCatalog';
import { canTransferResolvedFormat, sanitizeFilename, selectFormatByPreference } from '../../../features/remote-upload/domain';
import type { BatchMediaItem, BatchUrlResultGroup } from '../../../features/remote-upload/domain';
export function useRemoteUploadBatchActions(ctx: Record<string, any>) {
  const { t,batchUrls,setErrorMsg,batchInspectAbortRef,setBatchInspecting,setBatchInspectProgress,setIsEditingBatchText,setBatchGroups,setSelectedBatchItemIds,setFocusedBatchItem,batchGroups,focusedBatchItem,batchUrlsText,setBatchUrlsText,selectedBatchItemIds,batchItemDurations,setBatchItemDurations,batchPlayableUrl,setBatchPlayableUrl,batchQualityPreference,setBatchQualityPreference,queueDurationProbe,batchClickTimersRef,setCollapsedGroupIds,getMeasuredFormatBadge } = ctx;
  const handleInspectBatchUrls = useCallback(async () => {
    if (!batchUrls.length) {
      setErrorMsg(t('drive.remote_err_no_batch_urls'));
      return;
    }
    setErrorMsg('');
    if (batchInspectAbortRef.current) {
      batchInspectAbortRef.current.abort();
    }
    const controller = new AbortController();
    batchInspectAbortRef.current = controller;
    setBatchInspecting(true);
    setBatchInspectProgress({ current: 0, total: batchUrls.length });
    setIsEditingBatchText(false);

    const initialGroups: BatchUrlResultGroup[] = batchUrls.map((u, idx) => ({
      id: `batch_grp_${idx}_${u}`,
      sourceUrl: u,
      status: 'resolving',
      platformName: 'Remote URL',
      title: u,
      items: [],
      collapsed: false,
    }));
    setBatchGroups(initialGroups);

    const updatedGroups: BatchUrlResultGroup[] = [...initialGroups];
    const newSelectedIds = new Set<string>();
    let firstValidItem: BatchMediaItem | null = null;
    let completedCount = 0;

    const concurrency = 3;
    const queue = batchUrls.map((u, idx) => ({ url: u, index: idx }));

    const worker = async () => {
      while (queue.length > 0) {
        if (controller.signal.aborted) return;
        const task = queue.shift();
        if (!task) break;
        const { url: singleUrl, index: idx } = task;

        try {
          const res = await resolveRemoteMediaUrl(singleUrl, controller.signal);
          if (controller.signal.aborted) return;

          const items: BatchMediaItem[] = [];
          if (res.mediaItems && res.mediaItems.length > 0) {
            res.mediaItems.forEach((mItem, mIdx) => {
              const transferableFormats = mItem.formats.filter(canTransferResolvedFormat);
              const bestFmt = selectFormatByPreference(transferableFormats, batchQualityPreference) || transferableFormats[0];
              if (!bestFmt) return;
              const ext = bestFmt.ext || (mItem.kind === 'image' ? 'jpg' : 'mp4');
              const filename = sanitizeFilename(mItem.title.endsWith(`.${ext}`) ? mItem.title : `${mItem.title}.${ext}`);
              const isVid = mItem.kind === 'video' || bestFmt?.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
              const qualityBadge = getMeasuredFormatBadge(bestFmt, ext);
              const itemObj: BatchMediaItem = {
                id: `grp_${idx}_item_${mIdx}_${mItem.id}`,
                groupId: updatedGroups[idx].id,
                sourceUrl: singleUrl,
                title: mItem.title,
                filename,
                directUrl: bestFmt.directUrl,
                mux: bestFmt.mux,
                thumbnailUrl: mItem.thumbnailUrl,
                filesizeBytes: bestFmt?.mux?.estimatedSizeBytes || bestFmt?.filesizeBytes,
                durationSec: mItem.durationSec || bestFmt?.durationSec,
                qualityBadge,
                headers: bestFmt?.headers,
                isVideo: !!isVid,
                kind: isVid ? 'video' : mItem.kind === 'image' ? 'photo' : 'document',
              };
              items.push(itemObj);
              newSelectedIds.add(itemObj.id);
              if (!firstValidItem) firstValidItem = itemObj;
            });
          } else if (res.formats && res.formats.length > 0) {
            const transferableFormats = res.formats.filter(canTransferResolvedFormat);
            const masterFmt = selectFormatByPreference(transferableFormats, batchQualityPreference) || transferableFormats[0];
            if (!masterFmt) {
              updatedGroups[idx] = {
                ...updatedGroups[idx],
                status: 'error',
                errorMessage: t('drive.remote_native_interaction_required'),
                items: [],
              };
              continue;
            }
            if (masterFmt.isAlbumPack && masterFmt.allAlbumUrls && masterFmt.allAlbumUrls.length > 0) {
              masterFmt.allAlbumUrls.forEach((imgUrl, imgIdx) => {
                const filename = `Photo_${imgIdx + 1}_${Date.now()}.jpg`;
                const itemObj: BatchMediaItem = {
                  id: `grp_${idx}_photo_${imgIdx}`,
                  groupId: updatedGroups[idx].id,
                  sourceUrl: singleUrl,
                  title: `${res.title || 'Photo'} #${imgIdx + 1}`,
                  filename,
                  directUrl: imgUrl,
                  thumbnailUrl: imgUrl,
                  qualityBadge: 'PHOTO',
                  headers: masterFmt.headers,
                  isVideo: false,
                  kind: 'photo',
                };
                items.push(itemObj);
                newSelectedIds.add(itemObj.id);
                if (!firstValidItem) firstValidItem = itemObj;
              });
            } else {
              const ext = masterFmt.ext || 'mp4';
              const filename = sanitizeFilename(res.title.endsWith(`.${ext}`) ? res.title : `${res.title}.${ext}`);
              const isVid = masterFmt.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
              const qualityBadge = getMeasuredFormatBadge(masterFmt, ext);
              const itemObj: BatchMediaItem = {
                id: `grp_${idx}_master_0`,
                groupId: updatedGroups[idx].id,
                sourceUrl: singleUrl,
                title: res.title,
                filename,
                directUrl: masterFmt.directUrl,
                mux: masterFmt.mux,
                thumbnailUrl: res.thumbnailUrl,
                filesizeBytes: masterFmt.mux?.estimatedSizeBytes || masterFmt.filesizeBytes,
                durationSec: res.durationSec || masterFmt.durationSec,
                qualityBadge,
                headers: masterFmt.headers,
                isVideo: !!isVid,
                kind: isVid ? 'video' : 'document',
              };
              items.push(itemObj);
              newSelectedIds.add(itemObj.id);
              if (!firstValidItem) firstValidItem = itemObj;
            }
          } else {
            updatedGroups[idx] = {
              ...updatedGroups[idx],
              status: 'error',
              errorMessage: t('drive.remote_native_interaction_required'),
              items: [],
            };
            continue;
          }

          if (items.length === 0) {
            updatedGroups[idx] = {
              ...updatedGroups[idx],
              status: 'error',
              errorMessage: t('drive.remote_native_interaction_required'),
              items: [],
            };
            continue;
          }

          updatedGroups[idx] = {
            ...updatedGroups[idx],
            status: 'success',
            platformName: res.platformName || 'Remote Stream',
            title: res.title || singleUrl,
            items,
          };
          items.forEach((it) => queueDurationProbe(it));
        } catch (err: any) {
          if (controller.signal.aborted) return;
          updatedGroups[idx] = {
            ...updatedGroups[idx],
            status: 'error',
            errorMessage: err?.message || t('drive.remote_batch_error_title'),
            items: [],
          };
        } finally {
          completedCount++;
          setBatchInspectProgress({ current: completedCount, total: batchUrls.length });
          setBatchGroups([...updatedGroups]);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, batchUrls.length) }, () => worker());
    await Promise.all(workers);

    if (!controller.signal.aborted) {
      setSelectedBatchItemIds(newSelectedIds);
      if (firstValidItem) {
        setFocusedBatchItem(firstValidItem);
      }
      setBatchInspecting(false);
    }
  }, [batchUrls, t]);

  // Resolve stream proxy URL for focused batch video (handling Referer headers for Streamrizz, TikTok, X, etc.)
  useEffect(() => {
    let isCancelled = false;
    const rawUrl = focusedBatchItem?.directUrl;
    if (!rawUrl || !focusedBatchItem?.isVideo) {
      setBatchPlayableUrl('');
      return;
    }

    const referer = focusedBatchItem.headers?.Referer || getProviderReferer(rawUrl);

    if (detectTauriRuntime()) {
      invoke<string>('get_remote_stream_proxy_url', { url: rawUrl, referer })
        .then((proxied) => {
          if (!isCancelled) setBatchPlayableUrl(proxied);
        })
        .catch(() => {
          if (!isCancelled) setBatchPlayableUrl('');
        });
    } else {
      setBatchPlayableUrl(rawUrl);
    }

    return () => {
      isCancelled = true;
    };
  }, [focusedBatchItem]);

  const handleToggleBatchItem = useCallback((itemId: string) => {
    setSelectedBatchItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  // Card single-click and double-click logic for batch media cards
  const handleBatchCardClick = useCallback((item: BatchMediaItem) => {
    const existingTimer = batchClickTimersRef.current.get(item.id);
    if (existingTimer) {
      // Double click arrived! Set focus on preview
      clearTimeout(existingTimer);
      batchClickTimersRef.current.delete(item.id);
      setFocusedBatchItem(item);
      return;
    }

    const timer = setTimeout(() => {
      handleToggleBatchItem(item.id);
      batchClickTimersRef.current.delete(item.id);
    }, 220);

    batchClickTimersRef.current.set(item.id, timer);
  }, [handleToggleBatchItem]);

  const handleBatchCardDoubleClick = useCallback((item: BatchMediaItem) => {
    const existingTimer = batchClickTimersRef.current.get(item.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      batchClickTimersRef.current.delete(item.id);
    }
    setFocusedBatchItem(item);
  }, []);

  const handleToggleBatchGroup = useCallback((groupId: string, selectAll: boolean) => {
    setSelectedBatchItemIds((prev) => {
      const next = new Set(prev);
      const targetGroup = batchGroups.find((g) => g.id === groupId);
      if (targetGroup) {
        targetGroup.items.forEach((it) => {
          if (selectAll) {
            next.add(it.id);
          } else {
            next.delete(it.id);
          }
        });
      }
      return next;
    });
  }, [batchGroups]);

  const handleToggleAllBatchItems = useCallback((selectAll: boolean) => {
    if (selectAll) {
      const allIds = new Set<string>();
      batchGroups.forEach((g) => {
        g.items.forEach((it) => allIds.add(it.id));
      });
      setSelectedBatchItemIds(allIds);
    } else {
      setSelectedBatchItemIds(new Set());
    }
  }, [batchGroups]);

  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleRetryBatchGroup = useCallback(async (groupId: string) => {
    const targetGroup = batchGroups.find((g) => g.id === groupId);
    if (!targetGroup) return;

    setBatchGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, status: 'resolving', errorMessage: undefined } : g))
    );

    try {
      const res = await resolveRemoteMediaUrl(targetGroup.sourceUrl);
      const items: BatchMediaItem[] = [];
      const grpIdx = batchGroups.findIndex((g) => g.id === groupId);

      if (res.mediaItems && res.mediaItems.length > 0) {
        res.mediaItems.forEach((mItem, mIdx) => {
          const transferableFormats = mItem.formats.filter(canTransferResolvedFormat);
          const bestFmt = selectFormatByPreference(transferableFormats, batchQualityPreference) || transferableFormats[0];
          if (!bestFmt) return;
          const ext = bestFmt.ext || (mItem.kind === 'image' ? 'jpg' : 'mp4');
          const filename = sanitizeFilename(mItem.title.endsWith(`.${ext}`) ? mItem.title : `${mItem.title}.${ext}`);
          const isVid = mItem.kind === 'video' || bestFmt?.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
          const qualityBadge = getMeasuredFormatBadge(bestFmt, ext);
          const itemObj: BatchMediaItem = {
            id: `grp_${grpIdx}_item_${mIdx}_${mItem.id}`,
            groupId,
            sourceUrl: targetGroup.sourceUrl,
            title: mItem.title,
            filename,
            directUrl: bestFmt.directUrl,
            mux: bestFmt.mux,
            thumbnailUrl: mItem.thumbnailUrl,
            filesizeBytes: bestFmt?.mux?.estimatedSizeBytes || bestFmt?.filesizeBytes,
            durationSec: mItem.durationSec || bestFmt?.durationSec,
            qualityBadge,
            headers: bestFmt?.headers,
            isVideo: !!isVid,
            kind: isVid ? 'video' : mItem.kind === 'image' ? 'photo' : 'document',
          };
          items.push(itemObj);
        });
      } else if (res.formats && res.formats.length > 0) {
        const transferableFormats = res.formats.filter(canTransferResolvedFormat);
        const masterFmt = selectFormatByPreference(transferableFormats, batchQualityPreference) || transferableFormats[0];
        if (!masterFmt) throw new Error(t('drive.remote_native_interaction_required'));
        const ext = masterFmt.ext || 'mp4';
        const filename = sanitizeFilename(res.title.endsWith(`.${ext}`) ? res.title : `${res.title}.${ext}`);
        const isVid = masterFmt.isVideo || ext === 'mp4' || ext === 'mkv' || ext === 'webm';
        const qualityBadge = getMeasuredFormatBadge(masterFmt, ext);
        const itemObj: BatchMediaItem = {
          id: `grp_${grpIdx}_master_0`,
          groupId,
          sourceUrl: targetGroup.sourceUrl,
          title: res.title,
          filename,
          directUrl: masterFmt.directUrl,
          mux: masterFmt.mux,
          thumbnailUrl: res.thumbnailUrl,
          filesizeBytes: masterFmt.mux?.estimatedSizeBytes || masterFmt.filesizeBytes,
          durationSec: res.durationSec || masterFmt.durationSec,
          qualityBadge,
          headers: masterFmt.headers,
          isVideo: !!isVid,
          kind: isVid ? 'video' : 'document',
        };
        items.push(itemObj);
      }

      if (items.length === 0) throw new Error(t('drive.remote_native_interaction_required'));

      setBatchGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                status: 'success',
                platformName: res.platformName || 'Remote Stream',
                title: res.title || g.sourceUrl,
                items,
              }
            : g
        )
      );

      items.forEach((it) => queueDurationProbe(it));

      setSelectedBatchItemIds((prev) => {
        const next = new Set(prev);
        items.forEach((it) => next.add(it.id));
        return next;
      });

      if (items.length > 0 && !focusedBatchItem) {
        setFocusedBatchItem(items[0]);
      }
    } catch (err: any) {
      setBatchGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, status: 'error', errorMessage: err?.message || t('drive.remote_batch_error_title') }
            : g
        )
      );
    }
  }, [batchGroups, focusedBatchItem, t]);

  const handleRemoveBatchGroup = useCallback((groupId: string) => {
    const targetGroup = batchGroups.find((g) => g.id === groupId);
    if (!targetGroup) return;

    setSelectedBatchItemIds((prev) => {
      const next = new Set(prev);
      targetGroup.items.forEach((it) => next.delete(it.id));
      return next;
    });

    const remainingUrls = batchUrls.filter((u) => u !== targetGroup.sourceUrl);
    setBatchUrlsText(remainingUrls.join('\n'));
    setBatchGroups((prev) => prev.filter((g) => g.id !== groupId));

    if (focusedBatchItem && targetGroup.items.some((it) => it.id === focusedBatchItem.id)) {
      setFocusedBatchItem(null);
    }
  }, [batchGroups, batchUrls, focusedBatchItem]);

  const allBatchItems = useMemo(() => {
    const list: BatchMediaItem[] = [];
    batchGroups.forEach((g) => {
      if (g.status === 'success') {
        g.items.forEach((it) => list.push(it));
      }
    });
    return list;
  }, [batchGroups]);

  const selectedBatchItems = useMemo(() => {
    return allBatchItems.filter((it) => selectedBatchItemIds.has(it.id));
  }, [allBatchItems, selectedBatchItemIds]);

  const selectedBatchBytes = useMemo(() => {
    return selectedBatchItems.reduce((acc, it) => acc + (it.filesizeBytes || 0), 0);
  }, [selectedBatchItems]);
  return { handleInspectBatchUrls, handleToggleBatchItem, handleBatchCardClick, handleBatchCardDoubleClick, handleToggleBatchGroup, handleToggleAllBatchItems, handleToggleGroupCollapse, handleRetryBatchGroup, handleRemoveBatchGroup, allBatchItems, selectedBatchItems, selectedBatchBytes };
}
