package com.autogram.app.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.Work
import androidx.compose.ui.graphics.vector.ImageVector
import com.autogram.app.R

sealed class Screen(
    val route: String,
    @StringRes val titleRes: Int,
    val icon: ImageVector
) {
    data object Home : Screen("home", R.string.nav_home, Icons.Default.Home)
    data object Drive : Screen("drive", R.string.nav_drive, Icons.Default.Folder)
    data object Transfer : Screen("transfer", R.string.nav_transfer, Icons.Default.SwapVert)
    data object Forwarder : Screen("forwarder", R.string.nav_forwarder, Icons.Default.SwapHoriz)
    data object Studio : Screen("studio", R.string.nav_studio, Icons.Default.VideoLibrary)
    data object Remote : Screen("remote", R.string.nav_remote, Icons.Default.Link)
    data object LocalDownloads : Screen("local-downloads", R.string.local_download_title, Icons.Default.Download)
    data object Tools : Screen("tools", R.string.nav_tools, Icons.Default.Apps)
    data object Accounts : Screen("accounts", R.string.nav_accounts, Icons.Default.AccountCircle)
    data object Jobs : Screen("jobs", R.string.nav_jobs, Icons.Default.Work)
    data object Automation : Screen("automation", R.string.nav_automation, Icons.Default.Schedule)
    data object Statistics : Screen("statistics", R.string.nav_statistics, Icons.Default.BarChart)
    data object Profiles : Screen("profiles", R.string.nav_profiles, Icons.Default.Person)
    data object Sync : Screen("sync", R.string.nav_sync, Icons.Default.Sync)
    data object ApiSetup : Screen("api-setup", R.string.nav_api_setup, Icons.Default.Key)
    data object Settings : Screen("settings", R.string.nav_settings, Icons.Default.Settings)

    companion object {
        val primaryItems: List<Screen> get() = listOf(Home, Drive, Transfer, Tools, Settings)
        val items: List<Screen> get() = listOf(
            Home, Drive, Transfer, Remote, LocalDownloads, Forwarder, Studio, Tools,
            Accounts, Jobs, Automation, Statistics, Profiles, Sync, ApiSetup, Settings
        )
    }
}
