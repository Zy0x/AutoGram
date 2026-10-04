package com.autogram.app.ui.tools

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.autogram.app.R
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*

data class ToolItemSpec(
    val screen: Screen,
    val subtitleRes: Int,
    val icon: ImageVector,
    val accentColor: Color,
    val integrated: Boolean = true
)

data class ToolCategory(
    val titleRes: Int,
    val tools: List<ToolItemSpec>
)

private val toolCategories = listOf(
    ToolCategory(
        titleRes = R.string.ui2_tools_media_category,
        tools = listOf(
            ToolItemSpec(Screen.Remote, R.string.ui2_quick_remote_desc, Icons.Default.Link, MutedIceCyan, true),
            ToolItemSpec(Screen.LocalDownloads, R.string.ui2_quick_downloads_desc, Icons.Default.Download, DustySage, true),
            ToolItemSpec(Screen.Studio, R.string.ui2_quick_studio_desc, Icons.Default.VideoLibrary, SoftViolet, true),
            ToolItemSpec(Screen.LocalPreview, R.string.ui2_quick_preview_desc, Icons.Default.Visibility, WarmAmber, true)
        )
    ),
    ToolCategory(
        titleRes = R.string.ui2_tools_mgmt_category,
        tools = listOf(
            ToolItemSpec(Screen.Accounts, R.string.ui2_accounts_desc, Icons.Default.Person, GoldAccent, true),
            ToolItemSpec(Screen.ApiSetup, R.string.auth_api_instructions, Icons.Default.VpnKey, MutedIceCyan, true),
            ToolItemSpec(Screen.Statistics, R.string.statistics_local_scope, Icons.Default.BarChart, DustySage, true),
            ToolItemSpec(Screen.Settings, R.string.ui2_settings_subtitle, Icons.Default.Settings, SoftViolet, true)
        )
    ),
    ToolCategory(
        titleRes = R.string.ui2_tools_automation_category,
        tools = listOf(
            ToolItemSpec(Screen.Forwarder, R.string.ui2_quick_forwarder_desc, Icons.Default.SwapHoriz, WarmAmber, true),
            ToolItemSpec(Screen.Jobs, R.string.ui2_quick_jobs_desc, Icons.Default.Schedule, MutedIceCyan, true),
            ToolItemSpec(Screen.Automation, R.string.ui2_quick_automation_desc, Icons.Default.AutoFixHigh, SoftViolet, true),
            ToolItemSpec(Screen.Profiles, R.string.ui2_quick_profiles_desc, Icons.Default.Badge, DustySage, true),
            ToolItemSpec(Screen.Sync, R.string.ui2_quick_sync_desc, Icons.Default.Sync, GoldAccent, true)
        )
    )
)

@Composable
fun ToolsScreen(navController: NavController, modifier: Modifier = Modifier) {
    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Header
            item(key = "header") {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = stringResource(R.string.ui2_tools_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.ui2_tools_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Categories
            toolCategories.forEach { category ->
                item(key = "cat_header_${category.titleRes}") {
                    Text(
                        text = stringResource(category.titleRes),
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.3.sp
                        ),
                        color = TextPrimaryDark,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }

                items(category.tools, key = { it.screen.route }) { tool ->
                    ToolRowCard(
                        tool = tool,
                        onClick = {
                            navigatePrimary(navController, tool.screen.route, Screen.Tools.route)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolRowCard(
    tool: ToolItemSpec,
    onClick: () -> Unit
) {
    AutoGramGlassCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        borderColor = BorderHairline,
        containerColor = SurfaceDeep,
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Icon
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = tool.accentColor.copy(alpha = 0.14f),
                modifier = Modifier.size(44.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = tool.icon,
                        contentDescription = null,
                        tint = tool.accentColor,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }

            // Title & Subtitle
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = stringResource(tool.screen.titleRes),
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp
                    ),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = stringResource(tool.subtitleRes),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                    color = TextSecondaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            // Status chip or chevron
            if (!tool.integrated) {
                Surface(
                    shape = CircleShape,
                    color = SurfaceGlassSoft,
                    border = BorderStroke(0.5.dp, BorderHairline)
                ) {
                    Text(
                        text = stringResource(R.string.ui2_badge_soon),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                        color = TextMutedDark,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            }

            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = TextSecondaryDark,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/** Legacy contract compatibility for secondary screens in MainActivity */
data class NativeModuleSpec(val screen: Screen, val subtitleRes: Int, val integrated: Boolean = false)

private val moduleSpecs = listOf(
    NativeModuleSpec(Screen.Drive, R.string.workspace_scope_required, true),
    NativeModuleSpec(Screen.Transfer, R.string.transfer_native_scope, true),
    NativeModuleSpec(Screen.Remote, R.string.remote_engine_unavailable, true),
    NativeModuleSpec(Screen.LocalDownloads, R.string.local_download_scope, true),
    NativeModuleSpec(Screen.LocalPreview, R.string.real_local_preview_scope, true),
    NativeModuleSpec(Screen.Statistics, R.string.statistics_local_scope, true),
    NativeModuleSpec(Screen.Studio, R.string.capability_studio_gap, true),
    NativeModuleSpec(Screen.Settings, R.string.capability_settings_gap, true),
    NativeModuleSpec(Screen.Forwarder, R.string.ui2_quick_forwarder_desc, true),
    NativeModuleSpec(Screen.Accounts, R.string.auth_security, integrated = true),
    NativeModuleSpec(Screen.Jobs, R.string.ui2_quick_jobs_desc, true),
    NativeModuleSpec(Screen.Automation, R.string.ui2_quick_automation_desc, true),
    NativeModuleSpec(Screen.Profiles, R.string.ui2_quick_profiles_desc, true),
    NativeModuleSpec(Screen.Sync, R.string.ui2_quick_sync_desc, true),
    NativeModuleSpec(Screen.ApiSetup, R.string.auth_api_instructions, integrated = true)
)

fun nativeModuleSpec(screen: Screen): NativeModuleSpec = moduleSpecs.first { it.screen == screen }

@Composable
fun NativeModuleScreen(navController: NavController, spec: NativeModuleSpec, modifier: Modifier = Modifier) {
    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item { ScreenHeader(spec.screen.titleRes, R.string.capability_unavailable) }
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(spec.subtitleRes))
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.capability_no_execution))
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(onClick = {
                        navigatePrimary(navController, Screen.Tools.route, spec.screen.route)
                    }) { Text(stringResource(R.string.tools_hub_title)) }
                }
            }
        }
    }
}

