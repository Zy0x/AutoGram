import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, FileText, Link2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { driveFileDisplayName, formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { buildTelegramMessageUrl } from '../../../lib/telegram/utils/telegramMessageUrl';
import { nativeWriteClipboardText } from '../../../lib/tauri/desktopClipboard';

type Props = {
  file: DriveFile | null;
  locationName?: string;
  pathId?: string | null;
  onClose: () => void;
};

function compactMetadata(file: DriveFile): Array<[string, unknown]> {
  return Object.entries(file)
    .filter(([key, value]) => {
      if (value == null || value === '') return false;
      if (key === 'thumb_data_url' || key === 'thumbDataUrl') return false;
      return typeof value !== 'function';
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

function renderMetadataValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatCreatedAt(value: unknown, locale: string, fallback: string): string {
  if (value == null || value === '') return fallback;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date);
  } catch {
    return fallback;
  }
}

export function DriveFileInfoModal({ file, locationName, pathId, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!file) return;
    setExpanded(false);
    setCopied('');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [file, onClose]);

  const metadata = useMemo(() => (file ? compactMetadata(file) : []), [file]);
  if (!file) return null;

  const telegramUrl = buildTelegramMessageUrl(file);
  const duration = Number(file.duration ?? file.duration_s ?? 0);
  const links = Array.from(new Set(file.link_urls || []));
  const delivery = file.as_document
    ? t('speedtest.media_info_delivery_document')
    : t('speedtest.media_info_delivery_media');
  const createdAt = formatCreatedAt(
    file.created_at,
    i18n.language,
    t('speedtest.media_info_unknown'),
  );

  const copy = async (value: string, key: string) => {
    if (!value) return;
    if (await nativeWriteClipboardText(value)) {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? '' : current), 1500);
    }
  };

  const importantRows: Array<[string, string]> = [
    [t('speedtest.media_info_name'), driveFileDisplayName(file)],
    [t('speedtest.media_info_size'), formatDriveBytes(file.size || 0)],
    [t('speedtest.media_info_mime'), file.mime_type || t('speedtest.media_info_unknown')],
    [t('speedtest.media_info_delivery'), String(delivery)],
    [t('speedtest.media_info_category'), file.telegram_category || file.telegramCategory || file.icon_type || t('speedtest.media_info_unknown')],
    [t('speedtest.media_info_date'), createdAt],
    ...(duration > 0 ? [[t('speedtest.media_info_duration'), `${duration.toFixed(duration % 1 ? 1 : 0)} s`] as [string, string]] : []),
    [t('speedtest.media_info_message_id'), String(file.id)],
    [t('speedtest.media_info_peer_id'), String(file.peer_id || file.folder_id || 'me')],
    ...(file.topic_id != null ? [[t('speedtest.media_info_topic_id'), String(file.topic_id)] as [string, string]] : []),
    ...(file.grouped_id != null ? [[t('speedtest.media_info_album_id'), String(file.grouped_id)] as [string, string]] : []),
  ];

  return createPortal(
    <div className="drive-file-info-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="drive-file-info-dialog" role="dialog" aria-modal="true" aria-labelledby="drive-file-info-title">
        <header className="drive-file-info-header">
          <div className="drive-file-info-heading">
            <span className="drive-file-info-icon"><FileText size={20} /></span>
            <div>
              <h2 id="drive-file-info-title">{t('speedtest.media_info_title')}</h2>
              <p>{locationName || t('speedtest.media_info_location_unknown')}</p>
            </div>
          </div>
          <button type="button" className="drive-file-info-close" onClick={onClose} aria-label={t('speedtest.media_info_close')}>
            <X size={19} />
          </button>
        </header>

        <div className="drive-file-info-body">
          <div className="drive-file-info-name" title={driveFileDisplayName(file)}>{driveFileDisplayName(file)}</div>
          <div className="drive-file-info-grid">
            {importantRows.map(([label, value]) => (
              <div className="drive-file-info-row" key={label}>
                <span>{label}</span>
                <strong title={value}>{value}</strong>
              </div>
            ))}
          </div>

          {(pathId || telegramUrl) && (
            <div className="drive-file-info-identities">
              {pathId && (
                <button type="button" onClick={() => void copy(pathId, 'path')}>
                  <span><Link2 size={15} />{t('speedtest.media_info_path_id')}</span>
                  <code>{pathId}</code>
                  {copied === 'path' ? <Check size={15} /> : <Copy size={15} />}
                </button>
              )}
              {telegramUrl && (
                <button type="button" onClick={() => void openUrl(telegramUrl)}>
                  <span><ExternalLink size={15} />{t('speedtest.media_info_telegram_link')}</span>
                  <code>{telegramUrl}</code>
                  <ExternalLink size={15} />
                </button>
              )}
            </div>
          )}

          {links.length > 0 && (
            <div className="drive-file-info-links">
              <h3>{t('speedtest.media_info_embedded_links', { count: links.length })}</h3>
              {links.map((url, index) => (
                <button type="button" key={`${url}-${index}`} onClick={() => void copy(url, `link-${index}`)} title={url}>
                  <code>{url}</code>
                  {copied === `link-${index}` ? <Check size={14} /> : <Copy size={14} />}
                </button>
              ))}
            </div>
          )}

          <button type="button" className="drive-file-info-expand" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {expanded ? t('speedtest.media_info_less') : t('speedtest.media_info_more')}
          </button>
          {expanded && (
            <div className="drive-file-info-raw">
              {metadata.map(([key, value]) => (
                <div key={key}>
                  <code>{key}</code>
                  <span>{renderMetadataValue(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
