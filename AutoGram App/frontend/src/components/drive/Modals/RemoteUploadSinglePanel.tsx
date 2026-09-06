// Transitional extraction boundary: the parent owns the strongly-typed
// resolver state; this view receives a runtime context while the feature
// contract is being finalized. Keep runtime handler wiring explicit in the
// parent until the shared context type is promoted.
// @ts-nocheck
import {
  Link2, X, Loader2, RefreshCw, Clipboard, ExternalLink, Film, Image as ImageIcon, Music,
  FileText, CheckCircle2, Check, CheckCheck, CheckSquare, Square, XCircle,
  LayoutGrid, List, Layers, Sparkles, Zap, KeyRound, Search, Play, Clock, Pencil, RotateCcw,
  Copy, ArrowUp, ArrowDown, Filter, Info,
} from 'lucide-react';
import { detectTauriRuntime } from '../../../lib/tauri/platform';
import type { RawStreamItem, StreamQualityFormat } from '../../../lib/telegram/linkResolvers';
// Keep the destination icon available inside the extracted panel. Older HMR
// instances could still evaluate a destination branch that referenced this
// helper from the pre-split monolith.
import { kindIcon } from './remoteUploadUiPrimitives';

export function RemoteUploadSinglePanel({ ctx }: { ctx: Record<string, any> }) {
  const { t,url,passcode,submitting,inspection,setInspection,probeUrl,handleOpenInBrowser,handlePasteClipboard,handleUrlChange,resolvedMedia,handlePasscodeChange,renderTripletAndDestinationControls,isSplitActive,previewSectionRef,selectedFormatId,setSelectedFormatId,activePlayableUrl,isPlayingStream,activePreviewItem,activeSlideUrl,captureVideoCanvasThumbnail,setResolvedMedia,effectiveMediaItems,activeSlideIndex,activeTargetExt,activeItemCurrentName,isEditingActiveName,setIsEditingActiveName,editingNameValue,setEditingNameValue,saveCurrentEditingName,resetActiveName,itemCustomNames,isNameModified,handleSelectFormat,handleToggleFormat,handlePlayFormat,selectedMediaItemIds,handleToggleItem,handleSelectAllItems,handleDeselectAllItems,filteredAndSortedItems,galleryViewMode,setGalleryViewMode,galleryFilter,setGalleryFilter,gallerySearch,setGallerySearch,gallerySortBy,setGallerySortBy,gallerySortOrder,setGallerySortOrder,itemDurations,setItemDurations,itemResolutions,setItemResolutions,itemSelectedFormats,selectedBytes,streamContainerFilter,setStreamContainerFilter,matrixSearchQuery,setMatrixSearchQuery,matrixHideM3u8,setMatrixHideM3u8,subtitleSearchQuery,setSubtitleSearchQuery,subtitleTypeFilter,setSubtitleTypeFilter,copiedStreamUrl,setCopiedStreamUrl,handleLoadMoreDiscovery,discoveryLoading,handleOpenAssistedInspector,probeSingleItemDuration,ItemDurationBadge,fileKindIcon,getFormatDisplayLabel,getFormatDisplayBadge,getBadgeModifierClass,getSingleUnifiedBadgeInfo,isManifestFormat,splitFilenameAndExt,formatMediaDuration,formatDriveBytes,handleCardClick,handleCardDoubleClick,clickTimersRef} = ctx;
  return (
    <>
              {/* SECTION 1: INGESTION CONTROLS (Full-Width 1 Column) */}
              <div className="td-remote-section-1">
                <div className="td-remote-section-1-controls">
                  <div className="td-remote-unified-panel">
                    {/* Row 1: Source File URL */}
                    <div className="td-remote-field-group">
                      <div className="td-remote-label-row">
                        <label className="td-input-label" htmlFor="td-remote-url">
                          <span>{t('drive.source_url_label')}</span>
                        </label>
                      <div className="td-remote-label-actions">
                        {url.trim() && (
                          <button
                            type="button"
                            className="td-remote-paste-action"
                            onClick={() => probeUrl(url.trim(), passcode.trim(), true)}
                            disabled={submitting || inspection?.status === 'inspecting'}
                            title={t('drive.remote_batch_reinspect_btn')}
                          >
                            <RefreshCw size={11} className={inspection?.status === 'inspecting' ? 'spin' : ''} />
                            <span>{t('drive.remote_batch_reinspect_btn')}</span>
                          </button>
                        )}
                        {url.trim() && (
                          <button
                            type="button"
                            className="td-remote-browser-action"
                            onClick={() => handleOpenInBrowser(url.trim())}
                            disabled={submitting}
                            title={t('drive.remote_open_in_browser')}
                          >
                            <ExternalLink size={11} />
                            <span>{t('drive.remote_open_in_browser')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="td-remote-paste-action"
                          onClick={handlePasteClipboard}
                          disabled={submitting}
                          title={t('drive.remote_paste_clipboard')}
                        >
                          <Clipboard size={10} />
                          <span>{t('drive.remote_paste_clipboard')}</span>
                        </button>
                      </div>
                    </div>
                    <div className="td-remote-input-wrap">
                      <span className="td-remote-input-icon">
                        <Link2 size={14} />
                      </span>
                      <input
                        id="td-remote-url"
                        className="td-input-field td-remote-url-input"
                        type="text"
                        placeholder={t('drive.remote_url_placeholder')}
                        value={url}
                        onChange={(e) => handleUrlChange(e.target.value)}
                        disabled={submitting}
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                      />
                      {url && (
                        <button
                          type="button"
                          className="td-remote-clear-btn"
                          onClick={() => handleUrlChange('')}
                          disabled={submitting}
                          aria-label={t('drive.remote_clear_input')}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Passcode (if required) */}
                  {(resolvedMedia?.requiresPassword || Boolean(passcode.trim())) && (
                    <div className="td-remote-field-group td-remote-passcode-field-animated">

                      <div className="td-remote-label-row">
                        <label className="td-input-label" htmlFor="td-remote-passcode">
                          {t('drive.remote_passcode_label')}
                        </label>
                        <div className="td-remote-label-actions">
                          {resolvedMedia?.requiresPassword && (
                            <span
                              className={`td-remote-passcode-status-badge ${
                                resolvedMedia.passwordError ? 'error' : 'required'
                              }`}
                            >
                              <KeyRound size={10} />
                              <span>
                                {resolvedMedia.passwordError
                                  ? t('drive.remote_passcode_invalid_badge')
                                  : t('drive.remote_passcode_required_badge')}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="td-remote-input-wrap">
                        <span className="td-remote-input-icon">
                          <KeyRound size={13} />
                        </span>
                        <input
                          id="td-remote-passcode"
                          className={`td-input-field td-remote-passcode-input ${
                            resolvedMedia?.requiresPassword ? 'highlight-required' : ''
                          }`}
                          type="text"
                          placeholder={t('drive.remote_passcode_placeholder')}
                          value={passcode}
                          onChange={(e) => handlePasscodeChange(e.target.value)}
                          disabled={submitting}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        {passcode && (
                          <button
                            type="button"
                            className="td-remote-clear-btn"
                            onClick={() => handlePasscodeChange('')}
                            disabled={submitting}
                            aria-label={t('drive.remote_clear_input')}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Triplet Compact Row (Media Delivery Format, Transfer Engine, Storage Policy) & Destination */}
                  {renderTripletAndDestinationControls(false)}
                </div>
              </div>
            </div>

          {/* STREAM PREVIEW SECTION: Side-by-Side Player & Media Cards Gallery */}
          {isSplitActive && (
            <div ref={previewSectionRef} className="td-remote-preview-section">
              {resolvedMedia ? (
                <div className="td-remote-meta-card">
                  <div className="td-remote-stream-split-wrap">
                    {/* Left Column: Player & Active Stream Details */}
                    <div className="td-remote-stream-player-col">
                      {/* Active Player Canvas */}
                      {(() => {
                        const activeFormatForCanvas = resolvedMedia?.formats?.find((f) => f.id === selectedFormatId) || resolvedMedia?.formats?.[0];
                        const isDirectStream = Boolean(
                          activePlayableUrl &&
                          activeFormatForCanvas?.isStreamable !== false &&
                          !activePlayableUrl.includes('youtube.com/watch') &&
                          !activePlayableUrl.includes('youtu.be/')
                        );

                        return (
                          <div className="td-remote-big-canvas-wrap">
                            {isPlayingStream && isDirectStream ? (

                              <div className="td-remote-big-canvas-inner td-remote-single-player-canvas">
                                <video
                                  key={activePlayableUrl}
                                  src={activePlayableUrl}
                                  poster={activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia.thumbnailUrl}
                                  autoPlay
                                  controls
                                  preload="auto"
                                  playsInline
                                  className="td-remote-big-canvas-video td-remote-active-player-video"
                                  crossOrigin="anonymous"
                                  onLoadedData={(e) => {
                                    const v = e.currentTarget;
                                    if (resolvedMedia && !resolvedMedia.thumbnailUrl) {
                                      const thumb = captureVideoCanvasThumbnail(v);
                                      if (thumb) {
                                        setResolvedMedia((prev) => (prev ? { ...prev, thumbnailUrl: thumb } : prev));
                                      }
                                    }
                                  }}
                                  onLoadedMetadata={(e) => {
                                    const v = e.currentTarget;
                                    const dur = v.duration;
                                    const w = v.videoWidth;
                                    const h = v.videoHeight;
                                    if (resolvedMedia && !resolvedMedia.thumbnailUrl) {
                                      const thumb = captureVideoCanvasThumbnail(v);
                                      if (thumb) {
                                        setResolvedMedia((prev) => (prev ? { ...prev, thumbnailUrl: thumb } : prev));
                                      }
                                    }
                                    if (dur && isFinite(dur) && dur > 0) {
                                      const d = Math.round(dur);
                                      if (activePreviewItem) {
                                        setItemDurations((prev) => {
                                          if (prev[activePreviewItem.id] === d) return prev;
                                          return { ...prev, [activePreviewItem.id]: d };
                                        });
                                      }
                                    }
                                    if (w > 0 && h > 0 && activePreviewItem) {
                                      setItemResolutions((prev) => {
                                        const cur = prev[activePreviewItem.id];
                                        if (cur && cur.width === w && cur.height === h) return prev;
                                        return { ...prev, [activePreviewItem.id]: { width: w, height: h } };
                                      });
                                    }
                                  }}
                                  onDurationChange={(e) => {
                                    const dur = e.currentTarget.duration;
                                    if (dur && isFinite(dur) && dur > 0) {
                                      const d = Math.round(dur);
                                      if (activePreviewItem) {
                                        setItemDurations((prev) => {
                                          if (prev[activePreviewItem.id] === d) return prev;
                                          return { ...prev, [activePreviewItem.id]: d };
                                        });
                                      }
                                    }
                                  }}
                                />
                              </div>
                            ) : isPlayingStream ? (
                              <div className="td-remote-big-canvas-fallback">
                                <FileText size={36} className="td-remote-fallback-icon" />
                                <span>{t('drive_tools.remote_format_preview_unavailable')}</span>
                              </div>
                            ) : (activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia.thumbnailUrl) ? (
                              <div className="td-remote-big-canvas-inner">
                                <img
                                  src={activePreviewItem?.thumbnailUrl || activeSlideUrl || resolvedMedia.thumbnailUrl}
                                  alt={resolvedMedia.title}
                                  className="td-remote-big-canvas-img"
                                  loading="eager"
                                  referrerPolicy="no-referrer"
                                />
                                {activeFormatForCanvas && (
                                  <button
                                    type="button"
                                    className="td-remote-canvas-center-play-btn"

                                    onClick={() => handlePlayFormat(activeFormatForCanvas)}
                                    title={t('drive.remote_stream_play_tooltip')}
                                  >
                                    <div className="td-remote-canvas-play-circle">
                                      <Play size={24} fill="currentColor" />
                                    </div>
                                    <span className="td-remote-canvas-play-hint">{t('drive.remote_stream_play_hint')}</span>
                                  </button>
                                )}
                                <div className="td-remote-canvas-badge-overlay">
                                  {resolvedMedia.albumImages && resolvedMedia.albumImages.length > 1 && (
                                    <span className="td-remote-canvas-slide-tag">
                                      <ImageIcon size={12} />
                                      <span>
                                        {t('drive.remote_split_slide_preview', {
                                          idx: activeSlideIndex + 1,
                                          total: resolvedMedia.albumImages.length,
                                        })}
                                      </span>
                                    </span>
                                  )}
                                  {resolvedMedia.durationSec ? (
                                    <span className="td-remote-canvas-duration-tag">
                                      <Clock size={11} />
                                      <span>{formatMediaDuration(resolvedMedia.durationSec)}</span>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              <div className="td-remote-big-canvas-fallback">
                                <Film size={36} className="td-remote-fallback-icon" />
                                <span>{t('drive_tools.remote_platform_stream_fallback', { platform: resolvedMedia.platformName })}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Active Item Editable Filename Bar (Replacing Specs Ribbon) */}
                      <div className="td-remote-stream-filename-bar">
                        {isEditingActiveName ? (
                          <div className="td-remote-filename-edit-form">
                            <div className="td-remote-filename-input-group">
                              <input
                                type="text"
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    saveCurrentEditingName();
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setIsEditingActiveName(false);
                                  }
                                }}
                                className="td-remote-filename-input"
                                placeholder={t('drive_tools.remote_filename_placeholder')}
                                autoFocus
                              />
                              <span
                                className="td-remote-filename-locked-ext"
                                title={t('drive_tools.remote_filename_locked_ext_tooltip', { ext: `.${activeTargetExt}` })}
                              >
                                .{activeTargetExt}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={saveCurrentEditingName}
                              className="td-remote-name-action-btn td-remote-name-save-btn"
                              title={t('drive_tools.remote_save_filename')}
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingActiveName(false)}
                              className="td-remote-name-action-btn td-remote-name-cancel-btn"

                              title={t('drive_tools.remote_cancel_edit_filename')}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="td-remote-filename-display">
                            <span className="td-remote-filename-text" title={activeItemCurrentName}>
                              {activeItemCurrentName}
                            </span>
                            <div className="td-remote-filename-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  const { base } = splitFilenameAndExt(activeItemCurrentName, activeTargetExt);
                                  setEditingNameValue(base);
                                  setIsEditingActiveName(true);
                                }}
                                className="td-remote-name-action-btn"
                                title={t('drive_tools.remote_edit_filename')}
                              >
                                <Pencil size={12} />
                              </button>
                              {isNameModified && (
                                <button
                                  type="button"
                                  onClick={resetActiveName}
                                  className="td-remote-name-action-btn td-remote-name-reset-btn"
                                  title={t('drive_tools.remote_reset_filename')}
                                >
                                  <RotateCcw size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Media Cards Gallery or Format Selection */}
                    <div className="td-remote-stream-gallery-col">
                      {effectiveMediaItems.length > 1 ? (
                        <>
                          <div className="td-remote-gallery-header-row">
                            <div className="td-remote-gallery-header-left">
                              <Layers size={13} className="text-sky-400 shrink-0" />
                              <span className="td-remote-gallery-title">
                                {t('drive_tools.remote_gallery_title')}
                              </span>
                              <span
                                className="td-remote-gallery-unified-pill"
                                title={t('drive_tools.remote_gallery_selected_pill_full', {
                                  selected: selectedMediaItemIds.size,
                                  total: effectiveMediaItems.length,
                                  size: selectedBytes > 0 ? `~${formatDriveBytes(selectedBytes)}` : '0 B',
                                })}
                              >
                                <span className="td-pill-count">
                                  {t('drive_tools.remote_gallery_selected_pill', {
                                    selected: selectedMediaItemIds.size,
                                    total: effectiveMediaItems.length,
                                  })}
                                </span>
                                {selectedBytes > 0 && (
                                  <>
                                    <span className="td-pill-dot">·</span>
                                    <span className="td-pill-size">~{formatDriveBytes(selectedBytes)}</span>
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="td-remote-gallery-header-right">
                              <button
                                type="button"
                                className="td-remote-gallery-btn-action"
                                onClick={handleSelectAllItems}
                                title={t('drive_tools.remote_gallery_select_all')}
                              >
                                <CheckCheck size={11} />
                                <span>{t('drive_tools.remote_gallery_select_all')}</span>

                              </button>
                              <button
                                type="button"
                                className="td-remote-gallery-btn-action"
                                onClick={handleDeselectAllItems}
                                title={t('drive_tools.remote_gallery_deselect_all')}
                              >
                                <XCircle size={11} />
                                <span>{t('drive_tools.remote_gallery_deselect_all')}</span>
                              </button>
                              <div className="td-remote-gallery-density-toggle">
                                <button
                                  type="button"
                                  className={`td-remote-density-btn ${galleryViewMode === 'grid' ? 'active' : ''}`}
                                  onClick={() => setGalleryViewMode('grid')}
                                  title={t('drive_tools.remote_gallery_view_grid')}
                                >
                                  <LayoutGrid size={12} />
                                </button>
                                <button
                                  type="button"
                                  className={`td-remote-density-btn ${galleryViewMode === 'list' ? 'active' : ''}`}
                                  onClick={() => setGalleryViewMode('list')}
                                  title={t('drive_tools.remote_gallery_view_list')}
                                >
                                  <List size={12} />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Search & Filters + Sort inline */}
                          <div className="td-remote-gallery-toolbar">
                            <div className="td-remote-gallery-toolbar-left">
                              <div className="td-remote-gallery-search-wrap">
                                <Search size={12} className="td-remote-gallery-search-icon" />
                                <input
                                  type="text"
                                  className="td-remote-gallery-search-input"
                                  placeholder={t('drive_tools.remote_gallery_search_placeholder', { count: effectiveMediaItems.length })}
                                  value={gallerySearch}
                                  onChange={(e) => setGallerySearch(e.target.value)}
                                />
                                {gallerySearch && (
                                  <button
                                    type="button"
                                    className="td-remote-gallery-search-clear"
                                    onClick={() => setGallerySearch('')}
                                  >
                                    <X size={11} />
                                  </button>
                                )}
                              </div>

                              <div
                                className="td-remote-gallery-filters"
                                onWheel={(e) => {
                                  if (e.deltaY !== 0) {
                                    e.currentTarget.scrollLeft += e.deltaY;
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className={`td-remote-filter-chip ${galleryFilter === 'all' ? 'active' : ''}`}
                                  onClick={() => setGalleryFilter('all')}
                                >
                                  {t('drive_tools.remote_gallery_filter_all', { count: effectiveMediaItems.length })}
                                </button>
                                {effectiveMediaItems.some((i) => i.kind === 'video') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'video' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('video')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_videos', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'video').length,
                                    })}
                                  </button>
                                )}

                                {effectiveMediaItems.some((i) => i.kind === 'image') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'image' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('image')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_photos', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'image').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'profile') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'profile' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('profile')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_profile', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'profile').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'story') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'story' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('story')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_stories', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'story').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'audio') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'audio' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('audio')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_audio', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'audio').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'zip') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'zip' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('zip')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_archives', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'zip').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'doc') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip ${galleryFilter === 'doc' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('doc')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_documents', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'doc').length,
                                    })}
                                  </button>
                                )}
                                {effectiveMediaItems.some((i) => i.kind === 'unsupported' || i.kind === 'other') && (
                                  <button
                                    type="button"
                                    className={`td-remote-filter-chip filter-unsupported ${galleryFilter === 'unsupported' ? 'active' : ''}`}
                                    onClick={() => setGalleryFilter('unsupported')}
                                  >
                                    {t('drive_tools.remote_gallery_filter_unsupported', {
                                      count: effectiveMediaItems.filter((i) => i.kind === 'unsupported' || i.kind === 'other').length,
                                    })}
                                  </button>
                                )}
                              </div>
                            </div>


                            <div className="td-remote-gallery-toolbar-right">
                              <div className="td-remote-sort-wrap">
                                <button
                                  type="button"
                                  className="td-remote-sort-toggle-btn"
                                  onClick={() => setGallerySortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                                  title={gallerySortOrder === 'asc' ? t('drive_tools.remote_gallery_sort_order_asc') : t('drive_tools.remote_gallery_sort_order_desc')}
                                >
                                  <div className="td-remote-sort-arrows">
                                    <ArrowUp size={8.5} strokeWidth={2.8} className={`td-remote-sort-arrow ${gallerySortOrder === 'asc' ? 'active' : ''}`} />
                                    <ArrowDown size={8.5} strokeWidth={2.8} className={`td-remote-sort-arrow ${gallerySortOrder === 'desc' ? 'active' : ''}`} />
                                  </div>
                                </button>
                                <select
                                  className="td-remote-gallery-sort-select"
                                  value={gallerySortBy}
                                  onChange={(e) => setGallerySortBy(e.target.value as any)}
                                  title={t('drive_tools.remote_gallery_sort_label')}
                                >
                                  <option value="default">{t('drive_tools.remote_gallery_sort_default')}</option>
                                  <option value="name">{t('drive_tools.remote_gallery_sort_name')}</option>
                                  <option value="duration">{t('drive_tools.remote_gallery_sort_duration')}</option>
                                  <option value="size">{t('drive_tools.remote_gallery_sort_size')}</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* Scrollable Media Cards */}
                          <div className={`td-remote-gallery-grid-wrap ${galleryViewMode === 'list' ? 'view-list' : 'view-grid'}`}>
                            {filteredAndSortedItems.length === 0 ? (
                              <div className="td-remote-multicard-empty">
                                {t('drive_tools.no_match_found')}
                              </div>
                            ) : (
                              filteredAndSortedItems.map((item) => {
                                const isSelected = selectedMediaItemIds.has(item.id);
                                const isActive = item.id === activePreviewItem?.id;
                                const chosenFmtId = itemSelectedFormats[item.id] || item.selectedFormatId || item.formats[0]?.id;
                                const chosenFmt = item.formats.find((f) => f.id === chosenFmtId) || item.formats[0];

                                const rawName = itemCustomNames[item.id] || item.title;
                                const fallbackExt = chosenFmt?.ext ? `.${chosenFmt.ext.toLowerCase()}` : '';
                                const lastDot = rawName.lastIndexOf('.');
                                let baseName = rawName;
                                let extName = fallbackExt;

                                if (lastDot > 0) {
                                  baseName = rawName.slice(0, lastDot);
                                  extName = rawName.slice(lastDot);
                                }
                                const fullDisplayName = `${baseName}${extName}`;
                                const badgeInfo = getSingleUnifiedBadgeInfo(item, itemResolutions[item.id]);
                                const durSec = itemDurations[item.id] || item.durationSec || chosenFmt?.durationSec;
                                const durFormatted = formatMediaDuration(durSec);

                                if (galleryViewMode === 'list') {
                                  return (
                                    <div
                                      key={item.id}
                                      className={`td-remote-list-item-row ${isSelected ? 'selected' : ''} ${isActive ? 'is-active-preview' : ''}`}
                                      onClick={() => handleCardClick(item.id)}
                                      onDoubleClick={() => handleCardDoubleClick(item.id)}
                                    >
                                      {/* Left: Circular Checkbox */}
                                      <button
                                        type="button"
                                        className={`td-remote-item-checkbox list-mode-check ${isSelected ? 'checked' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const existingTimer = clickTimersRef.current.get(item.id);
                                          if (existingTimer) {
                                            clearTimeout(existingTimer);
                                            clickTimersRef.current.delete(item.id);
                                          }
                                          handleToggleItem(item.id);
                                        }}
                                        aria-label={isSelected ? t('drive_tools.remote_gallery_deselect_all') : t('drive_tools.remote_gallery_select_all')}
                                      >
                                        {isSelected && <Check size={9.5} strokeWidth={3.8} />}

                                      </button>

                                      {/* Compact Thumbnail with hover play hint */}
                                      <div
                                        className="td-remote-list-thumb-wrap"
                                        onClick={(e) => {
                                          if (item.kind === 'video') {
                                            e.stopPropagation();
                                            handleCardDoubleClick(item.id);
                                          }
                                        }}
                                        title={item.kind === 'video' ? t('drive_tools.remote_gallery_play_video') : undefined}
                                      >
                                        {item.thumbnailUrl ? (
                                          <img
                                            src={item.thumbnailUrl}
                                            alt={item.title}
                                            className="td-remote-list-thumb-img"
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            onLoad={(e) => {
                                              const target = e.currentTarget;
                                              if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                                                setItemResolutions((prev) => {
                                                  if (prev[item.id]) return prev;
                                                  return {
                                                    ...prev,
                                                    [item.id]: { width: target.naturalWidth, height: target.naturalHeight }
                                                  };
                                                });
                                              }
                                              if (
                                                item.kind === 'video' &&
                                                (!itemDurations[item.id] || !itemResolutions[item.id]) &&
                                                (!item.durationSec || item.durationSec <= 0)
                                              ) {
                                                probeSingleItemDuration(item);
                                              }
                                            }}
                                          />
                                        ) : (
                                          <div className="td-remote-list-thumb-fallback">
                                            {item.kind === 'video' ? <Film size={18} /> : <ImageIcon size={18} />}
                                          </div>
                                        )}
                                        {item.kind === 'video' && (
                                          <div className="td-remote-list-thumb-play-hint">
                                            <Play size={11} fill="currentColor" />
                                          </div>
                                        )}
                                      </div>

                                      {/* Middle: Title & Structured Meta Information */}
                                      <div className="td-remote-list-info-col">
                                        <div className="td-remote-list-title-row" title={fullDisplayName}>
                                          <span className="td-remote-list-title-base">{baseName}</span>
                                          {extName ? <span className="td-remote-list-title-ext">{extName}</span> : null}
                                        </div>

                                        <div className="td-remote-list-meta-row">
                                          {badgeInfo && (
                                            <span className={`td-remote-item-quality-badge in-list ${badgeInfo.tierClass}`} title={badgeInfo.text}>
                                              {badgeInfo.text}
                                            </span>
                                          )}
                                          {chosenFmt?.filesizeBytes ? (
                                            <span className="td-remote-list-meta-size">
                                              ~{formatDriveBytes(chosenFmt.filesizeBytes)}
                                            </span>
                                          ) : null}
                                          {durFormatted ? (
                                            <span className="td-remote-list-meta-dur">
                                              <Clock size={9.5} />
                                              <span>{durFormatted}</span>
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>

                                      {/* Right: Active playing badge or quick stream button */}

                                      <div className="td-remote-list-actions-col">
                                        {isActive ? (
                                          <span className="td-remote-list-active-badge">
                                            <Play size={9.5} fill="currentColor" />
                                            <span>{t('drive_tools.remote_gallery_playing')}</span>
                                          </span>
                                        ) : item.kind === 'video' ? (
                                          <button
                                            type="button"
                                            className="td-remote-list-play-btn"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleCardDoubleClick(item.id);
                                            }}
                                            title={t('drive_tools.remote_gallery_play_video')}
                                          >
                                            <Play size={11} fill="currentColor" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                }

                                /* Grid mode card */
                                return (
                                  <div
                                    key={item.id}
                                    className={`td-remote-media-item-card card-grid-mode ${isSelected ? 'selected' : ''} ${isActive ? 'is-active-preview' : ''}`}
                                    onClick={() => handleCardClick(item.id)}
                                    onDoubleClick={() => handleCardDoubleClick(item.id)}
                                  >
                                    <div className="td-remote-item-thumb-wrap">
                                      {item.thumbnailUrl ? (
                                        <img
                                          src={item.thumbnailUrl}
                                          alt={item.title}
                                          className="td-remote-item-thumb-img"
                                          loading="lazy"
                                          referrerPolicy="no-referrer"
                                          onLoad={(e) => {
                                            const target = e.currentTarget;
                                            if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                                              setItemResolutions((prev) => {
                                                if (prev[item.id]) return prev;
                                                return {
                                                  ...prev,
                                                  [item.id]: { width: target.naturalWidth, height: target.naturalHeight }
                                                };
                                              });
                                            }
                                            if (
                                              item.kind === 'video' &&
                                              (!itemDurations[item.id] || !itemResolutions[item.id]) &&
                                              (!item.durationSec || item.durationSec <= 0)
                                            ) {
                                              probeSingleItemDuration(item);
                                            }
                                          }}
                                        />
                                      ) : (
                                        <div className="td-remote-item-thumb-fallback">
                                          {item.kind === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}
                                        </div>
                                      )}

                                      {/* TOP-LEFT: Quality pill badge with dynamic tier styling */}
                                      {badgeInfo && (
                                        <span
                                          className={`td-remote-item-quality-badge ${badgeInfo.tierClass}`}
                                          title={badgeInfo.text}
                                        >
                                          {badgeInfo.text}
                                        </span>
                                      )}

                                      {/* TOP-RIGHT: Modern Circular Selection Button */}
                                      <button
                                        type="button"
                                        className={`td-remote-item-checkbox ${isSelected ? 'checked' : ''}`}

                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const existingTimer = clickTimersRef.current.get(item.id);
                                          if (existingTimer) {
                                            clearTimeout(existingTimer);
                                            clickTimersRef.current.delete(item.id);
                                          }
                                          handleToggleItem(item.id);
                                        }}
                                        aria-label={isSelected ? t('drive_tools.remote_gallery_deselect_all') : t('drive_tools.remote_gallery_select_all')}
                                      >
                                        {isSelected && <Check size={9.5} strokeWidth={3.8} />}
                                      </button>
                                    </div>

                                    {/* CARD BODY: bottom gradient overlay */}
                                    <div className="td-remote-item-card-body">
                                      <span
                                        className="td-remote-item-card-title"
                                        title={fullDisplayName}
                                      >
                                        <span className="td-remote-title-base">{baseName}</span>
                                        {extName ? <span className="td-remote-title-ext">{extName}</span> : null}
                                      </span>
                                      <div className="td-remote-card-meta-row">
                                        {chosenFmt?.filesizeBytes ? (
                                          <span className="td-remote-meta-size">
                                            ~{formatDriveBytes(chosenFmt.filesizeBytes)}
                                          </span>
                                        ) : <span />}
                                        <ItemDurationBadge
                                          item={item}
                                          knownDuration={itemDurations[item.id] || item.durationSec}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </>
                      ) : resolvedMedia.formats.length > 0 ? (
                        (() => {
                          const QUALITY_ORDER: Record<string, number> = {
                            '8k': 1,
                            '4k': 2,
                            '2k': 3,
                            '1080p': 4,
                            '720p': 5,
                            '480p': 6,
                            '360p': 7,
                            '240p': 8,
                            '144p': 9,
                          };

                          const isBrokenOrM3u8 = (f: StreamQualityFormat) =>
                            isManifestFormat(f) ||
                            (f.filesizeBytes === 0 && !f.resolution && !f.badge);

                          const allVideoFmts = resolvedMedia.formats.filter(
                            (f) => !f.isAudio && !f.isSubtitle && (f.isVideo || f.ext === 'mp4' || f.ext === 'webm') && !isBrokenOrM3u8(f)
                          );

                          const mp4VideoFmts = resolvedMedia.formats
                            .filter((f) => !f.isAudio && !f.isSubtitle && f.ext === 'mp4' && !isBrokenOrM3u8(f))
                            .sort((a, b) => (QUALITY_ORDER[a.qualityTier] || 99) - (QUALITY_ORDER[b.qualityTier] || 99) || (b.filesizeBytes || 0) - (a.filesizeBytes || 0));

                          const webmVideoFmts = resolvedMedia.formats
                            .filter((f) => !f.isAudio && !f.isSubtitle && f.ext === 'webm' && !isBrokenOrM3u8(f))
                            .sort((a, b) => (QUALITY_ORDER[a.qualityTier] || 99) - (QUALITY_ORDER[b.qualityTier] || 99) || (b.filesizeBytes || 0) - (a.filesizeBytes || 0));

                          const allAudioFmts = resolvedMedia.formats
                            .filter((f) => (f.isAudio || f.qualityTier === 'audio') && !isBrokenOrM3u8(f))
                            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                          // Audio has the same no-redundancy rule as General:
                          // collapse equivalent bitrate tiers and keep the
                          // highest concrete format in each tier.
                          const audioBitrate = (f: StreamQualityFormat): number => {

                            return Number(f.audioBitrate || f.bitrate || 0);
                          };
                          const audioGroups = new Map<string, StreamQualityFormat[]>();
                          allAudioFmts.forEach((f) => {
                            const bps = audioBitrate(f);
                            // Unknown metadata is deliberately not collapsed into an invented
                            // quality tier. It remains an explicit Original candidate.
                            const key = bps > 0 ? `bps-${Math.round(bps / 1000)}` : `original-${f.id}`;
                            const group = audioGroups.get(key) || [];
                            group.push(f);
                            audioGroups.set(key, group);
                          });
                          const audioFmts = Array.from(audioGroups.values())
                            .map((group) => group.sort((a, b) => {
                              const bitrateDiff = audioBitrate(b) - audioBitrate(a);
                              if (bitrateDiff !== 0) return bitrateDiff;
                              const sampleRateDiff = (b.sampleRate || 0) - (a.sampleRate || 0);
                              if (sampleRateDiff !== 0) return sampleRateDiff;
                              const channelDiff = (b.audioChannels || 0) - (a.audioChannels || 0);
                              if (channelDiff !== 0) return channelDiff;
                              const streamableDiff = Number(b.isStreamable === true) - Number(a.isStreamable === true);
                              if (streamableDiff !== 0) return streamableDiff;
                              return (b.filesizeBytes || 0) - (a.filesizeBytes || 0);
                            })[0])
                            .filter(Boolean)
                            .sort((a, b) => audioBitrate(b) - audioBitrate(a) || (b.filesizeBytes || 0) - (a.filesizeBytes || 0));

                          const subtitleFmts = resolvedMedia.formats.filter((f) => f.isSubtitle || f.qualityTier === 'subtitle');
                          const hasIdSubs = subtitleFmts.some((f) => f.resolution?.toLowerCase() === 'id' || f.label.toLowerCase().includes('indonesi') || f.badge?.toLowerCase().includes('id'));
                          const hasEnSubs = subtitleFmts.some((f) => f.resolution?.toLowerCase().startsWith('en') || f.label.toLowerCase().includes('english') || f.badge?.toLowerCase().includes('en'));
                          const hasAutoSubs = subtitleFmts.some((f) => f.label.toLowerCase().includes('(auto)') || f.badge?.toLowerCase().includes('auto'));
                          const hasManualSubs = subtitleFmts.some((f) => !f.label.toLowerCase().includes('(auto)') && !f.badge?.toLowerCase().includes('auto'));
                          const hasSrtSubs = subtitleFmts.some((f) => f.ext?.toLowerCase() === 'srt');
                          const hasVttSubs = subtitleFmts.some((f) => f.ext?.toLowerCase() === 'vtt');
                          const hasAssSubs = subtitleFmts.some((f) => f.ext?.toLowerCase() === 'ass');

                          const filteredSubtitleFmts = subtitleFmts.filter((f) => {
                            if (subtitleTypeFilter === 'id') {
                              const isId = f.resolution?.toLowerCase() === 'id' || f.label.toLowerCase().includes('indonesi') || f.badge?.toLowerCase().includes('id');
                              if (!isId) return false;
                            } else if (subtitleTypeFilter === 'en') {
                              const isEn = f.resolution?.toLowerCase().startsWith('en') || f.label.toLowerCase().includes('english') || f.badge?.toLowerCase().includes('en');
                              if (!isEn) return false;
                            } else if (subtitleTypeFilter === 'manual') {
                              const isAuto = f.label.toLowerCase().includes('(auto)') || f.badge?.toLowerCase().includes('auto');
                              if (isAuto) return false;
                            } else if (subtitleTypeFilter === 'auto') {
                              const isAuto = f.label.toLowerCase().includes('(auto)') || f.badge?.toLowerCase().includes('auto');
                              if (!isAuto) return false;
                            } else if (subtitleTypeFilter === 'srt') {
                              if (f.ext?.toLowerCase() !== 'srt') return false;
                            } else if (subtitleTypeFilter === 'vtt') {
                              if (f.ext?.toLowerCase() !== 'vtt') return false;
                            } else if (subtitleTypeFilter === 'ass') {
                              if (f.ext?.toLowerCase() !== 'ass') return false;
                            }

                            if (!subtitleSearchQuery.trim()) return true;
                            const q = subtitleSearchQuery.toLowerCase();
                            return (
                              f.label.toLowerCase().includes(q) ||
                              (f.resolution && f.resolution.toLowerCase().includes(q)) ||
                              (f.badge && f.badge.toLowerCase().includes(q))
                            );
                          });
                          const rawStreamsList = resolvedMedia.rawStreams || [];

                          const getFormatResolutionKey = (f: StreamQualityFormat): string => {
                            const height = Number(f.height || 0);
                            return height > 0 ? `height-${height}` : `original-${f.id}`;
                          };

                          const getVideoBitrate = (f: StreamQualityFormat): number => {
                            return Number(f.bitrate || 0);
                          };

                          const isHdrFormat = (f: StreamQualityFormat): boolean => {
                            return f.isHdr === true;
                          };


                          const getFormatFps = (f: StreamQualityFormat): number => {
                            return Number(f.fps || 0);
                          };

                          const sortTiersByQuality = (fmts: StreamQualityFormat[]): StreamQualityFormat[] => {
                            return [...fmts].sort((a, b) => {
                              // The General tab is a factual one-card-per-height view.
                              // Never prefer a container or parse the title to manufacture quality.
                              const hdrDiff = (isHdrFormat(b) ? 1 : 0) - (isHdrFormat(a) ? 1 : 0);
                              if (hdrDiff !== 0) return hdrDiff;

                              // 2. Higher FPS (60fps > 30fps)
                              const fpsDiff = getFormatFps(b) - getFormatFps(a);
                              if (fpsDiff !== 0) return fpsDiff;

                              // 3. Higher Bitrate
                              const brDiff = getVideoBitrate(b) - getVideoBitrate(a);
                              if (brDiff !== 0) return brDiff;

                              const streamableDiff = Number(b.isStreamable === true) - Number(a.isStreamable === true);
                              if (streamableDiff !== 0) return streamableDiff;
                              // 4. File size fallback only after measured stream metadata.
                              return (b.filesizeBytes || 0) - (a.filesizeBytes || 0);
                            });
                          };

                          // Group only by measured height. A generic direct link without dimensions
                          // remains "Original" instead of borrowing a resolution from its filename/title.
                          const resGroups = new Map<string, StreamQualityFormat[]>();
                          allVideoFmts.forEach((f) => {
                            const key = getFormatResolutionKey(f);
                            const existing = resGroups.get(key) || [];
                            existing.push(f);
                            resGroups.set(key, existing);
                          });

                          const curatedGeneralVideos: StreamQualityFormat[] = [];
                          resGroups.forEach((groupFmts) => {
                            const chosen = sortTiersByQuality(groupFmts)[0];
                            if (chosen) {
                              curatedGeneralVideos.push(chosen);
                            }
                          });

                          curatedGeneralVideos.sort(
                            (a, b) => (Number(b.height || 0) - Number(a.height || 0)) || getVideoBitrate(b) - getVideoBitrate(a)
                          );

                          const activeFmt = resolvedMedia.formats.find((f) => f.id === selectedFormatId) || resolvedMedia.formats[0];

                          const hasVideos = mp4VideoFmts.length > 0 || webmVideoFmts.length > 0;
                          const hasAudio = audioFmts.length > 0;
                          const hasRawMatrix = rawStreamsList.length > 0;
                          // Provider extractors expose an itag matrix, while
                          // public crawler results are ordinary verified
                          // formats. Both must get a complete Advanced tab.
                          const advancedFormatGroups = [
                            { key: 'mp4', label: t('drive.remote_matrix_group_mp4'), formats: resolvedMedia.formats.filter((f) => f.ext === 'mp4') },
                            { key: 'webm', label: t('drive.remote_matrix_group_webm'), formats: resolvedMedia.formats.filter((f) => f.ext === 'webm') },
                            { key: 'video', label: t('drive.remote_matrix_group_other_video'), formats: resolvedMedia.formats.filter((f) => f.isVideo && !['mp4', 'webm'].includes(f.ext)) },
                            { key: 'audio', label: t('drive.remote_matrix_group_audio'), formats: resolvedMedia.formats.filter((f) => f.isAudio || f.qualityTier === 'audio') },
                            { key: 'image', label: t('drive.remote_advanced_group_images'), formats: resolvedMedia.formats.filter((f) => f.isImage) },
                            { key: 'subtitle', label: t('drive.remote_advanced_group_subtitles'), formats: resolvedMedia.formats.filter((f) => f.isSubtitle || f.qualityTier === 'subtitle') },
                            { key: 'playlist', label: t('drive.remote_advanced_group_playlist'), formats: matrixHideM3u8 ? [] : resolvedMedia.formats.filter((f) => f.isAlbumPack || isManifestFormat(f)) },
                            { key: 'document', label: t('drive.remote_advanced_group_documents'), formats: resolvedMedia.formats.filter((f) => !f.isVideo && !f.isAudio && !f.isImage && !f.isSubtitle && !f.isAlbumPack && !['mp4', 'webm', 'm3u8', 'mpd'].includes(f.ext)) },
                          ].filter((group) => group.formats.length > 0);
                          const hasAdvancedFormats = advancedFormatGroups.length > 0;
                          const hasMultipleFilters = true;

                          const isGeneralTab = streamContainerFilter === 'general' || streamContainerFilter === 'all';
                          const isVideoTab = streamContainerFilter === 'video' || streamContainerFilter === 'mp4' || streamContainerFilter === 'webm';
                          const isAudioTab = streamContainerFilter === 'audio';
                          const isSubtitleTab = streamContainerFilter === 'subtitle';
                          const isAdvanceTab = streamContainerFilter === 'advance' || streamContainerFilter === 'matrix';

                          const isStreamHls = (s: RawStreamItem) => Boolean(/m3u8|mpd|dash|hls/i.test(`${s.protocol || ''} ${s.directUrl || ''}`));

                          const filteredRawStreams = rawStreamsList.filter((s) => {
                            if (matrixHideM3u8 && isStreamHls(s)) return false;
                            if (!matrixSearchQuery.trim()) return true;

                            const q = matrixSearchQuery.toLowerCase();
                            return (
                              String(s.itag).includes(q) ||
                              s.codec.toLowerCase().includes(q) ||
                              (s.qualityLabel && s.qualityLabel.toLowerCase().includes(q)) ||
                              s.mimeType.toLowerCase().includes(q) ||
                              s.type.toLowerCase().includes(q)
                            );
                          });

                          const renderFormatChip = (fmt: StreamQualityFormat) => {
                            const isSelected = selectedFormatId === fmt.id;
                            const isDownloadOnly = fmt.isDownloadable !== false && fmt.isStreamable === false;
                            const isHdr = fmt.isHdr === true;
                            const is60fps = Number(fmt.fps || 0) >= 50;
                            let displayBadge = getFormatDisplayBadge(fmt, t);

                            if (isHdr && displayBadge) {
                              displayBadge = displayBadge.replace(/^HDR\s*[•·-]?\s*/i, '').trim() || undefined;
                            }
                            if (is60fps && displayBadge) {
                              displayBadge = displayBadge.replace(/60FPS\s*[•·-]?\s*/i, '').trim() || undefined;
                            }
                            if (displayBadge && fmt.isVideo && fmt.ext) {
                              displayBadge = displayBadge.replace(new RegExp(`\\s+${fmt.ext}$`, 'i'), '').trim() || undefined;
                            }

                            return (
                              <button
                                key={fmt.id}
                                type="button"
                                className={`td-remote-quality-chip ${isSelected ? 'active' : ''} tier-${fmt.qualityTier} ${fmt.isAlbumPack ? 'album-pack' : ''}`}
                                onClick={() => handleToggleFormat(fmt)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handlePlayFormat(fmt);
                                }}
                                title={fmt.mux ? t('drive_tools.local_download_mux_hint') : isDownloadOnly
                                  ? t('drive_tools.remote_format_preview_unavailable')
                                  : isSelected
                                    ? t('drive.remote_unselect_card_tooltip')
                                    : t('drive.remote_stream_double_click_hint')}
                                disabled={submitting}
                              >
                                <div className="td-remote-quality-chip-top">
                                  <span className="td-remote-quality-chip-title">
                                    {getFormatDisplayLabel(fmt, resolvedMedia, t)}
                                  </span>
                                  <div className="td-remote-quality-chip-top-right">
                                    {fmt.filesizeBytes ? (
                                      <span className="td-remote-quality-chip-size">
                                        ~{formatDriveBytes(fmt.filesizeBytes)}
                                      </span>
                                    ) : null}
                                    {isSelected && <CheckCircle2 size={13} className="td-remote-chip-active-ico" />}
                                  </div>
                                </div>
                                <div className="td-remote-quality-chip-meta">
                                  <div className="td-remote-quality-chip-badges">
                                    {is60fps && (
                                      <span className="td-badge-pill fps-60">{t('drive.remote_badge_fps_60')}</span>
                                    )}
                                    {isHdr && (
                                      <span className="td-badge-pill hdr">{t('drive.remote_badge_hdr')}</span>
                                    )}
                                    {displayBadge && (
                                      <span className={`td-remote-quality-chip-badge ${getBadgeModifierClass(displayBadge)}`}>
                                        {displayBadge}
                                      </span>
                                    )}
                                    {isDownloadOnly && (
                                      <span className="td-remote-quality-chip-badge">
                                        {t('drive_tools.remote_format_download_only')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          };


                          return (
                            <div className="td-remote-formats-container">
                              {resolvedMedia.isPlaylist && (
                                <div className="td-remote-playlist-banner">
                                  <Layers size={13} />
                                  <span>{t('drive.remote_playlist_detected_banner')}</span>
                                </div>
                              )}

                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                                <label className="td-input-label" style={{ marginBottom: 0 }}>
                                  {t('drive.remote_split_select_format_hint')}
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <button
                                    type="button"
                                    className="td-remote-select-action-btn"
                                    onClick={() => {
                                      const bestVideo = curatedGeneralVideos[0] || mp4VideoFmts[0] || webmVideoFmts[0] || resolvedMedia.formats[0];
                                      if (bestVideo) {
                                        handleSelectFormat(bestVideo);
                                      }
                                    }}
                                    title={t('drive.remote_select_all_btn')}
                                  >
                                    <CheckSquare size={11} />
                                    <span>{t('drive.remote_select_all_btn')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`td-remote-select-action-btn ${!selectedFormatId ? 'active' : ''}`}
                                    onClick={() => {
                                      setSelectedFormatId('');
                                      setInspection((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              size: null,
                                            }
                                          : prev
                                      );
                                    }}
                                    title={t('drive.remote_unselect_all_btn')}
                                  >
                                    <Square size={11} />
                                    <span>{t('drive.remote_unselect_all_btn')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="td-remote-paste-action"
                                    onClick={() => probeUrl(url.trim(), passcode.trim(), true)}
                                    disabled={submitting || inspection?.status === 'inspecting'}
                                    title={t('drive.remote_batch_reinspect_btn')}
                                  >
                                    <RefreshCw size={10} className={inspection?.status === 'inspecting' ? 'spin' : ''} />
                                    <span>{t('drive.remote_batch_reinspect_btn')}</span>
                                  </button>
                                </div>
                              </div>

                              {hasMultipleFilters && (
                                <div className="td-remote-format-filter-bar">
                                  <button
                                    type="button"
                                    className={`td-remote-format-filter-chip ${isGeneralTab ? 'active' : ''}`}
                                    onClick={() => setStreamContainerFilter('general')}
                                  >
                                    <span>{t('drive.remote_format_filter_general')}</span>
                                    <span>({curatedGeneralVideos.length})</span>
                                  </button>
                                  {hasVideos && (
                                    <button
                                      type="button"
                                      className={`td-remote-format-filter-chip ${isVideoTab ? 'active' : ''}`}
                                      onClick={() => setStreamContainerFilter('video')}
                                    >
                                      <span>{t('drive.remote_format_filter_video_tab')}</span>
                                      <span>({mp4VideoFmts.length + webmVideoFmts.length})</span>
                                    </button>

                                  )}
                                  {hasAudio && (
                                    <button
                                      type="button"
                                      className={`td-remote-format-filter-chip ${isAudioTab ? 'active' : ''}`}
                                      onClick={() => setStreamContainerFilter('audio')}
                                    >
                                      <span>{t('drive.remote_format_filter_audio_tab')}</span>
                                      <span>({audioFmts.length})</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={`td-remote-format-filter-chip ${isSubtitleTab ? 'active' : ''}`}
                                    onClick={() => setStreamContainerFilter('subtitle')}
                                  >
                                    <span>{t('drive.remote_format_filter_subtitle')}</span>
                                    <span>({subtitleFmts.length})</span>
                                  </button>
                                  {hasAdvancedFormats && (
                                    <button
                                      type="button"
                                      className={`td-remote-format-filter-chip matrix-toggle ${isAdvanceTab ? 'active' : ''}`}
                                      onClick={() => setStreamContainerFilter('advance')}
                                    >
                                      <span>{t('drive.remote_format_filter_advance')}</span>
                                      <span>({hasRawMatrix ? rawStreamsList.length : resolvedMedia.formats.length})</span>
                                    </button>
                                  )}
                                </div>
                              )}

                              {isAdvanceTab ? (
                                hasRawMatrix ? (() => {
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
                                    const matchedFmt = resolvedMedia.formats.find((f) => (f.itag && f.itag === s.itag) || f.id === `raw_itag_${s.itag}`) || {
                                      id: `raw_itag_${s.itag}`,
                                      label: `${s.height ? t('drive.remote_format_height', { height: s.height }) : s.type === 'audio' ? t('drive.remote_format_filter_audio_tab') : s.codec} (itag ${s.itag})`,
                                      qualityTier: 'original' as const,
                                      resolution: s.height ? t('drive.remote_format_height', { height: s.height }) : undefined,
                                      ext: s.mimeType.includes('webm') || s.mimeType.includes('opus') ? 'webm' : (s.type === 'audio' ? 'm4a' : 'mp4'),
                                      filesizeBytes: s.filesizeBytes,
                                      directUrl: s.directUrl,
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
                                        onClick={() => handleToggleFormat(matchedFmt)}
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
                                          <span style={{ color: s.isHdr ? '#fbbf24' : '#38bdf8', fontWeight: 650 }}>

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
                                            disabled={s.isDownloadable === false && !s.directUrl}
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
                                          onClick={() => setMatrixHideM3u8((prev) => !prev)}
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
                                                        <Film size={12} style={{ color: '#38bdf8' }} />
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
                                                        <Film size={12} style={{ color: '#a855f7' }} />
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
                                                        <Music size={12} style={{ color: '#c084fc' }} />
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
                                })() : (
                                  <div className="td-remote-advanced-format-groups">
                                    {advancedFormatGroups.map((group) => (
                                      <div key={group.key} className="td-remote-formats-section">
                                        <div className="td-remote-formats-section-header is-general">
                                          <span className="td-remote-formats-section-title">
                                            <div className="td-remote-section-icon-box">
                                              {group.key === 'audio' ? <Music size={12} /> : group.key === 'subtitle' || group.key === 'document' ? <FileText size={12} /> : <Film size={12} />}
                                            </div>
                                            <span>{group.label}</span>
                                          </span>
                                          <span className="td-remote-formats-section-count">{group.formats.length}</span>
                                        </div>
                                        <div className="td-remote-quality-grid">
                                          {group.formats.map(renderFormatChip)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )
                              ) : isGeneralTab ? (
                                <>
                                  {curatedGeneralVideos.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header is-general">
                                        <span className="td-remote-formats-section-title">
                                          <div className="td-remote-section-icon-box">
                                            <Film size={12} />
                                          </div>
                                          <span>{t('drive.remote_section_video_streams')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{curatedGeneralVideos.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {curatedGeneralVideos.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}

                                </>
                              ) : isVideoTab ? (
                                <>
                                  {mp4VideoFmts.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header is-mp4">
                                        <span className="td-remote-formats-section-title">
                                          <div className="td-remote-section-icon-box">
                                            <Film size={12} />
                                          </div>
                                          <span>{t('drive.remote_section_mp4_video')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{mp4VideoFmts.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {mp4VideoFmts.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}

                                  {webmVideoFmts.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header is-webm">
                                        <span className="td-remote-formats-section-title">
                                          <div className="td-remote-section-icon-box">
                                            <Film size={12} />
                                          </div>
                                          <span>{t('drive.remote_section_webm_video')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{webmVideoFmts.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {webmVideoFmts.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : isAudioTab ? (
                                <>

                                  {audioFmts.length > 0 && (
                                    <div className="td-remote-formats-section">
                                      <div className="td-remote-formats-section-header is-audio">
                                        <span className="td-remote-formats-section-title">
                                          <div className="td-remote-section-icon-box">
                                            <Music size={12} />
                                          </div>
                                          <span>{t('drive.remote_section_audio_tracks')}</span>
                                        </span>
                                        <span className="td-remote-formats-section-count">{audioFmts.length}</span>
                                      </div>
                                      <div className="td-remote-quality-grid">
                                        {audioFmts.map(renderFormatChip)}
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : isSubtitleTab ? (
                                subtitleFmts.length > 0 ? (
                                  <div className="td-remote-formats-section">
                                    <div className="td-remote-formats-section-header is-subtitle">
                                      <span className="td-remote-formats-section-title">
                                        <div className="td-remote-section-icon-box">
                                          <FileText size={12} />
                                        </div>
                                        <span>{t('drive.remote_section_subtitles')}</span>
                                      </span>
                                      <span className="td-remote-formats-section-count">{filteredSubtitleFmts.length}</span>
                                    </div>

                                    <div className="td-remote-sub-info-banner">
                                      <Info size={13} style={{ color: '#2dd4bf', flexShrink: 0 }} />
                                      <span>{t('drive.remote_sub_info_banner')}</span>
                                    </div>

                                    <div className="td-remote-sub-filter-row">
                                      <button
                                        type="button"
                                        className={`td-remote-sub-pill ${subtitleTypeFilter === 'all' ? 'active' : ''}`}
                                        onClick={() => setSubtitleTypeFilter('all')}
                                      >
                                        {t('drive.remote_sub_filter_all')} ({subtitleFmts.length})
                                      </button>
                                      {hasIdSubs && (
                                        <button
                                          type="button"
                                          className={`td-remote-sub-pill ${subtitleTypeFilter === 'id' ? 'active' : ''}`}
                                          onClick={() => setSubtitleTypeFilter('id')}
                                        >
                                          {t('drive.remote_sub_filter_id')}
                                        </button>
                                      )}
                                      {hasEnSubs && (
                                        <button
                                          type="button"
                                          className={`td-remote-sub-pill ${subtitleTypeFilter === 'en' ? 'active' : ''}`}
                                          onClick={() => setSubtitleTypeFilter('en')}
                                        >
                                          {t('drive.remote_sub_filter_en')}
                                        </button>
                                      )}
                                      {hasManualSubs && hasAutoSubs && (
                                        <>
                                          <button
                                            type="button"
                                            className={`td-remote-sub-pill ${subtitleTypeFilter === 'manual' ? 'active' : ''}`}
                                            onClick={() => setSubtitleTypeFilter('manual')}
                                          >
                                            {t('drive.remote_sub_filter_manual')}
                                          </button>
                                          <button
                                            type="button"
                                            className={`td-remote-sub-pill ${subtitleTypeFilter === 'auto' ? 'active' : ''}`}
                                            onClick={() => setSubtitleTypeFilter('auto')}
                                          >
                                            {t('drive.remote_sub_filter_auto')}
                                          </button>
                                        </>
                                      )}
                                      {hasSrtSubs && (

                                        <button
                                          type="button"
                                          className={`td-remote-sub-pill ${subtitleTypeFilter === 'srt' ? 'active' : ''}`}
                                          onClick={() => setSubtitleTypeFilter('srt')}
                                        >
                                          {t('drive.remote_sub_filter_srt')}
                                        </button>
                                      )}
                                      {hasVttSubs && (
                                        <button
                                          type="button"
                                          className={`td-remote-sub-pill ${subtitleTypeFilter === 'vtt' ? 'active' : ''}`}
                                          onClick={() => setSubtitleTypeFilter('vtt')}
                                        >
                                          {t('drive.remote_sub_filter_vtt')}
                                        </button>
                                      )}
                                      {hasAssSubs && (
                                        <button
                                          type="button"
                                          className={`td-remote-sub-pill ${subtitleTypeFilter === 'ass' ? 'active' : ''}`}
                                          onClick={() => setSubtitleTypeFilter('ass')}
                                        >
                                          {t('drive.remote_sub_filter_ass')}
                                        </button>
                                      )}
                                    </div>

                                    <div className="td-remote-sub-search-box">
                                      <Search size={12} style={{ color: '#94a3b8' }} />
                                      <input
                                        type="text"
                                        value={subtitleSearchQuery}
                                        onChange={(e) => setSubtitleSearchQuery(e.target.value)}
                                        placeholder={t('drive.remote_sub_search_placeholder')}
                                      />
                                      {subtitleSearchQuery && (
                                        <button
                                          type="button"
                                          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                                          onClick={() => setSubtitleSearchQuery('')}
                                        >
                                          <X size={12} />
                                        </button>
                                      )}
                                    </div>
                                    {filteredSubtitleFmts.length === 0 ? (
                                      <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '0.72rem' }}>
                                        {t('drive.remote_sub_empty_search')}
                                      </div>
                                    ) : (
                                      <div className="td-remote-quality-grid">
                                        {filteredSubtitleFmts.map(renderFormatChip)}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="td-remote-empty-sub-card">
                                    <FileText size={28} style={{ color: '#64748b', opacity: 0.7, marginBottom: 8 }} />
                                    <h5 style={{ margin: '0 0 4px', fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>
                                      {t('drive.remote_sub_empty_title')}
                                    </h5>
                                    <p style={{ margin: 0, fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.45, maxWidth: '420px', textAlign: 'center' }}>
                                      {t('drive.remote_sub_empty_desc')}
                                    </p>
                                  </div>
                                )
                              ) : null}

                              {resolvedMedia.discovery && (
                                <div className="td-remote-sub-info-banner" style={{ marginTop: 12 }}>
                                  <Info size={13} style={{ color: '#38bdf8', flexShrink: 0 }} />
                                  <span>
                                    {resolvedMedia.discovery.complete
                                      ? t('drive.remote_discovery_complete')
                                      : t('drive.remote_discovery_pending', { count: resolvedMedia.discovery.pendingCount })}
                                  </span>
                                  {!resolvedMedia.discovery.complete && Boolean(resolvedMedia.discovery.cursor) && (
                                    <button
                                      type="button"

                                      className="td-btn-secondary"
                                      disabled={discoveryLoading}
                                      onClick={() => void handleLoadMoreDiscovery()}
                                      style={{ marginLeft: 'auto', minHeight: 32 }}
                                    >
                                      {discoveryLoading ? <Loader2 size={13} className="td-remote-inspecting-spinner" /> : <RefreshCw size={13} />}
                                      <span>{discoveryLoading ? t('drive.remote_discovery_loading_more') : t('drive.remote_discovery_load_more')}</span>
                                    </button>
                                  )}
                                </div>
                              )}

                              {activeFmt && (
                                <div className="td-remote-selected-spec-card">
                                  <div className="td-remote-selected-spec-left">
                                    <div className={`td-remote-selected-spec-icon-box ${activeFmt.isSubtitle ? 'is-sub' : activeFmt.isAudio ? 'is-audio' : 'is-video'}`}>
                                      {activeFmt.isSubtitle ? <FileText size={16} /> : activeFmt.isAudio ? <Music size={16} /> : <Film size={16} />}
                                    </div>
                                    <div className="td-remote-selected-spec-details">
                                      <div className="td-remote-selected-spec-title-row">
                                        <span className="td-remote-selected-spec-title">
                                          {getFormatDisplayLabel(activeFmt, resolvedMedia, t)}
                                        </span>
                                        {activeFmt.fps && activeFmt.fps > 30 && (
                                          <span className="td-remote-spec-pill fps">
                                            {t('drive.remote_badge_fps_val', { fps: activeFmt.fps })}
                                          </span>
                                        )}
                                        {activeFmt.isHdr === true && (
                                          <span className="td-remote-spec-pill hdr">{t('drive.remote_badge_hdr')}</span>
                                        )}
                                      </div>
                                      <div className="td-remote-selected-spec-meta">
                                        <span className="td-remote-spec-meta-item">
                                          {Number(activeFmt.height || 0) > 0
                                            ? t('drive.remote_format_height', { height: Math.round(Number(activeFmt.height)) })
                                            : activeFmt.isAudio && Number(activeFmt.audioBitrate || activeFmt.bitrate || 0) > 0
                                              ? t('drive.remote_format_bitrate_kbps', { value: Math.round(Number(activeFmt.audioBitrate || activeFmt.bitrate) / 1_000) })
                                              : t('drive.remote_quality_original')}
                                        </span>
                                        <span className="td-remote-spec-dot">•</span>
                                        <span className="td-remote-spec-meta-item ext">{activeFmt.ext ? `.${activeFmt.ext.toUpperCase()}` : '.MP4'}</span>
                                        {activeFmt.filesizeBytes ? (
                                          <>
                                            <span className="td-remote-spec-dot">•</span>
                                            <span className="td-remote-spec-meta-item size">~{formatDriveBytes(activeFmt.filesizeBytes)}</span>
                                          </>
                                        ) : null}
                                        {resolvedMedia.chapters && resolvedMedia.chapters.length > 0 ? (
                                          <>
                                            <span className="td-remote-spec-dot">•</span>
                                            <span className="td-remote-spec-meta-item chapters">
                                              {t('drive.remote_chapters_count', { count: resolvedMedia.chapters.length })}
                                            </span>
                                          </>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="td-remote-selected-spec-right">
                                    {activeFmt.directUrl && (
                                      <button
                                        type="button"
                                        className={`td-remote-spec-copy-btn ${copiedStreamUrl ? 'copied' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard?.writeText(activeFmt.directUrl);
                                          setCopiedStreamUrl(true);
                                          setTimeout(() => setCopiedStreamUrl(false), 2000);
                                        }}
                                        title={t('drive.remote_spec_copy_url_btn')}
                                      >
                                        {copiedStreamUrl ? <Check size={12} className="copy-icon" /> : <Copy size={12} className="copy-icon" />}
                                        <span>{copiedStreamUrl ? t('drive.remote_spec_url_copied') : t('drive.remote_spec_copy_url_btn')}</span>
                                      </button>
                                    )}
                                    <div className="td-remote-stream-status-pill">
                                      <span className="td-remote-status-glow-dot" />
                                      <Zap size={11} className="td-remote-status-icon" />
                                      <span>{activeFmt.isStreamable ? t('drive.remote_spec_direct_ready') : t('drive_tools.remote_format_download_only')}</span>

                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="td-remote-empty-sub-card">
                          <FileText size={28} style={{ color: '#64748b', opacity: 0.7, marginBottom: 8 }} />
                          <h5 style={{ margin: '0 0 4px', fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>
                            {t('drive.remote_discovery_blocked')}
                          </h5>
                          <p style={{ margin: 0, fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.45, maxWidth: '420px', textAlign: 'center' }}>
                            {resolvedMedia.description || t('drive.remote_native_interaction_required')}
                          </p>
                          {Boolean(resolvedMedia.discovery?.cursor) && !(resolvedMedia.discovery?.complete ?? true) && (
                            <button
                              type="button"
                              className="td-btn-secondary"
                              disabled={discoveryLoading}
                              onClick={() => void handleLoadMoreDiscovery()}
                              style={{ marginTop: 12, minHeight: 36 }}
                            >
                              {discoveryLoading ? <Loader2 size={13} className="td-remote-inspecting-spinner" /> : <RefreshCw size={13} />}
                              <span>{discoveryLoading ? t('drive.remote_discovery_loading_more') : t('drive.remote_discovery_load_more')}</span>
                            </button>
                          )}
                          {detectTauriRuntime() && (
                            <>
                              <button
                                type="button"
                                className="td-btn-secondary"
                                onClick={() => void handleOpenAssistedInspector()}
                                style={{ marginTop: 10, minHeight: 36 }}
                              >
                                <ExternalLink size={13} />
                                <span>{t('drive.remote_assisted_open')}</span>
                              </button>
                              <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: '#64748b', maxWidth: '420px', textAlign: 'center' }}>
                                {t('drive.remote_assisted_hint')}
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : inspection?.status === 'inspecting' ? (
                <div className="td-remote-preview-inspecting-card">
                  <Loader2 size={32} className="td-remote-inspecting-spinner" />
                  <div className="td-remote-inspecting-title">{t('drive.remote_inspecting')}</div>
                  <div className="td-remote-inspecting-subtitle">{t('drive.remote_split_inspecting_desc')}</div>
                </div>
              ) : inspection && url.trim() ? (
                <div className="td-remote-preview-content">
                  <div className={`td-remote-inspector-card kind-${inspection.kind}`}>
                    <div className="td-remote-inspector-icon">
                      {fileKindIcon(inspection.kind)}
                    </div>
                    <div className="td-remote-inspector-info">
                      <div className="td-remote-inspector-name" title={inspection.filename}>
                        {inspection.filename}
                      </div>
                      <div className="td-remote-inspector-meta">
                        {inspection.size ? (
                          <span className="td-remote-meta-badge size">
                            {formatDriveBytes(inspection.size)}
                          </span>
                        ) : (
                          <span className="td-remote-meta-badge stream">
                            {t('drive.remote_inspect_size_unknown')}
                          </span>
                        )}
                        <span className={`td-remote-meta-badge status ${inspection.status}`}>
                          {inspection.status === 'valid' ? (
                            <>
                              <CheckCircle2 size={11} />
                              <span>{t('drive.remote_inspect_valid')}</span>

                            </>
                          ) : (
                            <>
                              <Sparkles size={11} />
                              <span>{t('drive.remote_inspect_direct_stream')}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>

  );
}
