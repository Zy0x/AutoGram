package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.*
import androidx.compose.runtime.*
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

typealias DriveTopic = com.autogram.app.features.cloud.topics.CloudTopic

/**
 * Interactive Horizontal Topic Chip Bar for Telegram Forum Supergroups.
 */
@Composable
fun DriveTopicChips(
    topics: List<DriveTopic>,
    activeTopicId: Long?,
    onSelectTopic: (Long?) -> Unit,
    onAddTopic: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // "All Topics" Chip
        val isAllSelected = activeTopicId == null
        FilterChip(
            selected = isAllSelected,
            onClick = { onSelectTopic(null) },
            label = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Forum,
                        contentDescription = null,
                        modifier = Modifier.size(15.dp),
                        tint = if (isAllSelected) Color.Black else MutedIceCyan
                    )
                    Text(
                        text = stringResource(R.string.drive_topic_all),
                        fontWeight = if (isAllSelected) FontWeight.Bold else FontWeight.Medium,
                        fontSize = 12.sp,
                        color = if (isAllSelected) Color.Black else TextPrimaryDark
                    )
                }
            },
            colors = FilterChipDefaults.filterChipColors(
                containerColor = SurfaceElevatedDark,
                selectedContainerColor = MutedIceCyan
            ),
            border = BorderStroke(1.dp, if (isAllSelected) MutedIceCyan else BorderHairline),
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.height(34.dp)
        )

        // Individual Topic Chips
        topics.forEach { topic ->
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

            FilterChip(
                selected = isSelected,
                onClick = { onSelectTopic(if (isSelected) null else topic.id) },
                label = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        if (topic.iconEmoji != null) {
                            Text(text = topic.iconEmoji, fontSize = 12.sp)
                        } else {
                            // Colored dot or lock icon
                            if (topic.isClosed) {
                                Icon(
                                    imageVector = Icons.Default.Lock,
                                    contentDescription = null,
                                    modifier = Modifier.size(13.dp),
                                    tint = if (isSelected) Color.Black else TextMutedDark
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(7.dp)
                                        .clip(CircleShape)
                                        .background(if (isSelected) Color.Black else topicTint)
                                )
                            }
                        }

                        Text(
                            text = topic.title,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            fontSize = 12.sp,
                            color = if (isSelected) Color.Black else TextPrimaryDark
                        )
                    }
                },
                colors = FilterChipDefaults.filterChipColors(
                    containerColor = SurfaceDark,
                    selectedContainerColor = topicTint
                ),
                border = BorderStroke(1.dp, if (isSelected) topicTint else BorderHairline),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.height(34.dp)
            )
        }

        // Add Topic Chip Button (+)
        Surface(
            onClick = onAddTopic,
            shape = RoundedCornerShape(20.dp),
            color = SurfaceElevatedDark,
            border = BorderStroke(1.dp, BorderHairline),
            modifier = Modifier.height(34.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = stringResource(R.string.drive_action_create_topic),
                    tint = GoldAccent,
                    modifier = Modifier.size(15.dp)
                )
                Text(
                    text = stringResource(R.string.drive_topic_add),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 11.sp
                    ),
                    color = GoldAccent
                )
            }
        }
    }
}
