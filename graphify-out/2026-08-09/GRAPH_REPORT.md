# Graph Report - AutoGram  (2026-08-09)

## Corpus Check
- 782 files · ~3,096,634 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 16894 nodes · 48493 edges · 919 communities (631 shown, 288 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 2280 edges (avg confidence: 0.68)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b5412bbe`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- frontend/src-tauri/src/lib.rs
- app_db.rs
- grammers_media.rs
- telegram_ops.rs
- paths.mjs
- CHANGELOG.md
- grammers_ops.rs
- job_queue.rs
- list_zip_sparse
- tg_log.rs
- path_policy.rs
- session_rate.rs
- stream_server.rs
- TgError
- secrets.rs
- jobs_db.rs
- allow
- telethon_session_import.rs
- SpeedTest.tsx
- network.rs
- drive_rpc.rs
- compilerOptions
- AutoGram App/src-tauri/tauri.conf.json
- DriveExplorer.tsx
- migration_run.rs
- get_connection
- DrivePreviewModal.tsx
- path_is_allowed
- JobRuntime.tsx
- DriveConfirmDialog.tsx
- dependencies
- devDependencies
- App.tsx
- DriveZipBrowser.tsx
- permissions
- tg_error.rs
- scripts
- AutoGram Project Rules
- test_34404_instant.mjs
- test_34404_v3.mjs
- automations_db.rs
- download_registry.rs
- profiles_db.rs
- test_media_specific.mjs
- DriveSidebar.tsx
- Bug Investigation
- goto_42794.mjs
- Topic invalid + initial sidebar/thumbnail load
- 3. Fitur Utama (Core Features)
- JobEditor.tsx
- wait_helpers.mjs
- Bug Investigation: Media Studio Deep Performance
- ProgressTracker
- TransferJournal
- db.py
- debug_42772_deep.mjs
- ensure-remote.ps1
- goto_42772.mjs
- goto_42772_robust.mjs
- frontend/e2e-cdp-smoke.mjs
- DriveToolsPanel.tsx
- stats_db.rs
- session_clone.rs
- probe_34404.cjs
- probe_34404_v2.cjs
- probe_34404_v3.cjs
- test_all_three_media.mjs
- Bug Investigation: Media Studio Transfer Session
- Hybrid Rust–Python Architecture (AutoGram)
- list_media_blocking_topic
- parse_moov_internal
- streaming_policy.rs
- compilerOptions
- AutoGram App/src-tauri/capabilities/default.json
- Media Studio initial-load investigation
- Bug Investigation: Preview Random Seek
- Thumbnail cold-load and pagination performance
- e2e-gudang-thumbs.mjs
- scripts
- .new
- AutoGram Remote (CDP)
- Bug Investigation: Native Account, Session, Document and Video Preview
- Session Isolation, Upload Limits, and Migration Scale
- Bug Investigation: Session + Stream/Buffer/Preview Conflicts
- Staged session bootstrap
- Bug: Video preview keeps reloading during buffer (multi-video)
- config_normalize.rs
- ProgressSnapshot
- input_injector.mjs
- Media count and storage accuracy investigation
- Buffer bar stuck + “Stream bermasalah”
- Rust + Grammers Backend (Force — no Telethon runtime)
- System Architecture
- Web deploy vs desktop (heavy features)
- Architecture Decision Record (ADR)
- Repository Governance
- Backup & Recovery Procedures
- Final Audit Report (v5.1.1)
- Development Roadmap
- Security Control Matrix
- Test Strategy
- Accounts.tsx
- VSCodeCodeViewer.tsx
- DriveTransferManager.tsx
- ReUploadBatchModal.tsx
- capability.rs
- media_meta.rs
- frontend/package.json
- FormGroups.tsx
- ZipErrorBoundary
- Settings.tsx
- inspect_cards.mjs
- inspect_full_dom.mjs
- probe_msg_73.mjs
- probe_thumb_73_detail.mjs
- v2.3.53 Optimasi Performa Cold Start, Speed Loading List Card & Thumbnail Bulk IDB Read, & Fix Thumbnail Dokumen/File
- v2.3.52 Universal Target-DC Parallel MTProto Download Pipeline & CDN Edge Routing
- v2.1.73 Upload UI → Rust Orchestrator Default + Full-Rust Scaffold
- v2.1.74 Grammers dual-path compile-fix + multi-layer debug logs
- v2.1.81 Stream cancel thrash + Grammers album
- v2.1.78 Phase 6 — Progressive stream + thumbs + topics (Grammers)
- v5.1.1 Improvement Report
- AutoGram frontend (Tauri + React + TypeScript)
- AppearanceSection.tsx
- main.tsx
- React + TypeScript + Vite
- probe_direct.mjs
- probe_dom.cjs
- v2.1.72 Phase 3 — Studio Job Queue di Rust (Python Step Upload)
- v2.1.70 Proxy/VPN dari Telegram-Drive + Telethon Hybrid
- v2.1.79 Fix video preview reload loop + stream hardening
- v2.1.67 Start Video Multi-Tier + Pratinjau Dokumen/Kode Cepat
- v2.1.77 Phase 5 — Drive dual-path list + Grammers download
- v2.1.80 Video play stuck + buffer speed (34.mp4 class)
- v2.1.69 Hybrid Phase 2 — Rust Stream Server + Local Utilities
- v2.1.76 Grammers-first studio orch (honest hybrid, not full cutover)
- v2.1.75 Fix overhead looping (preview poll + session ready)
- Data Flow & Execution Pipeline
- ProgressBar.tsx
- vite-env.d.ts
- safety-guard.js
- v2.3.4 Optimasi Kecepatan & Presisi Penghapusan Media (`SpeedTest.tsx`, `mediaStudioDb.ts`, `drive_rpc.rs`)
- v2.3.2 Optimalisasi Kecepatan & Instant Fast-Fail Penghapusan Media (`drive_rpc.rs`, `grammers_ops.rs`)
- v2.3.13 Optimasi Pengindeksan & Pratinjau ZIP Sparse (Zero Full-Download & Kuota Hemat)
- v2.3.38 Support Thumbnail Extraction & Auto-Sync untuk Link Post Telegram (`Media::WebPage`)
- v2.3.41 Dynamic 4MB MOOV Tail Scan & Instant Frame Play-Nudge Fix
- v2.3.8 Self-Healing Cache & Automatic Database Sync untuk Berkas Terhapus Telegram Server
- v2.3.17 Zero-Seek Central Directory Fast Parser (Optimasi ZIP 1GB+ Hanya ~512 KB & 100% Akurat)
- v2.3.26 Toolbar Tools Lengkap untuk Pratinjau Gambar di ZIP Browser
- v2.2.0 Alur Kerja Komprehensif Ekstraksi Arsip ZIP ke Drives & Telegram
- v2.1.96 Fitur Slider Pembatas Ukuran Cache & Fitur Pangkas Otomatis (Cache Limit Slider)
- v2.3.0 Migrasi Full 100% Grammers Rust Native MTProto (Zero-Python Engine)
- v2.3.40 Resolusi Konflik MTProto Rate Governance (ZIP Sparse vs Video Stream)
- v2.3.37 Comprehensive Thumbnail Debug Logging & Diagnostic Enhancements
- v2.3.11 100% Pure Rust MTProto Sparse ZIP Engine (<0.5s Indeks Load)
- v2.2.5 Arsitektur Dual-Mode Pengunduhan ZIP & Migrasi Grammers Rust MTProto
- v2.3.61 Fast 2MB Single-Pass Tail Scan & Rescue Loop Head-Tail MP4 Combination Patch
- v2.3.62 Dual-Track Parallel Concurrency & Ultra-Fast Image Thumbnail Response
- v2.3.20 Perluasan Pencarian Central Directory 4 MB & Eliminasi Total Iterasi Network Seeking di Fallback Path
- v2.3.22 Direct Offset Range Fetching & In-Memory ZIP Catalog Caching
- v2.3.47 Ultra-Instant <50ms Stream URL Return & Parallel Concurrent MOOV Tail Fetch
- v2.3.45 Ultra-Fast 1-Shot MOOV Tail Bootstrap & Adaptive Lightweight Buffer Pacing
- v2.3.18 Eliminasi Total Iterasi Network Seeking saat Pratinjau Media Tunggal (Memangkas Kuota Pratinjau dari 60 MB ke Tepat 9.22 MB)
- v2.3.29 Zero Re-Download ZIP Entry Preview Caching
- v2.1.82 Session & Chat List Load Speed Optimization
- v2.3.50 Smart Auto-Pruning Engine & Active File Lock Protection
- v2.3.16 Perbaikan Kritis Eliminasi Pengunduhan ZIP Berkas Penuh untuk Ukuran ≤ 500 MB
- v2.2.1 Integrasi Visual Transfer Manager saat Ekstraksi Arsip ZIP
- v2.3.10 Perbaikan Kritis ZIP Preview & Extraction Engine
- v2.3.54 Instant 0ms Progressive Blur Thumbnail Paint & Real-Time Streaming
- v2.3.49 Progressive Blur Placeholder — Thumbnail Instan Mode Seimbang/Jelas
- v2.3.34 Perbaikan Kritis Multi-DC FILE_MIGRATE (RPC Error 303) pada Navigasi Pratinjau ZIP & Media
- v2.3.1 Perbaikan Error Banner & Resets Loading State pada Penghapusan Media/Topik
- v2.3.5 Multi-Key Channel Resolution Cache (`grammers_ops.rs`)
- v2.3.14 Elevasi Z-Index Transfer Manager (Floating Progress Pill Over Modals)
- v2.3.30 Mouse Wheel Zoom, Double Click Zoom & Smooth Panning Drag pada ZIP Media Preview
- v2.3.48 Optimasi Kecepatan Load Daftar Media & Thumbnail Grid
- v2.3.15 Instant 0-ms ZIP Index Caching, Telegram Auto-Sync, & Universal VSCode Code Viewer
- v2.2.3 Pelimpahan Ekstraksi ZIP ke Engine Transfer Manager Pusat
- v2.2.2 Penggabungan Destinasi Terpadu & Badge Visual Gabungan
- v2.3.31 Redesain Visual Aksen Tombol Toolbar ZIP Workbench
- v2.2.4 Perbaikan Unduh Arsip ZIP ke Lokal & Integrasi Transfer Manager
- v2.3.23 Force Refresh Cache Invalidation, Base64 RAM Protection, & Batch Extract Cancellation
- v2.3.55 Dynamic 16MB Tail Scan for 2K/4K/AV1 Videos, Reverse moov Finder, & Silent FFmpeg Execution
- v2.3.68 Real-Time Video Thumbnail Frame Extraction, Multi-Timestamp Seek (2s/5s) & Solid Black Fallback Card Purge
- v2.3.57 Universal Document Thumbnail Sample Extraction & Instant HD Blur Resolution Patch
- v2.3.66 AV1 Video Thumbnail Fix — Hardware Acceleration Bypass, Larger Sample Budget & Graceful Degradation
- v2.3.65 Document Video Saver Mode Lightweight Extraction & Extended Magic Bytes Fallback Fix
- v2.3.3 Perbaikan Bug Kritis ReferenceError `requireGrammersIdentity` pada Penghapusan Media (`driveApi.ts`)
- v2.3.21 Perbaikan Kompilasi Rust (`TgErrorCode::Io` pada Penanganan Password ZIP)
- v2.3.39 Stream Auto-Pause Fix & Eliminasi Loop Reload Pemutar Video
- v2.3.36 Perbaikan Kritis Ekstraksi Frame Video MP4 (Faststart <= 2.5MB), Dynamic Recursive FFmpeg Search, & Fallback Layer Telegram
- v2.3.33 Fix Presisi Topic Mapping pada Ekstraksi ZIP Preview Modal
- v2.3.56 Reliable Message-ID Mapping & Truncated Faststart MP4 Header Patching
- v2.3.51 Auto-Resume Buffer & Smooth Video Player Recovery
- v2.3.27 Eliminasi Layar Hitam Blank saat Membuka ZIP Modal
- v2.1.97 Penguatan Fungsi Seluruh Tombol Manajemen Cache & Rust Disk Trimming
- v2.3.46 Dynamic 6MB MOOV Tail Bootstrap & Non-Corrupting Range Server Fallback
- v2.3.44 Eliminasi Port 0 & Service Worker Bypass untuk Server Stream Lokal
- v2.3.50 Perbaikan Regresi — Loading List Media Lambat (maxConcurrent & loadingMore)
- v2.3.28 Perbaikan Flexbox Layout Collapse pada ZIP Preview Container (100% Full-Bleed Workbench)
- v2.3.58 Non-Web Image Transcoding, Embedded PDF Cover Extraction & Document Thumbnail Guard Patch
- v2.3.60 Native WinRT PDF Page 1 Render, AV1/2K Video Rescue & Non-Zero FFmpeg Exit Frame Extraction
- v2.3.59 Native WinRT PDF Page 1 Render, AV1/2K Video Rescue & Non-Zero FFmpeg Exit Frame Extraction
- v2.3.67 PDF FFmpeg Bypass, Non-Media Document Filtering & Disk/Memory Negative Caching (.nothumb)
- v2.1.84 Perbaikan False FloodWait & Optimalisasi Kecepatan Pemuatan Media
- v2.1.85 Perbaikan Disconnect Loop & Handling FloodWait Telegram
- v2.1.99 Dukungan Tautan & WebPage Preview (`Media::WebPage` & Link Cards)
- v2.1.83 Penyelarasan Kualitas & Kerapian Thumbnail (Hemat, Seimbang, Jelas)
- v2.1.93 Perbaikan Race Condition & Stale Media Bleeding pada Perpindahan Antar Topik
- v2.1.95 Otomatisasi Penelusuran Topik Mendalam & Eviksi Cache Kosong Lapuk
- v2.1.100 Eliminasi Pembekuan Grid & Penyelarasan Perpindahan Topik UI
- v2.1.94 Perluasan Batas Pemindaian Pesan Topik (`scan_limit` 10.000 Pesan)
- v2.1.92 Perbaikan Rekonstruksi Faststart MP4 & Re-indexing Atom Chunk Offset
- v2.1.91 Autodeteksi Lokasi Biner FFmpeg Windows & Ekstraksi Frame Video Otomatis
- v2.1.90 Perbaikan Duplikasi Offset Chunk & Korupsi Header Sampel Media
- v2.1.89 Autodeteksi Magic-Bytes Media & Eliminasi Error 'No Valid Thumb'
- v2.1.88 Perbaikan Auto-Retry & State Lockout Thumbnail Kartu Grid
- v2.1.87 Perbaikan Decoding Thumbnail Foto/Gambar Document (>256KB)
- v2.1.86 Perbaikan Pemuatan Thumbnail Video MP4 Non-Faststart & Large Media
- v2.3.35 Eliminasi Clipping Paint Card & Optimalisasi Spacing Atas Grid Media Drive
- v2.1.98 Alignment Presisi 1:1 Knob Slider & Teks Label Ukuran Cache
- v2.3.24 Peningkatan Threshold Media Image 15 MB & Dedicated Card Component untuk Large Media
- v2.3.6 Preservasi Pesan Kesalahan IPC Telegram API (`telegramBackend.ts`, `driveApi.ts`)
- v2.3.19 Eliminasi Total Background Pre-fetching Berkas Tetangga pada Modal Pratinjau ZIP & Dokumen
- v2.3.32 Serialized Request Lock, Stale Cancellation & Stream Auto-Stop (Proteksi Total FloodWait)
- v2.3.25 Redesain Modern Glassmorphic Encrypted ZIP Card UI
- v2.3.7 Perbaikan Kritis Pendaftaran Izin Tauri IPC Command (`autogram-commands.toml`)
- v2.3.9 Pure Rust + Grammers Engine ZIP Preview & Single-Entry Extraction
- v2.3.42 Fast MOOV Tail Bootstrap & Instant Video Start Fix
- v2.3.12 100% Pure Rust Virtual MTProto Sparse Reader (`TelegramSparseReader`)
- migrations/README.md
- database/README.md
- AUDIT_NOTES.md
- System_Component_Map.md
- Telegram_Core_Architecture.md
- Developer_Guide.md
- MERGE_AUDIT_REPORT_v5_1_1.md
- MERGE_HISTORY.md
- MERGE_HISTORY_v5_1_1.md
- Telegram_Session_Security.md
- i18next
- pdfjs-dist
- react-i18next
- TopBarBreadcrumbs.tsx
- migration_run.rs
- @tauri-apps/plugin-fs
- @tauri-apps/plugin-shell
- AutoGram App/src-tauri/build.rs
- ImageViewer.tsx
- AutoGram App/src-tauri/src/main.rs
- TopBarSearchFilter.tsx
- MicroProgressBar
- create_execution
- ModernProgressBar
- remote/e2e-cdp-smoke.mjs
- MediaStudioFilterTabs.tsx
- SidebarCategoryList.tsx
- SidebarQuickLinks.tsx
- SidebarStorageGauge.tsx
- MediaStudioBatchActionBar.tsx
- MediaStudioHeader.tsx
- react-phone-number-input
- @tauri-apps/api
- @tauri-apps/plugin-fs
- @tauri-apps/plugin-shell
- types.ts
- assert
- .getCurrentDirectory
- combinePaths
- getNextInvalidatedProjectCreateInfo
- startsWith
- README.md
- probe_thumb_files.mjs
- probe_thumbs_diag.mjs
- MicroProgressBar
- ModernProgressBar
- hasProperty
- stats_db.rs
- v2.3.71 Export clearThumbCache, Post-Wipe Global Auto-Refetch Event & Collision-Free FFmpeg Temp File Paths
- log_duplicates_batch
- v2.3.78 Multi-Decoder CPU Software Fallback (`libdav1d` / `av1`) & Head Rescue Loop
- MediaHeaderToolbar.tsx
- pdfjs-dist
- MediaStudioToolbar.tsx
- skipTrivia
- v2.3.75 Full Uncorrupted Faststart MP4 Reconstruction & Fault-Tolerant FFmpeg Extraction
- @tauri-apps/plugin-dialog
- media_prep.rs
- JSDocContainer
- getEmitScriptTarget
- Node
- LanguageService
- DeadCenterProgress
- .getStart
- findAncestor
- ZipErrorBoundary
- MediaAudioPlayer.tsx
- MediaVideoPlayer.tsx
- useMediaStudioKeybindings.ts
- parseClassElement
- parseAssignmentExpressionOrHigher
- withJSDoc
- DuplicatesTab.tsx
- SpaceUsageTab.tsx
- JobFilterSettings.tsx
- JobSourceTargetConfig.tsx
- AccountLoginModal.tsx
- SessionManagerTable.tsx
- arrayFrom
- createIdentifier
- startsWith
- getInfo
- parseExpected
- ErrorClass
- parseAssignmentExpressionOrHigher
- getContextualType
- Scanner
- Type
- ProgramHost
- .replaceNode
- extractFunctionInScope
- skipTrivia
- createIdentifier
- firstDefined
- .isStringLiteral
- getDirectoryPath
- createSolutionBuilderWorker
- TypeChecker
- push
- .add
- parseOptional
- .getLineAndCharacterOfPosition
- tokenToString
- createProgram
- .trace
- fileExtensionIs
- isIdentifier
- .has
- getEffectiveTypeParameterDeclarations
- studio_orch.rs
- store.rs
- getCompletionEntriesForNonRelativeModules
- TypeObject
- tokenToString
- enableDebugInfo
- isBinaryExpression
- .transformSourceFile
- parseConfig
- isPropertyAccessExpression
- contains
- doAddExistingFix
- .forEach
- isPropertyAccessExpression
- .getLineAndCharacterOfPosition
- getFirstJSDocTag
- getOrCreateEmitNode
- getNewFileImportsAndAddExportInOldFile
- getEmitFlags
- .forEach
- getSourceFileOfNode
- TopicMediaError
- createNodeArray
- LanguageServiceHost
- getEmitFlags
- hasSyntacticModifier
- .getSourceFile
- getEmitModuleKind
- AutoGramSplitManifest
- getAllRules
- isAssignmentOperator
- createNodeArray
- visitNode
- isBinaryExpression
- getAllRules
- tryCast
- displayPart
- checkDefined
- getDocumentationComment
- .getChildren
- isAssignmentOperator
- getOrCreateEmitNode
- isPropertyDeclaration
- flattenDestructuringAssignment
- transformCallbackArgument
- getRangeToExtract
- createTextSpan
- getDirectoryPath
- doChangeNamedToNamespaceOrDefault
- some
- isStringLiteralLike
- DuplicateChecker
- StorageError
- addNewNodeForMemberSymbol
- getCompletionData
- breakIntoSpans
- getFunctionOrClassName
- CompilerHost
- System
- t
- flattenDestructuringBinding
- quality.rs
- isSourceFile
- .getChildren
- createTypeChecker
- doChange
- enableDebugInfo
- computeModuleSpecifiers
- createCompletionEntry
- LanguageServiceShimHostAdapter
- isIdentifier
- download.rs
- transfer/mod.rs
- Expression
- Program
- mapDefined
- getSymbolDisplayPartsDocumentationAndSymbolKind
- assert
- patchNodeFactory
- isWhiteSpaceLike
- session_guard.rs
- models.rs
- some
- breakIntoSpans
- hasProperty
- AccountCapability
- transformNodes
- Statement
- ReadonlyESMap
- hasSyntacticModifier
- visitNode
- getCompletionEntryCodeActionsAndSourceDisplay
- createPrinter
- isStringOrNumericLiteralLike
- getAssignmentDeclarationKindWorker
- album.rs
- TopicMediaService
- patchNodeFactory
- .getSourceFile
- convertEntryToCallSite
- isVariableDeclaration
- caption.rs
- 4.10.3050.1/manifest.json
- p
- createGetSymbolAccessibilityDiagnosticForNode
- MemberExpression
- getAdjustedLocation
- getAssignmentDeclarationKindWorker
- getReferencesAtLocation
- isBindingElement
- TypeObject
- MTProtoRangeReader
- MediaAnalysis
- isConstructorDeclaration
- getNodeKind
- getSymbolDisplayPartsDocumentationAndSymbolKind
- getEmitModuleResolutionKind
- mapDefined
- getFirstJSDocTag
- babylon.js
- addChildrenRecursively
- isArrowFunction
- BuildInvalidedProject
- isCallExpression
- makeChange
- transformCallbackArgument
- createGetSymbolAccessibilityDiagnosticForNode
- resolveTypeReferenceDirective
- idText
- getDefinitionAtPosition
- isValidCallHierarchyDeclaration
- getDocumentationComment
- batch_optimizer.rs
- getHighlightSpans
- getRangeToExtract
- .delete
- computeSuggestionDiagnostics
- JSDocTag
- getHighlightSpans
- toPath
- getNewImportFixes
- fail
- addRange
- isWhiteSpaceLike
- isBlock
- addChildrenRecursively
- isAssignmentExpression
- assertIsDefined
- displayPart
- isExpressionNode
- resolve_thumbnail_strategy
- getNodeKind
- getMeaningFromLocation
- every
- getSourceFileOfNode
- createCompletionEntry
- isQualifiedName
- getEmitModuleKind
- BuilderProgram
- find
- isPropertyAssignment
- isExpressionStatement
- isFunctionLike
- getEffectiveTypeParameterDeclarations
- 2. 16 Detail Mikro Teknis & Trik Arsitektur Berdampak Besar (Micro-Technical Nuances & High-Impact Details)
- doc_preview.rs
- assertNever
- getNextInvalidatedProjectCreateInfo
- formatSyntaxKind
- getSymbolScope
- convertEntryToCallSite
- idText
- isRequireCall
- getDefinitionAtPosition
- getTypescriptKeywordCompletions
- NodeObject
- pop
- getLocaleSpecificMessage
- isImportSpecifier
- getContextualType
- getAdjustedLocation
- NodeObject
- EncoderQualityProfile
- build_quality_preflight
- SmartScanner
- get_cached_page
- assertIsDefined
- length
- .test
- compareValues
- isExpression
- AutoGram Master Architecture, WorkTree & Operational Workflow Specification
- encoder_provider.rs
- DesktopResourceProvider
- UploadResumeState
- renameCollidingVarNames
- getInfo
- createPrinter
- isFixablePromiseHandler
- .getLineStarts
- clear
- getJSDocTagsWorker
- FormattingContext
- getTypescriptKeywordCompletions
- DesktopNetworkProvider
- tg_load_more_topic_media
- FloodWaitGateController
- DevToolsPlugin.js
- .forEachChild
- compareValues
- continuePreviousIncompleteResponse
- setTextRange
- tokenIsIdentifierOrKeyword
- fail
- getEditsForToTemplateLiteral
- setTextRange
- sort
- InFlightTracker
- message_to_topic_media_item
- createRulesMap
- isBindingElement
- clear
- contains
- getEmitScriptTarget
- getDeclarationFromName
- createRulesMap
- optionsHaveChanges
- every
- MoovSidecarManager
- getSelectionChildren
- append
- createDocumentRegistryInternal
- getReferencedSymbolsForSymbol
- parseUpdateExpression
- LanguageServiceShimHostAdapter
- Apache License 2.0 (Apache)
- addImplementationReferences
- getSelectionChildren
- isModuleDeclaration
- getRefactorEditsToRemoveFunctionBraces
- AutoGram v4 Completion Audit
- SmartThrottle
- 4. Spesifikasi & Workflow 10 Kategori Fitur Utama (Deep-Dive)
- 5. Registrasi Command Tauri (85+ Commands — `lib.rs`)
- Quality Engine v4 Baseline Audit
- StorageBudget
- search_topic_media
- diag_stream_1869.mjs
- getContainingNodeArray
- textSpanEnd
- canHaveModifiers
- completionInfoFromData
- .getSemanticDiagnostics
- tryGetValueFromType
- PerDirectoryResolutionCache
- FormattingContext
- getTextOfIdentifierOrLiteral
- getObjectFlags
- organizeImports
- isFunctionExpression
- convertToAsyncFunction
- CoreServicesShimObject
- TypeScriptServicesFactory
- forEachImport
- getDefaultLikeExportNameFromDeclaration
- JobStatus
- media_statistics.rs
- MemoryThumbCache
- RangeCache
- .read_tail
- remote/e2e-cdp-smoke.mjs
- addImplementationReferences
- computePositionOfLineAndCharacter
- getSymbolCompletionFromEntryId
- createWriter
- getRenameInfoForNode
- getSynthesizedDeepCloneWorker
- collectCallSites
- compareModuleSpecifiers
- eachExportReference
- .toString
- findChildOfKind
- flatten
- getCompletionEntriesFromSymbols
- getScriptTransformers
- parseObjectBindingElement
- TransferProgressStore
- worker_pool.rs
- cast
- .getLineStarts
- assertDiagnosticLocation
- getThrowOccurrences
- getNavigateToItems
- compareStringsCaseSensitive
- getStringLiteralCompletions
- .getCurrentSourceFile
- ProjectResponse
- FlowNodeBase
- isPartOfTypeNode
- isFunctionLikeKind
- isBeforeBlockContext
- TypeScriptServicesFactory
- .forEachChild
- getNavigateToItems
- .throwIfCancellationRequested
- getContainingNodeArray
- isParameter
- getGroupedReferences
- isFunctionLikeKind
- MediaFingerprint
- 135.0.3176.0_0/manifest.json
- getReferencesAtLocation
- .throwIfCancellationRequested
- canReuseNode
- getFixInfo
- isTemplateLiteralKind
- getImplementationsAtPosition
- SourceFile
- Signature
- isVariableDeclarationInitializedToBareOrAccessedRequire
- getNodeId
- assertDiagnosticLocation
- canReuseNode
- coalesceImports
- parseComparator
- createNewParameters
- newFileChangesWorker
- getPossibleGenericSignatures
- AutoGram Spec v4 Implementation Log
- Media Studio, ZIP, Drive Tools, and thumbnail investigation
- 9. 5 Diagram Sequence Mermaid Komprehensif
- Transfer v4 Regression Report
- BandwidthController
- SessionMetadata
- SchedulerMetrics
- AdaptiveBackoff
- attachFlowNodeDebugInfoWorker
- updateSourceFile
- extendToAffectedRange
- collectCallSites
- parseComparator
- DocumentSpan
- ModeAwareCache
- Symbol
- processPragmasIntoFields
- isValidFunctionDeclaration
- isGeneratedPrivateIdentifier
- 113.0.1765.0_0/manifest.json
- attachFlowNodeDebugInfoWorker
- processTaggedTemplateExpression
- mayDeleteExpression
- getAllSupers
- isGeneratedPrivateIdentifier
- SignatureObject
- Media Studio context leak and viewport thumbnail loop — 2026-08-01
- v2.7.4 Transfer Progress Sync & Overall Percent Reducer Fix
- 7. Pipeline Thumbnail — 5 Tier (thumbs.rs + thumbBatcher.ts)
- ResourceScheduler
- FloodWaitState
- core/capability.rs
- commandLineOptionsToMap
- createPropertyNameFromSymbol
- TextRange
- SolutionBuilder
- Watch
- updateErrorForNoInputFiles
- isExecutableStatement
- getPossibleExtractions
- getNewImportFixes
- isFunctionLikeDeclaration
- append
- getSymbolId
- flattenDestructuringAssignment
- isVariableDeclarationInitializedToBareOrAccessedRequire
- walkUpParenthesizedExpressions
- v2.7.0 Canonical Media Identity Architecture, Peer Propagation, Guard Engine & Vite Warning Fix
- 10. Spesifikasi Database & Storage (SQLite `autogram.db` & IndexedDB `mediaStudioDb`)
- TransferPolicy
- save_thumbnail_atomic
- typescript-tsconfig.json
- run_real_seeking_suite.mjs
- propagateChildFlags
- flattenDestructuringBinding
- TypePredicateBase
- IScriptSnapshot
- PrintHandlers
- escapeNonAsciiString
- findOwnConstructorReferences
- getEncodedRootLength
- isDeclarationStatementKind
- addEs6Export
- propagateChildFlags
- skipAlias
- getEffectiveTypeAnnotationNode
- getEncodedRootLength
- getMeaningFromDeclaration
- isBeforeBlockContext
- isDeclarationStatementKind
- isValidTypeOnlyAliasUseSite
- 10.34.0.84/manifest.json
- v2.7.6 Video Thumbnail Generation & Smart Hardware GPU Allocation Engine
- 3. Peta WorkTree Repository Utuh & Exhaustive Directory Map
- MediaAnalyzer
- classify_media_item
- select_best_video_frame_candidate
- audit_all_cards.mjs
- deep_inspect.mjs
- inspect_aspect_ratio.mjs
- inspect_channel_73.mjs
- inspect_dom.mjs
- inspect_gudang_cards.mjs
- nav_inspect.mjs
- screenshot_inspect.mjs
- test_10_videos_seek.mjs
- test_media_73_random_seeks.mjs
- test_topic_interactive.mjs
- test_topic_navigation.mjs
- 1.0.0.12/manifest.json
- 6498.2025.9.4/manifest.json
- newFileChangesWorker
- createClassifier
- compareWithCallback
- convertReExportAll
- getDirectImportsMap
- FormatDiagnosticsHost
- IncompleteCompletionsCache
- ReadBuildProgramHost
- getSerializedCompilerOption
- .TokensAreOnSameLine
- nodeOverlapsWithStartEnd
- SourceFileObject
- StringScriptSnapshot
- createClassifier
- compareWithCallback
- convertReExportAll
- elementAt
- getSerializedCompilerOption
- .TokensAreOnSameLine
- tryRemovePrefix
- unorderedRemoveItem
- StringScriptSnapshot
- 120.0.6050.0/manifest.json
- 46.0.0.0/manifest.json
- 1.15.0.1/manifest.json
- adblock_snippet.js
- 2026.3.23.1/manifest.json
- v2.6.0 High-Priority Preview Resilience Engine & Media Classification Architecture
- v2.4.6 Terminal Non-Thumb Blacklist Eviction & Detailed Multi-Layer Logging
- v2.4.0 Smart Thumbnail Architecture & Multi-Tier Progressive Preview Engine
- v2.8.2 Album Send Result Mapping, History Recovery & Transfer Manager Debug Log Engine
- v2.7.7 Dynamic Re-encoded File Size Sync & Progress Overflow Fix
- v2.4.4 Queue Concurrency Deadlock Prevention & FFmpeg 3s Timeout Protection
- v2.5.5 Post-Wipe Terminal Cache Eviction & Automatic Viewport Refetch Engine
- v2.5.7 Asynchronous Tier-2 Video Thumbnail Delegation & Non-Blocking Batch Dispatcher
- v2.5.8 Smart FLOOD_PREMIUM_WAIT Handler & Range Bridge Auto-Recovery Engine
- v2.5.6 Smart Viewport Priority Elevation & Immediate Scroll Thumbnail Scheduler Engine
- v2.4.5 LIFO Viewport Priority Scheduler & Video Document Static Thumbnail Engine
- v2.4.1 Concurrent Batch Downloads & Session-Agnostic Mini-Thumb Fallback
- 6. Spesifikasi Buffer, Stream, Seek & moov Engine (Deep Technical Spec)
- DownloadProgress.tsx
- MediaAnalysisResult
- find_autogram_cdp.mjs
- inspect_live_dom.mjs
- isProgramUptoDate
- flatMapIterator
- getExpandedCharCodes
- compose
- computeSignatureWithDiagnostics
- CancellationToken
- Classifier
- PerModuleNameCache
- decodedTextSpanIntersectsWith
- encodeJsxCharacterEntity
- extensionIsTS
- getBinderAndCheckerDiagnosticsOfFile
- formatAlternative
- getContainingObjectLiteralElementWorker
- getExternalModuleNameLiteral
- onWatchedFileStat
- getMappedLocation
- mangleScopedPackageName
- isAnyDirectorySeparator
- isLiteralExpression
- isNamespaceReference
- isNotEmittedOrPartiallyEmittedNode
- orderedRemoveItem
- parseBuildCommand
- textSpanIntersection
- 0.0.1.7/manifest.json
- v2.3.79 Telegram-Drive Instant Local-First Media Load & Non-Blocking Background Sync
- v2.6.1 Media Preview Modal Sizing, Degraded State Warning Badge, Metadata Audit & Resilient Retry Engine
- v2.5.10 Active Socket Invalidation & Fresh MTProto Reconnect Engine
- v2.5.9 Resilient Media Preview Auto-Retry Engine
- v2.5.4 Canvas Event Key Alignment & Automatic Preview Frame Dispatcher
- v2.3.97 Capability-Gated FFmpeg Resolver, Dynamic AV1 Decoder Selection, In-Flight Request Coalescing & Atomic Negative Cache
- v2.3.98 End-to-End Media Identity Pipeline, Strict Identity Validation, Non-Positional Batch Matching & Cache Versioning
- v2.7.1 Automatic Document Video Attribute Detection & Progressive Streaming Engine
- v2.7.8 Universal Document Thumbnail & Video Attribute Support Across All Modes
- v2.3.89 Ultimate End-to-End Architecture & Multi-Workflow Master Specification
- v2.3.80 Telegram-Drive Instant Topic Media Render & Unblocked Local Cache Query
- v2.3.81 Zero-Bleed Instant Switch & Ultra-Fast Realtime Server Head Sync
- v2.3.85 Eliminate All-Media Topic Leakage & Enforce Topic-Scoped Local Cache
- v2.5.1 Guaranteed Video Poster Engine & Extended Range Bridge Probe
- v2.8.1 Realtime Transfer Manager Album & Photo Upload Progress Engine
- v2.3.96 Seekable Local HTTP Range Bridge, AV1 Software Decoder Bypass & Stderr Log Spam Elimination
- v2.4.3 Native Telegram Direct Static Thumbnail Pipeline & Ultra-Fast Media Engine
- v2.5.3 Isolated Last-Resort Video Canvas Frame Capturer
- v2.8.7 Smart 3x3 Grid Album Chunking Engine (Max 9 Per Album)
- v2.3.87 Proactive Infinite Scroll & Fast Streaming Pagination
- v2.3.88 Master Architecture & Workflow Specification
- v2.3.95 Instant Stripped Mini-Thumbs, Unpaused Thumbnail Batcher & High-Throughput RPC Pipeline
- v2.8.5 Partial Album Recovery Engine & Accurate Item Status Mapping
- v2.3.92 Ultimate All-Inclusive Architecture, WorkTree, Mermaid Diagrams & Operational Scenarios Specification
- v2.3.83 Restore App Load React Imports & Safe Topic Media Integration
- v2.8.4 Forum Topic Album History Recovery Engine & GroupedID Matching
- v2.3.94 Absolute Definitive Master Specification with Agent Standards & 16-Skill Pack Matrix
- v2.3.90 Granular Functional Matrix & Master Architecture Specification
- v2.3.93 100% Exhaustive 51-File Master Architecture & Workflow Specification
- v2.8.6 Universal Forum Topic Album Routing & Automatic Single Fallback Retry Engine
- v2.3.91 Definitive Master Architecture, Exhaustive WorkTree & Real-World Workflows Specification
- v2.8.3 Album Commit Phase State Engine & ReferenceError Fix
- v2.3.86 Fix Rust TL Message Mapping & Clean Cargo Build
- v2.7.2 Video Seek Buffer Fix — 5 Bug Race Condition Streaming Engine
- v2.3.84 MTProto Topic Media Fast Search & Card Restoration
- v2.3.82 Secure Local-First Topic Media Architecture & Multi-Lane MTProto Engine
- v2.3.99 Request Correlation ID Pipeline, Explicit Canonical Locator Naming, Media Source Identity Auditing & Debug Command
- v2.5.0 Dual-Tier Asynchronous Special Media Thumbnail Handler
- v2.8.0 Platform-Independent Production Reliability Engine (Architecture Hardening Edition)
- v2.4.2 Accurate Telegram Photo Size Extraction Engine
- v2.7.5 Smart Thumbnail Auto-Reload System
- v2.5.2 Universal Media Background Processor & Guaranteed Poster Delivery
- queue.rs
- BuilderProgramHost
- FileWatcher
- HostCancellationToken
- Iterator
- Push
- ResolveProjectReferencePathHost
- SourceFileLike
- SourceMapSource

## God Nodes (most connected - your core abstractions)
1. `NodeFactory` - 430 edges
2. `createNodeFactory()` - 371 edges
3. `createNodeFactory()` - 371 edges
4. `push()` - 225 edges
5. `push()` - 225 edges
6. `assert()` - 170 edges
7. `assert()` - 170 edges
8. `isIdentifier()` - 156 edges
9. `isIdentifier()` - 156 edges
10. `finishNode()` - 151 edges

## Surprising Connections (you probably didn't know these)
- `TransferOrchestrationSettings()` --indirect_call--> `value()`  [INFERRED]
  AutoGram App/frontend/src/components/drive/Transfers/TransferOrchestrationSettings.tsx → remote/.webview2_data/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js
- `TelegramDuplicateThumb()` --indirect_call--> `value()`  [INFERRED]
  AutoGram App/frontend/src/components/drive/Transfers/TransferPreflightDialog.tsx → remote/.webview2_data/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js
- `Profiles()` --indirect_call--> `p()`  [INFERRED]
  AutoGram App/frontend/src/pages/Profiles/index.tsx → remote/.webview2_data/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js
- `JobEditor()` --indirect_call--> `v()`  [INFERRED]
  AutoGram App/frontend/src/components/Jobs/JobEditor/index.tsx → remote/.webview2_data/EBWebView/Default/Extensions/kfbdpdaobnofkbopebjglnaadopfikhh/113.0.1765.0_0/third_party/babylon/babylon.js
- `JobDetailsModal()` --indirect_call--> `value()`  [INFERRED]
  AutoGram App/frontend/src/components/Jobs/Modals/JobDetailsModal.tsx → remote/.webview2_data/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js

## Import Cycles
- None detected.

## Communities (919 total, 288 thin omitted)

### Community 0 - "frontend/src-tauri/src/lib.rs"
Cohesion: 0.04
Nodes (134): acquire_session_lease_inner(), acquire_worker_session_lease(), autogram_get_account_scores(), autogram_get_hardware_profiles(), autogram_get_job_events(), autogram_plan_batch(), autogram_run_container_repair(), automations_delete() (+126 more)

### Community 1 - "app_db.rs"
Cohesion: 0.18
Nodes (30): clear_duplicate_history_for_target(), create_transfer_state(), delete_duplicate_by_message_id(), delete_session(), ensure_schema_extended(), get_duplicate_message_id(), get_duplicate_message_ids_batch(), get_session() (+22 more)

### Community 2 - "grammers_media.rs"
Cohesion: 0.07
Nodes (61): cache_root(), now_ms(), preview_dir(), PathBuf, thumb_dir(), classify_document_media(), classify_media_preview(), classify_message_media() (+53 more)

### Community 3 - "telegram_ops.rs"
Cohesion: 0.07
Nodes (87): TopicOpResult, active_ops(), active_streams_map(), active_telegram_backend(), AuthStatus, AvatarsBatchRequest, backend_status(), backend_status_lists_grammers_ops() (+79 more)

### Community 4 - "paths.mjs"
Cohesion: 0.19
Nodes (20): checkHealth(), fetchOk(), waitForHealthy(), lines, log, logFile, write(), diagnosePage() (+12 more)

### Community 5 - "CHANGELOG.md"
Cohesion: 0.03
Nodes (75): Optimalisasi Responsivitas & Paralelisme Grid Media (`grammers_media.rs`, `devicePerformance.ts`), Optimasi Pemuatan List Card, Thumbnail 2-Stage & Isolasi Konteks Presisi (`thumbBatcher.ts`, `DriveExplorer.tsx`, `driveFilesApi.ts`), Penghapusan Tombol Magnifier (`DrivePreviewModal/index.tsx`), v2.1.0 Foundation & Merged Repository, v2.1.10 Perbaikan Akurasi Pengurutan Terlama & Sinkronisasi State Filter, v2.1.11 Perbaikan Galat Indeks Pengindeksan Media & Kestabilan Indikator Koneksi, v2.1.12 Optimasi Dinamis Buffering & Kecepatan Streaming Berkas Besar (>1GB), v2.1.13 Perbaikan Error 'MTProtoSender' Object Is Not Callable untuk Pratinjau Berkas Lintas DC (>2GB) (+67 more)

### Community 6 - "grammers_ops.rs"
Cohesion: 0.00
Nodes (229): attachNodeArrayDebugInfo(), attachNodeArrayDebugInfoWorker(), canBeConvertedToClass(), canFollow(), canPrefix(), cartesianProduct(), cartesianProductWorker(), clearAffectedFilesPendingEmit() (+221 more)

### Community 7 - "job_queue.rs"
Cohesion: 0.13
Nodes (32): cancel_transfer(), cancelled_set(), clear_all_cancel_flags(), clear_cancel_flag_for(), create_and_update_item(), create_transfer(), CreateFileEntry, get_transfer() (+24 more)

### Community 8 - "list_zip_sparse"
Cohesion: 0.09
Nodes (18): DriveExplorer(), DriveGridRow, DriveGridRowProps, Props, DriveFileCard, Props, DriveFileListItem, Props (+10 more)

### Community 9 - "tg_log.rs"
Cohesion: 0.06
Nodes (39): AsRef, oversized_policy_is_isolated_from_normal_preview(), policy_for_size(), ProgressiveStartupPolicy, fetch_range_bytes(), parse_range(), RangeBridgeHandle, Arc (+31 more)

### Community 10 - "path_policy.rs"
Cohesion: 0.19
Nodes (14): FileHashResult, hashes_small_file(), quick_fingerprint(), Result, sha256_file(), assert_safe_transfer_path(), has_blocked_substr(), has_traversal() (+6 more)

### Community 11 - "session_rate.rs"
Cohesion: 0.13
Nodes (34): acquire_media_slot(), acquire_preview_slot(), begin_preview_flight(), end_preview_flight(), ensure_not_flooded(), flood_remaining_secs(), non_flood_errors_do_not_trigger_flood_wait(), note_error() (+26 more)

### Community 12 - "stream_server.rs"
Cohesion: 0.10
Nodes (48): stream_entry_is_active(), bounded_response_end(), clear_all_entries(), contiguous_end_from(), contiguous_from_zero(), cors_headers(), DemandRangeReader, ensure_started() (+40 more)

### Community 13 - "TgError"
Cohesion: 0.15
Nodes (38): AsyncRead, AlbumUploadFile, download_file_blocking(), DownloadFileResult, DownloadPolicyRequest, infer_mime_type(), is_real_photo(), map_album_random_ids() (+30 more)

### Community 14 - "secrets.rs"
Cohesion: 0.23
Nodes (33): decode_key_b64(), decrypt_map(), decrypt_map_or_recover(), delete_credential(), delete_worker_temp_file(), encrypt_map(), ensure_secure_dirs(), get_credential() (+25 more)

### Community 15 - "jobs_db.rs"
Cohesion: 0.08
Nodes (67): resolve_sessions_dir(), sessions_dir_nonempty(), cache_accounted_file_size(), cache_limit_bytes(), cache_operation_lock(), cache_roots(), CacheDirInfo, calculate_cache_size() (+59 more)

### Community 16 - "allow"
Cohesion: 0.06
Nodes (33): app, security, windows, enable, scope, build, beforeBuildCommand, beforeDevCommand (+25 more)

### Community 17 - "telethon_session_import.rs"
Cohesion: 0.05
Nodes (93): DcConnectionInfo, CachedLiveClient, connect_client(), disconnect_cached_session(), get_cached_user_profile(), live_clients(), purge_inactive_sessions(), Arc (+85 more)

### Community 18 - "SpeedTest.tsx"
Cohesion: 0.05
Nodes (43): 1. Logo Cover, 1. Monogram + Meaning, 2 × 3 REFERENCE-STYLE LAYOUT, 2. Logo Construction, 2. Product Action, 3. Digital Application, 3. Metaphor Fusion, 4. Brand Essence (+35 more)

### Community 19 - "network.rs"
Cohesion: 0.15
Nodes (26): apply_all(), apply_proxy(), apply_vpn(), clamp_vpn(), clamp_vpn_bounds(), connect_timeout_secs(), init_config_path(), is_network_available() (+18 more)

### Community 20 - "drive_rpc.rs"
Cohesion: 0.06
Nodes (96): avatars_batch_blocking(), AvatarsBatchResult, channel_peer_id_from_bare(), chats_from_updates(), compose_folder_about(), create_folder_blocking(), create_topic_blocking(), delete_folder_blocking() (+88 more)

### Community 21 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 22 - "AutoGram App/src-tauri/tauri.conf.json"
Cohesion: 0.09
Nodes (49): cache_scope_is_stable_and_session_isolated(), cancel_flags(), cancel_progressive(), clear_runtime_preview_cache(), data_url_jpeg_header(), find_cached_preview_file(), find_missing_offset_from(), first_missing_offset() (+41 more)

### Community 23 - "DriveExplorer.tsx"
Cohesion: 0.00
Nodes (627): accessKind(), addInitializer(), addRule(), aggregateChildData(), aggregateChildrenFlags(), areSameModule(), arrayIsEqualTo(), assign() (+619 more)

### Community 25 - "get_connection"
Cohesion: 0.24
Nodes (6): Into, Option, Result, Self, TransferStateConfig, TransferStateManager

### Community 26 - "DrivePreviewModal.tsx"
Cohesion: 0.01
Nodes (387): AbstractKeyword, AccessExpression, AccessibilityModifier, AccessorDeclaration, AccessorKeyword, ActionInvalidate, ActionPackageInstalled, ActionSet (+379 more)

### Community 27 - "path_is_allowed"
Cohesion: 0.42
Nodes (16): allowed_roots(), cache_file_ready(), copy_cache_file(), open_path_safe(), open_with_dialog(), path_is_allowed(), path_looks_like_cache(), resolve_worker_root() (+8 more)

### Community 28 - "JobRuntime.tsx"
Cohesion: 0.09
Nodes (21): InfoTooltip(), Select(), SelectOption, SelectProps, JobEditor(), CaptionModal(), CaptionModalProps, parseTelegramMarkdown() (+13 more)

### Community 29 - "DriveConfirmDialog.tsx"
Cohesion: 0.17
Nodes (3): DriveSidebarProps, DropRowProps, TELEGRAM_FOLDER_COLORS

### Community 30 - "dependencies"
Cohesion: 0.07
Nodes (29): dependencies, i18next, i18next-browser-languagedetector, lucide-react, pdfjs-dist, react-dom, react-i18next, react-phone-number-input (+21 more)

### Community 31 - "devDependencies"
Cohesion: 0.06
Nodes (30): devDependencies, playwright, @tauri-apps/cli, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react (+22 more)

### Community 33 - "DriveZipBrowser.tsx"
Cohesion: 0.06
Nodes (41): DuplicateContextInfo, DriveConfirmState, DriveContextMenu(), DriveContextMenuTarget, DriveLocationKind, Props, DriveDestChoice, DriveDestinationPicker() (+33 more)

### Community 34 - "permissions"
Cohesion: 0.12
Nodes (16): description, identifier, permissions, remote, urls, $schema, windows, allow-custom-commands (+8 more)

### Community 35 - "tg_error.rs"
Cohesion: 0.01
Nodes (6): createNodeConverters(), createNodeFactory(), createParenthesizerRules(), createNodeConverters(), createNodeFactory(), createParenthesizerRules()

### Community 36 - "scripts"
Cohesion: 0.12
Nodes (16): dependencies, ws, description, name, private, scripts, build:exe, ensure (+8 more)

### Community 37 - "AutoGram Project Rules"
Cohesion: 0.12
Nodes (16): Architecture (Tauri + React + Rust) — Grammers-only MTProto, AutoGram Project Rules, Commits, Database, Default workflows (skills), Deploy / Netlify, Done criteria, Duplicate prevention (+8 more)

### Community 38 - "test_34404_instant.mjs"
Cohesion: 0.30
Nodes (15): errLog(), httpGet(), js(), log(), main(), note(), ok(), openCDP() (+7 more)

### Community 39 - "test_34404_v3.mjs"
Cohesion: 0.30
Nodes (15): errL(), httpGet(), js(), log(), main(), note(), ok(), openCDP() (+7 more)

### Community 42 - "profiles_db.rs"
Cohesion: 0.06
Nodes (57): addNodeOutliningSpans(), addOutliningForLeadingCommentsForNode(), addOutliningForLeadingCommentsForPos(), addRegionOutliningSpans(), binarySearchKey(), collectElements(), collectTokens(), createDefinitionInfoFromName() (+49 more)

### Community 43 - "test_media_specific.mjs"
Cohesion: 0.26
Nodes (14): bug(), bugs, cdpSession(), evalJSON(), httpGet(), log(), main(), require (+6 more)

### Community 44 - "DriveSidebar.tsx"
Cohesion: 0.09
Nodes (20): DriveConfirmDialog(), DriveConfirmKind, DriveFolderDeleteChoice, DriveMoveChoice, Props, DriveSidebar(), dropKey(), DropRowProps (+12 more)

### Community 45 - "Bug Investigation"
Cohesion: 0.15
Nodes (12): Actual behavior, Bug Investigation, Expected behavior, Failed fixes, Hypotheses tried, Next steps, Reproduction steps, Status (+4 more)

### Community 46 - "goto_42794.mjs"
Cohesion: 0.29
Nodes (11): err(), httpGet(), js(), log(), main(), note(), openCDP(), require (+3 more)

### Community 47 - "Topic invalid + initial sidebar/thumbnail load"
Cohesion: 0.17
Nodes (11): Fix, Reproduction evidence (2026-07-16), Root cause, Root causes, Status, Symptoms, Topic invalid + initial sidebar/thumbnail load, Topic selector latency follow-up (2026-07-16) (+3 more)

### Community 48 - "3. Fitur Utama (Core Features)"
Cohesion: 0.17
Nodes (11): 1. Visi & Objektif, 2. Target Pengguna, 3.1. Entity Support, 3.2. Migration Engine, 3.3. Duplicate Engine (4-Level), 3.4. Rule Engine & Filters, 3.5. Task & Workflow Management, 3.6. Security & Anti-Spam (+3 more)

### Community 49 - "JobEditor.tsx"
Cohesion: 0.10
Nodes (39): repair_mp4_container(), RepairResult, Result, remux_lossless(), Result, collect_ffmpeg_candidates(), collect_ffmpeg_recursive(), extract_ffmpeg_frame_from_url() (+31 more)

### Community 50 - "wait_helpers.mjs"
Cohesion: 0.05
Nodes (66): addRange(), base64decode(), convertDocumentToSourceMapper(), convertJsonOption(), convertJsonOptionOfCustomType(), createCompilerDiagnosticForInvalidCustomType(), createDiagnosticForInvalidCustomType(), createDocumentPositionMapper() (+58 more)

### Community 51 - "Bug Investigation: Media Studio Deep Performance"
Cohesion: 0.18
Nodes (10): Bug Investigation: Media Studio Deep Performance, Expected behavior, Failed fixes, Hypotheses tried, Next steps, Status, Suspected files, Symptoms (+2 more)

### Community 52 - "ProgressTracker"
Cohesion: 0.21
Nodes (10): BenchProgressPayload, BenchResult, ProgressTracker, Instant, Option, Self, run_scale_benchmark(), ScaleBenchmarkResult (+2 more)

### Community 53 - "TransferJournal"
Cohesion: 0.36
Nodes (4): PathBuf, Self, Value, TransferJournal

### Community 54 - "db.py"
Cohesion: 0.09
Nodes (81): addRelatedInfo(), allowInAnd(), createDetachedDiagnostic(), createMissingList(), finishNode(), hasPrecedingJSDocComment(), internIdentifier(), makeBinaryExpression() (+73 more)

### Community 55 - "debug_42772_deep.mjs"
Cohesion: 0.35
Nodes (10): err(), httpGet(), js(), main(), note(), openCDP(), require, shot() (+2 more)

### Community 56 - "ensure-remote.ps1"
Cohesion: 0.38
Nodes (10): Get-NodePath(), Set-Progress(), Set-Status(), Start-ViteHidden(), Test-CdpUp(), Test-TcpPort(), Test-ViteUp(), Wait-Until() (+2 more)

### Community 57 - "goto_42772.mjs"
Cohesion: 0.35
Nodes (10): err(), httpGet(), js(), main(), note(), openCDP(), require, shot() (+2 more)

### Community 58 - "goto_42772_robust.mjs"
Cohesion: 0.35
Nodes (10): err(), httpGet(), js(), main(), note(), openCDP(), require, shot() (+2 more)

### Community 59 - "frontend/e2e-cdp-smoke.mjs"
Cohesion: 0.27
Nodes (17): _media_row_marker(), FolderChunkPayload, list_media_blocking(), list_media_blocking_topic(), ListMediaResult, media_to_row(), MediaFileRow, message_topic_id() (+9 more)

### Community 60 - "DriveToolsPanel.tsx"
Cohesion: 0.47
Nodes (5): formatBytes(), formatTimestamp(), GuardrailItem, Props, ReUploadBatchModal()

### Community 61 - "stats_db.rs"
Cohesion: 0.10
Nodes (40): CachedCatalog, extract_zip_entry_direct(), invalidate_cached_catalog(), parse_central_directory_fast(), preview_zip_entry_direct(), Client, HashMap, Instant (+32 more)

### Community 62 - "session_clone.rs"
Cohesion: 0.61
Nodes (8): cleanup_ghost_session(), clear_ghost_sessions_disk(), clone_telegram_session_atomic(), ensure_ghost_session(), get_sessions_dir(), AppHandle, PathBuf, Result

### Community 63 - "probe_34404.cjs"
Cohesion: 0.29
Nodes (9): fs, http, main(), note(), ok(), path, sleep(), warn() (+1 more)

### Community 64 - "probe_34404_v2.cjs"
Cohesion: 0.06
Nodes (34): 10. IMAGE-FIRST CODEX WEBSITE WORKFLOW, 11. WHEN TO TRIGGER IMAGE GENERATION FIRST, 13. WEBSITE REFERENCE RULE, 15. RESPONSIVE FIRST-VIEW RULE, 16. ANTI-NESTED-BOX RULE, 17. REDUCE MICRO-UI CLUTTER RULE, 18. SECTION IMAGE GENERATION RULE, 19. WEBSITE IMAGE SYSTEM RULE (+26 more)

### Community 65 - "probe_34404_v3.cjs"
Cohesion: 0.10
Nodes (24): fs, http, main(), note(), ok(), path, sleep(), warn() (+16 more)

### Community 66 - "test_all_three_media.mjs"
Cohesion: 0.31
Nodes (9): httpGet(), js(), openCDP(), require, run(), shot(), sleep(), TARGET_MEDIAS (+1 more)

### Community 67 - "Bug Investigation: Media Studio Transfer Session"
Cohesion: 0.22
Nodes (8): Bug Investigation: Media Studio Transfer Session, Decisions, Expected behavior, Reproduction evidence, Status, Suspected files, Symptoms, Verification

### Community 68 - "Hybrid Rust–Python Architecture (AutoGram)"
Cohesion: 0.22
Nodes (8): Env, Goal, Hybrid Rust–Python Architecture (AutoGram), Layer map, Not full Grammers yet, Safety, Status (honest — hybrid Phase 6), Verification

### Community 70 - "parse_moov_internal"
Cohesion: 0.46
Nodes (7): KeyframeEntry, parse_moov_internal(), parse_mp4_keyframes(), read_boxes(), HashMap, Option, Vec

### Community 71 - "streaming_policy.rs"
Cohesion: 0.43
Nodes (7): buckets_monotonic_first_play(), first_play_bytes(), get_streaming_config(), over_4gb(), stream_window_never_exceeds_small_file(), StreamingConfig, streaming_config_for_size()

### Community 72 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include, vite.config.ts

### Community 73 - "AutoGram App/src-tauri/capabilities/default.json"
Cohesion: 0.15
Nodes (8): DrivePreviewModalProps, isHttpStreamUrl(), isPlayableHttpUrl(), isProgressiveStreamPath(), normalizePlayQualities(), PlayQuality, RATES, sanitizeQualityLabel()

### Community 74 - "Media Studio initial-load investigation"
Cohesion: 0.25
Nodes (7): Fix direction, Measurements (2026-07-16), Media Studio initial-load investigation, Root cause, Symptom, Verification target, Verified result (2026-07-16)

### Community 75 - "Bug Investigation: Preview Random Seek"
Cohesion: 0.25
Nodes (7): Bug Investigation: Preview Random Seek, Constraints, Evidence and root-cause hypotheses, Expected behavior, Status, Suspected files, Symptoms

### Community 76 - "Thumbnail cold-load and pagination performance"
Cohesion: 0.25
Nodes (7): Cache reset, Root causes, Status, Symptoms, Thumbnail cold-load and pagination performance, Verification, Working fix

### Community 77 - "e2e-gudang-thumbs.mjs"
Cohesion: 0.07
Nodes (39): DriveToolsPanel(), DupTab(), preferredKeepId(), Props, smartDeleteIds(), ToolTabIntro(), DriveToolsTab, TOOL_GROUPS (+31 more)

### Community 78 - "scripts"
Cohesion: 0.06
Nodes (34): 10. DEVICE MOCKUP FRAME RULE, 11. ONBOARDING FLOW RULE, 12. FIRST SCREEN CLEANLINESS RULE, 13. SAFE AREA AND SYSTEM REGION RULE, 14. NAVIGATION RULE, 15. CLEAN LAYOUT RULE, 16. CREATIVE IMAGE DIRECTION RULE, 17. BACKGROUND TEXTURE AND SURFACE RULE (+26 more)

### Community 79 - ".new"
Cohesion: 0.29
Nodes (5): EventEnvelope, EventEnvelope<T>, Into, Self, T

### Community 80 - "AutoGram Remote (CDP)"
Cohesion: 0.25
Nodes (7): AutoGram Remote (CDP), Debug Mode app, Layout (pasca cleanup), Prasyarat, Quick start, Scripts, Status

### Community 81 - "Bug Investigation: Native Account, Session, Document and Video Preview"
Cohesion: 0.29
Nodes (6): Bug Investigation: Native Account, Session, Document and Video Preview, Confirmed root causes, Fixes applied, Remaining live check, Symptoms, Verification

### Community 82 - "Session Isolation, Upload Limits, and Migration Scale"
Cohesion: 0.29
Nodes (6): 2026-07-17 - Baseline, Investigation log, Pending evidence, Safety constraints, Scope, Session Isolation, Upload Limits, and Migration Scale

### Community 83 - "Bug Investigation: Session + Stream/Buffer/Preview Conflicts"
Cohesion: 0.29
Nodes (6): Bug Investigation: Session + Stream/Buffer/Preview Conflicts, Fixes (v2.1.64), Root causes found, Status, Symptoms, Verification

### Community 84 - "Staged session bootstrap"
Cohesion: 0.29
Nodes (6): Fix in progress, Live accuracy and location focus follow-up, Root cause, Staged session bootstrap, Symptom, Verification

### Community 85 - "Bug: Video preview keeps reloading during buffer (multi-video)"
Cohesion: 0.29
Nodes (6): Bug: Video preview keeps reloading during buffer (multi-video), Fixes (v2.1.79), Follow-up (v2.1.80) — Screenshot 34.mp4 stuck 0:00 / “menunggu data stream · 7%”, Root causes, Status, Symptoms

### Community 86 - "config_normalize.rs"
Cohesion: 0.62
Nodes (6): as_bool(), as_f64(), as_i64(), normalize_job_config(), normalizes_defaults(), Value

### Community 87 - "ProgressSnapshot"
Cohesion: 0.47
Nodes (5): compute_progress(), half_done(), ProgressSnapshot, Option, compute_progress_rate()

### Community 88 - "input_injector.mjs"
Cohesion: 0.43
Nodes (4): click(), dragFromTo(), pointerDragKeys(), sleep()

### Community 89 - "Media count and storage accuracy investigation"
Cohesion: 0.33
Nodes (5): Fix, Media count and storage accuracy investigation, Root cause, Symptom, Verification (2026-07-16)

### Community 90 - "Buffer bar stuck + “Stream bermasalah”"
Cohesion: 0.33
Nodes (5): Buffer bar stuck + “Stream bermasalah”, Evidence (`worker/temp` + `worker/cache`), Fix (v2.1.81), Root cause, Verify

### Community 91 - "Rust + Grammers Backend (Force — no Telethon runtime)"
Cohesion: 0.33
Nodes (5): Frontend rules, Remaining work, Rust + Grammers Backend (Force — no Telethon runtime), Session files, Status (v2.8.7)

### Community 92 - "System Architecture"
Cohesion: 0.33
Nodes (5): 1. Teknologi (Tech Stack), 2. Diagram Alur (Data Flow), 3. Komponen Utama, 4. Keamanan Arsitektur, System Architecture

### Community 93 - "Web deploy vs desktop (heavy features)"
Cohesion: 0.33
Nodes (5): Runtime split, Supabase / backend, Verify, Web deploy vs desktop (heavy features), Web host build

### Community 94 - "Architecture Decision Record (ADR)"
Cohesion: 0.33
Nodes (5): ADR-001: Desktop Framework Selection, ADR-002: Pemisahan Telegram API Engine (Python Worker), ADR-003: Penyimpanan Status Migrasi (Local Database), ADR-004: Forward Mode vs Copy Mode, Architecture Decision Record (ADR)

### Community 95 - "Repository Governance"
Cohesion: 0.33
Nodes (5): 1. Single Source of Truth, 2. Hygiene & Secrets Management, 3. Merge & Branching Strategy, 4. Requirement for Code Changes, Repository Governance

### Community 96 - "Backup & Recovery Procedures"
Cohesion: 0.33
Nodes (5): 1. Resume System (Koneksi Putus / PC Mati), 2. Failed Items Recovery, 3. Ekspor Laporan dan Konfigurasi, 4. Temporary Cache Management (Pembersihan Memori), Backup & Recovery Procedures

### Community 97 - "Final Audit Report (v5.1.1)"
Cohesion: 0.33
Nodes (5): 1. Verifikasi Struktur, 2. Verifikasi Keamanan, Final Audit Report (v5.1.1), Kesimpulan, Status: LULUS (PASSED)

### Community 98 - "Development Roadmap"
Cohesion: 0.33
Nodes (5): Development Roadmap, Phase 1: Offline Desktop Foundation (Current Focus), Phase 2: Advanced Rules & Automation, Phase 3: Web Dashboard & Cloud Deployment, Phase 4: Commercialization & Multi-Tenant

### Community 99 - "Security Control Matrix"
Cohesion: 0.33
Nodes (5): 1. Perlindungan Kredensial & Sesi (Session Protection), 2. Operasional Anti-Spam (Smart Throttle), 3. Validasi Tujuan (Destination Conflict), 4. Audit Trail, Security Control Matrix

### Community 100 - "Test Strategy"
Cohesion: 0.33
Nodes (5): 1. Unit Testing, 2. Integration Testing, 3. System Testing (Migration E2E), 4. Security & Safety Testing, Test Strategy

### Community 101 - "Accounts.tsx"
Cohesion: 0.09
Nodes (22): qrcode, ConfirmModal(), ConfirmModalProps, clearZipBrowserCache(), Accounts(), AccountsProps, CustomCountrySelect(), safeGetCallingCode() (+14 more)

### Community 102 - "VSCodeCodeViewer.tsx"
Cohesion: 0.10
Nodes (30): react, DriveZipBrowser(), mapLocalPreview(), mediaKindFromName(), PasswordAction, ZipCodePreviewModal(), ZipCodePreviewModalProps, EntryIcon() (+22 more)

### Community 104 - "ReUploadBatchModal.tsx"
Cohesion: 0.30
Nodes (13): cleanup_paths(), CleanupResult, clear_download_registry(), get_registry_path(), list_active_download_paths(), load_unlocked(), register_download_path(), RegistryData (+5 more)

### Community 106 - "media_meta.rs"
Cohesion: 0.50
Nodes (3): EncodeBudgetPlan, plan_encode_budget(), Option

### Community 107 - "frontend/package.json"
Cohesion: 0.09
Nodes (56): finishNode(), getNodePos(), getTemplateLiteralRawText(), isStartOfTypeOfImportType(), isUpdateExpression(), nextTokenAnd(), nextTokenIsOpenParen(), parseArrayBindingElement() (+48 more)

### Community 111 - "inspect_cards.mjs"
Cohesion: 0.50
Nodes (4): httpGet(), require, run(), WebSocket

### Community 112 - "inspect_full_dom.mjs"
Cohesion: 0.50
Nodes (4): httpGet(), require, run(), WebSocket

### Community 113 - "probe_msg_73.mjs"
Cohesion: 0.50
Nodes (4): httpGetIPv6(), require, run(), WebSocket

### Community 114 - "probe_thumb_73_detail.mjs"
Cohesion: 0.50
Nodes (4): httpGetIPv6(), require, run(), WebSocket

### Community 115 - "v2.3.53 Optimasi Performa Cold Start, Speed Loading List Card & Thumbnail Bulk IDB Read, & Fix Thumbnail Dokumen/File"
Cohesion: 0.50
Nodes (4): Adopsi Strategi Performa Telegram-Drive (`thumbBatcher.ts`, `DriveExplorer.tsx`, `DriveFileCard.tsx`), Pengeliminasian Freeze Cold Start (<300ms Boot) (`SpeedTest.tsx`), Perbaikan Thumbnail Media Dokumen/File (`grammers_ops.rs`, `driveTypes.ts`), v2.3.53 Optimasi Performa Cold Start, Speed Loading List Card & Thumbnail Bulk IDB Read, & Fix Thumbnail Dokumen/File

### Community 116 - "v2.3.52 Universal Target-DC Parallel MTProto Download Pipeline & CDN Edge Routing"
Cohesion: 0.50
Nodes (4): Akselerasi Multi-Socket Paralel & Uncapped Download Speed (`grammers_ops.rs`, `grammers_media.rs`, `DrivePreviewModal.tsx`), Eliminasi Variasi Kecepatan Antar-File via Target DC Download Engine (`grammers_media.rs`), Perbaikan Kebekuan Demuxer pada Batas Buffer (*Micro-Chunk Freeze*) (`stream_server.rs`, `DrivePreviewModal.tsx`), v2.3.52 Universal Target-DC Parallel MTProto Download Pipeline & CDN Edge Routing

### Community 117 - "v2.1.73 Upload UI → Rust Orchestrator Default + Full-Rust Scaffold"
Cohesion: 0.50
Nodes (4): Catatan, Full Rust bertahap (scaffold), Upload path (UI), v2.1.73 Upload UI → Rust Orchestrator Default + Full-Rust Scaffold

### Community 118 - "v2.1.74 Grammers dual-path compile-fix + multi-layer debug logs"
Cohesion: 0.50
Nodes (4): Catatan testing, Debug mode (lengkap lintas layer), Stability (pasca migrasi), v2.1.74 Grammers dual-path compile-fix + multi-layer debug logs

### Community 119 - "v2.1.81 Stream cancel thrash + Grammers album"
Cohesion: 0.50
Nodes (4): Fixes, Migrasi Grammers, Root cause (buffer % macet + “Stream bermasalah”), v2.1.81 Stream cancel thrash + Grammers album

### Community 120 - "v2.1.78 Phase 6 — Progressive stream + thumbs + topics (Grammers)"
Cohesion: 0.50
Nodes (4): Masih Python (sengaja), Progressive stream (Rust), Thumbs + topics, v2.1.78 Phase 6 — Progressive stream + thumbs + topics (Grammers)

### Community 121 - "v5.1.1 Improvement Report"
Cohesion: 0.50
Nodes (3): Detail Peningkatan (Improvements), Ringkasan Perbaikan, v5.1.1 Improvement Report

### Community 122 - "AutoGram frontend (Tauri + React + TypeScript)"
Cohesion: 0.50
Nodes (3): AutoGram frontend (Tauri + React + TypeScript), Recommended IDE Setup, Runtime: desktop vs web

### Community 124 - "main.tsx"
Cohesion: 0.10
Nodes (11): MediaStudio, ErrorBoundary, Props, SplashScreen(), SplashScreenProps, resources, ApiSetupScreen(), ApiSetupScreenProps (+3 more)

### Community 125 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

### Community 128 - "v2.1.72 Phase 3 — Studio Job Queue di Rust (Python Step Upload)"
Cohesion: 0.67
Nodes (3): Catatan, Orkestrasi, v2.1.72 Phase 3 — Studio Job Queue di Rust (Python Step Upload)

### Community 129 - "v2.1.70 Proxy/VPN dari Telegram-Drive + Telethon Hybrid"
Cohesion: 0.67
Nodes (3): Catatan, Proxy & VPN Optimizer (fitur Telegram-Drive → AutoGram), v2.1.70 Proxy/VPN dari Telegram-Drive + Telethon Hybrid

### Community 130 - "v2.1.79 Fix video preview reload loop + stream hardening"
Cohesion: 0.67
Nodes (3): Catatan migrasi, Critical fix, v2.1.79 Fix video preview reload loop + stream hardening

### Community 131 - "v2.1.67 Start Video Multi-Tier + Pratinjau Dokumen/Kode Cepat"
Cohesion: 0.67
Nodes (3): Dokumen & kode, v2.1.67 Start Video Multi-Tier + Pratinjau Dokumen/Kode Cepat, Video (semua ukuran)

### Community 132 - "v2.1.77 Phase 5 — Drive dual-path list + Grammers download"
Cohesion: 0.67
Nodes (3): Grammers / full-Rust progress, Masih Python (sengaja), v2.1.77 Phase 5 — Drive dual-path list + Grammers download

### Community 133 - "v2.1.80 Video play stuck + buffer speed (34.mp4 class)"
Cohesion: 0.67
Nodes (3): Kecepatan load / buffer, Screenshot issue (buffer ada, video di 0:00), v2.1.80 Video play stuck + buffer speed (34.mp4 class)

### Community 134 - "v2.1.69 Hybrid Phase 2 — Rust Stream Server + Local Utilities"
Cohesion: 0.67
Nodes (3): Local utilities (Rust), Stream (Rust + Python companion), v2.1.69 Hybrid Phase 2 — Rust Stream Server + Local Utilities

### Community 135 - "v2.1.76 Grammers-first studio orch (honest hybrid, not full cutover)"
Cohesion: 0.67
Nodes (3): Masih Python (sengaja), Status, v2.1.76 Grammers-first studio orch (honest hybrid, not full cutover)

### Community 136 - "v2.1.75 Fix overhead looping (preview poll + session ready)"
Cohesion: 0.67
Nodes (3): Performance, Remote, v2.1.75 Fix overhead looping (preview poll + session ready)

### Community 137 - "Data Flow & Execution Pipeline"
Cohesion: 0.50
Nodes (3): 1. Pipeline Utama (Migration Core Flow), 2. Pipeline Studio Orchestrated Upload (Studio Upload Flow), Data Flow & Execution Pipeline

### Community 158 - "v2.3.62 Dual-Track Parallel Concurrency & Ultra-Fast Image Thumbnail Response"
Cohesion: 0.14
Nodes (30): compute_best_encoder(), CpuCapability, detect_hardware_capabilities(), evaluate_resource_admission(), FfmpegEncoderSupport, get_hardware_capabilities(), GpuCapability, HardwareCapabilities (+22 more)

### Community 242 - "i18next"
Cohesion: 0.20
Nodes (7): candidates, card, errors, pages, results, sessionSelect, tDrive

### Community 244 - "react-i18next"
Cohesion: 0.04
Nodes (110): addProjToQueue(), buildWorker(), checkConfigFileUpToDateStatus(), cleanWorker(), clearProjectStatus(), computeSignature(), computeSignatureWithDiagnostics(), convertToDiagnosticRelatedInformation() (+102 more)

### Community 247 - "@tauri-apps/plugin-fs"
Cohesion: 0.25
Nodes (7): drivesBtn, gudang, page, photo, report, samples, t0

### Community 248 - "@tauri-apps/plugin-shell"
Cohesion: 0.36
Nodes (6): detectLanguage(), escapeHtml(), highlightLine(), VSCodeCodeViewer(), VSCodeCodeViewerProps, DocumentViewerProps

### Community 251 - "AutoGram App/src-tauri/build.rs"
Cohesion: 0.16
Nodes (26): codeFixAll(), createAction(), createActionForAddMissingMemberInJavascriptFile(), createActionsForAddMissingMemberInTypeScriptFile(), createAddIndexSignatureAction(), createCodeFixAction(), createCodeFixActionWithoutFixAll(), createCombinedCodeActions() (+18 more)

### Community 255 - "MicroProgressBar"
Cohesion: 0.05
Nodes (74): canFollowContextualOfKeyword(), canFollowExportModifier(), canFollowModifier(), canParseSemicolon(), entryToDeclaration(), isAssertionKey(), isBindingIdentifierOrPrivateIdentifierOrPattern(), isClassMemberStart() (+66 more)

### Community 257 - "ModernProgressBar"
Cohesion: 0.05
Nodes (32): addImportType(), addNamespaceQualifier(), addToSeen(), ChangeTracker(), codeActionForFixWorker(), convertAssignment(), convertExportsPropertyAssignment(), convertNamedExport() (+24 more)

### Community 259 - "remote/e2e-cdp-smoke.mjs"
Cohesion: 0.05
Nodes (84): abortParsingListOrMoveToNextToken(), canFollowContextualOfKeyword(), canFollowExportModifier(), canFollowModifier(), canParseSemicolon(), getExpectedCommaDiagnostic(), internPrivateIdentifier(), isBindingIdentifierOrPrivateIdentifierOrPattern() (+76 more)

### Community 266 - "react-phone-number-input"
Cohesion: 0.02
Nodes (226): addExports(), addToAffectedFilesPendingEmit(), addToMultimap(), applyChange(), arrayFrom(), arrayIterator(), arrayToMultiMap(), canReuseOldState() (+218 more)

### Community 267 - "@tauri-apps/api"
Cohesion: 0.01
Nodes (226): addImportType(), addJsxAttributes(), addMethodDeclaration(), addMissingConstraint(), addMissingMemberInJs(), addMissingNewOperator(), addNamespaceQualifier(), addObjectLiteralProperties() (+218 more)

### Community 268 - "@tauri-apps/plugin-fs"
Cohesion: 0.04
Nodes (128): addCompletionEntriesFromPaths(), addCompletionEntriesFromPathsOrExports(), arePathsEqual(), canWatchDirectoryOrFile(), combinePaths(), comparePaths(), comparePathsCaseInsensitive(), comparePathsCaseSensitive() (+120 more)

### Community 269 - "@tauri-apps/plugin-shell"
Cohesion: 0.03
Nodes (69): ArrayLiteralExpression, ArrayTypeNode, BigIntLiteral, ConditionalTypeNode, ConstructorTypeNode, Declaration, FalseLiteral, FunctionOrConstructorTypeNodeBase (+61 more)

### Community 270 - "types.ts"
Cohesion: 0.07
Nodes (36): loadMoreTopicMedia(), openTopicMedia(), OpResult, DocumentThumbnail(), DocumentThumbnailProps, FileTypeIcon(), FileTypeIconProps, ThumbnailQualityBadge() (+28 more)

### Community 271 - "assert"
Cohesion: 0.11
Nodes (27): collectEnclosingScopes(), collectReadsAndWrites(), extractConstantInScope(), extractFunctionInScope(), forEachEnclosingBlockScopeContainer(), getCalledExpression(), getConstantExtractionAtIndex(), getContainingVariableDeclarationIfInList() (+19 more)

### Community 272 - ".getCurrentDirectory"
Cohesion: 0.07
Nodes (48): copyProperties(), CoreServicesShimHostAdapter(), createCachedDirectoryStructureHost(), createCacheWithRedirects(), createCompilerHostFromProgramHost(), createCompilerHostWorker(), createIncrementalCompilerHost(), createIncrementalProgram() (+40 more)

### Community 273 - "combinePaths"
Cohesion: 0.04
Nodes (81): addCompletionEntriesFromPaths(), addCompletionEntriesFromPathsOrExports(), commandLineOptionsToMap(), containsSlash(), convertCompilerOptionsFromJson(), convertCompilerOptionsFromJsonWorker(), convertConfigFileToObject(), convertEnableAutoDiscoveryToEnable() (+73 more)

### Community 274 - "getNextInvalidatedProjectCreateInfo"
Cohesion: 0.05
Nodes (88): State, addProjToQueue(), bindSourceFile(), build(), buildNextInvalidatedProject(), buildNextInvalidatedProjectWorker(), buildWorker(), canJsonReportNoInputFiles() (+80 more)

### Community 275 - "startsWith"
Cohesion: 0.05
Nodes (73): allKeysStartWithDot(), compareNodeCoreModuleSpecifiers(), comparePatternKeys(), computeNewText(), consumesNodeCoreModules(), countPathComponents(), createCacheableExportInfoMap(), endsWith() (+65 more)

### Community 285 - "hasProperty"
Cohesion: 0.05
Nodes (76): classicNameResolver(), createResolvedModuleWithFailedLookupLocations(), diag(), directoryProbablyExists(), findBestPatternMatch(), getAllowedEndings(), getDefaultNodeResolutionFeatures(), getDirectoryPath() (+68 more)

### Community 291 - "stats_db.rs"
Cohesion: 0.12
Nodes (20): connect(), loadPlaywright(), require, config, commands, config, config, probeIPC() (+12 more)

### Community 294 - "v2.3.78 Multi-Decoder CPU Software Fallback (`libdav1d` / `av1`) & Head Rescue Loop"
Cohesion: 0.10
Nodes (5): createLanguageService(), getCompletionEntrySymbol(), getEditsForRefactor(), LanguageServiceShimObject(), maybeSetLocalizedDiagnosticMessages()

### Community 298 - "skipTrivia"
Cohesion: 0.09
Nodes (41): appendCommentRange(), concatenate(), deleteDeclaration(), deleteDefaultImport(), deleteImportBinding(), deleteNode(), deleteNodeInList(), deleteVariableDeclaration() (+33 more)

### Community 300 - "@tauri-apps/plugin-dialog"
Cohesion: 0.05
Nodes (27): ClassifierShimObject(), convertClassifications(), CoreServicesShimObject(), createAbstractBuilder(), createBuilderProgram(), createBuildOrUpdateInvalidedProject(), createClassifier(), createEmitAndSemanticDiagnosticsBuilderProgram() (+19 more)

### Community 301 - "media_prep.rs"
Cohesion: 0.14
Nodes (26): adjusted_target_planning_bytes(), download_remote_url(), emit_transfer_event(), EncoderPermit, ext_from_url_or_ctype(), is_remote_url(), maybe_reencode_for_telegram(), prepare_upload_artifact() (+18 more)

### Community 302 - "JSDocContainer"
Cohesion: 0.06
Nodes (58): ArrowFunction, AutoAccessorPropertyDeclaration, BindingElement, CallSignatureDeclaration, CaseClause, ClassDeclaration, ClassElement, ClassExpression (+50 more)

### Community 303 - "getEmitScriptTarget"
Cohesion: 0.14
Nodes (17): BUGS_DIR, CONFIG_DIR, __dirname, ensureDirs(), PATCHES_DIR, REPORTS_DIR, SHOTS_DIR, stamp() (+9 more)

### Community 304 - "Node"
Cohesion: 0.04
Nodes (42): ArrayBindingPattern, AssertClause, AssertEntry, Bundle, CaseBlock, CatchClause, ComputedPropertyName, Decorator (+34 more)

### Community 306 - "DeadCenterProgress"
Cohesion: 0.08
Nodes (32): chooseInitialDuplicateSlots(), DuplicateSlotCandidate, DuplicateSplitSlot, nextDistinctDuplicateIndex(), shouldLoadSplitPreview(), buildMediaSrc(), clamp(), DEFAULT_VIDEO_QUALITIES (+24 more)

### Community 307 - ".getStart"
Cohesion: 0.01
Nodes (281): addNodeOutliningSpans(), addOutliningForLeadingCommentsForNode(), addOutliningForLeadingCommentsForPos(), addRegionOutliningSpans(), addReplacementSpans(), applyChanges(), argumentStartsOnSameLineAsPreviousArgument(), assertLessThan() (+273 more)

### Community 308 - "findAncestor"
Cohesion: 0.10
Nodes (20): attrNames, decodeEntities(), en, enOnly, fallbackCalls, files, flatten(), hardcoded (+12 more)

### Community 309 - "ZipErrorBoundary"
Cohesion: 0.06
Nodes (66): arrayToMultiMap(), changeAnyExtension(), changeCompilerHostLikeToUseCache(), changeExtension(), createAddOutput(), createCompilerHost(), createCreateProgramOptions(), createProgram() (+58 more)

### Community 311 - "MediaVideoPlayer.tsx"
Cohesion: 0.33
Nodes (4): MediaVideoPlayerProps, PlaybackDiagnosticsPanel(), PlaybackDiagnosticsPanelProps, PlaybackTelemetryData

### Community 313 - "parseClassElement"
Cohesion: 0.09
Nodes (37): disallowInAnd(), doInAwaitContext(), doInDecoratorContext(), doInsideOfContext(), doInYieldAndAwaitContext(), doInYieldContext(), doOutsideOfAwaitContext(), doOutsideOfContext() (+29 more)

### Community 314 - "parseAssignmentExpressionOrHigher"
Cohesion: 0.07
Nodes (51): addJSDocComment(), canFollowTypeArgumentsInExpression(), doOutsideOfAwaitContext(), doOutsideOfContext(), doOutsideOfYieldAndAwaitContext(), getBinaryOperatorPrecedence(), inAwaitContext(), inContext() (+43 more)

### Community 315 - "withJSDoc"
Cohesion: 0.09
Nodes (57): allowConditionalTypesAnd(), combineDecoratorsAndModifiers(), disallowConditionalTypesAnd(), disallowInAnd(), doInAwaitContext(), doInDecoratorContext(), doInsideOfContext(), doInYieldAndAwaitContext() (+49 more)

### Community 322 - "arrayFrom"
Cohesion: 0.23
Nodes (17): CDP_PORTS, CdpClient, closePreview(), ensureDriveSession(), findAutoGramTarget(), getJson(), listSavedCards(), main() (+9 more)

### Community 323 - "createIdentifier"
Cohesion: 0.05
Nodes (49): addDefiniteAssignmentAssertion(), addInitializer(), addMissingNewOperator(), addReturnStatement(), addUndefinedType(), canHaveLiteralInitializer(), cast(), changeInferToUnknown() (+41 more)

### Community 324 - "startsWith"
Cohesion: 0.04
Nodes (83): allKeysStartWithDot(), comparePatternKeys(), computeModuleSpecifiers(), countPathComponents(), endsWith(), ensurePathIsNonModuleName(), findBestPatternMatch(), forEachFileNameOfModule() (+75 more)

### Community 325 - "getInfo"
Cohesion: 0.10
Nodes (21): 7.1 Upload overview strip, 7.2 Card 1: Upload quality and presentation, 7.3 Card 2: Video processing, 7.4 Card 3: Performance, 7.5 Card 4: Delivery behavior, 7.6 Card 5: Default caption, 7. DETAILED UPLOAD UI, Automatic mode UI (+13 more)

### Community 326 - "parseExpected"
Cohesion: 0.09
Nodes (71): addRelatedInfo(), allowInAnd(), createDetachedDiagnostic(), createMissingList(), hasPrecedingJSDocComment(), internIdentifier(), parseAmbientExternalModuleDeclaration(), parseAssertClause() (+63 more)

### Community 327 - "ErrorClass"
Cohesion: 0.06
Nodes (36): delete_job_checkpoints(), JobCheckpoint, load_latest_checkpoint(), Connection, Option, Result, save_checkpoint(), calculate_file_sha256() (+28 more)

### Community 328 - "parseAssignmentExpressionOrHigher"
Cohesion: 0.10
Nodes (30): addJSDocComment(), canFollowTypeArgumentsInExpression(), getBinaryOperatorPrecedence(), inDisallowInContext(), isBinaryOperator(), isBinaryOperatorToken(), isLeftHandSideExpression(), isUnParenthesizedAsyncArrowFunctionWorker() (+22 more)

### Community 329 - "getContextualType"
Cohesion: 0.11
Nodes (25): addNewFileToTsconfig(), createJsonPropertyAssignment(), findBaseOfDeclaration(), findJsonProperty(), firstDefined(), forEachProperty(), forEachTopLevelDeclaration(), forEachTopLevelDeclarationInBindingName() (+17 more)

### Community 330 - "Scanner"
Cohesion: 0.06
Nodes (16): createScanner(), Scanner, getCookedText(), getEncodedSyntacticClassifications(), reScanLessThanToken(), reScanSlashToken(), reScanTemplateToken(), scanJsxAttributeValue() (+8 more)

### Community 331 - "Type"
Cohesion: 0.04
Nodes (27): BigIntLiteralType, ConditionalType, DeferredTypeReference, EnumType, EvolvingArrayType, GenericType, IndexedAccessType, IndexType (+19 more)

### Community 332 - "ProgramHost"
Cohesion: 0.04
Nodes (11): ConfigFileDiagnosticsReporter, ParseConfigFileHost, ParseConfigHost, ProgramHost, SolutionBuilderHost, SolutionBuilderHostBase, SolutionBuilderWithWatchHost, WatchCompilerHost (+3 more)

### Community 333 - ".replaceNode"
Cohesion: 0.11
Nodes (21): escapeLeadingUnderscores(), expandPreOrPostfixIncrementOrDecrementExpression(), getEscapedTextOfIdentifierOrLiteral(), getNameTable(), getPropertyAssignment(), getPropertyNameForPropertyNameNode(), initializeNameTable(), isArgumentOfElementAccessExpression() (+13 more)

### Community 334 - "extractFunctionInScope"
Cohesion: 0.01
Nodes (312): addConvertToAsyncFunctionDiagnostics(), addDefiniteAssignmentAssertion(), addEnumMemberDeclaration(), addNewFileToTsconfig(), addReturnStatement(), addUndefinedType(), annotate(), annotateJSDocParameters() (+304 more)

### Community 335 - "skipTrivia"
Cohesion: 0.13
Nodes (15): forEachUnique(), getAllJSDocTags(), getAllJSDocTagsOfKind(), getCommentHavingNodes(), getDocumentationComment(), getJsDocCommentsFromDeclarations(), getJSDocImplementsTags(), getJSDocTags() (+7 more)

### Community 336 - "createIdentifier"
Cohesion: 0.10
Nodes (19): Code Quality, Color and Surfaces, Component Patterns, Content, Design Audit, Fix Priority, How This Works, Iconography (+11 more)

### Community 337 - "firstDefined"
Cohesion: 0.21
Nodes (13): getDefaultExportInfoWorker(), getDefaultLikeExportNameFromDeclaration(), getLocalSymbolForExportDefault(), getNameForExportDefault(), getNameForExportedSymbol(), getNamesForExportedSymbol(), getSymbolParentOrFail(), isExportDefaultSymbol() (+5 more)

### Community 338 - ".isStringLiteral"
Cohesion: 0.11
Nodes (18): 1. Define the Atmosphere, 2. Map the Color Palette, 3. Establish Typography Rules, 4. Define the Hero Section, 5. Describe Component Stylings, 6. Define Layout Principles, 7. Define Responsive Rules, 8. Encode Motion Philosophy (+10 more)

### Community 339 - "getDirectoryPath"
Cohesion: 0.14
Nodes (19): createQualifiedName(), isImplementsClause(), nextTokenIsIdentifierOrKeyword(), nextTokenIsIdentifierOrKeywordOnSameLine(), nextTokenIsIdentifierOrKeywordOrGreaterThan(), parseAssertEntry(), parseEntityName(), parseEntityNameOfTypeReference() (+11 more)

### Community 340 - "createSolutionBuilderWorker"
Cohesion: 0.06
Nodes (58): afterProgramDone(), bindSourceFile(), build(), buildErrors(), buildNextInvalidatedProject(), buildNextInvalidatedProjectWorker(), canJsonReportNoInputFiles(), clean() (+50 more)

### Community 342 - "push"
Cohesion: 0.02
Nodes (162): addPragmaForMatch(), addRange(), addSyntheticNodes(), aggregateAllBreakAndContinueStatements(), aggregateOwnedThrowStatements(), cloneCompilerOptions(), compact(), convertCompileOnSaveOptionFromJson() (+154 more)

### Community 343 - ".add"
Cohesion: 0.25
Nodes (8): createGetChecker(), getAllExportInfoForSymbol(), getDefaultLikeExportInfo(), getDefaultLikeExportWorker(), getExportInfoMap(), isImportableSymbol(), isKnownSymbol(), isPrivateIdentifierSymbol()

### Community 344 - "parseOptional"
Cohesion: 0.07
Nodes (73): allowConditionalTypesAnd(), createQualifiedName(), disallowConditionalTypesAnd(), getNodePos(), inDisallowConditionalTypesContext(), isDeclareModifier(), isIndexSignature(), isJSDocNullableType() (+65 more)

### Community 345 - ".getLineAndCharacterOfPosition"
Cohesion: 0.11
Nodes (17): Actual behavior, Agent Task Memory Log Skill, Bug Investigation, Expected behavior, Failed fixes, Format catatan bug, Hypotheses tried, Kapan update catatan (+9 more)

### Community 346 - "tokenToString"
Cohesion: 0.12
Nodes (29): createNodeArray(), getTextOfNodeFromSourceText(), parseErrorAt(), parseErrorAtRange(), parseFunctionOrConstructorTypeToError(), parseIntersectionTypeOrHigher(), parseJsxAttribute(), parseJsxAttributes() (+21 more)

### Community 347 - "createProgram"
Cohesion: 0.11
Nodes (17): 1. Meta Information & Core Directive, 2. THE "ABSOLUTE ZERO" DIRECTIVE (STRICT ANTI-PATTERNS), 3. THE CREATIVE VARIANCE ENGINE, 4. HAPTIC MICRO-AESTHETICS (COMPONENT MASTERY), 5. MOTION CHOREOGRAPHY (FLUID DYNAMICS), 6. PERFORMANCE GUARDRAILS, 7. EXECUTION PROTOCOL, 8. PRE-OUTPUT CHECKLIST (+9 more)

### Community 348 - ".trace"
Cohesion: 0.05
Nodes (84): arePathsEqual(), canWatchDirectoryOrFile(), combineNormal(), combinePaths(), combinePathsSafe(), comparePaths(), comparePathsCaseInsensitive(), comparePathsCaseSensitive() (+76 more)

### Community 349 - "fileExtensionIs"
Cohesion: 0.05
Nodes (51): Program, changeAnyExtension(), changeCompilerHostLikeToUseCache(), changeExtension(), createAddOutput(), createCompilerHost(), createCreateProgramOptions(), createProgram() (+43 more)

### Community 350 - "isIdentifier"
Cohesion: 0.06
Nodes (52): convertExportsAccesses(), eachSymbolReferenceInFile(), forEachChildRecursively(), forEachExportReference(), forEachFreeIdentifier(), forEachReference(), gatherPossibleChildren(), getAllAccessorDeclarations() (+44 more)

### Community 351 - ".has"
Cohesion: 0.04
Nodes (100): addToAffectedFilesPendingEmit(), addToMultimap(), arrayFrom(), arrayToMap(), canReuseOldState(), checkDefined(), cleanExtendedConfigCache(), clearSharedExtendedConfigFileWatcher() (+92 more)

### Community 352 - "getEffectiveTypeParameterDeclarations"
Cohesion: 0.09
Nodes (24): canHaveIllegalDecorators(), filterOwnedJSDocTags(), flattenInvalidBinaryExpr(), getContainingNodeArray(), getEffectiveConstraintOfTypeParameter(), getJSDocParameterTagsNoCache(), getJSDocParameterTagsWorker(), getJsDocTagAtPosition() (+16 more)

### Community 353 - "studio_orch.rs"
Cohesion: 0.16
Nodes (40): CreateTransferRequest, Value, Vec, TransferRecord, approved_alternate_sessions(), duplicate_force_upload_is_scoped_to_the_selected_source_path(), duplicate_match_for_prepared(), duplicate_skip_enabled() (+32 more)

### Community 354 - "store.rs"
Cohesion: 0.13
Nodes (35): begin_download_receipt(), begin_encoder_receipt(), create_album_commit(), download_receipt_matches(), DownloadRangeCheckpoint, find_upload_ledger_match(), finish_download_receipt(), finish_encoder_receipt() (+27 more)

### Community 355 - "getCompletionEntriesForNonRelativeModules"
Cohesion: 0.16
Nodes (14): DriveTransferManager(), encoderLabel(), Props, defaultStage, formatEtaSeconds(), formatSpeedBytes(), HardwareCpu, HardwareGpu (+6 more)

### Community 356 - "TypeObject"
Cohesion: 0.13
Nodes (8): createTypeParameterName(), getArgumentTypesAndTypeParameters(), isAnonymousObjectConstraintType(), isThisTypeParameter(), removeOptionality(), skipConstraint(), typeContainsTypeParameter(), TypeObject()

### Community 357 - "tokenToString"
Cohesion: 0.12
Nodes (29): combineDecoratorsAndModifiers(), createNodeArray(), getTextOfNodeFromSourceText(), isJSDocTypeExpressionOrChild(), isJsxOpeningElement(), isJsxOpeningFragment(), parseErrorAt(), parseErrorAtRange() (+21 more)

### Community 358 - "enableDebugInfo"
Cohesion: 0.05
Nodes (53): attachFlowNodeDebugInfo(), attachFlowNodeDebugInfoWorker(), canUseOriginalText(), enableDebugInfo(), escapeTemplateSubstitution(), extendedDebug(), flattenTypeLiteralNodeReference(), formatCheckMode() (+45 more)

### Community 359 - "isBinaryExpression"
Cohesion: 0.14
Nodes (21): containsTopLevelCommonjs(), countBinaryExpressionParameters(), expressionResultIsUnused(), getContextualSignatureLocationInfo(), getEditsForToTemplateLiteral(), getHighestBinary(), getInitializerOfBinaryExpression(), getNodeOrParentOfParentheses() (+13 more)

### Community 360 - ".transformSourceFile"
Cohesion: 0.12
Nodes (27): chainBundle(), CustomTransformer, transformECMAScriptModule(), transformES2015(), transformES2016(), transformES2019(), transformES2020(), transformES2021() (+19 more)

### Community 361 - "parseConfig"
Cohesion: 0.16
Nodes (15): getEntries(), getExtendedConfig(), getModeForFileReference(), hasChangesInResolutions(), isString(), loadSafeList(), loadTypesMap(), loadWithTypeDirectiveCache() (+7 more)

### Community 362 - "isPropertyAccessExpression"
Cohesion: 0.16
Nodes (15): admin_can_post(), banned(), now_ms(), object_number(), peer_can_send_media(), resolve_account_capability_blocking(), resolve_approved_alternate_identity(), Option (+7 more)

### Community 363 - "contains"
Cohesion: 0.12
Nodes (16): 1. Skill Meta, 2.1 Swiss Industrial Print, 2.2 Tactical Telemetry & CRT Terminal, 2. Visual Archetypes, 3.1 Macro-Typography (Structural Headers), 3.2 Micro-Typography (Data & Telemetry), 3.3 Textural Contrast (Artistic Disruption), 3. Typographic Architecture (+8 more)

### Community 364 - "doAddExistingFix"
Cohesion: 0.15
Nodes (17): arrayIsSorted(), binarySearch(), coalesceExports(), coalesceImports(), compareIdentifiers(), compareImportOrExportSpecifiers(), compareImportsOrRequireStatements(), compareStringsCaseInsensitive() (+9 more)

### Community 365 - ".forEach"
Cohesion: 0.12
Nodes (16): 10. SECTION RHYTHM RULE, 12. DENSITY & SPACING DISCIPLINE, 14. IMAGE / MEDIA DIRECTION, 16. MULTI-IMAGE CONSISTENCY RULE, 17. CLARITY CHECK, 19. RESPONSE BEHAVIOR, 1. ACTIVE BASELINE CONFIGURATION, 21. FINAL GOAL (+8 more)

### Community 366 - "isPropertyAccessExpression"
Cohesion: 0.17
Nodes (21): chainStartsWith(), convertOccurrences(), forEachNameInAccessChainWalkingLeft(), getBinaryInfo(), getConditionalInfo(), getElementOrPropertyAccessArgumentExpressionOrName(), getFinalExpressionInChain(), getLeftOfPropertyAccessOrQualifiedName() (+13 more)

### Community 367 - ".getLineAndCharacterOfPosition"
Cohesion: 0.08
Nodes (46): childIsUnindentedBranchOfConditionalExpression(), childStartsOnTheSameLineWithElseInIfStatement(), createCommentDirectivesMap(), deriveActualIndentationFromList(), findColumnForFirstNonWhitespaceCharacterInLine(), findEnclosingNode(), findFirstNonWhitespaceCharacterAndColumn(), findFirstNonWhitespaceColumn() (+38 more)

### Community 368 - "getFirstJSDocTag"
Cohesion: 0.11
Nodes (23): getEffectiveModifierFlagsAlwaysIncludeJSDoc(), getEffectiveModifierFlagsNoCache(), getFirstJSDocTag(), getJSDocAugmentsTag(), getJSDocClassTag(), getJSDocDeprecatedTag(), getJSDocDeprecatedTagNoCache(), getJSDocModifierFlagsNoCache() (+15 more)

### Community 369 - "getOrCreateEmitNode"
Cohesion: 0.02
Nodes (191): addDefaultValueAssignmentForBindingPattern(), addDefaultValueAssignmentForInitializer(), addDefaultValueAssignmentIfNeeded(), addDefaultValueAssignmentsIfNeeded(), addEmitFlags(), addEmitFlagsRecursively(), addEmitHelper(), addEmitHelpers() (+183 more)

### Community 370 - "getNewFileImportsAndAddExportInOldFile"
Cohesion: 0.07
Nodes (46): addMissingMemberInJs(), changeExport(), changeImports(), changeNamedToDefaultImport(), createIdentifier(), createOldFileImportsFromNewFile(), createRequireCall(), createUndefined() (+38 more)

### Community 371 - "getEmitFlags"
Cohesion: 0.18
Nodes (15): findUseStrictPrologue(), getRangesWhere(), getStatementsToMove(), insertStatementAfterCustomPrologue(), insertStatementAfterPrologue(), insertStatementAfterStandardPrologue(), insertStatementsAfterCustomPrologue(), insertStatementsAfterPrologue() (+7 more)

### Community 372 - ".forEach"
Cohesion: 0.13
Nodes (15): 0.A Read these signals first, 0.B Output a one-line "Design Read" before generating, 0. BRIEF INFERENCE (Read the Room Before Anything Else), 0.C If the brief is ambiguous, ask one question, do not guess, 0.D Anti-Default Discipline, 13. OUT OF SCOPE, 14. FINAL PRE-FLIGHT CHECK, 1.A Dial Inference (design read → dial values) (+7 more)

### Community 373 - "getSourceFileOfNode"
Cohesion: 0.13
Nodes (15): Appendix B - Canonical Sources (read these before reinventing), Apple Liquid Glass (Apple platforms only), Atlassian, Bootstrap, Carbon, Fluent UI, GOV.UK, Material Web (+7 more)

### Community 374 - "TopicMediaError"
Cohesion: 0.08
Nodes (25): Display, Error, Formatter, From, Result, Self, TopicMediaError, emit_delta_event() (+17 more)

### Community 375 - "createNodeArray"
Cohesion: 0.08
Nodes (39): abortParsingListOrMoveToNextToken(), attachFileToDiagnostics(), clearState(), createTokenRange(), fixupParentReferences(), getLanguageVariant(), getSpaceSuggestion(), initializeState() (+31 more)

### Community 377 - "getEmitFlags"
Cohesion: 0.13
Nodes (14): 0. EXECUTION CONTRACT FOR THE IMPLEMENTING AGENT, 11.1 Search behavior, 11.2 Search result behavior, 11.3 Responsive search, 11. SETTINGS SEARCH, 16.1 Policy visibility, 16.2 Current job isolation, 16.3 Fallback visibility (+6 more)

### Community 378 - "hasSyntacticModifier"
Cohesion: 0.15
Nodes (11): SUITE_ROOT, config, OUT, report, config, probeCacheKey(), getCdpJson(), logStep() (+3 more)

### Community 379 - ".getSourceFile"
Cohesion: 0.02
Nodes (159): changeImports(), compilerOptionsIndicateEsModules(), computeSuggestionDiagnostics(), concatConsecutiveString(), containsTopLevelCommonjs(), convertCallSiteGroupToIncomingCall(), convertCallSiteGroupToOutgoingCall(), convertToPrimaryNavBarMenuItem() (+151 more)

### Community 380 - "getEmitModuleKind"
Cohesion: 0.06
Nodes (54): collectExportedVariableInfo(), collectExternalModuleInfo(), containsDefaultReference(), createExternalHelpersImportDeclarationIfNeeded(), createRuntimeTypeSerializer(), getAdjustedLocationForExportDeclaration(), getAllowSyntheticDefaultImports(), getDefaultLibFileName() (+46 more)

### Community 381 - "AutoGramSplitManifest"
Cohesion: 0.09
Nodes (24): BinaryVolumePart, PathBuf, Result, Vec, split_binary_volume(), split_parts_are_bounded_and_reconstruct_exactly(), AutoGramSplitManifest, ManifestPartInfo (+16 more)

### Community 382 - "getAllRules"
Cohesion: 0.03
Nodes (84): addRule(), assign(), buildMap(), buildOverload(), convertCompileOnSaveOptionFromJson(), createBinder(), createOverload(), createRulesMap() (+76 more)

### Community 383 - "isAssignmentOperator"
Cohesion: 0.14
Nodes (14): 2. THE COMBINATORIAL VARIATION ENGINE, Background Character, Background Mode (per-section), Composition Anchor (per-section), CTA Variation, Hero Architecture, Hero Scale (per-page), Motion-Implied Language (+6 more)

### Community 384 - "createNodeArray"
Cohesion: 0.12
Nodes (31): attachFileToDiagnostics(), clearState(), createMissingNode(), createSourceFile(), fixupParentReferences(), initializeState(), isJSDocLikeText(), nextTokenJSDoc() (+23 more)

### Community 385 - "visitNode"
Cohesion: 0.26
Nodes (12): EncoderDecisionReceipt, OutputContract, Default, Option, PathBuf, Result, Self, test_transcode_missing_input_returns_err() (+4 more)

### Community 386 - "isBinaryExpression"
Cohesion: 0.30
Nodes (13): AutomationRow, delete_automation(), ensure_schema(), list_automations(), open_db(), resolve_migrator_db(), Connection, Option (+5 more)

### Community 387 - "getAllRules"
Cohesion: 0.30
Nodes (13): delete_profile(), ensure_schema(), list_profiles(), open_db(), ProfileRow, resolve_migrator_db(), Connection, Option (+5 more)

### Community 388 - "tryCast"
Cohesion: 0.03
Nodes (96): addImplementationReferences(), convertToAsyncFunction(), emptyNavigationBarNode(), entryToAccessExpression(), entryToFunctionCall(), findAncestor(), findNextToken(), findNodeToFix() (+88 more)

### Community 389 - "displayPart"
Cohesion: 0.10
Nodes (26): buildLinkParts(), createCompletionDetails(), createCompletionDetailsForSymbol(), createSimpleDetails(), displayPart(), findLinkNameEnd(), getCommentDisplayParts(), getCompletionEntryDetails() (+18 more)

### Community 390 - "checkDefined"
Cohesion: 0.10
Nodes (27): combineNormal(), combinePathsSafe(), computeModuleSpecifiers(), convertToReusableDiagnosticRelatedInformation(), convertToReusableDiagnostics(), convertToTSConfig(), ensurePathIsNonModuleName(), getCustomTypeMapOfCommandLineOption() (+19 more)

### Community 391 - "getDocumentationComment"
Cohesion: 0.22
Nodes (13): createSignatureHelpParameterForParameter(), createSignatureHelpParameterForTypeParameter(), getTypeHelpItem(), implementationKindDisplayParts(), itemInfoForParameters(), itemInfoForTypeParameters(), mapToDisplayParts(), nodeToDisplayParts() (+5 more)

### Community 392 - ".getChildren"
Cohesion: 0.15
Nodes (12): Actual behavior, Bug Investigation: Saved Message /81 Preview, Locale Parity, and General Settings, Expected behavior, Failed fixes, Hypotheses tried, Next steps, Reproduction steps, Status (+4 more)

### Community 393 - "isAssignmentOperator"
Cohesion: 0.08
Nodes (24): accessKind(), getAssignmentTargetKind(), isAdditiveOperator(), isAdditiveOperatorOrHigher(), isAssignmentOperator(), isAssignmentOperatorOrHigher(), isAssignmentTarget(), isBitwiseOperator() (+16 more)

### Community 394 - "getOrCreateEmitNode"
Cohesion: 0.11
Nodes (20): addEmitHelper(), addEmitHelpers(), appendIfUnique(), doInterfaceChange(), doTypeAliasChange(), getOrCreateEmitNode(), getOriginalSourceFile(), getParseTreeNode() (+12 more)

### Community 395 - "isPropertyDeclaration"
Cohesion: 0.09
Nodes (33): addClassStaticThisReferences(), addPropertyDeclaration(), addUndefinedToOptionalProperty(), createNewArgument(), createPropertyOrShorthandAssignment(), createSuperAccessVariableStatement(), entityNameToString(), formatSymbol() (+25 more)

### Community 396 - "flattenDestructuringAssignment"
Cohesion: 0.15
Nodes (27): bindingOrAssignmentElementAssignsToName(), bindingOrAssignmentElementContainsNonLiteralComputedName(), bindingOrAssignmentPatternAssignsToName(), bindingOrAssignmentPatternContainsNonLiteralComputedName(), createDefaultValueCheck(), createDestructuringPropertyAccess(), ensureIdentifier(), flattenArrayBindingOrAssignmentPattern() (+19 more)

### Community 397 - "transformCallbackArgument"
Cohesion: 0.06
Nodes (61): canBeConvertedToExpression(), classExpressionToDeclaration(), collectCallSites(), collectCallSitesOfClassStaticBlockDeclaration(), collectCallSitesOfFunctionLikeDeclaration(), collectCallSitesOfModuleDeclaration(), collectCallSitesOfSourceFile(), convertExportsDotXEquals_replaceNode() (+53 more)

### Community 398 - "getRangeToExtract"
Cohesion: 0.15
Nodes (12): 1. Intent, 2. Scope, 3. Expected outcome, 4. Acceptance criteria, 5. Assumptions, 6. Risk, 7. Execution plan, Contoh transformasi (+4 more)

### Community 399 - "createTextSpan"
Cohesion: 0.15
Nodes (12): AutoGram Remediation Backlog (Comprehensive Edition), `REM-P0-001`: OutputContract Validator Missing, `REM-P1-001`: Encoder Transcode Worker Stub, `REM-P1-002`: Universal Format Category Enum Alignment, `REM-P2-001`: Physical Hardware GPU Probing (L0-L6), `REM-P2-002`: Cross-Platform Merge Scripts (Python & Android), `REM-P2-003`: Album Commit Reconciliation & UNKNOWN_COMMIT Handler, `REM-P2-004`: Scale Benchmark Suite S0-S4 (+4 more)

### Community 400 - "getDirectoryPath"
Cohesion: 0.21
Nodes (11): addMissingDeclarations(), and(), getArgumentInfoForCompletions(), getHeritageClauseSymbolTable(), getStringLiteralCompletionEntries(), getStringLiteralCompletionsFromSignature(), getStringLiteralTypes(), hasIndexSignature() (+3 more)

### Community 401 - "doChangeNamedToNamespaceOrDefault"
Cohesion: 0.15
Nodes (13): changesAffectingProgramStructure(), changesAffectModuleResolution(), compilerOptionsAffectDeclarationPath(), compilerOptionsAffectEmit(), compilerOptionsAffectSemanticDiagnostics(), compilerOptionValueToString(), equalOwnProperties(), getCompilerOptionValue() (+5 more)

### Community 402 - "some"
Cohesion: 0.17
Nodes (11): 1. Feature brief, 2. User flow, 3. Data flow, 4. UI states, 5. Edge cases, 6. Implementation plan, 7. Acceptance criteria, Alur kerja (+3 more)

### Community 403 - "isStringLiteralLike"
Cohesion: 0.17
Nodes (12): 4.10 Quotes & Testimonials, 4.11 Page Theme Lock (Light / Dark Mode Consistency), 4.1 Typography, 4.2 Color Calibration, 4.3 Layout Diversification, 4.4 Materiality, Shadows, Cards, 4.5 Interactive UI States, 4.6 Data & Form Patterns (+4 more)

### Community 404 - "DuplicateChecker"
Cohesion: 0.17
Nodes (14): ScanCacheEntry, CheckResult, DuplicateChecker, ensure_tables(), now_unix(), open_db(), Connection, HashMap (+6 more)

### Community 405 - "StorageError"
Cohesion: 0.15
Nodes (13): AndroidStorageProvider, DesktopStorageProvider, FileMetadata, Display, Error, Formatter, Result, Self (+5 more)

### Community 406 - "addNewNodeForMemberSymbol"
Cohesion: 0.09
Nodes (33): addFunctionDeclaration(), addJsxAttributes(), addMethodDeclaration(), addMissingConstraint(), addMissingMembers(), addNewNodeForMemberSymbol(), addObjectLiteralProperties(), collectCallSitesOfClassLikeDeclaration() (+25 more)

### Community 407 - "getCompletionData"
Cohesion: 0.23
Nodes (12): canHaveModifiers(), findLast(), getModifierKindFromSource(), getNonDecoratorTokenPosOfNode(), getTokenPosOfNode(), isInJSDoc(), moveRangePastDecorators(), moveRangePastModifiers() (+4 more)

### Community 408 - "breakIntoSpans"
Cohesion: 0.04
Nodes (62): addPragmaForMatch(), applyChanges(), breakIntoCharacterSpans(), breakIntoSpans(), breakIntoWordSpans(), breakPatternIntoTextChunks(), charIsPunctuation(), commandLineOptionsToMap() (+54 more)

### Community 409 - "getFunctionOrClassName"
Cohesion: 0.13
Nodes (23): areSameModule(), cleanText(), compareChildren(), declarationNameToString(), getCalledExpressionName(), getFullyQualifiedModuleName(), getFunctionOrClassName(), getItemName() (+15 more)

### Community 410 - "CompilerHost"
Cohesion: 0.07
Nodes (3): CompilerHost, MinimalResolutionCacheHost, ModuleResolutionHost

### Community 412 - "t"
Cohesion: 0.17
Nodes (11): 1. Source Code Evidence Catalog (CODE-xxx), 2. Log Verification Catalog (LOG-xxx), AutoGram Evidence Index (Expanded & Detailed Edition), Evidence ID: `CODE-V41-001`, Evidence ID: `CODE-V41-002`, Evidence ID: `CODE-V44-001`, Evidence ID: `CODE-V44-002`, Evidence ID: `CODE-V45-001` (+3 more)

### Community 413 - "flattenDestructuringBinding"
Cohesion: 0.17
Nodes (12): 19.10 `DuplicatesTab.tsx` and `SpaceUsageTab.tsx`, 19.11 `DriveTransferDock.tsx`, 19.1 `index.tsx`, 19.2 `DriveTransferSettings.tsx`, 19.3 `TransferOrchestrationSettings.tsx`, 19.4 `encoderHardwareOptions.ts`, 19.5 `TransferPreflightDialog.tsx`, 19.6 `DriveTransferManager.tsx` (+4 more)

### Community 414 - "quality.rs"
Cohesion: 0.17
Nodes (22): classify_delivery(), classify_media(), classify_prepared_delivery(), DeliveryClassification, ext_category(), fixture(), is_consumer_audio(), iso_bmff_brands_do_not_all_become_video() (+14 more)

### Community 415 - "isSourceFile"
Cohesion: 0.07
Nodes (61): canHaveExportModifier(), eachUnreachableRange(), find(), findAllInitialDeclarations(), findImplementation(), findImplementationOrAllInitialDeclarations(), getAdjustedLocationForClass(), getAdjustedLocationForDeclaration() (+53 more)

### Community 416 - ".getChildren"
Cohesion: 0.33
Nodes (10): clampHealTimeoutMs(), computePollSchedule(), ENSURE_PHASE_BUDGETS_MS, ensureChildWorstCaseMs(), formatPhaseLine(), formatProgressStatus(), parentDeadlineCoversChild(), scheduleTotalMs() (+2 more)

### Community 417 - "createTypeChecker"
Cohesion: 0.11
Nodes (11): aggregateChildData(), containsParseError(), createGetSymbolWalker(), createTypeChecker(), getConstantValue(), getFirstIdentifier(), getPropertySymbolOfDestructuringAssignment(), skipTypeChecking() (+3 more)

### Community 418 - "doChange"
Cohesion: 0.17
Nodes (12): arrayElementCouldBeVariableDeclaration(), flattenDestructuringAssignment(), isAssignmentExpression(), isCallLikeExpression(), isDestructuringAssignment(), isEmptyArrayLiteral(), isEmptyObjectLiteral(), isLeftHandSideOfAssignment() (+4 more)

### Community 419 - "enableDebugInfo"
Cohesion: 0.02
Nodes (201): addUndefinedToOptionalProperty(), canHaveModifiers(), canProduceDiagnostics(), canUseOriginalText(), collectCallSites(), collectCallSitesOfClassLikeDeclaration(), collectCallSitesOfClassStaticBlockDeclaration(), collectCallSitesOfFunctionLikeDeclaration() (+193 more)

### Community 420 - "computeModuleSpecifiers"
Cohesion: 0.06
Nodes (76): afterProgramDone(), arrayToMap(), buildErrors(), convertDocumentToSourceMapper(), convertToTSConfig(), createBuilderProgramUsingProgramBuildInfo(), createDiagnosticCollection(), createDiagnosticReporter() (+68 more)

### Community 421 - "createCompletionEntry"
Cohesion: 0.20
Nodes (10): containsNonPublicProperties(), getApparentProperties(), getCombinedModifierFlags(), getDeclarationModifierFlagsFromSymbol(), getObjectFlags(), getPropertiesForObjectExpression(), isDeclarationReadonly(), isEnumConst() (+2 more)

### Community 422 - "LanguageServiceShimHostAdapter"
Cohesion: 0.11
Nodes (8): createLanguageServiceSourceFile(), ensureScriptKind(), getScriptKind(), getScriptKindFromFileName(), LanguageServiceShimHostAdapter(), setSourceFileFields(), SyntaxTreeCache(), updateLanguageServiceSourceFile()

### Community 423 - "isIdentifier"
Cohesion: 0.02
Nodes (248): addChildrenRecursively(), addImplementationReferences(), addLeafNode(), addNodeWithRecursiveChild(), addNodeWithRecursiveInitializer(), addTrackedEs5Class(), arrayElementCouldBeVariableDeclaration(), chainStartsWith() (+240 more)

### Community 424 - "download.rs"
Cohesion: 0.13
Nodes (21): DownloadConflictPolicy, DownloadDestinationPlan, DownloadIntegrity, finalize_partial(), open_partial_for_append(), overwrite_finalization_restores_or_replaces_safely(), partial_path_for(), partial_resume_truncates_unverified_tail() (+13 more)

### Community 425 - "transfer/mod.rs"
Cohesion: 0.12
Nodes (15): environment_flag(), parse_flag(), Default, Option, Self, safe_rollback_disables_dependent_features(), TransferFeatureFlags, OversizeAction (+7 more)

### Community 426 - "Expression"
Cohesion: 0.07
Nodes (27): ArrayDestructuringAssignment, AsExpression, AssignmentExpression, AwaitExpression, BinaryExpression, CommaListExpression, ConditionalExpression, DeleteExpression (+19 more)

### Community 428 - "mapDefined"
Cohesion: 0.17
Nodes (24): flatMap(), getAllReferencesForImportMeta(), getAllReferencesForKeyword(), getLabelReferencesInNode(), getPossibleSymbolReferenceNodes(), getReferencedSymbolsSpecial(), getReferencesForStringLiteral(), getReferencesForSuperKeyword() (+16 more)

### Community 429 - "getSymbolDisplayPartsDocumentationAndSymbolKind"
Cohesion: 0.23
Nodes (13): containsOnlyAmbientModules(), getCombinedLocalAndExportSymbolFlags(), getDeclarationOfKind(), getExternalModuleImportEqualsDeclarationExpression(), getImmediatelyContainingArgumentOrContextualParameterInfo(), getSymbolDisplayPartsDocumentationAndSymbolKind(), getSymbolKind(), getSymbolKindOfConstructorPropertyMethodAccessorFunctionOrVar() (+5 more)

### Community 430 - "assert"
Cohesion: 0.18
Nodes (10): Fix strategy, Large-stream and duplicate split investigation — 2026-08-09, Remaining caution, Root cause and fix, Root causes found, Scope, Split video playback follow-up, Symptom (+2 more)

### Community 431 - "patchNodeFactory"
Cohesion: 0.18
Nodes (10): Bug Fix Loop Investigator Skill, Bug investigation log, Cycle 1: Reproduce, Cycle 2: Diagnose, Cycle 3: Patch, Cycle 4: Verify, Cycle 5: Stop condition, Output yang diharapkan (+2 more)

### Community 432 - "isWhiteSpaceLike"
Cohesion: 0.18
Nodes (11): 22. IMPLEMENTATION PHASES AND CHECKLIST, Phase 10: Cleanup and verification, Phase 1: Establish one source of truth, Phase 2: Build shared settings workspace, Phase 3: Rebuild Upload Basic UI, Phase 4: Rebuild Upload Advanced UI, Phase 5: Rebuild Download UI, Phase 6: Rebuild Profiles and search (+3 more)

### Community 433 - "session_guard.rs"
Cohesion: 0.15
Nodes (19): acquire(), ActivityEntry, now_ms(), registry(), release(), release_all_for_session(), Drop, HashMap (+11 more)

### Community 434 - "models.rs"
Cohesion: 0.17
Nodes (22): MediaScopeKind, NavigationScope, OpenTopicMediaRequest, OpenTopicMediaResult, Default, Option, Self, Vec (+14 more)

### Community 435 - "some"
Cohesion: 0.16
Nodes (21): childIsDecorated(), classOrConstructorParameterIsDecorated(), containsGlobalScopeAugmentation(), getAllDecoratorsOfAccessors(), getAllDecoratorsOfClass(), getAllDecoratorsOfClassElement(), getAllDecoratorsOfMethod(), getAllDecoratorsOfProperty() (+13 more)

### Community 436 - "breakIntoSpans"
Cohesion: 0.03
Nodes (95): betterMatch(), breakIntoCharacterSpans(), breakIntoSpans(), breakIntoWordSpans(), breakPatternIntoTextChunks(), charIsPunctuation(), charSize(), compareBooleans() (+87 more)

### Community 437 - "hasProperty"
Cohesion: 0.18
Nodes (11): 8.1 Advanced card: Album and grouping, 8.2 Advanced card: Failure recovery, 8.3 Advanced card: Large-file handling, 8.4 Advanced card: Scheduling and delivery identity, 8.5 Advanced card: Item targeting, 8.6 Advanced card: Encoder tuning, 8. DETAILED ADVANCED UPLOAD UI, Album packing options (+3 more)

### Community 438 - "AccountCapability"
Cohesion: 0.16
Nodes (15): AccountCapability, CapabilitySource, default_caption_limit(), Into, Result, Self, runtime_limit_uses_max_parts_and_selected_part_size(), validate_part_size() (+7 more)

### Community 439 - "transformNodes"
Cohesion: 0.16
Nodes (6): createEmitHelperFactory(), CoreTransformationContext, TransformationContext, TransformationResult, transformNodes(), transformNodes()

### Community 440 - "Statement"
Cohesion: 0.08
Nodes (25): Block, BreakStatement, ContinueStatement, DebuggerStatement, DoStatement, EmptyStatement, ExpressionStatement, ForInStatement (+17 more)

### Community 441 - "ReadonlyESMap"
Cohesion: 0.09
Nodes (10): Collection, ESMap, Map, ReadonlyCollection, ReadonlyESMap, ReadonlyMap, ReadonlySet, ReadonlyUnderscoreEscapedMap (+2 more)

### Community 442 - "hasSyntacticModifier"
Cohesion: 0.40
Nodes (6): createTemplateCooked(), hasInvalidEscape(), isNoSubstitutionTemplateLiteral(), isStringLiteralLike(), processTaggedTemplateExpression(), tryGetPropertyName()

### Community 443 - "visitNode"
Cohesion: 0.11
Nodes (25): forEachChildInBlock(), forEachChildInCallOrConstructSignature(), forEachChildInCallOrNewExpression(), forEachChildInClassDeclarationOrExpression(), forEachChildInContinueOrBreakStatement(), forEachChildInImportOrExportSpecifier(), forEachChildInJSDocLinkCodeOrPlain(), forEachChildInJSDocParameterOrPropertyTag() (+17 more)

### Community 444 - "getCompletionEntryCodeActionsAndSourceDisplay"
Cohesion: 0.20
Nodes (9): 1. PYTHON-DRIVEN TRUE RANDOMIZATION (BREAKING THE LOOP), 2. AIDA STRUCTURE & SPACING, 3. HERO ARCHITECTURE & THE 2-LINE IRON RULE, 4. THE GAPLESS BENTO GRID, 5. ADVANCED GSAP MOTION & HOVER PHYSICS, 6. COMPONENT ARSENAL & CREATIVITY, 7. CONTENT, ASSETS & STRICT BANS, 8. MANDATORY PRE-FLIGHT <design_plan> (+1 more)

### Community 445 - "createPrinter"
Cohesion: 0.01
Nodes (195): addFunctionDeclaration(), addMissingDeclarations(), addMissingMembers(), addNewNodeForMemberSymbol(), and(), assertEachIsDefined(), buildLinkParts(), checkEachDefined() (+187 more)

### Community 446 - "isStringOrNumericLiteralLike"
Cohesion: 0.20
Nodes (10): 22. STYLE VARIATION ENGINE, Decorative Asset Set, Image Art Direction Bias, Motion-Implied Language, Palette Logic, Signature Component Set, Structure Bias, Texture / Surface Treatment (+2 more)

### Community 447 - "getAssignmentDeclarationKindWorker"
Cohesion: 0.20
Nodes (9): Checklist akhir, Code quality, Format status akhir, Functional, Implementation Quality Gate Skill, Prinsip utama, Safety, UI/UX (+1 more)

### Community 448 - "album.rs"
Cohesion: 0.19
Nodes (25): AlbumCommitIntent, AlbumCommitState, AlbumCompatibilityKey, AlbumFailurePolicy, AlbumPackingPolicy, AlbumPlan, AlbumPlanOptions, build_album_plan() (+17 more)

### Community 449 - "TopicMediaService"
Cohesion: 0.12
Nodes (16): Arc, HashMap, Mutex, Self, ScopedCancellationManager, AppHandle, Arc, AtomicU64 (+8 more)

### Community 450 - "patchNodeFactory"
Cohesion: 0.07
Nodes (30): aggregateChildrenFlags(), createDeprecation(), createErrorDeprecation(), createWarningDeprecation(), deprecate(), error(), formatDeprecationMessage(), getTransformFlagsSubtreeExclusions() (+22 more)

### Community 451 - ".getSourceFile"
Cohesion: 0.15
Nodes (17): doTypeOnlyImportChange(), forEachImportClauseDeclaration(), getReferencedSymbolsForModule(), getReferencedSymbolsForModuleIfDeclaredBySourceFile(), getReferencedSymbolsForNode(), getReferencedSymbolsForSymbol(), getReferencesForFileName(), getReferencesForNonModule() (+9 more)

### Community 452 - "convertEntryToCallSite"
Cohesion: 0.06
Nodes (53): addClassStaticThisReferences(), addConstructorReferences(), addReference(), climbPastPropertyAccess(), climbPastPropertyOrElementAccess(), convertEntryToCallSite(), createTextRangeFromNode(), findInheritedConstructorReferences() (+45 more)

### Community 453 - "isVariableDeclaration"
Cohesion: 0.20
Nodes (9): 1. Protocol Overview, 2. Absolute Negative Constraints (Banned Elements), 3. Typographic Architecture, 4. Color Palette (Warm Monochrome + Spot Pastels), 5. Component Specifications, 6. Iconography & Imagery Directives, 7. Subtle Motion & Micro-Animations, 8. Execution Protocol (+1 more)

### Community 454 - "caption.rs"
Cohesion: 0.16
Nodes (19): AlbumCaptionAssignment, apply_album_caption_policy(), CaptionDetailMode, CaptionOverflowPolicy, CaptionTemplateContext, empty_summary_preserves_per_item_captions(), fail_policy_is_explicit(), item() (+11 more)

### Community 455 - "4.10.3050.1/manifest.json"
Cohesion: 0.09
Nodes (22): cbcs, cenc, x64, x86_64, x86_64h, accept_arch, description, icons (+14 more)

### Community 456 - "p"
Cohesion: 0.04
Nodes (66): addConvertToAsyncFunctionDiagnostics(), assertType(), checkFixedAssignableTo(), chooseBetterSymbol(), createDiagnosticForNode(), createNavigateToItem(), createObjectTypeFromLabeledExpression(), createSymbolTable() (+58 more)

### Community 457 - "createGetSymbolAccessibilityDiagnosticForNode"
Cohesion: 0.06
Nodes (58): canHaveIllegalTypeParameters(), canProduceDiagnostics(), createGetSymbolAccessibilityDiagnosticForNode(), createGetSymbolAccessibilityDiagnosticForNodeName(), entryToImportOrExport(), getAdjustedLocation(), getAdjustedLocationForHeritageClause(), getContainingClassIfInHeritageClause() (+50 more)

### Community 458 - "MemberExpression"
Cohesion: 0.09
Nodes (23): CallChain, CallExpression, ElementAccessChain, ElementAccessExpression, ExpressionWithTypeArguments, ImportCall, ImportTypeNode, JsxTagNamePropertyAccess (+15 more)

### Community 459 - "getAdjustedLocation"
Cohesion: 0.20
Nodes (10): 10. REFERENCE VOCABULARY (Pattern Names the Agent Should Know), Animation Library Choice, Cards & Containers, Galleries & Media, Hero Paradigms, Layout & Grids, Micro-Interactions & Effects, Navigation & Menus (+2 more)

### Community 460 - "getAssignmentDeclarationKindWorker"
Cohesion: 0.17
Nodes (23): getAssignedExpandoInitializer(), getAssignmentDeclarationKindWorker(), getAssignmentDeclarationPropertyAccessKind(), getDeclaredExpandoInitializer(), getDefaultedExpandoInitializer(), getEffectiveInitializer(), getElementOrPropertyAccessName(), getEntityNameFromTypeNode() (+15 more)

### Community 461 - "getReferencesAtLocation"
Cohesion: 0.20
Nodes (9): AutoGram Real Remediation Plan (Phases 1 to 7), Phase 1: P0 Output Safety Chain Implementation, Phase 2: P0 Album Idempotency & UNKNOWN_COMMIT State Machine, Phase 3: P1 Universal Quality Engine & Router Alignment, Phase 4: P1 Oversize Transfer Engine & Merge Scripts, Phase 5: P1 Physical Hardware & Resource Admission Controller, Phase 6: P2 Transfer Scale & Reliability Engine, Phase 7: P2 Frontend UI, i18n & Final Verification Gate (+1 more)

### Community 462 - "isBindingElement"
Cohesion: 0.22
Nodes (9): 11. COMPONENT EXECUTION GUIDELINES, 3D Cascading Card Deck, Diagonal Staggered Square Masonry, Hover-Accordion Slice Layout, Off-Grid Editorial Layout, Pristine Gapless Bento Grid, Product UI Panel Stack, Turning Polaroid Arc (+1 more)

### Community 463 - "TypeObject"
Cohesion: 0.22
Nodes (9): 18. EXTRA CREATIVITY & IMPLEMENTATION EDGE, Composition variety check, Conversion focus, Cross-section contrast, CTA specificity, Cultural / tonal alignment, Data-viz restraint, Image variety inside one comp (+1 more)

### Community 464 - "MTProtoRangeReader"
Cohesion: 0.13
Nodes (15): AtomicUsize, MTProtoRangeReader, Bytes, Client, InputFileLocation, Option, Result, Self (+7 more)

### Community 465 - "MediaAnalysis"
Cohesion: 0.18
Nodes (14): analysis(), analysis_cache_key(), analyze_media(), analyze_media_uncached(), ffprobe_path(), MediaAnalysis, ProbeFormat, ProbeRoot (+6 more)

### Community 466 - "isConstructorDeclaration"
Cohesion: 0.29
Nodes (8): deduplicateRelational(), deduplicateSorted(), indicesOf(), selectIndex(), sort(), sortAndDeduplicate(), sortAndDeduplicateDiagnostics(), stableSortIndices()

### Community 467 - "getNodeKind"
Cohesion: 0.22
Nodes (8): A. Executive Summary & Requirement Reconciliation, AutoGram Forensic Implementation Re-Verification Audit Report (Corrected Edition), B. Five Audit Coverage Metrics, C. Corrected Verdict per Specification, D. Critical Findings by Risk, E. Specification Conflicts Summary, F. Missing Dependency Summary, G. Final Audit Statement

### Community 468 - "getSymbolDisplayPartsDocumentationAndSymbolKind"
Cohesion: 0.22
Nodes (8): AutoGram Remediation Backlog (V3 Machine-Verified), `REM-P0-001`: OutputContract Validator Implementation, `REM-P1-001`: FFmpeg Transcode Worker Implementation, `REM-P2-001`: Physical Hardware GPU Probing (L0-L6), `REM-P2-002`: Cross-Platform Merge Scripts (Python & Android), `REM-P2-003`: Scale Benchmark Harness S0-S4, `REM-P3-001`: Rustfmt Formatting Compliance, Technical Remediation Priority Items

### Community 469 - "getEmitModuleResolutionKind"
Cohesion: 0.22
Nodes (9): 3.1 Canonical entry point, 3.2 Top-level sections, 3.3 Basic and Advanced modes, 3. FINAL INFORMATION ARCHITECTURE, Advanced Download sections, Advanced Upload sections, Basic Download sections, Basic Upload sections (+1 more)

### Community 470 - "mapDefined"
Cohesion: 0.03
Nodes (112): addToSeen(), CancellationTokenObject(), canHaveIllegalDecorators(), checkForClassificationCancellation(), createDefinitionFromSignatureDeclaration(), createDefinitionInfo(), createDefinitionInfoFromName(), createModuleSpecifierResolutionHost() (+104 more)

### Community 471 - "getFirstJSDocTag"
Cohesion: 0.39
Nodes (8): config, enterLavenderDrive(), main(), openGudangDuplicates(), rect(), splitState(), verifyPinMenu(), verifySplit()

### Community 472 - "babylon.js"
Cohesion: 0.17
Nodes (16): C(), D(), ee(), F(), Ge(), I(), j(), K() (+8 more)

### Community 473 - "addChildrenRecursively"
Cohesion: 0.23
Nodes (15): addChildrenRecursively(), addLeafNode(), addNodeWithRecursiveChild(), addNodeWithRecursiveInitializer(), addTrackedEs5Class(), endNestedNodes(), endNode(), getInteriorModule() (+7 more)

### Community 474 - "isArrowFunction"
Cohesion: 0.07
Nodes (57): annotate(), annotateJSDocParameters(), annotateJSDocThis(), annotateParameters(), annotateSetAccessor(), annotateThis(), annotateVariableDeclaration(), canDeleteEntireVariableStatement() (+49 more)

### Community 475 - "BuildInvalidedProject"
Cohesion: 0.10
Nodes (4): BuildInvalidedProject, InvalidatedProjectBase, UpdateBundleProject, UpdateOutputFileStampsProject

### Community 476 - "isCallExpression"
Cohesion: 0.08
Nodes (27): entryToType(), getPossibleGenericSignatures(), getStatementOrExpressionRange(), isExpressionInCallExpression(), isExpressionNode(), isExpressionOfOptionalChainRoot(), isExpressionWithTypeArgumentsInClassExtendsClause(), isInExpressionContext() (+19 more)

### Community 477 - "makeChange"
Cohesion: 0.22
Nodes (4): addEnumMemberDeclaration(), SignatureObject(), singleElementArray(), tryGetReturnType()

### Community 478 - "transformCallbackArgument"
Cohesion: 0.25
Nodes (9): addReplacementSpans(), charSize(), getDirectoryFragmentTextSpan(), getPossibleSymbolReferencePositions(), getStringLiteralCompletionsFromModuleNames(), isIdentifierPart(), isIdentifierStart(), isIdentifierText() (+1 more)

### Community 479 - "createGetSymbolAccessibilityDiagnosticForNode"
Cohesion: 0.28
Nodes (9): codeActionForFix(), codeFixActionToCodeAction(), couldBeTypeOnlyImportSpecifier(), getCompletionEntryCodeActionsAndSourceDisplay(), getImportCompletionAction(), getImportStatementCompletionInfo(), getPromoteTypeOnlyCompletionAction(), getSingleExportInfoForSymbol() (+1 more)

### Community 480 - "resolveTypeReferenceDirective"
Cohesion: 0.19
Nodes (16): classicNameResolver(), createResolvedModuleWithFailedLookupLocations(), diag(), getExtendsConfigPath(), isTraceEnabled(), loadModuleFromGlobalCache(), node16ModuleNameResolver(), nodeModuleNameResolver() (+8 more)

### Community 481 - "idText"
Cohesion: 0.22
Nodes (9): disposeEmitNodes(), dumpTypes(), getLocation(), getPropertiesToAdd(), getReferencedFilesFromImportedModuleSymbol(), getReferencedFilesFromImportLiteral(), getSourceFileOfNode(), shouldUseParentTypeOfProperty() (+1 more)

### Community 482 - "getDefinitionAtPosition"
Cohesion: 0.25
Nodes (9): findFirstNonJsxWhitespaceToken(), findRightmostChildNodeWithTokens(), findRightmostToken(), isJsxText(), isNonWhitespaceToken(), isToken(), isTokenKind(), isWhiteSpaceOnlyJsxText() (+1 more)

### Community 483 - "isValidCallHierarchyDeclaration"
Cohesion: 0.28
Nodes (8): isSemicolonInsertionContext(), nodeIsASICandidate(), positionIsASICandidate(), probablyUsesSemicolons(), syntaxRequiresTrailingCommaOrSemicolonOrASI(), syntaxRequiresTrailingFunctionBlockOrSemicolonOrASI(), syntaxRequiresTrailingModuleBlockOrSemicolonOrASI(), syntaxRequiresTrailingSemicolonOrASI()

### Community 484 - "getDocumentationComment"
Cohesion: 0.28
Nodes (9): consumeNode(), currentNode(), isDeclareModifier(), isReusableParsingContext(), parseDeclaration(), parseListElement(), reparseTopLevelAwait(), speculationHelper() (+1 more)

### Community 485 - "batch_optimizer.rs"
Cohesion: 0.16
Nodes (12): ActionCategory, BatchItemPlan, BatchPlan, plan_batch_execution(), PathBuf, Vec, classify_user_intent(), Option (+4 more)

### Community 486 - "getHighlightSpans"
Cohesion: 0.09
Nodes (31): aggregateAllBreakAndContinueStatements(), aggregateOwnedThrowStatements(), flatMapChildren(), getAsyncAndAwaitOccurrences(), getBreakOrContinueStatementOccurrences(), getDocumentHighlights(), getHighlightSpans(), getIfElseKeywords() (+23 more)

### Community 487 - "getRangeToExtract"
Cohesion: 0.14
Nodes (19): chainDiagnosticMessages(), collectTypeParameters(), createCodeFixActionMaybeFixAll(), createCodeFixActionWorker(), createDiagnosticForNodeArray(), createFileDiagnostic(), createTextRangeFromSpan(), diagnosticToString() (+11 more)

### Community 488 - ".delete"
Cohesion: 0.25
Nodes (8): 12. THE COMBINATORIAL VARIATION ENGINE, Background Character, Hero Architecture, Motion-Implied Language, Section System, Signature Component Set, Theme Paradigm, Typography Character

### Community 489 - "computeSuggestionDiagnostics"
Cohesion: 0.11
Nodes (27): computeSuggestionDiagnostics(), fixImportOfModuleExports(), getContextualKeywords(), getErrorNodeFromCommonJsIndicator(), getExportEqualsLocalSymbol(), getModeForUsageLocation(), getResolvedModule(), getResolvedSourceFileFromImportDeclaration() (+19 more)

### Community 490 - "JSDocTag"
Cohesion: 0.10
Nodes (20): JSDocAugmentsTag, JSDocAuthorTag, JSDocClassTag, JSDocDeprecatedTag, JSDocImplementsTag, JSDocOverrideTag, JSDocParameterTag, JSDocPrivateTag (+12 more)

### Community 491 - "getHighlightSpans"
Cohesion: 0.25
Nodes (8): 8. ANTI-AI-SLOP RULES, Carousel / marquee slop (layout), Content slop, Data / KPI slop, Density slop, Layout slop, Typography slop, Visual slop

### Community 492 - "toPath"
Cohesion: 0.25
Nodes (8): 9.A Visual & CSS, 9. AI TELLS (Forbidden Patterns), 9.B Typography, 9.C Layout & Spacing, 9.D Content & Data ("Jane Doe" Effect), 9.E External Resources & Components, 9.F Production-Test Tells (banned outright), 9.G EM-DASH BAN (the single most-violated Tell)

### Community 493 - "getNewImportFixes"
Cohesion: 0.32
Nodes (6): EncoderPolicy, EncoderResourceProfile, EncoderStrategy, Default, Option, Self

### Community 494 - "fail"
Cohesion: 0.33
Nodes (7): diagnosticCategoryName(), formatCodeSpan(), formatColorAndReset(), formatDiagnosticsWithColorAndContext(), getCategoryFormat(), realizeDiagnostic(), realizeDiagnostics()

### Community 495 - "addRange"
Cohesion: 0.22
Nodes (10): getDeclarationTransformers(), getJSXTransformEnabled(), getModuleTransformer(), getScriptTransformers(), getTransformers(), isBundle(), wrapCustomTransformer(), wrapCustomTransformerFactory() (+2 more)

### Community 496 - "isWhiteSpaceLike"
Cohesion: 0.09
Nodes (22): createExport(), createExportSpecifiers(), createSingleLineStringWriter(), doChanges(), formatOnEnter(), getDisplayPartWriter(), getDocCommentTemplateAtPosition(), getEndLinePosition() (+14 more)

### Community 497 - "isBlock"
Cohesion: 0.40
Nodes (5): isExpressionKind(), isLeftHandSideExpressionKind(), isUnaryExpression(), isUnaryExpressionKind(), skipPartiallyEmittedExpressions()

### Community 498 - "addChildrenRecursively"
Cohesion: 0.25
Nodes (7): 1. Domain Specification Hierarchy, 2. Explicit Domain Conflict Resolutions, 3. Scope Classifications, A. Album Packing & Grouping Size (v4.6 vs Master Architecture v2.8.7), AutoGram Real Specification Precedence Register, B. Commit Timeouts & Idempotency (v4.6 vs v4.5), C. Hardware Detection & Encoding (v4.7 vs v4.1)

### Community 499 - "isAssignmentExpression"
Cohesion: 0.36
Nodes (8): createJSSignatureHelpItems(), createSignatureHelpItems(), createTypeHelpItems(), flatMapToMutable(), getEnclosingDeclarationFromInvocation(), getExpressionFromInvocation(), getInvokedExpression(), getSignatureHelpItems()

### Community 500 - "assertIsDefined"
Cohesion: 0.03
Nodes (82): addCommonjsExport(), addEs6Export(), addExport(), addExportToChanges(), adjustIntersectingElement(), assertDiagnosticLocation(), assertEqual(), assertGreaterThanOrEqual() (+74 more)

### Community 501 - "displayPart"
Cohesion: 0.29
Nodes (7): 33. CATEGORY-SPECIFIC BIAS, Commerce, Fintech, Health / Fitness, Productivity, Social, Wellness / Lifestyle

### Community 502 - "isExpressionNode"
Cohesion: 0.29
Nodes (7): 13. COLOR & MATERIAL RULES, Background Confidence Rule, Background-image harmony, Gradient Discipline, Materiality, Palette Discipline, Strong guidance

### Community 503 - "resolve_thumbnail_strategy"
Cohesion: 0.15
Nodes (14): ThumbnailSource, ThumbnailStatus, get_smart_icon_name(), Option, get_format_capability(), PreviewCapability, Option, get_mode_profile() (+6 more)

### Community 504 - "getNodeKind"
Cohesion: 0.16
Nodes (16): convertToPrimaryNavBarMenuItem(), convertToTree(), getCombinedNodeFlagsAlwaysIncludeJSDoc(), getModifiers(), getNavigationBarItems(), getNavigationTree(), getNodeModifiers(), getNodeSpan() (+8 more)

### Community 505 - "getMeaningFromLocation"
Cohesion: 0.25
Nodes (8): getEmitModuleDetectionKind(), getImportMetaIfNecessary(), getSetExternalModuleIndicator(), isFileForcedToBeModuleByFormat(), isFileModuleFromUsingJSXTag(), isFileProbablyExternalModule(), setExternalModuleIndicator(), walkTreeForImportMeta()

### Community 506 - "every"
Cohesion: 0.20
Nodes (12): arraysEqual(), assertEachNode(), deleteUnusedImports(), deleteUnusedImportsInDeclaration(), deleteUnusedImportsInVariableDeclaration(), every(), expressionCouldBeVariableDeclaration(), flattenDestructuringBinding() (+4 more)

### Community 507 - "getSourceFileOfNode"
Cohesion: 0.20
Nodes (16): concatConsecutiveString(), copyComments(), copyExpressionComments(), copyLeadingComments(), copyTrailingAsLeadingComments(), copyTrailingComments(), escapeRawStringForTemplate(), forEachTrailingCommentRange() (+8 more)

### Community 508 - "createCompletionEntry"
Cohesion: 0.19
Nodes (17): createCompletionEntry(), escapeSnippetText(), getInsertTextAndReplacementSpanForImportCompletion(), getSourceFromOrigin(), isQuoteOrBacktick(), isRecommendedCompletionMatch(), originIsExport(), originIsNullableMember() (+9 more)

### Community 509 - "isQualifiedName"
Cohesion: 0.36
Nodes (8): createExpressionForJsxElement(), createExpressionForJsxFragment(), createJsxFactoryExpression(), createJsxFactoryExpressionFromEntityName(), createJsxFragmentFactoryExpression(), createReactNamespace(), setStartsOnNewLine(), startOnNewLine()

### Community 510 - "getEmitModuleKind"
Cohesion: 0.16
Nodes (21): addEmitFlags(), addEmitFlagsRecursively(), createExternalHelpersImportDeclarationIfNeeded(), getAllowSyntheticDefaultImports(), getEmitHelpers(), getEmitModuleKind(), getESModuleInterop(), getExportEqualsImportKind() (+13 more)

### Community 511 - "BuilderProgram"
Cohesion: 0.11
Nodes (3): BuilderProgram, EmitAndSemanticDiagnosticsBuilderProgram, SemanticDiagnosticsBuilderProgram

### Community 512 - "find"
Cohesion: 0.29
Nodes (7): 4. HERO MINIMALISM RULES, Absolute Hero Rules, Graphic Restraint, Headline Rule, Hero Composition Bias, Pre-output check, Typography Execution

### Community 513 - "isPropertyAssignment"
Cohesion: 0.17
Nodes (13): charactersFuzzyMatchInString(), completionEntryDataIsResolved(), completionEntryDataToSymbolOriginInfo(), continuePreviousIncompleteResponse(), getAutoImportSymbolFromCompletionEntryData(), isIdentifierInNonEmittingHeritageClause(), isPartOfPossiblyValidTypeOrAbstractComputedPropertyName(), isPartOfTypeQuery() (+5 more)

### Community 514 - "isExpressionStatement"
Cohesion: 0.29
Nodes (6): Banned Output Patterns, Baseline, Execution Process, Full-Output Enforcement, Handling Long Outputs, Quick Check

### Community 515 - "isFunctionLike"
Cohesion: 0.29
Nodes (6): APPENDICES - Real Source-Backed Reference Material, Appendix A - Install Commands per Design System, Appendix C - Apple Liquid Glass: Honest Web Approximation, Safer web approximation skeleton, What is NOT official, What is official

### Community 516 - "getEffectiveTypeParameterDeclarations"
Cohesion: 0.29
Nodes (7): 11.A Detect the Mode (first action), 11.B Audit Before Touching, 11.C Preservation Rules, 11.D Modernisation Levers (priority order), 11.E Decision Tree: Targeted Evolution vs Full Redesign, 11.F What Never Changes Silently, 11. REDESIGN PROTOCOL

### Community 517 - "2. 16 Detail Mikro Teknis & Trik Arsitektur Berdampak Besar (Micro-Technical Nuances & High-Impact Details)"
Cohesion: 0.12
Nodes (17): 10. Bounded MPSC Channel (`mpsc::channel(24)`), 11. Dynamic Loopback Port Binding (`tiny_http` pada `127.0.0.1:0`), 12. Tail `moov` Relocation & Async Tail-Fetch (`need_async_moov_tail`), 13. `StreamEntry` LIVE RwLock Map & Range Merge State Machine, 14. `DemandRangeReader` & 16 MB HTTP Response Cap, 15. 3-Layer Seek Fix (v2.7.2), 16. Sparse ZIP Central Directory Read, 1. 512 KB MTProto Boundary Alignment (`offset - (offset % 512KB)`) (+9 more)

### Community 518 - "doc_preview.rs"
Cohesion: 0.24
Nodes (15): bounded_text_sample_is_unicode_safe_and_marks_partial_content(), ext_of(), extract_office_zip(), extract_rtf_plain(), guess_mime(), is_text_ext(), LocalDocPreview, looks_binary() (+7 more)

### Community 519 - "assertNever"
Cohesion: 0.29
Nodes (7): 3.A Stack, 3.B State, 3.C Icons, 3.D Emoji Policy, 3. DEFAULT ARCHITECTURE & CONVENTIONS, 3.E Responsiveness & Layout Mechanics, 3.F Dependency Verification (mandatory)

### Community 520 - "getNextInvalidatedProjectCreateInfo"
Cohesion: 0.29
Nodes (7): 6.A Hardware Acceleration, 6.B Reduced Motion (mandatory), 6.C Dark Mode (mandatory for any consumer-facing page), 6.D Core Web Vitals Targets, 6.E DOM Cost, 6.F Z-Index Restraint, 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS

### Community 521 - "formatSyntaxKind"
Cohesion: 0.29
Nodes (7): 15.1 Workflow, 15.2 Preflight dialog redesign, 15.3 Disable re-encode handling, 15. PREFLIGHT REDESIGN AND WORKFLOW INTEGRATION, Actions, Item list, Summary region

### Community 522 - "getSymbolScope"
Cohesion: 0.29
Nodes (7): 23. ACCEPTANCE CRITERIA, Accessibility, Architecture, Encoder, Responsive behavior, UI and UX, Workflow

### Community 523 - "convertEntryToCallSite"
Cohesion: 0.14
Nodes (23): addConstructorReferences(), climbPastPropertyAccess(), climbPastPropertyOrElementAccess(), convertEntryToCallSite(), createTextRangeFromNode(), findOwnConstructorReferences(), findSuperConstructorAccesses(), forEachDescendantOfKind() (+15 more)

### Community 524 - "idText"
Cohesion: 0.10
Nodes (26): canCompleteFromNamedBindings(), collectExternalModuleInfo(), containsDefaultReference(), extractSingleNode(), findNamespaceReExports(), forEachPossibleImportOrExportStatement(), getAdjustedLocationForExportDeclaration(), getAdjustedLocationForImportDeclaration() (+18 more)

### Community 525 - "isRequireCall"
Cohesion: 0.26
Nodes (15): changeDefaultToNamedImport(), convertedImports(), convertFileToEsModule(), convertPropertyAccessImport(), convertSingleIdentifierImport(), convertSingleImport(), convertStatement(), convertVariableStatement() (+7 more)

### Community 526 - "getDefinitionAtPosition"
Cohesion: 0.20
Nodes (14): createDefinitionFromSignatureDeclaration(), createDefinitionInfo(), definitionFromType(), getDefinitionAtPosition(), getDefinitionFromSymbol(), getDefinitionInfoForFileReference(), getDefinitionInfoForIndexSignatures(), getTouchingPropertyName() (+6 more)

### Community 527 - "getTypescriptKeywordCompletions"
Cohesion: 0.10
Nodes (25): collectExportRenames(), completionInfoFromData(), getKeywordCompletions(), getOptionalReplacementSpan(), getTypescriptKeywordCompletions(), identity(), insertSorted(), isCheckedFile() (+17 more)

### Community 528 - "NodeObject"
Cohesion: 0.09
Nodes (17): assignPositionsToNode(), assignPositionsToNodeArray(), containsPrecedingToken(), findContainingList(), findListItemInfo(), getActualIndentationForListItemBeforeComma(), getArgumentIndex(), getArgumentOrParameterListAndIndex() (+9 more)

### Community 529 - "pop"
Cohesion: 0.29
Nodes (7): 9.1 Download overview strip, 9.2 Card 1: Download performance, 9.3 Card 2: Existing-file behavior, 9.4 Card 3: Recovery and completion, 9.5 Advanced card: Integrity verification, 9.6 Section reset, 9. DETAILED DOWNLOAD UI

### Community 530 - "getLocaleSpecificMessage"
Cohesion: 0.33
Nodes (6): createNewParameters(), getRefactorableParameters(), getRefactorableParametersLength(), hasThisParameter(), isValidParameterDeclaration(), isValidParameterNodeArray()

### Community 531 - "isImportSpecifier"
Cohesion: 0.29
Nodes (7): getEffectiveSetAccessorTypeAnnotationNode(), getSetAccessorTypeAnnotationNode(), getSetAccessorValueParameter(), getThisParameter(), identifierIsThisKeyword(), isThisIdentifier(), parameterIsThisKeyword()

### Community 532 - "getContextualType"
Cohesion: 0.33
Nodes (5): Aturan, Contoh, Conventional Commit Skill, Format, Type yang boleh

### Community 533 - "getAdjustedLocation"
Cohesion: 0.33
Nodes (6): 29. ANTI-AI-SLOP RULES, Content slop, Density slop, Layout slop, Typography slop, Visual slop

### Community 534 - "NodeObject"
Cohesion: 0.33
Nodes (6): 5. IMAGE COUNT & PAGE SLICING, Continuity Rule, Counting rule, Format, Section size variety, THIS IS THE PRIMARY OUTPUT RULE

### Community 535 - "EncoderQualityProfile"
Cohesion: 0.29
Nodes (6): GpuProbeLevel, HardwareEncoderType, PhysicalGpuReport, probe_physical_gpu_capabilities(), Vec, test_probe_physical_gpu_returns_valid_report()

### Community 536 - "build_quality_preflight"
Cohesion: 0.28
Nodes (16): build_quality_preflight(), fail_policy_blocks_over_limit_caption_before_queueing(), is_remote(), original_never_proposes_a_transform(), preflight_explains_album_caption_assignment_and_runtime_truncation(), QualityPreflightDuplicateMatch, QualityPreflightItem, QualityPreflightReport (+8 more)

### Community 537 - "SmartScanner"
Cohesion: 0.13
Nodes (11): MediaFingerprint, Option, Vec, HashMap, Into, Option, Result, Self (+3 more)

### Community 538 - "get_cached_page"
Cohesion: 0.17
Nodes (14): list_media_legacy_facade(), Option, TopicMediaItem, Vec, get_cached_page(), mark_topic_media_deleted(), now_unix(), Option (+6 more)

### Community 539 - "assertIsDefined"
Cohesion: 0.05
Nodes (54): addSyntheticNodes(), adjustIntersectingElement(), assertDiagnosticLocation(), assertEqual(), assertGreaterThanOrEqual(), assertIsDefined(), assertLessThanOrEqual(), assertMissingNode() (+46 more)

### Community 540 - "length"
Cohesion: 0.20
Nodes (12): documentSpansEqual(), filterSameAsDefaultInclude(), getAwaitErrorSpanExpression(), getConvertableOverloadListAtPosition(), getIsMatchingAsyncError(), getRefactorActionsToConvertOverloadsToOneSignature(), getResolutionModeOverrideForClause(), isConvertableSignatureDeclaration() (+4 more)

### Community 541 - ".test"
Cohesion: 0.33
Nodes (5): Aturan UI, Langkah kerja, Output yang diharapkan, Prinsip utama, React Refactor Safe Skill

### Community 542 - "compareValues"
Cohesion: 0.33
Nodes (5): Buat test matrix, Output, Prinsip utama, Regression Test Planner Skill, Untuk Playwright

### Community 543 - "isExpression"
Cohesion: 0.33
Nodes (5): Checklist debugging, Output yang diharapkan, Pola solusi, Prinsip utama, Scroll Touch Debugger Skill

### Community 544 - "AutoGram Master Architecture, WorkTree & Operational Workflow Specification"
Cohesion: 0.13
Nodes (14): 11. Internasionalisasi (i18n) — 100% Zero Hardcoded Strings, 12. Keamanan System & Management Kredensial, 13. Rate Limit, FloodWait, & Konfigurasi Jaringan, 14. Matriks Hubungan & Panggilan Inter-Module (Call Graph Matrix), 15. Matriks Status Fitur (Feature Matrix v2.8.7), 16. Standar Governance Agent & Ekosistem Skill Pack, 1. Pendahuluan & Filosofi Arsitektur Utama (Core Technical Philosophy), 5 Pilar Utama Arsitektur Teknis v2.8.7: (+6 more)

### Community 545 - "encoder_provider.rs"
Cohesion: 0.13
Nodes (15): HardwareProfileInfo, select_best_hardware_profile(), DesktopEncoderProvider, EncoderError, EncoderProvider, EncoderQualityProfile, HardwareCapability, Default (+7 more)

### Community 546 - "DesktopResourceProvider"
Cohesion: 0.17
Nodes (7): DesktopResourceProvider, DeviceThermalState, ResourceProvider, Option, Self, Send, Sync

### Community 547 - "UploadResumeState"
Cohesion: 0.19
Nodes (8): calculate_chunk_allocation(), ChunkAllocation, Into, Self, Vec, UploadResumeState, ChunkedUploader, Self

### Community 548 - "renameCollidingVarNames"
Cohesion: 0.60
Nodes (5): GpuAdapterInfo, HardwarePlaybackProbeResult, PlaybackBackendCapability, probe_hardware_playback_capabilities(), Vec

### Community 549 - "getInfo"
Cohesion: 0.33
Nodes (6): getRefactorActionsToConvertToOptionalChain(), getRefactorActionsToInferReturnType(), getRefactorActionsToRemoveFunctionBraces(), getRefactorEditsToConvertToOptionalChain(), getRefactorEditsToInferReturnType(), isRefactorErrorInfo()

### Community 550 - "createPrinter"
Cohesion: 0.23
Nodes (12): createPrinter(), createSnippetPrinter(), createTextWriter(), createWriter(), getEntryForMemberCompletion(), getEntryForObjectLiteralMethodCompletion(), getNewLineCharacter(), getNewLineKind() (+4 more)

### Community 551 - "isFixablePromiseHandler"
Cohesion: 0.33
Nodes (5): 1. Core Principles, 2. Normative Invariants, 3. Implementation Roadmap & Verification Gates, AutoGram Quality Mode Engine Overhaul (v4.1.0), ORIGINAL · HQ · SMART

### Community 552 - ".getLineStarts"
Cohesion: 0.33
Nodes (5): 1. Requirement Count Reconciliation, 2. Five Coverage Metrics, 3. Log File SHA-256 Hashes and Summary Verification, AutoGram Audit Automated Consistency Check, Detailed Breakdown by Status Category

### Community 553 - "clear"
Cohesion: 0.33
Nodes (5): 1. Executive Summary, 2. Reconciled Status Breakdown (58 Canonical Requirements), 3. Specification Verdict Summary, 4. Final Audit Verdict & Statement, AutoGram Implementation Audit Report (V3.1 Machine-Verified Patch)

### Community 554 - "getJSDocTagsWorker"
Cohesion: 0.33
Nodes (5): 1. Executive Summary, 2. Reconciled Final Status Breakdown (58 Canonical Requirements), 3. Completed Remediation Highlights, 4. Final Verdict, AutoGram Real Forensic Implementation Audit Report (Final Verification)

### Community 555 - "FormattingContext"
Cohesion: 0.33
Nodes (6): 12.1 Draft lifecycle, 12.2 Dirty-state behavior, 12.3 Validation model, 12.4 Save behavior, 12.5 Reset behavior, 12. DRAFT, VALIDATION, SAVE, AND CLOSE WORKFLOW

### Community 556 - "getTypescriptKeywordCompletions"
Cohesion: 0.33
Nodes (6): 21.1 Unit tests, 21.2 Component tests, 21.3 Integration tests, 21.4 Responsive visual tests, 21.5 Accessibility tests, 21. TEST PLAN

### Community 557 - "DesktopNetworkProvider"
Cohesion: 0.18
Nodes (7): DesktopNetworkProvider, NetworkProvider, NetworkType, Option, Self, Send, Sync

### Community 558 - "tg_load_more_topic_media"
Cohesion: 0.24
Nodes (13): get_service(), OpenTopicMediaIpcPayload, AppHandle, OpenTopicMediaResult, OpResult, Option, Result, TopicMediaCursor (+5 more)

### Community 559 - "FloodWaitGateController"
Cohesion: 0.22
Nodes (10): FloodWaitGateController, GateKey, GateState, Arc, Duration, HashMap, Instant, Mutex (+2 more)

### Community 560 - "DevToolsPlugin.js"
Cohesion: 0.28
Nodes (10): createDescriptor(), getFileType(), getNameOfNameNode(), getNamesForFunctionLikeDeclaration(), parse(), recursivelyGetPropertyAccessName(), visitFunctionNodeImpl(), visitNodeIterative() (+2 more)

### Community 561 - ".forEachChild"
Cohesion: 0.11
Nodes (21): binaryExpressionMayBeOpenTag(), consumeNode(), currentNode(), getLastChild(), isExternalModuleReference(), isMissingList(), isModuleSpecifierMissingOrEmpty(), isReusableParsingContext() (+13 more)

### Community 562 - "compareValues"
Cohesion: 0.17
Nodes (12): compareEmitHelpers(), compareGeneratedPositions(), compareImportKind(), comparePrereleaseIdentifiers(), compareSourcePositions(), compareTextSpans(), compareValues(), getEnumMembers() (+4 more)

### Community 563 - "continuePreviousIncompleteResponse"
Cohesion: 0.10
Nodes (24): assertNever(), convertPathCompletions(), convertStringLiteralCompletions(), createSortedArray(), getCodeFixesForImportDeclaration(), getCompletionsAtPosition(), getExportNeedsImportStarHelper(), getJSDocTagCompletions() (+16 more)

### Community 564 - "setTextRange"
Cohesion: 0.25
Nodes (15): createExpressionForAccessorDeclaration(), createExpressionForMethodDeclaration(), createExpressionForObjectLiteralElementLike(), createExpressionForPropertyAssignment(), createExpressionForPropertyName(), createExpressionForShorthandPropertyAssignment(), createExpressionFromEntityName(), createMemberAccessForPropertyName() (+7 more)

### Community 565 - "tokenIsIdentifierOrKeyword"
Cohesion: 0.11
Nodes (36): createMissingNode(), getTemplateLiteralRawText(), internPrivateIdentifier(), isTemplateStartOfTaggedTemplate(), parseArgumentList(), parseAssertEntry(), parseCallExpressionRest(), parseConditionalExpressionRest() (+28 more)

### Community 566 - "fail"
Cohesion: 0.33
Nodes (6): 6.1 Visual direction, 6.2 Design tokens, 6.3 Typography, 6.4 Card structure, 6.5 Motion, 6. VISUAL DESIGN SYSTEM

### Community 567 - "getEditsForToTemplateLiteral"
Cohesion: 0.33
Nodes (5): 1. Core Principles, 2. Normative Invariants, 3. Implementation Roadmap & Verification Gates, AutoGram Quality Mode Engine Overhaul (v4.1.0), ORIGINAL · HQ · SMART

### Community 568 - "setTextRange"
Cohesion: 0.47
Nodes (4): closeRenameAudit(), closeSyntheticInputDialog(), openRenameForAudit(), openSyntheticInputDialog()

### Community 569 - "sort"
Cohesion: 0.53
Nodes (5): config, log(), main(), sleep(), ts()

### Community 570 - "InFlightTracker"
Cohesion: 0.21
Nodes (9): InFlightTracker, Arc, HashMap, Mutex, Option, Result, Self, Receiver (+1 more)

### Community 571 - "message_to_topic_media_item"
Cohesion: 0.17
Nodes (11): message_to_topic_media_item(), now_unix(), Message, Option, TopicMediaContext, TopicMediaItem, map_update_message(), Message (+3 more)

### Community 572 - "createRulesMap"
Cohesion: 0.40
Nodes (6): combine(), createConstEqualsRequireDeclaration(), getNewImports(), getNewRequires(), makeStringLiteral(), needsTypeOnly()

### Community 573 - "isBindingElement"
Cohesion: 0.23
Nodes (12): classifySymbol(), getCombinedFlags(), getCombinedNodeFlags(), getDeclarationForBindingElement(), getExportNode(), hasValueSideModule(), isBindingElement(), isCatchClause() (+4 more)

### Community 574 - "clear"
Cohesion: 0.10
Nodes (27): clear(), clearMap(), clearMarks(), clearMeasures(), collectFreeIdentifiers(), createCacheWithRedirects(), createDirectoryWatcherSupportingRecursive(), createModuleResolutionCache() (+19 more)

### Community 575 - "contains"
Cohesion: 0.15
Nodes (15): clearScreenIfNotWatchingForFileChanges(), contains(), createWatchStatusReporter(), deduplicateEquality(), eachDiagnostic(), getAllKeys(), getDiagnostics(), getFixes() (+7 more)

### Community 576 - "getEmitScriptTarget"
Cohesion: 0.20
Nodes (12): compilerOptionsIndicateEsModules(), createRuntimeTypeSerializer(), getDefaultLibFileName(), getEmitScriptTarget(), getStrictOptionValue(), getUseDefineForClassFields(), transformClassFields(), transformES2017() (+4 more)

### Community 577 - "getDeclarationFromName"
Cohesion: 0.24
Nodes (11): findReferencedSymbols(), getDeclarationFromName(), getTopMostDeclarationNamesInFile(), isDeclarationOfSymbol(), isDefinitionForReference(), isLiteralComputedPropertyDeclarationName(), isWriteAccess(), isWriteAccessForReference() (+3 more)

### Community 578 - "createRulesMap"
Cohesion: 0.33
Nodes (6): getRootDeclaration(), isBlockOrCatchScoped(), isCatchClauseVariableDeclaration(), isCatchClauseVariableDeclarationOrBindingElement(), isParameterDeclaration(), isParameterOrCatchClauseVariable()

### Community 579 - "optionsHaveChanges"
Cohesion: 0.40
Nodes (6): isDeleteTarget(), tryGetObjectLiteralContextualType(), walkUp(), walkUpParentheses(), walkUpParenthesizedExpressions(), walkUpParenthesizedTypes()

### Community 580 - "every"
Cohesion: 0.40
Nodes (4): Meta Commands, RTK - Rust Token Killer (Google Antigravity), Rule, Why

### Community 581 - "MoovSidecarManager"
Cohesion: 0.23
Nodes (7): MoovSidecarManager, Connection, Option, PathBuf, Result, Self, Vec

### Community 582 - "getSelectionChildren"
Cohesion: 0.40
Nodes (4): Codebase Cartographer Skill, Langkah kerja, Output, Prinsip utama

### Community 583 - "append"
Cohesion: 0.19
Nodes (15): addSyntheticLeadingComment(), addSyntheticTrailingComment(), append(), createQueue(), createUnparsedSourceFile(), getAllUnscopedEmitHelpers(), getImplementationsAtPosition(), getSyntheticLeadingComments() (+7 more)

### Community 584 - "createDocumentRegistryInternal"
Cohesion: 0.35
Nodes (4): createDocumentRegistry(), createDocumentRegistryInternal(), DocumentRegistry, createDocumentRegistryInternal()

### Community 585 - "getReferencedSymbolsForSymbol"
Cohesion: 0.11
Nodes (25): addReference(), findInheritedConstructorReferences(), getImportOrExportReferences(), getLocalSymbolForExportSpecifier(), getPropertyNameForUniqueESSymbol(), getReferenceForShorthandProperty(), getReferencesAtExportSpecifier(), getReferencesAtLocation() (+17 more)

### Community 586 - "parseUpdateExpression"
Cohesion: 0.40
Nodes (4): Checklist, Fokus review, GitHub PR Review Skill, Output yang diharapkan

### Community 587 - "LanguageServiceShimHostAdapter"
Cohesion: 0.10
Nodes (8): filterMutate(), getErrorForNoInputFiles(), isErrorNoInputFiles(), isTypingUpToDate(), LanguageServiceShimHostAdapter(), shouldReportNoInputFiles(), simpleForwardCall(), updateErrorForNoInputFiles()

### Community 588 - "Apache License 2.0 (Apache)"
Cohesion: 0.17
Nodes (11): Accepting Warranty or Additional Liability., Apache License 2.0 (Apache), Definitions., Disclaimer of Warranty., External dependencies, Grant of Copyright License., Grant of Patent License., Limitation of Liability. (+3 more)

### Community 589 - "addImplementationReferences"
Cohesion: 0.40
Nodes (5): 21. MOBILE ANTI-AI-TELLS RULE, Copy AI tells, Layout AI tells, UI clutter tells, Visual AI tells

### Community 590 - "getSelectionChildren"
Cohesion: 0.40
Nodes (4): Langkah debugging, Netlify Deploy Debug Skill, Output yang diharapkan, Untuk Vite/React SPA

### Community 591 - "isModuleDeclaration"
Cohesion: 0.40
Nodes (4): Checklist, Fokus utama, Output yang diharapkan, Performance Audit Skill

### Community 592 - "getRefactorEditsToRemoveFunctionBraces"
Cohesion: 0.40
Nodes (4): Checklist debugging, Output, Prinsip utama, Root Cause Debugger Skill

### Community 593 - "AutoGram v4 Completion Audit"
Cohesion: 0.18
Nodes (10): AutoGram v4 Completion Audit, Cross-spec control plane, Next closure order, Status legend, v4.1 Quality Mode Engine, v4.3 Universal File / Batch Handling, v4.4 Oversize Transfer Manager, v4.5 Scale / FloodWait / Download Reliability (+2 more)

### Community 594 - "SmartThrottle"
Cohesion: 0.22
Nodes (5): AtomicU32, AtomicBool, AtomicU64, Self, SmartThrottle

### Community 595 - "4. Spesifikasi & Workflow 10 Kategori Fitur Utama (Deep-Dive)"
Cohesion: 0.18
Nodes (11): 4. Spesifikasi & Workflow 10 Kategori Fitur Utama (Deep-Dive), Kategori 10: Multi-Channel Transfer, Smart 3x3 Album Engine, Hardware GPU Re-encode & Duplicate Engine (v2.8.7), Kategori 1: Media Studio Orchestration & Local-First SWR Warm State Engine, Kategori 2: Drive File Card & Visual Virtualized Grid Engine, Kategori 3: Progressive Thumbnail Pipeline & Parallel Correlation Manager, Kategori 4: Specialized Media & Edge-Case Async Keyframe Background Engine, Kategori 5: Progressive Range HTTP Streaming & Seekable Local Bridge Engine, Kategori 6: Sparse Remote ZIP Archive Browser & Instant Extraction Engine (+3 more)

### Community 596 - "5. Registrasi Command Tauri (85+ Commands — `lib.rs`)"
Cohesion: 0.18
Nodes (11): 5. Registrasi Command Tauri (85+ Commands — `lib.rs`), Grup: Authentication & Session, Grup: Cache & Files, Grup: Jobs & Migration, Grup: Media Listing & Folder, Grup: Network & Security, Grup: Profiles, Automation, Stats, Grup: Streaming & Preview (+3 more)

### Community 597 - "Quality Engine v4 Baseline Audit"
Cohesion: 0.18
Nodes (10): Active architecture and call graph, Baseline gaps against the specifications, Current upload paths, Database baseline, Planned change boundary, Primary risks, Quality Engine v4 Baseline Audit, Sources of current policy (+2 more)

### Community 598 - "StorageBudget"
Cohesion: 0.27
Nodes (6): Default, PathBuf, Result, Self, StorageBudget, StorageManager

### Community 599 - "search_topic_media"
Cohesion: 0.22
Nodes (10): map_filter_type_to_input(), Client, MessagesFilter, Option, Result, TopicMediaContext, TopicMediaCursor, TopicMediaItem (+2 more)

### Community 600 - "diag_stream_1869.mjs"
Cohesion: 0.36
Nodes (10): cdpEval(), httpRangeProbe(), log(), main(), openCDP(), require, screenshot(), sleep() (+2 more)

### Community 601 - "getContainingNodeArray"
Cohesion: 0.31
Nodes (9): addCommonjsExport(), addEs6Export(), addExport(), addExports(), addExportToChanges(), canHaveDecorators(), createExportAssignment(), getNamesToExportInCommonJS() (+1 more)

### Community 602 - "textSpanEnd"
Cohesion: 0.12
Nodes (23): collapseTextChangeRangesAcrossMultipleVersions(), convertCallSiteGroupToIncomingCall(), convertCallSiteGroupToOutgoingCall(), createCallHierarchyIncomingCall(), createCallHierarchyItem(), createCallHierarchyOutgoingCall(), createTextChangeRange(), createTextSpanFromBounds() (+15 more)

### Community 603 - "canHaveModifiers"
Cohesion: 0.32
Nodes (8): findModifier(), getClassNames(), getFunctionNames(), getGroupedReferences(), getModifierOccurrences(), getPresentModifiers(), modifiersToFlags(), modifierToFlag()

### Community 604 - "completionInfoFromData"
Cohesion: 0.28
Nodes (9): compareBooleans(), compareCompletionEntries(), compareModuleSpecifiers(), compareNavigateToItems(), compareNumberOfDirectorySeparators(), comparePathsByRedirectAndNumberOfDirectorySeparators(), compareStringsCaseSensitiveUI(), numberOfDirectorySeparators() (+1 more)

### Community 605 - ".getSemanticDiagnostics"
Cohesion: 0.27
Nodes (5): getDeclarationDiagnostics(), getNewLineOrDefaultFromHost(), getPreEmitDiagnostics(), handleNoEmitOptions(), transformDeclarations()

### Community 606 - "tryGetValueFromType"
Cohesion: 0.20
Nodes (10): assertEachIsDefined(), checkEachDefined(), getCompletionData(), getFirstSymbolInChain(), getPropertiesForCompletion(), getRecommendedCompletion(), hasDocComment(), isAbstractConstructorSymbol() (+2 more)

### Community 607 - "PerDirectoryResolutionCache"
Cohesion: 0.22
Nodes (5): ModuleResolutionCache, NonRelativeModuleNameResolutionCache, PackageJsonInfoCache, PerDirectoryResolutionCache, TypeReferenceDirectiveResolutionCache

### Community 608 - "FormattingContext"
Cohesion: 0.40
Nodes (4): Aturan keamanan, Langkah kerja, Output yang diharapkan, Supabase Safe Change Skill

### Community 609 - "getTextOfIdentifierOrLiteral"
Cohesion: 0.40
Nodes (4): 1. Standar Skema, 2. Row Level Security (RLS), 3. Penyimpanan SQL, Supabase Schema Manager

### Community 610 - "getObjectFlags"
Cohesion: 0.40
Nodes (5): 12.A File Location, 12.B Required Frontmatter, 12.C Required Body Sections, 12.D Block-Library Discipline, 12. THE BLOCK LIBRARY (Contract - Implementations Land Here Iteratively)

### Community 611 - "organizeImports"
Cohesion: 0.40
Nodes (5): 5.A Sticky-Stack - Canonical Skeleton, 5.B Horizontal-Pan - Canonical Skeleton, 5.C Scroll-Reveal Stagger - Canonical Skeleton (lighter alternative), 5. CONTEXT-AWARE PROACTIVITY, 5.D Forbidden Animation Patterns

### Community 612 - "isFunctionExpression"
Cohesion: 0.40
Nodes (5): 8.A Token Strategy (pick one, stick to it), 8.B Do Not Prescribe Specific Colors Here, 8.C Default Mode, 8.D Test in Both Modes Before Finishing, 8. DARK MODE PROTOCOL

### Community 613 - "convertToAsyncFunction"
Cohesion: 0.40
Nodes (4): 1. Handling FloodWaitError, 2. Penggunaan Sesi, 3. Rate Limiting Otomatis, Telethon Best Practices untuk AutoGram

### Community 614 - "CoreServicesShimObject"
Cohesion: 0.40
Nodes (4): Output yang diharapkan, Prinsip utama, Saat memperbaiki UI, UI Polish Mobile Skill

### Community 615 - "TypeScriptServicesFactory"
Cohesion: 0.25
Nodes (3): logInternalError(), ShimBase(), TypeScriptServicesFactory()

### Community 616 - "forEachImport"
Cohesion: 0.40
Nodes (4): AutoGram Specification Conflict Register, Conflict 01: Album Maximum Item Capacity (Master Architecture v2.8.7 vs Spec v4.6), Conflict 02: Default Video Re-encode Transcode Behavior (Master Architecture v2.8.7 vs Spec v4.1 & v4.7), Conflict 03: Missing Specification Dependency v4.2 Catalog

### Community 617 - "getDefaultLikeExportNameFromDeclaration"
Cohesion: 0.40
Nodes (5): 10.1 Profiles tab layout, 10.2 System presets, 10.3 User profile actions, 10.4 Profile safety, 10. PROFILES EXPERIENCE

### Community 618 - "JobStatus"
Cohesion: 0.24
Nodes (7): JobStatus, ReliableJob, Connection, Option, Result, Self, update_job_status()

### Community 619 - "media_statistics.rs"
Cohesion: 0.38
Nodes (9): get_cached_statistics(), MediaStatisticsResult, open_db(), resolve_migrator_db(), Connection, Option, PathBuf, Result (+1 more)

### Community 620 - "MemoryThumbCache"
Cohesion: 0.29
Nodes (6): MemoryThumbCache, HashMap, Mutex, Option, Self, Vec

### Community 621 - "RangeCache"
Cohesion: 0.31
Nodes (6): RangeCache, Bytes, HashMap, Mutex, Option, Self

### Community 622 - ".read_tail"
Cohesion: 0.49
Nodes (4): BoundedRangeReader<'a>, Option, Result, Vec

### Community 623 - "remote/e2e-cdp-smoke.mjs"
Cohesion: 0.20
Nodes (7): candidates, card, errors, pages, results, sessionSelect, tDrive

### Community 624 - "addImplementationReferences"
Cohesion: 0.21
Nodes (13): getContextualType(), getContextualTypeFromParent(), getContextualTypeFromParentOrAncestorTypeNode(), getSwitchedType(), getTypeNode(), getVariableLikeInitializer(), isEqualityOperatorKind(), isInJSXContent() (+5 more)

### Community 625 - "computePositionOfLineAndCharacter"
Cohesion: 0.08
Nodes (27): computeLineAndCharacterOfPosition(), computeLineOfPosition(), computeLineStarts(), computePositionOfLineAndCharacter(), createSourceFileLike(), emitComments(), emitDetachedComments(), emitNewLineBeforeLeadingCommentOfPosition() (+19 more)

### Community 626 - "getSymbolCompletionFromEntryId"
Cohesion: 0.20
Nodes (10): completionNameForLiteral(), createCompletionEntryForLiteral(), getCompletionEntriesFromSymbols(), getCompletionEntryDisplayNameForSymbol(), getSymbolCompletionFromEntryId(), isSingleOrDoubleQuote(), originIncludesSymbolName(), originIsObjectLiteralMethod() (+2 more)

### Community 627 - "createWriter"
Cohesion: 0.40
Nodes (5): 13.1 Capability loading, 13.2 Option model, 13.3 Capability states, 13.4 Hardware mode with no GPU, 13. ENCODER CAPABILITY WORKFLOW

### Community 628 - "getRenameInfoForNode"
Cohesion: 0.20
Nodes (11): getAdjustedNode(), getAdjustedReferenceLocation(), getAdjustedRenameLocation(), getPackagePathComponents(), getRenameInfo(), getRenameInfoError(), getRenameInfoForNode(), getRenameInfoSuccess() (+3 more)

### Community 629 - "getSynthesizedDeepCloneWorker"
Cohesion: 0.40
Nodes (5): 14.1 Read compatibility, 14.2 Unified resolver, 14.3 Schema version, 14.4 Migration rules, 14. LEGACY SETTINGS AND PROFILE MIGRATION

### Community 630 - "collectCallSites"
Cohesion: 0.40
Nodes (5): 17.1 Dialog behavior, 17.2 Tabs, 17.3 Controls, 17.4 Motion and contrast, 17. ACCESSIBILITY REQUIREMENTS

### Community 631 - "compareModuleSpecifiers"
Cohesion: 0.40
Nodes (5): 20.1 CSS organization, 20.2 Scroll ownership, 20.3 Sticky regions, 20.4 Container queries, 20. CSS AND RESPONSIVE IMPLEMENTATION

### Community 632 - "eachExportReference"
Cohesion: 0.40
Nodes (5): 5.1 Breakpoint matrix, 5.2 Tablet behavior, 5.3 Mobile behavior, 5.4 Height-constrained screens, 5. RESPONSIVE LAYOUT SPECIFICATION

### Community 633 - ".toString"
Cohesion: 0.60
Nodes (4): config, invoke(), main(), sleep()

### Community 634 - "findChildOfKind"
Cohesion: 0.50
Nodes (5): calculateIndent(), getIndentSize(), getIndentString(), writeCommentRange(), writeTrimmedCurrentLine()

### Community 637 - "getScriptTransformers"
Cohesion: 0.40
Nodes (5): getExpressionAssociativity(), getExpressionPrecedence(), getOperator(), getOperatorAssociativity(), getOperatorPrecedence()

### Community 638 - "parseObjectBindingElement"
Cohesion: 0.40
Nodes (3): getUnmatchedAttributes(), isJsxSpreadAttribute(), reclassifyByType()

### Community 640 - "worker_pool.rs"
Cohesion: 0.33
Nodes (6): DcWorkerPool, Arc, Default, Self, Semaphore, WorkerPoolConfig

### Community 641 - "cast"
Cohesion: 0.50
Nodes (4): 12-section pack, 33. DEFAULT SECTION PACKS, 4-section pack, 8-section pack

### Community 642 - ".getLineStarts"
Cohesion: 0.50
Nodes (4): 14. HERO MINIMALISM RULES, Absolute Hero Rules, Headline Rule, Hero Cleanliness Rule

### Community 643 - "assertDiagnosticLocation"
Cohesion: 0.50
Nodes (4): 37. EXAMPLE INTERPRETATIONS, Example 1, Example 2, Example 3

### Community 644 - "getThrowOccurrences"
Cohesion: 0.50
Nodes (4): 2. PLATFORM MODE RULE, Android-native premium, Cross-platform premium neutral, iOS-native premium

### Community 645 - "getNavigateToItems"
Cohesion: 0.24
Nodes (12): betterMatch(), compareMatches(), createPatternMatcher(), getContainers(), getFullMatch(), getItemsFromNamedDeclaration(), getNavigateToItems(), matchSegment() (+4 more)

### Community 646 - "compareStringsCaseSensitive"
Cohesion: 0.22
Nodes (9): compareComparableValues(), compareDiagnostics(), compareDiagnosticsSkipRelatedInformation(), compareMessageText(), compareProperties(), compareRelatedInformation(), compareStringsCaseSensitive(), compareTypesByDeclarationOrder() (+1 more)

### Community 647 - "getStringLiteralCompletions"
Cohesion: 0.50
Nodes (4): 37. EXAMPLE INTERPRETATIONS, Example 1, Example 2, Example 3

### Community 648 - ".getCurrentSourceFile"
Cohesion: 0.16
Nodes (12): createLanguageServiceSourceFile(), getDeleteAction(), getDescriptionForClassLikeDeclaration(), getDescriptionForConstantInScope(), getDescriptionForFunctionLikeDeclaration(), getDescriptionForModuleLikeDeclaration(), getPossibleExtractions(), getSnapshotText() (+4 more)

### Community 649 - "ProjectResponse"
Cohesion: 0.22
Nodes (9): BeginInstallTypes, EndInstallTypes, InitializationFailedResponse, InstallTypes, InvalidateCachedTypings, PackageInstalledResponse, ProjectResponse, SetTypings (+1 more)

### Community 650 - "FlowNodeBase"
Cohesion: 0.22
Nodes (9): FlowArrayMutation, FlowAssignment, FlowCall, FlowCondition, FlowLabel, FlowNodeBase, FlowReduceLabel, FlowStart (+1 more)

### Community 651 - "isPartOfTypeNode"
Cohesion: 0.25
Nodes (11): getExpectedCommaDiagnostic(), isHeritageClause(), parseArrayBindingElement(), parseArrayBindingPattern(), parseDelimitedList(), parseHeritageClause(), parseHeritageClauses(), parseIdentifierOrPattern() (+3 more)

### Community 652 - "isFunctionLikeKind"
Cohesion: 0.50
Nodes (4): 12-section pack, 15. DEFAULT SITE PACKS, 4-section pack, 8-section pack

### Community 653 - "isBeforeBlockContext"
Cohesion: 0.50
Nodes (4): 20. EXAMPLE INTERPRETATIONS, Example 1, Example 2, Example 3

### Community 654 - "TypeScriptServicesFactory"
Cohesion: 0.17
Nodes (5): forwardCall(), forwardJSONCall(), logInternalError(), ShimBase(), TypeScriptServicesFactory()

### Community 655 - ".forEachChild"
Cohesion: 0.50
Nodes (4): 7. DIAL DEFINITIONS (Technical Reference), DESIGN_VARIANCE (Level 1-10), MOTION_INTENSITY (Level 1-10), VISUAL_DENSITY (Level 1-10)

### Community 656 - "getNavigateToItems"
Cohesion: 0.50
Nodes (3): 1. Requirement Extraction Breakdown, 2. Granular Traceability Matrix Table, AutoGram Requirement Traceability Matrix (Expanded 42-Requirement Edition)

### Community 657 - ".throwIfCancellationRequested"
Cohesion: 0.50
Nodes (3): 1. Code-Level Implementation Gaps, 2. Integration & Runtime Verification Gaps, AutoGram Test Coverage Gap Analysis (Expanded Edition)

### Community 658 - "getContainingNodeArray"
Cohesion: 0.50
Nodes (3): 1. Machine Verifier Execution Log, 2. Integrity Metrics Summary Table, AutoGram Audit Integrity Report (V3.1 Machine Verification)

### Community 659 - "isParameter"
Cohesion: 0.50
Nodes (3): 1. Command Execution & Raw Log Evidence Index, 2. Core Code Evidence Symbols & Line Ranges, AutoGram Evidence Index (V3 Machine-Verified)

### Community 660 - "getGroupedReferences"
Cohesion: 0.50
Nodes (3): 1. Primary Code Implementation Gaps, 2. Integration & Runtime Verification Gaps, AutoGram Test Coverage Gap Analysis (V3 Machine-Verified)

### Community 661 - "isFunctionLikeKind"
Cohesion: 0.50
Nodes (4): 18.1 Required shared structure, 18.2 State controller, 18.3 Presentational primitives, 18. COMPONENT ARCHITECTURE

### Community 662 - "MediaFingerprint"
Cohesion: 0.50
Nodes (4): 26. PROGRESS AND BLOCKERS, Blockers, Decisions verified during implementation, Progress log

### Community 663 - "135.0.3176.0_0/manifest.json"
Cohesion: 0.25
Nodes (7): description, devtools_page, key, manifest_version, name, update_url, version

### Community 664 - "getReferencesAtLocation"
Cohesion: 0.50
Nodes (4): 2.1 High-impact architectural problems, 2.2 Current layout and usability problems, 2.3 Existing strengths that must be preserved, 2. CURRENT STATE AUDIT

### Community 665 - ".throwIfCancellationRequested"
Cohesion: 0.28
Nodes (5): CancellationTokenObject(), checkForClassificationCancellation(), getApplicableRefactors(), instant(), ThrottledCancellationToken()

### Community 666 - "canReuseNode"
Cohesion: 0.25
Nodes (8): canReuseNode(), isReusableClassMember(), isReusableEnumMember(), isReusableParameter(), isReusableStatement(), isReusableSwitchClause(), isReusableTypeMember(), isReusableVariableDeclaration()

### Community 667 - "getFixInfo"
Cohesion: 0.50
Nodes (4): 4.1 Overall tools shell, 4.2 Desktop sizing rules, 4.3 Header hierarchy, 4. TARGET DESKTOP LAYOUT

### Community 668 - "isTemplateLiteralKind"
Cohesion: 0.11
Nodes (21): assertLessThan(), getApplicableSpanForArguments(), getArgumentCount(), getArgumentIndexForTemplatePiece(), getArgumentListInfoForTemplate(), getArgumentOrParameterListInfo(), getImmediatelyContainingArgumentInfo(), getNewEndOfLineState() (+13 more)

### Community 669 - "getImplementationsAtPosition"
Cohesion: 0.33
Nodes (6): findReferenceOrRenameEntries(), flattenEntries(), getImplementationReferenceEntries(), getReferenceEntriesForNode(), isSuperOrSuperProperty(), isSuperProperty()

### Community 670 - "SourceFile"
Cohesion: 0.25
Nodes (3): JsonSourceFile, SourceFile, TsConfigSourceFile

### Community 672 - "isVariableDeclarationInitializedToBareOrAccessedRequire"
Cohesion: 0.22
Nodes (10): createExistingImportMap(), createImportSpecifierResolver(), getExternalModuleRequireArgument(), getLeftmostAccessExpression(), isAnyImportOrBareOrAccessedRequire(), isAnyImportSyntax(), isRequireVariableStatement(), isVariableDeclarationInitializedToBareOrAccessedRequire() (+2 more)

### Community 673 - "getNodeId"
Cohesion: 0.50
Nodes (4): CloseProject, DiscoverTypings, InstallPackageRequest, TypingInstallerRequestWithProjectName

### Community 674 - "assertDiagnosticLocation"
Cohesion: 0.67
Nodes (4): exportAssignmentIsAlias(), getExportAssignmentExpression(), isAliasableExpression(), isAliasSymbolDeclaration()

### Community 675 - "canReuseNode"
Cohesion: 0.50
Nodes (4): getJSDocParameterNameCompletions(), hasRestParameter(), isJSDocParameterTag(), isRestParameter()

### Community 676 - "coalesceImports"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 681 - "AutoGram Spec v4 Implementation Log"
Cohesion: 0.29
Nodes (6): AutoGram Spec v4 Implementation Log, Decisions, Environment limits and deferred edges, Implemented, Objective, Verification

### Community 682 - "Media Studio, ZIP, Drive Tools, and thumbnail investigation"
Cohesion: 0.29
Nodes (6): Changes applied, Media Studio, ZIP, Drive Tools, and thumbnail investigation, Remaining live limitation, Root causes found, Symptoms, Verification evidence

### Community 683 - "9. 5 Diagram Sequence Mermaid Komprehensif"
Cohesion: 0.29
Nodes (7): 9.1 Alur Kerja SWR Warm Fetch & Head Sync, 9.2 Alur Kerja Thumbnail 4-Flight Correlation Pipeline, 9.3 Alur Kerja Special Media Async Keyframe Background Engine, 9.4 Alur Kerja 512KB Aligned Range Streaming, Boot Phase, Tail-Fetch & Seek Engine (v2.7.2), 9.5 Alur Kerja Sparse Remote ZIP Central Directory Extraction, 9. 5 Diagram Sequence Mermaid Komprehensif, 9.6 Alur Kerja Upload, Download & Forwarder (Transfer Manager Orchestrator)

### Community 684 - "Transfer v4 Regression Report"
Cohesion: 0.29
Nodes (6): Automated evidence, Contract scenarios, Direct frontend.exe QA, Environment limitations, Protected media surface, Transfer v4 Regression Report

### Community 685 - "BandwidthController"
Cohesion: 0.33
Nodes (3): BandwidthController, BandwidthLimits, Self

### Community 686 - "SessionMetadata"
Cohesion: 0.38
Nodes (3): MtprotoClientWrapper, Self, SessionMetadata

### Community 688 - "AdaptiveBackoff"
Cohesion: 0.48
Nodes (3): AdaptiveBackoff, Duration, Self

### Community 690 - "updateSourceFile"
Cohesion: 0.05
Nodes (50): applyChange(), argumentStartsOnSameLineAsPreviousArgument(), assert(), assertSourceFileOkWithoutNextAffectedCall(), backupBuilderProgramEmitState(), base64FormatEncode(), checkChangeRange(), checkNodePositions() (+42 more)

### Community 693 - "parseComparator"
Cohesion: 0.31
Nodes (8): createComparator(), isWildcard(), parseComparator(), parseHyphen(), parsePartial(), parseRange(), tryParseComponents(), Version()

### Community 694 - "DocumentSpan"
Cohesion: 0.29
Nodes (7): DefinitionInfo, DocumentSpan, ImplementationLocation, ReferencedSymbolDefinitionInfo, ReferencedSymbolEntry, ReferenceEntry, RenameLocation

### Community 697 - "processPragmasIntoFields"
Cohesion: 0.67
Nodes (3): classFromKind(), isBinaryExpressionOperatorToken(), isPrefixUnaryExpressionOperatorToken()

### Community 698 - "isValidFunctionDeclaration"
Cohesion: 0.15
Nodes (18): explicitlyInheritsFrom(), forEachRelatedSymbol(), getCheckFlags(), getContainingObjectLiteralElement(), getDefinitionFromObjectLiteralElement(), getFirstTypeParameterName(), getPropertySymbolFromBindingElement(), getPropertySymbolsFromContextualType() (+10 more)

### Community 699 - "isGeneratedPrivateIdentifier"
Cohesion: 0.09
Nodes (25): addDefaultValueAssignmentForBindingPattern(), addDefaultValueAssignmentForInitializer(), addDefaultValueAssignmentIfNeeded(), addDefaultValueAssignmentsIfNeeded(), collectExportedVariableInfo(), formatGeneratedName(), formatGeneratedNamePart(), formatIdentifier() (+17 more)

### Community 700 - "113.0.1765.0_0/manifest.json"
Cohesion: 0.29
Nodes (6): description, key, manifest_version, name, update_url, version

### Community 701 - "attachFlowNodeDebugInfoWorker"
Cohesion: 0.67
Nodes (3): doneWithAffectedFile(), toAffectedFileEmitResult(), toAffectedFileResult()

### Community 707 - "Media Studio context leak and viewport thumbnail loop — 2026-08-01"
Cohesion: 0.33
Nodes (5): Fixes, Media Studio context leak and viewport thumbnail loop — 2026-08-01, Root causes, Symptoms, Verification evidence

### Community 708 - "v2.7.4 Transfer Progress Sync & Overall Percent Reducer Fix"
Cohesion: 0.33
Nodes (6): Eliminasi Fake Static Mockup Progress (`studio_orch.rs`), Perbaikan Konflik Visual Header Transfer Manager (`transferProgress.ts`), Perbaikan Modal Scrollability (`App.css`, `DriveToolsPanel`), Perbaikan Realtime Progress Transfer Manager (`media_prep.rs`, `studio_orch.rs`, `lib.rs`, `MediaStudio/index.tsx`), Realtime Thumbnail & Grid Synchronization (`MediaStudio/index.tsx`), v2.7.4 Transfer Progress Sync & Overall Percent Reducer Fix

### Community 709 - "7. Pipeline Thumbnail — 5 Tier (thumbs.rs + thumbBatcher.ts)"
Cohesion: 0.33
Nodes (6): 7. Pipeline Thumbnail — 5 Tier (thumbs.rs + thumbBatcher.ts), Tier 1: Stripped Mini-Thumb (MTProto `PhotoSize::Stripped`), Tier 2: Cached WebP HD (IndexedDB + Disk), Tier 3: Foto/Gambar Statis (Grammers `fast_sem` — 12 permit), Tier 4: Video Dokumen (Grammers `video_sem` — 4 permit), Tier 5: Negative Caching (`.nothumb` + `"NOT_FOUND"`)

### Community 710 - "ResourceScheduler"
Cohesion: 0.53
Nodes (3): ResourceBudget, ResourceScheduler, Self

### Community 712 - "core/capability.rs"
Cohesion: 0.53
Nodes (5): BackendOwner, capability_catalog(), CapabilityEntry, catalog_is_rust_first(), Vec

### Community 714 - "createPropertyNameFromSymbol"
Cohesion: 0.07
Nodes (29): createImportTracker(), createPropertyNameFromSymbol(), createPropertyNameNodeForIdentifierOrLiteral(), encodeJsxCharacterEntity(), encodeUtf16EscapeSequence(), escapeJsxAttributeString(), escapeNonAsciiString(), escapeString() (+21 more)

### Community 715 - "TextRange"
Cohesion: 0.33
Nodes (6): CheckJsDirective, CommentRange, FileReference, SourceMapRange, SynthesizedComment, TextRange

### Community 717 - "Watch"
Cohesion: 0.33
Nodes (3): Watch, WatchOfConfigFile, WatchOfFilesAndCompilerOptions

### Community 721 - "getNewImportFixes"
Cohesion: 0.17
Nodes (16): getAddAsTypeOnly(), getFixesForAddImport(), getImportFixes(), getModuleSpecifiers(), getModuleSpecifiersWithCacheInfo(), getNamespaceLikeImportText(), getNewImportFixes(), getSourceFileOfModule() (+8 more)

### Community 728 - "v2.7.0 Canonical Media Identity Architecture, Peer Propagation, Guard Engine & Vite Warning Fix"
Cohesion: 0.40
Nodes (5): Canonical MediaIdentity Contract & Peer Propagation (`mediaIdentity.ts`, `driveTypes.ts`, `media_list.rs`, `DriveFileCard.tsx`, `DriveExplorer.tsx`), Developer Experience & Vite Warning Fix (`DriveToolsPanel`), Request Correlation & Multi-Layer Cache Key Audit (`thumbBatcher.ts`, `previewCache.ts`, `thumbPersistentCache.ts`, `mediaStudioDb.ts`), v2.7.0 Canonical Media Identity Architecture, Peer Propagation, Guard Engine & Vite Warning Fix, Validated Message Refetch & Fail-Fast Refusal (`stream.rs`, `thumbs.rs`)

### Community 729 - "10. Spesifikasi Database & Storage (SQLite `autogram.db` & IndexedDB `mediaStudioDb`)"
Cohesion: 0.40
Nodes (5): 10. Spesifikasi Database & Storage (SQLite `autogram.db` & IndexedDB `mediaStudioDb`), A. Tabel SQLite Desktop Offline (`worker/autogram.db`), B. Struct Stream Registry (`StreamEntry`), C. Store IndexedDB (`mediaStudioDb.ts`), Tabel `topic_media_items`

### Community 730 - "TransferPolicy"
Cohesion: 0.40
Nodes (3): Default, Self, TransferPolicy

### Community 731 - "save_thumbnail_atomic"
Cohesion: 0.60
Nodes (4): get_account_cache_dir(), PathBuf, Result, save_thumbnail_atomic()

### Community 732 - "typescript-tsconfig.json"
Cohesion: 0.40
Nodes (4): typescript.js, compilerOptions, composite, files

### Community 733 - "run_real_seeking_suite.mjs"
Cohesion: 0.70
Nodes (4): cdpCmd(), formatBytes(), main(), sleep()

### Community 736 - "TypePredicateBase"
Cohesion: 0.40
Nodes (5): AssertsIdentifierTypePredicate, AssertsThisTypePredicate, IdentifierTypePredicate, ThisTypePredicate, TypePredicateBase

### Community 741 - "getEncodedRootLength"
Cohesion: 0.40
Nodes (5): getEncodedRootLength(), getFileUrlVolumeSeparatorEnd(), isDiskPathRoot(), isUrl(), isVolumeCharacter()

### Community 752 - "10.34.0.84/manifest.json"
Cohesion: 0.40
Nodes (4): manifest_version, name, ruleset_format, version

### Community 753 - "v2.7.6 Video Thumbnail Generation & Smart Hardware GPU Allocation Engine"
Cohesion: 0.50
Nodes (4): Generasi Thumbnail Video Otomatis (`media_transfer.rs`, `media_prep.rs`), Optimasi Performa GPU & Pengalokasian Resource (`media_prep.rs`, `studio_orch.rs`), Realtime Hardware GPU Detection Alignment (`hardware_capability.rs`, `transferProgressStore.ts`), v2.7.6 Video Thumbnail Generation & Smart Hardware GPU Allocation Engine

### Community 754 - "3. Peta WorkTree Repository Utuh & Exhaustive Directory Map"
Cohesion: 0.50
Nodes (4): 3. Peta WorkTree Repository Utuh & Exhaustive Directory Map, A. Root Repository (`F:\AutoGram\`), B. Rust Backend (`AutoGram App/frontend/src-tauri/src/`), C. React Frontend (`AutoGram App/frontend/src/`)

### Community 755 - "MediaAnalyzer"
Cohesion: 0.50
Nodes (3): MediaAnalyzer, Send, Sync

### Community 756 - "classify_media_item"
Cohesion: 0.52
Nodes (5): ClassificationResult, classify_media_category(), classify_media_item(), MediaCategory, Option

### Community 757 - "select_best_video_frame_candidate"
Cohesion: 0.50
Nodes (3): Option, Vec, select_best_video_frame_candidate()

### Community 762 - "inspect_dom.mjs"
Cohesion: 0.83
Nodes (3): cdpCmd(), main(), sleep()

### Community 766 - "test_10_videos_seek.mjs"
Cohesion: 0.83
Nodes (3): cdpCmd(), main(), sleep()

### Community 767 - "test_media_73_random_seeks.mjs"
Cohesion: 0.83
Nodes (3): cdpCmd(), main(), sleep()

### Community 770 - "1.0.0.12/manifest.json"
Cohesion: 0.50
Nodes (3): description, name, version

### Community 771 - "6498.2025.9.4/manifest.json"
Cohesion: 0.50
Nodes (3): description, name, version

### Community 773 - "createClassifier"
Cohesion: 0.17
Nodes (9): ClassifierShimObject(), convertClassifications(), convertClassificationsToSpans(), createClassifier(), createTextSpan(), getClassificationTypeName(), getDefinitionAndBoundSpan(), getSemanticClassifications() (+1 more)

### Community 774 - "compareWithCallback"
Cohesion: 0.67
Nodes (4): compareWithCallback(), createFallbackStringComparer(), createIntlCollatorStringComparer(), createLocaleCompareStringComparer()

### Community 775 - "convertReExportAll"
Cohesion: 0.67
Nodes (4): convertReExportAll(), makeExportDeclaration(), reExportDefault(), reExportStar()

### Community 780 - "getSerializedCompilerOption"
Cohesion: 0.50
Nodes (4): extend(), generateTSConfig(), getCompilerOptionsDiffValue(), getSerializedCompilerOption()

### Community 782 - "nodeOverlapsWithStartEnd"
Cohesion: 0.67
Nodes (4): nodeOverlapsWithStartEnd(), prepareRangeContainsErrorFunction(), rangeOverlapsWithStartEnd(), startEndOverlapsWithStartEnd()

### Community 794 - "120.0.6050.0/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 795 - "46.0.0.0/manifest.json"
Cohesion: 0.50
Nodes (3): description, name, version

### Community 796 - "1.15.0.1/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 797 - "adblock_snippet.js"
Cohesion: 0.83
Nodes (3): e(), r(), t()

### Community 799 - "v2.6.0 High-Priority Preview Resilience Engine & Media Classification Architecture"
Cohesion: 0.67
Nodes (3): Audit Media Classification & UI Formatting (`media_list.rs`, `thumbs.rs`, `DrivePreviewModal`), High-Priority Preview Engine (`session_rate.rs`, `stream.rs`, `tg_error.rs`), v2.6.0 High-Priority Preview Resilience Engine & Media Classification Architecture

### Community 800 - "v2.4.6 Terminal Non-Thumb Blacklist Eviction & Detailed Multi-Layer Logging"
Cohesion: 0.67
Nodes (3): Detailed Multi-Layer Logging (`thumbs.rs` & `thumbBatcher.ts`), Elimination of Video Permanent Blacklisting (`thumbs.rs`), v2.4.6 Terminal Non-Thumb Blacklist Eviction & Detailed Multi-Layer Logging

### Community 801 - "v2.4.0 Smart Thumbnail Architecture & Multi-Tier Progressive Preview Engine"
Cohesion: 0.67
Nodes (3): Document Smart Extractors & Range Cache (`thumbs.rs`, `thumbnail_range_bridge.rs`), Progressive Preview Ladder & Viewport Scheduler (`thumbBatcher.ts`, `DriveFileCard.tsx`), v2.4.0 Smart Thumbnail Architecture & Multi-Tier Progressive Preview Engine

### Community 802 - "v2.8.2 Album Send Result Mapping, History Recovery & Transfer Manager Debug Log Engine"
Cohesion: 0.67
Nodes (3): Eliminasi False Failure Album & Validasi `finalOk` (`transferProgress.ts`), Pemulihan Riwayat Chat Otomatis untuk RPC Album (`media_transfer.rs`), v2.8.2 Album Send Result Mapping, History Recovery & Transfer Manager Debug Log Engine

### Community 803 - "v2.7.7 Dynamic Re-encoded File Size Sync & Progress Overflow Fix"
Cohesion: 0.67
Nodes (3): Eliminasi Progress Overflow & Mismatched Total (`transferProgress.ts`), Sinkronisasi Ukuran File Pasca Re-encode (`media_prep.rs`, `studio_orch.rs`), v2.7.7 Dynamic Re-encoded File Size Sync & Progress Overflow Fix

### Community 804 - "v2.4.4 Queue Concurrency Deadlock Prevention & FFmpeg 3s Timeout Protection"
Cohesion: 0.67
Nodes (3): FFmpeg Extraction Bounded Timeout (`thumbs.rs`), Queue Concurrency Deadlock Prevention (`thumbBatcher.ts`), v2.4.4 Queue Concurrency Deadlock Prevention & FFmpeg 3s Timeout Protection

### Community 805 - "v2.5.5 Post-Wipe Terminal Cache Eviction & Automatic Viewport Refetch Engine"
Cohesion: 0.67
Nodes (3): Frontend Card & Scheduler Synchronization (`DriveFileCard.tsx`, `DriveExplorer.tsx`, `thumbBatcher.ts`), Rust Backend Terminal Cache Wipe (`thumbs.rs` & `jobs_db.rs`), v2.5.5 Post-Wipe Terminal Cache Eviction & Automatic Viewport Refetch Engine

### Community 806 - "v2.5.7 Asynchronous Tier-2 Video Thumbnail Delegation & Non-Blocking Batch Dispatcher"
Cohesion: 0.67
Nodes (3): Frontend Synchronization (`thumbBatcher.ts`), Rust MTProto Thumbnail Engine (`thumbs.rs` & `special_media_thumb.rs`), v2.5.7 Asynchronous Tier-2 Video Thumbnail Delegation & Non-Blocking Batch Dispatcher

### Community 807 - "v2.5.8 Smart FLOOD_PREMIUM_WAIT Handler & Range Bridge Auto-Recovery Engine"
Cohesion: 0.67
Nodes (3): HTTP Range Bridge Auto-Recovery (`thumbnail_range_bridge.rs` & `special_media_thumb.rs`), Rust MTProto Rate Limiter (`session_rate.rs`), v2.5.8 Smart FLOOD_PREMIUM_WAIT Handler & Range Bridge Auto-Recovery Engine

### Community 808 - "v2.5.6 Smart Viewport Priority Elevation & Immediate Scroll Thumbnail Scheduler Engine"
Cohesion: 0.67
Nodes (3): Immediate Scroll Thumbnail Scheduler (`DriveExplorer.tsx`), Scheduler Priority & Queue Eviction Fixes (`thumbBatcher.ts`), v2.5.6 Smart Viewport Priority Elevation & Immediate Scroll Thumbnail Scheduler Engine

### Community 809 - "v2.4.5 LIFO Viewport Priority Scheduler & Video Document Static Thumbnail Engine"
Cohesion: 0.67
Nodes (3): LIFO Viewport Priority Queue (`thumbBatcher.ts`), v2.4.5 LIFO Viewport Priority Scheduler & Video Document Static Thumbnail Engine, Video Document Static Thumbnail Matching (`thumbs.rs`)

### Community 810 - "v2.4.1 Concurrent Batch Downloads & Session-Agnostic Mini-Thumb Fallback"
Cohesion: 0.67
Nodes (3): Parallel Backend MTProto Batch Execution (`thumbs.rs`), Session-Agnostic Mini-Thumb Fallback (`thumbBatcher.ts`), v2.4.1 Concurrent Batch Downloads & Session-Agnostic Mini-Thumb Fallback

### Community 811 - "6. Spesifikasi Buffer, Stream, Seek & moov Engine (Deep Technical Spec)"
Cohesion: 0.67
Nodes (3): 6.1 Arsitektur Buffer & Stream State Machine, 6.2 Tabel Konstanta Kritis Streaming Engine, 6. Spesifikasi Buffer, Stream, Seek & moov Engine (Deep Technical Spec)

### Community 817 - "isProgramUptoDate"
Cohesion: 0.67
Nodes (3): arrayIsEqualTo(), compareDataObjects(), isProgramUptoDate()

### Community 818 - "flatMapIterator"
Cohesion: 0.13
Nodes (19): arrayIterator(), flatMapIterator(), getFixesInfoForNonUMDImport(), getFixesInfoForUMDImport(), getFixInfos(), getIterator(), getMergedAliasedSymbolOfNamespaceExportDeclaration(), getSymbolNamesToImport() (+11 more)

### Community 819 - "getExpandedCharCodes"
Cohesion: 0.67
Nodes (3): base64encode(), convertToBase64(), getExpandedCharCodes()

### Community 820 - "compose"
Cohesion: 0.67
Nodes (3): compose(), min(), reduceLeft()

### Community 825 - "decodedTextSpanIntersectsWith"
Cohesion: 0.67
Nodes (3): decodedTextSpanIntersectsWith(), textSpanIntersectsWith(), textSpanIntersectsWithTextSpan()

### Community 827 - "extensionIsTS"
Cohesion: 0.67
Nodes (3): extensionIsTS(), resolutionExtensionIsTSOrJson(), resolvedTypeScriptOnly()

### Community 828 - "getBinderAndCheckerDiagnosticsOfFile"
Cohesion: 0.67
Nodes (3): filterSemanticDiagnostics(), getBinderAndCheckerDiagnosticsOfFile(), getSemanticDiagnosticsOfFile()

### Community 832 - "getContainingObjectLiteralElementWorker"
Cohesion: 0.67
Nodes (3): getContainingObjectLiteralElementWorker(), isObjectLiteralElement(), isObjectLiteralElementLike()

### Community 833 - "getExternalModuleNameLiteral"
Cohesion: 0.40
Nodes (5): getExternalModuleName(), getExternalModuleNameLiteral(), tryGetModuleNameFromDeclaration(), tryGetModuleNameFromFile(), tryRenameExternalModule()

### Community 834 - "onWatchedFileStat"
Cohesion: 0.67
Nodes (3): getFileWatcherEventKind(), onWatchedFileStat(), pollWatchedFileQueue()

### Community 835 - "getMappedLocation"
Cohesion: 1.00
Nodes (3): getMappedContextSpan(), getMappedDocumentSpan(), getMappedLocation()

### Community 837 - "mangleScopedPackageName"
Cohesion: 0.67
Nodes (3): getTypesPackageName(), getTypesPackageNameToInstall(), mangleScopedPackageName()

### Community 838 - "isAnyDirectorySeparator"
Cohesion: 0.50
Nodes (4): isAnyDirectorySeparator(), stripLeadingDirectorySeparator(), tryRemoveDirectoryPrefix(), tryRemovePrefix()

### Community 840 - "isLiteralExpression"
Cohesion: 0.67
Nodes (3): isLiteralExpression(), isLiteralKind(), isLiteralTypeLikeExpression()

### Community 841 - "isNamespaceReference"
Cohesion: 0.67
Nodes (3): isNamespaceReference(), isPropertyAccessNamespaceReference(), isQualifiedNameNamespaceReference()

### Community 842 - "isNotEmittedOrPartiallyEmittedNode"
Cohesion: 0.67
Nodes (3): isNotEmittedOrPartiallyEmittedNode(), isNotEmittedStatement(), isPartiallyEmittedExpression()

### Community 844 - "orderedRemoveItem"
Cohesion: 0.67
Nodes (3): orderedRemoveItem(), orderedRemoveItemAt(), removeEmitHelper()

### Community 845 - "parseBuildCommand"
Cohesion: 0.67
Nodes (3): parseBuildCommand(), parseCommandLine(), parseCommandLineWorker()

### Community 847 - "textSpanIntersection"
Cohesion: 0.67
Nodes (3): textSpanIntersection(), textSpanOverlap(), textSpanOverlapsWith()

## Knowledge Gaps
- **2162 isolated node(s):** `fs`, `command`, `name`, `private`, `version` (+2157 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **288 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NodeFactory` connect `automations_db.rs` to `DrivePreviewModal.tsx`, `tg_error.rs`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `createNodeFactory()` connect `tg_error.rs` to `ModernProgressBar`, `createIdentifier`, `tokenToString`, `grammers_ops.rs`, `automations_db.rs`, `getContextualType`, `getNewFileImportsAndAddExportInOldFile`, `updateSourceFile`, `react-i18next`, `createSolutionBuilderWorker`, `parseOptional`, `getContainingNodeArray`, `assertIsDefined`, `clear`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Why does `createNodeFactory()` connect `tg_error.rs` to `createNodeArray`, `computeModuleSpecifiers`, `automations_db.rs`, `react-phone-number-input`, `@tauri-apps/api`, `extractFunctionInScope`, `.getCurrentDirectory`, `getOrCreateEmitNode`, `getDirectoryPath`, `assertIsDefined`, `push`, `DriveExplorer.tsx`, `tokenToString`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 365 inferred relationships involving `createNodeFactory()` (e.g. with `.createJSDocText()` and `createExportAssignment()`) actually correct?**
  _`createNodeFactory()` has 365 INFERRED edges - model-reasoned connections that need verification._
- **Are the 365 inferred relationships involving `createNodeFactory()` (e.g. with `.createArrayBindingPattern()` and `.createArrayLiteralExpression()`) actually correct?**
  _`createNodeFactory()` has 365 INFERRED edges - model-reasoned connections that need verification._
- **What connects `fs`, `command`, `name` to the rest of the system?**
  _2162 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `frontend/src-tauri/src/lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.04147241647241647 - nodes in this community are weakly interconnected._