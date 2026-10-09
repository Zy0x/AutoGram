package com.autogram.app.ui.tools

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.autogram.app.R
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*

private val toolCategories = listOf(
    R.string.ui2_tools_media_category to listOf(Screen.Remote, Screen.LocalDownloads, Screen.Studio, Screen.LocalPreview),
    R.string.ui2_tools_mgmt_category to listOf(Screen.Accounts, Screen.ApiSetup, Screen.Statistics, Screen.Settings),
    R.string.ui2_tools_automation_category to listOf(Screen.Forwarder, Screen.Jobs, Screen.Automation, Screen.Profiles, Screen.Sync)
)

@Composable
fun ToolsScreen(navController: NavController, modifier: Modifier = Modifier) {
    AutoGramSurface(modifier) {
        LazyColumn(Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            item(key = "header") {
                Column(Modifier.padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.ui2_tools_title), style = MaterialTheme.typography.headlineMedium)
                    Text(stringResource(R.string.ui2_tools_subtitle), style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondaryDark)
                }
            }
            toolCategories.forEach { (title, screens) ->
                item(key = "category:$title") {
                    Text(stringResource(title), style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(top = 20.dp, bottom = 8.dp), color = TextSecondaryDark)
                }
                items(screens, key = { it.route }) { screen ->
                    QuietActionRow(stringResource(screen.titleRes), screen.icon,
                        { navigatePrimary(navController, screen.route, Screen.Tools.route) })
                }
            }
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
    NativeModuleSpec(Screen.Forwarder, R.string.ui2_quick_forwarder_desc),
    NativeModuleSpec(Screen.Accounts, R.string.auth_security, integrated = true),
    NativeModuleSpec(Screen.Jobs, R.string.ui2_quick_jobs_desc),
    NativeModuleSpec(Screen.Automation, R.string.ui2_quick_automation_desc),
    NativeModuleSpec(Screen.Profiles, R.string.ui2_quick_profiles_desc),
    NativeModuleSpec(Screen.Sync, R.string.ui2_quick_sync_desc),
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

