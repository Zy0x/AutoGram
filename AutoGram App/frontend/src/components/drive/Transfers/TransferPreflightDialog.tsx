import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CopyCheck,
  FileSearch,
  ImageOff,
  Info,
  RefreshCw,
  Send,
  Settings,
  Video,
  Sparkles,
  Zap,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requestThumb } from '../../../lib/media/thumbBatcher';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import {
  buildPreflightReviewDecision,
  defaultDuplicateChoices,
} from '../../../lib/transfer/preflightDuplicateDecision';
import type {
  PreflightReviewDecision,
  QualityPreflightDuplicateMatch,
  QualityPreflightReport,
  TransferDuplicateChoice,
} from '../../../lib/transfer/qualityPreflight';
import type { RemoteEngineMode } from '../../../lib/telegram/driveTypes';

function transferPreviewSource(path: string, thumbnailUrl?: string | null): string | null {
  if (thumbnailUrl && (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://') || thumbnailUrl.startsWith('data:'))) {
    return thumbnailUrl;
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    if (path.match(/\.(jpe?g|png|webp|gif)($|\?)/i)) {
      return path;
    }
    return null;
  }
  return convertFileSrc(path);
}

function TelegramDuplicateThumb({
  match,
  creds,
}: {
  match: QualityPreflightDuplicateMatch;
  creds: DriveCredentials | null;
}) {
  const { t } = useTranslation();
  const [thumb, setThumb] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const messageId = Number(match.telegramMessageId || 0);
    if (!creds || messageId <= 0) {
      setThumb(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const peerId = match.destinationId === 'me' ? 'me' : match.destinationId;
    const folderId = peerId === 'me' ? null : Number(peerId);
    setLoading(true);
    void requestThumb(creds, Number.isFinite(folderId) ? folderId : null, messageId, {
      priority: 'visible',
      peerId,
      topicId: match.topicId,
      locationType: peerId === 'me' ? 'saved_messages' : 'group',
      signal: controller.signal,
    }).then((value) => {
      if (!controller.signal.aborted) {
        setThumb(value);
        setLoading(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setThumb(null);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [creds, match.destinationId, match.telegramMessageId, match.topicId]);

  return (
    <div className={`td-preflight-compare-media ${loading ? 'is-loading' : ''}`}>
      {thumb ? (
        <img src={thumb} alt={t('speedtest.preflight_existing_thumb_alt')} />
      ) : (
        <div className="td-preflight-thumb-empty">
          <ImageOff size={20} aria-hidden />
          <span>{loading ? t('speedtest.preflight_existing_thumb_loading') : t('speedtest.preflight_existing_thumb_missing')}</span>
        </div>
      )}
    </div>
  );
}

type Props = {
  report: QualityPreflightReport | null;
  creds: DriveCredentials | null;
  onConfirm: (decision: PreflightReviewDecision) => void;
  onCancel: () => void;
  onOpenSettings?: () => void;
  hasStackedModal?: boolean;
};

export function TransferPreflightDialog({
  report,
  creds,
  onConfirm,
  onCancel,
  onOpenSettings,
  hasStackedModal,
}: Props) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<Record<string, TransferDuplicateChoice>>({});
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [activePopover, setActivePopover] = useState<'transform' | 'clean' | 'album' | null>(null);

  useEffect(() => {
    if (report) setChoices(defaultDuplicateChoices(report));
  }, [report]);

  const duplicateCount = useMemo(
    () => report?.items.filter((item) => item.duplicateMatch).length || 0,
    [report]
  );
  const skippedCount = useMemo(
    () => report?.items.filter((item) => choices[item.sourcePath] === 'skip').length || 0,
    [choices, report]
  );
  const queuedCount = Math.max(0, (report?.items.length || 0) - skippedCount);

  const convertCount = useMemo(() => {
    if (typeof report?.transformConvertCount === 'number') return report.transformConvertCount;
    return report?.items.filter((i) => i.transform === 'convert_webp_png').length || 0;
  }, [report]);

  const reencodeCount = useMemo(() => {
    if (typeof report?.transformReencodeCount === 'number') return report.transformReencodeCount;
    return report?.items.filter((i) => i.transform === 'reencode').length || 0;
  }, [report]);

  if (!report || typeof document === 'undefined') return null;

  const visibleItems = report.items.slice(0, 100);
  const hiddenCount = Math.max(0, report.items.length - visibleItems.length);
  const setChoice = (path: string, choice: TransferDuplicateChoice) => {
    setChoices((current) => ({ ...current, [path]: choice }));
  };
  const setAllDuplicates = (choice: TransferDuplicateChoice) => {
    setChoices((current) => {
      const next = { ...current };
      report.items.forEach((item) => {
        if (item.duplicateMatch) next[item.sourcePath] = choice;
      });
      return next;
    });
  };
  const toggleTechDetails = (path: string) => {
    setExpandedDetails((current) => ({ ...current, [path]: !current[path] }));
  };

  const node = (
    <div className={`td-preflight-overlay ${hasStackedModal ? 'has-stacked-modal' : ''}`} role="presentation">
      <section className="td-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-preflight-title">
        <header className="td-preflight-head">
          <div className="td-xfer-settings-title">
            <FileSearch size={20} aria-hidden />
            <div>
              <h2 id="transfer-preflight-title">{t('speedtest.preflight_title')}</h2>
              <p>{t('speedtest.preflight_review_help')}</p>
            </div>
          </div>
          <button type="button" className="td-icon-btn" onClick={onCancel} aria-label={t('speedtest.topbar_cancel')}>
            <X size={18} />
          </button>
        </header>

        <div className="td-preflight-overview" role="status">
          <div><strong>{report.items.length}</strong><span>{t('speedtest.preflight_files')}</span></div>
          <div className={duplicateCount ? 'has-duplicates' : ''}><strong>{duplicateCount}</strong><span>{t('speedtest.preflight_duplicates_found')}</span></div>
          <div><strong>{queuedCount}</strong><span>{t('speedtest.preflight_will_queue')}</span></div>
          <div><strong>{skippedCount}</strong><span>{t('speedtest.preflight_will_skip')}</span></div>
          <div className="td-preflight-limit">
            <span>{t('speedtest.preflight_limit', { value: formatDriveBytes(report.effectiveMaxBytes) })}</span>
            <span>{t('speedtest.preflight_caption_limit', { count: report.captionLimit })}</span>
          </div>
        </div>

        {(convertCount > 0 || reencodeCount > 0) && (
          <div className="td-preflight-transform-notice-banner" role="status">
            <RefreshCw size={16} aria-hidden />
            <span className="td-preflight-banner-text">
              {convertCount > 0 && reencodeCount > 0
                ? t('speedtest.preflight_transform_banner_summary', { convertCount, reencodeCount })
                : convertCount > 0
                ? t('speedtest.preflight_transform_banner_convert', { convertCount })
                : t('speedtest.preflight_transform_banner_reencode', { reencodeCount })}
            </span>
            <button
              type="button"
              className={`td-preflight-info-btn ${activePopover === 'transform' ? 'is-active' : ''}`}
              onClick={() => setActivePopover(activePopover === 'transform' ? null : 'transform')}
              aria-label={t('speedtest.preflight_info_button')}
              title={t('speedtest.preflight_info_button')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        )}

        {duplicateCount === 0 ? (
          <div className="td-preflight-clean-banner" role="status">
            <CheckCircle2 size={18} className="td-clean-icon" aria-hidden />
            <span className="td-preflight-banner-text">{t('speedtest.preflight_all_clean_banner')}</span>
            <button
              type="button"
              className={`td-preflight-info-btn ${activePopover === 'clean' ? 'is-active' : ''}`}
              onClick={() => setActivePopover(activePopover === 'clean' ? null : 'clean')}
              aria-label={t('speedtest.preflight_info_button')}
              title={t('speedtest.preflight_info_button')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="td-preflight-duplicate-toolbar">
            <div>
              <CopyCheck size={17} aria-hidden />
              <span>{t('speedtest.preflight_duplicate_instruction')}</span>
            </div>
            <div>
              <button type="button" className="td-chip-btn" onClick={() => setAllDuplicates('skip')}>
                {t('speedtest.preflight_skip_all_duplicates')}
              </button>
              <button type="button" className="td-chip-btn" onClick={() => setAllDuplicates('upload')}>
                {t('speedtest.preflight_send_all_duplicates')}
              </button>
            </div>
          </div>
        )}

        {report.engineMode === 'safe_rollback' && (
          <div className="td-xfer-note" role="status">
            <AlertTriangle size={16} aria-hidden />
            <span>{t('speedtest.preflight_safe_rollback')}</span>
          </div>
        )}
        {report.albumIsProvisional && (
          <div className="td-xfer-note">
            <AlertTriangle size={16} aria-hidden />
            <span className="td-preflight-banner-text">
              {t('speedtest.preflight_album_provisional')}
              {report.plannedAlbumSizes.length > 0 && (
                <> {t('speedtest.preflight_album_grid_plan', {
                  size: report.albumGridSize,
                  groups: report.plannedAlbumSizes.join(' + '),
                })}</>
              )}
            </span>
            <button
              type="button"
              className={`td-preflight-info-btn ${activePopover === 'album' ? 'is-active' : ''}`}
              onClick={() => setActivePopover(activePopover === 'album' ? null : 'album')}
              aria-label={t('speedtest.preflight_info_button')}
              title={t('speedtest.preflight_info_button')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        )}

        {activePopover && (
          <div className="td-preflight-popover-overlay" onClick={() => setActivePopover(null)}>
            <div className="td-preflight-popover-card" onClick={(e) => e.stopPropagation()}>
              <div className="td-preflight-popover-head">
                <strong>
                  {activePopover === 'transform' && t('speedtest.preflight_info_title_transform')}
                  {activePopover === 'clean' && t('speedtest.preflight_info_title_clean')}
                  {activePopover === 'album' && t('speedtest.preflight_info_title_album')}
                </strong>
                <button type="button" className="td-icon-btn" onClick={() => setActivePopover(null)}>
                  <X size={14} />
                </button>
              </div>
              <div className="td-preflight-popover-body">
                <p className="td-preflight-popover-loc">
                  {activePopover === 'transform' && t('speedtest.preflight_info_loc_transform')}
                  {activePopover === 'clean' && t('speedtest.preflight_info_loc_clean')}
                  {activePopover === 'album' && t('speedtest.preflight_info_loc_album')}
                </p>
                <p className="td-preflight-popover-desc">
                  {activePopover === 'transform' && t('speedtest.preflight_info_desc_transform')}
                  {activePopover === 'clean' && t('speedtest.preflight_info_desc_clean')}
                  {activePopover === 'album' && t('speedtest.preflight_info_desc_album')}
                </p>
                <p className="td-preflight-popover-disable">
                  {activePopover === 'transform' && t('speedtest.preflight_info_disable_transform')}
                  {activePopover === 'clean' && t('speedtest.preflight_info_disable_clean')}
                  {activePopover === 'album' && t('speedtest.preflight_info_disable_album')}
                </p>
              </div>
              {onOpenSettings && (
                <div className="td-preflight-popover-foot">
                  <button
                    type="button"
                    className="td-btn-primary td-preflight-popover-btn"
                    onClick={() => {
                      setActivePopover(null);
                      onOpenSettings();
                    }}
                  >
                    <Settings size={14} aria-hidden />
                    <span>{t('speedtest.preflight_info_open_settings')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="td-preflight-items">
          {visibleItems.map((item) => {
            const previewSource = transferPreviewSource(item.sourcePath, item.thumbnailUrl);
            const duplicate = item.duplicateMatch;
            const choice = choices[item.sourcePath] || 'upload';
            const isExpanded = expandedDetails[item.sourcePath] || false;
            return (
              <article
                className={`td-preflight-item ${duplicate ? 'is-duplicate' : 'is-clean-item'} ${choice === 'skip' ? 'is-skipped' : 'is-uploading'}`}
                key={`${item.index}-${item.sourcePath}`}
              >
                <div className="td-preflight-item-topline">
                  <div>
                    {duplicate ? <CopyCheck size={16} aria-hidden /> : <CheckCircle2 size={16} className="td-icon-ready" aria-hidden />}
                    <strong>{item.index + 1}. {item.sourceName}</strong>
                    {duplicate ? (
                      <span className={`td-preflight-match-badge ${duplicate.matchLevel === 'exact_sha256' ? 'is-exact' : ''}`}>
                        {t(`speedtest.preflight_match_${duplicate.matchLevel}`)}
                      </span>
                    ) : (
                      <span className="td-preflight-ready-tag">{t('speedtest.preflight_ready_badge')}</span>
                    )}
                    {item.transform === 'convert_webp_png' && (
                      <span className="td-preflight-transform-tag is-convert">
                        <RefreshCw size={11} aria-hidden />
                        <span>{t('speedtest.preflight_transform_badge_convert_webp_png')}</span>
                      </span>
                    )}
                    {item.transform === 'reencode' && (
                      <span className="td-preflight-transform-tag is-reencode">
                        <Video size={11} aria-hidden />
                        <span>{t('speedtest.preflight_transform_badge_reencode_video')}</span>
                      </span>
                    )}
                    {(item.sourcePath.startsWith('http://') || item.sourcePath.startsWith('https://')) && (
                      ((report.remoteEngineMode as RemoteEngineMode | undefined) === 'cloud_fetch' ||
                        (report.remoteEngineMode !== 'ram_pipe' && item.sourceSize > 0 && item.sourceSize <= 20 * 1024 * 1024)) ? (
                        <span className="td-preflight-engine-tag is-cloud-fetch">
                          <Sparkles size={10} aria-hidden />
                          <span>{t('drive_tools.remote_zero_quota_badge')}</span>
                        </span>
                      ) : (
                        <span className="td-preflight-engine-tag is-ram-pipe">
                          <Zap size={10} aria-hidden />
                          <span>{t('drive_tools.remote_zero_disk_badge')}</span>
                        </span>
                      )
                    )}
                  </div>
                  <span>{formatDriveBytes(item.sourceSize)}</span>
                </div>

                {duplicate ? (
                  <div className="td-preflight-compare-grid">
                    <section>
                      <span className="td-preflight-compare-label">{t('speedtest.preflight_source_file')}</span>
                      <div className="td-preflight-compare-media">
                        {previewSource ? <img src={previewSource} alt={t('speedtest.preflight_source_thumb_alt')} /> : <FileSearch size={24} aria-hidden />}
                      </div>
                      <strong title={item.sourceName}>{item.sourceName}</strong>
                      <span>{formatDriveBytes(item.sourceSize)}</span>
                    </section>
                    <div className="td-preflight-compare-link" aria-hidden><CopyCheck size={18} /></div>
                    <section>
                      <span className="td-preflight-compare-label">{t('speedtest.preflight_existing_telegram')}</span>
                      <TelegramDuplicateThumb match={duplicate} creds={creds} />
                      <strong title={duplicate.existingName}>{duplicate.existingName}</strong>
                      <span>
                        {formatDriveBytes(duplicate.existingSize)} · {t('speedtest.preflight_message_id', { id: duplicate.telegramMessageId ?? '?' })}
                      </span>
                    </section>
                  </div>
                ) : (
                  <div className="td-preflight-standard-row">
                    <div className="td-preflight-thumb">
                      {previewSource ? <img src={previewSource} alt={t('speedtest.preflight_source_thumb_alt')} /> : <FileSearch size={20} aria-hidden />}
                    </div>
                    <div className="td-preflight-clean-meta">
                      <span className="td-preflight-clean-filename" title={item.sourceName}>{item.sourceName}</span>
                      <span className="td-preflight-clean-size">{formatDriveBytes(item.sourceSize)}</span>
                    </div>
                  </div>
                )}

                {isExpanded && !duplicate && (
                  <dl className="td-preflight-tech-dl">
                    <div><dt>{t('speedtest.preflight_category')}</dt><dd>{t(`speedtest.preflight_category_${item.category}`)}</dd></div>
                    <div><dt>{t('speedtest.preflight_transform')}</dt><dd>{t(`speedtest.preflight_transform_${item.transform}`)}</dd></div>
                    <div><dt>{t('speedtest.preflight_payload')}</dt><dd>{t(`speedtest.preflight_payload_${item.payloadClass}`)}</dd></div>
                  </dl>
                )}

                <div className="td-preflight-item-actions">
                  {!duplicate ? (
                    <button
                      type="button"
                      className="td-preflight-details-toggle"
                      onClick={() => toggleTechDetails(item.sourcePath)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      <span>{isExpanded ? t('speedtest.preflight_hide_details') : t('speedtest.preflight_toggle_details')}</span>
                    </button>
                  ) : (
                    <span className="td-preflight-reason">
                      {t(`speedtest.preflight_duplicate_reason_${duplicate.matchLevel}`)}
                    </span>
                  )}
                  <div role="group" aria-label={t('speedtest.preflight_item_decision')}>
                    <button
                      type="button"
                      className={`td-preflight-choice is-skip ${choice === 'skip' ? 'is-selected' : ''}`}
                      onClick={() => setChoice(item.sourcePath, 'skip')}
                      aria-pressed={choice === 'skip'}
                    >
                      {choice === 'skip' && <Check size={15} aria-hidden />}
                      {t('speedtest.preflight_skip_item')}
                    </button>
                    <button
                      type="button"
                      className={`td-preflight-choice is-upload ${choice === 'upload' ? 'is-selected' : ''}`}
                      onClick={() => setChoice(item.sourcePath, 'upload')}
                      aria-pressed={choice === 'upload'}
                    >
                      <Send size={15} aria-hidden />
                      {duplicate ? t('speedtest.preflight_send_anyway') : t('speedtest.preflight_include_item')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {hiddenCount > 0 && <p className="td-xfer-hint">{t('speedtest.preflight_more_items', { count: hiddenCount })}</p>}
        </div>

        <footer className="td-preflight-foot">
          <div>
            {onOpenSettings && (
              <button
                type="button"
                className="td-chip-btn"
                onClick={onOpenSettings}
                title={t('speedtest.preflight_drive_settings_title')}
              >
                <Settings size={13} aria-hidden style={{ marginRight: 4 }} />
                <span>{t('speedtest.preflight_drive_settings')}</span>
              </button>
            )}
            <button type="button" className="td-chip-btn" onClick={onCancel}>{t('speedtest.topbar_cancel')}</button>
          </div>
          <button
            type="button"
            className="td-btn-primary"
            onClick={() => onConfirm(buildPreflightReviewDecision(report, choices))}
            disabled={report.hasBlockingIssues || queuedCount === 0}
          >
            {t('speedtest.preflight_confirm_selection', { queue: queuedCount, skip: skippedCount })}
          </button>
        </footer>
      </section>
    </div>
  );

  return createPortal(node, document.body);
}
