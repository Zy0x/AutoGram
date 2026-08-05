# Graph Report - AutoGram  (2026-08-05)

## Corpus Check
- 665 files · ~2,927,937 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 15618 nodes · 47034 edges · 948 communities (697 shown, 251 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 2275 edges (avg confidence: 0.68)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b28ec7be`
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
- formatIdentifier
- forwardCall
- getContainingObjectLiteralElementWorker
- getExternalModuleNameLiteral
- onWatchedFileStat
- getMappedLocation
- getMergedAliasedSymbolOfNamespaceExportDeclaration
- mangleScopedPackageName
- isAnyDirectorySeparator
- isFunctionCallOrNewContext
- isLiteralExpression
- isNamespaceReference
- isNotEmittedOrPartiallyEmittedNode
- isRawSourceMap
- orderedRemoveItem
- parseBuildCommand
- testComparator
- textSpanIntersection
- isProgramUptoDate
- getExpandedCharCodes
- classFromKind
- compose
- decodedTextSpanIntersectsWith
- doneWithAffectedFile
- encodeJsxCharacterEntity
- extensionIsTS
- getBinderAndCheckerDiagnosticsOfFile
- formatAlternative
- formatIdentifier
- forwardCall
- getContainingObjectLiteralElementWorker
- onWatchedFileStat
- getMappedLocation
- getMergedAliasedSymbolOfNamespaceExportDeclaration
- getSymbolTarget
- isFunctionCallOrNewContext
- isInReferenceCommentWorker
- isNamespaceReference
- isNotEmittedOrPartiallyEmittedNode
- orderedRemoveItem
- parseBuildCommand
- testComparator
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
- v2.3.78 Ultra-Fast 2-Stage Progressive Thumbnail, Dual-Layer Bulk Warm-Up & Atomic Context Isolation Sync
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
- CustomTransformer
- FileWatcher
- HostCancellationToken
- Iterator
- Push
- ResolveProjectReferencePathHost
- SourceFileLike
- SourceMapSource
- getApplicableRefactors
- isNotStatementConditionContext
- isTypeArgumentOrParameterOrAssertionContext
- isInitializedOrStaticProperty
- isInRightSideOfInternalImportEqualsDeclaration
- isNotStatementConditionContext
- isTypeArgumentOrParameterOrAssertionContext
- moduleResolutionIsEqualTo

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
- `JobEditor()` --indirect_call--> `v()`  [INFERRED]
  AutoGram App/frontend/src/components/Jobs/JobEditor/index.tsx → remote/.webview2_data/EBWebView/Default/Extensions/kfbdpdaobnofkbopebjglnaadopfikhh/113.0.1765.0_0/third_party/babylon/babylon.js
- `JobDetailsModal()` --indirect_call--> `value()`  [INFERRED]
  AutoGram App/frontend/src/components/Jobs/Modals/JobDetailsModal.tsx → remote/.webview2_data/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js
- `DrivePreviewModal()` --indirect_call--> `q()`  [INFERRED]
  AutoGram App/frontend/src/components/drive/DrivePreviewModal/index.tsx → remote/.webview2_data/EBWebView/Default/Extensions/kfbdpdaobnofkbopebjglnaadopfikhh/113.0.1765.0_0/third_party/babylon/babylon.js
- `DrivePreviewModal()` --indirect_call--> `v()`  [INFERRED]
  AutoGram App/frontend/src/components/drive/DrivePreviewModal/index.tsx → remote/.webview2_data/EBWebView/Default/Extensions/kfbdpdaobnofkbopebjglnaadopfikhh/113.0.1765.0_0/third_party/babylon/babylon.js
- `DrivePreviewModal()` --indirect_call--> `w()`  [INFERRED]
  AutoGram App/frontend/src/components/drive/DrivePreviewModal/index.tsx → remote/.webview2_data/EBWebView/Default/Extensions/kfbdpdaobnofkbopebjglnaadopfikhh/113.0.1765.0_0/third_party/babylon/babylon.js

## Import Cycles
- None detected.

## Communities (948 total, 251 thin omitted)

### Community 0 - "frontend/src-tauri/src/lib.rs"
Cohesion: 0.04
Nodes (130): acquire_session_lease_inner(), acquire_worker_session_lease(), autogram_get_account_scores(), autogram_get_hardware_profiles(), autogram_get_job_events(), autogram_plan_batch(), autogram_run_container_repair(), automations_delete() (+122 more)

### Community 1 - "app_db.rs"
Cohesion: 0.18
Nodes (30): clear_duplicate_history_for_target(), create_transfer_state(), delete_duplicate_by_message_id(), delete_session(), ensure_schema_extended(), get_duplicate_message_id(), get_duplicate_message_ids_batch(), get_session() (+22 more)

### Community 2 - "grammers_media.rs"
Cohesion: 0.05
Nodes (85): repair_mp4_container(), RepairResult, Result, remux_lossless(), Result, collect_ffmpeg_candidates(), collect_ffmpeg_recursive(), extract_ffmpeg_frame_from_url() (+77 more)

### Community 3 - "telegram_ops.rs"
Cohesion: 0.07
Nodes (89): LoginResult, active_ops(), active_streams_map(), active_telegram_backend(), AuthStatus, AvatarsBatchRequest, backend_status(), backend_status_lists_grammers_ops() (+81 more)

### Community 4 - "paths.mjs"
Cohesion: 0.05
Nodes (72): checkHealth(), fetchOk(), waitForHealthy(), lines, log, logFile, write(), closeRenameAudit() (+64 more)

### Community 5 - "CHANGELOG.md"
Cohesion: 0.03
Nodes (69): v2.1.0 Foundation & Merged Repository, v2.1.10 Perbaikan Akurasi Pengurutan Terlama & Sinkronisasi State Filter, v2.1.11 Perbaikan Galat Indeks Pengindeksan Media & Kestabilan Indikator Koneksi, v2.1.12 Optimasi Dinamis Buffering & Kecepatan Streaming Berkas Besar (>1GB), v2.1.13 Perbaikan Error 'MTProtoSender' Object Is Not Callable untuk Pratinjau Berkas Lintas DC (>2GB), v2.1.14 Pembersihan Placeholder Tampilan Awal Memuat Pratinjau Media (Video & Gambar), v2.1.15 Pembersihan Sesi Bayangan (_preview) dari Daftar Pilihan Antarmuka, v2.1.16 Paralelisasi Bootstrapping & Optimasi Batas Muat Awal Media (+61 more)

### Community 6 - "grammers_ops.rs"
Cohesion: 0.00
Nodes (202): attachNodeArrayDebugInfo(), attachNodeArrayDebugInfoWorker(), canFollow(), cartesianProduct(), cartesianProductWorker(), changesAffectModuleResolution(), charactersFuzzyMatchInString(), clearAffectedFilesPendingEmit() (+194 more)

### Community 7 - "job_queue.rs"
Cohesion: 0.13
Nodes (32): cancel_transfer(), cancelled_set(), clear_all_cancel_flags(), clear_cancel_flag_for(), create_and_update_item(), create_transfer(), CreateFileEntry, get_transfer() (+24 more)

### Community 8 - "list_zip_sparse"
Cohesion: 0.10
Nodes (17): DriveGridRow, DriveGridRowProps, Props, DriveFileCard, Props, DriveFileListItem, Props, CenteredGlassmorphicProgress() (+9 more)

### Community 9 - "tg_log.rs"
Cohesion: 0.05
Nodes (51): AsRef, enqueue_special_media_item(), failed_until(), get_cached_special_thumb(), processed_keys(), resolved_cache(), AppHandle, Client (+43 more)

### Community 10 - "path_policy.rs"
Cohesion: 0.12
Nodes (25): FileHashResult, hashes_small_file(), quick_fingerprint(), Result, sha256_file(), finish_result(), flood_wait_secs(), is_clean_copy_mode() (+17 more)

### Community 11 - "session_rate.rs"
Cohesion: 0.13
Nodes (34): acquire_media_slot(), acquire_preview_slot(), begin_preview_flight(), end_preview_flight(), ensure_not_flooded(), flood_remaining_secs(), non_flood_errors_do_not_trigger_flood_wait(), note_error() (+26 more)

### Community 12 - "stream_server.rs"
Cohesion: 0.11
Nodes (46): bounded_response_end(), contiguous_end_from(), contiguous_from_zero(), cors_headers(), DemandRangeReader, ensure_started(), filled_bytes(), get_entry() (+38 more)

### Community 13 - "TgError"
Cohesion: 0.15
Nodes (39): AsyncRead, AlbumUploadFile, download_file_blocking(), download_file_blocking_with_policy(), DownloadFileResult, DownloadPolicyRequest, infer_mime_type(), is_real_photo() (+31 more)

### Community 14 - "secrets.rs"
Cohesion: 0.23
Nodes (33): decode_key_b64(), decrypt_map(), decrypt_map_or_recover(), delete_credential(), delete_worker_temp_file(), encrypt_map(), ensure_secure_dirs(), get_credential() (+25 more)

### Community 15 - "jobs_db.rs"
Cohesion: 0.06
Nodes (67): AutomationRow, delete_automation(), ensure_schema(), list_automations(), open_db(), resolve_migrator_db(), Connection, Option (+59 more)

### Community 16 - "allow"
Cohesion: 0.06
Nodes (33): app, security, windows, enable, scope, build, beforeBuildCommand, beforeDevCommand (+25 more)

### Community 17 - "telethon_session_import.rs"
Cohesion: 0.08
Nodes (51): DcConnectionInfo, cancel_qr_login(), clear_cached_user_profile(), disconnect_session_blocking(), ensure_grammers_session(), fresh_login_does_not_persist_session_before_auth_key(), grammers_file_has_auth_key(), grammers_runtime_is_process_wide() (+43 more)

### Community 18 - "SpeedTest.tsx"
Cohesion: 0.12
Nodes (16): DriveContextMenu(), DriveContextMenuTarget, DriveLocationKind, Props, DriveDestChoice, DriveDestinationPicker(), DriveDestPickerState, kindIcon() (+8 more)

### Community 19 - "network.rs"
Cohesion: 0.15
Nodes (26): apply_all(), apply_proxy(), apply_vpn(), clamp_vpn(), clamp_vpn_bounds(), connect_timeout_secs(), init_config_path(), is_network_available() (+18 more)

### Community 20 - "drive_rpc.rs"
Cohesion: 0.04
Nodes (141): avatars_batch_blocking(), AvatarsBatchResult, channel_peer_id_from_bare(), chats_from_updates(), compose_folder_about(), create_folder_blocking(), create_topic_blocking(), delete_folder_blocking() (+133 more)

### Community 21 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 22 - "AutoGram App/src-tauri/tauri.conf.json"
Cohesion: 0.11
Nodes (40): cancel_flags(), cancel_progressive(), data_url_jpeg_header(), find_cached_preview_file(), find_missing_offset_from(), first_missing_offset(), guess_mime(), image_dimensions_from_bytes() (+32 more)

### Community 23 - "DriveExplorer.tsx"
Cohesion: 0.00
Nodes (199): attachNodeArrayDebugInfo(), attachNodeArrayDebugInfoWorker(), canFollow(), cartesianProduct(), cartesianProductWorker(), charactersFuzzyMatchInString(), clearAffectedFilesPendingEmit(), convertClassification() (+191 more)

### Community 25 - "get_connection"
Cohesion: 0.24
Nodes (6): Into, Option, Result, Self, TransferStateConfig, TransferStateManager

### Community 26 - "DrivePreviewModal.tsx"
Cohesion: 0.01
Nodes (391): AbstractKeyword, AccessExpression, AccessibilityModifier, AccessorDeclaration, AccessorKeyword, ActionInvalidate, ActionPackageInstalled, ActionSet (+383 more)

### Community 27 - "path_is_allowed"
Cohesion: 0.42
Nodes (16): allowed_roots(), cache_file_ready(), copy_cache_file(), open_path_safe(), open_with_dialog(), path_is_allowed(), path_looks_like_cache(), resolve_worker_root() (+8 more)

### Community 28 - "JobRuntime.tsx"
Cohesion: 0.16
Nodes (12): FreshStartModal(), FreshStartModalProps, JobDetailsModal(), JobDetailsModalProps, RerunModal(), RerunModalProps, JobRuntime(), JobRuntimeProps (+4 more)

### Community 29 - "DriveConfirmDialog.tsx"
Cohesion: 0.17
Nodes (3): DriveSidebarProps, DropRowProps, TELEGRAM_FOLDER_COLORS

### Community 30 - "dependencies"
Cohesion: 0.06
Nodes (31): dependencies, i18next, i18next-browser-languagedetector, lucide-react, pdfjs-dist, react, react-dom, react-i18next (+23 more)

### Community 31 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, playwright, @tauri-apps/cli, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react (+9 more)

### Community 32 - "App.tsx"
Cohesion: 0.17
Nodes (11): App(), DESKTOP_ONLY_TABS, initialTab(), MediaStudio, NAV_ITEMS, Sidebar(), SidebarProps, Dashboard() (+3 more)

### Community 33 - "DriveZipBrowser.tsx"
Cohesion: 0.12
Nodes (19): clearZipBrowserCache(), DriveConfirmState, DriveInputKind, DriveInputState, Props, DriveCrumbSeg, DriveTopBar(), Props (+11 more)

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
Cohesion: 0.04
Nodes (109): addNodeOutliningSpans(), addOutliningForLeadingCommentsForNode(), assertLessThan(), collectTokens(), convertCallSiteGroupToIncomingCall(), convertCallSiteGroupToOutgoingCall(), createCallHierarchyIncomingCall(), createCallHierarchyItem() (+101 more)

### Community 43 - "test_media_specific.mjs"
Cohesion: 0.26
Nodes (14): bug(), bugs, cdpSession(), evalJSON(), httpGet(), log(), main(), require (+6 more)

### Community 44 - "DriveSidebar.tsx"
Cohesion: 0.10
Nodes (19): DriveConfirmDialog(), DriveConfirmKind, DriveFolderDeleteChoice, DriveMoveChoice, Props, DriveSidebar(), dropKey(), DropRowProps (+11 more)

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
Cohesion: 0.23
Nodes (8): InfoTooltip(), Select(), SelectOption, SelectProps, JobEditor(), CaptionModal(), CaptionModalProps, parseTelegramMarkdown()

### Community 50 - "wait_helpers.mjs"
Cohesion: 0.04
Nodes (95): assign(), changeAnyExtension(), cloneCompilerOptions(), convertCompileOnSaveOptionFromJson(), convertCompilerOptionsForTelemetry(), convertCompilerOptionsFromJson(), convertCompilerOptionsFromJsonWorker(), convertConfigFileToObject() (+87 more)

### Community 51 - "Bug Investigation: Media Studio Deep Performance"
Cohesion: 0.18
Nodes (10): Bug Investigation: Media Studio Deep Performance, Expected behavior, Failed fixes, Hypotheses tried, Next steps, Status, Suspected files, Symptoms (+2 more)

### Community 52 - "ProgressTracker"
Cohesion: 0.24
Nodes (6): BenchProgressPayload, BenchResult, ProgressTracker, Instant, Option, Self

### Community 53 - "TransferJournal"
Cohesion: 0.36
Nodes (4): PathBuf, Self, Value, TransferJournal

### Community 54 - "db.py"
Cohesion: 0.09
Nodes (95): addRelatedInfo(), allowInAnd(), createDetachedDiagnostic(), createMissingList(), finishNode(), getNodePos(), hasPrecedingJSDocComment(), internIdentifier() (+87 more)

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
Nodes (49): CachedCatalog, extract_zip_entry_direct(), extract_zip_entry_sparse(), get_cached_catalog(), invalidate_cached_catalog(), list_zip_sparse(), parse_central_directory_fast(), preview_zip_entry_direct() (+41 more)

### Community 62 - "session_clone.rs"
Cohesion: 0.61
Nodes (8): cleanup_ghost_session(), clear_ghost_sessions_disk(), clone_telegram_session_atomic(), ensure_ghost_session(), get_sessions_dir(), AppHandle, PathBuf, Result

### Community 63 - "probe_34404.cjs"
Cohesion: 0.29
Nodes (9): fs, http, main(), note(), ok(), path, sleep(), warn() (+1 more)

### Community 64 - "probe_34404_v2.cjs"
Cohesion: 0.29
Nodes (9): fs, http, main(), note(), ok(), path, sleep(), warn() (+1 more)

### Community 65 - "probe_34404_v3.cjs"
Cohesion: 0.19
Nodes (13): DriveInputDialog(), fs, http, main(), note(), ok(), path, sleep() (+5 more)

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
Nodes (33): DriveToolsPanel(), DupTab(), preferredKeepId(), Props, smartDeleteIds(), ToolTabIntro(), TransferTabContent(), DriveToolsTab (+25 more)

### Community 78 - "scripts"
Cohesion: 0.15
Nodes (12): name, private, scripts, build, build:web, dev, preview, tauri (+4 more)

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
Cohesion: 0.19
Nodes (10): qrcode, ConfirmModal(), ConfirmModalProps, Accounts(), CustomCountrySelect(), safeGetCallingCode(), Automation(), Profile (+2 more)

### Community 102 - "VSCodeCodeViewer.tsx"
Cohesion: 0.10
Nodes (28): DriveZipBrowser(), mapLocalPreview(), mediaKindFromName(), PasswordAction, ZipCodePreviewModal(), ZipCodePreviewModalProps, EntryIcon(), Props (+20 more)

### Community 104 - "ReUploadBatchModal.tsx"
Cohesion: 0.30
Nodes (13): cleanup_paths(), CleanupResult, clear_download_registry(), get_registry_path(), list_active_download_paths(), load_unlocked(), register_download_path(), RegistryData (+5 more)

### Community 106 - "media_meta.rs"
Cohesion: 0.50
Nodes (3): EncodeBudgetPlan, plan_encode_budget(), Option

### Community 107 - "frontend/package.json"
Cohesion: 0.06
Nodes (92): allowConditionalTypesAnd(), createQualifiedName(), disallowConditionalTypesAnd(), finishNode(), getNodePos(), getTemplateLiteralRawText(), inDisallowConditionalTypesContext(), isJSDocNullableType() (+84 more)

### Community 110 - "Settings.tsx"
Cohesion: 0.36
Nodes (5): DebugSection, Settings(), PerfSection, CACHE_LIMIT_LABELS, CACHE_LIMIT_STEPS

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
Cohesion: 0.18
Nodes (3): ErrorBoundary, Props, resources

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

### Community 242 - "i18next"
Cohesion: 0.20
Nodes (7): candidates, card, errors, pages, results, sessionSelect, tDrive

### Community 244 - "react-i18next"
Cohesion: 0.06
Nodes (76): convertToDiagnosticRelatedInformation(), convertToDiagnostics(), convertToTSConfig(), copyProperties(), CoreServicesShimHostAdapter(), createBuilderProgramUsingProgramBuildInfo(), createCachedDirectoryStructureHost(), createCompilerHostFromProgramHost() (+68 more)

### Community 247 - "@tauri-apps/plugin-fs"
Cohesion: 0.25
Nodes (7): drivesBtn, gudang, page, photo, report, samples, t0

### Community 248 - "@tauri-apps/plugin-shell"
Cohesion: 0.36
Nodes (6): detectLanguage(), escapeHtml(), highlightLine(), VSCodeCodeViewer(), VSCodeCodeViewerProps, DocumentViewerProps

### Community 251 - "AutoGram App/src-tauri/build.rs"
Cohesion: 0.05
Nodes (75): addDefiniteAssignmentAssertion(), addInitializer(), addMethodDeclaration(), addMissingMemberInJs(), addPropertyDeclaration(), addReturnStatement(), addUndefinedType(), changeInferToUnknown() (+67 more)

### Community 255 - "MicroProgressBar"
Cohesion: 0.05
Nodes (80): abortParsingListOrMoveToNextToken(), canFollowContextualOfKeyword(), canFollowExportModifier(), canFollowModifier(), consumeNode(), currentNode(), entryToDeclaration(), getExpectedCommaDiagnostic() (+72 more)

### Community 257 - "ModernProgressBar"
Cohesion: 0.05
Nodes (39): applyChange(), ChangeTracker(), convertAssignment(), convertExportsPropertyAssignment(), convertNamedExport(), createRange(), createTextRangeFromNode(), createTokenRange() (+31 more)

### Community 259 - "remote/e2e-cdp-smoke.mjs"
Cohesion: 0.05
Nodes (77): abortParsingListOrMoveToNextToken(), canFollowContextualOfKeyword(), canFollowExportModifier(), canFollowModifier(), canFollowTypeArgumentsInExpression(), canParseSemicolon(), getExpectedCommaDiagnostic(), isAssertionKey() (+69 more)

### Community 266 - "react-phone-number-input"
Cohesion: 0.05
Nodes (70): addExports(), addToAffectedFilesPendingEmit(), addToMultimap(), arrayToMultiMap(), canReuseOldState(), checkDefined(), cloneCompilerOptions(), collectFreeIdentifiers() (+62 more)

### Community 267 - "@tauri-apps/api"
Cohesion: 0.06
Nodes (34): addImportType(), addNamespaceQualifier(), arrayIsSorted(), binarySearch(), ChangeTracker(), codeActionForFixWorker(), compareImportOrExportSpecifiers(), convertExportsPropertyAssignment() (+26 more)

### Community 268 - "@tauri-apps/plugin-fs"
Cohesion: 0.06
Nodes (66): combineNormal(), combinePaths(), combinePathsSafe(), comparePaths(), comparePathsCaseInsensitive(), comparePathsCaseSensitive(), comparePathsWorker(), compareStringsCaseInsensitive() (+58 more)

### Community 269 - "@tauri-apps/plugin-shell"
Cohesion: 0.03
Nodes (69): ArrayLiteralExpression, ArrayTypeNode, BigIntLiteral, ConditionalTypeNode, ConstructorTypeNode, Declaration, FalseLiteral, FunctionOrConstructorTypeNodeBase (+61 more)

### Community 270 - "types.ts"
Cohesion: 0.07
Nodes (36): loadMoreTopicMedia(), openTopicMedia(), OpResult, DocumentThumbnail(), DocumentThumbnailProps, FileTypeIcon(), FileTypeIconProps, ThumbnailQualityBadge() (+28 more)

### Community 271 - "assert"
Cohesion: 0.05
Nodes (66): annotateJSDocParameters(), annotateParameters(), assert(), collectEnclosingScopes(), collectReadsAndWrites(), convertClassificationsToSpans(), createSuperAccessVariableStatement(), doInterfaceChange() (+58 more)

### Community 272 - ".getCurrentDirectory"
Cohesion: 0.08
Nodes (60): CoreServicesShimHostAdapter(), createBuilderProgramUsingProgramBuildInfo(), createCachedDirectoryStructureHost(), createCompilerHostFromProgramHost(), createCompilerHostWorker(), createDiagnosticReporter(), createGetCanonicalFileName(), createIncrementalCompilerHost() (+52 more)

### Community 273 - "combinePaths"
Cohesion: 0.07
Nodes (66): addCompletionEntriesFromPaths(), addCompletionEntriesFromPathsOrExports(), arePathsEqual(), combineNormal(), combinePaths(), comparePaths(), containsPath(), containsSlash() (+58 more)

### Community 274 - "getNextInvalidatedProjectCreateInfo"
Cohesion: 0.07
Nodes (66): State, addProjToQueue(), bindSourceFile(), build(), buildNextInvalidatedProject(), buildNextInvalidatedProjectWorker(), buildWorker(), clean() (+58 more)

### Community 275 - "startsWith"
Cohesion: 0.05
Nodes (66): compareBooleans(), compareModuleSpecifiers(), compareNodeCoreModuleSpecifiers(), compareNumberOfDirectorySeparators(), comparePathsByRedirectAndNumberOfDirectorySeparators(), countPathComponents(), endsWith(), ensurePathIsNonModuleName() (+58 more)

### Community 285 - "hasProperty"
Cohesion: 0.06
Nodes (63): allKeysStartWithDot(), comparePatternKeys(), createBinder(), createOverload(), directoryProbablyExists(), getCompilerOptionsOfBuildOptions(), getLoadModuleFromTargetImportOrExport(), getOwnKeys() (+55 more)

### Community 291 - "stats_db.rs"
Cohesion: 0.05
Nodes (62): assertNever(), canCompleteFromNamedBindings(), completionInfoFromData(), completionNameForLiteral(), convertPathCompletions(), convertStringLiteralCompletions(), createCompletionEntryForLiteral(), createSortedArray() (+54 more)

### Community 294 - "v2.3.78 Multi-Decoder CPU Software Fallback (`libdav1d` / `av1`) & Head Rescue Loop"
Cohesion: 0.08
Nodes (6): convertClassifications(), createLanguageService(), getEditsForRefactor(), getNewLineOrDefaultFromHost(), LanguageServiceShimObject(), maybeSetLocalizedDiagnosticMessages()

### Community 298 - "skipTrivia"
Cohesion: 0.07
Nodes (52): addEnumMemberDeclaration(), appendCommentRange(), checkNodePositions(), computeLineOfPosition(), concatenate(), deleteDeclaration(), deleteDefaultImport(), deleteImportBinding() (+44 more)

### Community 300 - "@tauri-apps/plugin-dialog"
Cohesion: 0.09
Nodes (6): convertClassifications(), createLanguageService(), getEditsForRefactor(), getNewLineOrDefaultFromHost(), LanguageServiceShimObject(), maybeSetLocalizedDiagnosticMessages()

### Community 301 - "media_prep.rs"
Cohesion: 0.08
Nodes (51): compute_best_encoder(), CpuCapability, detect_hardware_capabilities(), FfmpegEncoderSupport, get_hardware_capabilities(), GpuCapability, HardwareCapabilities, parse_specific_encoder_device() (+43 more)

### Community 302 - "JSDocContainer"
Cohesion: 0.06
Nodes (58): ArrowFunction, AutoAccessorPropertyDeclaration, BindingElement, CallSignatureDeclaration, CaseClause, ClassDeclaration, ClassElement, ClassExpression (+50 more)

### Community 303 - "getEmitScriptTarget"
Cohesion: 0.06
Nodes (52): addFunctionDeclaration(), addJsxAttributes(), addMethodDeclaration(), addMissingConstraint(), addMissingMemberInJs(), addMissingMembers(), addNewNodeForMemberSymbol(), addObjectLiteralProperties() (+44 more)

### Community 304 - "Node"
Cohesion: 0.04
Nodes (42): ArrayBindingPattern, AssertClause, AssertEntry, Bundle, CaseBlock, CatchClause, ComputedPropertyName, Decorator (+34 more)

### Community 306 - "DeadCenterProgress"
Cohesion: 0.12
Nodes (20): buildMediaSrc(), clamp(), DEFAULT_VIDEO_QUALITIES, DrivePreviewModal(), formatQualitySize(), isHttpStreamUrl(), isPlayableHttpUrl(), isProgressiveStreamPath() (+12 more)

### Community 307 - ".getStart"
Cohesion: 0.06
Nodes (46): addNodeOutliningSpans(), addOutliningForLeadingCommentsForPos(), addRegionOutliningSpans(), argumentStartsOnSameLineAsPreviousArgument(), assertLessThan(), collectElements(), collectTokens(), createOutliningSpan() (+38 more)

### Community 308 - "findAncestor"
Cohesion: 0.05
Nodes (56): addMissingNewOperator(), binaryExpressionMayBeOpenTag(), cast(), findAncestor(), findAncestorMatchingSpan(), findNodeToFix(), forEachTopLevelDeclarationInBindingName(), getActionsForInvalidImportLocation() (+48 more)

### Community 309 - "ZipErrorBoundary"
Cohesion: 0.07
Nodes (48): arrayToMultiMap(), changeCompilerHostLikeToUseCache(), changeExtension(), CoreServicesShimObject(), createCompilerHost(), createCreateProgramOptions(), createProgram(), fileExtensionIs() (+40 more)

### Community 313 - "parseClassElement"
Cohesion: 0.08
Nodes (55): disallowInAnd(), doInAwaitContext(), doInDecoratorContext(), doInsideOfContext(), doInYieldAndAwaitContext(), doInYieldContext(), inAwaitContext(), inContext() (+47 more)

### Community 314 - "parseAssignmentExpressionOrHigher"
Cohesion: 0.05
Nodes (55): addJSDocComment(), disallowInAnd(), doInAwaitContext(), doInDecoratorContext(), doInsideOfContext(), doInYieldAndAwaitContext(), doInYieldContext(), doOutsideOfAwaitContext() (+47 more)

### Community 315 - "withJSDoc"
Cohesion: 0.12
Nodes (53): allowInAnd(), hasPrecedingJSDocComment(), isDeclareModifier(), parseAccessorDeclaration(), parseBlock(), parseCaseClause(), parseCatchClause(), parseClassElement() (+45 more)

### Community 322 - "arrayFrom"
Cohesion: 0.06
Nodes (52): arrayFrom(), backupBuilderProgramEmitState(), canJsonReportNoInputFiles(), checkConfigFileUpToDateStatus(), createAbstractBuilder(), createAddOutput(), createBuilderProgram(), createDiagnosticCollection() (+44 more)

### Community 323 - "createIdentifier"
Cohesion: 0.06
Nodes (47): addFunctionDeclaration(), addJsxAttributes(), addMissingConstraint(), addNewFileToTsconfig(), addObjectLiteralProperties(), canPrefix(), changeDefaultToNamedImport(), changeExport() (+39 more)

### Community 324 - "startsWith"
Cohesion: 0.06
Nodes (51): allKeysStartWithDot(), changeAnyExtension(), compareNodeCoreModuleSpecifiers(), comparePatternKeys(), computeNewText(), countPathComponents(), endsWith(), extensionIsOk() (+43 more)

### Community 325 - "getInfo"
Cohesion: 0.06
Nodes (51): childIsUnindentedBranchOfConditionalExpression(), convertSemanticMeaningToSymbolFlags(), find(), getAdjustedLocationForClass(), getAdjustedLocationForDeclaration(), getAdjustedLocationForFunction(), getCallHierarchyDeclarationReferenceNode(), getCallHierarchyItemName() (+43 more)

### Community 326 - "parseExpected"
Cohesion: 0.09
Nodes (51): createMissingList(), inAwaitContext(), internIdentifier(), parseAmbientExternalModuleDeclaration(), parseBracketedList(), parseBreakOrContinueStatement(), parseCaseBlock(), parseCaseOrDefaultClause() (+43 more)

### Community 327 - "ErrorClass"
Cohesion: 0.06
Nodes (36): delete_job_checkpoints(), JobCheckpoint, load_latest_checkpoint(), Connection, Option, Result, save_checkpoint(), calculate_file_sha256() (+28 more)

### Community 328 - "parseAssignmentExpressionOrHigher"
Cohesion: 0.06
Nodes (50): addJSDocComment(), canFollowTypeArgumentsInExpression(), getBinaryOperatorPrecedence(), getExpressionAssociativity(), getExpressionPrecedence(), getOperator(), getOperatorAssociativity(), getOperatorPrecedence() (+42 more)

### Community 329 - "getContextualType"
Cohesion: 0.05
Nodes (50): addReplacementSpans(), createJsonPropertyAssignment(), forEachProperty(), forEachRelatedSymbol(), getArgumentInfoForCompletions(), getContainingObjectLiteralElement(), getContextualType(), getContextualTypeFromParent() (+42 more)

### Community 330 - "Scanner"
Cohesion: 0.06
Nodes (13): createScanner(), Scanner, getCookedText(), getEncodedSyntacticClassifications(), reScanTemplateToken(), scanJsxAttributeValue(), createScanner(), getCookedText() (+5 more)

### Community 331 - "Type"
Cohesion: 0.04
Nodes (27): BigIntLiteralType, ConditionalType, DeferredTypeReference, EnumType, EvolvingArrayType, GenericType, IndexedAccessType, IndexType (+19 more)

### Community 332 - "ProgramHost"
Cohesion: 0.04
Nodes (11): ConfigFileDiagnosticsReporter, ParseConfigFileHost, ParseConfigHost, ProgramHost, SolutionBuilderHost, SolutionBuilderHostBase, SolutionBuilderWithWatchHost, WatchCompilerHost (+3 more)

### Community 333 - ".replaceNode"
Cohesion: 0.06
Nodes (47): addDefiniteAssignmentAssertion(), addInitializer(), addReturnStatement(), addUndefinedType(), canHaveLiteralInitializer(), changeInferToUnknown(), convertToBlock(), createAccessorAccessExpression() (+39 more)

### Community 334 - "extractFunctionInScope"
Cohesion: 0.06
Nodes (49): addEnumMemberDeclaration(), collectEnclosingScopes(), extractConstantInScope(), extractFunctionInScope(), findBaseOfDeclaration(), getAllSuperTypeNodes(), getCalledExpression(), getConstantExtractionAtIndex() (+41 more)

### Community 335 - "skipTrivia"
Cohesion: 0.08
Nodes (42): appendCommentRange(), checkNodePositions(), concatenate(), deleteDeclaration(), deleteDefaultImport(), deleteImportBinding(), deleteNode(), deleteNodeInList() (+34 more)

### Community 336 - "createIdentifier"
Cohesion: 0.08
Nodes (47): changeDefaultToNamedImport(), changeImports(), changeNamedToDefaultImport(), collectExportRenames(), combine(), convertAssignment(), convertedImports(), convertExportsAccesses() (+39 more)

### Community 337 - "firstDefined"
Cohesion: 0.06
Nodes (46): codeActionForFix(), codeFixActionToCodeAction(), createImportSpecifierResolver(), createPackageJsonImportFilter(), firstDefined(), fix(), forEachTopLevelDeclaration(), forEachTopLevelDeclarationInBindingName() (+38 more)

### Community 338 - ".isStringLiteral"
Cohesion: 0.06
Nodes (40): addToSeen(), createJsonPropertyAssignment(), findFirstNonWhitespaceCharacterAndColumn(), findFirstNonWhitespaceColumn(), findJsonProperty(), firstOrUndefined(), forEachProperty(), formatOnEnter() (+32 more)

### Community 339 - "getDirectoryPath"
Cohesion: 0.07
Nodes (46): arePathsEqual(), base64decode(), canWatchDirectoryOrFile(), classicNameResolver(), convertDocumentToSourceMapper(), createDocumentPositionMapper(), createPackageJsonInfo(), createResolvedModuleWithFailedLookupLocations() (+38 more)

### Community 340 - "createSolutionBuilderWorker"
Cohesion: 0.10
Nodes (45): addProjToQueue(), bindSourceFile(), build(), buildNextInvalidatedProject(), buildNextInvalidatedProjectWorker(), buildWorker(), clean(), cleanWorker() (+37 more)

### Community 342 - "push"
Cohesion: 0.07
Nodes (45): addPragmaForMatch(), arrayFrom(), convertJsonOption(), convertJsonOptionOfCustomType(), convertJsonOptionOfListType(), createCompilerDiagnosticForInvalidCustomType(), createDiagnosticForInvalidCustomType(), createSet() (+37 more)

### Community 343 - ".add"
Cohesion: 0.05
Nodes (43): addToMultimap(), addToSeen(), charSize(), collectFreeIdentifiers(), consumesNodeCoreModules(), createCacheableExportInfoMap(), createDirectoryWatcherSupportingRecursive(), createExistingImportMap() (+35 more)

### Community 344 - "parseOptional"
Cohesion: 0.07
Nodes (43): allowConditionalTypesAnd(), disallowConditionalTypesAnd(), doOutsideOfAwaitContext(), doOutsideOfContext(), doOutsideOfYieldAndAwaitContext(), getTemplateLiteralRawText(), inDisallowConditionalTypesContext(), isJSDocNullableType() (+35 more)

### Community 345 - ".getLineAndCharacterOfPosition"
Cohesion: 0.09
Nodes (42): applyChanges(), childStartsOnTheSameLineWithElseInIfStatement(), createCommentDirectivesMap(), deriveActualIndentationFromList(), findColumnForFirstNonWhitespaceCharacterInLine(), findEnclosingNode(), findImmediatelyPrecedingTokenOfKind(), findOutermostNodeWithinListLevel() (+34 more)

### Community 346 - "tokenToString"
Cohesion: 0.09
Nodes (43): createMissingNode(), internPrivateIdentifier(), isJsxOpeningElement(), isStartOfOptionalPropertyOrElementAccessChain(), isTemplateStartOfTaggedTemplate(), nextTokenIsDot(), nextTokenIsIdentifierOrKeywordOrOpenBracketOrTemplate(), nextTokenIsOpenParenOrLessThan() (+35 more)

### Community 347 - "createProgram"
Cohesion: 0.09
Nodes (40): addRange(), afterProgramDone(), backupBuilderProgramEmitState(), buildErrors(), createAbstractBuilder(), createBuilderProgram(), createBuildOrUpdateInvalidedProject(), createCompilerHost() (+32 more)

### Community 348 - ".trace"
Cohesion: 0.10
Nodes (41): directoryProbablyExists(), getPackageJsonInfo(), isExternalModuleNameRelative(), loadJSOrExactTSFileName(), loadModuleFromFile(), loadModuleFromFileNoImplicitExtensions(), loadModuleFromFileNoPackageId(), loadModuleFromImmediateNodeModulesDirectory() (+33 more)

### Community 349 - "fileExtensionIs"
Cohesion: 0.10
Nodes (41): changeCompilerHostLikeToUseCache(), changeExtension(), createAddOutput(), fileExtensionIs(), fileExtensionIsOneOf(), getAllProjectOutputs(), getAreDeclarationMapsEnabled(), getCommonSourceDirectory() (+33 more)

### Community 350 - "isIdentifier"
Cohesion: 0.08
Nodes (40): addConvertToAsyncFunctionDiagnostics(), canBeConvertedToClass(), forEachReference(), getAssignedName(), getCallHierarchItemContainerName(), getCallName(), getContainers(), getDeclarationIdentifier() (+32 more)

### Community 351 - ".has"
Cohesion: 0.08
Nodes (39): addToAffectedFilesPendingEmit(), assertSourceFileOkWithoutNextAffectedCall(), canReuseOldState(), changesAffectingProgramStructure(), compilerOptionsAffectDeclarationPath(), compilerOptionsAffectEmit(), compilerOptionsAffectSemanticDiagnostics(), create() (+31 more)

### Community 352 - "getEffectiveTypeParameterDeclarations"
Cohesion: 0.06
Nodes (40): canHaveIllegalTypeParameters(), filterOwnedJSDocTags(), getAllJSDocTags(), getAllJSDocTagsOfKind(), getCommentHavingNodes(), getEffectiveConstraintOfTypeParameter(), getEffectiveImplementsTypeNodes(), getEffectiveReturnTypeNode() (+32 more)

### Community 353 - "studio_orch.rs"
Cohesion: 0.18
Nodes (37): CreateTransferRequest, Value, Vec, TransferRecord, approved_alternate_sessions(), duplicate_match_for_prepared(), duplicate_skip_enabled(), effective_upload_limit() (+29 more)

### Community 354 - "store.rs"
Cohesion: 0.13
Nodes (35): begin_download_receipt(), begin_encoder_receipt(), create_album_commit(), download_receipt_matches(), DownloadRangeCheckpoint, find_upload_ledger_match(), finish_download_receipt(), finish_encoder_receipt() (+27 more)

### Community 355 - "getCompletionEntriesForNonRelativeModules"
Cohesion: 0.10
Nodes (36): addCompletionEntriesFromPaths(), addCompletionEntriesFromPathsOrExports(), containsIgnoredPath(), containsSlash(), createNameAndKindSet(), directoryResult(), enumerateNodeModulesVisibleToScript(), findPackageJsons() (+28 more)

### Community 356 - "TypeObject"
Cohesion: 0.08
Nodes (22): addMissingDeclarations(), and(), assertEachIsDefined(), checkEachDefined(), containsNonPublicProperties(), getApparentProperties(), getDeclarationModifierFlagsFromSymbol(), getDefaultValueFromType() (+14 more)

### Community 357 - "tokenToString"
Cohesion: 0.10
Nodes (37): canParseSemicolon(), createMissingNode(), getTextOfNodeFromSourceText(), isInOrOfKeyword(), isJsxOpeningElement(), isVariableDeclaratorListTerminator(), parseConditionalExpressionRest(), parseErrorAt() (+29 more)

### Community 358 - "enableDebugInfo"
Cohesion: 0.07
Nodes (37): canUseOriginalText(), enableDebugInfo(), flattenTypeLiteralNodeReference(), formatCheckMode(), formatEmitFlags(), formatEnum(), formatModifierFlags(), formatNodeFlags() (+29 more)

### Community 359 - "isBinaryExpression"
Cohesion: 0.09
Nodes (37): containsTopLevelCommonjs(), countBinaryExpressionParameters(), exportAssignmentIsAlias(), expressionResultIsUnused(), findAwaitableInitializers(), getAssignmentDeclarationKind(), getContextualSignatureLocationInfo(), getEditsForToTemplateLiteral() (+29 more)

### Community 360 - ".transformSourceFile"
Cohesion: 0.10
Nodes (35): chainBundle(), transformClassFields(), transformECMAScriptModule(), transformES2015(), transformES2016(), transformES2017(), transformES2018(), transformES2019() (+27 more)

### Community 361 - "parseConfig"
Cohesion: 0.08
Nodes (36): assign(), commandLineOptionsToMap(), convertCompileOnSaveOptionFromJson(), convertCompilerOptionsFromJson(), convertCompilerOptionsFromJsonWorker(), convertConfigFileToObject(), convertEnableAutoDiscoveryToEnable(), convertOptionsFromJson() (+28 more)

### Community 362 - "isPropertyAccessExpression"
Cohesion: 0.09
Nodes (34): chainStartsWith(), cleanText(), convertOccurrences(), getBinaryInfo(), getCalledExpressionName(), getCallName(), getConditionalInfo(), getFinalExpressionInChain() (+26 more)

### Community 363 - "contains"
Cohesion: 0.07
Nodes (36): clearScreenIfNotWatchingForFileChanges(), contains(), copyProperties(), countWhere(), createBuilderStatusReporter(), createCompilerDiagnostic(), createSolutionBuilderWithWatchHost(), createTabularErrorsDisplay() (+28 more)

### Community 364 - "doAddExistingFix"
Cohesion: 0.08
Nodes (33): arrayIsSorted(), assignPositionsToNode(), assignPositionsToNodeArray(), binarySearch(), coalesceExports(), coalesceImports(), compareIdentifiers(), compareImportOrExportSpecifiers() (+25 more)

### Community 365 - ".forEach"
Cohesion: 0.09
Nodes (33): arrayToMap(), clearSharedExtendedConfigFileWatcher(), closeFileWatcher(), closeFileWatcherOf(), createModeAwareCache(), createSingleWatcherPerName(), createSystemWatchFunctions(), forEachMark() (+25 more)

### Community 366 - "isPropertyAccessExpression"
Cohesion: 0.09
Nodes (34): chainStartsWith(), convertOccurrences(), expandPreOrPostfixIncrementOrDecrementExpression(), findSuperStatementIndex(), getBinaryInfo(), getConditionalInfo(), getElementOrPropertyAccessArgumentExpressionOrName(), getFinalExpressionInChain() (+26 more)

### Community 367 - ".getLineAndCharacterOfPosition"
Cohesion: 0.11
Nodes (34): childIsUnindentedBranchOfConditionalExpression(), childStartsOnTheSameLineWithElseInIfStatement(), computeNewText(), createCommentDirectivesMap(), deriveActualIndentationFromList(), findColumnForFirstNonWhitespaceCharacterInLine(), findFirstNonWhitespaceCharacterAndColumn(), findFirstNonWhitespaceColumn() (+26 more)

### Community 368 - "getFirstJSDocTag"
Cohesion: 0.07
Nodes (35): getEffectiveModifierFlags(), getEffectiveModifierFlagsAlwaysIncludeJSDoc(), getEffectiveModifierFlagsNoCache(), getFirstJSDocTag(), getJSDocClassTag(), getJSDocDeprecatedTag(), getJSDocDeprecatedTagNoCache(), getJSDocEnumTag() (+27 more)

### Community 369 - "getOrCreateEmitNode"
Cohesion: 0.07
Nodes (35): addEmitFlags(), addEmitFlagsRecursively(), addEmitHelper(), addEmitHelpers(), addSyntheticLeadingComment(), addSyntheticTrailingComment(), appendIfUnique(), createExpressionForJsxElement() (+27 more)

### Community 370 - "getNewFileImportsAndAddExportInOldFile"
Cohesion: 0.09
Nodes (34): addCommonjsExport(), addExport(), addExports(), addExportToChanges(), createExportAssignment(), createOldFileImportsFromNewFile(), deleteMovedStatements(), deleteUnusedOldImports() (+26 more)

### Community 371 - "getEmitFlags"
Cohesion: 0.07
Nodes (34): addDefaultValueAssignmentForBindingPattern(), addDefaultValueAssignmentForInitializer(), addDefaultValueAssignmentIfNeeded(), addDefaultValueAssignmentsIfNeeded(), escapeTemplateSubstitution(), findUseStrictPrologue(), getEmitFlags(), getLiteralText() (+26 more)

### Community 372 - ".forEach"
Cohesion: 0.08
Nodes (31): arrayToMap(), cleanExtendedConfigCache(), clearSharedExtendedConfigFileWatcher(), closeFileWatcher(), closeFileWatcherOf(), createModeAwareCache(), createSingleWatcherPerName(), deleteDestructuringElements() (+23 more)

### Community 373 - "getSourceFileOfNode"
Cohesion: 0.07
Nodes (34): canHaveModifiers(), createDiagnosticForNodeFromMessageChain(), dispatchChanges(), doAddOverrideModifierChange(), doRemoveOverrideModifierChange(), entityNameToString(), findContainerClassElementLike(), findLast() (+26 more)

### Community 374 - "TopicMediaError"
Cohesion: 0.08
Nodes (25): Display, Error, Formatter, From, Result, Self, TopicMediaError, emit_delta_event() (+17 more)

### Community 375 - "createNodeArray"
Cohesion: 0.10
Nodes (33): attachFileToDiagnostics(), clearState(), combineDecoratorsAndModifiers(), createNodeArray(), createSourceFile(), fixupParentReferences(), initializeState(), isJSDocLikeText() (+25 more)

### Community 377 - "getEmitFlags"
Cohesion: 0.07
Nodes (33): addDefaultValueAssignmentForBindingPattern(), addDefaultValueAssignmentForInitializer(), addDefaultValueAssignmentIfNeeded(), addDefaultValueAssignmentsIfNeeded(), eachUnreachableRange(), escapeTemplateSubstitution(), findUseStrictPrologue(), getEmitFlags() (+25 more)

### Community 378 - "hasSyntacticModifier"
Cohesion: 0.07
Nodes (33): collectCallSitesOfModuleDeclaration(), getCombinedModifierFlags(), getCombinedNodeFlags(), getImportersForExport(), getModuleInstanceState(), getModuleInstanceStateCached(), getModuleInstanceStateForAliasTarget(), getModuleInstanceStateWorker() (+25 more)

### Community 379 - ".getSourceFile"
Cohesion: 0.11
Nodes (32): convertCallSiteGroupToIncomingCall(), createCallHierarchyIncomingCall(), createCallHierarchyItem(), createDefinitionInfoFromName(), createNavigateToItem(), createTextSpanFromRange(), definitionToReferencedSymbolDefinitionInfo(), entryToDocumentSpan() (+24 more)

### Community 380 - "getEmitModuleKind"
Cohesion: 0.09
Nodes (33): createExternalHelpersImportDeclarationIfNeeded(), createRuntimeTypeSerializer(), getAllowSyntheticDefaultImports(), getEmitHelpers(), getEmitModuleDetectionKind(), getEmitModuleKind(), getESModuleInterop(), getExportEqualsImportKind() (+25 more)

### Community 381 - "AutoGramSplitManifest"
Cohesion: 0.10
Nodes (24): BinaryVolumePart, PathBuf, Result, Vec, split_binary_volume(), split_parts_are_bounded_and_reconstruct_exactly(), AutoGramSplitManifest, ManifestPartInfo (+16 more)

### Community 382 - "getAllRules"
Cohesion: 0.07
Nodes (32): getAllRules(), isAfterCodeBlockContext(), isArrowFunctionContext(), isBinaryOpContext(), isConditionalOperatorContext(), isConstructorSignatureContext(), isControlDeclContext(), isForContext() (+24 more)

### Community 383 - "isAssignmentOperator"
Cohesion: 0.06
Nodes (32): accessKind(), declarationIsWriteAccess(), getAssignmentTargetKind(), getPropertySymbolOfDestructuringAssignment(), isAdditiveOperator(), isAdditiveOperatorOrHigher(), isArrayLiteralOrObjectLiteralDestructuringPattern(), isAssignmentOperator() (+24 more)

### Community 384 - "createNodeArray"
Cohesion: 0.10
Nodes (32): addRelatedInfo(), attachFileToDiagnostics(), clearState(), combineDecoratorsAndModifiers(), consumeNode(), createDetachedDiagnostic(), createNodeArray(), createSourceFile() (+24 more)

### Community 385 - "visitNode"
Cohesion: 0.09
Nodes (32): assignPositionsToNode(), assignPositionsToNodeArray(), forEachChildInBlock(), forEachChildInCallOrConstructSignature(), forEachChildInCallOrNewExpression(), forEachChildInClassDeclarationOrExpression(), forEachChildInContinueOrBreakStatement(), forEachChildInImportOrExportSpecifier() (+24 more)

### Community 386 - "isBinaryExpression"
Cohesion: 0.11
Nodes (32): compilerOptionsIndicateEsModules(), computeSuggestionDiagnostics(), containsTopLevelCommonjs(), countBinaryExpressionParameters(), exportAssignmentIsAlias(), forEachTopLevelDeclaration(), getAssignmentDeclarationKind(), getContextNodeForNodeEntry() (+24 more)

### Community 387 - "getAllRules"
Cohesion: 0.07
Nodes (32): getAllRules(), isAfterCodeBlockContext(), isArrowFunctionContext(), isBinaryOpContext(), isConditionalOperatorContext(), isConstructorSignatureContext(), isControlDeclContext(), isForContext() (+24 more)

### Community 388 - "tryCast"
Cohesion: 0.08
Nodes (31): annotate(), annotateJSDocThis(), annotateSetAccessor(), annotateThis(), annotateVariableDeclaration(), couldBeTypeOnlyImportSpecifier(), entryToAccessExpression(), entryToFunctionCall() (+23 more)

### Community 389 - "displayPart"
Cohesion: 0.09
Nodes (31): buildLinkParts(), createCompletionDetails(), createCompletionDetailsForSymbol(), createSimpleDetails(), displayPart(), findLinkNameEnd(), getCommentDisplayParts(), getCompletionEntryDetails() (+23 more)

### Community 390 - "checkDefined"
Cohesion: 0.09
Nodes (30): checkDefined(), computeModuleSpecifiers(), convertToRelativePath(), createTabularErrorsDisplay(), diagnosticCategoryName(), explainFiles(), explainIfFileIsRedirectAndImpliedFormat(), fileIncludeReasonToDiagnostics() (+22 more)

### Community 391 - "getDocumentationComment"
Cohesion: 0.09
Nodes (25): createJSSignatureHelpItems(), createSignatureHelpItems(), createSignatureHelpParameterForParameter(), createSignatureHelpParameterForTypeParameter(), createTypeHelpItems(), flatMapToMutable(), forEachUnique(), getDocumentationComment() (+17 more)

### Community 392 - ".getChildren"
Cohesion: 0.09
Nodes (27): containsPrecedingToken(), findContainingList(), findListItemInfo(), getActualIndentationForListItemBeforeComma(), getApplicableSpanForArguments(), getArgumentCount(), getArgumentIndex(), getArgumentOrParameterListAndIndex() (+19 more)

### Community 393 - "isAssignmentOperator"
Cohesion: 0.07
Nodes (30): accessKind(), declarationIsWriteAccess(), getAssignmentTargetKind(), getPropertySymbolOfDestructuringAssignment(), isAdditiveOperator(), isAdditiveOperatorOrHigher(), isArrayLiteralOrObjectLiteralDestructuringPattern(), isAssignmentOperator() (+22 more)

### Community 394 - "getOrCreateEmitNode"
Cohesion: 0.08
Nodes (30): addEmitFlags(), addEmitFlagsRecursively(), addEmitHelper(), addEmitHelpers(), addSyntheticLeadingComment(), addSyntheticTrailingComment(), appendIfUnique(), deduplicate() (+22 more)

### Community 395 - "isPropertyDeclaration"
Cohesion: 0.09
Nodes (30): addUndefinedToOptionalProperty(), collectCallSitesOfClassLikeDeclaration(), createPropertyName(), findBaseOfDeclaration(), getAccessorConvertiblePropertyAtPosition(), getAllSupers(), getClassExtendsHeritageElement(), getDeclarationType() (+22 more)

### Community 396 - "flattenDestructuringAssignment"
Cohesion: 0.13
Nodes (30): bindingOrAssignmentElementAssignsToName(), bindingOrAssignmentElementContainsNonLiteralComputedName(), bindingOrAssignmentPatternAssignsToName(), bindingOrAssignmentPatternContainsNonLiteralComputedName(), createDefaultValueCheck(), createDestructuringPropertyAccess(), ensureIdentifier(), flattenArrayBindingOrAssignmentPattern() (+22 more)

### Community 397 - "transformCallbackArgument"
Cohesion: 0.15
Nodes (30): canBeConvertedToExpression(), createSynthIdentifier(), createUniqueSynthName(), createVariableOrAssignmentOrExpressionStatement(), declareSynthBindingName(), declareSynthBindingPattern(), declareSynthIdentifier(), finishCatchOrFinallyTransform() (+22 more)

### Community 398 - "getRangeToExtract"
Cohesion: 0.08
Nodes (30): addOutliningForLeadingCommentsForNode(), collectTypeParameters(), createTextRangeFromSpan(), findFirstNonJsxWhitespaceToken(), findIndex(), findNextToken(), findRightmostChildNodeWithTokens(), findRightmostToken() (+22 more)

### Community 399 - "createTextSpan"
Cohesion: 0.11
Nodes (29): addReplacementSpans(), binarySearchKey(), collapseTextChangeRangesAcrossMultipleVersions(), createTextChangeRange(), createTextSpan(), createTextSpanFromBounds(), createTextSpanFromNode(), extendToAffectedRange() (+21 more)

### Community 400 - "getDirectoryPath"
Cohesion: 0.09
Nodes (30): base64decode(), containsIgnoredPath(), convertDocumentToSourceMapper(), createDocumentPositionMapper(), ensureDirectoriesExist(), findConfigFile(), findPackageJson(), forEachAncestorDirectory() (+22 more)

### Community 401 - "doChangeNamedToNamespaceOrDefault"
Cohesion: 0.09
Nodes (29): changeExport(), charSize(), createStringRange(), doChangeNamedToNamespaceOrDefault(), doChangeNamespaceToNamed(), doNamespaceImportChange(), eachSymbolReferenceInFile(), formatSymbol() (+21 more)

### Community 402 - "some"
Cohesion: 0.10
Nodes (30): childIsDecorated(), classOrConstructorParameterIsDecorated(), documentSpansEqual(), getAllDecoratorsOfAccessors(), getAllDecoratorsOfClass(), getAllDecoratorsOfClassElement(), getAllDecoratorsOfMethod(), getAllDecoratorsOfProperty() (+22 more)

### Community 403 - "isStringLiteralLike"
Cohesion: 0.11
Nodes (30): fixImportOfModuleExports(), forEachImportInStatement(), getContextualKeywords(), getModeForUsageLocation(), getRenameInfo(), getRenameInfoError(), getRenameInfoForModule(), getRenameInfoForNode() (+22 more)

### Community 404 - "DuplicateChecker"
Cohesion: 0.17
Nodes (14): ScanCacheEntry, CheckResult, DuplicateChecker, ensure_tables(), now_unix(), open_db(), Connection, HashMap (+6 more)

### Community 405 - "StorageError"
Cohesion: 0.15
Nodes (13): AndroidStorageProvider, DesktopStorageProvider, FileMetadata, Display, Error, Formatter, Result, Self (+5 more)

### Community 406 - "addNewNodeForMemberSymbol"
Cohesion: 0.10
Nodes (27): addMissingMembers(), addNewNodeForMemberSymbol(), createDummyParameters(), createMethodImplementingSignatures(), createMissingMemberNodes(), createObjectLiteralMethod(), createSignatureDeclarationFromCallExpression(), createStubbedBody() (+19 more)

### Community 407 - "getCompletionData"
Cohesion: 0.08
Nodes (26): binaryExpressionMayBeOpenTag(), dispatchChanges(), doAddOverrideModifierChange(), doRemoveOverrideModifierChange(), findContainerClassElementLike(), findLast(), findNodeToFix(), getCompletionData() (+18 more)

### Community 408 - "breakIntoSpans"
Cohesion: 0.09
Nodes (29): breakIntoCharacterSpans(), breakIntoSpans(), breakIntoWordSpans(), breakPatternIntoTextChunks(), charIsPunctuation(), createPatternMatch(), createSegment(), createTextChunk() (+21 more)

### Community 409 - "getFunctionOrClassName"
Cohesion: 0.09
Nodes (29): cleanText(), createNewArgument(), createPropertyOrShorthandAssignment(), entityNameToString(), escapeLeadingUnderscores(), formatJSDocLink(), getCalledExpressionName(), getEscapedTextOfIdentifierOrLiteral() (+21 more)

### Community 410 - "CompilerHost"
Cohesion: 0.07
Nodes (3): CompilerHost, MinimalResolutionCacheHost, ModuleResolutionHost

### Community 412 - "t"
Cohesion: 0.14
Nodes (28): t(), codeFixAll(), createActionForAddMissingMemberInJavascriptFile(), createActionsForAddMissingMemberInTypeScriptFile(), createAddIndexSignatureAction(), createCodeFixAction(), createCombinedCodeActions(), createDeleteFix() (+20 more)

### Community 413 - "flattenDestructuringBinding"
Cohesion: 0.15
Nodes (29): bindingOrAssignmentElementAssignsToName(), bindingOrAssignmentElementContainsNonLiteralComputedName(), bindingOrAssignmentPatternAssignsToName(), bindingOrAssignmentPatternContainsNonLiteralComputedName(), createDefaultValueCheck(), createDestructuringPropertyAccess(), ensureIdentifier(), flattenArrayBindingOrAssignmentPattern() (+21 more)

### Community 414 - "quality.rs"
Cohesion: 0.15
Nodes (25): OversizeAction, OversizeDecision, resolve_oversize(), classify_delivery(), classify_media(), classify_prepared_delivery(), DeliveryClassification, ext_category() (+17 more)

### Community 415 - "isSourceFile"
Cohesion: 0.11
Nodes (28): areSameModule(), canHaveExportModifier(), collectCallSitesOfModuleDeclaration(), containsGlobalScopeAugmentation(), containsOnlyAmbientModules(), getExportEqualsLocalSymbol(), getExportingModuleSymbol(), getIncomingCalls() (+20 more)

### Community 416 - ".getChildren"
Cohesion: 0.09
Nodes (27): argumentStartsOnSameLineAsPreviousArgument(), containsPrecedingToken(), findContainingList(), findListItemInfo(), getActualIndentationForListItemBeforeComma(), getAlreadyUsedTypesInStringLiteralUnion(), getArgumentCount(), getArgumentIndex() (+19 more)

### Community 417 - "createTypeChecker"
Cohesion: 0.12
Nodes (9): containsParseError(), createGetSymbolWalker(), createTypeChecker(), getFirstIdentifier(), getUseDefineForClassFields(), containsParseError(), createGetSymbolWalker(), createTypeChecker() (+1 more)

### Community 418 - "doChange"
Cohesion: 0.15
Nodes (24): addNewFileToTsconfig(), annotate(), annotateJSDocParameters(), annotateJSDocThis(), annotateParameters(), annotateSetAccessor(), annotateThis(), annotateVariableDeclaration() (+16 more)

### Community 419 - "enableDebugInfo"
Cohesion: 0.09
Nodes (28): canUseOriginalText(), dumpTypes(), enableDebugInfo(), formatCheckMode(), formatEmitFlags(), formatEnum(), formatModifierFlags(), formatNodeFlags() (+20 more)

### Community 420 - "computeModuleSpecifiers"
Cohesion: 0.11
Nodes (27): combinePathsSafe(), computeModuleSpecifiers(), convertToTSConfig(), ensurePathIsNonModuleName(), getCustomTypeMapOfCommandLineOption(), getEditsForFileRename(), getModeForResolutionAtIndex(), getModuleNameStringLiteralAt() (+19 more)

### Community 421 - "createCompletionEntry"
Cohesion: 0.11
Nodes (28): completionEntryDataIsResolved(), completionEntryDataToSymbolOriginInfo(), continuePreviousIncompleteResponse(), createCompletionEntry(), escapeSnippetText(), getAmbientModuleCompletions(), getAutoImportSymbolFromCompletionEntryData(), getInsertTextAndReplacementSpanForImportCompletion() (+20 more)

### Community 422 - "LanguageServiceShimHostAdapter"
Cohesion: 0.08
Nodes (12): createLanguageServiceSourceFile(), filterMutate(), getErrorForNoInputFiles(), getScriptKind(), isErrorNoInputFiles(), isTypingUpToDate(), LanguageServiceShimHostAdapter(), setSourceFileFields() (+4 more)

### Community 423 - "isIdentifier"
Cohesion: 0.10
Nodes (28): entryToDeclaration(), forEachReference(), getDeclarationIdentifier(), getJSDocTypeAliasName(), getNameOfExpando(), getNameOfJSDocTypedef(), getNonAssignedNameOfDeclaration(), getPrefixAndSuffixText() (+20 more)

### Community 424 - "download.rs"
Cohesion: 0.13
Nodes (21): DownloadConflictPolicy, DownloadDestinationPlan, DownloadIntegrity, finalize_partial(), open_partial_for_append(), overwrite_finalization_restores_or_replaces_safely(), partial_path_for(), partial_resume_truncates_unverified_tail() (+13 more)

### Community 425 - "transfer/mod.rs"
Cohesion: 0.09
Nodes (17): EncoderPolicy, EncoderResourceProfile, EncoderStrategy, Default, Option, Self, environment_flag(), parse_flag() (+9 more)

### Community 426 - "Expression"
Cohesion: 0.07
Nodes (27): ArrayDestructuringAssignment, AsExpression, AssignmentExpression, AwaitExpression, BinaryExpression, CommaListExpression, ConditionalExpression, DeleteExpression (+19 more)

### Community 428 - "mapDefined"
Cohesion: 0.14
Nodes (27): flatMap(), getAllReferencesForImportMeta(), getAllReferencesForKeyword(), getLabelReferencesInNode(), getPossibleSymbolReferenceNodes(), getReferencedSymbolsSpecial(), getReferencesForStringLiteral(), getReferencesForSuperKeyword() (+19 more)

### Community 429 - "getSymbolDisplayPartsDocumentationAndSymbolKind"
Cohesion: 0.12
Nodes (22): getCombinedLocalAndExportSymbolFlags(), getConstantValue(), getDeclarationOfKind(), getExternalModuleImportEqualsDeclarationExpression(), getPossibleGenericSignatures(), getSymbolDisplayPartsDocumentationAndSymbolKind(), getSymbolKind(), getSymbolKindOfConstructorPropertyMethodAccessorFunctionOrVar() (+14 more)

### Community 430 - "assert"
Cohesion: 0.09
Nodes (27): assert(), assertSourceFileOkWithoutNextAffectedCall(), checkChangeRange(), convertClassificationsToSpans(), convertToReusableDiagnosticRelatedInformation(), convertToReusableDiagnostics(), createSyntaxCursor(), getClassificationTypeName() (+19 more)

### Community 431 - "patchNodeFactory"
Cohesion: 0.08
Nodes (27): buildOverload(), createBinder(), createDeprecation(), createErrorDeprecation(), createOverload(), createWarningDeprecation(), deprecate(), error() (+19 more)

### Community 432 - "isWhiteSpaceLike"
Cohesion: 0.08
Nodes (27): computeLineOfPosition(), createSingleLineStringWriter(), emitComments(), emitDetachedComments(), emitNewLineBeforeLeadingCommentOfPosition(), emitNewLineBeforeLeadingComments(), emitNewLineBeforeLeadingCommentsOfPosition(), forEachLeadingCommentRange() (+19 more)

### Community 433 - "session_guard.rs"
Cohesion: 0.15
Nodes (19): acquire(), ActivityEntry, now_ms(), registry(), release(), release_all_for_session(), Drop, HashMap (+11 more)

### Community 434 - "models.rs"
Cohesion: 0.17
Nodes (22): MediaScopeKind, NavigationScope, OpenTopicMediaRequest, OpenTopicMediaResult, Default, Option, Self, Vec (+14 more)

### Community 435 - "some"
Cohesion: 0.12
Nodes (26): childIsDecorated(), classOrConstructorParameterIsDecorated(), explicitlyInheritsFrom(), getAllDecoratorsOfAccessors(), getAllDecoratorsOfClass(), getAllDecoratorsOfClassElement(), getAllDecoratorsOfMethod(), getAllDecoratorsOfProperty() (+18 more)

### Community 436 - "breakIntoSpans"
Cohesion: 0.11
Nodes (26): breakIntoCharacterSpans(), breakIntoSpans(), breakIntoWordSpans(), breakPatternIntoTextChunks(), charIsPunctuation(), createPatternMatch(), createSegment(), createTextChunk() (+18 more)

### Community 437 - "hasProperty"
Cohesion: 0.10
Nodes (26): convertCompilerOptionsForTelemetry(), convertToOptionsWithAbsolutePaths(), convertToOptionValueWithAbsolutePaths(), createOptionNameMap(), createUnknownOptionError(), getBuildOptionsNameMap(), getOptionDeclarationFromName(), getOptionFromName() (+18 more)

### Community 438 - "AccountCapability"
Cohesion: 0.16
Nodes (15): AccountCapability, CapabilitySource, default_caption_limit(), Into, Result, Self, runtime_limit_uses_max_parts_and_selected_part_size(), validate_part_size() (+7 more)

### Community 439 - "transformNodes"
Cohesion: 0.15
Nodes (6): createEmitHelperFactory(), CoreTransformationContext, TransformationContext, TransformationResult, transformNodes(), transformNodes()

### Community 440 - "Statement"
Cohesion: 0.08
Nodes (25): Block, BreakStatement, ContinueStatement, DebuggerStatement, DoStatement, EmptyStatement, ExpressionStatement, ForInStatement (+17 more)

### Community 441 - "ReadonlyESMap"
Cohesion: 0.09
Nodes (10): Collection, ESMap, Map, ReadonlyCollection, ReadonlyESMap, ReadonlyMap, ReadonlySet, ReadonlyUnderscoreEscapedMap (+2 more)

### Community 442 - "hasSyntacticModifier"
Cohesion: 0.10
Nodes (25): eachExportReference(), getContextNodeForNodeEntry(), getDocumentHighlights(), getResolutionModeOverrideForClause(), getSyntacticDocumentHighlights(), hasAmbientModifier(), hasPossibleExternalModuleReference(), hasScopeMarker() (+17 more)

### Community 443 - "visitNode"
Cohesion: 0.11
Nodes (25): forEachChildInBlock(), forEachChildInCallOrConstructSignature(), forEachChildInCallOrNewExpression(), forEachChildInClassDeclarationOrExpression(), forEachChildInContinueOrBreakStatement(), forEachChildInImportOrExportSpecifier(), forEachChildInJSDocLinkCodeOrPlain(), forEachChildInJSDocParameterOrPropertyTag() (+17 more)

### Community 444 - "getCompletionEntryCodeActionsAndSourceDisplay"
Cohesion: 0.12
Nodes (25): arrayIterator(), codeActionForFix(), codeFixActionToCodeAction(), flatMapIterator(), getCompletionEntryCodeActionsAndSourceDisplay(), getFixesInfoForNonUMDImport(), getFixesInfoForUMDImport(), getFixInfos() (+17 more)

### Community 445 - "createPrinter"
Cohesion: 0.14
Nodes (25): createJSSignatureHelpItems(), createPrinter(), createSignatureHelpItems(), createSignatureHelpParameterForParameter(), createSignatureHelpParameterForTypeParameter(), createSnippetPrinter(), createTypeHelpItems(), getEnclosingDeclarationFromInvocation() (+17 more)

### Community 446 - "isStringOrNumericLiteralLike"
Cohesion: 0.10
Nodes (25): escapeLeadingUnderscores(), getAllAccessorDeclarations(), getEscapedTextOfIdentifierOrLiteral(), getModuleName(), getNameTable(), getPropertyNameForPropertyNameNode(), hasDynamicName(), hasNavigationBarName() (+17 more)

### Community 447 - "getAssignmentDeclarationKindWorker"
Cohesion: 0.15
Nodes (25): getAssignedExpandoInitializer(), getAssignmentDeclarationKindWorker(), getAssignmentDeclarationPropertyAccessKind(), getDeclaredExpandoInitializer(), getDefaultedExpandoInitializer(), getElementOrPropertyAccessName(), getEntityNameFromTypeNode(), getExpandoInitializer() (+17 more)

### Community 448 - "album.rs"
Cohesion: 0.21
Nodes (21): AlbumCompatibilityKey, AlbumFailurePolicy, AlbumPackingPolicy, AlbumPlan, AlbumPlanOptions, build_album_plan(), contexts_are_never_mixed(), eleven_rebalances_to_nine_plus_two() (+13 more)

### Community 449 - "TopicMediaService"
Cohesion: 0.12
Nodes (16): Arc, HashMap, Mutex, Self, ScopedCancellationManager, AppHandle, Arc, AtomicU64 (+8 more)

### Community 450 - "patchNodeFactory"
Cohesion: 0.09
Nodes (24): buildOverload(), createDeprecation(), createErrorDeprecation(), createWarningDeprecation(), deprecate(), error(), formatDeprecationMessage(), getTypeScriptVersion() (+16 more)

### Community 451 - ".getSourceFile"
Cohesion: 0.14
Nodes (23): definitionToReferencedSymbolDefinitionInfo(), entryToDocumentSpan(), findReferenceInPosition(), getDefinitionKindAndDisplayParts(), getFileAndTextSpanFromNode(), getReferenceAtPosition(), getReferencedSymbolsForModule(), getReferencedSymbolsForModuleIfDeclaredBySourceFile() (+15 more)

### Community 452 - "convertEntryToCallSite"
Cohesion: 0.14
Nodes (24): addConstructorReferences(), climbPastPropertyAccess(), climbPastPropertyOrElementAccess(), convertEntryToCallSite(), createTextRangeFromNode(), findInheritedConstructorReferences(), findOwnConstructorReferences(), findSuperConstructorAccesses() (+16 more)

### Community 453 - "isVariableDeclaration"
Cohesion: 0.11
Nodes (24): addUndefinedToOptionalProperty(), canBeConvertedToClass(), canDeleteEntireVariableStatement(), createForOfBindingStatement(), getContainingVariableDeclarationIfInList(), getEffectiveContainerForJSDocTemplateTag(), getFunctionReferences(), getHostSignatureFromJSDoc() (+16 more)

### Community 454 - "caption.rs"
Cohesion: 0.16
Nodes (19): AlbumCaptionAssignment, apply_album_caption_policy(), CaptionDetailMode, CaptionOverflowPolicy, CaptionTemplateContext, empty_summary_preserves_per_item_captions(), fail_policy_is_explicit(), item() (+11 more)

### Community 455 - "4.10.3050.1/manifest.json"
Cohesion: 0.09
Nodes (22): cbcs, cenc, x64, x86_64, x86_64h, accept_arch, description, icons (+14 more)

### Community 456 - "p"
Cohesion: 0.10
Nodes (23): arrayElementCouldBeVariableDeclaration(), findJsonProperty(), forEachNameInAccessChainWalkingLeft(), getEffectiveJSDocHost(), getJSDocHost(), getJSDocRoot(), getNestedModuleDeclaration(), getNextJSDocCommentLocation() (+15 more)

### Community 457 - "createGetSymbolAccessibilityDiagnosticForNode"
Cohesion: 0.16
Nodes (17): canProduceDiagnostics(), createGetSymbolAccessibilityDiagnosticForNode(), createGetSymbolAccessibilityDiagnosticForNodeName(), isCallSignatureDeclaration(), isConstructSignatureDeclaration(), isExpressionWithTypeArguments(), isGetAccessor(), isImportEqualsDeclaration() (+9 more)

### Community 458 - "MemberExpression"
Cohesion: 0.09
Nodes (23): CallChain, CallExpression, ElementAccessChain, ElementAccessExpression, ExpressionWithTypeArguments, ImportCall, ImportTypeNode, JsxTagNamePropertyAccess (+15 more)

### Community 459 - "getAdjustedLocation"
Cohesion: 0.11
Nodes (23): entryToImportOrExport(), getAdjustedLocation(), getAdjustedLocationForExportDeclaration(), getAdjustedLocationForHeritageClause(), getAdjustedLocationForImportDeclaration(), getCategorizedImports(), hasModuleDeclarationMatchingSpecifier(), inImportClause() (+15 more)

### Community 460 - "getAssignmentDeclarationKindWorker"
Cohesion: 0.17
Nodes (23): getAssignedExpandoInitializer(), getAssignmentDeclarationKindWorker(), getAssignmentDeclarationPropertyAccessKind(), getDeclaredExpandoInitializer(), getDefaultedExpandoInitializer(), getEffectiveInitializer(), getElementOrPropertyAccessName(), getEntityNameFromTypeNode() (+15 more)

### Community 461 - "getReferencesAtLocation"
Cohesion: 0.18
Nodes (18): addClassStaticThisReferences(), addReference(), getImportOrExportReferences(), getReferencedSymbolsForSymbol(), getReferenceForShorthandProperty(), getReferencesAtExportSpecifier(), getReferencesAtLocation(), getReferencesInContainer() (+10 more)

### Community 462 - "isBindingElement"
Cohesion: 0.12
Nodes (22): classifySymbol(), filterBindingName(), filterImport(), filterNamedBindings(), getCombinedFlags(), getDeclarationForBindingElement(), getExportNode(), getNamespaceLikeImport() (+14 more)

### Community 463 - "TypeObject"
Cohesion: 0.11
Nodes (10): createTypeParameterName(), createTypeParametersForArguments(), getArgumentTypesAndTypeParameters(), getParentSymbolsOfPropertyAccess(), isAnonymousObjectConstraintType(), isThisTypeParameter(), reclassifyByType(), skipConstraint() (+2 more)

### Community 464 - "MTProtoRangeReader"
Cohesion: 0.13
Nodes (15): AtomicUsize, MTProtoRangeReader, Bytes, Client, InputFileLocation, Option, Result, Self (+7 more)

### Community 465 - "MediaAnalysis"
Cohesion: 0.19
Nodes (13): analysis(), analysis_cache_key(), analyze_media(), analyze_media_uncached(), ffprobe_path(), MediaAnalysis, ProbeFormat, ProbeRoot (+5 more)

### Community 466 - "isConstructorDeclaration"
Cohesion: 0.15
Nodes (22): collectElements(), deduplicateRelational(), findAllInitialDeclarations(), findImplementation(), findImplementationOrAllInitialDeclarations(), getDiagnostic(), getFirstConstructorWithBody(), getSymbolOfCallHierarchyDeclaration() (+14 more)

### Community 467 - "getNodeKind"
Cohesion: 0.11
Nodes (22): assertType(), convertToPrimaryNavBarMenuItem(), convertToTree(), createQueue(), getImplementationsAtPosition(), getNavigationBarItems(), getNavigationTree(), getNodeKind() (+14 more)

### Community 468 - "getSymbolDisplayPartsDocumentationAndSymbolKind"
Cohesion: 0.14
Nodes (20): chooseBetterSymbol(), containsOnlyAmbientModules(), getCombinedLocalAndExportSymbolFlags(), getConstantValue(), getDeclarationOfKind(), getExternalModuleImportEqualsDeclarationExpression(), getImmediatelyContainingArgumentOrContextualParameterInfo(), getSymbolDisplayPartsDocumentationAndSymbolKind() (+12 more)

### Community 469 - "getEmitModuleResolutionKind"
Cohesion: 0.11
Nodes (22): deduplicate(), discoverTypings(), getAllModulePaths(), getAllowedEndings(), getEmitModuleResolutionKind(), getImpliedNodeFormatForFile(), getImpliedNodeFormatForFileWorker(), getModuleResolutionHost() (+14 more)

### Community 470 - "mapDefined"
Cohesion: 0.18
Nodes (22): getAllReferencesForImportMeta(), getAllReferencesForKeyword(), getLabelReferencesInNode(), getPossibleSymbolReferenceNodes(), getPossibleSymbolReferencePositions(), getReferencedSymbolsSpecial(), getReferencesForStringLiteral(), getReferencesForSuperKeyword() (+14 more)

### Community 471 - "getFirstJSDocTag"
Cohesion: 0.12
Nodes (22): getEffectiveModifierFlagsAlwaysIncludeJSDoc(), getEffectiveModifierFlagsNoCache(), getFirstJSDocTag(), getJSDocAugmentsTag(), getJSDocClassTag(), getJSDocDeprecatedTag(), getJSDocDeprecatedTagNoCache(), getJSDocModifierFlagsNoCache() (+14 more)

### Community 472 - "babylon.js"
Cohesion: 0.16
Nodes (18): DriveExplorer(), C(), D(), ee(), F(), Ge(), I(), j() (+10 more)

### Community 473 - "addChildrenRecursively"
Cohesion: 0.17
Nodes (21): addChildrenRecursively(), addLeafNode(), addNodeWithRecursiveChild(), addNodeWithRecursiveInitializer(), addTrackedEs5Class(), emptyNavigationBarNode(), endNestedNodes(), endNode() (+13 more)

### Community 474 - "isArrowFunction"
Cohesion: 0.17
Nodes (21): chooseBetterSymbol(), containingThis(), createSignatureDeclarationFromSignature(), forEachAncestor(), getCommentOwnerInfo(), getCommentOwnerInfoWorker(), getFunctionInfo(), getRefactorActionsToConvertFunctionExpressions() (+13 more)

### Community 475 - "BuildInvalidedProject"
Cohesion: 0.10
Nodes (4): BuildInvalidedProject, InvalidatedProjectBase, UpdateBundleProject, UpdateOutputFileStampsProject

### Community 476 - "isCallExpression"
Cohesion: 0.11
Nodes (21): hasPropertyAccessExpressionWithName(), hasSupportedNumberOfArguments(), isCallbackLike(), isCallChain(), isCallExpression(), isExpressionInCallExpression(), isExpressionNode(), isFixablePromiseHandler() (+13 more)

### Community 477 - "makeChange"
Cohesion: 0.10
Nodes (21): applyChange(), expressionResultIsUnused(), getEffectiveTypeArguments(), getExpressionFromParenthesesOrExpression(), getJSDocTypeTag(), getLeftmostExpression(), isCommaListExpression(), isForInOrOfStatement() (+13 more)

### Community 478 - "transformCallbackArgument"
Cohesion: 0.20
Nodes (21): canBeConvertedToExpression(), createSynthIdentifier(), createUniqueSynthName(), createVariableOrAssignmentOrExpressionStatement(), declareSynthBindingName(), declareSynthBindingPattern(), declareSynthIdentifier(), finishCatchOrFinallyTransform() (+13 more)

### Community 479 - "createGetSymbolAccessibilityDiagnosticForNode"
Cohesion: 0.20
Nodes (20): canProduceDiagnostics(), createGetSymbolAccessibilityDiagnosticForNode(), createGetSymbolAccessibilityDiagnosticForNodeName(), findImplementation(), isCallSignatureDeclaration(), isConstructorDeclaration(), isConstructSignatureDeclaration(), isExpressionWithTypeArguments() (+12 more)

### Community 480 - "resolveTypeReferenceDirective"
Cohesion: 0.14
Nodes (21): classicNameResolver(), createResolvedModuleWithFailedLookupLocations(), diag(), getDefaultNodeResolutionFeatures(), getEntrypointsFromPackageJsonInfo(), getExtendsConfigPath(), getTemporaryModuleResolutionState(), isTraceEnabled() (+13 more)

### Community 481 - "idText"
Cohesion: 0.16
Nodes (21): collectExportedVariableInfo(), collectExternalModuleInfo(), containsDefaultReference(), createExpressionForJsxFragment(), createJsxFactoryExpression(), createJsxFactoryExpressionFromEntityName(), createJsxFragmentFactoryExpression(), createReactNamespace() (+13 more)

### Community 482 - "getDefinitionAtPosition"
Cohesion: 0.14
Nodes (20): createDefinitionFromSignatureDeclaration(), createDefinitionInfo(), definitionFromType(), flatMap(), getAncestorCallLikeExpression(), getDefinitionAtPosition(), getDefinitionFromObjectLiteralElement(), getDefinitionFromSymbol() (+12 more)

### Community 483 - "isValidCallHierarchyDeclaration"
Cohesion: 0.14
Nodes (21): findImplementationOrAllInitialDeclarations(), getCombinedNodeFlagsAlwaysIncludeJSDoc(), getNodeModifiers(), getNormalizedSymbolModifiers(), getStaticPropertiesAndClassStaticBlock(), hasNameOrDefault(), isClassDeclaration(), isClassExpression() (+13 more)

### Community 484 - "getDocumentationComment"
Cohesion: 0.13
Nodes (15): forEachUnique(), getAllJSDocTagsOfKind(), getCommentDisplayParts(), getDisplayPartsFromComment(), getDocumentationComment(), getJsDocCommentsFromDeclarations(), getJSDocTags(), getJsDocTagsFromDeclarations() (+7 more)

### Community 485 - "batch_optimizer.rs"
Cohesion: 0.16
Nodes (12): ActionCategory, BatchItemPlan, BatchPlan, plan_batch_execution(), PathBuf, Vec, classify_user_intent(), Option (+4 more)

### Community 486 - "getHighlightSpans"
Cohesion: 0.19
Nodes (19): aggregateAllBreakAndContinueStatements(), getAsyncAndAwaitOccurrences(), getBreakOrContinueOwner(), getBreakOrContinueStatementOccurrences(), getContainingFunction(), getHighlightSpans(), getIfElseKeywords(), getLoopBreakContinueOccurrences() (+11 more)

### Community 487 - "getRangeToExtract"
Cohesion: 0.14
Nodes (19): chainDiagnosticMessages(), collectTypeParameters(), createCodeFixActionMaybeFixAll(), createDiagnosticForNodeArray(), createFileDiagnostic(), createTextRangeFromSpan(), diagnosticToString(), formatMessage() (+11 more)

### Community 488 - ".delete"
Cohesion: 0.12
Nodes (17): cleanExtendedConfigCache(), clearMarks(), clearMeasures(), createSet(), deleteDestructuringElements(), deleteEntireVariableStatement(), deleteFromMultimap(), deleteTypeParameters() (+9 more)

### Community 489 - "computeSuggestionDiagnostics"
Cohesion: 0.13
Nodes (20): computeSuggestionDiagnostics(), findModuleReferences(), findNamespaceReExports(), fixImportOfModuleExports(), forEachImport(), forEachPossibleImportOrExportStatement(), getContainingModuleSymbol(), getContextualKeywords() (+12 more)

### Community 490 - "JSDocTag"
Cohesion: 0.10
Nodes (20): JSDocAugmentsTag, JSDocAuthorTag, JSDocClassTag, JSDocDeprecatedTag, JSDocImplementsTag, JSDocOverrideTag, JSDocParameterTag, JSDocPrivateTag (+12 more)

### Community 491 - "getHighlightSpans"
Cohesion: 0.19
Nodes (19): aggregateAllBreakAndContinueStatements(), getAsyncAndAwaitOccurrences(), getBreakOrContinueOwner(), getBreakOrContinueStatementOccurrences(), getContainingFunction(), getDiagnostic(), getHighlightSpans(), getIfElseKeywords() (+11 more)

### Community 492 - "toPath"
Cohesion: 0.16
Nodes (20): canJsonReportNoInputFiles(), checkConfigFileUpToDateStatus(), convertToDiagnosticRelatedInformation(), convertToDiagnostics(), createFsWatchCallbackForFileWatcherCallback(), getBestFix(), getBuildInfoCacheEntry(), getCurrentTime() (+12 more)

### Community 493 - "getNewImportFixes"
Cohesion: 0.13
Nodes (20): createExistingImportMap(), createGetChecker(), createImportSpecifierResolver(), createPackageJsonImportFilter(), getAddAsTypeOnly(), getAllExportInfoForSymbol(), getFixesForAddImport(), getImportFixes() (+12 more)

### Community 494 - "fail"
Cohesion: 0.12
Nodes (19): addPragmaForMatch(), base64FormatEncode(), deduplicateSorted(), extensionFromPath(), extensionIsOk(), fail(), findMap(), getCategoryFormat() (+11 more)

### Community 495 - "addRange"
Cohesion: 0.12
Nodes (19): addRange(), elementAt(), getDeclarationTransformers(), getExplicitPromisedTypeOfPromiseReturningCallExpression(), getJSXTransformEnabled(), getModuleTransformer(), getScriptTransformers(), getTransformers() (+11 more)

### Community 496 - "isWhiteSpaceLike"
Cohesion: 0.11
Nodes (19): calculateIndent(), createSingleLineStringWriter(), createTextWriter(), getDisplayPartWriter(), getFirstNonSpaceCharacterPosition(), getIndentSize(), getIndentString(), getLinesBetweenPositionAndNextNonWhitespaceCharacter() (+11 more)

### Community 497 - "isBlock"
Cohesion: 0.12
Nodes (19): getConvertibleArrowFunctionAtPosition(), getRefactorActionsToRemoveFunctionBraces(), insertLeadingStatement(), isAsyncFunction(), isBlock(), isConciseBody(), isConvertibleFunction(), isExpression() (+11 more)

### Community 498 - "addChildrenRecursively"
Cohesion: 0.19
Nodes (19): addChildrenRecursively(), addLeafNode(), addNodeWithRecursiveChild(), addNodeWithRecursiveInitializer(), addTrackedEs5Class(), emptyNavigationBarNode(), endNestedNodes(), endNode() (+11 more)

### Community 499 - "isAssignmentExpression"
Cohesion: 0.13
Nodes (19): arrayElementCouldBeVariableDeclaration(), forEachNameInAccessChainWalkingLeft(), getEffectiveJSDocHost(), getNestedModuleDeclaration(), getNextJSDocCommentLocation(), getRightMostAssignedExpression(), getSingleInitializerOfVariableStatementOrPropertyDeclaration(), getSingleVariableOfVariableStatement() (+11 more)

### Community 500 - "assertIsDefined"
Cohesion: 0.16
Nodes (17): assertEqual(), assertIsDefined(), checkCircularity(), createSourceMapGenerator(), createTimer(), createTimerIf(), DebugTypeMapper(), enter() (+9 more)

### Community 501 - "displayPart"
Cohesion: 0.11
Nodes (19): buildLinkParts(), createCompletionDetails(), createCompletionDetailsForSymbol(), createSimpleDetails(), displayPart(), findLinkNameEnd(), isJSDocLink(), isJSDocLinkCode() (+11 more)

### Community 502 - "isExpressionNode"
Cohesion: 0.13
Nodes (19): createExpressionFromEntityName(), entryToType(), getMeaningFromRightHandSideOfImportEquals(), isExpressionInCallExpression(), isExpressionNode(), isExpressionWithTypeArgumentsInClassExtendsClause(), isHeritageClause(), isInExpressionContext() (+11 more)

### Community 503 - "resolve_thumbnail_strategy"
Cohesion: 0.15
Nodes (14): ThumbnailSource, ThumbnailStatus, get_smart_icon_name(), Option, get_format_capability(), PreviewCapability, Option, get_mode_profile() (+6 more)

### Community 504 - "getNodeKind"
Cohesion: 0.14
Nodes (18): assertType(), convertToPrimaryNavBarMenuItem(), convertToTree(), getNavigationBarItems(), getNavigationTree(), getNodeKind(), getNodeSpan(), getRootDeclaration() (+10 more)

### Community 505 - "getMeaningFromLocation"
Cohesion: 0.12
Nodes (18): canCompleteFromNamedBindings(), getAdjustedNode(), getAdjustedReferenceLocation(), getAdjustedRenameLocation(), getImportMetaIfNecessary(), getIntersectingMeaningFromDeclarations(), getMeaningFromDeclaration(), getMeaningFromLocation() (+10 more)

### Community 506 - "every"
Cohesion: 0.13
Nodes (18): canDeleteEntireVariableStatement(), createForOfBindingStatement(), createNewParameters(), deleteUnusedImports(), deleteUnusedImportsInDeclaration(), deleteUnusedImportsInVariableDeclaration(), every(), expressionCouldBeVariableDeclaration() (+10 more)

### Community 507 - "getSourceFileOfNode"
Cohesion: 0.14
Nodes (18): concatConsecutiveString(), copyExpressionComments(), createDiagnosticForNode(), declarationNameToString(), escapeRawStringForTemplate(), findScope(), getExpressionFromParenthesesOrExpression(), getNameFromIndexInfo() (+10 more)

### Community 508 - "createCompletionEntry"
Cohesion: 0.18
Nodes (18): createCompletionEntry(), escapeSnippetText(), getInsertTextAndReplacementSpanForImportCompletion(), getSourceFromOrigin(), isQuoteOrBacktick(), isRecommendedCompletionMatch(), originIncludesSymbolName(), originIsExport() (+10 more)

### Community 509 - "isQualifiedName"
Cohesion: 0.16
Nodes (18): createExpressionForJsxElement(), createExpressionForJsxFragment(), createExpressionFromEntityName(), createJsxFactoryExpression(), createJsxFactoryExpressionFromEntityName(), createJsxFragmentFactoryExpression(), createReactNamespace(), getMeaningFromRightHandSideOfImportEquals() (+10 more)

### Community 510 - "getEmitModuleKind"
Cohesion: 0.20
Nodes (18): createExternalHelpersImportDeclarationIfNeeded(), getAllowSyntheticDefaultImports(), getEmitHelpers(), getEmitModuleKind(), getESModuleInterop(), getExportEqualsImportKind(), getExternalHelpersModuleName(), getImportKind() (+10 more)

### Community 511 - "BuilderProgram"
Cohesion: 0.11
Nodes (3): BuilderProgram, EmitAndSemanticDiagnosticsBuilderProgram, SemanticDiagnosticsBuilderProgram

### Community 512 - "find"
Cohesion: 0.18
Nodes (18): find(), findEnclosingNode(), getAdjustedLocationForClass(), getAdjustedLocationForDeclaration(), getAdjustedLocationForFunction(), getCallHierarchyDeclarationReferenceNode(), getCallHierarchyItemName(), getEffectiveContainerForJSDocTemplateTag() (+10 more)

### Community 513 - "isPropertyAssignment"
Cohesion: 0.13
Nodes (18): getPrefixAndSuffixText(), getSourceTarget(), isArrayBindingPattern(), isExportSpecifier(), isFirstDeclarationOfSymbolParameter(), isIdentifierInNonEmittingHeritageClause(), isObjectBindingElementWithoutPropertyName(), isObjectBindingPattern() (+10 more)

### Community 514 - "isExpressionStatement"
Cohesion: 0.13
Nodes (16): addExportToChanges(), addMissingDeclarations(), and(), checkFixedAssignableTo(), createExportAssignment(), createObjectTypeFromLabeledExpression(), createSymbolTable(), findSuperStatementIndex() (+8 more)

### Community 515 - "isFunctionLike"
Cohesion: 0.13
Nodes (18): aggregateOwnedThrowStatements(), getContainingClassStaticBlock(), getLabelCompletionAtPosition(), getLabelStatementCompletions(), getThrowOccurrences(), getThrowStatementOwner(), getTypeArgumentOrTypeParameterList(), getTypeParameterOwner() (+10 more)

### Community 516 - "getEffectiveTypeParameterDeclarations"
Cohesion: 0.12
Nodes (18): canHaveIllegalTypeParameters(), getEffectiveConstraintOfTypeParameter(), getEffectiveReturnTypeNode(), getEffectiveTypeParameterDeclarations(), getJSDocReturnTag(), getJSDocReturnType(), getJSDocTypeParameterDeclarations(), getReturnType() (+10 more)

### Community 517 - "2. 16 Detail Mikro Teknis & Trik Arsitektur Berdampak Besar (Micro-Technical Nuances & High-Impact Details)"
Cohesion: 0.12
Nodes (17): 10. Bounded MPSC Channel (`mpsc::channel(24)`), 11. Dynamic Loopback Port Binding (`tiny_http` pada `127.0.0.1:0`), 12. Tail `moov` Relocation & Async Tail-Fetch (`need_async_moov_tail`), 13. `StreamEntry` LIVE RwLock Map & Range Merge State Machine, 14. `DemandRangeReader` & 16 MB HTTP Response Cap, 15. 3-Layer Seek Fix (v2.7.2), 16. Sparse ZIP Central Directory Read, 1. 512 KB MTProto Boundary Alignment (`offset - (offset % 512KB)`) (+9 more)

### Community 518 - "doc_preview.rs"
Cohesion: 0.24
Nodes (15): bounded_text_sample_is_unicode_safe_and_marks_partial_content(), ext_of(), extract_office_zip(), extract_rtf_plain(), guess_mime(), is_text_ext(), LocalDocPreview, looks_binary() (+7 more)

### Community 519 - "assertNever"
Cohesion: 0.15
Nodes (16): addImportType(), addNamespaceQualifier(), assertNever(), codeActionForFixWorker(), DebugTypeMapper(), getImportTypePrefix(), getNamespaceLikeImportText(), getPrefixFromLexState() (+8 more)

### Community 520 - "getNextInvalidatedProjectCreateInfo"
Cohesion: 0.16
Nodes (17): afterProgramDone(), buildErrors(), createInvalidatedProjectWithInfo(), createUpdateOutputFileStampsProject(), doneInvalidatedProject(), getNextInvalidatedProjectCreateInfo(), isBuilderProgram(), listFiles() (+9 more)

### Community 521 - "formatSyntaxKind"
Cohesion: 0.17
Nodes (17): assertMissingNode(), assertNode(), assertNotNode(), assertOptionalNode(), assertOptionalToken(), createTextRangeWithKind(), formatSymbol(), formatSyntaxKind() (+9 more)

### Community 522 - "getSymbolScope"
Cohesion: 0.12
Nodes (17): canHaveLiteralInitializer(), createNavigateToItem(), getAncestor(), getContainerNode(), getSelectedEffectiveModifierFlags(), getSymbolScope(), hasAccessorModifier(), hasEffectiveModifier() (+9 more)

### Community 523 - "convertEntryToCallSite"
Cohesion: 0.18
Nodes (17): climbPastPropertyAccess(), climbPastPropertyOrElementAccess(), convertEntryToCallSite(), isArgumentExpressionOfElementAccess(), isCalleeWorker(), isCallExpressionTarget(), isCallOrNewExpressionTarget(), isDecoratorTarget() (+9 more)

### Community 524 - "idText"
Cohesion: 0.19
Nodes (17): collectExportedVariableInfo(), collectExternalModuleInfo(), containsDefaultReference(), formatIdentifierWorker(), getExportNeedsImportStarHelper(), getImportNeedsImportDefaultHelper(), getImportNeedsImportStarHelper(), getLocalNameForExternalImport() (+9 more)

### Community 525 - "isRequireCall"
Cohesion: 0.22
Nodes (17): collectExportRenames(), convertedImports(), convertFileToEsModule(), convertPropertyAccessImport(), convertSingleIdentifierImport(), convertSingleImport(), convertStatement(), convertVariableStatement() (+9 more)

### Community 526 - "getDefinitionAtPosition"
Cohesion: 0.16
Nodes (17): createDefinitionFromSignatureDeclaration(), createDefinitionInfo(), createDefinitionInfoFromName(), definitionFromType(), getAncestorCallLikeExpression(), getDefinitionAtPosition(), getDefinitionFromSymbol(), getDefinitionInfoForIndexSignatures() (+9 more)

### Community 527 - "getTypescriptKeywordCompletions"
Cohesion: 0.15
Nodes (17): getKeywordCompletions(), getPotentiallyInvalidImportSpecifier(), getTypescriptKeywordCompletions(), isClassMemberCompletionKeyword(), isClassMemberModifier(), isContextualKeyword(), isFunctionLikeBodyKeyword(), isIdentifierANonContextualKeyword() (+9 more)

### Community 529 - "pop"
Cohesion: 0.18
Nodes (17): canWatchDirectoryOrFile(), comparePathsCaseInsensitive(), comparePathsCaseSensitive(), comparePathsWorker(), computeCommonSourceDirectoryOfFilenames(), getNormalizedPathComponents(), getPackageScopeForPath(), getPathComponents() (+9 more)

### Community 530 - "getLocaleSpecificMessage"
Cohesion: 0.15
Nodes (17): chainDiagnosticMessages(), createAction(), createCodeFixActionMaybeFixAll(), createCodeFixActionWithoutFixAll(), createCodeFixActionWorker(), createDiagnosticForNodeArray(), createFileDiagnostic(), diagnosticToString() (+9 more)

### Community 531 - "isImportSpecifier"
Cohesion: 0.13
Nodes (17): couldBeTypeOnlyImportSpecifier(), entryToImportOrExport(), extractSingleNode(), getAdjustedLocationForImportDeclaration(), getCategorizedImports(), getPackagePathComponents(), getRestParameterElementType(), getTypeKeywordOfTypeOnlyImport() (+9 more)

### Community 532 - "getContextualType"
Cohesion: 0.17
Nodes (17): forEachRelatedSymbol(), getCheckFlags(), getContainingObjectLiteralElement(), getContextualType(), getContextualTypeFromParent(), getDeclarationModifierFlagsFromSymbol(), getPropertySymbolsFromContextualType(), getRelatedSymbol() (+9 more)

### Community 533 - "getAdjustedLocation"
Cohesion: 0.13
Nodes (17): getAdjustedLocation(), getAdjustedLocationForExportDeclaration(), getAdjustedLocationForHeritageClause(), getAdjustedNode(), getAdjustedReferenceLocation(), getAdjustedRenameLocation(), isArrayTypeNode(), isAsExpression() (+9 more)

### Community 535 - "EncoderQualityProfile"
Cohesion: 0.16
Nodes (8): Result, transcode_with_profile(), HardwareEncoderType, HardwareProfileInfo, select_best_hardware_profile(), EncoderQualityProfile, Default, Self

### Community 536 - "build_quality_preflight"
Cohesion: 0.29
Nodes (15): build_quality_preflight(), fail_policy_blocks_over_limit_caption_before_queueing(), is_remote(), original_never_proposes_a_transform(), preflight_explains_album_caption_assignment_and_runtime_truncation(), QualityPreflightItem, QualityPreflightReport, QualityPreflightRequest (+7 more)

### Community 537 - "SmartScanner"
Cohesion: 0.17
Nodes (8): HashMap, Into, Option, Result, Self, Vec, ScanStats, SmartScanner

### Community 538 - "get_cached_page"
Cohesion: 0.17
Nodes (14): list_media_legacy_facade(), Option, TopicMediaItem, Vec, get_cached_page(), mark_topic_media_deleted(), now_unix(), Option (+6 more)

### Community 539 - "assertIsDefined"
Cohesion: 0.20
Nodes (16): assertEqual(), assertIsDefined(), checkCircularity(), createSourceMapGenerator(), createTimer(), createTimerIf(), enter(), exit() (+8 more)

### Community 540 - "length"
Cohesion: 0.15
Nodes (16): documentSpansEqual(), filterSameAsDefaultInclude(), getAwaitErrorSpanExpression(), getCombinedNodeFlagsAlwaysIncludeJSDoc(), getConvertableOverloadListAtPosition(), getIsMatchingAsyncError(), getNodeModifiers(), getNormalizedSymbolModifiers() (+8 more)

### Community 541 - ".test"
Cohesion: 0.21
Nodes (14): assertEachNode(), assertMissingNode(), assertNode(), assertNotNode(), assertOptionalNode(), assertOptionalToken(), createTextRangeWithKind(), formatSyntaxKind() (+6 more)

### Community 542 - "compareValues"
Cohesion: 0.17
Nodes (15): compareComparableValues(), compareDiagnostics(), compareDiagnosticsSkipRelatedInformation(), compareEmitHelpers(), compareGeneratedPositions(), compareMessageText(), comparePrereleaseIdentifiers(), compareProperties() (+7 more)

### Community 543 - "isExpression"
Cohesion: 0.14
Nodes (16): getPropertiesToAdd(), getSourceTarget(), isConciseBody(), isExpression(), isExpressionKind(), isLeftHandSideExpression(), isLeftHandSideExpressionKind(), isPromiseTypedExpression() (+8 more)

### Community 544 - "AutoGram Master Architecture, WorkTree & Operational Workflow Specification"
Cohesion: 0.13
Nodes (14): 11. Internasionalisasi (i18n) — 100% Zero Hardcoded Strings, 12. Keamanan System & Management Kredensial, 13. Rate Limit, FloodWait, & Konfigurasi Jaringan, 14. Matriks Hubungan & Panggilan Inter-Module (Call Graph Matrix), 15. Matriks Status Fitur (Feature Matrix v2.8.7), 16. Standar Governance Agent & Ekosistem Skill Pack, 1. Pendahuluan & Filosofi Arsitektur Utama (Core Technical Philosophy), 5 Pilar Utama Arsitektur Teknis v2.8.7: (+6 more)

### Community 545 - "encoder_provider.rs"
Cohesion: 0.19
Nodes (10): DesktopEncoderProvider, EncoderError, EncoderProvider, HardwareCapability, Display, Error, Formatter, Result (+2 more)

### Community 546 - "DesktopResourceProvider"
Cohesion: 0.17
Nodes (7): DesktopResourceProvider, DeviceThermalState, ResourceProvider, Option, Self, Send, Sync

### Community 547 - "UploadResumeState"
Cohesion: 0.19
Nodes (8): calculate_chunk_allocation(), ChunkAllocation, Into, Self, Vec, UploadResumeState, ChunkedUploader, Self

### Community 548 - "renameCollidingVarNames"
Cohesion: 0.22
Nodes (15): classExpressionToDeclaration(), convertExportsDotXEquals_replaceNode(), functionExpressionToDeclaration(), getLastCallSignature(), getNewNameIfConflict(), getPossiblyAwaitedRightHandSide(), getSynthesizedDeepClone(), getSynthesizedDeepClones() (+7 more)

### Community 549 - "getInfo"
Cohesion: 0.17
Nodes (15): convertSemanticMeaningToSymbolFlags(), getExpression(), getInfo(), getRefactorActionsToConvertToOptionalChain(), getRefactorActionsToInferReturnType(), getSuggestion(), getValidParentNodeContainingSpan(), getValidParentNodeOfEmptySpan() (+7 more)

### Community 550 - "createPrinter"
Cohesion: 0.20
Nodes (11): createPrinter(), createSnippetPrinter(), createWriter(), Printer, getEntryForMemberCompletion(), getEntryForObjectLiteralMethodCompletion(), getNewLineKind(), getNonformattedText() (+3 more)

### Community 551 - "isFixablePromiseHandler"
Cohesion: 0.15
Nodes (15): addConvertToAsyncFunctionDiagnostics(), createDiagnosticForNode(), forEachReturnStatement(), getFunctionFlags(), getKeyFromNode(), getReturnStatementsWithPromiseHandlers(), hasReturnStatementWithPromiseHandler(), hasSupportedNumberOfArguments() (+7 more)

### Community 552 - ".getLineStarts"
Cohesion: 0.18
Nodes (10): arraysEqual(), computeLineAndCharacterOfPosition(), computeLineStarts(), computePositionOfLineAndCharacter(), createSourceFileLike(), getLineAndCharacterOfPosition(), getLineStarts(), getPositionOfLineAndCharacter() (+2 more)

### Community 553 - "clear"
Cohesion: 0.24
Nodes (14): clear(), clearMap(), clearMarks(), clearMeasures(), createCacheWithRedirects(), createModuleResolutionCache(), createPackageJsonInfoCache(), createPerDirectoryResolutionCache() (+6 more)

### Community 554 - "getJSDocTagsWorker"
Cohesion: 0.15
Nodes (15): filterOwnedJSDocTags(), getCommentHavingNodes(), getJSDocCommentsAndTags(), getJSDocParameterTagsNoCache(), getJSDocParameterTagsWorker(), getJSDocTagsNoCache(), getJSDocTagsWorker(), getJSDocTypeParameterTags() (+7 more)

### Community 555 - "FormattingContext"
Cohesion: 0.19
Nodes (9): FormattingContext(), isBeforeMultilineBlockContext(), isBlockContext(), isBraceWrappedContext(), isMultilineBlockContext(), isSingleLineBlockContext(), isTypeScriptDeclWithBlockContext(), nodeIsBlockContext() (+1 more)

### Community 556 - "getTypescriptKeywordCompletions"
Cohesion: 0.16
Nodes (15): getPresentModifiers(), getTypescriptKeywordCompletions(), isClassMemberCompletionKeyword(), isClassMemberModifier(), isContextualKeyword(), isDecorator(), isFunctionLikeBodyKeyword(), isIdentifierANonContextualKeyword() (+7 more)

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
Cohesion: 0.25
Nodes (10): createDescriptor(), getFileType(), getNameOfNameNode(), getNamesForFunctionLikeDeclaration(), parse(), recursivelyGetPropertyAccessName(), visitFunctionNodeImpl(), visitNodeIterative() (+2 more)

### Community 561 - ".forEachChild"
Cohesion: 0.18
Nodes (13): aggregateChildData(), convertToAsyncFunction(), findSuperCall(), gatherPossibleChildren(), getAllPromiseExpressionsToReturn(), getFirstChild(), getLastChild(), getTypeArgumentOrTypeParameterList() (+5 more)

### Community 562 - "compareValues"
Cohesion: 0.15
Nodes (12): compareChildren(), compareEmitHelpers(), compareGeneratedPositions(), compareImportKind(), comparePrereleaseIdentifiers(), compareSourcePositions(), compareTextSpans(), compareValues() (+4 more)

### Community 563 - "continuePreviousIncompleteResponse"
Cohesion: 0.15
Nodes (14): completionEntryDataIsResolved(), completionEntryDataToSymbolOriginInfo(), continuePreviousIncompleteResponse(), getAutoImportSymbolFromCompletionEntryData(), getCompletionsAtPosition(), getJSDocTagCompletions(), getJSDocTagNameCompletions(), getLocalSymbolForExportDefault() (+6 more)

### Community 564 - "setTextRange"
Cohesion: 0.29
Nodes (14): createExpressionForAccessorDeclaration(), createExpressionForMethodDeclaration(), createExpressionForObjectLiteralElementLike(), createExpressionForPropertyAssignment(), createExpressionForPropertyName(), createExpressionForShorthandPropertyAssignment(), createMemberAccessForPropertyName(), elideNodes() (+6 more)

### Community 565 - "tokenIsIdentifierOrKeyword"
Cohesion: 0.20
Nodes (14): createQualifiedName(), internPrivateIdentifier(), isImplementsClause(), nextTokenIsIdentifierOrKeyword(), nextTokenIsIdentifierOrKeywordOnSameLine(), parseAssertEntry(), parseEntityName(), parseIdentifierName() (+6 more)

### Community 566 - "fail"
Cohesion: 0.15
Nodes (14): base64FormatEncode(), deduplicateSorted(), extensionFromPath(), fail(), findMap(), getDefaultTagNameForKind(), getDefaultValueForOption(), getJSExtensionForFile() (+6 more)

### Community 567 - "getEditsForToTemplateLiteral"
Cohesion: 0.22
Nodes (14): concatConsecutiveString(), escapeRawStringForTemplate(), getEditsForToTemplateLiteral(), getNodeOrParentOfParentheses(), getParentBinaryExpression(), getRawTextOfTemplate(), getRefactorActionsToConvertToTemplateString(), getRefactorEditsToConvertToTemplateString() (+6 more)

### Community 568 - "setTextRange"
Cohesion: 0.27
Nodes (14): createExpressionForAccessorDeclaration(), createExpressionForMethodDeclaration(), createExpressionForObjectLiteralElementLike(), createExpressionForPropertyAssignment(), createExpressionForPropertyName(), createExpressionForShorthandPropertyAssignment(), createMemberAccessForPropertyName(), elideNodes() (+6 more)

### Community 569 - "sort"
Cohesion: 0.19
Nodes (14): deduplicateRelational(), findAllInitialDeclarations(), getEnumMembers(), getSymbolOfCallHierarchyDeclaration(), getTextChangesFromChanges(), indicesOf(), prepareRangeContainsErrorFunction(), rangeOverlapsWithStartEnd() (+6 more)

### Community 570 - "InFlightTracker"
Cohesion: 0.21
Nodes (9): InFlightTracker, Arc, HashMap, Mutex, Option, Result, Self, Receiver (+1 more)

### Community 571 - "message_to_topic_media_item"
Cohesion: 0.17
Nodes (11): message_to_topic_media_item(), now_unix(), Message, Option, TopicMediaContext, TopicMediaItem, map_update_message(), Message (+3 more)

### Community 572 - "createRulesMap"
Cohesion: 0.17
Nodes (13): addRule(), buildMap(), createRulesMap(), getFormatContext(), getInsertionIndex(), getRuleActionExclusion(), getRuleBucketIndex(), getRulesMap() (+5 more)

### Community 573 - "isBindingElement"
Cohesion: 0.23
Nodes (12): classifySymbol(), getCombinedFlags(), getCombinedModifierFlags(), getDeclarationForBindingElement(), getExportNode(), hasValueSideModule(), isBindingElement(), isCatchClause() (+4 more)

### Community 574 - "clear"
Cohesion: 0.28
Nodes (11): clear(), clearMap(), createCacheWithRedirects(), createModuleResolutionCache(), createPackageJsonInfoCache(), createPerDirectoryResolutionCache(), createResolutionCache(), createTypeReferenceDirectiveResolutionCache() (+3 more)

### Community 575 - "contains"
Cohesion: 0.18
Nodes (13): clearScreenIfNotWatchingForFileChanges(), codeFixAll(), contains(), createBuilderStatusReporter(), createCombinedCodeActions(), createWatchStatusReporter(), eachDiagnostic(), formatColorAndReset() (+5 more)

### Community 576 - "getEmitScriptTarget"
Cohesion: 0.18
Nodes (13): compilerOptionsIndicateEsModules(), createRuntimeTypeSerializer(), createTemplateCooked(), getCompilerOptionValue(), getDefaultLibFileName(), getEmitScriptTarget(), getStrictOptionValue(), hasInvalidEscape() (+5 more)

### Community 577 - "getDeclarationFromName"
Cohesion: 0.18
Nodes (13): findReferencedSymbols(), getDeclarationFromName(), getNameTable(), getTopMostDeclarationNamesInFile(), initializeNameTable(), isArgumentOfElementAccessExpression(), isDeclarationOfSymbol(), isDefinitionForReference() (+5 more)

### Community 578 - "createRulesMap"
Cohesion: 0.17
Nodes (13): addRule(), buildMap(), createRulesMap(), getFormatContext(), getInsertionIndex(), getRuleActionExclusion(), getRuleBucketIndex(), getRulesMap() (+5 more)

### Community 579 - "optionsHaveChanges"
Cohesion: 0.15
Nodes (13): changesAffectingProgramStructure(), changesAffectModuleResolution(), compilerOptionsAffectDeclarationPath(), compilerOptionsAffectEmit(), compilerOptionsAffectSemanticDiagnostics(), compilerOptionValueToString(), equalOwnProperties(), getCompilerOptionValue() (+5 more)

### Community 580 - "every"
Cohesion: 0.17
Nodes (13): deleteUnusedImports(), deleteUnusedImportsInDeclaration(), deleteUnusedImportsInVariableDeclaration(), every(), expressionCouldBeVariableDeclaration(), flattenTypeLiteralNodeReference(), getNameFromPropertyName(), isBindingPattern() (+5 more)

### Community 581 - "MoovSidecarManager"
Cohesion: 0.23
Nodes (7): MoovSidecarManager, Connection, Option, PathBuf, Result, Self, Vec

### Community 582 - "getSelectionChildren"
Cohesion: 0.24
Nodes (12): addSyntheticNodes(), compact(), createChildren(), createNode(), createSyntaxList(), getSelectionChildren(), groupChildren(), isImport() (+4 more)

### Community 583 - "append"
Cohesion: 0.23
Nodes (12): append(), combine(), createConstEqualsRequireDeclaration(), createUnparsedSourceFile(), getAllUnscopedEmitHelpers(), getNewImports(), getNewRequires(), makeStringLiteral() (+4 more)

### Community 584 - "createDocumentRegistryInternal"
Cohesion: 0.35
Nodes (4): createDocumentRegistry(), createDocumentRegistryInternal(), DocumentRegistry, createDocumentRegistryInternal()

### Community 585 - "getReferencedSymbolsForSymbol"
Cohesion: 0.33
Nodes (11): findInheritedConstructorReferences(), getImportOrExportReferences(), getReferencedSymbolsForSymbol(), getReferencesAtExportSpecifier(), getReferencesInContainer(), getReferencesInContainerOrFiles(), getReferencesInSourceFile(), isForRenameWithPrefixAndSuffixText() (+3 more)

### Community 586 - "parseUpdateExpression"
Cohesion: 0.26
Nodes (12): isUpdateExpression(), nextTokenAnd(), nextTokenIsIdentifierOrKeywordOrGreaterThan(), parseAwaitExpression(), parseDeleteExpression(), parsePrefixUnaryExpression(), parseSimpleUnaryExpression(), parseTypeOfExpression() (+4 more)

### Community 588 - "Apache License 2.0 (Apache)"
Cohesion: 0.17
Nodes (11): Accepting Warranty or Additional Liability., Apache License 2.0 (Apache), Definitions., Disclaimer of Warranty., External dependencies, Grant of Copyright License., Grant of Patent License., Limitation of Liability. (+3 more)

### Community 589 - "addImplementationReferences"
Cohesion: 0.18
Nodes (12): addImplementationReferences(), getAncestorTypeNode(), getContainingClassIfInHeritageClause(), getContextualTypeFromParentOrAncestorTypeNode(), hasInitializer(), hasType(), isAssertionExpression(), isDefinitionVisible() (+4 more)

### Community 590 - "getSelectionChildren"
Cohesion: 0.24
Nodes (12): addSyntheticNodes(), compact(), createChildren(), createNode(), createSyntaxList(), getSelectionChildren(), groupChildren(), isImport() (+4 more)

### Community 591 - "isModuleDeclaration"
Cohesion: 0.29
Nodes (12): canHaveExportModifier(), containsGlobalScopeAugmentation(), getInteriorModule(), getNonAugmentationDeclaration(), isAmbientModule(), isExternalModuleAugmentation(), isGlobalScopeAugmentation(), isModuleAugmentationExternal() (+4 more)

### Community 592 - "getRefactorEditsToRemoveFunctionBraces"
Cohesion: 0.26
Nodes (12): copyComments(), copyExpressionComments(), copyLeadingComments(), copyTrailingAsLeadingComments(), copyTrailingComments(), forEachTrailingCommentRange(), getAddCommentsFunction(), getRefactorActionsToConvertToOptionalChain() (+4 more)

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
Cohesion: 0.20
Nodes (11): addEs6Export(), canHaveDecorators(), canHaveIllegalDecorators(), flattenInvalidBinaryExpr(), getContainingNodeArray(), isEnumMember(), isJSDocCommentContainingNode(), isJSDocLinkLike() (+3 more)

### Community 602 - "textSpanEnd"
Cohesion: 0.25
Nodes (11): binarySearchKey(), findDiagnosticForNode(), getDiagnosticsWithinSpan(), getParentNodeInSpan(), getTypeExportSpecifiers(), isDiagnosticWithLocation(), spanContainsNode(), textSpanContainsPosition() (+3 more)

### Community 603 - "canHaveModifiers"
Cohesion: 0.25
Nodes (11): canHaveModifiers(), findModifier(), getClassNames(), getFunctionNames(), getGroupedReferences(), getModifierKindFromSource(), getModifierOccurrences(), moveRangePastDecorators() (+3 more)

### Community 604 - "completionInfoFromData"
Cohesion: 0.22
Nodes (11): compareCompletionEntries(), compareStringsCaseSensitiveUI(), completionInfoFromData(), getCompletionEntriesFromSymbols(), getLanguageVariant(), getOptionalReplacementSpan(), identity(), insertSorted() (+3 more)

### Community 605 - ".getSemanticDiagnostics"
Cohesion: 0.35
Nodes (9): createBuildOrUpdateInvalidedProject(), createRedirectedBuilderProgram(), emitFilesAndReportErrors(), emitFilesAndReportErrorsAndGetExitStatus(), getConfigFileParsingDiagnostics(), getDeclarationDiagnostics(), getPreEmitDiagnostics(), handleNoEmitOptions() (+1 more)

### Community 606 - "tryGetValueFromType"
Cohesion: 0.20
Nodes (11): createUndefined(), getClassLikeDeclarationOfSymbol(), getFirstSymbolInChain(), getObjectFlags(), getRecommendedCompletion(), hasAbstractModifier(), initializePropertyToUndefined(), isAbstractConstructorSymbol() (+3 more)

### Community 607 - "PerDirectoryResolutionCache"
Cohesion: 0.22
Nodes (5): ModuleResolutionCache, NonRelativeModuleNameResolutionCache, PackageJsonInfoCache, PerDirectoryResolutionCache, TypeReferenceDirectiveResolutionCache

### Community 608 - "FormattingContext"
Cohesion: 0.27
Nodes (5): FormattingContext(), isBeforeMultilineBlockContext(), isBraceWrappedContext(), isMultilineBlockContext(), isSingleLineBlockContext()

### Community 609 - "getTextOfIdentifierOrLiteral"
Cohesion: 0.22
Nodes (11): areSameModule(), createPropertyOrShorthandAssignment(), getContainers(), getFullyQualifiedModuleName(), getParameterName(), getTextOfIdentifierOrLiteral(), isOwnChild(), pushLiteral() (+3 more)

### Community 610 - "getObjectFlags"
Cohesion: 0.22
Nodes (9): assertEachIsDefined(), checkEachDefined(), containsNonPublicProperties(), getApparentProperties(), getObjectFlags(), getPropertiesForCompletion(), getPropertiesForObjectExpression(), isObjectLiteralType() (+1 more)

### Community 611 - "organizeImports"
Cohesion: 0.18
Nodes (11): coalesceExports(), compareImportKind(), compareImportsOrRequireStatements(), findNamespaceReExports(), getImportDeclarationInsertionIndex(), getImportKindOrder(), getModuleSpecifierExpression(), groupImportsByNewlineContiguous() (+3 more)

### Community 612 - "isFunctionExpression"
Cohesion: 0.25
Nodes (11): containingThis(), forEachAncestor(), getCommentOwnerInfo(), getCommentOwnerInfoWorker(), getFunctionInfo(), getRefactorActionsToConvertFunctionExpressions(), getRightHandSideOfAssignment(), isFunctionExpression() (+3 more)

### Community 613 - "convertToAsyncFunction"
Cohesion: 0.35
Nodes (11): convertToAsyncFunction(), getAllPromiseExpressionsToReturn(), getArgBindingName(), hasFailed(), hasPropertyAccessExpressionWithName(), isPromiseReturningCallExpression(), silentFail(), transformCatch() (+3 more)

### Community 614 - "CoreServicesShimObject"
Cohesion: 0.22
Nodes (3): CoreServicesShimObject(), getSnapshotText(), ScriptSnapshotShimAdapter()

### Community 615 - "TypeScriptServicesFactory"
Cohesion: 0.22
Nodes (4): createDocumentRegistry(), logInternalError(), ShimBase(), TypeScriptServicesFactory()

### Community 616 - "forEachImport"
Cohesion: 0.18
Nodes (11): createImportTracker(), findModuleReferences(), forEachImport(), forEachPossibleImportOrExportStatement(), getContainingModuleSymbol(), getDirectImportsMap(), getSearchesFromDirectImports(), getSourceFileLikeForImportDeclaration() (+3 more)

### Community 617 - "getDefaultLikeExportNameFromDeclaration"
Cohesion: 0.24
Nodes (10): formatSymbolFlags(), getDefaultExportInfoWorker(), getDefaultLikeExportNameFromDeclaration(), getLocalSymbolForExportDefault(), getNameForExportedSymbol(), getNamesForExportedSymbol(), getSymbolParentOrFail(), isExportDefaultSymbol() (+2 more)

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
Cohesion: 0.22
Nodes (10): addImplementationReferences(), getAncestorTypeNode(), getContainingClassIfInHeritageClause(), getContextualTypeFromParentOrAncestorTypeNode(), hasType(), isAssertionExpression(), isTypeElement(), isTypeNode() (+2 more)

### Community 625 - "computePositionOfLineAndCharacter"
Cohesion: 0.22
Nodes (9): arraysEqual(), computeLineStarts(), computePositionOfLineAndCharacter(), formatCodeSpan(), getLineStarts(), getPositionOfLineAndCharacter(), isIdenticalListOfDisplayParts(), nowString() (+1 more)

### Community 626 - "getSymbolCompletionFromEntryId"
Cohesion: 0.20
Nodes (10): completionNameForLiteral(), createCompletionEntryForLiteral(), getCompletionEntryDisplayNameForSymbol(), getCompletionEntrySymbol(), getSymbolCompletionFromEntryId(), isImportableSymbol(), isKnownSymbol(), isPrivateIdentifierSymbol() (+2 more)

### Community 627 - "createWriter"
Cohesion: 0.24
Nodes (9): calculateIndent(), createTextWriter(), createWriter(), getIndentSize(), getIndentString(), setEnd(), setPos(), writeCommentRange() (+1 more)

### Community 628 - "getRenameInfoForNode"
Cohesion: 0.22
Nodes (10): getPackagePathComponents(), getRenameInfo(), getRenameInfoError(), getRenameInfoForNode(), getRenameInfoSuccess(), isDefinedInLibraryFile(), isInsideNodeModules(), isLiteralNameOfPropertyDeclarationOrIndexAccess() (+2 more)

### Community 629 - "getSynthesizedDeepCloneWorker"
Cohesion: 0.33
Nodes (10): classExpressionToDeclaration(), convertExportsDotXEquals_replaceNode(), functionExpressionToDeclaration(), getSynthesizedDeepClones(), getSynthesizedDeepClonesWithReplacements(), getSynthesizedDeepCloneWithReplacements(), getSynthesizedDeepCloneWorker(), mapAllOrFail() (+2 more)

### Community 630 - "collectCallSites"
Cohesion: 0.20
Nodes (10): collectCallSites(), collectCallSitesOfClassLikeDeclaration(), collectCallSitesOfClassStaticBlockDeclaration(), collectCallSitesOfFunctionLikeDeclaration(), collectCallSitesOfSourceFile(), convertCallSiteGroupToOutgoingCall(), createCallHierarchyOutgoingCall(), createCallSiteCollector() (+2 more)

### Community 631 - "compareModuleSpecifiers"
Cohesion: 0.24
Nodes (10): compareBooleans(), compareChildren(), compareCompletionEntries(), compareModuleSpecifiers(), compareNumberOfDirectorySeparators(), comparePathsByRedirectAndNumberOfDirectorySeparators(), compareStringsCaseSensitiveUI(), navigationBarNodeKind() (+2 more)

### Community 632 - "eachExportReference"
Cohesion: 0.20
Nodes (10): eachExportReference(), getExternalModuleName(), getExternalModuleNameLiteral(), hasPossibleExternalModuleReference(), isImportOrExportSpecifier(), isImportOrExportSpecifierName(), isImportTypeNode(), isLiteralImportTypeNode() (+2 more)

### Community 633 - ".toString"
Cohesion: 0.22
Nodes (9): encodeUtf16EscapeSequence(), escapeNonAsciiString(), escapeString(), formatCodeSpan(), generateDjb2Hash(), getReplacement(), getTextOfConstantValue(), nowString() (+1 more)

### Community 634 - "findChildOfKind"
Cohesion: 0.24
Nodes (10): findChildOfKind(), findModifier(), functionSpan(), getClassOrObjectBraceEnds(), getFunctionNames(), getModifierOccurrences(), getNodesToSearchForModifier(), getOutliningSpanForNode() (+2 more)

### Community 635 - "flatten"
Cohesion: 0.27
Nodes (10): flatten(), getAllowJSCompilerOption(), getSupportedExtensions(), getSupportedExtensionsForModuleResolution(), getSupportedExtensionsWithJsonIfResolveJsonModule(), isEmitResolutionKindUsingNodeModules(), isJSLike(), isSupportedSourceFileName() (+2 more)

### Community 636 - "getCompletionEntriesFromSymbols"
Cohesion: 0.20
Nodes (10): getCompletionEntriesFromSymbols(), getCompletionEntryDisplayNameForSymbol(), getVariableDeclaration(), identity(), insertSorted(), isArrowFunctionBody(), isSingleOrDoubleQuote(), originIncludesSymbolName() (+2 more)

### Community 637 - "getScriptTransformers"
Cohesion: 0.22
Nodes (10): getDeclarationTransformers(), getJSXTransformEnabled(), getModuleTransformer(), getScriptTransformers(), getTransformers(), isBundle(), wrapCustomTransformer(), wrapCustomTransformerFactory() (+2 more)

### Community 638 - "parseObjectBindingElement"
Cohesion: 0.29
Nodes (10): isBindingIdentifier(), isBindingIdentifierOrPrivateIdentifierOrPattern(), isParameterNameStart(), parseArrayBindingElement(), parseArrayBindingPattern(), parseBindingIdentifier(), parseIdentifierOrPattern(), parseObjectBindingElement() (+2 more)

### Community 640 - "worker_pool.rs"
Cohesion: 0.33
Nodes (6): DcWorkerPool, Arc, Default, Self, Semaphore, WorkerPoolConfig

### Community 641 - "cast"
Cohesion: 0.22
Nodes (9): addMissingNewOperator(), cast(), findAncestorMatchingSpan(), getAllFixes(), getClass(), getContainingClass(), getModuleSpecifierText(), getProperty() (+1 more)

### Community 642 - ".getLineStarts"
Cohesion: 0.31
Nodes (6): addOutliningForLeadingCommentsForPos(), addRegionOutliningSpans(), computeLineAndCharacterOfPosition(), createSourceFileLike(), getLineAndCharacterOfPosition(), isRegionDelimiter()

### Community 643 - "assertDiagnosticLocation"
Cohesion: 0.25
Nodes (9): adjustIntersectingElement(), assertDiagnosticLocation(), assertGreaterThanOrEqual(), assertLessThanOrEqual(), attachFileToDiagnostic(), createDiagnosticForNodeFromMessageChain(), createFileDiagnosticFromMessageChain(), isDiagnosticWithDetachedLocation() (+1 more)

### Community 644 - "getThrowOccurrences"
Cohesion: 0.28
Nodes (9): aggregateOwnedThrowStatements(), flatMapChildren(), getThrowOccurrences(), getThrowStatementOwner(), isBlockStatement(), isFunctionBlock(), isLocalVariableOrFunction(), isThrowStatement() (+1 more)

### Community 645 - "getNavigateToItems"
Cohesion: 0.31
Nodes (9): betterMatch(), compareMatches(), compareNavigateToItems(), createPatternMatcher(), getFullMatch(), getItemsFromNamedDeclaration(), getNavigateToItems(), matchSegment() (+1 more)

### Community 646 - "compareStringsCaseSensitive"
Cohesion: 0.25
Nodes (9): compareComparableValues(), compareDiagnostics(), compareDiagnosticsSkipRelatedInformation(), compareMessageText(), compareProperties(), compareRelatedInformation(), compareStringsCaseSensitive(), compareTypesByDeclarationOrder() (+1 more)

### Community 647 - "getStringLiteralCompletions"
Cohesion: 0.28
Nodes (9): convertPathCompletions(), convertStringLiteralCompletions(), createSortedArray(), createTextSpanFromStringLiteralLikeContent(), getReplacementSpanForContextToken(), getStringLiteralCompletions(), isInNonReferenceComment(), isInReferenceComment() (+1 more)

### Community 648 - ".getCurrentSourceFile"
Cohesion: 0.28
Nodes (7): createLanguageServiceSourceFile(), ensureScriptKind(), getScriptKind(), getScriptKindFromFileName(), setSourceFileFields(), SyntaxTreeCache(), updateLanguageServiceSourceFile()

### Community 649 - "ProjectResponse"
Cohesion: 0.22
Nodes (9): BeginInstallTypes, EndInstallTypes, InitializationFailedResponse, InstallTypes, InvalidateCachedTypings, PackageInstalledResponse, ProjectResponse, SetTypings (+1 more)

### Community 650 - "FlowNodeBase"
Cohesion: 0.22
Nodes (9): FlowArrayMutation, FlowAssignment, FlowCall, FlowCondition, FlowLabel, FlowNodeBase, FlowReduceLabel, FlowStart (+1 more)

### Community 651 - "isPartOfTypeNode"
Cohesion: 0.25
Nodes (9): entryToType(), isExpressionWithTypeArgumentsInClassExtendsClause(), isHeritageClause(), isInExpressionContext(), isPartOfTypeNode(), isPossiblyTypeArgumentPosition(), tryGetClassByExtendingIdentifier(), tryGetClassExtendingExpressionWithTypeArguments() (+1 more)

### Community 652 - "isFunctionLikeKind"
Cohesion: 0.22
Nodes (9): forEachEnclosingBlockScopeContainer(), getEnclosingBlockScopeContainer(), isBlockScope(), isBlockScopedContainerTopLevel(), isFunctionLikeDeclarationKind(), isFunctionLikeKind(), isFunctionLikeOrClassStaticBlockDeclaration(), isNotTypeAnnotationContext() (+1 more)

### Community 653 - "isBeforeBlockContext"
Cohesion: 0.22
Nodes (9): isBeforeBlockContext(), isBlockContext(), isFunctionDeclContext(), isNotBeforeBlockInFunctionDeclarationContext(), isNotFunctionDeclContext(), isSameLineTokenOrBeforeBlockContext(), isTypeScriptDeclWithBlockContext(), nodeIsBlockContext() (+1 more)

### Community 654 - "TypeScriptServicesFactory"
Cohesion: 0.25
Nodes (3): logInternalError(), ShimBase(), TypeScriptServicesFactory()

### Community 655 - ".forEachChild"
Cohesion: 0.22
Nodes (8): aggregateChildData(), findNearestNodeStartingBeforeOrAtPosition(), findSuperCall(), flatMapChildren(), forEachFreeIdentifier(), getFirstChild(), getNodes(), isFreeIdentifier()

### Community 656 - "getNavigateToItems"
Cohesion: 0.31
Nodes (9): betterMatch(), compareMatches(), compareNavigateToItems(), createPatternMatcher(), getFullMatch(), getItemsFromNamedDeclaration(), getNavigateToItems(), matchSegment() (+1 more)

### Community 657 - ".throwIfCancellationRequested"
Cohesion: 0.28
Nodes (5): CancellationTokenObject(), checkForClassificationCancellation(), getApplicableRefactors(), instant(), ThrottledCancellationToken()

### Community 658 - "getContainingNodeArray"
Cohesion: 0.25
Nodes (9): canHaveIllegalDecorators(), flattenInvalidBinaryExpr(), getContainingNodeArray(), isEnumMember(), isJSDocCommentContainingNode(), isJSDocLinkLike(), isJSDocTag(), isJSDocTypeLiteral() (+1 more)

### Community 659 - "isParameter"
Cohesion: 0.28
Nodes (9): canPrefix(), getDeclaration(), getJSDocParameterTags(), getJSDocType(), hasUsableJSDoc(), isDeclarationWithType(), isParameter(), parameterShouldGetTypeFromJSDoc() (+1 more)

### Community 660 - "getGroupedReferences"
Cohesion: 0.22
Nodes (9): findReferenceOrRenameEntries(), flattenEntries(), getClassNames(), getGroupedReferences(), getImplementationReferenceEntries(), getReferenceEntriesForNode(), getReferences(), isSuperOrSuperProperty() (+1 more)

### Community 661 - "isFunctionLikeKind"
Cohesion: 0.22
Nodes (9): forEachEnclosingBlockScopeContainer(), getEnclosingBlockScopeContainer(), isBlockScope(), isBlockScopedContainerTopLevel(), isFunctionLikeDeclarationKind(), isFunctionLikeKind(), isFunctionLikeOrClassStaticBlockDeclaration(), isNotTypeAnnotationContext() (+1 more)

### Community 662 - "MediaFingerprint"
Cohesion: 0.39
Nodes (3): MediaFingerprint, Option, Vec

### Community 663 - "135.0.3176.0_0/manifest.json"
Cohesion: 0.25
Nodes (7): description, devtools_page, key, manifest_version, name, update_url, version

### Community 664 - "getReferencesAtLocation"
Cohesion: 0.43
Nodes (7): addClassStaticThisReferences(), addConstructorReferences(), addReference(), getReferenceForShorthandProperty(), getReferencesAtLocation(), hasMatchingMeaning(), shouldAddSingleReference()

### Community 665 - ".throwIfCancellationRequested"
Cohesion: 0.32
Nodes (4): CancellationTokenObject(), checkForClassificationCancellation(), instant(), ThrottledCancellationToken()

### Community 666 - "canReuseNode"
Cohesion: 0.25
Nodes (8): canReuseNode(), isReusableClassMember(), isReusableEnumMember(), isReusableParameter(), isReusableStatement(), isReusableSwitchClause(), isReusableTypeMember(), isReusableVariableDeclaration()

### Community 667 - "getFixInfo"
Cohesion: 0.29
Nodes (8): checkFixedAssignableTo(), createObjectTypeFromLabeledExpression(), createSymbolTable(), getFixInfo(), getLabelCompletionAtPosition(), getLabelStatementCompletions(), isLabeledBy(), isLabeledStatement()

### Community 668 - "isTemplateLiteralKind"
Cohesion: 0.25
Nodes (8): classFromKind(), getNewEndOfLineState(), isBinaryExpressionOperatorToken(), isPrefixUnaryExpressionOperatorToken(), isStringOrRegularExpressionOrTemplateLiteral(), isStringTextContainingNode(), isTemplateLiteralKind(), isTemplateLiteralToken()

### Community 669 - "getImplementationsAtPosition"
Cohesion: 0.25
Nodes (8): createQueue(), findReferenceOrRenameEntries(), flattenEntries(), getImplementationReferenceEntries(), getImplementationsAtPosition(), getReferenceEntriesForNode(), isSuperOrSuperProperty(), isSuperProperty()

### Community 670 - "SourceFile"
Cohesion: 0.25
Nodes (3): JsonSourceFile, SourceFile, TsConfigSourceFile

### Community 672 - "isVariableDeclarationInitializedToBareOrAccessedRequire"
Cohesion: 0.29
Nodes (8): getExternalModuleRequireArgument(), getLeftmostAccessExpression(), isAnyImportOrBareOrAccessedRequire(), isAnyImportSyntax(), isExternalModuleImportEquals(), isNodeImport(), isVariableDeclarationInitializedToBareOrAccessedRequire(), isVariableDeclarationInitializedWithRequireHelper()

### Community 673 - "getNodeId"
Cohesion: 0.29
Nodes (4): getNodeId(), getOriginalNodeId(), nodeSeenTracker(), State()

### Community 674 - "assertDiagnosticLocation"
Cohesion: 0.29
Nodes (8): adjustIntersectingElement(), assertDiagnosticLocation(), assertGreaterThanOrEqual(), assertLessThanOrEqual(), attachFileToDiagnostic(), createFileDiagnosticFromMessageChain(), isDiagnosticWithDetachedLocation(), relativeComplement()

### Community 675 - "canReuseNode"
Cohesion: 0.25
Nodes (8): canReuseNode(), isReusableClassMember(), isReusableEnumMember(), isReusableParameter(), isReusableStatement(), isReusableSwitchClause(), isReusableTypeMember(), isReusableVariableDeclaration()

### Community 676 - "coalesceImports"
Cohesion: 0.25
Nodes (8): coalesceImports(), compareIdentifiers(), compareStringsCaseInsensitive(), getNewImportSpecifiers(), hasModuleDeclarationMatchingSpecifier(), removeUnusedImports(), tryGetNamedBindingElements(), updateImportDeclarationAndClause()

### Community 677 - "parseComparator"
Cohesion: 0.43
Nodes (7): createComparator(), isWildcard(), parseComparator(), parseHyphen(), parsePartial(), parseRange(), VersionRange()

### Community 678 - "createNewParameters"
Cohesion: 0.29
Nodes (8): createNewParameters(), getRefactorableParameters(), getRefactorableParametersLength(), hasRestParameter(), hasThisParameter(), isRestParameter(), isValidParameterDeclaration(), isValidParameterNodeArray()

### Community 679 - "newFileChangesWorker"
Cohesion: 0.25
Nodes (8): createTextChange(), createTextChangeFromStartLength(), ensureScriptKind(), formatDocument(), getNewFileText(), getScriptKindFromFileName(), newFileChanges(), newFileChangesWorker()

### Community 680 - "getPossibleGenericSignatures"
Cohesion: 0.32
Nodes (7): getPossibleGenericSignatures(), isExpressionOfOptionalChainRoot(), isNewExpression(), isOptionalChain(), isOptionalChainRoot(), isOutermostOptionalChain(), removeOptionality()

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

### Community 689 - "attachFlowNodeDebugInfoWorker"
Cohesion: 0.29
Nodes (7): attachFlowNodeDebugInfo(), attachFlowNodeDebugInfoWorker(), extendedDebug(), formatControlFlowGraph(), formatFlowFlags(), initFlowNode(), printControlFlowGraph()

### Community 690 - "updateSourceFile"
Cohesion: 0.38
Nodes (7): checkChangeRange(), createSyntaxCursor(), getNewCommentDirectives(), shouldAssert(), textChangeRangeNewSpan(), updateSourceFile(), updateTokenPositionsAndMarkElements()

### Community 691 - "extendToAffectedRange"
Cohesion: 0.29
Nodes (5): collapseTextChangeRangesAcrossMultipleVersions(), createTextChangeRange(), extendToAffectedRange(), findNearestNodeStartingBeforeOrAtPosition(), ScriptSnapshotShimAdapter()

### Community 692 - "collectCallSites"
Cohesion: 0.29
Nodes (7): collectCallSites(), collectCallSitesOfClassStaticBlockDeclaration(), collectCallSitesOfFunctionLikeDeclaration(), collectCallSitesOfSourceFile(), createCallSiteCollector(), getCallSiteGroupKey(), getOutgoingCalls()

### Community 693 - "parseComparator"
Cohesion: 0.52
Nodes (6): createComparator(), isWildcard(), parseComparator(), parseHyphen(), parsePartial(), parseRange()

### Community 694 - "DocumentSpan"
Cohesion: 0.29
Nodes (7): DefinitionInfo, DocumentSpan, ImplementationLocation, ReferencedSymbolDefinitionInfo, ReferencedSymbolEntry, ReferenceEntry, RenameLocation

### Community 697 - "processPragmasIntoFields"
Cohesion: 0.29
Nodes (7): extractPragmas(), getNamedArgRegEx(), parseResolutionMode(), preProcessFile(), processCommentPragmas(), processPragmasIntoFields(), toArray()

### Community 698 - "isValidFunctionDeclaration"
Cohesion: 0.29
Nodes (6): getCheckFlags(), getFirstTypeParameterName(), getSymbolForContextualType(), hasNameOrDefault(), isSingleImplementation(), isValidFunctionDeclaration()

### Community 699 - "isGeneratedPrivateIdentifier"
Cohesion: 0.33
Nodes (7): getGeneratedPrivateIdentifierInfo(), getNodeForGeneratedName(), getPrivateIdentifier(), getPrivateIdentifierInfo(), isGeneratedPrivateIdentifier(), isReservedPrivateName(), setPrivateIdentifier()

### Community 700 - "113.0.1765.0_0/manifest.json"
Cohesion: 0.29
Nodes (6): description, key, manifest_version, name, update_url, version

### Community 701 - "attachFlowNodeDebugInfoWorker"
Cohesion: 0.29
Nodes (7): attachFlowNodeDebugInfo(), attachFlowNodeDebugInfoWorker(), extendedDebug(), formatControlFlowGraph(), formatFlowFlags(), initFlowNode(), printControlFlowGraph()

### Community 702 - "processTaggedTemplateExpression"
Cohesion: 0.33
Nodes (7): createTemplateCooked(), getRawLiteral(), getSourceTextOfNodeFromSourceFile(), hasInvalidEscape(), isNoSubstitutionTemplateLiteral(), isStringDoubleQuoted(), processTaggedTemplateExpression()

### Community 703 - "mayDeleteExpression"
Cohesion: 0.33
Nodes (7): expandPreOrPostfixIncrementOrDecrementExpression(), isLiteralExpression(), isLiteralKind(), isLiteralTypeLikeExpression(), isPostfixUnaryExpression(), isPrefixUnaryExpression(), mayDeleteExpression()

### Community 704 - "getAllSupers"
Cohesion: 0.29
Nodes (7): getAllJSDocTags(), getAllSupers(), getClassExtendsHeritageElement(), getEffectiveImplementsTypeNodes(), getHeritageClause(), getInterfaceBaseTypeNodes(), getJSDocImplementsTags()

### Community 705 - "isGeneratedPrivateIdentifier"
Cohesion: 0.33
Nodes (7): getGeneratedPrivateIdentifierInfo(), getNodeForGeneratedName(), getPrivateIdentifier(), getPrivateIdentifierInfo(), isGeneratedPrivateIdentifier(), isReservedPrivateName(), setPrivateIdentifier()

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

### Community 713 - "commandLineOptionsToMap"
Cohesion: 0.53
Nodes (6): commandLineOptionsToMap(), getCommandLineCompilerOptionsMap(), getCommandLineTypeAcquisitionMap(), getCommandLineWatchOptionsMap(), getOptionName(), getTsconfigRootOptionsMap()

### Community 714 - "createPropertyNameFromSymbol"
Cohesion: 0.33
Nodes (6): createPropertyNameFromSymbol(), createPropertyNameNodeForIdentifierOrLiteral(), getSymbolTarget(), isAliasSymbol(), isNumericLiteralName(), isTransientSymbol()

### Community 715 - "TextRange"
Cohesion: 0.33
Nodes (6): CheckJsDirective, CommentRange, FileReference, SourceMapRange, SynthesizedComment, TextRange

### Community 717 - "Watch"
Cohesion: 0.33
Nodes (3): Watch, WatchOfConfigFile, WatchOfFilesAndCompilerOptions

### Community 718 - "updateErrorForNoInputFiles"
Cohesion: 0.33
Nodes (5): filterMutate(), getErrorForNoInputFiles(), isErrorNoInputFiles(), shouldReportNoInputFiles(), updateErrorForNoInputFiles()

### Community 719 - "isExecutableStatement"
Cohesion: 0.33
Nodes (6): getCombinedNodeFlags(), isEnumDeclaration(), isExecutableStatement(), isLet(), isPurelyTypeDeclaration(), isVarConst()

### Community 720 - "getPossibleExtractions"
Cohesion: 0.33
Nodes (6): getDescriptionForClassLikeDeclaration(), getDescriptionForConstantInScope(), getDescriptionForFunctionInScope(), getDescriptionForFunctionLikeDeclaration(), getDescriptionForModuleLikeDeclaration(), getPossibleExtractions()

### Community 721 - "getNewImportFixes"
Cohesion: 0.47
Nodes (6): getModuleSpecifiers(), getModuleSpecifiersWithCacheInfo(), getNewImportFixes(), moduleResolutionUsesNodeModules(), tryGetModuleSpecifiersFromCache(), tryGetModuleSpecifiersFromCacheWorker()

### Community 722 - "isFunctionLikeDeclaration"
Cohesion: 0.47
Nodes (6): getNodeToInsertFunctionBefore(), getStatementsOrClassElements(), hasUsableJSDoc(), isDeclarationWithType(), isFunctionLikeDeclaration(), parameterShouldGetTypeFromJSDoc()

### Community 723 - "append"
Cohesion: 0.53
Nodes (6): append(), createUnparsedSourceFile(), getAllUnscopedEmitHelpers(), parseOldFileOfCurrentEmit(), parseUnparsedSourceFile(), setEachParent()

### Community 724 - "getSymbolId"
Cohesion: 0.33
Nodes (5): explicitlyInheritsFrom(), getPropertyNameForUniqueESSymbol(), getSymbolId(), getSymbolNameForPrivateIdentifier(), getUniqueSymbolId()

### Community 725 - "flattenDestructuringAssignment"
Cohesion: 0.33
Nodes (6): flattenDestructuringAssignment(), isEmptyArrayLiteral(), isEmptyObjectLiteral(), makeArrayAssignmentPattern(), makeAssignmentElement(), makeObjectAssignmentPattern()

### Community 726 - "isVariableDeclarationInitializedToBareOrAccessedRequire"
Cohesion: 0.40
Nodes (6): getExternalModuleRequireArgument(), getLeftmostAccessExpression(), isAnyImportOrBareOrAccessedRequire(), isAnyImportSyntax(), isVariableDeclarationInitializedToBareOrAccessedRequire(), isVariableDeclarationInitializedWithRequireHelper()

### Community 727 - "walkUpParenthesizedExpressions"
Cohesion: 0.40
Nodes (6): isDeleteTarget(), tryGetObjectLiteralContextualType(), walkUp(), walkUpParentheses(), walkUpParenthesizedExpressions(), walkUpParenthesizedTypes()

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

### Community 734 - "propagateChildFlags"
Cohesion: 0.40
Nodes (5): aggregateChildrenFlags(), getTransformFlagsSubtreeExclusions(), propagateChildFlags(), propagateIdentifierNameFlags(), propagatePropertyNameFlagsOfChild()

### Community 735 - "flattenDestructuringBinding"
Cohesion: 0.50
Nodes (5): assertEachNode(), flattenDestructuringBinding(), makeArrayBindingPattern(), makeBindingElement(), makeObjectBindingPattern()

### Community 736 - "TypePredicateBase"
Cohesion: 0.40
Nodes (5): AssertsIdentifierTypePredicate, AssertsThisTypePredicate, IdentifierTypePredicate, ThisTypePredicate, TypePredicateBase

### Community 739 - "escapeNonAsciiString"
Cohesion: 0.50
Nodes (5): encodeUtf16EscapeSequence(), escapeNonAsciiString(), escapeString(), getReplacement(), getTextOfConstantValue()

### Community 740 - "findOwnConstructorReferences"
Cohesion: 0.50
Nodes (5): findOwnConstructorReferences(), findSuperConstructorAccesses(), forEachDescendantOfKind(), getClassConstructorSymbol(), hasOwnConstructor()

### Community 741 - "getEncodedRootLength"
Cohesion: 0.40
Nodes (5): getEncodedRootLength(), getFileUrlVolumeSeparatorEnd(), isDiskPathRoot(), isUrl(), isVolumeCharacter()

### Community 742 - "isDeclarationStatementKind"
Cohesion: 0.40
Nodes (5): isDeclarationStatement(), isDeclarationStatementKind(), isStatementButNotDeclaration(), isStatementKindButNotDeclarationKind(), isStatementOrBlock()

### Community 743 - "addEs6Export"
Cohesion: 0.40
Nodes (5): addCommonjsExport(), addEs6Export(), addExport(), canHaveDecorators(), getNamesToExportInCommonJS()

### Community 744 - "propagateChildFlags"
Cohesion: 0.40
Nodes (5): aggregateChildrenFlags(), getTransformFlagsSubtreeExclusions(), propagateChildFlags(), propagateIdentifierNameFlags(), propagatePropertyNameFlagsOfChild()

### Community 745 - "skipAlias"
Cohesion: 0.40
Nodes (5): doTypeOnlyImportChange(), forEachImportClauseDeclaration(), isDeprecated(), skipAlias(), symbolCanBeReferencedAtTypeLocation()

### Community 746 - "getEffectiveTypeAnnotationNode"
Cohesion: 0.40
Nodes (5): getEffectiveSetAccessorTypeAnnotationNode(), getEffectiveTypeAnnotationNode(), getSetAccessorTypeAnnotationNode(), getSetAccessorValueParameter(), isJSDocPropertyLikeTag()

### Community 747 - "getEncodedRootLength"
Cohesion: 0.40
Nodes (5): getEncodedRootLength(), getFileUrlVolumeSeparatorEnd(), isDiskPathRoot(), isUrl(), isVolumeCharacter()

### Community 748 - "getMeaningFromDeclaration"
Cohesion: 0.40
Nodes (5): getIntersectingMeaningFromDeclarations(), getJSDocEnumTag(), getMeaningFromDeclaration(), getReferenceEntriesForShorthandPropertyAssignment(), symbolHasMeaning()

### Community 749 - "isBeforeBlockContext"
Cohesion: 0.40
Nodes (5): isBeforeBlockContext(), isFunctionDeclContext(), isNotBeforeBlockInFunctionDeclarationContext(), isNotFunctionDeclContext(), isSameLineTokenOrBeforeBlockContext()

### Community 750 - "isDeclarationStatementKind"
Cohesion: 0.40
Nodes (5): isDeclarationStatement(), isDeclarationStatementKind(), isStatementButNotDeclaration(), isStatementKindButNotDeclarationKind(), isStatementOrBlock()

### Community 751 - "isValidTypeOnlyAliasUseSite"
Cohesion: 0.40
Nodes (5): isIdentifierInNonEmittingHeritageClause(), isPartOfPossiblyValidTypeOrAbstractComputedPropertyName(), isPartOfTypeQuery(), isShorthandPropertyNameUseSite(), isValidTypeOnlyAliasUseSite()

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
Cohesion: 0.67
Nodes (3): ClassificationResult, classify_media_item(), Option

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

### Community 772 - "newFileChangesWorker"
Cohesion: 0.50
Nodes (4): applyChanges(), formatDocument(), getNewFileText(), newFileChangesWorker()

### Community 774 - "compareWithCallback"
Cohesion: 0.67
Nodes (4): compareWithCallback(), createFallbackStringComparer(), createIntlCollatorStringComparer(), createLocaleCompareStringComparer()

### Community 775 - "convertReExportAll"
Cohesion: 0.67
Nodes (4): convertReExportAll(), makeExportDeclaration(), reExportDefault(), reExportStar()

### Community 776 - "getDirectImportsMap"
Cohesion: 0.50
Nodes (4): createImportTracker(), getDirectImportsMap(), getImportersForExport(), getSearchesFromDirectImports()

### Community 780 - "getSerializedCompilerOption"
Cohesion: 0.50
Nodes (4): extend(), generateTSConfig(), getCompilerOptionsDiffValue(), getSerializedCompilerOption()

### Community 781 - ".TokensAreOnSameLine"
Cohesion: 0.50
Nodes (3): isEndOfDecoratorContextOnSameLine(), isNonJsxSameLineTokenContext(), isOptionDisabledOrUndefinedOrTokensOnSameLine()

### Community 782 - "nodeOverlapsWithStartEnd"
Cohesion: 0.67
Nodes (4): nodeOverlapsWithStartEnd(), prepareRangeContainsErrorFunction(), rangeOverlapsWithStartEnd(), startEndOverlapsWithStartEnd()

### Community 786 - "compareWithCallback"
Cohesion: 0.67
Nodes (4): compareWithCallback(), createFallbackStringComparer(), createIntlCollatorStringComparer(), createLocaleCompareStringComparer()

### Community 787 - "convertReExportAll"
Cohesion: 0.67
Nodes (4): convertReExportAll(), makeExportDeclaration(), reExportDefault(), reExportStar()

### Community 788 - "elementAt"
Cohesion: 0.50
Nodes (4): elementAt(), getExplicitPromisedTypeOfPromiseReturningCallExpression(), isReferenceToType(), toOffset()

### Community 789 - "getSerializedCompilerOption"
Cohesion: 0.50
Nodes (4): extend(), generateTSConfig(), getCompilerOptionsDiffValue(), getSerializedCompilerOption()

### Community 790 - ".TokensAreOnSameLine"
Cohesion: 0.50
Nodes (3): isEndOfDecoratorContextOnSameLine(), isNonJsxSameLineTokenContext(), isOptionDisabledOrUndefinedOrTokensOnSameLine()

### Community 791 - "tryRemovePrefix"
Cohesion: 0.50
Nodes (4): isAnyDirectorySeparator(), stripLeadingDirectorySeparator(), tryRemoveDirectoryPrefix(), tryRemovePrefix()

### Community 792 - "unorderedRemoveItem"
Cohesion: 0.50
Nodes (4): multiMapRemove(), unorderedRemoveFirstItemWhere(), unorderedRemoveItem(), unorderedRemoveItemAt()

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

### Community 798 - "2026.3.23.1/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

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
Cohesion: 0.67
Nodes (3): arrayIterator(), flatMapIterator(), getIterator()

### Community 819 - "getExpandedCharCodes"
Cohesion: 0.67
Nodes (3): base64encode(), convertToBase64(), getExpandedCharCodes()

### Community 820 - "compose"
Cohesion: 0.67
Nodes (3): compose(), min(), reduceLeft()

### Community 821 - "computeSignatureWithDiagnostics"
Cohesion: 0.67
Nodes (3): computeSignature(), computeSignatureWithDiagnostics(), getTextHandlingSourceMapForSignature()

### Community 825 - "decodedTextSpanIntersectsWith"
Cohesion: 0.67
Nodes (3): decodedTextSpanIntersectsWith(), textSpanIntersectsWith(), textSpanIntersectsWithTextSpan()

### Community 826 - "encodeJsxCharacterEntity"
Cohesion: 0.67
Nodes (3): encodeJsxCharacterEntity(), escapeJsxAttributeString(), getJsxAttributeStringReplacement()

### Community 827 - "extensionIsTS"
Cohesion: 0.67
Nodes (3): extensionIsTS(), resolutionExtensionIsTSOrJson(), resolvedTypeScriptOnly()

### Community 828 - "getBinderAndCheckerDiagnosticsOfFile"
Cohesion: 0.67
Nodes (3): filterSemanticDiagnostics(), getBinderAndCheckerDiagnosticsOfFile(), getSemanticDiagnosticsOfFile()

### Community 829 - "formatAlternative"
Cohesion: 0.67
Nodes (3): formatAlternative(), formatComparator(), formatDisjunction()

### Community 830 - "formatIdentifier"
Cohesion: 0.67
Nodes (3): formatGeneratedName(), formatGeneratedNamePart(), formatIdentifier()

### Community 831 - "forwardCall"
Cohesion: 0.67
Nodes (3): forwardCall(), forwardJSONCall(), simpleForwardCall()

### Community 832 - "getContainingObjectLiteralElementWorker"
Cohesion: 0.67
Nodes (3): getContainingObjectLiteralElementWorker(), isObjectLiteralElement(), isObjectLiteralElementLike()

### Community 833 - "getExternalModuleNameLiteral"
Cohesion: 0.67
Nodes (3): getExternalModuleNameLiteral(), tryGetModuleNameFromDeclaration(), tryRenameExternalModule()

### Community 834 - "onWatchedFileStat"
Cohesion: 0.67
Nodes (3): getFileWatcherEventKind(), onWatchedFileStat(), pollWatchedFileQueue()

### Community 835 - "getMappedLocation"
Cohesion: 1.00
Nodes (3): getMappedContextSpan(), getMappedDocumentSpan(), getMappedLocation()

### Community 836 - "getMergedAliasedSymbolOfNamespaceExportDeclaration"
Cohesion: 0.67
Nodes (3): getMergedAliasedSymbolOfNamespaceExportDeclaration(), isNamespaceExportDeclaration(), isUMDExportSymbol()

### Community 837 - "mangleScopedPackageName"
Cohesion: 0.67
Nodes (3): getTypesPackageName(), getTypesPackageNameToInstall(), mangleScopedPackageName()

### Community 838 - "isAnyDirectorySeparator"
Cohesion: 0.67
Nodes (3): isAnyDirectorySeparator(), stripLeadingDirectorySeparator(), tryRemoveDirectoryPrefix()

### Community 839 - "isFunctionCallOrNewContext"
Cohesion: 0.67
Nodes (3): isFunctionCallContext(), isFunctionCallOrNewContext(), isNewContext()

### Community 840 - "isLiteralExpression"
Cohesion: 0.67
Nodes (3): isLiteralExpression(), isLiteralKind(), isLiteralTypeLikeExpression()

### Community 841 - "isNamespaceReference"
Cohesion: 0.67
Nodes (3): isNamespaceReference(), isPropertyAccessNamespaceReference(), isQualifiedNameNamespaceReference()

### Community 842 - "isNotEmittedOrPartiallyEmittedNode"
Cohesion: 0.67
Nodes (3): isNotEmittedOrPartiallyEmittedNode(), isNotEmittedStatement(), isPartiallyEmittedExpression()

### Community 843 - "isRawSourceMap"
Cohesion: 0.67
Nodes (3): isRawSourceMap(), isStringOrNull(), tryParseRawSourceMap()

### Community 844 - "orderedRemoveItem"
Cohesion: 0.67
Nodes (3): orderedRemoveItem(), orderedRemoveItemAt(), removeEmitHelper()

### Community 845 - "parseBuildCommand"
Cohesion: 0.67
Nodes (3): parseBuildCommand(), parseCommandLine(), parseCommandLineWorker()

### Community 846 - "testComparator"
Cohesion: 0.67
Nodes (3): testAlternative(), testComparator(), testDisjunction()

### Community 847 - "textSpanIntersection"
Cohesion: 0.67
Nodes (3): textSpanIntersection(), textSpanOverlap(), textSpanOverlapsWith()

### Community 848 - "isProgramUptoDate"
Cohesion: 0.67
Nodes (3): arrayIsEqualTo(), compareDataObjects(), isProgramUptoDate()

### Community 849 - "getExpandedCharCodes"
Cohesion: 0.67
Nodes (3): base64encode(), convertToBase64(), getExpandedCharCodes()

### Community 850 - "classFromKind"
Cohesion: 0.67
Nodes (3): classFromKind(), isBinaryExpressionOperatorToken(), isPrefixUnaryExpressionOperatorToken()

### Community 851 - "compose"
Cohesion: 0.67
Nodes (3): compose(), min(), reduceLeft()

### Community 852 - "decodedTextSpanIntersectsWith"
Cohesion: 0.67
Nodes (3): decodedTextSpanIntersectsWith(), textSpanIntersectsWith(), textSpanIntersectsWithTextSpan()

### Community 853 - "doneWithAffectedFile"
Cohesion: 0.67
Nodes (3): doneWithAffectedFile(), toAffectedFileEmitResult(), toAffectedFileResult()

### Community 854 - "encodeJsxCharacterEntity"
Cohesion: 0.67
Nodes (3): encodeJsxCharacterEntity(), escapeJsxAttributeString(), getJsxAttributeStringReplacement()

### Community 855 - "extensionIsTS"
Cohesion: 0.67
Nodes (3): extensionIsTS(), resolutionExtensionIsTSOrJson(), resolvedTypeScriptOnly()

### Community 856 - "getBinderAndCheckerDiagnosticsOfFile"
Cohesion: 0.67
Nodes (3): filterSemanticDiagnostics(), getBinderAndCheckerDiagnosticsOfFile(), getSemanticDiagnosticsOfFile()

### Community 857 - "formatAlternative"
Cohesion: 0.67
Nodes (3): formatAlternative(), formatComparator(), formatDisjunction()

### Community 858 - "formatIdentifier"
Cohesion: 0.67
Nodes (3): formatGeneratedName(), formatGeneratedNamePart(), formatIdentifier()

### Community 859 - "forwardCall"
Cohesion: 0.67
Nodes (3): forwardCall(), forwardJSONCall(), simpleForwardCall()

### Community 860 - "getContainingObjectLiteralElementWorker"
Cohesion: 0.67
Nodes (3): getContainingObjectLiteralElementWorker(), isObjectLiteralElement(), isObjectLiteralElementLike()

### Community 861 - "onWatchedFileStat"
Cohesion: 0.67
Nodes (3): getFileWatcherEventKind(), onWatchedFileStat(), pollWatchedFileQueue()

### Community 862 - "getMappedLocation"
Cohesion: 1.00
Nodes (3): getMappedContextSpan(), getMappedDocumentSpan(), getMappedLocation()

### Community 863 - "getMergedAliasedSymbolOfNamespaceExportDeclaration"
Cohesion: 0.67
Nodes (3): getMergedAliasedSymbolOfNamespaceExportDeclaration(), isNamespaceExportDeclaration(), isUMDExportSymbol()

### Community 864 - "getSymbolTarget"
Cohesion: 0.67
Nodes (3): getSymbolTarget(), isAliasSymbol(), isTransientSymbol()

### Community 865 - "isFunctionCallOrNewContext"
Cohesion: 0.67
Nodes (3): isFunctionCallContext(), isFunctionCallOrNewContext(), isNewContext()

### Community 866 - "isInReferenceCommentWorker"
Cohesion: 0.67
Nodes (3): isInNonReferenceComment(), isInReferenceComment(), isInReferenceCommentWorker()

### Community 867 - "isNamespaceReference"
Cohesion: 0.67
Nodes (3): isNamespaceReference(), isPropertyAccessNamespaceReference(), isQualifiedNameNamespaceReference()

### Community 868 - "isNotEmittedOrPartiallyEmittedNode"
Cohesion: 0.67
Nodes (3): isNotEmittedOrPartiallyEmittedNode(), isNotEmittedStatement(), isPartiallyEmittedExpression()

### Community 869 - "orderedRemoveItem"
Cohesion: 0.67
Nodes (3): orderedRemoveItem(), orderedRemoveItemAt(), removeEmitHelper()

### Community 870 - "parseBuildCommand"
Cohesion: 0.67
Nodes (3): parseBuildCommand(), parseCommandLine(), parseCommandLineWorker()

### Community 871 - "testComparator"
Cohesion: 0.67
Nodes (3): testAlternative(), testComparator(), testDisjunction()

## Knowledge Gaps
- **1351 isolated node(s):** `fs`, `command`, `name`, `private`, `version` (+1346 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **251 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createNodeFactory()` connect `tg_error.rs` to `createNodeArray`, `isExpressionStatement`, `automations_db.rs`, `react-phone-number-input`, `frontend/package.json`, `.replaceNode`, `getSelectionChildren`, `getEmitScriptTarget`, `createIdentifier`, `.getCurrentDirectory`, `.isStringLiteral`, `assert`, `assertIsDefined`, `DriveExplorer.tsx`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `NodeFactory` connect `automations_db.rs` to `DrivePreviewModal.tsx`, `tg_error.rs`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `createNodeFactory()` connect `tg_error.rs` to `.getChildren`, `ModernProgressBar`, `createIdentifier`, `grammers_ops.rs`, `getSelectionChildren`, `automations_db.rs`, `assert`, `AutoGram App/src-tauri/build.rs`, `getNewFileImportsAndAddExportInOldFile`, `updateSourceFile`, `react-i18next`, `tokenIsIdentifierOrKeyword`, `createNodeArray`, `assertIsDefined`, `.add`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Are the 365 inferred relationships involving `createNodeFactory()` (e.g. with `.createJSDocText()` and `createExportAssignment()`) actually correct?**
  _`createNodeFactory()` has 365 INFERRED edges - model-reasoned connections that need verification._
- **Are the 365 inferred relationships involving `createNodeFactory()` (e.g. with `.createArrayBindingPattern()` and `.createArrayLiteralExpression()`) actually correct?**
  _`createNodeFactory()` has 365 INFERRED edges - model-reasoned connections that need verification._
- **What connects `fs`, `command`, `name` to the rest of the system?**
  _1351 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `frontend/src-tauri/src/lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.04265159301130524 - nodes in this community are weakly interconnected._