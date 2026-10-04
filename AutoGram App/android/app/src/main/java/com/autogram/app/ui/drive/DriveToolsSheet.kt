package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveToolsSheet(
    items: List<DriveFileItem>,
    locationTitle: String,
    onDismiss: () -> Unit,
    onDeleteItems: ((Set<String>) -> Unit)? = null
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SurfaceDark,
        dragHandle = { BottomSheetDefaults.DragHandle(color = BorderHairline) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.88f)
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp)
                .testTag("drive-tools-sheet")
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Handyman,
                        contentDescription = null,
                        tint = MutedIceCyan,
                        modifier = Modifier.size(24.dp)
                    )
                    Text(
                        text = stringResource(R.string.drive_tools_title),
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, null, tint = TextMutedDark)
                }
            }

            // Tabs Segment
            TabRow(
                selectedTabIndex = selectedTab,
                containerColor = SurfaceElevatedDark,
                contentColor = MutedIceCyan,
                divider = {},
                modifier = Modifier.clip(RoundedCornerShape(12.dp))
            ) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(Icons.Default.PieChart, null, modifier = Modifier.size(16.dp))
                            Text(stringResource(R.string.drive_tools_tab_space), fontWeight = FontWeight.SemiBold)
                        }
                    }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(Icons.Default.ContentCopy, null, modifier = Modifier.size(16.dp))
                            Text(stringResource(R.string.drive_tools_tab_duplicates), fontWeight = FontWeight.SemiBold)
                        }
                    }
                )
            }

            Spacer(Modifier.height(16.dp))

            when (selectedTab) {
                0 -> SpaceUsageTabContent(items, locationTitle)
                1 -> DuplicatesTabContent(items, onDeleteItems)
            }
        }
    }
}

@Composable
private fun SpaceUsageTabContent(
    items: List<DriveFileItem>,
    locationTitle: String
) {
    val nonFolders = remember(items) { items.filter { !it.isFolder } }
    val totalBytes = remember(nonFolders) { nonFolders.sumOf { it.size } }

    val videoBytes = remember(nonFolders) {
        nonFolders.filter { it.telegramCategory == "video" || it.mimeType.startsWith("video/") }.sumOf { it.size }
    }
    val imageBytes = remember(nonFolders) {
        nonFolders.filter { it.telegramCategory == "photo" || it.mimeType.startsWith("image/") }.sumOf { it.size }
    }
    val audioBytes = remember(nonFolders) {
        nonFolders.filter { it.telegramCategory == "audio" || it.mimeType.startsWith("audio/") }.sumOf { it.size }
    }
    val archiveBytes = remember(nonFolders) {
        nonFolders.filter {
            it.mimeType.contains("zip") || it.name.endsWith(".zip", ignoreCase = true) ||
            it.name.endsWith(".rar", ignoreCase = true) || it.name.endsWith(".7z", ignoreCase = true)
        }.sumOf { it.size }
    }
    val docBytes = remember(nonFolders) {
        nonFolders.filter {
            it.telegramCategory == "document" &&
            !it.mimeType.contains("zip") && !it.name.endsWith(".zip", ignoreCase = true) &&
            (it.mimeType.contains("pdf") || it.mimeType.contains("text") || it.name.endsWith(".pdf", ignoreCase = true))
        }.sumOf { it.size }
    }
    val otherBytes = remember(totalBytes, videoBytes, imageBytes, audioBytes, archiveBytes, docBytes) {
        (totalBytes - (videoBytes + imageBytes + audioBytes + archiveBytes + docBytes)).coerceAtLeast(0L)
    }

    val calcPct: (Long) -> Float = { b ->
        if (totalBytes > 0L) (b.toFloat() / totalBytes.toFloat()) * 100f else 0f
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Summary Card
        item {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = SurfaceElevatedDark,
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text(
                            text = locationTitle,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = stringResource(R.string.drive_tools_indexed_files, nonFolders.size),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMutedDark
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text = formatFileSize(totalBytes),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = MutedIceCyan
                        )
                        Text(
                            text = stringResource(R.string.drive_tools_used_capacity),
                            style = MaterialTheme.typography.labelSmall,
                            color = TextMutedDark
                        )
                    }
                }
            }
        }

        // Multi-color Segmented Storage Bar
        item {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = SurfaceElevatedDark,
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = stringResource(R.string.drive_tools_breakdown_title),
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = TextPrimaryDark
                    )

                    // Progress Track
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(14.dp)
                            .clip(RoundedCornerShape(7.dp))
                            .background(SurfaceDark)
                    ) {
                        if (totalBytes > 0L) {
                            if (videoBytes > 0L) Box(Modifier.weight((videoBytes.toFloat() / totalBytes).coerceAtLeast(0.01f)).fillMaxHeight().background(MutedIceCyan))
                            if (imageBytes > 0L) Box(Modifier.weight((imageBytes.toFloat() / totalBytes).coerceAtLeast(0.01f)).fillMaxHeight().background(DustySage))
                            if (audioBytes > 0L) Box(Modifier.weight((audioBytes.toFloat() / totalBytes).coerceAtLeast(0.01f)).fillMaxHeight().background(GoldAccent))
                            if (archiveBytes > 0L) Box(Modifier.weight((archiveBytes.toFloat() / totalBytes).coerceAtLeast(0.01f)).fillMaxHeight().background(SoftViolet))
                            if (docBytes > 0L) Box(Modifier.weight((docBytes.toFloat() / totalBytes).coerceAtLeast(0.01f)).fillMaxHeight().background(ElectricBlue))
                            if (otherBytes > 0L) Box(Modifier.weight((otherBytes.toFloat() / totalBytes).coerceAtLeast(0.01f)).fillMaxHeight().background(TextMutedDark))
                        } else {
                            Box(Modifier.fillMaxSize().background(BorderHairline))
                        }
                    }

                    // Category Breakdown Cards
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CategoryRow(stringResource(R.string.drive_space_videos), videoBytes, calcPct(videoBytes), MutedIceCyan)
                        CategoryRow(stringResource(R.string.drive_space_images), imageBytes, calcPct(imageBytes), DustySage)
                        CategoryRow(stringResource(R.string.drive_space_audio), audioBytes, calcPct(audioBytes), GoldAccent)
                        CategoryRow(stringResource(R.string.drive_space_archives), archiveBytes, calcPct(archiveBytes), SoftViolet)
                        CategoryRow(stringResource(R.string.drive_space_documents), docBytes, calcPct(docBytes), ElectricBlue)
                        CategoryRow(stringResource(R.string.drive_space_other), otherBytes, calcPct(otherBytes), TextMutedDark)
                    }
                }
            }
        }
    }
}

@Composable
private fun CategoryRow(
    label: String,
    bytes: Long,
    pct: Float,
    dotColor: Color
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(dotColor))
            Text(text = label, style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
        }
        Text(
            text = "${formatFileSize(bytes)} (${String.format(java.util.Locale.ROOT, "%.1f%%", pct)})",
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            color = TextMutedDark
        )
    }
}

@Composable
private fun DuplicatesTabContent(
    items: List<DriveFileItem>,
    onDeleteItems: ((Set<String>) -> Unit)?
) {
    val duplicateGroups = remember(items) {
        items.filter { !it.isFolder && it.size > 0 }
            .groupBy { "${it.name.trim().lowercase()}_${it.size}" }
            .values
            .filter { it.size > 1 }
    }

    val totalDupFiles = remember(duplicateGroups) { duplicateGroups.sumOf { it.size } }
    val wastedBytes = remember(duplicateGroups) {
        duplicateGroups.sumOf { group -> (group.size - 1).toLong() * group.first().size }
    }

    var selectedIds by remember { mutableStateOf(setOf<String>()) }
    var showConfirmDialog by remember { mutableStateOf(false) }

    fun keepNewest() {
        val toDelete = mutableSetOf<String>()
        duplicateGroups.forEach { group ->
            val sorted = group.sortedByDescending { it.modifiedMs }
            // Keep index 0, mark the rest
            sorted.drop(1).forEach { toDelete.add(it.id) }
        }
        selectedIds = toDelete
    }

    fun keepOldest() {
        val toDelete = mutableSetOf<String>()
        duplicateGroups.forEach { group ->
            val sorted = group.sortedBy { it.modifiedMs }
            // Keep index 0, mark the rest
            sorted.drop(1).forEach { toDelete.add(it.id) }
        }
        selectedIds = toDelete
    }

    if (duplicateGroups.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = DustySage,
                    modifier = Modifier.size(56.dp)
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = stringResource(R.string.drive_dup_none),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMutedDark
                )
            }
        }
    } else {
        Column(modifier = Modifier.fillMaxSize()) {
            // Stats & Auto Select Bar
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = SurfaceElevatedDark,
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(
                            R.string.drive_dup_found_summary,
                            duplicateGroups.size,
                            totalDupFiles,
                            formatFileSize(wastedBytes)
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextPrimaryDark
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = { keepNewest() },
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(36.dp),
                            contentPadding = PaddingValues(0.dp)
                        ) {
                            Text(stringResource(R.string.drive_dup_keep_newest), fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = { keepOldest() },
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f).height(36.dp),
                            contentPadding = PaddingValues(0.dp)
                        ) {
                            Text(stringResource(R.string.drive_dup_keep_oldest), fontSize = 12.sp)
                        }
                    }
                }
            }

            // Duplicates List
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(duplicateGroups, key = { it.first().id + it.first().size }) { group ->
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = SurfaceElevatedDark,
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = group.first().name,
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f)
                                )
                                Text(
                                    text = formatFileSize(group.first().size),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = GoldAccent
                                )
                            }

                            group.forEach { item ->
                                val isChecked = selectedIds.contains(item.id)
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .clickable {
                                            selectedIds = if (isChecked) selectedIds - item.id else selectedIds + item.id
                                        }
                                        .padding(vertical = 6.dp, horizontal = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Checkbox(
                                        checked = isChecked,
                                        onCheckedChange = { checked ->
                                            selectedIds = if (checked) selectedIds + item.id else selectedIds - item.id
                                        },
                                        colors = CheckboxDefaults.colors(
                                            checkedColor = ErrorRed,
                                            uncheckedColor = TextMutedDark
                                        )
                                    )
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = "ID: ${item.id}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = TextPrimaryDark
                                        )
                                        Text(
                                            text = formatTimestamp(item.modifiedMs),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = TextMutedDark
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Delete Action Button
            if (selectedIds.isNotEmpty() && onDeleteItems != null) {
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = { showConfirmDialog = true },
                    colors = ButtonDefaults.buttonColors(containerColor = ErrorRed),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) {
                    Icon(Icons.Default.Delete, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.drive_dup_action_delete, selectedIds.size),
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }

    if (showConfirmDialog && onDeleteItems != null) {
        AlertDialog(
            onDismissRequest = { showConfirmDialog = false },
            title = { Text(stringResource(R.string.drive_dup_confirm_title)) },
            text = { Text(stringResource(R.string.drive_dup_confirm_msg, selectedIds.size)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteItems(selectedIds)
                        selectedIds = emptySet()
                        showConfirmDialog = false
                    }
                ) {
                    Text(stringResource(R.string.drive_action_delete), color = ErrorRed, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmDialog = false }) {
                    Text(stringResource(R.string.drive_action_cancel))
                }
            }
        )
    }
}

private fun formatTimestamp(millis: Long): String {
    if (millis <= 0L) return "-"
    val df = java.text.SimpleDateFormat("dd MMM yyyy, HH:mm", java.util.Locale.getDefault())
    return df.format(java.util.Date(millis))
}
