package com.autogram.app.ui.drive.gallery

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloud.*

/** Actual cloud scopes, no fabricated stories or avatars. */
@Composable
fun DriveStories(state: CloudState, onLoad: (Boolean) -> Unit, onChoose: (CloudLocation) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.clean_drive_stories), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            IconButton(onClick = { onLoad(false) }, enabled = state.scope.accountId.isNotBlank() && !state.loadingLocations) {
                Icon(Icons.Default.Refresh, stringResource(R.string.cloud_refresh))
            }
        }
        LazyRow(modifier = Modifier.testTag("drive-stories"), contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "saved") {
                StoryDrive(CloudLocation("me", stringResource(R.string.cloud_saved_messages), "self"), state, onChoose)
            }
            items(state.locations.filter { it.id != "me" && it.kind != "self" }, key = { "location:${it.id}" }) {
                StoryDrive(it, state, onChoose)
            }
            if (state.locationsCursor != null) item(key = "more") {
                Column(Modifier.width(88.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    OutlinedIconButton(onClick = { onLoad(true) }, enabled = !state.loadingLocations,
                        modifier = Modifier.size(64.dp)) { Icon(Icons.Default.MoreHoriz, stringResource(R.string.clean_drive_more)) }
                    Text(stringResource(R.string.clean_drive_more), style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(top = 8.dp), maxLines = 2)
                }
            }
        }
        if (state.loadingLocations) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 20.dp))
        state.locationsError?.let { code ->
            Text(stringResource(cloudErrorLabel(code)), Modifier.padding(horizontal = 20.dp),
                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun StoryDrive(location: CloudLocation, state: CloudState, onChoose: (CloudLocation) -> Unit) {
    val active = state.scope.peerId == location.id || (location.kind == "self" && state.scope.peerId == "me")
    val title = location.title.ifBlank { location.id }
    val scheme = MaterialTheme.colorScheme
    Surface(onClick = { onChoose(location) }, enabled = state.scope.accountId.isNotBlank(),
        color = androidx.compose.ui.graphics.Color.Transparent,
        modifier = Modifier.width(88.dp).semantics { selected = active }) {
        Column(Modifier.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(Modifier.size(64.dp), shape = CircleShape,
                color = if (active) scheme.primaryContainer else scheme.surfaceVariant,
                border = BorderStroke(if (active) 2.dp else 1.dp, if (active) scheme.primary else scheme.outlineVariant)) {
                Box(contentAlignment = Alignment.Center) {
                    if (location.kind == "self") Icon(Icons.Default.BookmarkBorder, null, tint = scheme.primary)
                    else Text(title.take(1).uppercase(java.util.Locale.getDefault()), style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold, color = scheme.onSurface)
                }
            }
            Text(title, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelMedium,
                color = if (active) scheme.onSurface else scheme.onSurfaceVariant,
                maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}
