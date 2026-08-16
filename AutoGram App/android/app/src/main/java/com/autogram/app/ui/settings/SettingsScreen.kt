package com.autogram.app.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.SettingsViewModel

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Text(
                text = stringResource(R.string.settings_title),
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimaryDark
            )
        }

        // Hardware Profile Section
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderDark)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Memory,
                            contentDescription = "Hardware",
                            tint = PrimaryBlue
                        )
                        Text(
                            text = stringResource(R.string.settings_hardware_encoder),
                            style = MaterialTheme.typography.titleLarge,
                            color = TextPrimaryDark
                        )
                    }

                    val hw = state.hardwareProfile
                    if (hw != null) {
                        Text(
                            text = "Encoder: ${hw.bestEncoder} (Prioritas: ${hw.priority})",
                            style = MaterialTheme.typography.bodyLarge,
                            color = TextSecondaryDark
                        )
                        Text(
                            text = "Preset: ${hw.preset} • Bitrate: ${hw.bitrate / 1000} kbps",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMutedDark
                        )
                    } else {
                        Text(
                            text = "Memuat hardware profile...",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondaryDark
                        )
                    }
                }
            }
        }

        // Storage Budget Section
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderDark)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Storage,
                            contentDescription = "Storage",
                            tint = AccentCyan
                        )
                        Text(
                            text = stringResource(R.string.settings_storage_budget),
                            style = MaterialTheme.typography.titleLarge,
                            color = TextPrimaryDark
                        )
                    }

                    val storage = state.storageBudget
                    if (storage != null) {
                        Text(
                            text = "Kapasitas Temp: ${formatFileSize(storage.maxTempBytes.toLong())}",
                            style = MaterialTheme.typography.bodyLarge,
                            color = TextSecondaryDark
                        )
                        Text(
                            text = "Ambang Pembersihan (LRU): ${(storage.purgeThresholdRatio * 100).toInt()}%",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMutedDark
                        )
                    }
                }
            }
        }

        // Accounts Section
        item {
            Text(
                text = stringResource(R.string.settings_telegram_accounts),
                style = MaterialTheme.typography.titleLarge,
                color = TextPrimaryDark,
                modifier = Modifier.padding(top = 8.dp)
            )
        }

        items(state.accounts) { acc ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderDark)
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.AccountCircle,
                        contentDescription = "Account",
                        tint = PrimaryBlue,
                        modifier = Modifier.size(36.dp)
                    )

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = acc.accountId,
                            style = MaterialTheme.typography.titleMedium,
                            color = TextPrimaryDark
                        )
                        Text(
                            text = "Tier: ${acc.tier} • Skor Total: ${acc.totalScore.toInt()}/100",
                            style = MaterialTheme.typography.bodyMedium,
                            color = SuccessGreen
                        )
                    }
                }
            }
        }

        item {
            Text(
                text = stringResource(R.string.settings_version),
                style = MaterialTheme.typography.bodyMedium,
                color = TextMutedDark,
                modifier = Modifier.padding(vertical = 16.dp)
            )
        }
    }
}
