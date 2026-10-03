package com.autogram.app.ui.home

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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

    fun open(screen: Screen) = navigatePrimary(navController, screen.route, Screen.Home.route)

    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .widthIn(max = 640.dp)
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // 1. Header: Greeting & Account Status
            item(key = "header") {
                val displayName = activeAccount?.displayName?.takeIf { it.isNotBlank() }
                val isConnected = activeAccount?.active == true && activeAccount.verified

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = if (displayName != null) {
                                stringResource(R.string.ui2_greeting, displayName)
                            } else {
                                stringResource(R.string.ui2_greeting_guest)
                            },
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 24.sp,
                                letterSpacing = (-0.5).sp
                            ),
                            color = TextPrimaryDark,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            AutoGramStatusDot(
                                color = if (isConnected) SuccessGreen else SoftCoral,
                                isPulsing = isConnected,
                                size = 7.dp
                            )
                            Text(
                                text = stringResource(if (isConnected) R.string.ui2_connected else R.string.ui2_not_connected),
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                                color = if (isConnected) SuccessGreen else SoftCoral
                            )
                        }
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        IconButton(
                            onClick = onRefresh,
                            enabled = !drive.isLoading && !transfers.isLoading,
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.drive_action_refresh),
                                tint = if (!drive.isLoading) MutedIceCyan else TextSecondaryDark
                            )
                        }
                        Surface(
                            onClick = { open(Screen.Accounts) },
                            shape = CircleShape,
                            color = SurfaceGlass,
                            border = BorderStroke(1.dp, BorderHairline),
                            modifier = Modifier.size(44.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.Person,
                                    contentDescription = stringResource(R.string.clean_account_action),
                                    tint = GoldAccent,
                                    modifier = Modifier.size(22.dp)
                                )
                            }
                        }
                    }
                }
            }

            // 2. Hero Card: Drive Cloud & Google Photos Feed
            item(key = "hero_drive") {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                    borderColor = MutedIceCyan.copy(alpha = 0.3f),
                    containerColor = SurfaceDeep
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = MutedIceCyan.copy(alpha = 0.15f),
                                modifier = Modifier.size(52.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.Default.PhotoLibrary,
                                        contentDescription = null,
                                        tint = MutedIceCyan,
                                        modifier = Modifier.size(28.dp)
                                    )
                                }
                            }
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.ui2_hero_drive_title),
                                    style = MaterialTheme.typography.titleMedium.copy(
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 17.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = stringResource(R.string.ui2_hero_drive_desc),
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                                    color = TextSecondaryDark,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        if (drive.items.isNotEmpty()) {
                            Surface(
                                shape = CircleShape,
                                color = SurfaceGlassSoft,
                                border = BorderStroke(0.5.dp, BorderHairline)
                            ) {
                                Text(
                                    text = stringResource(R.string.clean_loaded_scope, drive.items.size),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                    color = TextSecondaryDark,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                                )
                            }
                        }

                        AutoGramGlowButton(
                            text = stringResource(R.string.ui2_open_drive_action),
                            onClick = { open(Screen.Drive) },
                            icon = Icons.Default.ArrowForward,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            // 3. Quick Shortcuts (2x2 Grid)
            item(key = "shortcuts") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = stringResource(R.string.ui2_shortcuts),
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.3.sp
                        ),
                        color = TextPrimaryDark
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        HomeQuickTile(
                            title = stringResource(R.string.ui2_quick_remote_title),
                            subtitle = stringResource(R.string.ui2_quick_remote_desc),
                            icon = Icons.Default.Link,
                            accentColor = MutedIceCyan,
                            onClick = { open(Screen.Remote) },
                            modifier = Modifier.weight(1f)
                        )
                        HomeQuickTile(
                            title = stringResource(R.string.ui2_quick_studio_title),
                            subtitle = stringResource(R.string.ui2_quick_studio_desc),
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
                        HomeQuickTile(
                            title = stringResource(R.string.ui2_quick_downloads_title),
                            subtitle = stringResource(R.string.ui2_quick_downloads_desc),
                            icon = Icons.Default.Download,
                            accentColor = DustySage,
                            onClick = { open(Screen.LocalDownloads) },
                            modifier = Modifier.weight(1f)
                        )
                        HomeQuickTile(
                            title = stringResource(R.string.ui2_quick_forwarder_title),
                            subtitle = stringResource(R.string.ui2_quick_forwarder_desc),
                            icon = Icons.Default.SwapHoriz,
                            accentColor = WarmAmber,
                            onClick = { open(Screen.Forwarder) },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }

            // 4. Live Transfer Capsule (if transfers exist)
            if (summary.running > 0 || summary.queued > 0) {
                item(key = "active_transfers") {
                    AutoGramGlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        borderColor = ChampagneGold.copy(alpha = 0.4f),
                        containerColor = SurfaceDeep,
                        onClick = { open(Screen.Transfer) }
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            AutoGramStatusDot(
                                color = ChampagneGold,
                                isPulsing = true,
                                size = 8.dp
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = stringResource(R.string.home_queue_counts, summary.running, summary.queued, summary.paused),
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = stringResource(R.string.clean_records_title),
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                                    color = TextSecondaryDark
                                )
                            }
                            Icon(
                                imageVector = Icons.Default.ChevronRight,
                                contentDescription = null,
                                tint = TextSecondaryDark
                            )
                        }
                    }
                }
            }

            // 5. Footer: Runtime Status & Tools Hub link
            item(key = "footer") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    val statusText = when (runtime) {
                        NativeRuntimeStatus.READY -> stringResource(R.string.native_runtime_ready)
                        NativeRuntimeStatus.STARTING -> stringResource(R.string.native_runtime_starting)
                        else -> stringResource(R.string.native_runtime_unavailable)
                    }
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                        color = TextMutedDark,
                        modifier = Modifier.weight(1f)
                    )
                    TextButton(
                        onClick = { open(Screen.Tools) },
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.ui2_tools_title),
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = MutedIceCyan
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeQuickTile(
    title: String,
    subtitle: String,
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
            modifier = Modifier
                .padding(14.dp)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = accentColor.copy(alpha = 0.14f),
                modifier = Modifier.size(36.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = accentColor,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.5.sp
                    ),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.5.sp),
                    color = TextSecondaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
