// Transitional extraction boundary; submit behavior is kept isolated from the
// modal while its domain context is consolidated into a typed contract.
// @ts-nocheck
import type React from 'react';
import type { RemoteMuxSpec } from '../../../lib/telegram/linkResolvers';
import { dispatchRemoteDestination } from '../../../features/remote-download/dispatch';
export function createRemoteUploadSubmitHandler(ctx: Record<string, any>) {
  const { t,setErrorMsg,setSubmitting,tab,url,passcode,customFilename,customCaption,resolvedMedia,effectiveMediaItems,selectedItems,selectedDest,onUpload,onClose,deliveryMode,remoteEngineMode,storagePolicy,customDiskPath,selectedBatchItems,batchGroups,isEditingBatchText,handleInspectBatchUrls,canTransferResolvedFormat,getEffectiveFormatFilename,resolveRemoteMediaUrl,hasKnownRemoteProvider,selectedFormatId,itemCustomNames,itemSelectedFormats } = ctx;
  const submitToDestination = async (urls, dest, options) => {
    try { return await dispatchRemoteDestination(urls, dest, options, onUpload); }
    catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code.startsWith('remote_download_')) throw new Error(t(`drive_tools.${code}`, { defaultValue: t('drive_tools.local_download_failed_hint') }));
      throw error;
    }
  };
  return async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (tab === 'single') {
      const targetUrl = url.trim();
      if (!targetUrl) {
        setErrorMsg(t('drive.remote_err_empty'));
        return;
      }
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        setErrorMsg(t('drive.remote_err_invalid_protocol'));
        return;
      }
      // A URL is never an implicit upload fallback. Every single-item
      // transfer must originate from a resolver candidate that passed its
      // public validation, otherwise an advertising/wrapper page could be
      // handed to the transfer engine as if it were a media file.
      let activeResolved = resolvedMedia;
      if (!activeResolved || activeResolved.formats.length === 0) {
        setSubmitting(true);
        try {
          activeResolved = await resolveRemoteMediaUrl(targetUrl, undefined, { passcode });
        } catch {
          /* fallback */
        }
      }

      if (!activeResolved || activeResolved.formats.length === 0) {
        setSubmitting(false);
        setErrorMsg(activeResolved?.description || t('drive.remote_native_interaction_required'));
        return;
      }

      // Multi-media card upload flow
      if (effectiveMediaItems.length > 1) {
        if (selectedItems.length === 0) {
          setErrorMsg(t('drive.remote_btn_select_at_least_one'));
          return;
        }

        setSubmitting(true);
        try {
          const uploadUrls: string[] = [];
          const uploadFilenames: string[] = [];
          const uploadSizes: number[] = [];
          const uploadThumbs: string[] = [];
          const uploadReferers: Array<string | undefined> = [];
          const remoteMuxes: Array<RemoteMuxSpec | null> = [];

          for (const item of selectedItems) {
            const chosenFmtId = itemSelectedFormats[item.id] || item.selectedFormatId || item.formats[0]?.id;
            let chosenFmt = item.formats.find((f) => f.id === chosenFmtId);
            if (!canTransferResolvedFormat(chosenFmt)) {
              chosenFmt = item.formats.find(canTransferResolvedFormat) || item.formats[0];
            }
            if (canTransferResolvedFormat(chosenFmt)) {
              uploadUrls.push(chosenFmt.directUrl);
              const origName = getEffectiveFormatFilename(chosenFmt, activeResolved) || item.title;
              const finalName = itemCustomNames[item.id]?.trim() || origName;
              uploadFilenames.push(finalName);
              uploadSizes.push(chosenFmt.mux?.estimatedSizeBytes || chosenFmt.filesizeBytes || 0);
              uploadThumbs.push(chosenFmt.thumbnailUrl || item.thumbnailUrl || activeResolved?.thumbnailUrl || '');
              uploadReferers.push(chosenFmt.headers?.Referer || activeResolved?.url || targetUrl);
              remoteMuxes.push(chosenFmt.mux || null);
            }
          }

          if (uploadUrls.length === 0) {
            setErrorMsg(t('drive.remote_btn_select_at_least_one'));
            return;
          }

          const effectiveQualityMode =
            deliveryMode === 'uncompressed'
              ? 'ORIGINAL'
              : deliveryMode === 'document'
                ? 'DOCUMENT'
                : 'SMART';
          const effectivePresentation =
            deliveryMode === 'document'
              ? 'document'
              : deliveryMode === 'uncompressed'
                ? 'original'
                : 'standard';

          // Clean modal handoff: Close RemoteUploadModal immediately so preflight dialog has full focus
          onClose();

          await submitToDestination(uploadUrls, selectedDest, {
            customFilename: uploadFilenames.length === 1 ? (customFilename.trim() || uploadFilenames[0]) : undefined,
            customFilenames: uploadFilenames,
            sourceSizes: uploadSizes,
            thumbnailUrls: uploadThumbs,
            asDocument: deliveryMode === 'document',
            qualityMode: effectiveQualityMode,
            presentationOverride: effectivePresentation,
            remoteEngineMode,
            storagePolicy,
            customDiskPath: customDiskPath.trim() || undefined,
            customCaption: customCaption?.trim() || undefined,
            remoteMuxes,
            referers: uploadReferers,
          });
        } catch (err: any) {
          setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
        } finally {
          setSubmitting(false);
        }
        return;
      }

      setSubmitting(true);
      try {
        let activeFormat =
          (selectedFormatId ? activeResolved?.formats.find((f) => f.id === selectedFormatId) : undefined);
        if (!canTransferResolvedFormat(activeFormat)) {
          activeFormat = activeResolved?.formats.find(canTransferResolvedFormat) || activeResolved?.formats[0];
        }
        if (!activeFormat || !canTransferResolvedFormat(activeFormat)) {
          setErrorMsg(activeResolved?.description || t('drive.remote_native_interaction_required'));
          return;
        }
        const effectiveFilename =
          customFilename.trim() ||
          getEffectiveFormatFilename(activeFormat, activeResolved);

        const isAlbum = Boolean(activeFormat?.isAlbumPack && activeFormat.allAlbumUrls && activeFormat.allAlbumUrls.length > 0);
        const isZipPack = isAlbum && (activeFormat?.ext === 'zip' || activeFormat?.id?.includes('pack'));
        let uploadUrls: string[];
        let uploadFilenames: string[];
        let zipUrls: string[] | undefined = undefined;

        if (isAlbum) {
          if (storagePolicy === 'custom_disk' && isZipPack) {
            uploadUrls = [activeFormat!.allAlbumUrls![0]];
            const cleanZipName = effectiveFilename.toLowerCase().endsWith('.zip') ? effectiveFilename : `${effectiveFilename}.zip`;
            uploadFilenames = [cleanZipName];
            zipUrls = activeFormat!.allAlbumUrls!;
          } else {
            uploadUrls = activeFormat!.allAlbumUrls!;
            const baseStem = effectiveFilename.replace(/\.[a-z0-9]+$/i, '');
            const itemExt = activeFormat!.ext === 'zip' ? 'jpg' : (activeFormat!.ext || 'bin');
            uploadFilenames = uploadUrls.map((_, i) => `${baseStem} - Part ${i + 1}.${itemExt}`);
          }
        } else {
          uploadUrls = [activeFormat!.directUrl];
          uploadFilenames = [effectiveFilename];
        }

        const existingThumb = activeFormat?.thumbnailUrl || activeResolved?.thumbnailUrl;
        let liveVideoThumb: string | undefined = undefined;
        if (!existingThumb) {
          try {
            const activeVideoEl = document.querySelector<HTMLVideoElement>('.td-remote-big-canvas-video, .td-remote-stream-player-col video, .td-remote-media-player video');
            if (activeVideoEl && activeVideoEl.videoWidth > 0 && activeVideoEl.videoHeight > 0) {
              const c = document.createElement('canvas');
              c.width = Math.min(480, activeVideoEl.videoWidth);
              c.height = Math.round((c.width * activeVideoEl.videoHeight) / activeVideoEl.videoWidth);
              const ctx = c.getContext('2d');
              if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'medium';
                ctx.drawImage(activeVideoEl, 0, 0, c.width, c.height);
                const url = c.toDataURL('image/jpeg', 0.8);
                if (url && url.length > 100) {
                  liveVideoThumb = url;
                }
              }
            }
          } catch {
            /* ignore */
          }
        }

        const uploadSize = activeFormat?.mux?.estimatedSizeBytes || activeFormat?.filesizeBytes;
        const uploadSizes = uploadSize ? [uploadSize] : undefined;
        const finalThumb = existingThumb || liveVideoThumb;
        const uploadThumbs = finalThumb ? [finalThumb] : undefined;
        const remoteMuxes: Array<RemoteMuxSpec | null> = [activeFormat?.mux || null];
        const refererUrl = activeFormat?.headers?.Referer || activeResolved?.url || targetUrl;
        const uploadReferers = uploadUrls.map(() => refererUrl);

        const effectiveQualityMode =
          deliveryMode === 'uncompressed'
            ? 'ORIGINAL'
            : deliveryMode === 'document'
              ? 'DOCUMENT'
              : 'SMART';
        const effectivePresentation =
          deliveryMode === 'document'
            ? 'document'
            : deliveryMode === 'uncompressed'
              ? 'original'
              : 'standard';

        // Clean modal handoff: Close RemoteUploadModal immediately so preflight dialog has full focus
        onClose();

        await submitToDestination(uploadUrls, selectedDest, {
          customFilename: uploadFilenames[0],
          customFilenames: uploadFilenames,
          sourceSizes: uploadSizes,
          thumbnailUrls: uploadThumbs,
          asDocument: deliveryMode === 'document',
          qualityMode: effectiveQualityMode,
          presentationOverride: effectivePresentation,
          remoteEngineMode,
          storagePolicy,
          customDiskPath: customDiskPath.trim() || undefined,
          customCaption: customCaption?.trim() || undefined,
          remoteMuxes,
          referers: uploadReferers,
          zipUrls,
        });
      } catch (err: any) {
        setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
      } finally {
        setSubmitting(false);
      }
    } else {
      // BATCH TAB SUBMISSION
      if (batchGroups.length === 0 || isEditingBatchText) {
        // Trigger batch inspection first
        handleInspectBatchUrls();
        return;
      }

      if (selectedBatchItems.length === 0) {
        setErrorMsg(t('drive.remote_batch_no_selected_hint'));
        return;
      }

      setSubmitting(true);
      try {
        const uploadUrls = selectedBatchItems.map((it) => it.directUrl);
        const customFilenames = selectedBatchItems.map((it) => it.filename);
        const sourceSizes = selectedBatchItems.map((it) => it.filesizeBytes || 0);
        const thumbnailUrls = selectedBatchItems.map((it) => it.thumbnailUrl || '');
        const remoteMuxes: Array<RemoteMuxSpec | null> = selectedBatchItems.map((it) => it.mux || null);

        const effectiveQualityMode =
          deliveryMode === 'uncompressed'
            ? 'ORIGINAL'
            : deliveryMode === 'document'
              ? 'DOCUMENT'
              : 'SMART';
        const effectivePresentation =
          deliveryMode === 'document'
            ? 'document'
            : deliveryMode === 'uncompressed'
              ? 'original'
              : 'standard';

        // Clean modal handoff: Close RemoteUploadModal immediately so preflight dialog has full focus
        onClose();

        await submitToDestination(uploadUrls, selectedDest, {
          customFilenames,
          sourceSizes,
          thumbnailUrls,
          asDocument: deliveryMode === 'document',
          qualityMode: effectiveQualityMode,
          presentationOverride: effectivePresentation,
          remoteEngineMode,
          storagePolicy,
          customDiskPath: customDiskPath.trim() || undefined,
          remoteMuxes,
          referers: selectedBatchItems.map((it) => it.headers?.Referer || it.sourceUrl),
        });
      } catch (err: any) {
        setErrorMsg(err?.message || t('ui.generated.gagal_melakukan_remote_upload_9dd65cb'));
      } finally {
        setSubmitting(false);
      }
    }
  };
}
