import { useTranslation } from 'react-i18next';
/**
 * Dedicated Upload / Download settings panel for Media Studio.
 * Surfaces every transfer option supported by the desktop worker UI path.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Settings2,
  Upload,
  Download,
  RotateCcw,
  Info,
  Save,
  Trash2,
  Search,
  Sliders,
  Cpu,
  Zap,
  Film,
  Bookmark,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
} from 'lucide-react';
import type { DriveTransferSettings, DriveTransferSettingsProfile, QualityMode } from '../../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  QUALITY_MODE_OPTIONS,
  clampConcurrency,
  loadTransferSettingsProfiles,
  saveTransferSettingsProfiles,
} from '../../../lib/telegram/driveTypes';
import { MediaSelect } from '../Navigation/MediaSelect';
import { useTransferHardwareCapabilities } from '../../../stores/transferProgressStore';
import { TransferOrchestrationSettings } from './TransferOrchestrationSettings';
import { buildEncoderHardwareOptions, isExplicitEncoderDevice } from './encoderHardwareOptions';

type Tab = 'upload' | 'download' | 'presets';

type Props = {
  open: boolean;
  settings: DriveTransferSettings;
  onChange: (next: DriveTransferSettings) => void;
  onClose: () => void;
  /** Transfer in progress — disable destructive toggles */
  transferActive?: boolean;
};

export function DriveTransferSettings({
  open,
  settings,
  onChange,
  onClose,
  transferActive,
}: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [tab, setTab] = useState<Tab>('upload');
  const [basicMode, setBasicMode] = useState(true);
  const [showAdvancedAccordion, setShowAdvancedAccordion] = useState(false);
  const [draft, setDraft] = useState<DriveTransferSettings>(() => ({
    ...DEFAULT_TRANSFER_SETTINGS,
    ...settings,
  }));
  const [profiles, setProfiles] = useState<DriveTransferSettingsProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');

  const { hardwareCapabilities, isDetectingHardware, fetchHardwareCapabilities } = useTransferHardwareCapabilities();

  useEffect(() => {
    if (open) {
      setDraft({
        ...DEFAULT_TRANSFER_SETTINGS,
        ...settings,
      });
      setTab('upload');
      setProfiles(loadTransferSettingsProfiles());
      setSelectedProfileId('');
      setProfileName('');
      setSettingsQuery('');
      setBasicMode(true);
      setShowAdvancedAccordion(false);
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const patch = (partial: Partial<DriveTransferSettings>) => {
    setDraft((d: any) => ({ ...d, ...partial }));
  };

  const apply = () => {
    const next: DriveTransferSettings = {
      ...draft,
      uploadConcurrency: clampConcurrency(draft.uploadConcurrency),
      downloadConcurrency: clampConcurrency(draft.downloadConcurrency),
      globalCaption: (draft.globalCaption || '').slice(0, 65_536),
      albumGroupSize: Math.max(2, Math.min(10, draft.albumGroupSize)),
      encoderMaxParallel: Math.max(1, Math.min(4, draft.encoderMaxParallel)),
    };
    onChange(next);
    onClose();
  };

  const reset = () => {
    setDraft({ ...DEFAULT_TRANSFER_SETTINGS });
  };

  const loadProfile = (id: string) => {
    setSelectedProfileId(id);
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) return;
    setProfileName(profile.name);
    setDraft({ ...DEFAULT_TRANSFER_SETTINGS, ...profile.settings });
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
    const next = [nextProfile, ...profiles.filter((candidate) => candidate.id !== id)];
    setProfiles(next);
    setSelectedProfileId(id);
    saveTransferSettingsProfiles(next);
  };

  const deleteProfile = () => {
    if (!selectedProfileId) return;
    const next = profiles.filter((candidate) => candidate.id !== selectedProfileId);
    setProfiles(next);
    setSelectedProfileId('');
    setProfileName('');
    saveTransferSettingsProfiles(next);
  };

  const settingsSearchResults = useMemo(() => {
    const query = settingsQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    const entries = [
      { tab: 'upload' as const, id: 'transfer-quality', label: String(t('speedtest.upload_quality_header')) },
      { tab: 'upload' as const, id: 'transfer-encoder-mode', label: String(t('speedtest.encoder_mode_title')) },
      { tab: 'upload' as const, id: 'transfer-send', label: String(t('speedtest.send_options_header')) },
      { tab: 'upload' as const, id: 'transfer-orchestration', label: String(t('speedtest.album_orchestration_title')) },
      { tab: 'download' as const, id: 'transfer-download', label: String(t('speedtest.download_reliability_title')) },
    ];
    return entries.filter((entry) => entry.label.toLocaleLowerCase().includes(query));
  }, [settingsQuery, t]);

  const jumpToSetting = (nextTab: Tab, id: string) => {
    setTab(nextTab);
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const hardwareOptions = useMemo(() => {
    return buildEncoderHardwareOptions(hardwareCapabilities, t, isDetectingHardware);
  }, [hardwareCapabilities, isDetectingHardware, t]);

  // Determine current active unified encoder mode
  const currentEncoderMode = useMemo(() => {
    if (draft.encoderStrategy === 'disable_reencode') return 'disable';
    if (draft.encoderStrategy === 'software_only' || draft.reencodeHardware === 'cpu') return 'software';
    if (draft.encoderStrategy === 'hardware_preferred' || isExplicitEncoderDevice(draft.reencodeHardware)) return 'hardware';
    return 'auto';
  }, [draft.encoderStrategy, draft.reencodeHardware]);

  if (!open) return null;

  const node = (
    <div
      className="td-xfer-settings-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="td-xfer-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="td-xfer-settings-head">
          <div className="td-xfer-settings-title">
            <Settings2 size={20} aria-hidden className="td-xfer-icon-glow" />
            <div>
              <h2 id={titleId}>{t('speedtest.transfer_settings_title')}</h2>
              <p>{t('speedtest.transfer_settings_subtitle')}</p>
            </div>
          </div>
          <div className="td-xfer-head-actions">
            <button
              type="button"
              className={`td-mode-toggle-btn ${basicMode ? 'is-basic' : 'is-advanced'}`}
              onClick={() => setBasicMode(!basicMode)}
              title={basicMode ? String(t('speedtest.mode_toggle_advanced')) : String(t('speedtest.mode_toggle_basic'))}
            >
              {basicMode ? t('speedtest.mode_toggle_basic') : t('speedtest.mode_toggle_advanced')}
            </button>
            <button
              type="button"
              className="td-icon-btn"
              onClick={onClose}
              title={t("speedtest.close_esc")}
              aria-label={t("speedtest.close_esc")}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="td-xfer-settings-tabs" role="tablist" aria-label={t("speedtest.settings_sections_aria")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            className={`td-xfer-tab ${tab === 'upload' ? 'active' : ''}`}
            onClick={() => setTab('upload')}
          >
            <Upload size={15} />
            {t("speedtest.upload_tab", "Upload")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'download'}
            className={`td-xfer-tab ${tab === 'download' ? 'active' : ''}`}
            onClick={() => setTab('download')}
          >
            <Download size={15} />
            {t("speedtest.download_tab", "Download")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'presets'}
            className={`td-xfer-tab ${tab === 'presets' ? 'active' : ''}`}
            onClick={() => setTab('presets')}
          >
            <Bookmark size={15} />
            {t("speedtest.presets_tab", "Presets & Profil")}
          </button>
        </div>

        <div className="td-xfer-search-bar-wrap">
          <label className="td-xfer-range-row td-xfer-search-row">
            <Search size={15} className="td-search-icon" aria-hidden />
            <input
              type="search"
              value={settingsQuery}
              onChange={(event) => setSettingsQuery(event.target.value)}
              placeholder={t('speedtest.transfer_settings_search')}
              aria-label={t('speedtest.transfer_settings_search')}
            />
          </label>
          {settingsQuery.trim() && (
            <div className="td-xfer-search-results" role="navigation" aria-label={t('speedtest.transfer_settings_search_results')}>
              {settingsSearchResults.length ? settingsSearchResults.map((result) => (
                <button key={result.id} type="button" className="td-chip-btn" onClick={() => jumpToSetting(result.tab, result.id)}>{result.label}</button>
              )) : <span className="td-xfer-hint">{t('speedtest.transfer_settings_search_empty')}</span>}
            </div>
          )}
        </div>

        <div className="td-xfer-settings-body">
          {tab === 'presets' && (
            <section className="td-xfer-section">
              <h3>{t('speedtest.transfer_profiles_title')}</h3>
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
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
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
                  <button type="button" className="td-chip-btn td-chip-primary" onClick={saveProfile} disabled={!!transferActive || !profileName.trim()}>
                    <Save size={14} /> {t('speedtest.transfer_profiles_save')}
                  </button>
                  <button type="button" className="td-chip-btn td-chip-danger" onClick={deleteProfile} disabled={!!transferActive || !selectedProfileId}>
                    <Trash2 size={14} /> {t('speedtest.transfer_profiles_delete')}
                  </button>
                </div>
              </div>
            </section>
          )}

          {tab === 'upload' && (
            <section id="transfer-quality" className="td-xfer-section" aria-label={t("speedtest.upload_settings_aria")}>
              <h3>{t('speedtest.upload_quality_header', 'UPLOAD QUALITY')}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.upload_quality_hint")}
              </p>
              <div className="td-xfer-radio-list" role="radiogroup" aria-label={t("speedtest.upload_quality")}>
                {QUALITY_MODE_OPTIONS.map((opt: any) => (
                  <label
                    key={opt.id}
                    className={`td-xfer-radio ${draft.qualityMode === opt.id ? 'is-on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="qualityMode"
                      value={opt.id}
                      checked={draft.qualityMode === opt.id}
                      disabled={!!transferActive}
                      onChange={() => {
                        patch({
                          qualityMode: opt.id as QualityMode,
                          forceDocumentDefault: false,
                        });
                      }}
                    />
                    <span>
                      <strong>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_label`))}</strong>
                      <small>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_desc`))}</small>
                    </span>
                  </label>
                ))}
              </div>

              {/* UNIFIED 4-MODE ENCODER ARCHITECTURE */}
              <h3 id="transfer-encoder-mode">{t("speedtest.encoder_mode_title")}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.encoder_mode_desc")}
              </p>
              <div className="td-xfer-radio-list" role="radiogroup" aria-label={t("speedtest.encoder_mode_title")}>
                {/* MODE 1: AUTO */}
                <label className={`td-xfer-radio ${currentEncoderMode === 'auto' ? 'is-on' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="auto"
                    checked={currentEncoderMode === 'auto'}
                    disabled={!!transferActive}
                    onChange={() => {
                      patch({
                        encoderStrategy: 'auto_adaptive',
                        reencodeHardware: 'auto',
                        encoderAllowSoftwareFallback: true,
                      });
                    }}
                  />
                  <span>
                    <strong className="td-mode-flex-title">
                      <Zap size={16} className="td-mode-icon-auto" />
                      {t("speedtest.encoder_mode_auto_title")}
                    </strong>
                    <small>{t("speedtest.encoder_mode_auto_desc")}</small>
                  </span>
                </label>

                {/* MODE 2: HARDWARE GPU */}
                <label className={`td-xfer-radio ${currentEncoderMode === 'hardware' ? 'is-on' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="hardware"
                    checked={currentEncoderMode === 'hardware'}
                    disabled={!!transferActive}
                    onChange={() => {
                      const firstGpu = hardwareOptions.find((o) => o.value !== 'auto' && o.value !== 'cpu' && o.value !== 'detecting');
                      const targetHw = firstGpu ? firstGpu.value : 'auto';
                      patch({
                        encoderStrategy: 'hardware_preferred',
                        reencodeHardware: targetHw as any,
                        encoderAllowSoftwareFallback: true,
                      });
                    }}
                  />
                  <span>
                    <strong className="td-mode-flex-title">
                      <Film size={16} className="td-mode-icon-gpu" />
                      {t("speedtest.encoder_mode_hardware_title")}
                    </strong>
                    <small>{t("speedtest.encoder_mode_hardware_desc")}</small>
                  </span>
                </label>

                {currentEncoderMode === 'hardware' && (
                  <div className="td-xfer-nested-select">
                    <MediaSelect
                      value={draft.reencodeHardware}
                      disabled={!!transferActive}
                      onChange={(value) => patch({ reencodeHardware: value as any })}
                      onOpen={fetchHardwareCapabilities}
                      ariaLabel={t("speedtest.hardware_reencode_header")}
                      options={hardwareOptions}
                    />
                  </div>
                )}

                {/* MODE 3: SOFTWARE CPU */}
                <label className={`td-xfer-radio ${currentEncoderMode === 'software' ? 'is-on' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="software"
                    checked={currentEncoderMode === 'software'}
                    disabled={!!transferActive}
                    onChange={() => {
                      patch({
                        encoderStrategy: 'software_only',
                        reencodeHardware: 'cpu',
                        encoderAllowSoftwareFallback: true,
                      });
                    }}
                  />
                  <span>
                    <strong className="td-mode-flex-title">
                      <Cpu size={16} className="td-mode-icon-cpu" />
                      {t("speedtest.encoder_mode_software_title")}
                    </strong>
                    <small>{t("speedtest.encoder_mode_software_desc")}</small>
                  </span>
                </label>

                {/* MODE 4: DISABLE REENCODE */}
                <label className={`td-xfer-radio ${currentEncoderMode === 'disable' ? 'is-on' : ''}`}>
                  <input
                    type="radio"
                    name="encoderUnifiedMode"
                    value="disable"
                    checked={currentEncoderMode === 'disable'}
                    disabled={!!transferActive}
                    onChange={() => {
                      patch({
                        encoderStrategy: 'disable_reencode',
                      });
                    }}
                  />
                  <span>
                    <strong className="td-mode-flex-title">
                      <Sliders size={16} className="td-mode-icon-disable" />
                      {t("speedtest.encoder_mode_disable_title")}
                    </strong>
                    <small>{t("speedtest.encoder_mode_disable_desc")}</small>
                  </span>
                </label>

                {currentEncoderMode === 'disable' && (
                  <div className="td-xfer-note td-xfer-note-warning">
                    <ShieldAlert size={15} />
                    <span>{t("speedtest.encoder_mode_disable_warning")}</span>
                  </div>
                )}
              </div>

              <h3>{t('speedtest.upload_parallelism_header')}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.upload_parallelism_hint")}
              </p>
              <label className="td-xfer-range-row">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.uploadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ uploadConcurrency: Number(e.target.value) })}
                  aria-label={t("speedtest.upload_parallelism_header")}
                />
                <span className="td-xfer-range-val">{draft.uploadConcurrency}</span>
                <span className="td-concurrency-badge">
                  {draft.uploadConcurrency <= 2 && t("speedtest.concurrency_badge_low")}
                  {draft.uploadConcurrency >= 3 && draft.uploadConcurrency <= 5 && t("speedtest.concurrency_badge_recommended")}
                  {draft.uploadConcurrency >= 6 && t("speedtest.concurrency_badge_high")}
                </span>
              </label>

              <h3 id="transfer-send">{t("speedtest.send_options_header")}</h3>
              <div className="td-xfer-checks">
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.groupAsAlbum}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ groupAsAlbum: e.target.checked })}
                  />
                  <span>
                    <strong>{t("speedtest.send_as_album")}</strong>
                    <small>{t("speedtest.send_as_album_desc")}</small>
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
                    <strong>{t("speedtest.send_silent")}</strong>
                    <small>{t("speedtest.send_silent_desc")}</small>
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
                    <strong>{t("speedtest.send_spoiler")}</strong>
                    <small>{t("speedtest.send_spoiler_desc")}</small>
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
                    <small>{t("speedtest.refresh_after_upload_desc")}</small>
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

              {/* ADVANCED ACCORDION FOR POWER-USER ORCHESTRATION */}
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
                    <strong>{t("speedtest.advanced_accordion_title")}</strong>
                    <small>{t("speedtest.advanced_accordion_desc")}</small>
                  </span>
                  {showAdvancedAccordion ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              )}

              <h3>{t("speedtest.default_caption_title")}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.default_caption_hint")}
              </p>
              <textarea
                className="td-xfer-textarea"
                rows={3}
                maxLength={65_536}
                placeholder={t("speedtest.optional_caption_ph")}
                value={draft.globalCaption}
                disabled={!!transferActive}
                onChange={(e) => patch({ globalCaption: e.target.value })}
              />
              <div className="td-xfer-charcount">
                {t('speedtest.caption_utf16_count', { count: [...draft.globalCaption].reduce<number>((total, character) => total + character.length, 0) })}
              </div>

              <div className="td-xfer-note">
                <Info size={14} />
                <span>
                  {t("speedtest.upload_note_box")}
                </span>
              </div>
            </section>
          )}

          {tab === 'download' && (
            <section id="transfer-download" className="td-xfer-section" aria-label={t("speedtest.download_settings_aria")}>
              <h3>{t('speedtest.download_parallel_header', 'PARALEL DOWNLOAD')}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.download_parallelism_hint")}
              </p>
              <label className="td-xfer-range-row">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.downloadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConcurrency: Number(e.target.value) })}
                  aria-label={t("speedtest.download_parallel_header")}
                />
                <span className="td-xfer-range-val">{draft.downloadConcurrency}</span>
                <span className="td-concurrency-badge">
                  {draft.downloadConcurrency <= 2 && t("speedtest.concurrency_badge_low")}
                  {draft.downloadConcurrency >= 3 && draft.downloadConcurrency <= 5 && t("speedtest.concurrency_badge_recommended")}
                  {draft.downloadConcurrency >= 6 && t("speedtest.concurrency_badge_high")}
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
                <span>
                  {t("speedtest.download_note_box")}
                </span>
              </div>
            </section>
          )}
        </div>

        <footer className="td-xfer-settings-foot">
          <button type="button" className="td-chip-btn" onClick={reset} disabled={!!transferActive}>
            <RotateCcw size={13} /> {t("speedtest.btn_reset_default")}
          </button>
          <div className="td-xfer-settings-foot-right">
            <button type="button" className="td-chip-btn" onClick={onClose}>
              {t("speedtest.topbar_cancel", "Batal")}
            </button>
            <button
              type="button"
              className="td-btn-primary"
              onClick={apply}
              disabled={!!transferActive}
            >
              {t("speedtest.btn_save", "Simpan")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
