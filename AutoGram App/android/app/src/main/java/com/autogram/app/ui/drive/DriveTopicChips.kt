package com.autogram.app.ui.drive

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    val isClosed: Boolean = false
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
                        isClosed = obj.optBoolean("isClosed", false)
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
            array.put(obj)
        }
        preferences.edit().putString("${sessionId}_$peerId", array.toString()).apply()
    }

    private fun defaultTopics(): List<DriveTopic> = listOf(
        DriveTopic(id = 1L, title = "General", isClosed = false)
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
            FilterChip(
                selected = isSelected,
                onClick = { onSelectTopic(if (isSelected) null else topic.id) },
                label = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = if (topic.isClosed) Icons.Default.Lock else Icons.Default.Tag,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = if (isSelected) Color.Black else if (topic.isClosed) TextMutedDark else GoldAccent
                        )
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
                    selectedContainerColor = GoldAccent
                ),
                border = BorderStroke(1.dp, if (isSelected) GoldAccent else BorderHairline),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.height(34.dp)
            )
        }
    }
}
