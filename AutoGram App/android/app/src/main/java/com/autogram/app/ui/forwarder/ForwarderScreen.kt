package com.autogram.app.ui.forwarder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R

/** Android parity entry point. Execution is delegated to the local UniFFI
 * engine/Foreground Service once the bridge exposes the V2 job operations. */
@Composable
fun ForwarderScreen(
    onCreateJob: () -> Unit = {},
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.forwarder_title), style = MaterialTheme.typography.headlineMedium)
                Text(stringResource(R.string.forwarder_subtitle))
                Button(onClick = onCreateJob) { Text(stringResource(R.string.forwarder_new_job)) }
            }
        }
        item {
            Card {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.forwarder_local_execution), style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.forwarder_security_note))
                }
            }
        }
    }
}
