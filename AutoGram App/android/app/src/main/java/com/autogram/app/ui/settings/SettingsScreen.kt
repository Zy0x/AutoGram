package com.autogram.app.ui.settings

import android.os.StatFs
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.BuildConfig
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.AndroidPlaybackPreferences
import com.autogram.app.runtime.NativeRuntime
import com.autogram.app.runtime.NativeRuntimeStatus
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*
import com.autogram.app.ui.drive.formatFileSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val playback = remember(context) { AndroidPlaybackPreferences(context) }
    var rememberPosition by remember { mutableStateOf(playback.rememberPosition) }
    val runtime by NativeRuntime.status.collectAsState()
    var refreshStorage by remember { mutableIntStateOf(0) }

    val freeBytes by produceState<Long?>(null, refreshStorage) {
        value = withContext(Dispatchers.IO) {
            runCatching { StatFs(context.filesDir.path).availableBytes }.getOrNull()
        }
    }

    val runtimeLabel = when (runtime) {
        NativeRuntimeStatus.READY -> R.string.native_runtime_ready
        NativeRuntimeStatus.STARTING -> R.string.native_runtime_starting
        NativeRuntimeStatus.UNAVAILABLE -> R.string.native_runtime_unavailable
    }

    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Header
            item(key = "header") {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = stringResource(R.string.ui2_settings_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.ui2_settings_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Section 1: Pemutaran Media
            item(key = "section_playback") {
                SettingsSectionHeader(stringResource(R.string.ui2_section_playback))
            }

            item(key = "playback_card") {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    borderColor = BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        // Switch item: Ingat Posisi
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = SoftViolet.copy(alpha = 0.15f),
                                modifier = Modifier.size(40.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.Default.PlayCircleOutline,
                                        contentDescription = null,
                                        tint = SoftViolet,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.ui2_playback_remember_title),
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 14.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = stringResource(R.string.ui2_playback_remember_desc),
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                                    color = TextSecondaryDark
                                )
                            }
                            Switch(
                                checked = rememberPosition,
                                onCheckedChange = { checked ->
                                    rememberPosition = checked
                                    playback.rememberPosition = checked
                                },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Color.White,
                                    checkedTrackColor = MutedIceCyan,
                                    uncheckedThumbColor = TextMutedDark,
                                    uncheckedTrackColor = SurfaceElevatedDark
                                )
                            )
                        }

                        Divider(color = BorderHairline, thickness = 0.5.dp)

                        // Action item: Hapus Riwayat
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = SoftCoral.copy(alpha = 0.15f),
                                modifier = Modifier.size(40.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.Default.DeleteOutline,
                                        contentDescription = null,
                                        tint = SoftCoral,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.ui2_clear_history_title),
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 14.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = stringResource(R.string.ui2_clear_history_desc),
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                                    color = TextSecondaryDark
                                )
                            }
                            OutlinedButton(
                                onClick = {
                                    playback.clearHistory()
                                    Toast.makeText(
                                        context,
                                        context.getString(R.string.ui2_history_cleared),
                                        Toast.LENGTH_SHORT
                                    ).show()
                                },
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, SoftCoral.copy(alpha = 0.4f)),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.cloud_clear_history),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 11.sp
                                    ),
                                    color = SoftCoral
                                )
                            }
                        }
                    }
                }
            }

            // Section 2: Penyimpanan
            item(key = "section_storage") {
                SettingsSectionHeader(stringResource(R.string.ui2_section_storage))
            }

            item(key = "storage_card") {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    borderColor = BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = DustySage.copy(alpha = 0.15f),
                            modifier = Modifier.size(40.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.Storage,
                                    contentDescription = null,
                                    tint = DustySage,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Text(
                                text = stringResource(R.string.ui2_free_space),
                                style = MaterialTheme.typography.titleSmall.copy(
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp
                                ),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = freeBytes?.let(::formatFileSize) ?: stringResource(R.string.real_unknown),
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                ),
                                color = DustySage
                            )
                        }
                        IconButton(
                            onClick = { refreshStorage++ },
                            modifier = Modifier.size(40.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.drive_action_refresh),
                                tint = MutedIceCyan,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }

            // Section 3: Tentang & Sistem
            item(key = "section_about") {
                SettingsSectionHeader(stringResource(R.string.ui2_section_about))
            }

            item(key = "about_card") {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    borderColor = BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        // App Version
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(10.dp),
                                    color = GoldAccent.copy(alpha = 0.15f),
                                    modifier = Modifier.size(40.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            imageVector = Icons.Default.Info,
                                            contentDescription = null,
                                            tint = GoldAccent,
                                            modifier = Modifier.size(20.dp)
                                        )
                                    }
                                }
                                Text(
                                    text = stringResource(R.string.ui2_version),
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 14.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                            }
                            Surface(
                                shape = CircleShape,
                                color = GoldAccent.copy(alpha = 0.12f),
                                border = BorderStroke(0.5.dp, GoldAccent.copy(alpha = 0.4f))
                            ) {
                                Text(
                                    text = BuildConfig.VERSION_NAME,
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    ),
                                    color = GoldAccent,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
                                )
                            }
                        }

                        Divider(color = BorderHairline, thickness = 0.5.dp)

                        // Engine Status
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(10.dp),
                                    color = MutedIceCyan.copy(alpha = 0.15f),
                                    modifier = Modifier.size(40.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            imageVector = Icons.Default.Memory,
                                            contentDescription = null,
                                            tint = MutedIceCyan,
                                            modifier = Modifier.size(20.dp)
                                        )
                                    }
                                }
                                Text(
                                    text = stringResource(R.string.ui2_engine),
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 14.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                AutoGramStatusDot(
                                    color = if (runtime == NativeRuntimeStatus.READY) SuccessGreen else WarmAmber,
                                    isPulsing = runtime == NativeRuntimeStatus.READY,
                                    size = 7.dp
                                )
                                Text(
                                    text = stringResource(runtimeLabel),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                                    color = if (runtime == NativeRuntimeStatus.READY) SuccessGreen else WarmAmber
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsSectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall.copy(
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.3.sp
        ),
        color = TextPrimaryDark,
        modifier = Modifier.padding(top = 4.dp)
    )
}
