// Transitional extraction boundary; see RemoteUploadSinglePanel for the
// shared-context migration note.
// @ts-nocheck
import { Loader2, XCircle, Folder, Copy, ExternalLink, Check, Trash2, ChevronDown, ChevronUp, Search, Info, Clipboard, SlidersHorizontal, LayoutGrid, RefreshCw, RotateCcw, FileText, Film, Clock, Square, Layers, Pencil, CheckSquare, X } from 'lucide-react';
import { BatchMediaCard } from '../../../features/remote-upload/BatchMediaCard';
import { formatMediaDuration, type BatchQualityPreference } from '../../../features/remote-upload/domain';

export function RemoteUploadBatchPanel({ ctx }: { ctx: Record<string, any> }) {
  const { t,showSupportedInfo,setShowSupportedInfo,handlePasteClipboard,submitting,errorMsg,setErrorMsg,setIsEditingBatchText,batchGroups,isEditingBatchText,batchSearchQuery,setBatchSearchQuery,batchFilterType,setBatchFilterType,selectedBatchItemIds,collapsedGroupIds,copiedUrlGroupId,setCopiedUrlGroupId,batchItemDurations,batchQualityPreference,setBatchQualityPreference,focusedBatchItem,handleToggleBatchItem,handleBatchCardClick,handleBatchCardDoubleClick,handleToggleBatchGroup,handleToggleAllBatchItems,handleToggleGroupCollapse,handleRetryBatchGroup,handleRemoveBatchGroup,handleOpenInBrowser,handleInspectBatchUrls,batchUrlsText,setBatchUrlsText,batchUrls,batchInspecting,batchInspectProgress,infoRef,renderSupportedLinksPopover,renderTripletAndDestinationControls,selectedBatchItems,allBatchItems,batchPlayableUrl,captureVideoCanvasThumbnail,setBatchGroups,setBatchItemDurations,formatDriveBytes} = ctx;
  return (
    <>
      {
            /* BATCH TAB */
            batchGroups.length === 0 || isEditingBatchText ? (
              <div className="td-remote-form-card">
                <div className="td-remote-field-group">
                  <div className="td-remote-label-row">
                    <div className="td-remote-label-left" ref={infoRef}>
                      <label className="td-input-label" htmlFor="td-remote-batch-input">
                        {t('drive.remote_tab_batch')}
                      </label>
                      <button
                        type="button"
                        className={`td-remote-info-trigger ${showSupportedInfo ? 'active' : ''}`}
                        onClick={() => setShowSupportedInfo((prev) => !prev)}
                        title={t('drive.remote_info_btn_aria')}
                        aria-label={t('drive.remote_info_btn_aria')}
                        aria-expanded={showSupportedInfo}
                      >
                        <Info size={12} />
                      </button>
                      {renderSupportedLinksPopover()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="td-remote-paste-action"
                        onClick={handlePasteClipboard}
                        disabled={submitting || batchInspecting}
                        title={t('drive.remote_paste_clipboard')}
                      >
                        <Clipboard size={12} />
                        <span>{t('drive.remote_paste_clipboard')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="td-remote-batch-quality-bar">
                    <div className="td-remote-batch-quality-label">
                      <SlidersHorizontal size={13} style={{ color: '#38bdf8' }} />
                      <span>{t('drive.remote_batch_quality_label')}</span>
                    </div>
                    <div className="td-remote-batch-quality-select-wrap">
                      <select
                        className="td-remote-batch-quality-select"
                        value={batchQualityPreference}
                        onChange={(e) => setBatchQualityPreference(e.target.value as BatchQualityPreference)}
                        disabled={submitting || batchInspecting}
                      >
                        <option value="best">{t('drive.remote_batch_quality_best')}</option>
                        <option value="1080p">{t('drive.remote_batch_quality_1080p')}</option>
                        <option value="720p">{t('drive.remote_batch_quality_720p')}</option>
                        <option value="audio">{t('drive.remote_batch_quality_audio')}</option>
                      </select>
                    </div>
                  </div>
                  <textarea
                    id="td-remote-batch-input"
                    className="td-input-field td-remote-batch-textarea"
                    rows={6}
                    placeholder={t('drive.remote_batch_placeholder')}
                    value={batchUrlsText}
                    onChange={(e) => {
                      setBatchUrlsText(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    disabled={submitting || batchInspecting}
                    spellCheck={false}
                  />
                  <div className="td-remote-batch-footer">
                    <span className="td-remote-batch-hint">
                      {batchUrls.length > 0
                        ? t('drive.remote_batch_count', { count: batchUrls.length })
                        : t('drive.remote_batch_empty_hint')}
                    </span>
                    <div className="td-remote-batch-footer-actions">
                      {batchGroups.length > 0 && (
                        <button
                          type="button"
                          className="td-btn-secondary td-remote-return-preview-btn"
                          onClick={() => setIsEditingBatchText(false)}
                          disabled={submitting || batchInspecting}
                          title={t('drive.remote_batch_view_preview_btn')}
                        >
                          <LayoutGrid size={13} />
                          <span>{t('drive.remote_batch_view_preview_btn')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="td-btn-primary td-remote-inspect-action-btn"
                        onClick={handleInspectBatchUrls}
                        disabled={batchUrls.length === 0 || batchInspecting || submitting}
                      >
                        {batchInspecting ? (
                          <>
                            <Loader2 size={13} className="spin" />
                            <span>
                              {t('drive.remote_batch_inspecting_status', {
                                current: batchInspectProgress.current,
                                total: batchInspectProgress.total,
                              })}
                            </span>
                          </>
                        ) : batchGroups.length > 0 ? (
                          <>
                            <RefreshCw size={13} />
                            <span>{t('drive.remote_batch_reinspect_all_btn')}</span>
                          </>
                        ) : (
                          <>
                            <Search size={13} />
                            <span>{t('drive.remote_batch_inspect_btn')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Delivery Format, Transfer Engine & Storage Policy Triplet Row in Batch tab */}
                {renderTripletAndDestinationControls(true)}
              </div>
            ) : (
              /* BATCH RESOLVED GALLERY & SPLIT PREVIEW */
              <div className="td-remote-stream-split-wrap is-batch-studio">
                {/* LEFT PANEL: FOCUSED MEDIA PREVIEW */}
                <div className="td-remote-stream-player-col">
                  <div className="td-remote-big-canvas-wrap">
                    {focusedBatchItem ? (
                      focusedBatchItem.isVideo && batchPlayableUrl ? (
                        <div className="td-remote-big-canvas-inner td-remote-single-player-canvas">
                          <video
                            key={batchPlayableUrl}
                            src={batchPlayableUrl}
                            poster={focusedBatchItem.thumbnailUrl}
                            controls
                            preload="metadata"
                            playsInline
                            className="td-remote-big-canvas-video td-remote-active-player-video"
                            crossOrigin="anonymous"
                            onLoadedData={(e) => {
                              const v = e.currentTarget;
                              if (focusedBatchItem && !focusedBatchItem.thumbnailUrl) {
                                const thumb = captureVideoCanvasThumbnail(v);
                                if (thumb) {
                                  setBatchGroups((prev) =>
                                    prev.map((grp) => ({
                                      ...grp,
                                      items: grp.items.map((it) => (it.id === focusedBatchItem.id ? { ...it, thumbnailUrl: thumb } : it)),
                                    }))
                                  );
                                }
                              }
                            }}
                            onLoadedMetadata={(e) => {
                              const v = e.currentTarget;
                              const dur = v.duration;
                              if (dur && isFinite(dur) && dur > 0 && focusedBatchItem) {
                                const d = Math.round(dur);
                                setBatchItemDurations((prev) => ({ ...prev, [focusedBatchItem.id]: d }));
                              }
                              if (focusedBatchItem && !focusedBatchItem.thumbnailUrl) {
                                const thumb = captureVideoCanvasThumbnail(v);
                                if (thumb) {
                                  setBatchGroups((prev) =>
                                    prev.map((grp) => ({
                                      ...grp,
                                      items: grp.items.map((it) => (it.id === focusedBatchItem.id ? { ...it, thumbnailUrl: thumb } : it)),
                                    }))
                                  );
                                }
                              }
                            }}
                          />
                        </div>
                      ) : focusedBatchItem.isVideo ? (
                        <div className="td-remote-big-canvas-fallback">
                          <FileText size={36} className="td-remote-fallback-icon" />
                          <span>{t('drive_tools.remote_format_preview_unavailable')}</span>
                        </div>
                      ) : focusedBatchItem.kind === 'photo' ? (
                        <div className="td-remote-big-canvas-inner">
                          <img
                            src={focusedBatchItem.directUrl || focusedBatchItem.thumbnailUrl}
                            alt={focusedBatchItem.title}
                            className="td-remote-big-canvas-img"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="td-remote-big-canvas-fallback">
                          <FileText size={36} className="td-remote-fallback-icon" />
                          <span>{focusedBatchItem.filename}</span>
                        </div>
                      )
                    ) : (
                      <div className="td-remote-big-canvas-fallback">
                        <Film size={36} className="td-remote-fallback-icon" />
                        <span>{t('drive.remote_split_ready_desc')}</span>
                      </div>
                    )}
                  </div>

                  {/* Active Item Details Bar */}
                  {focusedBatchItem && (
                    <div className="td-remote-stream-filename-bar">
                      <div className="td-remote-filename-display-view">
                        <div className="td-remote-filename-display-main" title={focusedBatchItem.filename}>
                          <span className="td-remote-filename-display-base">
                            {focusedBatchItem.filename.replace(/\.[a-zA-Z0-9]+$/, '')}
                          </span>
                          <span className="td-remote-filename-display-ext">
                            {focusedBatchItem.filename.match(/\.[a-zA-Z0-9]+$/)?.[0] || ''}
                          </span>
                        </div>
                        <div className="td-remote-stream-meta-ribbon">
                          {focusedBatchItem.qualityBadge && (
                            <span className="td-remote-stream-ribbon-badge">
                              {focusedBatchItem.qualityBadge}
                            </span>
                          )}
                          {focusedBatchItem.filesizeBytes ? (
                            <span className="td-remote-meta-size" style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600 }}>
                              ~{formatDriveBytes(focusedBatchItem.filesizeBytes)}
                            </span>
                          ) : null}
                          {(batchItemDurations[focusedBatchItem.id] || focusedBatchItem.durationSec) ? (
                            <span className="td-remote-item-duration-badge" style={{ fontSize: '0.65rem' }}>
                              <Clock size={10} />
                              <span>{formatMediaDuration(batchItemDurations[focusedBatchItem.id] || focusedBatchItem.durationSec)}</span>
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={`td-remote-quick-select-toggle ${selectedBatchItemIds.has(focusedBatchItem.id) ? 'active' : ''}`}
                            onClick={() => handleToggleBatchItem(focusedBatchItem.id)}
                          >
                            {selectedBatchItemIds.has(focusedBatchItem.id) ? (
                              <>
                                <Check size={11} strokeWidth={3} />
                                <span>{t('drive.preflight_include_item')}</span>
                              </>
                            ) : (
                              <>
                                <Square size={11} />
                                <span>{t('drive.preflight_skip_item')}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT PANEL: GROUPED CARDS & ACTIONS */}
                <div className="td-remote-stream-gallery-col">
                  {/* Header: Total summary & Action buttons */}
                  <div className="td-remote-gallery-header-row">
                    <div className="td-batch-header-title-group">
                      <div className="td-batch-header-icon-box">
                        <Layers size={13} />
                      </div>
                      <span className="td-batch-header-title-text">
                        {t('drive.remote_batch_all_groups_ready', { count: batchGroups.length })}
                      </span>
                      {allBatchItems.length > 0 && (
                        <div className="td-batch-header-stat-pill">
                          <span className="td-batch-stat-count">
                            {t('drive.remote_batch_item_count', { count: allBatchItems.length })}
                          </span>
                          <span className="td-batch-stat-sep">•</span>
                          <span className="td-batch-stat-size">
                            ~{formatDriveBytes(allBatchItems.reduce((acc, it) => acc + (it.filesizeBytes || 0), 0))}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="td-batch-header-actions-group">
                      <button
                        type="button"
                        className="td-batch-action-pill"
                        onClick={() => setIsEditingBatchText(true)}
                        title={t('drive.remote_batch_edit_urls')}
                      >
                        <Pencil size={11} />
                        <span>{t('drive.remote_batch_edit_urls')}</span>
                      </button>
                      <button
                        type="button"
                        className="td-batch-action-pill"
                        onClick={handleInspectBatchUrls}
                        disabled={batchInspecting}
                        title={t('drive.remote_batch_reinspect_btn')}
                      >
                        <RefreshCw size={11} className={batchInspecting ? 'spin' : ''} />
                        <span>{t('drive.remote_batch_reinspect_btn')}</span>
                      </button>

                      <div className="td-batch-actions-separator" />

                      <div className="td-batch-selection-segmented">
                        <button
                          type="button"
                          className="td-batch-seg-btn select-all"
                          onClick={() => handleToggleAllBatchItems(true)}
                          title={t('drive_tools.remote_gallery_select_all')}
                        >
                          <CheckSquare size={11} />
                          <span>{t('drive_tools.remote_gallery_select_all')}</span>
                        </button>
                        <button
                          type="button"
                          className="td-batch-seg-btn deselect-all"
                          onClick={() => handleToggleAllBatchItems(false)}
                          title={t('drive_tools.remote_gallery_deselect_all')}
                        >
                          <Square size={11} />
                          <span>{t('drive_tools.remote_gallery_deselect_all')}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Toolbar: Search input + Filter Chips */}
                  <div className="td-remote-gallery-toolbar">
                    <div className="td-remote-gallery-toolbar-left">
                      <div className="td-remote-gallery-search-wrap">
                        <Search size={11} className="td-remote-gallery-search-icon" />
                        <input
                          type="text"
                          className="td-remote-gallery-search-input"
                          placeholder={t('drive_tools.remote_gallery_search_placeholder', { count: allBatchItems.length })}
                          value={batchSearchQuery}
                          onChange={(e) => setBatchSearchQuery(e.target.value)}
                        />
                        {batchSearchQuery && (
                          <button
                            type="button"
                            className="td-remote-gallery-search-clear"
                            onClick={() => setBatchSearchQuery('')}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>

                      <div className="td-remote-gallery-filters">
                        <button
                          type="button"
                          className={`td-remote-filter-chip ${batchFilterType === 'all' ? 'active' : ''}`}
                          onClick={() => setBatchFilterType('all')}
                        >
                          {t('drive.remote_batch_filter_all')} ({allBatchItems.length})
                        </button>
                        {allBatchItems.some((i) => i.isVideo) && (
                          <button
                            type="button"
                            className={`td-remote-filter-chip ${batchFilterType === 'video' ? 'active' : ''}`}
                            onClick={() => setBatchFilterType('video')}
                          >
                            {t('drive.remote_batch_filter_video')} ({allBatchItems.filter((i) => i.isVideo).length})
                          </button>
                        )}
                        {allBatchItems.some((i) => i.kind === 'photo') && (
                          <button
                            type="button"
                            className={`td-remote-filter-chip ${batchFilterType === 'photo' ? 'active' : ''}`}
                            onClick={() => setBatchFilterType('photo')}
                          >
                            {t('drive.remote_batch_filter_photo')} ({allBatchItems.filter((i) => i.kind === 'photo').length})
                          </button>
                        )}
                        <button
                          type="button"
                          className={`td-remote-filter-chip ${batchFilterType === 'selected' ? 'active' : ''}`}
                          onClick={() => setBatchFilterType('selected')}
                        >
                          {t('drive.remote_batch_filter_selected')} ({selectedBatchItems.length})
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* GROUPS ACCORDION LIST */}
                  <div className="td-remote-batch-groups-list">
                    {batchGroups.map((group) => {
                      const groupFilteredItems = group.items.filter((it) => {
                        if (batchSearchQuery.trim()) {
                          const q = batchSearchQuery.trim().toLowerCase();
                          const matchName = it.filename.toLowerCase().includes(q);
                          const matchTitle = it.title ? it.title.toLowerCase().includes(q) : false;
                          if (!matchName && !matchTitle) return false;
                        }
                        if (batchFilterType === 'video') return it.isVideo;
                        if (batchFilterType === 'photo') return it.kind === 'photo';
                        if (batchFilterType === 'selected') return selectedBatchItemIds.has(it.id);
                        return true;
                      });
                      const allGroupSelected = group.items.length > 0 && group.items.every((it) => selectedBatchItemIds.has(it.id));
                      const someGroupSelected = group.items.some((it) => selectedBatchItemIds.has(it.id));
                      const groupTotalBytes = group.items.reduce((acc, it) => acc + (it.filesizeBytes || 0), 0);

                      const isCollapsed = collapsedGroupIds.has(group.id);

                      return (
                        <div
                          className={`td-remote-batch-group ${isCollapsed ? 'is-collapsed' : ''}`}
                          key={group.id}
                        >
                          <div className="td-remote-batch-group-head" onClick={() => handleToggleGroupCollapse(group.id)}>
                            <div className="td-remote-batch-group-head-left">
                              <span className="td-remote-batch-group-ico-wrap">
                                {group.status === 'resolving' ? (
                                  <Loader2 size={13} className="spin td-remote-batch-spinner" />
                                ) : group.status === 'error' ? (
                                  <XCircle size={13} className="td-remote-batch-err-ico" />
                                ) : (
                                  <Folder size={13} className="td-remote-batch-folder-ico" />
                                )}
                              </span>

                              <div className="td-remote-batch-group-info-col">
                                <div className="td-remote-batch-group-title-row">
                                  <span className="td-remote-batch-group-title" title={group.title}>
                                    {group.title}
                                  </span>
                                  {group.status === 'success' && (
                                    <span className="td-remote-batch-group-badge">
                                      {t('drive.remote_batch_item_count', { count: group.items.length })}{groupTotalBytes > 0 ? ` · ~${formatDriveBytes(groupTotalBytes)}` : ''}
                                    </span>
                                  )}
                                </div>

                                <div className="td-remote-batch-group-url-row">
                                  <span
                                    className="td-remote-batch-group-url"
                                    title={group.sourceUrl}
                                    onClick={(e) => {
                                      if (window.getSelection()?.toString().length) {
                                        e.stopPropagation();
                                      }
                                    }}
                                  >
                                    {group.sourceUrl}
                                  </span>
                                  <button
                                    type="button"
                                    className={`td-remote-batch-copy-url-btn ${copiedUrlGroupId === group.id ? 'is-copied' : ''}`}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await navigator.clipboard.writeText(group.sourceUrl);
                                        setCopiedUrlGroupId(group.id);
                                        setTimeout(() => setCopiedUrlGroupId(null), 1800);
                                      } catch (_) {}
                                    }}
                                    title={copiedUrlGroupId === group.id ? t('drive.remote_copied') : t('drive.remote_copy_link')}
                                    aria-label={copiedUrlGroupId === group.id ? t('drive.remote_copied') : t('drive.remote_copy_link')}
                                  >
                                    {copiedUrlGroupId === group.id ? (
                                      <Check size={9.5} className="text-emerald-400" />
                                    ) : (
                                      <Copy size={9.5} />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="td-remote-batch-open-url-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenInBrowser(group.sourceUrl);
                                    }}
                                    title={t('drive.remote_open_in_browser')}
                                    aria-label={t('drive.remote_open_in_browser')}
                                  >
                                    <ExternalLink size={9.5} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="td-remote-batch-group-head-right">
                              {group.status === 'success' && (
                                <button
                                  type="button"
                                  className={`td-remote-batch-group-select-btn ${allGroupSelected ? 'is-all-selected' : someGroupSelected ? 'is-partial-selected' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleBatchGroup(group.id, !allGroupSelected);
                                  }}
                                >
                                  {allGroupSelected ? (
                                    <>
                                      <CheckSquare size={11} />
                                      <span>{t('drive.remote_batch_group_deselect_all')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Square size={11} />
                                      <span>{t('drive.remote_batch_group_select_all')}</span>
                                    </>
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                className="td-remote-batch-group-collapse-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleGroupCollapse(group.id);
                                }}
                                aria-label={isCollapsed ? t('drive.remote_batch_expand_group') : t('drive.remote_batch_collapse_group')}
                              >
                                {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                              </button>
                            </div>
                          </div>

                          {!isCollapsed && (
                            <div className="td-remote-batch-group-body">
                              {group.status === 'resolving' ? (
                                <div className="td-remote-batch-resolving-row">
                                  <Loader2 size={16} className="spin" />
                                  <span>{t('drive.remote_inspecting')}</span>
                                </div>
                              ) : group.status === 'error' ? (
                                <div className="td-remote-batch-error-card">
                                  <div className="td-remote-batch-error-msg">
                                    {group.errorMessage || t('drive.remote_batch_error_title')}
                                  </div>
                                  <div className="td-remote-batch-error-actions">
                                    <button
                                      type="button"
                                      className="td-remote-batch-retry-btn"
                                      onClick={() => handleRetryBatchGroup(group.id)}
                                    >
                                      <RotateCcw size={12} />
                                      <span>{t('drive.remote_batch_retry_link')}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="td-remote-batch-remove-btn"
                                      onClick={() => handleRemoveBatchGroup(group.id)}
                                    >
                                      <Trash2 size={12} />
                                      <span>{t('drive.remote_batch_remove_link')}</span>
                                    </button>
                                  </div>
                                </div>
                              ) : groupFilteredItems.length === 0 ? (
                                <div className="td-remote-batch-no-items">
                                  {t('drive_tools.no_media_found')}
                                </div>
                              ) : (
                                <div className="td-remote-gallery-grid-wrap view-grid">
                                  {groupFilteredItems.map((item) => (
                                    <BatchMediaCard
                                      key={item.id}
                                      item={item}
                                      isSelected={selectedBatchItemIds.has(item.id)}
                                      isFocused={focusedBatchItem?.id === item.id}
                                      itemDur={batchItemDurations[item.id] || item.durationSec}
                                      onCardClick={handleBatchCardClick}
                                      onCardDoubleClick={handleBatchCardDoubleClick}
                                      onToggleItem={handleToggleBatchItem}
                                      t={t}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )
      }
    </>
  );
}
