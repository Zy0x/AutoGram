import type { TFunction } from 'i18next';

export interface SearchableSettingItem {
  id: string;
  tab: 'upload' | 'download' | 'presets';
  mode: 'basic' | 'advanced';
  sectionId: string;
  label: string;
  description: string;
  keywords: string[];
}

export function buildSearchRegistry(t: TFunction): SearchableSettingItem[] {
  return [
    {
      id: 'upload-quality',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'transfer-quality',
      label: String(t('speedtest.upload_quality_header')),
      description: String(t('speedtest.upload_quality_hint')),
      keywords: ['quality', 'kualitas', 'hq', 'smart', 'original', 'native', 'photo', 'video'],
    },
    {
      id: 'upload-encoder',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'transfer-encoder-mode',
      label: String(t('speedtest.encoder_mode_title')),
      description: String(t('speedtest.encoder_mode_desc')),
      keywords: ['encoder', 'gpu', 'nvenc', 'amf', 'qsv', 'cpu', 'reencode', 'hardware', 'software', 'disable', 'asli', 'kompresi'],
    },
    {
      id: 'upload-concurrency',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'transfer-quality',
      label: String(t('speedtest.upload_parallelism_header')),
      description: String(t('speedtest.upload_parallelism_hint')),
      keywords: ['concurrency', 'paralel', 'upload speed', 'slots', 'kecepatan', 'threads'],
    },
    {
      id: 'upload-send-options',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'transfer-send',
      label: String(t('speedtest.send_options_header')),
      description: 'Album, silent send, spoiler, refresh after upload, skip duplicates',
      keywords: ['album', 'silent', 'spoiler', 'refresh', 'skip', 'duplicate', 'duplikat'],
    },
    {
      id: 'upload-caption',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'transfer-quality',
      label: String(t('speedtest.default_caption_title')),
      description: String(t('speedtest.default_caption_hint')),
      keywords: ['caption', 'keterangan', 'utf-16', 'truncate', 'overflow'],
    },
    {
      id: 'upload-album-orchestration',
      tab: 'upload',
      mode: 'advanced',
      sectionId: 'transfer-orchestration',
      label: String(t('speedtest.album_orchestration_title')),
      description: String(t('speedtest.album_orchestration_desc')),
      keywords: ['album', 'packing', 'group size', 'avoid single', 'group documents', 'group audio'],
    },
    {
      id: 'upload-failure-recovery',
      tab: 'upload',
      mode: 'advanced',
      sectionId: 'transfer-orchestration',
      label: String(t('speedtest.album_failure_policy')),
      description: 'Kebijakan toleransi kegagalan album',
      keywords: ['failure', 'policy', 'strict', 'atomic', 'best effort', 'replan', 'retry'],
    },
    {
      id: 'upload-delivery-routing',
      tab: 'upload',
      mode: 'advanced',
      sectionId: 'transfer-orchestration',
      label: String(t('speedtest.delivery_routing_title')),
      description: String(t('speedtest.delivery_routing_desc')),
      keywords: ['schedule', 'jadwal', 'send as', 'peer', 'spoiler positions'],
    },
    {
      id: 'upload-oversize-policy',
      tab: 'upload',
      mode: 'advanced',
      sectionId: 'transfer-orchestration',
      label: String(t('speedtest.oversize_policy_title')),
      description: 'Split, alternate account, atau skip file besar',
      keywords: ['oversize', 'large file', 'split', 'alternate account', 'pool'],
    },
    {
      id: 'download-concurrency',
      tab: 'download',
      mode: 'basic',
      sectionId: 'transfer-download',
      label: String(t('speedtest.download_parallel_header')),
      description: String(t('speedtest.download_parallelism_hint')),
      keywords: ['download', 'paralel', 'concurrency', 'unduh'],
    },
    {
      id: 'download-behavior',
      tab: 'download',
      mode: 'basic',
      sectionId: 'transfer-download',
      label: String(t('speedtest.download_behavior_header')),
      description: String(t('speedtest.download_status_desc')),
      keywords: ['notification', 'pemberitahuan', 'status', 'notify'],
    },
    {
      id: 'download-conflict',
      tab: 'download',
      mode: 'advanced',
      sectionId: 'transfer-download-reliability',
      label: String(t('speedtest.download_reliability_title')),
      description: String(t('speedtest.download_reliability_desc')),
      keywords: ['conflict', 'rename', 'overwrite', 'ask', 'integrity', 'sha256', 'resume'],
    },
  ];
}

export function searchSettingsRegistry(
  items: SearchableSettingItem[],
  query: string
): SearchableSettingItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.filter((item) => {
    return (
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.toLowerCase().includes(q))
    );
  });
}
