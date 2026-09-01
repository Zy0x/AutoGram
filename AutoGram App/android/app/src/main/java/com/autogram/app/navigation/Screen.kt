package com.autogram.app.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.ui.graphics.vector.ImageVector
import com.autogram.app.R

sealed class Screen(
    val route: String,
    @StringRes val titleRes: Int,
    val icon: ImageVector
) {
    data object Drive : Screen("drive", R.string.nav_drive, Icons.Default.Folder)
    data object Transfer : Screen("transfer", R.string.nav_transfer, Icons.Default.SwapVert)
    data object Forwarder : Screen("forwarder", R.string.nav_forwarder, Icons.Default.SwapHoriz)
    data object Studio : Screen("studio", R.string.nav_studio, Icons.Default.VideoLibrary)
    data object Remote : Screen("remote", R.string.nav_remote, Icons.Default.Link)
    data object Settings : Screen("settings", R.string.nav_settings, Icons.Default.Settings)

    companion object {
        val items: List<Screen> get() = listOf(Drive, Transfer, Forwarder, Studio, Remote, Settings)
    }
}
