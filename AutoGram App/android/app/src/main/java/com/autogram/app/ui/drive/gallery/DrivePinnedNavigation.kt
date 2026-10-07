package com.autogram.app.ui.drive.gallery

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

/** Sibling of the only vertical scroll root, never a virtualized gallery item. */
@Composable
fun DrivePinnedNavigation(compact: Boolean, selectionMode: Boolean,
    locations: (@Composable (Boolean) -> Unit)?, header: @Composable (Boolean) -> Unit,
    topics: (@Composable () -> Unit)?) {
    Column(Modifier.fillMaxWidth().testTag(if (compact) "drive-navigation-compact" else "drive-navigation-expanded")) {
        if (!selectionMode) locations?.invoke(compact)
        header(compact)
        if (!selectionMode) topics?.invoke()
    }
}
