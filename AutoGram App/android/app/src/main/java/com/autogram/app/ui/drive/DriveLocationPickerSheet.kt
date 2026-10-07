package com.autogram.app.ui.drive

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudLocation
import com.autogram.app.features.cloud.topics.resolveDriveLocation
import com.autogram.app.theme.*
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persists up to 5 recently accessed drives for fast switching.
 */
class RecentDrivesStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("autogram_recent_drives", Context.MODE_PRIVATE)

    fun getRecents(sessionId: String): List<CloudLocation> {
        val raw = preferences.getString("recents_$sessionId", null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            val list = mutableListOf<CloudLocation>()
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                list.add(
                    CloudLocation(
                        id = obj.getString("id"),
                        title = obj.getString("title"),
                        kind = obj.getString("kind")
                    )
                )
            }
            list
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun addRecent(sessionId: String, location: CloudLocation) {
        val current = getRecents(sessionId).filterNot { it.id == location.id }.toMutableList()
        current.add(0, location)
        val trimmed = current.take(5)
        val array = JSONArray()
        trimmed.forEach {
            array.put(JSONObject().put("id", it.id).put("title", it.title).put("kind", it.kind))
        }
        preferences.edit().putString("recents_$sessionId", array.toString()).apply()
    }
}

enum class LocationCategoryFilter {
    ALL,
    SAVED,
    GROUPS,
    CHANNELS
}

/**
 * Modern Bottom Sheet for switching active Telegram Drive / Chat location.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveLocationPickerSheet(
    currentPeerId: String,
    locations: List<CloudLocation>,
    sessionId: String,
    onSelectLocation: (CloudLocation) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val recentStore = remember(context) { RecentDrivesStore(context) }
    var recents by remember(sessionId) { mutableStateOf(recentStore.getRecents(sessionId)) }
    val resolvedRecents = remember(recents, locations) { recents.map { resolveDriveLocation(it, locations) } }

    var searchQuery by remember { mutableStateOf("") }
    var categoryFilter by remember { mutableStateOf(LocationCategoryFilter.ALL) }
    var customizingLocation by remember { mutableStateOf<CloudLocation?>(null) }

    // Always ensure Saved Messages ("me") is present at the top
    val allLocations = remember(locations) {
        val hasMe = locations.any { it.id == "me" }
        if (hasMe) locations else listOf(CloudLocation("me", "Saved Messages", "self")) + locations
    }

    val filteredLocations = remember(allLocations, searchQuery, categoryFilter) {
        allLocations.filter { loc ->
            val matchesQuery = searchQuery.isBlank() || loc.title.contains(searchQuery, ignoreCase = true)
            val matchesCategory = when (categoryFilter) {
                LocationCategoryFilter.ALL -> true
                LocationCategoryFilter.SAVED -> loc.id == "me" || loc.kind in setOf("self", "user")
                LocationCategoryFilter.GROUPS -> loc.kind in setOf("group", "supergroup", "forum")
                LocationCategoryFilter.CHANNELS -> loc.kind == "channel"
            }
            matchesQuery && matchesCategory
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = SurfaceDeep,
        dragHandle = { BottomSheetDefaults.DragHandle(color = TextMutedDark) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 24.dp)
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = stringResource(R.string.drive_switch_location_title),
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.drive_switch_location_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.Close, contentDescription = null, tint = TextMutedDark)
                }
            }

            // Search Bar
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                placeholder = {
                    Text(stringResource(R.string.drive_search_chat_placeholder), fontSize = 13.sp)
                },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null, tint = TextSecondaryDark, modifier = Modifier.size(20.dp))
                },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Default.Close, contentDescription = null, tint = TextMutedDark, modifier = Modifier.size(16.dp))
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
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
                    .padding(horizontal = 20.dp, vertical = 6.dp)
                    .height(48.dp),
                textStyle = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp)
            )

            // Category Chips Row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                LocationCategoryFilter.values().forEach { cat ->
                    val isSelected = categoryFilter == cat
                    val label = when (cat) {
                        LocationCategoryFilter.ALL -> stringResource(R.string.drive_category_all)
                        LocationCategoryFilter.SAVED -> stringResource(R.string.drive_category_saved)
                        LocationCategoryFilter.GROUPS -> stringResource(R.string.drive_category_groups)
                        LocationCategoryFilter.CHANNELS -> stringResource(R.string.drive_category_channels)
                    }
                    FilterChip(
                        selected = isSelected,
                        onClick = { categoryFilter = cat },
                        label = { Text(label, fontSize = 11.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal) },
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = SurfaceElevatedDark,
                            selectedContainerColor = MutedIceCyan
                        ),
                        modifier = Modifier.height(32.dp)
                    )
                }
            }

            // Recents Section (if available and no active search query)
            if (resolvedRecents.isNotEmpty() && searchQuery.isBlank() && categoryFilter == LocationCategoryFilter.ALL) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    Text(
                        text = stringResource(R.string.drive_recent_locations),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp
                        ),
                        color = TextMutedDark,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                    resolvedRecents.forEach { recent ->
                        LocationRowItem(
                            location = recent,
                            isSelected = recent.id == currentPeerId,
                            onClick = {
                                recentStore.addRecent(sessionId, recent)
                                onSelectLocation(recent)
                                onDismiss()
                            },
                            onCustomize = { customizingLocation = recent }
                        )
                    }
                    HorizontalDivider(
                        color = SurfaceElevatedDark,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)
                    )
                }
            }

            // All Filtered Locations List
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .heightIn(max = 420.dp)
            ) {
                items(filteredLocations, key = { it.id }) { loc ->
                    LocationRowItem(
                        location = loc,
                        isSelected = loc.id == currentPeerId,
                        onClick = {
                            recentStore.addRecent(sessionId, loc)
                            onSelectLocation(loc)
                            onDismiss()
                        },
                        onCustomize = { customizingLocation = loc }
                    )
                }
            }
        }
    }

    if (customizingLocation != null) {
        val target = customizingLocation!!
        DriveCustomizeIconModal(
            peerId = target.id,
            title = target.title.ifEmpty { stringResource(R.string.cloud_saved_messages) },
            kind = target.kind,
            isForum = target.kind == "forum",
            onDismiss = { customizingLocation = null },
            onSaved = { customizingLocation = null }
        )
    }
}

@Composable
private fun LocationRowItem(
    location: CloudLocation,
    isSelected: Boolean,
    onClick: () -> Unit,
    onCustomize: () -> Unit = {}
) {
    val isForum = location.kind == "forum"
    val defaultTitle = stringResource(R.string.cloud_saved_messages)
    val displayTitle = location.title.ifEmpty { defaultTitle }
    val subtitle = when {
        location.id == "me" || location.kind == "self" -> stringResource(R.string.drive_kind_saved)
        isForum -> stringResource(R.string.drive_kind_forum)
        location.kind in setOf("group", "supergroup") -> stringResource(R.string.drive_kind_group)
        location.kind == "channel" -> stringResource(R.string.drive_kind_channel)
        location.kind == "bot" -> stringResource(R.string.drive_kind_bot)
        else -> stringResource(R.string.drive_kind_private)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(if (isSelected) MutedIceCyan.copy(alpha = 0.1f) else Color.Transparent)
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        PeerAvatar(
            title = displayTitle,
            peerId = location.id,
            kind = location.kind,
            isForum = isForum,
            size = 44.dp
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = displayTitle,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold
                ),
                color = if (isSelected) MutedIceCyan else TextPrimaryDark,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = if (isForum) GoldAccent.copy(alpha = 0.15f) else SurfaceElevatedDark
                ) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                        color = if (isForum) GoldAccent else TextSecondaryDark,
                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                    )
                }
            }
        }

        IconButton(
            onClick = onCustomize,
            modifier = Modifier.size(32.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Palette,
                contentDescription = stringResource(R.string.drive_customize_icon_title),
                tint = TextMutedDark,
                modifier = Modifier.size(16.dp)
            )
        }

        if (isSelected) {
            Icon(
                imageVector = Icons.Default.Check,
                contentDescription = null,
                tint = MutedIceCyan,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}
