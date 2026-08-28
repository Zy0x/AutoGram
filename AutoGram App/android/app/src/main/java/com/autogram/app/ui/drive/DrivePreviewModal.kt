package com.autogram.app.ui.drive

import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
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

    val isPhoto = item.mimeType.startsWith("image") || item.telegramCategory.equals("photo", ignoreCase = true)
    val isVideo = item.mimeType.startsWith("video") || item.telegramCategory.equals("video", ignoreCase = true)
    val isAudio = item.mimeType.startsWith("audio") || item.telegramCategory.equals("audio", ignoreCase = true)

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CanvasDeepNavy.copy(alpha = 0.96f))
        ) {
            // 1. TOP APP BAR
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left: Close Button + Filename
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier
                            .size(38.dp)
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
                            text = formatFileSize(item.size),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                            color = TextSecondaryDark
                        )
                    }
                }

                // Right: Action Buttons (Info & Download)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    IconButton(
                        onClick = { isInfoSheetOpen = !isInfoSheetOpen },
                        modifier = Modifier
                            .size(38.dp)
                            .background(if (isInfoSheetOpen) GoldAccent.copy(alpha = 0.25f) else Color(0x22FFFFFF), CircleShape)
                            .border(1.dp, if (isInfoSheetOpen) GoldAccent else Color(0x33FFFFFF), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = stringResource(R.string.preview_action_info),
                            tint = if (isInfoSheetOpen) GoldAccent else Color.White,
                            modifier = Modifier.size(19.dp)
                        )
                    }
                    IconButton(
                        onClick = { onDownload(item) },
                        modifier = Modifier
                            .size(38.dp)
                            .background(MutedIceCyan.copy(alpha = 0.2f), CircleShape)
                            .border(1.dp, MutedIceCyan.copy(alpha = 0.4f), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Download,
                            contentDescription = stringResource(R.string.preview_action_download),
                            tint = MutedIceCyan,
                            modifier = Modifier.size(19.dp)
                        )
                    }
                }
            }

            // 2. MAIN MEDIA VIEWER
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = 80.dp, bottom = if (isInfoSheetOpen) 280.dp else 40.dp),
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
                            onProgressChange = { p -> progress = p }
                        )
                    }
                    isAudio -> {
                        AudioPlayerViewer(
                            item = item,
                            isPlaying = isPlaying,
                            onTogglePlay = { isPlaying = !isPlaying },
                            progress = progress,
                            onProgressChange = { p -> progress = p }
                        )
                    }
                    else -> {
                        DocumentViewer(item = item)
                    }
                }
            }

            // 3. BOTTOM METADATA SHEET
            AnimatedVisibility(
                visible = isInfoSheetOpen,
                enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),
                exit = slideOutVertically(targetOffsetY = { it }) + fadeOut(),
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .wrapContentHeight(),
                    shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                    color = Color(0xF50B1C30),
                    border = BorderStroke(1.dp, Color(0x33FFFFFF))
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
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
                                    fontSize = 14.sp
                                ),
                                color = GoldAccent
                            )
                            Surface(
                                color = MutedIceCyan.copy(alpha = 0.15f),
                                shape = CircleShape,
                                border = BorderStroke(0.5.dp, MutedIceCyan.copy(alpha = 0.35f))
                            ) {
                                Text(
                                    text = "MTProto Verified",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                                    color = MutedIceCyan
                                )
                            }
                        }

                        HorizontalDivider(color = Color(0x1FFFFFFF))

                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            MetadataRow(label = stringResource(R.string.preview_meta_size), value = formatFileSize(item.size))
                            MetadataRow(label = stringResource(R.string.preview_meta_mime), value = item.mimeType)
                            MetadataRow(label = stringResource(R.string.preview_meta_hash), value = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4... (SHA256)")
                            MetadataRow(label = stringResource(R.string.preview_meta_msgid), value = "#${item.id} • Channel VIP")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ZoomablePhotoViewer(item: DriveFileItem) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val transformState = rememberTransformableState { zoomChange, offsetChange, _ ->
        scale = (scale * zoomChange).coerceIn(1f, 4f)
        offset += offsetChange
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .transformable(state = transformState)
            .graphicsLayer(
                scaleX = scale,
                scaleY = scale,
                translationX = offset.x,
                translationY = offset.y
            ),
        contentAlignment = Alignment.Center
    ) {
        if (!item.thumbnailUri.isNullOrBlank()) {
            AsyncImage(
                model = item.thumbnailUri,
                contentDescription = item.name,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)),
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
}

@Composable
private fun VideoPlayerViewer(
    item: DriveFileItem,
    isPlaying: Boolean,
    onTogglePlay: () -> Unit,
    playbackSpeed: Float,
    onSpeedChange: (Float) -> Unit,
    progress: Float,
    onProgressChange: (Float) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(240.dp),
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

                Surface(
                    color = Color(0xCC000000),
                    shape = CircleShape,
                    border = BorderStroke(0.5.dp, GoldAccent.copy(alpha = 0.5f)),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(12.dp)
                ) {
                    Text(
                        text = stringResource(R.string.preview_transcode_status),
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                        color = GoldAccent
                    )
                }
            }
        }

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
                Text("00:42", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp), color = TextSecondaryDark)
                Text("02:15", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp), color = TextSecondaryDark)
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                onClick = {
                    val nextSpeed = when (playbackSpeed) {
                        1.0f -> 1.5f
                        1.5f -> 2.0f
                        else -> 1.0f
                    }
                    onSpeedChange(nextSpeed)
                },
                color = Color(0x26FFFFFF),
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, Color(0x33FFFFFF))
            ) {
                Text(
                    text = "${playbackSpeed}x",
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                    color = Color.White
                )
            }

            IconButton(
                onClick = onTogglePlay,
                modifier = Modifier
                    .size(56.dp)
                    .background(MutedIceCyan, CircleShape)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = null,
                    tint = CanvasDeepNavy,
                    modifier = Modifier.size(30.dp)
                )
            }

            IconButton(
                onClick = { },
                modifier = Modifier
                    .size(40.dp)
                    .background(Color(0x26FFFFFF), CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.Subtitles,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
private fun AudioPlayerViewer(
    item: DriveFileItem,
    isPlaying: Boolean,
    onTogglePlay: () -> Unit,
    progress: Float,
    onProgressChange: (Float) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        Box(
            modifier = Modifier
                .size(140.dp)
                .background(GoldAccent.copy(alpha = 0.15f), RoundedCornerShape(24.dp))
                .border(1.dp, GoldAccent.copy(alpha = 0.35f), RoundedCornerShape(24.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Audiotrack,
                contentDescription = null,
                tint = GoldAccent,
                modifier = Modifier.size(64.dp)
            )
        }

        Slider(
            value = progress,
            onValueChange = onProgressChange,
            colors = SliderDefaults.colors(
                thumbColor = GoldAccent,
                activeTrackColor = GoldAccent,
                inactiveTrackColor = Color(0x33FFFFFF)
            )
        )

        IconButton(
            onClick = onTogglePlay,
            modifier = Modifier
                .size(56.dp)
                .background(GoldAccent, CircleShape)
        ) {
            Icon(
                imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = null,
                tint = CanvasDeepNavy,
                modifier = Modifier.size(30.dp)
            )
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
            modifier = Modifier.widthIn(max = 200.dp)
        )
    }
}