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
  Info,
  ChevronDown,
  ChevronUp,
  Trash2,
  AlertTriangle,
  Sparkles,
  Layers,
  CheckCircle2,
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
import { TransferOrchestrationSettings } from './TransferOrchestrationSettings';
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

type Tab = 'upload' | 'download' | 'presets';

export interface TransferSettingsWorkspaceProps {
  settings: DriveTransferSettings;
  onChange: (next: DriveTransferSettings) => void;
  onClose?: () => void;
  transferActive?: boolean;
  /** Whether rendered inside a modal wrapper or embedded in tools drawer panel */
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

  const [tab, setTab] = useState<Tab>('upload');
  const [basicMode, setBasicMode] = useState(true);
  const [showAdvancedAccordion, setShowAdvancedAccordion] = useState(false);

  // Baseline vs Draft state
  const [baseline, setBaseline] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));
  const [draft, setDraft] = useState<DriveTransferSettings>(() => normalizeTransferSettings(settings));

  // Profile manager state
  const [profiles, setProfiles] = useState<DriveTransferSettingsProfile[]>(() => loadTransferSettingsProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');

  // Unsaved confirmation modal state
  const [pendingProfileLoad, setPendingProfileLoad] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const { hardwareCapabilities, isDetectingHardware, fetchHardwareCapabilities } = useTransferHardwareCapabilities();

  // Search registry
  const searchRegistry = useMemo(() => buildSearchRegistry(t), [t]);
  const searchResults = useMemo(
    () => searchSettingsRegistry(searchRegistry, settingsQuery),
    [searchRegistry, settingsQuery]
  );

  // Check if draft has unsaved changes compared to baseline
  const isDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }, [draft, baseline]);

  // Validation state
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

  const applyPreset = (presetSettings: Partial<DriveTransferSettings>) => {
    const next = normalizeTransferSettings({ ...draft, ...presetSettings });
    setDraft(next);
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
    setTab(item.tab);
    if (item.mode === 'advanced') {
      setBasicMode(false);
      setShowAdvancedAccordion(true);
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

  return (
    <div className={`td-xfer-workspace ${embedded ? 'is-embedded' : 'is-standalone'}`}>
      {/* Header bar */}
      <header className="td-xfer-workspace-head">
        {!embedded ? (
          <div className="td-xfer-workspace-title">
            <div className="td-xfer-head-avatar">
              <Sliders size={22} className="td-xfer-icon-glow" />
            </div>
            <div>
              <h3>{t('speedtest.transfer_settings_title')}</h3>
              <p>{t('speedtest.transfer_settings_subtitle')}</p>
            </div>
          </div>
        ) : (
          <div className="td-mode-segmented-control" role="group" aria-label="Mode selector">
            <button
              type="button"
              className={`td-segmented-btn ${basicMode ? 'active' : ''}`}
              onClick={() => setBasicMode(true)}
            >
              <Zap size={13} />
              {t('speedtest.mode_toggle_basic')}
            </button>
            <button
              type="button"
              className={`td-segmented-btn ${!basicMode ? 'active' : ''}`}
              onClick={() => setBasicMode(false)}
            >
              <Layers size={13} />
              {t('speedtest.mode_toggle_advanced')}
            </button>
          </div>
        )}

        <div className="td-xfer-workspace-head-right">
          {isDirty && (
            <span className="td-dirty-badge" role="status">
              <span className="td-dirty-dot" />
              {t('speedtest.unsaved_changes', 'Perubahan belum disimpan')}
            </span>
          )}

          {!embedded && (
            <div className="td-mode-segmented-control" role="group" aria-label="Mode selector">
              <button
                type="button"
                className={`td-segmented-btn ${basicMode ? 'active' : ''}`}
                onClick={() => setBasicMode(true)}
              >
                <Zap size={13} />
                {t('speedtest.mode_toggle_basic')}
              </button>
              <button
                type="button"
                className={`td-segmented-btn ${!basicMode ? 'active' : ''}`}
                onClick={() => setBasicMode(false)}
              >
                <Layers size={13} />
                {t('speedtest.mode_toggle_advanced')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Tabs Row */}
      <div className="td-xfer-workspace-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upload'}
          className={`td-xfer-tab ${tab === 'upload' ? 'active' : ''}`}
          onClick={() => setTab('upload')}
        >
          <Upload size={15} />
          {t('speedtest.upload_tab', 'Unggah')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'download'}
          className={`td-xfer-tab ${tab === 'download' ? 'active' : ''}`}
          onClick={() => setTab('download')}
        >
          <Download size={15} />
          {t('speedtest.download_tab', 'Unduh')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'presets'}
          className={`td-xfer-tab ${tab === 'presets' ? 'active' : ''}`}
          onClick={() => setTab('presets')}
        >
          <Bookmark size={15} />
          {t('speedtest.presets_tab', 'Presets & Profil')}
        </button>
      </div>

      {/* Search Input */}
      <div className="td-xfer-search-bar-wrap">
        <label htmlFor={searchInputId} className="td-xfer-range-row td-xfer-search-row">
          <Search size={15} className="td-search-icon" aria-hidden />
          <input
            id={searchInputId}
            type="search"
            value={settingsQuery}
            onChange={(event) => setSettingsQuery(event.target.value)}
            placeholder={t('speedtest.transfer_settings_search')}
            aria-label={t('speedtest.transfer_settings_search')}
          />
        </label>
        {settingsQuery.trim() && (
          <div className="td-xfer-search-results" role="navigation">
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

      {/* Main Settings Body */}
      <div className="td-xfer-settings-body">
        {/* PRESETS TAB */}
        {tab === 'presets' && (
          <section className="td-xfer-section">
            <h3>{t('speedtest.system_presets_title', 'System Presets (Rekomendasi)')}</h3>
            <p className="td-xfer-hint">{t('speedtest.system_presets_desc', 'Pilih preset siap pakai untuk mengonfigurasi transfer secara cepat.')}</p>
            <div className="td-system-presets-grid">
              {SYSTEM_TRANSFER_PRESETS.map((preset) => (
                <div key={preset.id} className="td-system-preset-card">
                  <div className="td-preset-card-head">
                    <Sparkles size={16} className="td-preset-icon" />
                    <h4>{preset.name}</h4>
                  </div>
                  <p>{preset.description}</p>
                  <button
                    type="button"
                    className="td-chip-btn td-chip-primary"
                    disabled={!!transferActive}
                    onClick={() => applyPreset(preset.settings)}
                  >
                    <CheckCircle2 size={14} /> {t('speedtest.apply_preset', 'Terapkan Preset')}
                  </button>
                </div>
              ))}
            </div>

            <h3 style={{ marginTop: '28px' }}>{t('speedtest.transfer_profiles_title')}</h3>
            <p className="td-xfer-hint">{t('speedtest.transfer_profiles_desc')}</p>
            <div className="td-profile-mgr-card">
              <div className="td-profile-row">
                <select
                  value={selectedProfileId}
                  disabled={!!transferActive}
                  onChange={(event) => loadProfile(event.target.value)}
                  aria-label={t('speedtest.transfer_profiles_select')}
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
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder={t('speedtest.transfer_profiles_name')}
                  aria-label={t('speedtest.transfer_profiles_name')}
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
          </section>
        )}

        {/* UPLOAD TAB */}
        {tab === 'upload' && (
          <section id="transfer-quality" className="td-xfer-section" aria-label={t('speedtest.upload_settings_aria')}>
            <h3>{t('speedtest.upload_quality_header', 'KUALITAS UNGGAHAN')}</h3>
            <p className="td-xfer-hint">{t('speedtest.upload_quality_hint')}</p>
            <div className="td-xfer-radio-list" role="radiogroup">
              {QUALITY_MODE_OPTIONS.map((opt: any) => (
                <label key={opt.id} className={`td-xfer-radio ${draft.qualityMode === opt.id ? 'is-on' : ''}`}>
                  <input
                    type="radio"
                    name="qualityMode"
                    value={opt.id}
                    checked={draft.qualityMode === opt.id}
                    disabled={!!transferActive}
                    onChange={() => patch({ qualityMode: opt.id as QualityMode, forceDocumentDefault: false })}
                  />
                  <span>
                    <strong>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_label`))}</strong>
                    <small>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_desc`))}</small>
                  </span>
                </label>
              ))}
            </div>

            {/* UNIFIED 4-MODE ENCODER ARCHITECTURE */}
            <h3 id="transfer-encoder-mode">{t('speedtest.encoder_mode_title')}</h3>
            <p className="td-xfer-hint">{t('speedtest.encoder_mode_desc')}</p>
            <div className="td-encoder-modes-grid" role="radiogroup">
              {/* MODE 1: AUTO */}
              <label className={`td-xfer-radio td-encoder-card ${currentEncoderMode === 'automatic' ? 'is-on' : ''}`}>
                <input
                  type="radio"
                  name="encoderUnifiedMode"
                  value="automatic"
                  checked={currentEncoderMode === 'automatic'}
                  disabled={!!transferActive}
                  onChange={() => patch(applyUnifiedEncodingMode(draft, 'automatic'))}
                />
                <span>
                  <strong className="td-mode-flex-title">
                    <span className="td-mode-icon-badge is-auto">
                      <Zap size={16} />
                    </span>
                    {t('speedtest.encoder_mode_auto_title')}
                  </strong>
                  <small>{t('speedtest.encoder_mode_auto_desc')}</small>
                </span>
              </label>

              {/* MODE 2: HARDWARE GPU */}
              <label className={`td-xfer-radio td-encoder-card ${currentEncoderMode === 'hardware' ? 'is-on' : ''}`}>
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
                <span>
                  <strong className="td-mode-flex-title">
                    <span className="td-mode-icon-badge is-gpu">
                      <Film size={16} />
                    </span>
                    {t('speedtest.encoder_mode_hardware_title')}
                  </strong>
                  <small>{t('speedtest.encoder_mode_hardware_desc')}</small>
                </span>
              </label>

              {/* MODE 3: SOFTWARE CPU */}
              <label className={`td-xfer-radio td-encoder-card ${currentEncoderMode === 'software' ? 'is-on' : ''}`}>
                <input
                  type="radio"
                  name="encoderUnifiedMode"
                  value="software"
                  checked={currentEncoderMode === 'software'}
                  disabled={!!transferActive}
                  onChange={() => patch(applyUnifiedEncodingMode(draft, 'software'))}
                />
                <span>
                  <strong className="td-mode-flex-title">
                    <span className="td-mode-icon-badge is-cpu">
                      <Cpu size={16} />
                    </span>
                    {t('speedtest.encoder_mode_software_title')}
                  </strong>
                  <small>{t('speedtest.encoder_mode_software_desc')}</small>
                </span>
              </label>

              {/* MODE 4: DISABLE REENCODE */}
              <label className={`td-xfer-radio td-encoder-card ${currentEncoderMode === 'disabled' ? 'is-on' : ''}`}>
                <input
                  type="radio"
                  name="encoderUnifiedMode"
                  value="disabled"
                  checked={currentEncoderMode === 'disabled'}
                  disabled={!!transferActive}
                  onChange={() => patch(applyUnifiedEncodingMode(draft, 'disabled'))}
                />
                <span>
                  <strong className="td-mode-flex-title">
                    <span className="td-mode-icon-badge is-disable">
                      <Sliders size={16} />
                    </span>
                    {t('speedtest.encoder_mode_disable_title')}
                  </strong>
                  <small>{t('speedtest.encoder_mode_disable_desc')}</small>
                </span>
              </label>
            </div>

            {currentEncoderMode === 'hardware' && (
              <div className="td-xfer-nested-select">
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

            {currentEncoderMode === 'disabled' && (
              <div className="td-xfer-note td-xfer-note-warning">
                <ShieldAlert size={16} />
                <span>{t('speedtest.encoder_mode_disable_warning')}</span>
              </div>
            )}

            <h3>{t('speedtest.upload_parallelism_header')}</h3>
            <p className="td-xfer-hint">{t('speedtest.upload_parallelism_hint')}</p>
            <label className="td-xfer-range-row">
              <input
                type="range"
                min={1}
                max={8}
                value={draft.uploadConcurrency}
                disabled={!!transferActive}
                onChange={(e) => patch({ uploadConcurrency: Number(e.target.value) })}
                aria-label={t('speedtest.upload_parallelism_header')}
              />
              <span className="td-xfer-range-val">{draft.uploadConcurrency}</span>
              <span className="td-concurrency-badge">
                {draft.uploadConcurrency <= 2 && t('speedtest.concurrency_badge_low')}
                {draft.uploadConcurrency >= 3 && draft.uploadConcurrency <= 5 && t('speedtest.concurrency_badge_recommended')}
                {draft.uploadConcurrency >= 6 && t('speedtest.concurrency_badge_high')}
              </span>
            </label>

            <h3 id="transfer-send">{t('speedtest.send_options_header')}</h3>
            <div className="td-xfer-checks">
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.groupAsAlbum}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ groupAsAlbum: e.target.checked })}
                />
                <span>
                  <strong>{t('speedtest.send_as_album')}</strong>
                  <small>{t('speedtest.send_as_album_desc')}</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.silent}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ silent: e.target.checked })}
                />
                <span>
                  <strong>{t('speedtest.send_silent')}</strong>
                  <small>{t('speedtest.send_silent_desc')}</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.spoiler}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ spoiler: e.target.checked })}
                />
                <span>
                  <strong>{t('speedtest.send_spoiler')}</strong>
                  <small>{t('speedtest.send_spoiler_desc')}</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.refreshAfterUpload}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ refreshAfterUpload: e.target.checked })}
                />
                <span>
                  <strong>{t('speedtest.refresh_after_upload')}</strong>
                  <small>{t('speedtest.refresh_after_upload_desc')}</small>
                </span>
              </label>
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.duplicatePolicy === 'SKIP'}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ duplicatePolicy: e.target.checked ? 'SKIP' : 'FORCE_UPLOAD' })}
                />
                <span>
                  <strong>{t('speedtest.skip_uploaded_files')}</strong>
                  <small>{t('speedtest.skip_uploaded_desc')}</small>
                </span>
              </label>
            </div>

            {/* ADVANCED ORCHESTRATION ACCORDION */}
            {(!basicMode || showAdvancedAccordion) && (
              <div className="td-xfer-accordion-wrapper">
                <TransferOrchestrationSettings
                  mode="upload"
                  settings={draft}
                  onChange={patch}
                  disabled={!!transferActive}
                />
              </div>
            )}

            {basicMode && (
              <button
                type="button"
                className="td-accordion-toggle-btn"
                onClick={() => setShowAdvancedAccordion(!showAdvancedAccordion)}
              >
                <span>
                  <strong>{t('speedtest.advanced_accordion_title')}</strong>
                  <small>{t('speedtest.advanced_accordion_desc')}</small>
                </span>
                {showAdvancedAccordion ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
            )}

            <h3>{t('speedtest.default_caption_title')}</h3>
            <p className="td-xfer-hint">{t('speedtest.default_caption_hint')}</p>
            <textarea
              className="td-xfer-textarea"
              rows={3}
              maxLength={65536}
              placeholder={t('speedtest.optional_caption_ph')}
              value={draft.globalCaption}
              disabled={!!transferActive}
              onChange={(e) => patch({ globalCaption: e.target.value })}
            />
            <div className="td-xfer-charcount">
              {t('speedtest.caption_utf16_count', {
                count: [...draft.globalCaption].reduce<number>((tot, char) => tot + char.length, 0),
              })}
            </div>

            <div className="td-xfer-note">
              <Info size={14} />
              <span>{t('speedtest.upload_note_box')}</span>
            </div>
          </section>
        )}

        {/* DOWNLOAD TAB */}
        {tab === 'download' && (
          <section id="transfer-download" className="td-xfer-section" aria-label={t('speedtest.download_settings_aria')}>
            <h3>{t('speedtest.download_parallel_header', 'PARALEL DOWNLOAD')}</h3>
            <p className="td-xfer-hint">{t('speedtest.download_parallelism_hint')}</p>
            <label className="td-xfer-range-row">
              <input
                type="range"
                min={1}
                max={8}
                value={draft.downloadConcurrency}
                disabled={!!transferActive}
                onChange={(e) => patch({ downloadConcurrency: Number(e.target.value) })}
                aria-label={t('speedtest.download_parallel_header')}
              />
              <span className="td-xfer-range-val">{draft.downloadConcurrency}</span>
              <span className="td-concurrency-badge">
                {draft.downloadConcurrency <= 2 && t('speedtest.concurrency_badge_low')}
                {draft.downloadConcurrency >= 3 && draft.downloadConcurrency <= 5 && t('speedtest.concurrency_badge_recommended')}
                {draft.downloadConcurrency >= 6 && t('speedtest.concurrency_badge_high')}
              </span>
            </label>

            <h3>{t('speedtest.download_behavior_header', 'PERILAKU DOWNLOAD')}</h3>
            <div className="td-xfer-checks">
              <label className="td-xfer-check">
                <input
                  type="checkbox"
                  checked={draft.notifyDownloadDone}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ notifyDownloadDone: e.target.checked })}
                />
                <span>
                  <strong>{t('speedtest.download_status_title')}</strong>
                  <small>{t('speedtest.download_status_desc')}</small>
                </span>
              </label>
            </div>

            <TransferOrchestrationSettings
              mode="download"
              settings={draft}
              onChange={patch}
              disabled={!!transferActive}
            />

            <div className="td-xfer-note">
              <Info size={14} />
              <span>{t('speedtest.download_note_box')}</span>
            </div>
          </section>
        )}
      </div>

      {/* Validation Warnings */}
      {validation.warnings.length > 0 && (
        <div className="td-xfer-validation-strip warning" role="alert">
          <AlertTriangle size={15} />
          <span>{validation.warnings[0].message}</span>
        </div>
      )}

      {/* Footer bar */}
      <footer className="td-xfer-settings-foot">
        <button
          type="button"
          className="td-chip-btn"
          onClick={() => setShowResetConfirm(true)}
          disabled={!!transferActive}
        >
          <RotateCcw size={13} /> {t('speedtest.btn_reset_default')}
        </button>
        <div className="td-xfer-settings-foot-right">
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
            <Save size={14} /> {isDirty ? t('speedtest.btn_save', 'Simpan') : t('speedtest.saved', 'Tersimpan')}
          </button>
        </div>
      </footer>

      {/* Reset Confirmation Overlay */}
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

      {/* Unsaved Load Profile Confirm */}
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
