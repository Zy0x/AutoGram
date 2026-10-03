package com.autogram.app.ui.home

import android.text.format.Formatter
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.autogram.app.R
import com.autogram.app.features.auth.AuthAccount
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
    activeAccount: AuthAccount?,
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
            modifier = Modifier
                .align(Alignment.TopCenter)
                .widthIn(max = 640.dp)
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            // Header with Brand and Refresh
            item {
                ScreenHeader(
                    titleRes = R.string.home_workspace_hub_title,
                    subtitleRes = R.string.home_workspace_hub_subtitle
                ) {
                    IconButton(
                        onClick = onRefresh,
                        enabled = !drive.isLoading && !transfers.isLoading,
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.drive_action_refresh),
                            tint = MutedIceCyan
                        )
                    }
                }
            }

            // Active Telegram Session Card (Desktop SessionLauncher Parity)
            item {
                ActiveSessionCard(
                    account = activeAccount,
                    runtime = runtime,
                    onSwitchSession = { open(Screen.Accounts) }
                )
            }

            // Dual Grand Workspace Pillars: Pengelola Cloud (Drives) & Media Forwarder
            item {
                val driveStats = if (summary.fileCount > 0 || summary.folderCount > 0) {
                    stringResource(
                        R.string.home_folder_counts,
                        summary.fileCount,
                        summary.folderCount,
                        Formatter.formatFileSize(context, summary.knownFileBytes)
                    )
                } else {
                    ""
                }
                GrandWorkspaceCard(
                    title = stringResource(R.string.home_drives_title),
                    description = stringResource(R.string.home_drives_desc),
                    metaInfo = driveStats,
                    buttonText = stringResource(R.string.home_drives_btn),
                    accentColor = MutedIceCyan,
                    icon = Icons.Default.Folder,
                    onOpen = { open(Screen.Drive) }
                )
            }

            item {
                GrandWorkspaceCard(
                    title = stringResource(R.string.home_forwarder_title),
                    description = stringResource(R.string.home_forwarder_desc),
                    metaInfo = "Clean Copy · Auto-Forward · Deduplikasi Matrix",
                    buttonText = stringResource(R.string.home_forwarder_btn),
                    accentColor = GoldAccent,
                    icon = Icons.Default.SwapHoriz,
                    onOpen = { open(Screen.Forwarder) }
                )
            }

            // Active Transfer & Queue Dashboard
            item {
                TransferMonitorCard(
                    transfers = transfers,
                    running = summary.running,
                    queued = summary.queued,
                    paused = summary.paused,
                    progress = summary.activeProgress,
                    onClick = { open(Screen.Transfer) }
                )
            }

            // Quick Services 2x2 Grid
            item {
                Text(
                    text = stringResource(R.string.home_quick_services_title),
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        QuickServiceTile(
                            title = stringResource(R.string.home_service_remote_title),
                            description = stringResource(R.string.home_service_remote_desc),
                            icon = Icons.Default.Link,
                            accentColor = MutedIceCyan,
                            onClick = { open(Screen.Remote) },
                            modifier = Modifier.weight(1f)
                        )
                        QuickServiceTile(
                            title = stringResource(R.string.home_service_studio_title),
                            description = stringResource(R.string.home_service_studio_desc),
                            icon = Icons.Default.VideoLibrary,
                            accentColor = SoftViolet,
                            onClick = { open(Screen.Studio) },
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        QuickServiceTile(
                            title = stringResource(R.string.home_service_downloads_title),
                            description = stringResource(R.string.home_service_downloads_desc),
                            icon = Icons.Default.Download,
                            accentColor = DustySage,
                            onClick = { open(Screen.LocalDownloads) },
                            modifier = Modifier.weight(1f)
                        )
                        QuickServiceTile(
                            title = stringResource(R.string.home_service_tools_title),
                            description = stringResource(R.string.home_service_tools_desc),
                            icon = Icons.Default.Apps,
                            accentColor = GoldAccent,
                            onClick = { open(Screen.Tools) },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            // Parallel Safety & Session Guard Card (Desktop Dashboard Parity)
            item {
                ParallelSafetyCard()
            }
        }
    }
}

@Composable
private fun ActiveSessionCard(
    account: AuthAccount?,
    runtime: NativeRuntimeStatus,
    onSwitchSession: () -> Unit
) {
    AutoGramDoubleBezelCard(
        modifier = Modifier.fillMaxWidth(),
        borderColor = if (account?.active == true) BorderActive else BorderCyanGlow
    ) {
        // Status Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                AutoGramStatusDot(
                    color = if (runtime == NativeRuntimeStatus.READY) DustySage else GoldAccent,
                    isPulsing = true,
                    size = 8.dp
                )
                Text(
                    text = stringResource(R.string.home_session_status_strong),
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = if (runtime == NativeRuntimeStatus.READY) DustySage else GoldAccent
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // Primary badge
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = GoldAccent.copy(alpha = 0.14f),
                    border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.35f))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Star,
                            contentDescription = null,
                            tint = GoldAccent,
                            modifier = Modifier.size(12.dp)
                        )
                        Text(
                            text = stringResource(R.string.home_session_badge_primary),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, fontWeight = FontWeight.Bold),
                            color = GoldAccent
                        )
                    }
                }

                // Switch session action
                Surface(
                    onClick = onSwitchSession,
                    shape = RoundedCornerShape(8.dp),
                    color = SurfaceGlass,
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.height(28.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.home_session_switch_btn),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium),
                            color = TextSecondaryDark
                        )
                        Icon(
                            imageVector = Icons.Default.ChevronRight,
                            contentDescription = null,
                            tint = TextSecondaryDark,
                            modifier = Modifier.size(12.dp)
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(14.dp))

        // Profile Identity Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            val displayName = account?.displayName?.ifBlank { null } ?: stringResource(R.string.home_session_default_name)
            val initial = displayName.firstOrNull()?.uppercaseChar()?.toString() ?: "U"

            Surface(
                shape = RoundedCornerShape(16.dp),
                color = CanvasDeepNavy,
                border = BorderStroke(1.5.dp, ChampagneToCyanBrush),
                modifier = Modifier.size(52.dp)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.linearGradient(
                                listOf(MutedIceCyan.copy(alpha = 0.25f), CanvasDeepNavy)
                            )
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = initial,
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 22.sp
                        ),
                        color = MutedIceCyan
                    )
                }
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = displayName,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.2).sp
                    ),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                val username = account?.username?.let { if (it.startsWith("@")) it else "@$it" }
                val sessionLabel = account?.id?.replace("session_", "")?.take(12) ?: "telegram"
                val metaText = if (!username.isNullOrBlank()) {
                    "$username · ID $sessionLabel"
                } else {
                    "ID $sessionLabel"
                }
                Text(
                    text = metaText,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                    color = TextSecondaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun GrandWorkspaceCard(
    title: String,
    description: String,
    metaInfo: String,
    buttonText: String,
    accentColor: Color,
    icon: ImageVector,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier
) {
    AutoGramDoubleBezelCard(
        modifier = modifier.fillMaxWidth(),
        borderColor = accentColor.copy(alpha = 0.35f)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Surface(
                shape = CircleShape,
                color = accentColor.copy(alpha = 0.15f),
                border = BorderStroke(1.dp, accentColor.copy(alpha = 0.3f)),
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = accentColor,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    ),
                    color = TextPrimaryDark
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall.copy(
                        color = TextSecondaryDark,
                        lineHeight = 16.sp
                    )
                )
                if (metaInfo.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = metaInfo,
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = accentColor,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp
                        )
                    )
                }
            }
        }

        Spacer(Modifier.height(14.dp))

        Button(
            onClick = onOpen,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = accentColor.copy(alpha = 0.18f),
                contentColor = accentColor
            ),
            border = BorderStroke(1.dp, accentColor.copy(alpha = 0.45f))
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = accentColor,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = buttonText,
                style = MaterialTheme.typography.labelLarge.copy(
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.2.sp
                ),
                color = TextPrimaryDark
            )
        }
    }
}

@Composable
private fun TransferMonitorCard(
    transfers: TransferUiState,
    running: Int,
    queued: Int,
    paused: Int,
    progress: Float,
    onClick: () -> Unit
) {
    AutoGramGlassCard(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick
    ) {
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
                    imageVector = Icons.Default.SwapVert,
                    contentDescription = null,
                    tint = MutedIceCyan,
                    modifier = Modifier.size(20.dp)
                )
                Text(
                    text = stringResource(R.string.home_transfer_monitor_title),
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }
            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = TextSecondaryDark,
                modifier = Modifier.size(18.dp)
            )
        }

        Spacer(Modifier.height(10.dp))

        when {
            transfers.isLoading -> {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = MutedIceCyan)
            }
            transfers.errorCode != null -> {
                Text(
                    text = stringResource(R.string.workspace_load_error),
                    color = SoftCoral,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            transfers.activeTasks.isEmpty() -> {
                Text(
                    text = stringResource(R.string.home_transfer_idle),
                    color = TextSecondaryDark,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            else -> {
                Text(
                    text = stringResource(R.string.home_queue_counts, running, queued, paused),
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                    color = TextPrimaryDark
                )
                Spacer(Modifier.height(10.dp))
                AutoGramProgressBar(progress)
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = stringResource(R.string.transfer_progress_percent, (progress * 100).toInt()),
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                        color = MutedIceCyan
                    )
                    Text(
                        text = "${running + queued} tugas",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondaryDark
                    )
                }
            }
        }
    }
}

@Composable
private fun QuickServiceTile(
    title: String,
    description: String,
    icon: ImageVector,
    accentColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = SurfaceGlass,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = modifier.heightIn(min = 88.dp)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Surface(
                shape = CircleShape,
                color = accentColor.copy(alpha = 0.15f),
                modifier = Modifier.size(34.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = accentColor,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = TextSecondaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun ParallelSafetyCard() {
    AutoGramGlassCard(
        modifier = Modifier.fillMaxWidth(),
        borderColor = BorderHairline,
        containerColor = SurfaceGlassSoft
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Shield,
                contentDescription = null,
                tint = DustySage,
                modifier = Modifier.size(18.dp)
            )
            Text(
                text = stringResource(R.string.home_safety_title),
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                color = TextPrimaryDark
            )
        }

        Spacer(Modifier.height(10.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.Default.Bolt, null, tint = GoldAccent, modifier = Modifier.size(14.dp))
                    Text(
                        text = stringResource(R.string.home_safety_pool_title),
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                        color = GoldAccent
                    )
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    text = stringResource(R.string.home_safety_pool_desc),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp, lineHeight = 14.sp),
                    color = TextSecondaryDark
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.Default.Lock, null, tint = MutedIceCyan, modifier = Modifier.size(14.dp))
                    Text(
                        text = stringResource(R.string.home_safety_guard_title),
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                        color = MutedIceCyan
                    )
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    text = stringResource(R.string.home_safety_guard_desc),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp, lineHeight = 14.sp),
                    color = TextSecondaryDark
                )
            }
        }
    }
}
