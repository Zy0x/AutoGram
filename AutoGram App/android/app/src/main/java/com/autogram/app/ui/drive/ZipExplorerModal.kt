package com.autogram.app.ui.drive

import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.theme.*
import com.autogram.app.ui.drive.zip.SparseZipReader
import com.autogram.app.ui.drive.zip.ZipEntryItem
import com.autogram.app.viewmodel.DriveFileItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ZipExplorerModal(
    archiveItem: DriveFileItem,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var entries by remember { mutableStateOf<List<ZipEntryItem>>(emptyList()) }
    var searchQuery by remember { mutableStateOf("") }
    var reader by remember { mutableStateOf<SparseZipReader?>(null) }

    // In-memory entry preview state
    var previewEntry by remember { mutableStateOf<ZipEntryItem?>(null) }
    var previewBytes by remember { mutableStateOf<ByteArray?>(null) }
    var isPreviewLoading by remember { mutableStateOf(false) }

    LaunchedEffect(archiveItem) {
        isLoading = true
        errorMessage = null
        try {
            val accountId = archiveItem.cloudAccountId
            val peerId = archiveItem.cloudPeerId
            val messageId = archiveItem.cloudMessageId
            if (accountId != null && peerId != null && messageId != null) {
                val source = CloudRangeSource.open(accountId, peerId, messageId)
                val zipReader = SparseZipReader(source)
                reader = zipReader
                val items = zipReader.listEntries()
                entries = items
                isLoading = false
            } else {
                errorMessage = context.getString(R.string.real_preview_unavailable)
                isLoading = false
            }
        } catch (e: Exception) {
            errorMessage = e.message ?: context.getString(R.string.real_preview_unavailable)
            isLoading = false
        }
    }

    val filteredEntries = remember(entries, searchQuery) {
        if (searchQuery.isBlank()) entries
        else entries.filter { it.name.contains(searchQuery, ignoreCase = true) }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = SurfaceDeep
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .safeDrawingPadding()
            ) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.native_close), tint = TextPrimaryDark)
                    }
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        Text(
                            text = archiveItem.name,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            color = TextPrimaryDark
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = SoftViolet.copy(alpha = 0.2f)
                            ) {
                                Text(
                                    text = stringResource(R.string.preview_zip_sparse_streaming),
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                    color = SoftViolet
                                )
                            }
                            Text(
                                text = formatFileSize(archiveItem.size),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextSecondaryDark
                            )
                        }
                    }
                }

                // Search Bar
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text(stringResource(R.string.zip_search_placeholder)) },
                    leadingIcon = { Icon(Icons.Default.Search, null, tint = TextMutedDark) },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(Icons.Default.Clear, null, tint = TextMutedDark)
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = SoftViolet,
                        unfocusedBorderColor = BorderHairline,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                )

                // Content
                when {
                    isLoading -> {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                CircularProgressIndicator(color = SoftViolet)
                                Text(
                                    text = "Membaca direktori ZIP via MTProto Byte-Range...",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondaryDark
                                )
                            }
                        }
                    }
                    errorMessage != null -> {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth()
                                .padding(24.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = errorMessage ?: "Gagal membuka arsip",
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                    filteredEntries.isEmpty() -> {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = stringResource(R.string.zip_empty),
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextMutedDark
                            )
                        }
                    }
                    else -> {
                        Text(
                            text = stringResource(R.string.zip_entries_count, filteredEntries.size),
                            style = MaterialTheme.typography.labelSmall,
                            color = TextMutedDark,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                        )
                        LazyColumn(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            items(filteredEntries, key = { it.localHeaderOffset.toString() + it.name }) { entry ->
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = SurfaceElevatedDark,
                                    border = BorderStroke(1.dp, BorderHairline),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            if (!entry.isFolder && reader != null) {
                                                previewEntry = entry
                                                isPreviewLoading = true
                                                previewBytes = null
                                                coroutineScope.launch {
                                                    try {
                                                        val bytes = reader!!.extractEntryBytes(entry)
                                                        previewBytes = bytes
                                                    } catch (e: Exception) {
                                                        Toast.makeText(context, e.message ?: "Gagal mengekstrak berkas", Toast.LENGTH_SHORT).show()
                                                        previewEntry = null
                                                    } finally {
                                                        isPreviewLoading = false
                                                    }
                                                }
                                            }
                                        }
                                ) {
                                    Row(
                                        modifier = Modifier.padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                                    ) {
                                        Surface(
                                            shape = RoundedCornerShape(8.dp),
                                            color = if (entry.isFolder) SoftViolet.copy(alpha = 0.15f) else DustySage.copy(alpha = 0.15f),
                                            modifier = Modifier.size(36.dp)
                                        ) {
                                            Box(contentAlignment = Alignment.Center) {
                                                Icon(
                                                    imageVector = if (entry.isFolder) Icons.Default.Folder else Icons.Default.InsertDriveFile,
                                                    contentDescription = null,
                                                    tint = if (entry.isFolder) SoftViolet else DustySage,
                                                    modifier = Modifier.size(20.dp)
                                                )
                                            }
                                        }

                                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Text(
                                                text = entry.name,
                                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp),
                                                color = TextPrimaryDark,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            if (!entry.isFolder) {
                                                Text(
                                                    text = "${formatFileSize(entry.uncompressedSize)} (terkompresi: ${formatFileSize(entry.compressedSize)})",
                                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                                    color = TextMutedDark
                                                )
                                            }
                                        }

                                        if (entry.isEncrypted) {
                                            Icon(
                                                imageVector = Icons.Default.Lock,
                                                contentDescription = "Terenkripsi",
                                                tint = Color(0xFFFFB74D),
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // In-Memory Preview Dialog for single clicked ZIP entry
            val currentEntry = previewEntry
            if (currentEntry != null) {
                AlertDialog(
                    onDismissRequest = { previewEntry = null; previewBytes = null },
                    title = {
                        Text(
                            text = currentEntry.name.substringAfterLast('/'),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    },
                    text = {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 300.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            if (isPreviewLoading) {
                                CircularProgressIndicator()
                            } else {
                                val bytes = previewBytes
                                if (bytes != null) {
                                    val isImage = currentEntry.name.endsWith(".jpg", ignoreCase = true) ||
                                            currentEntry.name.endsWith(".png", ignoreCase = true) ||
                                            currentEntry.name.endsWith(".webp", ignoreCase = true)

                                    if (isImage) {
                                        val bmp = remember(bytes) {
                                            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                                        }
                                        if (bmp != null) {
                                            androidx.compose.foundation.Image(
                                                bitmap = bmp.asImageBitmap(),
                                                contentDescription = currentEntry.name,
                                                modifier = Modifier.fillMaxWidth().heightIn(max = 280.dp)
                                            )
                                        } else {
                                            Text("Pratinjau gambar tidak dapat didekode.")
                                        }
                                    } else {
                                        val textSnippet = remember(bytes) {
                                            val len = minOf(bytes.size, 4096)
                                            String(bytes, 0, len, Charsets.UTF_8)
                                        }
                                        Text(
                                            text = textSnippet,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = TextPrimaryDark,
                                            maxLines = 12,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = { previewEntry = null; previewBytes = null }) {
                            Text(stringResource(R.string.native_close))
                        }
                    },
                    containerColor = SurfaceDeep,
                    shape = RoundedCornerShape(16.dp)
                )
            }
        }
    }
}
