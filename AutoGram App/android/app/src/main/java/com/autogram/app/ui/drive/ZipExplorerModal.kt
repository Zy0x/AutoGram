package com.autogram.app.ui.drive

import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem

data class ZipEntryItem(
    val name: String,
    val uncompressedSize: Long,
    val compressedSize: Long,
    val isFolder: Boolean,
    val kind: String = "file"
)

@Composable
fun ZipExplorerModal(
    archiveItem: DriveFileItem,
    onDismiss: () -> Unit,
    onExtractEntry: (ZipEntryItem) -> Unit = {},
    onExtractAll: () -> Unit = {}
) {
    var searchQuery by remember { mutableStateOf("") }
    var extractedMessage by remember { mutableStateOf<String?>(null) }

    // Mock entries matching sparse ZIP contents
    val allEntries = remember {
        listOf(
            ZipEntryItem("cinematic_b_roll_4k.mp4", 45000000, 18500000, false, "video"),
            ZipEntryItem("scene_01_take03.jpg", 3400000, 1200000, false, "image"),
            ZipEntryItem("scene_02_take01.jpg", 4100000, 1450000, false, "image"),
            ZipEntryItem("director_script_notes.pdf", 890000, 420000, false, "doc"),
            ZipEntryItem("production_metadata.json", 145000, 32000, false, "code"),
            ZipEntryItem("soundtrack_master_stem.wav", 18200000, 9400000, false, "audio")
        )
    }

    val filteredEntries = allEntries.filter {
        searchQuery.isBlank() || it.name.contains(searchQuery, ignoreCase = true)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CanvasDeepNavy.copy(alpha = 0.97f))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
            ) {
                // 1. TOP HEADER
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(58.dp)
                        .background(Color(0xD9031427))
                        .padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        IconButton(
                            onClick = onDismiss,
                            modifier = Modifier
                                .size(36.dp)
                                .background(Color(0x22FFFFFF), CircleShape)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = stringResource(R.string.preview_action_close),
                                tint = Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Column {
                            Text(
                                text = archiveItem.name,
                                style = MaterialTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 15.sp
                                ),
                                color = Color.White,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = stringResource(R.string.zip_entries_count, allEntries.size),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextSecondaryDark
                            )
                        }
                    }

                    // Sparse In-Memory Badge
                    Surface(
                        color = GoldAccent.copy(alpha = 0.15f),
                        shape = CircleShape,
                        border = BorderStroke(0.5.dp, GoldAccent.copy(alpha = 0.4f))
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                        ) {
                            Icon(Icons.Default.Bolt, null, tint = GoldAccent, modifier = Modifier.size(12.dp))
                            Text(
                                text = "Sparse Stream",
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, fontWeight = FontWeight.Bold),
                                color = GoldAccent
                            )
                        }
                    }
                }

                // 2. SEARCH BAR & SPARSE NOTICE
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp),
                        placeholder = {
                            Text(
                                stringResource(R.string.zip_search_placeholder),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                                color = TextMutedDark
                            )
                        },
                        leadingIcon = {
                            Icon(Icons.Default.Search, null, tint = TextSecondaryDark, modifier = Modifier.size(18.dp))
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = CardNavyBg,
                            unfocusedContainerColor = CardNavyBg,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            focusedTextColor = TextPrimaryDark,
                            unfocusedTextColor = TextPrimaryDark
                        )
                    )

                    // Sparse Streaming Guarantee Pill
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        color = MutedIceCyan.copy(alpha = 0.08f),
                        border = BorderStroke(0.5.dp, MutedIceCyan.copy(alpha = 0.25f))
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(Icons.Default.Shield, null, tint = MutedIceCyan, modifier = Modifier.size(14.dp))
                            Text(
                                text = stringResource(R.string.zip_in_memory_stream),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.5.sp),
                                color = MutedIceCyan
                            )
                        }
                    }
                }

                // 3. ZIP ENTRY LIST
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 100.dp)
                ) {
                    items(filteredEntries, key = { it.name }) { entry ->
                        ZipEntryCard(
                            entry = entry,
                            onExtract = {
                                onExtractEntry(entry)
                                extractedMessage = "Ekstraksi '${entry.name}' berhasil!"
                            }
                        )
                    }
                }
            }

            // 4. BOTTOM ACTION BAR
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter),
                color = Color(0xF5081729),
                border = BorderStroke(1.dp, Color(0x22FFFFFF))
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (extractedMessage != null) {
                        Text(
                            text = extractedMessage!!,
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = DustySage
                        )
                    }
                    Button(
                        onClick = {
                            onExtractAll()
                            extractedMessage = "Semua berkas di ZIP berhasil diekstrak!"
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(46.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MutedIceCyan,
                            contentColor = CanvasDeepNavy
                        )
                    ) {
                        Icon(Icons.Default.FileDownload, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = stringResource(R.string.zip_action_extract_all),
                            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ZipEntryCard(
    entry: ZipEntryItem,
    onExtract: () -> Unit
) {
    val entryColor = when (entry.kind) {
        "video" -> CategoryVideo
        "image" -> CategoryPhoto
        "audio" -> CategoryAudio
        "doc" -> CategoryDoc
        else -> ElectricBlue
    }

    val iconVector = when (entry.kind) {
        "video" -> Icons.Default.Videocam
        "image" -> Icons.Default.Image
        "audio" -> Icons.Default.Audiotrack
        "doc" -> Icons.Default.Description
        else -> Icons.AutoMirrored.Filled.InsertDriveFile
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = CardNavyBg),
        border = BorderStroke(1.dp, CardNavyBorder)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .background(entryColor.copy(alpha = 0.15f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(iconVector, null, tint = entryColor, modifier = Modifier.size(20.dp))
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${formatFileSize(entry.uncompressedSize)} • Kompresi: ${formatFileSize(entry.compressedSize)}",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                    color = TextSecondaryDark
                )
            }

            IconButton(
                onClick = onExtract,
                modifier = Modifier
                    .size(34.dp)
                    .background(Color(0x22FFFFFF), CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.FileDownload,
                    contentDescription = stringResource(R.string.zip_action_extract_selected),
                    tint = MutedIceCyan,
                    modifier = Modifier.size(17.dp)
                )
            }
        }
    }
}