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
            contentPadding = PaddingValues(top = 10.dp, bottom = 100.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Spacious Clean Header Row
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = stringResource(R.string.settings_title),
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = (-0.3).sp
                            ),
                            color = TextPrimaryDark
                        )
                        Text(
                            text = stringResource(R.string.settings_subtitle),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = TextSecondaryDark
                        )
                    }

                    StatusPill(text = "System Ready", color = DustySage, isLive = true)
                }
            }

            // Telegram Accounts Section
            item {
                Text(
                    text = stringResource(R.string.settings_telegram_accounts),
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            if (state.accounts.isEmpty()) {
                item {
                    // Active Telegram Account Mock/Default Card (Stitch Soft Luxury)
                    AutoGramGlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        borderColor = ChampagneGold.copy(alpha = 0.25f),
                        containerColor = SurfaceGlassStrong
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(46.dp)
                                    .background(ChampagneToCyanBrush, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.AccountCircle, null, tint = Color.White, modifier = Modifier.size(28.dp))
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Telegram MTProto Session",
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Spacer(Modifier.height(1.dp))
                                Text(
                                    text = "Online • DC4 Production • Ping 42 ms",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                    color = ChampagneGold
                                )
                            }

                            Surface(
                                color = DustySage.copy(alpha = 0.15f),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text(
                                    text = "Tier A (99.8%)",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                    color = DustySage,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
            } else {
                items(state.accounts, key = { it.accountId }) { account ->
                    AutoGramGlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        borderColor = BorderHairline,
                        containerColor = SurfaceGlass
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(44.dp)
                                    .background(ChampagneToCyanBrush, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.AccountCircle, null, tint = Color.White, modifier = Modifier.size(24.dp))
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = account.accountId,
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "Skor: ${account.totalScore.toInt()}/100 • Latensi: ${account.latencyScore.toInt()}ms",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                    color = TextSecondaryDark
                                )
                            }

                            StatusPill(text = "Tier ${account.tier}", color = DustySage, isLive = true)
                        }
                    }
                }
            }

            // Hardware Acceleration Profile
            item {
                Text(
                    text = "Akselerasi Perangkat Keras",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    borderColor = BorderHairline,
                    containerColor = SurfaceGlass
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = SoftViolet.copy(alpha = 0.15f),
                                modifier = Modifier.size(36.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Default.Memory, null, tint = SoftViolet, modifier = Modifier.size(18.dp))
                                }
                            }
                            Column {
                                Text(
                                    text = "Hardware Encoder",
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "Android MediaCodec Engine",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                    color = TextSecondaryDark
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Surface(
                                color = SurfaceDeep.copy(alpha = 0.6f),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    Text("ENCODER", style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp), color = TextMutedDark)
                                    Spacer(Modifier.height(2.dp))
                                    Text("h264_mediacodec", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp), color = ChampagneGold)
                                }
                            }
                            Surface(
                                color = SurfaceDeep.copy(alpha = 0.6f),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    Text("BITRATE", style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp), color = TextMutedDark)
                                    Spacer(Modifier.height(2.dp))
                                    Text("5000 kbps", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp), color = TextPrimaryDark)
                                }
                            }
                        }
                    }
                }
            }

            // Storage & Capacity
            item {
                Text(
                    text = "Penyimpanan & Kapasitas",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    borderColor = BorderHairline,
                    containerColor = SurfaceGlass
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = MutedIceCyan.copy(alpha = 0.15f),
                                modifier = Modifier.size(36.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Default.Storage, null, tint = MutedIceCyan, modifier = Modifier.size(18.dp))
                                }
                            }
                            Column {
                                Text(
                                    text = "AutoGram Library Storage",
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "F:\\AutoGram Library • Windows Host Online",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                    color = TextSecondaryDark
                                )
                            }
                        }

                        AutoGramProgressBar(
                            progress = 0.08f,
                            brush = ChampagneToCyanBrush,
                            height = 5.dp
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Budget: 20.0 GB", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp), color = TextSecondaryDark)
                            Text("Batas Pembersihan: 90%", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp), color = WarmAmber)
                        }
                    }
                }
            }

            // Version Tag
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "AutoGram Android Native v3.8.46",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold),
                        color = ChampagneGold
                    )
                    Text(
                        text = "Stitch Soft Luxury Engine • MTProto via Grammers",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp),
                        color = TextMutedDark
                    )
                }
            }
        }
    }
}
