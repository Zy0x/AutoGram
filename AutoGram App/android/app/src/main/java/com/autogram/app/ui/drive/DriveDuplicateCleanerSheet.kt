package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.viewmodel.DriveFileItem

data class DuplicateFileGroup(
    val groupKey: String,
    val name: String,
    val size: Long,
    val files: List<DriveFileItem>
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveDuplicateCleanerSheet(
    items: List<DriveFileItem>,
    onDismiss: () -> Unit,
    onCleanDuplicates: (List<String>) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Analyze duplicates: group by exact size and canonical stem
    val duplicateGroups = remember(items) {
        val validFiles = items.filter { !it.isFolder && it.size > 0 }
        validFiles
            .groupBy { "${it.name.trim().lowercase()}_${it.size}" }
            .filter { it.value.size > 1 }
            .map { (key, group) ->
                DuplicateFileGroup(
                    groupKey = key,
                    name = group.first().name,
                    size = group.first().size,
                    files = group
                )
            }
    }

    val totalReclaimableBytes = remember(duplicateGroups) {
        duplicateGroups.sumOf { group -> (group.files.size - 1) * group.size }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = SurfaceDeep,
        dragHandle = { BottomSheetDefaults.DragHandle(color = BorderHairline) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = stringResource(R.string.drive_dedup_title),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.drive_dedup_reclaimable, formatFileSize(totalReclaimableBytes)),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
                        color = if (totalReclaimableBytes > 0) WarmAmber else DustySage
                    )
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.Close, contentDescription = null, tint = TextMutedDark)
                }
            }

            if (duplicateGroups.isEmpty()) {
                // Clean empty state
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = DustySage, modifier = Modifier.size(44.dp))
                        Text(
                            text = stringResource(R.string.drive_dedup_clean_empty),
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = TextPrimaryDark
                        )
                    }
                }
            } else {
                // Summary bar
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = WarmAmber.copy(alpha = 0.12f),
                    border = BorderStroke(1.dp, WarmAmber.copy(alpha = 0.3f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = WarmAmber, modifier = Modifier.size(18.dp))
                        Text(
                            text = stringResource(R.string.drive_dedup_found, duplicateGroups.size),
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, color = WarmAmber)
                        )
                    }
                }

                // Duplicate List
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 280.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(duplicateGroups, key = { it.groupKey }) { group ->
                        AutoGramGlassCard(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            borderColor = BorderHairline,
                            containerColor = SurfaceElevatedDark
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = group.name,
                                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                        color = TextPrimaryDark,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = "${group.files.size} salinan · ${formatFileSize(group.size)} per file",
                                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                        color = TextSecondaryDark
                                    )
                                }
                                Surface(shape = RoundedCornerShape(6.dp), color = SoftCoral.copy(alpha = 0.15f)) {
                                    Text(
                                        text = "-${formatFileSize((group.files.size - 1) * group.size)}",
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = 10.sp, color = SoftCoral)
                                    )
                                }
                            }
                        }
                    }
                }

                // 1-Click Auto Clean Button
                Button(
                    onClick = {
                        val idsToDelete = duplicateGroups.flatMap { group ->
                            group.files.drop(1).map { it.id }
                        }
                        onCleanDuplicates(idsToDelete)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = SoftCoral, contentColor = Color.White),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 46.dp)
                ) {
                    Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.drive_dedup_clean_action), fontWeight = FontWeight.Bold)
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}
