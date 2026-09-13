// Transitional extraction boundary; the parent supplies the state setters
// and this module only owns presentational controls.
// @ts-nocheck
import { Home, Folder, HardDrive, Hash, Layers, Info, X, Zap, Sparkles, FileText, Film, Check, ChevronRight, Search, Filter, Music } from 'lucide-react';
import { PeerAvatar } from '../Navigation/sidebarUtils';
import { kindIcon } from './remoteUploadUiPrimitives';
import type { RemoteEngineMode, StorageLocalPolicy } from '../../../lib/telegram/driveTypes';
import type { RawStreamItem, StreamQualityFormat } from '../../../lib/telegram/linkResolvers';

export function createRemoteUploadRenderers(ctx: Record<string, any>) {
  const { t, showSupportedInfo, setShowSupportedInfo, activeTripletInfo, setActiveTripletInfo, tripletInfoRef, selectedDest, creds, cleanTargetDisplay, customDiskPath, setCustomDiskPath, deliveryMode, setDeliveryMode, effectiveRemoteEngine, remoteEngineMode, setRemoteEngineMode, storagePolicy, setStoragePolicy, submitting, renderBadge, setPickerOpen } = ctx;
  const renderSupportedLinksPopover = () => {
    if (!showSupportedInfo) return null;
    return (
      <div
        className="td-remote-info-popover"
        role="dialog"
        aria-modal="false"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="td-remote-info-popover-header">
          <span className="td-remote-info-popover-title">
            <Info size={13} className="td-remote-info-title-icon" />
            <span>{t('drive.remote_info_popover_title')}</span>
          </span>
          <button
            type="button"
            className="td-remote-info-close"
            onClick={() => setShowSupportedInfo(false)}
            aria-label={t('drive.preview_close_btn')}
          >
            <X size={13} />
          </button>
        </div>

        {/* Section 1: Social & Video */}
        <div className="td-remote-info-group">
          <div className="td-remote-info-group-title">
            {t('drive.remote_info_cat_social')}
          </div>
          <div className="td-remote-info-tags">
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_tiktok')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_youtube')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_instagram')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_pinterest')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_pixiv')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_terabox')}</span>
          </div>
        </div>

        {/* Section 2: Cloud & Direct */}
        <div className="td-remote-info-group">
          <div className="td-remote-info-group-title">
            {t('drive.remote_info_cat_cloud')}
          </div>
          <div className="td-remote-info-tags">
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_pikpak')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_streamrizz')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_gdrive')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_dropbox')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_mediafire')}</span>
            <span className="td-remote-info-tag">{t('drive.remote_info_tag_direct')}</span>
          </div>
        </div>

        <div className="td-remote-info-footer">
          <Zap size={11} className="td-remote-info-footer-icon" />
          <span>{t('drive.remote_info_footer_note')}</span>
        </div>
      </div>
    );
  };

  const renderTripletInfoPopover = (type: 'delivery' | 'engine' | 'policy') => {
    if (activeTripletInfo !== type) return null;
    return (
      <div
        className="td-remote-triplet-popover"
        ref={tripletInfoRef}
        onClick={(e) => e.stopPropagation()}
        role="tooltip"
      >
        <div className="td-remote-triplet-popover-header">
          <span className="td-remote-triplet-popover-title">
            <Info size={12} className="text-sky-400" />
            <span>
              {type === 'delivery'
                ? t('drive_tools.remote_info_delivery_title')
                : type === 'engine'
                ? t('drive_tools.remote_info_engine_title')
                : t('drive_tools.remote_info_policy_title')}
            </span>
          </span>
          <button
            type="button"
            className="td-remote-info-close"
            onClick={(e) => {
              e.stopPropagation();
              setActiveTripletInfo(null);
            }}
            aria-label={t('drive.preview_close_btn')}
          >
            <X size={13} />
          </button>
        </div>

        {type === 'delivery' && (
          <>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: 'var(--accent-secondary, #c084fc)' }}>
                <Film size={10} /> {t('drive.remote_mode_uncompressed')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_uncompressed')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: 'var(--accent-primary, #38bdf8)' }}>
                <Zap size={10} /> {t('drive.remote_mode_auto')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_auto')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#facc15' }}>
                <FileText size={10} /> {t('drive.remote_mode_doc')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_delivery_doc')}
              </span>
            </div>
          </>
        )}

        {type === 'engine' && (
          <>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: 'var(--accent-primary, #38bdf8)' }}>
                <Zap size={10} /> {t('drive_tools.remote_engine_auto')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_engine_auto')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#34d399' }}>
                <Sparkles size={10} /> {t('drive_tools.remote_engine_cloud_fetch')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_engine_cloud_fetch')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#67e8f9' }}>
                <HardDrive size={10} /> {t('drive_tools.remote_engine_storage_local')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_engine_storage_local')}
              </span>
            </div>
          </>
        )}

        {type === 'policy' && (
          <>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: 'var(--accent-primary, #38bdf8)' }}>
                <Zap size={10} /> {t('drive_tools.remote_policy_telegram')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_policy_telegram')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#818cf8' }}>
                <Folder size={10} /> {t('drive_tools.remote_policy_custom_disk')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_policy_custom_disk')}
              </span>
            </div>
            <div className="td-remote-triplet-popover-item">
              <span className="td-remote-triplet-popover-key" style={{ color: '#34d399' }}>
                <Layers size={10} /> {t('drive_tools.remote_policy_disk_and_telegram')}
              </span>
              <span className="td-remote-triplet-popover-desc">
                {t('drive_tools.remote_info_policy_disk_and_telegram')}
              </span>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderTripletAndDestinationControls = (isBatch?: boolean) => (
    <>
      {/* Row: Triplet Compact Row (Media Delivery Format, Transfer Engine, Storage Policy in 1 Row) */}
      <div className="td-remote-triplet-row">
        {/* Col 1: Media Delivery Format */}
        <div className="td-remote-triplet-col col-delivery">
          <div className="td-remote-triplet-header">
            <span className="td-remote-triplet-title">
              <Film size={11} className="text-purple-400" />
              <span>{t('drive.remote_delivery_mode_label')}</span>
            </span>
            <button
              type="button"
              className={`td-remote-col-info-btn${activeTripletInfo === 'delivery' ? ' active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTripletInfo((prev) => (prev === 'delivery' ? null : 'delivery'));
              }}
              title={t('drive_tools.remote_info_delivery_title')}
              aria-label={t('drive_tools.remote_info_delivery_title')}
            >
              <Info size={10} />
            </button>
          </div>
          {renderTripletInfoPopover('delivery')}
          <div className="td-remote-mode-pills">
            <button
              type="button"
              className={`td-remote-mode-pill${deliveryMode === 'uncompressed' ? ' active uncompressed' : ''}`}
              onClick={() => setDeliveryMode('uncompressed')}
              disabled={submitting}
              title={t('drive.remote_mode_uncompressed_hint')}
            >
              <Film size={11} />
              <span>{t('drive.remote_mode_uncompressed')}</span>
              {deliveryMode === 'uncompressed' && <Check size={10} />}
            </button>
            <button
              type="button"
              className={`td-remote-mode-pill${deliveryMode === 'auto' ? ' active auto' : ''}`}
              onClick={() => setDeliveryMode('auto')}
              disabled={submitting}
              title={t('drive.remote_mode_auto_hint')}
            >
              <Zap size={11} />
              <span>{t('drive.remote_mode_auto')}</span>
              {deliveryMode === 'auto' && <Check size={10} />}
            </button>
            <button
              type="button"
              className={`td-remote-mode-pill${deliveryMode === 'document' ? ' active doc' : ''}`}
              onClick={() => setDeliveryMode('document')}
              disabled={submitting}
              title={t('drive.remote_mode_doc_hint')}
            >
              <FileText size={11} />
              <span>{t('drive.remote_mode_doc')}</span>
              {deliveryMode === 'document' && <Check size={10} />}
            </button>
          </div>
        </div>

        {/* Col 2: Transfer Engine */}
        <div className="td-remote-triplet-col col-engine">
          <div className="td-remote-triplet-header">
            <span className="td-remote-triplet-title">
              <Zap size={11} className="text-sky-400" />
              <span>{t('drive_tools.remote_engine_mode_title')}</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {effectiveRemoteEngine === 'cloud_fetch' ? (
                <span className="td-remote-engine-badge zero-quota">
                  <Sparkles size={9} />
                  <span>{t('drive_tools.remote_zero_quota_badge')}</span>
                </span>
              ) : (
                <span className="td-remote-engine-badge storage-local">
                  <HardDrive size={9.5} />
                  <span>{t('drive_tools.remote_engine_storage_local')}</span>
                </span>
              )}
              <button
                type="button"
                className={`td-remote-col-info-btn${activeTripletInfo === 'engine' ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTripletInfo((prev) => (prev === 'engine' ? null : 'engine'));
                }}
                title={t('drive_tools.remote_info_engine_title')}
                aria-label={t('drive_tools.remote_info_engine_title')}
              >
                <Info size={10} />
              </button>
            </div>
          </div>
          {renderTripletInfoPopover('engine')}
          <div className="td-remote-engine-pills">
            {(['auto', 'cloud_fetch', 'storage_local'] as RemoteEngineMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`td-remote-engine-pill mode-${mode}${remoteEngineMode === mode ? ' active' : ''}`}
                disabled={submitting}
                onClick={() => {
                  setRemoteEngineMode(mode);
                  try { localStorage.setItem('autogram_remote_engine_mode', mode); } catch { /* ok */ }
                }}
              >
                {mode === 'auto' && <Zap size={10} />}
                {mode === 'cloud_fetch' && <Sparkles size={10} />}
                {mode === 'storage_local' && <HardDrive size={10} />}
                <span>
                  {mode === 'auto' ? t('drive_tools.remote_engine_auto') :
                   mode === 'cloud_fetch' ? t('drive_tools.remote_engine_cloud_fetch') :
                   t('drive_tools.remote_engine_storage_local')}
                </span>
                {remoteEngineMode === mode && <Check size={9} />}
              </button>
            ))}
          </div>
        </div>

        {/* Col 3: Storage Policy */}
        <div className="td-remote-triplet-col col-policy">
          <div className="td-remote-triplet-header">
            <span className="td-remote-triplet-title">
              <HardDrive size={11} className="text-emerald-400" />
              <span>{t('drive_tools.remote_storage_policy_label')}</span>
            </span>
            <button
              type="button"
              className={`td-remote-col-info-btn${activeTripletInfo === 'policy' ? ' active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTripletInfo((prev) => (prev === 'policy' ? null : 'policy'));
              }}
              title={t('drive_tools.remote_info_policy_title')}
              aria-label={t('drive_tools.remote_info_policy_title')}
            >
              <Info size={10} />
            </button>
          </div>
          {renderTripletInfoPopover('policy')}
          <div className="td-remote-engine-pills">
            {(['telegram', 'custom_disk', 'disk_and_telegram'] as StorageLocalPolicy[]).map((pol) => (
              <button
                key={pol}
                type="button"
                className={`td-remote-engine-pill${storagePolicy === pol ? ' active' : ''}`}
                disabled={submitting}
                onClick={() => setStoragePolicy(pol)}
              >
                {pol === 'telegram' && <Zap size={10} />}
                {pol === 'custom_disk' && <Folder size={10} />}
                {pol === 'disk_and_telegram' && <Layers size={10} />}
                <span>
                  {pol === 'telegram' ? t('drive_tools.remote_policy_telegram') :
                   pol === 'custom_disk' ? t('drive_tools.remote_policy_custom_disk') :
                   t('drive_tools.remote_policy_disk_and_telegram')}
                </span>
                {storagePolicy === pol && <Check size={9} />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Optional Custom Disk Path Row */}
      {(storagePolicy === 'custom_disk' || storagePolicy === 'disk_and_telegram') && (
        <div className="td-remote-custom-disk-row" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <input
            type="text"
            className="td-input-field"
            placeholder={t('drive_tools.remote_custom_disk_path_label')}
            value={customDiskPath}
            onChange={(e) => setCustomDiskPath(e.target.value)}
            style={{ flex: 1, height: 28, fontSize: '0.74rem' }}
          />
          <button
            type="button"
            className="td-chip-btn"
            style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, height: 28 }}
            onClick={async () => {
              try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const res = await open({ directory: true });
                if (res) setCustomDiskPath(String(res));
              } catch (e) {
                console.error('Folder picker error:', e);
              }
            }}
          >
            <Folder size={11} />
            <span>{t('drive_tools.remote_custom_disk_browse')}</span>
          </button>
        </div>
      )}

      {/* Row: Destination Selector (Hidden when Local Disk Only) */}
      {storagePolicy !== 'custom_disk' && (
        <div className="td-remote-field-group td-remote-dest-row">
          <button
            id={isBatch ? 'td-remote-target-batch' : 'td-remote-target'}
            type="button"
            className="td-remote-dest-card"
            onClick={() => setPickerOpen(true)}
            disabled={submitting}
            title={t('drive.btn_change_dest')}
          >
            <div className="td-remote-dest-main">
              <span className="td-dest-ico" aria-hidden>
                {selectedDest.kind === 'saved' ? (
                  <Home size={14} />
                ) : (
                  <PeerAvatar
                    peerId={selectedDest.id ?? 0}
                    creds={creds}
                    title={selectedDest.label}
                    fallback={kindIcon(selectedDest)}
                  />
                )}
              </span>
              <div className="td-remote-dest-info">
                <span className="td-remote-dest-title" title={cleanTargetDisplay.title}>
                  {cleanTargetDisplay.title}
                </span>
                {cleanTargetDisplay.topicPill && (
                  <span className="td-remote-dest-topic">
                    <Hash size={9} style={{ display: 'inline', verticalAlign: '-1px' }} />
                    {` ${cleanTargetDisplay.topicPill.replace(/^#\s*/, '')}`}
                  </span>
                )}
              </div>
            </div>
            <div className="td-remote-dest-actions">
              {renderBadge(selectedDest, t)}
              <span className="td-remote-dest-change-tag">
                {t('drive.btn_change_dest')}
                <ChevronRight size={11} style={{ marginLeft: 2 }} />
              </span>
            </div>
          </button>
        </div>
      )}
    </>
  );

  return { renderSupportedLinksPopover, renderTripletInfoPopover, renderTripletAndDestinationControls };
}

export function renderMatrixTable({
  filteredRawStreams,
  resolvedMedia,
  selectedFormatId,
  activeFmt,
  handleToggleFormat,
  handlePlayFormat,
  matrixSearchQuery,
  setMatrixSearchQuery,
  matrixHideM3u8,
  setMatrixHideM3u8,
  t,
  formatDriveBytes,
  isStreamHls,
}: {
  filteredRawStreams: RawStreamItem[];
  resolvedMedia: any;
  selectedFormatId?: string | null;
  activeFmt?: StreamQualityFormat;
  handleToggleFormat: (fmt: StreamQualityFormat) => void;
  handlePlayFormat: (fmt: StreamQualityFormat) => void;
  matrixSearchQuery: string;
  setMatrixSearchQuery: (query: string) => void;
  matrixHideM3u8: boolean;
  setMatrixHideM3u8: React.Dispatch<React.SetStateAction<boolean>>;
  t: (key: string, opts?: any) => string;
  formatDriveBytes: (bytes: number) => string;
  isStreamHls: (s: RawStreamItem) => boolean;
}) {
  const rawMp4Videos = filteredRawStreams
    .filter((s) => s.type !== 'audio' && (s.mimeType.includes('mp4') || s.codec.includes('AVC') || s.codec.includes('H.264') || s.codec.includes('AV1')))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  const rawWebmVideos = filteredRawStreams
    .filter((s) => s.type !== 'audio' && (s.mimeType.includes('webm') || s.codec.includes('VP9')))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  const rawOtherVideos = filteredRawStreams
    .filter((s) => s.type !== 'audio' && !rawMp4Videos.some((m) => m.itag === s.itag) && !rawWebmVideos.some((w) => w.itag === s.itag))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  const rawAudioStreams = filteredRawStreams
    .filter((s) => s.type === 'audio')
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  const renderMatrixRow = (s: RawStreamItem) => {
    const matchedFmt = resolvedMedia.formats.find((f: StreamQualityFormat) => f.directUrl === s.directUrl && !f.mux?.transcodeVideo) || {
      id: `raw_itag_${s.itag}`,
      label: `${s.height ? t('drive.remote_format_height', { height: s.height }) : s.type === 'audio' ? t('drive.remote_format_filter_audio_tab') : s.codec} (itag ${s.itag})`,
      qualityTier: 'original' as const,
      resolution: s.height ? t('drive.remote_format_height', { height: s.height }) : undefined,
      ext: s.mimeType.includes('webm') || s.mimeType.includes('opus') ? 'webm' : (s.type === 'audio' ? 'm4a' : 'mp4'),
      filesizeBytes: s.filesizeBytes,
      directUrl: s.directUrl,
      protocol: s.protocol,
      isVideo: s.type === 'video' || s.type === 'muxed',
      isAudio: s.type === 'audio',
      width: s.width,
      height: s.height,
      fps: s.fps,
      bitrate: s.bitrate,
      audioBitrate: s.type === 'audio' ? s.bitrate : undefined,
      sampleRate: s.sampleRate,
      audioChannels: s.audioChannels,
      isHdr: s.isHdr === true,
      badge: s.bitrateFormatted,
      itag: s.itag,
      isDownloadable: s.isDownloadable,
      isStreamable: s.isStreamable,
      downloadOnly: s.downloadOnly,
    };
    const isSelected = Boolean(
      selectedFormatId &&
      (selectedFormatId === matchedFmt.id || (activeFmt?.itag && activeFmt.itag === s.itag))
    );
    return (
      <tr
        key={s.itag}
        className={`td-remote-matrix-row ${isSelected ? 'selected' : ''}`}
        onClick={() => { if (!isStreamHls(s) && s.isDownloadable !== false) handleToggleFormat(matchedFmt); }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handlePlayFormat(matchedFmt);
        }}
        title={s.isStreamable === false
          ? t('drive_tools.remote_format_preview_unavailable')
          : isSelected
            ? t('drive.remote_unselect_card_tooltip')
            : t('drive.remote_stream_double_click_hint')}
      >
        <td>
          <span className="td-remote-matrix-itag-badge">{s.itag}</span>
        </td>
        <td>
          {(() => {
            const baseRes = s.type === 'audio'
              ? t('drive.remote_format_filter_audio_tab')
              : (s.qualityLabel || '').replace(/\s*HDR/i, '').replace(/(\d+p)60/i, '$1').replace(/\s*60fps/i, '').replace(/\s*30fps/i, '').trim();
            return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontWeight: 700, color: s.isHdr ? '#fbbf24' : '#ffffff' }}>
                  {baseRes || s.qualityLabel}
                </span>
                {s.fps && s.fps >= 50 ? (
                  <span style={{ color: '#34d399', fontSize: '0.62rem', fontWeight: 700, background: 'rgba(52, 211, 153, 0.12)', padding: '1px 4px', borderRadius: 4 }}>
                    {`${s.fps}fps`}
                  </span>
                ) : s.fps && s.fps < 50 && s.type !== 'audio' ? (
                  <span style={{ color: '#94a3b8', fontSize: '0.62rem' }}>
                    {`${s.fps}fps`}
                  </span>
                ) : null}
                {s.isHdr && (
                  <span style={{ color: '#fbbf24', fontSize: '0.60rem', fontWeight: 800, background: 'rgba(251, 191, 36, 0.15)', padding: '1px 4px', borderRadius: 4 }}>
                    {t('drive.remote_badge_hdr')}
                  </span>
                )}
              </div>
            );
          })()}
        </td>
        <td>
          <span>{s.codec}</span>
          <span style={{ color: '#64748b', marginLeft: 4, fontSize: '0.62rem' }}>
            ({s.mimeType.split('/')[1] || s.mimeType})
          </span>
          {isStreamHls(s) ? (
            <span style={{
              color: '#fbbf24',
              background: 'rgba(251, 191, 36, 0.15)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              padding: '1px 5px',
              borderRadius: '4px',
              fontSize: '0.58rem',
              fontWeight: 700,
              marginLeft: 6,
            }}>
              {t('drive.remote_matrix_hls_badge')}
            </span>
          ) : (
            <span style={{
              color: '#4ade80',
              background: 'rgba(74, 222, 128, 0.14)',
              border: '1px solid rgba(74, 222, 128, 0.3)',
              padding: '1px 5px',
              borderRadius: '4px',
              fontSize: '0.58rem',
              fontWeight: 700,
              marginLeft: 6,
            }}>
              {t('drive.remote_matrix_direct_badge')}
            </span>
          )}
        </td>
        <td>
          <span style={{ color: s.isHdr ? '#fbbf24' : 'var(--accent-primary, #38bdf8)', fontWeight: 650 }}>
            {s.bitrateFormatted}
          </span>
        </td>
        <td>
          {s.filesizeBytes ? `~${formatDriveBytes(s.filesizeBytes)}` : '-'}
        </td>
        <td>
          <span className={`td-remote-matrix-type-badge ${s.type}`}>
            {s.type}
          </span>
        </td>
        <td style={{ textAlign: 'right' }}>
          <button
            type="button"
            className={`td-remote-matrix-select-btn ${isSelected ? 'selected' : ''}`}
            disabled={s.isDownloadable === false || isStreamHls(s) || !resolvedMedia.formats.some((f: StreamQualityFormat) => f.id === matchedFmt.id)}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleFormat(matchedFmt);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handlePlayFormat(matchedFmt);
            }}
            title={isSelected ? t('drive.remote_unselect_card_tooltip') : t('drive.remote_stream_double_click_hint')}
          >
            {isSelected ? t('drive.remote_matrix_selected_badge') : t('drive.remote_matrix_select_btn')}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="td-remote-matrix-wrapper">
      <div className="td-remote-matrix-search-box" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1 }}>
          <Search size={13} style={{ color: '#94a3b8', position: 'absolute', left: '10px' }} />
          <input
            type="text"
            value={matrixSearchQuery}
            onChange={(e) => setMatrixSearchQuery(e.target.value)}
            placeholder={t('drive.remote_matrix_search_placeholder')}
            style={{ width: '100%', paddingLeft: '30px' }}
          />
          {matrixSearchQuery && (
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, position: 'absolute', right: '10px' }}
              onClick={() => setMatrixSearchQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`td-chip-btn ${matrixHideM3u8 ? 'td-chip-primary' : ''}`}
          onClick={() => setMatrixHideM3u8((prev: boolean) => !prev)}
          style={{
            fontSize: '0.74rem',
            padding: '6px 10px',
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            borderRadius: '8px',
          }}
        >
          <Filter size={12} />
          <span>{matrixHideM3u8 ? t('drive.remote_matrix_hide_m3u8_active') : t('drive.remote_matrix_hide_m3u8_inactive')}</span>
        </button>
      </div>

      <div className="td-remote-matrix-table-scroll">
        <table className="td-remote-matrix-table">
          <thead>
            <tr>
              <th>{t('drive.remote_matrix_col_itag')}</th>
              <th>{t('drive.remote_matrix_col_resolution')}</th>
              <th>{t('drive.remote_matrix_col_codec')}</th>
              <th>{t('drive.remote_matrix_col_bitrate')}</th>
              <th>{t('drive.remote_matrix_col_size')}</th>
              <th>{t('drive.remote_matrix_col_type')}</th>
              <th style={{ textAlign: 'right' }}>{t('drive.remote_matrix_select_btn')}</th>
            </tr>
          </thead>
          {filteredRawStreams.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '16px', color: '#64748b' }}>
                  {t('drive.remote_matrix_empty_search')}
                </td>
              </tr>
            </tbody>
          ) : (
            <>
              {rawMp4Videos.length > 0 && (
                <tbody className="td-remote-matrix-group-tbody">
                  <tr className="td-remote-matrix-group-header-row">
                    <td colSpan={7}>
                      <div className="td-remote-matrix-group-header">
                        <Film size={12} style={{ color: 'var(--accent-primary, #38bdf8)' }} />
                        <span>{t('drive.remote_matrix_group_mp4')}</span>
                        <span className="td-remote-matrix-group-badge">{rawMp4Videos.length}</span>
                      </div>
                    </td>
                  </tr>
                  {rawMp4Videos.map(renderMatrixRow)}
                </tbody>
              )}

              {rawWebmVideos.length > 0 && (
                <tbody className="td-remote-matrix-group-tbody">
                  <tr className="td-remote-matrix-group-header-row">
                    <td colSpan={7}>
                      <div className="td-remote-matrix-group-header">
                        <Film size={12} style={{ color: '#fbbf24' }} />
                        <span>{t('drive.remote_matrix_group_webm')}</span>
                        <span className="td-remote-matrix-group-badge">{rawWebmVideos.length}</span>
                      </div>
                    </td>
                  </tr>
                  {rawWebmVideos.map(renderMatrixRow)}
                </tbody>
              )}

              {rawOtherVideos.length > 0 && (
                <tbody className="td-remote-matrix-group-tbody">
                  <tr className="td-remote-matrix-group-header-row">
                    <td colSpan={7}>
                      <div className="td-remote-matrix-group-header">
                        <Film size={12} style={{ color: 'var(--accent-secondary, #a855f7)' }} />
                        <span>{t('drive.remote_matrix_group_other_video')}</span>
                        <span className="td-remote-matrix-group-badge">{rawOtherVideos.length}</span>
                      </div>
                    </td>
                  </tr>
                  {rawOtherVideos.map(renderMatrixRow)}
                </tbody>
              )}

              {rawAudioStreams.length > 0 && (
                <tbody className="td-remote-matrix-group-tbody">
                  <tr className="td-remote-matrix-group-header-row">
                    <td colSpan={7}>
                      <div className="td-remote-matrix-group-header">
                        <Music size={12} style={{ color: 'var(--accent-secondary, #c084fc)' }} />
                        <span>{t('drive.remote_matrix_group_audio')}</span>
                        <span className="td-remote-matrix-group-badge">{rawAudioStreams.length}</span>
                      </div>
                    </td>
                  </tr>
                  {rawAudioStreams.map(renderMatrixRow)}
                </tbody>
              )}
            </>
          )}
        </table>
      </div>
    </div>
  );
}
