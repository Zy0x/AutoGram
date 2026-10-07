package com.autogram.app.ui.drive.gallery

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloud.*
import com.autogram.app.theme.*

/** Real account-owned locations; no social/story fixtures or a duplicate refresh toolbar. */
@Composable
fun DriveStories(state: CloudState, onLoad: (Boolean) -> Unit, onChoose: (CloudLocation) -> Unit,
    modifier: Modifier = Modifier, compact: Boolean = false) {
    val rowState = rememberLazyListState()
    val locations = state.locations.filter { it.id != "me" && it.kind != "self" }
    val activeIndex = if (state.scope.peerId == "me") 0 else locations.indexOfFirst { it.id == state.scope.peerId }
        .let { if (it < 0) -1 else it + 1 }
    LaunchedEffect(state.scope.accountId, state.scope.peerId, activeIndex) {
        if (activeIndex >= 0 && rowState.layoutInfo.visibleItemsInfo.none { it.index == activeIndex }) rowState.scrollToItem(activeIndex)
    }
    Column(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp)) {
        LazyRow(Modifier.testTag("drive-stories"), state = rowState, contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "saved") {
                StoryDrive(CloudLocation("me", stringResource(R.string.cloud_saved_messages), "self"), state, onChoose, compact)
            }
            items(locations, key = { "location:${it.id}" }) {
                StoryDrive(it, state, onChoose, compact)
            }
            if (state.locationsCursor != null) item(key = "more") {
                Surface(onClick = { onLoad(true) }, enabled = !state.loadingLocations, color = Color.Transparent,
                    modifier = if (compact) Modifier.size(48.dp) else Modifier.width(76.dp)) {
                    Column(Modifier.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(if (compact) 40.dp else 56.dp), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.MoreHoriz, stringResource(R.string.clean_drive_more), tint = MutedIceCyan)
                        }
                        if (!compact) {
                            Spacer(Modifier.height(6.dp))
                            Text(stringResource(R.string.ui2_more), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
        if (state.loadingLocations) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
        state.locationsError?.let { code ->
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(stringResource(cloudErrorLabel(code)), color = SoftCoral, style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = { onLoad(false) }, enabled = !state.loadingLocations) {
                    Text(stringResource(R.string.cloud_refresh))
                }
            }
        }
    }
}

@Composable
private fun StoryDrive(location: CloudLocation, state: CloudState, onChoose: (CloudLocation) -> Unit, compact: Boolean) {
    val active = state.scope.peerId == location.id || (location.kind == "self" && state.scope.peerId == "me")
    val title = location.title.ifBlank { location.id }
    Surface(onClick = { onChoose(location) }, enabled = state.scope.accountId.isNotBlank(),
        shape = MaterialTheme.shapes.small,
        color = if (compact && active) SurfaceElevatedDark else Color.Transparent,
        modifier = (if (compact) Modifier.heightIn(min = 48.dp).widthIn(max = 180.dp) else Modifier.width(76.dp))
            .semantics { selected = active }.testTag("drive-location:${location.id}")) {
        if (compact) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (location.kind == "self") Icon(Icons.Default.Bookmark, null, Modifier.size(20.dp), tint = MutedIceCyan)
                Text(if (location.kind == "self") stringResource(R.string.ui2_saved) else title,
                    style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (active) TextPrimaryDark else TextSecondaryDark)
            }
        } else {
        Column(Modifier.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(shape = CircleShape, color = SurfaceDeep,
                border = if (active) BorderStroke(2.dp, MutedIceCyan) else null,
                modifier = Modifier.size(56.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    if (location.kind == "self") Icon(Icons.Default.Bookmark, null, Modifier.size(24.dp),
                        tint = if (active) MutedIceCyan else TextSecondaryDark)
                    else Text(title.firstOrNull()?.uppercaseChar()?.toString().orEmpty(),
                        style = MaterialTheme.typography.titleLarge,
                        color = if (active) TextPrimaryDark else TextSecondaryDark)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(if (location.kind == "self") stringResource(R.string.ui2_saved) else title,
                style = MaterialTheme.typography.labelSmall, color = if (active) TextPrimaryDark else TextSecondaryDark,
                maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        }
        }
    }
}
