package com.autogram.app.features.cloudtransfer.upload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import uniffi.autogram_android_bridge.NativeAlbumPacking

@Composable
internal fun PhotoAlbumGridPicker(
    packing: NativeAlbumPacking,
    customSize: Int,
    onPackingChange: (NativeAlbumPacking) -> Unit,
    onCustomSizeChange: (Int) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.cloud_upload_album_grid_label))
        OutlinedButton(onClick = { expanded = true }) {
            Text(stringResource(packingLabel(packing)))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            listOf(
                NativeAlbumPacking.SMART_ADAPTIVE to R.string.cloud_upload_album_grid_maximum,
                NativeAlbumPacking.CUSTOM to R.string.cloud_upload_album_grid_custom,
            ).forEach { (value, label) ->
                DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = {
                    onPackingChange(value)
                    expanded = false
                })
            }
        }
        if (packing == NativeAlbumPacking.CUSTOM) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.cloud_upload_album_grid_size))
                Text(customSize.toString())
            }
            Slider(
                modifier = Modifier.testTag("cloud-upload-album-grid-size"),
                value = customSize.toFloat(),
                onValueChange = { onCustomSizeChange(it.toInt().coerceIn(2, 10)) },
                valueRange = 2f..10f,
                steps = 7,
            )
        }
    }
}

private fun packingLabel(packing: NativeAlbumPacking): Int = when (packing) {
    NativeAlbumPacking.CUSTOM -> R.string.cloud_upload_album_grid_custom
    else -> R.string.cloud_upload_album_grid_maximum
}
