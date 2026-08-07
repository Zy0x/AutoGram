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
      label: 'Pencari Duplikat (Duplicates)',
      description: 'Pindai dan hapus berkas duplikat berdasarkan Hash SHA256 & Nama File',
      keywords: ['duplicates', 'duplikat', 'ganda', 'sama', 'hapus duplikat', 'sha256', 'hash', 'clean'],
      isDriveTool: true,
    },
    {
      id: 'tool-rename',
      tab: 'rename',
      mode: 'basic',
      sectionId: 'drive-tool-rename',
      label: 'Bulk Rename (Ubah Nama Massal)',
      description: 'Ubah nama banyak berkas sekaligus menggunakan pola format tag otomatis',
      keywords: ['rename', 'ubah nama', 'ganti nama', 'bulk rename', 'pattern', 'pola', 'prefix', 'suffix', 'penomoran'],
      isDriveTool: true,
    },
    {
      id: 'tool-space',
      tab: 'space',
      mode: 'basic',
      sectionId: 'drive-tool-space',
      label: 'Space Usage (Analisis Penyimpanan)',
      description: 'Lihat rincian penggunaan ruang drive, ukuran total, dan statistik kategori berkas',
      keywords: ['space', 'storage', 'ruang', 'penyimpanan', 'kapasitas', 'ukuran', 'bytes', 'usage', 'kuota'],
      isDriveTool: true,
    },
    {
      id: 'tool-filter',
      tab: 'filter',
      mode: 'basic',
      sectionId: 'drive-tool-filter',
      label: 'Advanced Filter (Filter Lanjutan)',
      description: 'Filter berkas berdasarkan rentang ukuran, ekstensi, rentang tanggal & tipe media',
      keywords: ['filter', 'penyaring', 'advanced filter', 'ukuran', 'tanggal', 'ext', 'ekstensi', 'video', 'foto', 'dokumen'],
      isDriveTool: true,
    },
    {
      id: 'upload-quality',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'section-upload-format',
      label: String(t('speedtest.upload_quality_header', 'Format & Kualitas Unggahan')),
      description: String(t('speedtest.upload_quality_hint', 'Pilih format pengiriman media')),
      keywords: ['quality', 'kualitas', 'hq', 'smart', 'original', 'native', 'photo', 'video', 'format', 'dokumen'],
    },
    {
      id: 'upload-encoder',
      tab: 'encoding',
      mode: 'basic',
      sectionId: 'section-encoding-mode',
      label: String(t('speedtest.encoder_mode_title', 'Mode Encoding Video')),
      description: String(t('speedtest.encoder_mode_desc', 'Pengaturan akselerasi GPU & CPU')),
      keywords: ['encoder', 'gpu', 'nvenc', 'amf', 'qsv', 'cpu', 'reencode', 'hardware', 'software', 'disable', 'asli', 'kompresi'],
    },
    {
      id: 'upload-concurrency',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'section-upload-performance',
      label: String(t('speedtest.upload_parallelism_header', 'Jumlah Unggahan Paralel')),
      description: String(t('speedtest.upload_parallelism_hint', 'Mengatur kecepatan paralel upload')),
      keywords: ['concurrency', 'paralel', 'upload speed', 'slots', 'kecepatan', 'threads'],
    },
    {
      id: 'upload-caption',
      tab: 'upload',
      mode: 'basic',
      sectionId: 'section-upload-caption',
      label: String(t('speedtest.default_caption_title', 'Caption Global & Perilaku Overflow')),
      description: String(t('speedtest.default_caption_hint', 'Caption otomatis untuk setiap media')),
      keywords: ['caption', 'keterangan', 'utf-16', 'truncate', 'overflow'],
    },
    {
      id: 'upload-album-orchestration',
      tab: 'albums',
      mode: 'basic',
      sectionId: 'section-albums-main',
      label: String(t('speedtest.album_orchestration_title', 'Pengelompokan Album')),
      description: String(t('speedtest.album_orchestration_desc', 'Pengaturan grouping media sebagai album')),
      keywords: ['album', 'packing', 'group size', 'avoid single', 'group documents', 'group audio'],
    },
    {
      id: 'upload-duplicates',
      tab: 'duplicates',
      mode: 'basic',
      sectionId: 'section-duplicates-main',
      label: 'Penanganan Duplikat',
      description: 'Pencegahan dan metode pemeriksaan duplikat',
      keywords: ['duplicate', 'duplikat', 'skip', 'hash', 'sha256', 'unique id', 'message id'],
    },
    {
      id: 'download-concurrency',
      tab: 'download',
      mode: 'basic',
      sectionId: 'section-download-performance',
      label: String(t('speedtest.download_parallel_header', 'Paralel Unduhan')),
      description: String(t('speedtest.download_parallelism_hint', 'Jumlah berkas diunduh secara bersamaan')),
      keywords: ['download', 'paralel', 'concurrency', 'unduh'],
    },
    {
      id: 'download-conflict',
      tab: 'download',
      mode: 'basic',
      sectionId: 'section-download-conflict',
      label: String(t('speedtest.download_reliability_title', 'Konflik File & Keandalan')),
      description: String(t('speedtest.download_reliability_desc', 'Kebijakan jika nama berkas sudah ada')),
      keywords: ['conflict', 'rename', 'overwrite', 'ask', 'integrity', 'sha256', 'resume'],
    },
    {
      id: 'limits-recovery',
      tab: 'limits_recovery',
      mode: 'advanced',
      sectionId: 'section-limits-recovery',
      label: 'Batas Ukuran & Pemulihan',
      description: 'Penanganan berkas oversize, split, dan routing akun alternatif',
      keywords: ['oversize', 'large file', 'split', 'alternate account', 'pool', 'retry'],
    },
    {
      id: 'advanced-settings',
      tab: 'advanced',
      mode: 'advanced',
      sectionId: 'section-advanced-main',
      label: 'Pengaturan Lanjutan Global',
      description: 'Sinkronisasi, reset, import & export JSON',
      keywords: ['advanced', 'sync', 'timeout', 'export', 'import', 'reset'],
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
