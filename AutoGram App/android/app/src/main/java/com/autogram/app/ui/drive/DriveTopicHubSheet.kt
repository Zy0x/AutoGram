package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveTopicHubSheet(
    topics: List<DriveTopic>,
    activeTopicId: Long?,
    onSelectTopic: (Long?) -> Unit,
    onAddTopic: () -> Unit,
    onDismiss: () -> Unit,
    loading: Boolean = false,
    error: String? = null,
    hasMore: Boolean = false,
    onRefresh: () -> Unit = {},
    onMore: () -> Unit = {}
) {
    var searchQuery by remember { mutableStateOf("") }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val filteredTopics = remember(topics, searchQuery) {
        if (searchQuery.isBlank()) topics
        else topics.filter { it.title.contains(searchQuery, ignoreCase = true) }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SurfaceDeep,
        dragHandle = {
            BottomSheetDefaults.DragHandle(
                color = TextMutedDark.copy(alpha = 0.5f),
                width = 36.dp,
                height = 4.dp
            )
        }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Header Row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Forum,
                        contentDescription = null,
                        tint = GoldAccent,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = stringResource(R.string.drive_topic_hub_title),
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp
                        ),
                        color = TextPrimaryDark
                    )
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = GoldAccent.copy(alpha = 0.15f)
                    ) {
                        Text(
                            text = "${topics.size}",
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 11.sp
                            ),
                            color = GoldAccent,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }

                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = stringResource(R.string.drive_action_cancel),
                        tint = TextSecondaryDark,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            // Prominent Create Topic Button
            Button(
                onClick = {
                    onDismiss()
                    onAddTopic()
                },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = GoldAccent,
                    contentColor = Color.Black
                )
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Text(
                        text = stringResource(R.string.drive_action_create_topic),
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp
                        )
                    )
                }
            }

            // Topic Search Field (if more than 3 topics)
            if (topics.size > 3) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = {
                        Text(
                            text = stringResource(R.string.drive_topic_search_placeholder),
                            fontSize = 12.sp,
                            color = TextMutedDark
                        )
                    },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            tint = TextMutedDark,
                            modifier = Modifier.size(18.dp)
                        )
                    },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = null,
                                    tint = TextSecondaryDark,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = SurfaceDark,
                        unfocusedContainerColor = SurfaceDark,
                        focusedBorderColor = MutedIceCyan,
                        unfocusedBorderColor = BorderHairline,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                )
            }

            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(stringResource(com.autogram.app.features.cloud.cloudErrorLabel(it))) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = onRefresh, enabled = !loading, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.cloud_refresh))
                }
                if (hasMore) TextButton(onClick = onMore, enabled = !loading, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.cloud_more))
                }
            }

            // Topics List
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 380.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // "All Topics / General" Row
                item(key = "all_topics") {
                    val isAllSelected = activeTopicId == null
                    Surface(
                        onClick = {
                            onSelectTopic(null)
                            onDismiss()
                        },
                        shape = RoundedCornerShape(12.dp),
                        color = if (isAllSelected) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isAllSelected) MutedIceCyan else BorderHairline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = if (isAllSelected) MutedIceCyan else SurfaceDark,
                                modifier = Modifier.size(32.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.Default.Forum,
                                        contentDescription = null,
                                        tint = if (isAllSelected) Color.Black else MutedIceCyan,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = stringResource(R.string.drive_topic_all),
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = if (isAllSelected) FontWeight.Bold else FontWeight.SemiBold,
                                        fontSize = 13.sp
                                    ),
                                    color = if (isAllSelected) MutedIceCyan else TextPrimaryDark
                                )
                                Text(
                                    text = stringResource(R.string.drive_topic_all_desc),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                    color = TextMutedDark
                                )
                            }

                            if (isAllSelected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = null,
                                    tint = MutedIceCyan,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }

                // Individual Topics
                items(filteredTopics, key = { it.id }) { topic ->
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
                        onClick = {
                            onSelectTopic(if (isSelected) null else topic.id)
                            onDismiss()
                        },
                        shape = RoundedCornerShape(12.dp),
                        color = if (isSelected) topicTint.copy(alpha = 0.15f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSelected) topicTint else BorderHairline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            // Emoji / Color Dot Avatar
                            Surface(
                                shape = CircleShape,
                                color = topicTint.copy(alpha = 0.25f),
                                border = BorderStroke(1.5.dp, topicTint),
                                modifier = Modifier.size(32.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    if (topic.iconEmoji != null) {
                                        Text(text = topic.iconEmoji, fontSize = 16.sp)
                                    } else {
                                        Box(
                                            modifier = Modifier
                                                .size(10.dp)
                                                .clip(CircleShape)
                                                .background(topicTint)
                                        )
                                    }
                                }
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Text(
                                        text = topic.title,
                                        style = MaterialTheme.typography.bodyMedium.copy(
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                                            fontSize = 13.sp
                                        ),
                                        color = if (isSelected) topicTint else TextPrimaryDark,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    if (topic.isClosed) {
                                        Icon(
                                            imageVector = Icons.Default.Lock,
                                            contentDescription = null,
                                            tint = TextMutedDark,
                                            modifier = Modifier.size(12.dp)
                                        )
                                    }
                                }
                                topic.messageCount?.let { count ->
                                    Text(
                                        text = stringResource(R.string.drive_topic_item_count, count),
                                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                        color = TextMutedDark
                                    )
                                }
                            }

                            if (isSelected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = null,
                                    tint = topicTint,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }

                if (filteredTopics.isEmpty() && searchQuery.isNotBlank()) {
                    item(key = "empty_search") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(24.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = stringResource(R.string.drive_topic_not_found),
                                style = MaterialTheme.typography.bodySmall,
                                color = TextMutedDark
                            )
                        }
                    }
                }
            }
        }
    }
}
