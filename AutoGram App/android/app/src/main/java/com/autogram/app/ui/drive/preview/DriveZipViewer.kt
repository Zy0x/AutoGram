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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.zip.Inflater

data class ZipEntryItem(
    val name: String,
    val uncompressedSize: Long,
    val compressedSize: Long,
    val isDirectory: Boolean,
    val isEncrypted: Boolean,
    val method: Int,
    val localHeaderOffset: Long
)

@Composable
fun DriveZipViewer(
    source: CloudRangeSource,
    fileName: String,
    modifier: Modifier = Modifier
) {
    var entries by remember { mutableStateOf<List<ZipEntryItem>?>(null) }
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
                val parsed = parseZipCatalog(source)
                entries = parsed
            } catch (t: Throwable) {
                error = t.message ?: "Failed to parse ZIP archive"
            }
        }
    }

    val filteredEntries = remember(entries, searchQuery) {
        val list = entries ?: emptyList()
        if (searchQuery.isBlank()) list
        else list.filter { it.name.contains(searchQuery, ignoreCase = true) }
    }

    val totalUncompressed = remember(entries) {
        entries?.filter { !it.isDirectory }?.sumOf { it.uncompressedSize } ?: 0L
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
                                        loadEntryPreview(source, entry, onImage = { previewBitmap = it }, onText = { previewText = it })
                                        selectedEntry = entry
                                    }
                                },
                                onExtract = {
                                    scope.launch {
                                        isExtracting = true
                                        val success = extractSingleEntry(source, entry)
                                        isExtracting = false
                                        extractMessage = if (success) {
                                            context.getString(R.string.zip_extract_success, entry.name.substringAfterLast('/'))
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
                                    val success = extractSingleEntry(source, entry)
                                    extractMessage = if (success) {
                                        context.getString(R.string.zip_extract_success, entry.name.substringAfterLast('/'))
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
    val isPreviewable = !entry.isDirectory && !entry.isEncrypted && (isImage || isText)

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
                    entry.isDirectory -> Icons.Default.Folder
                    entry.isEncrypted -> Icons.Default.Lock
                    isImage -> Icons.Default.Image
                    isText -> Icons.Default.Description
                    else -> Icons.Default.InsertDriveFile
                },
                contentDescription = null,
                tint = if (entry.isDirectory) GoldAccent else if (isImage) DustySage else MutedIceCyan,
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
                if (!entry.isDirectory) {
                    Text(
                        text = "${formatFileSize(entry.uncompressedSize)} (${formatFileSize(entry.compressedSize)} compressed)",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMutedDark
                    )
                }
            }

            if (!entry.isDirectory) {
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

/** Parses Central Directory sparse bytes without downloading the full archive */
private suspend fun parseZipCatalog(source: CloudRangeSource): List<ZipEntryItem> = withContext(Dispatchers.IO) {
    val totalSize = source.size
    if (totalSize < 22) throw IllegalArgumentException("File too small to be a ZIP archive")

    val tailLen = minOf(totalSize, 65536L + 22L).toInt()
    val tailOffset = totalSize - tailLen
    val tailBytes = source.read(tailOffset, tailLen)

    // Locate EOCD signature 0x06054b50 scanning backwards
    var eocdPos = -1
    for (i in tailLen - 22 downTo 0) {
        if (tailBytes[i] == 0x50.toByte() &&
            tailBytes[i + 1] == 0x4B.toByte() &&
            tailBytes[i + 2] == 0x05.toByte() &&
            tailBytes[i + 3] == 0x06.toByte()
        ) {
            eocdPos = i
            break
        }
    }
    if (eocdPos == -1) throw IllegalArgumentException("EOCD signature not found in archive tail")

    val cdSize = readIntLE(tailBytes, eocdPos + 12)
    val cdOffset = readIntLE(tailBytes, eocdPos + 16)
    if (cdSize <= 0 || cdOffset < 0 || cdOffset + cdSize > totalSize) {
        throw IllegalArgumentException("Invalid Central Directory offsets")
    }

    // Read only Central Directory byte slice
    val cdBytes = source.read(cdOffset, cdSize.toInt())
    val results = mutableListOf<ZipEntryItem>()
    var ptr = 0

    while (ptr + 46 <= cdBytes.size) {
        if (cdBytes[ptr] != 0x50.toByte() ||
            cdBytes[ptr + 1] != 0x4B.toByte() ||
            cdBytes[ptr + 2] != 0x01.toByte() ||
            cdBytes[ptr + 3] != 0x02.toByte()
        ) {
            break // End of Central Directory entries
        }

        val flags = readShortLE(cdBytes, ptr + 8)
        val method = readShortLE(cdBytes, ptr + 10)
        val compressedSize = readIntLE(cdBytes, ptr + 20)
        val uncompressedSize = readIntLE(cdBytes, ptr + 24)
        val nameLen = readShortLE(cdBytes, ptr + 28)
        val extraLen = readShortLE(cdBytes, ptr + 30)
        val commentLen = readShortLE(cdBytes, ptr + 32)
        val localOffset = readIntLE(cdBytes, ptr + 42)

        if (ptr + 46 + nameLen > cdBytes.size) break
        val name = String(cdBytes, ptr + 46, nameLen, Charsets.UTF_8)
        val isDirectory = name.endsWith("/") || (uncompressedSize == 0L && compressedSize == 0L && name.endsWith("/"))
        val isEncrypted = (flags and 1) != 0

        results.add(
            ZipEntryItem(
                name = name,
                uncompressedSize = uncompressedSize,
                compressedSize = compressedSize,
                isDirectory = isDirectory,
                isEncrypted = isEncrypted,
                method = method,
                localHeaderOffset = localOffset
            )
        )

        ptr += 46 + nameLen + extraLen + commentLen
    }

    results
}

/** Fetches entry bytes and uncompresses for inline preview */
private suspend fun loadEntryPreview(
    source: CloudRangeSource,
    entry: ZipEntryItem,
    onImage: (Bitmap) -> Unit,
    onText: (String) -> Unit
) = withContext(Dispatchers.IO) {
    val uncompressed = fetchAndDecompressEntry(source, entry) ?: return@withContext
    val isImage = entry.name.lowercase().let { it.endsWith(".png") || it.endsWith(".jpg") || it.endsWith(".jpeg") || it.endsWith(".webp") }
    if (isImage) {
        val bitmap = BitmapFactory.decodeByteArray(uncompressed, 0, uncompressed.size)
        if (bitmap != null) onImage(bitmap)
    } else {
        val text = String(uncompressed, 0, minOf(uncompressed.size, 65536), Charsets.UTF_8)
        onText(text)
    }
}

/** Extracts a single entry to external Downloads folder */
private suspend fun extractSingleEntry(
    source: CloudRangeSource,
    entry: ZipEntryItem
): Boolean = withContext(Dispatchers.IO) {
    try {
        val uncompressed = fetchAndDecompressEntry(source, entry) ?: return@withContext false
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val destFile = File(downloadsDir, entry.name.substringAfterLast('/'))
        FileOutputStream(destFile).use { fos ->
            fos.write(uncompressed)
        }
        true
    } catch (_: Exception) {
        false
    }
}

private suspend fun fetchAndDecompressEntry(source: CloudRangeSource, entry: ZipEntryItem): ByteArray? = withContext(Dispatchers.IO) {
    if (entry.compressedSize <= 0) return@withContext ByteArray(0)
    // Read 30 bytes of Local File Header to calculate exact data payload start
    val localHeader = source.read(entry.localHeaderOffset, 30)
    if (localHeader.size < 30) return@withContext null
    val localNameLen = readShortLE(localHeader, 26)
    val localExtraLen = readShortLE(localHeader, 28)
    val payloadStart = entry.localHeaderOffset + 30 + localNameLen + localExtraLen

    val compressed = source.read(payloadStart, entry.compressedSize.toInt())
    if (entry.method == 0) {
        // Stored (no compression)
        compressed
    } else if (entry.method == 8) {
        // Deflated
        val inflater = Inflater(true) // raw deflate without zlib header
        val out = ByteArray(entry.uncompressedSize.toInt())
        inflater.setInput(compressed)
        inflater.inflate(out)
        inflater.end()
        out
    } else {
        null
    }
}

private fun readShortLE(bytes: ByteArray, offset: Int): Int {
    return (bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)
}

private fun readIntLE(bytes: ByteArray, offset: Int): Long {
    return (bytes[offset].toLong() and 0xFFL) or
            ((bytes[offset + 1].toLong() and 0xFFL) shl 8) or
            ((bytes[offset + 2].toLong() and 0xFFL) shl 16) or
            ((bytes[offset + 3].toLong() and 0xFFL) shl 24)
}
