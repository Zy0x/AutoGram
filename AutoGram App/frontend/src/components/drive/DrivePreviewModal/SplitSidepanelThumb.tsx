import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Image as ImageIcon, Music, FileText } from 'lucide-react';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import {
  canShowDriveThumb,
  isImageDriveFile,
  isVideoDriveFile,
  isAudioDriveFile,
} from '../../../lib/telegram/driveTypes';
import {
  getCachedThumb,
  getCachedSaverThumb,
  buildThumbCacheKey,
  requestThumb,
} from '../../../lib/media/thumbBatcher';
import { loadPersistentThumb } from '../../../lib/media/thumbPersistentCache';

type Props = {
  file: DriveFile;
  folderId: number | null;
  creds?: DriveCredentials;
  fallbackSrc?: string;
  isA?: boolean;
  isB?: boolean;
};

export const SplitSidepanelThumb = memo(function SplitSidepanelThumb({
  file,
  folderId,
  creds,
  fallbackSrc,
  isA,
  isB,
}: Props) {
  const { t } = useTranslation();
  const scopedFolderId = file.folder_id ?? folderId;
  const itemPeerId = scopedFolderId != null && scopedFolderId !== 0 ? String(scopedFolderId) : (file.peer_id || 'me');
  const itemTopicId = file.topic_id ?? null;
  const thumbLocator = { peerId: itemPeerId, topicId: itemTopicId };

  const getInitialThumb = () => {
    const cached = getCachedThumb(scopedFolderId, file.id, thumbLocator);
    if (cached) return cached;

    const saver = creds?.session
      ? getCachedSaverThumb(scopedFolderId, file.id, creds.session, thumbLocator)
      : null;
    if (saver) return saver;

    if (file.thumb_data_url || file.thumbDataUrl) {
      return (file.thumb_data_url || file.thumbDataUrl) as string;
    }
    if (fallbackSrc) return fallbackSrc;
    return null;
  };

  const [thumb, setThumb] = useState<string | null>(getInitialThumb);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    let isSubscribed = true;

    const currentThumb = getInitialThumb();
    setThumb(currentThumb);

    // Try IndexedDB persistent cache if missing memory cache
    if (!currentThumb && creds?.session) {
      const key = buildThumbCacheKey(
        scopedFolderId,
        file.id,
        'balanced',
        creds.session,
        itemPeerId,
        itemTopicId
      );
      void loadPersistentThumb(key).then((persisted) => {
        if (isSubscribed && persisted) {
          setThumb(persisted);
        }
      });

      // Request thumbnail from backend/Telegram if thumbnailable
      if (canShowDriveThumb(file)) {
        void requestThumb(creds, scopedFolderId, file.id, {
          priority: 'visible',
          peerId: itemPeerId,
          topicId: itemTopicId,
        });
      }
    }

    const onThumbReady = (ev: Event) => {
      if (!isSubscribed) return;
      const hit = getCachedThumb(scopedFolderId, file.id, thumbLocator);
      if (hit) {
        setThumb(hit);
        setImgError(false);
        return;
      }
      const detail = (ev as CustomEvent).detail as { key?: string; url?: string } | undefined;
      if (detail?.key && detail?.url && creds?.session) {
        const expectedKey = buildThumbCacheKey(
          scopedFolderId,
          file.id,
          'balanced',
          creds.session,
          itemPeerId,
          itemTopicId
        );
        const expectedSaverKey = buildThumbCacheKey(
          scopedFolderId,
          file.id,
          'saver',
          creds.session,
          itemPeerId,
          itemTopicId
        );
        if (detail.key === expectedKey || detail.key === expectedSaverKey) {
          setThumb(detail.url);
          setImgError(false);
        }
      }
    };

    window.addEventListener('autogram-thumb-ready', onThumbReady);
    return () => {
      isSubscribed = false;
      window.removeEventListener('autogram-thumb-ready', onThumbReady);
    };
  }, [file.id, file.thumb_data_url, file.thumbDataUrl, scopedFolderId, itemPeerId, itemTopicId, creds?.session, fallbackSrc]);

  const renderIcon = () => {
    if (isVideoDriveFile(file)) {
      return <Film size={18} className="text-slate-400" />;
    }
    if (isImageDriveFile(file)) {
      return <ImageIcon size={18} className="text-slate-400" />;
    }
    if (isAudioDriveFile(file)) {
      return <Music size={18} className="text-slate-400" />;
    }
    return <FileText size={18} className="text-slate-400" />;
  };

  return (
    <div className="drive-dup-sidebar-thumb-box-23">
      {isA && <span className="drive-dup-sidebar-badge-a">{t('ui.generated.a_6dcd4ce')}</span>}
      {isB && <span className="drive-dup-sidebar-badge-b">{t('ui.generated.b_ae4f281')}</span>}
      {thumb && !imgError ? (
        <img
          src={thumb}
          alt={file.name}
          className="drive-dup-sidebar-thumb-23"
          onError={() => setImgError(true)}
        />
      ) : (
        renderIcon()
      )}
    </div>
  );
});
