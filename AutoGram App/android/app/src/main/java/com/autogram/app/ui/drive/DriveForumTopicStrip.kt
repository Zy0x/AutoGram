package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveForumTopicStrip(
    topics: List<DriveTopic>,
    activeTopicId: Long?,
    onSelectTopic: (Long?) -> Unit,
    onAddTopic: () -> Unit,
    onOpenTopicHub: () -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // "All Topics" Chip
        item(key = "topic_all") {
            val isSelected = activeTopicId == null
            Surface(
                onClick = { onSelectTopic(null) },
                shape = RoundedCornerShape(16.dp),
                color = if (isSelected) MutedIceCyan.copy(alpha = 0.25f) else SurfaceElevatedDark,
                border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                modifier = Modifier.height(32.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "# ${stringResource(R.string.drive_topic_all)}",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            fontSize = 11.sp
                        ),
                        color = if (isSelected) TextPrimaryDark else TextSecondaryDark
                    )
                }
            }
        }

        // Individual Topic Chips
        items(topics, key = { it.id }) { topic ->
            val isSelected = activeTopicId == topic.id
            val topicTint = remember(topic.colorHex) {
                if (topic.colorHex != null) {
                    try {
                        Color(android.graphics.Color.parseColor(topic.colorHex))
                    } catch (_: Exception) {
                        GoldAccent
                    }
                } else GoldAccent
            }

            Surface(
                onClick = { onSelectTopic(if (isSelected) null else topic.id) },
                shape = RoundedCornerShape(16.dp),
                color = if (isSelected) topicTint.copy(alpha = 0.25f) else SurfaceElevatedDark,
                border = BorderStroke(1.dp, if (isSelected) topicTint else BorderHairline),
                modifier = Modifier.height(32.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    if (topic.iconEmoji != null) {
                        Text(text = topic.iconEmoji, fontSize = 12.sp)
                    } else {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(topicTint)
                        )
                    }

                    Text(
                        text = topic.title,
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            fontSize = 11.sp
                        ),
                        color = if (isSelected) TextPrimaryDark else TextSecondaryDark
                    )

                    if (topic.isClosed) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            tint = TextMutedDark,
                            modifier = Modifier.size(11.dp)
                        )
                    }
                }
            }
        }

        // Add Topic (+) Chip
        item(key = "add_topic_btn") {
            Surface(
                onClick = onAddTopic,
                shape = RoundedCornerShape(16.dp),
                color = SurfaceElevatedDark,
                border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.5f)),
                modifier = Modifier.height(32.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = stringResource(R.string.drive_action_create_topic),
                        tint = GoldAccent,
                        modifier = Modifier.size(14.dp)
                    )
                    Text(
                        text = stringResource(R.string.drive_topic_add),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 10.sp
                        ),
                        color = GoldAccent
                    )
                }
            }
        }

        // Topic Hub Sheet Icon Button
        if (topics.isNotEmpty()) {
            item(key = "topic_hub_btn") {
                IconButton(
                    onClick = onOpenTopicHub,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Layers,
                        contentDescription = stringResource(R.string.drive_topic_hub_title),
                        tint = GoldAccent,
                        modifier = Modifier.size(17.dp)
                    )
                }
            }
        }
    }
}
