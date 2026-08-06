import { useId, useMemo, useRef, useState } from 'react';
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
  FolderTree,
  CopyCheck,
  HardDriveUpload,
  SlidersHorizontal,
  X,
  ArrowLeft,
  ChevronRight,
  Plus,
  ChevronDown,
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

export type WorkspaceTabState = 'menu' | SubMenuCategory;

export interface TransferSettingsWorkspaceProps {
  settings: DriveTransferSettings;
  onChange: (next: DriveTransferSettings) => void;
  onClose?: () => void;
  transferActive?: boolean;
  embedded?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}

export function TransferSettingsWorkspace({
  settings,
  onChange,
  onClose,
  transferActive,
  embedded = false,
  searchQuery: propsSearchQuery,
  onSearchQueryChange: propsOnSearchQueryChange,
}: TransferSettingsWorkspaceProps) {
  const { t } = useTranslation();
  const searchInputId = useId();

  // Navigation state: 'menu' (main overview list) or direct sub-menu category
  const [activeTab, setActiveTab] = useState<WorkspaceTabState>('menu');
  const [internalSettingsQuery, setInternalSettingsQuery] = useState('');

  const settingsQuery = propsSearchQuery !== undefined ? propsSearchQuery : internalSettingsQuery;
  const setSettingsQuery = propsOnSearchQueryChange || setInternalSettingsQuery;

  // Drawer / Modal overlays
  const [showPresetDrawer, setShowPresetDrawer] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Baseline vs Draft state
  const [baseline, setBaseline] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));
  const [draft, setDraft] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));

  // Profile manager state
  const [profiles, setProfiles] = useState<DriveTransferSettingsProfile[]>(() => loadTransferSettingsProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [pendingProfileLoad, setPendingProfileLoad] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownDirection, setDropdownDirection] = useState<'down' | 'up'>('down');
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const toggleDropdown = () => {
    if (!isDropdownOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 230 && spaceAbove > spaceBelow) {
        setDropdownDirection('up');
      } else {
        setDropdownDirection('down');
      }
    }
    setIsDropdownOpen((prev) => !prev);
  };

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
    setDraft((prev) => {
      const next = normalizeTransferSettings({ ...prev, ...partial });
      const validResult = validateTransferSettings(next, hardwareCapabilities);
      if (validResult.valid) {
        onChange(validResult.normalized);
        setBaseline(validResult.normalized);
      }
      return next;
    });
  };

  const resetAll = () => {
    const next = normalizeTransferSettings(DEFAULT_TRANSFER_SETTINGS);
    setDraft(next);
    setBaseline(next);
    onChange(next);
    setShowResetConfirm(false);
  };

  const applyPreset = (presetSettings: Partial<DriveTransferSettings>) => {
    const next = normalizeTransferSettings({ ...draft, ...presetSettings });
    const validResult = validateTransferSettings(next, hardwareCapabilities);
    setDraft(next);
    if (validResult.valid) {
      onChange(validResult.normalized);
      setBaseline(validResult.normalized);
    }
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

  // Sub-Menu Categories List (Displays ALL categories directly)
  const subMenuCategories: { id: SubMenuCategory; label: string; desc: string; icon: any }[] = [
    { id: 'upload', label: t('speedtest.tab_upload', 'Upload'), desc: 'Format pengiriman, caption global, penjadwalan & performa paralel unggah', icon: Upload },
    { id: 'encoding', label: t('speedtest.tab_encoding', 'Encoding Video'), desc: 'Mode encoder GPU/CPU, akselerasi hardware & kompresi video', icon: Film },
    { id: 'albums', label: t('speedtest.tab_albums', 'Pengelompokan Album'), desc: 'Grouping foto/video menjadi album Telegram & penanganan dokumen', icon: FolderTree },
    { id: 'duplicates', label: t('speedtest.tab_duplicates', 'Penanganan Duplikat'), desc: 'Pencegahan file duplikat & verifikasi 4-level', icon: CopyCheck },
    { id: 'download', label: t('speedtest.tab_download', 'Download'), desc: 'Paralelisme unduh, kebijakan konflik nama file, resume & notifikasi', icon: Download },
    { id: 'limits_recovery', label: t('speedtest.tab_limits_recovery', 'Batas Ukuran & Pemulihan'), desc: 'Penanganan berkas oversize (>2GB/4GB), split, pool akun alternatif', icon: HardDriveUpload },
    { id: 'advanced', label: t('speedtest.tab_advanced', 'Pengaturan Lanjutan'), desc: 'Sinkronisasi tampilan, retry teknis & ekspor/impor konfigurasi', icon: SlidersHorizontal },
  ];

  return (
    <div className={`td-xfer-single-workspace ${embedded ? 'is-embedded' : 'is-standalone'}`}>
      {/* TOP HEADER BAR */}
      <header className="td-xfer-header">
        <div className="td-xfer-header-left">
          {activeTab !== 'menu' ? (
            <button
              type="button"
              className="td-back-nav-btn"
              onClick={() => setActiveTab('menu')}
            >
              <ArrowLeft size={16} />
              <span>{t('speedtest.back_to_settings', 'Kembali')}</span>
            </button>
          ) : (
            <div className="td-xfer-avatar">
              <SlidersHorizontal size={20} />
            </div>
          )}

          <div>
            <h3>
              {activeTab === 'menu'
                ? t('speedtest.transfer_settings_title', 'Transfer Settings')
                : subMenuCategories.find((c) => c.id === activeTab)?.label || 'Detail Pengaturan'}
            </h3>
            <p>
              {activeTab === 'menu'
                ? t('speedtest.transfer_settings_subtitle', 'Konfigurasi unggah, unduh, dan pengodean media')
                : subMenuCategories.find((c) => c.id === activeTab)?.desc}
            </p>
          </div>
        </div>

        <div className="td-xfer-header-right">
          {isDirty && (
            <span className="td-dirty-badge">
              <span className="td-dirty-dot" />
              {t('speedtest.unsaved_changes', 'Perubahan belum disimpan')}
            </span>
          )}

          {/* Search Box / Search Results Dropdown */}
          <div className="td-xfer-search-wrapper">
            {propsSearchQuery === undefined && (
              <>
                <Search size={14} className="td-search-icon" />
                <input
                  id={searchInputId}
                  type="search"
                  value={settingsQuery}
                  onChange={(e) => setSettingsQuery(e.target.value)}
                  placeholder={t('speedtest.search_placeholder_short', 'Cari pengaturan…')}
                />
              </>
            )}

            {settingsQuery.trim() !== '' && (
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

      {/* MAIN FOCUSED WORKSPACE VIEWPORT */}
      <main className="td-xfer-panel-viewport">
        {/* LEVEL 1: MAIN MENU OVERVIEW (PRESET ACTIVE STRIP + CATEGORY LIST BUTTONS) */}
        {activeTab === 'menu' && (
          <div className="td-xfer-menu-page">
            {/* PRESET ACTIVE SUMMARY STRIP */}
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
                  <Sparkles size={13} /> {t('speedtest.preset_and_profiles_btn', 'Preset & Profil')}
                </button>
              </div>
            </section>

            {/* CATEGORIES BUTTONS LIST GRID (DIRECTLY DISPLAYS ALL CATEGORIES) */}
            <div className="td-category-menu-list">
              {subMenuCategories.map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className="td-category-menu-card"
                    onClick={() => setActiveTab(cat.id)}
                  >
                    <div className="td-cat-card-icon">
                      <Icon size={22} />
                    </div>
                    <div className="td-cat-card-info">
                      <h4>{cat.label}</h4>
                      <p>{cat.desc}</p>
                    </div>
                    <ChevronRight size={18} className="td-cat-arrow" />
                  </button>
                );
              })}
            </div>

            {/* Validation Warnings inside Summary */}
            {validation.warnings.length > 0 && (
              <div className="td-summary-warning-box" style={{ marginTop: '16px' }}>
                <AlertTriangle size={18} />
                <div>
                  <strong>{t('speedtest.warning_label', 'Peringatan Konfigurasi')}</strong>
                  <p>{validation.warnings[0].message}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEVEL 2: DEDICATED CLEAN SUB-MENU PAGES (SHOWS ALL SETTINGS DIRECTLY INCLUDING ADVANCED OPTIONS) */}

        {/* DEDICATED PAGE: UPLOAD */}
        {activeTab === 'upload' && (
          <div className="td-xfer-focused-panel" id="section-upload-format">
            <div className="td-settings-card">
              <div className="td-card-head">
                <Upload size={20} className="td-card-icon-primary" />
                <div>
                  <h4>{t('speedtest.tab_upload_title', 'Pengaturan Unggahan (Upload)')}</h4>
                  <p>{t('speedtest.tab_upload_desc', 'Atur paralelisme unggah, format pengiriman media, caption global & penjadwalan')}</p>
                </div>
              </div>

              {/* SUB-SECTION: PARALEL UNGGAH */}
              <div className="td-settings-subcard">
                <label className="td-field-label">Jumlah Unggahan Paralel (Upload Slots)</label>
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

              {/* SUB-SECTION: FORMAT PENGIRIMAN MEDIA */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">Format Pengiriman Media</label>
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

              {/* SUB-SECTION: CAPTION GLOBAL & OPERASI UNGGAH */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">Caption Global & Opsi Pengiriman</label>
                <div className="td-caption-input-box">
                  <textarea
                    rows={2}
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
                      <label>{t('speedtest.caption_overflow_label', 'Perilaku panjang')}:</label>
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

                <div className="td-switches-list" style={{ marginTop: '14px' }}>
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
            </div>
          </div>
        )}

        {/* DEDICATED PAGE: DOWNLOAD */}
        {activeTab === 'download' && (
          <div className="td-xfer-focused-panel" id="section-download-performance">
            <div className="td-settings-card">
              <div className="td-card-head">
                <Download size={20} className="td-card-icon-primary" />
                <div>
                  <h4>{t('speedtest.tab_download_title', 'Pengaturan Unduhan (Download)')}</h4>
                  <p>{t('speedtest.tab_download_desc', 'Atur paralelisme unduhan, kebijakan konflik nama berkas & keandalan resume')}</p>
                </div>
              </div>

              {/* SUB-SECTION: PARALEL UNDUHAN */}
              <div className="td-settings-subcard">
                <label className="td-field-label">Jumlah Unduhan Paralel (Download Slots)</label>
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

              {/* SUB-SECTION: KONFLIK FILE & KEANDALAN */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">Kebijakan Konflik Nama Berkas Di Komputer</label>
                <select
                  value={draft.downloadConflictPolicy || 'ask'}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConflictPolicy: e.target.value as any })}
                  style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', background: '#0f172a', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#f8fafc' }}
                >
                  <option value="ask">Tanyakan sebelum mengunduh</option>
                  <option value="rename">Ganti nama otomatis (tambah angka)</option>
                  <option value="overwrite">Timpa berkas yang ada</option>
                  <option value="skip">Lewati berkas</option>
                </select>

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
          </div>
        )}

        {/* DEDICATED PAGE: ENCODING VIDEO */}
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

            {/* ENCODING TECHNICAL OPTIONS (DIRECTLY DISPLAYED) */}
            <div className="td-settings-card">
              <div className="td-card-head">
                <SlidersHorizontal size={18} />
                <div>
                  <h4>Pengaturan Teknis Encoder Lanjutan</h4>
                  <p>Konfigurasi beban kerja prosesor dan jumlah thread encoding parallel</p>
                </div>
              </div>

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
          </div>
        )}

        {/* DEDICATED PAGE: PENGELOMPOKAN ALBUM */}
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

        {/* DEDICATED PAGE: PENANGANAN DUPLIKAT */}
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

        {/* DEDICATED PAGE: BATAS UKURAN & PEMULIHAN */}
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

        {/* DEDICATED PAGE: PENGATURAN LANJUTAN */}
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
        {showPresetDrawer && (
          <div className="td-xfer-confirm-overlay" role="presentation" onClick={() => setShowPresetDrawer(false)}>
            <div className="td-xfer-drawer-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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
                <h5 className="td-drawer-section-title" style={{ marginTop: '22px' }}>Manajemen Profil Tersimpan</h5>
                <div className="td-profile-mgr-card">
                  <div className="td-profile-row">
                    {/* CUSTOM GLASSMORPHIC PROFILE SELECTOR */}
                    <div className="td-custom-select-container">
                      <button
                        ref={triggerRef}
                        type="button"
                        className={`td-custom-select-trigger ${isDropdownOpen ? 'is-active' : ''}`}
                        onClick={toggleDropdown}
                        disabled={!!transferActive}
                      >
                        <div className="td-trigger-left">
                          <Bookmark size={15} className="td-trigger-icon" />
                          <span className="td-trigger-text">
                            {selectedProfileId
                              ? profiles.find((p) => p.id === selectedProfileId)?.name || 'Profil Kustom'
                              : t('speedtest.transfer_profiles_new', '+ Buat Profil Baru')}
                          </span>
                        </div>
                        <ChevronDown size={14} className={`td-trigger-chevron ${isDropdownOpen ? 'is-open' : ''}`} />
                      </button>

                      {/* FLOATING GLASSMORPHIC MENU */}
                      {isDropdownOpen && (
                        <>
                          <div className="td-select-backdrop" onClick={() => setIsDropdownOpen(false)} />
                          <div className={`td-custom-select-menu ${dropdownDirection === 'up' ? 'open-upward' : 'open-downward'}`}>
                            <div
                              className={`td-select-option ${!selectedProfileId ? 'is-selected' : ''}`}
                              onClick={() => {
                                setSelectedProfileId('');
                                setProfileName('');
                                setIsDropdownOpen(false);
                              }}
                            >
                              <Plus size={14} className="td-opt-icon" />
                              <span>{t('speedtest.transfer_profiles_new', '+ Buat Profil Baru')}</span>
                            </div>

                            <div className="td-select-divider" />

                            <div className="td-select-scroll-area">
                              {profiles.length > 0 ? (
                                profiles.map((p) => {
                                  const isSelected = selectedProfileId === p.id;
                                  return (
                                    <div
                                      key={p.id}
                                      className={`td-select-option ${isSelected ? 'is-selected' : ''}`}
                                      onClick={() => {
                                        loadProfile(p.id);
                                        setIsDropdownOpen(false);
                                      }}
                                    >
                                      <Bookmark size={14} className="td-opt-icon" />
                                      <span className="td-opt-name">{p.name}</span>
                                      {isSelected && <CheckCircle2 size={13} className="td-opt-check" />}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="td-select-empty">Belum ada profil tersimpan</div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* PROFILE NAME INPUT */}
                    <div className="td-profile-input-wrapper">
                      <input
                        value={profileName}
                        maxLength={80}
                        disabled={!!transferActive}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder={t('speedtest.transfer_profiles_name', 'Nama Profil')}
                        className="td-modern-profile-input"
                      />
                    </div>
                  </div>

                  <div className="td-profile-actions">
                    <button
                      type="button"
                      className="td-chip-btn td-chip-primary"
                      onClick={() => {
                        saveProfile();
                        setIsDropdownOpen(false);
                      }}
                      disabled={!!transferActive || !profileName.trim()}
                    >
                      <Save size={14} /> {selectedProfileId ? 'Update Profil' : 'Simpan Profil Baru'}
                    </button>
                    {selectedProfileId && (
                      <button
                        type="button"
                        className="td-chip-btn td-chip-danger"
                        onClick={() => {
                          deleteProfile();
                          setIsDropdownOpen(false);
                        }}
                        disabled={!!transferActive}
                      >
                        <Trash2 size={14} /> {t('speedtest.transfer_profiles_delete', 'Hapus Profil')}
                      </button>
                    )}
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
            <button type="button" className="td-chip-btn td-chip-primary" onClick={onClose}>
              {t('speedtest.topbar_close', 'Selesai')}
            </button>
          )}
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
