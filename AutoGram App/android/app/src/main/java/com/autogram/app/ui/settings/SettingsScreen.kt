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
import com.autogram.app.ui.components.ScreenHeader

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
      LazyColumn(
        modifier = Modifier.fillMaxSize().widthIn(max = 980.dp).padding(horizontal = 20.dp),
        contentPadding = PaddingValues(vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
      ) {
        item {
            ScreenHeader(
                titleRes = R.string.settings_title,
                subtitleRes = R.string.settings_subtitle
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
                            contentDescription = stringResource(R.string.settings_hardware_accessibility),
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
                            text = stringResource(
                                R.string.settings_encoder_value,
                                hw.bestEncoder,
                                hw.priority
                            ),
                            style = MaterialTheme.typography.bodyLarge,
                            color = TextSecondaryDark
                        )
                        Text(
                            text = stringResource(
                                R.string.settings_encoder_profile,
                                hw.preset,
                                (hw.bitrate / 1000u).toLong()
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMutedDark
                        )
                    } else {
                        Text(
                            text = stringResource(R.string.settings_hardware_loading),
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
                            contentDescription = stringResource(R.string.settings_storage_accessibility),
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
                            text = stringResource(
                                R.string.settings_storage_capacity,
                                formatFileSize(storage.maxTempBytes.toLong())
                            ),
                            style = MaterialTheme.typography.bodyLarge,
                            color = TextSecondaryDark
                        )
                        Text(
                            text = stringResource(
                                R.string.settings_storage_threshold,
                                (storage.purgeThresholdRatio * 100).toInt()
                            ),
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
                        contentDescription = stringResource(R.string.settings_account_accessibility),
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
                            text = stringResource(
                                R.string.settings_account_score,
                                acc.tier,
                                acc.totalScore.toInt()
                            ),
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
}
