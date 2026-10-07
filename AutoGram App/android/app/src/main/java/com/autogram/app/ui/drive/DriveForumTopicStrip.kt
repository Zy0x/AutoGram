package com.autogram.app.ui.drive

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveForumTopicStrip(topics: List<DriveTopic>, activeTopicId: Long?,
    onSelectTopic: (Long?) -> Unit, onOpenTopicHub: () -> Unit, modifier: Modifier = Modifier,
    loading: Boolean = false, error: String? = null, onRetry: () -> Unit = {}) {
    val rowState = rememberLazyListState()
    val selectedIndex = if (activeTopicId == null) 0 else topics.indexOfFirst { it.id == activeTopicId }
        .let { if (it < 0) -1 else it + 1 }
    LaunchedEffect(activeTopicId, selectedIndex) {
        val index = selectedIndex
        if (index >= 0 && rowState.layoutInfo.visibleItemsInfo.none { it.index == index }) rowState.scrollToItem(index)
    }
    Column(modifier.fillMaxWidth().testTag("drive-pinned-topics")) {
    Row(Modifier.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        LazyRow(Modifier.weight(1f), state = rowState, contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            item(key = "topic-all") {
                TextButton(onClick = { onSelectTopic(null) }, modifier = Modifier.heightIn(min = 48.dp)
                    .semantics { selected = activeTopicId == null }.testTag("drive-topic:all")) {
                    Text(stringResource(R.string.drive_topic_all),
                        color = if (activeTopicId == null) MutedIceCyan else TextSecondaryDark)
                }
            }
            items(topics, key = { it.id }) { topic ->
                val active = topic.id == activeTopicId
                TextButton(onClick = { onSelectTopic(if (active) null else topic.id) },
                    modifier = Modifier.heightIn(min = 48.dp).widthIn(max = 240.dp)
                        .semantics { selected = active }.testTag("drive-topic:${topic.id}")) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        // Actual server color is content metadata, not random chrome decoration.
                        val tint = topic.colorHex?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() }
                            ?: MutedIceCyan
                        Box(Modifier.size(6.dp).clip(CircleShape).background(tint))
                        Text(topic.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = if (active) MutedIceCyan else TextSecondaryDark)
                        if (topic.isClosed) Icon(Icons.Default.Lock, null, Modifier.size(14.dp), tint = TextMutedDark)
                    }
                }
            }
        }
        // Always reachable even when loading failed or no topics have been returned yet.
        TextButton(onClick = onOpenTopicHub, modifier = Modifier.heightIn(min = 48.dp).testTag("drive-topic-picker")) {
            Icon(Icons.Default.Layers, null, Modifier.size(18.dp), tint = TextSecondaryDark)
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.drive_topic_picker), style = MaterialTheme.typography.labelLarge)
        }
    }
    if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    error?.let { code ->
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(com.autogram.app.features.cloud.cloudErrorLabel(code)),
                Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = SoftCoral)
            TextButton(onClick = onRetry, enabled = !loading, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cloud_refresh))
            }
        }
    }
    }
}
