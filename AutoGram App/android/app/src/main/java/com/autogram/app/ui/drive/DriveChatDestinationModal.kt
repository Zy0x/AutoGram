package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudLocation
import com.autogram.app.features.cloud.CloudScope
import com.autogram.app.features.cloud.NativeCloudService
import com.autogram.app.features.cloud.topics.CloudTopicsStore
import kotlinx.coroutines.launch
import com.autogram.app.theme.*

@Composable
fun DriveChatDestinationModal(
    selectedCount: Int = 1,
    locations: List<CloudLocation> = emptyList(),
    sessionId: String = "",
    onForward: (targetPeerId: String, cleanCopy: Boolean, targetTopicId: Long?) -> Unit = { _, _, _ -> },
    onDismiss: () -> Unit
) {
    var selectedTarget by remember { mutableStateOf("me") }
    var cleanCopy by remember { mutableStateOf(true) }
    var customChatId by remember { mutableStateOf("") }
    var isCustomMode by remember { mutableStateOf(false) }
    var selectedTopicId by remember { mutableStateOf<Long?>(null) }

    val selectedLocation = remember(selectedTarget, locations) {
        locations.find { it.id == selectedTarget }
    }
    val isTargetForum = selectedLocation?.kind == "forum"
    val topicsStore = remember { CloudTopicsStore(NativeCloudService()) }
    val topicsState by topicsStore.state.collectAsState()
    val topicJobs = rememberCoroutineScope()
    val forumTopics = if (topicsState.scope == CloudScope(sessionId, selectedTarget)) topicsState.items else emptyList()
    LaunchedEffect(selectedTarget, sessionId, isTargetForum) {
        selectedTopicId = null
        topicsStore.scope(CloudScope(sessionId, selectedTarget))
        if (isTargetForum) topicsStore.load()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = DustySage.copy(alpha = 0.15f),
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Send,
                        contentDescription = null,
                        tint = DustySage,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }
        },
        title = {
            Text(
                text = stringResource(R.string.drive_dest_title),
                style = MaterialTheme.typography.titleLarge.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp
                ),
                color = TextPrimaryDark
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_dest_forward_prompt, selectedCount),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondaryDark
                )

                // Clean copy toggle
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = SurfaceElevatedDark,
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                text = stringResource(R.string.drive_dest_clean_copy_title),
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = stringResource(R.string.drive_dest_clean_copy_desc),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextMutedDark
                            )
                        }
                        Switch(
                            checked = cleanCopy,
                            onCheckedChange = { cleanCopy = it },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = Color.White,
                                checkedTrackColor = MutedIceCyan
                            )
                        )
                    }
                }

                // Preset destination options
                Text(
                    text = stringResource(R.string.drive_dest_select_target),
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextPrimaryDark
                )

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Option 1: Saved Messages
                    val isSavedSelected = !isCustomMode && selectedTarget == "me"
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (isSavedSelected) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSavedSelected) MutedIceCyan else BorderHairline),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                isCustomMode = false
                                selectedTarget = "me"
                                selectedTopicId = null
                            }
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            PeerAvatar(
                                title = stringResource(R.string.drive_dest_saved),
                                peerId = "me",
                                kind = "saved",
                                size = 32.dp
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = stringResource(R.string.drive_dest_saved),
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = if (isSavedSelected) FontWeight.Bold else FontWeight.Normal
                                    ),
                                    color = if (isSavedSelected) MutedIceCyan else TextPrimaryDark
                                )
                            }
                            if (isSavedSelected) Icon(Icons.Default.Check, null, tint = MutedIceCyan, modifier = Modifier.size(18.dp))
                        }
                    }

                    // Available dialog locations if any
                    locations.take(6).forEach { loc ->
                        val isLocSelected = !isCustomMode && selectedTarget == loc.id
                        val isLocForum = loc.kind == "forum"
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (isLocSelected) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark,
                            border = BorderStroke(1.dp, if (isLocSelected) MutedIceCyan else BorderHairline),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    isCustomMode = false
                                    selectedTarget = loc.id
                                    selectedTopicId = null
                                }
                        ) {
                            Row(
                                modifier = Modifier.padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                PeerAvatar(
                                    title = loc.title,
                                    peerId = loc.id,
                                    kind = loc.kind,
                                    isForum = isLocForum,
                                    size = 32.dp
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = loc.title,
                                        style = MaterialTheme.typography.bodyMedium.copy(
                                            fontWeight = if (isLocSelected) FontWeight.Bold else FontWeight.Normal
                                        ),
                                        color = if (isLocSelected) MutedIceCyan else TextPrimaryDark,
                                        maxLines = 1
                                    )
                                }
                                if (isLocSelected) Icon(Icons.Default.Check, null, tint = MutedIceCyan, modifier = Modifier.size(18.dp))
                            }
                        }
                    }

                    // Option Custom ID
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (isCustomMode) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isCustomMode) MutedIceCyan else BorderHairline),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { isCustomMode = true }
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(Icons.Default.Tag, null, tint = if (isCustomMode) MutedIceCyan else TextMutedDark)
                                Text(
                                    text = stringResource(R.string.drive_dest_custom),
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = if (isCustomMode) FontWeight.Bold else FontWeight.Normal
                                    ),
                                    color = if (isCustomMode) MutedIceCyan else TextPrimaryDark
                                )
                            }
                            if (isCustomMode) {
                                OutlinedTextField(
                                    value = customChatId,
                                    onValueChange = { customChatId = it },
                                    placeholder = { Text(stringResource(R.string.drive_dest_custom_hint)) },
                                    singleLine = true,
                                    shape = RoundedCornerShape(8.dp),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = MutedIceCyan,
                                        unfocusedBorderColor = BorderHairline,
                                        focusedTextColor = TextPrimaryDark,
                                        unfocusedTextColor = TextPrimaryDark
                                    ),
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                    }
                }

                // If Selected Destination is a Forum Supergroup, show Forum Topic Selector
                if (isTargetForum) {
                    if (topicsState.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    topicsState.error?.let { Text(stringResource(com.autogram.app.features.cloud.cloudErrorLabel(it))) }
                    Row(Modifier.fillMaxWidth()) {
                        TextButton(enabled = !topicsState.loading, onClick = { topicJobs.launch { topicsStore.load() } }) {
                            Text(stringResource(R.string.cloud_refresh))
                        }
                        if (topicsState.next != null) TextButton(enabled = !topicsState.loading,
                            onClick = { topicJobs.launch { topicsStore.load(true) } }) {
                            Text(stringResource(R.string.cloud_more))
                        }
                    }
                }
                if (isTargetForum && forumTopics.isNotEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.drive_dest_topic_label),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 11.sp
                            ),
                            color = GoldAccent
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            // "Semua / General" chip
                            FilterChip(
                                selected = selectedTopicId == null,
                                onClick = { selectedTopicId = null },
                                label = { Text(stringResource(R.string.drive_topic_all), fontSize = 11.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    containerColor = SurfaceElevatedDark,
                                    selectedContainerColor = GoldAccent
                                ),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.height(30.dp)
                            )
                            forumTopics.forEach { topic ->
                                val isSelected = selectedTopicId == topic.id
                                FilterChip(
                                    selected = isSelected,
                                    onClick = { selectedTopicId = topic.id },
                                    label = {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            if (topic.iconEmoji != null) {
                                                Text(topic.iconEmoji, fontSize = 11.sp)
                                            } else {
                                                Icon(Icons.Default.Tag, null, modifier = Modifier.size(12.dp))
                                            }
                                            Text(topic.title, fontSize = 11.sp)
                                        }
                                    },
                                    colors = FilterChipDefaults.filterChipColors(
                                        containerColor = SurfaceElevatedDark,
                                        selectedContainerColor = GoldAccent
                                    ),
                                    shape = RoundedCornerShape(16.dp),
                                    modifier = Modifier.height(30.dp)
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            val finalTarget = if (isCustomMode) customChatId.trim() else selectedTarget
            Button(
                onClick = {
                    onForward(finalTarget, cleanCopy, selectedTopicId)
                    onDismiss()
                },
                enabled = finalTarget.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = DustySage,
                    contentColor = SurfaceDeep
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.heightIn(min = 44.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_dest_apply),
                    fontWeight = FontWeight.Bold
                )
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.heightIn(min = 44.dp)
            ) {
                Text(stringResource(R.string.drive_action_cancel))
            }
        },
        shape = RoundedCornerShape(20.dp),
        containerColor = SurfaceDeep
    )
}
