package com.autogram.app.ui.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.ui.text.style.TextOverflow
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
import com.autogram.app.features.accounts.AccountSessionItem
import com.autogram.app.features.accounts.AccountsUiState
import com.autogram.app.viewmodel.AccountsViewModel

@Composable
fun AccountsScreen(viewModel: AccountsViewModel, modifier: Modifier = Modifier,
    auth: com.autogram.app.features.auth.AuthViewModel = androidx.lifecycle.viewmodel.compose.viewModel()) {
    com.autogram.app.features.auth.AuthAccountsScreen(auth)
}

@Composable
internal fun AccountsContent(state: AccountsUiState, onRefresh: () -> Unit, modifier: Modifier = Modifier) {
    AutoGramSurface(modifier) {
        LazyColumn(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item(key = "header") {
                ScreenHeader(
                    R.string.accounts_title,
                    R.string.accounts_subtitle,
                    action = {
                        IconButton(onClick = onRefresh, enabled = !state.isLoading) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.accounts_refresh), tint = MutedIceCyan)
                        }
                    }
                )
            }
            item(key = "security") {
                Text(
                    stringResource(R.string.accounts_security_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondaryDark
                )
            }
            if (state.isLoading) item(key = "loading") {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) { CircularProgressIndicator(color = GoldAccent) }
            }
            if (state.errorCode != null) item(key = "error") {
                AutoGramErrorState(
                    stringResource(if (state.errorCode == "native_runtime_unavailable")
                        R.string.accounts_runtime_unavailable else R.string.account_inventory_failed),
                    onRefresh
                )
            }
            if (!state.isLoading && state.errorCode == null && state.sessions.isEmpty()) item(key = "empty") {
                AutoGramEmptyState(
                    stringResource(R.string.accounts_empty_title),
                    stringResource(R.string.accounts_empty_description)
                )
            }
            // Prefix keys so a session named "header" cannot collide with page chrome.
            items(state.sessions, key = { "session:${it.name}" }) { AccountCard(it) }
        }
    }
}

@Composable
private fun AccountCard(item: AccountSessionItem) {
    AutoGramGlassCard(Modifier.fillMaxWidth(), containerColor = SurfaceGlass) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.AccountCircle, null, tint = MutedIceCyan)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(item.name, color = TextPrimaryDark, style = MaterialTheme.typography.titleMedium,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    stringResource(R.string.accounts_source_status,
                        stringResource(accountSourceLabel(item.source)),
                        stringResource(accountStatusLabel(item.status))),
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

internal fun accountSourceLabel(source: String): Int = when (source) {
    "grammers" -> R.string.accounts_source_native
    "grammers+migration_source" -> R.string.accounts_source_combined
    "telethon_migration_source" -> R.string.accounts_source_legacy
    else -> R.string.accounts_source_unknown
}

internal fun accountStatusLabel(status: String): Int = when (status) {
    "migration_required" -> R.string.accounts_status_migration
    else -> R.string.accounts_status_unverified
}
