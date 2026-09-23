package com.autogram.app.ui.home

import android.text.format.Formatter
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.autogram.app.R
import com.autogram.app.features.workspace.summarizeWorkspace
import com.autogram.app.navigation.Screen
import com.autogram.app.runtime.NativeRuntimeStatus
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*
import com.autogram.app.viewmodel.DriveUiState
import com.autogram.app.viewmodel.TransferUiState

@Composable
fun HomeScreen(
    navController: NavController,
    drive: DriveUiState,
    transfers: TransferUiState,
    runtime: NativeRuntimeStatus,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier
) {
    val summary = remember(drive.items, transfers.activeTasks, transfers.completedTasks) {
        summarizeWorkspace(drive.items, transfers.activeTasks + transfers.completedTasks)
    }
    val context = LocalContext.current
    fun open(screen: Screen) = navigatePrimary(navController, screen.route, Screen.Home.route)

    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier.align(Alignment.TopCenter).widthIn(max = 640.dp)
                .fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            item {
                ScreenHeader(R.string.app_name, R.string.home_subtitle) {
                    IconButton(onClick = onRefresh, enabled = !drive.isLoading && !transfers.isLoading) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh))
                    }
                }
            }
            item {
                StatusPill(
                    text = stringResource(when (runtime) {
                        NativeRuntimeStatus.STARTING -> R.string.native_runtime_starting
                        NativeRuntimeStatus.READY -> R.string.native_runtime_ready
                        NativeRuntimeStatus.UNAVAILABLE -> R.string.native_runtime_unavailable
                    }),
                    color = if (runtime == NativeRuntimeStatus.READY) NeonCyan else GoldAccent
                )
            }
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.home_action_add_link), style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.home_remote_description), color = TextSecondaryDark)
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { open(Screen.Remote) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Icon(Screen.Remote.icon, null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.home_action_open_remote))
                    }
                }
            }
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth(), onClick = { open(Screen.Transfer) }) {
                    SectionHeading(stringResource(R.string.home_active_transfers))
                    Spacer(Modifier.height(8.dp))
                    when {
                        transfers.isLoading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        transfers.errorCode != null -> Text(stringResource(R.string.workspace_load_error), color = SoftCoral)
                        transfers.activeTasks.isEmpty() -> Text(stringResource(R.string.transfer_empty), color = TextSecondaryDark)
                        else -> {
                            Text(stringResource(R.string.home_queue_counts, summary.running, summary.queued, summary.paused))
                            Spacer(Modifier.height(12.dp))
                            AutoGramProgressBar(summary.activeProgress)
                            Spacer(Modifier.height(8.dp))
                            Text(stringResource(R.string.transfer_progress_percent, (summary.activeProgress * 100).toInt()))
                        }
                    }
                }
            }
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth(), onClick = { open(Screen.Drive) }) {
                    SectionHeading(stringResource(R.string.home_drive_title))
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.workspace_folder_scope), color = TextSecondaryDark)
                    Spacer(Modifier.height(8.dp))
                    when {
                        drive.isLoading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        drive.errorCode != null -> Text(stringResource(R.string.workspace_load_error), color = SoftCoral)
                        drive.sessionId.isBlank() || drive.peerId.isBlank() -> Text(stringResource(R.string.workspace_scope_required))
                        else -> Text(stringResource(R.string.home_folder_counts, summary.fileCount,
                            summary.folderCount, Formatter.formatFileSize(context, summary.knownFileBytes)))
                    }
                    if (summary.recentFiles.isNotEmpty()) {
                        Spacer(Modifier.height(16.dp))
                        Text(stringResource(R.string.home_recent_files), style = MaterialTheme.typography.titleSmall)
                        summary.recentFiles.forEach { file ->
                            Text(file.name, modifier = Modifier.padding(top = 8.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            item { Text(stringResource(R.string.home_quick_actions), style = MaterialTheme.typography.titleMedium) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(Screen.Drive, Screen.Studio, Screen.Forwarder, Screen.Statistics, Screen.Tools).forEach { screen ->
                        OutlinedButton(onClick = { open(screen) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Icon(screen.icon, null)
                            Spacer(Modifier.width(12.dp))
                            Text(stringResource(screen.titleRes), modifier = Modifier.weight(1f))
                            Icon(Icons.Default.ChevronRight, null)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeading(title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Icon(Icons.Default.ChevronRight, null, tint = TextSecondaryDark)
    }
}
