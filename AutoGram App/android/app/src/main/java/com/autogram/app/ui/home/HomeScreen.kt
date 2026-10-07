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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.autogram.app.R
import com.autogram.app.features.auth.AuthAccount
import com.autogram.app.features.workspace.summarizeWorkspace
import com.autogram.app.navigation.Screen
import com.autogram.app.runtime.NativeRuntimeStatus
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*
import com.autogram.app.ui.drive.DrivePreviewModal
import com.autogram.app.viewmodel.*

@Composable
fun HomeScreen(navController: NavController, drive: DriveUiState, transfers: TransferUiState,
    runtime: NativeRuntimeStatus, activeAccount: AuthAccount?, onRefresh: () -> Unit,
    modifier: Modifier = Modifier) {
    val summary = remember(drive.items, transfers.activeTasks, transfers.completedTasks) {
        summarizeWorkspace(drive.items, transfers.activeTasks + transfers.completedTasks)
    }
    val media = remember(drive.items, drive.sessionId) { homeMediaItems(drive.items, drive.sessionId) }
    var preview by remember(drive.sessionId, drive.peerId) { mutableStateOf<DriveFileItem?>(null) }
    fun open(screen: Screen) = navigatePrimary(navController, screen.route, Screen.Home.route)

    AutoGramSurface(modifier) {
        LazyColumn(Modifier.align(Alignment.TopCenter).widthIn(max = 640.dp).fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)) {
            item(key = "header") {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.nav_home), style = MaterialTheme.typography.headlineMedium)
                        val name = activeAccount?.displayName?.takeIf { it.isNotBlank() }
                        Text(if (name != null) stringResource(R.string.ui2_greeting, name)
                            else stringResource(R.string.ui2_greeting_guest),
                            style = MaterialTheme.typography.bodyMedium, color = TextSecondaryDark,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = onRefresh, enabled = !drive.isLoading && !transfers.isLoading,
                        modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh), tint = MutedIceCyan)
                    }
                    Surface(onClick = { open(Screen.Accounts) }, shape = CircleShape, color = SurfaceDeep,
                        modifier = Modifier.size(48.dp)) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Person, stringResource(R.string.clean_account_action),
                                Modifier.size(24.dp), tint = MutedIceCyan)
                        }
                    }
                }
            }
            item(key = "collection") {
                Column(Modifier.testTag("home-collection"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.clean_home_collection), style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.clean_loaded_scope, drive.items.size),
                        style = MaterialTheme.typography.bodyMedium, color = TextSecondaryDark)
                    if (drive.isLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    drive.errorCode?.let { code ->
                        Text(stringResource(com.autogram.app.features.cloud.cloudErrorLabel(code)),
                            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (media.isNotEmpty()) HomeMediaShelf(media) { preview = it }
                    else if (!drive.isLoading) Text(stringResource(R.string.clean_gallery_empty_hint),
                        style = MaterialTheme.typography.bodyMedium, color = TextSecondaryDark)
                }
            }
            if (summary.running > 0 || summary.queued > 0 || summary.paused > 0) item(key = "active_transfers") {
                QuietActionRow(stringResource(R.string.nav_transfer), Icons.Default.SwapVert,
                    { open(Screen.Transfer) }, subtitle = stringResource(R.string.home_queue_counts,
                        summary.running, summary.queued, summary.paused))
            }
            item(key = "shortcuts") {
                Column {
                    Text(stringResource(R.string.ui2_shortcuts), style = MaterialTheme.typography.titleMedium)
                    QuietActionRow(stringResource(R.string.nav_remote), Icons.Default.Link, { open(Screen.Remote) })
                    HorizontalDivider(color = BorderHairline)
                    QuietActionRow(stringResource(R.string.nav_studio), Icons.Default.VideoLibrary, { open(Screen.Studio) })
                }
            }
            if (runtime != NativeRuntimeStatus.READY || activeAccount?.verified != true || activeAccount?.active != true) item(key = "status") {
                Text(stringResource(if (runtime == NativeRuntimeStatus.STARTING) R.string.native_runtime_starting
                    else if (runtime != NativeRuntimeStatus.READY) R.string.native_runtime_unavailable
                    else R.string.ui2_not_connected),
                    color = TextSecondaryDark, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    preview?.let { item ->
        DrivePreviewModal(item, media, onDismiss = { preview = null }, onNavigateItem = { preview = it })
    }
}
