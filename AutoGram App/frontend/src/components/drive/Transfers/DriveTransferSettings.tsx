import { useTranslation } from 'react-i18next';
/**
 * Dedicated Upload / Download settings panel for Media Studio.
 * Surfaces every transfer option supported by the desktop worker UI path.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Settings2,
  Upload,
  Download,
  RotateCcw,
  Info,
} from 'lucide-react';
import type { DriveTransferSettings, QualityMode } from '../../../lib/telegram/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  QUALITY_MODE_OPTIONS,
  clampConcurrency,
} from '../../../lib/telegram/driveTypes';
import { MediaSelect } from '../Navigation/MediaSelect';

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

  useEffect(() => {
    if (open) {
      setDraft({
        ...DEFAULT_TRANSFER_SETTINGS,
        ...settings,
      });
      setTab('upload');
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

  if (!open) return null;

  const patch = (partial: Partial<DriveTransferSettings>) => {
    setDraft((d: any) => ({ ...d, ...partial }));
  };

  const apply = () => {
    const next: DriveTransferSettings = {
      ...draft,
      uploadConcurrency: clampConcurrency(draft.uploadConcurrency),
      downloadConcurrency: clampConcurrency(draft.downloadConcurrency),
      globalCaption: (draft.globalCaption || '').slice(0, 1024),
      // ORIGINAL force-document aligns with qualityMode when forceDocumentDefault is on
      qualityMode:
        draft.forceDocumentDefault && draft.qualityMode !== 'ORIGINAL'
          ? 'ORIGINAL'
          : draft.qualityMode,
    };
    onChange(next);
    onClose();
  };

  const reset = () => {
    setDraft({ ...DEFAULT_TRANSFER_SETTINGS });
  };

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

        <div className="td-xfer-settings-body">
          {tab === 'upload' && (
            <section className="td-xfer-section" aria-label={t("speedtest.upload_settings_aria")}>
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
                          forceDocumentDefault: opt.id === 'ORIGINAL',
                        });
                      }}
                    />
                    <span>
                      <strong>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_label`, opt.label))}</strong>
                      <small>{String(t(`speedtest.quality_mode_${opt.id.toLowerCase()}_desc`, opt.description))}</small>
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
                  ariaLabel={t("speedtest.hardware_reencode_header")}
                  options={[
                    { value: 'auto', label: String(t('speedtest.gpu_auto_label')), description: String(t('speedtest.gpu_auto_desc')) },
                    { value: 'nvidia', label: 'NVIDIA NVENC', description: String(t('speedtest.gpu_nvidia_desc')) },
                    { value: 'amd', label: 'AMD AMF', description: String(t('speedtest.gpu_amd_desc')) },
                    { value: 'intel', label: 'Intel Quick Sync', description: String(t('speedtest.gpu_intel_desc')) },
                    { value: 'cpu', label: 'CPU x264', description: String(t('speedtest.gpu_cpu_desc')) },
                  ]}
                />
              </label>

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

              <h3>{t("speedtest.send_options_header")}</h3>
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
                    checked={draft.forceDocumentDefault || draft.qualityMode === 'ORIGINAL'}
                    disabled={!!transferActive}
                    onChange={(e) => {
                      const on = e.target.checked;
                      patch({
                        forceDocumentDefault: on,
                        qualityMode: on ? 'ORIGINAL' : draft.qualityMode === 'ORIGINAL' ? 'HIGH_QUALITY' : draft.qualityMode,
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

              <h3>{t("speedtest.default_caption_title")}</h3>
              <p className="td-xfer-hint">
                {t("speedtest.default_caption_hint")}
              </p>
              <textarea
                className="td-xfer-textarea"
                rows={3}
                maxLength={1024}
                placeholder={t("speedtest.optional_caption_ph")}
                value={draft.globalCaption}
                disabled={!!transferActive}
                onChange={(e) => patch({ globalCaption: e.target.value })}
              />
              <div className="td-xfer-charcount">{draft.globalCaption.length}/1024</div>

              <div className="td-xfer-note">
                <Info size={14} />
                <span>
                  {t("speedtest.upload_note_box")}
                </span>
              </div>
            </section>
          )}

          {tab === 'download' && (
            <section className="td-xfer-section" aria-label={t("speedtest.download_settings_aria")}>
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
