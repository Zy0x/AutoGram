# AutoGram Theme Migration & Static Color Inventory Report

**Date**: 2026-09-08T13:45:02.278Z
**Total Files Scanned**: 345

## 1. Summary by Workspace

| Workspace | Files with Static Colors | Slate/Gray/Zinc Tokens | Raw Hex Codes | RGB/RGBA Occurrences | Inline Color Styles |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Cloud Drives** | 58 | 190 | 845 | 642 | 513 |
| **Media Forwarder** | 1 | 0 | 48 | 72 | 0 |
| **Media Studio** | 15 | 200 | 7 | 4 | 6 |
| **Drive Tools** | 0 | 0 | 0 | 0 | 0 |
| **Settings** | 12 | 75 | 382 | 441 | 304 |
| **Core UI & Layout** | 31 | 44 | 3754 | 3642 | 450 |

## 2. Detailed Component Ownership & Inventory

### Workspace: Cloud Drives

| File Path | Slate/Gray Classes | Raw Hex | RGB/RGBA | Inline Styles | Replacement Strategy |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `components/drive/DriveToolsPanel/DuplicatesTab.tsx` | 25 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DriveToolsPanel/SpaceUsageTab.tsx` | 27 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DriveToolsPanel/index.tsx` | 0 | 44 | 37 | 36 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/MediaAudioPlayer.tsx` | 6 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/MediaHeaderToolbar.tsx` | 21 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/DocumentViewer.tsx` | 14 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/ImageViewer.tsx` | 20 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/MediaVideoPlayer.tsx` | 9 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/PlaybackDiagnosticsPanel.tsx` | 0 | 27 | 5 | 25 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/SplitSidepanelThumb.tsx` | 4 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/TgsLottiePlayer.tsx` | 1 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/CodeScriptViewer.tsx` | 0 | 26 | 26 | 3 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/JsonTreeViewer.tsx` | 0 | 1 | 3 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/LogViewer.tsx` | 1 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/FontWaterfallViewer.tsx` | 1 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/DatabaseTableInspector.tsx` | 1 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/DrivePreviewModal/DocxViewer.tsx` | 0 | 10 | 1 | 6 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/SpreadsheetViewer.tsx` | 0 | 29 | 19 | 23 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/JupyterNotebookViewer.tsx` | 0 | 12 | 10 | 13 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/PptxViewer.tsx` | 0 | 39 | 24 | 29 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/MarkdownViewer.tsx` | 0 | 21 | 11 | 19 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/EpubViewer.tsx` | 0 | 28 | 17 | 22 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/HeicTiffViewer.tsx` | 0 | 3 | 0 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/PreviewCopyIdentityActions.tsx` | 1 | 10 | 8 | 10 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DrivePreviewModal/index.tsx` | 7 | 61 | 61 | 34 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/DriveZipBrowser/DriveZipBrowser.css` | 0 | 181 | 168 | 0 | Bridge to active :root custom properties |
| `components/drive/Explorer/DriveSkeleton.tsx` | 0 | 2 | 1 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Explorer/ThumbnailImage.tsx` | 3 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Explorer/ImageCanvasThumbnailCapturer.tsx` | 0 | 1 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Explorer/DriveFileCard.tsx` | 0 | 8 | 0 | 1 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Explorer/DriveExplorer.tsx` | 0 | 6 | 18 | 10 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Navigation/TopBarBreadcrumbs.tsx` | 6 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Navigation/SidebarStorageGauge.tsx` | 6 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Navigation/SidebarQuickLinks.tsx` | 3 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Navigation/SidebarCategoryList.tsx` | 6 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Navigation/SidebarRecentsSection.tsx` | 5 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Navigation/SidebarSessionHeader.tsx` | 10 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Navigation/TopBarSearchFilter.tsx` | 10 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/drive/Navigation/sidebarUtils.tsx` | 0 | 25 | 1 | 1 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Navigation/DriveTopBar.tsx` | 0 | 2 | 0 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Navigation/DriveSidebarIndex.tsx` | 0 | 28 | 1 | 1 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Navigation/SidebarView.tsx` | 2 | 22 | 14 | 13 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Modals/DriveConfirmDialog.tsx` | 0 | 1 | 0 | 1 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Modals/SessionRelogModal.tsx` | 0 | 11 | 11 | 9 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Modals/TelegramMessagePreviewModal.tsx` | 0 | 26 | 2 | 5 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Modals/RemoteUploadBatchPanel.tsx` | 0 | 2 | 0 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Modals/RemoteUploadSinglePanel.tsx` | 0 | 21 | 8 | 21 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Modals/remoteUploadRenderers.tsx` | 0 | 26 | 6 | 24 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/TransferOrchestrationSettings.tsx` | 0 | 1 | 0 | 1 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/TransferSettingsWorkspace.tsx` | 0 | 56 | 39 | 58 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/AlbumStrategyControl.tsx` | 0 | 26 | 24 | 30 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/TransferPreflightDialog.tsx` | 1 | 11 | 15 | 10 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/UploadSettingsSection.tsx` | 0 | 12 | 18 | 18 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/EncodingSettingsSection.tsx` | 0 | 17 | 26 | 21 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/AdvancedSettingsSection.tsx` | 0 | 16 | 30 | 25 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/DownloadSettingsSection.tsx` | 0 | 5 | 7 | 6 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/PlaybackSettingsSection.tsx` | 0 | 8 | 11 | 9 | Refactor inline style to var(--bg-*) or CSS class |
| `components/drive/Transfers/LimitsRecoverySettingsSection.tsx` | 0 | 20 | 20 | 19 | Refactor inline style to var(--bg-*) or CSS class |

### Workspace: Media Forwarder

| File Path | Slate/Gray Classes | Raw Hex | RGB/RGBA | Inline Styles | Replacement Strategy |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `pages/ForwarderWorkspace/ForwarderWorkspace.css` | 0 | 48 | 72 | 0 | Bridge to active :root custom properties |

### Workspace: Media Studio

| File Path | Slate/Gray Classes | Raw Hex | RGB/RGBA | Inline Styles | Replacement Strategy |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `pages/MediaStudio/MediaStudioModals.tsx` | 45 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/MediaStudio/MediaStudioOverlays.tsx` | 0 | 3 | 1 | 3 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/MediaStudio/MediaStudioToolbar.tsx` | 20 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/MediaStudio/MediaStudioFilterTabs.tsx` | 6 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/MediaStudio/MediaStudioBatchActionBar.tsx` | 6 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/MediaStudio/MediaStudioGrid.tsx` | 43 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/MediaStudio/MediaStudioHeader.tsx` | 16 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/MediaStudio/MediaStudioSidebar.tsx` | 39 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/MediaStudio/index.tsx` | 0 | 4 | 3 | 3 | Refactor inline style to var(--bg-*) or CSS class |
| `features/topic-media/components/FileTypeIcon.tsx` | 1 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `features/topic-media/components/DownloadProgress.tsx` | 1 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `features/topic-media/components/DocumentThumbnail.tsx` | 3 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `features/topic-media/components/TopicMediaSkeleton.tsx` | 4 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `features/topic-media/components/TopicMediaItem.tsx` | 6 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `features/topic-media/components/TopicMediaGrid.tsx` | 10 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |

### Workspace: Drive Tools

*No static color leakage detected in this workspace.*

### Workspace: Settings

| File Path | Slate/Gray Classes | Raw Hex | RGB/RGBA | Inline Styles | Replacement Strategy |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `components/Jobs/JobEditor/JobFilterSettings.tsx` | 35 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/Settings/index.tsx` | 0 | 83 | 50 | 70 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Settings/DataBackupSection.tsx` | 10 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/Settings/AccountSessionSection.tsx` | 13 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/Settings/AppearanceSection.tsx` | 17 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/Settings/NetworkSection.tsx` | 0 | 23 | 21 | 24 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Settings/PerfSection.tsx` | 0 | 16 | 16 | 15 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Settings/Settings.css` | 0 | 61 | 155 | 0 | Bridge to active :root custom properties |
| `pages/Settings/SpecificCacheModal.tsx` | 0 | 126 | 119 | 117 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Settings/CustomAccountSelect.tsx` | 0 | 8 | 5 | 4 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Settings/StorageSettingsSection.tsx` | 0 | 53 | 54 | 59 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Settings/ColorPaletteSection.tsx` | 0 | 12 | 21 | 15 | Refactor inline style to var(--bg-*) or CSS class |

### Workspace: Core UI & Layout

| File Path | Slate/Gray Classes | Raw Hex | RGB/RGBA | Inline Styles | Replacement Strategy |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `App.tsx` | 0 | 2 | 2 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `index.css` | 0 | 78 | 208 | 0 | Bridge to active :root custom properties |
| `components/Jobs/JobEditor/JobSourceTargetConfig.tsx` | 11 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `components/Jobs/JobEditor/index.tsx` | 0 | 12 | 30 | 82 | Refactor inline style to var(--bg-*) or CSS class |
| `components/Jobs/Modals/CaptionModal.tsx` | 0 | 9 | 9 | 23 | Refactor inline style to var(--bg-*) or CSS class |
| `components/Jobs/Modals/JobDetailsModal.tsx` | 0 | 0 | 6 | 8 | Refactor inline style to var(--bg-*) or CSS class |
| `components/Jobs/Modals/FreshStartModal.tsx` | 0 | 0 | 2 | 7 | Refactor inline style to var(--bg-*) or CSS class |
| `components/Jobs/Modals/RerunModal.tsx` | 0 | 0 | 8 | 11 | Refactor inline style to var(--bg-*) or CSS class |
| `components/Jobs/Runtime/JobRuntime.tsx` | 0 | 0 | 5 | 22 | Refactor inline style to var(--bg-*) or CSS class |
| `components/common/InfoTooltip.tsx` | 0 | 1 | 2 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `components/common/ProgressBar.tsx` | 0 | 0 | 1 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `components/common/Select.tsx` | 0 | 0 | 5 | 4 | Refactor inline style to var(--bg-*) or CSS class |
| `components/common/VSCodeCodeViewer.tsx` | 0 | 2 | 0 | 1 | Refactor inline style to var(--bg-*) or CSS class |
| `components/common/ConfirmModal.tsx` | 0 | 14 | 11 | 5 | Refactor inline style to var(--bg-*) or CSS class |
| `components/common/ErrorBoundary.tsx` | 0 | 2 | 3 | 4 | Refactor inline style to var(--bg-*) or CSS class |
| `components/layout/SplashScreen.tsx` | 0 | 14 | 8 | 10 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Accounts/SessionManagerTable.tsx` | 14 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/Accounts/AccountLoginModal.tsx` | 19 | 0 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `pages/Accounts/index.tsx` | 0 | 46 | 34 | 52 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Accounts/AccountLoginWizard.tsx` | 0 | 33 | 23 | 29 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Automation/index.tsx` | 0 | 0 | 2 | 8 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Dashboard/index.tsx` | 0 | 1 | 2 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Profiles/index.tsx` | 0 | 0 | 1 | 5 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/Statistics/index.tsx` | 0 | 0 | 0 | 2 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/SessionLauncher/index.tsx` | 0 | 132 | 116 | 105 | Refactor inline style to var(--bg-*) or CSS class |
| `pages/ApiSetupScreen/index.tsx` | 0 | 67 | 79 | 64 | Refactor inline style to var(--bg-*) or CSS class |
| `lib/telegram/interaction/pathSearchParser.ts` | 0 | 1 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `lib/media/uploadThumbnailGenerator.ts` | 0 | 1 | 0 | 0 | Tailwind bridge & Semantic Token CSS |
| `features/remote-download/localDownloads.css` | 0 | 9 | 0 | 0 | Bridge to active :root custom properties |
| `stores/themePaletteStore.ts` | 0 | 337 | 90 | 0 | Tailwind bridge & Semantic Token CSS |
| `App.css` | 0 | 2993 | 2995 | 0 | Bridge to active :root custom properties |

## 3. Migration Strategy & Phase Order

1. **Universal Tailwind Semantic Bridging (Phase 2)**:
   Map `bg-slate-*`, `border-slate-*`, `text-slate-*` globally in `index.css` to active theme tokens (`--bg-card`, `--bg-main`, `--border-default`, `--text-primary`) so all 40+ nested components instantly adopt the active theme.
2. **Component Refactoring (Phase 3)**:
   Remove hardcoded inline styles in Cloud Drives, Media Players, Tools, and Settings.
3. **Theme Leakage Scanner (Phase 4)**:
   Register `npm run audit:theme` to enforce 0 forbidden static colors with whitelist annotations.
