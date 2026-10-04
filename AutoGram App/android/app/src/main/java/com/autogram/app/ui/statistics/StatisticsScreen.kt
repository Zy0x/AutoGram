package com.autogram.app.ui.statistics

import android.text.format.Formatter
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.workspace.summarizeWorkspace
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.ui.components.ScreenHeader
import com.autogram.app.viewmodel.DriveUiState
import com.autogram.app.viewmodel.TransferUiState

import android.content.Intent
import androidx.compose.ui.unit.sp
import com.autogram.app.theme.SoftViolet

@Composable
fun StatisticsScreen(drive: DriveUiState, transfers: TransferUiState, onRefresh: () -> Unit) {
    val summary = remember(drive.items, transfers.activeTasks, transfers.completedTasks) {
        summarizeWorkspace(drive.items, transfers.activeTasks + transfers.completedTasks)
    }
    val context = LocalContext.current
    AutoGramSurface {
        LazyColumn(
            modifier = Modifier.align(Alignment.TopCenter).widthIn(max = 640.dp)
                .fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item { ScreenHeader(R.string.nav_statistics, R.string.statistics_local_scope) }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onRefresh,
                        enabled = !drive.isLoading && !transfers.isLoading,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.drive_action_refresh))
                    }
                    Button(
                        onClick = {
                            val csv = buildString {
                                appendLine("ID,FileName,Status,Stage,SpeedBps,TransferredBytes,TotalBytes,Attempt,ErrorCode")
                                (transfers.activeTasks + transfers.completedTasks).forEach { t ->
                                    val safeName = "\"${t.fileName.replace("\"", "\"\"")}\""
                                    appendLine("${t.id},$safeName,${t.status},${t.stage},${t.speedBps},${t.transferredBytes},${t.totalBytes},${t.attempt},\"${t.errorCode.orEmpty()}\"")
                                }
                            }
                            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_SUBJECT, "Laporan Transfer AutoGram")
                                putExtra(Intent.EXTRA_TEXT, csv)
                            }
                            context.startActivity(Intent.createChooser(sendIntent, context.getString(R.string.statistics_export_csv)))
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = SoftViolet),
                        modifier = Modifier.weight(1.3f)
                    ) {
                        Text(stringResource(R.string.statistics_export_csv), fontSize = 11.sp)
                    }
                }
            }
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.nav_transfer), style = MaterialTheme.typography.titleMedium)
                    when {
                        transfers.isLoading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        transfers.errorCode != null -> Text(stringResource(R.string.workspace_load_error))
                        else -> {
                            Metric(R.string.statistics_running, summary.running.toString())
                            Metric(R.string.statistics_queued, summary.queued.toString())
                            Metric(R.string.statistics_paused, summary.paused.toString())
                            Metric(R.string.statistics_completed, summary.completed.toString())
                            Metric(R.string.statistics_failed, summary.failed.toString())
                            Metric(R.string.statistics_cancelled, summary.cancelled.toString())
                            Metric(R.string.statistics_skipped, summary.skipped.toString())
                            Metric(R.string.transfer_metric_speed, stringResource(R.string.transfer_speed,
                                Formatter.formatFileSize(context, summary.speedBps)))
                        }
                    }
                }
            }
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.workspace_folder_scope), style = MaterialTheme.typography.titleMedium)
                    when {
                        drive.isLoading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        drive.errorCode != null -> Text(stringResource(R.string.workspace_load_error))
                        drive.sessionId.isBlank() || drive.peerId.isBlank() -> Text(stringResource(R.string.workspace_scope_required))
                        else -> {
                            Metric(R.string.statistics_files, summary.fileCount.toString())
                            Metric(R.string.statistics_folders, summary.folderCount.toString())
                            Metric(R.string.statistics_indexed_bytes, Formatter.formatFileSize(context, summary.knownFileBytes))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Metric(label: Int, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(label), modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.titleSmall)
    }
}
