package com.autogram.app.ui.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.GoldAccent
import com.autogram.app.theme.MutedIceCyan
import com.autogram.app.theme.SurfaceGlass
import com.autogram.app.theme.TextPrimaryDark
import com.autogram.app.theme.TextSecondaryDark
import com.autogram.app.ui.components.AutoGramEmptyState
import com.autogram.app.ui.components.AutoGramErrorState
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.ui.components.ScreenHeader
import com.autogram.app.viewmodel.AccountSessionItem
import com.autogram.app.viewmodel.AccountsViewModel

@Composable
fun AccountsScreen(viewModel: AccountsViewModel, modifier: Modifier = Modifier) {
    val state by viewModel.uiState.collectAsState()
    AutoGramSurface(modifier) {
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 20.dp)) {
            ScreenHeader(
                R.string.accounts_title,
                R.string.accounts_subtitle,
                action = {
                    IconButton(onClick = viewModel::refresh) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.accounts_refresh), tint = MutedIceCyan)
                    }
                }
            )
            Text(
                stringResource(R.string.accounts_security_note),
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondaryDark,
                modifier = Modifier.padding(top = 12.dp, bottom = 12.dp)
            )
            when {
                state.isLoading -> Column(
                    Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) { CircularProgressIndicator(color = GoldAccent) }
                state.errorCode != null -> AutoGramErrorState(
                    stringResource(R.string.account_inventory_failed),
                    viewModel::refresh
                )
                state.sessions.isEmpty() -> AutoGramEmptyState(
                    stringResource(R.string.accounts_empty_title),
                    stringResource(R.string.accounts_empty_description)
                )
                else -> LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) { items(state.sessions, key = { it.name }) { AccountCard(it) } }
            }
        }
    }
}

@Composable
private fun AccountCard(item: AccountSessionItem) {
    AutoGramGlassCard(Modifier.fillMaxWidth(), containerColor = SurfaceGlass) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.AccountCircle, null, tint = MutedIceCyan)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(item.name, color = TextPrimaryDark, style = MaterialTheme.typography.titleMedium)
                Text(
                    stringResource(R.string.accounts_source_status, item.source, item.status),
                    color = TextSecondaryDark,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Surface(color = GoldAccent.copy(alpha = 0.15f)) {
                Text(
                    stringResource(R.string.accounts_local_badge),
                    color = GoldAccent,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }
        }
    }
}
