package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveGridAspectRatio
import com.autogram.app.viewmodel.DriveSortOrder
import com.autogram.app.viewmodel.DriveThumbnailQuality

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveViewOptionsSheet(
    isGridView: Boolean,
    onToggleViewMode: () -> Unit,
    gridAspectRatio: DriveGridAspectRatio,
    onGridAspectRatioChange: (DriveGridAspectRatio) -> Unit,
    thumbnailQuality: DriveThumbnailQuality,
    onThumbnailQualityChange: (DriveThumbnailQuality) -> Unit,
    sortOrder: DriveSortOrder,
    onSortOrderChange: (DriveSortOrder) -> Unit,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

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
                .padding(bottom = 32.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(20.dp)
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
                        imageVector = Icons.Default.Tune,
                        contentDescription = null,
                        tint = GoldAccent,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = stringResource(R.string.drive_view_options_title),
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp
                        ),
                        color = TextPrimaryDark
                    )
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

            // Section 1: Layout Mode (Grid vs List)
            ViewOptionSection(title = stringResource(R.string.drive_view_layout_section)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OptionSelectCard(
                        icon = Icons.Default.GridView,
                        title = stringResource(R.string.drive_view_mode_grid),
                        subtitle = stringResource(R.string.drive_view_mode_grid_desc),
                        isSelected = isGridView,
                        onClick = { if (!isGridView) onToggleViewMode() },
                        modifier = Modifier.weight(1f)
                    )
                    OptionSelectCard(
                        icon = Icons.AutoMirrored.Filled.ViewList,
                        title = stringResource(R.string.drive_view_mode_list),
                        subtitle = stringResource(R.string.drive_view_mode_list_desc),
                        isSelected = !isGridView,
                        onClick = { if (isGridView) onToggleViewMode() },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Section 2: Grid Aspect Ratio (Poster 2:3 vs Square 1:1)
            if (isGridView) {
                ViewOptionSection(title = stringResource(R.string.drive_view_aspect_section)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OptionSelectCard(
                            icon = Icons.Default.CropPortrait,
                            title = stringResource(R.string.drive_aspect_poster_title),
                            subtitle = "2:3 Poster",
                            isSelected = gridAspectRatio == DriveGridAspectRatio.PORTRAIT,
                            onClick = { onGridAspectRatioChange(DriveGridAspectRatio.PORTRAIT) },
                            modifier = Modifier.weight(1f)
                        )
                        OptionSelectCard(
                            icon = Icons.Default.CropSquare,
                            title = stringResource(R.string.drive_aspect_square_title),
                            subtitle = "1:1 Kotak",
                            isSelected = gridAspectRatio == DriveGridAspectRatio.SQUARE,
                            onClick = { onGridAspectRatioChange(DriveGridAspectRatio.SQUARE) },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            // Section 3: Thumbnail Quality (Saver vs Balanced vs Sharp)
            ViewOptionSection(title = stringResource(R.string.drive_view_quality_section)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    QualityChip(
                        label = stringResource(R.string.drive_thumb_quality_saver),
                        desc = stringResource(R.string.drive_thumb_quality_saver_desc),
                        isSelected = thumbnailQuality == DriveThumbnailQuality.SAVER,
                        onClick = { onThumbnailQualityChange(DriveThumbnailQuality.SAVER) },
                        modifier = Modifier.weight(1f)
                    )
                    QualityChip(
                        label = stringResource(R.string.drive_thumb_quality_balanced),
                        desc = stringResource(R.string.drive_thumb_quality_balanced_desc),
                        isSelected = thumbnailQuality == DriveThumbnailQuality.BALANCED,
                        onClick = { onThumbnailQualityChange(DriveThumbnailQuality.BALANCED) },
                        modifier = Modifier.weight(1f)
                    )
                    QualityChip(
                        label = stringResource(R.string.drive_thumb_quality_sharp),
                        desc = stringResource(R.string.drive_thumb_quality_sharp_desc),
                        isSelected = thumbnailQuality == DriveThumbnailQuality.SHARP,
                        onClick = { onThumbnailQualityChange(DriveThumbnailQuality.SHARP) },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Section 4: Sort Order
            ViewOptionSection(title = stringResource(R.string.drive_view_sort_section)) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SortOrderRow(
                        label = stringResource(R.string.drive_sort_date_desc),
                        icon = Icons.Default.Schedule,
                        isSelected = sortOrder == DriveSortOrder.DATE_DESC,
                        onClick = { onSortOrderChange(DriveSortOrder.DATE_DESC) }
                    )
                    SortOrderRow(
                        label = stringResource(R.string.drive_sort_date_asc),
                        icon = Icons.Default.History,
                        isSelected = sortOrder == DriveSortOrder.DATE_ASC,
                        onClick = { onSortOrderChange(DriveSortOrder.DATE_ASC) }
                    )
                    SortOrderRow(
                        label = stringResource(R.string.drive_sort_size_desc),
                        icon = Icons.Default.DataUsage,
                        isSelected = sortOrder == DriveSortOrder.SIZE_DESC,
                        onClick = { onSortOrderChange(DriveSortOrder.SIZE_DESC) }
                    )
                    SortOrderRow(
                        label = stringResource(R.string.drive_sort_name_asc),
                        icon = Icons.Default.SortByAlpha,
                        isSelected = sortOrder == DriveSortOrder.NAME_ASC,
                        onClick = { onSortOrderChange(DriveSortOrder.NAME_ASC) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ViewOptionSection(
    title: String,
    content: @Composable () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelSmall.copy(
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp
            ),
            color = GoldAccent
        )
        content()
    }
}

@Composable
private fun OptionSelectCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (isSelected) MutedIceCyan.copy(alpha = 0.18f) else SurfaceElevatedDark,
        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
        modifier = modifier
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (isSelected) MutedIceCyan else TextSecondaryDark,
                modifier = Modifier.size(20.dp)
            )
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                        fontSize = 12.sp
                    ),
                    color = if (isSelected) TextPrimaryDark else TextSecondaryDark
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = TextMutedDark
                )
            }
        }
    }
}

@Composable
private fun QualityChip(
    label: String,
    desc: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = if (isSelected) MutedIceCyan.copy(alpha = 0.18f) else SurfaceElevatedDark,
        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 11.sp
                ),
                color = if (isSelected) MutedIceCyan else TextPrimaryDark
            )
            Text(
                text = desc,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = TextMutedDark
            )
        }
    }
}

@Composable
private fun SortOrderRow(
    label: String,
    icon: ImageVector,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = if (isSelected) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark.copy(alpha = 0.6f),
        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (isSelected) MutedIceCyan else TextMutedDark,
                modifier = Modifier.size(16.dp)
            )
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                    fontSize = 12.sp
                ),
                color = if (isSelected) TextPrimaryDark else TextSecondaryDark,
                modifier = Modifier.weight(1f)
            )
            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = null,
                    tint = MutedIceCyan,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}
