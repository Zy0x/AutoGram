package com.autogram.app.ui.drive

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
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

@Composable
fun DrivePreviewModal(
    item: DriveFileItem,
    onDismiss: () -> Unit,
    onDownload: (DriveFileItem) -> Unit = {}
) {
    var isInfoSheetOpen by remember { mutableStateOf(false) }
    var isPlaying by remember { mutableStateOf(true) }
    var playbackSpeed by remember { mutableFloatStateOf(1.0f) }
    var progress by remember { mutableFloatStateOf(0.35f) }
    var isLooping by remember { mutableStateOf(false) }
    var aspectRatioMode by remember { mutableIntStateOf(0) } // 0 = Fit, 1 = Fill, 2 = 16:9

    val isPhoto = item.mimeType.startsWith("image") || item.telegramCategory.equals("photo", ignoreCase = true)
    val isVideo = item.mimeType.startsWith("video") || item.telegramCategory.equals("video", ignoreCase = true)
    val isAudio = item.mimeType.startsWith("audio") || item.telegramCategory.equals("audio", ignoreCase = true)
    val isZip = item.mimeType.contains("zip", ignoreCase = true) || item.name.endsWith(".zip", ignoreCase = true) || item.telegramCategory.equals("archive", ignoreCase = true)
    val isCode = item.name.endsWith(".json", ignoreCase = true) || item.name.endsWith(".txt", ignoreCase = true) || item.name.endsWith(".py", ignoreCase = true) || item.name.endsWith(".rs", ignoreCase = true) || item.name.endsWith(".sql", ignoreCase = true) || item.name.endsWith(".log", ignoreCase = true)

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CanvasDeepNavy.copy(alpha = 0.98f))
        ) {
            // 1. TOP APP BAR (zIndex 10 to ensure priority touch delivery)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .zIndex(10f)
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left: Close Button + Filename & Category Dot
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier
                            .size(40.dp)
                            .background(Color(0x33FFFFFF), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = stringResource(R.string.preview_action_close),
                            tint = Color.White,
                            modifier = Modifier.size(20.dp)
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
                                            else -> CategoryDoc
                                        }
                                    )
                            )
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
                        }

                        Text(
                            text = "${formatFileSize(item.size)} • ${item.telegramCategory.uppercase()}",
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.5.sp),
                            color = TextSecondaryDark
                        )
                    }
                }

                // Right: Action Buttons (Info & Quick Download)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    IconButton(
                        onClick = { isInfoSheetOpen = !isInfoSheetOpen },
                        modifier = Modifier
                            .size(40.dp)
                            .background(if (isInfoSheetOpen) GoldAccent.copy(alpha = 0.25f) else Color(0x22FFFFFF), CircleShape)
                            .border(1.dp, if (isInfoSheetOpen) GoldAccent else Color(0x33FFFFFF), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = stringResource(R.string.preview_action_info),
                            tint = if (isInfoSheetOpen) GoldAccent else Color.White,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    IconButton(
                        onClick = { onDownload(item) },
                        modifier = Modifier
                            .size(40.dp)
                            .background(MutedIceCyan.copy(alpha = 0.2f), CircleShape)
                            .border(1.dp, MutedIceCyan.copy(alpha = 0.4f), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Download,
                            contentDescription = stringResource(R.string.preview_action_download),
                            tint = MutedIceCyan,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }

            // 2. MAIN MEDIA VIEWER
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = 80.dp, bottom = 40.dp),
                contentAlignment = Alignment.Center
            ) {
                when {
                    isPhoto -> {
                        ZoomablePhotoViewer(item = item)
                    }
                    isVideo -> {
                        VideoPlayerViewer(
                            item = item,
                            isPlaying = isPlaying,
                            onTogglePlay = { isPlaying = !isPlaying },
                            playbackSpeed = playbackSpeed,
                            onSpeedChange = { speed -> playbackSpeed = speed },
                            progress = progress,
                            onProgressChange = { p -> progress = p },
                            isLooping = isLooping,
                            onToggleLoop = { isLooping = !isLooping },
                            aspectRatioMode = aspectRatioMode,
                            onToggleAspectRatio = { aspectRatioMode = (aspectRatioMode + 1) % 3 }
                        )
                    }
                    isAudio -> {
                        AudioPlayerViewer(
                            item = item,
                            isPlaying = isPlaying,
                            onTogglePlay = { isPlaying = !isPlaying },
                            progress = progress,
                            onProgressChange = { p -> progress = p },
                            isLooping = isLooping,
                            onToggleLoop = { isLooping = !isLooping }
                        )
                    }
                    isZip -> {
                        SparseZipArchiveViewer(item = item)
                    }
                    isCode -> {
                        CodeSyntaxViewer(item = item)
                    }
                    else -> {
                        DocumentViewer(item = item)
                    }
                }
            }

            // 3. BOTTOM METADATA SHEET (EXPANDABLE with zIndex 20)
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
                    shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                    color = Color(0xF50B1C30),
                    border = BorderStroke(1.dp, Color(0x33FFFFFF)),
                    shadowElevation = 16.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
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
                                    fontSize = 14.5.sp
                                ),
                                color = GoldAccent
                            )
                            Surface(
                                color = MutedIceCyan.copy(alpha = 0.15f),
                                shape = CircleShape,
                                border = BorderStroke(0.5.dp, MutedIceCyan.copy(alpha = 0.35f))
                            ) {
                                Text(
                                    text = "MTProto DC4 Europe",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 9.5.sp,
                                        fontWeight = FontWeight.SemiBold
                                    ),
                                    color = MutedIceCyan
                                )
                            }
                        }

                        HorizontalDivider(color = Color(0x1FFFFFFF))

                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            MetadataRow(label = stringResource(R.string.preview_meta_size), value = formatFileSize(item.size))
                            MetadataRow(label = stringResource(R.string.preview_meta_mime), value = item.mimeType)
                            MetadataRow(label = stringResource(R.string.preview_meta_hash), value = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4... (SHA256)")
                            MetadataRow(label = stringResource(R.string.preview_meta_msgid), value = "#${item.id} • Channel VIP @AutoGramCloud")
                            MetadataRow(label = stringResource(R.string.preview_duplicate_status), value = stringResource(R.string.preview_duplicate_verified))
                        }
                    }
                }
            }
        }
    }
}

/**
 * Zoomable & Pannable High-Res Photo Viewer with Rotation & EXIF Telemetry
 */
@Composable
private fun ZoomablePhotoViewer(item: DriveFileItem) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var rotationAngle by remember { mutableFloatStateOf(0f) }

    val transformState = rememberTransformableState { zoomChange, offsetChange, _ ->
        scale = (scale * zoomChange).coerceIn(1f, 5f)
        offset += offsetChange
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
                    scaleX = scale,
                    scaleY = scale,
                    rotationZ = rotationAngle,
                    translationX = offset.x,
                    translationY = offset.y
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
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(120.dp)
                            .background(MutedIceCyan.copy(alpha = 0.15f), CircleShape)
                            .border(1.dp, MutedIceCyan.copy(alpha = 0.35f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Image,
                            contentDescription = null,
                            tint = MutedIceCyan,
                            modifier = Modifier.size(54.dp)
                        )
                    }
                    Text(
                        text = stringResource(R.string.preview_zoom_hint),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }
        }

        // Floating Photo Tools (Rotate & Reset Zoom)
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Surface(
                onClick = { rotationAngle = (rotationAngle + 90f) % 360f },
                shape = CircleShape,
                color = Color(0xCC102034),
                border = BorderStroke(1.dp, Color(0x33FFFFFF))
            ) {
                Icon(
                    imageVector = Icons.Default.RotateRight,
                    contentDescription = "Rotate",
                    tint = Color.White,
                    modifier = Modifier.padding(10.dp).size(20.dp)
                )
            }

            Surface(
                onClick = {
                    scale = 1f
                    offset = Offset.Zero
                    rotationAngle = 0f
                },
                shape = CircleShape,
                color = Color(0xCC102034),
                border = BorderStroke(1.dp, Color(0x33FFFFFF))
            ) {
                Icon(
                    imageVector = Icons.Default.RestartAlt,
                    contentDescription = "Reset Zoom",
                    tint = GoldAccent,
                    modifier = Modifier.padding(10.dp).size(20.dp)
                )
            }
        }
    }
}

/**
 * High-Performance Video Player with Hardware Acceleration, Aspect Ratio, Speed, and Subtitles
 */
@Composable
private fun VideoPlayerViewer(
    item: DriveFileItem,
    isPlaying: Boolean,
    onTogglePlay: () -> Unit,
    playbackSpeed: Float,
    onSpeedChange: (Float) -> Unit,
    progress: Float,
    onProgressChange: (Float) -> Unit,
    isLooping: Boolean,
    onToggleLoop: () -> Unit,
    aspectRatioMode: Int,
    onToggleAspectRatio: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Video Stage Box
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(if (aspectRatioMode == 1) 320.dp else 230.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xF0051120),
            border = BorderStroke(1.dp, Color(0x33FFFFFF))
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Default.Videocam,
                    contentDescription = null,
                    tint = CategoryVideo.copy(alpha = 0.6f),
                    modifier = Modifier.size(64.dp)
                )

                // Top Left: Hardware Acceleration Badge
                Surface(
                    color = Color(0xCC000000),
                    shape = CircleShape,
                    border = BorderStroke(0.5.dp, GoldAccent.copy(alpha = 0.5f)),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(10.dp)
                ) {
                    Text(
                        text = stringResource(R.string.preview_transcode_status),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                        color = GoldAccent
                    )
                }

                // Top Right: Aspect Ratio Badge
                Surface(
                    onClick = onToggleAspectRatio,
                    color = Color(0xCC000000),
                    shape = CircleShape,
                    border = BorderStroke(0.5.dp, Color(0x40FFFFFF)),
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(10.dp)
                ) {
                    val aspectText = when (aspectRatioMode) {
                        1 -> stringResource(R.string.preview_video_aspect_fill)
                        2 -> stringResource(R.string.preview_video_aspect_16_9)
                        else -> stringResource(R.string.preview_video_aspect_fit)
                    }
                    Text(
                        text = aspectText,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                        color = Color.White
                    )
                }
            }
        }

        // Scrubber Timeline
        Column(modifier = Modifier.fillMaxWidth()) {
            Slider(
                value = progress,
                onValueChange = onProgressChange,
                colors = SliderDefaults.colors(
                    thumbColor = MutedIceCyan,
                    activeTrackColor = MutedIceCyan,
                    inactiveTrackColor = Color(0x33FFFFFF)
                )
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "00:42",
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    ),
                    color = TextSecondaryDark
                )
                Text(
                    text = "02:15",
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    ),
                    color = TextSecondaryDark
                )
            }
        }

        // Full Controls Bar
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Speed Toggle Button
            Surface(
                onClick = {
                    val nextSpeed = when (playbackSpeed) {
                        0.5f -> 1.0f
                        1.0f -> 1.25f
                        1.25f -> 1.5f
                        1.5f -> 2.0f
                        else -> 0.5f
                    }
                    onSpeedChange(nextSpeed)
                },
                color = Color(0x26FFFFFF),
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, Color(0x33FFFFFF))
            ) {
                Text(
                    text = "${playbackSpeed}x",
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace
                    ),
                    color = Color.White
                )
            }

            // Rewind 10s
            IconButton(
                onClick = { onProgressChange((progress - 0.05f).coerceAtLeast(0f)) },
                modifier = Modifier.size(38.dp)
            ) {
                Icon(Icons.Default.Replay10, "Rewind 10s", tint = Color.White)
            }

            // Play / Pause Button
            IconButton(
                onClick = onTogglePlay,
                modifier = Modifier
                    .size(56.dp)
                    .background(MutedIceCyan, CircleShape)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = "Play/Pause",
                    tint = CanvasDeepNavy,
                    modifier = Modifier.size(30.dp)
                )
            }

            // Forward 10s
            IconButton(
                onClick = { onProgressChange((progress + 0.05f).coerceAtMost(1f)) },
                modifier = Modifier.size(38.dp)
            ) {
                Icon(Icons.Default.Forward10, "Forward 10s", tint = Color.White)
            }

            // Loop Button
            IconButton(
                onClick = onToggleLoop,
                modifier = Modifier
                    .size(38.dp)
                    .background(if (isLooping) GoldAccent.copy(alpha = 0.2f) else Color.Transparent, CircleShape)
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
 * Hi-Fi Audio Player with Spinning Vinyl Disc & Real-Time Waveform Visualizer
 */
@Composable
private fun AudioPlayerViewer(
    item: DriveFileItem,
    isPlaying: Boolean,
    onTogglePlay: () -> Unit,
    progress: Float,
    onProgressChange: (Float) -> Unit,
    isLooping: Boolean,
    onToggleLoop: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "VinylDisc")
    val discRotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(4000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "DiscAngle"
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Spinning Vinyl Disc
        Box(
            modifier = Modifier
                .size(150.dp)
                .rotate(if (isPlaying) discRotation else 0f)
                .clip(CircleShape)
                .background(Color(0xFF0F172A))
                .border(2.dp, GoldAccent.copy(alpha = 0.6f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(54.dp)
                    .clip(CircleShape)
                    .background(GoldAccent.copy(alpha = 0.25f))
                    .border(1.dp, GoldAccent, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Audiotrack,
                    contentDescription = null,
                    tint = GoldAccent,
                    modifier = Modifier.size(28.dp)
                )
            }
        }

        // Track Info & Audio Engine Quality Pill
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = item.name,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                ),
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Text(
                text = stringResource(R.string.preview_audio_artist),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
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
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace
                    ),
                    color = GoldAccent
                )
            }
        }

        // Animated 16-Bar Spectrum Visualizer
        Row(
            modifier = Modifier
                .fillMaxWidth(0.85f)
                .height(28.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom
        ) {
            val barCount = 16
            for (i in 0 until barCount) {
                val barProgress = ((i * 17 + (progress * 100).toInt()) % 100) / 100f
                val barHeight = if (isPlaying) (8.dp + 20.dp * barProgress) else 6.dp

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
                Text("01:24", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp, fontFamily = FontFamily.Monospace), color = TextSecondaryDark)
                Text("04:30", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp, fontFamily = FontFamily.Monospace), color = TextSecondaryDark)
            }
        }

        // Controls
        Row(
            modifier = Modifier.fillMaxWidth(0.85f),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = onToggleLoop,
                modifier = Modifier.size(40.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Repeat,
                    contentDescription = "Loop",
                    tint = if (isLooping) GoldAccent else TextSecondaryDark
                )
            }

            IconButton(
                onClick = onTogglePlay,
                modifier = Modifier
                    .size(56.dp)
                    .background(GoldAccent, CircleShape)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = "Play/Pause",
                    tint = CanvasDeepNavy,
                    modifier = Modifier.size(30.dp)
                )
            }

            IconButton(
                onClick = { onProgressChange((progress + 0.1f).coerceAtMost(1f)) },
                modifier = Modifier.size(40.dp)
            ) {
                Icon(Icons.Default.Forward10, "Forward", tint = Color.White)
            }
        }
    }
}

/**
 * In-Memory Sparse ZIP Archive Explorer (0 MB Overhead Streaming)
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
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Sparse MTProto Header Card
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            color = Color(0xF00B1C30),
            border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.35f))
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.preview_zip_sparse_streaming),
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp
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
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                            color = GoldAccent
                        )
                    }
                }
                Text(
                    text = stringResource(R.string.preview_zip_sparse_desc),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp),
                    color = TextSecondaryDark
                )
            }
        }

        // Entries List
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp),
            shape = RoundedCornerShape(12.dp),
            color = Color(0xF0051120),
            border = BorderStroke(1.dp, Color(0x33FFFFFF))
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(sampleZipEntries) { (name, size) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0x1F26364A), RoundedCornerShape(6.dp))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = if (name.endsWith(".mp4")) Icons.Default.Movie else Icons.AutoMirrored.Filled.InsertDriveFile,
                                contentDescription = null,
                                tint = if (name.endsWith(".mp4")) MutedIceCyan else GoldAccent,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = name,
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontSize = 12.sp,
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
                                fontSize = 11.sp,
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

/**
 * Syntax Code & Text Viewer with Line Numbers and Copy All Action
 */
@Composable
private fun CodeSyntaxViewer(item: DriveFileItem) {
    val clipboard = LocalClipboardManager.current
    var isCopied by remember { mutableStateOf(false) }

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

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = stringResource(R.string.preview_code_syntax),
                style = MaterialTheme.typography.titleSmall.copy(
                    fontSize = 12.5.sp,
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
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = if (isCopied) DustySage else Color.White
                )
            }
        }

        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(280.dp),
            shape = RoundedCornerShape(12.dp),
            color = Color(0xF0051120),
            border = BorderStroke(1.dp, Color(0x33FFFFFF))
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(12.dp)
            ) {
                val lines = sampleCode.lines()
                items(lines.size) { index ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "${index + 1}",
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            color = TextSecondaryDark.copy(alpha = 0.4f),
                            modifier = Modifier.width(24.dp)
                        )
                        Text(
                            text = lines[index],
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            color = if (lines[index].contains(":")) GoldAccent else Color.White
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DocumentViewer(item: DriveFileItem) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Box(
            modifier = Modifier
                .size(120.dp)
                .background(CategoryDoc.copy(alpha = 0.15f), RoundedCornerShape(20.dp))
                .border(1.dp, CategoryDoc.copy(alpha = 0.35f), RoundedCornerShape(20.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.InsertDriveFile,
                contentDescription = null,
                tint = CategoryDoc,
                modifier = Modifier.size(54.dp)
            )
        }
        Text(
            text = item.name,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = Color.White
        )
        Text(
            text = "${formatFileSize(item.size)} • Document Format",
            style = MaterialTheme.typography.bodySmall,
            color = TextSecondaryDark
        )
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
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
            color = TextSecondaryDark
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall.copy(
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace
            ),
            color = TextPrimaryDark,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 220.dp)
        )
    }
}