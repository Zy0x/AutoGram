package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

private data class IconSymbolOption(val id: String, val labelRes: Int, val icon: ImageVector)
private data class ColorPresetOption(val hex: String, val color: Color)

@Composable
fun DriveCustomizeIconModal(
    peerId: String,
    title: String,
    kind: String,
    isForum: Boolean = false,
    onDismiss: () -> Unit,
    onSaved: () -> Unit
) {
    val context = LocalContext.current
    val store = remember(context) { PeerAvatarStore(context) }
    val initial = remember(peerId) { store.getCustomIcon(peerId) }

    var selectedSymbol by remember { mutableStateOf(initial?.iconSymbol ?: "default") }
    var selectedColorHex by remember { mutableStateOf(initial?.colorHex) }

    val symbolOptions = remember {
        listOf(
            IconSymbolOption("default", R.string.drive_icon_symbol_default, Icons.Default.Abc),
            IconSymbolOption("cloud", R.string.drive_icon_symbol_cloud, Icons.Default.Cloud),
            IconSymbolOption("folder", R.string.drive_icon_symbol_folder, Icons.Default.Folder),
            IconSymbolOption("vault", R.string.drive_icon_symbol_vault, Icons.Default.Lock),
            IconSymbolOption("video", R.string.drive_icon_symbol_video, Icons.Default.PlayCircle),
            IconSymbolOption("music", R.string.drive_icon_symbol_music, Icons.Default.MusicNote),
            IconSymbolOption("archive", R.string.drive_icon_symbol_archive, Icons.Default.Inventory2),
            IconSymbolOption("star", R.string.drive_icon_symbol_star, Icons.Default.Star),
            IconSymbolOption("bookmark", R.string.drive_icon_symbol_bookmark, Icons.Default.Bookmark)
        )
    }

    val colorPresets = remember {
        listOf(
            ColorPresetOption("#0083B0", Color(0xFF0083B0)), // Ocean Blue
            ColorPresetOption("#00B4DB", Color(0xFF00B4DB)), // Cyan
            ColorPresetOption("#11998E", Color(0xFF11998E)), // Emerald Green
            ColorPresetOption("#F2994A", Color(0xFFF2994A)), // Amber Orange
            ColorPresetOption("#8E2DE2", Color(0xFF8E2DE2)), // Deep Purple
            ColorPresetOption("#FC466B", Color(0xFFFC466B)), // Electric Pink
            ColorPresetOption("#FD746C", Color(0xFFFD746C)), // Coral Red
            ColorPresetOption("#4A00E0", Color(0xFF4A00E0))  // Royal Indigo
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceDeep,
        icon = {
            PeerAvatar(
                title = title,
                peerId = peerId,
                kind = kind,
                isForum = isForum,
                customSymbol = selectedSymbol,
                customColorHex = selectedColorHex,
                size = 64.dp
            )
        },
        title = {
            Text(
                text = stringResource(R.string.drive_customize_icon_title),
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 17.sp
                ),
                color = TextPrimaryDark
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_customize_icon_subtitle, title),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = TextSecondaryDark
                )

                // Symbol Picker
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.drive_customize_symbol_label),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp
                        ),
                        color = GoldAccent
                    )
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.height(130.dp)
                    ) {
                        items(symbolOptions) { opt ->
                            val isSelected = selectedSymbol == opt.id
                            Surface(
                                onClick = { selectedSymbol = opt.id },
                                shape = RoundedCornerShape(12.dp),
                                color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
                                border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline)
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Icon(
                                        imageVector = opt.icon,
                                        contentDescription = null,
                                        tint = if (isSelected) MutedIceCyan else TextPrimaryDark,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Text(
                                        text = stringResource(opt.labelRes),
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontSize = 11.sp,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                        ),
                                        color = if (isSelected) MutedIceCyan else TextPrimaryDark
                                    )
                                }
                            }
                        }
                    }
                }

                // Color Presets
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.drive_customize_color_label),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp
                        ),
                        color = GoldAccent
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        colorPresets.forEach { preset ->
                            val isSelected = selectedColorHex == preset.hex
                            Box(
                                modifier = Modifier
                                    .size(30.dp)
                                    .clip(CircleShape)
                                    .clickable {
                                        selectedColorHex = if (isSelected) null else preset.hex
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Surface(
                                    shape = CircleShape,
                                    color = preset.color,
                                    border = if (isSelected) BorderStroke(2.5.dp, Color.White) else null,
                                    modifier = Modifier.fillMaxSize()
                                ) {
                                    if (isSelected) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(
                                                imageVector = Icons.Default.Check,
                                                contentDescription = null,
                                                tint = Color.White,
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (selectedSymbol == "default" && selectedColorHex == null) {
                        store.removeCustomIcon(peerId)
                    } else {
                        store.setCustomIcon(peerId, selectedSymbol, selectedColorHex)
                    }
                    onSaved()
                    onDismiss()
                }
            ) {
                Text(
                    text = stringResource(R.string.drive_action_save),
                    fontWeight = FontWeight.Bold,
                    color = MutedIceCyan
                )
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (initial != null) {
                    TextButton(
                        onClick = {
                            store.removeCustomIcon(peerId)
                            onSaved()
                            onDismiss()
                        }
                    ) {
                        Text(
                            text = stringResource(R.string.drive_action_reset),
                            color = SoftCoral
                        )
                    }
                }
                TextButton(onClick = onDismiss) {
                    Text(
                        text = stringResource(R.string.drive_action_cancel),
                        color = TextSecondaryDark
                    )
                }
            }
        }
    )
}
