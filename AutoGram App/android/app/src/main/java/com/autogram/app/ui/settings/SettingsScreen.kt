package com.autogram.app.ui.settings
import android.os.StatFs
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.BuildConfig
import com.autogram.app.R
import com.autogram.app.runtime.NativeRuntime
import com.autogram.app.runtime.NativeRuntimeStatus
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.ui.components.ScreenHeader
import com.autogram.app.ui.drive.formatFileSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.autogram.app.features.cloud.preview.AndroidPlaybackPreferences

/** Reports actual local state. No inactive login forms or message-only save actions. */
@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val playback = remember(context) { AndroidPlaybackPreferences(context) }
    var rememberPosition by remember { mutableStateOf(playback.rememberPosition) }
    val runtime by NativeRuntime.status.collectAsState()
    var refresh by remember { mutableIntStateOf(0) }
    val freeBytes by produceState<Long?>(null, refresh) {
        value = withContext(Dispatchers.IO) { runCatching { StatFs(context.filesDir.path).availableBytes }.getOrNull() }
    }
    val runtimeLabel = when (runtime) {
        NativeRuntimeStatus.READY -> R.string.native_runtime_ready
        NativeRuntimeStatus.STARTING -> R.string.native_runtime_starting
        NativeRuntimeStatus.UNAVAILABLE -> R.string.native_runtime_unavailable
    }
    AutoGramSurface(modifier) {
        LazyColumn(Modifier.fillMaxSize().safeDrawingPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { ScreenHeader(R.string.real_settings_title, R.string.real_settings_scope) }
            item { Text(stringResource(R.string.real_runtime_status, stringResource(runtimeLabel))) }
            item { Text(stringResource(R.string.real_device_storage,
                freeBytes?.let(::formatFileSize) ?: stringResource(R.string.real_unknown))) }
            item { OutlinedButton(onClick = { refresh++ }) { Text(stringResource(R.string.drive_action_refresh)) } }
            item { Text(stringResource(R.string.android_app_version, BuildConfig.VERSION_NAME)) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stringResource(R.string.cloud_remember_position), Modifier.weight(1f))
                    Switch(checked = rememberPosition, onCheckedChange = {
                        rememberPosition = it; playback.rememberPosition = it
                    })
                }
                Text(stringResource(R.string.cloud_history_scope))
                TextButton(onClick = playback::clearHistory) { Text(stringResource(R.string.cloud_clear_history)) }
            }
            item { Text(stringResource(R.string.android_engine_preview)) }
        }
    }
}
