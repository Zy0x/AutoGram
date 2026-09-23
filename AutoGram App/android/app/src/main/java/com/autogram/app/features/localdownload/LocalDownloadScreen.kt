package com.autogram.app.features.localdownload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.autogram.app.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** Standalone route content. The parent owns navigation and the normal ViewModelStoreOwner. */
@Composable
fun LocalDownloadScreen(initialUrl: String = "") {
    val model: LocalDownloadViewModel = viewModel()
    val state by model.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(model, initialUrl) { model.acceptInitialUrl(initialUrl) }
    LaunchedEffect(model, lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                model.refresh()
                delay(1_500)
            }
        }
    }
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding(),
            contentPadding = PaddingValues(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.local_download_title), style = MaterialTheme.typography.headlineMedium)
                    Text(stringResource(R.string.local_download_scope), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        stringResource(R.string.local_download_storage),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = state.url,
                        onValueChange = model::updateUrl,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.busy,
                        label = { Text(stringResource(R.string.local_download_url)) },
                        placeholder = { Text(stringResource(R.string.local_download_url_hint)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        singleLine = true,
                        isError = state.error == LocalDownloadError.INVALID_URL
                    )
                    Button(
                        onClick = model::startDownload,
                        enabled = !state.busy && state.url.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    ) {
                        Text(stringResource(if (state.busy) R.string.local_download_working else R.string.local_download_start))
                    }
                    if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    state.error?.let {
                        Text(stringResource(it.textResource()), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            item {
                Text(stringResource(R.string.local_download_history), style = MaterialTheme.typography.titleLarge)
                Text(stringResource(R.string.local_download_limits, LocalDownloadPolicy.MAX_ACTIVE, LocalDownloadPolicy.MAX_TRACKED),
                    style = MaterialTheme.typography.bodySmall)
            }
            if (state.items.isEmpty()) {
                item {
                    Text(stringResource(if (state.refreshing) R.string.local_download_loading else R.string.local_download_empty))
                }
            }
            items(state.items, key = { it.id }) { item ->
                LocalDownloadCard(item, state.busy, model::requestCancel, model::open, model::forget)
            }
        }
    }
    state.cancelTarget?.let { target ->
        AlertDialog(
            onDismissRequest = model::dismissCancel,
            title = { Text(stringResource(R.string.local_download_cancel_title)) },
            text = { Text(stringResource(R.string.local_download_cancel_body, target.filename)) },
            confirmButton = {
                TextButton(onClick = model::confirmCancel, enabled = !state.busy) {
                    Text(stringResource(R.string.local_download_cancel_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = model::dismissCancel) { Text(stringResource(R.string.local_download_keep)) }
            }
        )
    }
}
