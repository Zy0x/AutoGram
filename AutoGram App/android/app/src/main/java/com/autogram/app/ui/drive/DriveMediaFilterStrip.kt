package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramStatusDot
import com.autogram.app.viewmodel.DriveMediaFilter

@Composable
fun DriveMediaFilterStrip(
    activeFilter: DriveMediaFilter,
    onFilterChange: (DriveMediaFilter) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        items(DriveMediaFilter.entries, key = { it.name }) { filter ->
            val labelRes = when (filter) {
                DriveMediaFilter.ALL -> R.string.drive_filter_all
                DriveMediaFilter.MEDIA -> R.string.drive_filter_media
                DriveMediaFilter.IMAGES -> R.string.drive_filter_images
                DriveMediaFilter.VIDEOS -> R.string.drive_filter_videos
                DriveMediaFilter.AUDIO -> R.string.drive_filter_audio
                DriveMediaFilter.DOCUMENTS -> R.string.drive_filter_documents
                DriveMediaFilter.STICKERS -> R.string.drive_filter_stickers
            }
            val isSelected = filter == activeFilter

            Surface(
                onClick = { onFilterChange(filter) },
                shape = RoundedCornerShape(10.dp),
                color = if (isSelected) MutedIceCyan.copy(alpha = 0.12f) else androidx.compose.ui.graphics.Color.Transparent,
                modifier = Modifier.heightIn(min = 48.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    Text(
                        text = stringResource(labelRes),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            fontSize = 14.sp
                        ),
                        color = if (isSelected) TextPrimaryDark else TextSecondaryDark
                    )
                }
            }
        }
    }
}
