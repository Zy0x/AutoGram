package com.autogram.app.ui.profiles

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.autogram.app.features.workspace.execution.ExecutionBoundaryScreen
import com.autogram.app.features.workspace.execution.PendingExecutionDomain

@Composable
fun ProfilesScreen(modifier: Modifier = Modifier) {
    ExecutionBoundaryScreen(PendingExecutionDomain.PROFILES, modifier)
}
