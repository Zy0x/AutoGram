package com.autogram.app.ui.drive

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveForumTopicStrip(topics: List<DriveTopic>, activeTopicId: Long?,
    onSelectTopic: (Long?) -> Unit, onOpenTopicHub: () -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        LazyRow(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            item(key = "topic-all") {
                TextButton(onClick = { onSelectTopic(null) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.drive_topic_all),
                        color = if (activeTopicId == null) MutedIceCyan else TextSecondaryDark)
                }
            }
            items(topics, key = { it.id }) { topic ->
                val active = topic.id == activeTopicId
                TextButton(onClick = { onSelectTopic(if (active) null else topic.id) },
                    modifier = Modifier.heightIn(min = 48.dp).widthIn(max = 240.dp)) {
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
        IconButton(onClick = onOpenTopicHub, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Default.Layers, stringResource(R.string.drive_topic_hub_title), tint = TextSecondaryDark)
        }
    }
}
