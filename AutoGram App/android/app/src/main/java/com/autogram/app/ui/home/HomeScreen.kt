package com.autogram.app.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.autogram.app.R
import com.autogram.app.features.auth.AuthAccount
import com.autogram.app.features.workspace.summarizeWorkspace
import com.autogram.app.navigation.Screen
import com.autogram.app.runtime.NativeRuntimeStatus
import com.autogram.app.ui.components.*
import com.autogram.app.viewmodel.DriveUiState
import com.autogram.app.viewmodel.TransferUiState

@Composable
fun HomeScreen(navController: NavController, drive: DriveUiState, transfers: TransferUiState,
    runtime: NativeRuntimeStatus, activeAccount: AuthAccount?, onRefresh: () -> Unit,
    modifier: Modifier = Modifier) {
    val summary = remember(drive.items, transfers.activeTasks, transfers.completedTasks) {
        summarizeWorkspace(drive.items, transfers.activeTasks + transfers.completedTasks)
    }
    fun open(screen: Screen) = navigatePrimary(navController, screen.route, Screen.Home.route)
    AutoGramSurface(modifier) {
        LazyColumn(Modifier.align(Alignment.TopCenter).widthIn(max = 640.dp).fillMaxSize().safeDrawingPadding(),
            contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)) {
            item(key = "heading") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.clean_dashboard_title), style = MaterialTheme.typography.headlineLarge)
                        Text(stringResource(R.string.clean_dashboard_subtitle),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = onRefresh, enabled = !drive.isLoading && !transfers.isLoading) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh))
                    }
                }
            }
            item(key = "account") {
                Surface(onClick = { open(Screen.Accounts) }, shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Surface(Modifier.size(44.dp), shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.PersonOutline, null, tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(activeAccount?.displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.auth_no_accounts),
                                style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(stringResource(if (activeAccount?.active == true && activeAccount.verified)
                                R.string.auth_active else R.string.clean_account_unverified),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Default.ChevronRight, stringResource(R.string.clean_account_action))
                    }
                }
            }
            item(key = "drive") {
                Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.primaryContainer) {
                    Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Icon(Icons.Default.PhotoLibrary, null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.primary)
                        Text(stringResource(R.string.home_drives_title), style = MaterialTheme.typography.headlineMedium)
                        Text(stringResource(R.string.clean_drive_description), style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (drive.items.isNotEmpty()) Text(stringResource(R.string.clean_loaded_scope, drive.items.size),
                            style = MaterialTheme.typography.labelMedium)
                        Button(onClick = { open(Screen.Drive) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Text(stringResource(R.string.home_action_open_drive))
                            Spacer(Modifier.weight(1f))
                            Icon(Icons.Default.ArrowForward, null)
                        }
                    }
                }
            }
            item(key = "services") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.clean_services_title), style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        WorkspaceShortcut(R.string.home_action_open_remote, Icons.Default.Link,
                            { open(Screen.Remote) }, Modifier.weight(1f))
                        WorkspaceShortcut(R.string.nav_studio, Icons.Default.VideoLibrary,
                            { open(Screen.Studio) }, Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        WorkspaceShortcut(R.string.local_download_title, Icons.Default.Download,
                            { open(Screen.LocalDownloads) }, Modifier.weight(1f))
                        WorkspaceShortcut(R.string.nav_forwarder, Icons.Default.SwapHoriz,
                            { open(Screen.Forwarder) }, Modifier.weight(1f))
                    }
                }
            }
            item(key = "records") {
                Surface(onClick = { open(Screen.Transfer) }, modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.clean_records_title), Modifier.weight(1f),
                                style = MaterialTheme.typography.titleMedium)
                            Icon(Icons.Default.ChevronRight, null)
                        }
                        Text(stringResource(R.string.home_queue_counts, summary.running, summary.queued, summary.paused),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (transfers.isLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                        if (transfers.errorCode != null) Text(stringResource(R.string.workspace_load_error),
                            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item(key = "footer") {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(when (runtime) {
                        NativeRuntimeStatus.READY -> R.string.native_runtime_ready
                        NativeRuntimeStatus.STARTING -> R.string.native_runtime_starting
                        else -> R.string.native_runtime_unavailable
                    }), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { open(Screen.Tools) }) { Text(stringResource(R.string.tools_hub_title)) }
                }
            }
        }
    }
}
