package com.autogram.app.features.preview

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import com.autogram.app.R
import com.autogram.app.ui.components.AutoGramSurface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class FilePreviewState(val name: String = "", val mime: String = "",
    val text: TextPreview? = null, val loading: Boolean = true, val failed: Boolean = false)

@Composable
fun LocalMediaPreviewScreen() {
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        // Access is granted by the picker, not by trusting a pathname or thumbnail.
        selected = uri?.takeIf { it.scheme == "content" }?.toString()
    }
    AutoGramSurface {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.real_local_preview), style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.real_local_preview_scope))
            Button(onClick = { picker.launch(arrayOf("image/*", "video/*", "audio/*", "text/*", "application/json")) }) {
                Text(stringResource(R.string.real_pick_file))
            }
            selected?.let { key(it) { LocalMediaContent(Uri.parse(it), Modifier.weight(1f).padding(bottom = 90.dp)) } }
        }
    }
}

@Composable
internal fun LocalMediaContent(uri: Uri, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val state by produceState(FilePreviewState(), uri) {
        value = withContext(Dispatchers.IO) {
            try {
                require(uri.scheme == "content")
                val resolver = context.contentResolver
                val mime = resolver.getType(uri).orEmpty()
                var name = ""
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) name = it.getString(0).orEmpty()
                }
                val text = if (previewKind(mime) in setOf(PreviewKind.TEXT, PreviewKind.MARKDOWN, PreviewKind.CODE, PreviewKind.LOG, PreviewKind.TABULAR, PreviewKind.JSON)) {
                    resolver.openInputStream(uri)?.use(::readTextPreview) ?: error("content_unavailable")
                } else null
                FilePreviewState(name, mime, text, loading = false)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { FilePreviewState(loading = false, failed = true) }
        }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(state.name, maxLines = 2)
        when {
            state.loading -> Text(stringResource(R.string.real_preview_loading))
            state.failed -> Text(stringResource(R.string.real_preview_failed))
            else -> when (previewKind(state.mime)) {
                PreviewKind.IMAGE -> SubcomposeAsyncImage(uri, state.name, Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                    loading = { CircularProgressIndicator() },
                    error = { Text(stringResource(R.string.real_preview_failed)) })
                PreviewKind.AUDIO, PreviewKind.VIDEO -> NativeMediaPlayer(uri, Modifier.fillMaxSize())
                PreviewKind.TEXT, PreviewKind.TABULAR, PreviewKind.JSON, PreviewKind.MARKDOWN, PreviewKind.CODE, PreviewKind.LOG -> {
                    if (state.text?.truncated == true) Text(stringResource(R.string.real_text_truncated))
                    SelectionContainer { Text(state.text?.text.orEmpty(), Modifier.verticalScroll(rememberScrollState())) }
                }
                PreviewKind.PDF, PreviewKind.STICKER, PreviewKind.HEX, PreviewKind.UNSUPPORTED -> Text(stringResource(R.string.real_preview_unsupported))
            }
        }
    }
}
