package com.autogram.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.*
import uniffi.autogram_android_bridge.*

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    SettingsScreenContent(
        state = state,
        modifier = modifier
    )
}

@Composable
fun SettingsScreenContent(
    state: SettingsUiState,
    modifier: Modifier = Modifier
) {
    AutoGramSurface(modifier = modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .widthIn(max = 980.dp)
                .padding(horizontal = 20.dp),
            contentPadding = PaddingValues(top = 16.dp, bottom = 100.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            item {
                ScreenHeader(
                    titleRes = R.string.settings_title,
                    subtitleRes = R.string.settings_subtitle,
                    action = {
                        StatusPill(text = "System Ready", color = Emerald, isLive = true)
                    }
                )
            }

            // Telegram Accounts Section
            item {
                Text(
                    text = stringResource(R.string.settings_telegram_accounts),
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            if (state.accounts.isEmpty()) {
                item {
                    // Active Telegram Account Mock/Default Card
                    AutoGramGlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        borderColor = NeonCyan.copy(alpha = 0.35f),
                        containerColor = SurfaceGlassStrong
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(52.dp)
                                    .background(CyanToBlueBrush, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.AccountCircle, null, tint = Color.White, modifier = Modifier.size(32.dp))
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        text = "Telegram MTProto Session",
                                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                        color = TextPrimaryDark
                                    )
                                    AutoGramStatusDot(color = Emerald, isPulsing = true, size = 6.dp)
                                }
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = "Online • DC4 Production • Ping 42 ms",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = NeonCyan
                                )
                            }

                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = Emerald.copy(alpha = 0.15f),
                                border = BorderStroke(1.dp, Emerald.copy(alpha = 0.4f))
                            ) {
                                Text(
                                    text = "Tier A (99.8%)",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                    color = Emerald
                                )
                            }
                        }
                    }
                }
            } else {
                items(state.accounts) { acc ->
                    AutoGramGlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        borderColor = NeonCyan.copy(alpha = 0.35f),
                        containerColor = SurfaceGlassStrong
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(50.dp)
                                    .background(CyanToBlueBrush, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.AccountCircle, null, tint = Color.White, modifier = Modifier.size(30.dp))
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Text(
                                        text = acc.accountId,
                                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                        color = TextPrimaryDark
                                    )
                                    AutoGramStatusDot(color = Emerald, isPulsing = true, size = 6.dp)
                                }
                                Text(
                                    text = "MTProto Connected",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondaryDark
                                )
                            }

                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = Emerald.copy(alpha = 0.15f),
                                border = BorderStroke(1.dp, Emerald.copy(alpha = 0.4f))
                            ) {
                                Text(
                                    text = "${acc.tier} (${acc.totalScore.toInt()}%)",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                    color = Emerald
                                )
                            }
                        }
                    }
                }
            }

            // Hardware Encoder Profile Section
            item {
                Text(
                    text = "Akselerasi Perangkat Keras",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    containerColor = SurfaceGlass
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = ElectricViolet.copy(alpha = 0.15f),
                                modifier = Modifier.size(38.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Default.Memory, null, tint = ElectricViolet, modifier = Modifier.size(20.dp))
                                }
                            }
                            Column {
                                Text(
                                    text = stringResource(R.string.settings_hardware_encoder),
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "Android MediaCodec Engine",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextSecondaryDark
                                )
                            }
                        }

                        val hw = state.hardwareProfile
                        if (hw != null) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Surface(
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(10.dp),
                                    color = SurfaceDeep
                                ) {
                                    Column(Modifier.padding(10.dp)) {
                                        Text("ENCODER", style = MaterialTheme.typography.labelSmall, color = TextMutedDark)
                                        Text(hw.bestEncoder, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = NeonCyan)
                                    }
                                }
                                Surface(
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(10.dp),
                                    color = SurfaceDeep
                                ) {
                                    Column(Modifier.padding(10.dp)) {
                                        Text("BITRATE", style = MaterialTheme.typography.labelSmall, color = TextMutedDark)
                                        Text("${(hw.bitrate / 1000u).toLong()} kbps", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = TextPrimaryDark)
                                    }
                                }
                            }
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
                Text(
                    text = "Penyimpanan & Kapasitas",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    containerColor = SurfaceGlass
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = NeonCyan.copy(alpha = 0.15f),
                                modifier = Modifier.size(38.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Default.Storage, null, tint = NeonCyan, modifier = Modifier.size(20.dp))
                                }
                            }
                            Column {
                                Text(
                                    text = "AutoGram Library Storage",
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "F:\\AutoGram Library • Windows Host Online",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = NeonCyan
                                )
                            }
                        }

                        val storage = state.storageBudget
                        val maxBytes = storage?.maxTempBytes?.toLong() ?: 21474836480L
                        val thresholdRatio = storage?.purgeThresholdRatio ?: 0.9f

                        AutoGramProgressBar(
                            progress = thresholdRatio,
                            brush = CyanToBlueBrush,
                            height = 8.dp
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "Budget: ${formatFileSize(maxBytes)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondaryDark
                            )
                            Text(
                                text = "Batas Pembersihan: ${(thresholdRatio * 100).toInt()}%",
                                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                                color = Amber
                            )
                        }
                    }
                }
            }

            // Version info footer
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "AutoGram Android Native v3.8.38",
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                        color = NeonCyan
                    )
                    Text(
                        text = "Cyber Dark Glassmorphism Engine • MTProto via Grammers",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMutedDark
                    )
                }
            }
        }
    }
}

@androidx.compose.ui.tooling.preview.Preview(showBackground = true, backgroundColor = 0xFF0B0F19)
@Composable
fun SettingsScreenPreview() {
    AutoGramTheme(darkTheme = true) {
        SettingsScreenContent(
            state = SettingsUiState(
                hardwareProfile = HardwareProfileSummary(
                    bestEncoder = "h264_mediacodec",
                    priority = 1u,
                    bitrate = 2500000u,
                    preset = "medium"
                ),
                storageBudget = StorageBudgetResult(
                    maxTempBytes = 10000000000UL,
                    purgeThresholdRatio = 0.85f
                ),
                accounts = listOf(
                    AccountScoreResult(
                        accountId = "+62 812-3456-7890",
                        tier = "Tier A (Healthy)",
                        totalScore = 98.5,
                        capabilityScore = 100.0,
                        healthScore = 98.0,
                        latencyScore = 97.5
                    )
                )
            )
        )
    }
}
