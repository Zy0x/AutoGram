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
  ChevronRight,
} from 'lucide-react';
import type {
  DriveTransferSettings,
  DriveTransferSettingsProfile,
  QualityMode,
  ReencodeHardware,
} from '../../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  QUALITY_MODE_OPTIONS,
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
} from './transferSettingsModel';
import {
  buildSearchRegistry,
  searchSettingsRegistry,
  type SearchableSettingItem,
} from './transferSettingsSearchRegistry';

export type SettingsCategory =
  | 'summary'
  | 'upload_quality'
  | 'video_encoding'
  | 'parallelism'
  | 'albums'
  | 'duplicates'
  | 'limits_fallback'
  | 'download'
  | 'advanced'
  | 'profiles';

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

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('upload_quality');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Baseline vs Draft state
  const [baseline, setBaseline] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));
  const [draft, setDraft] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));

  // Profile manager state
  const [profiles, setProfiles] = useState<DriveTransferSettingsProfile[]>(() => loadTransferSettingsProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');

  // Confirmation modal state
  const [pendingProfileLoad, setPendingProfileLoad] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
    if (item.tab === 'download') {
      setActiveCategory('download');
    } else if (item.tab === 'presets') {
      setActiveCategory('profiles');
    } else {
      setActiveCategory('upload_quality');
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

  // Identify active preset matching current draft
  const activePresetId = useMemo(() => {
    if (draft.qualityMode === 'ORIGINAL' && currentEncoderMode === 'disabled') return 'archival_original';
    if (draft.qualityMode === 'HIGH_QUALITY' && draft.uploadConcurrency >= 5) return 'fast_publish';
    if (draft.qualityMode === 'SMART' || (draft.qualityMode === 'HIGH_QUALITY' && draft.uploadConcurrency <= 4)) return 'balanced_default';
    return null;
  }, [draft, currentEncoderMode]);

  const categories: { id: SettingsCategory; label: string; icon: any; isAdvanced?: boolean }[] = [
    { id: 'summary', label: t('speedtest.cat_summary', 'Ringkasan'), icon: Gauge },
    { id: 'upload_quality', label: t('speedtest.cat_upload_quality', 'Kualitas Upload'), icon: Upload },
    { id: 'video_encoding', label: t('speedtest.cat_video_encoding', 'Encoding Video'), icon: Film },
    { id: 'parallelism', label: t('speedtest.cat_parallelism', 'Kecepatan & Paralelisme'), icon: Zap },
    { id: 'albums', label: t('speedtest.cat_albums', 'Pengelompokan Album'), icon: FolderTree },
    { id: 'duplicates', label: t('speedtest.cat_duplicates', 'Penanganan Duplikat'), icon: CopyCheck },
    { id: 'limits_fallback', label: t('speedtest.cat_limits', 'Batas Ukuran & Fallback'), icon: HardDriveUpload, isAdvanced: true },
    { id: 'download', label: t('speedtest.cat_download', 'Download'), icon: Download },
    { id: 'advanced', label: t('speedtest.cat_advanced', 'Pengaturan Lanjutan'), icon: SlidersHorizontal, isAdvanced: true },
    { id: 'profiles', label: t('speedtest.cat_profiles', 'Profil Tersimpan'), icon: Bookmark },
  ];

  return (
    <div className={`td-xfer-hybrid-workspace ${embedded ? 'is-embedded' : 'is-standalone'}`}>
      {/* HEADER BAR */}
      {!embedded && (
        <header className="td-hybrid-head">
          <div className="td-hybrid-head-left">
            <div className="td-hybrid-avatar">
              <SlidersHorizontal size={20} />
            </div>
            <div>
              <h3>{t('speedtest.transfer_settings_title')}</h3>
              <p>{t('speedtest.transfer_settings_subtitle')}</p>
            </div>
          </div>
          {isDirty && (
            <span className="td-dirty-badge">
              <span className="td-dirty-dot" />
              {t('speedtest.unsaved_changes', 'Perubahan belum disimpan')}
            </span>
          )}
        </header>
      )}

      {/* HERO SECTION: 3 PRESET CARDS */}
      <section className="td-hybrid-hero-presets">
        <div className="td-hero-presets-header">
          <Sparkles size={16} className="td-hero-icon" />
          <span>{t('speedtest.preset_hero_title', 'Pilih Preset Konfigurasi Siap Pakai')}</span>
        </div>
        <div className="td-hero-presets-grid">
          {SYSTEM_TRANSFER_PRESETS.map((preset) => {
            const isSelected = activePresetId === preset.id;
            return (
              <div
                key={preset.id}
                className={`td-hero-preset-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => applyPreset(preset.settings)}
              >
                <div className="td-hero-card-top">
                  <h4>{preset.name}</h4>
                  {isSelected && <CheckCircle2 size={16} className="td-selected-check" />}
                </div>
                <p className="td-hero-card-desc">{preset.description}</p>
                <div className="td-hero-card-impacts">
                  <span className="td-impact-chip">
                    {preset.id === 'fast_publish' && '⚡ Kecepatan Tinggi • 720p'}
                    {preset.id === 'balanced_default' && '⚖️ Seimbang (Default) • 1080p'}
                    {preset.id === 'archival_original' && '🎨 Kualitas Asli • No Re-encode'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SEARCH BAR */}
      <div className="td-hybrid-search-bar">
        <Search size={15} className="td-search-icon" />
        <input
          id={searchInputId}
          type="search"
          value={settingsQuery}
          onChange={(e) => setSettingsQuery(e.target.value)}
          placeholder={t('speedtest.transfer_settings_search')}
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
                  {item.label}
                </button>
              ))
            ) : (
              <span className="td-xfer-hint">{t('speedtest.transfer_settings_search_empty')}</span>
            )}
          </div>
        )}
      </div>

      {/* CLEAN 2-COLUMN LAYOUT */}
      <div className="td-hybrid-body-grid">
        {/* LEFT COLUMN: CATEGORY SIDEBAR */}
        <nav className="td-hybrid-sidebar">
          {categories.map((cat) => {
            if (cat.isAdvanced && !showAdvanced) return null;
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className={`td-hybrid-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                <Icon size={16} />
                <span>{cat.label}</span>
                {isActive && <ChevronRight size={14} className="td-nav-arrow" />}
              </button>
            );
          })}

          <button
            type="button"
            className="td-hybrid-toggle-adv"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span>{showAdvanced ? t('speedtest.hide_adv_opt', 'Sembunyikan Opsi Lanjutan') : t('speedtest.show_adv_opt', 'Tampilkan Opsi Lanjutan')}</span>
          </button>
        </nav>

        {/* RIGHT COLUMN: SETTINGS CONTENT PANEL */}
        <main className="td-hybrid-content">
          {/* CATEGORY: RINGKASAN */}
          {activeCategory === 'summary' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">{t('speedtest.cat_summary', 'Ringkasan Pengaturan Aktif')}</h3>
              <p className="td-panel-sub">{t('speedtest.summary_desc', 'Berikut adalah ringkasan status konfigurasi transfer yang digunakan saat ini.')}</p>

              <div className="td-summary-grid">
                <div className="td-summary-card">
                  <span className="td-summary-label">Kualitas Unggah</span>
                  <strong>{draft.qualityMode}</strong>
                </div>
                <div className="td-summary-card">
                  <span className="td-summary-label">Mode Encoder</span>
                  <strong>{currentEncoderMode.toUpperCase()}</strong>
                </div>
                <div className="td-summary-card">
                  <span className="td-summary-label">Unggah Paralel</span>
                  <strong>{draft.uploadConcurrency} Berkas</strong>
                </div>
                <div className="td-summary-card">
                  <span className="td-summary-label">Unduh Paralel</span>
                  <strong>{draft.downloadConcurrency} Berkas</strong>
                </div>
                <div className="td-summary-card">
                  <span className="td-summary-label">Pengelompokan Album</span>
                  <strong>{draft.groupAsAlbum ? 'Aktif' : 'Nonaktif'}</strong>
                </div>
                <div className="td-summary-card">
                  <span className="td-summary-label">Penanganan Duplikat</span>
                  <strong>{draft.duplicatePolicy === 'SKIP' ? 'Lewati' : 'Unggah Ulang'}</strong>
                </div>
              </div>
            </div>
          )}

          {/* CATEGORY: KUALITAS UPLOAD */}
          {activeCategory === 'upload_quality' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">{t('speedtest.upload_quality_header', 'KUALITAS UNGGAHAN')}</h3>
              <p className="td-panel-sub">{t('speedtest.upload_quality_hint')}</p>

              <div className="td-radio-group">
                {QUALITY_MODE_OPTIONS.map((opt: any) => (
                  <label key={opt.id} className={`td-hybrid-radio-row ${draft.qualityMode === opt.id ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="qualityMode"
                      value={opt.id}
                      checked={draft.qualityMode === opt.id}
                      disabled={!!transferActive}
                      onChange={() => patch({ qualityMode: opt.id as QualityMode, forceDocumentDefault: false })}
                    />
                    <div>
                      <strong>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_label`))}</strong>
                      <p>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_desc`))}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* CATEGORY: ENCODING VIDEO */}
          {activeCategory === 'video_encoding' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">{t('speedtest.encoder_mode_title')}</h3>
              <p className="td-panel-sub">{t('speedtest.encoder_mode_desc')}</p>

              <div className="td-encoder-2x2-grid">
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
                      <strong>{t('speedtest.encoder_mode_auto_title')}</strong>
                    </div>
                    <p>{t('speedtest.encoder_mode_auto_desc')}</p>
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
                      <strong>{t('speedtest.encoder_mode_hardware_title')}</strong>
                    </div>
                    <p>{t('speedtest.encoder_mode_hardware_desc')}</p>
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
                      <strong>{t('speedtest.encoder_mode_software_title')}</strong>
                    </div>
                    <p>{t('speedtest.encoder_mode_software_desc')}</p>
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
                      <strong>{t('speedtest.encoder_mode_disable_title')}</strong>
                    </div>
                    <p>{t('speedtest.encoder_mode_disable_desc')}</p>
                  </div>
                </label>
              </div>

              {/* STRICT PROGRESSIVE DISCLOSURE: GPU SELECTOR ONLY SHOWS WHEN HARDWARE MODE IS ACTIVE */}
              {currentEncoderMode === 'hardware' && (
                <div className="td-progressive-child-box">
                  <label className="td-field-label">{t('speedtest.hardware_reencode_header', 'Pilih Perangkat GPU Fisik')}</label>
                  <MediaSelect
                    value={draft.reencodeHardware}
                    disabled={!!transferActive}
                    onChange={(val) => patch(applyUnifiedEncodingMode(draft, 'hardware', { targetHw: val as ReencodeHardware }))}
                    onOpen={fetchHardwareCapabilities}
                    ariaLabel={t('speedtest.hardware_reencode_header')}
                    options={hardwareOptions}
                  />
                </div>
              )}

              {/* STRICT PROGRESSIVE DISCLOSURE: GUARDRAIL NOTE ONLY SHOWS WHEN DISABLE REENCODE IS ACTIVE */}
              {currentEncoderMode === 'disabled' && (
                <div className="td-progressive-child-box is-warning">
                  <ShieldAlert size={16} />
                  <span>{t('speedtest.encoder_mode_disable_warning')}</span>
                </div>
              )}
            </div>
          )}

          {/* CATEGORY: KECEPATAN & PARALELISME */}
          {activeCategory === 'parallelism' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">{t('speedtest.upload_parallelism_header')}</h3>
              <p className="td-panel-sub">{t('speedtest.upload_parallelism_hint')}</p>

              <div className="td-slider-row">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.uploadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ uploadConcurrency: Number(e.target.value) })}
                />
                <span className="td-slider-val">{draft.uploadConcurrency} Berkas</span>
                <span className="td-concurrency-badge">
                  {draft.uploadConcurrency <= 2 && t('speedtest.concurrency_badge_low')}
                  {draft.uploadConcurrency >= 3 && draft.uploadConcurrency <= 5 && t('speedtest.concurrency_badge_recommended')}
                  {draft.uploadConcurrency >= 6 && t('speedtest.concurrency_badge_high')}
                </span>
              </div>
            </div>
          )}

          {/* CATEGORY: PENGELOMPOKAN ALBUM */}
          {activeCategory === 'albums' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">{t('speedtest.send_options_header')}</h3>

              <div className="td-checkbox-list">
                <label className="td-hybrid-check-row">
                  <input
                    type="checkbox"
                    checked={draft.groupAsAlbum}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ groupAsAlbum: e.target.checked })}
                  />
                  <div>
                    <strong>{t('speedtest.send_as_album')}</strong>
                    <p>{t('speedtest.send_as_album_desc')}</p>
                  </div>
                </label>

                {/* STRICT PROGRESSIVE DISCLOSURE: ALBUM SIZE OPTIONS ONLY RENDER WHEN GROUP AS ALBUM IS CHECKED */}
                {draft.groupAsAlbum && (
                  <div className="td-progressive-child-box">
                    <label className="td-field-label">Ukuran Kelompok Album</label>
                    <select
                      value={draft.albumGroupSize || 10}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ albumGroupSize: Number(e.target.value) })}
                    >
                      <option value={10}>Standard Telegram (10 media / album)</option>
                      <option value={5}>Ringkas (5 media / album)</option>
                      <option value={2}>Pasangan (2 media / album)</option>
                    </select>
                  </div>
                )}

                <label className="td-hybrid-check-row">
                  <input
                    type="checkbox"
                    checked={draft.silent}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ silent: e.target.checked })}
                  />
                  <div>
                    <strong>{t('speedtest.send_silent')}</strong>
                    <p>{t('speedtest.send_silent_desc')}</p>
                  </div>
                </label>

                <label className="td-hybrid-check-row">
                  <input
                    type="checkbox"
                    checked={draft.spoiler}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ spoiler: e.target.checked })}
                  />
                  <div>
                    <strong>{t('speedtest.send_spoiler')}</strong>
                    <p>{t('speedtest.send_spoiler_desc')}</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* CATEGORY: PENANGANAN DUPLIKAT */}
          {activeCategory === 'duplicates' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">Pencegahan & Kebijakan Duplikat</h3>
              <p className="td-panel-sub">Konfigurasikan bagaimana sistem menangani berkas yang sudah pernah diunggah.</p>

              <div className="td-checkbox-list">
                <label className="td-hybrid-check-row">
                  <input
                    type="checkbox"
                    checked={draft.duplicatePolicy === 'SKIP'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ duplicatePolicy: e.target.checked ? 'SKIP' : 'FORCE_UPLOAD' })}
                  />
                  <div>
                    <strong>{t('speedtest.skip_uploaded_files')}</strong>
                    <p>{t('speedtest.skip_uploaded_desc')}</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* CATEGORY: BATAS UKURAN & FALLBACK */}
          {activeCategory === 'limits_fallback' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">Batas Ukuran & Penanganan Kesalahan</h3>
              <p className="td-panel-sub">Pengaturan otomatis saat ukuran berkas melebihi batas Telegram.</p>

              <div className="td-checkbox-list">
                <label className="td-hybrid-check-row">
                  <input
                    type="checkbox"
                    checked={draft.forceDocumentDefault}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ forceDocumentDefault: e.target.checked })}
                  />
                  <div>
                    <strong>Paksa Sebagai Dokumen</strong>
                    <p>Kirim seluruh media sebagai dokumen tanpa pemrosesan pratinjau media.</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* CATEGORY: DOWNLOAD */}
          {activeCategory === 'download' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">{t('speedtest.download_parallel_header', 'PARALEL DOWNLOAD')}</h3>
              <p className="td-panel-sub">{t('speedtest.download_parallelism_hint')}</p>

              <div className="td-slider-row">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.downloadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConcurrency: Number(e.target.value) })}
                />
                <span className="td-slider-val">{draft.downloadConcurrency} Berkas</span>
                <span className="td-concurrency-badge">
                  {draft.downloadConcurrency <= 2 && t('speedtest.concurrency_badge_low')}
                  {draft.downloadConcurrency >= 3 && draft.downloadConcurrency <= 5 && t('speedtest.concurrency_badge_recommended')}
                  {draft.downloadConcurrency >= 6 && t('speedtest.concurrency_badge_high')}
                </span>
              </div>

              <h3 className="td-panel-title" style={{ marginTop: '24px' }}>{t('speedtest.download_behavior_header', 'PERILAKU DOWNLOAD')}</h3>
              <div className="td-checkbox-list">
                <label className="td-hybrid-check-row">
                  <input
                    type="checkbox"
                    checked={draft.notifyDownloadDone}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ notifyDownloadDone: e.target.checked })}
                  />
                  <div>
                    <strong>{t('speedtest.download_status_title')}</strong>
                    <p>{t('speedtest.download_status_desc')}</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* CATEGORY: ADVANCED */}
          {activeCategory === 'advanced' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">Routing Akun & Pengaturan Mahir</h3>
              <p className="td-panel-sub">Pengaturan khusus untuk mengoptimalkan transfer multi-akun.</p>

              <div className="td-checkbox-list">
                <label className="td-hybrid-check-row">
                  <input
                    type="checkbox"
                    checked={draft.refreshAfterUpload}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ refreshAfterUpload: e.target.checked })}
                  />
                  <div>
                    <strong>{t('speedtest.refresh_after_upload')}</strong>
                    <p>{t('speedtest.refresh_after_upload_desc')}</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* CATEGORY: PROFILES */}
          {activeCategory === 'profiles' && (
            <div className="td-hybrid-panel">
              <h3 className="td-panel-title">{t('speedtest.transfer_profiles_title')}</h3>
              <p className="td-panel-sub">{t('speedtest.transfer_profiles_desc')}</p>

              <div className="td-profile-mgr-card">
                <div className="td-profile-row">
                  <select
                    value={selectedProfileId}
                    disabled={!!transferActive}
                    onChange={(e) => loadProfile(e.target.value)}
                  >
                    <option value="">{t('speedtest.transfer_profiles_new')}</option>
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
                    placeholder={t('speedtest.transfer_profiles_name')}
                  />
                </div>
                <div className="td-profile-actions">
                  <button
                    type="button"
                    className="td-chip-btn td-chip-primary"
                    onClick={saveProfile}
                    disabled={!!transferActive || !profileName.trim()}
                  >
                    <Save size={14} /> {t('speedtest.transfer_profiles_save')}
                  </button>
                  <button
                    type="button"
                    className="td-chip-btn td-chip-danger"
                    onClick={deleteProfile}
                    disabled={!!transferActive || !selectedProfileId}
                  >
                    <Trash2 size={14} /> {t('speedtest.transfer_profiles_delete')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* VALIDATION WARNING STRIP */}
      {validation.warnings.length > 0 && (
        <div className="td-xfer-validation-strip warning" role="alert">
          <AlertTriangle size={15} />
          <span>{validation.warnings[0].message}</span>
        </div>
      )}

      {/* FOOTER ACTION BAR */}
      <footer className="td-hybrid-foot">
        <button
          type="button"
          className="td-chip-btn"
          onClick={() => setShowResetConfirm(true)}
          disabled={!!transferActive}
        >
          <RotateCcw size={13} /> {t('speedtest.btn_reset_default')}
        </button>
        <div className="td-hybrid-foot-right">
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
