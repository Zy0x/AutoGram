package com.autogram.app.ui.forwarder

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.autogram.app.features.workspace.execution.ExecutionBoundaryScreen
import com.autogram.app.features.workspace.execution.PendingExecutionDomain

@Composable
fun ForwarderScreen(modifier: Modifier = Modifier) {
    ExecutionBoundaryScreen(PendingExecutionDomain.FORWARDER, modifier)
}
