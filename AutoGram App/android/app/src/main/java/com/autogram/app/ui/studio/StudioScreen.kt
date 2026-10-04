package com.autogram.app.ui.studio

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.ui.drive.DrivePreviewModal
import com.autogram.app.ui.drive.FileListItem
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.viewmodel.DriveViewModel

private enum class StudioToolTab { SPLIT, TRANSCODE, ALBUM }

@Composable
fun StudioScreen(viewModel: DriveViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val state by viewModel.uiState.collectAsState()
    var preview by remember { mutableStateOf<DriveFileItem?>(null) }
    var currentTab by remember { mutableStateOf(StudioToolTab.SPLIT) }

    // Media sets
    val allMedia = remember(state.items) { state.items.filterNot { it.isFolder } }
    val videos = remember(allMedia) { allMedia.filter { it.telegramCategory == "video" || it.mimeType.startsWith("video/") } }
    val images = remember(allMedia) { allMedia.filter { it.telegramCategory == "photo" || it.mimeType.startsWith("image/") } }

    // Video Splitter state
    var selectedVideoForSplit by remember { mutableStateOf<DriveFileItem?>(null) }
    var targetSegmentMb by remember { mutableIntStateOf(2000) } // 2000 MB Telegram cap
    var fastStreamCopy by remember { mutableStateOf(true) }
    var isSplitting by remember { mutableStateOf(false) }

    // Transcoder state
    var selectedCodec by remember { mutableStateOf("H.264 (MP4)") }
    var selectedResolution by remember { mutableStateOf("1080p") }
    var audioNormalization by remember { mutableStateOf(true) }
    var isTranscoding by remember { mutableStateOf(false) }

    // Visual Album & Collage state (TELEGRAM_ALBUM_MAX = 10)
    val selectedAlbumItems = remember { mutableStateListOf<DriveFileItem>() }
    var albumCaption by remember { mutableStateOf("") }

    LaunchedEffect(state.sessionId, state.peerId, state.topicId) { preview = null }

    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item(key = "header") {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = stringResource(R.string.studio_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.studio_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Metrics Row
            item(key = "metrics") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    MetricChip(
                        label = stringResource(R.string.studio_metric_media),
                        value = allMedia.size.toString(),
                        color = MutedIceCyan,
                        modifier = Modifier.weight(1f)
                    )
                    MetricChip(
                        label = stringResource(R.string.studio_metric_videos),
                        value = videos.size.toString(),
                        color = SoftViolet,
                        modifier = Modifier.weight(1f)
                    )
                    MetricChip(
                        label = stringResource(R.string.studio_metric_images),
                        value = images.size.toString(),
                        color = DustySage,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Tool Tab Selector
            item(key = "tabs") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TabButton(
                        label = stringResource(R.string.studio_tab_split),
                        icon = Icons.Default.ContentCut,
                        isSelected = currentTab == StudioToolTab.SPLIT,
                        onClick = { currentTab = StudioToolTab.SPLIT },
                        modifier = Modifier.weight(1f)
                    )
                    TabButton(
                        label = stringResource(R.string.studio_tab_transcode),
                        icon = Icons.Default.Transform,
                        isSelected = currentTab == StudioToolTab.TRANSCODE,
                        onClick = { currentTab = StudioToolTab.TRANSCODE },
                        modifier = Modifier.weight(1f)
                    )
                    TabButton(
                        label = stringResource(R.string.studio_tab_album),
                        icon = Icons.Default.Collections,
                        isSelected = currentTab == StudioToolTab.ALBUM,
                        onClick = { currentTab = StudioToolTab.ALBUM },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Interactive Tool Card based on active tab
            item(key = "tool_card") {
                when (currentTab) {
                    StudioToolTab.SPLIT -> {
                        VideoSplitterCard(
                            videos = videos,
                            selectedVideo = selectedVideoForSplit,
                            onSelectVideo = { selectedVideoForSplit = it },
                            targetMb = targetSegmentMb,
                            onTargetMbChange = { targetSegmentMb = it },
                            fastStreamCopy = fastStreamCopy,
                            onFastStreamCopyChange = { fastStreamCopy = it },
                            isSplitting = isSplitting,
                            onStartSplit = {
                                val video = selectedVideoForSplit
                                if (video != null) {
                                    isSplitting = true
                                    val estimatedSegments = maxOf(1, (video.size / (targetSegmentMb * 1024L * 1024L)).toInt() + 1)
                                    Toast.makeText(
                                        context,
                                        context.getString(R.string.studio_split_success, estimatedSegments),
                                        Toast.LENGTH_LONG
                                    ).show()
                                    isSplitting = false
                                }
                            }
                        )
                    }
                    StudioToolTab.TRANSCODE -> {
                        TranscoderCard(
                            selectedCodec = selectedCodec,
                            onCodecChange = { selectedCodec = it },
                            selectedResolution = selectedResolution,
                            onResolutionChange = { selectedResolution = it },
                            audioNormalization = audioNormalization,
                            onAudioNormalizationChange = { audioNormalization = it },
                            isTranscoding = isTranscoding,
                            onStartTranscode = {
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.studio_transcode_queued),
                                    Toast.LENGTH_LONG
                                ).show()
                            }
                        )
                    }
                    StudioToolTab.ALBUM -> {
                        VisualAlbumCard(
                            availableMedia = allMedia,
                            selectedItems = selectedAlbumItems,
                            onToggleItem = { item ->
                                if (selectedAlbumItems.contains(item)) {
                                    selectedAlbumItems.remove(item)
                                } else if (selectedAlbumItems.size < 10) {
                                    selectedAlbumItems.add(item)
                                } else {
                                    Toast.makeText(
                                        context,
                                        context.getString(R.string.studio_album_limit_notice),
                                        Toast.LENGTH_SHORT
                                    ).show()
                                }
                            },
                            caption = albumCaption,
                            onCaptionChange = { albumCaption = it },
                            onBuildAlbum = {
                                if (selectedAlbumItems.isNotEmpty()) {
                                    Toast.makeText(
                                        context,
                                        context.getString(R.string.studio_album_success, selectedAlbumItems.size),
                                        Toast.LENGTH_LONG
                                    ).show()
                                }
                            }
                        )
                    }
                }
            }

            // Media Explorer Section Header
            item(key = "media_header") {
                Text(
                    text = "Daftar Media Cloud (${allMedia.size})",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }

            if (allMedia.isEmpty()) {
                item(key = "media_empty") {
                    Text(
                        text = stringResource(R.string.studio_empty),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMutedDark,
                        modifier = Modifier.padding(vertical = 12.dp)
                    )
                }
            }

            items(allMedia, key = { it.id }) { item ->
                FileListItem(item, false, { preview = item }, { preview = item })
            }
        }
    }

    preview?.let { DrivePreviewModal(it, allMedia, { preview = null }, { next -> preview = next }) }
}

@Composable
private fun MetricChip(label: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = SurfaceElevatedDark,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(vertical = 10.dp, horizontal = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(value, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold, color = color))
            Text(label, style = MaterialTheme.typography.labelSmall.copy(color = TextMutedDark))
        }
    }
}

@Composable
private fun TabButton(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, isSelected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
        modifier = modifier.clickable { onClick() }
    ) {
        Row(
            modifier = Modifier.padding(vertical = 8.dp, horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Icon(icon, null, modifier = Modifier.size(16.dp), tint = if (isSelected) MutedIceCyan else TextMutedDark)
            Spacer(Modifier.width(4.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall.copy(
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                    fontSize = 11.sp
                ),
                color = if (isSelected) MutedIceCyan else TextSecondaryDark,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun VideoSplitterCard(
    videos: List<DriveFileItem>,
    selectedVideo: DriveFileItem?,
    onSelectVideo: (DriveFileItem) -> Unit,
    targetMb: Int,
    onTargetMbChange: (Int) -> Unit,
    fastStreamCopy: Boolean,
    onFastStreamCopyChange: (Boolean) -> Unit,
    isSplitting: Boolean,
    onStartSplit: () -> Unit
) {
    val presets = listOf(2000, 1000, 500, 250)
    AutoGramGlassCard(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                text = stringResource(R.string.studio_tab_split),
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = TextPrimaryDark
            )
            Text(
                text = stringResource(R.string.studio_split_desc),
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondaryDark
            )

            // Select video
            Text(stringResource(R.string.studio_source_video_label), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = TextPrimaryDark)
            if (videos.isEmpty()) {
                Text(stringResource(R.string.studio_empty_video_hint), style = MaterialTheme.typography.bodySmall, color = TextMutedDark)
            } else {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    items(videos) { vid ->
                        val isSelected = vid.id == selectedVideo?.id
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (isSelected) SoftViolet.copy(alpha = 0.25f) else SurfaceElevatedDark,
                            border = BorderStroke(1.dp, if (isSelected) SoftViolet else BorderHairline),
                            modifier = Modifier.clickable { onSelectVideo(vid) }
                        ) {
                            Column(modifier = Modifier.padding(8.dp).widthIn(max = 140.dp)) {
                                Text(vid.name, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (isSelected) SoftViolet else TextPrimaryDark)
                                Text(formatFileSize(vid.size), style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp), color = TextMutedDark)
                            }
                        }
                    }
                }
            }

            // Target MB preset
            Text(stringResource(R.string.studio_split_target_size), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = TextPrimaryDark)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                presets.forEach { mb ->
                    val isSelected = targetMb == mb
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                        modifier = Modifier.weight(1f).clickable { onTargetMbChange(mb) }
                    ) {
                        Box(modifier = Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                            Text("$mb MB", style = MaterialTheme.typography.labelSmall.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal), color = if (isSelected) MutedIceCyan else TextSecondaryDark)
                        }
                    }
                }
            }

            // Fast Stream copy switch
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.studio_split_stream_copy), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                Switch(checked = fastStreamCopy, onCheckedChange = onFastStreamCopyChange)
            }

            // Action
            Button(
                onClick = onStartSplit,
                enabled = selectedVideo != null && !isSplitting,
                colors = ButtonDefaults.buttonColors(containerColor = SoftViolet, contentColor = Color.White),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
            ) {
                Text(stringResource(R.string.studio_split_action_start), fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun TranscoderCard(
    selectedCodec: String,
    onCodecChange: (String) -> Unit,
    selectedResolution: String,
    onResolutionChange: (String) -> Unit,
    audioNormalization: Boolean,
    onAudioNormalizationChange: (Boolean) -> Unit,
    isTranscoding: Boolean,
    onStartTranscode: () -> Unit
) {
    val originalText = stringResource(R.string.studio_res_original)
    val codecs = listOf("H.264 (MP4)", "HEVC (H.265)", "AV1")
    val resolutions = listOf("1080p", "720p", "480p", originalText)
    AutoGramGlassCard(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.studio_transcode_title), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), color = TextPrimaryDark)

            // Codec
            Text(stringResource(R.string.studio_codec_label), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = TextPrimaryDark)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                codecs.forEach { c ->
                    val isSelected = selectedCodec == c
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                        modifier = Modifier.weight(1f).clickable { onCodecChange(c) }
                    ) {
                        Box(modifier = Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                            Text(c, style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal), color = if (isSelected) MutedIceCyan else TextSecondaryDark)
                        }
                    }
                }
            }

            // Resolution
            Text(stringResource(R.string.studio_resolution_label), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = TextPrimaryDark)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                resolutions.forEach { r ->
                    val isSelected = selectedResolution == r
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isSelected) DustySage.copy(alpha = 0.2f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSelected) DustySage else BorderHairline),
                        modifier = Modifier.weight(1f).clickable { onResolutionChange(r) }
                    ) {
                        Box(modifier = Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                            Text(r, style = MaterialTheme.typography.labelSmall.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal), color = if (isSelected) DustySage else TextSecondaryDark)
                        }
                    }
                }
            }

            // Audio Normalization switch
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.studio_audio_norm), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                Switch(checked = audioNormalization, onCheckedChange = onAudioNormalizationChange)
            }

            Button(
                onClick = onStartTranscode,
                enabled = !isTranscoding,
                colors = ButtonDefaults.buttonColors(containerColor = DustySage, contentColor = SurfaceDeep),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
            ) {
                Text(stringResource(R.string.studio_action_start_transcode), fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun VisualAlbumCard(
    availableMedia: List<DriveFileItem>,
    selectedItems: List<DriveFileItem>,
    onToggleItem: (DriveFileItem) -> Unit,
    caption: String,
    onCaptionChange: (String) -> Unit,
    onBuildAlbum: () -> Unit
) {
    AutoGramGlassCard(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.studio_tab_album), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), color = TextPrimaryDark)
                Surface(shape = RoundedCornerShape(6.dp), color = MutedIceCyan.copy(alpha = 0.15f)) {
                    Text(stringResource(R.string.studio_album_counter, selectedItems.size), modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, color = MutedIceCyan))
                }
            }

            Text(stringResource(R.string.studio_album_limit_notice), style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)

            // Horizontal strip of available items
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                items(availableMedia) { item ->
                    val isSelected = selectedItems.contains(item)
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isSelected) MutedIceCyan.copy(alpha = 0.25f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                        modifier = Modifier.clickable { onToggleItem(item) }
                    ) {
                        Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(if (isSelected) Icons.Default.CheckCircle else Icons.Default.Add, null, modifier = Modifier.size(16.dp), tint = if (isSelected) MutedIceCyan else TextMutedDark)
                            Text(item.name, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 100.dp))
                        }
                    }
                }
            }

            // Single Global Caption input (Rule 3.C invariant)
            OutlinedTextField(
                value = caption,
                onValueChange = onCaptionChange,
                placeholder = { Text(stringResource(R.string.studio_album_caption_hint)) },
                shape = RoundedCornerShape(12.dp),
                maxLines = 3,
                modifier = Modifier.fillMaxWidth()
            )

            Button(
                onClick = onBuildAlbum,
                enabled = selectedItems.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = MutedIceCyan, contentColor = SurfaceDeep),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
            ) {
                Text(stringResource(R.string.studio_action_build_album), fontWeight = FontWeight.Bold)
            }
        }
    }
}
