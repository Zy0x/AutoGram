package com.autogram.app.ui.forwarder

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ForwarderJobItem(
    val id: String,
    val source: String,
    val destination: String,
    val filterType: String,
    val totalCount: Int,
    val processedCount: Int,
    val status: String, // RUNNING, PAUSED, COMPLETED
    val stripCaptions: Boolean
)

@Composable
fun ForwarderScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var sourceInput by remember { mutableStateOf("") }
    var destInput by remember { mutableStateOf("") }
    var selectedFilter by remember { mutableStateOf("ALL") }

    // Clean Copy parameters
    var stripCaptions by remember { mutableStateOf(true) }
    var dedupCheck by remember { mutableStateOf(true) }
    var preserveCollage by remember { mutableStateOf(true) }
    var floodProtection by remember { mutableStateOf(true) }

    // Active Jobs
    var activeJobs by remember {
        mutableStateOf(
            listOf(
                ForwarderJobItem(
                    id = "fwd_1",
                    source = "@TechNewsArchive",
                    destination = "Saved Messages",
                    filterType = "PHOTO & VIDEO",
                    totalCount = 42,
                    processedCount = 18,
                    status = "RUNNING",
                    stripCaptions = true
                )
            )
        )
    }

    val filters = listOf(
        "ALL" to R.string.forwarder_filter_all,
        "PHOTO" to R.string.forwarder_filter_photo,
        "VIDEO" to R.string.forwarder_filter_video,
        "DOC" to R.string.forwarder_filter_doc,
        "AUDIO" to R.string.forwarder_filter_audio
    )

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
                        text = stringResource(R.string.forwarder_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.forwarder_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Clean Copy Pipeline Config Card
            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    borderColor = BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text(
                            text = stringResource(R.string.forwarder_clean_copy_title),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark
                        )

                        // Source Input
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = stringResource(R.string.forwarder_source_label),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextSecondaryDark
                            )
                            OutlinedTextField(
                                value = sourceInput,
                                onValueChange = { sourceInput = it },
                                placeholder = { Text(stringResource(R.string.forwarder_source_hint), fontSize = 12.sp) },
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                trailingIcon = {
                                    IconButton(onClick = { sourceInput = "Saved Messages" }) {
                                        Icon(Icons.Default.Bookmark, contentDescription = null, tint = SoftViolet)
                                    }
                                }
                            )
                        }

                        // Destination Input
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = stringResource(R.string.forwarder_dest_label),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextSecondaryDark
                            )
                            OutlinedTextField(
                                value = destInput,
                                onValueChange = { destInput = it },
                                placeholder = { Text(stringResource(R.string.forwarder_dest_hint), fontSize = 12.sp) },
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                trailingIcon = {
                                    IconButton(onClick = { destInput = "Saved Messages" }) {
                                        Icon(Icons.Default.Bookmark, contentDescription = null, tint = SoftViolet)
                                    }
                                }
                            )
                        }

                        // Filter Chips
                        Text(
                            text = "Filter Media:",
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                            color = TextSecondaryDark
                        )
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            items(filters) { (type, labelRes) ->
                                val isSelected = selectedFilter == type
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = if (isSelected) WarmAmber.copy(alpha = 0.2f) else SurfaceElevatedDark,
                                    border = BorderStroke(1.dp, if (isSelected) WarmAmber else BorderHairline),
                                    modifier = Modifier.clickable { selectedFilter = type }
                                ) {
                                    Text(
                                        text = stringResource(labelRes),
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                            fontSize = 11.sp
                                        ),
                                        color = if (isSelected) WarmAmber else TextSecondaryDark,
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                    )
                                }
                            }
                        }

                        HorizontalDivider(color = BorderHairline)

                        // Toggles
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(stringResource(R.string.forwarder_strip_captions), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                            Switch(checked = stripCaptions, onCheckedChange = { stripCaptions = it })
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(stringResource(R.string.forwarder_dedup_check), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                            Switch(checked = dedupCheck, onCheckedChange = { dedupCheck = it })
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(stringResource(R.string.forwarder_preserve_album), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                            Switch(checked = preserveCollage, onCheckedChange = { preserveCollage = it })
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(stringResource(R.string.forwarder_flood_protection), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                            Switch(checked = floodProtection, onCheckedChange = { floodProtection = it })
                        }

                        // Start Action Button
                        Button(
                            onClick = {
                                val src = if (sourceInput.isBlank()) "Source Channel" else sourceInput
                                val dst = if (destInput.isBlank()) "Saved Messages" else destInput
                                val newJob = ForwarderJobItem(
                                    id = "fwd_${System.currentTimeMillis()}",
                                    source = src,
                                    destination = dst,
                                    filterType = selectedFilter,
                                    totalCount = 30,
                                    processedCount = 0,
                                    status = "RUNNING",
                                    stripCaptions = stripCaptions
                                )
                                activeJobs = listOf(newJob) + activeJobs
                                Toast.makeText(context, context.getString(R.string.forwarder_job_started), Toast.LENGTH_SHORT).show()
                                sourceInput = ""
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = WarmAmber, contentColor = SurfaceDeep),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 44.dp)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.forwarder_action_start), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // Active Forwarder Jobs Section
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.forwarder_active_jobs_title),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark
                    )
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = WarmAmber.copy(alpha = 0.15f)
                    ) {
                        Text(
                            text = "${activeJobs.size} aktif",
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, color = WarmAmber)
                        )
                    }
                }
            }

            if (activeJobs.isEmpty()) {
                item {
                    AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(R.string.forwarder_empty_jobs),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMutedDark
                        )
                    }
                }
            } else {
                items(activeJobs, key = { it.id }) { job ->
                    ForwarderJobCard(
                        job = job,
                        onTogglePause = {
                            activeJobs = activeJobs.map {
                                if (it.id == job.id) {
                                    it.copy(status = if (it.status == "RUNNING") "PAUSED" else "RUNNING")
                                } else it
                            }
                        },
                        onCancel = {
                            activeJobs = activeJobs.filter { it.id != job.id }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ForwarderJobCard(
    job: ForwarderJobItem,
    onTogglePause: () -> Unit,
    onCancel: () -> Unit
) {
    val progress = if (job.totalCount > 0) job.processedCount.toFloat() / job.totalCount else 0f
    val isRunning = job.status == "RUNNING"

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
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = job.source,
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 120.dp)
                    )
                    Icon(Icons.Default.ArrowForward, contentDescription = null, modifier = Modifier.size(14.dp), tint = TextSecondaryDark)
                    Text(
                        text = job.destination,
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                        color = WarmAmber,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 120.dp)
                    )
                }

                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = if (isRunning) DustySage.copy(alpha = 0.2f) else SoftCoral.copy(alpha = 0.2f)
                ) {
                    Text(
                        text = if (isRunning) stringResource(R.string.forwarder_status_running) else stringResource(R.string.forwarder_status_paused),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.Bold,
                            color = if (isRunning) DustySage else SoftCoral
                        ),
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            // Progress bar
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp),
                color = WarmAmber,
                trackColor = SurfaceElevatedDark
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "${job.processedCount} / ${job.totalCount} media (${(progress * 100).toInt()}%)",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                    color = TextSecondaryDark
                )

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(onClick = onTogglePause, modifier = Modifier.size(32.dp)) {
                        Icon(
                            if (isRunning) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = null,
                            tint = if (isRunning) WarmAmber else DustySage,
                            modifier = Modifier.size(18.dp)
                        )
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
