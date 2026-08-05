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
import { useTransferProgressStore, useTransferHardwareCapabilities } from '../../../stores/transferProgressStore';
import { TransferOrchestrationSettings } from './TransferOrchestrationSettings';
import { buildEncoderHardwareOptions, isExplicitEncoderDevice } from './encoderHardwareOptions';

type Tab = 'upload' | 'download';

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
  const [draft, setDraft] = useState<DriveTransferSettings>(() => ({
    ...DEFAULT_TRANSFER_SETTINGS,
    ...settings,
  }));
  const [profiles, setProfiles] = useState<DriveTransferSettingsProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');

  const { hardwareCapabilities, fetchHardwareCapabilities } = useTransferHardwareCapabilities();

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
      // fetchHardwareCapabilities(); // Temporarily disabled
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
      { tab: 'upload' as const, id: 'transfer-send', label: String(t('speedtest.send_options_header')) },
      { tab: 'upload' as const, id: 'transfer-orchestration', label: String(t('speedtest.album_orchestration_title')) },
      { tab: 'upload' as const, id: 'transfer-encoder', label: String(t('speedtest.encoder_orchestration_title')) },
      { tab: 'download' as const, id: 'transfer-download', label: String(t('speedtest.download_reliability_title')) },
    ];
    return entries.filter((entry) => entry.label.toLocaleLowerCase().includes(query));
  }, [settingsQuery, t]);

  const jumpToSetting = (nextTab: Tab, id: string) => {
    setTab(nextTab);
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const hardwareOptions = useMemo(() => {
    return buildEncoderHardwareOptions(hardwareCapabilities, t);
  }, [hardwareCapabilities, t]);

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
            <Settings2 size={18} aria-hidden />
            <div>
              <h2 id={titleId}>{t('speedtest.transfer_settings_title')}</h2>
              <p>{t('speedtest.transfer_settings_subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            className="td-icon-btn"
            onClick={onClose}
            title={t("speedtest.close_esc")}
            aria-label={t("speedtest.close_esc")}
          >
            <X size={18} />
          </button>
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
        </div>

        <div className="td-xfer-subsection td-transfer-profile-manager">
          <h3>{t('speedtest.transfer_profiles_title')}</h3>
          <p className="td-xfer-hint">{t('speedtest.transfer_profiles_desc')}</p>
          <div className="td-xfer-settings-foot-right">
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
            <button type="button" className="td-chip-btn" onClick={saveProfile} disabled={!!transferActive || !profileName.trim()}>
              <Save size={13} /> {t('speedtest.transfer_profiles_save')}
            </button>
            <button type="button" className="td-chip-btn" onClick={deleteProfile} disabled={!!transferActive || !selectedProfileId}>
              <Trash2 size={13} /> {t('speedtest.transfer_profiles_delete')}
            </button>
          </div>
          <label className="td-xfer-range-row">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={settingsQuery}
              onChange={(event) => setSettingsQuery(event.target.value)}
              placeholder={t('speedtest.transfer_settings_search')}
              aria-label={t('speedtest.transfer_settings_search')}
            />
          </label>
          {settingsQuery.trim() && (
            <div className="td-xfer-settings-foot-right" role="navigation" aria-label={t('speedtest.transfer_settings_search_results')}>
              {settingsSearchResults.length ? settingsSearchResults.map((result) => (
                <button key={result.id} type="button" className="td-chip-btn" onClick={() => jumpToSetting(result.tab, result.id)}>{result.label}</button>
              )) : <span className="td-xfer-hint">{t('speedtest.transfer_settings_search_empty')}</span>}
            </div>
          )}
        </div>

        <div className="td-xfer-settings-body">
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

              <h3>{t("speedtest.hardware_reencode_header")}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.gpu_accel_desc")}
              </p>
              <label className="td-xfer-range-row">
                <MediaSelect
                  value={draft.reencodeHardware}
                  disabled={!!transferActive}
                  onChange={(value) => patch({ reencodeHardware: value as any })}
                  onOpen={fetchHardwareCapabilities}
                  ariaLabel={t("speedtest.hardware_reencode_header")}
                  options={hardwareOptions}
                />
              </label>
              {draft.encoderStrategy === 'specific_device' && !isExplicitEncoderDevice(draft.reencodeHardware) && (
                <p className="td-xfer-note" role="alert">{t('speedtest.encoder_specific_device_required')}</p>
              )}

              <h3>{t("speedtest.reencode_mode_header")}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.reencode_mode_desc")}
              </p>
              <label className="td-xfer-range-row">
                <MediaSelect
                  value={draft.reencodePreset}
                  disabled={!!transferActive}
                  onChange={(value) => patch({ reencodePreset: value as any })}
                  ariaLabel={t("speedtest.reencode_mode_header")}
                  options={[
                    { value: 'speed', label: String(t('speedtest.preset_speed_label')), description: String(t('speedtest.preset_speed_desc')) },
                    { value: 'balanced', label: String(t('speedtest.preset_balanced_label')), description: String(t('speedtest.preset_balanced_desc')) },
                    { value: 'quality', label: String(t('speedtest.preset_quality_label')), description: String(t('speedtest.preset_quality_desc')) },
                  ]}
                />
              </label>

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
                    checked={draft.presentationOverride === 'force_document'}
                    disabled={!!transferActive}
                    onChange={(e) => {
                      const on = e.target.checked;
                      patch({
                        forceDocumentDefault: on,
                        presentationOverride: on ? 'force_document' : 'automatic',
                      });
                    }}
                  />
                  <span>
                    <strong>{t("speedtest.force_document_title")}</strong>
                    <small>{t("speedtest.force_document_desc")}</small>
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

                {draft.duplicatePolicy === 'SKIP' && (
                  <div className="td-xfer-subsection">
                    <h4 className="td-xfer-sub-title">{t("speedtest.scan_mode_title")}</h4>
                    <p className="td-xfer-hint">
                      {t("speedtest.scan_mode_desc")}
                    </p>
                    <div className="td-xfer-radio-group">
                      {([
                        { id: 'normal',   label: t('speedtest.scan_normal'),   desc: t('speedtest.scan_normal_desc') },
                        { id: 'smart',    label: t('speedtest.scan_smart'),    desc: t('speedtest.scan_smart_desc') },
                        { id: 'forensic', label: t('speedtest.scan_forensic'), desc: t('speedtest.scan_forensic_desc') },
                      ] as const).map(({ id, label, desc }) => (
                        <label key={id} className={`td-xfer-radio ${draft.scanMode === id ? 'is-on' : ''}`}>
                          <input
                            type="radio"
                            name="scanMode"
                            value={id}
                            checked={draft.scanMode === id}
                            disabled={!!transferActive}
                            onChange={() => patch({ scanMode: id })}
                          />
                          <span>
                            <strong>{label}</strong>
                            <small>{desc}</small>
                          </span>
                        </label>
                      ))}
                    </div>

                    <h4 className="td-xfer-sub-title" style={{ marginTop: '0.75rem' }}>{t("speedtest.topic_scope_title")}</h4>
                    <MediaSelect
                      value={draft.topicScope}
                      disabled={!!transferActive}
                      onChange={(val) => patch({ topicScope: val as any })}
                      ariaLabel={t("speedtest.topic_scope_title")}
                      options={[
                        { value: 'selected_only', label: t('speedtest.topic_scope_selected'), description: t('speedtest.topic_scope_selected_desc') },
                        { value: 'selected_plus_general', label: t('speedtest.topic_scope_plus_gen'), description: t('speedtest.topic_scope_plus_gen_desc') },
                        { value: 'all_topics', label: t('speedtest.topic_scope_all'), description: t('speedtest.topic_scope_all_desc') },
                      ]}
                    />

                    <h4 className="td-xfer-sub-title" style={{ marginTop: '0.75rem' }}>{t("speedtest.guardrail_title")}</h4>
                    <label className="td-xfer-check" style={{ marginBottom: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={draft.guardrailEnabled}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ guardrailEnabled: e.target.checked })}
                      />
                      <span>
                        <strong>{t("speedtest.guardrail_check_title")}</strong>
                        <small>{t("speedtest.guardrail_check_desc")}</small>
                      </span>
                    </label>
                    {draft.guardrailEnabled && (
                      <>
                        <p className="td-xfer-hint">
                          {t("speedtest.guardrail_time_hint")}
                        </p>
                        <label className="td-xfer-range-row">
                          <input
                            type="range"
                            min={3}
                            max={30}
                            value={draft.guardrailThresholdDays}
                            disabled={!!transferActive}
                            onChange={(e) => patch({ guardrailThresholdDays: Number(e.target.value) })}
                            aria-label={t("speedtest.guardrail_title")}
                          />
                          <span className="td-xfer-range-val">{draft.guardrailThresholdDays} {t("speedtest.days_unit")}</span>
                        </label>
                      </>
                    )}
                  </div>
                )}

              </div>{/* /.td-xfer-checks */}

              <TransferOrchestrationSettings
                mode="upload"
                settings={draft}
                onChange={patch}
                disabled={!!transferActive}
              />

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
              <p className="td-xfer-hint">{t('speedtest.caption_runtime_limit_hint')}</p>
              <MediaSelect
                value={draft.captionOverflowPolicy}
                disabled={!!transferActive}
                onChange={(value) => patch({ captionOverflowPolicy: value as DriveTransferSettings['captionOverflowPolicy'] })}
                ariaLabel={t('speedtest.caption_overflow_policy')}
                options={['truncate_with_warning', 'fail'].map((value) => ({
                  value,
                  label: String(t(`speedtest.caption_overflow_${value}`)),
                  description: String(t(`speedtest.caption_overflow_${value}_desc`)),
                }))}
              />

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

              <h3>{t("speedtest.supported_features_title")}</h3>
              <ul className="td-xfer-list">
                <li>{t('speedtest.download_multi_folder')}</li>
                <li>{t('speedtest.download_single_file')}</li>
                <li>{t("speedtest.dock_progress_feature")}</li>
                <li>{t('speedtest.cancel_active_download')}</li>
                <li>{t("speedtest.multipart_feature")}</li>
              </ul>
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
