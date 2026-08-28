package com.autogram.app.ui.settings

import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
import com.autogram.app.viewmodel.*

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
    var parallelStreams by remember { mutableFloatStateOf(4f) }
    var selectedChunkSize by remember { mutableStateOf("512 KB") }
    var smartBackoffEnabled by remember { mutableStateOf(true) }
    var amoledThemeEnabled by remember { mutableStateOf(false) }
    var isAddAccountDialogOpen by remember { mutableStateOf(false) }
    var actionToastMessage by remember { mutableStateOf<String?>(null) }

    AutoGramSurface(modifier = modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .widthIn(max = 980.dp)
                .padding(horizontal = 20.dp),
            contentPadding = PaddingValues(top = 10.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
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

            // Toast feedback banner if active
            actionToastMessage?.let { msg ->
                item {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        color = DustySage.copy(alpha = 0.15f),
                        border = BorderStroke(1.dp, DustySage)
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(Icons.Default.CheckCircle, null, tint = DustySage, modifier = Modifier.size(16.dp))
                            Text(text = msg, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold), color = DustySage)
                        }
                    }
                }
            }

            // 1. MULTI-ACCOUNT MANAGEMENT
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.settings_section_accounts),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark
                    )
                    TextButton(onClick = { isAddAccountDialogOpen = true }) {
                        Icon(Icons.Default.Add, null, tint = GoldAccent, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = stringResource(R.string.settings_action_add_account),
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                            color = GoldAccent
                        )
                    }
                }
            }

            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    borderColor = ChampagneGold.copy(alpha = 0.3f),
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
                                text = "Akun Utama (@AutoGramCloud)",
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = "DC4 Production • Tier A (99.8%) • Ping 42 ms",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = ChampagneGold
                            )
                        }

                        Surface(
                            color = DustySage.copy(alpha = 0.15f),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(
                                text = "Aktif",
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, fontWeight = FontWeight.Bold),
                                color = DustySage
                            )
                        }
                    }
                }
            }

            // 2. NETWORK & MTPROTO CONCURRENCY TUNING
            item {
                Text(
                    text = stringResource(R.string.settings_section_network),
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
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        // Slider Parallel Streams
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = stringResource(R.string.settings_stream_concurrency, parallelStreams.toInt()),
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "1 - 8x MTProto",
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                    color = MutedIceCyan
                                )
                            }
                            Slider(
                                value = parallelStreams,
                                onValueChange = { parallelStreams = it },
                                valueRange = 1f..8f,
                                steps = 6,
                                colors = SliderDefaults.colors(
                                    thumbColor = MutedIceCyan,
                                    activeTrackColor = MutedIceCyan,
                                    inactiveTrackColor = Color(0x33FFFFFF)
                                )
                            )
                        }

                        // Chunk size selector
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Ukuran Blok MTProto",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondaryDark
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf("128 KB", "512 KB", "1 MB").forEach { size ->
                                    Surface(
                                        onClick = { selectedChunkSize = size },
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (selectedChunkSize == size) MutedIceCyan.copy(alpha = 0.2f) else Color(0x1AFFFFFF),
                                        border = if (selectedChunkSize == size) BorderStroke(1.dp, MutedIceCyan) else null
                                    ) {
                                        Text(
                                            text = size,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                            style = MaterialTheme.typography.labelSmall.copy(
                                                fontSize = 10.5.sp,
                                                fontWeight = if (selectedChunkSize == size) FontWeight.Bold else FontWeight.Normal
                                            ),
                                            color = if (selectedChunkSize == size) MutedIceCyan else TextSecondaryDark
                                        )
                                    }
                                }
                            }
                        }

                        // Smart Backoff Switch
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = stringResource(R.string.settings_smart_backoff),
                                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "Otomatis turunkan kecepatan saat FloodWait terdeteksi",
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                    color = TextSecondaryDark
                                )
                            }
                            Switch(
                                checked = smartBackoffEnabled,
                                onCheckedChange = { smartBackoffEnabled = it },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = GoldAccent,
                                    checkedTrackColor = GoldAccent.copy(alpha = 0.3f)
                                )
                            )
                        }
                    }
                }
            }

            // 3. CACHE & STORAGE CLEANER
            item {
                Text(
                    text = stringResource(R.string.settings_section_cache),
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
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Thumbnail Cache: 14.2 MB", style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)
                            Text("Download Temp: 48.6 MB", style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            OutlinedButton(
                                onClick = { actionToastMessage = "Thumbnail cache berhasil dibersihkan!" },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, Color(0x33FFFFFF))
                            ) {
                                Text(
                                    text = "Bersihkan Thumb",
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                    color = TextPrimaryDark
                                )
                            }
                            OutlinedButton(
                                onClick = { actionToastMessage = "Unduhan sementara berhasil dibersihkan!" },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, Color(0x33FFFFFF))
                            ) {
                                Text(
                                    text = "Bersihkan Temp",
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                    color = TextPrimaryDark
                                )
                            }
                        }
                    }
                }
            }

            // 4. APPEARANCE & ACCESSIBILITY
            item {
                Text(
                    text = stringResource(R.string.settings_section_theme),
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
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.settings_theme_amoled),
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextPrimaryDark
                            )
                            Switch(
                                checked = amoledThemeEnabled,
                                onCheckedChange = { amoledThemeEnabled = it },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = MutedIceCyan,
                                    checkedTrackColor = MutedIceCyan.copy(alpha = 0.3f)
                                )
                            )
                        }

                        HorizontalDivider(color = Color(0x14FFFFFF))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Bahasa Aplikasi",
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextPrimaryDark
                            )
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = GoldAccent.copy(alpha = 0.15f),
                                border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.35f))
                            ) {
                                Text(
                                    text = "Bahasa Indonesia",
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                    color = GoldAccent
                                )
                            }
                        }
                    }
                }
            }

            // 5. DATABASE BACKUP & EXPORT
            item {
                Text(
                    text = stringResource(R.string.settings_section_database),
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
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "SQLite Migration History",
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = "Schema v2.4 • Enkripsi AES-256",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextSecondaryDark
                            )
                        }

                        Button(
                            onClick = { actionToastMessage = "Backup Database SQLite berhasil diekspor!" },
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = GoldAccent,
                                contentColor = CanvasDeepNavy
                            )
                        ) {
                            Icon(Icons.Default.Backup, null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = "Ekspor",
                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)
                            )
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
                        text = "AutoGram Android Native v3.8.50",
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