package com.autogram.app.ui.sync

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface

data class FolderSyncPair(
    val id: String,
    val labelRes: Int,
    val localPath: String,
    val cloudPath: String,
    var direction: String, // TWO_WAY, UPLOAD_ONLY, DOWNLOAD_ONLY
    val pendingCount: Int,
    val isSyncing: Boolean
)

@Composable
fun SyncScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var isFullSyncing by remember { mutableStateOf(false) }

    var syncPairs by remember {
        mutableStateOf(
            listOf(
                FolderSyncPair(
                    id = "pair_camera",
                    labelRes = R.string.sync_pair_camera,
                    localPath = "DCIM/Camera",
                    cloudPath = "Telegram /Foto",
                    direction = "UPLOAD_ONLY",
                    pendingCount = 4,
                    isSyncing = false
                ),
                FolderSyncPair(
                    id = "pair_downloads",
                    labelRes = R.string.sync_pair_downloads,
                    localPath = "Download/AutoGram",
                    cloudPath = "Telegram /Dokumen",
                    direction = "TWO_WAY",
                    pendingCount = 0,
                    isSyncing = false
                ),
                FolderSyncPair(
                    id = "pair_media",
                    labelRes = R.string.sync_pair_media,
                    localPath = "Movies",
                    cloudPath = "Telegram /Video",
                    direction = "TWO_WAY",
                    pendingCount = 2,
                    isSyncing = false
                )
            )
        )
    }

    val totalPending = syncPairs.sumOf { it.pendingCount }

    AutoGramSurface(modifier = modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = stringResource(R.string.sync_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.sync_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Sync Status Overview Banner
            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    borderColor = if (totalPending > 0) GoldAccent else BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(
                                    imageVector = if (totalPending > 0) Icons.Default.SyncProblem else Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    tint = if (totalPending > 0) GoldAccent else DustySage,
                                    modifier = Modifier.size(20.dp)
                                )
                                Text(
                                    text = if (totalPending > 0) stringResource(R.string.sync_status_pending, totalPending) else stringResource(R.string.sync_status_in_sync),
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = if (totalPending > 0) GoldAccent else DustySage
                                )
                            }
                            Text(
                                text = stringResource(R.string.sync_last_synced, "14 menit yang lalu"),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextMutedDark
                            )
                        }

                        Button(
                            onClick = {
                                isFullSyncing = true
                                Toast.makeText(context, context.getString(R.string.sync_started_success), Toast.LENGTH_SHORT).show()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = GoldAccent, contentColor = SurfaceDeep),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.heightIn(min = 40.dp)
                        ) {
                            Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.sync_action_sync_all), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                    }
                }
            }

            // Folder Pairs Header
            item {
                Text(
                    text = "Pasangan Folder Aktif:",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextSecondaryDark
                )
            }

            items(syncPairs, key = { it.id }) { pair ->
                SyncPairCard(
                    pair = pair,
                    onDirectionChange = { newDir ->
                        syncPairs = syncPairs.map {
                            if (it.id == pair.id) it.copy(direction = newDir) else it
                        }
                    },
                    onSyncSingle = {
                        Toast.makeText(context, context.getString(R.string.sync_started_success), Toast.LENGTH_SHORT).show()
                    }
                )
            }
        }
    }
}

@Composable
private fun SyncPairCard(
    pair: FolderSyncPair,
    onDirectionChange: (String) -> Unit,
    onSyncSingle: () -> Unit
) {
    val directions = listOf(
        "TWO_WAY" to R.string.sync_dir_bidirectional,
        "UPLOAD_ONLY" to R.string.sync_dir_upload_only,
        "DOWNLOAD_ONLY" to R.string.sync_dir_download_only
    )

    AutoGramGlassCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        borderColor = BorderHairline,
        containerColor = SurfaceDeep
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(pair.labelRes),
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )

                if (pair.pendingCount > 0) {
                    Surface(shape = RoundedCornerShape(6.dp), color = GoldAccent.copy(alpha = 0.15f)) {
                        Text(
                            text = "${pair.pendingCount} tertunda",
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = 10.sp, color = GoldAccent)
                        )
                    }
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = pair.localPath,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = TextSecondaryDark
                )
                Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(16.dp), tint = GoldAccent)
                Text(
                    text = pair.cloudPath,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = TextSecondaryDark
                )
            }

            // Direction Chips
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                directions.forEach { (dirKey, labelRes) ->
                    val isSelected = pair.direction == dirKey
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isSelected) GoldAccent.copy(alpha = 0.2f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSelected) GoldAccent else BorderHairline),
                        modifier = Modifier.weight(1f).clickable { onDirectionChange(dirKey) }
                    ) {
                        Box(modifier = Modifier.padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
                            Text(
                                text = stringResource(labelRes),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    fontSize = 10.sp
                                ),
                                color = if (isSelected) GoldAccent else TextSecondaryDark
                            )
                        }
                    }
                }
            }

            // Action
            OutlinedButton(
                onClick = onSyncSingle,
                modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp),
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, BorderHairline)
            ) {
                Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(14.dp), tint = TextPrimaryDark)
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.sync_action_sync_now), color = TextPrimaryDark, fontSize = 12.sp)
            }
        }
    }
}
