package com.autogram.app.ui.tools

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.autogram.app.R
import com.autogram.app.navigation.Screen
import com.autogram.app.ui.components.*

/** Availability describes implemented behavior, not whether a route can be rendered. */
data class NativeModuleSpec(val screen: Screen, val subtitleRes: Int, val integrated: Boolean = false)

private val moduleSpecs = listOf(
    NativeModuleSpec(Screen.Drive, R.string.workspace_scope_required, true),
    NativeModuleSpec(Screen.Transfer, R.string.transfer_native_scope, true),
    NativeModuleSpec(Screen.Remote, R.string.remote_engine_unavailable, true),
    NativeModuleSpec(Screen.LocalDownloads, R.string.local_download_scope, true),
    NativeModuleSpec(Screen.Statistics, R.string.statistics_local_scope, true),
    NativeModuleSpec(Screen.Studio, R.string.capability_studio_gap, true),
    NativeModuleSpec(Screen.Settings, R.string.capability_settings_gap, true),
    NativeModuleSpec(Screen.Forwarder, R.string.capability_jobs_gap),
        NativeModuleSpec(Screen.Accounts, R.string.accounts_subtitle, integrated = true),
    NativeModuleSpec(Screen.Jobs, R.string.capability_jobs_gap),
    NativeModuleSpec(Screen.Automation, R.string.capability_automation_gap),
    NativeModuleSpec(Screen.Profiles, R.string.capability_profiles_gap),
    NativeModuleSpec(Screen.Sync, R.string.capability_sync_gap),
    NativeModuleSpec(Screen.ApiSetup, R.string.capability_auth_gap)
)

fun nativeModuleSpec(screen: Screen): NativeModuleSpec = moduleSpecs.first { it.screen == screen }

@Composable
fun ToolsScreen(navController: NavController, modifier: Modifier = Modifier) {
    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { ScreenHeader(R.string.tools_hub_title, R.string.capability_overview) }
            items(moduleSpecs, key = { it.screen.route }) { spec ->
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth(), onClick = {
                    navigatePrimary(navController, spec.screen.route, Screen.Tools.route)
                }) {
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Icon(spec.screen.icon, null, modifier = Modifier.size(24.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(stringResource(spec.screen.titleRes), modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium)
                        Icon(Icons.Default.ChevronRight, null)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(if (spec.integrated) R.string.capability_partial else R.string.capability_unavailable),
                        color = MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.labelMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(spec.subtitleRes), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

/** Honest unavailable state; never a substitute for a job/auth/sync implementation. */
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
