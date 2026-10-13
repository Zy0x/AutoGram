package com.autogram.app.ui.drive.preview

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Environment
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.theme.*
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.ui.drive.zip.SparseZipReader
import com.autogram.app.ui.drive.zip.ZipEntryItem
import com.autogram.app.ui.drive.zip.zipErrorMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

@Composable
fun DriveZipViewer(
    source: CloudRangeSource,
    fileName: String,
    modifier: Modifier = Modifier
) {
    var entries by remember { mutableStateOf<List<ZipEntryItem>?>(null) }
    var zipReader by remember(source) { mutableStateOf<SparseZipReader?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    var selectedEntry by remember { mutableStateOf<ZipEntryItem?>(null) }
    var previewBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var previewText by remember { mutableStateOf<String?>(null) }
    var isExtracting by remember { mutableStateOf(false) }
    var extractMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(source) {
        withContext(Dispatchers.IO) {
            try {
                val reader = SparseZipReader(source)
                val parsed = reader.listEntries()
                zipReader = reader
                entries = parsed
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (t: Exception) {
                error = zipErrorMessage(context, t)
            }
        }
    }

    val filteredEntries = remember(entries, searchQuery) {
        val list = entries ?: emptyList()
        if (searchQuery.isBlank()) list
        else list.filter { it.name.contains(searchQuery, ignoreCase = true) }
    }

    val totalUncompressed = remember(entries) {
        entries?.filter { !it.isFolder }?.sumOf { it.uncompressedSize } ?: 0L
    }

    Column(modifier = modifier.fillMaxSize().padding(12.dp)) {
        // Archive Header Card
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = SurfaceElevatedDark,
            border = BorderStroke(1.dp, BorderHairline),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = SoftViolet.copy(alpha = 0.2f),
                    modifier = Modifier.size(42.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.FolderZip,
                            contentDescription = null,
                            tint = SoftViolet,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = fileName,
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = if (entries != null) {
                            stringResource(
                                R.string.zip_summary_info,
                                entries!!.size,
                                formatFileSize(totalUncompressed)
                            )
                        } else {
                            stringResource(R.string.cloud_preview_loading)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMutedDark
                    )
                }
            }
        }

        Spacer(Modifier.height(10.dp))

        // Search Filter
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text(stringResource(R.string.zip_search_placeholder), color = TextMutedDark) },
            leadingIcon = { Icon(Icons.Default.Search, null, tint = TextMutedDark) },
            trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                    IconButton(onClick = { searchQuery = "" }) {
                        Icon(Icons.Default.Clear, null, tint = TextMutedDark)
                    }
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = SurfaceElevatedDark,
                unfocusedContainerColor = SurfaceElevatedDark,
                focusedBorderColor = MutedIceCyan,
                unfocusedBorderColor = BorderHairline
            ),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        )

        Spacer(Modifier.height(8.dp))

        // Extract Status Toast / Banner
        extractMessage?.let { msg ->
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MutedIceCyan.copy(alpha = 0.15f),
                border = BorderStroke(1.dp, MutedIceCyan),
                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
            ) {
                Text(
                    text = msg,
                    style = MaterialTheme.typography.bodySmall,
                    color = MutedIceCyan,
                    modifier = Modifier.padding(10.dp)
                )
            }
        }

        // Entries List
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when {
                error != null -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Default.Warning, null, tint = ErrorRed, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = error ?: "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = ErrorRed
                        )
                    }
                }
                entries == null -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        CircularProgressIndicator(color = MutedIceCyan)
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = stringResource(R.string.zip_reading_directory),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMutedDark
                        )
                    }
                }
                filteredEntries.isEmpty() -> {
                    Text(
                        text = stringResource(R.string.zip_empty),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextMutedDark,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().testTag("zip-entry-list"),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        items(filteredEntries, key = { it.name + it.localHeaderOffset }) { entry ->
                            ZipEntryRow(
                                entry = entry,
                                onPreview = {
                                    scope.launch {
                                        zipReader?.let { reader -> loadEntryPreview(reader, entry, onImage = { previewBitmap = it }, onText = { previewText = it }) }
                                        selectedEntry = entry
                                    }
                                },
                                onExtract = {
                                    scope.launch {
                                        isExtracting = true
                                        val success = zipReader?.let { extractSingleEntry(it, entry) } == true
                                        isExtracting = false
                                        extractMessage = if (success) {
                                            context.getString(R.string.zip_extract_success)
                                        } else {
                                            context.getString(R.string.zip_extract_failed)
                                        }
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    // Modal Preview for Selected Zip Entry
    if (selectedEntry != null && (previewBitmap != null || previewText != null)) {
        Dialog(onDismissRequest = {
            selectedEntry = null
            previewBitmap = null
            previewText = null
        }) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = SurfaceElevatedDark,
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier.fillMaxWidth().padding(16.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = selectedEntry?.name?.substringAfterLast('/') ?: "",
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = {
                            selectedEntry = null
                            previewBitmap = null
                            previewText = null
                        }) {
                            Icon(Icons.Default.Close, null, tint = TextMutedDark)
                        }
                    }

                    Spacer(Modifier.height(12.dp))

                    if (previewBitmap != null) {
                        AsyncImage(
                            model = previewBitmap,
                            contentDescription = selectedEntry?.name,
                            modifier = Modifier.fillMaxWidth().heightIn(max = 340.dp).clip(RoundedCornerShape(8.dp))
                        )
                    } else if (previewText != null) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = SurfaceDark,
                            modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp)
                        ) {
                            Text(
                                text = previewText ?: "",
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                color = TextPrimaryDark,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }

                    Spacer(Modifier.height(16.dp))

                    Button(
                        onClick = {
                            selectedEntry?.let { entry ->
                                scope.launch {
                                    val success = zipReader?.let { extractSingleEntry(it, entry) } == true
                                    extractMessage = if (success) {
                                        context.getString(R.string.zip_extract_success)
                                    } else {
                                        context.getString(R.string.zip_extract_failed)
                                    }
                                    selectedEntry = null
                                    previewBitmap = null
                                    previewText = null
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = MutedIceCyan, contentColor = Color.Black),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth().height(44.dp)
                    ) {
                        Icon(Icons.Default.Download, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.zip_action_extract_entry), fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun ZipEntryRow(
    entry: ZipEntryItem,
    onPreview: () -> Unit,
    onExtract: () -> Unit
) {
    val isImage = entry.name.lowercase().let { it.endsWith(".png") || it.endsWith(".jpg") || it.endsWith(".jpeg") || it.endsWith(".webp") }
    val isText = entry.name.lowercase().let { it.endsWith(".txt") || it.endsWith(".md") || it.endsWith(".json") || it.endsWith(".csv") || it.endsWith(".log") }
    val isPreviewable = !entry.isFolder && !entry.isEncrypted && (isImage || isText)

    Surface(
        shape = RoundedCornerShape(10.dp),
        color = SurfaceElevatedDark,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .clickable(enabled = isPreviewable, onClick = onPreview)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                imageVector = when {
                    entry.isFolder -> Icons.Default.Folder
                    entry.isEncrypted -> Icons.Default.Lock
                    isImage -> Icons.Default.Image
                    isText -> Icons.Default.Description
                    else -> Icons.Default.InsertDriveFile
                },
                contentDescription = null,
                tint = if (entry.isFolder) GoldAccent else if (isImage) DustySage else MutedIceCyan,
                modifier = Modifier.size(24.dp)
            )

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (!entry.isFolder) {
                    Text(
                        text = "${formatFileSize(entry.uncompressedSize)} (${formatFileSize(entry.compressedSize)} compressed)",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMutedDark
                    )
                }
            }

            if (!entry.isFolder) {
                IconButton(
                    onClick = onExtract,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Download,
                        contentDescription = stringResource(R.string.zip_action_extract_entry),
                        tint = TextPrimaryDark,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}

/** Displays extracted bytes only after the shared sparse reader validates the entry. */
private suspend fun loadEntryPreview(
    reader: SparseZipReader,
    entry: ZipEntryItem,
    onImage: (Bitmap) -> Unit,
    onText: (String) -> Unit
) = withContext(Dispatchers.IO) {
    val uncompressed = reader.extractEntryBytes(entry)
    val isImage = entry.name.lowercase().let { it.endsWith(".png") || it.endsWith(".jpg") || it.endsWith(".jpeg") || it.endsWith(".webp") }
    if (isImage) {
        val bitmap = BitmapFactory.decodeByteArray(uncompressed, 0, uncompressed.size)
        if (bitmap != null) onImage(bitmap)
    } else {
        onText(String(uncompressed, 0, minOf(uncompressed.size, 65536), Charsets.UTF_8))
    }
}

/** Writes only checksum-verified bytes from the selected sparse entry. */
private suspend fun extractSingleEntry(reader: SparseZipReader, entry: ZipEntryItem): Boolean = withContext(Dispatchers.IO) {
    try {
        val uncompressed = reader.extractEntryBytes(entry)
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val destFile = File(downloadsDir, entry.name.substringAfterLast('/'))
        FileOutputStream(destFile).use { it.write(uncompressed) }
        true
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        false
    }
}
