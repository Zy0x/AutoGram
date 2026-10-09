package com.autogram.app.ui.automation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.autogram.app.features.workspace.execution.ExecutionBoundaryScreen
import com.autogram.app.features.workspace.execution.PendingExecutionDomain

@Composable
fun AutomationScreen(modifier: Modifier = Modifier) {
    ExecutionBoundaryScreen(PendingExecutionDomain.AUTOMATION, modifier)
}
