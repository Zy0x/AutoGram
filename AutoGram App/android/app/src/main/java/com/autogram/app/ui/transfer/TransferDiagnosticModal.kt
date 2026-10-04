package com.autogram.app.ui.transfer

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.TransferTaskItem

@Composable
fun TransferDiagnosticModal(
    task: TransferTaskItem,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = SurfaceDeep,
            border = BorderStroke(1.dp, BorderHairline),
            modifier = Modifier
                .fillMaxWidth(0.92f)
                .fillMaxHeight(0.85f)
                .testTag("transfer-diagnostic-modal")
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Terminal, null, tint = SoftViolet, modifier = Modifier.size(24.dp))
                        Text(
                            text = stringResource(R.string.diagnostic_title),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark
                        )
                    }
                    IconButton(onClick = onDismiss, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Default.Close, null, tint = TextMutedDark)
                    }
                }

                // File Name & Status
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = SurfaceElevatedDark,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = task.fileName,
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = TextPrimaryDark,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = SoftViolet.copy(alpha = 0.2f)
                            ) {
                                Text(
                                    text = task.status.uppercase(),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                    color = SoftViolet,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                            Text(
                                text = "Stage: ${task.stage}",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextMutedDark
                            )
                        }
                    }
                }

                // Diagnostics Telemetry Body - Strictly Authentic Data
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    DiagnosticMetricCard(
                        icon = Icons.Default.Info,
                        title = stringResource(R.string.diagnostic_metric_status),
                        subtitle = "Status: ${task.status} · Stage: ${task.stage} · Paused: ${task.paused}"
                    )

                    val progressPercent = if (task.totalBytes > 0L) {
                        "${(task.transferredBytes * 100L / task.totalBytes).coerceIn(0L, 100L)}%"
                    } else {
                        "0%"
                    }
                    DiagnosticMetricCard(
                        icon = Icons.Default.DataUsage,
                        title = stringResource(R.string.diagnostic_metric_progress),
                        subtitle = "${formatFileSize(task.transferredBytes)} / ${formatFileSize(task.totalBytes)} ($progressPercent)"
                    )

                    DiagnosticMetricCard(
                        icon = Icons.Default.Speed,
                        title = stringResource(R.string.diagnostic_metric_speed),
                        subtitle = "${formatFileSize(task.speedBps)}/s · ETA: ${task.etaSecs}s"
                    )

                    DiagnosticMetricCard(
                        icon = Icons.Default.Replay,
                        title = stringResource(R.string.diagnostic_metric_retries),
                        subtitle = stringResource(R.string.diagnostic_attempts, task.attempt)
                    )

                    // Confidentiality: Mask source and destination endpoints to protect signed URLs and credentials
                    DiagnosticMetricCard(
                        icon = Icons.Default.Login,
                        title = stringResource(R.string.diagnostic_source, stringResource(R.string.diagnostic_endpoint_confidential)),
                        subtitle = "Source Type: ${if (task.sourceIdentity.startsWith("http")) "Remote Stream" else "Local / Telegram"}"
                    )

                    DiagnosticMetricCard(
                        icon = Icons.Default.CloudQueue,
                        title = stringResource(R.string.diagnostic_destination, stringResource(R.string.diagnostic_endpoint_tg)),
                        subtitle = "Target Type: Telegram Cloud Storage"
                    )

                    if (!task.errorCode.isNullOrBlank()) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.error.copy(alpha = 0.12f),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.4f)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    text = stringResource(R.string.diagnostic_error_details),
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                    color = MaterialTheme.colorScheme.error
                                )
                                Text(
                                    text = task.errorCode,
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                    color = MaterialTheme.colorScheme.error
                                )
                            }
                        }
                    }
                }

                // Copy Diagnostic Payload Button
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            val report = buildString {
                                appendLine("--- AutoGram Transfer Task Diagnostics ---")
                                appendLine("Task ID: ${task.id}")
                                appendLine("File: ${task.fileName}")
                                appendLine("Progress: ${task.transferredBytes} / ${task.totalBytes} bytes")
                                appendLine("Status: ${task.status}")
                                appendLine("Stage: ${task.stage}")
                                appendLine("Speed: ${task.speedBps} bps (${formatFileSize(task.speedBps)}/s)")
                                appendLine("ETA: ${task.etaSecs}s")
                                appendLine("Attempts: ${task.attempt}")
                                appendLine("Paused: ${task.paused}")
                                appendLine("Error: ${task.errorCode ?: "None"}")
                                appendLine("Source: [Protected Endpoint]")
                                appendLine("Destination: Telegram Cloud")
                            }
                            clipboard.setText(AnnotatedString(report))
                            Toast.makeText(context, context.getString(R.string.file_info_copied), Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.ContentCopy, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.file_info_copy), fontSize = 12.sp)
                    }

                    Button(
                        onClick = onDismiss,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SoftViolet)
                    ) {
                        Text(stringResource(R.string.native_close), fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun DiagnosticMetricCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = SurfaceElevatedDark,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = SoftViolet, modifier = Modifier.size(20.dp))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = TextMutedDark,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
