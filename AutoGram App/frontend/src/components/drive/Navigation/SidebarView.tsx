// Transitional extraction boundary for the sidebar view. Its parent still
// owns the virtual-row contract; keep runtime behavior intact while the
// shared row type is consolidated.
// @ts-nocheck
import { createPortal } from 'react-dom';
import {
  FolderPlus, Folder, RefreshCw, Home, HardDrive, MessageSquare, Users, Hash, Bot,
  Search, ArrowLeft, ChevronDown, ChevronRight, X, Clock, Pin, Filter, Sparkles, User,
  Radio, MessagesSquare, Check, LogIn, Zap,
} from 'lucide-react';
import { MediaSelect } from './MediaSelect';

type SidebarViewProps = { ctx: Record<string, any> };

export function SidebarView({ ctx }: SidebarViewProps) {
  const {
    t, folders, chats, chatFolders, activeChatFolderId, onSelectChatFolder, activePeerId,
    locationKind, onSelectSaved, onSelectDrive, onSelectChat, onCreate,
    loadingFolders, loadingChats, session, sessions, onSessionChange, statusText, connected,
    collapsed, onToggleCollapse, onChatQuery, drawerOpen, onCloseDrawer,
    chatsHasMore, chatsLoadingMore, onLoadMoreChats, onExitToApp, onOpenRelogModal,
    mediaDragActive, creds, onSelectRecent, pins, onSelectPin, onLocationContextMenu, channelLimitWarning,
    pingState, onNavigatePath, isCompactSearchActive, setIsCompactSearchActive, getPingTooltip,
    layoutModel, activeTab, setActiveTab, manualSpin, handleRefreshClick,
    scheduleChatFolderSwitch, cancelChatFolderSwitch, navRef, sidebarRef,
    chatListRef, folderStackRef,
    isSelf, chatIndex, locationQuery, hasLocationQuery, parsedPath, isPathIdMode,
    resolvedPathInfo, pathSteps, chatRows, folderRows, rootDriveCount, matchingRootDriveCount,
    treeExpanded, folderTreeRows, displayFolderTreeRows, typeFilterMenuRef, typeFilterButtonRef,
    chatFoldersScrollerRef, activeChatTypeLabel, toggleTypeFilterMenu, filteredByTypeChats,
    toggleTreeFolder, createIsSubfolder, activeDriveFolder, showSaved, filteredRecents,
    matchingRecents, busy, foldersExpanded, chatsExpanded, openFoldersSection,
    openChatsSection, toggleFolders, toggleChats, chatVirtualizer, virtualItems, vStart, vEnd,
    overKey, dragLive, folderDragLive, anyDragLive, acceptDrop, handleHover, handleDropKey,
    registerLabel, go, locationSearchRef, isCollapseAllowed, effectiveCollapsed,
    chatFoldersScrolled, setChatFoldersScrolled, chatTypeFilter, setChatTypeFilter,
    typeFilterMenuOpen, setTypeFilterMenuOpen, typeFilterMenuPosition,
    DRIVE_FOLDER_SOFT_LIMIT, driveItemKind, describePath, chatFolderDropKey,
    applyDropEffect, recentDisplayLabel, getDriveSessionError,
    isDriveSessionCircuitTripped, resetDriveSessionCircuit, getSessionDisplayName,
    telegramFolderColor, formatRelativeAccessTime, dropKey,
    isInternalMediaDragActive, isFolderReparentDragActive,
    DropRow, PeerAvatar, ChatIcon,
  } = ctx;

  return (
    <aside
      ref={sidebarRef as React.RefObject<HTMLElement>}
      className={`td-sidebar ${effectiveCollapsed ? 'is-collapsed' : ''} ${drawerOpen ? 'is-drawer-open' : ''} ${anyDragLive ? 'media-dnd' : ''}`}
      aria-label={t('ui.generated.drive_locations_e6fade5')}
      data-collapsed={effectiveCollapsed ? 'true' : 'false'}
    >
      {/* Expand/collapse first (top) — users expect this control at the top of the rail */}
      <div className="td-rail-head">
        {onExitToApp && (
          <button
            type="button"
            className="td-rail-btn td-rail-back td-rail-back-btn"
            onClick={() => {
              onExitToApp();
              onCloseDrawer?.();
            }}
            title={t("drive.sidebar_back_to_app")}
            aria-label={t("drive.sidebar_back_to_app")}
          >
            <ArrowLeft size={18} />
          </button>
        )}

        <button
          type="button"
          className="td-rail-brand td-rail-brand-toggle"
          onClick={() => {
            if (!isCollapseAllowed) {
              onCloseDrawer?.();
            } else {
              onToggleCollapse?.();
            }
          }}
          title={
            isCollapseAllowed
              ? (effectiveCollapsed ? t('drive.sidebar_expand_tooltip') : t('drive.sidebar_collapse_tooltip'))
              : t('drive.sidebar_close_tooltip')
          }
          aria-expanded={isCollapseAllowed ? !effectiveCollapsed : undefined}
          aria-label={
            isCollapseAllowed
              ? (effectiveCollapsed ? t('drive.sidebar_expand_tooltip') : t('drive.sidebar_collapse_tooltip'))
              : t('drive.sidebar_close_tooltip')
          }
        >
          <div className="td-sidebar-logo">
            <HardDrive size={20} />
            {effectiveCollapsed && (
              <span
                className={`td-sidebar-logo-dot td-rail-conn-dot ${pingState?.status || (connected ? 'excellent' : 'disconnected')} pulse`}
                title={getPingTooltip()}
              />
            )}
          </div>
          <div className="td-sidebar-brand-text">
            <strong>{t('drive.header_drive_title')}</strong>
            <span>{t('drive.header_drive_subtitle')}</span>
          </div>
        </button>
      </div>

      <div className="td-sidebar-session td-only-expanded">
        <div className="td-session-header-row">
          <div className="td-session-header-left">
            <label className="td-label">{t("drive.session_header")}</label>
            <button
              type="button"
              className={`td-session-refresh-btn${busy || manualSpin ? ' is-refreshing' : ''}`}
              title={t("drive.sidebar_refresh_all")}
              aria-label={t("drive.sidebar_refresh_tooltip")}
              onClick={handleRefreshClick}
              disabled={busy}
            >
              <RefreshCw size={12} className={busy || manualSpin ? 'spin' : ''} aria-hidden />
            </button>
          </div>
          <div
            className={`td-conn-indicator status-${pingState?.status || (connected ? 'excellent' : 'disconnected')}`}
            title={
              pingState?.status === 'offline'
                ? t('drive.ping_offline')
                : pingState?.status === 'disconnected'
                ? t('drive.ping_disconnected')
                : pingState?.status === 'transferring'
                ? t('drive.ping_transferring')
                : pingState?.status === 'excellent'
                ? `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_excellent')}`
                : pingState?.status === 'good'
                ? `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_good')}`
                : pingState?.status === 'fair'
                ? `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_fair')}`
                : pingState?.status === 'poor'
                ? `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_poor')}`
                : connected
                ? t('drive.ping_drive_connected')
                : t('drive.ping_not_connected')
            }
          >
            <span className={`td-conn-dot ${pingState?.status || (connected ? 'excellent' : 'disconnected')} pulse`} />
            <span className="td-conn-text">
              {pingState?.status === 'offline' && t('drive.ping_offline')}
              {pingState?.status === 'disconnected' && t('drive.ping_disconnected')}
              {pingState?.status === 'transferring' && t('drive.ping_transferring')}
              {pingState?.status === 'excellent' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_excellent')}`}
              {pingState?.status === 'good' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_good')}`}
              {pingState?.status === 'fair' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_fair')}`}
              {pingState?.status === 'poor' && `${pingState.ms != null ? `${pingState.ms} ms · ` : ''}${t('drive.ping_poor')}`}
              {!pingState && (connected ? t('drive.ping_drive_connected') : t('drive.ping_not_connected'))}
            </span>
          </div>
        </div>
        <MediaSelect
          value={session}
          onChange={onSessionChange}
          ariaLabel="Telegram session"
          compact
          options={sessions.length
            ? sessions.map((name) => ({ value: name, label: getSessionDisplayName(name) }))
            : [{ value: '', label: 'Belum ada session', disabled: true }]}
        />
        {(!connected || pingState?.status === 'disconnected' || pingState?.status === 'offline') && (
          <div className="td-session-reconnect-bar" role="status">
            <div className="td-reconnect-actions">
              <button
                type="button"
                className="td-reconnect-action-btn td-reconnect-check-btn"
                onClick={handleRefreshClick}
                disabled={busy || manualSpin}
                title={t('drive.sidebar_refresh_tooltip')}
              >
                <RefreshCw size={12} className={busy || manualSpin ? 'spin' : ''} />
                <span>{busy || manualSpin ? t('accounts.status_checking') : t('drive.btn_check_connection')}</span>
              </button>
              {onOpenRelogModal && (
                <button
                  type="button"
                  className="td-reconnect-action-btn td-reconnect-login-btn"
                  onClick={onOpenRelogModal}
                  title={t('accounts.btn_relog')}
                >
                  <LogIn size={12} />
                  <span>{t('accounts.btn_relog')}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="td-rail-actions td-rail-toolbar" role="toolbar" aria-label={t('ui.generated.aksi_drive_47b8b0c')}>
        {effectiveCollapsed ? (
          <>
            <button
              type="button"
              className="td-rail-btn td-rail-tool td-btn-new-folder"
              title={
                createIsSubfolder
                  ? `Buat folder di dalam “${activeDriveFolder?.name || 'lokasi ini'}” (folder dalam Drive/Folder)`
                  : 'Buat Drive baru (channel privat [TD] di root). Buka Drive/Folder dulu untuk membuat folder di dalamnya.'
              }
              aria-label={createIsSubfolder ? 'Buat folder di dalam Drive/Folder' : 'Buat Drive baru'}
              onClick={() =>
                onCreate(
                  createIsSubfolder && activePeerId != null
                    ? { parentId: activePeerId }
                    : { parentId: null }
                )
              }
            >
              <FolderPlus size={18} aria-hidden className="td-btn-add-icon" />
            </button>

            <button
              type="button"
              className="td-rail-btn td-rail-tool td-sidebar-search-btn"
              onClick={() => {
                if (isCollapseAllowed) {
                  onToggleCollapse?.();
                }
                setTimeout(() => {
                  setIsCompactSearchActive(true);
                  locationSearchRef.current?.focus();
                }, 100);
              }}
              title={t("drive.sidebar_search_title")}
              aria-label={t("drive.sidebar_search_aria")}
            >
              <Search size={18} />
            </button>
          </>
        ) : isCompactSearchActive || Boolean(locationQuery && locationQuery.trim().length > 0) ? (
          <div className="td-location-search td-location-search-inline">
            <Search size={14} aria-hidden className="td-location-search-ico" />
            <input
              ref={locationSearchRef}
              type="text"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              value={locationQuery}
              onChange={(e) => onChatQuery(e.target.value)}
              placeholder={t("drive.sidebar_search_location_ph")}
              aria-label={t("drive.sidebar_search_aria")}
              title={t("drive.sidebar_search_title")}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (!locationQuery) {
                    setIsCompactSearchActive(false);
                  } else {
                    onChatQuery('');
                  }
                }
                if (e.key === 'Enter' && isPathIdMode && parsedPath.isPathId) {
                  e.preventDefault();
                  onNavigatePath?.(parsedPath);
                  onCloseDrawer?.();
                }
              }}
              onBlur={() => {
                if (!locationQuery) {
                  setIsCompactSearchActive(false);
                }
              }}
              onDragOver={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="td-location-search-clear"
              title={t('drive.clear_search')}
              aria-label={t("drive.sidebar_clear_search")}
              onClick={() => {
                onChatQuery('');
                setIsCompactSearchActive(false);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="td-sidebar-action-split-row">
            <button
              type="button"
              className="td-rail-btn td-rail-tool td-btn-new-folder is-full-width"
              title={
                createIsSubfolder
                  ? `Buat folder di dalam “${activeDriveFolder?.name || 'lokasi ini'}” (folder dalam Drive/Folder)`
                  : 'Buat Drive baru (channel privat [TD] di root). Buka Drive/Folder dulu untuk membuat folder di dalamnya.'
              }
              aria-label={createIsSubfolder ? 'Buat folder di dalam Drive/Folder' : 'Buat Drive baru'}
              onClick={() =>
                onCreate(
                  createIsSubfolder && activePeerId != null
                    ? { parentId: activePeerId }
                    : { parentId: null }
                )
              }
              onContextMenu={(e) => {
                e.preventDefault();
                if (createIsSubfolder && activePeerId != null) {
                  onCreate({ parentId: activePeerId });
                } else {
                  onCreate({ parentId: null });
                }
              }}
            >
              <FolderPlus size={16} aria-hidden className="td-btn-add-icon" />
              <span className="td-rail-btn-label">
                {createIsSubfolder ? t('drive.btn_create_folder') : t('drive.btn_create_drive')}
              </span>
            </button>

            <button
              type="button"
              className="td-rail-btn td-sidebar-search-btn"
              onClick={() => {
                setIsCompactSearchActive(true);
                setTimeout(() => {
                  locationSearchRef.current?.focus();
                  locationSearchRef.current?.select();
                }, 30);
              }}
              title={t("drive.sidebar_search_title")}
              aria-label={t("drive.sidebar_search_aria")}
            >
              <Search size={16} />
            </button>
          </div>
        )}
      </div>

      {(channelLimitWarning ||
        rootDriveCount >= DRIVE_FOLDER_SOFT_LIMIT) && (
        <p className="td-channel-limit-banner td-only-expanded" role="status">
          {channelLimitWarning ||
            t('drive.drive_root_limit_warning', { count: rootDriveCount })}
        </p>
      )}

      {/* DnD hint only in status bar (Cloud Drives) — avoid dark slab in sidebar */}
      {folderDragLive && !dragLive && (
        <p className="td-dnd-hint td-only-expanded">
          {t('ui.generated.lepas_di_4ee781a')} <strong>{t('ui.generated.drive_atau_folder_lain_df18d2b')}</strong> {t('ui.generated.untuk_memindahkan_esc_batal_ff0f8f2')}
        </p>
      )}

      {/* ── Fixed Controls Block (Search Bar + 3 Smart Tabs Bar) ── */}
      <div className="td-sidebar-fixed-controls">
          {/* Expanded mode: Search Bar */}
          {!anyDragLive && !collapsed && (
            <div className="td-location-search td-location-search-main">
              <Search size={14} aria-hidden className="td-location-search-ico" />
              <input
                ref={locationSearchRef}
                type="text"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
                value={locationQuery}
                onChange={(e) => onChatQuery(e.target.value)}
                placeholder={t("drive.sidebar_search_location_ph")}
                aria-label={t("drive.sidebar_search_aria")}
                title={t("drive.sidebar_search_title")}
                onDragOver={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isPathIdMode && parsedPath.isPathId) {
                    e.preventDefault();
                    onNavigatePath?.(parsedPath);
                    onCloseDrawer?.();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onChatQuery('');
                  }
                }}
              />
              {hasLocationQuery && (
                <button
                  type="button"
                  className="td-location-search-clear"
                  title={t('drive.clear_search')}
                  aria-label={t("drive.sidebar_clear_search")}
                  onClick={() => onChatQuery('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {/* Expanded mode: Horizontal 3 Smart Tabs Bar */}
          {!collapsed && (layoutModel === 'model_a' || layoutModel === 'model_b') && (
            <div className="td-sidebar-tab-bar" role="tablist">
              {/* Tab 1: Recent Locations */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'recent'}
                data-drop-key="tab:recent"
                className={`td-sidebar-tab-btn${activeTab === 'recent' ? ' is-active' : ''}${overKey === 'tab:recent' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('recent')}
                title={t('drive.sidebar_recents_header')}
              >
                <Clock size={13} aria-hidden />
                <span className="td-sidebar-tab-label">{t('drive.sidebar_tab_recent')}</span>
                {(hasLocationQuery || filteredRecents.length > 0) && (
                  <span className="td-tab-badge">
                    {hasLocationQuery ? matchingRecents.length : filteredRecents.length}
                  </span>
                )}
              </button>

              {/* Tab 2: Drives */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'drives'}
                data-drop-key="tab:drives"
                className={`td-sidebar-tab-btn${activeTab === 'drives' ? ' is-active' : ''}${overKey === 'tab:drives' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('drives')}
                title={t('ui.generated.drives_td_d85c6ed')}
              >
                <HardDrive size={13} aria-hidden />
                <span className="td-sidebar-tab-label">{t('drive.sidebar_tab_drives')}</span>
                {(hasLocationQuery || rootDriveCount > 0) && (
                  <span className="td-tab-badge">
                    {hasLocationQuery ? matchingRootDriveCount : rootDriveCount}
                  </span>
                )}
              </button>

              {/* Tab 3: Telegram Chats & Groups */}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'chats'}
                data-drop-key="tab:chats"
                className={`td-sidebar-tab-btn${activeTab === 'chats' ? ' is-active' : ''}${overKey === 'tab:chats' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('chats')}
                title={t('ui.generated.daftar_chat_71a8e93')}
              >
                <MessageSquare size={13} aria-hidden />
                <span className="td-sidebar-tab-label">{t('drive.sidebar_tab_telegram')}</span>
                {(hasLocationQuery || chats.length > 0) && (
                  <span className="td-tab-badge">
                    {hasLocationQuery ? chatRows.length : (chatIndex.length || chats.length)}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Collapsed mode: Vertical 3 Mini Tab Icon Strip */}
          {collapsed && (layoutModel === 'model_a' || layoutModel === 'model_b') && (
            <div className="td-sidebar-collapsed-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'recent'}
                data-drop-key="tab:recent"
                className={`td-collapsed-tab-icon${activeTab === 'recent' ? ' is-active' : ''}${overKey === 'tab:recent' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('recent')}
                title={`${t('drive.sidebar_tab_recent')} (${hasLocationQuery ? matchingRecents.length : filteredRecents.length})`}
              >
                <Clock size={15} aria-hidden />
                {(hasLocationQuery || filteredRecents.length > 0) && (
                  <span className="td-collapsed-badge">
                    {hasLocationQuery ? matchingRecents.length : filteredRecents.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'drives'}
                data-drop-key="tab:drives"
                className={`td-collapsed-tab-icon${activeTab === 'drives' ? ' is-active' : ''}${overKey === 'tab:drives' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('drives')}
                title={`${t('drive.sidebar_tab_drives')} (${hasLocationQuery ? matchingRootDriveCount : rootDriveCount})`}
              >
                <HardDrive size={15} aria-hidden />
                {(hasLocationQuery || rootDriveCount > 0) && (
                  <span className="td-collapsed-badge">
                    {hasLocationQuery ? matchingRootDriveCount : rootDriveCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'chats'}
                data-drop-key="tab:chats"
                className={`td-collapsed-tab-icon${activeTab === 'chats' ? ' is-active' : ''}${overKey === 'tab:chats' ? ' is-drag-hover' : ''}`}
                onClick={() => setActiveTab('chats')}
                title={`${t('drive.sidebar_tab_telegram')} (${hasLocationQuery ? chatRows.length : (chatIndex.length || chats.length)})`}
              >
                <MessageSquare size={15} aria-hidden />
                {(hasLocationQuery || chats.length > 0) && (
                  <span className="td-collapsed-badge">
                    {hasLocationQuery ? chatRows.length : (chatIndex.length || chats.length)}
                  </span>
                )}
              </button>
            </div>
          )}
      </div>

      <nav
        ref={navRef as React.RefObject<HTMLElement>}
        className={`td-folder-nav ${anyDragLive ? 'is-drop-mode is-dnd-layout' : ''} ${
          hasLocationQuery ? 'is-search-mode' : ''
        } ${!chatsExpanded ? 'chats-collapsed' : ''} ${!foldersExpanded ? 'folders-collapsed' : ''} td-nav-model-${layoutModel}`}
        data-layout-model={layoutModel}
        data-active-tab={activeTab}
        data-has-query={hasLocationQuery ? 'true' : 'false'}
        onWheel={(e) => {
          if (collapsed && navRef.current) {
            e.preventDefault();
            navRef.current.scrollTop += e.deltaY;
          }
        }}
        onDragOver={(e) => {
          if (
            dragLive ||
            folderDragLive ||
            acceptDrop(e) ||
            isInternalMediaDragActive() ||
            isFolderReparentDragActive()
          ) {
            e.preventDefault();
            applyDropEffect(
              e.dataTransfer,
              isFolderReparentDragActive() || folderDragLive ? 'move' : 'move'
            );
          }
        }}
      >
        {hasLocationQuery && !dragLive && !isPathIdMode && (
          <p className="td-location-search-meta td-only-expanded">
            {layoutModel === 'model_a'
              ? activeTab === 'recent'
                ? `${matchingRecents.length} ${t('drive.sidebar_tab_recent')}`
                : activeTab === 'drives'
                  ? `${folderRows.length} ${t('drive.sidebar_tab_drives')}`
                  : `${chatRows.length} ${t('drive.sidebar_tab_telegram')}`
              : `${[
                  showSaved ? 1 : 0,
                  matchingRecents.length,
                  folderRows.length,
                  chatRows.length,
                ].reduce((a, b) => a + b, 0)} ${t('ui.generated.lokasi_9c8096b')}`}
            {chatsHasMore && chatRows.length === 0 && activeTab === 'chats'
              ? ` · ${t('ui.generated.muat_chat_lain_jika_belum_muncul_38ef29f')}`
              : ''}
          </p>
        )}

        {/* ── Compact Quick Jump Card — shown when Path ID pattern detected ── */}
        {hasLocationQuery && !dragLive && isPathIdMode && (
          <div
            className="td-path-quick-jump td-only-expanded"
            role="button"
            tabIndex={0}
            title={describePath(parsedPath, t, resolvedPathInfo || undefined)}
            aria-label={`${t('ui.path_jump.title')}: ${describePath(parsedPath, t, resolvedPathInfo || undefined)}`}
            onClick={() => {
              onNavigatePath?.(parsedPath);
              onCloseDrawer?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigatePath?.(parsedPath);
                onCloseDrawer?.();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onChatQuery('');
              }
            }}
          >
            {/* Header: Title */}
            <div className="td-path-qj-header">
              <div className="td-path-qj-title-wrap">
                <Zap size={12} aria-hidden className="td-path-qj-icon" />
                <span className="td-path-qj-title">{t('ui.path_jump.title')}</span>
              </div>
            </div>

            {/* Breadcrumb Flow: Horizontal Scrollable Single-Line Strip */}
            <div
              className="td-path-qj-flow"
              onWheel={(e) => {
                if (e.deltaY !== 0) {
                  e.currentTarget.scrollLeft += e.deltaY;
                }
              }}
            >
              {pathSteps.map((step, idx) => (
                <div key={idx} className="td-path-qj-step">
                  {idx > 0 && <ChevronRight size={10} className="td-path-qj-sep" aria-hidden />}
                  <span className={`td-path-pill td-path-pill-${step.type}`} title={step.tooltip || step.name}>
                    <span className="td-path-pill-tag">{step.tag}</span>
                    <span className="td-path-pill-text">{step.name}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Actions Row: Open & Cancel on the Next Line */}
            <div className="td-path-qj-actions-row">
              <button
                type="button"
                className="td-path-qj-btn-open"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigatePath?.(parsedPath);
                  onCloseDrawer?.();
                }}
                title={t('ui.path_jump.btn_open_short')}
              >
                <span>{t('ui.path_jump.btn_open_short')}</span>
                <kbd className="td-path-qj-kbd">↵</kbd>
              </button>
              <button
                type="button"
                className="td-path-qj-btn-cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  onChatQuery('');
                }}
                title={t('ui.path_jump.btn_cancel_short')}
                aria-label={t('ui.path_jump.btn_cancel_short')}
              >
                <X size={11} />
                <span>{t('ui.path_jump.btn_cancel_short')}</span>
                <kbd className="td-path-qj-kbd">{t('ui.path_jump.key_escape')}</kbd>
              </button>
            </div>
          </div>
        )}

        {/* ── Saved Messages & Pins Quick Bar (Shown in both Expanded and Collapsed Rail) ── */}
        {(layoutModel === 'model_a' || layoutModel === 'model_b') && !anyDragLive && !hasLocationQuery && (
          <div className="td-sidebar-quick-bar">
            {(() => {
              const key = dropKey('saved', null);
              registerLabel(key, 'Saved Messages');
              return (
                <DropRow
                  dropKeyStr={key}
                  className={`td-quick-item ${locationKind === 'saved' ? 'active' : ''}`}
                  title={t('drive.sidebar_saved_messages_tooltip')}
                  isOver={overKey === key}
                  invalidTarget={isSelf(key)}
                  dragLive={dragLive}
                  acceptDrop={acceptDrop}
                  onHover={handleHover}
                  onDropTarget={handleDropKey}
                  onActivate={() => go(onSelectSaved)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onLocationContextMenu?.({
                      locationKind: 'saved',
                      id: null,
                      name: t('drive.saved_messages') || 'Saved Messages',
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <span className="td-folder-ico">
                    <PeerAvatar peerId={0} creds={creds} title={t('drive.saved_messages')} fallback={<Home size={15} />} />
                  </span>
                  <span className="td-folder-label td-only-expanded">{t('drive.saved_messages')}</span>
                </DropRow>
              );
            })()}
            {pins.slice(0, 3).map((r: any) => {
              const key = r.kind === 'saved' ? dropKey('saved', null) : dropKey(r.kind, r.id as number);
              registerLabel(key, r.label);
              const active =
                (r.kind === 'saved' && locationKind === 'saved') ||
                (r.kind !== 'saved' && locationKind === r.kind && activePeerId === r.id);
              return (
                <DropRow
                  key={`qb:${r.kind}:${r.id ?? 'me'}`}
                  dropKeyStr={key}
                  className={`td-quick-item td-pin-item ${active ? 'active' : ''}`}
                  title={r.label}
                  isOver={overKey === key}
                  invalidTarget={isSelf(key)}
                  dragLive={dragLive}
                  acceptDrop={acceptDrop}
                  onHover={handleHover}
                  onDropTarget={handleDropKey}
                  onActivate={() => go(() => onSelectPin?.(r))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onLocationContextMenu?.({
                      locationKind: r.kind === 'saved' ? 'saved' : r.kind === 'drive' ? 'drive' : 'chat',
                      id: r.kind === 'saved' ? null : (r.id as number),
                      name: r.label,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <span className="td-folder-ico" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {r.kind === 'chat' && r.id != null ? (
                      <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<MessageSquare size={15} />} />
                    ) : r.kind === 'drive' && r.id != null ? (
                      <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<Folder size={15} />} />
                    ) : (
                      <Home size={15} />
                    )}
                    <span className="td-pin-badge-dot" title={r.label}>
                      <Pin size={8} className="td-pin-svg-icon" />
                    </span>
                  </span>
                  <span className="td-folder-label td-only-expanded">{recentDisplayLabel(r.label, 18)}</span>
                </DropRow>
              );
            })}
          </div>
        )}
        {/* Shortcuts moved to input title tooltips — strip was visual noise */}
        <div className="td-shortcuts-hint td-only-expanded" style={{ display: 'none' }}>
          {t('ui.generated.ctrl_k_lokasi_ctrl_f_file_ctrl_a_pilih_esc_398cbc6')}
        </div>

        {showSaved && layoutModel !== 'model_a' &&
          (() => {
            const key = dropKey('saved', null);
            registerLabel(key, 'Saved Messages');
            return (
              <DropRow
                dropKeyStr={key}
                className={`td-folder-row ${locationKind === 'saved' ? 'active' : ''}`}
                title={t("drive.sidebar_saved_messages_tooltip")}
                isOver={overKey === key}
                invalidTarget={isSelf(key)}
                dragLive={dragLive}
                acceptDrop={acceptDrop}
                onHover={handleHover}
                onDropTarget={handleDropKey}
                onActivate={() => go(onSelectSaved)}
                onContextMenu={(e) =>
                  onLocationContextMenu?.({
                    locationKind: 'saved',
                    id: null,
                    name: 'Saved Messages',
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
              >
                <span className="td-folder-ico">
                  <PeerAvatar
                    peerId={0}
                    creds={creds}
                    title={t('drive.saved_messages')}
                    fallback={<Home size={16} />}
                  />
                </span>
                <span className="td-folder-label">{t("drive.saved_messages")}</span>
              </DropRow>
            );
          })()}

        {/* Pinned favorites */}
        {!hasLocationQuery && pins.length > 0 && (layoutModel === 'model_c' || (layoutModel === 'model_b' && activeTab === 'pins')) && (
          <div className="td-recents td-pins td-only-expanded" data-pins="1">
            <div className="td-recents-label">
              <Pin size={12} aria-hidden />
              {t('ui.generated.disematkan_57b7b13')}
            </div>
            <div className="td-recents-list">
              {pins.slice(0, 8).map((r: any) => {
                const key =
                  r.kind === 'saved' ? dropKey('saved', null) : dropKey(r.kind, r.id as number);
                registerLabel(key, r.label);
                const active =
                  (r.kind === 'saved' && locationKind === 'saved') ||
                  (r.kind !== 'saved' &&
                    locationKind === r.kind &&
                    activePeerId === r.id);
                const short = recentDisplayLabel(r.label, 18);
                return (
                  <DropRow
                    key={`pin:${r.kind}:${r.id ?? 'me'}`}
                    dropKeyStr={key}
                    className={`td-recent-chip td-pin-chip ${active ? 'active' : ''}`}
                    title={
                      dragLive
                        ? `Lepas untuk kirim ke ${r.label}`
                        : r.label
                    }
                    isOver={overKey === key}
                    invalidTarget={isSelf(key)}
                    dragLive={dragLive}
                    acceptDrop={acceptDrop}
                    onHover={handleHover}
                    onDropTarget={handleDropKey}
                    onActivate={() => go(() => onSelectPin?.(r))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onLocationContextMenu?.({
                        locationKind: r.kind === 'saved' ? 'saved' : r.kind === 'drive' ? 'drive' : 'chat',
                        id: r.kind === 'saved' ? null : (r.id as number),
                        name: r.label,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    <span className="td-folder-label">{short}</span>
                  </DropRow>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent locations — flat clean section without heavy dropdown container */}
        {(hasLocationQuery ? (matchingRecents.length > 0 || (layoutModel === 'model_a' && activeTab === 'recent')) : filteredRecents.length > 0) && (
          <div className="td-recents" data-recent="1">
            <div className="td-recents-header td-only-expanded">
              <Clock size={12} className="td-recents-icon" aria-hidden />
              <span className="td-recents-title">{t("drive.sidebar_recents_header")}</span>
              <span className="td-recents-count">
                {hasLocationQuery ? `${matchingRecents.length}/${filteredRecents.length}` : filteredRecents.length}
              </span>
            </div>
            {hasLocationQuery && matchingRecents.length === 0 ? (
              <p className="td-sidebar-hint td-only-expanded">{t('drive.sidebar_recents_empty')}</p>
            ) : (
              <div className="td-recents-list">
                {matchingRecents.slice(0, 8).map((r: any) => {
                  const key =
                    r.kind === 'saved'
                      ? dropKey('saved', null)
                      : dropKey(r.kind, r.id as number);
                  registerLabel(key, r.label);
                  const active =
                    (r.kind === 'saved' && locationKind === 'saved') ||
                    (r.kind !== 'saved' &&
                      locationKind === r.kind &&
                      activePeerId === r.id);
                  const kindBadge = (() => {
                    if (r.kind === 'drive') return 'Drive';
                    if (r.kind === 'saved') return 'Saved';
                    // kind === 'chat': resolve type from stored metadata first,
                    // then fall back to live chats list (covers old localStorage entries without chatType)
                    const liveMeta = r.id != null ? chats.find((c) => c.id === r.id) : null;
                    const resolvedIsForum = r.isForum ?? !!(liveMeta?.is_forum);
                    const resolvedType = r.chatType ?? liveMeta?.type;
                    if (resolvedIsForum) return 'Groups - Forum';
                    if (resolvedType === 'channel') return 'Channel';
                    if (resolvedType === 'group') return 'Group';
                    if (resolvedType === 'bot') return 'Bot';
                    if (resolvedType === 'user') return 'Private Chat';
                    return 'Chat';
                  })();
                  return (
                    <DropRow
                      key={`${r.kind}:${r.id ?? 'me'}`}
                      dropKeyStr={key}
                      className={`td-folder-row ${active ? 'active' : ''}`}
                      title={
                        dragLive
                          ? `Lepas untuk kirim ke ${r.label}`
                          : r.label
                      }
                      isOver={overKey === key}
                      invalidTarget={isSelf(key)}
                      dragLive={dragLive}
                      acceptDrop={acceptDrop}
                      onHover={handleHover}
                      onDropTarget={handleDropKey}
                      onActivate={() => go(() => onSelectRecent?.(r))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onLocationContextMenu?.({
                          locationKind: r.kind === 'saved' ? 'saved' : r.kind === 'drive' ? 'drive' : 'chat',
                          id: r.kind === 'saved' ? null : (r.id as number),
                          name: r.label,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                    >
                      <span className="td-folder-ico">
                        {r.kind === 'saved' ? (
                          <PeerAvatar peerId={0} creds={creds} title={r.label} fallback={<Home size={16} />} />
                        ) : r.kind === 'drive' ? (
                          <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<Folder size={16} />} />
                        ) : (
                          <PeerAvatar peerId={r.id} creds={creds} title={r.label} fallback={<MessageSquare size={16} />} />
                        )}
                      </span>
                      <div className="td-folder-text-col" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: '1px', lineHeight: 1.25 }}>
                        <span className="td-folder-label">{r.label}</span>
                        <span className="td-folder-subtext" style={{ fontSize: '0.68rem', color: 'var(--td-sub, #94a3b8)', opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {formatRelativeAccessTime(r.at, t)}
                        </span>
                      </div>
                      <span className="td-location-badge" style={(() => {
                        const base = {
                          fontSize: '0.62rem',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          marginLeft: '8px',
                          flexShrink: 0 as const,
                        };
                        if (kindBadge === 'Groups - Forum') return { ...base, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.45)', color: '#c4b5fd' };
                        if (kindBadge === 'Channel') return { ...base, background: 'rgba(6,182,212,0.13)', border: '1px solid rgba(6,182,212,0.4)', color: '#67e8f9' };
                        if (kindBadge === 'Group') return { ...base, background: 'rgba(34,197,94,0.13)', border: '1px solid rgba(34,197,94,0.4)', color: '#86efac' };
                        if (kindBadge === 'Bot') return { ...base, background: 'rgba(16,185,129,0.13)', border: '1px solid rgba(16,185,129,0.4)', color: '#6ee7b7' };
                        if (kindBadge === 'Private Chat') return { ...base, background: 'rgba(148,163,184,0.13)', border: '1px solid rgba(148,163,184,0.4)', color: '#cbd5e1' };
                        if (kindBadge === 'Drive') return { ...base, background: 'rgba(249,115,22,0.13)', border: '1px solid rgba(249,115,22,0.4)', color: '#fdba74' };
                        if (kindBadge === 'Saved') return { ...base, background: 'rgba(59,130,246,0.13)', border: '1px solid rgba(59,130,246,0.4)', color: '#93c5fd' };
                        return { ...base, border: '1px solid color-mix(in srgb, var(--td-primary, #3b82f6) 40%, var(--td-border))', color: 'color-mix(in srgb, var(--td-primary, #3b82f6) 85%, var(--td-fg))' };
                      })()}>
                        {kindBadge}
                      </span>
                    </DropRow>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Drives [TD] — compact stack while dragging so CHATS list gets height */}
        <div ref={folderStackRef} className="td-dnd-folder-stack">
          {(layoutModel === 'model_c' || hasLocationQuery) && (
            <button
              type="button"
              className={`td-section-toggle td-only-expanded${dragLive ? ' is-dnd-target' : ''}`}
              aria-expanded={foldersExpanded}
              onClick={toggleFolders}
              onPointerEnter={() => {
                if (dragLive || isInternalMediaDragActive() || mediaDragActive) openFoldersSection();
              }}
              onDragEnter={(e) => {
                if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
                e.preventDefault();
                openFoldersSection();
              }}
              onDragOver={(e) => {
                if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
                e.preventDefault();
                openFoldersSection();
              }}
              title={
                foldersExpanded
                  ? 'Ciutkan Drives — lebih luas untuk chat'
                  : 'Perluas Drives'
              }
            >
              <ChevronDown
                size={14}
                className={`td-section-chevron ${foldersExpanded ? 'is-open' : ''}`}
                aria-hidden
              />
              <span className="td-section-toggle-label">{t('ui.generated.drives_td_d85c6ed')}</span>
              <span className="td-chat-count" title={t("drive.sidebar_td_count")}>
                {hasLocationQuery ? `${matchingRootDriveCount}/${rootDriveCount}` : rootDriveCount}
              </span>
            </button>
          )}
          {foldersExpanded && folders.length === 0 && !loadingFolders && !hasLocationQuery && (
            <p className="td-sidebar-hint td-only-expanded">
              <strong>{t('drive.perspective_drive_short')}</strong> {t('ui.generated.root_penanda_7790d14')} <code>{t('ui.generated.td_1294383')}</code>{t('ui.generated.buka_drive_lalu_d92c640')}{' '}
              <strong>{t('ui.generated.folder_0d9a3d4')}</strong>{t('ui.generated.folder_bisa_berisi_folder_lagi_chat_di_bawah_bba5941')}
            </p>
          )}
          {foldersExpanded && hasLocationQuery && folderRows.length === 0 && folders.length > 0 && (
            <p className="td-sidebar-hint td-only-expanded">{t('drive.sidebar_drives_empty')}</p>
          )}
          {foldersExpanded &&
            displayFolderTreeRows.map(({ folder: f, depth, hasChildren }) => {
              const key = dropKey('drive', f.id);
              registerLabel(key, f.name);
              const isOpen = treeExpanded.has(f.id);
              const itemKind = driveItemKind(f);
              const nestTitle =
                f.is_orphan
                  ? `${f.title_raw || f.name} · Drive yatim (parent hilang) · klik kanan menu`
                  : hasChildren
                    ? `${f.title_raw || f.name} · ${
                        itemKind === 'folder' ? 'Folder' : 'Drive'
                      } · dobel-klik / panah untuk buka·tutup subfolder`
                    : itemKind === 'folder'
                      ? `${f.title_raw || f.name} · Folder · seret ke Drive/folder lain / klik kanan`
                      : `${f.title_raw || f.name} · Drive · seret atau klik kanan (+ Folder di dalam)`;
              return (
                <DropRow
                  key={f.id}
                  dropKeyStr={key}
                  className={`td-folder-row ${
                    locationKind === 'drive' && activePeerId === f.id ? 'active' : ''
                  } ${depth > 0 ? 'is-nested' : ''}${f.is_orphan ? ' is-orphan' : ''}${
                    itemKind === 'drive' ? ' is-drive-root' : ' is-drive-folder'
                  }`}
                  title={nestTitle}
                  isOver={overKey === key}
                  invalidTarget={isSelf(key)}
                  dragLive={dragLive}
                  folderDragLive={folderDragLive}
                  folderDragSource={{ folderId: f.id, folderName: f.name }}
                  acceptDrop={acceptDrop}
                  onHover={handleHover}
                  onDropTarget={handleDropKey}
                  onActivate={() => go(() => onSelectDrive(f.id))}
                  onDoubleActivate={
                    hasChildren && !collapsed ? () => toggleTreeFolder(f.id) : undefined
                  }
                  style={collapsed ? undefined : { paddingLeft: (depth === 0 && !hasChildren) ? 4 : 4 + depth * 14 }}
                  onContextMenu={(e) =>
                    onLocationContextMenu?.({
                      locationKind: 'drive',
                      id: f.id,
                      name: f.name,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                >
                  {/* Tree chevron/spacer only when expanded — spacer shifted icons off-center in rail */}
                  {!collapsed &&
                    (hasChildren ? (
                      <button
                        type="button"
                        className="td-folder-tree-toggle"
                        aria-label={isOpen ? 'Ciutkan folder' : 'Perluas folder'}
                        aria-expanded={isOpen}
                        title={isOpen ? t('drive.sidebar_collapse_subfolder') : t('drive.sidebar_expand_subfolder')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleTreeFolder(f.id);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                        }}
                        draggable={false}
                      >
                        {isOpen ? (
                          <ChevronDown size={14} aria-hidden />
                        ) : (
                          <ChevronRight size={14} aria-hidden />
                        )}
                      </button>
                    ) : depth > 0 ? (
                      <span className="td-folder-tree-spacer" aria-hidden />
                    ) : null)}
                  <span className="td-folder-ico">
                    <PeerAvatar
                      peerId={f.id}
                      creds={creds}
                      title={f.name}
                      fallback={<Folder size={16} />}
                    />
                  </span>
                  <span className="td-folder-label">{f.name}</span>
                  {/* Badges only on roots / orphan when searching or in stacked model */}
                  {itemKind === 'drive' && !f.is_orphan && depth === 0 && (layoutModel === 'model_c' || hasLocationQuery) && (
                    <span className="td-badge-drive td-only-expanded" title={t("drive.sidebar_drive_root")}>
                      {t('drive.perspective_drive_short')}
                    </span>
                  )}
                  {f.is_orphan && (
                    <span className="td-folder-orphan-badge td-only-expanded" title={t("drive.sidebar_orphan_parent")}>
                      {t('ui.generated.yatim_fbb507d')}
                    </span>
                  )}
                </DropRow>
              );
            })}
        </div>
        {/* Keep active folder reachable when section collapsed (not searching) */}
        {!foldersExpanded &&
          !collapsed &&
          locationKind === 'drive' &&
          activePeerId != null &&
          (() => {
            const f = folders.find((x) => x.id === activePeerId);
            if (!f) return null;
            const key = dropKey('drive', f.id);
            registerLabel(key, f.name);
            return (
              <DropRow
                dropKeyStr={key}
                className="td-folder-row active td-section-pinned"
                title={`${f.name} (${t('drive.active_folder_click_header')})`}
                isOver={overKey === key}
                invalidTarget={isSelf(key)}
                dragLive={dragLive}
                acceptDrop={acceptDrop}
                onHover={handleHover}
                onDropTarget={handleDropKey}
                onActivate={() => go(() => onSelectDrive(f.id))}
              >
                <span className="td-folder-ico">
                  <PeerAvatar
                    peerId={f.id}
                    creds={creds}
                    title={f.name}
                    fallback={<Folder size={16} />}
                  />
                </span>
                <span className="td-folder-label">{f.name}</span>
              </DropRow>
            );
          })()}

        {/* Quiet line between Drives (above) and Chats (below) — no extra zone icons */}
        {/* td-chat-section wraps the divider + header + list so CSS tab-switching can target it */}
        <div className="td-chat-section">
        {(layoutModel === 'model_c' || hasLocationQuery) && (
          <div
            className="td-zone-divider"
            role="separator"
            aria-label={t("drive.sidebar_resizer_aria")}
          >
            <span className="td-zone-divider-line" aria-hidden />
          </div>
        )}

        {/* Chats section toggle — only in stacked model or universal search */}
        {(layoutModel === 'model_c' || hasLocationQuery) && (
          <button
            type="button"
            className={`td-section-toggle td-only-expanded${dragLive ? ' is-dnd-target' : ''}`}
            aria-expanded={chatsExpanded}
            onClick={toggleChats}
            onPointerEnter={() => {
              if (dragLive || isInternalMediaDragActive() || mediaDragActive) openChatsSection();
            }}
            onDragEnter={(e) => {
              if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
              e.preventDefault();
              openChatsSection();
            }}
            onDragOver={(e) => {
              if (!dragLive && !acceptDrop(e) && !isInternalMediaDragActive()) return;
              e.preventDefault();
              openChatsSection();
            }}
            title={
              chatsExpanded
                ? 'Ciutkan daftar chat — lebih luas untuk folder'
                : dragLive
                  ? 'Arahkan ke sini untuk buka daftar chat (drop target)'
                  : 'Perluas daftar chat'
            }
          >
            <ChevronDown
              size={14}
              className={`td-section-chevron ${chatsExpanded ? 'is-open' : ''}`}
              aria-hidden
            />
            <span className="td-section-toggle-label">{t("drive.sidebar_chats_header")}</span>
            {chatIndex.length > 0 && (
              <span className="td-chat-count" title={t("drive.sidebar_chats_tooltip")}>
                {hasLocationQuery
                  ? `${chatRows.length}/${chatIndex.length}`
                  : chatIndex.length}
                {chatsHasMore ? '+' : ''}
              </span>
            )}
          </button>
        )}
        {chatsExpanded && chatFolders.length > 0 && (
          <div className="td-chat-folders-wrap td-only-expanded">
            <span className="td-chat-folders-label">{t("drive.sidebar_chat_folders_header")}</span>
            <div
              ref={chatFoldersScrollerRef}
              className={`td-chat-folders-row${chatFoldersScrolled ? ' is-scrolled' : ''}`}
              onScroll={(event) => setChatFoldersScrolled(event.currentTarget.scrollLeft > 14)}
              onWheel={(e) => {
                if (e.currentTarget) {
                  e.preventDefault();
                  e.stopPropagation();
                  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                  e.currentTarget.scrollLeft += delta;
                }
              }}
            >
              <button
                type="button"
                className={`td-chat-type-filter-compact td-chat-type-filter-pill${chatTypeFilter !== 'all' ? ' active' : ''}${chatFoldersScrolled ? ' is-visible' : ''}`}
                onClick={toggleTypeFilterMenu}
                title={activeChatTypeLabel}
                aria-label={`${t('drive.filter_by_type')}: ${activeChatTypeLabel}`}
                aria-expanded={typeFilterMenuOpen}
                tabIndex={chatFoldersScrolled ? 0 : -1}
              >
                <Filter size={13} className="td-filter-icon" />
              </button>
              {/* Chat Type Filter Trigger Button */}
              <div className="td-chat-type-filter-container" ref={typeFilterMenuRef}>
                <button
                  ref={typeFilterButtonRef}
                  type="button"
                  className={`td-chat-folder-chip td-chat-type-filter-pill ${chatTypeFilter !== 'all' ? 'active' : ''}`}
                  onClick={toggleTypeFilterMenu}
                  title={t('drive.filter_by_type')}
                  aria-label={t('drive.filter_by_type')}
                  aria-expanded={typeFilterMenuOpen}
                >
                  <Filter size={13} className="td-filter-icon" />
                  <span className="td-active-filter-badge">{activeChatTypeLabel}</span>
                  <ChevronDown size={11} className={`td-filter-arrow ${typeFilterMenuOpen ? 'is-open' : ''}`} />
                </button>

                {typeFilterMenuOpen && createPortal(
                  <div
                    className="td-chat-type-dropdown"
                    role="menu"
                    data-chat-type-dropdown
                    style={{ left: typeFilterMenuPosition.left, top: typeFilterMenuPosition.top }}
                  >
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'all' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('all'); setTypeFilterMenuOpen(false); }}
                    >
                      <Sparkles size={14} style={{ color: '#f59e0b' }} />
                      <span>{t('drive.filter_all_chats')}</span>
                      {chatTypeFilter === 'all' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'user' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('user'); setTypeFilterMenuOpen(false); }}
                    >
                      <User size={14} style={{ color: '#38bdf8' }} />
                      <span>{t('drive.filter_private')}</span>
                      {chatTypeFilter === 'user' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'group' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('group'); setTypeFilterMenuOpen(false); }}
                    >
                      <Users size={14} style={{ color: '#818cf8' }} />
                      <span>{t('drive.filter_groups')}</span>
                      {chatTypeFilter === 'group' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'channel' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('channel'); setTypeFilterMenuOpen(false); }}
                    >
                      <Radio size={14} style={{ color: '#34d399' }} />
                      <span>{t('drive.filter_channels')}</span>
                      {chatTypeFilter === 'channel' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'bot' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('bot'); setTypeFilterMenuOpen(false); }}
                    >
                      <Bot size={14} style={{ color: '#c084fc' }} />
                      <span>{t('drive.filter_bots')}</span>
                      {chatTypeFilter === 'bot' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                    <button
                      type="button"
                      className={`td-type-dropdown-item ${chatTypeFilter === 'forum' ? 'is-selected' : ''}`}
                      onClick={() => { setChatTypeFilter('forum'); setTypeFilterMenuOpen(false); }}
                    >
                      <MessagesSquare size={14} style={{ color: '#f472b6' }} />
                      <span>{t('drive.filter_forums')}</span>
                      {chatTypeFilter === 'forum' && <Check size={13} style={{ marginLeft: 'auto', color: '#f59e0b' }} />}
                    </button>
                  </div>,
                  document.body
                )}
              </div>

              <div className="td-chat-folders" role="tablist" aria-label={t("drive.sidebar_chat_folders_aria")}>
              {chatFolders.map((folder) => {
                const active = folder.id === activeChatFolderId;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    data-drop-key={chatFolderDropKey(folder.id)}
                    data-chat-folder-id={folder.id}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    className={`td-chat-folder-chip${active ? ' active' : ''}${overKey === chatFolderDropKey(folder.id) ? ' is-drag-hover is-drop-over' : ''}`}
                    style={{ '--td-chat-folder-color': telegramFolderColor(folder.color) } as React.CSSProperties}
                    title={`${folder.id === 0 ? t("drive.all_chats") : folder.title}${folder.kind === 'shared' ? ` · ${t("drive.shared_telegram_folder")}` : ''}`}
                    onClick={() => onSelectChatFolder?.(folder.id)}
                    onPointerEnter={() => {
                      if (!anyDragLive) return;
                      const key = chatFolderDropKey(folder.id);
                      handleHover(key);
                      scheduleChatFolderSwitch(folder.id);
                    }}
                    onPointerMove={() => {
                      if (!anyDragLive) return;
                      const key = chatFolderDropKey(folder.id);
                      handleHover(key);
                      scheduleChatFolderSwitch(folder.id);
                    }}
                    onPointerLeave={() => {
                      if (!anyDragLive) return;
                      cancelChatFolderSwitch();
                      handleHover(null);
                    }}
                    onDragEnter={(event) => {
                      if (!anyDragLive) return;
                      event.preventDefault();
                      applyDropEffect(event.dataTransfer, 'move');
                      const key = chatFolderDropKey(folder.id);
                      handleHover(key);
                      scheduleChatFolderSwitch(folder.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      const tabs = Array.from(
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []
                      );
                      const index = tabs.indexOf(event.currentTarget);
                      const next = event.key === 'ArrowRight'
                        ? (index + 1) % tabs.length
                        : (index - 1 + tabs.length) % tabs.length;
                      tabs[next]?.focus();
                      tabs[next]?.click();
                    }}
                  >
                    {folder.emoticon && <span aria-hidden>{folder.emoticon}</span>}
                    <span>{folder.id === 0 ? t("drive.all_chats") : folder.title}</span>
                  </button>
                );
              })}
              </div>
            </div>
          </div>
        )}
        {chatsExpanded && chatRows.length === 0 && !loadingChats && (
          <p className="td-sidebar-hint td-only-expanded">
            {hasLocationQuery
              ? chatsHasMore
                ? t('ui.generated.belum_ketemu_di_chat_yang_sudah_termuat_scroll_m_ba5501e')
                : t('ui.generated.tidak_ada_chat_yang_cocok_bed4d35')
              : t('ui.generated.tidak_ada_chat_refresh_atau_cek_session_fb2e1de')}
          </p>
        )}
        {chatsExpanded && chatRows.length === 0 && loadingChats && (
          <div className="td-only-expanded" style={{ padding: '4px 0' }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="td-sidebar-skeleton-row">
                <div className="td-sidebar-skeleton-avatar" />
                <div className="td-sidebar-skeleton-text">
                  <div className="td-sidebar-skeleton-line-primary" />
                  <div className="td-sidebar-skeleton-line-secondary" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Virtualized chat list — also shown on collapsed rail (avatar icons, hidden scrollbar). */}
        {chatsExpanded && (
          <div
            ref={chatListRef}
            className={`td-chat-virtual ${collapsed ? 'is-rail' : ''}`}
            role="list"
            aria-label={t('ui.generated.daftar_chat_71a8e93')}
          >
            {collapsed ? (
              <div className="td-chat-collapsed-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0', alignItems: 'center' }}>
                {filteredByTypeChats.map((c) => {
                  const key = dropKey('chat', c.id);
                  registerLabel(key, c.name);
                  const active = locationKind === 'chat' && activePeerId === c.id;
                  return (
                    <DropRow
                      key={c.id}
                      dropKeyStr={key}
                      className={`td-folder-row ${active ? 'active' : ''}`}
                      title={`${c.name} (${c.type})`}
                      isOver={overKey === key}
                      invalidTarget={isSelf(key)}
                      dragLive={dragLive}
                      acceptDrop={acceptDrop}
                      onHover={handleHover}
                      onDropTarget={handleDropKey}
                      onActivate={() => go(() => onSelectChat(c.id))}
                      onContextMenu={(e) =>
                        onLocationContextMenu?.({
                          locationKind: 'chat',
                          id: c.id,
                          name: c.name,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }
                    >
                      <span className="td-folder-ico">
                        <PeerAvatar peerId={c.id} creds={creds} title={c.name} fallback={<MessageSquare size={16} />} />
                      </span>
                      <span className="td-folder-label">{c.name}</span>
                      {c.is_forum && (
                        <span
                          className="td-badge-forum td-only-expanded"
                          title={t('drive.group_with_topics')}
                        >
                          {t('drive.label_topic')}
                        </span>
                      )}
                    </DropRow>
                  );
                })}
              </div>
            ) : (
              <div
                className="td-chat-virtual-inner"
                style={{ height: chatVirtualizer.getTotalSize(), position: 'relative' }}
              >
                {virtualItems.map((vRow) => {
                  const c = filteredByTypeChats[vRow.index];
                  if (!c) return null;
                  const key = dropKey('chat', c.id);
                  registerLabel(key, c.name);
                  return (
                    <div
                      key={c.id}
                      className="td-chat-virtual-row"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: vRow.size,
                        transform: `translateY(${vRow.start}px)`,
                      }}
                    >
                      <DropRow
                        dropKeyStr={key}
                        className={`td-folder-row ${
                          locationKind === 'chat' && activePeerId === c.id ? 'active' : ''
                        }`}
                        title={
                          isSelf(key)
                            ? `${c.name} — ${t('drive.source_location_choose_other')}`
                            : `${c.name} (${c.type}) — ${t('drive.right_click_menu')}${
                                c.is_forum ? ` · ${t('drive.label_topic')}` : ''
                              }`
                        }
                        isOver={overKey === key}
                        invalidTarget={isSelf(key)}
                        dragLive={dragLive}
                        acceptDrop={acceptDrop}
                        onHover={handleHover}
                        onDropTarget={handleDropKey}
                        onActivate={() => go(() => onSelectChat(c.id))}
                        onContextMenu={(e) =>
                          onLocationContextMenu?.({
                            locationKind: 'chat',
                            id: c.id,
                            name: c.name,
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                      >
                        <span className="td-folder-ico">
                          <PeerAvatar peerId={c.id} creds={creds} title={c.name} fallback={<MessageSquare size={16} />} />
                        </span>
                        <div className="td-folder-text-col" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: '1px', lineHeight: 1.25 }}>
                          <span className="td-folder-label">{c.name}</span>
                        </div>
                      </DropRow>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* Active chat pin when section collapsed */}
        {!chatsExpanded &&
          !collapsed &&
          locationKind === 'chat' &&
          activePeerId != null &&
          (() => {
            const c = chats.find((x) => x.id === activePeerId);
            if (!c) return null;
            const key = dropKey('chat', c.id);
            registerLabel(key, c.name);
            return (
              <DropRow
                dropKeyStr={key}
                className="td-folder-row active td-section-pinned"
                title={`${c.name} (${t('drive.active_chat_click_header')})`}
                isOver={overKey === key}
                invalidTarget={isSelf(key)}
                dragLive={dragLive}
                acceptDrop={acceptDrop}
                onHover={handleHover}
                onDropTarget={handleDropKey}
                onActivate={() => go(() => onSelectChat(c.id))}
              >
                <span className="td-folder-ico">
                  <PeerAvatar
                    peerId={c.id}
                    creds={creds}
                    title={c.name}
                    fallback={<ChatIcon type={c.type} />}
                  />
                </span>
                <span className="td-folder-label">{c.name}</span>
              </DropRow>
            );
          })()}
        {chatsExpanded && chatsHasMore && !collapsed && (
          <button
            type="button"
            className="td-folder-row td-load-more-chats"
            onClick={() => onLoadMoreChats?.()}
            disabled={chatsLoadingMore}
          >
            <span className="td-folder-label">
              {chatsLoadingMore
                ? t('drive.sidebar_loading_more_chats', { count: chatIndex.length })
                : t('drive.sidebar_load_more_chats', { count: chatIndex.length })}
            </span>
          </button>
        )}
        </div>{/* /td-chat-section */}
      </nav>

      <div className="td-sidebar-foot td-only-expanded p-3 border-t border-gray-100 dark:border-gray-800">
        {creds && isDriveSessionCircuitTripped(creds) ? (
          <div className="flex flex-col gap-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-lg">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium break-words leading-relaxed">
              {getDriveSessionError(creds) || t('ui.generated.drive_gagal_terhubung_8e7dd9a')}
            </p>
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-md transition-colors shadow-sm cursor-pointer"
              onClick={() => {
                resetDriveSessionCircuit(creds);
              }}
            >
              <RefreshCw className="w-3 h-3 animate-pulse" />
              {t('drive.btn_retry')}
            </button>
          </div>
        ) : (
          statusText && <p className="td-status-foot">{statusText}</p>
        )}
      </div>
    </aside>  );
}
