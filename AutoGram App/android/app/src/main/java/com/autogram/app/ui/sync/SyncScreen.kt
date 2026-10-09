package com.autogram.app.ui.sync

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.autogram.app.features.workspace.execution.ExecutionBoundaryScreen
import com.autogram.app.features.workspace.execution.PendingExecutionDomain

@Composable
fun SyncScreen(modifier: Modifier = Modifier) {
    ExecutionBoundaryScreen(PendingExecutionDomain.SYNC, modifier)
}
