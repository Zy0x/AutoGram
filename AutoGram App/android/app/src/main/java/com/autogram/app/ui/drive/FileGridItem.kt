package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileGridItem(
    item: DriveFileItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isVideo = item.mimeType.startsWith("video") || item.telegramCategory.equals("video", ignoreCase = true)
    val isAudio = item.mimeType.startsWith("audio") || item.telegramCategory.equals("audio", ignoreCase = true)
    val isImage = item.mimeType.startsWith("image") || item.telegramCategory.equals("photo", ignoreCase = true)
    val isZip = item.name.endsWith(".zip", ignoreCase = true) || item.mimeType.contains("zip", ignoreCase = true)
    val isSync = item.name.contains("Processing", ignoreCase = true) || item.name.contains("Sync", ignoreCase = true)

    val formatBadgeText = when {
        item.isFolder -> "FOLDER"
        isZip -> "SPARSE ZIP"
        isVideo -> if (item.size > 20_000_000) "4K UHD" else "1080p 60F"
        isImage -> "PHOTO HD"
        isAudio -> "AUDIO MP3"
        item.mimeType.contains("pdf", ignoreCase = true) -> "PDF DOC"
        else -> item.telegramCategory.uppercase()
    }

    val formatBadgeColor = when {
        item.isFolder -> MutedIceCyan
        isZip -> ChampagneGold
        isVideo -> CategoryVideo
        isImage -> CategoryPhoto
        isAudio -> CategoryAudio
        else -> TextSecondaryDark
    }

    val border = when {
        isSelected -> BorderStroke(2.dp, GoldAccent)
        isSync -> BorderStroke(1.dp, GoldAccent.copy(alpha = 0.5f))
        else -> BorderStroke(1.dp, CardNavyBorder)
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(16.dp))
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) SurfaceElevatedDark else CardNavyBg
        ),
        border = border
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            // 1. Full-Bleed Thumbnail or Thematic Center Icon
            if (!item.thumbnailUri.isNullOrBlank()) {
                AsyncImage(
                    model = item.thumbnailUri,
                    contentDescription = item.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            } else if (item.isFolder) {
                // Folder 2:3 Center Presentation
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(SurfaceGlassStrong, SurfaceDeep)
                            )
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = MutedIceCyan.copy(alpha = 0.12f),
                            modifier = Modifier.size(56.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.Folder,
                                    contentDescription = null,
                                    tint = MutedIceCyan,
                                    modifier = Modifier.size(32.dp)
                                )
                            }
                        }
                        Text(
                            text = item.name,
                            style = MaterialTheme.typography.titleSmall.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            ),
                            color = TextPrimaryDark,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 10.dp)
                        )
                        Text(
                            text = "${(item.size % 20 + 5)} items",
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = TextSecondaryDark
                        )
                    }
                }
            } else {
                // Media / Document 2:3 Placeholder Presentation
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(SurfaceDeep),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = when {
                            isVideo -> Icons.Default.Videocam
                            isImage -> Icons.Default.Image
                            isAudio -> Icons.Default.Audiotrack
                            isZip -> Icons.Default.FolderZip
                            else -> Icons.AutoMirrored.Filled.InsertDriveFile
                        },
                        contentDescription = null,
                        tint = formatBadgeColor.copy(alpha = 0.35f),
                        modifier = Modifier.size(54.dp)
                    )
                }
            }

            // 2. Cinematic Dark Vignette Overlay
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color(0x66000000),
                                Color.Transparent,
                                Color(0x99000000),
                                Color(0xFA040D1A)
                            )
                        )
                    )
            )

            // 3. Top Row: Format Pill (Left) + Selection Circle (Right)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    color = Color(0xCC051120),
                    shape = RoundedCornerShape(6.dp),
                    border = BorderStroke(0.5.dp, formatBadgeColor.copy(alpha = 0.5f))
                ) {
                    Text(
                        text = formatBadgeText,
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.3.sp
                        ),
                        color = formatBadgeColor
                    )
                }

                // 1-Tap Select Circle
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .clickable { onLongClick() }
                        .background(if (isSelected) GoldAccent else Color(0x55000000))
                        .border(
                            1.5.dp,
                            if (isSelected) GoldAccent else Color(0x88FFFFFF),
                            CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (isSelected) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = stringResource(R.string.drive_item_selected_accessibility),
                            tint = CanvasDeepNavy,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }

            // 4. Center Play Button for Videos
            if (isVideo && !isSelected) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(Color(0x77000000))
                        .border(1.dp, Color(0x55FFFFFF), CircleShape)
                        .align(Alignment.Center),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }

            // 5. Bottom Info Overlay
            if (!item.isFolder) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.BottomCenter)
                        .padding(horizontal = 10.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    Text(
                        text = item.name,
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp
                        ),
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = formatFileSize(item.size),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Medium
                            ),
                            color = TextSecondaryDark
                        )

                        if (isVideo) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Memory,
                                    contentDescription = null,
                                    tint = GoldAccent,
                                    modifier = Modifier.size(11.dp)
                                )
                                Text(
                                    text = "NVENC",
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 9.5.sp,
                                        fontWeight = FontWeight.Bold
                                    ),
                                    color = GoldAccent
                                )
                            }
                        } else if (isZip) {
                            Text(
                                text = "RAM Stream",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 9.5.sp,
                                    fontWeight = FontWeight.Bold
                                ),
                                color = ChampagneGold
                            )
                        }
                    }
                }
            }
        }
    }
}

fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt().coerceIn(0, units.size - 1)
    val value = bytes / Math.pow(1024.0, digitGroups.toDouble())
    return String.format(java.util.Locale.US, "%.1f %s", value, units[digitGroups])
}