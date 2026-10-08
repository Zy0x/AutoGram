package com.autogram.app.features.cloud

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R

@Composable
fun CloudControls(state: CloudState, onLocations: (Boolean) -> Unit,
    onChoose: (CloudLocation) -> Unit, onMore: () -> Unit) {
    var showLocations by remember(state.scope.accountId) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(enabled = state.scope.accountId.isNotBlank(), onClick = {
            showLocations = true; onLocations(false)
        }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
            Text(stringResource(R.string.cloud_choose_location))
        }
        if (state.nextOffset != null) {
            TextButton(onClick = onMore, enabled = !state.loading, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cloud_more))
            }
        }
    }
    if (showLocations) AlertDialog(onDismissRequest = { showLocations = false },
        title = { Text(stringResource(R.string.cloud_choose_location)) },
        text = {
            Column {
                TextButton(onClick = {
                    showLocations = false; onChoose(CloudLocation("me", "", "self"))
                }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.cloud_saved_messages))
                }
                state.locationsError?.let { Text(stringResource(cloudErrorLabel(it))) }
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(state.locations, key = { it.id }) { location ->
                        TextButton(onClick = { showLocations = false; onChoose(location) },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Text(location.title.ifBlank { location.id })
                        }
                    }
                    if (state.loadingLocations) item { CircularProgressIndicator(Modifier.padding(16.dp)) }
                    if (state.locationsCursor != null) item {
                        TextButton(enabled = !state.loadingLocations, onClick = { onLocations(true) }) {
                            Text(stringResource(R.string.cloud_more))
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !state.loadingLocations, onClick = { onLocations(false) }) {
            Text(stringResource(R.string.cloud_refresh))
        } },
        dismissButton = { TextButton(onClick = { showLocations = false }) { Text(stringResource(R.string.native_close)) } })
}

fun cloudErrorLabel(code: String): Int = when (code) {
    "not_authorized", "account_changed", "account_missing", "account_not_selected" -> R.string.cloud_account_required
    "flood_wait" -> R.string.cloud_rate_limited
    "cloud_cursor_expired", "cloud_location_missing" -> R.string.cloud_refresh_required
    "cloud_media_truncated", "cloud_stream_closed", "cloud_cursor_invalid" -> R.string.cloud_read_failed
    "cloud_image_too_large" -> R.string.cloud_image_too_large
    "storage_space_unavailable" -> R.string.preview_image_storage_low
    "cloud_format_unsupported" -> R.string.cloud_format_unsupported
    "drive_operation_unavailable", "drive_delete_unavailable" -> R.string.real_cloud_unavailable
    else -> R.string.cloud_read_failed
}
