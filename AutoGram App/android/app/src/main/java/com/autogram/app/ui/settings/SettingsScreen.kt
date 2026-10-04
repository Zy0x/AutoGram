package com.autogram.app.ui.settings

import uniffi.autogram_android_bridge.getAvailableStorageBytes
import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val playback = remember(context) { AndroidPlaybackPreferences(context) }
    var rememberPosition by remember { mutableStateOf(playback.rememberPosition) }
    val runtime by NativeRuntime.status.collectAsState()
    var refreshStorage by remember { mutableIntStateOf(0) }

    val sharedPrefs = remember(context) { context.getSharedPreferences("autogram_network_prefs", Context.MODE_PRIVATE) }
    var bypassCellular by remember { mutableStateOf(sharedPrefs.getBoolean("bypass_cellular_turbo", false)) }

    var pendingRestoreUri by remember { mutableStateOf<Uri?>(null) }
    var showRestoreConfirmDialog by remember { mutableStateOf(false) }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/x-sqlite3")
    ) { uri ->
        if (uri != null) {
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val dbFile = File(context.filesDir, "telegram_migrator.db")
                    if (dbFile.exists()) {
                        context.contentResolver.openOutputStream(uri)?.use { outStream ->
                            dbFile.inputStream().use { inStream ->
                                inStream.copyTo(outStream)
                            }
                        }
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, context.getString(R.string.settings_db_export_success), Toast.LENGTH_SHORT).show()
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, context.getString(R.string.settings_db_export_success), Toast.LENGTH_SHORT).show()
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Export error: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    val restoreLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            pendingRestoreUri = uri
            showRestoreConfirmDialog = true
        }
    }

    val freeBytes by produceState<Long?>(null, refreshStorage, runtime) {
        value = withContext(Dispatchers.IO) {
            runCatching { getAvailableStorageBytes().coerceAtMost(Long.MAX_VALUE.toULong()).toLong() }.getOrNull()
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

            // Section: Jaringan & Konkurensi
            item(key = "section_network") {
                SettingsSectionHeader(stringResource(R.string.settings_network_bypass_title))
            }

            item(key = "network_card") {
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
                            color = MutedIceCyan.copy(alpha = 0.15f),
                            modifier = Modifier.size(40.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.Speed,
                                    contentDescription = null,
                                    tint = MutedIceCyan,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Text(
                                text = stringResource(R.string.settings_network_bypass_title),
                                style = MaterialTheme.typography.titleSmall.copy(
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp
                                ),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = stringResource(R.string.settings_network_bypass_desc),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                                color = TextSecondaryDark
                            )
                        }
                        Switch(
                            checked = bypassCellular,
                            onCheckedChange = { checked ->
                                bypassCellular = checked
                                sharedPrefs.edit().putBoolean("bypass_cellular_turbo", checked).apply()
                            },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = Color.White,
                                checkedTrackColor = MutedIceCyan,
                                uncheckedThumbColor = TextMutedDark,
                                uncheckedTrackColor = SurfaceElevatedDark
                            )
                        )
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
                            modifier = Modifier.size(48.dp)
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

            // Section: Cadangan & Pemulihan Database
            item(key = "section_db_backup") {
                SettingsSectionHeader(stringResource(R.string.settings_db_backup_title))
            }

            item(key = "db_backup_card") {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    borderColor = BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
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
                                        imageVector = Icons.Default.Backup,
                                        contentDescription = null,
                                        tint = GoldAccent,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.settings_db_backup_title),
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 14.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = stringResource(R.string.settings_db_backup_desc),
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                                    color = TextSecondaryDark
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Button(
                                onClick = {
                                    val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
                                    exportLauncher.launch("AutoGram_Backup_$timestamp.db")
                                },
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MutedIceCyan.copy(alpha = 0.2f),
                                    contentColor = MutedIceCyan
                                ),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Default.CloudUpload, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.settings_db_export_action), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            }

                            OutlinedButton(
                                onClick = {
                                    restoreLauncher.launch(arrayOf("*/*"))
                                },
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, SoftCoral.copy(alpha = 0.4f)),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Default.SettingsBackupRestore, contentDescription = null, tint = SoftCoral, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.settings_db_restore_action), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = SoftCoral)
                            }
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

    if (showRestoreConfirmDialog && pendingRestoreUri != null) {
        AlertDialog(
            onDismissRequest = {
                showRestoreConfirmDialog = false
                pendingRestoreUri = null
            },
            title = { Text(stringResource(R.string.settings_db_restore_action)) },
            text = { Text(stringResource(R.string.settings_db_restore_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        val uri = pendingRestoreUri
                        showRestoreConfirmDialog = false
                        pendingRestoreUri = null
                        if (uri != null) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val dbFile = File(context.filesDir, "telegram_migrator.db")
                                    val walFile = File(context.filesDir, "telegram_migrator.db-wal")
                                    val shmFile = File(context.filesDir, "telegram_migrator.db-shm")
                                    if (walFile.exists()) walFile.delete()
                                    if (shmFile.exists()) shmFile.delete()

                                    context.contentResolver.openInputStream(uri)?.use { inStream ->
                                        dbFile.outputStream().use { outStream ->
                                            inStream.copyTo(outStream)
                                        }
                                    }
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, context.getString(R.string.settings_db_restore_success), Toast.LENGTH_LONG).show()
                                        refreshStorage++
                                    }
                                } catch (e: Exception) {
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "Restore error: ${e.message}", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        }
                    }
                ) {
                    Text(stringResource(R.string.native_confirm), color = SoftCoral)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showRestoreConfirmDialog = false
                    pendingRestoreUri = null
                }) {
                    Text(stringResource(R.string.drive_action_cancel))
                }
            }
        )
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
