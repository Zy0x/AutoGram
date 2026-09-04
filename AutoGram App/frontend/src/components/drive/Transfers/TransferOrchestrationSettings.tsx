import { useTranslation } from 'react-i18next';
import type { DriveTransferSettings } from '../../../lib/telegram/driveTypes';
import { MediaSelect } from '../Navigation/MediaSelect';

type Props = {
  mode: 'upload' | 'download';
  settings: DriveTransferSettings;
  onChange: (patch: Partial<DriveTransferSettings>) => void;
  disabled?: boolean;
};

export function TransferOrchestrationSettings({ mode, settings, onChange, disabled }: Props) {
  const { t } = useTranslation();

  if (mode === 'download') {
    return (
      <div id="transfer-download-reliability" className="td-xfer-subsection td-orchestration-settings">
        <h4 className="td-xfer-sub-title">{t('drive.download_reliability_title')}</h4>
        <p className="td-xfer-hint">{t('drive.download_reliability_desc')}</p>
        <button
          type="button"
          className="td-chip-btn"
          disabled={disabled}
          onClick={() => onChange({ downloadConflictPolicy: 'ask', downloadResumePartial: true, downloadIntegrity: 'size' })}
        >
          {t('drive.reset_section')}
        </button>
        <MediaSelect
          value={settings.downloadConflictPolicy}
          disabled={disabled}
          onChange={(value) => onChange({ downloadConflictPolicy: value as DriveTransferSettings['downloadConflictPolicy'] })}
          ariaLabel={t('drive.download_conflict_policy')}
          options={['ask', 'rename', 'overwrite', 'skip'].map((value) => ({
            value,
            label: String(t(`drive.download_conflict_${value}`)),
            description: String(t(`drive.download_conflict_${value}_desc`)),
          }))}
        />
        <div className="td-xfer-checks">
          <label className="td-xfer-check">
            <input type="checkbox" checked={settings.downloadResumePartial} disabled={disabled} onChange={(event) => onChange({ downloadResumePartial: event.target.checked })} />
            <span><strong>{t('drive.download_resume_partial')}</strong><small>{t('drive.download_resume_partial_desc')}</small></span>
          </label>
        </div>
        <MediaSelect
          value={settings.downloadIntegrity}
          disabled={disabled}
          onChange={(value) => onChange({ downloadIntegrity: value as DriveTransferSettings['downloadIntegrity'] })}
          ariaLabel={t('drive.download_integrity')}
          options={['size', 'sha256'].map((value) => ({
            value,
            label: String(t(`drive.download_integrity_${value}`)),
            description: String(t(`drive.download_integrity_${value}_desc`)),
          }))}
        />
      </div>
    );
  }

  return (
    <div id="transfer-orchestration" className="td-orchestration-settings">
      <div className="td-xfer-note" role="status">
        <span>{t('drive.frozen_profile_notice')}</span>
      </div>
      <button
        type="button"
        className="td-chip-btn"
        disabled={disabled}
        onClick={() => onChange({
          presentationOverride: 'automatic',
          albumPacking: 'smart_adaptive',
          albumGroupSize: 10,
          albumAvoidSingle: true,
          albumFailurePolicy: 'atomic_strict',
          groupDocuments: true,
          groupAudio: true,
          groupOriginalDocuments: true,
          oversizeAction: 'split',
          alternateAccountPool: '',
          alternateIdentityApproved: false,
          albumAlternateStrategy: 'cancel_group',
          encoderStrategy: 'auto_adaptive',
          encoderResourceProfile: 'balanced',
          encoderMaxParallel: 1,
          encoderAllowSoftwareFallback: true,
          scheduleAt: '',
          sendAs: '',
          spoilerItemPositions: '',
        })}
      >
        {t('drive.reset_section')}
      </button>

      <h3>{t('drive.presentation_override_title')}</h3>
      <p className="td-xfer-hint">{t('drive.presentation_override_desc')}</p>
      <MediaSelect
        value={settings.presentationOverride}
        disabled={disabled}
        onChange={(value) => onChange({ presentationOverride: value as DriveTransferSettings['presentationOverride'] })}
        ariaLabel={t('drive.presentation_override_title')}
        options={['automatic', 'force_document', 'force_native_media'].map((value) => ({
          value,
          label: String(t(`drive.presentation_${value}`)),
          description: String(t(`drive.presentation_${value}_desc`)),
        }))}
      />

      {(() => {
        const isStickerEnabled = !disabled && settings.presentationOverride !== 'force_document' && !settings.forceDocumentDefault;
        return (
          <div className="td-xfer-checks" style={{ marginTop: '12px', opacity: isStickerEnabled ? 1 : 0.55 }}>
            <label className="td-xfer-check" style={{ cursor: isStickerEnabled ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={Boolean(settings.preventStickerConversion)}
                disabled={!isStickerEnabled}
                onChange={(event) => onChange({ preventStickerConversion: event.target.checked })}
              />
              <span>
                <strong>
                  {t('drive.prevent_sticker_conversion_title')} {t('drive.prevent_sticker_conversion_formats')}
                </strong>
                <small>{t('drive.prevent_sticker_conversion_desc')}</small>
                {!isStickerEnabled && (
                  <small style={{ color: '#f59e0b', marginTop: '4px', display: 'block' }}>
                    ⚠️ {t('drive.prevent_sticker_conversion_doc_note')}
                  </small>
                )}
              </span>
            </label>
          </div>
        );
      })()}
      {settings.oversizeAction === 'alternate_account' && (
        <div className="td-xfer-subsection">
          <label className="td-xfer-range-row">
            <span>{t('drive.alternate_account_pool')}</span>
            <input
              type="text"
              value={settings.alternateAccountPool}
              disabled={disabled}
              maxLength={512}
              placeholder={String(t('drive.alternate_account_pool_placeholder'))}
              onChange={(event) => onChange({ alternateAccountPool: event.target.value.replace(/[^a-zA-Z0-9_.\-,\s]/g, '') })}
              aria-label={t('drive.alternate_account_pool')}
            />
          </label>
          <p className="td-xfer-hint">{t('drive.alternate_account_pool_desc')}</p>
          <MediaSelect
            value={settings.albumAlternateStrategy}
            disabled={disabled}
            onChange={(value) => onChange({ albumAlternateStrategy: value as DriveTransferSettings['albumAlternateStrategy'] })}
            ariaLabel={t('drive.album_alternate_strategy')}
            options={['separate_item', 'move_whole_group', 'cancel_group'].map((value) => ({
              value,
              label: String(t(`drive.album_alternate_${value}`)),
              description: String(t(`drive.album_alternate_${value}_desc`)),
            }))}
          />
          <label className="td-xfer-check">
            <input
              type="checkbox"
              checked={settings.alternateIdentityApproved}
              disabled={disabled}
              onChange={(event) => onChange({ alternateIdentityApproved: event.target.checked })}
            />
            <span><strong>{t('drive.alternate_identity_approved')}</strong><small>{t('drive.alternate_identity_approved_desc')}</small></span>
          </label>
        </div>
      )}

      <h3>{t('drive.album_orchestration_title')}</h3>
      <p className="td-xfer-hint">{t('drive.album_orchestration_desc')}</p>
      {settings.groupAsAlbum && (
        <div className="td-xfer-subsection">
          <label className="td-xfer-range-row">
            <span>{t('drive.album_grid_size')}</span>
            <input
              type="range"
              min={2}
              max={10}
              value={settings.albumGroupSize}
              disabled={disabled}
              onChange={(event) => {
                const albumGroupSize = Number(event.target.value);
                onChange({
                  albumGroupSize,
                  albumPacking: albumGroupSize === 10 ? 'smart_adaptive' : 'custom',
                });
              }}
            />
            <span className="td-xfer-range-val">{settings.albumGroupSize}</span>
          </label>
          <p className="td-xfer-hint">
            {t('drive.album_grid_size_desc', { size: settings.albumGroupSize })}
          </p>
          <MediaSelect
            value={
              settings.albumFailurePolicy === 'atomic_strict' || settings.albumFailurePolicy === 'cancel_group'
                ? 'atomic_strict'
                : settings.albumFailurePolicy === 'send_failed_separately' || settings.albumFailurePolicy === 'retry_prepare'
                ? 'send_failed_separately'
                : 'replan_group'
            }
            disabled={disabled}
            onChange={(value) => onChange({ albumFailurePolicy: value as DriveTransferSettings['albumFailurePolicy'] })}
            ariaLabel={t('drive.album_failure_policy')}
            options={[
              {
                value: 'atomic_strict',
                label: String(t('drive.album_failure_preset_strict_title')),
                description: String(t('drive.album_failure_preset_strict_desc')),
              },
              {
                value: 'replan_group',
                label: String(t('drive.album_failure_preset_best_effort_title')),
                description: String(t('drive.album_failure_preset_best_effort_desc')),
              },
              {
                value: 'send_failed_separately',
                label: String(t('drive.album_failure_preset_retry_title')),
                description: String(t('drive.album_failure_preset_retry_desc')),
              },
            ]}
          />
          <div className="td-xfer-checks">
            {(['albumAvoidSingle', 'groupDocuments', 'groupAudio', 'groupOriginalDocuments'] as const).map((field) => (
              <label className="td-xfer-check" key={field}>
                <input type="checkbox" checked={settings[field]} disabled={disabled} onChange={(event) => onChange({ [field]: event.target.checked })} />
                <span><strong>{t(`drive.${field}`)}</strong><small>{t(`drive.${field}_desc`)}</small></span>
              </label>
            ))}
          </div>
        </div>
      )}

      <h3>{t('drive.delivery_routing_title')}</h3>
      <p className="td-xfer-hint">{t('drive.delivery_routing_desc')}</p>
      <label className="td-xfer-range-row">
        <span>{t('drive.schedule_at')}</span>
        <input
          type="datetime-local"
          value={settings.scheduleAt}
          disabled={disabled}
          onChange={(event) => onChange({ scheduleAt: event.target.value })}
          aria-label={t('drive.schedule_at')}
        />
      </label>
      <p className="td-xfer-hint">{t('drive.schedule_at_desc')}</p>
      <label className="td-xfer-range-row">
        <span>{t('drive.send_as_peer')}</span>
        <input
          type="text"
          value={settings.sendAs}
          disabled={disabled}
          maxLength={128}
          placeholder={String(t('drive.send_as_peer_placeholder'))}
          onChange={(event) => onChange({ sendAs: event.target.value })}
          aria-label={t('drive.send_as_peer')}
        />
      </label>
      <p className="td-xfer-hint">{t('drive.send_as_peer_desc')}</p>
      <label className="td-xfer-range-row">
        <span>{t('drive.spoiler_item_positions')}</span>
        <input
          type="text"
          inputMode="numeric"
          value={settings.spoilerItemPositions}
          disabled={disabled}
          maxLength={128}
          placeholder={String(t('drive.spoiler_item_positions_placeholder'))}
          onChange={(event) => onChange({ spoilerItemPositions: event.target.value.replace(/[^0-9,\-\s]/g, '') })}
          aria-label={t('drive.spoiler_item_positions')}
        />
      </label>
      <p className="td-xfer-hint">{t('drive.spoiler_item_positions_desc')}</p>

      <h3>{t('drive.oversize_policy_title')}</h3>
      <MediaSelect
        value={settings.oversizeAction}
        disabled={disabled}
        onChange={(value) => onChange({ oversizeAction: value as DriveTransferSettings['oversizeAction'] })}
        ariaLabel={t('drive.oversize_policy_title')}
        options={['split', 'alternate_account', 'skip'].map((value) => ({
          value,
          label: String(t(`drive.oversize_${value}`)),
          description: String(t(`drive.oversize_${value}_desc`)),
        }))}
      />

      <h3 id="transfer-encoder">{t('drive.encoder_orchestration_title')}</h3>
      <p className="td-xfer-hint">{t('drive.encoder_orchestration_desc')}</p>
      <MediaSelect
        value={settings.encoderStrategy}
        disabled={disabled}
        onChange={(value) => onChange({ encoderStrategy: value as DriveTransferSettings['encoderStrategy'] })}
        ariaLabel={t('drive.encoder_strategy')}
        options={['auto_adaptive', 'hardware_preferred', 'software_preferred', 'hardware_only', 'software_only', 'specific_device', 'disable_reencode'].map((value) => ({
          value,
          label: String(t(`drive.encoder_strategy_${value}`)),
          description: String(t(`drive.encoder_strategy_${value}_desc`)),
        }))}
      />
      <MediaSelect
        value={settings.encoderResourceProfile}
        disabled={disabled}
        onChange={(value) => onChange({ encoderResourceProfile: value as DriveTransferSettings['encoderResourceProfile'] })}
        ariaLabel={t('drive.encoder_resource_profile')}
        options={['eco', 'balanced', 'performance', 'custom'].map((value) => ({
          value,
          label: String(t(`drive.encoder_resource_${value}`)),
          description: String(t(`drive.encoder_resource_${value}_desc`)),
        }))}
      />
      <label className="td-xfer-range-row">
        <span>{t('drive.encoder_parallel')}</span>
        <input type="range" min={1} max={4} value={settings.encoderMaxParallel} disabled={disabled} onChange={(event) => onChange({ encoderMaxParallel: Number(event.target.value) })} />
        <span className="td-xfer-range-val">{settings.encoderMaxParallel}</span>
      </label>
      <div className="td-xfer-checks">
        <label className="td-xfer-check">
          <input type="checkbox" checked={settings.encoderAllowSoftwareFallback} disabled={disabled || settings.encoderStrategy === 'hardware_only'} onChange={(event) => onChange({ encoderAllowSoftwareFallback: event.target.checked })} />
          <span><strong>{t('drive.encoder_software_fallback')}</strong><small>{t('drive.encoder_software_fallback_desc')}</small></span>
        </label>
      </div>
    </div>
  );
}
