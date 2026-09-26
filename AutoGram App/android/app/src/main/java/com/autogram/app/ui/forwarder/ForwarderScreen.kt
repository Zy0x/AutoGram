package com.autogram.app.ui.forwarder
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.ui.components.AutoGramSurface

@Composable
fun ForwarderScreen() {
    AutoGramSurface {
        Column(Modifier.safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.nav_forwarder))
            Text(stringResource(R.string.capability_jobs_gap))
        }
    }
}
