package com.autogram.app.features.cloud.preview

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
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
fun CloudPreview(item: DriveFileItem) {
    var source by remember(item) { mutableStateOf<CloudRangeSource?>(null) }
    var image by remember(item) { mutableStateOf<Bitmap?>(null) }
    var text by remember(item) { mutableStateOf<TextPreview?>(null) }
    var error by remember(item) { mutableStateOf<String?>(null) }
    val kind = previewKind(item.mimeType)
    LaunchedEffect(item) {
        var owned: CloudRangeSource? = null
        try {
            if (kind == PreviewKind.UNSUPPORTED) throw CloudFailure("cloud_format_unsupported")
            // An open completing concurrently with disposal must still release its capability.
            owned = withContext(NonCancellable) {
                CloudRangeSource.open(requireNotNull(item.cloudAccountId), requireNotNull(item.cloudPeerId), requireNotNull(item.cloudMessageId))
            }
            ensureActive()
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
    when {
        error != null -> Text(stringResource(cloudErrorLabel(error!!)))
        active == null -> {
            CircularProgressIndicator()
            Text(stringResource(R.string.cloud_preview_loading))
        }
        bitmap != null -> Image(bitmap.asImageBitmap(), contentDescription = item.name,
            contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().heightIn(max = 340.dp))
        kind == PreviewKind.TEXT -> {
            text?.let {
                if (it.truncated) Text(stringResource(R.string.cloud_text_truncated))
                Text(it.text)
            }
        }
        kind == PreviewKind.VIDEO || kind == PreviewKind.AUDIO ->
            key(active) { CloudMediaPlayer(active, Modifier.fillMaxWidth().height(240.dp),
                PlaybackScope(requireNotNull(item.cloudAccountId), requireNotNull(item.cloudPeerId), requireNotNull(item.cloudMessageId))) }
    }
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
