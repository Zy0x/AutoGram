package com.autogram.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.runtime.NativeRuntime
import com.autogram.app.features.localdownload.LocalDownloadScreen
import com.autogram.app.features.preview.LocalMediaPreviewScreen
import com.autogram.app.ui.components.AutoGramNavigationRail
import com.autogram.app.ui.components.BottomNavBar
import com.autogram.app.ui.accounts.AccountsScreen
import com.autogram.app.ui.drive.DriveScreen
import com.autogram.app.ui.home.HomeScreen
import com.autogram.app.ui.remote.RemoteUrlScreen
import com.autogram.app.ui.settings.SettingsScreen
import com.autogram.app.ui.studio.StudioScreen
import com.autogram.app.ui.statistics.StatisticsScreen
import com.autogram.app.ui.transfer.TransferScreen
import com.autogram.app.ui.forwarder.ForwarderScreen
import com.autogram.app.ui.jobs.JobsScreen
import com.autogram.app.ui.automation.AutomationScreen
import com.autogram.app.ui.profiles.ProfilesScreen
import com.autogram.app.ui.sync.SyncScreen
import com.autogram.app.ui.tools.ToolsScreen
import com.autogram.app.viewmodel.DriveViewModel
import com.autogram.app.viewmodel.AccountsViewModel
import com.autogram.app.viewmodel.RemoteUrlViewModel
import com.autogram.app.viewmodel.TransferViewModel
import com.autogram.app.features.gate.GateRoot
import com.autogram.app.features.auth.AuthAccount

class MainActivity : ComponentActivity() {
    private var sharedUrl by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        sharedUrl = extractSharedUrl(intent)
        setContent {
            AutoGramTheme(darkTheme = true) {
                GateRoot(
                    onAuthenticated = { account ->
                        AutoGramAppRoot(
                            sharedUrl = sharedUrl,
                            onSharedUrlConsumed = { sharedUrl = null },
                            activeAccount = account
                        )
                    }
                )
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
fun AutoGramAppRoot(
    sharedUrl: String? = null,
    onSharedUrlConsumed: () -> Unit = {},
    activeAccount: AuthAccount? = null
) {
    val navController = rememberNavController()
    val driveViewModel: DriveViewModel = viewModel()
    val accountsViewModel: AccountsViewModel = viewModel()
    val authViewModel: com.autogram.app.features.auth.AuthViewModel = viewModel()
    val transferViewModel: TransferViewModel = viewModel()
    val remoteUrlViewModel: RemoteUrlViewModel = viewModel()
    val remoteState by remoteUrlViewModel.uiState.collectAsState()
    val driveState by driveViewModel.uiState.collectAsState()
    val transferState by transferViewModel.uiState.collectAsState()
    val authState by authViewModel.state.collectAsState()
    val resolvedAccount = activeAccount ?: authState.accounts.firstOrNull { it.active } ?: authState.accounts.firstOrNull()
    val runtimeStatus by NativeRuntime.status.collectAsState()
    val accountRevision by NativeRuntime.accountRevision.collectAsState()
    var appliedAccountRevision by remember { mutableStateOf(-1L) }
    val lifecycleOwner = LocalLifecycleOwner.current
    suspend fun syncAuthorizedScope() {
        val requestedRevision = NativeRuntime.accountRevision.value
        val account = withContext(Dispatchers.IO) {
            try { uniffi.autogram_android_bridge.listAuthorizedAccounts().firstOrNull { it.active && it.verified } }
            catch (_: Exception) { null }
            catch (_: LinkageError) { null }
        }
        if (requestedRevision != NativeRuntime.accountRevision.value) return
        val session = account?.id.orEmpty()
        if (driveViewModel.uiState.value.sessionId != session || appliedAccountRevision != requestedRevision) {
            driveViewModel.setScope(session, if (session.isBlank()) "" else "me", null)
            appliedAccountRevision = requestedRevision
        }
    }
    fun refreshWorkspace() {
        driveViewModel.loadFolder(driveViewModel.uiState.value.currentPath)
        transferViewModel.loadTransfers()
    }
    LaunchedEffect(accountRevision, runtimeStatus) { syncAuthorizedScope() }
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            syncAuthorizedScope()
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
        
        Row(Modifier.fillMaxSize()) {
            if (useRail) AutoGramNavigationRail(navController)
            Column(Modifier.weight(1f).imePadding()) {
                NavHost(
                    navController = navController,
                    startDestination = Screen.Home.route,
                    modifier = Modifier.weight(1f).then(
                        if (!useRail) Modifier.consumeWindowInsets(WindowInsets.navigationBars) else Modifier
                    )
                ) {
                    composable(Screen.Home.route) {
                        HomeScreen(
                            navController = navController,
                            drive = driveState,
                            transfers = transferState,
                            runtime = runtimeStatus,
                            activeAccount = resolvedAccount,
                            onRefresh = ::refreshWorkspace
                        )
                    }
                    composable(Screen.Drive.route) {
                        DriveScreen(viewModel = driveViewModel)
                    }
                    composable(Screen.Transfer.route) {
                        TransferScreen(viewModel = transferViewModel, accountId = driveState.sessionId)
                    }
                    composable(Screen.Forwarder.route) {
                        ForwarderScreen()
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
                        LocalDownloadScreen(initialUrl = remoteState.url)
                    }
                    composable(Screen.LocalPreview.route) {
                        LocalMediaPreviewScreen()
                    }
                    composable(Screen.Tools.route) {
                        ToolsScreen(navController = navController)
                    }
                    composable(Screen.Accounts.route) {
                        AccountsScreen(viewModel = accountsViewModel, auth = authViewModel)
                    }
                    composable(Screen.Jobs.route) {
                        JobsScreen()
                    }
                    composable(Screen.Automation.route) {
                        AutomationScreen()
                    }
                    composable(Screen.Statistics.route) {
                        StatisticsScreen(driveState, transferState, ::refreshWorkspace)
                    }
                    composable(Screen.Profiles.route) {
                        ProfilesScreen()
                    }
                    composable(Screen.Sync.route) {
                        SyncScreen()
                    }
                    composable(Screen.ApiSetup.route) {
                        com.autogram.app.features.auth.AuthAccountsScreen(authViewModel, configureOnly = true)
                    }
                    composable(Screen.Settings.route) {
                        SettingsScreen()
                    }
                }
                if (!useRail) BottomNavBar(navController)
            }
        }
    }
}
