package com.autogram.app.features.workspace.execution

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.ui.components.AutoGramSurface

/** Temporary truthful boundary. This does not satisfy desktop-equivalence acceptance. */
@Composable
fun ExecutionBoundaryScreen(
    domain: PendingExecutionDomain,
    modifier: Modifier = Modifier,
    availableActions: @Composable ColumnScope.() -> Unit = {}
) {
    AutoGramSurface(modifier) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding()
                .verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(stringResource(domain.title), style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.execution_not_connected),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.testTag("execution-boundary:${domain.name}"))
            Text(stringResource(domain.missingExecution), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.execution_no_simulated_records),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            availableActions()
        }
    }
}
