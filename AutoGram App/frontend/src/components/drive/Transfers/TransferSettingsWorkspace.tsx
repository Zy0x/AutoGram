import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  Download,
  Bookmark,
  RotateCcw,
  Save,
  Search,
  Zap,
  Film,
  Cpu,
  Sliders,
  ShieldAlert,
  Trash2,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  Gauge,
  FolderTree,
  CopyCheck,
  HardDriveUpload,
  SlidersHorizontal,
  X,
  Clock,
  FileCode,
  DownloadCloud,
} from 'lucide-react';
import type {
  DriveTransferSettings,
  DriveTransferSettingsProfile,
  ReencodeHardware,
} from '../../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  loadTransferSettingsProfiles,
  saveTransferSettingsProfiles,
} from '../../../lib/telegram/driveTypes';
import { MediaSelect } from '../Navigation/MediaSelect';
import { useTransferHardwareCapabilities } from '../../../stores/transferProgressStore';
import { buildEncoderHardwareOptions } from './encoderHardwareOptions';
import {
  applyUnifiedEncodingMode,
  normalizeTransferSettings,
  resolveUnifiedEncodingMode,
  SYSTEM_TRANSFER_PRESETS,
  validateTransferSettings,
  getDeliveryFormatMode,
  applyDeliveryFormatMode,
} from './transferSettingsModel';
import {
  buildSearchRegistry,
  searchSettingsRegistry,
  type SearchableSettingItem,
  type SubMenuCategory,
} from './transferSettingsSearchRegistry';

export interface TransferSettingsWorkspaceProps {
  settings: DriveTransferSettings;
  onChange: (next: DriveTransferSettings) => void;
  onClose?: () => void;
  transferActive?: boolean;
  embedded?: boolean;
}

export function TransferSettingsWorkspace({
  settings,
  onChange,
  onClose,
  transferActive,
  embedded = false,
}: TransferSettingsWorkspaceProps) {
  const { t } = useTranslation();
  const searchInputId = useId();

  // Navigation & mode state
  const [activeTab, setActiveTab] = useState<SubMenuCategory>('summary');
  const [viewMode, setViewMode] = useState<'basic' | 'advanced'>('basic');
  const [settingsQuery, setSettingsQuery] = useState('');

  // Drawer / Modal overlays
  const [showPresetDrawer, setShowPresetDrawer] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAdvancedEncoding, setShowAdvancedEncoding] = useState(false);

  // Baseline vs Draft state
  const [baseline, setBaseline] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));
  const [draft, setDraft] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));

  // Profile manager state
  const [profiles, setProfiles] = useState<DriveTransferSettingsProfile[]>(() => loadTransferSettingsProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [pendingProfileLoad, setPendingProfileLoad] = useState<string | null>(null);

  const { hardwareCapabilities, isDetectingHardware, fetchHardwareCapabilities } = useTransferHardwareCapabilities();

  // Search registry
  const searchRegistry = useMemo(() => buildSearchRegistry(t), [t]);
  const searchResults = useMemo(
    () => searchSettingsRegistry(searchRegistry, settingsQuery),
    [searchRegistry, settingsQuery]
  );

  // Unsaved changes check
  const isDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }, [draft, baseline]);

  // Validation
  const validation = useMemo(
    () => validateTransferSettings(draft, hardwareCapabilities),
    [draft, hardwareCapabilities]
  );

  const patch = (partial: Partial<DriveTransferSettings>) => {
    setDraft((prev) => normalizeTransferSettings({ ...prev, ...partial }));
  };

  const applySave = () => {
    if (!validation.valid) return;
    const next = validation.normalized;
    onChange(next);
    setBaseline(next);
    setDraft(next);
  };

  const resetAll = () => {
    const next = normalizeTransferSettings(DEFAULT_TRANSFER_SETTINGS);
    setDraft(next);
    setShowResetConfirm(false);
  };

  const applyPreset = (presetSettings: Partial<DriveTransferSettings>) => {
    const next = normalizeTransferSettings({ ...draft, ...presetSettings });
    setDraft(next);
  };

  const loadProfile = (id: string) => {
    if (isDirty) {
      setPendingProfileLoad(id);
      return;
    }
    executeLoadProfile(id);
  };

  const executeLoadProfile = (id: string) => {
    setSelectedProfileId(id);
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setProfileName(profile.name);
    const next = normalizeTransferSettings(profile.settings);
    setDraft(next);
    setBaseline(next);
    onChange(next);
    setPendingProfileLoad(null);
  };

  const saveProfile = () => {
    const name = profileName.trim().slice(0, 80);
    if (!name) return;
    const id = selectedProfileId || (globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}`);
    const nextProfile: DriveTransferSettingsProfile = {
      id,
      name,
      updatedAt: Date.now(),
      settings: { ...draft },
    };
    const next = [nextProfile, ...profiles.filter((p) => p.id !== id)];
    setProfiles(next);
    setSelectedProfileId(id);
    saveTransferSettingsProfiles(next);
  };

  const deleteProfile = () => {
    if (!selectedProfileId) return;
    const next = profiles.filter((p) => p.id !== selectedProfileId);
    setProfiles(next);
    setSelectedProfileId('');
    setProfileName('');
    saveTransferSettingsProfiles(next);
  };

  const handleSearchResultClick = (item: SearchableSettingItem) => {
    setActiveTab(item.tab);
    if (item.mode === 'advanced') {
      setViewMode('advanced');
    }
    window.setTimeout(() => {
      const el = document.getElementById(item.sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('td-search-highlight');
        window.setTimeout(() => el.classList.remove('td-search-highlight'), 1800);
      }
    }, 50);
  };

  const hardwareOptions = useMemo(() => {
    return buildEncoderHardwareOptions(hardwareCapabilities, t, isDetectingHardware);
  }, [hardwareCapabilities, isDetectingHardware, t]);

  const currentEncoderMode = useMemo(() => resolveUnifiedEncodingMode(draft), [draft]);
  const currentDeliveryFormat = useMemo(() => getDeliveryFormatMode(draft), [draft]);

  // Identify active preset matching current draft
  const activePresetId = useMemo(() => {
    if (draft.qualityMode === 'ORIGINAL' && currentEncoderMode === 'disabled') return 'preset-archival';
    if (draft.qualityMode === 'HIGH_QUALITY' && draft.uploadConcurrency >= 5) return 'preset-fast-publish';
    if (draft.qualityMode === 'SMART' || (draft.qualityMode === 'HIGH_QUALITY' && draft.uploadConcurrency <= 4)) return 'preset-balanced';
    return null;
  }, [draft, currentEncoderMode]);

  const activePresetName = useMemo(() => {
    const found = SYSTEM_TRANSFER_PRESETS.find((p) => p.id === activePresetId);
    return found ? found.name : t('speedtest.preset_custom', 'Kustom');
  }, [activePresetId, t]);

  // 8 Horizontal Sub-Menu Tabs
  const subMenuTabs: { id: SubMenuCategory; label: string; icon: any; isAdvancedOnly?: boolean }[] = [
    { id: 'summary', label: t('speedtest.tab_summary', 'Ringkasan'), icon: Gauge },
    { id: 'upload', label: t('speedtest.tab_upload', 'Upload'), icon: Upload },
    { id: 'encoding', label: t('speedtest.tab_encoding', 'Encoding Video'), icon: Film },
    { id: 'albums', label: t('speedtest.tab_albums', 'Pengelompokan Album'), icon: FolderTree },
    { id: 'duplicates', label: t('speedtest.tab_duplicates', 'Penanganan Duplikat'), icon: CopyCheck },
    { id: 'download', label: t('speedtest.tab_download', 'Download'), icon: Download },
    { id: 'limits_recovery', label: t('speedtest.tab_limits_recovery', 'Batas Ukuran & Pemulihan'), icon: HardDriveUpload, isAdvancedOnly: true },
    { id: 'advanced', label: t('speedtest.tab_advanced', 'Pengaturan Lanjutan'), icon: SlidersHorizontal, isAdvancedOnly: true },
  ];

  return (
    <div className={`td-xfer-single-workspace ${embedded ? 'is-embedded' : 'is-standalone'}`}>
      {/* TOP HEADER BAR */}
      <header className="td-xfer-header">
        <div className="td-xfer-header-left">
          <div className="td-xfer-avatar">
            <SlidersHorizontal size={20} />
          </div>
          <div>
            <h3>{t('speedtest.transfer_settings_title', 'Transfer Settings')}</h3>
            <p>{t('speedtest.transfer_settings_subtitle', 'Konfigurasi unggah, unduh, dan pengodean media')}</p>
          </div>
        </div>

        <div className="td-xfer-header-right">
          {/* Mode Switcher: Basic vs Advanced */}
          <div className="td-xfer-mode-segmented">
            <button
              type="button"
              className={`td-segmented-btn ${viewMode === 'basic' ? 'active' : ''}`}
              onClick={() => setViewMode('basic')}
            >
              {t('speedtest.mode_basic', 'Dasar')}
            </button>
            <button
              type="button"
              className={`td-segmented-btn ${viewMode === 'advanced' ? 'active' : ''}`}
              onClick={() => setViewMode('advanced')}
            >
              {t('speedtest.mode_advanced', 'Lanjutan')}
            </button>
          </div>

          {isDirty && (
            <span className="td-dirty-badge">
              <span className="td-dirty-dot" />
              {t('speedtest.unsaved_changes', 'Perubahan belum disimpan')}
            </span>
          )}

          {/* Search Box */}
          <div className="td-xfer-search-wrapper">
            <Search size={14} className="td-search-icon" />
            <input
              id={searchInputId}
              type="search"
              value={settingsQuery}
              onChange={(e) => setSettingsQuery(e.target.value)}
              placeholder={t('speedtest.search_placeholder_short', 'Cari pengaturan…')}
            />
            {settingsQuery.trim() && (
              <div className="td-xfer-search-results">
                {searchResults.length ? (
                  searchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="td-chip-btn"
                      onClick={() => handleSearchResultClick(item)}
                    >
                      <span className="td-search-item-tab">[{item.tab.toUpperCase()}]</span> {item.label}
                    </button>
                  ))
                ) : (
                  <span className="td-xfer-hint">{t('speedtest.transfer_settings_search_empty', 'Tidak ada hasil')}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* COMPACT PRESET SUMMARY STRIP */}
      <section className="td-xfer-preset-strip">
        <div className="td-preset-strip-left">
          <Sparkles size={16} className="td-preset-sparkle" />
          <div className="td-preset-summary-info">
            <span className="td-preset-label-text">
              {t('speedtest.active_preset_label', 'Preset aktif')}: <strong>{activePresetName}</strong>
            </span>
            <span className="td-preset-details-text">
              • GPU {currentEncoderMode.toUpperCase()} • {draft.uploadConcurrency} Paralel Unggah • {draft.duplicatePolicy === 'SKIP' ? 'Lewati Duplikat' : 'Unggah Ulang'}
            </span>
          </div>
        </div>

        <div className="td-preset-strip-actions">
          <button
            type="button"
            className="td-chip-btn td-chip-primary"
            onClick={() => setShowPresetDrawer(true)}
          >
            <Sparkles size={13} /> {t('speedtest.change_preset_btn', 'Ubah Preset')}
          </button>
          <button
            type="button"
            className="td-chip-btn"
            onClick={() => {
              setActiveTab('profiles');
              setShowPresetDrawer(true);
            }}
          >
            <Bookmark size={13} /> {t('speedtest.profiles_btn', 'Profil')}
          </button>
        </div>
      </section>

      {/* HORIZONTAL SUB-MENU TABS BAR */}
      <nav className="td-xfer-subnav-bar" aria-label="Transfer Settings Categories">
        {subMenuTabs.map((tab) => {
          if (tab.isAdvancedOnly && viewMode !== 'advanced') return null;
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`td-subnav-pill ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* MAIN FOCUSED WORKSPACE VIEWPORT */}
      <main className="td-xfer-panel-viewport">
        {/* SUB-MENU 1: RINGKASAN */}
        {activeTab === 'summary' && (
          <div className="td-xfer-focused-panel" id="section-summary">
            <div className="td-panel-head">
              <Gauge size={20} className="td-panel-icon" />
              <div>
                <h3>{t('speedtest.cat_summary', 'Ringkasan Konfigurasi Transfer')}</h3>
                <p>{t('speedtest.summary_desc', 'Tinjauan cepat seluruh status pengaturan transfer aktif')}</p>
              </div>
            </div>

            <div className="td-summary-grid-cards">
              <div className="td-summary-tile" onClick={() => setActiveTab('upload')}>
                <span className="td-summary-tile-title">Format & Kualitas Unggah</span>
                <strong className="td-summary-tile-val">{currentDeliveryFormat.toUpperCase()} ({draft.qualityMode})</strong>
                <span className="td-summary-tile-sub">Klik untuk ubah di tab Upload</span>
              </div>

              <div className="td-summary-tile" onClick={() => setActiveTab('encoding')}>
                <span className="td-summary-tile-title">Mode Encoder Video</span>
                <strong className="td-summary-tile-val">{currentEncoderMode.toUpperCase()}</strong>
                <span className="td-summary-tile-sub">
                  {draft.reencodeHardware !== 'auto' && draft.reencodeHardware !== 'cpu'
                    ? draft.reencodeHardware
                    : 'Akselerasi Otomatis'}
                </span>
              </div>

              <div className="td-summary-tile" onClick={() => setActiveTab('upload')}>
                <span className="td-summary-tile-title">Unggah Paralel</span>
                <strong className="td-summary-tile-val">{draft.uploadConcurrency} Berkas</strong>
                <span className="td-summary-tile-sub">Batas bersamaan</span>
              </div>

              <div className="td-summary-tile" onClick={() => setActiveTab('download')}>
                <span className="td-summary-tile-title">Unduh Paralel</span>
                <strong className="td-summary-tile-val">{draft.downloadConcurrency} Berkas</strong>
                <span className="td-summary-tile-sub">Batas bersamaan</span>
              </div>

              <div className="td-summary-tile" onClick={() => setActiveTab('albums')}>
                <span className="td-summary-tile-title">Pengelompokan Album</span>
                <strong className="td-summary-tile-val">{draft.groupAsAlbum ? 'Aktif' : 'Nonaktif'}</strong>
                <span className="td-summary-tile-sub">Ukuran: {draft.albumGroupSize || 10} media</span>
              </div>

              <div className="td-summary-tile" onClick={() => setActiveTab('duplicates')}>
                <span className="td-summary-tile-title">Penanganan Duplikat</span>
                <strong className="td-summary-tile-val">{draft.duplicatePolicy === 'SKIP' ? 'Lewati' : 'Unggah Ulang'}</strong>
                <span className="td-summary-tile-sub">Deteksi obrolan Telegram</span>
              </div>
            </div>

            {/* Validation Warnings inside Summary */}
            {validation.warnings.length > 0 && (
              <div className="td-summary-warning-box">
                <AlertTriangle size={18} />
                <div>
                  <strong>{t('speedtest.warning_label', 'Peringatan Konfigurasi')}</strong>
                  <p>{validation.warnings[0].message}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUB-MENU 2: UPLOAD */}
        {activeTab === 'upload' && (
          <div className="td-xfer-focused-panel" id="section-upload-format">
            {/* FORMAT PENGIRIMAN */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <Upload size={18} />
                <div>
                  <h4>{t('speedtest.delivery_format_title', 'Format Pengiriman Media')}</h4>
                  <p>{t('speedtest.delivery_format_desc', 'Menentukan bagaimana Telegram menampilkan dan mengirim media Anda')}</p>
                </div>
              </div>

              <div className="td-radio-tiles-grid">
                <label className={`td-radio-tile ${currentDeliveryFormat === 'auto' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="deliveryFormat"
                    value="auto"
                    checked={currentDeliveryFormat === 'auto'}
                    disabled={!!transferActive}
                    onChange={() => patch(applyDeliveryFormatMode(draft, 'auto'))}
                  />
                  <div>
                    <strong>Otomatis (Direkomendasikan)</strong>
                    <p>Telegram secara cerdas menentukan format terbaik per berkas.</p>
                  </div>
                </label>

                <label className={`td-radio-tile ${currentDeliveryFormat === 'telegram' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="deliveryFormat"
                    value="telegram"
                    checked={currentDeliveryFormat === 'telegram'}
                    disabled={!!transferActive}
                    onChange={() => patch(applyDeliveryFormatMode(draft, 'telegram'))}
                  />
                  <div>
                    <strong>Media Native Telegram</strong>
                    <p>Kirim sebagai foto / video yang dapat diputar langsung di chat.</p>
                  </div>
                </label>

                <label className={`td-radio-tile ${currentDeliveryFormat === 'document' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="deliveryFormat"
                    value="document"
                    checked={currentDeliveryFormat === 'document'}
                    disabled={!!transferActive}
                    onChange={() => patch(applyDeliveryFormatMode(draft, 'document'))}
                  />
                  <div>
                    <strong>Dokumen Asli (Uncompressed)</strong>
                    <p>Kirim berkas mentah tanpa pemrosesan pratinjau media.</p>
                  </div>
                </label>
              </div>
            </div>

            {/* CAPTION GLOBAL */}
            <div className="td-settings-card" id="section-upload-caption">
              <div className="td-card-head">
                <FileCode size={18} />
                <div>
                  <h4>{t('speedtest.default_caption_title', 'Caption Global')}</h4>
                  <p>{t('speedtest.default_caption_hint', 'Keterangan otomatis yang akan disertakan pada pengiriman')}</p>
                </div>
              </div>

              <div className="td-caption-input-box">
                <textarea
                  rows={3}
                  value={draft.globalCaption || ''}
                  disabled={!!transferActive}
                  placeholder={t('speedtest.caption_placeholder', 'Tulis caption di sini…')}
                  onChange={(e) => patch({ globalCaption: e.target.value })}
                />
                <div className="td-caption-meta">
                  <span className="td-caption-char-count">
                    {[...(draft.globalCaption || '')].length} / 1024 karakter
                  </span>
                  <div className="td-caption-overflow-select">
                    <label>{t('speedtest.caption_overflow_label', 'Perilaku jika terlalu panjang')}:</label>
                    <select
                      value={draft.captionOverflowPolicy || 'truncate'}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ captionOverflowPolicy: e.target.value as any })}
                    >
                      <option value="truncate">Potong dengan peringatan</option>
                      <option value="fail">Batalkan pengiriman</option>
                      <option value="split">Bagi otomatis</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* PENGIRIMAN & IDENTITAS */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <Clock size={18} />
                <div>
                  <h4>{t('speedtest.delivery_scheduling_title', 'Penjadwalan & Identitas Pengirim')}</h4>
                  <p>{t('speedtest.delivery_scheduling_desc', 'Atur waktu pengiriman dan identitas peer yang digunakan')}</p>
                </div>
              </div>

              <div className="td-form-row-grid">
                <div className="td-field-group">
                  <label className="td-field-label">Jadwalkan Pengiriman</label>
                  <input
                    type="datetime-local"
                    value={draft.scheduleAt || ''}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ scheduleAt: e.target.value })}
                  />
                </div>

                <div className="td-field-group">
                  <label className="td-field-label">Send As (Identitas Pengirim)</label>
                  <input
                    type="text"
                    value={draft.sendAs || ''}
                    disabled={!!transferActive}
                    placeholder="@channel_username atau ID channel"
                    onChange={(e) => patch({ sendAs: e.target.value })}
                  />
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>{t('speedtest.send_silent', 'Kirim Tanpa Suara (Silent Send)')}</strong>
                    <p>{t('speedtest.send_silent_desc', 'Penerima tidak menerima suara notifikasi')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.silent}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ silent: e.target.checked })}
                  />
                </label>

                <label className="td-switch-row">
                  <div>
                    <strong>{t('speedtest.send_spoiler', 'Efek Spoiler')}</strong>
                    <p>{t('speedtest.send_spoiler_desc', 'Tutup media dengan efek buram spoiler')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.spoiler}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ spoiler: e.target.checked })}
                  />
                </label>
              </div>
            </div>

            {/* PERFORMA UNGGAH */}
            <div className="td-settings-card" id="section-upload-performance">
              <div className="td-card-head">
                <Zap size={18} />
                <div>
                  <h4>{t('speedtest.upload_parallelism_header', 'Jumlah Unggahan Paralel')}</h4>
                  <p>{t('speedtest.upload_parallelism_hint', 'Kecepatan upload ditentukan oleh jumlah slot berkas bersamaan')}</p>
                </div>
              </div>

              <div className="td-slider-row-box">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.uploadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ uploadConcurrency: Number(e.target.value) })}
                />
                <div className="td-slider-value-bar">
                  <span className="td-slider-val">{draft.uploadConcurrency} Berkas</span>
                  <span className="td-concurrency-badge">
                    {draft.uploadConcurrency <= 2 && '🐢 Stabil'}
                    {draft.uploadConcurrency >= 3 && draft.uploadConcurrency <= 5 && '⚡ Seimbang (Rekomendasi)'}
                    {draft.uploadConcurrency >= 6 && '🚀 Kecepatan Tinggi'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MENU 3: ENCODING VIDEO */}
        {activeTab === 'encoding' && (
          <div className="td-xfer-focused-panel" id="section-encoding-mode">
            <div className="td-settings-card">
              <div className="td-card-head">
                <Film size={18} />
                <div>
                  <h4>{t('speedtest.encoder_mode_title', 'Mode Encoding Video')}</h4>
                  <p>{t('speedtest.encoder_mode_desc', 'Pilih bagaimana sistem memproses berkas video sebelum diunggah')}</p>
                </div>
              </div>

              <div className="td-encoder-4x-grid">
                {/* AUTO */}
                <label className={`td-encoder-tile ${currentEncoderMode === 'automatic' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="automatic"
                    checked={currentEncoderMode === 'automatic'}
                    disabled={!!transferActive}
                    onChange={() => patch(applyUnifiedEncodingMode(draft, 'automatic'))}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Zap size={16} className="td-tile-icon is-auto" />
                      <strong>Otomatis (GPU Adaptif)</strong>
                    </div>
                    <p>Sistem mendeteksi GPU secara otomatis. Jika gagal, fallback ke CPU.</p>
                  </div>
                </label>

                {/* HARDWARE GPU */}
                <label className={`td-encoder-tile ${currentEncoderMode === 'hardware' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="hardware"
                    checked={currentEncoderMode === 'hardware'}
                    disabled={!!transferActive}
                    onChange={() => {
                      const firstGpu = hardwareOptions.find(
                        (o) => o.value !== 'auto' && o.value !== 'cpu' && o.value !== 'detecting'
                      );
                      const targetHw = (firstGpu ? firstGpu.value : 'auto') as ReencodeHardware;
                      patch(applyUnifiedEncodingMode(draft, 'hardware', { targetHw }));
                    }}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Film size={16} className="td-tile-icon is-gpu" />
                      <strong>Akselerasi GPU Hardware</strong>
                    </div>
                    <p>Gunakan chip GPU khusus (NVIDIA NVENC, AMD AMF, Intel QSV).</p>
                  </div>
                </label>

                {/* SOFTWARE CPU */}
                <label className={`td-encoder-tile ${currentEncoderMode === 'software' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="software"
                    checked={currentEncoderMode === 'software'}
                    disabled={!!transferActive}
                    onChange={() => patch(applyUnifiedEncodingMode(draft, 'software'))}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Cpu size={16} className="td-tile-icon is-cpu" />
                      <strong>Software CPU Encoding</strong>
                    </div>
                    <p>Kompresi menggunakan prosessor CPU. Sangat presisi namun memakan beban CPU.</p>
                  </div>
                </label>

                {/* DISABLE REENCODE */}
                <label className={`td-encoder-tile ${currentEncoderMode === 'disabled' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="disabled"
                    checked={currentEncoderMode === 'disabled'}
                    disabled={!!transferActive}
                    onChange={() => patch(applyUnifiedEncodingMode(draft, 'disabled'))}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Sliders size={16} className="td-tile-icon is-disable" />
                      <strong>Matikan Re-encode</strong>
                    </div>
                    <p>Kirim video tanpa kompresi ulang. Format non-native dikirim sebagai dokumen.</p>
                  </div>
                </label>
              </div>

              {/* HARDWARE DEVICE SELECTOR (SHOWS CONDITIONALLY) */}
              {currentEncoderMode === 'hardware' && (
                <div className="td-conditional-box">
                  <label className="td-field-label">Pilih Perangkat GPU Fisik</label>
                  <MediaSelect
                    value={draft.reencodeHardware}
                    disabled={!!transferActive}
                    onChange={(val) => patch(applyUnifiedEncodingMode(draft, 'hardware', { targetHw: val as ReencodeHardware }))}
                    onOpen={fetchHardwareCapabilities}
                    ariaLabel="Pilih Perangkat GPU Fisik"
                    options={hardwareOptions}
                  />
                </div>
              )}

              {/* DISABLE WARNING (SHOWS CONDITIONALLY) */}
              {currentEncoderMode === 'disabled' && (
                <div className="td-conditional-box is-warning">
                  <ShieldAlert size={16} />
                  <span>Re-encode dinonaktifkan. Video format non-native (MKV/AVI) akan dikirim sebagai berkas dokumen.</span>
                </div>
              )}
            </div>

            {/* ENCODING TECHNICAL OPTIONS (ACCORDION) */}
            <div className="td-settings-card">
              <button
                type="button"
                className="td-accordion-toggle-btn"
                onClick={() => setShowAdvancedEncoding(!showAdvancedEncoding)}
              >
                <span>Pengaturan Teknis Encoder Lanjutan</span>
                <SlidersHorizontal size={15} />
              </button>

              {showAdvancedEncoding && (
                <div className="td-accordion-content">
                  <div className="td-form-row-grid">
                    <div className="td-field-group">
                      <label className="td-field-label">Jumlah Encoder Paralel</label>
                      <select
                        value={draft.encoderMaxParallel || 1}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ encoderMaxParallel: Number(e.target.value) })}
                      >
                        <option value={1}>1 Proses (Stabil)</option>
                        <option value={2}>2 Proses Parallel</option>
                        <option value={3}>3 Proses Parallel</option>
                        <option value={4}>4 Proses Parallel (Max GPU)</option>
                      </select>
                    </div>

                    <div className="td-field-group">
                      <label className="td-field-label">Resource Profile</label>
                      <select
                        value={draft.encoderResourceProfile || 'balanced'}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ encoderResourceProfile: e.target.value as any })}
                      >
                        <option value="eco">Hemat Daya (Eco)</option>
                        <option value="balanced">Seimbang (Recommended)</option>
                        <option value="performance">Performa Maksimal</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUB-MENU 4: PENGELOMPOKAN ALBUM */}
        {activeTab === 'albums' && (
          <div className="td-xfer-focused-panel" id="section-albums-main">
            <div className="td-settings-card">
              <div className="td-card-head">
                <FolderTree size={18} />
                <div>
                  <h4>{t('speedtest.album_orchestration_title', 'Pengelompokan Media Album')}</h4>
                  <p>{t('speedtest.album_orchestration_desc', 'Kirim foto dan video dalam satu album grup Telegram')}</p>
                </div>
              </div>

              <label className="td-switch-row">
                <div>
                  <strong>{t('speedtest.send_as_album', 'Kirim Media Sebagai Album')}</strong>
                  <p>{t('speedtest.send_as_album_desc', 'Gabungkan beberapa foto/video menjadi album tunggal')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.groupAsAlbum}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ groupAsAlbum: e.target.checked })}
                />
              </label>

              {/* ALBUM OPTIONS (CONDITIONALLY SHOWS WHEN GROUP AS ALBUM IS TRUE) */}
              {draft.groupAsAlbum && (
                <div className="td-conditional-box">
                  <div className="td-field-group">
                    <label className="td-field-label">Ukuran Kelompok Album</label>
                    <select
                      value={draft.albumGroupSize || 10}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ albumGroupSize: Number(e.target.value) })}
                    >
                      <option value={10}>Otomatis Standard Telegram (10 media / album)</option>
                      <option value={5}>Ringkas (5 media / album)</option>
                      <option value={2}>Pasangan (2 media / album)</option>
                    </select>
                  </div>

                  <div className="td-switches-list" style={{ marginTop: '16px' }}>
                    <label className="td-switch-row">
                      <div>
                        <strong>Pisahkan Dokumen Dari Album</strong>
                        <p>Kirim berkas dokumen secara terpisah di luar grup media album.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.groupDocuments ?? true}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ groupDocuments: e.target.checked })}
                      />
                    </label>

                    <label className="td-switch-row">
                      <div>
                        <strong>Hindari Album Satu Item</strong>
                        <p>Jika tersisa 1 item, kirim sebagai pesan tunggal tanpa frame album.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.albumAvoidSingle ?? true}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumAvoidSingle: e.target.checked })}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUB-MENU 5: PENANGANAN DUPLIKAT */}
        {activeTab === 'duplicates' && (
          <div className="td-xfer-focused-panel" id="section-duplicates-main">
            <div className="td-settings-card">
              <div className="td-card-head">
                <CopyCheck size={18} />
                <div>
                  <h4>Penanganan & Kebijakan Duplikat</h4>
                  <p>Konfigurasikan bagaimana sistem mendeteksi dan menangani berkas yang sudah pernah diunggah.</p>
                </div>
              </div>

              <div className="td-radio-tiles-grid">
                <label className={`td-radio-tile ${draft.duplicatePolicy === 'SKIP' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="duplicatePolicy"
                    value="SKIP"
                    checked={draft.duplicatePolicy === 'SKIP'}
                    disabled={!!transferActive}
                    onChange={() => patch({ duplicatePolicy: 'SKIP' })}
                  />
                  <div>
                    <strong>Lewati Duplikat (Rekomendasi)</strong>
                    <p>Berkas yang sudah ada di riwayat akan otomatis dilewati.</p>
                  </div>
                </label>

                <label className={`td-radio-tile ${draft.duplicatePolicy === 'FORCE_UPLOAD' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="duplicatePolicy"
                    value="FORCE_UPLOAD"
                    checked={draft.duplicatePolicy === 'FORCE_UPLOAD'}
                    disabled={!!transferActive}
                    onChange={() => patch({ duplicatePolicy: 'FORCE_UPLOAD' })}
                  />
                  <div>
                    <strong>Tetap Unggah Ulang</strong>
                    <p>Selalu unggah berkas tanpa memeriksa riwayat duplikat.</p>
                  </div>
                </label>
              </div>

              {/* 4-LEVEL INSPECTION DETAILS INFO */}
              <div className="td-dup-inspection-info">
                <strong>Metode Verifikasi 4-Level Internal:</strong>
                <div className="td-dup-chips-row">
                  <span className="td-dup-chip">1. Message ID</span>
                  <span className="td-dup-chip">2. Unique ID Telegram</span>
                  <span className="td-dup-chip">3. SHA-256 Checksum</span>
                  <span className="td-dup-chip">4. Nama + Ukuran File</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MENU 6: DOWNLOAD */}
        {activeTab === 'download' && (
          <div className="td-xfer-focused-panel" id="section-download-performance">
            <div className="td-settings-card">
              <div className="td-card-head">
                <Download size={18} />
                <div>
                  <h4>{t('speedtest.download_parallel_header', 'Paralel Unduhan')}</h4>
                  <p>{t('speedtest.download_parallelism_hint', 'Atur jumlah berkas diunduh secara bersamaan')}</p>
                </div>
              </div>

              <div className="td-slider-row-box">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.downloadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConcurrency: Number(e.target.value) })}
                />
                <div className="td-slider-value-bar">
                  <span className="td-slider-val">{draft.downloadConcurrency} Berkas</span>
                  <span className="td-concurrency-badge">
                    {draft.downloadConcurrency <= 2 && '🐢 Stabil'}
                    {draft.downloadConcurrency >= 3 && draft.downloadConcurrency <= 5 && '⚡ Seimbang (Rekomendasi)'}
                    {draft.downloadConcurrency >= 6 && '🚀 Kecepatan Tinggi'}
                  </span>
                </div>
              </div>
            </div>

            <div className="td-settings-card" id="section-download-conflict">
              <div className="td-card-head">
                <DownloadCloud size={18} />
                <div>
                  <h4>{t('speedtest.download_reliability_title', 'Konflik File & Keandalan Unduhan')}</h4>
                  <p>{t('speedtest.download_reliability_desc', 'Atur tindakan jika nama berkas sudah ada di folder komputer')}</p>
                </div>
              </div>

              <div className="td-field-group">
                <label className="td-field-label">Kebijakan Konflik Berkas</label>
                <select
                  value={draft.downloadConflictPolicy || 'ask'}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConflictPolicy: e.target.value as any })}
                >
                  <option value="ask">Tanyakan sebelum mengunduh</option>
                  <option value="rename">Ganti nama otomatis (tambah angka)</option>
                  <option value="overwrite">Timpa berkas yang ada</option>
                  <option value="skip">Lewati berkas</option>
                </select>
              </div>

              <div className="td-switches-list" style={{ marginTop: '16px' }}>
                <label className="td-switch-row">
                  <div>
                    <strong>Lanjutkan Unduhan Parsial (Resume)</strong>
                    <p>Lanjutkan unduhan yang terputus tanpa mulai dari awal.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.downloadResumePartial ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ downloadResumePartial: e.target.checked })}
                  />
                </label>

                <label className="td-switch-row">
                  <div>
                    <strong>Notifikasi Setelah Unduhan Selesai</strong>
                    <p>Tampilkan pemberitahuan banner saat batch unduhan rampung.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.notifyDownloadDone}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ notifyDownloadDone: e.target.checked })}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MENU 7: BATAS UKURAN & PEMULIHAN */}
        {activeTab === 'limits_recovery' && (
          <div className="td-xfer-focused-panel" id="section-limits-recovery">
            <div className="td-settings-card">
              <div className="td-card-head">
                <HardDriveUpload size={18} />
                <div>
                  <h4>Batas Ukuran & Penanganan Berkas Oversize</h4>
                  <p>Tindakan otomatis saat ukuran berkas melebihi batas Telegram (2 GB / 4 GB Premium).</p>
                </div>
              </div>

              <div className="td-field-group">
                <label className="td-field-label">Tindakan Berkas Oversize</label>
                <select
                  value={draft.oversizeAction || 'split'}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ oversizeAction: e.target.value as any })}
                >
                  <option value="split">Pecah berkas otomatis (Split ZIP/Parts)</option>
                  <option value="alternate_account">Gunakan Akun Alternatif (Premium 4GB Pool)</option>
                  <option value="skip">Batalkan & Beri Tahu</option>
                </select>
              </div>

              {/* ALTERNATE ACCOUNT ROUTING SUBSECTION */}
              {draft.oversizeAction === 'alternate_account' && (
                <div className="td-conditional-box">
                  <div className="td-field-group">
                    <label className="td-field-label">Pool Akun Alternatif</label>
                    <input
                      type="text"
                      value={draft.alternateAccountPool || ''}
                      disabled={!!transferActive}
                      placeholder="account1, account2"
                      onChange={(e) => patch({ alternateAccountPool: e.target.value })}
                    />
                  </div>

                  <label className="td-switch-row" style={{ marginTop: '12px' }}>
                    <div>
                      <strong>Persetujuan Identitas Akun Alternatif</strong>
                      <p>Izinkan sistem menggunakan identitas dari pool akun yang ditentukan.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.alternateIdentityApproved}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ alternateIdentityApproved: e.target.checked })}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUB-MENU 8: PENGATURAN LANJUTAN */}
        {activeTab === 'advanced' && (
          <div className="td-xfer-focused-panel" id="section-advanced-main">
            <div className="td-settings-card">
              <div className="td-card-head">
                <SlidersHorizontal size={18} />
                <div>
                  <h4>Pengaturan Lanjutan Global</h4>
                  <p>Fitur teknis untuk pemeliharaan, sinkronisasi, dan diagnostik sistem.</p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>Sinkronisasi Tampilan Setelah Upload</strong>
                    <p>Otomatis memperbarui daftar file Obrolan Telegram setelah unggahan selesai.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.refreshAfterUpload}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ refreshAfterUpload: e.target.checked })}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* PROFILES DRAWER / MODAL OVERLAY */}
        {(showPresetDrawer || activeTab === 'profiles') && (
          <div className="td-xfer-confirm-overlay" role="presentation">
            <div className="td-xfer-drawer-modal" role="dialog" aria-modal="true">
              <div className="td-drawer-head">
                <div className="td-drawer-head-left">
                  <Sparkles size={18} className="td-preset-sparkle" />
                  <h4>{t('speedtest.transfer_profiles_title', 'Preset & Profil Konfigurasi')}</h4>
                </div>
                <button
                  type="button"
                  className="td-chip-btn"
                  onClick={() => setShowPresetDrawer(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="td-drawer-body">
                {/* 3 PRESET CARDS */}
                <h5 className="td-drawer-section-title">Pilih Preset Siap Pakai</h5>
                <div className="td-hero-presets-grid">
                  {SYSTEM_TRANSFER_PRESETS.map((preset) => {
                    const isSelected = activePresetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        className={`td-hero-preset-card ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => {
                          applyPreset(preset.settings);
                          setShowPresetDrawer(false);
                        }}
                      >
                        <div className="td-hero-card-top">
                          <h4>{preset.name}</h4>
                          {isSelected && <CheckCircle2 size={16} className="td-selected-check" />}
                        </div>
                        <p className="td-hero-card-desc">{preset.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* USER PROFILES PERSISTENCE MANAGER */}
                <h5 className="td-drawer-section-title" style={{ marginTop: '20px' }}>Manajemen Profil Tersimpan</h5>
                <div className="td-profile-mgr-card">
                  <div className="td-profile-row">
                    <select
                      value={selectedProfileId}
                      disabled={!!transferActive}
                      onChange={(e) => loadProfile(e.target.value)}
                    >
                      <option value="">{t('speedtest.transfer_profiles_new', '+ Buat Profil Baru')}</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={profileName}
                      maxLength={80}
                      disabled={!!transferActive}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder={t('speedtest.transfer_profiles_name', 'Nama Profil')}
                    />
                  </div>
                  <div className="td-profile-actions">
                    <button
                      type="button"
                      className="td-chip-btn td-chip-primary"
                      onClick={saveProfile}
                      disabled={!!transferActive || !profileName.trim()}
                    >
                      <Save size={14} /> {t('speedtest.transfer_profiles_save', 'Simpan Profil')}
                    </button>
                    <button
                      type="button"
                      className="td-chip-btn td-chip-danger"
                      onClick={deleteProfile}
                      disabled={!!transferActive || !selectedProfileId}
                    >
                      <Trash2 size={14} /> {t('speedtest.transfer_profiles_delete', 'Hapus Profil')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER ACTION BAR */}
      <footer className="td-xfer-footer">
        <button
          type="button"
          className="td-chip-btn"
          onClick={() => setShowResetConfirm(true)}
          disabled={!!transferActive}
        >
          <RotateCcw size={13} /> {t('speedtest.btn_reset_default', 'Reset Default')}
        </button>

        <div className="td-footer-right">
          {onClose && (
            <button type="button" className="td-chip-btn" onClick={onClose}>
              {t('speedtest.topbar_cancel', 'Batal')}
            </button>
          )}
          <button
            type="button"
            className="td-btn-primary"
            onClick={applySave}
            disabled={!!transferActive || !isDirty || !validation.valid}
          >
            <Save size={14} /> {isDirty ? t('speedtest.btn_save', 'Simpan Perubahan') : t('speedtest.saved', 'Tersimpan')}
          </button>
        </div>
      </footer>

      {/* RESET OVERLAY */}
      {showResetConfirm && (
        <div className="td-xfer-confirm-overlay" role="presentation">
          <div className="td-xfer-confirm-modal" role="dialog" aria-modal="true">
            <AlertTriangle size={24} className="td-confirm-icon" />
            <h4>{t('speedtest.reset_confirm_title', 'Reset Semua Pengaturan?')}</h4>
            <p>{t('speedtest.reset_confirm_desc', 'Seluruh draf pengaturan transfer akan dikembalikan ke nilai default sistem.')}</p>
            <div className="td-confirm-actions">
              <button type="button" className="td-chip-btn" onClick={() => setShowResetConfirm(false)}>
                {t('speedtest.topbar_cancel', 'Batal')}
              </button>
              <button type="button" className="td-chip-btn td-chip-danger" onClick={resetAll}>
                {t('speedtest.btn_reset_default', 'Ya, Reset Default')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DISCARD PROFILE OVERLAY */}
      {pendingProfileLoad && (
        <div className="td-xfer-confirm-overlay" role="presentation">
          <div className="td-xfer-confirm-modal" role="dialog" aria-modal="true">
            <AlertTriangle size={24} className="td-confirm-icon" />
            <h4>{t('speedtest.unsaved_profile_title', 'Buang Perubahan Saat Ini?')}</h4>
            <p>{t('speedtest.unsaved_profile_desc', 'Anda memiliki perubahan draf yang belum disimpan. Memuat profil akan membuang perubahan ini.')}</p>
            <div className="td-confirm-actions">
              <button type="button" className="td-chip-btn" onClick={() => setPendingProfileLoad(null)}>
                {t('speedtest.keep_editing', 'Batal')}
              </button>
              <button
                type="button"
                className="td-chip-btn td-chip-danger"
                onClick={() => executeLoadProfile(pendingProfileLoad)}
              >
                {t('speedtest.discard_changes', 'Buang & Muat Profil')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
