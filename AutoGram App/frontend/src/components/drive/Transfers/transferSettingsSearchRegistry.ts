import type { TFunction } from 'i18next';

export type SubMenuCategory =
  | 'summary'
  | 'upload'
  | 'encoding'
  | 'albums'
  | 'duplicates'
  | 'download'
  | 'limits_recovery'
  | 'advanced'
  | 'network'
  | 'profiles'
  | 'copy'
  | 'dups'
  | 'rename'
  | 'space'
  | 'filter';

export interface SearchableSettingItem {
  id: string;
  tab: SubMenuCategory;
  mode: 'basic' | 'advanced';
  sectionId: string;
  label: string;
  description: string;
  keywords: string[];
  isDriveTool?: boolean;
}

export function buildSearchRegistry(t: TFunction): SearchableSettingItem[] {
  return [
    // DRIVE POWER TOOLS
    {
      id: 'tool-dups',
      tab: 'dups',
      mode: 'basic',
      sectionId: 'drive-tool-dups',
      label: String(t('speedtest.tools_tab_dups')),
      description: String(t('speedtest.tools_tab_dups_desc')),
      keywords: ['duplicates', 'duplikat', 'ganda', 'sama', 'hapus duplikat', 'sha256', 'hash', 'clean'],
      isDriveTool: true,
    },
    {
      id: 'tool-rename',
      tab: 'rename',
      mode: 'basic',
      sectionId: 'drive-tool-rename',
      label: String(t('speedtest.tools_tab_rename')),
      description: String(t('speedtest.tools_tab_rename_desc')),
      keywords: ['rename', 'ubah nama', 'ganti nama', 'bulk rename', 'pattern', 'pola', 'prefix', 'suffix', 'penomoran'],
      isDriveTool: true,
    },
    {
      id: 'tool-space',
      tab: 'space',
      mode: 'basic',
      sectionId: 'drive-tool-space',
      label: String(t('speedtest.tools_tab_space')),
      description: String(t('speedtest.tools_tab_space_desc')),
      keywords: ['space', 'storage', 'ruang', 'penyimpanan', 'kapasitas', 'ukuran', 'bytes', 'usage', 'kuota'],
      isDriveTool: true,
    },
    {
      id: 'tool-filter',
      tab: 'filter',
      mode: 'basic',
      sectionId: 'drive-tool-filter',
      label: String(t('speedtest.tools_tab_filter')),
      description: String(t('speedtest.tools_tab_filter_desc')),
      keywords: ['filter', 'penyaring', 'advanced filter', 'ukuran', 'tanggal', 'ext', 'ekstensi', 'video', 'foto', 'dokumen'],
      isDriveTool: true,
    },
    {
      id: 'upload-quality',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'section-upload-format',
      label: String(t('speedtest.upload_quality_header')),
      description: String(t('speedtest.upload_quality_hint')),
      keywords: ['quality', 'kualitas', 'hq', 'smart', 'original', 'native', 'photo', 'video', 'format', 'dokumen'],
    },
    {
      id: 'upload-encoder',
      tab: 'encoding',
      mode: 'basic',
      sectionId: 'section-encoding-mode',
      label: String(t('speedtest.encoder_mode_title')),
      description: String(t('speedtest.encoder_mode_desc')),
      keywords: ['encoder', 'gpu', 'nvenc', 'amf', 'qsv', 'cpu', 'reencode', 'hardware', 'software', 'disable', 'asli', 'kompresi'],
    },
    {
      id: 'upload-concurrency',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'section-upload-performance',
      label: String(t('speedtest.upload_parallelism_header')),
      description: String(t('speedtest.upload_parallelism_hint')),
      keywords: ['concurrency', 'paralel', 'upload speed', 'slots', 'kecepatan', 'threads'],
    },
    {
      id: 'upload-caption',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'section-upload-caption',
      label: String(t('speedtest.default_caption_title')),
      description: String(t('speedtest.default_caption_hint')),
      keywords: ['caption', 'keterangan', 'utf-16', 'truncate', 'overflow'],
    },
    {
      id: 'upload-album-orchestration',
      tab: 'albums',
      mode: 'basic',
      sectionId: 'section-albums-main',
      label: String(t('speedtest.album_orchestration_title')),
      description: String(t('speedtest.album_orchestration_desc')),
      keywords: ['album', 'packing', 'group size', 'avoid single', 'group documents', 'group audio'],
    },
    {
      id: 'upload-duplicates',
      tab: 'duplicates',
      mode: 'basic',
      sectionId: 'section-duplicates-main',
      label: String(t('speedtest.tools_tab_duplicate')),
      description: String(t('speedtest.tools_tab_duplicate_desc')),
      keywords: ['duplicate', 'duplikat', 'skip', 'hash', 'sha256', 'unique id', 'message id'],
    },
    {
      id: 'download-concurrency',
      tab: 'download',
      mode: 'basic',
      sectionId: 'section-download-performance',
      label: String(t('speedtest.download_parallel_header')),
      description: String(t('speedtest.download_parallelism_hint')),
      keywords: ['download', 'paralel', 'concurrency', 'unduh'],
    },
    {
      id: 'download-conflict',
      tab: 'download',
      mode: 'basic',
      sectionId: 'section-download-conflict',
      label: String(t('speedtest.download_reliability_title')),
      description: String(t('speedtest.download_reliability_desc')),
      keywords: ['conflict', 'rename', 'overwrite', 'ask', 'integrity', 'sha256', 'resume'],
    },
    {
      id: 'limits-recovery',
      tab: 'limits_recovery',
      mode: 'advanced',
      sectionId: 'section-limits-recovery',
      label: String(t('speedtest.tools_tab_oversize')),
      description: String(t('speedtest.tools_tab_oversize_desc')),
      keywords: ['oversize', 'large file', 'split', 'alternate account', 'pool', 'retry'],
    },
    {
      id: 'advanced-settings',
      tab: 'advanced',
      mode: 'advanced',
      sectionId: 'section-advanced-main',
      label: String(t('speedtest.tools_tab_advanced')),
      description: String(t('speedtest.tools_tab_advanced_desc')),
      keywords: ['advanced', 'sync', 'timeout', 'export', 'import', 'reset'],
    },
    {
      id: 'hide-restricted-media',
      tab: 'advanced',
      mode: 'advanced',
      sectionId: 'section-hide-restricted-media',
      label: String(t('speedtest.hide_restricted_media_title')),
      description: String(t('speedtest.hide_restricted_media_desc')),
      keywords: [
        'restricted',
        'channel',
        'saluran',
        'terlarang',
        'dibatasi',
        'tidak dapat ditampilkan',
        'this channel can\'t be',
        'this channel cannot be',
        'this message cannot be',
        'cant be displayed',
        'hide',
        'sembunyikan',
        'bersihkan',
        'clean',
        'block',
        'banned',
        'rusak',
      ],
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
