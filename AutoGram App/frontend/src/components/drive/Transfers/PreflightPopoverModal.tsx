import {
  Cpu,
  ExternalLink,
  Film,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  Network,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_TRANSFER_SETTINGS,
  type DriveTransferSettings,
} from '../../../lib/telegram/driveTypes';
import type { SubMenuCategory } from './transferSettingsSearchRegistry';

export type PreflightPopoverType =
  | 'transform'
  | 'clean'
  | 'album'
  | 'duplicate'
  | 'rollback'
  | 'caption'
  | 'modes_summary'
  | null;

type PreflightPopoverModalProps = {
  activePopover: PreflightPopoverType;
  onClose: () => void;
  isReevaluating: boolean;
  transferSettings?: DriveTransferSettings;
  onSettingChange: (patch: Partial<DriveTransferSettings>) => void;
  onResetDefaults: () => void;
  onOpenSettings?: (category?: SubMenuCategory) => void;
};

export function PreflightPopoverModal({
  activePopover,
  onClose,
  isReevaluating,
  transferSettings,
  onSettingChange,
  onResetDefaults,
  onOpenSettings,
}: PreflightPopoverModalProps) {
  const { t } = useTranslation();

  if (!activePopover) return null;

  return (
    <div className="td-preflight-popover-overlay" onClick={onClose}>
      <div
        className={`td-preflight-popover-card ${activePopover === 'modes_summary' ? 'is-modes-card' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="td-preflight-popover-head">
          <div className="td-preflight-popover-title-row">
            <div className={`td-preflight-popover-icon ${activePopover === 'modes_summary' ? 'is-modes' : ''}`}>
              {activePopover === 'modes_summary' ? (
                <Sliders size={15} aria-hidden />
              ) : (
                <Info size={15} aria-hidden />
              )}
            </div>
            <strong>
              {activePopover === 'modes_summary' && t('drive.preflight_modes_modal_title')}
              {activePopover === 'transform' && t('drive.preflight_info_title_transform')}
              {activePopover === 'clean' && t('drive.preflight_info_title_clean')}
              {activePopover === 'album' && t('drive.preflight_info_title_album')}
              {activePopover === 'duplicate' && t('drive.preflight_info_title_duplicate')}
              {activePopover === 'rollback' && t('drive.preflight_info_title_rollback')}
              {activePopover === 'caption' && t('drive.preflight_info_title_caption')}
            </strong>
          </div>
          <button type="button" className="td-icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={15} />
          </button>
        </div>

        {activePopover === 'modes_summary' ? (
          <div className="td-preflight-popover-body is-modes-body">
            {isReevaluating && (
              <div className="td-preflight-modes-recalc-banner">
                <Loader2 size={12} className="td-preflight-modes-recalc-spin" aria-hidden />
                <span>{t('drive.preflight_modes_recalculating')}</span>
              </div>
            )}

            <div className="td-preflight-modes-grid-6">
              {/* Card 1: Video Encoding & Acceleration (tab: encoding) */}
              <div className="td-preflight-mode-card-6">
                <div className="td-preflight-mode6-header">
                  <div className="td-preflight-mode6-icon is-encoding">
                    <Cpu size={12} aria-hidden />
                  </div>
                  <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_encoding_title')}</span>
                  <button
                    type="button"
                    className="td-preflight-mode-deeplink"
                    onClick={() => onOpenSettings?.('encoding')}
                    title={t('drive.preflight_modes_configure_link')}
                  >
                    <ExternalLink size={11} aria-hidden />
                  </button>
                </div>
                <div className="td-preflight-mode6-toggle-row">
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.encoderStrategy ?? DEFAULT_TRANSFER_SETTINGS.encoderStrategy) !== 'disable_reencode' ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ encoderStrategy: 'auto_adaptive' })}
                  >
                    {t('drive.preflight_modes_opt_gpu_auto')}
                  </button>
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.encoderStrategy ?? DEFAULT_TRANSFER_SETTINGS.encoderStrategy) === 'disable_reencode' ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ encoderStrategy: 'disable_reencode' })}
                  >
                    {t('drive.preflight_modes_opt_no_reencode')}
                  </button>
                </div>
                <span className="td-preflight-mode6-badge is-encoding">
                  {(transferSettings?.encoderStrategy ?? DEFAULT_TRANSFER_SETTINGS.encoderStrategy) === 'disable_reencode'
                    ? t('drive.preflight_modes_opt_no_reencode')
                    : (transferSettings?.reencodeHardware ?? DEFAULT_TRANSFER_SETTINGS.reencodeHardware)}
                  {' · '}
                  {(transferSettings?.reencodePreset ?? DEFAULT_TRANSFER_SETTINGS.reencodePreset)}
                </span>
              </div>

              {/* Card 2: Delivery Format (tab: upload) */}
              <div className="td-preflight-mode-card-6">
                <div className="td-preflight-mode6-header">
                  <div className="td-preflight-mode6-icon is-delivery">
                    <Film size={12} aria-hidden />
                  </div>
                  <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_delivery_title')}</span>
                  <button
                    type="button"
                    className="td-preflight-mode-deeplink"
                    onClick={() => onOpenSettings?.('upload')}
                    title={t('drive.preflight_modes_configure_link')}
                  >
                    <ExternalLink size={11} aria-hidden />
                  </button>
                </div>
                <div className="td-preflight-mode6-toggle-row">
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${!(transferSettings?.forceDocumentDefault ?? DEFAULT_TRANSFER_SETTINGS.forceDocumentDefault) ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ forceDocumentDefault: false })}
                  >
                    {t('drive.preflight_modes_opt_visual_stream')}
                  </button>
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.forceDocumentDefault ?? DEFAULT_TRANSFER_SETTINGS.forceDocumentDefault) ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ forceDocumentDefault: true })}
                  >
                    {t('drive.preflight_modes_opt_raw_document')}
                  </button>
                </div>
                <span className="td-preflight-mode6-badge is-delivery">
                  {transferSettings?.qualityMode ?? DEFAULT_TRANSFER_SETTINGS.qualityMode}
                </span>
              </div>

              {/* Card 3: Album Grid Packaging (tab: albums) */}
              <div className="td-preflight-mode-card-6">
                <div className="td-preflight-mode6-header">
                  <div className="td-preflight-mode6-icon is-album">
                    <Layers size={12} aria-hidden />
                  </div>
                  <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_album_title')}</span>
                  <button
                    type="button"
                    className="td-preflight-mode-deeplink"
                    onClick={() => onOpenSettings?.('albums')}
                    title={t('drive.preflight_modes_configure_link')}
                  >
                    <ExternalLink size={11} aria-hidden />
                  </button>
                </div>
                <div className="td-preflight-mode6-toggle-row">
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum) ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ groupAsAlbum: true })}
                  >
                    {t('drive.preflight_modes_opt_album_grid', { size: transferSettings?.albumGroupSize ?? DEFAULT_TRANSFER_SETTINGS.albumGroupSize })}
                  </button>
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${!(transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum) ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ groupAsAlbum: false })}
                  >
                    {t('drive.preflight_modes_opt_album_separate')}
                  </button>
                </div>
                <span className="td-preflight-mode6-badge is-album">
                  {(transferSettings?.groupAsAlbum ?? DEFAULT_TRANSFER_SETTINGS.groupAsAlbum)
                    ? `Grid ${transferSettings?.albumGroupSize ?? DEFAULT_TRANSFER_SETTINGS.albumGroupSize} · ${transferSettings?.albumPacking ?? DEFAULT_TRANSFER_SETTINGS.albumPacking}`
                    : t('drive.preflight_modes_opt_album_separate')}
                </span>
              </div>

              {/* Card 4: Duplicate Prevention (tab: duplicates) */}
              <div className="td-preflight-mode-card-6">
                <div className="td-preflight-mode6-header">
                  <div className="td-preflight-mode6-icon is-safety">
                    <ShieldCheck size={12} aria-hidden />
                  </div>
                  <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_duplicate_title')}</span>
                  <button
                    type="button"
                    className="td-preflight-mode-deeplink"
                    onClick={() => onOpenSettings?.('duplicates')}
                    title={t('drive.preflight_modes_configure_link')}
                  >
                    <ExternalLink size={11} aria-hidden />
                  </button>
                </div>
                <div className="td-preflight-mode6-toggle-row">
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.duplicatePolicy ?? DEFAULT_TRANSFER_SETTINGS.duplicatePolicy) === 'SKIP' ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ duplicatePolicy: 'SKIP' })}
                  >
                    {t('drive.preflight_modes_opt_dup_skip')}
                  </button>
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.duplicatePolicy ?? DEFAULT_TRANSFER_SETTINGS.duplicatePolicy) === 'FORCE_UPLOAD' ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ duplicatePolicy: 'FORCE_UPLOAD' })}
                  >
                    {t('drive.preflight_modes_opt_dup_force')}
                  </button>
                </div>
                <span className="td-preflight-mode6-badge is-safety">
                  {t('drive.preflight_duplicate_4level')}
                  {' · '}
                  {transferSettings?.scanMode ?? DEFAULT_TRANSFER_SETTINGS.scanMode}
                </span>
              </div>

              {/* Card 5: Network & Concurrency (tab: network) */}
              <div className="td-preflight-mode-card-6">
                <div className="td-preflight-mode6-header">
                  <div className="td-preflight-mode6-icon is-network">
                    <Network size={12} aria-hidden />
                  </div>
                  <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_network_title')}</span>
                  <button
                    type="button"
                    className="td-preflight-mode-deeplink"
                    onClick={() => onOpenSettings?.('network')}
                    title={t('drive.preflight_modes_configure_link')}
                  >
                    <ExternalLink size={11} aria-hidden />
                  </button>
                </div>
                <div className="td-preflight-mode6-info-row">
                  <span className="td-preflight-mode6-badge is-network">
                    {t('drive.preflight_modes_workers_badge', { count: transferSettings?.uploadConcurrency ?? DEFAULT_TRANSFER_SETTINGS.uploadConcurrency })}
                  </span>
                  <span className="td-preflight-mode6-badge is-network-alt">
                    {t('drive.preflight_modes_floodwait_badge')}
                  </span>
                </div>
                <span className="td-preflight-mode6-subtext">
                  {`↑ ${transferSettings?.uploadConcurrency ?? DEFAULT_TRANSFER_SETTINGS.uploadConcurrency} · ↓ ${transferSettings?.downloadConcurrency ?? DEFAULT_TRANSFER_SETTINGS.downloadConcurrency} · max ${transferSettings?.maxReuploadPerHour ?? DEFAULT_TRANSFER_SETTINGS.maxReuploadPerHour}/h`}
                </span>
              </div>

              {/* Card 6: Caption & Limits (tab: limits_recovery) */}
              <div className="td-preflight-mode-card-6">
                <div className="td-preflight-mode6-header">
                  <div className="td-preflight-mode6-icon is-caption">
                    <MessageSquare size={12} aria-hidden />
                  </div>
                  <span className="td-preflight-mode6-title">{t('drive.preflight_modes_card_caption_title')}</span>
                  <button
                    type="button"
                    className="td-preflight-mode-deeplink"
                    onClick={() => onOpenSettings?.('limits_recovery')}
                    title={t('drive.preflight_modes_configure_link')}
                  >
                    <ExternalLink size={11} aria-hidden />
                  </button>
                </div>
                <div className="td-preflight-mode6-toggle-row">
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.captionOverflowPolicy ?? DEFAULT_TRANSFER_SETTINGS.captionOverflowPolicy) === 'truncate_with_warning' ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ captionOverflowPolicy: 'truncate_with_warning' })}
                  >
                    {t('drive.preflight_modes_caption_truncate_opt')}
                  </button>
                  <button
                    type="button"
                    className={`td-preflight-mode6-pill ${(transferSettings?.captionOverflowPolicy ?? DEFAULT_TRANSFER_SETTINGS.captionOverflowPolicy) === 'split' ? 'is-active' : ''}`}
                    onClick={() => onSettingChange({ captionOverflowPolicy: 'split' })}
                  >
                    {t('drive.preflight_modes_caption_split_opt')}
                  </button>
                </div>
                <span className="td-preflight-mode6-badge is-caption">
                  {t('drive.preflight_modes_caption_limit_badge', { count: 1024 })}
                  {' · '}
                  {transferSettings?.captionParseMode ?? DEFAULT_TRANSFER_SETTINGS.captionParseMode}
                </span>
              </div>
            </div>

            {/* Reset to Defaults */}
            <div className="td-preflight-modes-footer">
              <button
                type="button"
                className="td-preflight-modes-reset-btn"
                onClick={onResetDefaults}
              >
                <RotateCcw size={12} aria-hidden />
                <span>{t('drive.preflight_modes_reset_defaults')}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="td-preflight-popover-body">
            <div className="td-preflight-popover-section">
              <span className="td-preflight-popover-label">{t('drive.preflight_popover_section_location')}</span>
              <div className="td-preflight-popover-pill">
                <Settings size={12} aria-hidden />
                <span>
                  {activePopover === 'transform' && t('drive.preflight_info_loc_transform')}
                  {activePopover === 'clean' && t('drive.preflight_info_loc_clean')}
                  {activePopover === 'album' && t('drive.preflight_info_loc_album')}
                  {activePopover === 'duplicate' && t('drive.preflight_info_loc_duplicate')}
                  {activePopover === 'rollback' && t('drive.preflight_info_loc_rollback')}
                  {activePopover === 'caption' && t('drive.preflight_info_loc_caption')}
                </span>
              </div>
            </div>
            <div className="td-preflight-popover-section">
              <span className="td-preflight-popover-label">{t('drive.preflight_popover_section_analysis')}</span>
              <p className="td-preflight-popover-desc">
                {activePopover === 'transform' && t('drive.preflight_info_desc_transform')}
                {activePopover === 'clean' && t('drive.preflight_info_desc_clean')}
                {activePopover === 'album' && t('drive.preflight_info_desc_album')}
                {activePopover === 'duplicate' && t('drive.preflight_info_desc_duplicate')}
                {activePopover === 'rollback' && t('drive.preflight_info_desc_rollback')}
                {activePopover === 'caption' && t('drive.preflight_info_desc_caption')}
              </p>
            </div>
            <div className="td-preflight-popover-section">
              <span className="td-preflight-popover-label">{t('drive.preflight_popover_section_adjust')}</span>
              <p className="td-preflight-popover-disable">
                {activePopover === 'transform' && t('drive.preflight_info_disable_transform')}
                {activePopover === 'clean' && t('drive.preflight_info_disable_clean')}
                {activePopover === 'album' && t('drive.preflight_info_disable_album')}
                {activePopover === 'duplicate' && t('drive.preflight_info_disable_duplicate')}
                {activePopover === 'rollback' && t('drive.preflight_info_disable_rollback')}
                {activePopover === 'caption' && t('drive.preflight_info_disable_caption')}
              </p>
            </div>
          </div>
        )}

        {onOpenSettings && (
          <div className="td-preflight-popover-foot">
            <button
              type="button"
              className="td-btn-primary td-preflight-popover-btn"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
            >
              <Settings size={14} aria-hidden />
              <span>{t('drive.preflight_info_open_settings')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
