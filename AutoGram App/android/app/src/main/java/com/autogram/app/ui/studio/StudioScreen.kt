package com.autogram.app.ui.studio
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.ui.drive.DrivePreviewModal
import com.autogram.app.ui.drive.FileListItem
import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.viewmodel.DriveViewModel

@Composable
fun StudioScreen(viewModel: DriveViewModel, modifier: Modifier = Modifier) {
    val state by viewModel.uiState.collectAsState()
    var preview by remember { mutableStateOf<DriveFileItem?>(null) }
    val media = state.items.filterNot { it.isFolder }
    LaunchedEffect(state.sessionId, state.peerId, state.topicId) { preview = null }
    AutoGramSurface(modifier) {
        LazyColumn(Modifier.fillMaxSize().safeDrawingPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text(stringResource(R.string.nav_studio), style = MaterialTheme.typography.headlineMedium) }
            item { Text(stringResource(R.string.real_studio_scope)) }
            if (media.isEmpty()) item { Text(stringResource(R.string.real_studio_empty)) }
            items(media, key = { it.id }) { item ->
                FileListItem(item, false, { preview = item }, { preview = item })
            }
        }
    }
    preview?.let { DrivePreviewModal(it, media, { preview = null }, { next -> preview = next }) }
}
