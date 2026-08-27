package com.autogram.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.theme.BgDark
import com.autogram.app.ui.components.BottomNavBar
import com.autogram.app.ui.components.AutoGramNavigationRail
import com.autogram.app.ui.drive.DriveScreen
import com.autogram.app.ui.settings.SettingsScreen
import com.autogram.app.ui.studio.StudioScreen
import com.autogram.app.ui.remote.RemoteUrlScreen
import com.autogram.app.ui.transfer.TransferScreen
import com.autogram.app.viewmodel.DriveViewModel
import com.autogram.app.viewmodel.SettingsViewModel
import com.autogram.app.viewmodel.RemoteUrlViewModel
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

    LaunchedEffect(sharedUrl) {
        if (!sharedUrl.isNullOrBlank()) {
            remoteUrlViewModel.acceptSharedUrl(sharedUrl)
            navController.navigate(Screen.Remote.route) { launchSingleTop = true }
            onSharedUrlConsumed()
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val useRail = maxWidth >= 720.dp
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = BgDark,
            bottomBar = {
                if (!useRail) BottomNavBar(navController = navController)
            }
        ) { innerPadding ->
            Row(Modifier.fillMaxSize().padding(innerPadding)) {
                if (useRail) AutoGramNavigationRail(navController)
                NavHost(
                    navController = navController,
                    startDestination = Screen.Drive.route,
                    modifier = Modifier.weight(1f)
                ) {
                    composable(Screen.Drive.route) {
                        DriveScreen(viewModel = driveViewModel)
                    }
                    composable(Screen.Transfer.route) {
                        TransferScreen(viewModel = transferViewModel)
                    }
                    composable(Screen.Studio.route) {
                        StudioScreen(viewModel = driveViewModel)
                    }
                    composable(Screen.Remote.route) {
                        RemoteUrlScreen(viewModel = remoteUrlViewModel)
                    }
                    composable(Screen.Settings.route) {
                        SettingsScreen(viewModel = settingsViewModel)
                    }
                }
            }
        }
    }
}
