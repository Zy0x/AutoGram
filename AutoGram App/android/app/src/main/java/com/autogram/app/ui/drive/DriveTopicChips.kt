package com.autogram.app.ui.drive

import android.content.Context
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
import org.json.JSONArray
import org.json.JSONObject

data class DriveTopic(
    val id: Long,
    val title: String,
    val topMessageId: Long? = null,
    val isClosed: Boolean = false,
    val colorHex: String? = null,
    val iconEmoji: String? = null,
    val messageCount: Int? = null
)

/**
 * Persistence cache for Forum Topics (matching desktop driveTopicsCache.ts).
 */
class DriveTopicsStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("autogram_drive_topics", Context.MODE_PRIVATE)

    fun getTopics(sessionId: String, peerId: String): List<DriveTopic> {
        val raw = preferences.getString("${sessionId}_$peerId", null) ?: return defaultTopics()
        return try {
            val array = JSONArray(raw)
            val list = mutableListOf<DriveTopic>()
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                list.add(
                    DriveTopic(
                        id = obj.getLong("id"),
                        title = obj.getString("title"),
                        topMessageId = if (obj.has("topMessageId")) obj.getLong("topMessageId") else null,
                        isClosed = obj.optBoolean("isClosed", false),
                        colorHex = if (obj.has("colorHex")) obj.getString("colorHex") else null,
                        iconEmoji = if (obj.has("iconEmoji")) obj.getString("iconEmoji") else null,
                        messageCount = if (obj.has("messageCount")) obj.getInt("messageCount") else null
                    )
                )
            }
            if (list.isEmpty()) defaultTopics() else list
        } catch (_: Exception) {
            defaultTopics()
        }
    }

    fun saveTopics(sessionId: String, peerId: String, topics: List<DriveTopic>) {
        val array = JSONArray()
        topics.forEach {
            val obj = JSONObject()
                .put("id", it.id)
                .put("title", it.title)
                .put("isClosed", it.isClosed)
            if (it.topMessageId != null) obj.put("topMessageId", it.topMessageId)
            if (it.colorHex != null) obj.put("colorHex", it.colorHex)
            if (it.iconEmoji != null) obj.put("iconEmoji", it.iconEmoji)
            if (it.messageCount != null) obj.put("messageCount", it.messageCount)
            array.put(obj)
        }
        preferences.edit().putString("${sessionId}_$peerId", array.toString()).apply()
    }

    fun addTopic(sessionId: String, peerId: String, title: String, colorHex: String?, iconEmoji: String?): List<DriveTopic> {
        val current = getTopics(sessionId, peerId).toMutableList()
        val nextId = (current.maxOfOrNull { it.id } ?: 0L) + 1L
        val newTopic = DriveTopic(
            id = nextId,
            title = title,
            colorHex = colorHex,
            iconEmoji = iconEmoji
        )
        current.add(newTopic)
        saveTopics(sessionId, peerId, current)
        return current
    }

    private fun defaultTopics(): List<DriveTopic> = listOf(
        DriveTopic(id = 1L, title = "General", isClosed = false, colorHex = "#6FB9F0", iconEmoji = "💬")
    )
}

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
