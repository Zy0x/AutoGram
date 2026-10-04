package com.autogram.app.ui.jobs

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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface

data class BackgroundJob(
    val id: String,
    val name: String,
    val type: String,
    val status: String, // RUNNING, QUEUED, PAUSED, COMPLETED, FAILED
    val totalItems: Int,
    val processedItems: Int,
    val speedBps: Long,
    val errorMsg: String? = null
)

@Composable
fun JobsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var selectedTab by remember { mutableStateOf("ALL") }

    var jobsList by remember {
        mutableStateOf(
            listOf(
                BackgroundJob(
                    id = "job_101",
                    name = "Telegram Cloud Sync /Dokumen",
                    type = "CLOUD_SYNC",
                    status = "RUNNING",
                    totalItems = 120,
                    processedItems = 74,
                    speedBps = 3_450_000
                ),
                BackgroundJob(
                    id = "job_102",
                    name = "Clean Copy Forwarder -> Saved Messages",
                    type = "FORWARDER",
                    status = "RUNNING",
                    totalItems = 45,
                    processedItems = 12,
                    speedBps = 1_850_000
                ),
                BackgroundJob(
                    id = "job_103",
                    name = "Sparse ZIP Extraction (Archive_2026.zip)",
                    type = "ZIP_EXTRACT",
                    status = "COMPLETED",
                    totalItems = 18,
                    processedItems = 18,
                    speedBps = 0
                ),
                BackgroundJob(
                    id = "job_104",
                    name = "Batch Transcode 1080p -> HEVC",
                    type = "TRANSCODE",
                    status = "FAILED",
                    totalItems = 5,
                    processedItems = 2,
                    speedBps = 0,
                    errorMsg = "MediaCodec error: Resource busy"
                )
            )
        )
    }

    val filteredJobs = remember(jobsList, selectedTab) {
        when (selectedTab) {
            "ACTIVE" -> jobsList.filter { it.status == "RUNNING" || it.status == "QUEUED" || it.status == "PAUSED" }
            "COMPLETED" -> jobsList.filter { it.status == "COMPLETED" }
            "FAILED" -> jobsList.filter { it.status == "FAILED" }
            else -> jobsList
        }
    }

    val totalCount = jobsList.size
    val activeCount = jobsList.count { it.status == "RUNNING" || it.status == "QUEUED" || it.status == "PAUSED" }
    val completedCount = jobsList.count { it.status == "COMPLETED" }
    val failedCount = jobsList.count { it.status == "FAILED" }

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
                        text = stringResource(R.string.jobs_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.jobs_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Metrics Row
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    MetricCard(label = stringResource(R.string.jobs_metric_total), count = totalCount, color = TextPrimaryDark, modifier = Modifier.weight(1f))
                    MetricCard(label = stringResource(R.string.jobs_metric_active), count = activeCount, color = MutedIceCyan, modifier = Modifier.weight(1f))
                    MetricCard(label = stringResource(R.string.jobs_metric_completed), count = completedCount, color = DustySage, modifier = Modifier.weight(1f))
                    MetricCard(label = stringResource(R.string.jobs_tab_failed), count = failedCount, color = SoftCoral, modifier = Modifier.weight(1f))
                }
            }

            // Filter Tabs
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val tabs = listOf(
                        "ALL" to R.string.jobs_tab_all,
                        "ACTIVE" to R.string.jobs_tab_active,
                        "COMPLETED" to R.string.jobs_tab_completed,
                        "FAILED" to R.string.jobs_tab_failed
                    )
                    tabs.forEach { (tabKey, titleRes) ->
                        val isSelected = selectedTab == tabKey
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
                            border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                            modifier = Modifier
                                .weight(1f)
                                .clickable { selectedTab = tabKey }
                        ) {
                            Box(modifier = Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    text = stringResource(titleRes),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                        fontSize = 11.sp
                                    ),
                                    color = if (isSelected) MutedIceCyan else TextSecondaryDark
                                )
                            }
                        }
                    }
                }
            }

            // Clear Completed Button (if any completed)
            if (completedCount > 0) {
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(
                            onClick = {
                                jobsList = jobsList.filter { it.status != "COMPLETED" }
                                Toast.makeText(context, context.getString(R.string.jobs_cleared_success), Toast.LENGTH_SHORT).show()
                            }
                        ) {
                            Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(16.dp), tint = TextMutedDark)
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = stringResource(R.string.jobs_action_clear_completed),
                                style = MaterialTheme.typography.labelSmall,
                                color = TextMutedDark
                            )
                        }
                    }
                }
            }

            // Job List
            if (filteredJobs.isEmpty()) {
                item {
                    AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(R.string.jobs_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMutedDark
                        )
                    }
                }
            } else {
                items(filteredJobs, key = { it.id }) { job ->
                    JobCardItem(
                        job = job,
                        onTogglePause = {
                            jobsList = jobsList.map {
                                if (it.id == job.id) {
                                    it.copy(status = if (it.status == "RUNNING") "PAUSED" else "RUNNING")
                                } else it
                            }
                        },
                        onRetry = {
                            jobsList = jobsList.map {
                                if (it.id == job.id) it.copy(status = "RUNNING", errorMsg = null) else it
                            }
                        },
                        onCancel = {
                            jobsList = jobsList.filter { it.id != job.id }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun MetricCard(label: String, count: Int, color: Color, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = SurfaceElevatedDark,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(vertical = 10.dp, horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(count.toString(), style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold, color = color))
            Text(label, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, color = TextMutedDark), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun JobCardItem(
    job: BackgroundJob,
    onTogglePause: () -> Unit,
    onRetry: () -> Unit,
    onCancel: () -> Unit
) {
    val progress = if (job.totalItems > 0) job.processedItems.toFloat() / job.totalItems else 0f
    val (statusColor, statusText) = when (job.status) {
        "RUNNING" -> DustySage to "BERJALAN"
        "PAUSED" -> WarmAmber to "DIJEDA"
        "COMPLETED" -> DustySage to "SELESAI"
        "FAILED" -> SoftCoral to "GAGAL"
        else -> TextSecondaryDark to "ANTRE"
    }

    AutoGramGlassCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        borderColor = BorderHairline,
        containerColor = SurfaceDeep
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = job.name,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = statusColor.copy(alpha = 0.2f)
                ) {
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp,
                            color = statusColor
                        ),
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            if (job.errorMsg != null) {
                Text(
                    text = job.errorMsg,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                    color = SoftCoral
                )
            }

            // Progress bar
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp),
                color = if (job.status == "FAILED") SoftCoral else MutedIceCyan,
                trackColor = SurfaceElevatedDark
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "${job.processedItems} / ${job.totalItems} berkas (${(progress * 100).toInt()}%)",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                    color = TextSecondaryDark
                )

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (job.status == "RUNNING" || job.status == "PAUSED") {
                        IconButton(onClick = onTogglePause, modifier = Modifier.size(32.dp)) {
                            Icon(
                                if (job.status == "RUNNING") Icons.Default.Pause else Icons.Default.PlayArrow,
                                contentDescription = null,
                                tint = if (job.status == "RUNNING") WarmAmber else DustySage,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                    if (job.status == "FAILED") {
                        IconButton(onClick = onRetry, modifier = Modifier.size(32.dp)) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = null,
                                tint = MutedIceCyan,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                    IconButton(onClick = onCancel, modifier = Modifier.size(32.dp)) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = null,
                            tint = SoftCoral,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }
    }
}
