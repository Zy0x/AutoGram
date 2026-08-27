package com.autogram.app.ui.drive

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
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
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveMediaFilter

@Composable
fun DriveTopBar(
    currentPath: String,
    itemCount: Int,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    mediaFilter: DriveMediaFilter,
    onMediaFilterChange: (DriveMediaFilter) -> Unit,
    isGridView: Boolean,
    onToggleViewMode: () -> Unit,
    onRefresh: () -> Unit,
    onUpload: () -> Unit
) {
    var isSearchExpanded by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Row 1: Home Breadcrumbs & Action Icons (matching user reference mockup)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Left: 🏠 › Telegram Cloud
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.clickable { onRefresh() }
            ) {
                Icon(
                    imageVector = Icons.Default.Home,
                    contentDescription = null,
                    tint = TextSecondaryDark,
                    modifier = Modifier.size(18.dp)
                )
                Text(
                    text = "›",
                    color = TextMutedDark,
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp)
                )
                Text(
                    text = if (currentPath.isBlank() || currentPath == "/") "Telegram Cloud" else currentPath.trimStart('/'),
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    ),
                    color = TextPrimaryDark
                )
            }

            // Right: 🔍  +  ⋮
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = "Search",
                    tint = TextSecondaryDark,
                    modifier = Modifier
                        .size(20.dp)
                        .clickable { isSearchExpanded = !isSearchExpanded }
                )
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "Add",
                    tint = TextSecondaryDark,
                    modifier = Modifier
                        .size(22.dp)
                        .clickable { onUpload() }
                )
                Icon(
                    imageVector = Icons.Default.MoreVert,
                    contentDescription = "More",
                    tint = TextSecondaryDark,
                    modifier = Modifier
                        .size(20.dp)
                        .clickable { onToggleViewMode() }
                )
            }
        }

        // Optional Search Bar when search is expanded
        AnimatedVisibility(visible = isSearchExpanded) {
            TextField(
                value = searchQuery,
                onValueChange = onSearchChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp),
                placeholder = {
                    Text(
                        stringResource(R.string.drive_search_placeholder),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextMutedDark
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = CardNavyBg,
                    unfocusedContainerColor = CardNavyBg,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedTextColor = TextPrimaryDark,
                    unfocusedTextColor = TextPrimaryDark
                )
            )
        }

        // Row 2: Filter Pills + Item Count (matching user reference mockup)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            val filters = listOf(
                DriveMediaFilter.ALL to "All",
                DriveMediaFilter.IMAGES to "Images",
                DriveMediaFilter.VIDEOS to "Videos",
                DriveMediaFilter.AUDIO to "Audio",
                DriveMediaFilter.DOCUMENTS to "Docs"
            )

            filters.forEach { (filter, label) ->
                val isSelected = mediaFilter == filter

                if (isSelected) {
                    // Solid Gold Pill
                    Surface(
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable { onMediaFilterChange(filter) },
                        shape = CircleShape,
                        color = GoldAccent
                    ) {
                        Text(
                            text = label,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 11.5.sp
                            ),
                            color = CanvasDeepNavy
                        )
                    }
                } else {
                    // Dark Pill
                    Surface(
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable { onMediaFilterChange(filter) },
                        shape = CircleShape,
                        color = CardNavyBg,
                        border = BorderStroke(1.dp, CardNavyBorder)
                    ) {
                        Text(
                            text = label,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.Medium,
                                fontSize = 11.5.sp
                            ),
                            color = TextSecondaryDark
                        )
                    }
                }
            }

            Spacer(Modifier.width(8.dp))

            // Far-Right: 124 Items Outline Pill
            Surface(
                shape = CircleShape,
                color = Color.Transparent,
                border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.6f))
            ) {
                Text(
                    text = "$itemCount items",
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
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
