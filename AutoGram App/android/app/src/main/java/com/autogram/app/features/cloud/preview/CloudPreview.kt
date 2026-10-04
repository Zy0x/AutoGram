package com.autogram.app.features.cloud.preview

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import coil.compose.AsyncImage
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.cloudErrorLabel
import com.autogram.app.features.preview.*
import com.autogram.app.viewmodel.DriveFileItem
import kotlinx.coroutines.*
import java.io.ByteArrayInputStream

@Composable
fun CloudPreview(item: DriveFileItem, modifier: Modifier = Modifier) {
    var attempt by remember(item) { mutableIntStateOf(0) }
    var source by remember(item, attempt) { mutableStateOf<CloudRangeSource?>(null) }
    var image by remember(item, attempt) { mutableStateOf<Bitmap?>(null) }
    var text by remember(item, attempt) { mutableStateOf<TextPreview?>(null) }
    var rawBytes by remember(item, attempt) { mutableStateOf<ByteArray?>(null) }
    var error by remember(item, attempt) { mutableStateOf<String?>(null) }
    var opened by remember(item, attempt) { mutableStateOf(false) }
    val kind = previewKind(item.mimeType, item.name)
    LaunchedEffect(item, attempt) {
        var owned: CloudRangeSource? = null
        try {
            if (kind == PreviewKind.UNSUPPORTED) throw CloudFailure("cloud_format_unsupported")
            // An open completing concurrently with disposal must still release its capability.
            owned = withContext(NonCancellable) {
                CloudRangeSource.open(requireNotNull(item.cloudAccountId), requireNotNull(item.cloudPeerId), requireNotNull(item.cloudMessageId))
            }
            ensureActive()
            opened = true
            val active = owned
            when (kind) {
                PreviewKind.IMAGE -> {
                    if (active.size > 20 * 1024 * 1024) throw CloudFailure("cloud_image_too_large")
                    val bytes = readPrefix(active, active.size.toInt())
                    image = withContext(Dispatchers.Default) {
                        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw CloudFailure("cloud_format_unsupported")
                        var sample = 1
                        while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) sample *= 2
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                            ?: throw CloudFailure("cloud_format_unsupported")
                    }
                }
                PreviewKind.TEXT -> text = withContext(Dispatchers.IO) {
                    readTextPreview(ByteArrayInputStream(readPrefix(active, minOf(active.size, 256 * 1024L + 1).toInt())))
                }
                PreviewKind.TABULAR, PreviewKind.JSON, PreviewKind.HEX, PreviewKind.STICKER -> {
                    val limit = if (kind == PreviewKind.HEX) 65536L else 262144L
                    rawBytes = withContext(Dispatchers.IO) {
                        readPrefix(active, minOf(active.size, limit).toInt())
                    }
                }
                else -> Unit
            }
            source = active
            awaitCancellation()
        } catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { error = (failure as? CloudFailure)?.code ?: "cloud_read_failed" }
        catch (_: LinkageError) { error = "native_runtime_unavailable" }
        finally { withContext(NonCancellable + Dispatchers.IO) { runCatching { owned?.close() } } }
    }
    val active = source
    val bitmap = image
    Box(modifier, contentAlignment = Alignment.Center) { when {
        error != null -> Column(Modifier.testTag("preview-error"), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(cloudErrorLabel(error!!)))
            TextButton(onClick = { attempt++ }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.drive_action_refresh))
            }
        }
        active == null -> {
            if (kind == PreviewKind.IMAGE && item.thumbnailBytes != null) {
                AsyncImage(model = item.thumbnailBytes, contentDescription = item.name,
                    contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
            Column(Modifier.testTag(if (opened) "preview-reading" else "preview-opening"), horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Text(stringResource(R.string.cloud_preview_loading))
            }
        }
        bitmap != null -> CloudImageViewer(bitmap, item.name)
        kind == PreviewKind.TEXT -> {
            text?.let {
                if (item.name.endsWith(".json", ignoreCase = true) || item.mimeType.equals("application/json", ignoreCase = true)) {
                    com.autogram.app.ui.drive.preview.DriveJsonTreeViewer(
                        rawJson = it.text,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    com.autogram.app.ui.drive.preview.DriveRichTextPreview(
                        fileName = item.name,
                        preview = it,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
        kind == PreviewKind.TABULAR && rawBytes != null -> {
            com.autogram.app.ui.drive.preview.DriveTabularViewer(
                rawText = String(rawBytes!!, Charsets.UTF_8),
                fileName = item.name,
                modifier = Modifier.fillMaxSize()
            )
        }
        kind == PreviewKind.JSON && rawBytes != null -> {
            com.autogram.app.ui.drive.preview.DriveJsonTreeViewer(
                rawJson = String(rawBytes!!, Charsets.UTF_8),
                modifier = Modifier.fillMaxSize()
            )
        }
        kind == PreviewKind.HEX && rawBytes != null -> {
            com.autogram.app.ui.drive.preview.DriveHexInspector(
                bytes = rawBytes!!,
                fileName = item.name,
                modifier = Modifier.fillMaxSize()
            )
        }
        kind == PreviewKind.STICKER && rawBytes != null -> {
            com.autogram.app.ui.drive.preview.DriveLottiePlayer(
                rawBytes = rawBytes!!,
                fileName = item.name,
                modifier = Modifier.fillMaxSize()
            )
        }
        kind == PreviewKind.VIDEO || kind == PreviewKind.AUDIO ->
            key(active) { CloudMediaPlayer(active, Modifier.fillMaxSize(),
                PlaybackScope(requireNotNull(item.cloudAccountId), requireNotNull(item.cloudPeerId), requireNotNull(item.cloudMessageId)),
                audioOnly = kind == PreviewKind.AUDIO, onRetry = { attempt++ }) }
    } }
}

private suspend fun readPrefix(source: CloudRangeSource, length: Int): ByteArray {
    val output = ByteArray(length)
    var offset = 0
    while (offset < length) {
        currentCoroutineContext().ensureActive()
        val bytes = source.read(offset.toLong(), length - offset)
        bytes.copyInto(output, offset)
        offset += bytes.size
    }
    return output
}
