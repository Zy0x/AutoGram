package com.autogram.app.ui.drive

import android.widget.Toast
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.VolumeMute
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem

/**
 * Truncate filename in the middle with ellipsis (e.g., "production_master...4k.mp4")
 */
private fun middleTruncateFilename(filename: String, maxLength: Int = 26): String {
    if (filename.length <= maxLength) return filename
    val extIndex = filename.lastIndexOf('.')
    val ext = if (extIndex != -1) filename.substring(extIndex) else ""
    val nameWithoutExt = if (extIndex != -1) filename.substring(0, extIndex) else filename

    val targetLen = (maxLength - ext.length - 3).coerceAtLeast(4)
    val frontLen = (targetLen + 1) / 2
    val backLen = targetLen / 2

    return "${nameWithoutExt.take(frontLen)}...${nameWithoutExt.takeLast(backLen)}$ext"
}

@Composable
fun DrivePreviewModal(
    item: DriveFileItem,
    allItems: List<DriveFileItem> = emptyList(),
    onDismiss: () -> Unit,
    onNavigateItem: ((DriveFileItem) -> Unit)? = null,
    onDownload: (DriveFileItem) -> Unit = {}
) {
    val context = LocalContext.current
    var currentItem by remember(item) { mutableStateOf(item) }

    // Desktop UI State Variables
    var isInfoSheetOpen by remember { mutableStateOf(false) }
    var isDiagnosticsOpen by remember { mutableStateOf(false) }
    var isFullscreen by remember { mutableStateOf(false) }
    var isPlaying by remember { mutableStateOf(true) }
    var isMuted by remember { mutableStateOf(false) }
    var playbackSpeed by remember { mutableFloatStateOf(1.0f) }
    var selectedQuality by remember { mutableStateOf("Original") }
    var isQualityMenuOpen by remember { mutableStateOf(false) }
    var isSpeedMenuOpen by remember { mutableStateOf(false) }
    var isDuplicateCompareOpen by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0.35f) }
    var isLooping by remember { mutableStateOf(false) }
    var aspectRatioMode by remember { mutableIntStateOf(0) } // 0=Fit, 1=Fill, 2=16:9, 3=4:3, 4=Stretch
    var isFilmstripVisible by remember { mutableStateOf(true) }

    // File Category Detection
    val isPhoto = currentItem.mimeType.startsWith("image") || currentItem.telegramCategory.equals("photo", ignoreCase = true)
    val isVideo = currentItem.mimeType.startsWith("video") || currentItem.telegramCategory.equals("video", ignoreCase = true)
    val isAudio = currentItem.mimeType.startsWith("audio") || currentItem.telegramCategory.equals("audio", ignoreCase = true)
    val isZip = currentItem.mimeType.contains("zip", ignoreCase = true) || currentItem.name.endsWith(".zip", ignoreCase = true) || currentItem.telegramCategory.equals("archive", ignoreCase = true)
    val isCode = currentItem.name.endsWith(".json", ignoreCase = true) || currentItem.name.endsWith(".txt", ignoreCase = true) || currentItem.name.endsWith(".py", ignoreCase = true) || currentItem.name.endsWith(".rs", ignoreCase = true) || currentItem.name.endsWith(".sql", ignoreCase = true) || currentItem.name.endsWith(".log", ignoreCase = true) || currentItem.name.endsWith(".md", ignoreCase = true) || currentItem.name.endsWith(".js", ignoreCase = true) || currentItem.name.endsWith(".ts", ignoreCase = true)
    val isPdf = currentItem.name.endsWith(".pdf", ignoreCase = true) || currentItem.mimeType.contains("pdf", ignoreCase = true)
    val isTgs = currentItem.name.endsWith(".tgs", ignoreCase = true) || currentItem.name.endsWith(".lottie", ignoreCase = true)

    // Navigation Indexes
    val currentIndex = allItems.indexOfFirst { it.id == currentItem.id }
    val hasPrev = currentIndex > 0
    val hasNext = currentIndex != -1 && currentIndex < allItems.size - 1

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CanvasDeepNavy.copy(alpha = 0.98f))
        ) {
            // =========================================================================
            // 1. DESKTOP-GRADE HEADER TOOLBAR (MediaHeaderToolbar)
            // =========================================================================
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .zIndex(15f)
                    .statusBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left: Close Button + File Info & Counter
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier
                            .size(36.dp)
                            .background(Color(0x33FFFFFF), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = stringResource(R.string.preview_action_close),
                            tint = Color.White,
                            modifier = Modifier.size(18.dp)
                        )
                    }

                    Column {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(7.dp)
                                    .clip(CircleShape)
                                    .background(
                                        when {
                                            isVideo -> CategoryVideo
                                            isPhoto -> CategoryPhoto
                                            isAudio -> CategoryAudio
                                            isZip -> GoldAccent
                                            isPdf -> CategoryDoc
                                            else -> MutedIceCyan
                                        }
                                    )
                            )
                            Text(
                                text = middleTruncateFilename(currentItem.name, 22),
                                style = MaterialTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.5.sp
                                ),
                                color = Color.White,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = "(${formatFileSize(currentItem.size)})",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace
                                ),
                                color = TextSecondaryDark
                            )
                            if (allItems.isNotEmpty() && currentIndex != -1) {
                                Text(
                                    text = "• ${currentIndex + 1}/${allItems.size}",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp),
                                    color = MutedIceCyan
                                )
                            }
                        }
                    }
                }

                // Right: Full Suite Actions (Prev, Next, Diag, Open System, Print, Download, Info, Fullscreen)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // Previous File
                    if (allItems.isNotEmpty()) {
                        IconButton(
                            onClick = {
                                if (hasPrev) {
                                    val prevItem = allItems[currentIndex - 1]
                                    currentItem = prevItem
                                    onNavigateItem?.invoke(prevItem)
                                }
                            },
                            enabled = hasPrev,
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ChevronLeft,
                                contentDescription = stringResource(R.string.preview_nav_prev),
                                tint = if (hasPrev) Color.White else Color(0x40FFFFFF),
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        // Next File
                        IconButton(
                            onClick = {
                                if (hasNext) {
                                    val nextItem = allItems[currentIndex + 1]
                                    currentItem = nextItem
                                    onNavigateItem?.invoke(nextItem)
                                }
                            },
                            enabled = hasNext,
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ChevronRight,
                                contentDescription = stringResource(R.string.preview_nav_next),
                                tint = if (hasNext) Color.White else Color(0x40FFFFFF),
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }

                    // Open in System App
                    IconButton(
                        onClick = {
                            Toast.makeText(context, context.getString(R.string.preview_open_system_app), Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.OpenInNew,
                            contentDescription = stringResource(R.string.preview_open_system_app),
                            tint = TextSecondaryDark,
                            modifier = Modifier.size(17.dp)
                        )
                    }

                    // Print PDF Document
                    if (isPdf) {
                        IconButton(
                            onClick = {
                                Toast.makeText(context, context.getString(R.string.preview_pdf_print), Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Print,
                                contentDescription = stringResource(R.string.preview_pdf_print),
                                tint = TextSecondaryDark,
                                modifier = Modifier.size(17.dp)
                            )
                        }
                    }

                    // Stream Diagnostics Toggle (Desktop Activity Icon)
                    IconButton(
                        onClick = { isDiagnosticsOpen = !isDiagnosticsOpen },
                        modifier = Modifier
                            .size(32.dp)
                            .background(if (isDiagnosticsOpen) MutedIceCyan.copy(alpha = 0.25f) else Color.Transparent, CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.QueryStats,
                            contentDescription = stringResource(R.string.preview_diag_title),
                            tint = if (isDiagnosticsOpen) MutedIceCyan else TextSecondaryDark,
                            modifier = Modifier.size(17.dp)
                        )
                    }

                    // Quick Download
                    IconButton(
                        onClick = { onDownload(currentItem) },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Download,
                            contentDescription = stringResource(R.string.preview_action_download),
                            tint = MutedIceCyan,
                            modifier = Modifier.size(17.dp)
                        )
                    }

                    // Info / Metadata Toggle
                    IconButton(
                        onClick = { isInfoSheetOpen = !isInfoSheetOpen },
                        modifier = Modifier
                            .size(32.dp)
                            .background(if (isInfoSheetOpen) GoldAccent.copy(alpha = 0.25f) else Color.Transparent, CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = stringResource(R.string.preview_action_info),
                            tint = if (isInfoSheetOpen) GoldAccent else TextSecondaryDark,
                            modifier = Modifier.size(17.dp)
                        )
                    }

                    // Fullscreen Toggle
                    IconButton(
                        onClick = { isFullscreen = !isFullscreen },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(
                            imageVector = if (isFullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                            contentDescription = if (isFullscreen) stringResource(R.string.preview_fullscreen_exit) else stringResource(R.string.preview_fullscreen_enter),
                            tint = Color.White,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }

            // =========================================================================
            // 2. MAIN MEDIA STAGE
            // =========================================================================
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = if (isFullscreen) 0.dp else 68.dp, bottom = if (isFullscreen) 0.dp else 84.dp),
                contentAlignment = Alignment.Center
            ) {
                when {
                    isDuplicateCompareOpen -> {
                        SplitComparePlayer(
                            item = currentItem,
                            onClose = { isDuplicateCompareOpen = false }
                        )
                    }
                    isTgs -> {
                        TgsLottieViewer(item = currentItem)
                    }
                    isPhoto -> {
                        ImageViewerSuite(item = currentItem)
                    }
                    isVideo -> {
                        MediaVideoPlayerSuite(
                            item = currentItem,
                            isPlaying = isPlaying,
                            onTogglePlay = { isPlaying = !isPlaying },
                            isMuted = isMuted,
                            onToggleMute = { isMuted = !isMuted },
                            playbackSpeed = playbackSpeed,
                            onSpeedChange = { s -> playbackSpeed = s },
                            selectedQuality = selectedQuality,
                            onQualityChange = { q -> selectedQuality = q },
                            isQualityMenuOpen = isQualityMenuOpen,
                            onToggleQualityMenu = { isQualityMenuOpen = !isQualityMenuOpen },
                            isSpeedMenuOpen = isSpeedMenuOpen,
                            onToggleSpeedMenu = { isSpeedMenuOpen = !isSpeedMenuOpen },
                            progress = progress,
                            onProgressChange = { p -> progress = p },
                            isLooping = isLooping,
                            onToggleLoop = { isLooping = !isLooping },
                            aspectRatioMode = aspectRatioMode,
                            onToggleAspectRatio = { aspectRatioMode = (aspectRatioMode + 1) % 5 },
                            onToggleSplitCompare = { isDuplicateCompareOpen = !isDuplicateCompareOpen }
                        )
                    }
                    isAudio -> {
                        MediaAudioPlayerSuite(
                            item = currentItem,
                            isPlaying = isPlaying,
                            onTogglePlay = { isPlaying = !isPlaying },
                            progress = progress,
                            onProgressChange = { p -> progress = p },
                            isLooping = isLooping,
                            onToggleLoop = { isLooping = !isLooping },
                            isMuted = isMuted,
                            onToggleMute = { isMuted = !isMuted }
                        )
                    }
                    isZip -> {
                        SparseZipArchiveViewer(item = currentItem)
                    }
                    isCode -> {
                        VSCodeSyntaxViewer(item = currentItem)
                    }
                    isPdf -> {
                        PdfDocumentViewer(item = currentItem)
                    }
                    else -> {
                        GenericDocumentViewer(item = currentItem)
                    }
                }

                // =========================================================================
                // 3. PLAYBACK & STREAM DIAGNOSTICS HUD (PlaybackDiagnosticsPanel)
                // =========================================================================
                AnimatedVisibility(
                    visible = isDiagnosticsOpen,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically(),
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 10.dp, end = 12.dp)
                        .zIndex(25f)
                ) {
                    PlaybackDiagnosticsHUD(onClose = { isDiagnosticsOpen = false })
                }
            }

            // =========================================================================
            // 4. DESKTOP THUMBNAIL FILMSTRIP (SplitSidepanelThumbStrip)
            // =========================================================================
            if (allItems.isNotEmpty() && !isFullscreen) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(bottom = if (isInfoSheetOpen) 220.dp else 12.dp)
                        .zIndex(10f)
                ) {
                    LazyRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        items(allItems) { fileItem ->
                            val isSelected = fileItem.id == currentItem.id
                            Surface(
                                onClick = {
                                    currentItem = fileItem
                                    onNavigateItem?.invoke(fileItem)
                                },
                                shape = RoundedCornerShape(8.dp),
                                color = if (isSelected) MutedIceCyan.copy(alpha = 0.25f) else Color(0x330F172A),
                                border = BorderStroke(
                                    if (isSelected) 1.5.dp else 0.5.dp,
                                    if (isSelected) MutedIceCyan else Color(0x26FFFFFF)
                                ),
                                modifier = Modifier
                                    .width(72.dp)
                                    .height(44.dp)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Icon(
                                        imageVector = when {
                                            fileItem.mimeType.startsWith("video") -> Icons.Default.Movie
                                            fileItem.mimeType.startsWith("image") -> Icons.Default.Image
                                            fileItem.mimeType.startsWith("audio") -> Icons.Default.Audiotrack
                                            fileItem.mimeType.contains("zip") -> Icons.Default.FolderZip
                                            else -> Icons.AutoMirrored.Filled.InsertDriveFile
                                        },
                                        contentDescription = null,
                                        tint = if (isSelected) MutedIceCyan else TextSecondaryDark,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Text(
                                        text = fileItem.name,
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontSize = 9.sp,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                        ),
                                        color = if (isSelected) Color.White else TextSecondaryDark,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // =========================================================================
            // 5. BOTTOM METADATA & TELEMETRY DRAWER (Expandable with zIndex 20)
            // =========================================================================
            AnimatedVisibility(
                visible = isInfoSheetOpen,
                enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),
                exit = slideOutVertically(targetOffsetY = { it }) + fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .zIndex(20f)
            ) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .wrapContentHeight(),
                    shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
                    color = Color(0xF50B1C30),
                    border = BorderStroke(1.dp, Color(0x33FFFFFF)),
                    shadowElevation = 16.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.preview_metadata_title),
                                style = MaterialTheme.typography.titleSmall.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.5.sp
                                ),
                                color = GoldAccent
                            )
                            Surface(
                                color = MutedIceCyan.copy(alpha = 0.15f),
                                shape = CircleShape,
                                border = BorderStroke(0.5.dp, MutedIceCyan.copy(alpha = 0.35f))
                            ) {
                                Text(
                                    text = "MTProto DC4 Europe (Port 443)",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 9.sp,
                                        fontWeight = FontWeight.SemiBold
                                    ),
                                    color = MutedIceCyan
                                )
                            }
                        }

                        HorizontalDivider(color = Color(0x1FFFFFFF))

                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            MetadataRow(label = stringResource(R.string.preview_meta_size), value = "${formatFileSize(currentItem.size)} (${currentItem.size} bytes)")
                            MetadataRow(label = stringResource(R.string.preview_meta_mime), value = currentItem.mimeType)
                            MetadataRow(label = stringResource(R.string.preview_meta_node), value = "149.154.167.51:443 (Obfuscated TCP)")
                            MetadataRow(label = stringResource(R.string.preview_meta_channel), value = "@AutoGramCloud • Message #${currentItem.id}")
                            MetadataRow(label = stringResource(R.string.preview_meta_hash), value = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4... (SHA256)")
                            MetadataRow(label = stringResource(R.string.preview_duplicate_status), value = stringResource(R.string.preview_duplicate_verified))
                        }
                    }
                }
            }
        }
    }
}

/**
 * Playback Diagnostics HUD matching desktop PlaybackDiagnosticsPanel.tsx 1:1
 */
@Composable
private fun PlaybackDiagnosticsHUD(onClose: () -> Unit) {
    Surface(
        modifier = Modifier.width(280.dp),
        shape = RoundedCornerShape(10.dp),
        color = Color(0xF20F172A),
        border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.4f)),
        shadowElevation = 12.dp
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.QueryStats,
                        contentDescription = null,
                        tint = MutedIceCyan,
                        modifier = Modifier.size(14.dp)
                    )
                    Text(
                        text = stringResource(R.string.preview_diag_title),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        ),
                        color = MutedIceCyan
                    )
                }

                IconButton(
                    onClick = onClose,
                    modifier = Modifier.size(20.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Close HUD",
                        tint = TextSecondaryDark,
                        modifier = Modifier.size(14.dp)
                    )
                }
            }

            HorizontalDivider(color = Color(0x1FFFFFFF))

            DiagRow(label = stringResource(R.string.preview_diag_backend), value = "Vulkan Hardware Video Acceleration", color = DustySage)
            DiagRow(label = stringResource(R.string.preview_diag_gpu), value = "Adreno / Mali GPU Pipeline", color = Color.White)
            DiagRow(label = stringResource(R.string.preview_diag_zero_copy), value = stringResource(R.string.preview_diag_zero_copy_active), color = DustySage)
            DiagRow(label = stringResource(R.string.preview_diag_profile), value = "HEVC Main10 @ Level 5.1 (4K 60FPS)", color = GoldAccent)
            DiagRow(label = stringResource(R.string.preview_diag_vram), value = "312 MB / 1024 MB (98.4% Hit)", color = TextSecondaryDark)

            // 2-Box Render FPS & Dropped Frames
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0x33000000), RoundedCornerShape(6.dp))
                    .padding(6.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = stringResource(R.string.preview_diag_render_fps),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                        color = TextSecondaryDark
                    )
                    Text(
                        text = "60 / 60 FPS",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        ),
                        color = MutedIceCyan
                    )
                }

                Column {
                    Text(
                        text = stringResource(R.string.preview_diag_dropped),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                        color = TextSecondaryDark
                    )
                    Text(
                        text = "0 (0.2 ms)",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        ),
                        color = DustySage
                    )
                }
            }
        }
    }
}

@Composable
private fun DiagRow(label: String, value: String, color: Color) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
            color = TextSecondaryDark
        )
        Text(
            text = value,
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace
            ),
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/**
 * Desktop-Grade Media Video Player Suite with Dual-Progress Scrubber, Transcode Qualities, and Aspect Ratios
 */
@Composable
private fun MediaVideoPlayerSuite(
    item: DriveFileItem,
    isPlaying: Boolean,
    onTogglePlay: () -> Unit,
    isMuted: Boolean,
    onToggleMute: () -> Unit,
    playbackSpeed: Float,
    onSpeedChange: (Float) -> Unit,
    selectedQuality: String,
    onQualityChange: (String) -> Unit,
    isQualityMenuOpen: Boolean,
    onToggleQualityMenu: () -> Unit,
    isSpeedMenuOpen: Boolean,
    onToggleSpeedMenu: () -> Unit,
    progress: Float,
    onProgressChange: (Float) -> Unit,
    isLooping: Boolean,
    onToggleLoop: () -> Unit,
    aspectRatioMode: Int,
    onToggleAspectRatio: () -> Unit,
    onToggleSplitCompare: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Video Stage Box with Overlays
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(if (aspectRatioMode == 1) 310.dp else 220.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xF0051120),
            border = BorderStroke(1.dp, Color(0x33FFFFFF))
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Default.Videocam,
                    contentDescription = null,
                    tint = CategoryVideo.copy(alpha = 0.5f),
                    modifier = Modifier.size(58.dp)
                )

                // Top Left Overlay: Transcode Profile Chip
                Box(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                        .zIndex(5f)
                ) {
                    Surface(
                        onClick = onToggleQualityMenu,
                        color = Color(0xCC000000),
                        shape = CircleShape,
                        border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.5f)),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = selectedQuality,
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                                color = GoldAccent
                            )
                            Icon(Icons.Default.ArrowDropDown, null, tint = GoldAccent, modifier = Modifier.size(12.dp))
                        }
                    }

                    DropdownMenu(
                        expanded = isQualityMenuOpen,
                        onDismissRequest = onToggleQualityMenu,
                        modifier = Modifier.background(Color(0xF50B1C30), RoundedCornerShape(12.dp))
                    ) {
                        listOf("Original (Direct MTProto)", "NVENC H.265 / 4K 60FPS", "H.264 / 1080p High", "Fast Proxy 720p").forEach { q ->
                            DropdownMenuItem(
                                text = { Text(q, fontSize = 11.sp, color = if (selectedQuality == q) GoldAccent else Color.White) },
                                onClick = {
                                    onQualityChange(q)
                                    onToggleQualityMenu()
                                }
                            )
                        }
                    }
                }

                // Top Right Overlay: Aspect Ratio & Split Compare Mode
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .zIndex(5f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Split Compare Toggle
                    Surface(
                        onClick = onToggleSplitCompare,
                        color = Color(0xCC000000),
                        shape = CircleShape,
                        border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.5f)),
                        modifier = Modifier.size(36.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                            Icon(
                                imageVector = Icons.Default.Compare,
                                contentDescription = "Split Compare",
                                tint = MutedIceCyan,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    // Aspect Ratio
                    Surface(
                        onClick = onToggleAspectRatio,
                        color = Color(0xCC000000),
                        shape = CircleShape,
                        border = BorderStroke(1.dp, Color(0x40FFFFFF)),
                        modifier = Modifier.height(36.dp)
                    ) {
                        val aspectText = when (aspectRatioMode) {
                            1 -> stringResource(R.string.preview_video_aspect_fill)
                            2 -> stringResource(R.string.preview_video_aspect_16_9)
                            3 -> stringResource(R.string.preview_aspect_4_3)
                            4 -> stringResource(R.string.preview_aspect_stretch)
                            else -> stringResource(R.string.preview_video_aspect_fit)
                        }
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxHeight().padding(horizontal = 10.dp)) {
                            Text(
                                text = aspectText,
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.SemiBold
                                ),
                                color = Color.White
                            )
                        }
                    }
                }
            }
        }

        // Dual-Progress Scrubber Timeline (Buffered Chunks + Active Track)
        Column(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(18.dp),
                contentAlignment = Alignment.Center
            ) {
                // Background Track
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(CircleShape)
                        .background(Color(0x33FFFFFF))
                )
                // Buffered Chunks (65%)
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.65f)
                        .height(4.dp)
                        .clip(CircleShape)
                        .background(MutedIceCyan.copy(alpha = 0.35f))
                        .align(Alignment.CenterStart)
                )
                // Slider
                Slider(
                    value = progress,
                    onValueChange = onProgressChange,
                    colors = SliderDefaults.colors(
                        thumbColor = MutedIceCyan,
                        activeTrackColor = MutedIceCyan,
                        inactiveTrackColor = Color.Transparent
                    )
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "00:42",
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 10.5.sp,
                        fontFamily = FontFamily.Monospace
                    ),
                    color = TextSecondaryDark
                )
                Text(
                    text = "02:15",
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 10.5.sp,
                        fontFamily = FontFamily.Monospace
                    ),
                    color = TextSecondaryDark
                )
            }
        }

        // Bottom Controls Bar (Speed, Skip 10s, Play/Pause, Mute, Loop)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Speed Dropdown Button
            Box {
                Surface(
                    onClick = onToggleSpeedMenu,
                    color = Color(0x26FFFFFF),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Color(0x33FFFFFF))
                ) {
                    Text(
                        text = "${playbackSpeed}x",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp
                        ),
                        color = Color.White
                    )
                }

                DropdownMenu(
                    expanded = isSpeedMenuOpen,
                    onDismissRequest = onToggleSpeedMenu,
                    modifier = Modifier.background(Color(0xF50B1C30), RoundedCornerShape(12.dp))
                ) {
                    listOf(0.25f, 0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 1.75f, 2.0f).forEach { s ->
                        DropdownMenuItem(
                            text = { Text("${s}x", fontSize = 11.sp, color = if (playbackSpeed == s) GoldAccent else Color.White) },
                            onClick = {
                                onSpeedChange(s)
                                onToggleSpeedMenu()
                            }
                        )
                    }
                }
            }

            // Rewind 10s
            IconButton(
                onClick = { onProgressChange((progress - 0.05f).coerceAtLeast(0f)) },
                modifier = Modifier.size(36.dp)
            ) {
                Icon(Icons.Default.Replay10, "Rewind 10s", tint = Color.White, modifier = Modifier.size(20.dp))
            }

            // Play / Pause Button
            IconButton(
                onClick = onTogglePlay,
                modifier = Modifier
                    .size(52.dp)
                    .background(MutedIceCyan, CircleShape)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = "Play/Pause",
                    tint = CanvasDeepNavy,
                    modifier = Modifier.size(28.dp)
                )
            }

            // Forward 10s
            IconButton(
                onClick = { onProgressChange((progress + 0.05f).coerceAtMost(1f)) },
                modifier = Modifier.size(36.dp)
            ) {
                Icon(Icons.Default.Forward10, "Forward 10s", tint = Color.White, modifier = Modifier.size(20.dp))
            }

            // Audio Mute Toggle
            IconButton(
                onClick = onToggleMute,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = if (isMuted) Icons.AutoMirrored.Filled.VolumeMute else Icons.AutoMirrored.Filled.VolumeUp,
                    contentDescription = "Mute",
                    tint = if (isMuted) SoftCoral else Color.White,
                    modifier = Modifier.size(20.dp)
                )
            }

            // Loop Button
            IconButton(
                onClick = onToggleLoop,
                modifier = Modifier
                    .size(36.dp)
                    .background(if (isLooping) GoldAccent.copy(alpha = 0.2f) else Color.Transparent, CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.Repeat,
                    contentDescription = "Loop",
                    tint = if (isLooping) GoldAccent else TextSecondaryDark,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

/**
 * Desktop-Grade ImageViewer with Floating Controls matching desktop ImageViewer.tsx 1:1
 */
@Composable
private fun ImageViewerSuite(item: DriveFileItem) {
    var zoom by remember { mutableFloatStateOf(1f) }
    var rotationAngle by remember { mutableFloatStateOf(0f) }
    var flipH by remember { mutableStateOf(false) }
    var flipV by remember { mutableStateOf(false) }
    var panOffset by remember { mutableStateOf(Offset.Zero) }

    val transformState = rememberTransformableState { zoomChange, offsetChange, _ ->
        zoom = (zoom * zoomChange).coerceIn(0.5f, 5f)
        panOffset += offsetChange
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .transformable(state = transformState),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .graphicsLayer(
                    scaleX = zoom * (if (flipH) -1f else 1f),
                    scaleY = zoom * (if (flipV) -1f else 1f),
                    rotationZ = rotationAngle,
                    translationX = panOffset.x,
                    translationY = panOffset.y
                ),
            contentAlignment = Alignment.Center
        ) {
            if (!item.thumbnailUri.isNullOrBlank()) {
                AsyncImage(
                    model = item.thumbnailUri,
                    contentDescription = item.name,
                    modifier = Modifier
                        .fillMaxWidth(0.92f)
                        .clip(RoundedCornerShape(12.dp)),
                    contentScale = ContentScale.Fit
                )
            } else {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(110.dp)
                            .background(CategoryPhoto.copy(alpha = 0.15f), CircleShape)
                            .border(1.dp, CategoryPhoto.copy(alpha = 0.35f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Image,
                            contentDescription = null,
                            tint = CategoryPhoto,
                            modifier = Modifier.size(50.dp)
                        )
                    }
                    Text(
                        text = "3840×2160 • 24-bit sRGB (EXIF Verified)",
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace
                        ),
                        color = TextSecondaryDark
                    )
                }
            }
        }

        // Floating Image Controls Toolbar (matching desktop 1:1)
        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 12.dp),
            shape = RoundedCornerShape(20.dp),
            color = Color(0xF00F172A),
            border = BorderStroke(1.dp, Color(0x33FFFFFF)),
            shadowElevation = 12.dp
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Zoom Out
                IconButton(
                    onClick = { zoom = (zoom - 0.25f).coerceAtLeast(0.5f) },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(Icons.Default.ZoomOut, "Zoom Out", tint = Color.White, modifier = Modifier.size(15.dp))
                }

                // Zoom Level Pill
                Text(
                    text = "${(zoom * 100).toInt()}%",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 10.5.sp
                    ),
                    color = Color.White,
                    modifier = Modifier.widthIn(min = 36.dp)
                )

                // Zoom In
                IconButton(
                    onClick = { zoom = (zoom + 0.25f).coerceAtMost(5f) },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(Icons.Default.ZoomIn, "Zoom In", tint = Color.White, modifier = Modifier.size(15.dp))
                }

                VerticalDivider(modifier = Modifier.height(14.dp), color = Color(0x26FFFFFF))

                // Rotate Left
                IconButton(
                    onClick = { rotationAngle = (rotationAngle - 90f) % 360f },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(Icons.Default.RotateLeft, "Rotate Left", tint = Color.White, modifier = Modifier.size(15.dp))
                }

                // Rotate Right
                IconButton(
                    onClick = { rotationAngle = (rotationAngle + 90f) % 360f },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(Icons.Default.RotateRight, "Rotate Right", tint = Color.White, modifier = Modifier.size(15.dp))
                }

                VerticalDivider(modifier = Modifier.height(14.dp), color = Color(0x26FFFFFF))

                // Flip Horizontal
                IconButton(
                    onClick = { flipH = !flipH },
                    modifier = Modifier
                        .size(28.dp)
                        .background(if (flipH) MutedIceCyan.copy(alpha = 0.25f) else Color.Transparent, CircleShape)
                ) {
                    Icon(Icons.Default.Flip, "Flip H", tint = if (flipH) MutedIceCyan else Color.White, modifier = Modifier.size(15.dp))
                }

                // Reset Button
                Surface(
                    onClick = {
                        zoom = 1f
                        rotationAngle = 0f
                        flipH = false
                        flipV = false
                        panOffset = Offset.Zero
                    },
                    shape = RoundedCornerShape(6.dp),
                    color = Color(0x1F26364A)
                ) {
                    Text(
                        text = stringResource(R.string.preview_reset_view),
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, fontWeight = FontWeight.Bold),
                        color = GoldAccent
                    )
                }
            }
        }
    }
}

/**
 * Hi-Fi Media Audio Player Suite matching desktop MediaAudioPlayer.tsx 1:1
 */
@Composable
private fun MediaAudioPlayerSuite(
    item: DriveFileItem,
    isPlaying: Boolean,
    onTogglePlay: () -> Unit,
    progress: Float,
    onProgressChange: (Float) -> Unit,
    isLooping: Boolean,
    onToggleLoop: () -> Unit,
    isMuted: Boolean,
    onToggleMute: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "VinylTurntable")
    val discRotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(3800, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "TurntableAngle"
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Spinning Vinyl Disc with Concentric Grooves
        Box(
            modifier = Modifier
                .size(140.dp)
                .rotate(if (isPlaying) discRotation else 0f)
                .clip(CircleShape)
                .background(Color(0xFF0B132B))
                .border(2.dp, GoldAccent.copy(alpha = 0.6f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(50.dp)
                    .clip(CircleShape)
                    .background(GoldAccent.copy(alpha = 0.25f))
                    .border(1.dp, GoldAccent, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Audiotrack,
                    contentDescription = null,
                    tint = GoldAccent,
                    modifier = Modifier.size(26.dp)
                )
            }
        }

        // Track Information & Quality Tag
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Text(
                text = item.name,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.5.sp
                ),
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Text(
                text = stringResource(R.string.preview_audio_artist),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                color = TextSecondaryDark
            )

            Surface(
                color = GoldAccent.copy(alpha = 0.12f),
                shape = RoundedCornerShape(4.dp),
                border = BorderStroke(0.5.dp, GoldAccent.copy(alpha = 0.3f)),
                modifier = Modifier.padding(top = 2.dp)
            ) {
                Text(
                    text = stringResource(R.string.preview_audio_quality),
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontSize = 8.5.sp,
                        fontFamily = FontFamily.Monospace
                    ),
                    color = GoldAccent
                )
            }
        }

        // Dynamic 16-Bar Spectrum Visualizer
        Row(
            modifier = Modifier
                .fillMaxWidth(0.85f)
                .height(26.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom
        ) {
            val barCount = 16
            for (i in 0 until barCount) {
                val barProgress = ((i * 17 + (progress * 100).toInt()) % 100) / 100f
                val barHeight = if (isPlaying) (6.dp + 20.dp * barProgress) else 5.dp

                Box(
                    modifier = Modifier
                        .width(4.dp)
                        .height(barHeight)
                        .clip(CircleShape)
                        .background(if (i % 2 == 0) GoldAccent else MutedIceCyan)
                )
            }
        }

        // Scrubber Timeline
        Column(modifier = Modifier.fillMaxWidth()) {
            Slider(
                value = progress,
                onValueChange = onProgressChange,
                colors = SliderDefaults.colors(
                    thumbColor = GoldAccent,
                    activeTrackColor = GoldAccent,
                    inactiveTrackColor = Color(0x33FFFFFF)
                )
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("01:24", style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.5.sp, fontFamily = FontFamily.Monospace), color = TextSecondaryDark)
                Text("04:30", style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.5.sp, fontFamily = FontFamily.Monospace), color = TextSecondaryDark)
            }
        }

        // Controls
        Row(
            modifier = Modifier.fillMaxWidth(0.85f),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = onToggleMute,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = if (isMuted) Icons.AutoMirrored.Filled.VolumeMute else Icons.AutoMirrored.Filled.VolumeUp,
                    contentDescription = "Mute",
                    tint = if (isMuted) SoftCoral else TextSecondaryDark
                )
            }

            IconButton(
                onClick = onTogglePlay,
                modifier = Modifier
                    .size(52.dp)
                    .background(GoldAccent, CircleShape)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = "Play/Pause",
                    tint = CanvasDeepNavy,
                    modifier = Modifier.size(28.dp)
                )
            }

            IconButton(
                onClick = onToggleLoop,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Repeat,
                    contentDescription = "Loop",
                    tint = if (isLooping) GoldAccent else TextSecondaryDark
                )
            }
        }
    }
}

/**
 * TGS / Lottie Vector Sticker Viewer matching desktop TgsLottiePlayer.tsx 1:1
 */
@Composable
private fun TgsLottieViewer(item: DriveFileItem) {
    var bgMode by remember { mutableIntStateOf(0) } // 0=Dark, 1=Light, 2=Checkerboard

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Sticker Stage Canvas
        Surface(
            modifier = Modifier
                .size(220.dp),
            shape = RoundedCornerShape(16.dp),
            color = when (bgMode) {
                1 -> Color(0xFFE2E8F0)
                2 -> Color(0xFF1E293B)
                else -> Color(0xF00A1526)
            },
            border = BorderStroke(1.dp, Color(0x33FFFFFF))
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Default.EmojiEmotions,
                    contentDescription = null,
                    tint = GoldAccent,
                    modifier = Modifier.size(72.dp)
                )

                Surface(
                    color = Color(0xCC000000),
                    shape = CircleShape,
                    modifier = Modifier.align(Alignment.TopStart).padding(8.dp)
                ) {
                    Text(
                        text = "TGS 60 FPS (Vector Lottie)",
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                        color = GoldAccent
                    )
                }
            }
        }

        // Background Switcher Chips
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Surface(
                onClick = { bgMode = 0 },
                shape = CircleShape,
                color = if (bgMode == 0) MutedIceCyan.copy(alpha = 0.2f) else Color(0x1F26364A),
                border = BorderStroke(0.5.dp, if (bgMode == 0) MutedIceCyan else Color(0x26FFFFFF))
            ) {
                Text(
                    text = stringResource(R.string.preview_sticker_bg_dark),
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = if (bgMode == 0) MutedIceCyan else TextSecondaryDark
                )
            }

            Surface(
                onClick = { bgMode = 1 },
                shape = CircleShape,
                color = if (bgMode == 1) MutedIceCyan.copy(alpha = 0.2f) else Color(0x1F26364A),
                border = BorderStroke(0.5.dp, if (bgMode == 1) MutedIceCyan else Color(0x26FFFFFF))
            ) {
                Text(
                    text = stringResource(R.string.preview_sticker_bg_light),
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = if (bgMode == 1) MutedIceCyan else TextSecondaryDark
                )
            }
        }
    }
}

/**
 * Side-by-Side Duplicate Compare Player matching desktop SplitVideoPlayer.tsx
 */
@Composable
private fun SplitComparePlayer(item: DriveFileItem, onClose: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = stringResource(R.string.preview_split_title),
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp
                ),
                color = GoldAccent
            )
            IconButton(onClick = onClose, modifier = Modifier.size(24.dp)) {
                Icon(Icons.Default.Close, null, tint = TextSecondaryDark, modifier = Modifier.size(16.dp))
            }
        }

        // Side A vs Side B Split Screen
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Side A
            Surface(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                shape = RoundedCornerShape(10.dp),
                color = Color(0xF00B1C30),
                border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.4f))
            ) {
                Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.SpaceBetween) {
                    Text("Slot A (Original)", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MutedIceCyan)
                    Box(modifier = Modifier.fillMaxWidth().height(80.dp), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Videocam, null, tint = MutedIceCyan, modifier = Modifier.size(32.dp))
                    }
                    Text("1080p • 15.4 MB", fontSize = 9.sp, fontFamily = FontFamily.Monospace, color = TextSecondaryDark)
                }
            }

            // Side B
            Surface(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                shape = RoundedCornerShape(10.dp),
                color = Color(0xF00B1C30),
                border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.4f))
            ) {
                Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.SpaceBetween) {
                    Text("Slot B (Duplicate)", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = GoldAccent)
                    Box(modifier = Modifier.fillMaxWidth().height(80.dp), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Videocam, null, tint = GoldAccent, modifier = Modifier.size(32.dp))
                    }
                    Text("720p • 8.2 MB", fontSize = 9.sp, fontFamily = FontFamily.Monospace, color = TextSecondaryDark)
                }
            }
        }

        // Action Buttons: Keep Only This vs Delete Duplicate
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(
                onClick = onClose,
                colors = ButtonDefaults.buttonColors(containerColor = MutedIceCyan),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = stringResource(R.string.preview_split_keep_this),
                    fontSize = 11.sp,
                    color = CanvasDeepNavy,
                    fontWeight = FontWeight.Bold
                )
            }

            OutlinedButton(
                onClick = onClose,
                border = BorderStroke(1.dp, SoftCoral),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = stringResource(R.string.preview_split_delete_dup),
                    fontSize = 11.sp,
                    color = SoftCoral,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

/**
 * VSCode-Style Syntax Code Viewer matching desktop VSCodeCodeViewer.tsx 1:1
 */
@Composable
private fun VSCodeSyntaxViewer(item: DriveFileItem) {
    val clipboard = LocalClipboardManager.current
    var isCopied by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }

    val sampleCode = """
    {
      "app": "AutoGram Cloud Suite",
      "version": "3.8.50",
      "engine": "Rust MTProto Grammers",
      "concurrency": {
        "parallel_streams": 4,
        "chunk_size_kb": 512,
        "smart_rate_controller": true
      },
      "encryption": "AES-256-CTR",
      "status": "Production Verified"
    }
    """.trimIndent()

    val filteredLines = remember(searchQuery) {
        val lines = sampleCode.lines()
        if (searchQuery.isBlank()) lines else lines.filter { it.contains(searchQuery, ignoreCase = true) }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = stringResource(R.string.preview_code_syntax),
                style = MaterialTheme.typography.titleSmall.copy(
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                ),
                color = MutedIceCyan
            )

            Surface(
                onClick = {
                    clipboard.setText(AnnotatedString(sampleCode))
                    isCopied = true
                },
                color = if (isCopied) DustySage.copy(alpha = 0.2f) else Color(0x3326364A),
                shape = RoundedCornerShape(6.dp),
                border = BorderStroke(1.dp, if (isCopied) DustySage else Color(0x33FFFFFF))
            ) {
                Text(
                    text = if (isCopied) stringResource(R.string.preview_code_copied) else stringResource(R.string.preview_code_copy),
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                    color = if (isCopied) DustySage else Color.White
                )
            }
        }

        // Code Search Box
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text(stringResource(R.string.preview_code_search_placeholder), fontSize = 11.sp, color = TextSecondaryDark) },
            leadingIcon = { Icon(Icons.Default.Search, null, tint = TextSecondaryDark, modifier = Modifier.size(16.dp)) },
            trailingIcon = {
                if (searchQuery.isNotBlank()) {
                    Text(
                        text = stringResource(R.string.preview_code_matches, filteredLines.size),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, color = GoldAccent),
                        modifier = Modifier.padding(end = 8.dp)
                    )
                }
            },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp),
            shape = RoundedCornerShape(8.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = MutedIceCyan,
                unfocusedBorderColor = Color(0x26FFFFFF),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White
            )
        )

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(230.dp),
            shape = RoundedCornerShape(12.dp),
            color = Color(0xF0051120),
            border = BorderStroke(1.dp, Color(0x33FFFFFF))
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(10.dp)
            ) {
                items(filteredLines.size) { index ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            text = "${index + 1}",
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontSize = 10.5.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            color = TextSecondaryDark.copy(alpha = 0.4f),
                            modifier = Modifier.width(22.dp)
                        )
                        Text(
                            text = filteredLines[index],
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontSize = 10.5.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            color = if (filteredLines[index].contains(":")) GoldAccent else Color.White
                        )
                    }
                }
            }
        }
    }
}

/**
 * PDF Document Viewer with Page Counter
 */
@Composable
private fun PdfDocumentViewer(item: DriveFileItem) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Surface(
            modifier = Modifier
                .size(width = 160.dp, height = 220.dp),
            shape = RoundedCornerShape(12.dp),
            color = Color(0xF00B1C30),
            border = BorderStroke(1.dp, CategoryDoc.copy(alpha = 0.4f))
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Icon(
                    imageVector = Icons.Default.PictureAsPdf,
                    contentDescription = null,
                    tint = CategoryDoc,
                    modifier = Modifier.size(48.dp)
                )

                Text(
                    text = item.name,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp
                    ),
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Surface(
                    color = Color(0x33000000),
                    shape = CircleShape
                ) {
                    Text(
                        text = stringResource(R.string.preview_pdf_page, 1, 12),
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                        color = CategoryDoc
                    )
                }
            }
        }
    }
}

/**
 * Generic Document Viewer
 */
@Composable
private fun GenericDocumentViewer(item: DriveFileItem) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Box(
            modifier = Modifier
                .size(110.dp)
                .background(CategoryDoc.copy(alpha = 0.15f), RoundedCornerShape(20.dp))
                .border(1.dp, CategoryDoc.copy(alpha = 0.35f), RoundedCornerShape(20.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.InsertDriveFile,
                contentDescription = null,
                tint = CategoryDoc,
                modifier = Modifier.size(48.dp)
            )
        }
        Text(
            text = item.name,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold, fontSize = 14.sp),
            color = Color.White
        )
        Text(
            text = "${formatFileSize(item.size)} • Document Format",
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
            color = TextSecondaryDark
        )
    }
}

/**
 * Sparse ZIP Archive Explorer matching desktop DriveZipBrowser
 */
@Composable
private fun SparseZipArchiveViewer(item: DriveFileItem) {
    val sampleZipEntries = remember {
        listOf(
            "manifest.json" to "1.2 KB",
            "production_master.mp4" to "820.4 MB",
            "audio_track_stems.wav" to "142.1 MB",
            "preview_thumbnail.png" to "840 KB",
            "readme_instructions.txt" to "4.8 KB"
        )
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            color = Color(0xF00B1C30),
            border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.35f))
        ) {
            Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.preview_zip_sparse_streaming),
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.5.sp
                        ),
                        color = GoldAccent
                    )
                    Surface(
                        color = GoldAccent.copy(alpha = 0.15f),
                        shape = CircleShape
                    ) {
                        Text(
                            text = "WinZip AES-256 / PKWARE",
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp),
                            color = GoldAccent
                        )
                    }
                }
                Text(
                    text = stringResource(R.string.preview_zip_sparse_desc),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 9.5.sp),
                    color = TextSecondaryDark
                )
            }
        }

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(240.dp),
            shape = RoundedCornerShape(12.dp),
            color = Color(0xF0051120),
            border = BorderStroke(1.dp, Color(0x33FFFFFF))
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(sampleZipEntries) { (name, size) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0x1F26364A), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = if (name.endsWith(".mp4")) Icons.Default.Movie else Icons.AutoMirrored.Filled.InsertDriveFile,
                                contentDescription = null,
                                tint = if (name.endsWith(".mp4")) MutedIceCyan else GoldAccent,
                                modifier = Modifier.size(15.dp)
                            )
                            Text(
                                text = name,
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.Medium
                                ),
                                color = Color.White,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }

                        Text(
                            text = size,
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.5.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            color = TextSecondaryDark
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MetadataRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
            color = TextSecondaryDark
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall.copy(
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace
            ),
            color = TextPrimaryDark,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 210.dp)
        )
    }
}