package com.autogram.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.runtime.NativeRuntime
import com.autogram.app.features.localdownload.LocalDownloadScreen
import com.autogram.app.ui.components.AutoGramNavigationRail
import com.autogram.app.ui.components.BottomNavBar
import com.autogram.app.ui.drive.DriveScreen
import com.autogram.app.ui.home.HomeScreen
import com.autogram.app.ui.remote.RemoteUrlScreen
import com.autogram.app.ui.settings.SettingsScreen
import com.autogram.app.ui.studio.StudioScreen
import com.autogram.app.ui.statistics.StatisticsScreen
import com.autogram.app.ui.transfer.TransferScreen
import com.autogram.app.ui.tools.NativeModuleScreen
import com.autogram.app.ui.tools.ToolsScreen
import com.autogram.app.ui.tools.nativeModuleSpec
import com.autogram.app.viewmodel.DriveViewModel
import com.autogram.app.viewmodel.RemoteUrlViewModel
import com.autogram.app.viewmodel.SettingsViewModel
import com.autogram.app.viewmodel.TransferViewModel

class MainActivity : ComponentActivity() {
    private var sharedUrl by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        sharedUrl = extractSharedUrl(intent)
        setContent {
            AutoGramTheme(darkTheme = true) {
                AutoGramAppRoot(sharedUrl = sharedUrl, onSharedUrlConsumed = { sharedUrl = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        sharedUrl = extractSharedUrl(intent)
    }

    private fun extractSharedUrl(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return null
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        return Regex("https?://\\S+", RegexOption.IGNORE_CASE)
            .find(text)
            ?.value
            ?.trimEnd('.', ',', ')', ']', '}')
    }
}

@Composable
fun AutoGramAppRoot(sharedUrl: String? = null, onSharedUrlConsumed: () -> Unit = {}) {
    val navController = rememberNavController()
    val driveViewModel: DriveViewModel = viewModel()
    val transferViewModel: TransferViewModel = viewModel()
    val settingsViewModel: SettingsViewModel = viewModel()
    val remoteUrlViewModel: RemoteUrlViewModel = viewModel()
    val driveState by driveViewModel.uiState.collectAsState()
    val transferState by transferViewModel.uiState.collectAsState()
    val runtimeStatus by NativeRuntime.status.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current
    fun refreshWorkspace() {
        driveViewModel.loadFolder(driveViewModel.uiState.value.currentPath)
        transferViewModel.loadTransfers()
    }
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            refreshWorkspace()
            NativeRuntime.events.collect { event ->
                when (event) {
                    "drive_items_changed" -> driveViewModel.loadFolder(driveViewModel.uiState.value.currentPath)
                    "transfer_task_changed" -> transferViewModel.loadTransfers()
                }
            }
        }
    }

    LaunchedEffect(sharedUrl) {
        if (!sharedUrl.isNullOrBlank()) {
            remoteUrlViewModel.acceptSharedUrl(sharedUrl)
            navController.navigate(Screen.Remote.route) { launchSingleTop = true }
            onSharedUrlConsumed()
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val useRail = maxWidth >= 720.dp
        
        Box(modifier = Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxSize()) {
                if (useRail) AutoGramNavigationRail(navController)
                NavHost(
                    navController = navController,
                    startDestination = Screen.Home.route,
                    modifier = Modifier.weight(1f)
                ) {
                    composable(Screen.Home.route) {
                        HomeScreen(navController, driveState, transferState, runtimeStatus, ::refreshWorkspace)
                    }
                    composable(Screen.Drive.route) {
                        DriveScreen(viewModel = driveViewModel)
                    }
                    composable(Screen.Transfer.route) {
                        TransferScreen(viewModel = transferViewModel)
                    }
                    composable(Screen.Forwarder.route) {
                        NativeModuleScreen(navController, nativeModuleSpec(Screen.Forwarder))
                    }
                    composable(Screen.Studio.route) {
                        StudioScreen(viewModel = driveViewModel)
                    }
                    composable(Screen.Remote.route) {
                        RemoteUrlScreen(viewModel = remoteUrlViewModel, onOpenLocalDownloads = {
                            navController.navigate(Screen.LocalDownloads.route) { launchSingleTop = true }
                        })
                    }
                    composable(Screen.LocalDownloads.route) {
                        LocalDownloadScreen(initialUrl = remoteUrlViewModel.uiState.value.url)
                    }
                    composable(Screen.Tools.route) {
                        ToolsScreen(navController = navController)
                    }
                    composable(Screen.Accounts.route) {
                        NativeModuleScreen(navController, nativeModuleSpec(Screen.Accounts))
                    }
                    composable(Screen.Jobs.route) {
                        NativeModuleScreen(navController, nativeModuleSpec(Screen.Jobs))
                    }
                    composable(Screen.Automation.route) {
                        NativeModuleScreen(navController, nativeModuleSpec(Screen.Automation))
                    }
                    composable(Screen.Statistics.route) {
                        StatisticsScreen(driveState, transferState, ::refreshWorkspace)
                    }
                    composable(Screen.Profiles.route) {
                        NativeModuleScreen(navController, nativeModuleSpec(Screen.Profiles))
                    }
                    composable(Screen.Sync.route) {
                        NativeModuleScreen(navController, nativeModuleSpec(Screen.Sync))
                    }
                    composable(Screen.ApiSetup.route) {
                        NativeModuleScreen(navController, nativeModuleSpec(Screen.ApiSetup))
                    }
                    composable(Screen.Settings.route) {
                        SettingsScreen(viewModel = settingsViewModel)
                    }
                }
            }

            // Floating Glass Capsule Bottom Navigation Bar (Overlays content gracefully)
            if (!useRail) {
                Box(
                    modifier = Modifier.align(Alignment.BottomCenter)
                ) {
                    BottomNavBar(navController = navController)
                }
            }
        }
    }
}
