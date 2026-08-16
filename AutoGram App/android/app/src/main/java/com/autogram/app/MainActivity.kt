package com.autogram.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.theme.BgDark
import com.autogram.app.ui.components.BottomNavBar
import com.autogram.app.ui.drive.DriveScreen
import com.autogram.app.ui.settings.SettingsScreen
import com.autogram.app.ui.transfer.TransferScreen
import com.autogram.app.viewmodel.DriveViewModel
import com.autogram.app.viewmodel.SettingsViewModel
import com.autogram.app.viewmodel.TransferViewModel

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate()
        setContent {
            AutoGramTheme {
                AutoGramAppRoot()
            }
        }
    }
}

@Composable
fun AutoGramAppRoot() {
    val navController = rememberNavController()
    val driveViewModel: DriveViewModel = viewModel()
    val transferViewModel: TransferViewModel = viewModel()
    val settingsViewModel: SettingsViewModel = viewModel()

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = BgDark,
        bottomBar = {
            BottomNavBar(navController = navController)
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Drive.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.Drive.route) {
                DriveScreen(viewModel = driveViewModel)
            }
            composable(Screen.Transfer.route) {
                TransferScreen(viewModel = transferViewModel)
            }
            composable(Screen.Studio.route) {
                DriveScreen(viewModel = driveViewModel) // Studio / Media view
            }
            composable(Screen.Settings.route) {
                SettingsScreen(viewModel = settingsViewModel)
            }
        }
    }
}
